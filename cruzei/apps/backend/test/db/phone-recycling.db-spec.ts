import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';

import { phoneHash } from '../../src/common/phone-hash';
import type { PrismaService } from '../../src/database/prisma.service';
import { AccountStateService } from '../../src/modules/account/account-state.service';
import { tombstoneData } from '../../src/modules/account-privacy/purge-plan';
import { AdminUsersService } from '../../src/modules/admin/admin-users.service';
import { AuthService, type JwtPayload } from '../../src/modules/auth/auth.service';
import { PhoneReleaseService } from '../../src/modules/auth/phone-release.service';
import type { SmsService } from '../../src/modules/auth/sms.service';
import { ModerationService } from '../../src/modules/moderation/moderation.service';
import type { PhotoModerationService } from '../../src/modules/moderation/photo-moderation.service';
import { UsersService } from '../../src/modules/users/users.service';
import type { RedisService } from '../../src/redis/redis.service';

import {
  actor,
  asGateway,
  fakeGateway,
  fakePush,
  fakeRedis,
  newUser,
  notifyStack,
  resetAdminDb,
} from './admin-fakes';
import { assertTestDatabase } from './env';

// Número reciclado contra o banco de TESTE: conta parada há 90+ dias não entra só com o SMS; "não é minha" ou 3 erros
// na data de nascimento liberam o número (phone NULL, histórico em phone_releases, pausa sem prazo, push apagado,
// sessões revogadas); o cadastro com o mesmo número liga o histórico e nasce em revisão se a conta antiga era banida;
// o painel acha a conta pelo número antigo e mostra o histórico. Recriar o banco: bash test/db/setup-test-db.sh

const DAY = 86_400_000;
const SECRET = 'segredo-do-db-spec-de-numero-reciclado';

const prisma = new PrismaClient();
const db = prisma as unknown as PrismaService;

// Redis em memória com o que o login usa (desafio GETDEL, contador INCR/PERSIST, limites INCR/EXPIRE, travas SET NX,
// prova de SMS)
const redis = fakeRedis();
Object.assign(redis.client, {
  persist: async () => 1,
  getdel: async (k: string) => {
    const v = redis.kv.get(k) ?? null;
    redis.kv.delete(k);
    return v;
  },
  incr: async (k: string) => {
    const n = Number(redis.kv.get(k) ?? 0) + 1;
    redis.kv.set(k, String(n));
    return n;
  },
  expire: async () => 1,
});
const redisExtra = {
  setSignupProof: jest.fn(async (phone: string) => void redis.kv.set(`sms:verified:${phone}`, '1')),
  consumeSignupProof: jest.fn(async (phone: string) => redis.kv.delete(`sms:verified:${phone}`)),
};
const asRedis = () => Object.assign(redis, redisExtra) as unknown as RedisService;

// estado da conta DE VERDADE (lê sessions_valid_after do banco): o cache do Redis falso fica sempre vazio
const accounts = new AccountStateService(db, asRedis());
const phones = new PhoneReleaseService(db, asRedis(), accounts);
const jwt = new JwtService({ secret: SECRET });
const cfg = {
  get: (k: string) =>
    ({ 'jwt.secret': SECRET, 'jwt.accessTtl': 900, 'jwt.refreshTtl': 2_592_000 })[k],
} as unknown as ConfigService;
const sms = { verifyCode: async () => true } as unknown as SmsService;
const auth = new AuthService(db, jwt, cfg, sms, asRedis(), accounts, phones);

const gateway = fakeGateway();
const push = fakePush();
const { notify, audit } = notifyStack(prisma, gateway, push.transport);
const moderation = new ModerationService(
  db,
  asRedis(),
  accounts,
  asGateway(gateway),
  {} as PhotoModerationService,
  notify,
);
const users = new UsersService(db, asRedis(), {} as PhotoModerationService, asGateway(gateway));
const admin = new AdminUsersService(
  db,
  asRedis(),
  accounts,
  asGateway(gateway),
  moderation,
  users,
  notify,
  audit,
  phones,
);

const META = { ip: '203.0.113.9', port: 51000, userAgent: 'Metch/1.0 (Android)' };

let adminId = '';
let modId = '';
let oldId = '';
let oldPhone = '';

const reset = async () => {
  await resetAdminDb(prisma);
  // sem FK em users: o TRUNCATE ... CASCADE não leva estas
  await prisma.$executeRawUnsafe(
    'TRUNCATE phone_releases, access_logs, trial_claims RESTART IDENTITY',
  );
};

/** conta parada: criada, vista e com o último acesso registrado há `days` dias */
async function makeDormant(id: string, days = 100): Promise<void> {
  const at = new Date(Date.now() - days * DAY);
  await prisma.user.update({ where: { id }, data: { createdAt: at, lastActiveAt: at } });
  await prisma.accessLog.create({ data: { userId: id, event: 'login', createdAt: at } });
}

const tokenIat = (t: string) => jwt.verify<JwtPayload & { iat: number }>(t, { secret: SECRET }).iat;

beforeAll(async () => {
  await assertTestDatabase(prisma);
});

beforeEach(async () => {
  await reset();
  redis.kv.clear();
  jest.clearAllMocks();
  adminId = (await newUser(prisma, 'Monteiro', { role: 'admin' })).id;
  modId = (await newUser(prisma, 'Mari Mod', { role: 'moderator' })).id;
  const old = await newUser(prisma, 'Bruna Paula', { birthDate: new Date('1990-07-21') });
  oldId = old.id;
  oldPhone = old.phone!;
  await prisma.deviceToken.create({
    data: {
      userId: oldId,
      token: 'fcm-token-antigo',
      platform: 'android',
      lastUsedAt: new Date(Date.now() - 100 * DAY),
    },
  });
});

afterAll(async () => {
  await reset();
  await prisma.$disconnect();
});

describe('quando a conta conta como parada', () => {
  it('lastUsedAt é o maior entre posição, criação, access_logs e push', async () => {
    await makeDormant(oldId, 100);
    const at = await phones.lastUsedAt(oldId);
    expect(Date.now() - at!.getTime()).toBeGreaterThan(99 * DAY);

    // um refresh de 5 dias atrás (sem posição) já prova uso
    await prisma.accessLog.create({
      data: { userId: oldId, event: 'refresh', createdAt: new Date(Date.now() - 5 * DAY) },
    });
    const recent = await phones.lastUsedAt(oldId);
    expect(Date.now() - recent!.getTime()).toBeLessThan(6 * DAY);
    const r = await auth.login(oldPhone, '123456');
    expect(r.token).toEqual(expect.any(String));
    expect(r.claim).toBeUndefined();
  });

  it('conta ativa entra direto com o SMS', async () => {
    const r = await auth.login(oldPhone, '123456');
    expect(r.user.id).toBe(oldId);
    expect(r.token).toEqual(expect.any(String));
  });

  it('conta parada: desafio sem token e NADA marca a conta como usada', async () => {
    await makeDormant(oldId, 100);
    const before = await prisma.user.findUniqueOrThrow({ where: { id: oldId } });
    const r = await auth.login(oldPhone, '123456', META);
    expect(r.token).toBeNull();
    expect(r.claim).toMatchObject({
      maskedName: 'B••• P•••',
      createdMonth: null,
      attemptsLeft: 3,
      expiresIn: 600,
    });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: oldId } });
    expect(after.lastActiveAt.getTime()).toBe(before.lastActiveAt.getTime());
    expect(after.phone).toBe(oldPhone);
    expect(await prisma.accessLog.count({ where: { userId: oldId } })).toBe(1);
    // a próxima tentativa continua pedindo a confirmação
    expect((await auth.login(oldPhone, '123456')).claim).toBeDefined();
  });
});

describe('liberação do número', () => {
  it('"Não é minha": phone NULL, histórico, pausa sem prazo, push apagado e sessões antigas recusadas', async () => {
    await makeDormant(oldId, 100);
    const session = await auth.refresh(
      jwt.sign({ sub: oldId, typ: 'refresh' }, { secret: SECRET, expiresIn: 2_592_000 }),
    );
    // garante iat anterior ao corte (resolução do iat é 1 s)
    await new Promise((r) => setTimeout(r, 1100));

    const claim = (await auth.login(oldPhone, '123456')).claim!;
    const r = await auth.releaseClaim(claim.challengeId, META);
    expect(r).toMatchObject({
      user: { isNew: true, phone: oldPhone },
      token: null,
      released: 'not_mine',
    });

    const u = await prisma.user.findUniqueOrThrow({ where: { id: oldId } });
    expect(u).toMatchObject({ phone: null, isPaused: true, pausedUntil: null });
    expect(u.phoneReleasedAt).toBeInstanceOf(Date);
    expect(u.sessionsValidAfter).toBeInstanceOf(Date);

    const [rel] = await prisma.phoneRelease.findMany({ where: { userId: oldId } });
    expect(rel).toMatchObject({
      phone: oldPhone,
      reason: 'not_mine',
      accountStatus: 'active',
      ip: META.ip,
      port: META.port,
      userAgent: META.userAgent,
      releasedBy: null,
      newUserId: null,
    });
    expect(Date.now() - rel.lastUsedAt!.getTime()).toBeGreaterThan(99 * DAY);
    expect(await prisma.deviceToken.count({ where: { userId: oldId } })).toBe(0);
    const act = await prisma.moderationAction.findFirstOrThrow({ where: { targetUserId: oldId } });
    expect(act).toMatchObject({ action: 'phone_released', moderatorId: null });

    // sessão aberta antes da liberação: refresh e Bearer caem com session_revoked
    await expect(auth.refresh(session.refreshToken)).rejects.toMatchObject({
      response: { error: 'session_revoked' },
    });
    await expect(accounts.assertActive(oldId, tokenIat(session.token))).rejects.toMatchObject({
      response: { error: 'session_revoked' },
    });
    expect(await accounts.blockedReason(oldId, tokenIat(session.token))).toMatchObject({
      error: 'session_revoked',
    });
  });

  it('cadastro com o mesmo número: funciona, liga o histórico e a conta nasce visível (sem revisão)', async () => {
    await makeDormant(oldId, 100);
    const claim = (await auth.login(oldPhone, '123456')).claim!;
    await auth.releaseClaim(claim.challengeId, META);

    const r = await auth.register({
      phone: oldPhone,
      name: 'Nova Pessoa',
      birthDate: new Date('1998-02-02'),
      gender: 'female',
      termsVersion: '1.2',
      visibilityMode: 'visible',
    });
    const created = await prisma.user.findUniqueOrThrow({ where: { id: r.user.id } });
    expect(created).toMatchObject({
      phone: oldPhone,
      visibilityMode: 'visible',
      anonymousUntil: null,
      showMe: 'everyone',
      reviewHoldAt: null,
    });
    const rel = await prisma.phoneRelease.findFirstOrThrow({ where: { userId: oldId } });
    expect(rel.newUserId).toBe(r.user.id);
    expect(await prisma.report.count({ where: { reportedId: r.user.id } })).toBe(0);
  });

  it('conta que usou o teste grátis: a liberação deixa a marca do número em trial_claims', async () => {
    await prisma.user.update({
      where: { id: oldId },
      data: { trialUsedAt: new Date(Date.now() - 200 * DAY) },
    });
    await makeDormant(oldId, 100);
    const claim = (await auth.login(oldPhone, '123456')).claim!;
    await auth.releaseClaim(claim.challengeId, META);
    const mark = await prisma.trialClaim.findUniqueOrThrow({
      where: { phoneHash: phoneHash(oldPhone) },
    });
    expect(mark.userId).toBe(oldId);
  });

  it('erros de data somam sem prazo entre desafios: o 3º acumulado libera', async () => {
    await makeDormant(oldId, 100);
    let claim = (await auth.login(oldPhone, '123456')).claim!;
    await expect(auth.confirmClaim(claim.challengeId, '2000-01-01')).rejects.toMatchObject({
      response: { error: 'claim_mismatch', attemptsLeft: 2 },
    });
    claim = (await auth.login(oldPhone, '123456')).claim!;
    expect(claim.attemptsLeft).toBe(2);
    await expect(auth.confirmClaim(claim.challengeId, '2000-01-02')).rejects.toMatchObject({
      response: { error: 'claim_mismatch', attemptsLeft: 1 },
    });
    claim = (await auth.login(oldPhone, '123456')).claim!;
    const out = await auth.confirmClaim(claim.challengeId, '2000-01-03', META);
    expect(out).toMatchObject({ user: { isNew: true }, released: 'birthdate_mismatch' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: oldId } })).phone).toBeNull();
    // a liberação zera o contador
    expect(redis.kv.has(`auth:claim:fails:${oldId}`)).toBe(false);
  });

  it('3 erros na data liberam (birthdate_mismatch); a data certa antes disso entra', async () => {
    await makeDormant(oldId, 100);
    let claim = (await auth.login(oldPhone, '123456')).claim!;
    await expect(auth.confirmClaim(claim.challengeId, '1990-07-20')).rejects.toMatchObject({
      response: { error: 'claim_mismatch', attemptsLeft: 2 },
    });
    // data certa: sessão normal e o número fica
    const ok = await auth.confirmClaim(claim.challengeId, '1990-07-21', META);
    expect(ok.user.id).toBe(oldId);
    expect(ok.token).toEqual(expect.any(String));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: oldId } })).phone).toBe(oldPhone);

    // de novo parada (o controller gravaria o access_log 'login'; aqui o serviço sozinho não grava nada)
    claim = (await auth.login(oldPhone, '123456')).claim!;
    for (const d of ['2000-01-01', '2000-01-02']) {
      await expect(auth.confirmClaim(claim.challengeId, d)).rejects.toMatchObject({
        response: { error: 'claim_mismatch' },
      });
    }
    const out = await auth.confirmClaim(claim.challengeId, '2000-01-03', META);
    expect(out).toMatchObject({ user: { isNew: true }, released: 'birthdate_mismatch' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: oldId } })).phone).toBeNull();
    expect(
      await prisma.phoneRelease.count({ where: { userId: oldId, reason: 'birthdate_mismatch' } }),
    ).toBe(1);
  });

  it('número de conta banida: libera, mas a conta nova nasce em revisão (auto_hold + item na fila)', async () => {
    await prisma.user.update({
      where: { id: oldId },
      data: { accountStatus: 'banned', moderationReason: 'golpe' },
    });
    await makeDormant(oldId, 100);
    const claim = (await auth.login(oldPhone, '123456')).claim!;
    await auth.releaseClaim(claim.challengeId, META);
    expect(
      (await prisma.phoneRelease.findFirstOrThrow({ where: { userId: oldId } })).accountStatus,
    ).toBe('banned');

    const r = await auth.register({
      phone: oldPhone,
      name: 'Voltei',
      birthDate: new Date('1990-07-21'),
      gender: 'female',
      termsVersion: '1.2',
    });
    const created = await prisma.user.findUniqueOrThrow({ where: { id: r.user.id } });
    expect(created.reviewHoldAt).toBeInstanceOf(Date);
    const hold = await prisma.moderationAction.findFirstOrThrow({
      where: { targetUserId: r.user.id },
    });
    expect(hold).toMatchObject({ action: 'auto_hold', moderatorId: null });
    expect(hold.note).toContain(oldId);
    const report = await prisma.report.findFirstOrThrow({ where: { reportedId: r.user.id } });
    expect(report).toMatchObject({
      reporterId: null,
      reason: 'other',
      status: 'pending',
      priority: 1,
    });
    // a moderação vê a conta nova na fila
    const queue = await moderation.queue();
    expect(queue.reports.map((g) => g.user.id)).toContain(r.user.id);
  });

  it('conta excluída: o login libera o número na hora (account_deleted)', async () => {
    await prisma.user.update({ where: { id: oldId }, data: { deletedAt: new Date() } });
    const r = await auth.login(oldPhone, '123456', META);
    expect(r).toMatchObject({ user: { isNew: true }, released: 'account_deleted' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: oldId } })).phone).toBeNull();
    expect(redis.kv.get(`sms:verified:${oldPhone}`)).toBe('1');
  });

  it('dois "não é minha" com o mesmo desafio: só um libera, o outro vê o desafio vencido', async () => {
    await makeDormant(oldId, 100);
    const claim = (await auth.login(oldPhone, '123456')).claim!;
    const r = await Promise.allSettled([
      auth.releaseClaim(claim.challengeId),
      auth.releaseClaim(claim.challengeId),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.phoneRelease.count({ where: { userId: oldId } })).toBe(1);
  });
});

describe('cadastro: campos novos', () => {
  const proof = (phone: string) => redis.kv.set(`sms:verified:${phone}`, '1');

  it('orientação com exibição/ordem, "mostrar" e invisível com a janela grátis de 24 h', async () => {
    const phone = '+5534966600001';
    proof(phone);
    const r = await auth.register({
      phone,
      name: 'Dani',
      birthDate: new Date('1996-05-05'),
      // app antigo ainda manda "Não-binário": grava 'other'
      gender: 'non_binary',
      termsVersion: '1.2',
      orientation: 'queer',
      showOrientation: true,
      sameOrientationFirst: true,
      showMe: 'women',
      visibilityMode: 'anonymous',
    });
    const u = await prisma.user.findUniqueOrThrow({ where: { id: r.user.id } });
    expect(u).toMatchObject({
      gender: 'other',
      orientation: 'queer',
      showOrientation: true,
      sameOrientationFirst: true,
      showMe: 'women',
      visibilityMode: 'anonymous',
    });
    expect(u.orientationConsentedAt).toBeInstanceOf(Date);
    const window = u.anonymousUntil!.getTime() - Date.now();
    expect(window).toBeGreaterThan(23.9 * 3_600_000);
    expect(window).toBeLessThanOrEqual(24 * 3_600_000);
  });

  it('app antigo (sem visibilityMode): nasce invisível com a janela grátis de 24 h, como antes', async () => {
    const phone = '+5534966600003';
    proof(phone);
    const r = await auth.register({
      phone,
      name: 'Fábio',
      birthDate: new Date('1995-05-05'),
      gender: 'male',
      termsVersion: '1.2',
    });
    const u = await prisma.user.findUniqueOrThrow({ where: { id: r.user.id } });
    expect(u.visibilityMode).toBe('anonymous');
    const window = u.anonymousUntil!.getTime() - Date.now();
    expect(window).toBeGreaterThan(23.9 * 3_600_000);
    expect(window).toBeLessThanOrEqual(24 * 3_600_000);
  });

  it('exibir/ordenar pela orientação sem ter orientação: 400 orientation_required (e a prova de SMS fica)', async () => {
    const phone = '+5534966600002';
    proof(phone);
    await expect(
      auth.register({
        phone,
        name: 'Edu',
        birthDate: new Date('1996-05-05'),
        gender: 'male',
        termsVersion: '1.2',
        showOrientation: true,
      }),
    ).rejects.toMatchObject({ response: { error: 'orientation_required' } });
    expect(redis.kv.get(`sms:verified:${phone}`)).toBe('1');
  });
});

describe('painel', () => {
  async function releaseOld(): Promise<string> {
    await makeDormant(oldId, 100);
    const claim = (await auth.login(oldPhone, '123456')).claim!;
    await auth.releaseClaim(claim.challengeId, META);
    const r = await auth.register({
      phone: oldPhone,
      name: 'Nova Pessoa',
      birthDate: new Date('1998-02-02'),
      gender: 'female',
      termsVersion: '1.2',
    });
    return r.user.id;
  }

  it('a busca pelo número antigo acha a conta antiga (e a nova, que tem o número agora)', async () => {
    const newId = await releaseOld();
    const found = await admin.list(actor(adminId, 'admin'), { q: oldPhone.slice(-8) });
    expect(found.items.map((u) => u.id).sort()).toEqual([newId, oldId].sort());
    const oldRow = found.items.find((u) => u.id === oldId)!;
    expect(oldRow.phone).toBeNull();
    expect(oldRow.phoneReleasedAt).toEqual(expect.any(String));
  });

  it('ficha: histórico com telefone inteiro e link pra conta nova só pra admin; a conta nova vê de onde veio', async () => {
    const newId = await releaseOld();
    const asAdmin = await admin.detail(actor(adminId, 'admin'), oldId);
    expect(asAdmin.phoneReleases).toEqual([
      expect.objectContaining({
        phone: oldPhone,
        reason: 'not_mine',
        accountStatus: 'active',
        newUserId: newId,
        releasedBy: null,
        incoming: false,
        oldUserId: null,
      }),
    ]);
    const asMod = await admin.detail(actor(modId, 'moderator'), oldId);
    expect(asMod.phoneReleases![0].phone).not.toBe(oldPhone);
    expect(asMod.phoneReleases![0].phone).toContain(oldPhone.slice(-4));
    expect(asMod.phoneReleases![0].newUserId).toBeNull();

    const fresh = await admin.detail(actor(adminId, 'admin'), newId);
    expect(fresh.phoneReleases).toEqual([
      expect.objectContaining({ incoming: true, oldUserId: oldId }),
    ]);
    expect(fresh.phoneReleasedAt).toBeNull();
  });

  it('conta nova excluída e limpa (não banida): a ficha dela não mostra mais o número que veio pra ela', async () => {
    const newId = await releaseOld();
    // conta limpa (mesmas colunas da limpeza de verdade: users_purged_clean_chk)
    await prisma.user.update({ where: { id: newId }, data: tombstoneData(new Date(), new Date()) });
    for (const viewer of [actor(adminId, 'admin'), actor(modId, 'moderator')]) {
      const d = await admin.detail(viewer, newId);
      expect(d.phoneReleases).toEqual([expect.objectContaining({ incoming: true, phone: null })]);
      expect(JSON.stringify(d.phoneReleases)).not.toContain(oldPhone.slice(-4));
    }
    // na ficha da conta antiga o histórico (número dela) continua
    const asAdmin = await admin.detail(actor(adminId, 'admin'), oldId);
    expect(asAdmin.phoneReleases![0]).toMatchObject({ phone: oldPhone, incoming: false });
  });

  it('"Liberar número" (só admin): libera, audita, derruba o socket; moderador, a própria conta e conta sem número não', async () => {
    const target = await newUser(prisma, 'Ativa');
    await expect(
      admin.releasePhone(actor(modId, 'moderator'), target.id, { reason: 'pedido do suporte' }),
    ).rejects.toMatchObject({ response: { error: 'forbidden' } });
    await expect(
      admin.releasePhone(actor(adminId, 'admin'), adminId, { reason: 'teste' }),
    ).rejects.toMatchObject({ response: { error: 'own_phone' } });

    const row = await admin.releasePhone(
      actor(adminId, 'admin'),
      target.id,
      { reason: 'linha trocada (#42)' },
      META,
    );
    expect(row.phone).toBeNull();
    expect(row.phoneReleasedAt).toEqual(expect.any(String));
    const rel = await prisma.phoneRelease.findFirstOrThrow({ where: { userId: target.id } });
    expect(rel).toMatchObject({ reason: 'admin', releasedBy: adminId, phone: target.phone });
    expect(gateway.disconnectUser).toHaveBeenCalledWith(
      target.id,
      expect.objectContaining({ error: 'session_revoked' }),
    );
    const [a] = await prisma.auditLog.findMany({ where: { action: 'admin.user.release_phone' } });
    expect(a.userId).toBe(adminId);
    expect(a.metadata).toMatchObject({
      target: { kind: 'user', id: target.id },
      detail: 'linha trocada (#42)',
    });

    await expect(
      admin.releasePhone(actor(adminId, 'admin'), target.id, { reason: 'de novo' }),
    ).rejects.toMatchObject({ response: { error: 'no_phone' } });
    const d = await admin.detail(actor(adminId, 'admin'), target.id);
    expect(d.phoneReleases![0].releasedBy).toEqual({ id: adminId, name: 'Monteiro' });
  });
});
