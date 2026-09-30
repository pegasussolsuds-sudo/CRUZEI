import { BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import type { PrismaService } from '../../src/database/prisma.service';
import type { AccountStateService } from '../../src/modules/account/account-state.service';
import { BlocksService } from '../../src/modules/blocks/blocks.service';
import { InboxService } from '../../src/modules/inbox/inbox.service';
import { ModerationService } from '../../src/modules/moderation/moderation.service';
import type { PhotoModerationService } from '../../src/modules/moderation/photo-moderation.service';
import { REPORT_THROTTLE } from '../../src/modules/reports/reports.controller';
import { EMERGENCY_REPORT_TARGETS_PER_DAY } from '../../src/modules/safety/emergency-limits';
import { EmergencyService } from '../../src/modules/safety/emergency.service';
import { URGENT_REPEAT_MS, urgentAlertKey } from '../../src/modules/support/support.mapper';
import { SupportService } from '../../src/modules/support/support.service';
import type { ChatGateway } from '../../src/realtime/chat.gateway';
import type { RedisService } from '../../src/redis/redis.service';

import {
  actor,
  emittedTo,
  emittedToStaff,
  fakeGateway,
  fakePush,
  newUser,
  notifyStack,
} from './admin-fakes';
import { assertTestDatabase } from './env';

// Botão de emergência e filtro de abuso contra o banco de TESTE (cruzei_test):
// - emergência: pausa 7 dias (some do mapa), bloqueio, denúncia de segurança (prioridade máxima, com a conversa),
//   suporte URGENTE no topo da fila com alerta ao vivo, sem duplicar ao repetir; conversa alheia não vale
// - mensagens: ódio/ameaça/menor → 400 text_blocked sem gravar nada; golpe passa e vira UMA denúncia automática
//   pendente (dedupe no banco), palavrão entre adultos passa
// Recriar o banco: bash test/db/setup-test-db.sh

const prisma = new PrismaClient();
const db = prisma as unknown as PrismaService;

// Redis falso: cache de perfil, presença, contadores (incrRate) e o que o InboxService usa (ttl/decr/set/get/del)
const kv = new Map<string, string>();
const counters = new Map<string, number>();
const redis = {
  invalidateProfile: jest.fn(async (_id: string) => undefined),
  markPresenceHidden: jest.fn(async (_id: string) => undefined),
  getCachedProfile: jest.fn(async (_id: string) => null),
  cacheProfile: jest.fn(async () => undefined),
  incrRate: jest.fn(async (userId: string, action: string) => {
    const k = `rate:${userId}:${action}`;
    const n = (counters.get(k) ?? 0) + 1;
    counters.set(k, n);
    return n;
  }),
  client: {
    ttl: async () => 60,
    decr: async (k: string) => {
      const n = (counters.get(k) ?? 0) - 1;
      counters.set(k, n);
      return n;
    },
    set: async (k: string, v: string, ...opts: unknown[]) => {
      if (opts.includes('NX') && kv.has(k)) return null;
      kv.set(k, v);
      return 'OK';
    },
    get: async (k: string) => kv.get(k) ?? null,
    del: async (...keys: string[]) => keys.reduce((n, k) => n + Number(kv.delete(k)), 0),
    // aceno (wave:<de>:<pra>) conta como relação pro botão de emergência
    exists: async (...keys: string[]) => keys.filter((k) => kv.has(k)).length,
    publish: async () => 0,
  },
};
const asRedis = redis as unknown as RedisService;
const gateway = fakeGateway();
const asGw = gateway as unknown as ChatGateway;
const push = fakePush();
const { notify } = notifyStack(prisma, gateway, push.transport);

const support = new SupportService(db, asRedis, asGw, notify);
const blocks = new BlocksService(db, asRedis, asGw);
const moderation = new ModerationService(
  db,
  asRedis,
  { invalidate: jest.fn(async () => undefined) } as unknown as AccountStateService,
  asGw,
  {} as PhotoModerationService,
  notify,
);
const emergency = new EmergencyService(db, asRedis, blocks, support, moderation);
const inbox = new InboxService(db, asRedis, asGw);

const DAY = 86_400_000;

const resetDb = () =>
  prisma.$executeRawUnsafe(
    'TRUNCATE conversations, users, pois, events, push_campaigns, place_candidates, geo_areas RESTART IDENTITY CASCADE',
  );

const pairOf = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);

/** conversa do par montada direto no banco */
async function conversation(a: string, b: string): Promise<string> {
  const [low, high] = pairOf(a, b);
  const c = await prisma.conversation.create({
    data: {
      userLowId: low,
      userHighId: high,
      lastMessageAt: new Date(),
      members: {
        create: [
          { userId: a, role: 'REQUESTER' },
          { userId: b, role: 'RECIPIENT' },
        ],
      },
    },
  });
  await prisma.message.create({ data: { conversationId: c.id, senderId: a, body: 'oi' } });
  return c.id;
}

/** espera algo feito depois da resposta (denúncia automática é "void") */
async function eventually<T>(read: () => Promise<T>, ok: (v: T) => boolean, ms = 2000): Promise<T> {
  const until = Date.now() + ms;
  let v = await read();
  while (!ok(v) && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 25));
    v = await read();
  }
  return v;
}

const settle = () => new Promise((r) => setTimeout(r, 30));

const urgentThread = (userId: string) =>
  prisma.supportThread.findFirst({ where: { userId, status: { not: 'resolved' } } });

beforeAll(async () => {
  await assertTestDatabase(prisma);
});

beforeEach(async () => {
  await resetDb();
  jest.clearAllMocks();
  kv.clear();
  counters.clear();
  push.sent.length = 0;
});

afterAll(async () => {
  await resetDb();
  await prisma.$disconnect();
});

describe('botão de emergência — com a pessoa (chat)', () => {
  it('pausa 7 dias, bloqueia, denuncia com a conversa, suporte urgente no topo e alerta ao vivo', async () => {
    const me = await newUser(prisma, 'Aline');
    const him = await newUser(prisma, 'Fulano Perigoso', { gender: 'male' });
    const other = await newUser(prisma, 'Carla');
    const agent = await newUser(prisma, 'Ana Suporte', { role: 'moderator' });
    const convId = await conversation(him.id, me.id);

    const t0 = Date.now();
    const r = await emergency.trigger(me.id, { targetUserId: him.id, conversationId: convId });
    await settle();

    // resultado
    expect(r.blocked).toBe(true);
    expect(r.reportId).toBeTruthy();
    expect(r.supportThreadId).toBeTruthy();
    const until = Date.parse(r.pausedUntil);
    expect(until).toBeGreaterThanOrEqual(t0 + 7 * DAY - 1000);
    expect(until).toBeLessThanOrEqual(Date.now() + 7 * DAY + 1000);

    // pausa: some do mapa na hora
    const u = await prisma.user.findUniqueOrThrow({
      where: { id: me.id },
      select: { isPaused: true, pausedUntil: true },
    });
    expect(u.isPaused).toBe(true);
    expect(u.pausedUntil?.toISOString()).toBe(r.pausedUntil);
    expect(redis.markPresenceHidden).toHaveBeenCalledWith(me.id);

    // bloqueio (e a conversa arquivada pros dois)
    expect(await prisma.block.count({ where: { blockerId: me.id, blockedId: him.id } })).toBe(1);
    const archived = await prisma.conversationMember.findMany({
      where: { conversationId: convId },
    });
    expect(archived.every((m) => m.archivedAt !== null)).toBe(true);

    // denúncia de segurança: prioridade máxima, com a conversa
    const rep = await prisma.report.findUniqueOrThrow({ where: { id: r.reportId! } });
    expect(rep).toMatchObject({
      reporterId: me.id,
      reportedId: him.id,
      reason: 'emergency',
      priority: 4,
      status: 'pending',
      context: { source: 'emergency', conversationId: convId },
    });

    // fila da moderação: primeiro, com a origem de sistema preservada na leitura
    await prisma.report.create({
      data: { reporterId: other.id, reportedId: me.id, reason: 'child_safety', priority: 3 },
    });
    const q = await moderation.queue();
    expect(q.reports[0].user.id).toBe(him.id);
    expect(q.reports[0].priority).toBe(4);
    expect(q.reports[0].reports[0].context).toEqual({
      source: 'emergency',
      conversationId: convId,
    });

    // suporte: URGENTE
    const th = await prisma.supportThread.findUniqueOrThrow({ where: { id: r.supportThreadId } });
    expect(th).toMatchObject({
      userId: me.id,
      status: 'open',
      urgent: true,
      staffUnread: 1,
      userUnread: 1,
    });
    expect(th.urgentAt).not.toBeNull();

    // o app: a própria mensagem + a resposta do sistema; sem nota interna e sem o nome da outra pessoa
    const app = await support.threadForApp(me.id);
    expect(app.thread?.urgent).toBe(true);
    expect(app.messages.map((m) => m.author)).toEqual(['user', 'system']);
    expect(app.messages[0].body).toMatch(/^🆘 URGENTE/);
    expect(app.messages[1].body).toContain('190');
    expect(JSON.stringify(app)).not.toContain('Fulano');
    // socket pra própria pessoa também sem a nota
    const toMe = emittedTo(gateway, me.id, 'support:message').map(
      (e) => e.payload.message as { internal: boolean },
    );
    expect(toMe).toHaveLength(2);
    expect(toMe.every((m) => m.internal === false)).toBe(true);

    // a equipe: 3 mensagens, a nota interna com o contexto
    const detail = await support.threadDetail(actor(agent.id, 'moderator'), r.supportThreadId);
    expect(detail.urgent).toBe(true);
    expect(detail.urgentAt).toBeTruthy();
    expect(detail.messages.map((m) => [m.author, m.internal])).toEqual([
      ['user', false],
      ['system', false],
      ['system', true],
    ]);
    const note = detail.messages[2].body;
    expect(note).toContain('Fulano Perigoso');
    expect(note).toContain(convId);
    expect(note).toContain(r.reportId!);

    // alerta ao vivo
    const alerts = emittedToStaff(gateway, 'support:urgent');
    expect(alerts).toHaveLength(1);
    expect((alerts[0].payload.thread as { id: string; urgent: boolean }).urgent).toBe(true);

    // fila: atendimento comum MAIS RECENTE, mas o urgente fica no topo
    await new Promise((res) => setTimeout(res, 20));
    await support.sendFromUser(other.id, 'oi, dúvida do Premium');
    const list = await support.listThreads(actor(agent.id, 'moderator'), {});
    expect(list.items.map((i) => i.id)[0]).toBe(r.supportThreadId);
    expect(list.items[0]).toMatchObject({ urgent: true });
    expect(list.items[1]).toMatchObject({ urgent: false, urgentAt: null });
    expect(list.total).toBe(2);
    // order=oldest também
    const oldest = await support.listThreads(actor(agent.id, 'moderator'), { order: 'oldest' });
    expect(oldest.items[0].id).toBe(r.supportThreadId);
    // urgent=1: só os urgentes
    const onlyUrgent = await support.listThreads(actor(agent.id, 'moderator'), { urgent: '1' });
    expect(onlyUrgent.items.map((i) => i.id)).toEqual([r.supportThreadId]);
  });

  it('sem targetUserId, a conversa (minha) define a pessoa', async () => {
    const me = await newUser(prisma, 'Aline');
    const him = await newUser(prisma, 'Beto');
    const convId = await conversation(me.id, him.id);
    const r = await emergency.trigger(me.id, { conversationId: convId });
    expect(r.blocked).toBe(true);
    const rep = await prisma.report.findUniqueOrThrow({ where: { id: r.reportId! } });
    expect(rep.reportedId).toBe(him.id);
  });
});

describe('botão de emergência — sem pessoa e travas', () => {
  it('Ajuda e segurança (sem pessoa): só pausa + suporte urgente', async () => {
    const me = await newUser(prisma, 'Aline');
    const r = await emergency.trigger(me.id, {});
    expect(r).toMatchObject({ blocked: false, reportId: null });
    expect(await prisma.report.count()).toBe(0);
    expect(await prisma.block.count()).toBe(0);
    expect((await urgentThread(me.id))?.urgent).toBe(true);
    const detail = await support.threadDetail(actor(me.id, 'admin'), r.supportThreadId);
    expect(detail.messages[2].body).toContain('Sem pessoa envolvida');
  });

  it('repetir não duplica bloqueio, denúncia, atendimento nem mensagens (e mantém o urgentAt da 1ª vez)', async () => {
    const me = await newUser(prisma, 'Aline');
    const him = await newUser(prisma, 'Beto');
    // relação registrada: ele me curtiu
    await prisma.like.create({ data: { likerId: him.id, likedId: me.id } });
    const a = await emergency.trigger(me.id, { targetUserId: him.id });
    const first = await urgentThread(me.id);
    const b = await emergency.trigger(me.id, { targetUserId: him.id });
    expect(b.supportThreadId).toBe(a.supportThreadId);
    expect(b.reportId).toBe(a.reportId);
    expect(await prisma.block.count()).toBe(1);
    expect(await prisma.report.count()).toBe(1);
    expect(await prisma.supportThread.count()).toBe(1);
    expect(await prisma.supportMessage.count()).toBe(3);
    expect((await urgentThread(me.id))?.urgentAt?.getTime()).toBe(first?.urgentAt?.getTime());
    // o alarme da equipe NÃO toca de novo na repetição (a fila só atualiza)
    expect(emittedToStaff(gateway, 'support:urgent')).toHaveLength(1);
    expect(emittedToStaff(gateway, 'support:thread').length).toBeGreaterThanOrEqual(2);
  });

  it('alarme: 1 por atendimento a cada 10 min, mesmo passando o tempo de repetição das mensagens', async () => {
    const me = await newUser(prisma, 'Aline');
    const a = await emergency.trigger(me.id, {});
    // passou o URGENT_REPEAT_MS (mensagens voltam a entrar), mas não os 10 min do alarme
    await prisma.supportThread.update({
      where: { id: a.supportThreadId },
      data: { urgentAt: new Date(Date.now() - URGENT_REPEAT_MS - 1000) },
    });
    await emergency.trigger(me.id, {});
    expect(await prisma.supportMessage.count()).toBe(6);
    expect(emittedToStaff(gateway, 'support:urgent')).toHaveLength(1);
    // venceu a janela do alarme (a chave do Redis some): toca de novo
    kv.delete(urgentAlertKey(a.supportThreadId));
    await emergency.trigger(me.id, {});
    expect(emittedToStaff(gateway, 'support:urgent')).toHaveLength(2);
  });

  it('atendimento comum já aberto vira urgente (mesmo atendimento)', async () => {
    const me = await newUser(prisma, 'Aline');
    const { thread } = await support.sendFromUser(me.id, 'oi, tenho uma dúvida');
    const r = await emergency.trigger(me.id, {});
    expect(r.supportThreadId).toBe(thread.id);
    expect(await prisma.supportThread.count()).toBe(1);
    expect((await urgentThread(me.id))?.urgent).toBe(true);
  });

  it('conversa de outras pessoas não vale; alvo = eu mesmo vira emergência sem pessoa', async () => {
    const me = await newUser(prisma, 'Aline');
    const b = await newUser(prisma, 'Beto');
    const c = await newUser(prisma, 'Carla');
    const theirs = await conversation(b.id, c.id);
    const r1 = await emergency.trigger(me.id, { conversationId: theirs });
    expect(r1).toMatchObject({ blocked: false, reportId: null });
    const r2 = await emergency.trigger(me.id, { targetUserId: me.id });
    expect(r2).toMatchObject({ blocked: false, reportId: null });
    expect(await prisma.block.count()).toBe(0);
    expect(await prisma.report.count()).toBe(0);
  });

  it('alvo SEM relação (id qualquer): pausa + suporte, sem bloquear nem denunciar; a equipe vê a pessoa citada', async () => {
    const me = await newUser(prisma, 'Aline');
    const stranger = await newUser(prisma, 'Desconhecida');
    const r = await emergency.trigger(me.id, { targetUserId: stranger.id });
    expect(r).toMatchObject({ blocked: false, reportId: null });
    expect(await prisma.block.count()).toBe(0);
    expect(await prisma.report.count()).toBe(0);
    expect((await urgentThread(me.id))?.urgent).toBe(true);
    const detail = await support.threadDetail(actor(me.id, 'admin'), r.supportThreadId);
    expect(detail.messages[2].body).toContain('SEM relação registrada');
    expect(detail.messages[2].body).toContain(stranger.id);
    // o app não vê o nome de ninguém
    expect(JSON.stringify(await support.threadForApp(me.id))).not.toContain('Desconhecida');
  });

  it('relação: curtida em qualquer sentido, passe no deck ou aceno recente valem', async () => {
    const me = await newUser(prisma, 'Aline');
    const [b, c, d, e] = await Promise.all(['B', 'C', 'D', 'E'].map((n) => newUser(prisma, n)));
    await prisma.like.create({ data: { likerId: me.id, likedId: b.id } });
    await prisma.like.create({ data: { likerId: c.id, likedId: me.id } });
    await prisma.pass.create({ data: { userId: d.id, targetId: me.id } });
    kv.set(`wave:${e.id}:${me.id}`, '1');
    expect(await emergency.hasRelation(me.id, b.id)).toBe(true);
    expect(await emergency.hasRelation(me.id, c.id)).toBe(true);
    expect(await emergency.hasRelation(me.id, d.id)).toBe(true);
    expect(await emergency.hasRelation(me.id, e.id)).toBe(true);
    // passe vencido não vale
    const f = await newUser(prisma, 'F');
    await prisma.pass.create({
      data: { userId: me.id, targetId: f.id, createdAt: new Date(Date.now() - 400 * DAY) },
    });
    expect(await emergency.hasRelation(me.id, f.id)).toBe(false);
    const r = await emergency.trigger(me.id, { targetUserId: c.id });
    expect(r.blocked).toBe(true);
    expect(r.reportId).toBeTruthy();
  });

  it('orçamento: a denúncia de emergência conta junto com as do app (última hora); bloqueio continua', async () => {
    const me = await newUser(prisma, 'Aline');
    const him = await newUser(prisma, 'Beto');
    await prisma.like.create({ data: { likerId: him.id, likedId: me.id } });
    const others = await Promise.all(
      Array.from({ length: REPORT_THROTTLE.default.limit }, (_, i) => newUser(prisma, `P${i}`)),
    );
    await prisma.report.createMany({
      data: others.map((o) => ({ reporterId: me.id, reportedId: o.id, reason: 'spam' })),
    });
    const r = await emergency.trigger(me.id, { targetUserId: him.id });
    expect(r).toMatchObject({ blocked: true, reportId: null });
    expect(await prisma.report.count({ where: { reason: 'emergency' } })).toBe(0);
    const detail = await support.threadDetail(actor(me.id, 'admin'), r.supportThreadId);
    expect(detail.messages[2].body).toContain('Denúncia NÃO criada');
  });

  it(`orçamento: no máximo ${EMERGENCY_REPORT_TARGETS_PER_DAY} pessoas diferentes por dia pelo botão`, async () => {
    const me = await newUser(prisma, 'Aline');
    const people = await Promise.all(
      Array.from({ length: EMERGENCY_REPORT_TARGETS_PER_DAY + 1 }, (_, i) =>
        newUser(prisma, `Q${i}`),
      ),
    );
    for (const p of people) await prisma.like.create({ data: { likerId: p.id, likedId: me.id } });
    const results = [];
    for (const p of people) results.push(await emergency.trigger(me.id, { targetUserId: p.id }));
    expect(results.slice(0, -1).every((r) => r.reportId !== null)).toBe(true);
    expect(results[results.length - 1]).toMatchObject({ blocked: true, reportId: null });
    expect(await prisma.report.count({ where: { reason: 'emergency' } })).toBe(
      EMERGENCY_REPORT_TARGETS_PER_DAY,
    );
  });

  it('alvo que não existe não derruba a emergência', async () => {
    const me = await newUser(prisma, 'Aline');
    const r = await emergency.trigger(me.id, {
      targetUserId: '0f5c3a4e-1111-4222-8333-444455556666',
    });
    expect(r).toMatchObject({ blocked: false, reportId: null });
    expect((await urgentThread(me.id))?.urgent).toBe(true);
  });

  it('pausa maior que já existia fica (não encurta)', async () => {
    const long = new Date(Date.now() + 30 * DAY);
    const me = await newUser(prisma, 'Aline', { isPaused: true, pausedUntil: long });
    const r = await emergency.trigger(me.id, {});
    expect(Date.parse(r.pausedUntil)).toBe(long.getTime());
  });

  it('resolvido: sai do topo (fica marcado no histórico) e a próxima emergência abre outro urgente', async () => {
    const me = await newUser(prisma, 'Aline');
    const agent = await newUser(prisma, 'Ana Suporte', { role: 'moderator' });
    const a = await emergency.trigger(me.id, {});
    await support.setStatus(a.supportThreadId, 'resolved');
    const resolved = await prisma.supportThread.findUniqueOrThrow({
      where: { id: a.supportThreadId },
    });
    expect(resolved).toMatchObject({ status: 'resolved', urgent: true });
    const open = await support.listThreads(actor(agent.id, 'moderator'), {});
    expect(open.items).toHaveLength(0);

    const b = await emergency.trigger(me.id, {});
    expect(b.supportThreadId).not.toBe(a.supportThreadId);
    const all = await support.listThreads(actor(agent.id, 'moderator'), { status: 'all' });
    expect(all.items[0].id).toBe(b.supportThreadId);
  });

  it('paginação: urgentes só na 1ª página, o cursor segue os comuns sem repetir', async () => {
    const agent = await newUser(prisma, 'Ana Suporte', { role: 'moderator' });
    const people = await Promise.all(['P1', 'P2', 'P3'].map((n) => newUser(prisma, n)));
    for (const p of people) {
      await support.sendFromUser(p.id, 'oi');
      await new Promise((res) => setTimeout(res, 5));
    }
    const sos = await newUser(prisma, 'Socorro');
    const r = await emergency.trigger(sos.id, {});
    const p1 = await support.listThreads(actor(agent.id, 'moderator'), { limit: '2' });
    expect(p1.items[0].id).toBe(r.supportThreadId);
    expect(p1.items).toHaveLength(3);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = await support.listThreads(actor(agent.id, 'moderator'), {
      limit: '2',
      cursor: p1.nextCursor!,
    });
    const ids = [...p1.items, ...p2.items].map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(4);
    expect(p2.items.some((i) => i.urgent)).toBe(false);
  });

  it('Painel: urgentes não resolvidos no contador', async () => {
    const me = await newUser(prisma, 'Aline');
    await emergency.trigger(me.id, {});
    const [row] = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*) FILTER (WHERE urgent AND status <> 'resolved')::int AS n FROM support_threads`;
    expect(row.n).toBe(1);
  });
});

describe('filtro de abuso — mensagens', () => {
  const autoReports = (reportedId: string) =>
    prisma.report.findMany({
      where: { reportedId, reporterId: null, reason: 'scam' },
      orderBy: { createdAt: 'asc' },
    });

  it('ódio, ameaça e menor: 400 text_blocked e nada é gravado', async () => {
    const a = await newUser(prisma, 'Ana');
    const b = await newUser(prisma, 'Bia');
    for (const text of ['seu macaco', 'vou te matar', 'manda nudes de novinha de 15']) {
      const err = await inbox.createConversation(a.id, b.id, text).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).getResponse()).toMatchObject({
        error: 'text_blocked',
        field: 'message',
      });
    }
    expect(await prisma.conversation.count()).toBe(0);
    expect(await prisma.message.count()).toBe(0);

    // numa conversa que já existe também
    const { conversation } = await inbox.createConversation(a.id, b.id, 'oi, tudo bem?');
    await expect(
      inbox.sendMessage(a.id, conversation.id, 'volta pra senzala'),
    ).rejects.toMatchObject({
      response: { error: 'text_blocked', reason: 'hate' },
    });
    expect(await prisma.message.count({ where: { conversationId: conversation.id } })).toBe(1);
  });

  it('palavrão entre adultos passa, sem denúncia', async () => {
    const a = await newUser(prisma, 'Ana');
    const b = await newUser(prisma, 'Bia');
    const { message } = await inbox.createConversation(a.id, b.id, 'porra, que dia foda kkk');
    expect(message.body).toBe('porra, que dia foda kkk');
    await settle();
    expect(await autoReports(a.id)).toHaveLength(0);
  });

  it('golpe passa e vira UMA denúncia automática pendente (dedupe); dispensada, a próxima abre outra', async () => {
    const a = await newUser(prisma, 'Golpista');
    const b = await newUser(prisma, 'Bia');
    const c = await newUser(prisma, 'Carla');
    const { conversation, message } = await inbox.createConversation(
      a.id,
      b.id,
      'me manda um pix de 50?',
    );
    expect(message.body).toBe('me manda um pix de 50?');

    const first = await eventually(
      () => autoReports(a.id),
      (l) => l.length > 0,
    );
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      status: 'pending',
      priority: 1,
      context: { source: 'auto_filter', conversationId: conversation.id, messageId: message.id },
    });
    expect(first[0].description).toContain('me manda um pix');

    // mais golpe (outra conversa, outro trecho): a mesma pendente, com o trecho novo somado e a conversa na lista
    const second = await inbox.createConversation(a.id, c.id, 'clica aqui bit.ly/promo');
    const again = await eventually(
      () => autoReports(a.id),
      (l) => (l[0]?.description ?? '').includes('bit.ly'),
    );
    expect(again).toHaveLength(1);
    expect(again[0].description).toContain('bit.ly');
    expect((again[0].context as { occurrences?: unknown }).occurrences).toEqual([
      { conversationId: conversation.id, messageId: message.id },
      { conversationId: second.conversation.id, messageId: second.message.id },
    ]);
    // a ficha da moderação abre as DUAS conversas
    const detail = await moderation.userDetail(a.id);
    expect(detail.conversations.map((x) => x.conversationId).sort()).toEqual(
      [conversation.id, second.conversation.id].sort(),
    );
    expect(detail.reports[0].context?.occurrences).toHaveLength(2);
    // o mesmo trecho de novo não repete na descrição
    await inbox.sendMessage(a.id, conversation.id, 'me manda um pix de 50?');
    await settle();
    const same = await autoReports(a.id);
    expect(same).toHaveLength(1);
    expect(same[0].description!.split('me manda um pix').length - 1).toBe(1);
    // mesma conversa de novo: a lista não repete
    expect((same[0].context as { occurrences?: unknown[] }).occurrences).toHaveLength(2);

    // a moderação lê a origem de sistema
    const q = await moderation.queue();
    expect(q.reports[0].reports[0].context?.source).toBe('auto_filter');

    // dispensou: a próxima abre outra pendente
    await prisma.report.update({ where: { id: same[0].id }, data: { status: 'dismissed' } });
    await inbox.sendMessage(a.id, conversation.id, 'minha chave pix é 11999998888');
    const after = await eventually(
      () => autoReports(a.id),
      (l) => l.length === 2,
    );
    expect(after.map((r) => r.status)).toEqual(['dismissed', 'pending']);
  });
});
