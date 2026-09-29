import { PrismaClient } from '@prisma/client';

import type { PrismaService } from '../../src/database/prisma.service';
import { AdminPanelController } from '../../src/modules/admin/admin-panel.controller';
import { AdminUsersService, NO_EXPIRY } from '../../src/modules/admin/admin-users.service';
import type { StatsService } from '../../src/modules/admin/stats.service';
import { ModerationService } from '../../src/modules/moderation/moderation.service';
import type { PhotoModerationService } from '../../src/modules/moderation/photo-moderation.service';
import { UsersService } from '../../src/modules/users/users.service';

import {
  actor,
  asAccounts,
  asGateway,
  asRedis,
  emittedTo,
  fakeAccounts,
  fakeGateway,
  fakePush,
  fakeRedis,
  newUser,
  notifyStack,
  resetAdminDb,
} from './admin-fakes';
import { assertTestDatabase } from './env';

// Usuários no painel contra o banco de TESTE: Premium manual (dar/tirar, linha em subscriptions, auditoria, /me,
// aviso), papéis (nunca o próprio, sempre sobra um admin, cache do estado da conta cai) e a busca com telefone
// mascarado pro moderador. Recriar o banco: bash test/db/setup-test-db.sh

const prisma = new PrismaClient();
const db = prisma as unknown as PrismaService;
const redis = fakeRedis();
const gateway = fakeGateway();
const accounts = fakeAccounts();
const push = fakePush();
const { notify, audit } = notifyStack(prisma, gateway, push.transport);
const moderation = new ModerationService(
  db,
  asRedis(redis),
  asAccounts(accounts),
  asGateway(gateway),
  {} as PhotoModerationService,
  notify,
);
const users = new UsersService(
  db,
  asRedis(redis),
  {} as PhotoModerationService,
  asGateway(gateway),
);
const svc = new AdminUsersService(
  db,
  asRedis(redis),
  asAccounts(accounts),
  asGateway(gateway),
  moderation,
  users,
  notify,
  audit,
);

let adminId = '';
let modId = '';
let userId = '';

beforeAll(async () => {
  await assertTestDatabase(prisma);
});

beforeEach(async () => {
  await resetAdminDb(prisma);
  jest.clearAllMocks();
  push.sent.length = 0;
  adminId = (await newUser(prisma, 'Monteiro', { role: 'admin' })).id;
  modId = (await newUser(prisma, 'Mari Mod', { role: 'moderator' })).id;
  userId = (await newUser(prisma, 'Aline')).id;
});

afterAll(async () => {
  await resetAdminDb(prisma);
  await prisma.$disconnect();
});

const auditOf = (action: string) =>
  prisma.auditLog.findMany({ where: { action }, orderBy: { createdAt: 'asc' } });

describe('Premium manual', () => {
  it('dar por 30 dias: users + linha manual em subscriptions + auditoria + aviso + /me', async () => {
    const row = await svc.setPremium(actor(adminId, 'admin'), userId, {
      tier: 'premium',
      days: 30,
      reason: 'parceria do evento',
      notify: true,
    });
    expect(row.premiumTier).toBe('premium');
    const exp = new Date(row.premiumExpiresAt!).getTime();
    expect(Math.abs(exp - (Date.now() + 30 * 86_400_000))).toBeLessThan(60_000);

    const subs = await prisma.subscription.findMany({ where: { userId } });
    expect(subs).toHaveLength(1);
    expect(subs[0]).toMatchObject({
      tier: 'premium',
      platform: 'manual',
      note: 'parceria do evento',
      grantedBy: adminId,
      cancelledAt: null,
    });

    const [a] = await auditOf('admin.user.premium_grant');
    expect(a.userId).toBe(adminId);
    expect(a.metadata).toMatchObject({
      target: { kind: 'user', id: userId },
      tier: 'premium',
      days: 30,
    });
    expect(redis.invalidateProfile).toHaveBeenCalledWith(userId);

    const n = await prisma.notification.findFirstOrThrow({ where: { userId } });
    expect(n).toMatchObject({ type: 'premium_granted' });
    expect((n.data as { target: unknown }).target).toEqual({ kind: 'premium' });
    expect(emittedTo(gateway, userId, 'notification:new')).toHaveLength(1);

    const me = (await users.me(userId)) as { premiumTier: string };
    expect(me.premiumTier).toBe('premium');

    // a ficha mostra a linha com quem deu
    const detail = await svc.detail(actor(adminId, 'admin'), userId);
    expect(detail.subscriptions[0]).toMatchObject({
      platform: 'manual',
      note: 'parceria do evento',
      grantedBy: { id: adminId, name: 'Monteiro' },
    });
  });

  it('sem vencimento: users.premium_expires_at null e a linha vence em 2099; trocar substitui a manual vigente', async () => {
    await svc.setPremium(actor(adminId, 'admin'), userId, {
      tier: 'premium',
      days: 7,
      reason: 'teste',
    });
    const row = await svc.setPremium(actor(adminId, 'admin'), userId, {
      tier: 'premium_plus',
      days: null,
      reason: 'embaixadora',
    });
    expect(row).toMatchObject({ premiumTier: 'premium_plus', premiumExpiresAt: null });
    const subs = await prisma.subscription.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    expect(subs).toHaveLength(2);
    expect(subs[0].cancelledAt).not.toBeNull(); // a de 7 dias foi substituída
    expect(subs[1]).toMatchObject({ tier: 'premium_plus', cancelledAt: null });
    expect(subs[1].expiresAt.getTime()).toBe(NO_EXPIRY.getTime());
    expect(((await users.me(userId)) as { premiumTier: string }).premiumTier).toBe('premium_plus');
    expect(push.sent).toHaveLength(0); // sem notify: ninguém é avisado
  });

  it("tirar ('free'): cancela a manual vigente, volta a free, avatar sem itens pagos, /me free", async () => {
    await svc.setPremium(actor(adminId, 'admin'), userId, {
      tier: 'premium',
      days: 30,
      reason: 'x',
    });
    await prisma.deviceToken.create({ data: { userId, token: 'tok-aline', platform: 'android' } });
    const row = await svc.setPremium(actor(adminId, 'admin'), userId, {
      tier: 'free',
      days: null,
      reason: 'fim da parceria',
      notify: true,
    });
    expect(row).toMatchObject({ premiumTier: 'free', premiumExpiresAt: null });
    const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(u).toMatchObject({ premiumTier: 'free', premiumExpiresAt: null });
    const subs = await prisma.subscription.findMany({ where: { userId } });
    expect(subs.every((s) => s.cancelledAt !== null)).toBe(true);
    expect(((await users.me(userId)) as { premiumTier: string }).premiumTier).toBe('free');
    expect(await auditOf('admin.user.premium_remove')).toHaveLength(1);
    expect(push.sent.map((m) => m.payload.title)).toEqual(['Seu Premium foi encerrado']);
  });

  it('conta apagada → 404; motivo vazio → 400', async () => {
    await prisma.user.update({ where: { id: userId }, data: { deletedAt: new Date() } });
    await expect(
      svc.setPremium(actor(adminId, 'admin'), userId, { tier: 'premium', days: 1, reason: 'x' }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      svc.setPremium(actor(adminId, 'admin'), modId, { tier: 'premium', days: 1, reason: '   ' }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('aviso da moderação', () => {
  it('avisar: vai pra central, pro socket (alerta no app) e por push', async () => {
    await prisma.deviceToken.create({
      data: { userId, token: 'tok-aline-warn', platform: 'android' },
    });
    gateway.emitToUser.mockClear();
    gateway.emitToUsers.mockClear();
    await moderation.act({ id: adminId, role: 'admin' }, userId, {
      action: 'warn',
      reason: 'Mensagens ofensivas não são permitidas.',
    });
    const n = await prisma.notification.findFirstOrThrow({
      where: { userId, type: 'moderation_warning' },
    });
    expect(n).toMatchObject({
      title: 'Aviso da moderação',
      body: 'Mensagens ofensivas não são permitidas.',
    });
    expect(push.sent.map((m) => m.payload.title)).toEqual(['Aviso da moderação']);
    expect(emittedTo(gateway, userId, 'notification:new')).toHaveLength(1);
    expect(emittedTo(gateway, userId, 'account_notice')).toEqual([
      {
        event: 'account_notice',
        payload: { kind: 'warning', message: 'Mensagens ofensivas não são permitidas.' },
      },
    ]);
  });
});

describe('papéis', () => {
  it('promove e rebaixa: estado da conta invalidado, sala da equipe atualizada, auditoria', async () => {
    const row = await svc.setRole(actor(adminId, 'admin'), userId, 'moderator');
    expect(row.role).toBe('moderator');
    expect(accounts.invalidate).toHaveBeenCalledWith(userId);
    expect(gateway.setStaffMembership).toHaveBeenLastCalledWith(userId, true);
    await svc.setRole(actor(adminId, 'admin'), userId, 'user');
    expect(gateway.setStaffMembership).toHaveBeenLastCalledWith(userId, false);
    const logs = await auditOf('admin.user.role');
    expect(logs.map((l) => (l.metadata as { detail: string }).detail)).toEqual([
      'user → moderator',
      'moderator → user',
    ]);
  });

  it('não muda o próprio papel', async () => {
    await expect(svc.setRole(actor(adminId, 'admin'), adminId, 'user')).rejects.toMatchObject({
      response: { error: 'own_role' },
    });
  });

  it('sempre sobra pelo menos um admin, mesmo com dois admins se rebaixando ao mesmo tempo', async () => {
    const other = (await newUser(prisma, 'Outro Admin', { role: 'admin' })).id;
    // sem a trava, os dois passariam na conta "ainda tem outro admin" e o app ficaria sem nenhum
    const r = await Promise.allSettled([
      svc.setRole(actor(adminId, 'admin'), other, 'user'),
      svc.setRole(actor(other, 'admin'), adminId, 'user'),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const rejected = r.find((x): x is PromiseRejectedResult => x.status === 'rejected');
    expect(rejected?.reason).toMatchObject({ response: { error: 'last_admin' } });
    expect(await prisma.user.count({ where: { role: 'admin' } })).toBe(1);
  });
});

describe('busca e ficha', () => {
  it('telefone inteiro só pra admin; moderador vê mascarado; busca por nome, telefone e id', async () => {
    const phone = (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).phone!;
    const asAdmin = await svc.list(actor(adminId, 'admin'), { q: 'alin' });
    expect(asAdmin.items.map((u) => u.id)).toEqual([userId]);
    expect(asAdmin.items[0].phone).toBe(phone);
    expect(asAdmin.total).toBe(1);

    const asMod = await svc.list(actor(modId, 'moderator'), { q: phone.slice(-6) });
    expect(asMod.items.map((u) => u.id)).toEqual([userId]);
    expect(asMod.items[0].phone).not.toBe(phone);
    expect(asMod.items[0].phone).toContain(phone.slice(-4));

    expect((await svc.list(actor(adminId, 'admin'), { q: userId })).items.map((u) => u.id)).toEqual(
      [userId],
    );
    expect(
      (await svc.list(actor(adminId, 'admin'), { role: 'moderator' })).items.map((u) => u.id),
    ).toEqual([modId]);

    // compatibilidade: a ficha traz ModerationUserDetail no nível de cima (tela do celular) e em `moderation`
    const d = await svc.detail(actor(modId, 'moderator'), userId);
    expect(d.moderation.user.id).toBe(userId);
    expect(d.user.id).toBe(userId);
    expect(d.phone).not.toBe(phone);
    expect(d.counts).toEqual({
      likesSent: 0,
      likesReceived: 0,
      mutualLikes: 0,
      conversations: 0,
      messagesSent: 0,
      blocksReceived: 0,
    });
  });

  it('paginação por cursor sem repetir ninguém', async () => {
    for (let i = 0; i < 5; i++) await newUser(prisma, `Pessoa ${i}`);
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await svc.list(actor(adminId, 'admin'), { cursor, limit: 3 });
      seen.push(...page.items.map((u) => u.id));
      expect(page.total).toBe(8);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toHaveLength(8);
    expect(new Set(seen).size).toBe(8);
  });
});

describe('denúncias pendentes, auditoria e equipe', () => {
  it('filtro "com denúncias pendentes"; a ficha traz a situação de cada denúncia e o papel', async () => {
    const other = (await newUser(prisma, 'Beto')).id;
    await prisma.report.createMany({
      data: [
        { reporterId: other, reportedId: userId, reason: 'spam' },
        { reporterId: other, reportedId: modId, reason: 'fake', status: 'dismissed' },
      ],
    });
    const pending = await svc.list(actor(adminId, 'admin'), { reports: 'pending' });
    expect(pending.items.map((u) => u.id)).toEqual([userId]);
    expect(pending.total).toBe(1);
    expect(pending.items[0].reportsPending).toBe(1);

    const d = await svc.detail(actor(adminId, 'admin'), modId);
    expect(d.reportsPending).toBe(0);
    expect(d.moderation.reports.map((r) => r.status)).toEqual(['dismissed']);
    expect(d.moderation.user.role).toBe('moderator');
    // fila de moderação: o resumo leva o papel (o painel esconde ações que o servidor recusaria)
    const q = await moderation.queue();
    expect(q.reports.map((g) => [g.user.id, g.user.role])).toEqual([[userId, 'user']]);
  });

  it('auditoria: ação por trecho e sem caixa ("warn" acha moderation.warn); alvo pelo id', async () => {
    await moderation.act({ id: modId, role: 'moderator' }, userId, {
      action: 'warn',
      reason: 'Calma aí',
    });
    await svc.setRole(actor(adminId, 'admin'), userId, 'moderator');
    expect((await audit.list({ action: 'warn' })).items.map((i) => i.action)).toEqual([
      'moderation.warn',
    ]);
    expect((await audit.list({ action: 'USER.ROLE' })).items.map((i) => i.action)).toEqual([
      'admin.user.role',
    ]);
    // curinga digitado é texto: nenhuma ação tem "%"
    expect((await audit.list({ action: '%' })).items).toHaveLength(0);
    expect((await audit.list({ targetId: userId })).items).toHaveLength(2);
  });

  it('GET /admin/staff: só a equipe ativa, por nome', async () => {
    const banned = (await newUser(prisma, 'Ze Mod', { role: 'moderator' })).id;
    await prisma.user.update({ where: { id: banned }, data: { accountStatus: 'banned' } });
    const panel = new AdminPanelController(db, {} as StatsService, audit);
    expect((await panel.staff()).items).toEqual([
      { id: modId, name: 'Mari Mod', role: 'moderator' },
      { id: adminId, name: 'Monteiro', role: 'admin' },
    ]);
  });
});
