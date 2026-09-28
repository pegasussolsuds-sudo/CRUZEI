import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';
/**
 * Canal de invalidação dos caches de candidatos da descoberta (um por processo do cluster): mudou visibilidade,
 * pausa, modo de descoberta, foto, nome… → todo processo esquece aquela pessoa na hora. '*' = esquece todo mundo.
 */
export const CANDIDATE_INVALIDATION_CHANNEL = 'metch:cand-inv';

/** o pipeline do ioredis não rejeita quando um comando falha — devolve [erro, resultado] por comando */
export function throwPipelineError(results: [Error | null, unknown][] | null | undefined): void {
  const failed = results?.find(([err]) => err);
  if (failed?.[0]) throw failed[0];
}

/**
 * Sinal de multidão (descoberta de lugares): só entra quando a pessoa está elegível (visível, fora de área privada,
 * fora de um lugar já conhecido, conta com idade mínima) — quem decide é o LocationService. Aqui só gravamos
 * AGREGADOS: HyperLogLog de hashes com chave (nunca o id) e contagens por sub-célula/faixa do dia, com TTL.
 */
export interface CrowdSignal {
  /** HMAC do id (crowdMember) */
  member: string;
  /** dia de Brasília (yyyy-mm-dd) */
  day: string;
  /** último caractere do geohash-8 (sub-célula de ~38 × 19 m dentro da célula geohash-7) */
  sub: string;
  /** faixa do dia: 0 madrugada, 1 dia, 2 noite */
  band: 0 | 1 | 2;
  /** permanência mínima (ms) na célula antes de contar */
  dwellMs: number;
  /** TTL (s) das chaves de multidão */
  ttlS: number;
}

/**
 * Presença + "desde quando está nesta célula" + sinal de multidão numa ida só ao Redis (atômico).
 * Mudar pra uma célula VIZINHA conta como a mesma estadia (GPS oscila na borda).
 * KEYS[1] = user:loc:<uid>, KEYS[2] = presence:<geohash>
 */
const PRESENCE_LUA = `
local locKey, presKey = KEYS[1], KEYS[2]
local uid, gh, lat, lng = ARGV[1], ARGV[2], ARGV[3], ARGV[4]
local now, ttl = tonumber(ARGV[5]), tonumber(ARGV[6])
local poiId, poiName, hidden, cell, neighbors = ARGV[7], ARGV[8], ARGV[9], ARGV[10], ARGV[11]
local prev = redis.call('HMGET', locKey, 'geohash', 'cell', 'cell_since')
local prevGh, prevCell, prevSince = prev[1], prev[2], prev[3]
local stay = false
if prevCell and cell ~= '' then
  stay = (prevCell == cell) or (string.find(neighbors, ',' .. prevCell .. ',', 1, true) ~= nil)
end
local since = now
if stay and prevSince then since = tonumber(prevSince) end
redis.call('ZREMRANGEBYSCORE', presKey, '-inf', now - ttl * 1000)
redis.call('ZADD', presKey, now, uid)
redis.call('EXPIRE', presKey, ttl)
redis.call('HSET', locKey, 'lat', lat, 'lng', lng, 'geohash', gh, 'updated_at', now, 'poi_id', poiId, 'poi_name', poiName, 'hidden', hidden, 'cell', cell, 'cell_since', since)
redis.call('EXPIRE', locKey, ttl)
if prevGh and prevGh ~= gh then redis.call('ZREM', 'presence:' .. prevGh, uid) end
local wrote = 0
if ARGV[12] == '1' and hidden ~= '1' and cell ~= '' and (now - since) >= tonumber(ARGV[13]) then
  local member, day, sub, band, cttl = ARGV[14], ARGV[15], ARGV[16], ARGV[17], tonumber(ARGV[18])
  local uKey = 'crowd:u:' .. day .. ':' .. cell
  local dKey = 'crowd:d:' .. day .. ':' .. cell
  local cKey = 'crowd:cells:' .. day
  redis.call('PFADD', uKey, member)
  redis.call('EXPIRE', uKey, cttl)
  redis.call('HINCRBY', dKey, 's' .. sub, 1)
  redis.call('HINCRBY', dKey, 'b' .. band, 1)
  redis.call('EXPIRE', dKey, cttl)
  redis.call('SADD', cKey, cell)
  redis.call('EXPIRE', cKey, cttl)
  wrote = 1
end
return {since, wrote}
`;

type PresenceCommand = (...args: (string | number)[]) => Promise<[number, number]>;

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly presenceCmd: PresenceCommand;

  constructor(@Inject(REDIS_CLIENT) public readonly client: Redis) {
    const c = client as Redis & { metchPresence?: PresenceCommand };
    if (typeof c.metchPresence !== 'function') c.defineCommand('metchPresence', { numberOfKeys: 2, lua: PRESENCE_LUA });
    this.presenceCmd = (...args) => (client as unknown as { metchPresence: PresenceCommand }).metchPresence(...args);
  }

  async onModuleDestroy() {
    await this.client.quit();
  }

  // Helpers específicos do Cruzei — geohash presence + cache de perfil

  /**
   * Grava a presença (e o sinal de multidão, quando vier) numa ida só. `cellNeighbors` = vizinhas da célula geohash-7
   * atual (pra estadia continuar ao cruzar a borda). Devolve desde quando a pessoa está nesta célula e se o sinal
   * de multidão foi gravado.
   */
  async setUserPresence(
    userId: string,
    geohash: string,
    lat: number,
    lng: number,
    ttlSeconds = 7_200, // 2h
    poi: { id: string; name: string } | null = null,
    hidden = false,
    cell = '',
    cellNeighbors: string[] = [],
    crowd: CrowdSignal | null = null,
  ): Promise<{ cellSince: number; crowdWritten: boolean }> {
    const now = Date.now();
    const [since, wrote] = await this.presenceCmd(
      `user:loc:${userId}`,
      `presence:${geohash}`,
      userId,
      geohash,
      String(lat),
      String(lng),
      now,
      ttlSeconds,
      poi?.id ?? '',
      poi?.name ?? '',
      hidden ? '1' : '0',
      cell,
      `,${cellNeighbors.join(',')},`,
      crowd ? '1' : '0',
      crowd?.dwellMs ?? 0,
      crowd?.member ?? '',
      crowd?.day ?? '',
      crowd?.sub ?? '',
      crowd?.band ?? 0,
      crowd?.ttlS ?? 0,
    );
    return { cellSince: Number(since), crowdWritten: Number(wrote) === 1 };
  }

  async getNearbyUserIds(geohashes: string[]): Promise<string[]> {
    const pipeline = this.client.pipeline();
    for (const h of geohashes) pipeline.zrange(`presence:${h}`, 0, -1);
    const results = await pipeline.exec();
    const set = new Set<string>();
    results?.forEach(([_, users]) => {
      (users as string[] | null)?.forEach((u) => set.add(u));
    });
    return Array.from(set);
  }

  /**
   * Quantas presenças vivas (atualizadas desde `sinceMs`) existem nas células, sem contar `excludeId` — só CONTA:
   * ZCOUNT/ZSCORE são O(log N), nada de trazer milhares de ids pra memória (antes: ZRANGE de 9 células a cada update).
   * Quem aparece em duas células ao mesmo tempo (troca de célula em andamento) conta duas vezes: é uma estimativa.
   */
  async countNearbyPresence(geohashes: string[], excludeId: string, sinceMs: number): Promise<number> {
    if (geohashes.length === 0) return 0;
    const pipeline = this.client.pipeline();
    for (const h of geohashes) {
      pipeline.zcount(`presence:${h}`, sinceMs, '+inf');
      pipeline.zscore(`presence:${h}`, excludeId);
    }
    const results = await pipeline.exec();
    let total = 0;
    for (let i = 0; i < geohashes.length; i++) {
      const [countErr, count] = results?.[i * 2] ?? [null, 0];
      if (countErr) continue; // estimativa: uma célula com erro só deixa de contar
      total += Number(count ?? 0);
      const [scoreErr, mine] = results?.[i * 2 + 1] ?? [null, null];
      if (!scoreErr && mine != null && Number(mine) >= sinceMs) total -= 1;
    }
    return Math.max(0, total);
  }

  async incrRate(userId: string, action: string, ttlSeconds = 86_400): Promise<number> {
    const key = `rate:${userId}:${action}`;
    const n = await this.client.incr(key);
    if (n === 1) await this.client.expire(key, ttlSeconds);
    return n;
  }

  async cacheProfile(userId: string, payload: unknown, ttl = 3600): Promise<void> {
    await this.client.set(
      `profile:${userId}`,
      JSON.stringify(payload),
      'EX',
      ttl,
    );
  }

  async getCachedProfile<T>(userId: string): Promise<T | null> {
    const raw = await this.client.get(`profile:${userId}`);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  /** perfil mudou: some o cache do /me e os caches de candidato da descoberta em todos os processos */
  async invalidateProfile(userId: string): Promise<void> {
    await this.client.del(`profile:${userId}`);
    await this.publishCandidateInvalidation(userId);
  }

  async publishCandidateInvalidation(userId: string | '*'): Promise<void> {
    try {
      await this.client.publish(CANDIDATE_INVALIDATION_CHANNEL, userId);
    } catch {
      /* o cache de candidato tem prazo curto de segurança: sem Redis, a mudança aparece quando ele vence */
    }
  }

  /** prova de que o número confirmou um código de SMS (login com isNew) — vale 10 min, consumida pelo /auth/register */
  async setSignupProof(phone: string): Promise<void> {
    await this.client.set(`sms:verified:${phone}`, '1', 'EX', 600);
  }

  async consumeSignupProof(phone: string): Promise<boolean> {
    const v = await this.client.getdel(`sms:verified:${phone}`);
    return v === '1';
  }
}
