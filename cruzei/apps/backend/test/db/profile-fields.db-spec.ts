import { PrismaClient } from '@prisma/client';

import type { PrismaService } from '../../src/database/prisma.service';
import type { LocationService } from '../../src/modules/location/location.service';
import type { PhotoModerationService } from '../../src/modules/moderation/photo-moderation.service';
import { PublicUsersController } from '../../src/modules/users/public-users.controller';
import { UsersService } from '../../src/modules/users/users.service';

import {
  actor,
  asGateway,
  asRedis,
  fakeGateway,
  fakeRedis,
  newUser,
  resetAdminDb,
} from './admin-fakes';
import { assertTestDatabase } from './env';

// Campos do perfil contra o banco de TESTE: orientação (9 opções, consentimento carimbado, null revoga), exibir /
// mesma orientação primeiro (exigem orientação), "Mostrar" (Mulheres/Homens/Todos), @ do Instagram (normalizado,
// público no cartão) e o cartão público sem lastActiveAt (só faixa, só pra quem descobre ou deu match) + os CHECKs.
// Recriar o banco: bash test/db/setup-test-db.sh

const prisma = new PrismaClient();
const db = prisma as unknown as PrismaService;
const redis = fakeRedis();
const gateway = fakeGateway();
const users = new UsersService(
  db,
  asRedis(redis),
  {} as PhotoModerationService,
  asGateway(gateway),
);

// descoberta falsa: cada teste diz se quem consulta descobre a pessoa agora (mesmas regras do /nearby)
type Discover = {
  ok: boolean;
  band: 'very_near' | 'near' | 'region' | null;
  poi: { id: number; name: string } | null;
};
const HIDDEN: Discover = { ok: false, band: null, poi: null };
let discover: Discover = HIDDEN;
const location = { discoverability: jest.fn(async () => discover) };
const cards = new PublicUsersController(db, location as unknown as LocationService);

/** corpo do erro Nest (BadRequestException({error, message})) */
async function errorOf(p: Promise<unknown>): Promise<{ status?: number; error?: string }> {
  try {
    await p;
  } catch (e) {
    const err = e as { getStatus?: () => number; getResponse?: () => unknown };
    const body = (err.getResponse?.() ?? {}) as { error?: string };
    return { status: err.getStatus?.(), error: body.error };
  }
  throw new Error('era pra ter falhado');
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

beforeAll(async () => {
  await assertTestDatabase(prisma);
});

beforeEach(async () => {
  await resetAdminDb(prisma);
  jest.clearAllMocks();
  discover = HIDDEN;
});

afterAll(async () => {
  await resetAdminDb(prisma);
  await prisma.$disconnect();
});

describe('cartão público (GET /users/:id)', () => {
  it('nunca devolve lastActiveAt; estranho sem descoberta nem match não vê nem a faixa', async () => {
    const a = await newUser(prisma, 'Ana');
    const b = await newUser(prisma, 'Bia', { lastActiveAt: minutesAgo(2) });
    const card = await cards.card(actor(a.id, 'user'), b.id);
    expect(card).not.toHaveProperty('lastActiveAt');
    expect(card.lastSeen).toBeNull();
    expect(JSON.stringify(card)).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/); // nenhum horário exato em lugar nenhum
  });

  it('quem descobre a pessoa agora vê só a faixa: online (< 15 min), recent (< 60 min), depois nada', async () => {
    const a = await newUser(prisma, 'Ana');
    const b = await newUser(prisma, 'Bia', { lastActiveAt: minutesAgo(2) });
    discover = { ok: true, band: 'near', poi: { id: 1, name: 'Bar do Léo' } };
    expect((await cards.card(actor(a.id, 'user'), b.id)).lastSeen).toBe('online');
    await prisma.user.update({ where: { id: b.id }, data: { lastActiveAt: minutesAgo(30) } });
    expect((await cards.card(actor(a.id, 'user'), b.id)).lastSeen).toBe('recent');
    await prisma.user.update({ where: { id: b.id }, data: { lastActiveAt: minutesAgo(120) } });
    expect((await cards.card(actor(a.id, 'user'), b.id)).lastSeen).toBeNull();
  });

  it('match (curtida mútua) vê a faixa mesmo fora da descoberta', async () => {
    const a = await newUser(prisma, 'Ana');
    const b = await newUser(prisma, 'Bia', { lastActiveAt: minutesAgo(40) });
    await prisma.like.create({ data: { likerId: a.id, likedId: b.id } });
    // só A curtiu: ainda é estranho pro relógio da B
    expect((await cards.card(actor(a.id, 'user'), b.id)).lastSeen).toBeNull();
    await prisma.like.create({ data: { likerId: b.id, likedId: a.id } });
    const card = await cards.card(actor(a.id, 'user'), b.id);
    expect(card.likeStatus).toBe('MUTUAL');
    expect(card.lastSeen).toBe('recent');
  });

  it('faixa e lugar continuam presos a "mostrar distância", mesmo descoberta', async () => {
    const a = await newUser(prisma, 'Ana');
    const b = await newUser(prisma, 'Bia', { showDistance: false, lastActiveAt: minutesAgo(1) });
    discover = { ok: true, band: 'very_near', poi: { id: 1, name: 'Bar do Léo' } };
    const card = await cards.card(actor(a.id, 'user'), b.id);
    expect(card.proximityBand).toBeNull();
    expect(card.placeName).toBeNull();
    expect(card.lastSeen).toBe('online'); // a última atividade não depende de "mostrar distância"
  });

  it('orientação só quando a pessoa exibe; Instagram é público pra quem abre o cartão', async () => {
    const a = await newUser(prisma, 'Ana');
    const b = await newUser(prisma, 'Bia', {
      orientation: 'lesbian',
      showOrientation: false,
      instagramHandle: 'bia.rocha',
    });
    let card = await cards.card(actor(a.id, 'user'), b.id);
    expect(card.orientation).toBeNull();
    expect(card.instagram).toBe('bia.rocha'); // estranho também vê (decisão do dono)
    await prisma.user.update({ where: { id: b.id }, data: { showOrientation: true } });
    card = await cards.card(actor(a.id, 'user'), b.id);
    expect(card.orientation).toBe('lesbian');
    const c = await newUser(prisma, 'Caio', { gender: 'male' });
    expect((await cards.card(actor(a.id, 'user'), c.id)).instagram).toBeNull();
  });
});

describe('PATCH /me: orientação e Instagram', () => {
  it('orientação nova grava e carimba o consentimento; mesma orientação não recarimba', async () => {
    const { id } = await newUser(prisma, 'Ana');
    const me = (await users.update(id, { orientation: 'bisexual' })) as { orientation: string };
    expect(me.orientation).toBe('bisexual');
    const row = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(row.orientationConsentedAt).toBeInstanceOf(Date);
    const first = row.orientationConsentedAt?.getTime();
    await users.update(id, { orientation: 'bisexual' });
    const again = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(again.orientationConsentedAt?.getTime()).toBe(first);
  });

  it('null apaga a orientação e desliga exibir/ordem (revogação do consentimento)', async () => {
    const { id } = await newUser(prisma, 'Ana', {
      orientation: 'queer',
      orientationConsentedAt: new Date(),
      showOrientation: true,
      sameOrientationFirst: true,
    });
    await users.update(id, { orientation: null });
    const row = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({
      orientation: null,
      showOrientation: false,
      sameOrientationFirst: false,
      orientationConsentedAt: null,
    });
  });

  it('Instagram: normaliza link/@/maiúsculas, recusa fora da regra, vazio apaga', async () => {
    const { id } = await newUser(prisma, 'Ana');
    let me = (await users.update(id, {
      instagram: 'https://www.instagram.com/Ana.Souza_/?hl=pt',
    })) as { instagram: string | null };
    expect(me.instagram).toBe('ana.souza_');
    expect(await errorOf(users.update(id, { instagram: '.ana' }))).toEqual({
      status: 400,
      error: 'instagram_invalid',
    });
    expect(await errorOf(users.update(id, { instagram: 'ana..souza' }))).toEqual({
      status: 400,
      error: 'instagram_invalid',
    });
    // o inválido não mexeu no que estava
    expect((await prisma.user.findUniqueOrThrow({ where: { id } })).instagramHandle).toBe(
      'ana.souza_',
    );
    me = (await users.update(id, { instagram: '' })) as { instagram: string | null };
    expect(me.instagram).toBeNull();
  });
});

describe('PATCH /me/settings: exibir, ordem e "Mostrar"', () => {
  it('ligar exibir/ordem sem orientação: 400 orientation_required (não 500 do CHECK)', async () => {
    const { id } = await newUser(prisma, 'Ana');
    expect(await errorOf(users.updateSettings(id, { showOrientation: true }))).toEqual({
      status: 400,
      error: 'orientation_required',
    });
    expect(await errorOf(users.updateSettings(id, { sameOrientationFirst: true }))).toEqual({
      status: 400,
      error: 'orientation_required',
    });
    // desligar sempre pode
    await expect(users.updateSettings(id, { showOrientation: false })).resolves.toMatchObject({
      ok: true,
    });
  });

  it('com orientação liga as duas; "Mostrar" grava; o /me devolve tudo', async () => {
    const { id } = await newUser(prisma, 'Ana', {
      orientation: 'straight',
      orientationConsentedAt: new Date(),
    });
    await users.updateSettings(id, {
      showOrientation: true,
      sameOrientationFirst: true,
      showMe: 'men',
    });
    expect(redis.invalidateProfile).toHaveBeenCalledWith(id); // /me e caches da descoberta
    const me = (await users.me(id)) as { settings: Record<string, unknown> };
    expect(me.settings).toMatchObject({
      showOrientation: true,
      sameOrientationFirst: true,
      showMe: 'men',
    });
  });

  it('conta sem escolha: "Mostrar" = Todos e as chaves desligadas', async () => {
    const { id } = await newUser(prisma, 'Ana');
    const me = (await users.me(id)) as { settings: Record<string, unknown>; instagram: unknown };
    expect(me.settings).toMatchObject({
      showOrientation: false,
      sameOrientationFirst: false,
      showMe: 'everyone',
    });
    expect(me.instagram).toBeNull();
  });
});

describe('banco: enums, CHECKs e padrões', () => {
  it('Orientation tem exatamente as 9 opções; ShowMe as 3', async () => {
    const o = await prisma.$queryRaw<
      { v: string }[]
    >`SELECT unnest(enum_range(NULL::"Orientation"))::text AS v`;
    expect(o.map((r) => r.v)).toEqual([
      'straight',
      'gay',
      'lesbian',
      'asexual',
      'bisexual',
      'demisexual',
      'pansexual',
      'queer',
      'curious',
    ]);
    const s = await prisma.$queryRaw<
      { v: string }[]
    >`SELECT unnest(enum_range(NULL::"ShowMe"))::text AS v`;
    expect(s.map((r) => r.v)).toEqual(['women', 'men', 'everyone']);
  });

  it('CHECK: exibir/ordem sem orientação e @ fora da regra não entram nem por SQL direto', async () => {
    const { id } = await newUser(prisma, 'Ana');
    await expect(
      prisma.user.update({ where: { id }, data: { showOrientation: true } }),
    ).rejects.toThrow();
    await expect(
      prisma.user.update({ where: { id }, data: { sameOrientationFirst: true } }),
    ).rejects.toThrow();
    for (const bad of ['.ana', 'ana.', 'a..b', 'Ana', 'ana souza']) {
      await expect(
        prisma.user.update({ where: { id }, data: { instagramHandle: bad } }),
      ).rejects.toThrow();
    }
    await expect(
      prisma.user.update({ where: { id }, data: { instagramHandle: 'ana_souza.99' } }),
    ).resolves.toBeTruthy();
  });

  it('conta nova sem escolha: "Mostrar" = Todos, sem orientação e chaves desligadas (padrões do banco)', async () => {
    const { id } = await prisma.user.create({
      data: { name: 'Nova', birthDate: new Date('1995-01-01'), gender: 'other' },
      select: { id: true },
    });
    const row = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({
      orientation: null,
      orientationConsentedAt: null,
      showOrientation: false,
      sameOrientationFirst: false,
      showMe: 'everyone',
      instagramHandle: null,
    });
  });
});
