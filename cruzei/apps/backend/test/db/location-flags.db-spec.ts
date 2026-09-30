import type { Orientation } from '@cruzei/shared-types';
import { encodeGeohash, offsetLatLng } from '@cruzei/shared-utils';
import type { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

import type { PrismaService } from '../../src/database/prisma.service';
import type { AccountStateService } from '../../src/modules/account/account-state.service';
import { GPS_GUARD, type GuardMode } from '../../src/modules/location/anti-spoof';
import { PRIVACY, findForbiddenKeys } from '../../src/modules/location/discovery-privacy';
import { GpsGuard } from '../../src/modules/location/gps-guard';
import { LocationService, type DiscoveryResult } from '../../src/modules/location/location.service';
import { ModerationService } from '../../src/modules/moderation/moderation.service';
import type { PhotoModerationService } from '../../src/modules/moderation/photo-moderation.service';
import type { NotifyService } from '../../src/modules/notifications/notify.service';
import type { ChatGateway } from '../../src/realtime/chat.gateway';
import type { RedisService } from '../../src/redis/redis.service';

import { assertTestDatabase } from './env';

// Descoberta contra o banco de TESTE (cruzei_test) com o LocationService DE VERDADE (SQL das flags, regras, ordem) e
// um Redis em memória: "Mostrar" recíproco, "mesma orientação primeiro" (só de quem exibe), Boost 5 km (faixa
// 'boost', posição visual, piso de anonimato), GPS falso (salto / posição simulada) e a denúncia automática na fila
// da moderação (sem denunciante, sem coordenada). Banco fora do ar = FALHA. Recriar: pnpm test:db:setup

const prisma = new PrismaClient();
const db = prisma as unknown as PrismaService;

// ------------------------------------------------------------------------------------------------
// Redis em memória: só o que o LocationService / GpsGuard usam (string, hash, zset, set, lista, pipeline/multi)
// ------------------------------------------------------------------------------------------------
type Cmd = (...args: unknown[]) => Promise<unknown>;

function memRedis() {
  const str = new Map<string, string>();
  const hash = new Map<string, Map<string, string>>();
  const zset = new Map<string, Map<string, number>>();
  const sets = new Map<string, Set<string>>();
  const lists = new Map<string, string[]>();
  const get = <T>(m: Map<string, T>, k: string, make: () => T): T => {
    let v = m.get(k);
    if (v === undefined) m.set(k, (v = make()));
    return v;
  };
  const ops: Record<string, Cmd> = {
    get: async (k) => str.get(k as string) ?? null,
    set: async (k, v, ...opts) => {
      if (opts.includes('NX') && str.has(k as string)) return null;
      str.set(k as string, String(v));
      return 'OK';
    },
    del: async (...keys) => {
      let n = 0;
      for (const k of keys.flat() as string[]) {
        const hit =
          str.delete(k) || hash.delete(k) || zset.delete(k) || sets.delete(k) || lists.delete(k);
        n += hit ? 1 : 0;
      }
      return n;
    },
    incr: async (k) => {
      const n = Number(str.get(k as string) ?? 0) + 1;
      str.set(k as string, String(n));
      return n;
    },
    expire: async () => 1,
    hgetall: async (k) => Object.fromEntries(hash.get(k as string) ?? []),
    hget: async (k, f) => hash.get(k as string)?.get(f as string) ?? null,
    hset: async (k, ...args) => {
      const m = get(hash, k as string, () => new Map<string, string>());
      if (args.length === 1 && typeof args[0] === 'object')
        for (const [f, v] of Object.entries(args[0] as object)) m.set(f, String(v));
      else for (let i = 0; i + 1 < args.length; i += 2) m.set(String(args[i]), String(args[i + 1]));
      return 1;
    },
    hincrby: async (k, f, by) => {
      const m = get(hash, k as string, () => new Map<string, string>());
      const n = Number(m.get(f as string) ?? 0) + Number(by);
      m.set(f as string, String(n));
      return n;
    },
    zadd: async (k, score, member) => {
      get(zset, k as string, () => new Map<string, number>()).set(String(member), Number(score));
      return 1;
    },
    zrem: async (k, member) => (zset.get(k as string)?.delete(String(member)) ? 1 : 0),
    zrange: async (k, _from, _to, withScores) => {
      const e = [...(zset.get(k as string) ?? new Map<string, number>())].sort(
        (a, b) => a[1] - b[1],
      );
      return withScores ? e.flatMap(([m, s]) => [m, String(s)]) : e.map(([m]) => m);
    },
    sadd: async (k, ...members) => {
      const s = get(sets, k as string, () => new Set<string>());
      let n = 0;
      for (const m of members as string[]) if (!s.has(m)) s.add(m), n++;
      return n;
    },
    scard: async (k) => sets.get(k as string)?.size ?? 0,
    smembers: async (k) => [...(sets.get(k as string) ?? [])],
    rpush: async (k, ...v) => {
      const l = get(lists, k as string, () => [] as string[]);
      l.push(...(v as string[]));
      return l.length;
    },
    ltrim: async () => 'OK',
    publish: async () => 0,
  };
  // pipeline/multi: grava os comandos (encadeados ou não) e executa em ordem no exec → [[null, resultado], ...]
  const batch = () => {
    const queue: (() => Promise<unknown>)[] = [];
    const b: Record<string, unknown> = {};
    for (const [name, fn] of Object.entries(ops)) {
      b[name] = (...args: unknown[]) => {
        queue.push(() => fn(...args));
        return b;
      };
    }
    b.exec = async () => {
      const out: [null, unknown][] = [];
      for (const q of queue) out.push([null, await q()]);
      return out;
    };
    return b;
  };
  const client = { ...ops, pipeline: batch, multi: batch };

  // o que o RedisService faz em Lua, em memória: presença (hash + célula) e "esconder agora"
  const service = {
    client,
    async setUserPresence(
      userId: string,
      geohash: string,
      lat: number,
      lng: number,
      _ttl?: number,
      poi?: { id: string; name: string } | null,
      hidden = false,
    ) {
      const key = `user:loc:${userId}`;
      const prev = hash.get(key);
      const prevGh = prev?.get('geohash');
      const wasHidden = prev?.get('hidden') === '1';
      const now = Date.now();
      await ops.hset(key, {
        lat: String(lat),
        lng: String(lng),
        geohash,
        updated_at: String(now),
        poi_id: poi?.id ?? '',
        poi_name: poi?.name ?? '',
        hidden: hidden ? '1' : '0',
      });
      if (prevGh && prevGh !== geohash) zset.get(`presence:${prevGh}`)?.delete(userId);
      await ops.zadd(`presence:${geohash}`, now, userId);
      return { cellSince: now, crowdWritten: false, wasHidden };
    },
    async countNearbyPresence() {
      return 0;
    },
    markPresenceHidden: jest.fn(async (userId: string) => {
      const m = hash.get(`user:loc:${userId}`);
      if (!m) return;
      m.set('hidden', '1');
      const gh = m.get('geohash');
      // mexe no score (a descoberta recarrega a célula pelo score), como o HIDE_LUA
      if (gh && zset.get(`presence:${gh}`)?.has(userId))
        zset.get(`presence:${gh}`)!.set(userId, Date.now() + 1);
    }),
    publishCandidateInvalidation: async () => undefined,
    invalidateProfile: async () => undefined,
  };
  const reset = () => [str, hash, zset, sets, lists].forEach((m) => m.clear());
  return { service, str, hash, reset };
}

const mem = memRedis();
const redis = mem.service as unknown as RedisService;
const config = { get: () => 'salt-de-teste' } as unknown as ConfigService;
// instância nova por teste: os caches de candidato (60 s) e de boost (10 s) não vazam de um caso pro outro
const location = () => new LocationService(db, redis, config);

// região isolada (sem lugares de outros specs por perto)
const CENTER = { lat: -10.5, lng: -55.5 };
const at = (north: number, east = 0) => offsetLatLng(CENTER.lat, CENTER.lng, north, east);
async function place(id: string, p: { lat: number; lng: number }) {
  await mem.service.setUserPresence(
    id,
    encodeGeohash(p.lat, p.lng, 6),
    p.lat,
    p.lng,
    7_200,
    null,
    false,
  );
}

let seq = 0;
type PersonOpts = {
  gender?: 'female' | 'male' | 'non_binary' | 'other';
  showMe?: 'women' | 'men' | 'everyone';
  orientation?: Orientation | null;
  showOrientation?: boolean;
  sameOrientationFirst?: boolean;
};
async function person(name: string, o: PersonOpts = {}): Promise<string> {
  seq++;
  const u = await prisma.user.create({
    data: {
      name,
      phone: `+5534966${String(seq).padStart(6, '0')}`,
      birthDate: new Date('1995-01-01'),
      gender: o.gender ?? 'female',
      visibilityMode: 'visible',
      showMe: o.showMe ?? 'everyone',
      orientation: o.orientation ?? null,
      showOrientation: o.showOrientation ?? false,
      sameOrientationFirst: o.sameOrientationFirst ?? false,
    },
    select: { id: true },
  });
  return u.id;
}

const idsOf = (r: DiscoveryResult) => r.users.map((u) => u.id);
const originalMode: GuardMode = GPS_GUARD.MODE;

beforeAll(async () => {
  await assertTestDatabase(prisma);
  GPS_GUARD.MODE = 'on';
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE users, boosts, reports, moderation_actions RESTART IDENTITY CASCADE',
  );
  mem.reset();
});

afterAll(async () => {
  GPS_GUARD.MODE = originalMode;
  await prisma.$disconnect();
});

describe('flags de candidato (SQL leve, com invalidação imediata)', () => {
  it('traz gênero, "Mostrar", orientação e se a pessoa exibe a orientação', async () => {
    const id = await person('Flags', {
      gender: 'non_binary',
      showMe: 'women',
      orientation: 'queer',
      showOrientation: true,
    });
    const svc = location() as unknown as {
      loadFlagsFromDb(ids: string[]): Promise<Record<string, unknown>[]>;
    };
    const [row] = await svc.loadFlagsFromDb([id]);
    expect(row).toMatchObject({
      id,
      gender: 'non_binary',
      showMe: 'women',
      orientation: 'queer',
      showOrientation: true,
    });
  });
});

describe('"Mostrar: Mulheres / Homens / Todos" é recíproco (mapa, lista e deck)', () => {
  it('só aparece quem também quer me ver; não binário só pra quem escolheu Todos', async () => {
    const m = await person('Marcos', { gender: 'male', showMe: 'women' });
    const w1 = await person('Wanda', { gender: 'female', showMe: 'everyone' });
    const w2 = await person('Wilma', { gender: 'female', showMe: 'women' });
    const nb = await person('Nic', { gender: 'non_binary', showMe: 'everyone' });
    const m2 = await person('Mauro', { gender: 'male', showMe: 'everyone' });
    await place(m, at(0));
    await place(w1, at(40));
    await place(w2, at(60, 20));
    await place(nb, at(20, 50));
    await place(m2, at(-40, 10));

    expect(new Set(idsOf(await location().discover(m)))).toEqual(new Set([w1]));
    expect(new Set(idsOf(await location().discover(w2)))).toEqual(new Set([w1]));
    expect(new Set(idsOf(await location().discover(nb)))).toEqual(new Set([w1, m2]));
    // o cartão/acenos seguem a mesma regra
    expect((await location().discoverability(m, w2)).ok).toBe(false);
    expect((await location().discoverability(w2, m)).ok).toBe(false);
    expect((await location().discoverability(m, w1)).ok).toBe(true);
  });
});

describe('"Mesma orientação primeiro" só ordena, e só por quem EXIBE', () => {
  it('quem exibe a mesma orientação sobe; quem esconde fica exatamente onde estava', async () => {
    const v = await person('Vera', { gender: 'female', orientation: 'lesbian' });
    const shown = await person('Lia', {
      gender: 'female',
      orientation: 'lesbian',
      showOrientation: true,
    });
    const hidden = await person('Lu', {
      gender: 'female',
      orientation: 'lesbian',
      showOrientation: false,
    });
    const others: string[] = [];
    for (let i = 0; i < 8; i++)
      others.push(
        await person(`Outra${i}`, {
          gender: 'female',
          orientation: 'straight',
          showOrientation: true,
        }),
      );
    await place(v, at(0));
    await place(shown, at(30, 30));
    await place(hidden, at(-20, 40));
    for (const [i, id] of others.entries()) await place(id, at(10 * i - 40, -30));

    const svc = location();
    const before = idsOf(await svc.discover(v));
    await prisma.user.update({ where: { id: v }, data: { sameOrientationFirst: true } });
    const res = await svc.discover(v);
    const after = idsOf(res);
    expect(after[0]).toBe(shown);
    // o resto (inclusive quem esconde a orientação) na MESMA ordem de antes: a posição não vaza nada
    expect(after.slice(1)).toEqual(before.filter((id) => id !== shown));
    // a orientação só sai de quem exibe
    expect(res.users.find((u) => u.id === shown)?.orientation).toBe('lesbian');
    expect(res.users.find((u) => u.id === hidden)?.orientation).toBeNull();
  });
});

describe('Boost 5 km', () => {
  it('boost na frente; de longe (≤ 5 km) na faixa boost com posição visual e piso de anonimato', async () => {
    const v = await person('Vini', { gender: 'male' });
    const near = await person('Perto', { gender: 'female' });
    const nearBoost = await person('PertoBoost', { gender: 'female' });
    const farBoost = await person('LongeBoost', { gender: 'female' });
    const farFriend = await person('LongeAmiga', { gender: 'female' });
    const aloneBoost = await person('SozinhaBoost', { gender: 'female' });
    const tooFar = await person('LongeDemais', { gender: 'female' });
    const tooFarFriend = await person('LongeDemaisAmiga', { gender: 'female' });
    await place(v, at(0));
    await place(near, at(30));
    await place(nearBoost, at(200, 50));
    const FAR = at(3_000);
    await place(farBoost, FAR);
    await place(farFriend, at(3_030, 20));
    // mesma área de anonimato (geohash-6): o piso de 2 pessoas vale pra ela
    expect(encodeGeohash(at(3_030, 20).lat, at(3_030, 20).lng, 6)).toBe(
      encodeGeohash(FAR.lat, FAR.lng, 6),
    );
    await place(aloneBoost, at(-4_000, -1_500)); // sozinha na área dela
    await place(tooFar, at(7_000));
    await place(tooFarFriend, at(7_030));
    const until = new Date(Date.now() + 30 * 60_000);
    for (const id of [nearBoost, farBoost, aloneBoost, tooFar])
      await prisma.boost.create({
        data: { userId: id, expiresAt: until, amountCents: 0, platform: 'android' },
      });

    const res = await location().discover(v, PRIVACY.DISCOVERY_RADIUS_M);
    const ids = idsOf(res);
    expect(ids.slice(0, 2)).toEqual([nearBoost, farBoost]); // boost primeiro; o de perto antes do de longe
    expect(ids).toContain(near);
    expect(ids).not.toContain(farFriend); // sem boost, a 3 km, não aparece
    expect(ids).not.toContain(aloneBoost); // piso de anonimato vale pro boost de longe
    expect(ids).not.toContain(tooFar); // além dos 5 km
    const fb = res.users.find((u) => u.id === farBoost)!;
    expect(fb.proximityBand).toBe('boost');
    expect(fb.isBoosted).toBe(true);
    expect(fb.mapPosition).not.toBeNull();
    expect(
      Math.abs(fb.mapPosition!.lat - FAR.lat) < 1e-6 &&
        Math.abs(fb.mapPosition!.lng - FAR.lng) < 1e-6,
    ).toBe(false);
    expect(findForbiddenKeys(res)).toEqual([]);

    // cartão/aceno: descoberta de longe com a faixa boost (sem distância)
    expect(await location().discoverability(v, farBoost)).toEqual({
      ok: true,
      band: 'boost',
      poi: null,
    });
    expect((await location().discoverability(v, farFriend)).ok).toBe(false);
    // raio pedido menor que o cheio: só quem está nele (sem boost de longe)
    expect(idsOf(await location().discover(v, 100))).not.toContain(farBoost);
  });

  it('as outras regras continuam valendo pro boost de longe ("Mostrar", invisível)', async () => {
    const v = await person('Vitor', { gender: 'male', showMe: 'men' });
    const vFriend = await person('Amigo', { gender: 'male' });
    const farBoost = await person('LongeBoost', { gender: 'female' });
    const farFriend = await person('LongeAmiga', { gender: 'female' });
    await place(v, at(0));
    await place(vFriend, at(50));
    await place(farBoost, at(3_000));
    await place(farFriend, at(3_030));
    await prisma.boost.create({
      data: {
        userId: farBoost,
        expiresAt: new Date(Date.now() + 30 * 60_000),
        amountCents: 0,
        platform: 'android',
      },
    });
    expect(idsOf(await location().discover(v))).not.toContain(farBoost);
    await prisma.user.update({ where: { id: v }, data: { showMe: 'everyone' } });
    expect(idsOf(await location().discover(v))).toContain(farBoost);
    await prisma.user.update({ where: { id: farBoost }, data: { visibilityMode: 'anonymous' } });
    expect(idsOf(await location().discover(v))).not.toContain(farBoost);
  });
});

describe('GPS falso (GPS_GUARD=on)', () => {
  it('salto impossível: não vira posição pública, some pros outros e a pessoa não vê ninguém; volta com posição boa', async () => {
    const u = await person('Ulisses', { gender: 'male' });
    const o = await person('Olga', { gender: 'female' });
    const o2 = await person('Otília', { gender: 'female' });
    await place(o, at(40));
    await place(o2, at(-30, 20));
    const svc = location();
    const P = at(0);

    const first = await svc.update(u, { latitude: P.lat, longitude: P.lng, accuracyMeters: 10 });
    expect(first.hiddenReason).toBeNull();
    expect(idsOf(await location().discover(o))).toContain(u);
    // a âncora guardada é grosseira (3 casas ≈ 110 m), nunca a posição fina
    expect(mem.hash.get(`loc:anchor:${u}`)?.get('la')).toMatch(/^-?\d+(\.\d{1,3})?$/);
    // a âncora da janela (velocidade acumulada) mora no mesmo hash, também grosseira
    expect(mem.hash.get(`loc:anchor:${u}`)?.get('wla')).toMatch(/^-?\d+(\.\d{1,3})?$/);

    mem.str.delete(`loc:gate:${u}`);
    const J = at(5_000);
    const jump = await svc.update(u, { latitude: J.lat, longitude: J.lng, accuracyMeters: 10 });
    expect(jump).toMatchObject({ discoverable: false, hiddenReason: 'location_unverified' });
    // a presença NÃO foi pra posição falsa (continua a antiga, escondida)
    expect(Number(mem.hash.get(`user:loc:${u}`)?.get('lat'))).toBeCloseTo(P.lat, 6);
    expect(mem.hash.get(`user:loc:${u}`)?.get('hidden')).toBe('1');
    expect(idsOf(await location().discover(o))).not.toContain(u);
    const mine = await location().discover(u);
    expect(mine.users).toEqual([]);
    expect(mine.me.hiddenReason).toBe('location_unverified');
    expect(mem.str.get(`gps:strikes:${u}:teleport`)).toBe('1');

    // o GPS voltou (perto da âncora): aceito na hora, aviso some, aparece de novo
    mem.str.delete(`loc:gate:${u}`);
    const back = await svc.update(u, {
      latitude: at(40).lat,
      longitude: at(40).lng,
      accuracyMeters: 10,
    });
    expect(back.hiddenReason).toBeNull();
    expect(mem.str.has(`loc:flag:${u}`)).toBe(false);
    expect(idsOf(await location().discover(o))).toContain(u);
  });

  it('posição simulada (mocked): location_mocked, sem mexer na posição', async () => {
    const u = await person('Mock', { gender: 'male' });
    const svc = location();
    const P = at(0);
    await svc.update(u, { latitude: P.lat, longitude: P.lng, accuracyMeters: 10 });
    mem.str.delete(`loc:gate:${u}`);
    const Q = at(200);
    const r = await svc.update(u, {
      latitude: Q.lat,
      longitude: Q.lng,
      accuracyMeters: 5,
      mocked: true,
    });
    expect(r).toMatchObject({ discoverable: false, hiddenReason: 'location_mocked' });
    expect(Number(mem.hash.get(`user:loc:${u}`)?.get('lat'))).toBeCloseTo(P.lat, 6);
    expect((await location().discover(u)).me.hiddenReason).toBe('location_mocked');
  });

  it('episódios repetidos viram UMA denúncia automática na fila (sem denunciante, sem coordenada, sem banir)', async () => {
    const u = await person('Pulador', { gender: 'male' });
    const guard = new GpsGuard(db, redis);
    for (let i = 0; i < GPS_GUARD.STRIKES_TELEPORT + 2; i++) await guard.strike(u, 'teleport');

    const reports = await prisma.report.findMany({ where: { reportedId: u } });
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      reporterId: null,
      reason: 'fake',
      priority: 1,
      status: 'pending',
    });
    expect(reports[0].description).not.toMatch(/-?\d+\.\d{3,}/);
    const actions = await prisma.moderationAction.findMany({ where: { targetUserId: u } });
    expect(actions.map((a) => a.action)).toEqual(['auto_flag_gps']);
    // nada de banimento/suspensão/análise automática
    expect(
      await prisma.user.findUnique({
        where: { id: u },
        select: { accountStatus: true, reviewHoldAt: true },
      }),
    ).toEqual({ accountStatus: 'active', reviewHoldAt: null });

    const moderation = new ModerationService(
      db,
      redis,
      { invalidate: async () => undefined } as unknown as AccountStateService,
      { emitToUser: jest.fn() } as unknown as ChatGateway,
      {} as PhotoModerationService,
      {
        notify: async () => ({ notified: 0, pushSent: 0, pushFailed: 0 }),
      } as unknown as NotifyService,
    );
    const q = await moderation.queue();
    const g = q.reports.find((r) => r.user.id === u);
    expect(g).toBeDefined();
    expect(g!.distinctReporters).toBe(0);
    expect(g!.reports[0]).toMatchObject({ reporterId: null, reason: 'fake' });
    expect(findForbiddenKeys(g)).toEqual([]);
  });
});
