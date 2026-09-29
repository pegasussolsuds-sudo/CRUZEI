import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import type { PrismaService } from '../../database/prisma.service';
import type { RedisService } from '../../redis/redis.service';
import { BuildingTilesService } from './building-tiles.service';

// caixa dos dados = Uberlândia (bbox padrão do import)
const UDI = { minx: -48.4, miny: -19.02, maxx: -48.15, maxy: -18.82 };
const META = { n: 166755, d: '2026-09-29', s: '83372505872', h: '1544993', mh: '0', ...UDI };
const CENTER14 = { z: 14, x: 5994, y: 9069 };
const MVT = Buffer.from('1a0b0a03626c6478021a0120', 'hex'); // conteúdo qualquer: o serviço não decodifica

interface Query {
  sql: string;
  values: unknown[];
}

function setup(opts: { meta?: unknown[]; tile?: () => unknown[]; redisGet?: jest.Mock; redisSet?: jest.Mock } = {}) {
  const queries: Query[] = [];
  let metaAnswer: unknown[] = opts.meta ?? [META];
  const prisma = {
    $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const q = Prisma.sql(strings, ...values);
      queries.push({ sql: q.sql.replace(/\s+/g, ' '), values: q.values });
      if (q.sql.includes('ST_AsMVT(')) return (opts.tile ?? (() => [{ mvt: MVT, n: 3 }]))();
      return metaAnswer;
    }),
  };
  const store = new Map<string, Buffer>();
  const redis = {
    client: {
      getBuffer: opts.redisGet ?? jest.fn(async (k: string) => store.get(k) ?? null),
      set: opts.redisSet ?? jest.fn(async (k: string, v: Buffer) => (store.set(k, v), 'OK')),
    },
  };
  const svc = new BuildingTilesService(prisma as unknown as PrismaService, redis as unknown as RedisService);
  const tileQueries = () => queries.filter((q) => q.sql.includes('ST_AsMVT('));
  const metaQueries = () => queries.filter((q) => !q.sql.includes('ST_AsMVT('));
  return { svc, prisma, redis, store, queries, tileQueries, metaQueries, setMeta: (m: unknown[]) => (metaAnswer = m) };
}

/** o setImmediate deixa o set() do Redis (disparado sem await) terminar */
const flush = () => new Promise((r) => setImmediate(r));

describe('BuildingTilesService', () => {
  let warn: jest.SpyInstance;
  const savedVersion = process.env.BLD_TILES_VERSION;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    delete process.env.BLD_TILES_VERSION;
  });
  afterEach(() => {
    warn.mockRestore();
    jest.restoreAllMocks();
    if (savedVersion === undefined) delete process.env.BLD_TILES_VERSION;
    else process.env.BLD_TILES_VERSION = savedVersion;
  });

  it('zoom fora de 13..16: vazio sem banco nem Redis', async () => {
    const { svc, prisma, redis } = setup();
    for (const t of [{ z: 12, x: 1498, y: 2267 }, { z: 17, x: 47958, y: 72552 }, { z: 0, x: 0, y: 0 }]) {
      expect(await svc.tile(t)).toEqual({ kind: 'empty', cache: 'skip' });
    }
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(redis.client.getBuffer).not.toHaveBeenCalled();
  });

  it('tile fora da caixa dos dados: vazio sem Redis e sem montar tile', async () => {
    const { svc, redis, tileQueries, metaQueries } = setup();
    expect(await svc.tile({ z: 14, x: 0, y: 0 })).toEqual({ kind: 'empty', cache: 'skip' });
    expect(metaQueries()).toHaveLength(1);
    expect(tileQueries()).toHaveLength(0);
    expect(redis.client.getBuffer).not.toHaveBeenCalled();
  });

  it('tabela vazia: tudo vazio', async () => {
    const { svc, tileQueries } = setup({ meta: [{ n: 0, d: '', s: '0', h: '0', mh: '0', minx: null, miny: null, maxx: null, maxy: null }] });
    expect(await svc.tile(CENTER14)).toEqual({ kind: 'empty', cache: 'skip' });
    expect(tileQueries()).toHaveLength(0);
  });

  it('frio: monta no banco (parametrizado), grava no Redis com TTL e devolve gzip + ETag fraca', async () => {
    const { svc, redis, store, tileQueries } = setup();
    const t = await svc.tile(CENTER14);
    await flush();
    expect(t.kind).toBe('mvt');
    if (t.kind !== 'mvt') return;
    expect(t.cache).toBe('miss');
    expect(gunzipSync(t.gz).equals(MVT)).toBe(true);
    expect(t.etag).toBe(`W/"${createHash('md5').update(MVT).digest('hex')}"`);

    const [q] = tileQueries();
    // z/x/y só como parâmetro, nunca no texto do SQL
    expect(q.sql).not.toMatch(/5994|9069/);
    expect(q.values).toEqual(expect.arrayContaining([14, 5994, 9069, 'bld', 4096, 64]));
    expect(q.sql).toContain('ST_AsMVTGeom(');
    expect(q.sql).not.toContain('ST_Simplify');

    const version = await svc.version();
    expect(version).toMatch(/^1\.[0-9a-f]{12}$/);
    const key = `tiles:bld:${version}:14/5994/9069`;
    expect(redis.client.set).toHaveBeenCalledWith(key, expect.any(Buffer), 'EX', 7 * 86_400);
    const stored = store.get(key)!;
    expect(stored.subarray(0, 16).equals(createHash('md5').update(MVT).digest())).toBe(true);
    expect(gunzipSync(stored.subarray(16)).equals(MVT)).toBe(true);
  });

  it('quente: vem do Redis sem ir ao banco, com a mesma ETag', async () => {
    const { svc, tileQueries } = setup();
    const cold = await svc.tile(CENTER14);
    await flush();
    const warm = await svc.tile(CENTER14);
    expect(warm.cache).toBe('hit');
    expect(tileQueries()).toHaveLength(1);
    if (cold.kind !== 'mvt' || warm.kind !== 'mvt') throw new Error('esperava mvt');
    expect(warm.etag).toBe(cold.etag);
    expect(gunzipSync(warm.gz).equals(MVT)).toBe(true);
  });

  it('tile sem prédio: vazio, e o vazio também fica no cache', async () => {
    const { svc, store, tileQueries } = setup({ tile: () => [{ mvt: Buffer.alloc(0), n: 0 }] });
    expect(await svc.tile(CENTER14)).toEqual({ kind: 'empty', cache: 'miss' });
    await flush();
    expect([...store.values()][0]).toHaveLength(0);
    expect(await svc.tile(CENTER14)).toEqual({ kind: 'empty', cache: 'hit' });
    expect(tileQueries()).toHaveLength(1);
  });

  it('ST_AsMVT nulo ou sem feição também é vazio', async () => {
    for (const row of [{ mvt: null, n: 0 }, { mvt: Buffer.from([0x1a, 0x00]), n: 0 }]) {
      const { svc } = setup({ tile: () => [row] });
      expect((await svc.tile(CENTER14)).kind).toBe('empty');
    }
  });

  it('pedidos simultâneos do mesmo tile frio: uma consulta só', async () => {
    const { svc, tileQueries } = setup();
    const all = await Promise.all(Array.from({ length: 10 }, () => svc.tile(CENTER14)));
    expect(all.every((t) => t.kind === 'mvt')).toBe(true);
    expect(tileQueries()).toHaveLength(1);
  });

  it('no máximo 4 tiles montados ao mesmo tempo', async () => {
    let active = 0;
    let peak = 0;
    const { svc, tileQueries } = setup({
      tile: () => {
        throw new Error('não usado');
      },
    });
    // troca a resposta do tile por uma lenta que mede a concorrência
    (svc as unknown as { query: () => Promise<Buffer> }).query = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return MVT;
    };
    const tiles = Array.from({ length: 12 }, (_, i) => svc.tile({ z: 16, x: 23970 + i, y: 36276 }));
    const out = await Promise.all(tiles);
    expect(out.every((t) => t.kind === 'mvt')).toBe(true);
    expect(peak).toBe(4);
    expect(tileQueries()).toHaveLength(0);
  });

  it('z13 só leva footprint ≥ 250 m² e simplifica; z14+ leva tudo', async () => {
    const { svc, tileQueries } = setup();
    await svc.tile({ z: 13, x: 2997, y: 4534 });
    await svc.tile(CENTER14);
    const [z13, z14] = tileQueries();
    expect(z13.sql).toContain('ST_Simplify(');
    expect(z13.values).toEqual(expect.arrayContaining([250]));
    const tol = z13.values.find((v) => typeof v === 'number' && v > 2 && v < 3) as number;
    expect(tol).toBeCloseTo(2 * 1.1943, 3);
    expect(z14.sql).not.toContain('ST_Simplify(');
    expect(z14.values).toEqual(expect.arrayContaining([0]));
  });

  it('Redis fora: serve do banco mesmo assim', async () => {
    const { svc, tileQueries } = setup({
      redisGet: jest.fn(async () => {
        throw new Error('Connection is closed.');
      }),
      redisSet: jest.fn(async () => {
        throw new Error('Connection is closed.');
      }),
    });
    const a = await svc.tile(CENTER14);
    await flush();
    const b = await svc.tile(CENTER14);
    expect(a.kind).toBe('mvt');
    expect(b.kind).toBe('mvt');
    expect(tileQueries()).toHaveLength(2);
    expect(warn).toHaveBeenCalledTimes(1); // aviso limitado a 1 por minuto
  });

  it('import novo muda a versão (e a chave) depois de 5 min; banco fora mantém a versão antiga', async () => {
    let now = 1_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const { svc, setMeta, metaQueries, prisma } = setup();
    const v1 = await svc.version();

    // dentro dos 5 min não consulta de novo
    now += 60_000;
    expect(await svc.version()).toBe(v1);
    expect(metaQueries()).toHaveLength(1);

    // altura mudou (ex.: --height 3dglobfp): versão nova
    setMeta([{ ...META, h: '2000000' }]);
    now += 5 * 60_000;
    await svc.version(); // devolve a antiga enquanto recalcula
    await flush();
    const v2 = await svc.version();
    expect(v2).not.toBe(v1);

    // banco caiu na hora de recalcular: fica com a v2
    prisma.$queryRaw.mockImplementationOnce(async () => {
      throw new Error('db down');
    });
    now += 5 * 60_000;
    await svc.version();
    await flush();
    expect(await svc.version()).toBe(v2);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('mantendo a versão'));
  });

  it('primeira impressão digital falhando: erro pro chamador (500), sem travar as próximas', async () => {
    const { svc, prisma } = setup();
    prisma.$queryRaw.mockImplementationOnce(async () => {
      throw new Error('db down');
    });
    await expect(svc.tile(CENTER14)).rejects.toThrow('db down');
    expect((await svc.tile(CENTER14)).kind).toBe('mvt');
  });

  it('sem a tabela (migration não aplicada): 204 em tudo, sem erro por tile', async () => {
    const { svc, prisma, tileQueries } = setup();
    prisma.$queryRaw.mockImplementationOnce(async () => {
      throw Object.assign(new Error('Raw query failed. Code: `42P01`.'), { code: 'P2010', meta: { code: '42P01' } });
    });
    expect(await svc.tile(CENTER14)).toEqual({ kind: 'empty', cache: 'skip' });
    expect(await svc.version()).toBe('1.none');
    expect(tileQueries()).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('extra_buildings não existe'));
  });

  it('BLD_TILES_VERSION força versão nova com o mesmo dado', async () => {
    const a = await setup().svc.version();
    process.env.BLD_TILES_VERSION = '2 x!';
    const b = await setup().svc.version();
    expect(a.split('.')[1]).toBe(b.split('.')[1]);
    expect(b.startsWith('2x.')).toBe(true);
  });
});
