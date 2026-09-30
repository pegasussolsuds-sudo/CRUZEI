import { PrismaClient } from '@prisma/client';

import type { PrismaService } from '../../src/database/prisma.service';
import { InboxService } from '../../src/modules/inbox/inbox.service';
import { LikesService } from '../../src/modules/likes/likes.service';
import { superLikeDay } from '../../src/modules/likes/super-like-quota';
import type { PhotoModerationService } from '../../src/modules/moderation/photo-moderation.service';
import { UsersService } from '../../src/modules/users/users.service';
import type { ChatGateway } from '../../src/realtime/chat.gateway';
import type { RedisService } from '../../src/redis/redis.service';
import { PassesCleanupTask } from '../../src/tasks/passes-cleanup.task';

import { assertTestDatabase } from './env';

// Deck de curtidas contra o banco de TESTE: limite diário da super curtida (super_like_uses, dia de São Paulo, plano
// efetivo, gasto atômico), "Passar" salvo na tabela passes (renova o prazo, "Voltar" apaga, nada no audit_log) e a
// limpeza de madrugada. LikesService + InboxService de verdade; Redis em memória e gateway que só grava.
// Recriar o banco: pnpm test:db:setup

const prisma = new PrismaClient();
const db = prisma as unknown as PrismaService;

/** Redis em memória: limite anti-abuso (incrRate/decr) e o cache do /me */
function makeRedis() {
  const kv = new Map<string, string>();
  const client = {
    get: async (k: string) => kv.get(k) ?? null,
    set: async (k: string, v: string | number, ...opts: unknown[]) => {
      if (opts.includes('NX') && kv.has(k)) return null;
      kv.set(k, String(v));
      return 'OK';
    },
    del: async (...keys: string[]) => keys.filter((k) => kv.delete(k)).length,
    incr: async (k: string) => {
      const n = Number(kv.get(k) ?? 0) + 1;
      kv.set(k, String(n));
      return n;
    },
    decr: async (k: string) => {
      const n = Number(kv.get(k) ?? 0) - 1;
      kv.set(k, String(n));
      return n;
    },
    expire: async () => 1,
    publish: async () => 0,
  };
  return {
    kv,
    client,
    incrRate: async (userId: string, action: string) => client.incr(`rate:${userId}:${action}`),
    invalidateProfile: jest.fn(async (_id: string) => undefined),
    getCachedProfile: async () => null,
    cacheProfile: jest.fn(async () => undefined),
    markPresenceHidden: async () => undefined,
    publishCandidateInvalidation: async () => undefined,
  };
}

let redis: ReturnType<typeof makeRedis>;
let likes: LikesService;
let users: UsersService;
const task = new PassesCleanupTask(db);

function build() {
  redis = makeRedis();
  const gw = {
    emitToUser: () => undefined,
    emitToUsers: () => undefined,
    removeFromConversation: () => undefined,
    leaveAllConversations: async () => undefined,
  } as unknown as ChatGateway;
  const r = redis as unknown as RedisService;
  const inbox = new InboxService(db, r, gw);
  likes = new LikesService(db, r, gw, inbox);
  users = new UsersService(db, r, {} as PhotoModerationService, gw);
}

const resetDb = () =>
  prisma.$executeRawUnsafe('TRUNCATE conversations, users RESTART IDENTITY CASCADE');

async function newUser(name: string, extra: Record<string, unknown> = {}): Promise<string> {
  const u = await prisma.user.create({
    data: {
      name,
      birthDate: new Date('1996-03-12'),
      gender: 'female',
      visibilityMode: 'visible',
      ...extra,
    } as never,
    select: { id: true },
  });
  return u.id;
}

const DAY = 86_400_000;
const premium = { premiumTier: 'premium', premiumExpiresAt: new Date(Date.now() + 10 * DAY) };

/** a promessa falha com 403 super_like_limit; devolve o corpo */
async function limitError(p: Promise<unknown>): Promise<Record<string, unknown>> {
  const err = (await p.then(
    () => null,
    (e: unknown) => e,
  )) as { getStatus?: () => number; getResponse?: () => unknown } | null;
  expect(err?.getStatus?.()).toBe(403);
  const body = err!.getResponse!() as Record<string, unknown>;
  expect(body.error).toBe('super_like_limit');
  return body;
}

const usesOf = async (userId: string) => {
  const rows = await prisma.$queryRaw<{ day: string; used: number }[]>`
    SELECT to_char(day, 'YYYY-MM-DD') AS day, used FROM super_like_uses WHERE user_id = ${userId}::uuid ORDER BY day`;
  return rows.map((r) => ({ day: r.day, used: Number(r.used) }));
};
const superLikesBy = (likerId: string) => prisma.like.count({ where: { likerId, isSuper: true } });
const passesOf = async (userId: string) =>
  (await prisma.pass.findMany({ where: { userId }, select: { targetId: true } }))
    .map((p) => p.targetId)
    .sort();

beforeAll(async () => {
  await assertTestDatabase(prisma);
});

beforeEach(async () => {
  await resetDb();
  build();
});

afterAll(async () => {
  await resetDb();
  await prisma.$disconnect();
});

// =================================================================================================
describe('super curtida: limite por dia (grátis 1, Premium e Premium+ 7)', () => {
  it('grátis: a 1ª passa; a 2ª é 403 com convite pro Premium, nada gravado e sem gastar o limite anti-abuso', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    const cris = await newUser('Cris');

    const r = await likes.like(ana, bia, true);
    expect(r).toMatchObject({ likeStatus: 'SENT', superLikesRemainingToday: 0 });
    expect(await usesOf(ana)).toEqual([{ day: superLikeDay(), used: 1 }]);
    // o /me de quem mandou atualiza (stats.superLikesRemainingToday)
    expect(redis.invalidateProfile).toHaveBeenCalledWith(ana);

    const body = await limitError(likes.like(ana, cris, true));
    expect(body).toMatchObject({ limit: 1, canUpgrade: true });
    expect(new Date(String(body.resetsAt)).getTime()).toBeGreaterThan(Date.now());
    expect(await superLikesBy(ana)).toBe(1);
    expect(await prisma.like.count({ where: { likerId: ana, likedId: cris } })).toBe(0);
    expect(await redis.client.get(`rate:${ana}:like`)).toBe('1');

    // curtida normal continua liberada
    expect((await likes.like(ana, cris)).likeStatus).toBe('SENT');

    expect(await likes.superQuota(ana)).toMatchObject({
      tier: 'free',
      limit: 1,
      used: 1,
      remaining: 0,
    });
  });

  it('Premium: 7 por dia e a 8ª é 403 sem convite; Premium vencido conta como grátis', async () => {
    const ana = await newUser('Ana', premium);
    const alvos = await Promise.all(Array.from({ length: 8 }, (_, i) => newUser(`Alvo${i}`)));
    for (let i = 0; i < 7; i++) {
      const r = await likes.like(ana, alvos[i], true);
      expect(r.superLikesRemainingToday).toBe(6 - i);
    }
    expect(await limitError(likes.like(ana, alvos[7], true))).toMatchObject({
      limit: 7,
      canUpgrade: false,
    });
    expect(await usesOf(ana)).toEqual([{ day: superLikeDay(), used: 7 }]);

    const duda = await newUser('Duda', {
      premiumTier: 'premium_plus',
      premiumExpiresAt: new Date(Date.now() - 1_000),
    });
    await likes.like(duda, alvos[0], true);
    expect(await limitError(likes.like(duda, alvos[1], true))).toMatchObject({
      limit: 1,
      canUpgrade: true,
    });
    expect(await likes.superQuota(duda)).toMatchObject({ tier: 'free', remaining: 0 });
  });

  it('desfazer a curtida NÃO devolve o uso; repetir a super pra quem eu já curti não gasta', async () => {
    const ana = await newUser('Ana', premium);
    const bia = await newUser('Bia');

    expect((await likes.like(ana, bia, true)).superLikesRemainingToday).toBe(6);
    // toque duplo / deck recarregado: devolve o estado, sem gastar
    await likes.like(ana, bia, true);
    expect(await usesOf(ana)).toEqual([{ day: superLikeDay(), used: 1 }]);

    await likes.unlike(ana, bia);
    expect((await likes.superQuota(ana)).used).toBe(1);
    expect((await likes.like(ana, bia, true)).superLikesRemainingToday).toBe(5);
  });

  it('corrida: 5 super curtidas ao mesmo tempo no grátis → só 1 passa (gasto atômico)', async () => {
    const ana = await newUser('Ana');
    const alvos = await Promise.all(['B', 'C', 'D', 'E', 'F'].map((n) => newUser(n)));
    const out = await Promise.allSettled(alvos.map((id) => likes.like(ana, id, true)));
    expect(out.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    for (const o of out.filter((x): x is PromiseRejectedResult => x.status === 'rejected')) {
      expect((o.reason as { getResponse(): { error: string } }).getResponse().error).toBe(
        'super_like_limit',
      );
    }
    expect(await superLikesBy(ana)).toBe(1);
    expect(await usesOf(ana)).toEqual([{ day: superLikeDay(), used: 1 }]);
    // quem perdeu a corrida dentro da transação devolveu o limite anti-abuso
    expect(Number(await redis.client.get(`rate:${ana}:like`))).toBe(1);
  });

  it('o dia é o de São Paulo: o uso de ontem não conta hoje', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    const ontem = superLikeDay(new Date(Date.now() - DAY));
    await prisma.$executeRaw`INSERT INTO super_like_uses (user_id, day, used) VALUES (${ana}::uuid, ${ontem}::date, 1)`;
    expect((await likes.superQuota(ana)).remaining).toBe(1);
    expect((await likes.like(ana, bia, true)).superLikesRemainingToday).toBe(0);
    expect(await usesOf(ana)).toEqual([
      { day: ontem, used: 1 },
      { day: superLikeDay(), used: 1 },
    ]);
  });

  it('o /me mostra as super curtidas de hoje (usadas, restantes e o limite do plano)', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    const before = (await users.me(ana)) as { stats: Record<string, number> };
    expect(before.stats).toMatchObject({
      superLikesToday: 0,
      superLikesRemainingToday: 1,
      superLikeDailyLimit: 1,
    });
    await likes.like(ana, bia, true);
    const after = (await users.me(ana)) as { stats: Record<string, number> };
    expect(after.stats).toMatchObject({
      superLikesToday: 1,
      superLikesRemainingToday: 0,
      superLikeDailyLimit: 1,
    });

    const cris = await newUser('Cris', premium);
    const plus = (await users.me(cris)) as { stats: Record<string, number> };
    expect(plus.stats).toMatchObject({ superLikesRemainingToday: 7, superLikeDailyLimit: 7 });
  });
});

// =================================================================================================
describe('"Passar" salvo (tabela passes) e "Voltar"', () => {
  it('passar grava em passes e NÃO no audit_log; passar de novo renova o prazo', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    await likes.pass(ana, bia);
    expect(await passesOf(ana)).toEqual([bia]);

    // envelhece o passar e passa de novo: o prazo recomeça agora
    await prisma.$executeRaw`UPDATE passes SET created_at = now() - interval '10 days' WHERE user_id = ${ana}::uuid`;
    await likes.pass(ana, bia);
    const row = await prisma.pass.findUniqueOrThrow({
      where: { userId_targetId: { userId: ana, targetId: bia } },
    });
    expect(Math.abs(row.createdAt.getTime() - Date.now())).toBeLessThan(60_000);
    expect(await prisma.pass.count()).toBe(1);

    expect(await prisma.auditLog.count({ where: { action: 'pass' } })).toBe(0);
  });

  it('"Voltar" apaga só ESSE passar, o meu último (idempotente)', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    const cris = await newUser('Cris');
    await likes.pass(ana, cris);
    await likes.pass(ana, bia);
    await likes.pass(bia, cris); // de outra pessoa: não mexe (nem conta como "último" da Ana)
    await likes.unpass(ana, bia);
    expect(await passesOf(ana)).toEqual([cris]);
    await likes.unpass(ana, bia);
    expect(await passesOf(ana)).toEqual([cris]);
    expect(await passesOf(bia)).toEqual([cris]);
  });

  it('"Voltar" de passar que não é o último ou mais velho que 10 min: 409 e o passar fica', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    const cris = await newUser('Cris');
    await likes.pass(ana, bia);
    await likes.pass(ana, cris);
    await expect(likes.unpass(ana, bia)).rejects.toMatchObject({ status: 409 });
    expect(await passesOf(ana)).toEqual([bia, cris].sort());
    // o último, mas velho
    await prisma.$executeRaw`UPDATE passes SET created_at = now() - interval '11 minutes' WHERE user_id = ${ana}::uuid AND target_id = ${cris}::uuid`;
    await prisma.$executeRaw`UPDATE passes SET created_at = now() - interval '12 minutes' WHERE user_id = ${ana}::uuid AND target_id = ${bia}::uuid`;
    await expect(likes.unpass(ana, cris)).rejects.toMatchObject({ status: 409 });
    expect(await passesOf(ana)).toEqual([bia, cris].sort());
  });

  it('id que não existe não grava nada nem dá erro; passar a si mesmo é 400', async () => {
    const ana = await newUser('Ana');
    await likes.pass(ana, '00000000-0000-4000-8000-000000000000');
    expect(await prisma.pass.count()).toBe(0);
    await expect(likes.pass(ana, ana)).rejects.toMatchObject({ status: 400 });
  });
});

// =================================================================================================
describe('limpeza de madrugada (PassesCleanupTask)', () => {
  it('apaga os passes vencidos e mantém os que ainda valem', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    const cris = await newUser('Cris');
    await likes.pass(ana, bia);
    await likes.pass(ana, cris);
    await prisma.$executeRaw`UPDATE passes SET created_at = now() - interval '31 days' WHERE target_id = ${bia}::uuid`;
    await prisma.$executeRaw`UPDATE passes SET created_at = now() - interval '29 days' WHERE target_id = ${cris}::uuid`;

    expect(await task.purgeExpiredPasses(new Date(), 30)).toBe(1);
    expect(await passesOf(ana)).toEqual([cris]);
    expect(await task.purgeExpiredPasses(new Date(), 30)).toBe(0);
  });

  it('apaga os contadores de super curtida de mais de 7 dias (o de hoje fica)', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    await likes.like(ana, bia, true);
    const d10 = superLikeDay(new Date(Date.now() - 10 * DAY));
    const d3 = superLikeDay(new Date(Date.now() - 3 * DAY));
    await prisma.$executeRaw`INSERT INTO super_like_uses (user_id, day, used) VALUES (${ana}::uuid, ${d10}::date, 1), (${ana}::uuid, ${d3}::date, 1)`;

    expect(await task.purgeOldSuperLikeUses()).toBe(1);
    expect((await usesOf(ana)).map((u) => u.day)).toEqual([d3, superLikeDay()]);
    // o uso de hoje continua valendo
    expect((await likes.superQuota(ana)).remaining).toBe(0);
  });
});
