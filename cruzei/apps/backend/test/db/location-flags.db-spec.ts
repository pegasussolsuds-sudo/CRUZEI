import type { Orientation } from '@cruzei/shared-types';
import { encodeGeohash, offsetLatLng } from '@cruzei/shared-utils';
import type { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

import type { AuthenticatedUser } from '../../src/common/decorators/current-user.decorator';
import type { PrismaService } from '../../src/database/prisma.service';
import type { AccountStateService } from '../../src/modules/account/account-state.service';
import { GPS_GUARD, type GuardMode } from '../../src/modules/location/anti-spoof';
import { DECK } from '../../src/modules/location/discovery-order';
import { PRIVACY, findForbiddenKeys } from '../../src/modules/location/discovery-privacy';
import { GpsGuard } from '../../src/modules/location/gps-guard';
import {
  LocationService,
  type DeckResult,
  type DiscoveryResult,
} from '../../src/modules/location/location.service';
import { ModerationService } from '../../src/modules/moderation/moderation.service';
import type { PhotoModerationService } from '../../src/modules/moderation/photo-moderation.service';
import type { NotifyService } from '../../src/modules/notifications/notify.service';
import { PublicUsersController } from '../../src/modules/users/public-users.controller';
import type { ChatGateway } from '../../src/realtime/chat.gateway';
import type { RedisService } from '../../src/redis/redis.service';

import { assertTestDatabase } from './env';

// Descoberta contra o banco de TESTE (cruzei_test) com o LocationService DE VERDADE (SQL das flags, regras, ordem) e
// um Redis em memória: "Mostrar" recíproco, "mesma orientação primeiro" (só de quem exibe), Boost 5 km (faixa
// 'boost', posição visual, piso de anonimato), GPS falso (salto / posição simulada) e a denúncia automática na fila
// da moderação (sem denunciante, sem coordenada), faixa de idade (só o meu lado; idade escondida pelo bloco de 5 anos,
// nunca revelada) e o deck
// (?deck=1: passar/já curti fora, super curtida pendente no topo). Banco fora do ar = FALHA. Recriar: pnpm test:db:setup

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
  gender?: 'female' | 'male' | 'other';
  showMe?: 'women' | 'men' | 'everyone';
  orientation?: Orientation | null;
  showOrientation?: boolean;
  sameOrientationFirst?: boolean;
  /** idade em anos completos hoje (nascimento 1º de janeiro, ou hoje - N anos - 1 dia se o ano ainda não virou) */
  age?: number;
  showAge?: boolean;
  ageMin?: number;
  ageMax?: number;
  visibilityMode?: 'visible' | 'anonymous';
  premium?: boolean;
};
/** nascimento com exatamente `age` anos completos hoje (meio do ano passado do aniversário: sem borda de fuso) */
function bornAged(age: number): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - age);
  d.setDate(d.getDate() - 100);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}
async function person(name: string, o: PersonOpts = {}): Promise<string> {
  seq++;
  const u = await prisma.user.create({
    data: {
      name,
      phone: `+5534966${String(seq).padStart(6, '0')}`,
      birthDate: o.age != null ? bornAged(o.age) : new Date('1995-01-01'),
      showAge: o.showAge ?? true,
      gender: o.gender ?? 'female',
      visibilityMode: o.visibilityMode ?? 'visible',
      showMe: o.showMe ?? 'everyone',
      orientation: o.orientation ?? null,
      showOrientation: o.showOrientation ?? false,
      sameOrientationFirst: o.sameOrientationFirst ?? false,
      ageMin: o.ageMin ?? 18,
      ageMax: o.ageMax ?? 99,
      ...(o.premium ? { premiumTier: 'premium' as const, premiumExpiresAt: null } : {}),
    },
    select: { id: true },
  });
  return u.id;
}

const idsOf = (r: DiscoveryResult | DeckResult) => r.users.map((u) => u.id);
const originalMode: GuardMode = GPS_GUARD.MODE;

beforeAll(async () => {
  await assertTestDatabase(prisma);
  GPS_GUARD.MODE = 'on';
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE users, boosts, reports, moderation_actions, likes, passes, blocks RESTART IDENTITY CASCADE',
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
      gender: 'other',
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
      gender: 'other',
      showMe: 'women',
      orientation: 'queer',
      showOrientation: true,
    });
  });
});

describe('"Mostrar: Mulheres / Homens / Todos" é recíproco (mapa, lista e deck)', () => {
  it('só aparece quem também quer me ver; "Outro" só pra quem escolheu Todos', async () => {
    const m = await person('Marcos', { gender: 'male', showMe: 'women' });
    const w1 = await person('Wanda', { gender: 'female', showMe: 'everyone' });
    const w2 = await person('Wilma', { gender: 'female', showMe: 'women' });
    const nb = await person('Nic', { gender: 'other', showMe: 'everyone' });
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

describe('faixa de idade do "quem ver" (só o meu lado; idade escondida = bloco de 5 anos, nunca revelada)', () => {
  it('mapa/lista: só quem cabe na MINHA faixa; quem esconde a idade entra pelo bloco e segue sem idade', async () => {
    const v = await person('Vic', { gender: 'male', age: 33, ageMin: 25, ageMax: 30 });
    const young = await person('Jovem', { age: 24 });
    const hidden = await person('Escondida', { age: 27, showAge: false });
    const hiddenOld = await person('EscondidaVelha', { age: 40, showAge: false });
    // escondidas com a idade exata fora da faixa, mas o bloco encosta: 23 (23–27) e 32 (28–32)
    const hiddenLow = await person('EscondidaBlocoBaixo', { age: 23, showAge: false });
    const hiddenHigh = await person('EscondidaBlocoAlto', { age: 32, showAge: false });
    // a mesma idade mostrando: vale a exata
    const shownLow = await person('MostraVinteETres', { age: 23 });
    const edge = await person('Borda', { age: 30 });
    const old = await person('Velha', { age: 31 });
    await place(v, at(0));
    await place(young, at(30));
    await place(hidden, at(-30, 20));
    await place(hiddenOld, at(50, -20));
    await place(hiddenLow, at(-60, 40));
    await place(hiddenHigh, at(60, 30));
    await place(shownLow, at(-20, -60));
    await place(edge, at(-50));
    await place(old, at(20, 60));

    const res = await location().discover(v);
    expect(new Set(idsOf(res))).toEqual(new Set([hidden, hiddenLow, hiddenHigh, edge]));
    for (const id of [hidden, hiddenLow, hiddenHigh])
      expect(res.users.find((u) => u.id === id)!.age).toBeNull();
    expect(res.users.find((u) => u.id === edge)!.age).toBe(30);
    // quem saiu pela idade não vira "+N por perto" (igual ao "Mostrar")
    expect(res.hiddenCount).toBe(0);
    expect(findForbiddenKeys(res)).toEqual([]);
    expect(JSON.stringify(res)).not.toMatch(/birth/i);

    // NÃO recíproco: a de 24 (sem filtro) continua me vendo
    expect(idsOf(await location().discover(young))).toContain(v);
    // o deck usa a mesma faixa
    expect(new Set(idsOf(await location().discoverDeck(v)))).toEqual(
      new Set([hidden, hiddenLow, hiddenHigh, edge]),
    );
    // abrir a faixa (18 a 80+): todo mundo volta
    await prisma.user.update({ where: { id: v }, data: { ageMin: 18, ageMax: 99 } });
    expect(new Set(idsOf(await location().discover(v)))).toEqual(
      new Set([young, hidden, hiddenOld, hiddenLow, hiddenHigh, shownLow, edge, old]),
    );
  });

  it('busca binária na faixa não passa do bloco: escondidas de 28 e 32 anos aparecem e somem juntas', async () => {
    const v = await person('Busca', { gender: 'male', age: 40 });
    const a28 = await person('Vinte8', { age: 28, showAge: false });
    const a32 = await person('Trinta2', { age: 32, showAge: false });
    await place(v, at(0));
    await place(a28, at(30));
    await place(a32, at(-30, 20));
    const seenWith = async (ageMin: number, ageMax: number) => {
      await prisma.user.update({ where: { id: v }, data: { ageMin, ageMax } });
      return new Set(idsOf(await location().discover(v)));
    };
    for (const [ageMin, ageMax] of [
      [18, 27],
      [18, 30],
      [29, 33],
      [30, 99],
      [32, 99],
    ]) {
      const seen = await seenWith(ageMin, ageMax);
      expect(seen.has(a28)).toBe(seen.has(a32));
    }
    // o bloco 28–32 encosta: as duas; não encosta: nenhuma
    expect(await seenWith(18, 28)).toEqual(new Set([a28, a32]));
    expect(await seenWith(33, 99)).toEqual(new Set());
  });

  it('topo "80+" (99) não corta ninguém em cima; 80 corta quem tem 81', async () => {
    const v = await person('Avo', { gender: 'male', age: 70, ageMin: 60, ageMax: 99 });
    const a85 = await person('OitentaECinco', { age: 85 });
    const a81 = await person('OitentaEUm', { age: 81 });
    const a59 = await person('CinquentaENove', { age: 59 });
    await place(v, at(0));
    await place(a85, at(30));
    await place(a81, at(-30, 20));
    await place(a59, at(20, -40));
    expect(new Set(idsOf(await location().discover(v)))).toEqual(new Set([a85, a81]));
    await prisma.user.update({ where: { id: v }, data: { ageMax: 80 } });
    expect(idsOf(await location().discover(v))).toEqual([]);
  });

  it('Premium: a contagem de invisíveis também respeita a minha faixa (e o deck não traz invisíveis)', async () => {
    const v = await person('Premium', { gender: 'male', premium: true, ageMin: 25, ageMax: 35 });
    const vis1 = await person('Vis1', { age: 30 });
    const vis2 = await person('Vis2', { age: 30 });
    const invIn = await person('InvDentro', { age: 30, visibilityMode: 'anonymous' });
    const invOut = await person('InvFora', { age: 50, visibilityMode: 'anonymous' });
    // idade escondida: 23 entra pelo bloco 23–27; 22 (bloco 18–22) fica fora
    const invHiddenIn = await person('InvEscondeDentro', {
      age: 23,
      showAge: false,
      visibilityMode: 'anonymous',
    });
    const invHiddenOut = await person('InvEscondeFora', {
      age: 22,
      showAge: false,
      visibilityMode: 'anonymous',
    });
    await place(v, at(0));
    await place(vis1, at(30));
    await place(vis2, at(-30, 20));
    await place(invIn, at(20, -40));
    await place(invOut, at(-20, -40));
    await place(invHiddenIn, at(40, 10));
    await place(invHiddenOut, at(-40, 10));

    const res = await location().discover(v);
    expect(res.invisible?.total).toBe(2);
    // grupos de invisíveis têm lat/lng de propósito (ponto do lugar ou centro da quadra, nunca de alguém)
    expect(
      findForbiddenKeys(res, '', [], /^(mapPosition|poi|pois|place|invisible\.groups)(\.|$)/),
    ).toEqual([]);
    // 25 a 80+: entra a de 50; a escondida de 22 continua fora (bloco 18–22)
    await prisma.user.update({ where: { id: v }, data: { ageMax: 99 } });
    expect((await location().discover(v)).invisible?.total).toBe(3);
    const deck = await location().discoverDeck(v);
    expect(deck.invisible).toBeNull();
    expect(idsOf(deck)).not.toContain(invIn);
  });
});

describe('deck (?deck=1): passar, já curti e super curtida no topo', () => {
  const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);
  const superLike = (from: string, to: string, at: Date = new Date()) =>
    prisma.like.create({ data: { likerId: from, likedId: to, isSuper: true, createdAt: at } });

  it('passei (< DISCOVERY_PASS_DAYS) ou já curti: some do deck, mas continua no mapa; passar vencido volta', async () => {
    const v = await person('Deck', { gender: 'male' });
    const passed = await person('Passada');
    const liked = await person('Curtida');
    const oldPass = await person('PassouHaMuito');
    const fresh = await person('Nova');
    await place(v, at(0));
    await place(passed, at(30));
    await place(liked, at(-30, 20));
    await place(oldPass, at(20, -40));
    await place(fresh, at(-40, -10));
    await prisma.pass.create({ data: { userId: v, targetId: passed } });
    await prisma.pass.create({
      data: { userId: v, targetId: oldPass, createdAt: daysAgo(DECK.PASS_DAYS + 1) },
    });
    await prisma.like.create({ data: { likerId: v, likedId: liked } });

    const deck = await location().discoverDeck(v);
    expect(new Set(idsOf(deck))).toEqual(new Set([oldPass, fresh]));
    expect(deck.superLikesPending).toBe(0);
    expect(deck.users.some((u) => u.superLikedMe)).toBe(false);
    expect(findForbiddenKeys(deck)).toEqual([]);
    // o mapa é presença: passar não esconde ninguém
    expect(new Set(idsOf(await location().discover(v)))).toEqual(
      new Set([passed, liked, oldPass, fresh]),
    );
    // passar é só MEU: quem eu passei continua me vendo no deck dela
    expect(idsOf(await location().discoverDeck(passed))).toContain(v);
    // "Voltar" (apagar o passar): volta pro deck na hora
    await prisma.pass.delete({ where: { userId_targetId: { userId: v, targetId: passed } } });
    expect(idsOf(await location().discoverDeck(v))).toContain(passed);
  });

  it('super curtida pendente vem primeiro (a mais recente antes), de qualquer distância, sem dizer onde', async () => {
    const v = await person('Recebe', { gender: 'male' }); // grátis: curtida normal fica escondida
    const near = await person('Perto');
    const nearFriend = await person('PertoAmiga');
    const superNear = await person('SuperPerto');
    const superFar = await person('SuperLonge');
    const normalLiker = await person('CurtidaNormal');
    await place(v, at(0));
    await place(near, at(30));
    await place(nearFriend, at(-30, 10));
    await place(superNear, at(40, 40));
    await place(superFar, at(4_000));
    await place(normalLiker, at(-40, -20));
    await superLike(superFar, v, new Date(Date.now() - 3_600_000));
    await superLike(superNear, v); // a mais recente
    await prisma.like.create({ data: { likerId: normalLiker, likedId: v } });

    const deck = await location().discoverDeck(v);
    expect(idsOf(deck).slice(0, 2)).toEqual([superNear, superFar]);
    expect(deck.superLikesPending).toBe(2);
    const [sn, sf] = deck.users;
    expect(sn).toMatchObject({ superLikedMe: true, likeStatus: 'RECEIVED', likedByMe: false });
    expect(sn.proximityBand).not.toBeNull(); // no raio e com marcador: como no mapa
    expect(sf).toMatchObject({
      superLikedMe: true,
      likeStatus: 'RECEIVED',
      proximityBand: null,
      mapPosition: null,
      poi: null,
      lastSeen: 'earlier',
      isOnline: false,
    });
    // curtida normal continua escondida pra quem não é Premium+ (e sem selo)
    const nl = deck.users.find((u) => u.id === normalLiker)!;
    expect(nl.likeStatus).toBe('NONE');
    expect(nl.superLikedMe).toBeUndefined();
    expect(new Set(idsOf(deck).slice(2))).toEqual(new Set([near, nearFriend, normalLiker]));
    expect(findForbiddenKeys(deck)).toEqual([]);

    // mapa e lista não mudam: sem topo, sem quem está longe, sem selo
    const map = await location().discover(v);
    expect(idsOf(map)).not.toContain(superFar);
    expect(map.users.some((u) => 'superLikedMe' in u)).toBe(false);
    expect('superLikesPending' in map).toBe(false);
  });

  it('responder tira do topo: curtir de volta ou passar DEPOIS; passar ANTES não conta (segunda chance)', async () => {
    const v = await person('Responde', { gender: 'male' });
    const a = await person('A');
    const b = await person('B');
    const c = await person('C');
    const old = await person('Antiga');
    // eu ainda sem presença: a super curtida não depende de onde eu estou
    await superLike(a, v, daysAgo(1));
    await superLike(b, v, daysAgo(1));
    await superLike(c, v, daysAgo(1));
    await superLike(old, v, daysAgo(DECK.PASS_DAYS + 1)); // venceu: não fica pendente pra sempre
    await prisma.like.create({ data: { likerId: v, likedId: a } }); // curti de volta
    await prisma.pass.create({ data: { userId: v, targetId: b } }); // passei depois
    await prisma.pass.create({ data: { userId: v, targetId: c, createdAt: daysAgo(2) } }); // passei antes

    const deck = await location().discoverDeck(v);
    expect(deck.me.hiddenReason).toBe('no_presence');
    expect(idsOf(deck)).toEqual([c]);
    expect(deck.superLikesPending).toBe(1);
    expect(deck.users[0]).toMatchObject({ superLikedMe: true, proximityBand: null });
    // a mesma regra pro cartão público (GET /users/:id → superLikedMe)
    expect(await location().superLikedMeFrom(v, [a, b, c, old, v])).toEqual(new Set([c]));
    expect(await location().superLikedMeFrom(v, [])).toEqual(new Set());
    // cartão de verdade: grátis vê o selo e RECEIVED (a super curtida revela); quem já respondi, não
    const cards = new PublicUsersController(db, location());
    const me = { id: v } as AuthenticatedUser;
    expect(await cards.card(me, c)).toMatchObject({
      superLikedMe: true,
      likeStatus: 'RECEIVED',
      likedMe: true,
    });
    const cardB = await cards.card(me, b);
    expect('superLikedMe' in cardB).toBe(false);
    expect(cardB.likeStatus).toBe('NONE');
  });

  it('topo respeita bloqueio, invisível, pausa, análise, conta fora do ar, "Ninguém", meu "Mostrar" e minha idade', async () => {
    const v = await person('Filtra', { gender: 'male', showMe: 'women', ageMin: 23, ageMax: 40 });
    const ok = await person('Ok', { age: 30 });
    const hiddenAgeOk = await person('EscondeIdadeOk', { age: 35, showAge: false });
    // 41 escondida: o bloco 38–42 encosta nos 40
    const hiddenAgeEdge = await person('EscondeIdadeBloco', { age: 41, showAge: false });
    const blockedByMe = await person('Bloqueada', { age: 30 });
    const blockedMe = await person('MeBloqueou', { age: 30 });
    const anon = await person('Invisivel', { age: 30, visibilityMode: 'anonymous' });
    const paused = await person('Pausada', { age: 30 });
    const hold = await person('EmAnalise', { age: 30 });
    const suspended = await person('Suspensa', { age: 30 });
    const deleted = await person('Apagada', { age: 30 });
    const nobody = await person('Ninguem', { age: 30 });
    const man = await person('Homem', { gender: 'male', age: 30 });
    const outro = await person('Outro', { gender: 'other', age: 30 });
    const tooOld = await person('ForaDaFaixa', { age: 50 });
    // 22 escondida: bloco 18–22, não encosta nos 23
    const hiddenAgeYoung = await person('EscondeIdadeNova', { age: 22, showAge: false });
    await prisma.user.update({ where: { id: paused }, data: { isPaused: true } });
    await prisma.user.update({ where: { id: hold }, data: { reviewHoldAt: new Date() } });
    await prisma.user.update({ where: { id: suspended }, data: { accountStatus: 'suspended' } });
    await prisma.user.update({ where: { id: deleted }, data: { deletedAt: new Date() } });
    await prisma.user.update({ where: { id: nobody }, data: { discoveryMode: 'nobody' } });
    await prisma.block.create({ data: { blockerId: v, blockedId: blockedByMe } });
    await prisma.block.create({ data: { blockerId: blockedMe, blockedId: v } });
    const all = [
      ok,
      hiddenAgeOk,
      blockedByMe,
      blockedMe,
      anon,
      paused,
      hold,
      suspended,
      deleted,
      nobody,
      man,
      outro,
      tooOld,
      hiddenAgeYoung,
      hiddenAgeEdge,
    ];
    for (const [i, id] of all.entries()) await superLike(id, v, new Date(Date.now() - i * 60_000));

    const deck = await location().discoverDeck(v);
    expect(idsOf(deck)).toEqual([ok, hiddenAgeOk, hiddenAgeEdge]);
    // a super curtida revela quem é, nunca a idade escondida
    expect(deck.users[1].age).toBeNull();
    expect(deck.users[2].age).toBeNull();
    expect(JSON.stringify(deck)).not.toMatch(/birth/i);

    // eu com GPS falso detectado agora: nada (nem o topo)
    mem.str.set(`loc:flag:${v}`, 'teleport');
    expect(idsOf(await location().discoverDeck(v))).toEqual([]);
    mem.str.delete(`loc:flag:${v}`);
    // eu em "Ninguém": fora da descoberta, deck vazio
    await prisma.user.update({ where: { id: v }, data: { discoveryMode: 'nobody' } });
    expect(idsOf(await location().discoverDeck(v))).toEqual([]);
  });
});
