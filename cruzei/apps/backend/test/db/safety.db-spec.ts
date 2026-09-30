import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import type { PrismaService } from '../../src/database/prisma.service';
import type { AccountStateService } from '../../src/modules/account/account-state.service';
import { BlocksService } from '../../src/modules/blocks/blocks.service';
import { InboxService } from '../../src/modules/inbox/inbox.service';
import { LikesService } from '../../src/modules/likes/likes.service';
import type { LocationService } from '../../src/modules/location/location.service';
import { loadPeerSocial } from '../../src/modules/location/peer-social';
import { ModerationService } from '../../src/modules/moderation/moderation.service';
import type { PhotoModerationService } from '../../src/modules/moderation/photo-moderation.service';
import type { NotifyService } from '../../src/modules/notifications/notify.service';
import { PublicUsersController } from '../../src/modules/users/public-users.controller';
import type { ChatGateway } from '../../src/realtime/chat.gateway';
import { canJoinConversation } from '../../src/realtime/conversation-access';
import type { RedisService } from '../../src/redis/redis.service';

import { assertTestDatabase } from './env';

// Segurança da inbox contra o banco de TESTE (cruzei_test): bloqueio (esconde dos dois lados, zera não lidas,
// arquiva pros dois, Like/Message intocados, eventos só depois do commit), banimento (arquiva as conversas da
// pessoa) e o que o cartão/mapa mostram (likeStatus com RECEIVED só pra Premium+, conversa do par); curtida:
// like_received sem identidade fora do Premium+/mútuo e a corrida curtida × bloqueio.
// Banco fora do ar = FALHA. Recriar o banco: bash test/db/setup-test-db.sh

const prisma = new PrismaClient();
const db = prisma as unknown as PrismaService;

// Redis falso: cache de perfil, contadores de limite (incrRate) e a idempotência por clientId do InboxService
const kv = new Map<string, string>();
const counters = new Map<string, number>();
const redis = {
  invalidateProfile: jest.fn(async (_id: string) => undefined),
  markPresenceHidden: jest.fn(async (_id: string) => undefined),
  incrRate: async (userId: string, action: string) => {
    const k = `rate:${userId}:${action}`;
    const n = (counters.get(k) ?? 0) + 1;
    counters.set(k, n);
    return n;
  },
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
    del: async (k: string) => Number(kv.delete(k)),
  },
};
const gateway = {
  emitToUser: jest.fn(),
  emitToUsers: jest.fn(),
  removeFromConversation: jest.fn(),
  disconnectUser: jest.fn(),
};
const accounts = { invalidate: jest.fn(async (_id: string): Promise<void> => undefined) };
// cartão público: faixa/lugar não interessam aqui (a pessoa não está "descoberta")
const location = { discoverability: jest.fn(async () => ({ ok: false, band: null, poi: null })) };

const blocks = new BlocksService(
  db,
  redis as unknown as RedisService,
  gateway as unknown as ChatGateway,
);
const moderation = new ModerationService(
  db,
  redis as unknown as RedisService,
  accounts as unknown as AccountStateService,
  gateway as unknown as ChatGateway,
  {} as PhotoModerationService,
  // aviso da moderação: central + socket (push fora do teste)
  { notify: async () => ({ notified: 1, pushSent: 0, pushFailed: 0 }) } as unknown as NotifyService,
);
const cards = new PublicUsersController(db, location as unknown as LocationService);
const inbox = new InboxService(
  db,
  redis as unknown as RedisService,
  gateway as unknown as ChatGateway,
);
const likes = new LikesService(
  db,
  redis as unknown as RedisService,
  gateway as unknown as ChatGateway,
  inbox,
);

/** tudo que o gateway falso emitiu, na ordem das chamadas (emitToUser e emitToUsers juntos) */
const emitted = () =>
  [
    ...gateway.emitToUser.mock.calls.map((c, i) => ({
      to: [c[0] as string],
      event: c[1] as string,
      payload: c[2] as Record<string, unknown>,
      order: gateway.emitToUser.mock.invocationCallOrder[i],
    })),
    ...gateway.emitToUsers.mock.calls.map((c, i) => ({
      to: c[0] as string[],
      event: c[1] as string,
      payload: c[2] as Record<string, unknown>,
      order: gateway.emitToUsers.mock.invocationCallOrder[i],
    })),
  ].sort((x, y) => x.order - y.order);

// TRUNCATE não dispara o trigger de linha do audit_log (deleteMany de usuário falharia)
const resetDb = () =>
  prisma.$executeRawUnsafe('TRUNCATE conversations, users RESTART IDENTITY CASCADE');

const newUser = (name: string, extra: Record<string, unknown> = {}) =>
  prisma.user.create({
    data: {
      name,
      birthDate: new Date('1995-01-01'),
      gender: 'female',
      visibilityMode: 'visible',
      ...extra,
    } as never,
    select: { id: true },
  });

const pairOf = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);

/** conversa do par montada direto no banco (sem o InboxService): requester mandou `sent` mensagens */
async function conversation(
  requester: string,
  recipient: string,
  opts: { sent?: number; replies?: number; promoted?: boolean } = {},
) {
  const [low, high] = pairOf(requester, recipient);
  const sent = opts.sent ?? 1;
  const replies = opts.replies ?? 0;
  const c = await prisma.conversation.create({
    data: {
      userLowId: low,
      userHighId: high,
      lastMessageAt: new Date(),
      ...(opts.promoted ? { promotedAt: new Date(), promotedReason: 'mutual' } : {}),
      members: {
        create: [
          { userId: requester, role: 'REQUESTER', unreadCount: replies },
          { userId: recipient, role: 'RECIPIENT', unreadCount: sent },
        ],
      },
    },
  });
  const msgs = [
    ...Array.from({ length: sent }, (_, i) => ({
      conversationId: c.id,
      senderId: requester,
      body: `oi ${i}`,
    })),
    ...Array.from({ length: replies }, (_, i) => ({
      conversationId: c.id,
      senderId: recipient,
      body: `resposta ${i}`,
    })),
  ];
  if (msgs.length) await prisma.message.createMany({ data: msgs });
  return c.id;
}

const members = (conversationId: string) =>
  prisma.conversationMember.findMany({ where: { conversationId }, orderBy: { userId: 'asc' } });

/** o que os leitores do inbox enxergam de uma pessoa: linhas dela não arquivadas (Principal + Solicitações) */
const visibleTo = async (userId: string) =>
  (
    await prisma.conversationMember.findMany({
      where: { userId, archivedAt: null },
      select: { conversationId: true },
    })
  ).map((m) => m.conversationId);

beforeAll(async () => {
  await assertTestDatabase(prisma);
});

beforeEach(async () => {
  await resetDb();
  jest.clearAllMocks();
  kv.clear();
  counters.clear();
});

afterAll(async () => {
  await resetDb();
  await prisma.$disconnect();
});

describe('bloqueio (BlocksService)', () => {
  it('B bloqueia A com solicitação aberta: some dos dois lados, não lidas zeram, Like/Message intocados', async () => {
    const a = await newUser('Ana');
    const b = await newUser('Bia');
    await prisma.like.create({ data: { likerId: a.id, likedId: b.id } });
    const conv = await conversation(a.id, b.id, { sent: 2 });
    expect((await members(conv)).find((m) => m.userId === b.id)?.unreadCount).toBe(2);
    expect(await visibleTo(b.id)).toEqual([conv]); // nas solicitações de B

    const likesBefore = await prisma.like.count();
    const msgsBefore = await prisma.message.count();
    await blocks.block(b.id, a.id, 'chato');

    // as duas linhas: não lidas 0 e arquivadas → fora do inbox e das solicitações dos dois
    const ms = await members(conv);
    expect(ms).toHaveLength(2);
    for (const m of ms) {
      expect(m.unreadCount).toBe(0);
      expect(m.archivedAt).toBeInstanceOf(Date);
    }
    expect(await visibleTo(a.id)).toEqual([]);
    expect(await visibleTo(b.id)).toEqual([]);
    // sala do "digitando" recusada pros dois
    expect(await canJoinConversation(prisma, conv, a.id)).toBe(false);
    expect(await canJoinConversation(prisma, conv, b.id)).toBe(false);
    // independente de Like e Message
    expect(await prisma.like.count()).toBe(likesBefore);
    expect(await prisma.message.count()).toBe(msgsBefore);
    expect(await prisma.block.count()).toBe(1);

    // eventos só pros dois, depois do commit
    expect(gateway.emitToUsers).toHaveBeenCalledTimes(1);
    expect(gateway.emitToUsers).toHaveBeenCalledWith([b.id, a.id], 'conversation:removed', {
      conversationId: conv,
    });
    expect(gateway.removeFromConversation).toHaveBeenCalledWith(conv, [b.id, a.id]);
    expect(gateway.emitToUser).not.toHaveBeenCalled();
    expect(redis.invalidateProfile).toHaveBeenCalledWith(a.id);
    expect(redis.invalidateProfile).toHaveBeenCalledWith(b.id);

    // perfil e foto somem nos dois sentidos (404 igual ao de quem não existe)
    await expect(cards.card({ id: a.id }, b.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(cards.card({ id: b.id }, a.id)).rejects.toBeInstanceOf(NotFoundException);
    // e o mapa não aponta mais pra conversa
    expect((await loadPeerSocial(db, a.id, [b.id])).get(b.id)?.conversation).toBeNull();
    expect((await loadPeerSocial(db, b.id, [a.id])).get(a.id)?.conversation).toBeNull();
  });

  it('bloquear de novo é idempotente: nenhuma linha, nenhum evento, data de arquivamento mantida', async () => {
    const a = await newUser('Caio');
    const b = await newUser('Duda');
    const conv = await conversation(a.id, b.id);
    await blocks.block(a.id, b.id);
    const before = await members(conv);
    jest.clearAllMocks();

    await blocks.block(a.id, b.id, 'de novo');
    expect(await prisma.block.count()).toBe(1);
    expect(gateway.emitToUsers).not.toHaveBeenCalled();
    expect(gateway.removeFromConversation).not.toHaveBeenCalled();
    expect((await members(conv)).map((m) => m.archivedAt?.getTime())).toEqual(
      before.map((m) => m.archivedAt?.getTime()),
    );

    // o outro sentido cria a linha dele, mas a conversa já saiu dos dois: sem evento
    await blocks.block(b.id, a.id);
    expect(await prisma.block.count()).toBe(2);
    expect(gateway.emitToUsers).not.toHaveBeenCalled();
  });

  it('quem já tinha arquivado mantém a data; o outro lado é arquivado e os dois recebem o evento', async () => {
    const a = await newUser('Eva');
    const b = await newUser('Fê');
    const conv = await conversation(a.id, b.id, { sent: 1, replies: 1, promoted: true });
    const old = new Date('2026-09-01T10:00:00Z');
    await prisma.conversationMember.update({
      where: { conversationId_userId: { conversationId: conv, userId: a.id } },
      data: { archivedAt: old },
    });

    await blocks.block(b.id, a.id);
    const ms = await members(conv);
    expect(ms.find((m) => m.userId === a.id)?.archivedAt?.getTime()).toBe(old.getTime());
    expect(ms.find((m) => m.userId === b.id)?.archivedAt).toBeInstanceOf(Date);
    expect(ms.every((m) => m.unreadCount === 0)).toBe(true);
    expect(gateway.emitToUsers).toHaveBeenCalledWith([b.id, a.id], 'conversation:removed', {
      conversationId: conv,
    });
  });

  it('bloquear sem conversa nenhuma funciona (só o Block e o cache dos perfis)', async () => {
    const a = await newUser('Gabi');
    const b = await newUser('Hugo');
    const r = await blocks.block(a.id, b.id, 'x'.repeat(300));
    expect(r).toMatchObject({ blockedId: b.id, reason: 'x'.repeat(255) });
    expect(typeof r.id).toBe('string'); // BigInt nunca sai cru
    expect(await prisma.block.count()).toBe(1);
    expect(await prisma.conversation.count()).toBe(0);
    expect(gateway.emitToUsers).not.toHaveBeenCalled();
    expect(redis.invalidateProfile).toHaveBeenCalledTimes(2);
  });

  it('desbloquear NÃO desarquiva: a conversa continua fora do inbox dos dois', async () => {
    const a = await newUser('Iara');
    const b = await newUser('João');
    const conv = await conversation(a.id, b.id, { sent: 1, replies: 1, promoted: true });
    await blocks.block(a.id, b.id);
    await blocks.unblock(a.id, b.id);

    expect(await prisma.block.count()).toBe(0);
    const ms = await members(conv);
    expect(ms.every((m) => m.archivedAt instanceof Date && m.unreadCount === 0)).toBe(true);
    expect(await visibleTo(a.id)).toEqual([]);
    expect(await visibleTo(b.id)).toEqual([]);
    // o cartão volta a abrir (o bloqueio saiu)
    await expect(cards.card({ id: a.id }, b.id)).resolves.toMatchObject({
      id: b.id,
      conversation: null,
    });
  });

  it('falha no meio da transação: nada gravado e nenhum evento (emit só depois do commit)', async () => {
    const a = await newUser('Kel');
    const b = await newUser('Lia');
    const conv = await conversation(a.id, b.id);
    // roda o callback de verdade e força o rollback no fim
    const spy = jest.spyOn(prisma, '$transaction').mockImplementationOnce((async (
      fn: (tx: unknown) => Promise<unknown>,
    ) =>
      prisma.$transaction(async (tx) => {
        await fn(tx);
        throw new Error('rollback forçado');
      })) as never);

    await expect(blocks.block(a.id, b.id)).rejects.toThrow('rollback forçado');
    spy.mockRestore();
    expect(await prisma.block.count()).toBe(0);
    expect((await members(conv)).some((m) => m.archivedAt === null)).toBe(true);
    expect(gateway.emitToUsers).not.toHaveBeenCalled();
    expect(gateway.removeFromConversation).not.toHaveBeenCalled();
    expect(redis.invalidateProfile).not.toHaveBeenCalled();
  });

  it('GET /blocks devolve nome + avatar, nunca a foto', async () => {
    const a = await newUser('Mel');
    const b = await newUser('Nina');
    await prisma.photo.create({
      data: {
        userId: b.id,
        url: 'http://localhost/uploads/b.jpg',
        status: 'approved',
        isMain: true,
        orderIndex: 0,
      },
    });
    await blocks.block(a.id, b.id);
    const list = await blocks.list(a.id);
    expect(list).toHaveLength(1);
    expect(list[0].user).toMatchObject({ id: b.id, name: 'Nina', mainPhotoUrl: null });
    expect(list[0].user.avatar).toBeTruthy();
    expect(JSON.stringify(list)).not.toContain('b.jpg');
  });
});

describe('bloqueio × InboxService (fluxo de verdade)', () => {
  const idsOf = (r: { items: { id: string }[] }) => r.items.map((c) => c.id);

  it('A pede, B bloqueia: some da Principal e das Solicitações dos DOIS, envio e reabertura dão 404', async () => {
    const a = await newUser('Ana');
    const b = await newUser('Bia');
    const { conversation } = await inbox.createConversation(a.id, b.id, 'oi, tudo bem?');
    const conv = conversation.id;
    const reqB = await inbox.list(b.id, 'requests');
    expect(idsOf(reqB)).toEqual([conv]);
    expect(reqB.items[0].unreadCount).toBe(1);
    expect(reqB.counts).toMatchObject({ requests: 1, unreadRequests: 1 });
    expect(idsOf(await inbox.list(a.id, 'inbox'))).toEqual([conv]); // quem pediu vê na principal ("aguardando")
    jest.clearAllMocks();

    await blocks.block(b.id, a.id);

    for (const [who, folder] of [
      [a.id, 'inbox'],
      [a.id, 'requests'],
      [b.id, 'inbox'],
      [b.id, 'requests'],
    ] as const) {
      const page = await inbox.list(who, folder);
      expect(idsOf(page)).toEqual([]);
      expect(page.counts).toEqual({ unreadInbox: 0, requests: 0, unreadRequests: 0 });
    }
    expect(gateway.emitToUsers).toHaveBeenCalledWith([b.id, a.id], 'conversation:removed', {
      conversationId: conv,
    });
    await expect(inbox.sendMessage(a.id, conv, 'oi?')).rejects.toBeInstanceOf(NotFoundException);
    await expect(inbox.sendMessage(b.id, conv, 'oi?')).rejects.toBeInstanceOf(NotFoundException);
    await expect(inbox.createConversation(a.id, b.id, 'de novo')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(inbox.createConversation(b.id, a.id, 'de novo')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(await prisma.message.count({ where: { conversationId: conv } })).toBe(1);
  });

  it('mensagem e bloqueio ao mesmo tempo: qualquer ordem termina arquivada pros dois com não lidas zeradas', async () => {
    for (let i = 0; i < 5; i++) {
      const a = await newUser(`Pede ${i}`);
      const b = await newUser(`Recebe ${i}`);
      const { conversation } = await inbox.createConversation(a.id, b.id, 'oi');
      const [sent, blocked] = await Promise.allSettled([
        inbox.sendMessage(b.id, conversation.id, 'resposta'),
        blocks.block(a.id, b.id),
      ]);
      expect(blocked.status).toBe('fulfilled');
      // a resposta ou entrou antes do bloqueio (e foi arquivada junto) ou deu 404 depois dele
      if (sent.status === 'rejected') expect(sent.reason).toBeInstanceOf(NotFoundException);
      const ms = await members(conversation.id);
      expect(ms.every((m) => m.archivedAt instanceof Date && m.unreadCount === 0)).toBe(true);
      expect(await prisma.message.count({ where: { conversationId: conversation.id } })).toBe(
        sent.status === 'fulfilled' ? 2 : 1,
      );
    }
  });
});

describe('banimento (ModerationService.act ban)', () => {
  it('arquiva todas as conversas da pessoa pros dois lados e avisa só os pares; as outras ficam', async () => {
    const mod = await newUser('Moderadora', { role: 'moderator' });
    const x = await newUser('Xis');
    const y = await newUser('Ypsilon');
    const z = await newUser('Zeta');
    const xy = await conversation(y.id, x.id, { sent: 2, replies: 1, promoted: true });
    const xz = await conversation(x.id, z.id, { sent: 1 }); // solicitação de X pra Z
    const yz = await conversation(y.id, z.id, { sent: 1, replies: 1, promoted: true });

    // no 1º invalidate a conta já está banida e as conversas ainda NÃO foram arquivadas (o guard barra antes)
    let atInvalidate: { status?: string; open: string[] } | null = null;
    accounts.invalidate.mockImplementationOnce(async () => {
      const u = await prisma.user.findUnique({
        where: { id: x.id },
        select: { accountStatus: true },
      });
      atInvalidate = { status: u?.accountStatus, open: await visibleTo(x.id) };
    });

    await moderation.act({ id: mod.id, role: 'moderator' }, x.id, {
      action: 'ban',
      reason: 'teste',
    });

    expect(atInvalidate).toEqual({ status: 'banned', open: expect.arrayContaining([xy, xz]) });
    expect(accounts.invalidate.mock.invocationCallOrder[0]).toBeLessThan(
      gateway.emitToUsers.mock.invocationCallOrder[0],
    );
    for (const conv of [xy, xz]) {
      const ms = await members(conv);
      expect(ms.every((m) => m.archivedAt instanceof Date && m.unreadCount === 0)).toBe(true);
    }
    expect((await members(yz)).every((m) => m.archivedAt === null)).toBe(true);
    expect(await visibleTo(y.id)).toEqual([yz]);
    expect(await visibleTo(z.id)).toEqual([yz]);

    const removed = gateway.emitToUsers.mock.calls.filter((c) => c[1] === 'conversation:removed');
    expect(removed.map((c) => c[2].conversationId).sort()).toEqual([xy, xz].sort());
    for (const c of removed) expect([...c[0]].sort()).toContain(x.id);
    expect(gateway.removeFromConversation).toHaveBeenCalledTimes(2);
    expect(gateway.disconnectUser).toHaveBeenCalledWith(x.id, expect.anything());

    // banir de novo não gera evento de conversa
    jest.clearAllMocks();
    await moderation.act({ id: mod.id, role: 'moderator' }, x.id, {
      action: 'ban',
      reason: 'de novo',
    });
    expect(
      gateway.emitToUsers.mock.calls.filter((c) => c[1] === 'conversation:removed'),
    ).toHaveLength(0);
  });

  it('userDetail acha as conversas citadas nas denúncias, só as da pessoa denunciada', async () => {
    const x = await newUser('Xis');
    const y = await newUser('Ypsilon');
    const z = await newUser('Zeta');
    const xy = await conversation(y.id, x.id, { sent: 2 });
    const xz = await conversation(x.id, z.id, { sent: 1, replies: 1, promoted: true });
    const yz = await conversation(y.id, z.id, { sent: 1 }); // não é de X: não pode aparecer
    await prisma.report.createMany({
      data: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          reporterId: y.id,
          reportedId: x.id,
          reason: 'harassment',
          context: { source: 'requests', conversationId: xy },
        },
        {
          id: '22222222-2222-4222-8222-222222222222',
          reporterId: z.id,
          reportedId: x.id,
          reason: 'spam',
          context: { source: 'chat', conversationId: xz },
        },
        {
          id: '33333333-3333-4333-8333-333333333333',
          reporterId: z.id,
          reportedId: x.id,
          reason: 'spam',
          context: { source: 'chat', conversationId: yz },
        },
      ],
    });

    const d = await moderation.userDetail(x.id);
    const byId = new Map(d.conversations.map((c) => [c.conversationId, c]));
    expect([...byId.keys()].sort()).toEqual([xy, xz].sort());
    expect(byId.get(xy)?.otherUserId).toBe(y.id);
    expect(
      byId
        .get(xy)
        ?.messages.map((m) => m.content)
        .sort(),
    ).toEqual(['oi 0', 'oi 1']);
    expect(byId.get(xz)?.otherUserId).toBe(z.id);
    expect(byId.get(xz)?.messages).toHaveLength(2);
  });

  it('userDetail lê denúncia de antes da inbox (context.matchId, origem matches): a conversa tem o mesmo id', async () => {
    const x = await newUser('Xis');
    const y = await newUser('Ypsilon');
    const z = await newUser('Zeta');
    const xy = await conversation(y.id, x.id, { sent: 2 });
    const yz = await conversation(y.id, z.id, { sent: 1 }); // não é de X: continua de fora
    await prisma.report.createMany({
      data: [
        {
          id: '44444444-4444-4444-8444-444444444444',
          reporterId: y.id,
          reportedId: x.id,
          reason: 'child_safety',
          context: { source: 'matches', matchId: xy.toUpperCase() },
        },
        {
          id: '55555555-5555-4555-8555-555555555555',
          reporterId: z.id,
          reportedId: x.id,
          reason: 'spam',
          context: { source: 'chat', matchId: yz },
        },
      ],
    });

    const d = await moderation.userDetail(x.id);
    expect(d.conversations.map((c) => c.conversationId)).toEqual([xy]);
    expect(d.conversations[0].otherUserId).toBe(y.id);
    expect(d.conversations[0].messages.map((m) => m.content).sort()).toEqual(['oi 0', 'oi 1']);
    // e a denúncia sai no formato de hoje pro app da moderação
    const ctx = new Map(d.reports.map((r) => [r.id, r.context]));
    expect(ctx.get('44444444-4444-4444-8444-444444444444')).toEqual({
      source: 'inbox',
      conversationId: xy,
    });
    expect(ctx.get('55555555-5555-4555-8555-555555555555')).toEqual({
      source: 'chat',
      conversationId: yz,
    });
  });
});

describe('cartão público e mapa (likeStatus + conversa do par)', () => {
  it('"já te curtiu" só pra Premium+ vigente; mútuo pra todos; pasta da conversa pelo papel de quem vê', async () => {
    const a = await newUser('Ana');
    const b = await newUser('Bia');
    await prisma.like.create({ data: { likerId: a.id, likedId: b.id } });

    // B grátis vendo A (que curtiu B): não vaza
    let card = await cards.card({ id: b.id }, a.id);
    expect(card).toMatchObject({
      likeStatus: 'NONE',
      likedMe: false,
      likedByMe: false,
      conversation: null,
    });
    expect(card).not.toHaveProperty('match');
    // horário exato da última atividade nunca sai no cartão (só a faixa lastSeen, pra quem tem direito)
    expect(card).not.toHaveProperty('lastActiveAt');
    expect(card.lastSeen).toBeNull();
    // A vendo B: SENT
    expect(await cards.card({ id: a.id }, b.id)).toMatchObject({
      likeStatus: 'SENT',
      likedByMe: true,
      likedMe: false,
    });

    // B Premium+ vigente vê; vencido não vê
    await prisma.user.update({
      where: { id: b.id },
      data: { premiumTier: 'premium_plus', premiumExpiresAt: new Date(Date.now() + 86_400_000) },
    });
    expect(await cards.card({ id: b.id }, a.id)).toMatchObject({
      likeStatus: 'RECEIVED',
      likedMe: true,
    });
    await prisma.user.update({
      where: { id: b.id },
      data: { premiumExpiresAt: new Date(Date.now() - 1000) },
    });
    expect(await cards.card({ id: b.id }, a.id)).toMatchObject({
      likeStatus: 'NONE',
      likedMe: false,
    });

    // A mandou a 1ª mensagem: pra A é principal ("aguardando"), pra B é solicitação
    const conv = await conversation(a.id, b.id);
    expect((await cards.card({ id: a.id }, b.id)).conversation).toEqual({
      id: conv,
      folder: 'inbox',
    });
    card = await cards.card({ id: b.id }, a.id);
    expect(card.conversation).toEqual({ id: conv, folder: 'requests' });

    // curtida mútua (a promoção é do InboxService; aqui só o status derivado + a pasta gravada)
    await prisma.like.create({ data: { likerId: b.id, likedId: a.id } });
    await prisma.conversation.update({
      where: { id: conv },
      data: { promotedAt: new Date(), promotedReason: 'mutual' },
    });
    card = await cards.card({ id: b.id }, a.id);
    expect(card).toMatchObject({
      likeStatus: 'MUTUAL',
      likedMe: true,
      conversation: { id: conv, folder: 'inbox' },
    });

    // /nearby usa a mesma consulta, em lote
    const c = await newUser('Caio');
    const social = await loadPeerSocial(db, b.id, [a.id, c.id, b.id]);
    expect(social.get(a.id)).toEqual({
      likedByMe: true,
      likeStatus: 'MUTUAL',
      conversation: { id: conv, folder: 'inbox' },
    });
    expect(social.get(c.id)).toEqual({ likedByMe: false, likeStatus: 'NONE', conversation: null });
    expect(social.has(b.id)).toBe(false); // eu mesma fora

    // arquivada por mim: o mapa não aponta pra ela
    await prisma.conversationMember.update({
      where: { conversationId_userId: { conversationId: conv, userId: b.id } },
      data: { archivedAt: new Date() },
    });
    expect((await loadPeerSocial(db, b.id, [a.id])).get(a.id)?.conversation).toBeNull();
  });
});

describe('curtida (LikesService): like_received só identifica quem pode saber', () => {
  const likeEvents = () => emitted().filter((e) => e.event === 'like_received');

  it('curtida não mútua: sem quem curtiu (só isSuper) fora do Premium+ vigente; Premium+ vigente recebe o id', async () => {
    const a = await newUser('Ana');
    const b = await newUser('Bia'); // grátis
    const c = await newUser('Cris', {
      premiumTier: 'premium_plus',
      premiumExpiresAt: new Date(Date.now() + 86_400_000),
    });
    const d = await newUser('Duda', { premiumTier: 'premium_plus', premiumExpiresAt: null });
    const e = await newUser('Eli', {
      premiumTier: 'premium_plus',
      premiumExpiresAt: new Date(Date.now() - 1000), // venceu
    });
    const f = await newUser('Fê', {
      premiumTier: 'premium',
      premiumExpiresAt: new Date(Date.now() + 86_400_000),
    });

    await likes.like(a.id, b.id);
    await likes.like(a.id, f.id, true); // super, plano sem "já te curtiu"
    await likes.like(a.id, e.id);
    await likes.like(a.id, c.id, true);
    await likes.like(a.id, d.id);

    expect(likeEvents().map((ev) => [ev.to, ev.payload])).toEqual([
      [[b.id], { isSuper: false }],
      [[f.id], { isSuper: true }],
      [[e.id], { isSuper: false }],
      [[c.id], { fromUserId: a.id, isSuper: true }],
      [[d.id], { fromUserId: a.id, isSuper: false }],
    ]);
    // nada do id de quem curtiu nos eventos sem identidade (nem com outro nome de campo)
    for (const ev of likeEvents().slice(0, 3))
      expect(JSON.stringify(ev.payload)).not.toContain(a.id);
  });

  it('curtida que fecha o mútuo: o id vai mesmo pra quem é grátis (MUTUAL aparece pra todos)', async () => {
    const a = await newUser('Ana');
    const b = await newUser('Bia');
    await likes.like(a.id, b.id);
    await likes.like(b.id, a.id);
    expect(likeEvents().map((ev) => [ev.to, ev.payload])).toEqual([
      [[b.id], { isSuper: false }],
      [[a.id], { fromUserId: b.id, isSuper: false, isMutual: true }],
    ]);
  });
});

describe('curtida × bloqueio (o Block é conferido de novo depois da trava do par)', () => {
  const forbiddenForBlocker = [
    'like_received',
    'match:new',
    'conversation:promoted',
    'message:new',
  ];
  const systemMessages = (conversationId: string) =>
    prisma.message.count({ where: { conversationId, systemKind: { not: null } } });
  const archivedForBoth = async (conversationId: string) =>
    (await members(conversationId)).every(
      (m) => m.archivedAt instanceof Date && m.unreadCount === 0,
    );

  it('bloqueio entra entre a checagem de fora e a trava: nada de curtida, promoção ou evento; a cota volta', async () => {
    const a = await newUser('Ana');
    const b = await newUser('Bia');
    await likes.like(a.id, b.id);
    const { conversation: conv } = await inbox.createConversation(a.id, b.id, 'oi');
    jest.clearAllMocks();

    // a checagem de fora já passou (sem Block); o bloqueio commita antes da transação da curtida pegar a trava
    const realIncr = redis.incrRate;
    const incr = jest
      .spyOn(redis, 'incrRate')
      .mockImplementationOnce(async (userId: string, action: string) => {
        await blocks.block(a.id, b.id);
        return realIncr(userId, action);
      });
    try {
      await expect(likes.like(b.id, a.id)).rejects.toBeInstanceOf(BadRequestException);
    } finally {
      incr.mockRestore();
    }

    expect(await prisma.like.count({ where: { likerId: b.id, likedId: a.id } })).toBe(0);
    const c = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    expect(c.promotedAt).toBeNull();
    expect(await systemMessages(conv.id)).toBe(0);
    expect(counters.get(`rate:${b.id}:like`)).toBe(0); // a curtida recusada não gastou cota
    // só o bloqueio falou com alguém
    expect(emitted().map((e) => e.event)).toEqual(['conversation:removed']);
    expect(await archivedForBoth(conv.id)).toBe(true);
  });

  it('ao mesmo tempo, em vários pares: ou a curtida entra ANTES do bloqueio, ou é recusada sem gravar nada', async () => {
    for (let i = 0; i < 8; i++) {
      const a = await newUser(`Bloqueia ${i}`);
      const b = await newUser(`Curte ${i}`);
      await likes.like(a.id, b.id);
      const { conversation: conv } = await inbox.createConversation(a.id, b.id, 'oi');
      jest.clearAllMocks();

      const [liked, blocked] = await Promise.allSettled([
        likes.like(b.id, a.id),
        blocks.block(a.id, b.id),
      ]);
      expect(blocked.status).toBe('fulfilled');

      const likeBA = await prisma.like.count({ where: { likerId: b.id, likedId: a.id } });
      const c = await prisma.conversation.findUniqueOrThrow({ where: { id: conv.id } });
      const events = emitted();
      const removedAt = events.findIndex((e) => e.event === 'conversation:removed');
      expect(removedAt).toBeGreaterThanOrEqual(0);
      // quem bloqueou não recebe nada da curtida DEPOIS do conversation:removed
      const late = events
        .slice(removedAt + 1)
        .filter((e) => e.to.includes(a.id) && forbiddenForBlocker.includes(e.event));
      expect(late).toEqual([]);

      if (liked.status === 'rejected') {
        expect(liked.reason).toBeInstanceOf(BadRequestException);
        expect(likeBA).toBe(0);
        expect(c.promotedAt).toBeNull();
        expect(await systemMessages(conv.id)).toBe(0);
        expect(events.filter((e) => forbiddenForBlocker.includes(e.event))).toEqual([]);
      } else {
        // a curtida pegou a trava primeiro: mútua legítima e promovida; o bloqueio arquivou depois
        expect(likeBA).toBe(1);
        expect(c.promotedAt).toBeInstanceOf(Date);
        expect(await systemMessages(conv.id)).toBe(1);
      }
      // em qualquer ordem o bloqueio vale: arquivada pros dois, não lidas zeradas
      expect(await archivedForBoth(conv.id)).toBe(true);
    }
  });
});
