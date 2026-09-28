import { Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { Redis } from 'ioredis';

/** mesmo formato que o @nestjs/throttler 6.x espera do storage (tempos em SEGUNDOS, arredondados pra cima) */
export interface ThrottlerRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/**
 * Janela fixa + bloqueio numa ida só ao Redis (script Lua atômico):
 *   - bloqueado → devolve o bloqueio sem contar
 *   - senão INCR; primeiro hit da janela ganha PEXPIRE(ttl)
 *   - passou do limite → grava o bloqueio por blockDuration e zera a janela (depois do bloqueio começa do zero)
 */
const LUA = `
local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl > 0 then
  local hits = tonumber(redis.call('GET', KEYS[1]) or '0')
  local ttl = redis.call('PTTL', KEYS[1])
  return {hits, ttl, 1, blockTtl}
end
local hits = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
if hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  redis.call('DEL', KEYS[1])
  return {hits, ttl, 1, tonumber(ARGV[3])}
end
return {hits, ttl, 0, 0}
`;

type ThrottleCommand = (hitsKey: string, blockKey: string, ttlMs: number, limit: number, blockMs: number) => Promise<[number, number, number, number]>;

/**
 * Storage do rate limit no Redis. Substitui o storage em memória do @nestjs/throttler 6.2.1, que:
 *   - guardava UM array de timers por nome de throttler, compartilhado por todo mundo, filtrado a cada expiração
 *     (O(N) por requisição: ~1,2 núcleo inteiro só nisso a 1.200 req/s);
 *   - zerava os timers de TODOS ao liberar o bloqueio de UM (falsos 429 pra quem não fez nada);
 *   - nunca apagava chaves e não funcionava com mais de um processo.
 * Se o Redis falhar, deixa passar (fail-open): rate limit indisponível não pode derrubar o app.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly log = new Logger('Throttler');
  private readonly throttle: ThrottleCommand;
  private lastErrorLog = 0;

  constructor(
    redis: Redis,
    private readonly prefix = 'thr',
  ) {
    const client = redis as Redis & { metchThrottle?: ThrottleCommand };
    if (typeof client.metchThrottle !== 'function') client.defineCommand('metchThrottle', { numberOfKeys: 2, lua: LUA });
    this.throttle = (...args) => (client as unknown as { metchThrottle: ThrottleCommand }).metchThrottle(...args);
  }

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string): Promise<ThrottlerRecord> {
    const base = `${this.prefix}:${throttlerName}:${key}`;
    try {
      const [hits, ttlMs, blocked, blockMs] = await this.throttle(`${base}:h`, `${base}:b`, Math.max(1, ttl), limit, Math.max(1, blockDuration || ttl));
      return {
        totalHits: Number(hits),
        timeToExpire: Math.max(0, Math.ceil(Number(ttlMs) / 1000)),
        isBlocked: Number(blocked) === 1,
        timeToBlockExpire: Math.max(0, Math.ceil(Number(blockMs) / 1000)),
      };
    } catch (err) {
      const now = Date.now();
      if (now - this.lastErrorLog > 60_000) {
        this.lastErrorLog = now;
        this.log.warn(`Redis indisponível pro rate limit, liberando: ${(err as Error).message}`);
      }
      return { totalHits: 0, timeToExpire: Math.ceil(ttl / 1000), isBlocked: false, timeToBlockExpire: 0 };
    }
  }
}
