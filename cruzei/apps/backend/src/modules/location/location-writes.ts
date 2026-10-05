// Escritas de localização em LOTE. Com dezenas de milhares de pessoas no app, uma UPDATE em users (last_active_at,
// indexada: nenhuma atualização "HOT", 7 índices reescritos) e um INSERT no histórico (gatilho + 8 índices, um GIST)
// por atualização de posição, cada um na própria transação com flush do WAL, deixavam o Postgres com 3,4 núcleos
// ocupados e seguravam todas as outras rotas. Agora a atualização só enfileira no Redis e um processo (o dos crons)
// grava tudo em poucos comandos a cada FLUSH_EVERY_MS.
import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';

/** "apagar histórico de localização": ms do corte (linha da fila com t <= isto é descartada); TTL curto */
export const locationForgetKey = (id: string) => `loc:forget:${id}`;

/** hash userId → ms da última atividade (a escrita mais nova sobrescreve) */
export const LAST_ACTIVE_PENDING = 'la:pending';
/** fila de linhas do histórico grosseiro (JSON) */
export const HISTORY_QUEUE = 'loc:hist:q';
/** teto da fila: se o gravador parar, a fila não cresce sem limite (fica com as mais novas) */
export const HISTORY_QUEUE_MAX = 200_000;
const FLUSH_EVERY_MS = 10_000;
const BATCH = 5_000;
/** por rodada: no máximo isto de lotes do histórico (o resto fica pra próxima) */
const MAX_HISTORY_BATCHES = 8;

/** linha do histórico na fila (nomes curtos: são dezenas de milhares por minuto) */
export interface QueuedHistory {
  u: string;
  la: number;
  lo: number;
  g: string;
  a: number | null;
  p: number | null;
  c: string | null;
  s: string | null;
  /** expira em (ms) */
  x: number;
  an: boolean;
  /** gravado em (ms) */
  t: number;
}

/** precisão do GPS cabe num SMALLINT inteiro (o app pode mandar fração ou lixo) */
export function accuracyForDb(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.min(32_767, Math.max(0, Math.round(v)));
}

// pega e apaga numa operação só (quem chegar no meio vai pra próxima rodada, nada se perde nem duplica)
const TAKE_HASH = "local v = redis.call('HGETALL', KEYS[1]); redis.call('DEL', KEYS[1]); return v";
const TAKE_LIST =
  "local v = redis.call('LRANGE', KEYS[1], 0, tonumber(ARGV[1]) - 1); redis.call('LTRIM', KEYS[1], tonumber(ARGV[1]), -1); return v";

@Injectable()
export class LocationWritesFlusher {
  private readonly log = new Logger(LocationWritesFlusher.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** só roda no processo dos crons (ScheduleModule): um gravador por cluster */
  @Interval(FLUSH_EVERY_MS)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.flushLastActive();
      await this.flushHistory();
    } catch (e) {
      this.log.warn(`gravação em lote falhou: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  async flushLastActive(): Promise<number> {
    const raw = (await this.redis.client.eval(TAKE_HASH, 1, LAST_ACTIVE_PENDING)) as string[];
    if (!raw?.length) return 0;
    const ids: string[] = [];
    const secs: number[] = [];
    for (let i = 0; i + 1 < raw.length; i += 2) {
      ids.push(raw[i]);
      secs.push(Number(raw[i + 1]) / 1000);
    }
    for (let i = 0; i < ids.length; i += BATCH) {
      await this.prisma.$executeRaw`
        UPDATE users u SET last_active_at = (to_timestamp(v.ts) AT TIME ZONE 'UTC')
          FROM unnest(${ids.slice(i, i + BATCH)}::uuid[], ${secs.slice(i, i + BATCH)}::float8[]) AS v(id, ts)
         WHERE u.id = v.id AND u.last_active_at < (to_timestamp(v.ts) AT TIME ZONE 'UTC')
           AND u.deleted_at IS NULL`;
    }
    return ids.length;
  }

  async flushHistory(): Promise<number> {
    let written = 0;
    for (let b = 0; b < MAX_HISTORY_BATCHES; b++) {
      const raw = (await this.redis.client.eval(TAKE_LIST, 1, HISTORY_QUEUE, BATCH)) as string[];
      if (!raw?.length) break;
      const rows: QueuedHistory[] = [];
      for (const r of raw) {
        try {
          rows.push(JSON.parse(r) as QueuedHistory);
        } catch {
          /* linha corrompida: descarta */
        }
      }
      // conta excluída / lugar retirado no meio do caminho: a linha sai (senão a chave estrangeira derruba o lote todo).
      // Exclusão pedida (deleted_at) também sai, e "apagar histórico" (loc:forget) descarta o que já estava na fila
      const userIds = [...new Set(rows.map((r) => r.u))];
      const [users, pois, forgets] = await Promise.all([
        this.prisma.$queryRaw<
          { id: string }[]
        >`SELECT id::text AS id FROM users WHERE id = ANY(${userIds}::uuid[]) AND deleted_at IS NULL`,
        this.prisma.$queryRaw<
          { id: bigint }[]
        >`SELECT id FROM pois WHERE id = ANY(${[...new Set(rows.filter((r) => r.p != null).map((r) => BigInt(r.p as number)))]}::bigint[])`,
        userIds.length
          ? this.redis.client.mget(userIds.map(locationForgetKey))
          : Promise.resolve([]),
      ]);
      const okUsers = new Set(users.map((u) => u.id));
      const okPois = new Set(pois.map((p) => Number(p.id)));
      const forgetAt = new Map<string, number>();
      userIds.forEach((id, i) => {
        const v = Number(forgets[i]);
        if (forgets[i] != null && Number.isFinite(v)) forgetAt.set(id, v);
      });
      const data: Prisma.LocationCreateManyInput[] = rows
        .filter((r) => okUsers.has(r.u) && !(r.t <= (forgetAt.get(r.u) ?? -Infinity)))
        .map((r) => ({
          userId: r.u,
          latitude: r.la,
          longitude: r.lo,
          geohash: r.g,
          accuracyMeters: accuracyForDb(r.a),
          poiId: r.p != null && okPois.has(r.p) ? BigInt(r.p) : null,
          city: r.c,
          state: r.s,
          expiresAt: new Date(r.x),
          isAnonymous: r.an,
          recordedAt: new Date(r.t),
        }));
      if (data.length > 0) await this.prisma.location.createMany({ data });
      written += data.length;
      if (raw.length < BATCH) break;
    }
    return written;
  }
}
