import { HttpException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import type { PrismaService } from '../../src/database/prisma.service';
import { BlocksService } from '../../src/modules/blocks/blocks.service';
import { MUTUAL_LIKE_TEXT } from '../../src/modules/inbox/inbox.mapper';
import { lockPair } from '../../src/modules/inbox/inbox.queries';
import { InboxService } from '../../src/modules/inbox/inbox.service';
import { LikesService } from '../../src/modules/likes/likes.service';
import {
  PushService,
  type PushMessage,
  type PushOutcome,
} from '../../src/modules/notifications/push.service';
import { SocialPushService } from '../../src/modules/notifications/social-push.service';
import type { ChatGateway } from '../../src/realtime/chat.gateway';
import type { RedisService } from '../../src/redis/redis.service';

import { assertTestDatabase } from './env';

// InboxService + LikesService (+ BlocksService) contra o banco de TESTE (cruzei_test), sem Nest: Prisma de verdade,
// Redis e gateway falsos (o gateway falso guarda cada emit pra conferir QUEM recebeu O QUÊ e QUANTAS vezes).
// Banco fora do ar = teste FALHA. Recriar: bash test/db/setup-test-db.sh

const prisma = new PrismaClient();
const db = prisma as unknown as PrismaService;

// ---------- falsos ----------

/** Redis em memória com o que os services usam (set NX EX, get, del, incr/decr, expire, ttl, incrRate) */
class FakeRedis {
  private readonly store = new Map<string, { v: string; exp: number | null }>();
  readonly invalidated: string[] = [];
  private read(k: string): string | null {
    const e = this.store.get(k);
    if (!e) return null;
    if (e.exp != null && e.exp <= Date.now()) {
      this.store.delete(k);
      return null;
    }
    return e.v;
  }
  private write(k: string, v: string, exp: number | null) {
    this.store.set(k, { v, exp });
  }
  readonly client = {
    get: async (k: string) => this.read(k),
    set: async (k: string, v: string | number, ...args: (string | number)[]) => {
      const ex = args.indexOf('EX');
      const ttl = ex >= 0 ? Number(args[ex + 1]) : null;
      if (args.includes('NX') && this.read(k) != null) return null;
      this.write(k, String(v), ttl ? Date.now() + ttl * 1000 : null);
      return 'OK';
    },
    del: async (...keys: string[]) => keys.filter((k) => this.store.delete(k)).length,
    incr: async (k: string) => {
      const n = Number(this.read(k) ?? 0) + 1;
      this.write(k, String(n), this.store.get(k)?.exp ?? null);
      return n;
    },
    decr: async (k: string) => {
      const n = Number(this.read(k) ?? 0) - 1;
      this.write(k, String(n), this.store.get(k)?.exp ?? null);
      return n;
    },
    expire: async (k: string, s: number) => {
      const v = this.read(k);
      if (v == null) return 0;
      this.write(k, v, Date.now() + s * 1000);
      return 1;
    },
    ttl: async (k: string) => {
      if (this.read(k) == null) return -2;
      const e = this.store.get(k)!;
      return e.exp == null ? -1 : Math.ceil((e.exp - Date.now()) / 1000);
    },
  };
  async incrRate(userId: string, action: string, ttlSeconds = 86_400) {
    const key = `rate:${userId}:${action}`;
    const n = await this.client.incr(key);
    if (n === 1) await this.client.expire(key, ttlSeconds);
    return n;
  }
  async invalidateProfile(userId: string) {
    this.invalidated.push(userId);
  }
  async publishCandidateInvalidation() {}
  /** preenche um contador de rate limit (simula quem já gastou a cota) */
  async preset(key: string, n: number, ttl = 60) {
    this.write(key, String(n), Date.now() + ttl * 1000);
  }
}

interface Emitted {
  to: string[];
  event: string;
  payload: Record<string, unknown>;
}

function fakeGateway() {
  const emitted: Emitted[] = [];
  const left: { conversationId: string; userIds: string[] }[] = [];
  return {
    emitted,
    left,
    emitToUser: jest.fn((id: string, event: string, payload: unknown) => {
      emitted.push({ to: [id], event, payload: payload as Record<string, unknown> });
    }),
    emitToUsers: jest.fn((ids: string[], event: string, payload: unknown) => {
      emitted.push({ to: [...ids], event, payload: payload as Record<string, unknown> });
    }),
    removeFromConversation: jest.fn((conversationId: string, userIds: string[]) => {
      left.push({ conversationId, userIds: [...userIds] });
    }),
    reset() {
      emitted.length = 0;
      left.length = 0;
    },
  };
}

/**
 * Prisma cujo `tx` de $transaction lança erro num método (ex.: conversation.update, que roda DEPOIS do insert da
 * mensagem): prova que o rollback desfaz tudo e que nenhum evento sai.
 */
function failingPrisma(model: string, method: string): PrismaService {
  const boom = () => {
    throw new Error('falha forçada');
  };
  const wrapTx = (tx: object) =>
    new Proxy(tx, {
      get(t, p) {
        const v = Reflect.get(t, p) as unknown;
        if (p === model && v && typeof v === 'object') {
          return new Proxy(v, {
            get(m, q) {
              if (q === method) return boom;
              const f = Reflect.get(m, q) as unknown;
              return typeof f === 'function' ? (f as (...a: unknown[]) => unknown).bind(m) : f;
            },
          });
        }
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
      },
    });
  return new Proxy(prisma, {
    get(target, prop) {
      if (prop === '$transaction') {
        return (fn: (tx: unknown) => Promise<unknown>, opts?: object) =>
          (
            target.$transaction as (
              f: (tx: object) => Promise<unknown>,
              o?: object,
            ) => Promise<unknown>
          )((tx) => fn(wrapTx(tx)), opts);
      }
      const v = Reflect.get(target, prop) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  }) as unknown as PrismaService;
}

// ---------- montagem ----------

let redis: FakeRedis;
let gw: ReturnType<typeof fakeGateway>;
let inbox: InboxService;
let likes: LikesService;
let blocks: BlocksService;

function build(p: PrismaService = db) {
  const i = new InboxService(p, redis as unknown as RedisService, gw as unknown as ChatGateway);
  return {
    inbox: i,
    likes: new LikesService(p, redis as unknown as RedisService, gw as unknown as ChatGateway, i),
  };
}

// TRUNCATE não dispara o trigger de linha do audit_log (deleteMany de usuário falharia)
const resetDb = () =>
  prisma.$executeRawUnsafe('TRUNCATE conversations, users RESTART IDENTITY CASCADE');

type UserExtra = Partial<{
  visibilityMode: 'visible' | 'anonymous';
  isPaused: boolean;
  pausedUntil: Date | null;
  accountStatus: 'active' | 'suspended' | 'banned';
  reviewHoldAt: Date | null;
  deletedAt: Date | null;
  premiumTier: 'free' | 'premium' | 'premium_plus';
  premiumExpiresAt: Date | null;
}>;

async function newUser(name: string, extra: UserExtra = {}): Promise<string> {
  const u = await prisma.user.create({
    data: {
      name,
      birthDate: new Date('1995-05-10'),
      gender: 'female',
      visibilityMode: 'visible',
      ...extra,
    },
    select: { id: true },
  });
  return u.id;
}

const of = (event: string) => gw.emitted.filter((e) => e.event === event);
const sorted = (ids: string[]) => [...ids].sort();

/** a promessa rejeita com HttpException desse status (e, se dado, desse `error`) */
async function expectHttp(
  p: Promise<unknown>,
  status: number,
  error?: string,
): Promise<Record<string, unknown>> {
  const err = await p.then(
    () => {
      throw new Error(`esperava HTTP ${status}, mas deu certo`);
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(HttpException);
  const h = err as HttpException;
  expect(h.getStatus()).toBe(status);
  const body = h.getResponse() as Record<string, unknown>;
  if (error) expect(body.error).toBe(error);
  return body;
}

const memberOf = (conversationId: string, userId: string) =>
  prisma.conversationMember.findUniqueOrThrow({
    where: { conversationId_userId: { conversationId, userId } },
  });
const systemMessages = (conversationId: string) =>
  prisma.message.findMany({ where: { conversationId, systemKind: { not: null } } });

/** espera até alguém ficar parado numa trava advisory (o envio esperando a trava do par) */
async function waitForAdvisoryWaiter(timeoutMs = 5_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const [r] = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_locks
       WHERE locktype = 'advisory' AND NOT granted
         AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`;
    if (r.n > 0) return;
    await new Promise((res) => setTimeout(res, 25));
  }
  throw new Error('ninguém ficou esperando a trava do par');
}

beforeAll(async () => {
  await assertTestDatabase(prisma);
});

beforeEach(async () => {
  await resetDb();
  redis = new FakeRedis();
  gw = fakeGateway();
  ({ inbox, likes } = build());
  blocks = new BlocksService(db, redis as unknown as RedisService, gw as unknown as ChatGateway);
});

afterAll(async () => {
  await resetDb();
  await prisma.$disconnect();
});

// =================================================================================================
describe('fluxo completo: solicitação → resposta → principal', () => {
  it('A abre com B: principal de A (aguardando), solicitações de B com 1 não lida; B responde e vai pra principal', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');

    const { conversation, message } = await inbox.createConversation(
      ana,
      bia,
      '  oi, tudo bem?  ',
      'cid-1',
    );
    const conv = conversation.id;
    expect(message).toMatchObject({
      body: 'oi, tudo bem?',
      senderId: ana,
      clientId: 'cid-1',
      systemKind: null,
    });
    expect(conversation).toMatchObject({
      folder: 'inbox',
      route: 'request',
      myRole: 'REQUESTER',
      awaitingReply: true,
      unreadCount: 0,
      promotedAt: null,
      likeStatus: 'NONE',
      peer: { id: bia, name: 'Bia', mainPhotoUrl: null },
    });

    // eventos: conversation:new por lado + message:new por lado (clientId só pra quem enviou); nada de promoção
    expect(sorted(of('conversation:new').map((e) => e.to[0]))).toEqual(sorted([ana, bia]));
    expect(of('conversation:new').every((e) => e.to.length === 1)).toBe(true);
    const [toAna, toBia] = of('message:new');
    expect(toAna).toMatchObject({
      to: [ana],
      payload: { conversationId: conv, unreadCount: 0, message: { clientId: 'cid-1' } },
    });
    expect(toBia.to).toEqual([bia]);
    expect(toBia.payload).toMatchObject({ conversationId: conv, unreadCount: 1 });
    expect((toBia.payload.message as Record<string, unknown>).clientId).toBeUndefined();
    expect(of('conversation:promoted')).toHaveLength(0);

    // listas: A vê na principal; B vê em solicitações, com prévia e 1 não lida
    const anaInbox = await inbox.list(ana, 'inbox');
    expect(anaInbox.items.map((c) => c.id)).toEqual([conv]);
    expect((await inbox.list(ana, 'requests')).items).toEqual([]);
    const biaReq = await inbox.list(bia, 'requests');
    expect(biaReq.items).toHaveLength(1);
    expect(biaReq.items[0]).toMatchObject({
      id: conv,
      folder: 'requests',
      myRole: 'RECIPIENT',
      unreadCount: 1,
      awaitingReply: false,
    });
    expect(biaReq.items[0].lastMessage?.body).toBe('oi, tudo bem?');
    expect(biaReq.counts).toEqual({ unreadInbox: 0, requests: 1, unreadRequests: 1 });
    expect((await inbox.list(bia, 'inbox')).items).toEqual([]);

    // B abre a solicitação: o badge DELA zera, mas A não fica sabendo (sem readAt, "lida" só pros aparelhos de B)
    gw.reset();
    expect(await inbox.markRead(bia, conv)).toEqual({ unreadCount: 0, readAt: null });
    expect((await memberOf(conv, bia)).unreadCount).toBe(0);
    expect(
      await prisma.message.count({ where: { conversationId: conv, readAt: { not: null } } }),
    ).toBe(0);
    expect(of('message:read').map((e) => e.to)).toEqual([[bia]]);

    // B responde → bounce (mensagem dos dois lados) → principal pros dois, 1 evento de promoção, sem mensagem de sistema
    gw.reset();
    await inbox.sendMessage(bia, conv, 'oi! tudo e você?');
    const promoted = of('conversation:promoted');
    expect(promoted).toHaveLength(1);
    expect(sorted(promoted[0].to)).toEqual(sorted([ana, bia]));
    expect(promoted[0].payload).toMatchObject({ conversationId: conv, reason: 'bounce' });
    expect(await systemMessages(conv)).toHaveLength(0);

    expect((await inbox.list(bia, 'requests')).items).toEqual([]);
    const biaInbox = await inbox.list(bia, 'inbox');
    expect(biaInbox.items[0]).toMatchObject({
      id: conv,
      folder: 'inbox',
      route: 'principal',
      promotedReason: 'bounce',
    });
    const anaNow = await inbox.getConversation(ana, conv);
    expect(anaNow).toMatchObject({
      awaitingReply: false,
      unreadCount: 1,
      requestMessagesLeft: null,
      archivedAt: null,
    });

    // aceita: agora "lida" grava readAt e avisa os dois
    gw.reset();
    const read = await inbox.markRead(bia, conv);
    expect(read.readAt).not.toBeNull();
    const first = await prisma.message.findFirstOrThrow({
      where: { conversationId: conv, senderId: ana },
    });
    expect(first.readAt).not.toBeNull();
    expect(sorted(of('message:read')[0].to)).toEqual(sorted([bia, ana]));
    expect(of('message:read')[0].payload).toMatchObject({
      conversationId: conv,
      readerId: bia,
      upToMessageId: null,
    });

    // histórico em ordem crescente
    const history = await inbox.listMessages(ana, conv);
    expect(history.map((m) => m.body)).toEqual(['oi, tudo bem?', 'oi! tudo e você?']);
  });

  it('REQUESTER manda no máximo 3 até a primeira resposta (429 awaiting_reply); quem recebeu sempre responde', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    const { conversation } = await inbox.createConversation(ana, bia, '1');
    const conv = conversation.id;
    expect((await inbox.getConversation(ana, conv)).requestMessagesLeft).toBe(2);
    await inbox.sendMessage(ana, conv, '2');
    await inbox.sendMessage(ana, conv, '3');
    expect((await inbox.getConversation(ana, conv)).requestMessagesLeft).toBe(0);

    gw.reset();
    const body = await expectHttp(inbox.sendMessage(ana, conv, '4'), 429, 'awaiting_reply');
    expect(body.retryAfter).toBeNull();
    expect(gw.emitted).toHaveLength(0);
    expect(await prisma.message.count({ where: { conversationId: conv } })).toBe(3);
    // POST /conversations de novo (reuso da conversa do par) também respeita o teto
    await expectHttp(inbox.createConversation(ana, bia, '4 de novo'), 429, 'awaiting_reply');

    await inbox.sendMessage(bia, conv, 'oi');
    await inbox.sendMessage(ana, conv, '4 agora vai');
    expect(await prisma.message.count({ where: { conversationId: conv } })).toBe(5);
    expect((await memberOf(conv, bia)).unreadCount).toBe(4);
  });

  it('"Mover para principal": só quem recebeu (403 pro REQUESTER), idempotente, 1 evento', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    const conv = (await inbox.createConversation(ana, bia, 'oi')).conversation.id;
    gw.reset();

    await expectHttp(inbox.promoteManual(ana, conv), 403, 'not_recipient');
    const s = await inbox.promoteManual(bia, conv);
    expect(s).toMatchObject({ folder: 'inbox', route: 'principal', promotedReason: 'manual' });
    const again = await inbox.promoteManual(bia, conv);
    expect(again.promotedAt).toBe(s.promotedAt);
    expect(of('conversation:promoted')).toHaveLength(1);
    expect(of('conversation:promoted')[0].payload).toMatchObject({ reason: 'manual' });

    // depois de aceitar, "lida" vale
    expect((await inbox.markRead(bia, conv)).readAt).not.toBeNull();
    // e o REQUESTER não trava mais em 3 (conversa na principal)
    await inbox.sendMessage(ana, conv, '2');
    await inbox.sendMessage(ana, conv, '3');
    await inbox.sendMessage(ana, conv, '4');
    expect(await prisma.message.count({ where: { conversationId: conv } })).toBe(4);
  });
});

// =================================================================================================
describe('idempotência e concorrência', () => {
  it('reavaliar 2x → 1 mensagem de sistema, 1 conversation:promoted, promotedAt inalterado', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    const conv = (await inbox.createConversation(ana, bia, 'oi')).conversation.id;
    // curtidas gravadas por fora (sem passar pelo like()): só a reavaliação promove
    await prisma.like.createMany({
      data: [
        { likerId: ana, likedId: bia },
        { likerId: bia, likedId: ana },
      ],
    });
    gw.reset();

    expect(await inbox.reevaluate(conv)).toEqual({ promoted: true });
    const first = await prisma.conversation.findUniqueOrThrow({ where: { id: conv } });
    expect(await inbox.reevaluate(conv)).toEqual({ promoted: false });
    const second = await prisma.conversation.findUniqueOrThrow({ where: { id: conv } });

    expect(first.promotedAt).not.toBeNull();
    expect(second.promotedAt?.getTime()).toBe(first.promotedAt?.getTime());
    expect(second.promotedReason).toBe('mutual');
    const sys = await systemMessages(conv);
    expect(sys).toHaveLength(1);
    expect(sys[0]).toMatchObject({
      systemKind: 'mutual_like',
      messageType: 'system',
      body: MUTUAL_LIKE_TEXT,
    });
    expect(of('conversation:promoted')).toHaveLength(1);
    // mensagem de sistema: um message:new por lado, sem somar não lidas
    expect(of('message:new')).toHaveLength(2);
    expect((await memberOf(conv, ana)).unreadCount).toBe(0);
    expect((await memberOf(conv, bia)).unreadCount).toBe(1);
  });

  it('curtida mútua pelo LikesService promove a conversa + "Vocês se curtiram"; curtir de novo não duplica', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    const conv = (await inbox.createConversation(ana, bia, 'oi')).conversation.id;

    const r1 = await likes.like(ana, bia);
    expect(r1).toMatchObject({ likeStatus: 'SENT', isMutual: false, promotedConversationIds: [] });
    gw.reset();
    const r2 = await likes.like(bia, ana);
    expect(r2).toMatchObject({
      likeStatus: 'MUTUAL',
      isMutual: true,
      promotedConversationIds: [conv],
    });
    expect(of('conversation:promoted')).toHaveLength(1);
    expect(of('conversation:promoted')[0].payload).toMatchObject({ reason: 'mutual' });
    expect(
      of('message:new').map((e) => (e.payload.message as Record<string, unknown>).systemKind),
    ).toEqual(['mutual_like', 'mutual_like']);
    expect(of('like_received')).toEqual([
      {
        to: [ana],
        event: 'like_received',
        payload: { fromUserId: bia, isSuper: false, isMutual: true },
      },
    ]);
    // eventos da conversa saem antes do aviso da curtida; por último a comemoração pra quem curtiu primeiro
    expect(gw.emitted.map((e) => e.event)).toEqual([
      'conversation:promoted',
      'message:new',
      'message:new',
      'like_received',
      'match:new',
    ]);
    expect(of('match:new')).toEqual([
      {
        to: [ana],
        event: 'match:new',
        payload: {
          peer: { id: bia, name: 'Bia', avatar: expect.any(Object), mainPhotoUrl: null },
          conversationId: conv,
          matchedAt: expect.any(String),
        },
      },
    ]);

    gw.reset();
    const r3 = await likes.like(bia, ana); // toque duplo
    expect(r3).toMatchObject({ likeStatus: 'MUTUAL', isMutual: true, promotedConversationIds: [] });
    expect(await inbox.reevaluate(conv)).toEqual({ promoted: false });
    expect(gw.emitted).toHaveLength(0);
    expect(await systemMessages(conv)).toHaveLength(1);
    expect(await prisma.like.count()).toBe(2);

    // na principal dos dois, com a mensagem de sistema como prévia
    const biaInbox = await inbox.list(bia, 'inbox');
    expect(biaInbox.items[0]).toMatchObject({
      id: conv,
      likeStatus: 'MUTUAL',
      promotedReason: 'mutual',
    });
    expect(biaInbox.items[0].lastMessage).toMatchObject({
      systemKind: 'mutual_like',
      body: MUTUAL_LIKE_TEXT,
    });
  });

  it('curtida mútua sem conversa não cria conversa; a 1ª mensagem depois já nasce na principal', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    await likes.like(ana, bia);
    const r = await likes.like(bia, ana);
    expect(r).toMatchObject({ isMutual: true, promotedConversationIds: [] });
    expect(await prisma.conversation.count()).toBe(0);

    gw.reset();
    const { conversation } = await inbox.createConversation(ana, bia, 'deu match!');
    expect(conversation).toMatchObject({
      route: 'principal',
      promotedReason: 'mutual',
      awaitingReply: false,
    });
    expect(await systemMessages(conversation.id)).toHaveLength(1);
    expect((await inbox.list(bia, 'inbox')).items.map((c) => c.id)).toEqual([conversation.id]);
    expect(of('conversation:promoted')).toHaveLength(1);
  });

  it('curtida e resposta ao mesmo tempo → exatamente 1 promoção (5 pares)', async () => {
    for (let i = 0; i < 5; i++) {
      const a = await newUser(`A${i}`);
      const b = await newUser(`B${i}`);
      const conv = (await inbox.createConversation(a, b, 'oi')).conversation.id;
      await likes.like(a, b);
      gw.reset();

      await Promise.all([likes.like(b, a), inbox.sendMessage(b, conv, 'oi de volta')]);

      const c = await prisma.conversation.findUniqueOrThrow({ where: { id: conv } });
      expect(c.promotedAt).not.toBeNull();
      expect(of('conversation:promoted')).toHaveLength(1);
      // quem chegou primeiro decide o motivo; mensagem de sistema só quando foi a curtida
      const sys = await systemMessages(conv);
      expect(sys).toHaveLength(c.promotedReason === 'mutual' ? 1 : 0);
      expect(['mutual', 'bounce']).toContain(c.promotedReason);
      expect(
        await prisma.message.count({ where: { conversationId: conv, systemKind: null } }),
      ).toBe(2);
    }
  });

  it('2 POST /conversations simultâneos do mesmo par → 1 conversa (e a cota diária conta 1)', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    const [r1, r2] = await Promise.all([
      inbox.createConversation(ana, bia, 'oi 1'),
      inbox.createConversation(ana, bia, 'oi 2'),
    ]);
    expect(r1.conversation.id).toBe(r2.conversation.id);
    expect(await prisma.conversation.count()).toBe(1);
    expect(await prisma.conversationMember.count()).toBe(2);
    expect(await prisma.message.count()).toBe(2);
    expect(of('conversation:new')).toHaveLength(2); // um por lado, só de quem criou
    expect(await redis.client.get(`rate:${ana}:conv:new`)).toBe('1');
    expect((await memberOf(r1.conversation.id, bia)).unreadCount).toBe(2);
  });

  it('os dois lados abrem ao mesmo tempo → 1 conversa, papéis distintos e já na principal (mensagem dos dois lados)', async () => {
    const caio = await newUser('Caio');
    const duda = await newUser('Duda');
    await Promise.all([
      inbox.createConversation(caio, duda, 'oi Duda'),
      inbox.createConversation(duda, caio, 'oi Caio'),
    ]);
    const [conv] = await prisma.conversation.findMany({ include: { members: true } });
    expect(await prisma.conversation.count()).toBe(1);
    expect(conv.members.map((m) => m.role).sort()).toEqual(['RECIPIENT', 'REQUESTER']);
    expect(conv.promotedReason).toBe('bounce');
    expect(of('conversation:promoted')).toHaveLength(1);
  });

  it('rollback forçado depois do insert → nada gravado, 0 eventos, clientId liberado', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    const conv = (await inbox.createConversation(ana, bia, 'oi')).conversation.id;
    const before = await prisma.message.count();
    gw.reset();

    // conversation.update roda depois do insert da mensagem (last_message_at)
    const broken = build(failingPrisma('conversation', 'update'));
    await expect(broken.inbox.sendMessage(ana, conv, 'vai falhar', 'cid-x')).rejects.toThrow(
      'falha forçada',
    );
    expect(gw.emitted).toHaveLength(0);
    expect(gw.left).toHaveLength(0);
    expect(await prisma.message.count()).toBe(before);
    expect((await memberOf(conv, bia)).unreadCount).toBe(1);

    // o mesmo clientId depois da falha grava normalmente (a chave pending foi solta)
    const ok = await inbox.sendMessage(ana, conv, 'agora vai', 'cid-x');
    expect(ok.body).toBe('agora vai');
    expect(await prisma.message.count()).toBe(before + 1);
  });

  it('rollback forçado na promoção da curtida → curtida desfeita e 0 eventos', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    const conv = (await inbox.createConversation(ana, bia, 'oi')).conversation.id;
    await likes.like(ana, bia);
    gw.reset();

    const broken = build(failingPrisma('conversation', 'updateMany'));
    await expect(broken.likes.like(bia, ana)).rejects.toThrow('falha forçada');
    expect(gw.emitted).toHaveLength(0);
    expect(await prisma.like.count({ where: { likerId: bia } })).toBe(0);
    expect(
      (await prisma.conversation.findUniqueOrThrow({ where: { id: conv } })).promotedAt,
    ).toBeNull();
    expect(await systemMessages(conv)).toHaveLength(0);
  });

  it('clientId repetido devolve a mesma mensagem (abrir e enviar)', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    const a = await inbox.createConversation(ana, bia, 'oi', 'dup-1');
    const b = await inbox.createConversation(ana, bia, 'oi', 'dup-1');
    expect(b.message.id).toBe(a.message.id);
    expect(b.conversation.id).toBe(a.conversation.id);
    const m1 = await inbox.sendMessage(ana, a.conversation.id, 'de novo', 'dup-2');
    const m2 = await inbox.sendMessage(ana, a.conversation.id, 'de novo', 'dup-2');
    expect(m2.id).toBe(m1.id);
    expect(m2.clientId).toBe('dup-2');
    expect(await prisma.message.count()).toBe(2);
  });
});

// =================================================================================================
describe('reenvio pelo clientId: uma chave só por remetente, nas duas rotas', () => {
  it('1ª mensagem saiu pelo POST /conversations, resposta perdida; reenvio pelo /messages devolve a MESMA (sem duplicar nem gastar)', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    const first = await inbox.createConversation(ana, bia, 'oi, tudo bem?', 'c_1');
    const conv = first.conversation.id;
    const msgRate = await redis.client.get(`rate:${ana}:msg`);
    gw.reset();

    // o app descobriu a conversa pelo socket (conversation:new) e reenvia o balão que "falhou" pela outra rota
    const again = await inbox.sendMessage(ana, conv, 'oi, tudo bem?', 'c_1');
    expect(again).toMatchObject({ id: first.message.id, clientId: 'c_1', body: 'oi, tudo bem?' });
    expect(await prisma.message.count({ where: { conversationId: conv } })).toBe(1);
    expect(gw.emitted).toHaveLength(0);
    expect((await memberOf(conv, bia)).unreadCount).toBe(1);
    // não gastou 1 das 3 do REQUESTER nem o limite por minuto
    expect((await inbox.getConversation(ana, conv)).requestMessagesLeft).toBe(2);
    expect(await redis.client.get(`rate:${ana}:msg`)).toBe(msgRate);

    // e o caminho inverso: saiu pelo /messages, reenviado pelo POST /conversations
    const m2 = await inbox.sendMessage(ana, conv, 'tá por aí?', 'c_2');
    gw.reset();
    const viaCreate = await inbox.createConversation(ana, bia, 'tá por aí?', 'c_2');
    expect(viaCreate.message).toMatchObject({ id: m2.id, clientId: 'c_2' });
    expect(viaCreate.conversation).toMatchObject({ id: conv, myRole: 'REQUESTER' });
    expect(await prisma.message.count({ where: { conversationId: conv } })).toBe(2);
    expect(gw.emitted).toHaveLength(0);

    // a 3ª (última antes da resposta) reenviada não cai no 429 awaiting_reply: é a mesma mensagem
    const m3 = await inbox.sendMessage(ana, conv, 'última', 'c_3');
    await expect(inbox.sendMessage(ana, conv, 'última', 'c_3')).resolves.toMatchObject({
      id: m3.id,
    });
    await expect(inbox.createConversation(ana, bia, 'última', 'c_3')).resolves.toMatchObject({
      message: { id: m3.id },
    });
    await expectHttp(inbox.sendMessage(ana, conv, 'quarta', 'c_4'), 429, 'awaiting_reply');
    expect(await prisma.message.count({ where: { conversationId: conv } })).toBe(3);

    // gravação por SQL cru: created_at igual ao last_message_at que o Prisma gravou com o mesmo instante
    const last = await prisma.message.findUniqueOrThrow({ where: { id: m3.id } });
    const c = await prisma.conversation.findUniqueOrThrow({ where: { id: conv } });
    expect(last.createdAt.getTime()).toBe(c.lastMessageAt?.getTime());
    expect(last.clientId).toBe('c_3');
  });

  it('histórico e lastMessage trazem o clientId só nas MINHAS mensagens', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    const conv = (await inbox.createConversation(ana, bia, 'oi', 'a_1')).conversation.id;
    await inbox.sendMessage(bia, conv, 'oi!', 'b_1');
    await inbox.sendMessage(ana, conv, 'sem clientId');

    const forAna = await inbox.listMessages(ana, conv);
    expect(forAna.map((m) => [m.body, m.clientId])).toEqual([
      ['oi', 'a_1'],
      ['oi!', undefined],
      ['sem clientId', undefined],
    ]);
    expect(forAna.every((m) => m.senderId === ana || !('clientId' in m))).toBe(true);
    const forBia = await inbox.listMessages(bia, conv);
    expect(forBia.map((m) => m.clientId)).toEqual([undefined, 'b_1', undefined]);

    // lastMessage do resumo: minha → com clientId; do outro → sem
    await inbox.sendMessage(bia, conv, 'e aí', 'b_2');
    expect((await inbox.getConversation(bia, conv)).lastMessage?.clientId).toBe('b_2');
    const anaView = await inbox.getConversation(ana, conv);
    expect(anaView.lastMessage?.body).toBe('e aí');
    expect(anaView.lastMessage && 'clientId' in anaView.lastMessage).toBe(false);
  });

  it('o mesmo clientId ao mesmo tempo (nas duas rotas) → 1 mensagem só', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    const conv = (await inbox.createConversation(ana, bia, 'oi')).conversation.id;
    await inbox.sendMessage(bia, conv, 'oi!'); // principal: o teto de 3 não interfere

    const [a, b] = await Promise.all([
      inbox.sendMessage(ana, conv, 'junto', 'par_1'),
      inbox.sendMessage(ana, conv, 'junto', 'par_1'),
    ]);
    expect(b.id).toBe(a.id);
    const [c, d] = await Promise.all([
      inbox.createConversation(ana, bia, 'cruzado', 'par_2'),
      inbox.sendMessage(ana, conv, 'cruzado', 'par_2'),
    ]);
    expect(d.id).toBe(c.message.id);
    expect(await prisma.message.count({ where: { conversationId: conv, senderId: ana } })).toBe(3);
    // cada envio real soltou 1 message:new por lado; os reenvios, nenhum
    expect(of('message:new').filter((e) => e.to[0] === bia)).toHaveLength(4);
  });

  it('reenvio depois de bloqueio → 404 (não 409 preso); clientId de outra conversa → 409, nada gravado', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    const caio = await newUser('Caio');
    const conv = (await inbox.createConversation(ana, bia, 'oi', 'k_1')).conversation.id;
    const withCaio = (await inbox.createConversation(ana, caio, 'oi Caio', 'k_2')).conversation.id;

    // o mesmo clientId noutra conversa/par (cliente com defeito): não devolve a mensagem de outro par
    await expectHttp(inbox.sendMessage(ana, withCaio, 'oi', 'k_1'), 409, 'client_id_conflict');
    await expectHttp(inbox.createConversation(ana, caio, 'oi', 'k_1'), 409, 'client_id_conflict');
    expect(await prisma.message.count()).toBe(2);

    await blocks.block(bia, ana);
    gw.reset();
    const body = await expectHttp(inbox.createConversation(ana, bia, 'oi', 'k_1'), 404);
    expect(body.message).toBe('Usuário não encontrado');
    await expectHttp(inbox.sendMessage(ana, conv, 'oi', 'k_1'), 404);
    expect(gw.emitted).toHaveLength(0);
    expect(await prisma.message.count()).toBe(2);
  });
});

// =================================================================================================
describe('quem ENVIA também é conferido (conta e análise)', () => {
  it('banida/suspensa/apagada: erro igual ao do guard nas duas rotas; nada gravado, nada emitido, nada desarquivado', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    const caio = await newUser('Caio');
    const conv = (await inbox.createConversation(ana, bia, 'oi')).conversation.id;
    // a moderação já arquivou as conversas de Ana (o cache do guard ainda diz 'active')
    await prisma.conversationMember.updateMany({
      where: { conversationId: conv },
      data: { archivedAt: new Date() },
    });

    const cases: [UserExtra, number, string][] = [
      [{ accountStatus: 'banned' }, 403, 'account_banned'],
      [{ accountStatus: 'suspended' }, 403, 'account_suspended'],
      [{ accountStatus: 'active', deletedAt: new Date() }, 401, 'account_gone'],
    ];
    for (const [state, status, error] of cases) {
      await prisma.user.update({ where: { id: ana }, data: { deletedAt: null, ...state } });
      gw.reset();
      await expectHttp(inbox.sendMessage(ana, conv, 'ainda aqui?'), status, error);
      await expectHttp(inbox.createConversation(ana, bia, 'pelo cartão'), status, error);
      await expectHttp(inbox.createConversation(ana, caio, 'conversa nova'), status, error);
      expect(gw.emitted).toHaveLength(0);
    }
    expect(await prisma.message.count()).toBe(1);
    expect(await prisma.conversation.count()).toBe(1);
    expect(await redis.client.get(`rate:${ana}:conv:new`)).toBe('1'); // só a conversa aberta antes do ban
    for (const u of [ana, bia]) expect((await memberOf(conv, u)).archivedAt).not.toBeNull();
    expect((await memberOf(conv, bia)).unreadCount).toBe(1);
  });

  it('banida enquanto o envio esperava a trava do par (janela do ban): o envio vê o ban e não grava', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    const conv = (await inbox.createConversation(ana, bia, 'oi')).conversation.id;
    await inbox.sendMessage(bia, conv, 'oi!');
    gw.reset();

    // "moderação": segura a trava do par, bane e arquiva; só commita depois que o envio já está esperando
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const ban = prisma.$transaction(
      async (tx) => {
        await lockPair(tx, ana, bia);
        await tx.user.update({ where: { id: ana }, data: { accountStatus: 'banned' } });
        await tx.conversationMember.updateMany({
          where: { conversationId: conv },
          data: { archivedAt: new Date(), unreadCount: 0 },
        });
        await gate;
      },
      { timeout: 20_000 },
    );
    const sending = inbox.sendMessage(ana, conv, 'na janela do ban').then(
      () => null,
      (e: unknown) => e,
    );
    await waitForAdvisoryWaiter();
    release();
    await ban;

    const err = (await sending) as HttpException;
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(403);
    expect((err.getResponse() as Record<string, unknown>).error).toBe('account_banned');
    expect(gw.emitted).toHaveLength(0);
    expect(await prisma.message.count({ where: { conversationId: conv } })).toBe(2);
    for (const u of [ana, bia]) {
      const m = await memberOf(conv, u);
      expect(m.archivedAt).not.toBeNull();
      expect(m.unreadCount).toBe(0);
    }
  });

  it('em análise: não abre conversa nova (404 igual ao de alvo indisponível) e não gasta a cota do dia', async () => {
    const hold = await newUser('Hold', { reviewHoldAt: new Date() });
    const bia = await newUser('Bia');
    const other = await newUser('Outra');
    const unavailable = await newUser('Pausa', { isPaused: true });

    const held = await expectHttp(inbox.createConversation(hold, bia, 'oi', 'h_1'), 404);
    // não revela a análise: o mesmo 404 de quem tenta abrir com alguém indisponível
    const paused = await expectHttp(inbox.createConversation(other, unavailable, 'oi'), 404);
    expect(held).toEqual(paused);
    expect(await prisma.conversation.count()).toBe(0);
    expect(await prisma.message.count()).toBe(0);
    expect(await redis.client.get(`rate:${hold}:conv:new`)).toBeNull();
    expect(gw.emitted).toHaveLength(0);
  });

  it('em análise: não insiste na solicitação que abriu (429, composer "esperando"), e ela some das Solicitações de quem recebeu', async () => {
    const x = await newUser('X');
    const bia = await newUser('Bia');
    const conv = (await inbox.createConversation(x, bia, 'oi')).conversation.id;
    expect((await inbox.list(bia, 'requests')).items).toHaveLength(1);
    await prisma.user.update({ where: { id: x }, data: { reviewHoldAt: new Date() } });
    gw.reset();

    await expectHttp(inbox.sendMessage(x, conv, 'oi de novo'), 429, 'awaiting_reply');
    await expectHttp(inbox.createConversation(x, bia, 'pelo cartão'), 429, 'awaiting_reply');
    expect((await inbox.getConversation(x, conv)).requestMessagesLeft).toBe(0);
    expect(await prisma.message.count({ where: { conversationId: conv } })).toBe(1);
    expect((await memberOf(conv, bia)).unreadCount).toBe(1);
    expect(gw.emitted).toHaveLength(0);

    // quem recebeu não vê mais nome/foto de quem está em análise
    expect((await inbox.list(bia, 'requests')).items).toEqual([]);
    expect(await inbox.counts(bia)).toEqual({ unreadInbox: 0, requests: 0, unreadRequests: 0 });
    await expectHttp(inbox.getConversation(bia, conv), 404);
    expect(await inbox.lookupWith(bia, x)).toBeNull();
    // quem está em análise continua vendo a própria conversa (principal, aguardando)
    expect((await inbox.list(x, 'inbox')).items.map((c) => c.id)).toEqual([conv]);

    // análise encerrada sem punição: volta tudo
    await prisma.user.update({ where: { id: x }, data: { reviewHoldAt: null } });
    expect((await inbox.list(bia, 'requests')).items.map((c) => c.id)).toEqual([conv]);
    await expect(inbox.sendMessage(x, conv, 'agora vai')).resolves.toMatchObject({
      body: 'agora vai',
    });
  });

  it('em análise: RESPONDE quem pediu e continua conversa aceita', async () => {
    const x = await newUser('X');
    const bia = await newUser('Bia');
    const caio = await newUser('Caio');
    // Bia pediu antes da análise; X (agora em análise) responde → bounce, principal
    const fromBia = (await inbox.createConversation(bia, x, 'oi X')).conversation.id;
    await prisma.user.update({ where: { id: x }, data: { reviewHoldAt: new Date() } });
    await expect(inbox.sendMessage(x, fromBia, 'oi Bia')).resolves.toMatchObject({
      body: 'oi Bia',
    });
    // responder pelo POST /conversations (reuso da conversa do par) também vale
    await expect(inbox.createConversation(x, bia, 'tudo bem?')).resolves.toMatchObject({
      message: { body: 'tudo bem?' },
    });
    expect(
      (await prisma.conversation.findUniqueOrThrow({ where: { id: fromBia } })).promotedReason,
    ).toBe('bounce');

    // conversa que X abriu ANTES da análise e já foi aceita: continua
    await prisma.user.update({ where: { id: x }, data: { reviewHoldAt: null } });
    const withCaio = (await inbox.createConversation(x, caio, 'oi Caio')).conversation.id;
    await inbox.promoteManual(caio, withCaio);
    await prisma.user.update({ where: { id: x }, data: { reviewHoldAt: new Date() } });
    await expect(inbox.sendMessage(x, withCaio, 'e aí')).resolves.toMatchObject({ body: 'e aí' });
    expect(await prisma.message.count({ where: { senderId: x } })).toBe(4);
  });
});

// =================================================================================================
describe('bloqueio (BlocksService) e visibilidade', () => {
  it('bloquear esconde dos DOIS lados, zera não lidas, arquiva; envio 404; Like e Message ficam', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    const conv = (await inbox.createConversation(ana, bia, 'oi')).conversation.id;
    await likes.like(ana, bia);
    expect((await memberOf(conv, bia)).unreadCount).toBe(1);
    gw.reset();

    await blocks.block(bia, ana);

    for (const u of [ana, bia]) {
      expect((await inbox.list(u, 'inbox')).items).toEqual([]);
      expect((await inbox.list(u, 'requests')).items).toEqual([]);
      expect(await inbox.counts(u)).toEqual({ unreadInbox: 0, requests: 0, unreadRequests: 0 });
      const m = await memberOf(conv, u);
      expect(m.unreadCount).toBe(0);
      expect(m.archivedAt).not.toBeNull();
      await expectHttp(inbox.getConversation(u, conv), 404);
      await expectHttp(inbox.listMessages(u, conv), 404);
      await expectHttp(inbox.sendMessage(u, conv, 'ainda aí?'), 404);
      expect(await inbox.lookupWith(u, u === ana ? bia : ana)).toBeNull();
    }
    const blocked = await expectHttp(inbox.createConversation(ana, bia, 'oi de novo'), 404);
    expect(blocked.message).toBe('Usuário não encontrado');

    const removed = of('conversation:removed');
    expect(removed).toHaveLength(1);
    expect(sorted(removed[0].to)).toEqual(sorted([ana, bia]));
    expect(gw.left).toEqual([{ conversationId: conv, userIds: [bia, ana] }]);
    expect(redis.invalidated).toEqual(expect.arrayContaining([ana, bia]));
    expect(await prisma.like.count()).toBe(1);
    expect(await prisma.message.count()).toBe(1);

    // bloquear de novo: nenhuma linha nova, nenhum evento novo
    gw.reset();
    await blocks.block(bia, ana);
    expect(await prisma.block.count()).toBe(1);
    expect(of('conversation:removed')).toHaveLength(0);
  });

  it('desbloquear não desarquiva; a conversa volta com uma mensagem nova', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    const conv = (await inbox.createConversation(ana, bia, 'oi')).conversation.id;
    await blocks.block(bia, ana);
    await blocks.unblock(bia, ana);
    expect((await inbox.list(bia, 'requests')).items).toEqual([]);
    expect((await inbox.list(ana, 'inbox')).items).toEqual([]);

    gw.reset();
    await inbox.sendMessage(ana, conv, 'oi de novo');
    expect((await inbox.list(bia, 'requests')).items.map((c) => c.unreadCount)).toEqual([1]);
    expect((await inbox.list(ana, 'inbox')).items.map((c) => c.id)).toEqual([conv]);
    expect(
      of('conversation:new')
        .map((e) => e.to[0])
        .sort(),
    ).toEqual(sorted([ana, bia]));
  });

  it('Block gravado sem arquivar (segunda proteção): as listas e o detalhe já escondem', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    const conv = (await inbox.createConversation(ana, bia, 'oi')).conversation.id;
    await prisma.block.create({ data: { blockerId: ana, blockedId: bia } });
    expect((await inbox.list(ana, 'inbox')).items).toEqual([]);
    expect((await inbox.list(bia, 'requests')).items).toEqual([]);
    expect((await inbox.counts(bia)).requests).toBe(0);
    await expectHttp(inbox.getConversation(bia, conv), 404);
    await expectHttp(inbox.promoteManual(bia, conv), 404);
    await expectHttp(inbox.markRead(bia, conv), 404);
  });

  it('abrir conversa: mesma visibilidade do cartão, 404 idêntico em todos os casos', async () => {
    const me = await newUser('Eu');
    const future = new Date(Date.now() + 86_400_000);
    const past = new Date(Date.now() - 86_400_000);
    const targets: [string, string][] = [
      ['anônima', await newUser('Anon', { visibilityMode: 'anonymous' })],
      ['pausada', await newUser('Pausa', { isPaused: true, pausedUntil: future })],
      ['pausada sem prazo', await newUser('Pausa2', { isPaused: true })],
      ['suspensa', await newUser('Susp', { accountStatus: 'suspended' })],
      ['banida', await newUser('Ban', { accountStatus: 'banned' })],
      ['em análise', await newUser('Hold', { reviewHoldAt: new Date() })],
      ['apagada', await newUser('Del', { deletedAt: new Date() })],
      ['inexistente', '0b9f3c2e-8d1a-4c55-9a7e-3f2b1d0c9e8a'],
      ['eu mesma', me],
    ];
    const blockedMe = await newUser('BloqueouEu');
    await prisma.block.create({ data: { blockerId: blockedMe, blockedId: me } });
    const iBlocked = await newUser('EuBloqueei');
    await prisma.block.create({ data: { blockerId: me, blockedId: iBlocked } });
    targets.push(['me bloqueou', blockedMe], ['eu bloqueei', iBlocked]);

    const bodies: unknown[] = [];
    for (const [, id] of targets)
      bodies.push(await expectHttp(inbox.createConversation(me, id, 'oi'), 404));
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
    expect(bodies[0]).toMatchObject({ message: 'Usuário não encontrado' });
    expect(await prisma.conversation.count()).toBe(0);
    expect(gw.emitted).toHaveLength(0);

    // pausa vencida não conta: abre normalmente
    const back = await newUser('Voltou', { isPaused: true, pausedUntil: past });
    await expect(inbox.createConversation(me, back, 'oi')).resolves.toMatchObject({
      conversation: { peer: { id: back } },
    });
  });

  it('conversa que já existe continua mesmo se a outra ponta ficar anônima/pausada; conta banida corta (404)', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    const conv = (await inbox.createConversation(ana, bia, 'oi')).conversation.id;
    await prisma.user.update({
      where: { id: bia },
      data: { visibilityMode: 'anonymous', isPaused: true },
    });
    await expect(inbox.sendMessage(ana, conv, 'ainda aqui')).resolves.toMatchObject({
      body: 'ainda aqui',
    });
    // POST /conversations de novo reusa a conversa do par: a regra do cartão vale só pra ABRIR conversa nova
    await expect(inbox.createConversation(ana, bia, 'pelo cartão')).resolves.toMatchObject({
      message: { body: 'pelo cartão' },
    });
    await prisma.user.update({ where: { id: bia }, data: { accountStatus: 'banned' } });
    expect((await inbox.list(ana, 'inbox')).items).toEqual([]);
    await expectHttp(inbox.sendMessage(ana, conv, 'e agora?'), 404);
  });
});

// =================================================================================================
describe('modo invisível: mandar e receber mensagens é do Premium', () => {
  const LOCKED = 'anonymous_requires_premium';
  const anonFree = (id: string) =>
    prisma.user.update({
      where: { id },
      data: { visibilityMode: 'anonymous', premiumTier: 'free' },
    });
  const toVisible = (id: string) =>
    prisma.user.update({ where: { id }, data: { visibilityMode: 'visible' } });
  const emittedTo = (id: string) => gw.emitted.filter((e) => e.to.includes(id));

  it('invisível grátis NÃO manda: responder, abrir, reenviar → 403; nada gravado, nada emitido, cota intacta', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    const cris = await newUser('Cris');
    const conv = (await inbox.createConversation(ana, bia, 'oi', 'c-1')).conversation.id;
    await anonFree(ana);
    gw.reset();
    const before = await prisma.message.count();
    const convNew = await redis.client.get(`rate:${ana}:conv:new`);

    await expectHttp(inbox.sendMessage(ana, conv, 'tá aí?'), 403, LOCKED);
    await expectHttp(inbox.createConversation(ana, cris, 'oi cris'), 403, LOCKED);
    // nem o reenvio de algo já gravado passa: invisível sem Premium não usa o chat
    await expectHttp(inbox.createConversation(ana, bia, 'oi', 'c-1'), 403, LOCKED);
    await expectHttp(inbox.sendMessage(ana, conv, 'oi', 'c-1'), 403, LOCKED);

    expect(await prisma.message.count()).toBe(before);
    expect(await prisma.conversation.count()).toBe(1);
    expect(gw.emitted).toHaveLength(0);
    expect(await redis.client.get(`rate:${ana}:conv:new`)).toBe(convNew);
    expect(await redis.client.get(`rate:${ana}:msg`)).toBe('1'); // só a 1ª mensagem, quando ainda estava visível

    // voltou a ficar visível: tudo normal de novo
    await toVisible(ana);
    await expect(inbox.sendMessage(ana, conv, 'voltei')).resolves.toMatchObject({ body: 'voltei' });
  });

  it('invisível grátis não abre as conversas: listas, detalhe, histórico, aceitar e lida → 403; a contagem continua', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    const conv = (await inbox.createConversation(ana, bia, 'oi')).conversation.id;
    await anonFree(bia);
    gw.reset();
    await expectHttp(inbox.list(bia, 'inbox'), 403, LOCKED);
    await expectHttp(inbox.list(bia, 'requests'), 403, LOCKED);
    await expectHttp(inbox.getConversation(bia, conv), 403, LOCKED);
    await expectHttp(inbox.listMessages(bia, conv), 403, LOCKED);
    await expectHttp(inbox.promoteManual(bia, conv), 403, LOCKED);
    await expectHttp(inbox.markRead(bia, conv), 403, LOCKED);
    await expectHttp(inbox.updateConversation(bia, conv, { archived: true }), 403, LOCKED);
    // só números, pro convite ("1 conversa te esperando")
    expect(await inbox.counts(bia)).toMatchObject({ requests: 1 });
    expect(gw.emitted).toHaveLength(0);
    const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: conv } });
    expect(conversation.promotedAt).toBeNull();
    expect((await memberOf(conv, bia)).unreadCount).toBe(1);
  });

  it('invisível grátis NÃO recebe: a mensagem é gravada e conta como não lida, mas nada chega por socket; ao ficar visível, aparece tudo', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    const conv = (await inbox.createConversation(ana, bia, 'oi')).conversation.id;
    await inbox.sendMessage(bia, conv, 'oi!'); // bounce: principal dos dois
    await inbox.markRead(ana, conv);
    await inbox.markRead(bia, conv);
    await anonFree(bia);
    gw.reset();

    // quem envia não percebe diferença nenhuma
    const m = await inbox.sendMessage(ana, conv, 'tá aí?');
    expect(m).toMatchObject({ body: 'tá aí?', senderId: ana });
    expect(emittedTo(bia)).toEqual([]);
    expect(of('message:new').map((e) => e.to)).toEqual([[ana]]);
    expect((await memberOf(conv, bia)).unreadCount).toBe(1);
    await inbox.sendMessage(ana, conv, 'e aí?');
    expect(emittedTo(bia)).toEqual([]);

    await toVisible(bia);
    const biaInbox = await inbox.list(bia, 'inbox');
    expect(biaInbox.items[0]).toMatchObject({ id: conv, unreadCount: 2 });
    expect(biaInbox.items[0].lastMessage).toMatchObject({ body: 'e aí?' });
    const history = await inbox.listMessages(bia, conv);
    expect(history.map((x) => x.body)).toEqual(['oi', 'oi!', 'tá aí?', 'e aí?']);
    // e a partir daqui recebe ao vivo
    gw.reset();
    await inbox.sendMessage(ana, conv, 'agora foi');
    expect(of('message:new').map((e) => e.to)).toEqual([[ana], [bia]]);
  });

  it('lida de quem está visível sobre mensagens de quem está invisível grátis: gravada, sem recibo pro outro', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    const conv = (await inbox.createConversation(ana, bia, 'oi')).conversation.id;
    await inbox.sendMessage(bia, conv, 'oi!');
    await anonFree(ana);
    gw.reset();
    await inbox.markRead(bia, conv);
    expect(of('message:read').map((e) => e.to)).toEqual([[bia]]);
    expect(emittedTo(ana)).toEqual([]);
    const first = await prisma.message.findFirstOrThrow({
      where: { conversationId: conv, senderId: ana },
    });
    expect(first.readAt).not.toBeNull();
  });

  it('solicitação pra quem ficou invisível grátis: gravada sem aviso; ao voltar, responde e vira principal', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    const conv = (await inbox.createConversation(ana, bia, 'oi')).conversation.id;
    await anonFree(bia);
    gw.reset();
    await inbox.sendMessage(ana, conv, 'oi de novo');
    expect(emittedTo(bia)).toEqual([]);
    expect((await memberOf(conv, bia)).unreadCount).toBe(2);

    await toVisible(bia);
    expect((await inbox.list(bia, 'requests')).items.map((c) => c.id)).toEqual([conv]);
    gw.reset();
    await inbox.sendMessage(bia, conv, 'oi, voltei'); // resposta: bounce
    expect(of('conversation:promoted').map((e) => sorted(e.to))).toEqual([sorted([ana, bia])]);
  });

  it('Premium e Premium+ invisíveis mandam e recebem normalmente; Premium vencido volta a travar', async () => {
    const ana = await newUser('Ana', { visibilityMode: 'anonymous', premiumTier: 'premium' });
    const bia = await newUser('Bia');
    const leo = await newUser('Leo', {
      visibilityMode: 'anonymous',
      premiumTier: 'premium_plus',
      premiumExpiresAt: new Date(Date.now() + 86_400_000),
    });

    const conv = (await inbox.createConversation(ana, bia, 'oi, tô invisível')).conversation.id;
    gw.reset();
    await inbox.sendMessage(bia, conv, 'oi!');
    expect(of('message:new').map((e) => e.to)).toEqual([[bia], [ana]]);
    expect(of('conversation:promoted').map((e) => sorted(e.to))).toEqual([sorted([ana, bia])]);
    expect((await inbox.list(ana, 'inbox')).items.map((c) => c.id)).toEqual([conv]);

    // quem está visível escreve pra conversa que já existe com a Premium invisível (uma conversa por par)
    expect((await inbox.createConversation(bia, ana, 'e aí?')).conversation.id).toBe(conv);
    const convLeo = (await inbox.createConversation(leo, bia, 'oi, sou o Leo')).conversation.id;
    gw.reset();
    await inbox.sendMessage(bia, convLeo, 'oi Leo');
    expect(of('message:new').map((e) => e.to)).toEqual([[bia], [leo]]);

    await prisma.user.update({
      where: { id: ana },
      data: { premiumExpiresAt: new Date(Date.now() - 1_000) },
    });
    await expectHttp(inbox.sendMessage(ana, conv, 'venceu?'), 403, LOCKED);
    gw.reset();
    await inbox.sendMessage(bia, conv, 'cadê você?');
    expect(emittedTo(ana)).toEqual([]);
  });

  it('abrir conversa COM quem está invisível continua 404 (o cartão não aparece), mesmo sendo Premium', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia', { visibilityMode: 'anonymous', premiumTier: 'premium' });
    const cris = await newUser('Cris', { visibilityMode: 'anonymous' });
    await expectHttp(inbox.createConversation(ana, bia, 'oi'), 404);
    await expectHttp(inbox.createConversation(ana, cris, 'oi'), 404);
    expect(await prisma.conversation.count()).toBe(0);
  });

  it('invisível grátis NÃO curte nem super curte: 403, nada gravado, cota intacta, nenhum evento; visível de novo curte', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    const conv = (await inbox.createConversation(ana, bia, 'oi')).conversation.id;
    await likes.like(ana, bia);
    await anonFree(bia);
    gw.reset();

    await expectHttp(likes.like(bia, ana), 403, LOCKED);
    await expectHttp(likes.like(bia, ana, true), 403, LOCKED);
    expect(await prisma.like.count({ where: { likerId: bia } })).toBe(0);
    expect(await redis.client.get(`rate:${bia}:like`)).toBeNull();
    expect(gw.emitted).toHaveLength(0);
    expect(await systemMessages(conv)).toHaveLength(0);

    // Premium vencido também trava
    await prisma.user.update({
      where: { id: bia },
      data: { premiumTier: 'premium', premiumExpiresAt: new Date(Date.now() - 1_000) },
    });
    await expectHttp(likes.like(bia, ana), 403, LOCKED);

    // visível de novo: a curtida fecha o par e promove a conversa, com os eventos pros dois
    await toVisible(bia);
    const r = await likes.like(bia, ana);
    expect(r).toMatchObject({
      likeStatus: 'MUTUAL',
      isMutual: true,
      promotedConversationIds: [conv],
    });
    expect(of('conversation:promoted').map((e) => sorted(e.to))).toEqual([sorted([ana, bia])]);
  });

  it('curtida mútua com Premium invisível: os dois recebem tudo, como sempre', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    await inbox.createConversation(ana, bia, 'oi');
    await likes.like(ana, bia);
    await prisma.user.update({
      where: { id: bia },
      data: { visibilityMode: 'anonymous', premiumTier: 'premium' },
    });
    gw.reset();
    await likes.like(bia, ana);
    expect(of('conversation:promoted').map((e) => sorted(e.to))).toEqual([sorted([ana, bia])]);
    expect(sorted(of('message:new').flatMap((e) => e.to))).toEqual(sorted([ana, bia]));
  });

  it('"Mover para principal" por quem está visível, com o outro invisível grátis: promove sem avisar o outro', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    const conv = (await inbox.createConversation(ana, bia, 'oi')).conversation.id;
    await anonFree(ana);
    gw.reset();
    await inbox.promoteManual(bia, conv);
    expect(of('conversation:promoted').map((e) => e.to)).toEqual([[bia]]);
    expect(emittedTo(ana)).toEqual([]);
  });
});

// =================================================================================================
describe('rate limits (429 com retryAfter)', () => {
  it('15/min por par, 30/min por remetente, 30 conversas novas/dia (reusar a do par não conta)', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    const caio = await newUser('Caio');
    const conv = (await inbox.createConversation(ana, bia, 'oi')).conversation.id;
    await prisma.like.createMany({
      data: [
        { likerId: ana, likedId: bia },
        { likerId: bia, likedId: ana },
      ],
    });
    await inbox.reevaluate(conv); // principal: o teto de 3 do requester não interfere

    await redis.preset(`rate:${ana}:msg:to:${bia}`, 15);
    const pair = await expectHttp(inbox.sendMessage(ana, conv, 'spam'), 429, 'rate_limited');
    expect(pair.retryAfter).toEqual(expect.any(Number));
    expect(pair.retryAfter as number).toBeGreaterThan(0);

    await redis.preset(`rate:${ana}:msg:to:${bia}`, 0);
    await redis.preset(`rate:${ana}:msg`, 30);
    await expectHttp(inbox.sendMessage(ana, conv, 'spam'), 429, 'rate_limited');

    await redis.preset(`rate:${ana}:msg`, 0);
    await redis.preset(`rate:${ana}:conv:new`, 30, 86_400);
    const daily = await expectHttp(inbox.createConversation(ana, caio, 'oi'), 429, 'daily_limit');
    expect(daily.retryAfter as number).toBeGreaterThan(3600);
    expect(await redis.client.get(`rate:${ana}:conv:new`)).toBe('30'); // devolveu a tentativa negada
    await expect(inbox.createConversation(ana, bia, 'reuso não conta')).resolves.toBeTruthy();
    expect(await prisma.conversation.count()).toBe(1);
  });
});

// =================================================================================================
describe('curtida, arquivo e paginação', () => {
  it('DELETE /likes/:userId apaga a curtida e NÃO despromove', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    const conv = (await inbox.createConversation(ana, bia, 'oi')).conversation.id;
    await likes.like(ana, bia);
    await likes.like(bia, ana);
    await likes.unlike(bia, ana);
    expect(await prisma.like.count({ where: { likerId: bia } })).toBe(0);
    const c = await prisma.conversation.findUniqueOrThrow({ where: { id: conv } });
    expect(c.promotedAt).not.toBeNull();
    expect((await inbox.list(bia, 'inbox')).items.map((x) => x.id)).toEqual([conv]);
    expect((await inbox.getConversation(bia, conv)).likeStatus).toBe('NONE'); // ana→bia é RECEIVED, escondido no grátis
    expect((await inbox.getConversation(ana, conv)).likeStatus).toBe('SENT');
    expect(await inbox.reevaluate(conv)).toEqual({ promoted: false });
  });

  it('arquivar tira da lista (evento só pra mim), desarquivar devolve; lookup ignora arquivada', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    const conv = (await inbox.createConversation(ana, bia, 'oi')).conversation.id;
    gw.reset();
    const d = await inbox.updateConversation(ana, conv, { archived: true, isMuted: true });
    expect(d).toMatchObject({ isMuted: true });
    expect(d.archivedAt).not.toBeNull();
    expect((await inbox.list(ana, 'inbox')).items).toEqual([]);
    expect(await inbox.lookupWith(ana, bia)).toBeNull();
    expect(await inbox.lookupWith(bia, ana)).toEqual({ id: conv, folder: 'requests' });
    expect(gw.emitted).toEqual([
      { to: [ana], event: 'conversation:removed', payload: { conversationId: conv } },
    ]);
    expect(gw.left).toEqual([{ conversationId: conv, userIds: [ana] }]);

    gw.reset();
    await inbox.updateConversation(ana, conv, { archived: false });
    expect((await inbox.list(ana, 'inbox')).items.map((c) => c.id)).toEqual([conv]);
    expect(of('conversation:new').map((e) => e.to)).toEqual([[ana]]);
  });

  it('lista por cursor sem repetir nem pular; histórico por before (id) e teto de 100', async () => {
    const me = await newUser('Eu');
    const ids: string[] = [];
    for (const n of ['P1', 'P2', 'P3']) {
      const peer = await newUser(n);
      ids.push((await inbox.createConversation(me, peer, `oi ${n}`)).conversation.id);
    }
    const p1 = await inbox.list(me, 'inbox', undefined, 2);
    expect(p1.items.map((c) => c.id)).toEqual([ids[2], ids[1]]);
    expect(p1.nextCursor).toEqual(expect.any(String));
    const p2 = await inbox.list(me, 'inbox', p1.nextCursor as string, 2);
    expect(p2.items.map((c) => c.id)).toEqual([ids[0]]);
    expect(p2.nextCursor).toBeNull();
    await expectHttp(inbox.list(me, 'inbox', 'lixo'), 400);

    const peer = await newUser('Hist');
    const conv = (await inbox.createConversation(me, peer, 'm1')).conversation.id;
    await inbox.sendMessage(peer, conv, 'm2');
    for (const b of ['m3', 'm4', 'm5']) await inbox.sendMessage(me, conv, b);
    const last2 = await inbox.listMessages(me, conv, 2);
    expect(last2.map((m) => m.body)).toEqual(['m4', 'm5']);
    const older = await inbox.listMessages(me, conv, 2, last2[0].id);
    expect(older.map((m) => m.body)).toEqual(['m2', 'm3']);
    expect(await inbox.listMessages(me, conv, 1000)).toHaveLength(5);
  });
});

// =================================================================================================
describe('push de mensagem nova (SocialPushService: só push, depois do commit, fora da central)', () => {
  let sent: PushMessage[];
  let social: SocialPushService;
  let pinbox: InboxService;

  beforeEach(() => {
    sent = [];
    // transporte falso no lugar do FCM: grava cada push por aparelho
    const push = new PushService(db, {
      sendEach: async (m: PushMessage[]): Promise<PushOutcome[]> => {
        sent.push(...m);
        return m.map(() => 'ok');
      },
    });
    social = new SocialPushService(db, redis as unknown as RedisService, push);
    pinbox = new InboxService(
      db,
      redis as unknown as RedisService,
      gw as unknown as ChatGateway,
      social,
    );
  });

  const device = (userId: string, token: string) =>
    prisma.deviceToken.create({ data: { userId, token, platform: 'android' } });
  const pushesTo = (token: string) => sent.filter((m) => m.token === token).map((m) => m.payload);
  /** passa a espera de 60 s da conversa */
  const skipGap = (userId: string, conv: string) => redis.client.del(`push:msg:${userId}:${conv}`);

  it('a outra ponta recebe (solicitação com cara de solicitação), quem enviou não; rajada = 1 push por conversa', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    await device(ana, 'tok-ana');
    await device(bia, 'tok-bia');

    const conv = (await pinbox.createConversation(ana, bia, 'oi, tudo bem?')).conversation.id;
    await social.drain();
    expect(pushesTo('tok-ana')).toEqual([]);
    expect(pushesTo('tok-bia')).toEqual([
      {
        title: 'Nova solicitação de mensagem',
        body: 'Ana: oi, tudo bem?',
        channelId: 'messages',
        tag: `conv:${conv}`,
        ttlSeconds: 86_400,
        // mensagem nunca aparece na tela bloqueada (aparece ao desbloquear)
        visibility: 'secret',
        data: {
          notificationId: '',
          type: 'message',
          target: JSON.stringify({ kind: 'conversation', conversationId: conv }),
        },
      },
    ]);

    // 2ª mensagem dentro dos 60 s: nada de push novo
    await pinbox.sendMessage(ana, conv, 'tá aí?');
    await social.drain();
    expect(pushesTo('tok-bia')).toHaveLength(1);

    // a resposta chega pra quem abriu (na principal dela: título = nome, corpo = prévia)
    await pinbox.sendMessage(bia, conv, 'oi!');
    await social.drain();
    expect(pushesTo('tok-ana')).toEqual([
      expect.objectContaining({ title: 'Bia', body: 'oi!', channelId: 'messages' }),
    ]);
    // só push: nada na central de avisos, nenhum notification:new
    expect(await prisma.notification.count()).toBe(0);
    expect(of('notification:new')).toEqual([]);
  });

  it('prévia desligada esconde o texto; conversa muda e "Mensagens novas" desligado não avisam', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    await device(bia, 'tok-bia');
    await prisma.notificationPref.create({ data: { userId: bia, messagePreview: false } });

    const conv = (await pinbox.createConversation(ana, bia, 'segredo')).conversation.id;
    await social.drain();
    expect(pushesTo('tok-bia')).toEqual([
      expect.objectContaining({
        title: 'Nova solicitação de mensagem',
        body: 'Ana quer conversar com você',
      }),
    ]);
    expect(JSON.stringify(sent)).not.toContain('segredo');

    await pinbox.updateConversation(bia, conv, { isMuted: true });
    await skipGap(bia, conv);
    await pinbox.sendMessage(ana, conv, 'e aí?');
    await social.drain();
    expect(pushesTo('tok-bia')).toHaveLength(1);

    await pinbox.updateConversation(bia, conv, { isMuted: false });
    await prisma.notificationPref.update({ where: { userId: bia }, data: { messages: false } });
    await skipGap(bia, conv);
    await pinbox.sendMessage(ana, conv, 'oi??');
    await social.drain();
    expect(pushesTo('tok-bia')).toHaveLength(1);
  });

  it('invisível sem Premium (retido), bloqueio, conta fora e solicitação de quem está em análise: sem push', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    await device(bia, 'tok-bia');
    const conv = (await pinbox.createConversation(ana, bia, 'oi')).conversation.id;
    await social.drain();
    expect(pushesTo('tok-bia')).toHaveLength(1);
    sent.length = 0;

    // retida: a mensagem é gravada, mas nem evento nem push
    await prisma.user.update({
      where: { id: bia },
      data: { visibilityMode: 'anonymous', premiumTier: 'free' },
    });
    await skipGap(bia, conv);
    await pinbox.sendMessage(ana, conv, 'tá aí?');
    await social.drain();
    expect(sent).toEqual([]);
    await prisma.user.update({ where: { id: bia }, data: { visibilityMode: 'visible' } });

    // as mesmas regras da leitura da inbox valem mesmo chamando direto (corrida com bloqueio/análise)
    const target = { to: bia, conversationId: conv, senderId: ana, messageType: 'text', body: 'x' };
    await prisma.user.update({ where: { id: ana }, data: { reviewHoldAt: new Date() } });
    await skipGap(bia, conv);
    await social.messages([target]);
    expect(sent).toEqual([]); // solicitação de quem está em análise some pra quem recebeu
    await prisma.user.update({ where: { id: ana }, data: { reviewHoldAt: null } });

    await prisma.block.create({ data: { blockerId: bia, blockedId: ana } });
    await skipGap(bia, conv);
    await social.messages([target]);
    expect(sent).toEqual([]);
    await prisma.block.deleteMany({});

    await prisma.user.update({ where: { id: bia }, data: { accountStatus: 'suspended' } });
    await skipGap(bia, conv);
    await social.messages([target]);
    expect(sent).toEqual([]);

    // tudo em ordem de novo: avisa
    await prisma.user.update({ where: { id: bia }, data: { accountStatus: 'active' } });
    await skipGap(bia, conv);
    await social.messages([target]);
    expect(sent).toHaveLength(1);
  });

  it('teto de 30 pushes sociais por hora por pessoa', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    await device(bia, 'tok-bia');
    const conv = (await pinbox.createConversation(ana, bia, 'oi')).conversation.id;
    await social.drain();
    expect(sent).toHaveLength(1);
    await redis.preset(`rate:${bia}:push:social`, 30, 3_600);
    await skipGap(bia, conv);
    await pinbox.sendMessage(ana, conv, 'de novo');
    await social.drain();
    expect(sent).toHaveLength(1);
  });

  it('sem FCM (push desligado): não consulta nada e a mensagem segue igual', async () => {
    const off = new PushService(db, null);
    const quiet = new SocialPushService(db, redis as unknown as RedisService, off);
    const i = new InboxService(
      db,
      redis as unknown as RedisService,
      gw as unknown as ChatGateway,
      quiet,
    );
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    const r = await i.createConversation(ana, bia, 'oi');
    await quiet.drain();
    expect(r.message.body).toBe('oi');
    expect(await redis.client.get(`push:msg:${bia}:${r.conversation.id}`)).toBeNull();
  });
});
