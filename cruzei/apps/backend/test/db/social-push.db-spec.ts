import { PrismaClient } from '@prisma/client';

import type { PrismaService } from '../../src/database/prisma.service';
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

// Push social de curtida e match + comemoração do match pra quem RECEBE (quem curtiu primeiro), contra o banco de
// TESTE: LikesService + InboxService + SocialPushService de verdade, Redis em memória, gateway e transporte do FCM
// falsos (gravam QUEM recebeu O QUÊ). A mensagem nova fica no inbox.db-spec. Recriar: pnpm test:db:setup

const prisma = new PrismaClient();
const db = prisma as unknown as PrismaService;

/** Redis em memória com o que os services usam (set NX EX, get, del, incr/decr, expire, getdel, incrRate) */
class FakeRedis {
  private readonly store = new Map<string, { v: string; exp: number | null }>();
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
    getdel: async (k: string) => {
      const v = this.read(k);
      this.store.delete(k);
      return v;
    },
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
  };
  async incrRate(userId: string, action: string, ttlSeconds = 86_400) {
    const key = `rate:${userId}:${action}`;
    const n = await this.client.incr(key);
    if (n === 1) await this.client.expire(key, ttlSeconds);
    return n;
  }
  async invalidateProfile() {}
  async publishCandidateInvalidation() {}
  async preset(key: string, n: number, ttl = 3_600) {
    this.write(key, String(n), Date.now() + ttl * 1000);
  }
}

interface Emitted {
  to: string;
  event: string;
  payload: Record<string, unknown>;
}

let redis: FakeRedis;
let emitted: Emitted[];
let sent: PushMessage[];
let social: SocialPushService;
let likes: LikesService;
let inbox: InboxService;

function build() {
  redis = new FakeRedis();
  emitted = [];
  sent = [];
  const gw = {
    emitToUser: (to: string, event: string, payload: unknown) =>
      void emitted.push({ to, event, payload: payload as Record<string, unknown> }),
    emitToUsers: (ids: string[], event: string, payload: unknown) =>
      ids.forEach((to) => emitted.push({ to, event, payload: payload as Record<string, unknown> })),
    removeFromConversation: () => undefined,
  } as unknown as ChatGateway;
  const push = new PushService(db, {
    sendEach: async (m: PushMessage[]): Promise<PushOutcome[]> => {
      sent.push(...m);
      return m.map(() => 'ok');
    },
  });
  const r = redis as unknown as RedisService;
  social = new SocialPushService(db, r, push);
  inbox = new InboxService(db, r, gw, social);
  likes = new LikesService(db, r, gw, inbox, social);
}

const resetDb = () =>
  prisma.$executeRawUnsafe('TRUNCATE conversations, users RESTART IDENTITY CASCADE');

async function newUser(name: string, extra: Record<string, unknown> = {}): Promise<string> {
  const u = await prisma.user.create({
    data: {
      name,
      birthDate: new Date('1995-05-10'),
      gender: 'female',
      visibilityMode: 'visible',
      ...extra,
    } as never,
    select: { id: true },
  });
  // um aparelho por pessoa: o token é o nome (fica fácil ver quem recebeu)
  await prisma.deviceToken.create({
    data: { userId: u.id, token: `tok-${name}`, platform: 'android' },
  });
  return u.id;
}

const DAY = 86_400_000;
const plusActive = { premiumTier: 'premium_plus', premiumExpiresAt: new Date(Date.now() + DAY) };
const pushesTo = (name: string) =>
  sent.filter((m) => m.token === `tok-${name}`).map((m) => m.payload);
const eventsTo = (id: string, event: string) =>
  emitted.filter((e) => e.to === id && e.event === event).map((e) => e.payload);

/** curte e espera o push sair (ele roda depois da resposta) */
async function like(from: string, to: string, isSuper = false) {
  const r = await likes.like(from, to, isSuper);
  await social.drain();
  return r;
}

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
describe('push de curtida (só push, fora da central)', () => {
  it('quem não é Premium+: "Alguém curtiu você 💚", sem nome nem id de quem curtiu, abre Curtidas', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    await like(ana, bia);
    expect(pushesTo('Bia')).toEqual([
      {
        title: 'Alguém curtiu você 💚',
        body: 'Abre o Metch pra ver.',
        channelId: 'social',
        tag: 'likes',
        collapseKey: 'likes',
        ttlSeconds: 12 * 3_600,
        data: { notificationId: '', type: 'like', target: JSON.stringify({ kind: 'likes' }) },
      },
    ]);
    expect(JSON.stringify(sent)).not.toContain('Ana');
    expect(JSON.stringify(sent)).not.toContain(ana);
    expect(pushesTo('Ana')).toEqual([]);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('Premium+ vigente vê o nome; vencido não; curtidor invisível (Premium) nunca é nomeado; em análise nem avisa', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia', plusActive);
    const cris = await newUser('Cris', {
      premiumTier: 'premium_plus',
      premiumExpiresAt: new Date(Date.now() - 1_000),
    });
    const dani = await newUser('Dani', plusActive);
    const eli = await newUser('Eli', { visibilityMode: 'anonymous', premiumTier: 'premium' });
    const fabi = await newUser('Fabi', plusActive);
    const gabi = await newUser('Gabi', { reviewHoldAt: new Date() });

    await like(ana, bia);
    await like(ana, cris);
    await like(eli, dani);
    await like(gabi, fabi);

    expect(pushesTo('Bia').map((p) => [p.title, p.visibility])).toEqual([
      ['Ana curtiu você 💚', 'private'],
    ]);
    expect(pushesTo('Cris').map((p) => p.title)).toEqual(['Alguém curtiu você 💚']);
    expect(pushesTo('Dani').map((p) => p.title)).toEqual(['Alguém curtiu você 💚']);
    // o aviso ao vivo segue a mesma regra: invisível não vai com o id, nem pro Premium+
    expect(eventsTo(bia, 'like_received')).toEqual([{ fromUserId: ana, isSuper: false }]);
    expect(eventsTo(dani, 'like_received')).toEqual([{ isSuper: false }]);
    // em análise: curtida guardada, mas nem push nem like_received (se a análise terminar sem punição, segue a vida)
    expect(pushesTo('Fabi')).toEqual([]);
    expect(eventsTo(fabi, 'like_received')).toEqual([]);
    expect(await prisma.like.count({ where: { likerId: gabi, likedId: fabi } })).toBe(1);
  });

  it('curtidor em análise: nem super curtida avisa; saiu da análise, nada retroativo', async () => {
    const gabi = await newUser('Gabi', { reviewHoldAt: new Date() });
    const hana = await newUser('Hana', plusActive);
    await like(gabi, hana, true);
    expect(pushesTo('Hana')).toEqual([]);
    expect(eventsTo(hana, 'like_received')).toEqual([]);
    await prisma.user.update({ where: { id: gabi }, data: { reviewHoldAt: null } });
    await social.drain();
    expect(pushesTo('Hana')).toEqual([]);
    // a curtida continua valendo (aparece em Curtidas; curtir de volta dá match)
    expect((await like(hana, gabi)).isMutual).toBe(true);
  });

  it('fim da espera de 15 min: as barradas saem somadas; bloqueio desconta; dois envios do mesmo job = um push', async () => {
    const bia = await newUser('Bia');
    const [ana, cris, dani, eli] = await Promise.all(
      ['Ana', 'Cris', 'Dani', 'Eli'].map((n) => newUser(n)),
    );
    await like(ana, bia);
    await like(cris, bia);
    await like(dani, bia);
    await like(eli, bia);
    expect(pushesTo('Bia').map((p) => p.title)).toEqual(['Alguém curtiu você 💚']);
    // Bia bloqueia a Eli antes do fim da espera
    await prisma.block.create({ data: { blockerId: bia, blockedId: eli } });

    // a espera guarda o fim dela; vence (apaga) e o job roda — em dois processos ao mesmo tempo
    const dueAt = Number(await redis.client.get(`push:likes:gate:${bia}`));
    expect(dueAt).toBeGreaterThan(Date.now());
    await redis.client.del(`push:likes:gate:${bia}`);
    await Promise.all([
      social.flushLikes({ to: bia, dueAt }),
      social.flushLikes({ to: bia, dueAt }),
    ]);
    expect(pushesTo('Bia').map((p) => p.title)).toEqual([
      'Alguém curtiu você 💚',
      'Você tem 2 curtidas novas 💚',
    ]);
    expect(pushesTo('Bia')[1]).not.toHaveProperty('visibility');

    // a espera nova vale: a próxima curtida fica barrada
    const fabi = await newUser('Fabi');
    await like(fabi, bia);
    expect(pushesTo('Bia')).toHaveLength(2);
  });

  it('fim da espera sem nada válido: sem push e a espera é liberada (a próxima avisa na hora)', async () => {
    const bia = await newUser('Bia');
    const [ana, cris] = await Promise.all(['Ana', 'Cris'].map((n) => newUser(n)));
    await like(ana, bia);
    await like(cris, bia);
    await likes.unlike(cris, bia);
    const dueAt = Number(await redis.client.get(`push:likes:gate:${bia}`));
    await redis.client.del(`push:likes:gate:${bia}`);
    await social.flushLikes({ to: bia, dueAt });
    expect(pushesTo('Bia')).toHaveLength(1);
    expect(await redis.client.get(`push:likes:gate:${bia}`)).toBeNull();
  });

  it('1 push a cada 15 min somando as do período; super curtida fura; descurtir e curtir de novo não repete', async () => {
    const bia = await newUser('Bia');
    const [ana, cris, dani, eli, fabi] = await Promise.all(
      ['Ana', 'Cris', 'Dani', 'Eli', 'Fabi'].map((n) => newUser(n)),
    );
    await like(ana, bia);
    await like(cris, bia);
    await like(dani, bia);
    expect(pushesTo('Bia').map((p) => p.title)).toEqual(['Alguém curtiu você 💚']);

    // a super curtida revela quem mandou (mesmo pra quem não é Premium+)
    await like(eli, bia, true);
    expect(pushesTo('Bia').map((p) => p.title)).toEqual([
      'Alguém curtiu você 💚',
      'Eli te mandou uma super curtida ⭐',
    ]);

    await likes.unlike(ana, bia);
    await like(ana, bia);
    expect(pushesTo('Bia')).toHaveLength(2);

    // passou a espera: a próxima sai com a soma (Cris, Dani e Fabi; a Ana repetida não conta)
    await redis.client.del(`push:likes:gate:${bia}`);
    await like(fabi, bia);
    expect(pushesTo('Bia').map((p) => p.title)).toEqual([
      'Alguém curtiu você 💚',
      'Eli te mandou uma super curtida ⭐',
      'Você tem 3 curtidas novas 💚',
    ]);
  });

  it('"Curtidas" desligado, bloqueio, conta fora ou teto de 30/h: sem push', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    const cris = await newUser('Cris');
    const dani = await newUser('Dani');
    await prisma.notificationPref.create({ data: { userId: bia, likes: false } });
    await like(ana, bia);
    expect(pushesTo('Bia')).toEqual([]);

    // bloqueio logo depois da curtida (o push roda depois do commit): confere de novo antes de mandar
    await like(ana, cris);
    expect(pushesTo('Cris')).toHaveLength(1);
    await prisma.block.create({ data: { blockerId: cris, blockedId: ana } });
    await redis.client.del(`push:like:${ana}:${cris}`);
    await redis.client.del(`push:likes:gate:${cris}`);
    await social.like({ to: cris, likerId: ana, isSuper: false, reveal: false });
    expect(pushesTo('Cris')).toHaveLength(1);
    await prisma.block.deleteMany({});

    // conta de quem recebe fora do ar
    await prisma.user.update({ where: { id: cris }, data: { accountStatus: 'suspended' } });
    await redis.client.del(`push:like:${ana}:${cris}`);
    await redis.client.del(`push:likes:gate:${cris}`);
    await social.like({ to: cris, likerId: ana, isSuper: false, reveal: false });
    expect(pushesTo('Cris')).toHaveLength(1);

    await redis.preset(`rate:${dani}:push:social`, 30);
    await like(ana, dani);
    expect(pushesTo('Dani')).toEqual([]);
  });
});

// =================================================================================================
describe('match: comemoração pra quem curtiu primeiro', () => {
  it('ao vivo (match:new) + push "METCH!" + pendente até ver; quem completou não recebe nada disso', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    await like(ana, bia);
    sent.length = 0;
    const r = await like(bia, ana);
    expect(r.isMutual).toBe(true);

    const [live] = eventsTo(ana, 'match:new');
    expect(live).toEqual({
      peer: { id: bia, name: 'Bia', avatar: expect.any(Object), mainPhotoUrl: null },
      conversationId: null,
      matchedAt: expect.any(String),
    });
    expect(eventsTo(bia, 'match:new')).toEqual([]);
    expect(pushesTo('Ana')).toEqual([
      {
        title: 'METCH! 🔥',
        body: 'Você e Bia se curtiram. Manda um oi!',
        channelId: 'social',
        tag: `match:${bia}`,
        ttlSeconds: 3 * 86_400,
        visibility: 'private',
        data: {
          notificationId: '',
          type: 'match',
          target: JSON.stringify({ kind: 'match', userId: bia }),
        },
      },
    ]);
    // quem completou já viu o modal pela resposta: nem push de curtida nem de match
    expect(pushesTo('Bia')).toEqual([]);

    expect(await likes.pendingMatches(ana)).toEqual([live]);
    expect(await likes.pendingMatches(bia)).toEqual([]);
    await likes.markMatchSeen(ana, bia);
    await likes.markMatchSeen(ana, bia); // idempotente
    expect(await likes.pendingMatches(ana)).toEqual([]);
  });

  it('com conversa: a comemoração leva a conversa promovida e a foto aprovada principal', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    await prisma.photo.create({
      data: {
        userId: bia,
        url: 'https://cdn/bia.jpg',
        status: 'approved',
        isMain: true,
        orderIndex: 0,
      },
    } as never);
    const conv = (await inbox.createConversation(ana, bia, 'oi')).conversation.id;
    await like(ana, bia);
    await like(bia, ana);
    expect(eventsTo(ana, 'match:new')).toEqual([
      expect.objectContaining({
        conversationId: conv,
        peer: expect.objectContaining({ mainPhotoUrl: 'https://cdn/bia.jpg' }),
      }),
    ]);
    // a mensagem de sistema "Vocês se curtiram" não vira push de mensagem (o match tem o dele)
    expect(pushesTo('Ana').map((p) => p.data.type)).toEqual(['match']);
  });

  it('descurtir e curtir de novo: nada de novo antes de 7 dias da vista; depois comemora de novo', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    await like(ana, bia);
    await like(bia, ana);
    await likes.markMatchSeen(ana, bia);
    emitted.length = 0;
    sent.length = 0;

    await likes.unlike(bia, ana);
    await like(bia, ana);
    expect(eventsTo(ana, 'match:new')).toEqual([]);
    expect(pushesTo('Ana')).toEqual([]);
    expect(await likes.pendingMatches(ana)).toEqual([]);

    // 8 dias depois da vista (e a trava de 7 dias do push também venceu)
    await prisma.$executeRaw`UPDATE match_celebrations SET seen_at = now() - interval '8 days'`;
    await redis.client.del(`push:match:${ana}:${bia}`);
    await likes.unlike(bia, ana);
    await like(bia, ana);
    expect(eventsTo(ana, 'match:new')).toHaveLength(1);
    expect(pushesTo('Ana').map((p) => p.title)).toEqual(['METCH! 🔥']);
    expect(await likes.pendingMatches(ana)).toHaveLength(1);
  });

  it('quem completou está em análise: sem comemoração ao vivo nem push; aparece se a análise terminar sem punição', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    await like(ana, bia);
    await prisma.user.update({ where: { id: bia }, data: { reviewHoldAt: new Date() } });
    sent.length = 0;
    await like(bia, ana);
    expect(eventsTo(ana, 'match:new')).toEqual([]);
    expect(pushesTo('Ana')).toEqual([]);
    expect(await likes.pendingMatches(ana)).toEqual([]);

    await prisma.user.update({ where: { id: bia }, data: { reviewHoldAt: null } });
    expect((await likes.pendingMatches(ana)).map((m) => m.peer.id)).toEqual([bia]);
  });

  it('"Matches" desligado: sem push, mas a comemoração continua; match fura o teto de 30/h', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    const cris = await newUser('Cris');
    await prisma.notificationPref.create({ data: { userId: ana, matches: false } });
    await like(ana, bia);
    await like(bia, ana);
    expect(pushesTo('Ana')).toEqual([]);
    expect(eventsTo(ana, 'match:new')).toHaveLength(1);

    await like(cris, bia);
    await redis.preset(`rate:${cris}:push:social`, 30);
    await like(bia, cris);
    expect(pushesTo('Cris').map((p) => p.title)).toEqual(['METCH! 🔥']);
  });

  it('pendentes: sem bloqueado, descurtido, conta fora, em análise ou velho (14 dias); no máx 5, mais novo primeiro', async () => {
    const ana = await newUser('Ana');
    const peers: string[] = [];
    for (let i = 0; i < 9; i++) {
      const p = await newUser(`P${i}`);
      peers.push(p);
      await likes.like(ana, p);
      await likes.like(p, ana);
    }
    await social.drain();
    const [blocked, unliked, suspended, held, old, ...ok] = peers;
    await prisma.block.create({ data: { blockerId: ana, blockedId: blocked } });
    await likes.unlike(unliked, ana);
    await prisma.user.update({ where: { id: suspended }, data: { accountStatus: 'suspended' } });
    await prisma.user.update({ where: { id: held }, data: { reviewHoldAt: new Date() } });
    await prisma.$executeRaw`
      UPDATE match_celebrations SET created_at = now() - interval '15 days' WHERE peer_id = ${old}::uuid`;

    const pending = await likes.pendingMatches(ana);
    expect(pending.map((m) => m.peer.id)).toEqual([...ok].reverse());

    // mais de 5 válidas: só as 5 mais novas
    await prisma.user.update({ where: { id: suspended }, data: { accountStatus: 'active' } });
    await prisma.user.update({ where: { id: held }, data: { reviewHoldAt: null } });
    const top = await likes.pendingMatches(ana);
    expect(top).toHaveLength(5);
    expect(top[0].peer.id).toBe(ok[ok.length - 1]);

    // invisível sem Premium não conversa nem curte: nada de comemoração até voltar
    await prisma.user.update({
      where: { id: ana },
      data: { visibilityMode: 'anonymous', premiumTier: 'free' },
    });
    expect(await likes.pendingMatches(ana)).toEqual([]);
  });

  it('conta apagada (deleted_at): a comemoração some; o push do match confere de novo antes de mandar', async () => {
    const ana = await newUser('Ana');
    const bia = await newUser('Bia');
    await like(ana, bia);
    await like(bia, ana);
    expect(await prisma.matchCelebration.count()).toBe(1);
    sent.length = 0;
    await prisma.user.update({ where: { id: bia }, data: { deletedAt: new Date() } });
    expect(await likes.pendingMatches(ana)).toEqual([]);
    await redis.client.del(`push:match:${ana}:${bia}`);
    await social.match({ to: ana, peerId: bia });
    expect(sent).toEqual([]);
  });
});
