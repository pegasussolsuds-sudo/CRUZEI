import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';

import type { PrismaService } from '../../src/database/prisma.service';
import { AccountStateService } from '../../src/modules/account/account-state.service';
import { AuthService } from '../../src/modules/auth/auth.service';
import { PhoneReleaseService } from '../../src/modules/auth/phone-release.service';
import type { SmsService } from '../../src/modules/auth/sms.service';
import type { PhotoModerationService } from '../../src/modules/moderation/photo-moderation.service';
import { UsersService } from '../../src/modules/users/users.service';
import type { RedisService } from '../../src/redis/redis.service';

import { asGateway, fakeGateway, fakeRedis, newUser, resetAdminDb } from './admin-fakes';
import { assertTestDatabase } from './env';

// Cadastro e perfil da leva de 04/10/2026 contra o banco de TESTE: gênero só Mulher/Homem/Outro (app antigo com
// non_binary grava other), bio/@/interesses no cadastro (validados ANTES de gastar a prova do SMS), PATCH /me com
// gênero, nome e interesses, e a faixa de idade do "quem ver" (PATCH /me/settings: 400 age_range_invalid, nunca o
// 500 do CHECK; uma ponta só trava contra a outra no próprio UPDATE). Recriar o banco: bash test/db/setup-test-db.sh

const SECRET = 'segredo-do-db-spec-de-cadastro';
const prisma = new PrismaClient();
const db = prisma as unknown as PrismaService;

// Redis em memória com a prova de SMS (o resto do cadastro não usa)
const redis = fakeRedis();
const redisExtra = {
  setSignupProof: jest.fn(async (phone: string) => void redis.kv.set(`sms:verified:${phone}`, '1')),
  consumeSignupProof: jest.fn(async (phone: string) => redis.kv.delete(`sms:verified:${phone}`)),
};
const asRedis = () => Object.assign(redis, redisExtra) as unknown as RedisService;

const accounts = new AccountStateService(db, asRedis());
const phones = new PhoneReleaseService(db, asRedis(), accounts);
const jwt = new JwtService({ secret: SECRET });
const cfg = {
  get: (k: string) =>
    ({ 'jwt.secret': SECRET, 'jwt.accessTtl': 900, 'jwt.refreshTtl': 2_592_000 })[k],
} as unknown as ConfigService;
const sms = { verifyCode: async () => true } as unknown as SmsService;
const auth = new AuthService(db, jwt, cfg, sms, asRedis(), accounts, phones);
const users = new UsersService(
  db,
  asRedis(),
  {} as PhotoModerationService,
  asGateway(fakeGateway()),
);

/** corpo do erro Nest (BadRequestException({error, message, field?})); toEqual ignora o field ausente */
async function errorOf(
  p: Promise<unknown>,
): Promise<{ status?: number; error?: string; field?: string }> {
  try {
    await p;
  } catch (e) {
    const err = e as { getStatus?: () => number; getResponse?: () => unknown };
    const body = (err.getResponse?.() ?? {}) as { error?: string; field?: string };
    return { status: err.getStatus?.(), error: body.error, field: body.field };
  }
  throw new Error('era pra ter falhado');
}

const CATALOG = ['Música', 'Viagem', 'Praia', 'Café'];
const proof = (phone: string) => redis.kv.set(`sms:verified:${phone}`, '1');
const signup = {
  name: 'Nova',
  birthDate: new Date('1997-04-04'),
  gender: 'female',
  termsVersion: '1.2',
  visibilityMode: 'visible' as const,
};
const interestsOf = async (userId: string) =>
  (await prisma.userInterest.findMany({ where: { userId }, include: { interest: true } }))
    .map((ui) => ui.interest.name)
    .sort();

beforeAll(async () => {
  await assertTestDatabase(prisma);
});

beforeEach(async () => {
  await resetAdminDb(prisma);
  // o banco de teste não tem o catálogo do seed: cria o mínimo (interests não tem FK pra users)
  for (const name of CATALOG) {
    await prisma.interest.upsert({
      where: { name },
      update: {},
      create: { name, category: 'lifestyle' },
    });
  }
  redis.kv.clear();
  jest.clearAllMocks();
});

afterAll(async () => {
  await resetAdminDb(prisma);
  await prisma.$disconnect();
});

describe('banco: gênero e faixa de idade', () => {
  it('Gender tem só as 3 opções (non_binary saiu)', async () => {
    const g = await prisma.$queryRaw<
      { v: string }[]
    >`SELECT unnest(enum_range(NULL::"Gender"))::text AS v`;
    expect(g.map((r) => r.v)).toEqual(['female', 'male', 'other']);
  });

  it('conta nova nasce sem limite de idade (18–99); o CHECK barra faixa inválida até por SQL direto', async () => {
    const { id } = await newUser(prisma, 'Ana');
    expect(await prisma.user.findUniqueOrThrow({ where: { id } })).toMatchObject({
      ageMin: 18,
      ageMax: 99,
    });
    for (const data of [
      { ageMin: 17 },
      { ageMax: 100 },
      { ageMin: 40, ageMax: 30 },
      // vão mínimo de 4 anos (migration 20261004000300_age_range_gap)
      { ageMin: 30, ageMax: 33 },
      { ageMin: 96 },
    ]) {
      await expect(prisma.user.update({ where: { id }, data })).rejects.toThrow();
    }
    await prisma.user.update({ where: { id }, data: { ageMin: 30, ageMax: 34 } });
  });
});

describe('cadastro (POST /auth/register): etapas novas', () => {
  it('grava bio, @ normalizado e os interesses do catálogo; completude conta bio e interesses', async () => {
    const phone = '+5534966610001';
    proof(phone);
    const r = await auth.register({
      ...signup,
      phone,
      name: '  Nova   Silva ',
      lookingFor: 'casual',
      bio: '  café coado e praia \n',
      instagram: '@Nova.Silva',
      interests: ['Música', 'Praia', 'Café', 'Música', 'Inventado'],
    });
    const u = await prisma.user.findUniqueOrThrow({ where: { id: r.user.id } });
    expect(u).toMatchObject({
      name: 'Nova Silva',
      bio: 'café coado e praia',
      instagramHandle: 'nova.silva',
      gender: 'female',
      // nome 10 + intenção 5 + bio 15 + 3 interesses 15
      profileCompleteness: 45,
    });
    expect(await interestsOf(r.user.id)).toEqual(['Café', 'Música', 'Praia']);
    const me = (await users.me(r.user.id)) as {
      bio: string;
      instagram: string;
      interests: string[];
    };
    expect(me.instagram).toBe('nova.silva');
    expect([...me.interests].sort()).toEqual(['Café', 'Música', 'Praia']);
  });

  it('pulou as etapas opcionais: sem bio, sem @, sem interesses', async () => {
    const phone = '+5534966610002';
    proof(phone);
    const r = await auth.register({ ...signup, phone, bio: '', instagram: '', interests: [] });
    const u = await prisma.user.findUniqueOrThrow({ where: { id: r.user.id } });
    expect(u).toMatchObject({ bio: null, instagramHandle: null, profileCompleteness: 10 });
    expect(await interestsOf(r.user.id)).toEqual([]);
  });

  it('@ inválido: 400 instagram_invalid, nenhuma conta e a prova do SMS continua valendo', async () => {
    const phone = '+5534966610003';
    proof(phone);
    expect(await errorOf(auth.register({ ...signup, phone, instagram: 'ana..souza' }))).toEqual({
      status: 400,
      error: 'instagram_invalid',
    });
    expect(await prisma.user.count({ where: { phone } })).toBe(0);
    // corrigiu e mandou de novo, sem pedir outro código
    const r = await auth.register({ ...signup, phone, instagram: 'ana.souza' });
    expect(r.user.id).toEqual(expect.any(String));
  });

  it('filtro de abuso na bio: 400 text_blocked, nenhuma conta e a prova do SMS continua valendo', async () => {
    const phone = '+5534966610005';
    proof(phone);
    expect(await errorOf(auth.register({ ...signup, phone, bio: 'vou te matar' }))).toEqual({
      status: 400,
      error: 'text_blocked',
      field: 'bio',
    });
    expect(await prisma.user.count({ where: { phone } })).toBe(0);
    const r = await auth.register({ ...signup, phone, bio: 'café e praia' });
    expect(r.user.id).toEqual(expect.any(String));
  });

  it('app antigo com "non_binary" grava "other"', async () => {
    const phone = '+5534966610004';
    proof(phone);
    const r = await auth.register({ ...signup, phone, gender: 'non_binary' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: r.user.id } })).gender).toBe(
      'other',
    );
  });
});

describe('PATCH /me: gênero, nome, bio e interesses', () => {
  it('troca o gênero (Mulher/Homem/Outro) e o /me devolve', async () => {
    const { id } = await newUser(prisma, 'Ana');
    const me = (await users.update(id, { gender: 'other' })) as { gender: string };
    expect(me.gender).toBe('other');
    expect(redis.invalidateProfile).toHaveBeenCalledWith(id); // caches da descoberta relêem o gênero
  });

  it('nome só com espaço ou 1 letra: 400 name_invalid e nada muda', async () => {
    const { id } = await newUser(prisma, 'Ana');
    for (const bad of ['   ', ' A ']) {
      expect(await errorOf(users.update(id, { name: bad }))).toEqual({
        status: 400,
        error: 'name_invalid',
      });
    }
    expect((await prisma.user.findUniqueOrThrow({ where: { id } })).name).toBe('Ana');
    const me = (await users.update(id, { name: '  Ana   Paula ' })) as { name: string };
    expect(me.name).toBe('Ana Paula');
  });

  it('filtro de abuso: nome/bio/@ recusados com 400 text_blocked e nada é gravado', async () => {
    const { id } = await newUser(prisma, 'Ana');
    await users.update(id, { bio: 'café e praia' });
    const cases: [Parameters<typeof users.update>[1], string][] = [
      [{ name: 'Caralho' }, 'name'],
      [{ bio: 'vou te matar', interests: ['Música'] }, 'bio'],
      [{ bio: 'me manda um pix' }, 'bio'],
    ];
    for (const [patch, field] of cases) {
      expect(await errorOf(users.update(id, patch))).toEqual({
        status: 400,
        error: 'text_blocked',
        field,
      });
    }
    const row = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ name: 'Ana', bio: 'café e praia' });
    expect(await interestsOf(id)).toEqual([]);
  });

  it('interesses: troca a lista inteira, ignora nome fora do catálogo; lista vazia apaga', async () => {
    const { id } = await newUser(prisma, 'Ana');
    await users.update(id, { interests: ['Música', 'Viagem'] });
    await users.update(id, { interests: ['Praia', 'Praia', 'Inventado'] });
    expect(await interestsOf(id)).toEqual(['Praia']);
    await users.update(id, { interests: [] });
    expect(await interestsOf(id)).toEqual([]);
  });

  it('bio vazia apaga e a completude recalcula', async () => {
    const { id } = await newUser(prisma, 'Ana');
    await users.update(id, { bio: 'oi, tudo bem?' });
    const withBio = (await prisma.user.findUniqueOrThrow({ where: { id } })).profileCompleteness;
    await users.update(id, { bio: '  ' });
    const row = await prisma.user.findUniqueOrThrow({ where: { id } });
    expect(row.bio).toBeNull();
    expect(row.profileCompleteness).toBe(withBio - 15);
  });
});

describe('PATCH /me/settings: faixa de idade do "quem ver"', () => {
  it('grava as duas pontas e o /me devolve; o topo "80+" é 99', async () => {
    const { id } = await newUser(prisma, 'Ana');
    await expect(users.updateSettings(id, { ageMin: 25, ageMax: 35 })).resolves.toMatchObject({
      ok: true,
      ageMin: 25,
      ageMax: 35,
    });
    expect(redis.invalidateProfile).toHaveBeenCalledWith(id);
    const me = (await users.me(id)) as { settings: Record<string, unknown> };
    expect(me.settings).toMatchObject({ ageMin: 25, ageMax: 35 });
    await users.updateSettings(id, { ageMax: 99 });
    expect(await prisma.user.findUniqueOrThrow({ where: { id } })).toMatchObject({
      ageMin: 25,
      ageMax: 99,
    });
  });

  it('fora da regra: 400 age_range_invalid (nunca 500) e nada é gravado, nem os outros campos', async () => {
    const { id } = await newUser(prisma, 'Ana');
    for (const bad of [
      { ageMin: 17, ageMax: 30 },
      { ageMin: 40, ageMax: 30 },
      { ageMin: 20, ageMax: 100 },
      { ageMin: 10 },
      { ageMax: 120 },
      // vão menor que 4 anos
      { ageMin: 30, ageMax: 33 },
      { ageMin: 30, ageMax: 30 },
    ]) {
      expect(await errorOf(users.updateSettings(id, { ...bad, showMe: 'men' }))).toEqual({
        status: 400,
        error: 'age_range_invalid',
      });
    }
    expect(await prisma.user.findUniqueOrThrow({ where: { id } })).toMatchObject({
      ageMin: 18,
      ageMax: 99,
      showMe: 'everyone',
    });
  });

  it('uma ponta só, contra a outra que está no banco: "de" a menos de 4 anos do "até" gravado é recusado', async () => {
    const { id } = await newUser(prisma, 'Ana', { ageMin: 20, ageMax: 30 });
    for (const bad of [{ ageMin: 35 }, { ageMin: 27 }, { ageMax: 19 }, { ageMax: 23 }]) {
      expect(await errorOf(users.updateSettings(id, bad))).toEqual({
        status: 400,
        error: 'age_range_invalid',
      });
    }
    await users.updateSettings(id, { ageMin: 26 });
    await users.updateSettings(id, { ageMax: 45 });
    expect(await prisma.user.findUniqueOrThrow({ where: { id } })).toMatchObject({
      ageMin: 26,
      ageMax: 45,
    });
  });

  it('até 5 mudanças por dia: a 6ª leva 429 age_range_limit e nada é gravado; igual ao gravado não conta', async () => {
    const { id } = await newUser(prisma, 'Ana');
    // recusadas por regra não gastam
    await errorOf(users.updateSettings(id, { ageMin: 30, ageMax: 31 }));
    for (let i = 0; i < 5; i++) await users.updateSettings(id, { ageMin: 20 + i, ageMax: 40 });
    // mandar o que já está gravado não gasta
    await users.updateSettings(id, { ageMin: 24, ageMax: 40 });
    await users.updateSettings(id, { ageMax: 40, showMe: 'men' });
    const e = await errorOf(users.updateSettings(id, { ageMin: 30, ageMax: 40, showMe: 'women' }));
    expect(e).toEqual({ status: 429, error: 'age_range_limit' });
    // nada da 6ª gravou (nem os outros campos)
    expect(await prisma.user.findUniqueOrThrow({ where: { id } })).toMatchObject({
      ageMin: 24,
      ageMax: 40,
      showMe: 'men',
    });
    // outras opções continuam liberadas
    await expect(users.updateSettings(id, { showMe: 'everyone' })).resolves.toMatchObject({
      ok: true,
    });
  });
});

describe('GET /interests (público: o cadastro pede antes da conta existir)', () => {
  it('devolve id, nome, ícone e categoria em ordem de nome', async () => {
    const list = await users.listInterests();
    const ours = list.map((i) => i.name).filter((n) => CATALOG.includes(n));
    expect(ours).toEqual(['Café', 'Música', 'Praia', 'Viagem']);
    expect(Object.keys(list[0]).sort()).toEqual(['category', 'icon', 'id', 'name']);
  });
});
