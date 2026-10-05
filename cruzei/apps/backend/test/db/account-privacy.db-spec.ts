import { ConflictException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';

import { phoneHash } from '../../src/common/phone-hash';
import type { PrismaService } from '../../src/database/prisma.service';
import { AccountStateService } from '../../src/modules/account/account-state.service';
import { DeletionStateService } from '../../src/modules/account/deletion-state.service';
import { AccountDeletionService } from '../../src/modules/account-privacy/account-deletion.service';
import { AccountPurgeService } from '../../src/modules/account-privacy/account-purge.service';
import { DataExportService } from '../../src/modules/account-privacy/data-export.service';
import { LocationHistoryService } from '../../src/modules/account-privacy/location-history.service';
import { AuthService } from '../../src/modules/auth/auth.service';
import { PhoneReleaseService } from '../../src/modules/auth/phone-release.service';
import type { SmsService } from '../../src/modules/auth/sms.service';
import type { RedisService } from '../../src/redis/redis.service';

import { asGateway, fakeGateway, newPoi, newUser, resetAdminDb } from './admin-fakes';
import { assertTestDatabase } from './env';

// Conta e privacidade contra o banco de TESTE: pedir exclusão some com a conta na hora (sessões, push, conversas do
// outro lado); o login no prazo devolve 409 com desafio e o cancelamento traz tudo de volta; no fim do prazo a limpeza
// deixa só a "conta limpa" (CHECK users_purged_clean_chk), guarda a prova citada em denúncia, enfileira os arquivos
// (gatilho photos_release_media), espera denúncia em análise e guarda o número de conta banida; a retenção apaga a
// prova vencida, a marca do número (6 meses) e o fiscal (5 anos). Também: apagar histórico de localização e a cópia
// dos dados. Recriar o banco: bash test/db/setup-test-db.sh

const DAY = 86_400_000;
const SECRET = 'segredo-do-db-spec-de-conta-e-privacidade';

const prisma = new PrismaClient();
const db = prisma as unknown as PrismaService;

/** Redis em memória com o que esses fluxos usam (strings, hashes, sets, zsets, SCAN por prefixo, contadores) */
function memRedis() {
  const str = new Map<string, string>();
  const hash = new Map<string, Map<string, string>>();
  const sets = new Map<string, Set<string>>();
  const zsets = new Map<string, Set<string>>();
  const keys = () => new Set([...str.keys(), ...hash.keys(), ...sets.keys(), ...zsets.keys()]);
  const delKey = (k: string) =>
    Number(str.delete(k) || hash.delete(k) || sets.delete(k) || zsets.delete(k));
  const counters = new Map<string, number>();
  const client = {
    get: async (k: string) => str.get(k) ?? null,
    mget: async (...ks: (string | string[])[]) => ks.flat().map((k) => str.get(k) ?? null),
    set: async (k: string, v: string, ...opts: unknown[]) => {
      if (opts.includes('NX') && str.has(k)) return null;
      str.set(k, v);
      return 'OK';
    },
    getdel: async (k: string) => {
      const v = str.get(k) ?? null;
      str.delete(k);
      return v;
    },
    del: async (...ks: string[]) => ks.reduce((n, k) => n + delKey(k), 0),
    unlink: async (...ks: string[]) => ks.reduce((n, k) => n + delKey(k), 0),
    exists: async (k: string) => Number(keys().has(k)),
    ttl: async () => 3600,
    incr: async (k: string) => {
      const n = Number(str.get(k) ?? 0) + 1;
      str.set(k, String(n));
      return n;
    },
    decr: async (k: string) => {
      const n = Number(str.get(k) ?? 0) - 1;
      str.set(k, String(n));
      return n;
    },
    expire: async () => 1,
    persist: async () => 1,
    publish: async () => 0,
    hget: async (k: string, f: string) => hash.get(k)?.get(f) ?? null,
    hgetall: async (k: string) => Object.fromEntries(hash.get(k) ?? []),
    hdel: async (k: string, f: string) => Number(hash.get(k)?.delete(f) ?? false),
    smembers: async (k: string) => [...(sets.get(k) ?? [])],
    scard: async (k: string) => sets.get(k)?.size ?? 0,
    scan: async (_c: string, _m: string, pattern: string) => [
      '0',
      [...keys()].filter((k) => k.startsWith(pattern.replace(/\*$/, ''))),
    ],
    // só o DECR com piso do contador de casas; o resto (cache do estado da conta) fica sem cache
    eval: async (_lua: string, _n: number, key: string) => {
      if (!key.startsWith('home:cnt:')) return null;
      const v = Number(str.get(key) ?? '0');
      if (v <= 1) {
        str.delete(key);
        return 0;
      }
      str.set(key, String(v - 1));
      return v - 1;
    },
    multi: () => {
      const ops: (() => unknown)[] = [];
      const m = {
        zrem: (k: string, member: string) => (ops.push(() => zsets.get(k)?.delete(member)), m),
        del: (k: string) => (ops.push(() => delKey(k)), m),
        exec: async () => ops.map((op) => [null, op()]),
      };
      return m;
    },
    duplicate: () => ({ subscribe: async () => undefined, on: () => undefined }),
  };
  const redis = {
    client,
    invalidateProfile: jest.fn(async () => undefined),
    markPresenceHidden: jest.fn(async () => undefined),
    getCachedProfile: jest.fn(async () => null),
    cacheProfile: jest.fn(async () => undefined),
    incrRate: jest.fn(async (userId: string, action: string) => {
      const k = `rate:${userId}:${action}`;
      const n = (counters.get(k) ?? 0) + 1;
      counters.set(k, n);
      str.set(k, String(n));
      return n;
    }),
    setSignupProof: jest.fn(async (phone: string) => void str.set(`sms:verified:${phone}`, '1')),
    consumeSignupProof: jest.fn(async (phone: string) => str.delete(`sms:verified:${phone}`)),
  };
  const reset = () => {
    str.clear();
    hash.clear();
    sets.clear();
    zsets.clear();
    counters.clear();
  };
  return { redis: redis as unknown as RedisService, str, hash, sets, zsets, keys, reset };
}

const mem = memRedis();
const gateway = fakeGateway();
const accounts = new AccountStateService(db, mem.redis);
const deletionsState = new DeletionStateService(db, mem.redis, accounts);
const phones = new PhoneReleaseService(db, mem.redis, accounts);
const jwt = new JwtService({ secret: SECRET });
const cfg = {
  get: (k: string) =>
    ({ 'jwt.secret': SECRET, 'jwt.accessTtl': 900, 'jwt.refreshTtl': 2_592_000 })[k],
} as unknown as ConfigService;
const sms = { verifyCode: async () => true } as unknown as SmsService;
const auth = new AuthService(db, jwt, cfg, sms, mem.redis, accounts, phones, deletionsState);
const deletion = new AccountDeletionService(db, mem.redis, accounts, asGateway(gateway));
const purge = new AccountPurgeService(db, mem.redis, accounts);
const exporter = new DataExportService(db, mem.redis);
const history = new LocationHistoryService(db, mem.redis);

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';

let anaId = '';
let anaPhone = '';
let beaId = '';
let caioId = '';
let poiId = BigInt(0);

const reset = async () => {
  await resetAdminDb(prisma);
  // sem FK em users: o TRUNCATE ... CASCADE não leva estas
  await prisma.$executeRawUnsafe(
    'TRUNCATE phone_releases, access_logs, trial_claims, media_objects RESTART IDENTITY',
  );
};

/** conversa entre duas pessoas (par ordenado como o app grava) com uma mensagem de cada */
async function conversation(a: string, b: string, text = 'oi') {
  const [low, high] = a < b ? [a, b] : [b, a];
  const c = await prisma.conversation.create({
    data: { userLowId: low, userHighId: high, promotedAt: new Date() },
  });
  await prisma.conversationMember.createMany({
    data: [
      { conversationId: c.id, userId: a, role: 'REQUESTER' },
      { conversationId: c.id, userId: b, role: 'RECIPIENT' },
    ],
  });
  await prisma.message.createMany({
    data: [
      { conversationId: c.id, senderId: a, body: `${text} de A` },
      { conversationId: c.id, senderId: b, body: `${text} de B` },
    ],
  });
  return c.id;
}

/** pedido de exclusão já vencido (como se os 30 dias tivessem passado) */
async function expireRequest(userId: string) {
  await prisma.dataDeletionRequest.updateMany({
    where: { userId, status: 'pending' },
    data: { scheduledFor: new Date(Date.now() - 60_000) },
  });
}

beforeAll(async () => {
  await assertTestDatabase(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await reset();
  mem.reset();
  jest.clearAllMocks();
  delete process.env.ACCOUNT_DELETION_GRACE_DAYS;
  const ana = await newUser(prisma, 'Ana Lima', {
    bio: 'oi',
    instagramHandle: 'ana',
    trialUsedAt: new Date(),
  });
  anaId = ana.id;
  anaPhone = ana.phone!;
  beaId = (await newUser(prisma, 'Bea')).id;
  caioId = (await newUser(prisma, 'Caio')).id;
  poiId = (await newPoi(prisma, 'Bar do Zé')).id;
  await prisma.deviceToken.create({
    data: { userId: anaId, token: 'fcm-ana', platform: 'android' },
  });
});

describe('pedir exclusão', () => {
  it('some na hora: deleted_at, sessões cortadas, push apagado, conversa some ao vivo do outro lado', async () => {
    const conv = await conversation(anaId, beaId);
    const out = await deletion.request(anaId, { confirm: 'EXCLUIR', reason: 'privacy' });
    expect(out.created).toBe(true);
    expect(out.graceDays).toBe(30);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: anaId } });
    expect(u.deletedAt).not.toBeNull();
    expect(u.sessionsValidAfter).not.toBeNull();
    expect(await prisma.deviceToken.count({ where: { userId: anaId } })).toBe(0);
    const req = await prisma.dataDeletionRequest.findFirstOrThrow({ where: { userId: anaId } });
    expect(req).toMatchObject({ status: 'pending', source: 'app', reason: 'privacy' });
    expect(req.scheduledFor.getTime() - req.requestedAt.getTime()).toBe(30 * DAY);
    expect(gateway.emitToUsers).toHaveBeenCalledWith([beaId], expect.any(String), {
      conversationId: conv,
    });
    expect(gateway.disconnectUser).toHaveBeenCalledWith(anaId, expect.anything());
    // nada apagado ainda: a restauração traz tudo
    expect(await prisma.message.count({ where: { conversationId: conv } })).toBe(2);
  });

  it('idempotente: segundo pedido devolve o mesmo, um pendente só (índice ddr_one_pending_uq)', async () => {
    const a = await deletion.request(anaId, { confirm: 'EXCLUIR' });
    const b = await deletion.request(anaId, { confirm: 'EXCLUIR' });
    expect(b).toMatchObject({
      created: false,
      requestedAt: a.requestedAt,
      scheduledFor: a.scheduledFor,
    });
    expect(await prisma.dataDeletionRequest.count({ where: { userId: anaId } })).toBe(1);
    await expect(
      prisma.dataDeletionRequest.create({
        data: { userId: anaId, scheduledFor: new Date(), status: 'pending' },
      }),
    ).rejects.toThrow();
  });

  it('conta da equipe não se exclui (409 staff_account)', async () => {
    await prisma.user.update({ where: { id: anaId }, data: { role: 'moderator' } });
    await expect(deletion.request(anaId, { confirm: 'EXCLUIR' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(await prisma.dataDeletionRequest.count()).toBe(0);
  });
});

describe('arrependimento: login no prazo', () => {
  it('409 com desafio (sem sessão, número não é liberado) → cancelar traz a conta de volta', async () => {
    await conversation(anaId, beaId);
    await deletion.request(anaId, { confirm: 'EXCLUIR' });
    const err = await auth.login(anaPhone, '123456').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    const body = (err as ConflictException).getResponse() as { error: string; challengeId: string };
    expect(body.error).toBe('account_deletion_pending');
    // o número continua na conta (nada de liberar pra cadastro novo)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: anaId } })).phone).toBe(anaPhone);
    expect(await prisma.phoneRelease.count()).toBe(0);

    const r = await deletionsState.cancelByChallenge(body.challengeId);
    expect(r.userId).toBe(anaId);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: anaId } });
    expect(u.deletedAt).toBeNull();
    const req = await prisma.dataDeletionRequest.findFirstOrThrow({ where: { userId: anaId } });
    expect(req.status).toBe('cancelled');
    expect(req.cancelledAt).not.toBeNull();
    // sessão nova vale (token emitido depois do corte)
    const s = await auth.openSession(anaId);
    expect(s.token).toEqual(expect.any(String));
    await expect(
      accounts.assertActive(anaId, Math.floor(Date.now() / 1000) + 1),
    ).resolves.toBeTruthy();
    // conversas voltaram intactas
    expect(await prisma.message.count({ where: { senderId: anaId } })).toBe(1);
    // e o desafio é de uso único
    await expect(deletionsState.cancelByChallenge(body.challengeId)).rejects.toMatchObject({
      response: { error: 'deletion_challenge_expired' },
    });
  });

  it('limpeza já passou: o número saiu, login segue pro cadastro como número novo', async () => {
    await deletion.request(anaId, { confirm: 'EXCLUIR' });
    await expireRequest(anaId);
    await purge.purgeDue(5);
    const r = await auth.login(anaPhone, '123456');
    expect(r).toMatchObject({ token: null, user: { isNew: true } });
  });
});

describe('limpeza definitiva no fim do prazo', () => {
  it('deixa só a conta limpa, guarda a prova citada e enfileira os arquivos', async () => {
    const plain = await conversation(anaId, beaId, 'comum');
    const evidence = await conversation(anaId, caioId, 'prova');
    // Caio denunciou Ana citando a conversa; a denúncia já foi decidida (não segura a limpeza)
    await prisma.report.create({
      data: {
        reporterId: caioId,
        reportedId: anaId,
        reason: 'harassment',
        status: 'resolved',
        reviewedAt: new Date(),
        context: { source: 'chat', conversationId: evidence },
      },
    });
    await prisma.photo.createMany({
      data: [
        {
          userId: anaId,
          url: `p/${P1}.jpg`,
          thumbnailUrl: `p/${P1}-t.jpg`,
          orderIndex: 0,
          isMain: true,
        },
        { userId: anaId, url: `p/${P2}.jpg`, orderIndex: 1, moderationLabels: { urgent: true } },
        { userId: anaId, url: 'fakes/f1.jpg', orderIndex: 2 },
      ],
    });
    await prisma.like.create({ data: { likerId: beaId, likedId: anaId } });
    await prisma.like.create({ data: { likerId: anaId, likedId: caioId } });
    await prisma.pass.create({ data: { userId: beaId, targetId: anaId } });
    await prisma.block.create({ data: { blockerId: anaId, blockedId: caioId } });
    await prisma.visit.create({ data: { visitorId: beaId, visitedId: anaId } });
    await prisma.privateArea.create({
      data: { userId: anaId, label: 'Casa', latitude: -18.91, longitude: -48.27, radiusM: 200 },
    });
    await prisma.location.create({
      data: { userId: anaId, latitude: -18.919, longitude: -48.277, geohash: '6upq8c' },
    });
    await prisma.poisCheckin.create({ data: { userId: anaId, poiId } });
    await prisma.subscription.create({
      data: {
        userId: anaId,
        tier: 'premium',
        platform: 'android',
        startsAt: new Date(Date.now() - 40 * DAY),
        expiresAt: new Date(Date.now() - 10 * DAY),
      },
    });
    await prisma.boost.create({
      data: {
        userId: anaId,
        expiresAt: new Date(Date.now() - DAY),
        latitude: -18.9,
        longitude: -48.2,
        amountCents: 990,
        platform: 'android',
      },
    });
    await prisma.analyticsEvent.create({
      data: { userId: anaId, installId: 'inst-ana', name: 'app_open' },
    });
    await prisma.auditLog.createMany({
      data: [
        { userId: anaId, action: 'profile.update' },
        { userId: anaId, action: 'admin.premium_grant' },
      ],
    });
    await prisma.accessLog.create({ data: { userId: anaId, event: 'login', ip: '203.0.113.9' } });

    await deletion.request(anaId, { confirm: 'EXCLUIR' });
    await expireRequest(anaId);
    const res = await purge.purgeDue(5);
    expect(res).toMatchObject({ completed: 1, held: 0, failed: 0 });

    // conta limpa (o CHECK users_purged_clean_chk passou, senão o UPDATE teria falhado)
    const u = await prisma.user.findUniqueOrThrow({ where: { id: anaId } });
    expect(u).toMatchObject({
      phone: null,
      bio: null,
      instagramHandle: null,
      name: 'Conta excluída',
      isPaused: true,
    });
    expect(u.purgedAt).not.toBeNull();
    expect(u.deletedAt).not.toBeNull();

    // conversa comum some com as mensagens das duas pessoas; a de prova fica arquivada pros dois
    expect(await prisma.conversation.count({ where: { id: plain } })).toBe(0);
    expect(await prisma.message.count({ where: { conversationId: evidence } })).toBe(2);
    const members = await prisma.conversationMember.findMany({
      where: { conversationId: evidence },
    });
    expect(members.every((m) => m.archivedAt)).toBe(true);

    // relações e dados da pessoa
    expect(
      await prisma.like.count({ where: { OR: [{ likerId: anaId }, { likedId: anaId }] } }),
    ).toBe(0);
    expect(await prisma.pass.count({ where: { targetId: anaId } })).toBe(0);
    expect(await prisma.block.count({ where: { blockerId: anaId } })).toBe(0);
    expect(await prisma.visit.count({ where: { visitedId: anaId } })).toBe(0);
    expect(await prisma.privateArea.count({ where: { userId: anaId } })).toBe(0);
    expect(await prisma.location.count({ where: { userId: anaId } })).toBe(0);
    expect(await prisma.poisCheckin.count({ where: { userId: anaId } })).toBe(0);
    expect(await prisma.photo.count({ where: { userId: anaId } })).toBe(0);

    // arquivos na fila: comum vence agora, 'urgent' só daqui a 180 dias, fakes/ nunca entra
    const media = await prisma.$queryRaw<
      { key: string; thumb_key: string | null; due_days: number }[]
    >`
      SELECT key, thumb_key, round(extract(epoch FROM (delete_after - now())) / 86400)::int AS due_days
        FROM media_objects ORDER BY key`;
    expect(media).toEqual([
      { key: `p/${P1}.jpg`, thumb_key: `p/${P1}-t.jpg`, due_days: 0 },
      { key: `p/${P2}.jpg`, thumb_key: null, due_days: 180 },
    ]);

    // fica sem apontar pra pessoa: fiscal (5 anos), Boost sem posição, métricas anônimas, auditoria do painel
    expect(await prisma.subscription.count({ where: { userId: anaId } })).toBe(1);
    const boost = await prisma.boost.findFirstOrThrow({ where: { userId: anaId } });
    expect(boost.latitude).toBeNull();
    const ev = await prisma.analyticsEvent.findFirstOrThrow({ where: { name: 'app_open' } });
    expect(ev.userId).toBeNull();
    expect(ev.installId).toMatch(/^del:/);
    const audits = await prisma.auditLog.findMany({ where: { userId: anaId } });
    expect(audits.map((a) => a.action)).toEqual(['admin.premium_grant']);
    // registros de acesso ficam (Marco Civil, 6 meses)
    expect(await prisma.accessLog.count({ where: { userId: anaId } })).toBe(1);
    // teste grátis vira marca permanente
    expect(
      await prisma.$queryRaw<
        { n: number }[]
      >`SELECT count(*)::int AS n FROM trial_claims WHERE phone_hash = ${phoneHash(anaPhone)}`,
    ).toEqual([{ n: 1 }]);

    // pedido concluído com a marca do número
    const req = await prisma.dataDeletionRequest.findFirstOrThrow({ where: { userId: anaId } });
    expect(req).toMatchObject({
      status: 'completed',
      holdReason: null,
      phoneHash: phoneHash(anaPhone),
    });

    // a exceção do audit_log valeu só na transação da limpeza
    await expect(
      prisma.$executeRaw`DELETE FROM audit_log WHERE user_id = ${anaId}::uuid`,
    ).rejects.toThrow(/só-anexar/);

    // rodar de novo não faz nada (idempotente)
    expect(await purge.purgeDue(5)).toMatchObject({ completed: 0, failed: 0 });
  });

  it('denúncia contra a pessoa em análise: adia (open_reports) e não apaga nada', async () => {
    await prisma.report.create({
      data: { reporterId: beaId, reportedId: anaId, reason: 'spam', status: 'pending' },
    });
    await deletion.request(anaId, { confirm: 'EXCLUIR' });
    await expireRequest(anaId);
    const res = await purge.purgeDue(5);
    expect(res).toMatchObject({ completed: 0, held: 1 });
    const req = await prisma.dataDeletionRequest.findFirstOrThrow({ where: { userId: anaId } });
    expect(req.status).toBe('pending');
    expect(req.holdReason).toBe('open_reports');
    expect(req.scheduledFor.getTime()).toBeGreaterThan(Date.now());
    expect((await prisma.user.findUniqueOrThrow({ where: { id: anaId } })).phone).toBe(anaPhone);
  });

  it('conta banida: o número fica em phone_releases (evasão de banimento)', async () => {
    await deletion.request(anaId, { confirm: 'EXCLUIR' });
    await prisma.user.update({ where: { id: anaId }, data: { accountStatus: 'banned' } });
    await expireRequest(anaId);
    await purge.purgeDue(5);
    const rel = await prisma.phoneRelease.findFirstOrThrow({ where: { userId: anaId } });
    expect(rel).toMatchObject({
      phone: anaPhone,
      reason: 'account_deleted',
      accountStatus: 'banned',
    });
  });

  it('conta não banida: número reciclado vira hash e o IP do pedido dela sai nos 6 meses', async () => {
    const OLD = '+5534977776666';
    // número antigo que saiu da Ana (o Caio disse "não é minha"): o IP é do Caio
    const out = await prisma.phoneRelease.create({
      data: {
        userId: anaId,
        phone: OLD,
        reason: 'not_mine',
        accountStatus: 'active',
        newUserId: caioId,
        ip: '198.51.100.7',
      },
    });
    // números que vieram PRA Ana (pedido dela): um de 200 dias, um de 30
    const inOld = await prisma.phoneRelease.create({
      data: {
        userId: beaId,
        phone: anaPhone,
        reason: 'not_mine',
        accountStatus: 'active',
        newUserId: anaId,
        ip: '203.0.113.9',
        port: 51000,
        userAgent: 'Metch/1.0',
        createdAt: new Date(Date.now() - 200 * DAY),
      },
    });
    const inRecent = await prisma.phoneRelease.create({
      data: {
        userId: caioId,
        phone: anaPhone,
        reason: 'birthdate_mismatch',
        accountStatus: 'active',
        newUserId: anaId,
        ip: '203.0.113.10',
        createdAt: new Date(Date.now() - 30 * DAY),
      },
    });
    await deletion.request(anaId, { confirm: 'EXCLUIR' });
    await expireRequest(anaId);
    await purge.purgeDue(5);

    const a = await prisma.phoneRelease.findUniqueOrThrow({ where: { id: out.id } });
    expect(a).toMatchObject({ phone: null, phoneHash: phoneHash(OLD), ip: '198.51.100.7' });
    expect(await prisma.phoneRelease.findUniqueOrThrow({ where: { id: inOld.id } })).toMatchObject({
      ip: null,
      port: null,
      userAgent: null,
    });
    // ainda dentro dos 6 meses do Marco Civil
    expect((await prisma.phoneRelease.findUniqueOrThrow({ where: { id: inRecent.id } })).ip).toBe(
      '203.0.113.10',
    );
    // nada de guardar o número inteiro de quem não foi banido
    expect(
      await prisma.phoneRelease.count({ where: { userId: anaId, phone: { not: null } } }),
    ).toBe(0);

    // 200 dias depois: IP do pedido recente e o hash (6 meses depois da limpeza) saem na retenção
    const out2 = await purge.retention(new Date(Date.now() + 200 * DAY));
    expect(out2).toMatchObject({ releaseMeta: 1, releaseHashes: 1 });
    expect(
      (await prisma.phoneRelease.findUniqueOrThrow({ where: { id: inRecent.id } })).ip,
    ).toBeNull();
    expect(
      (await prisma.phoneRelease.findUniqueOrThrow({ where: { id: out.id } })).phoneHash,
    ).toBeNull();
  });

  it('revisão sem denúncia: segura até o teto; passou, limpa guardando o número', async () => {
    await prisma.user.update({ where: { id: anaId }, data: { reviewHoldAt: new Date() } });
    await deletion.request(anaId, { confirm: 'EXCLUIR' });
    await expireRequest(anaId);
    expect(await purge.purgeDue(5)).toMatchObject({ held: 1, completed: 0 });
    expect(
      (await prisma.dataDeletionRequest.findFirstOrThrow({ where: { userId: anaId } })).holdReason,
    ).toBe('review_hold');
    // pedido de 61 dias atrás: passou do teto (30 de prazo + 30 de revisão)
    await prisma.dataDeletionRequest.updateMany({
      where: { userId: anaId },
      data: {
        requestedAt: new Date(Date.now() - 61 * DAY),
        scheduledFor: new Date(Date.now() - 60_000),
      },
    });
    expect(await purge.purgeDue(5)).toMatchObject({ completed: 1 });
    // número guardado com a situação real: o próximo dono dele não nasce em revisão
    expect(await prisma.phoneRelease.findFirstOrThrow({ where: { userId: anaId } })).toMatchObject({
      phone: anaPhone,
      reason: 'account_deleted',
      accountStatus: 'active',
    });
  });

  it('cancelou antes da limpeza: pedido cancelado não é pego', async () => {
    await deletion.request(anaId, { confirm: 'EXCLUIR' });
    await prisma.user.update({ where: { id: anaId }, data: { deletedAt: null } });
    await expireRequest(anaId);
    const res = await purge.purgeDue(5);
    expect(res).toMatchObject({ completed: 0, cancelled: 1 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: anaId } })).purgedAt).toBeNull();
  });
});

describe('retenção diária', () => {
  it('prova vencida sai; marca do número sai em 6 meses; fiscal em 5 anos; segurança infantil fica', async () => {
    const evidence = await conversation(anaId, caioId, 'prova');
    const childSafety = await conversation(anaId, beaId, 'grave');
    const longAgo = new Date(Date.now() - 200 * DAY);
    await prisma.report.createMany({
      data: [
        {
          reporterId: caioId,
          reportedId: anaId,
          reason: 'harassment',
          status: 'resolved',
          reviewedAt: longAgo,
          context: { source: 'chat', conversationId: evidence },
        },
        {
          reporterId: beaId,
          reportedId: anaId,
          reason: 'child_safety',
          status: 'resolved',
          reviewedAt: longAgo,
          context: { source: 'chat', conversationId: childSafety },
        },
      ],
    });
    await prisma.subscription.create({
      data: {
        userId: anaId,
        tier: 'premium',
        platform: 'ios',
        startsAt: new Date(Date.now() - 6 * 365 * DAY),
        expiresAt: new Date(Date.now() - 5.5 * 365 * DAY),
      },
    });
    await deletion.request(anaId, { confirm: 'EXCLUIR' });
    await expireRequest(anaId);
    await purge.purgeDue(5);
    expect(
      await prisma.conversation.count({ where: { id: { in: [evidence, childSafety] } } }),
    ).toBe(2);

    // marca do número velha
    await prisma.dataDeletionRequest.updateMany({
      where: { userId: anaId },
      data: { completedAt: new Date(Date.now() - 200 * DAY) },
    });
    const out = await purge.retention();
    expect(out).toMatchObject({ conversations: 1, phoneHashes: 1, subscriptions: 1 });
    expect(await prisma.conversation.count({ where: { id: evidence } })).toBe(0);
    expect(await prisma.conversation.count({ where: { id: childSafety } })).toBe(1);
    expect(
      (await prisma.dataDeletionRequest.findFirstOrThrow({ where: { userId: anaId } })).phoneHash,
    ).toBeNull();
  });
});

describe('apagar histórico de localização', () => {
  it('posições, check-ins e "estou aqui" saem; pedidos de lugar e áreas privadas ficam', async () => {
    await prisma.location.createMany({
      data: [
        { userId: anaId, latitude: -18.919, longitude: -48.277, geohash: '6upq8c' },
        { userId: anaId, latitude: -18.92, longitude: -48.278, geohash: '6upq8c' },
        { userId: beaId, latitude: -18.92, longitude: -48.278, geohash: '6upq8c' },
      ],
    });
    await prisma.poisCheckin.create({ data: { userId: anaId, poiId } });
    await prisma.privateArea.create({
      data: { userId: anaId, label: 'Casa', latitude: -18.91, longitude: -48.27, radiusM: 200 },
    });
    const mk = async (ext: string) =>
      (
        await prisma.$queryRaw<{ id: bigint }[]>`
          INSERT INTO place_candidates (key, ext_id, mapbox_id, cell, status, name, category, kind, latitude, longitude, city, state,
                                        last_evidence_on, created_on)
          VALUES (${ext}, ${ext}, ${ext}, '6utsm7v', 'pending', 'Lugar', 'bar', 'bar', -18.91, -48.27, 'Uberlândia', 'MG',
                  CURRENT_DATE, CURRENT_DATE)
          RETURNING id`
      )[0].id;
    const c1 = await mk('ovt:1');
    const c2 = await mk('ovt:2');
    await prisma.$executeRaw`INSERT INTO place_votes (candidate_id, user_id, kind, voted_on) VALUES
      (${c1}, ${anaId}::uuid, 'onsite', CURRENT_DATE), (${c2}, ${anaId}::uuid, 'request', CURRENT_DATE)`;
    mem.hash.set(`user:loc:${anaId}`, new Map([['geohash', '6upq8c']]));
    mem.zsets.set('presence:6upq8c', new Set([anaId]));
    mem.hash.set(`loc:anchor:${anaId}`, new Map([['la', '-18.919']]));
    mem.sets.set(`home:cells:${anaId}`, new Set(['6upq8c']));

    const out = await history.forget(anaId, { learnedHome: true });
    expect(out).toEqual({ positions: 2, checkins: 1, placeVotes: 1, learnedHome: true });
    expect(await prisma.location.count({ where: { userId: anaId } })).toBe(0);
    expect(await prisma.location.count({ where: { userId: beaId } })).toBe(1);
    expect(await prisma.privateArea.count({ where: { userId: anaId } })).toBe(1);
    const votes = await prisma.$queryRaw<
      { kind: string }[]
    >`SELECT kind FROM place_votes WHERE user_id = ${anaId}::uuid`;
    expect(votes).toEqual([{ kind: 'request' }]);
    expect(mem.keys().has(`user:loc:${anaId}`)).toBe(false);
    expect(mem.keys().has(`loc:anchor:${anaId}`)).toBe(false);
    expect(mem.keys().has(`home:cells:${anaId}`)).toBe(false);
    expect(mem.str.has(`loc:forget:${anaId}`)).toBe(true);
  });
});

describe('cópia dos dados', () => {
  it('traz o centro exato das áreas, só as minhas mensagens e só as denúncias que fiz', async () => {
    const conv = await conversation(anaId, beaId, 'papo');
    await prisma.privateArea.create({
      data: {
        userId: anaId,
        label: 'Casa',
        latitude: -18.91234567,
        longitude: -48.27654321,
        radiusM: 200,
      },
    });
    await prisma.report.create({
      data: { reporterId: anaId, reportedId: caioId, reason: 'spam', description: 'chato' },
    });
    await prisma.report.create({
      data: {
        reporterId: beaId,
        reportedId: anaId,
        reason: 'harassment',
        description: 'segredo de quem denunciou',
      },
    });
    mem.sets.set(`home:cells:${anaId}`, new Set(['6upq8c']));
    mem.sets.set(
      `home:nights:${anaId}:6upq8c`,
      new Set(['2026-10-01', '2026-10-02', '2026-10-03']),
    );

    const data = await exporter.build(anaId);
    expect(data.account.phone).toBe(anaPhone);
    expect(data.privateAreas[0]).toMatchObject({
      label: 'Casa',
      lat: -18.91234567,
      lng: -48.27654321,
    });
    expect(data.location.learnedHomeCells).toEqual([{ cell: '6upq8c', nights: 3 }]);
    const c = data.conversations.find((x) => x.id === conv)!;
    expect(c.myMessages.map((m) => m.body)).toEqual(['papo de A']);
    expect(data.reportsMade).toHaveLength(1);
    const json = JSON.stringify(data);
    expect(json).not.toContain('papo de B');
    expect(json).not.toContain('segredo de quem denunciou');
    expect(json).not.toContain('fcm-ana');
  });

  it('limite diário: a 4ª cópia do dia dá 429 export_limit', async () => {
    for (let i = 0; i < 3; i++) await exporter.takeQuota(anaId);
    await expect(exporter.takeQuota(anaId)).rejects.toMatchObject({
      status: 429,
      response: { error: 'export_limit' },
    });
  });
});
