import { HttpException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { SupportService } from '../../src/modules/support/support.service';

import {
  actor,
  asGateway,
  asRedis,
  emittedTo,
  emittedToStaff,
  fakeGateway,
  fakePush,
  fakeRedis,
  newUser,
  notifyStack,
  resetAdminDb,
} from './admin-fakes';
import { assertTestDatabase } from './env';

// Suporte ao vivo contra o banco de TESTE: fluxo completo (app ↔ equipe), nota interna invisível pro app (HTTP e
// socket), eventos com gateway falso, um atendimento aberto por pessoa (inclusive em corrida), idempotência do
// clientId, limite por minuto, reabrir com conflito e aviso + push da resposta.
// Recriar o banco: bash test/db/setup-test-db.sh

const prisma = new PrismaClient();
const redis = fakeRedis();
const gateway = fakeGateway();
const push = fakePush();
const { notify } = notifyStack(prisma, gateway, push.transport);
const svc = new SupportService(prisma as never, asRedis(redis), asGateway(gateway), notify);

let userId = '';
let agentId = '';
let agent2Id = '';

beforeAll(async () => {
  await assertTestDatabase(prisma);
});

beforeEach(async () => {
  await resetAdminDb(prisma);
  jest.clearAllMocks();
  redis.resetRates();
  push.sent.length = 0;
  userId = (await newUser(prisma, 'Aline')).id;
  agentId = (await newUser(prisma, 'Ana Suporte', { role: 'moderator' })).id;
  agent2Id = (await newUser(prisma, 'Beto Admin', { role: 'admin' })).id;
  await prisma.deviceToken.create({ data: { userId, token: 'tok-aline-1', platform: 'android' } });
});

afterAll(async () => {
  await resetAdminDb(prisma);
  await prisma.$disconnect();
});

/** o gateway falso emite pra equipe numa promessa (nomes): espera ela terminar */
const settle = () => new Promise((r) => setTimeout(r, 30));

describe('suporte — fluxo completo', () => {
  it('1ª mensagem abre o atendimento com boas-vindas; equipe responde; nota interna nunca chega no app', async () => {
    expect(await svc.threadForApp(userId)).toEqual({ thread: null, messages: [] });

    const first = await svc.sendFromUser(userId, '  Não consigo ver meu Premium  ', 'c-1');
    expect(first.message).toMatchObject({
      author: 'user',
      body: 'Não consigo ver meu Premium',
      clientId: 'c-1',
      senderId: userId,
    });
    expect(first.welcome?.author).toBe('system');
    expect(first.welcome?.body).toContain('horas');
    expect(first.thread).toMatchObject({ status: 'open', unread: 1 });

    // a equipe vê na fila, sem responsável, com 1 não lida
    const queue = await svc.listThreads(actor(agentId, 'moderator'), {});
    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]).toMatchObject({
      status: 'open',
      staffUnread: 1,
      assignedTo: null,
      user: { id: userId, name: 'Aline' },
    });

    const threadId = first.thread.id;
    const note = await svc.sendFromStaff(actor(agentId, 'moderator'), threadId, {
      body: 'conferir assinatura na loja',
      internal: true,
    });
    expect(note.internal).toBe(true);
    const reply = await svc.sendFromStaff(actor(agentId, 'moderator'), threadId, {
      body: 'Oi Aline! Já olhei aqui.',
      clientId: 'p-1',
    });
    expect(reply).toMatchObject({ author: 'staff', senderName: 'Ana Suporte', clientId: 'p-1' });
    await settle();

    // app: sem a nota interna, atendente anônimo
    const app = await svc.threadForApp(userId);
    expect(app.messages.map((m) => m.author)).toEqual(['user', 'system', 'staff']);
    expect(app.messages.some((m) => m.body.includes('conferir assinatura'))).toBe(false);
    const staffMsg = app.messages[2];
    expect(staffMsg).toMatchObject({ senderName: 'Equipe Metch', senderId: null });
    expect(app.thread).toMatchObject({ status: 'pending', unread: 2 });

    // equipe: tudo, com nomes reais; resposta pública atribuiu o atendimento e marcou a 1ª resposta
    const detail = await svc.threadDetail(actor(agentId, 'moderator'), threadId);
    expect(detail.messages.map((m) => [m.author, m.internal])).toEqual([
      ['user', false],
      ['system', false],
      ['staff', true],
      ['staff', false],
    ]);
    expect(detail.assignedTo).toEqual({ id: agentId, name: 'Ana Suporte' });
    expect(detail.firstResponseMinutes).toBe(0);
    expect(detail.staffUnread).toBe(0);
    expect(detail.context.pastThreads).toBe(0);

    // a pessoa lê
    await svc.readByUser(userId);
    expect((await svc.threadForApp(userId)).thread?.unread).toBe(0);
  });

  it('socket: a pessoa nunca recebe nota interna; a equipe recebe tudo; fila avisada a cada mudança', async () => {
    const { thread } = await svc.sendFromUser(userId, 'oi');
    await svc.sendFromStaff(actor(agentId, 'moderator'), thread.id, {
      body: 'nota secreta',
      internal: true,
    });
    await svc.sendFromStaff(actor(agentId, 'moderator'), thread.id, { body: 'resposta' });
    await settle();

    const toUser = emittedTo(gateway, userId, 'support:message').map(
      (e) => e.payload.message as Record<string, unknown>,
    );
    expect(toUser.map((m) => m.author)).toEqual(['user', 'system', 'staff']);
    expect(toUser.every((m) => m.internal === false)).toBe(true);
    expect(JSON.stringify(toUser)).not.toContain('nota secreta');
    expect(JSON.stringify(toUser)).not.toContain(agentId);

    const toStaff = emittedToStaff(gateway, 'support:message').map(
      (e) => e.payload.message as Record<string, unknown>,
    );
    expect(toStaff.map((m) => m.body)).toEqual([
      'oi',
      expect.stringContaining('Equipe Metch'),
      'nota secreta',
      'resposta',
    ]);
    expect(emittedToStaff(gateway, 'support:thread').length).toBeGreaterThanOrEqual(3);

    // resposta pública → aviso na central + socket 'notification:new' + push; nota interna não avisa
    const notes = await prisma.notification.findMany({ where: { userId } });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      type: 'support_reply',
      title: 'A Equipe Metch respondeu',
      body: 'resposta',
    });
    expect((notes[0].data as { target: unknown }).target).toEqual({ kind: 'support' });
    expect(emittedTo(gateway, userId, 'notification:new')).toHaveLength(1);
    expect(push.sent).toHaveLength(1);
    expect(push.sent[0]).toMatchObject({
      token: 'tok-aline-1',
      payload: {
        channelId: 'support',
        data: { notificationId: notes[0].id, type: 'support_reply' },
      },
    });
  });
});

describe('suporte — travas', () => {
  it('um atendimento não resolvido por pessoa, mesmo com várias primeiras mensagens ao mesmo tempo', async () => {
    const outs = await Promise.all(
      [1, 2, 3, 4, 5].map((i) => svc.sendFromUser(userId, `msg ${i}`)),
    );
    expect(new Set(outs.map((o) => o.thread.id)).size).toBe(1);
    expect(outs.filter((o) => o.welcome).length).toBe(1); // uma boas-vindas só
    expect(await prisma.supportThread.count({ where: { userId } })).toBe(1);
    const t = await prisma.supportThread.findFirstOrThrow({ where: { userId } });
    expect(t.staffUnread).toBe(5);
    // o índice único parcial é quem garante
    await expect(
      prisma.$executeRaw`INSERT INTO support_threads (user_id, status) VALUES (${userId}::uuid, 'pending')`,
    ).rejects.toThrow();
  });

  it('clientId: reenvio devolve a MESMA mensagem, sem duplicar nem gastar cota; limite de 10/min', async () => {
    const a = await svc.sendFromUser(userId, 'uma vez só', 'dup-1');
    const b = await svc.sendFromUser(userId, 'uma vez só', 'dup-1');
    const [c, d] = await Promise.all([
      svc.sendFromUser(userId, 'corrida', 'dup-2'),
      svc.sendFromUser(userId, 'corrida', 'dup-2'),
    ]);
    expect(b.message.id).toBe(a.message.id);
    expect(b.welcome).toBeNull();
    expect(c.message.id).toBe(d.message.id);
    expect(await prisma.supportMessage.count({ where: { author: 'user' } })).toBe(2);

    // equipe também é idempotente
    const s1 = await svc.sendFromStaff(actor(agentId, 'moderator'), a.thread.id, {
      body: 'x',
      clientId: 'st-1',
    });
    const s2 = await svc.sendFromStaff(actor(agentId, 'moderator'), a.thread.id, {
      body: 'x',
      clientId: 'st-1',
    });
    expect(s2.id).toBe(s1.id);
    expect(await prisma.notification.count({ where: { userId } })).toBe(1);

    redis.resetRates();
    for (let i = 0; i < 10; i++) await svc.sendFromUser(userId, `n${i}`);
    await expect(svc.sendFromUser(userId, 'a 11ª')).rejects.toMatchObject({ status: 429 });
    await expect(svc.sendFromUser(userId, 'a 11ª')).rejects.toBeInstanceOf(HttpException);
  });

  it('encerrar manda mensagem de sistema; atendimento encerrado só aceita nota interna; nova mensagem abre outro', async () => {
    const { thread } = await svc.sendFromUser(userId, 'oi');
    const closed = await svc.setStatus(thread.id, 'resolved');
    expect(closed.status).toBe('resolved');
    const app = await svc.threadForApp(userId);
    expect(app.thread?.status).toBe('resolved');
    expect(app.messages[app.messages.length - 1]).toMatchObject({
      author: 'system',
      body: expect.stringContaining('encerrado'),
    });

    await expect(
      svc.sendFromStaff(actor(agentId, 'moderator'), thread.id, { body: 'e aí?' }),
    ).rejects.toMatchObject({
      response: { error: 'thread_resolved' },
    });
    await svc.sendFromStaff(actor(agentId, 'moderator'), thread.id, {
      body: 'nota depois',
      internal: true,
    });

    // a pessoa volta: atendimento NOVO (com boas-vindas de novo)
    const again = await svc.sendFromUser(userId, 'voltei');
    expect(again.thread.id).not.toBe(thread.id);
    expect(again.welcome).not.toBeNull();
    // reabrir o antigo agora esbarra no atendimento aberto
    await expect(svc.setStatus(thread.id, 'open')).rejects.toMatchObject({
      response: { error: 'thread_conflict' },
    });

    // nota e a fila de resolvidos
    await svc.rate(userId, 5);
    expect(
      (await prisma.supportThread.findUniqueOrThrow({ where: { id: again.thread.id } })).rating,
    ).toBe(5);
    const resolved = await svc.listThreads(actor(agentId, 'moderator'), { status: 'resolved' });
    expect(resolved.items.map((t) => t.id)).toEqual([thread.id]);
  });

  it('atribuir só pra alguém da equipe; "meus" filtra; ler zera as não lidas da equipe', async () => {
    const { thread } = await svc.sendFromUser(userId, 'oi');
    await expect(svc.assign(thread.id, userId)).rejects.toMatchObject({
      response: { error: 'not_staff' },
    });
    const s = await svc.assign(thread.id, agent2Id);
    expect(s.assignedTo).toEqual({ id: agent2Id, name: 'Beto Admin' });
    expect((await svc.listThreads(actor(agentId, 'moderator'), { mine: '1' })).items).toHaveLength(
      0,
    );
    expect((await svc.listThreads(actor(agent2Id, 'admin'), { mine: '1' })).items).toHaveLength(1);
    expect((await svc.readByStaff(thread.id)).staffUnread).toBe(0);
    expect((await svc.assign(thread.id, null)).assignedTo).toBeNull();
  });
});

describe('suporte — fila por espera e conversa longa', () => {
  it('order=oldest: quem espera há mais tempo primeiro (insistir não joga pro fim); total = abertos', async () => {
    const bia = (await newUser(prisma, 'Bia')).id;
    const caio = (await newUser(prisma, 'Caio')).id;
    const me = actor(agentId, 'moderator');
    const a = await svc.sendFromUser(userId, 'primeiro');
    const b = await svc.sendFromUser(bia, 'segundo');
    const c = await svc.sendFromUser(caio, 'terceiro');
    await svc.sendFromUser(userId, 'alguém?'); // última mensagem mais nova, mas espera desde a primeira

    const oldest = await svc.listThreads(me, { status: 'open', order: 'oldest' });
    expect(oldest.items.map((t) => t.id)).toEqual([a.thread.id, b.thread.id, c.thread.id]);
    expect(oldest.total).toBe(3);
    expect(oldest.items[0].waitingSince).toBe(a.message.createdAt);
    expect((await svc.listThreads(me, { status: 'open' })).items[0].id).toBe(a.thread.id);

    // respondeu: vira pendente, não espera mais e o total dos abertos cai
    await svc.sendFromStaff(me, b.thread.id, { body: 'oi Bia' });
    const pend = await svc.listThreads(me, { status: 'pending' });
    expect(pend.items.map((t) => [t.id, t.waitingSince])).toEqual([[b.thread.id, null]]);
    expect((await svc.listThreads(me, { status: 'open', order: 'oldest' })).total).toBe(2);

    // paginação pela espera percorre na mesma ordem
    const p1 = await svc.listThreads(me, { status: 'open', order: 'oldest', limit: 1 });
    const p2 = await svc.listThreads(me, {
      status: 'open',
      order: 'oldest',
      limit: 1,
      cursor: p1.nextCursor ?? undefined,
    });
    expect([...p1.items, ...p2.items].map((t) => t.id)).toEqual([a.thread.id, c.thread.id]);
    expect(p2.nextCursor).toBeNull();
  });

  it('conversa longa: o detalhe traz as 1000 mais NOVAS, em ordem', async () => {
    const { thread } = await svc.sendFromUser(userId, 'começo');
    await prisma.$executeRaw`
      INSERT INTO support_messages (thread_id, sender_id, author, body, internal, created_at)
      SELECT ${thread.id}::uuid, ${userId}::uuid, 'user', 'msg ' || g, false, now() + g * interval '1 second'
        FROM generate_series(1, 1005) g`;
    const detail = await svc.threadDetail(actor(agentId, 'moderator'), thread.id);
    expect(detail.messages).toHaveLength(1000);
    expect(detail.messages[0].body).toBe('msg 6');
    expect(detail.messages[999].body).toBe('msg 1005');
  });
});
