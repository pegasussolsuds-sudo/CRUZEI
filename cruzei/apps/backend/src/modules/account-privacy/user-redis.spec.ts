import type { Redis } from 'ioredis';

import { LAST_ACTIVE_PENDING } from '../location/location-writes';

import {
  forgetLearnedHome,
  forgetLocationKeys,
  learnedHomeCells,
  locationForgetKey,
  purgeUserKeys,
} from './user-redis';

// Redis em memória com o que as funções usam (strings, hashes, sets, zsets, SCAN por prefixo, o Lua do DECR com piso)
function memRedis() {
  const str = new Map<string, string>();
  const hash = new Map<string, Map<string, string>>();
  const sets = new Map<string, Set<string>>();
  const zsets = new Map<string, Set<string>>();
  const all = () => new Set([...str.keys(), ...hash.keys(), ...sets.keys(), ...zsets.keys()]);
  const delKey = (k: string) =>
    Number(str.delete(k) || hash.delete(k) || sets.delete(k) || zsets.delete(k));
  const client = {
    get: async (k: string) => str.get(k) ?? null,
    set: async (k: string, v: string) => {
      str.set(k, v);
      return 'OK';
    },
    del: async (...keys: string[]) => keys.reduce((n, k) => n + delKey(k), 0),
    unlink: async (...keys: string[]) => keys.reduce((n, k) => n + delKey(k), 0),
    exists: async (k: string) => Number(all().has(k)),
    hget: async (k: string, f: string) => hash.get(k)?.get(f) ?? null,
    hdel: async (k: string, f: string) => Number(hash.get(k)?.delete(f) ?? false),
    smembers: async (k: string) => [...(sets.get(k) ?? [])],
    scard: async (k: string) => sets.get(k)?.size ?? 0,
    scan: async (_cursor: string, _m: string, pattern: string) => {
      const prefix = pattern.replace(/\*$/, '');
      return ['0', [...all()].filter((k) => k.startsWith(prefix))];
    },
    eval: async (_lua: string, _n: number, key: string) => {
      const v = Number(str.get(key) ?? '0');
      if (v <= 1) {
        str.delete(key);
        return 0;
      }
      str.set(key, String(v - 1));
      return v - 1;
    },
    multi: () => {
      const ops: (() => void)[] = [];
      const m = {
        zrem: (k: string, member: string) => {
          ops.push(() => zsets.get(k)?.delete(member));
          return m;
        },
        del: (k: string) => {
          ops.push(() => delKey(k));
          return m;
        },
        exec: async () => ops.map((op) => [null, op()]),
      };
      return m;
    },
  };
  return { client: client as unknown as Redis, str, hash, sets, zsets, all };
}

const U = '0a000000-0000-4000-8000-00000000000a';
const OTHER = '0b000000-0000-4000-8000-00000000000b';

function seed(r: ReturnType<typeof memRedis>) {
  r.hash.set(
    `user:loc:${U}`,
    new Map([
      ['geohash', '6upq8c'],
      ['lat', '-18.9'],
    ]),
  );
  r.zsets.set('presence:6upq8c', new Set([U, OTHER]));
  r.str.set(`loc:hist:${U}`, 'sig');
  r.str.set(`loc:last:${U}`, '{}');
  r.hash.set(`loc:anchor:${U}`, new Map([['la', '-18.919']]));
  r.hash.set(`loc:pending:${U}`, new Map([['la', '-18.919']]));
  r.sets.set(`home:cells:${U}`, new Set(['6upq8c', '6upq8d']));
  r.sets.set(`home:nights:${U}:6upq8c`, new Set(['2026-10-01', '2026-10-02', '2026-10-03']));
  r.sets.set(`home:nights:${U}:6upq8d`, new Set(['2026-10-01']));
  r.sets.set(`home:nights:${OTHER}:6upq8c`, new Set(['2026-10-01']));
  r.str.set('home:cnt:6upq8c', '2');
  r.str.set('home:cnt:6upq8d', '1');
  r.str.set(`crowd:u:x`, 'hll');
}

describe('forgetLocationKeys', () => {
  it('tira histórico, resposta em cache, presença e âncoras; casa aprendida só com a opção', async () => {
    const r = memRedis();
    seed(r);
    const out = await forgetLocationKeys(r.client, U, { learnedHome: false });
    expect(out).toEqual({ anchors: true });
    for (const k of [
      `loc:hist:${U}`,
      `loc:last:${U}`,
      `user:loc:${U}`,
      `loc:anchor:${U}`,
      `loc:pending:${U}`,
    ])
      expect(r.all().has(k)).toBe(false);
    // a outra pessoa continua na célula
    expect([...r.zsets.get('presence:6upq8c')!]).toEqual([OTHER]);
    // sem learnedHome: casa fica
    expect(r.sets.has(`home:cells:${U}`)).toBe(true);
    expect(r.str.get('crowd:u:x')).toBe('hll');
  });

  it('com alerta de GPS falso ativo, as âncoras ficam (senão burlaria o anti-teleporte)', async () => {
    const r = memRedis();
    seed(r);
    r.str.set(`loc:flag:${U}`, 'teleport');
    const out = await forgetLocationKeys(r.client, U, { learnedHome: false });
    expect(out).toEqual({ anchors: false });
    expect(r.hash.has(`loc:anchor:${U}`)).toBe(true);
    expect(r.hash.has(`loc:pending:${U}`)).toBe(true);
    expect(r.str.get(`loc:flag:${U}`)).toBe('teleport');
    expect(r.hash.has(`user:loc:${U}`)).toBe(false);
  });

  it('learnedHome: células, noites e o contador agregado (com piso em zero)', async () => {
    const r = memRedis();
    seed(r);
    await forgetLocationKeys(r.client, U, { learnedHome: true });
    expect(r.sets.has(`home:cells:${U}`)).toBe(false);
    expect(r.sets.has(`home:nights:${U}:6upq8c`)).toBe(false);
    expect(r.sets.has(`home:nights:${U}:6upq8d`)).toBe(false);
    // noites de outra pessoa intactas
    expect(r.sets.has(`home:nights:${OTHER}:6upq8c`)).toBe(true);
    expect(r.str.get('home:cnt:6upq8c')).toBe('1');
    expect(r.str.has('home:cnt:6upq8d')).toBe(false);
  });
});

describe('learnedHomeCells', () => {
  it('células em ordem com as noites contadas (cópia dos dados)', async () => {
    const r = memRedis();
    seed(r);
    expect(await learnedHomeCells(r.client, U)).toEqual([
      { cell: '6upq8c', nights: 3 },
      { cell: '6upq8d', nights: 1 },
    ]);
    await forgetLearnedHome(r.client, U);
    expect(await learnedHomeCells(r.client, U)).toEqual([]);
  });
});

describe('purgeUserKeys', () => {
  it('limpa tudo da pessoa, inclusive o número, e marca o corte da fila', async () => {
    const r = memRedis();
    seed(r);
    const phone = '+5534999990000';
    r.str.set(`profile:${U}`, '{}');
    r.str.set(`gps:flagged:${U}`, '1');
    r.str.set(`loc:flag:${U}`, 'mock');
    r.str.set(`sms:verified:${phone}`, '1');
    r.hash.set(
      LAST_ACTIVE_PENDING,
      new Map([
        [U, '1'],
        [OTHER, '2'],
      ]),
    );
    await purgeUserKeys(r.client, U, phone);
    for (const k of [
      `profile:${U}`,
      `gps:flagged:${U}`,
      `loc:flag:${U}`,
      `loc:anchor:${U}`,
      `user:loc:${U}`,
      `home:cells:${U}`,
      `sms:verified:${phone}`,
    ])
      expect(r.all().has(k)).toBe(false);
    expect([...r.hash.get(LAST_ACTIVE_PENDING)!.keys()]).toEqual([OTHER]);
    expect(Number(r.str.get(locationForgetKey(U)))).toBeGreaterThan(0);
  });
});
