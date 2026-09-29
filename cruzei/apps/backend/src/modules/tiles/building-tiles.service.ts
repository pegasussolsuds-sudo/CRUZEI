import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { gzip as gzipCb } from 'node:zlib';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { boxesIntersect, mercatorUnit, tileBounds, type LngLatBox, type TileCoords } from './tile-coords';

const gzip = promisify(gzipCb);

/** faixa de zoom servida (acima de 16 o MapLibre faz overzoom do 16) */
export const BLD_MIN_Z = 13;
export const BLD_MAX_Z = 16;
export const BLD_LAYER = 'bld';
export const TILE_EXTENT = 4096;
export const TILE_BUFFER = 64;

/**
 * z13 é visão geral: 13,4 mil prédios e 550 KB no tile do centro com tudo. Lá só entra footprint ≥ 250 m²,
 * simplificado em 2 unidades do tile (~2,4 m) → ~120 KB gzip. Do z14 em diante vai tudo, sem simplificar.
 */
const Z13_MIN_AREA_M2 = 250;
const Z13_SIMPLIFY_UNITS = 2;

/** cache no Redis por tile: dura até a versão mudar (a chave leva a versão) */
const CACHE_TTL_S = 7 * 86_400;
const KEY_PREFIX = 'tiles:bld';
/** a impressão digital da tabela é refeita a cada 5 min (import novo → versão nova → tiles novos) */
const META_TTL_MS = 5 * 60_000;
const META_RETRY_MS = 30_000;
/** tiles montados ao mesmo tempo por processo: rajada de tiles frios não toma o pool do Prisma */
const BUILD_CONCURRENCY = 4;

export type TileCacheStatus = 'hit' | 'miss' | 'skip';
type BuiltTile = { kind: 'empty' } | { kind: 'mvt'; gz: Buffer; etag: string };
export type BuildingTile = BuiltTile & { cache: TileCacheStatus };

interface TilesMeta {
  version: string;
  /** caixa dos dados; null = tabela vazia */
  extent: LngLatBox | null;
}

interface MetaRow {
  n: number;
  d: string;
  s: string;
  h: string;
  mh: string;
  minx: number | null;
  miny: number | null;
  maxx: number | null;
  maxy: number | null;
}

/** fila simples: no máximo `limit` tarefas ao mesmo tempo */
class Gate {
  private active = 0;
  private readonly queue: (() => void)[] = [];
  constructor(private readonly limit: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.queue.push(resolve));
    else this.active++;
    try {
      return await task();
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.active--;
    }
  }
}

/** ETag fraca: o mesmo MVT sai com ou sem gzip */
function etagOf(digest: Buffer): string {
  return `W/"${digest.toString('hex')}"`;
}

/** erro do Postgres "relation does not exist" (42P01), que o Prisma embrulha no P2010 do $queryRaw */
function isMissingTable(err: unknown): boolean {
  const e = err as { code?: string; meta?: { code?: string }; message?: string };
  return e?.meta?.code === '42P01' || e?.code === '42P01' || /relation "extra_buildings" does not exist/.test(e?.message ?? '');
}

/** versão manual (BLD_TILES_VERSION) pra forçar tiles novos sem mudar dado; só [A-Za-z0-9_-] */
function manualVersion(): string {
  const v = (process.env.BLD_TILES_VERSION ?? '').trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
  return v || '1';
}

/**
 * Tiles vetoriais (MVT) dos prédios extras (`extra_buildings`: footprints da Microsoft onde o OSM não tem prédio).
 * Camada 'bld' com `height` e `min_height` (m), extent 4096, buffer 64, sem id de feição (o id custava ~37% do tile
 * gzipado e o mapa não usa). Cache no Redis por tile, na chave da versão (manual + impressão digital da tabela).
 */
@Injectable()
export class BuildingTilesService {
  private readonly log = new Logger(BuildingTilesService.name);
  private meta: TilesMeta | null = null;
  private metaExpires = 0;
  private metaLoading: Promise<TilesMeta> | null = null;
  private readonly inflight = new Map<string, Promise<BuiltTile>>();
  private readonly gate = new Gate(BUILD_CONCURRENCY);
  private lastRedisWarn = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async tile(t: TileCoords): Promise<BuildingTile> {
    if (t.z < BLD_MIN_Z || t.z > BLD_MAX_Z) return { kind: 'empty', cache: 'skip' };
    const meta = await this.getMeta();
    // fora da caixa dos dados: vazio sem ir ao Redis nem ao banco (e sem encher o Redis de tiles vazios do mundo)
    if (!meta.extent || !boxesIntersect(tileBounds(t, TILE_BUFFER / TILE_EXTENT), meta.extent)) return { kind: 'empty', cache: 'skip' };

    const key = `${KEY_PREFIX}:${meta.version}:${t.z}/${t.x}/${t.y}`;
    const cached = await this.readCache(key);
    if (cached) return { ...cached, cache: 'hit' };

    let pending = this.inflight.get(key);
    if (!pending) {
      pending = this.build(t, key).finally(() => this.inflight.delete(key));
      this.inflight.set(key, pending);
    }
    return { ...(await pending), cache: 'miss' };
  }

  /** versão atual (pra diagnóstico e testes) */
  async version(): Promise<string> {
    return (await this.getMeta()).version;
  }

  private async getMeta(): Promise<TilesMeta> {
    if (this.meta && Date.now() < this.metaExpires) return this.meta;
    if (!this.metaLoading) {
      this.metaLoading = this.loadMeta()
        .then((m) => {
          this.meta = m;
          this.metaExpires = Date.now() + META_TTL_MS;
          return m;
        })
        .catch((err: Error) => {
          if (!this.meta) throw err;
          // banco fora: segue com a versão antiga e tenta de novo daqui a pouco
          this.log.warn(`impressão digital dos prédios falhou, mantendo a versão ${this.meta.version}: ${err.message}`);
          this.metaExpires = Date.now() + META_RETRY_MS;
          return this.meta;
        })
        .finally(() => {
          this.metaLoading = null;
        });
    }
    // enquanto recalcula, quem já tem versão não espera
    return this.meta ?? this.metaLoading;
  }

  /** impressão digital barata (~30 ms em 167 mil linhas): muda com linha nova/removida/geometria/altura */
  private async loadMeta(): Promise<TilesMeta> {
    let rows: MetaRow[];
    try {
      rows = await this.fingerprint();
    } catch (err) {
      if (!isMissingTable(err)) throw err;
      // ambiente sem a migration dos prédios: tudo vazio (204), sem erro por tile
      this.log.warn('tabela extra_buildings não existe: tiles de prédios vazios até aplicar a migration');
      return { version: `${manualVersion()}.none`, extent: null };
    }
    const r = rows[0];
    const fingerprint = r ? [r.n, r.d, r.s, r.h, r.mh].join('|') : '0';
    const digest = createHash('md5').update(fingerprint).digest('hex').slice(0, 12);
    const extent: LngLatBox | null =
      r && r.n > 0 && r.minx != null && r.miny != null && r.maxx != null && r.maxy != null ? [r.minx, r.miny, r.maxx, r.maxy] : null;
    return { version: `${manualVersion()}.${digest}`, extent };
  }

  private fingerprint(): Promise<MetaRow[]> {
    return this.prisma.$queryRaw<MetaRow[]>`
      SELECT count(*)::int AS n,
             coalesce(max(refreshed_on)::text, '') AS d,
             coalesce(sum(id % 1000003), 0)::text AS s,
             coalesce(sum((height * 2)::int), 0)::text AS h,
             coalesce(sum((min_height * 2)::int), 0)::text AS mh,
             ST_XMin(ST_Extent(geom)) AS minx, ST_YMin(ST_Extent(geom)) AS miny,
             ST_XMax(ST_Extent(geom)) AS maxx, ST_YMax(ST_Extent(geom)) AS maxy
        FROM extra_buildings`;
  }

  private async build(t: TileCoords, key: string): Promise<BuiltTile> {
    const raw = await this.gate.run(() => this.query(t));
    if (!raw) {
      this.writeCache(key, Buffer.alloc(0));
      return { kind: 'empty' };
    }
    const digest = createHash('md5').update(raw).digest();
    const gz = await gzip(raw, { level: 6 });
    // no Redis: 16 bytes do md5 do MVT cru + MVT gzipado (vazio = valor vazio)
    this.writeCache(key, Buffer.concat([digest, gz]));
    return { kind: 'mvt', gz, etag: etagOf(digest) };
  }

  /** MVT cru do tile, ou null se não tem prédio nele */
  private async query({ z, x, y }: TileCoords): Promise<Buffer | null> {
    const low = z <= BLD_MIN_Z;
    const minArea = low ? Z13_MIN_AREA_M2 : 0;
    const merc = Prisma.sql`ST_Transform(b.geom, 3857)`;
    const geom = low ? Prisma.sql`ST_Simplify(${merc}, ${Z13_SIMPLIFY_UNITS * mercatorUnit(z, TILE_EXTENT)}::float8, true)` : merc;
    const rows = await this.prisma.$queryRaw<{ mvt: Buffer | Uint8Array | null; n: number }[]>`
      SELECT ST_AsMVT(q, ${BLD_LAYER}::text, ${TILE_EXTENT}::int, 'geom') AS mvt, count(q.geom)::int AS n
        FROM (
          SELECT b.height, b.min_height,
                 ST_AsMVTGeom(${geom}, ST_TileEnvelope(${z}::int, ${x}::int, ${y}::int), ${TILE_EXTENT}::int, ${TILE_BUFFER}::int, true) AS geom
            FROM extra_buildings b
           WHERE b.geom && ST_Transform(ST_TileEnvelope(${z}::int, ${x}::int, ${y}::int, margin => ${TILE_BUFFER / TILE_EXTENT}::float8), 4326)
             AND b.area_m2 >= ${minArea}::real
        ) q`;
    const row = rows[0];
    if (!row || !row.mvt || row.n === 0 || row.mvt.length === 0) return null;
    return Buffer.isBuffer(row.mvt) ? row.mvt : Buffer.from(row.mvt);
  }

  private async readCache(key: string): Promise<BuiltTile | null> {
    let v: Buffer | null;
    try {
      v = await this.redis.client.getBuffer(key);
    } catch (err) {
      this.redisWarn(err);
      return null;
    }
    if (!v) return null;
    if (v.length === 0) return { kind: 'empty' };
    if (v.length <= 16) return null; // valor estranho: monta de novo
    return { kind: 'mvt', gz: v.subarray(16), etag: etagOf(v.subarray(0, 16)) };
  }

  /** grava sem segurar a resposta; Redis fora só perde o cache */
  private writeCache(key: string, value: Buffer): void {
    this.redis.client.set(key, value, 'EX', CACHE_TTL_S).catch((err: unknown) => this.redisWarn(err));
  }

  private redisWarn(err: unknown): void {
    const now = Date.now();
    if (now - this.lastRedisWarn < 60_000) return;
    this.lastRedisWarn = now;
    this.log.warn(`Redis indisponível pro cache de tiles: ${(err as Error)?.message ?? err}`);
  }
}
