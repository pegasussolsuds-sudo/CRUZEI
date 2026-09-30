import { offsetLatLng } from '@cruzei/shared-utils';
import type { ConfigService } from '@nestjs/config';

import type { PrismaService } from '../../database/prisma.service';
import type { RedisService } from '../../redis/redis.service';

import { GPS_GUARD, type GuardState } from './anti-spoof';
import { LocationService, type Presence } from './location.service';

// POST /location/update com fix impreciso (ignorado pelo GPS_GUARD) e SEM resposta anterior em loc:last: a resposta é
// o estado real (presença que já existe ou 'no_presence') e não fica em cache — o próximo fix bom não esbarra nela.

const HOME = { lat: -18.923, lng: -48.27 };
const userRow = {
  visibilityMode: 'visible',
  isPaused: false,
  deletedAt: null,
  discoveryMode: 'everyone',
  createdAt: new Date(0),
  isVerified: false,
  privateAreas: [],
};

function setup(
  opts: {
    cached?: string | null;
    state?: Partial<GuardState>;
    presence?: Partial<Presence> | null;
    user?: Partial<typeof userRow>;
  } = {},
) {
  const sets: string[] = [];
  const redis = {
    client: {
      set: jest.fn(async (key: string) => {
        sets.push(key);
        return 'OK';
      }),
      get: jest.fn(async (key: string) =>
        key.startsWith('loc:last:') ? (opts.cached ?? null) : null,
      ),
    },
  } as unknown as RedisService;
  const prisma = {
    user: { findUnique: jest.fn(async () => ({ ...userRow, ...opts.user })) },
  } as unknown as PrismaService;
  const config = { get: () => 'sal-de-teste' } as unknown as ConfigService;
  const svc = new LocationService(prisma, redis, config);
  const internals = svc as unknown as { gps: { read: () => Promise<GuardState> } };
  jest
    .spyOn(internals.gps, 'read')
    // âncora recente na casa: o fix de antena a 4 km em 20 s não é plausível e cai no 'ignore' (sem âncora, o impreciso
    // vira a 1ª posição — ver anti-spoof.spec)
    .mockResolvedValue({
      anchor: { lat: HOME.lat, lng: HOME.lng, t: Date.now() - 20_000, acc: 10 },
      win: null,
      pending: null,
      flag: null,
      ...opts.state,
    });
  const presences = new Map<string, Presence>();
  if (opts.presence !== null && opts.presence !== undefined) {
    presences.set('u1', {
      lat: HOME.lat,
      lng: HOME.lng,
      updatedAt: Date.now() - 60_000,
      poi: null,
      hidden: false,
      ...opts.presence,
    });
  }
  jest.spyOn(svc, 'getPresences').mockResolvedValue(presences);
  return { svc, sets };
}

/** fix de antena: ±3 km, a 4 km da casa */
const imprecise = () => {
  const p = offsetLatLng(HOME.lat, HOME.lng, 4_000, 0);
  return { latitude: p.lat, longitude: p.lng, accuracyMeters: 3_000 };
};

describe('update com fix ignorado (impreciso) e sem resposta anterior', () => {
  const mode = GPS_GUARD.MODE;
  beforeAll(() => {
    GPS_GUARD.MODE = 'on';
  });
  afterAll(() => {
    GPS_GUARD.MODE = mode;
  });

  it('sem presença ainda: no_presence (não "location_unverified") e nada em loc:last', async () => {
    const { svc, sets } = setup({ presence: null });
    const r = await svc.update('u1', imprecise());
    expect(r).toMatchObject({ discoverable: false, hiddenReason: 'no_presence' });
    expect(sets.filter((k) => k.startsWith('loc:last:'))).toEqual([]);
  });

  it('com presença de antes: continua descoberta (hiddenReason null), sem cache', async () => {
    const { svc, sets } = setup({
      presence: {},
      state: { anchor: { lat: HOME.lat, lng: HOME.lng, t: Date.now() - 20_000, acc: 10 } },
    });
    const r = await svc.update('u1', imprecise());
    expect(r).toMatchObject({ discoverable: true, hiddenReason: null });
    expect(sets.filter((k) => k.startsWith('loc:last:'))).toEqual([]);
  });

  it('estado real de verdade: área privada, pausa e aviso de GPS falso ativo', async () => {
    expect(
      (await setup({ presence: { hidden: true } }).svc.update('u1', imprecise())).hiddenReason,
    ).toBe('private_area');
    expect(
      (await setup({ presence: null, user: { isPaused: true } }).svc.update('u1', imprecise()))
        .hiddenReason,
    ).toBe('paused');
    expect(
      (await setup({ presence: {}, state: { flag: 'teleport' } }).svc.update('u1', imprecise()))
        .hiddenReason,
    ).toBe('location_unverified');
  });

  it('com resposta anterior: devolve ela (a presença de antes continua valendo)', async () => {
    const prev = {
      geohash: '6gyf4b',
      nearbyUsers: 3,
      nearbyPois: 1,
      expiresAt: new Date().toISOString(),
      discoverable: true,
      hiddenReason: null,
    };
    const { svc, sets } = setup({ cached: JSON.stringify(prev) });
    expect(await svc.update('u1', imprecise())).toEqual(prev);
    expect(sets.filter((k) => k.startsWith('loc:last:'))).toEqual([]);
  });
});
