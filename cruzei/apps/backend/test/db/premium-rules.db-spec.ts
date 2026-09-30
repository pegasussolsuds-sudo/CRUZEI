import { PrismaClient } from '@prisma/client';

import { phoneHash } from '../../src/common/phone-hash';
import type { PrismaService } from '../../src/database/prisma.service';
import { AnonymousService } from '../../src/modules/anonymous/anonymous.service';
import type { PhotoModerationService } from '../../src/modules/moderation/photo-moderation.service';
import {
  ANONYMOUS_EXPIRED_TEXT,
  PREMIUM_EXPIRED_TEXT,
  PremiumLifecycleService,
  openAnonWindowOnDowngrade,
} from '../../src/modules/subscriptions/premium-lifecycle.service';
import { PremiumTask } from '../../src/modules/subscriptions/premium.task';
import { SubscriptionsService } from '../../src/modules/subscriptions/subscriptions.service';
import { UsersService } from '../../src/modules/users/users.service';

import {
  asGateway,
  asRedis,
  emittedTo,
  fakeGateway,
  fakePush,
  fakeRedis,
  newUser,
  notifyStack,
} from './admin-fakes';
import { assertTestDatabase } from './env';

// Regras do Premium (decisão 8 do dono) contra o banco de TESTE: prazo do invisível grátis no banco (PATCH repetido
// não estende, religa quando quiser, /anonymous/enable igual, /me), a tarefa periódica (fim do invisível, rebaixamento
// do vencido com 24 h pra quem está invisível, avisos) e o teste grátis uma vez por conta E por número.
// Recriar o banco: bash test/db/setup-test-db.sh

const prisma = new PrismaClient();
const db = prisma as unknown as PrismaService;
const redis = fakeRedis();
const gateway = fakeGateway();
const push = fakePush();
const { notify } = notifyStack(prisma, gateway, push.transport);
const users = new UsersService(
  db,
  asRedis(redis),
  {} as PhotoModerationService,
  asGateway(gateway),
);
const lifecycle = new PremiumLifecycleService(
  db,
  asRedis(redis),
  users,
  asGateway(gateway),
  notify,
);
const subs = new SubscriptionsService(db, asRedis(redis), lifecycle);
const anonymous = new AnonymousService(db, users);
const task = new PremiumTask(lifecycle, asRedis(redis));

const H = 3_600_000;
const DAY = 24 * H;
/** relógio do container x do Node: 1 min de folga */
const near = (d: Date | string | null | undefined, expectedMs: number, tol = 60_000) => {
  expect(d).toBeTruthy();
  expect(Math.abs(new Date(d as Date | string).getTime() - expectedMs)).toBeLessThan(tol);
};
const row = (id: string) => prisma.user.findUniqueOrThrow({ where: { id } });
const notesOf = (userId: string) =>
  prisma.notification.findMany({ where: { userId }, orderBy: { sentAt: 'asc' } });
const past = (ms: number) => new Date(Date.now() - ms);
const future = (ms: number) => new Date(Date.now() + ms);

const resetDb = () =>
  prisma.$executeRawUnsafe('TRUNCATE users, trial_claims RESTART IDENTITY CASCADE');

beforeAll(async () => {
  await assertTestDatabase(prisma);
});

beforeEach(async () => {
  await resetDb();
  jest.clearAllMocks();
  push.sent.length = 0;
});

afterAll(async () => {
  await resetDb();
  await prisma.$disconnect();
});

describe('invisível grátis: prazo no banco (users.anonymous_until)', () => {
  it('PATCH anonymous grava 24 h e tira das salas; PATCH repetido NÃO estende', async () => {
    const { id } = await newUser(prisma, 'Ana');
    const r1 = await users.updateSettings(id, { visibilityMode: 'anonymous' });
    near(r1.anonymousUntil, Date.now() + DAY);
    const u1 = await row(id);
    expect(u1.visibilityMode).toBe('anonymous');
    expect(u1.anonymousUntil?.toISOString()).toBe(r1.anonymousUntil);
    expect(gateway.leaveAllConversations).toHaveBeenCalledWith(id);

    // o app mandando o modo de novo junto com outro ajuste: mesmo prazo, e o outro ajuste grava
    const r2 = await users.updateSettings(id, { visibilityMode: 'anonymous', showAge: false });
    expect(r2.anonymousUntil).toBe(r1.anonymousUntil);
    const u2 = await row(id);
    expect(u2.anonymousUntil?.toISOString()).toBe(r1.anonymousUntil);
    expect(u2.showAge).toBe(false);
  });

  it('pode religar quando quiser: desligar zera o prazo e religar abre 24 h novas na hora', async () => {
    const { id } = await newUser(prisma, 'Bia', {
      visibilityMode: 'anonymous',
      anonymousUntil: future(H),
    });
    const off = await users.updateSettings(id, { visibilityMode: 'visible' });
    expect(off.anonymousUntil).toBeNull();
    expect(await row(id)).toMatchObject({ visibilityMode: 'visible', anonymousUntil: null });

    const on = await users.updateSettings(id, { visibilityMode: 'anonymous' });
    near(on.anonymousUntil, Date.now() + DAY);
  });

  it('Premium vigente: invisível sem prazo e continua nas conversas', async () => {
    const { id } = await newUser(prisma, 'Carla', {
      premiumTier: 'premium',
      premiumExpiresAt: future(10 * DAY),
    });
    const r = await users.updateSettings(id, { visibilityMode: 'anonymous' });
    expect(r.anonymousUntil).toBeNull();
    expect((await row(id)).anonymousUntil).toBeNull();
    expect(gateway.leaveAllConversations).not.toHaveBeenCalled();
    const me = (await users.me(id)) as {
      settings: { anonymousUntil: string | null; visibilityMode: string };
    };
    expect(me.settings).toMatchObject({ visibilityMode: 'anonymous', anonymousUntil: null });
  });

  it('Premium vencido (a tarefa ainda não passou) conta como grátis: ganha prazo', async () => {
    const { id } = await newUser(prisma, 'Duda', {
      premiumTier: 'premium',
      premiumExpiresAt: past(H),
    });
    const r = await users.updateSettings(id, { visibilityMode: 'anonymous' });
    near(r.anonymousUntil, Date.now() + DAY);
    expect(gateway.leaveAllConversations).toHaveBeenCalledWith(id);
  });

  it('POST /anonymous/enable|disable aplica a MESMA regra (antes não gravava prazo nenhum)', async () => {
    const { id } = await newUser(prisma, 'Eva');
    const on = await anonymous.enable(id);
    near(on.anonymousUntil, Date.now() + DAY);
    expect(on.expiresAt).toBe(on.anonymousUntil);
    expect((await row(id)).anonymousUntil?.toISOString()).toBe(on.anonymousUntil);
    expect((await anonymous.enable(id)).anonymousUntil).toBe(on.anonymousUntil); // repetido não estende
    expect(await anonymous.getLimits(id)).toEqual({
      unlimited: false,
      isActive: true,
      anonymousUntil: on.anonymousUntil,
    });

    await anonymous.disable(id);
    expect(await row(id)).toMatchObject({ visibilityMode: 'visible', anonymousUntil: null });
  });

  it('/me mostra o prazo; janela vencida volta ao visível na leitura; invisível sem prazo ganha as 24 h', async () => {
    const { id } = await newUser(prisma, 'Fê');
    const on = await users.updateSettings(id, { visibilityMode: 'anonymous' });
    const me1 = (await users.me(id)) as { settings: { anonymousUntil: string | null } };
    expect(me1.settings.anonymousUntil).toBe(on.anonymousUntil);

    await prisma.user.update({ where: { id }, data: { anonymousUntil: past(60_000) } });
    const me2 = (await users.me(id)) as {
      settings: { anonymousUntil: string | null; visibilityMode: string };
    };
    expect(me2.settings).toMatchObject({ visibilityMode: 'visible', anonymousUntil: null });
    expect(await row(id)).toMatchObject({ visibilityMode: 'visible', anonymousUntil: null });

    const { id: old } = await newUser(prisma, 'Gi', {
      visibilityMode: 'anonymous',
      anonymousUntil: null,
    });
    const me3 = (await users.me(old)) as {
      settings: { anonymousUntil: string | null; visibilityMode: string };
    };
    expect(me3.settings.visibilityMode).toBe('anonymous');
    near(me3.settings.anonymousUntil, Date.now() + DAY);
  });

  it('/me de Premium vencido e invisível (sem rebaixar ainda) NÃO devolve ao mapa: espera o rebaixamento', async () => {
    const { id } = await newUser(prisma, 'Helô', {
      premiumTier: 'premium',
      premiumExpiresAt: past(H),
      visibilityMode: 'anonymous',
      anonymousUntil: past(5 * DAY), // janela grátis antiga, de antes de assinar
    });
    const me = (await users.me(id)) as {
      premiumTier: string;
      settings: { visibilityMode: string };
    };
    expect(me.premiumTier).toBe('free');
    expect(me.settings.visibilityMode).toBe('anonymous');
    expect((await row(id)).visibilityMode).toBe('anonymous');
  });

  it('conta nova nasce VISÍVEL (default do banco)', async () => {
    const u = await prisma.user.create({
      data: { name: 'Nova', birthDate: new Date('1998-01-01'), gender: 'female' },
    });
    expect(u).toMatchObject({ visibilityMode: 'visible', anonymousUntil: null, trialUsedAt: null });
  });
});

describe('tarefa periódica (PremiumTask → PremiumLifecycleService)', () => {
  it('fim da janela grátis: volta ao visível, socket visibility e aviso anonymous_expired (central + push)', async () => {
    const a = await newUser(prisma, 'Ana', {
      visibilityMode: 'anonymous',
      anonymousUntil: past(60_000),
    });
    const b = await newUser(prisma, 'Bia', {
      visibilityMode: 'anonymous',
      anonymousUntil: future(H),
    });
    // Premium vigente com uma janela grátis velha gravada: não é afetado
    const c = await newUser(prisma, 'Carla', {
      visibilityMode: 'anonymous',
      anonymousUntil: past(H),
      premiumTier: 'premium_plus',
      premiumExpiresAt: null,
    });
    await prisma.deviceToken.create({
      data: { userId: a.id, token: 'tok-ana', platform: 'android' },
    });

    expect(await lifecycle.expireFreeAnonymous()).toEqual([a.id]);
    expect(await row(a.id)).toMatchObject({ visibilityMode: 'visible', anonymousUntil: null });
    expect((await row(b.id)).visibilityMode).toBe('anonymous');
    expect((await row(c.id)).visibilityMode).toBe('anonymous');

    expect(emittedTo(gateway, a.id, 'account:changed')).toEqual([
      { event: 'account:changed', payload: { reason: 'visibility' } },
    ]);
    expect(redis.invalidateProfile).toHaveBeenCalledWith(a.id);
    const [n] = await notesOf(a.id);
    expect(n).toMatchObject({
      type: 'anonymous_expired',
      title: ANONYMOUS_EXPIRED_TEXT.title,
      body: ANONYMOUS_EXPIRED_TEXT.body,
    });
    expect((n.data as { target: unknown }).target).toEqual({ kind: 'map' });
    expect(push.sent.map((m) => m.payload.title)).toEqual([ANONYMOUS_EXPIRED_TEXT.title]);
    expect(await notesOf(b.id)).toHaveLength(0);
    expect(await notesOf(c.id)).toHaveLength(0);

    // de novo: ninguém mais
    expect(await lifecycle.expireFreeAnonymous()).toEqual([]);
  });

  it('fim da janela com o perfil PAUSADO: volta a visible, mas sem o aviso "voltou pro mapa" (segue fora dele)', async () => {
    const paused = await newUser(prisma, 'Pausada', {
      visibilityMode: 'anonymous',
      anonymousUntil: past(60_000),
      isPaused: true,
      pausedUntil: future(DAY),
    });
    const forever = await newUser(prisma, 'Pausada sem prazo', {
      visibilityMode: 'anonymous',
      anonymousUntil: past(60_000),
      isPaused: true,
      pausedUntil: null,
    });
    // pausa vencida que a limpeza ainda não tirou: volta pro mapa de verdade, então avisa
    const stale = await newUser(prisma, 'Pausa vencida', {
      visibilityMode: 'anonymous',
      anonymousUntil: past(60_000),
      isPaused: true,
      pausedUntil: past(60_000),
    });

    expect((await lifecycle.expireFreeAnonymous()).sort()).toEqual(
      [paused.id, forever.id, stale.id].sort(),
    );
    for (const id of [paused.id, forever.id]) {
      // visível no banco (as conversas destravam), pausa intacta, sem aviso nem push
      expect(await row(id)).toMatchObject({
        visibilityMode: 'visible',
        anonymousUntil: null,
        isPaused: true,
      });
      expect(await notesOf(id)).toHaveLength(0);
      expect(redis.invalidateProfile).toHaveBeenCalledWith(id);
      expect(emittedTo(gateway, id, 'account:changed')).toEqual([
        { event: 'account:changed', payload: { reason: 'visibility' } },
      ]);
    }
    expect((await row(paused.id)).pausedUntil).not.toBeNull();
    expect(await notesOf(stale.id)).toMatchObject([
      { type: 'anonymous_expired', body: ANONYMOUS_EXPIRED_TEXT.body },
    ]);
  });

  it('Premium vencido: rebaixa, avatar free, invisível ganha 24 h (não aparece de surpresa), aviso premium_expired', async () => {
    const avatarSpy = jest.spyOn(users, 'downgradeAvatarToFree');
    const expiredAt = past(2 * H);
    const vis = await newUser(prisma, 'Vis', {
      premiumTier: 'premium',
      premiumExpiresAt: expiredAt,
    });
    const anon = await newUser(prisma, 'Anon', {
      premiumTier: 'premium_plus',
      premiumExpiresAt: past(H),
      visibilityMode: 'anonymous',
      anonymousUntil: past(3 * DAY), // janela velha: sem a ordem certa, a tarefa o jogaria no mapa
    });
    const valid = await newUser(prisma, 'Vigente', {
      premiumTier: 'premium',
      premiumExpiresAt: future(DAY),
    });
    const forever = await newUser(prisma, 'Sem prazo', {
      premiumTier: 'premium',
      premiumExpiresAt: null,
      visibilityMode: 'anonymous',
    });
    const released = await newUser(prisma, 'Liberada', {
      premiumTier: 'premium',
      premiumExpiresAt: past(H),
      phone: null,
      phoneReleasedAt: past(H),
    });

    await task.tick();

    const v = await row(vis.id);
    expect(v).toMatchObject({
      premiumTier: 'free',
      visibilityMode: 'visible',
      anonymousUntil: null,
    });
    expect(v.premiumExpiresAt?.getTime()).toBe(expiredAt.getTime()); // fica como histórico
    const a = await row(anon.id);
    expect(a).toMatchObject({ premiumTier: 'free', visibilityMode: 'anonymous' });
    near(a.anonymousUntil, Date.now() + DAY);
    expect(await row(valid.id)).toMatchObject({ premiumTier: 'premium' });
    expect(await row(forever.id)).toMatchObject({
      premiumTier: 'premium',
      visibilityMode: 'anonymous',
      anonymousUntil: null,
    });
    expect((await row(released.id)).premiumTier).toBe('free');

    const touched = avatarSpy.mock.calls.map((c) => c[0]).sort();
    expect(touched).toEqual([vis.id, anon.id, released.id].sort());
    expect(gateway.leaveAllConversations).toHaveBeenCalledTimes(1);
    expect(gateway.leaveAllConversations).toHaveBeenCalledWith(anon.id);
    for (const id of [vis.id, anon.id, released.id]) {
      expect(emittedTo(gateway, id, 'account:changed')).toEqual([
        { event: 'account:changed', payload: { reason: 'premium_expired' } },
      ]);
    }

    expect(await notesOf(vis.id)).toMatchObject([
      {
        type: 'premium_expired',
        title: PREMIUM_EXPIRED_TEXT.title,
        body: PREMIUM_EXPIRED_TEXT.visible,
      },
    ]);
    expect(await notesOf(anon.id)).toMatchObject([
      { type: 'premium_expired', body: PREMIUM_EXPIRED_TEXT.anonymous },
    ]);
    expect(await notesOf(valid.id)).toHaveLength(0);
    expect(await notesOf(released.id)).toHaveLength(0); // conta antiga de número reciclado não é avisada
    avatarSpy.mockRestore();
  });

  it('invisível grátis sem prazo gravado (caminho antigo) ganha a janela, sem aviso', async () => {
    const { id } = await newUser(prisma, 'Legado', {
      visibilityMode: 'anonymous',
      anonymousUntil: null,
    });
    expect(await lifecycle.openMissingWindows()).toBe(1);
    near((await row(id)).anonymousUntil, Date.now() + DAY);
    expect(await notesOf(id)).toHaveLength(0);
  });

  it('dois processos ao mesmo tempo: cada pessoa é rebaixada e avisada uma vez só', async () => {
    const ids = await Promise.all(
      ['A', 'B', 'C'].map(
        async (n) =>
          (await newUser(prisma, n, { premiumTier: 'premium', premiumExpiresAt: past(H) })).id,
      ),
    );
    const [r1, r2] = await Promise.all([
      lifecycle.downgradeExpired(),
      lifecycle.downgradeExpired(),
    ]);
    expect(r1.length + r2.length).toBe(3);
    for (const id of ids) expect(await notesOf(id)).toHaveLength(1);
  });

  it('GET /premium/status de quem venceu rebaixa na hora pela mesma rotina (aviso e janela)', async () => {
    const { id } = await newUser(prisma, 'Status', {
      premiumTier: 'premium',
      premiumExpiresAt: past(H),
      visibilityMode: 'anonymous',
    });
    const st = await subs.getStatus(id);
    expect(st).toMatchObject({
      tier: 'free',
      daysRemaining: 0,
      trialActive: false,
      trialEndsAt: null,
    });
    const u = await row(id);
    expect(u.premiumTier).toBe('free');
    near(u.anonymousUntil, Date.now() + DAY);
    expect(await notesOf(id)).toMatchObject([{ type: 'premium_expired' }]);
  });

  it('Premium tirado no painel com a pessoa invisível: mesma janela de 24 h (openAnonWindowOnDowngrade)', async () => {
    const anon = await newUser(prisma, 'Anon', {
      visibilityMode: 'anonymous',
      premiumTier: 'premium',
    });
    const vis = await newUser(prisma, 'Vis', { premiumTier: 'premium' });
    near(await openAnonWindowOnDowngrade(prisma, anon.id), Date.now() + DAY);
    expect(await openAnonWindowOnDowngrade(prisma, vis.id)).toBeNull();
    expect((await row(vis.id)).anonymousUntil).toBeNull();
  });
});

describe('teste grátis: uma vez por conta E por número', () => {
  const monthlyTrial = async (userId: string) =>
    (await subs.listPlans(userId)).plans.find((p) => p.id === 'premium_monthly')?.trialDays;

  it('1ª assinatura do mensal: 7 dias de teste, marca a conta e o número (hash, nunca o número)', async () => {
    const u = await newUser(prisma, 'Ana');
    expect(await monthlyTrial(u.id)).toBe(7);
    expect((await subs.getStatus(u.id)).trialEligible).toBe(true);

    const r = await subs.subscribe(u.id, 'premium_monthly', 'android', 'dev');
    expect(r.trialActive).toBe(true);
    near(r.expiresAt, Date.now() + 37 * DAY);

    const me = await row(u.id);
    near(me.trialUsedAt, Date.now());
    const [sub] = await prisma.subscription.findMany({ where: { userId: u.id } });
    near(sub.trialEndsAt, Date.now() + 7 * DAY);
    const claims = await prisma.trialClaim.findMany();
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({ phoneHash: phoneHash(u.phone!), userId: u.id });
    expect(claims[0].phoneHash).not.toContain(u.phone!.replace('+', ''));

    const st = await subs.getStatus(u.id);
    expect(st).toMatchObject({ tier: 'premium', trialActive: true, trialEligible: false });
    near(st.trialEndsAt, Date.now() + 7 * DAY);
    expect(await monthlyTrial(u.id)).toBeUndefined();
  });

  it('assinou de novo depois de vencer: sem teste (e o status não diz "em teste")', async () => {
    const u = await newUser(prisma, 'Bia');
    await subs.subscribe(u.id, 'premium_monthly', 'android', 'dev');
    // a assinatura (com o teste) já terminou
    await prisma.user.update({ where: { id: u.id }, data: { premiumExpiresAt: past(H) } });
    await prisma.subscription.updateMany({
      where: { userId: u.id },
      data: { expiresAt: past(H), trialEndsAt: past(30 * DAY) },
    });
    await lifecycle.downgradeExpired();

    const r = await subs.subscribe(u.id, 'premium_monthly', 'android', 'dev');
    expect(r.trialActive).toBe(false);
    near(r.expiresAt, Date.now() + 30 * DAY);
    const latest = await prisma.subscription.findFirstOrThrow({
      where: { userId: u.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(latest.trialEndsAt).toBeNull();
    expect((await subs.getStatus(u.id)).trialActive).toBe(false);
  });

  it('mesmo número numa conta nova (apagou a conta / número reciclado): sem teste', async () => {
    const a = await newUser(prisma, 'Antiga');
    await subs.subscribe(a.id, 'premium_monthly', 'android', 'dev');
    await prisma.user.delete({ where: { id: a.id } }); // a marca do número sobrevive (sem FK)

    const b = await prisma.user.create({
      data: { name: 'Nova', phone: a.phone, birthDate: new Date('1996-01-01'), gender: 'male' },
    });
    expect(await monthlyTrial(b.id)).toBeUndefined();
    expect((await subs.getStatus(b.id)).trialEligible).toBe(false);
    const r = await subs.subscribe(b.id, 'premium_monthly', 'android', 'dev');
    expect(r.trialActive).toBe(false);
    expect((await row(b.id)).trialUsedAt).not.toBeNull(); // a conta nova também consumiu a dela
  });

  it('qualquer 1ª assinatura paga consome o teste (anual primeiro → mensal depois sem teste)', async () => {
    const u = await newUser(prisma, 'Carla');
    const r1 = await subs.subscribe(u.id, 'premium_yearly', 'android', 'dev');
    expect(r1.trialActive).toBe(false);
    expect(await prisma.trialClaim.count()).toBe(1);
    await prisma.user.update({ where: { id: u.id }, data: { premiumExpiresAt: past(H) } });
    const r2 = await subs.subscribe(u.id, 'premium_monthly', 'android', 'dev'); // vencido no banco = free efetivo
    expect(r2.trialActive).toBe(false);
  });

  it('duas compras ao mesmo tempo: uma assinatura só (a outra recebe 400)', async () => {
    const u = await newUser(prisma, 'Duda');
    const out = await Promise.allSettled([
      subs.subscribe(u.id, 'premium_monthly', 'android', 'dev'),
      subs.subscribe(u.id, 'premium_monthly', 'android', 'dev'),
    ]);
    expect(out.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const rejected = out.find((o) => o.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ status: 400 });
    expect(await prisma.subscription.count({ where: { userId: u.id } })).toBe(1);
    expect(await prisma.trialClaim.count()).toBe(1);
  });

  it('Premium manual do painel não consome; conta sem telefone não ganha teste', async () => {
    const manual = await newUser(prisma, 'Parceira', {
      premiumTier: 'premium',
      premiumExpiresAt: past(H),
    });
    expect(await monthlyTrial(manual.id)).toBe(7);
    const noPhone = await newUser(prisma, 'Sem número', { phone: null });
    expect(await monthlyTrial(noPhone.id)).toBeUndefined();
    const r = await subs.subscribe(noPhone.id, 'premium_monthly', 'android', 'dev');
    expect(r.trialActive).toBe(false);
  });

  it('assinatura vigente → 400; cancelar decide pelo plano EFETIVO (vencido → 400)', async () => {
    const u = await newUser(prisma, 'Eva');
    await subs.subscribe(u.id, 'premium_yearly', 'android', 'dev');
    await expect(subs.subscribe(u.id, 'premium_monthly', 'android', 'dev')).rejects.toMatchObject({
      status: 400,
    });
    const c = await subs.cancel(u.id);
    expect(c.cancelledAt).toEqual(expect.any(String));
    expect((await subs.getStatus(u.id)).autoRenew).toBe(false);

    await prisma.user.update({ where: { id: u.id }, data: { premiumExpiresAt: past(H) } });
    await expect(subs.cancel(u.id)).rejects.toMatchObject({ status: 400 });
  });

  it('assinar invisível (grátis, com prazo) tira o prazo: Premium é invisível sem limite', async () => {
    const u = await newUser(prisma, 'Fê');
    await users.updateSettings(u.id, { visibilityMode: 'anonymous' });
    expect((await row(u.id)).anonymousUntil).not.toBeNull();
    await subs.subscribe(u.id, 'premium_quarterly', 'android', 'dev');
    expect(await row(u.id)).toMatchObject({
      visibilityMode: 'anonymous',
      anonymousUntil: null,
      premiumTier: 'premium',
    });
    // e a tarefa não o devolve ao mapa
    expect(await lifecycle.expireFreeAnonymous()).toEqual([]);
  });
});
