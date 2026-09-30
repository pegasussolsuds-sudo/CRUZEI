import { type HttpException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { maskName } from '../../common/name-mask';
import type { PrismaService } from '../../database/prisma.service';
import type { RedisService } from '../../redis/redis.service';
import {
  isRevoked,
  SESSION_REVOKED,
  type AccountStateService,
} from '../account/account-state.service';

import {
  AuthService,
  canRenewWith,
  CLAIM_RATE,
  isAnonymousSignup,
  isRefreshPayload,
  sameBirthDate,
  type JwtPayload,
} from './auth.service';
import type { PhoneReleaseService } from './phone-release.service';
import type { SmsService } from './sms.service';
import { JwtStrategy } from './strategies/jwt.strategy';

// Access e refresh usam o MESMO segredo: o tipo no payload é o que impede o refresh de 30 dias de virar Bearer
// (HTTP e socket) e o access de renovar sessão. Token antigo, sem tipo, ainda renova (ninguém cai no deploy).
// Número reciclado: conta parada há 90+ dias não entra só com o SMS ("Essa conta é sua?" + data de nascimento).

const SECRET = 'segredo-do-teste-de-auth';
const USER = '0a000000-0000-4000-8000-00000000000a';
const OLD = '0b000000-0000-4000-8000-00000000000b';
const GONE = '0c000000-0000-4000-8000-00000000000c';
const PHONE = '+5534999990000';
const OLD_PHONE = '+5534999991111';
const GONE_PHONE = '+5534999992222';
const DAY = 86_400_000;

// como no AuthModule: o segredo vem do registro do módulo (o sign do serviço não passa segredo)
const jwt = new JwtService({ secret: SECRET });
const cfgValues: Record<string, unknown> = {
  'jwt.secret': SECRET,
  'jwt.accessTtl': 900,
  'jwt.refreshTtl': 2_592_000,
};
const cfg = { get: (k: string) => cfgValues[k] } as unknown as ConfigService;

interface FakeUser {
  id: string;
  name: string;
  phone: string | null;
  birthDate: Date;
  createdAt: Date;
  lastActiveAt: Date;
  deletedAt: Date | null;
}
const users = new Map<string, FakeUser>();
function resetUsers() {
  users.clear();
  const longAgo = new Date(Date.now() - 400 * DAY);
  users.set(USER, {
    id: USER,
    name: 'Ana',
    phone: PHONE,
    birthDate: new Date('1995-03-10'),
    createdAt: longAgo,
    lastActiveAt: new Date(),
    deletedAt: null,
  });
  users.set(OLD, {
    id: OLD,
    name: 'Bruna Paula',
    phone: OLD_PHONE,
    birthDate: new Date('1990-07-21'),
    createdAt: new Date('2025-03-15T12:00:00Z'),
    lastActiveAt: longAgo,
    deletedAt: null,
  });
  users.set(GONE, {
    id: GONE,
    name: 'Carla',
    phone: GONE_PHONE,
    birthDate: new Date('1992-01-01'),
    createdAt: longAgo,
    lastActiveAt: new Date(),
    deletedAt: new Date(),
  });
}

/** o que o cadastro gravou (tx.user.create) */
const created: Record<string, unknown>[] = [];
/** catálogo de interesses falso (GET /interests) */
const CATALOG = [
  { id: 1, name: 'Música' },
  { id: 2, name: 'Viagem' },
  { id: 9, name: 'Praia' },
];
const tx = {
  interest: {
    findMany: jest.fn(async ({ where }: { where: { name: { in: string[] } } }) =>
      CATALOG.filter((c) => where.name.in.includes(c.name)).map(({ id }) => ({ id })),
    ),
  },
  userInterest: {
    createMany: jest.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length })),
  },
  user: {
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      created.push(data);
      const u: FakeUser = {
        id: data.id as string,
        name: data.name as string,
        phone: data.phone as string,
        birthDate: data.birthDate as Date,
        createdAt: new Date(),
        lastActiveAt: new Date(),
        deletedAt: null,
      };
      users.set(u.id, u);
      return { ...u };
    }),
  },
};
const prisma = {
  user: {
    findUnique: jest.fn(async ({ where }: { where: { id?: string; phone?: string } }) => {
      const u = where.id
        ? users.get(where.id)
        : [...users.values()].find((x) => x.phone === where.phone);
      return u ? { ...u } : null;
    }),
  },
  $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
} as unknown as PrismaService;

// Redis em memória: o que o fluxo usa (desafio, contador de erros, travas, limites, prova de SMS)
const kv = new Map<string, string>();
/** chaves com prazo (segundos) */
const ttl = new Map<string, number>();
/** simula instâncias sem trava compartilhada: o SET NX das travas sempre passa */
let lockBypass = false;
const redis = {
  client: {
    get: jest.fn(async (k: string) => kv.get(k) ?? null),
    set: jest.fn(async (k: string, v: string, ...opts: unknown[]) => {
      if (opts.includes('NX') && kv.has(k) && !(lockBypass && k.includes(':lock:'))) return null;
      kv.set(k, v);
      const ex = opts.indexOf('EX');
      if (ex >= 0) ttl.set(k, Number(opts[ex + 1]));
      else ttl.delete(k);
      return 'OK';
    }),
    del: jest.fn(async (k: string) => {
      ttl.delete(k);
      return Number(kv.delete(k));
    }),
    getdel: jest.fn(async (k: string) => {
      const v = kv.get(k) ?? null;
      kv.delete(k);
      ttl.delete(k);
      return v;
    }),
    incr: jest.fn(async (k: string) => {
      const n = Number(kv.get(k) ?? 0) + 1;
      kv.set(k, String(n));
      return n;
    }),
    expire: jest.fn(async (k: string, s: number) => {
      if (!kv.has(k)) return 0;
      ttl.set(k, s);
      return 1;
    }),
    persist: jest.fn(async (k: string) => Number(ttl.delete(k))),
  },
  setSignupProof: jest.fn(async (phone: string) => void kv.set(`sms:verified:${phone}`, '1')),
  consumeSignupProof: jest.fn(async (phone: string) => kv.delete(`sms:verified:${phone}`)),
} as unknown as RedisService;
const proofOf = (phone: string) => kv.has(`sms:verified:${phone}`);

const sms = { verifyCode: jest.fn(async () => true) } as unknown as SmsService;

/** corte de sessão por conta (users.sessions_valid_after), em ms */
const validAfter = new Map<string, number>();
const accounts = {
  assertActive: jest.fn(async (userId: string, iat?: number) => {
    if (isRevoked(iat, validAfter.get(userId)))
      throw new UnauthorizedException({ ...SESSION_REVOKED });
    return { status: 'active', until: null, reason: null, role: 'user' };
  }),
} as unknown as AccountStateService;

// liberação falsa: tira o telefone e corta as sessões (a de verdade é testada no banco: phone-recycling.db-spec)
const phones = {
  lastUsedAt: jest.fn(async (id: string) => users.get(id)?.lastActiveAt ?? null),
  release: jest.fn(async ({ userId, phone }: { userId: string; phone: string }) => {
    const u = users.get(userId);
    if (!u || u.phone !== phone) return false;
    u.phone = null;
    validAfter.set(userId, Date.now());
    return true;
  }),
  pendingReleases: jest.fn(async () => []),
  linkNewAccount: jest.fn(async () => undefined),
} as unknown as PhoneReleaseService;
const releaseMock = phones.release as unknown as jest.Mock;

const service = new AuthService(prisma, jwt, cfg, sms, redis, accounts, phones);
const strategy = new JwtStrategy(cfg, accounts);

const decode = (t: string) =>
  jwt.verify<JwtPayload & { exp: number; iat: number }>(t, { secret: SECRET });
const sign = (p: object, expiresIn = 900) => jwt.sign(p, { secret: SECRET, expiresIn });

beforeEach(() => {
  resetUsers();
  kv.clear();
  ttl.clear();
  lockBypass = false;
  created.length = 0;
  validAfter.clear();
  jest.clearAllMocks();
  delete cfgValues['auth.dormantDays'];
  delete cfgValues['auth.claimMaxAttempts'];
});

describe('tipo do token (access × refresh)', () => {
  it('regras puras: refresh nunca autentica; renovar aceita refresh ou token antigo sem tipo', () => {
    expect(isRefreshPayload({ typ: 'refresh' })).toBe(true);
    expect(isRefreshPayload({ typ: 'access' })).toBe(false);
    expect(isRefreshPayload({})).toBe(false);
    expect(isRefreshPayload(null)).toBe(false);
    expect(canRenewWith({ typ: 'refresh' })).toBe(true);
    expect(canRenewWith({})).toBe(true);
    expect(canRenewWith({ typ: 'access' })).toBe(false);
    expect(canRenewWith(null)).toBe(false);
  });

  it('refresh devolve um par novo com tipo: access curto e refresh longo', async () => {
    const r = await service.refresh(sign({ sub: USER, typ: 'refresh' }, 2_592_000));
    const access = decode(r.token);
    const refresh = decode(r.refreshToken);
    expect(access).toMatchObject({ sub: USER, typ: 'access' });
    expect(refresh).toMatchObject({ sub: USER, typ: 'refresh' });
    expect(access.exp - access.iat).toBe(900);
    expect(refresh.exp - refresh.iat).toBe(2_592_000);
  });

  it('token antigo (sem tipo) ainda renova: ninguém é deslogado no deploy', async () => {
    const r = await service.refresh(sign({ sub: USER }, 2_592_000));
    expect(decode(r.refreshToken).typ).toBe('refresh');
  });

  it('access mandado no /auth/refresh é recusado (401)', async () => {
    await expect(service.refresh(sign({ sub: USER, typ: 'access' }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(service.refresh('lixo')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('Bearer: access (novo ou antigo) passa; refresh é recusado antes de olhar a conta', async () => {
    await expect(strategy.validate({ sub: USER, typ: 'access' })).resolves.toMatchObject({
      id: USER,
      role: 'user',
    });
    await expect(strategy.validate({ sub: USER })).resolves.toMatchObject({ id: USER });
    (accounts.assertActive as jest.Mock).mockClear();
    await expect(strategy.validate({ sub: USER, typ: 'refresh' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(accounts.assertActive).not.toHaveBeenCalled();
  });
});

describe('sessão revogada (sessions_valid_after)', () => {
  it('regra pura: iat (s) antes do corte (ms) cai; sem iat ou sem corte vale', () => {
    expect(isRevoked(1_000, 1_000_001)).toBe(true);
    expect(isRevoked(1_001, 1_000_001)).toBe(false);
    expect(isRevoked(undefined, 1_000_001)).toBe(false);
    expect(isRevoked(1_000, null)).toBe(false);
    expect(isRevoked(1_000, undefined)).toBe(false);
  });

  it('refresh e Bearer com iat anterior ao corte: 401 session_revoked; o telefone do token novo vem do banco', async () => {
    const before = Math.floor(Date.now() / 1000) - 60;
    const refresh = jwt.sign(
      { sub: USER, typ: 'refresh', phone: '+5511000000000', iat: before },
      { secret: SECRET },
    );
    const ok = await service.refresh(refresh);
    // o phone do token antigo não passa pro novo: vale o do banco
    expect(decode(ok.token).phone).toBe(PHONE);

    validAfter.set(USER, Date.now() - 30_000);
    await expect(service.refresh(refresh)).rejects.toMatchObject({
      response: { error: 'session_revoked' },
    });
    await expect(
      strategy.validate({ sub: USER, typ: 'access', iat: before }),
    ).rejects.toMatchObject({
      response: { error: 'session_revoked' },
    });
    // token emitido depois do corte segue valendo
    await expect(
      strategy.validate({ sub: USER, typ: 'access', iat: Math.floor(Date.now() / 1000) }),
    ).resolves.toMatchObject({ id: USER });
  });
});

describe('número reciclado: login', () => {
  it('conta ativa entra direto só com o SMS (sem consultar o histórico)', async () => {
    const r = await service.login(PHONE, '123456');
    expect(r.token).toEqual(expect.any(String));
    expect(r.user).toMatchObject({ id: USER, isNew: false });
    expect(r.claim).toBeUndefined();
    expect(phones.lastUsedAt).not.toHaveBeenCalled();
  });

  it('número sem conta: isNew + prova de SMS pro cadastro', async () => {
    const r = await service.login('+5534988887777', '123456');
    expect(r).toMatchObject({ user: { id: null, isNew: true }, token: null, refreshToken: null });
    expect(proofOf('+5534988887777')).toBe(true);
  });

  it('conta parada: devolve o desafio (só iniciais, sem mês de criação) sem token nem prova de SMS', async () => {
    const r = await service.login(OLD_PHONE, '123456');
    expect(r.token).toBeNull();
    expect(r.refreshToken).toBeNull();
    expect(r.user).toEqual({ id: null, name: '', phone: OLD_PHONE, isNew: false });
    expect(r.claim).toEqual({
      challengeId: expect.any(String),
      maskedName: 'B••• P•••',
      createdMonth: null,
      attemptsLeft: 3,
      expiresIn: 600,
    });
    expect(proofOf(OLD_PHONE)).toBe(false);
    expect(releaseMock).not.toHaveBeenCalled();
  });

  it('posição antiga mas login/refresh recente (histórico) não conta como parada', async () => {
    (phones.lastUsedAt as jest.Mock).mockResolvedValueOnce(new Date(Date.now() - 10 * DAY));
    const r = await service.login(OLD_PHONE, '123456');
    expect(r.token).toEqual(expect.any(String));
    expect(r.claim).toBeUndefined();
  });

  it('AUTH_DORMANT_DAYS=0 desliga a confirmação', async () => {
    cfgValues['auth.dormantDays'] = 0;
    const r = await service.login(OLD_PHONE, '123456');
    expect(r.token).toEqual(expect.any(String));
  });

  it('conta excluída: o número é liberado direto (account_deleted) e segue pro cadastro', async () => {
    const r = await service.login(GONE_PHONE, '123456');
    expect(r).toMatchObject({ user: { isNew: true }, token: null, released: 'account_deleted' });
    expect(releaseMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: GONE, phone: GONE_PHONE, reason: 'account_deleted' }),
    );
    expect(proofOf(GONE_PHONE)).toBe(true);
  });
});

describe('número reciclado: "Essa conta é sua?"', () => {
  const challenge = async () => (await service.login(OLD_PHONE, '123456')).claim!.challengeId;

  it('data certa: sessão normal, desafio e contador apagados', async () => {
    const id = await challenge();
    const r = await service.confirmClaim(id, '1990-07-21');
    expect(r.token).toEqual(expect.any(String));
    expect(r.user).toMatchObject({ id: OLD, isNew: false });
    expect(kv.has(`auth:claim:${id}`)).toBe(false);
    expect(kv.has(`auth:claim:fails:${OLD}`)).toBe(false);
    // as travas foram soltas
    expect([...kv.keys()].filter((k) => k.includes(':lock:'))).toEqual([]);
    await expect(service.confirmClaim(id, '1990-07-21')).rejects.toMatchObject({
      response: { error: 'claim_expired' },
    });
    expect(releaseMock).not.toHaveBeenCalled();
  });

  it('data errada: 401 claim_mismatch com as tentativas; na 3ª o número é liberado (birthdate_mismatch)', async () => {
    const id = await challenge();
    await expect(service.confirmClaim(id, '1990-07-22')).rejects.toMatchObject({
      response: { error: 'claim_mismatch', attemptsLeft: 2 },
    });
    await expect(service.confirmClaim(id, '1991-07-21')).rejects.toMatchObject({
      response: { error: 'claim_mismatch', attemptsLeft: 1 },
    });
    const r = await service.confirmClaim(id, '2000-01-01');
    expect(r).toMatchObject({ user: { isNew: true }, token: null, released: 'birthdate_mismatch' });
    expect(releaseMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: OLD, phone: OLD_PHONE, reason: 'birthdate_mismatch' }),
    );
    expect(proofOf(OLD_PHONE)).toBe(true);
    expect(users.get(OLD)!.phone).toBeNull();
  });

  it('as tentativas são por CONTA: pedir outro SMS não devolve as chances', async () => {
    const first = await challenge();
    await expect(service.confirmClaim(first, '1990-01-01')).rejects.toMatchObject({
      response: { attemptsLeft: 2 },
    });
    const again = await service.login(OLD_PHONE, '123456');
    expect(again.claim!.attemptsLeft).toBe(2);
    await expect(
      service.confirmClaim(again.claim!.challengeId, '1990-01-02'),
    ).rejects.toMatchObject({
      response: { attemptsLeft: 1 },
    });
  });

  it('"Não é minha": libera (not_mine), prova de SMS e o mesmo desafio não serve de novo', async () => {
    const id = await challenge();
    const r = await service.releaseClaim(id, { ip: '10.0.0.1', port: 5555, userAgent: 'teste' });
    expect(r).toMatchObject({ user: { isNew: true, phone: OLD_PHONE }, released: 'not_mine' });
    expect(releaseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: OLD,
        phone: OLD_PHONE,
        reason: 'not_mine',
        meta: { ip: '10.0.0.1', port: 5555, userAgent: 'teste' },
      }),
    );
    expect(proofOf(OLD_PHONE)).toBe(true);
    await expect(service.releaseClaim(id)).rejects.toMatchObject({
      response: { error: 'claim_expired' },
    });
    await expect(service.confirmClaim(id, '1990-07-21')).rejects.toMatchObject({
      response: { error: 'claim_expired' },
    });
  });

  it('depois da liberação a conta antiga perde a sessão (refresh antigo dá 401 session_revoked)', async () => {
    const oldRefresh = jwt.sign(
      { sub: OLD, typ: 'refresh', iat: Math.floor(Date.now() / 1000) - 3600 },
      { secret: SECRET },
    );
    await service.releaseClaim(await challenge());
    await expect(service.refresh(oldRefresh)).rejects.toMatchObject({
      response: { error: 'session_revoked' },
    });
  });

  it('desafio desconhecido ou vencido: 401 claim_expired', async () => {
    await expect(
      service.confirmClaim('0f000000-0000-4000-8000-0000000000ff', '1990-07-21'),
    ).rejects.toMatchObject({ response: { error: 'claim_expired' } });
  });

  it('desafio de um número que já saiu da conta: claim_expired (não confere data nem libera)', async () => {
    const id = await challenge();
    users.get(OLD)!.phone = null;
    await expect(service.confirmClaim(id, '1990-07-21')).rejects.toMatchObject({
      response: { error: 'claim_expired' },
    });
    expect(releaseMock).not.toHaveBeenCalled();
  });
});

describe('número reciclado: força bruta e contador sem prazo', () => {
  const FAILS = `auth:claim:fails:${OLD}`;
  const challenge = async () => (await service.login(OLD_PHONE, '123456')).claim!.challengeId;
  const day = (i: number) => `2000-01-${String(i + 1).padStart(2, '0')}`;
  const errorOf = (x: PromiseSettledResult<unknown>) =>
    x.status === 'rejected' ? (x.reason as HttpException) : null;
  const isMismatch = (x: PromiseSettledResult<unknown>) =>
    (errorOf(x)?.getResponse?.() as { error?: string } | undefined)?.error === 'claim_mismatch';
  const is429 = (x: PromiseSettledResult<unknown>) => errorOf(x)?.getStatus?.() === 429;
  const locks = () => [...kv.keys()].filter((k) => k.includes(':lock:'));

  it('o contador de erros não vence (nem o que a versão antiga gravou com 24 h)', async () => {
    const id = await challenge();
    kv.set(FAILS, '1');
    ttl.set(FAILS, 3_600);
    await expect(service.confirmClaim(id, '1990-01-01')).rejects.toMatchObject({
      response: { error: 'claim_mismatch', attemptsLeft: 1 },
    });
    expect(kv.get(FAILS)).toBe('2');
    expect(ttl.has(FAILS)).toBe(false);
    expect(redis.client.expire).not.toHaveBeenCalledWith(FAILS, expect.anything());
  });

  it('o 3º erro ACUMULADO libera, mesmo com os erros espalhados no tempo e em desafios diferentes', async () => {
    kv.set(FAILS, '2'); // dois erros de muito tempo atrás
    const again = await service.login(OLD_PHONE, '123456');
    expect(again.claim!.attemptsLeft).toBe(1);
    const r = await service.confirmClaim(again.claim!.challengeId, '2000-01-01');
    expect(r).toMatchObject({ user: { isNew: true }, token: null, released: 'birthdate_mismatch' });
    expect(users.get(OLD)!.phone).toBeNull();
  });

  it('contador já no máximo (a liberação caiu no meio): o login libera direto, sem desafio', async () => {
    kv.set(FAILS, '3');
    const r = await service.login(OLD_PHONE, '123456', { ip: '10.0.0.2', port: 1, userAgent: 'x' });
    expect(r.claim).toBeUndefined();
    expect(r).toMatchObject({ user: { isNew: true }, token: null, released: 'birthdate_mismatch' });
    expect(releaseMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: OLD, phone: OLD_PHONE, reason: 'birthdate_mismatch' }),
    );
    expect(proofOf(OLD_PHONE)).toBe(true);
  });

  it('a tentativa é reservada ANTES de comparar: com o contador no máximo nem a data certa entra (libera)', async () => {
    const id = await challenge();
    kv.set(FAILS, '3');
    const r = await service.confirmClaim(id, '1990-07-21');
    expect(r.token).toBeNull();
    expect(r).toMatchObject({ released: 'birthdate_mismatch' });
    expect(users.get(OLD)!.phone).toBeNull();
  });

  it('rajada no mesmo desafio: só um pedido confere (trava + limite por desafio), o resto leva 429', async () => {
    const id = await challenge();
    const r = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => service.confirmClaim(id, day(i))),
    );
    expect(r.filter(isMismatch)).toHaveLength(1);
    expect(r.filter(is429)).toHaveLength(9);
    expect(kv.get(FAILS)).toBe('1');
    expect(locks()).toEqual([]);
    expect(releaseMock).not.toHaveBeenCalled();
  });

  it('rajada em desafios diferentes da mesma conta: a trava da conta segura (429)', async () => {
    const a = await challenge();
    const b = await challenge();
    const r = await Promise.allSettled([
      service.confirmClaim(a, day(0)),
      service.confirmClaim(b, day(1)),
    ]);
    expect(r.filter(isMismatch)).toHaveLength(1);
    expect(r.filter(is429)).toHaveLength(1);
    expect(kv.get(FAILS)).toBe('1');
    expect(locks()).toEqual([]);
  });

  it('sem trava compartilhada (várias instâncias): só as primeiras reservas comparam; a data certa no fim não entra', async () => {
    lockBypass = true;
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) ids.push(await challenge());
    const r = await Promise.allSettled(
      ids.map((id, i) => service.confirmClaim(id, i === ids.length - 1 ? '1990-07-21' : day(i))),
    );
    // max = 3: dois erros respondem claim_mismatch, o 3º libera; o resto nem compara
    expect(r.filter(isMismatch)).toHaveLength(2);
    expect(r.some((x) => x.status === 'fulfilled' && x.value.token)).toBe(false);
    expect(users.get(OLD)!.phone).toBeNull();
  });

  it('limite por desafio e por conta: passou → 429 sem gastar tentativa', async () => {
    const id = await challenge();
    const cKey = `auth:claim:rl:c:${id}`;
    const uKey = `auth:claim:rl:u:${OLD}`;
    kv.set(cKey, String(CLAIM_RATE.challenge.limit));
    await expect(service.confirmClaim(id, '1990-07-21')).rejects.toMatchObject({
      status: 429,
      response: { error: 'too_many_requests' },
    });
    expect(kv.has(FAILS)).toBe(false);

    kv.delete(cKey);
    kv.set(uKey, String(CLAIM_RATE.user.limit));
    await expect(service.releaseClaim(id)).rejects.toMatchObject({ status: 429 });
    await expect(service.confirmClaim(id, '1990-07-21')).rejects.toMatchObject({ status: 429 });
    expect(releaseMock).not.toHaveBeenCalled();
    expect(kv.has(`auth:claim:${id}`)).toBe(true);

    // janela nova: o primeiro pedido grava o prazo de cada contador
    kv.delete(cKey);
    kv.delete(uKey);
    await expect(service.confirmClaim(id, '2000-01-01')).rejects.toMatchObject({
      response: { error: 'claim_mismatch' },
    });
    expect(ttl.get(cKey)).toBe(CLAIM_RATE.challenge.ttlS);
    expect(ttl.get(uKey)).toBe(CLAIM_RATE.user.ttlS);
  });

  it('desafio ou conta travados por outro pedido: 429 sem gastar tentativa e sem apagar a trava alheia', async () => {
    const id = await challenge();
    kv.set(`auth:claim:lock:c:${id}`, 'outro');
    await expect(service.confirmClaim(id, '2000-01-01')).rejects.toMatchObject({
      status: 429,
      response: { error: 'too_many_requests' },
    });
    expect(kv.get(`auth:claim:lock:c:${id}`)).toBe('outro');

    kv.delete(`auth:claim:lock:c:${id}`);
    kv.set(`auth:claim:lock:u:${OLD}`, 'outro');
    await expect(service.releaseClaim(id)).rejects.toMatchObject({ status: 429 });
    // soltou a trava do desafio que tinha pegado; a da conta continua de quem pegou
    expect(kv.has(`auth:claim:lock:c:${id}`)).toBe(false);
    expect(kv.get(`auth:claim:lock:u:${OLD}`)).toBe('outro');
    expect(kv.has(FAILS)).toBe(false);
    expect(releaseMock).not.toHaveBeenCalled();
  });

  it('o desafio usado por outro pedido entre a leitura e a trava: claim_expired sem gastar tentativa', async () => {
    const id = await challenge();
    (prisma.user.findUnique as jest.Mock).mockImplementationOnce(async () => {
      kv.delete(`auth:claim:${id}`); // o pedido anterior acertou/liberou nesse meio-tempo
      return { ...users.get(OLD)! };
    });
    await expect(service.confirmClaim(id, '2000-01-01')).rejects.toMatchObject({
      response: { error: 'claim_expired' },
    });
    expect(kv.has(FAILS)).toBe(false);
    expect(locks()).toEqual([]);
  });
});

describe('cadastro: visibilidade', () => {
  const NEW = '+5534977770000';
  const base = {
    phone: NEW,
    name: 'Nova',
    birthDate: new Date('1998-02-02'),
    gender: 'female',
    termsVersion: '1.2',
  };
  const H24 = 24 * 3_600_000;
  const window = (d: Record<string, unknown>, before: number) =>
    (d.anonymousUntil as Date).getTime() - before;

  it('app antigo (sem visibilityMode): nasce invisível com a janela grátis de 24 h, como antes', async () => {
    kv.set(`sms:verified:${NEW}`, '1');
    const before = Date.now();
    const r = await service.register(base);
    expect(r.token).toEqual(expect.any(String));
    expect(created[0].visibilityMode).toBe('anonymous');
    expect(window(created[0], before)).toBeGreaterThanOrEqual(H24);
    expect(window(created[0], before)).toBeLessThan(H24 + 5_000);
  });

  it("'visible' nasce visível sem janela; 'anonymous' nasce invisível com 24 h", async () => {
    kv.set(`sms:verified:${NEW}`, '1');
    await service.register({ ...base, visibilityMode: 'visible' });
    expect(created[0]).toMatchObject({ visibilityMode: 'visible', anonymousUntil: null });

    const other = '+5534977770001';
    kv.set(`sms:verified:${other}`, '1');
    const before = Date.now();
    await service.register({ ...base, phone: other, visibilityMode: 'anonymous' });
    expect(created[1].visibilityMode).toBe('anonymous');
    expect(window(created[1], before)).toBeGreaterThanOrEqual(H24);
  });
});

describe('cadastro: nome, bio, Instagram e interesses', () => {
  const NEW = '+5534977770100';
  const base = {
    phone: NEW,
    name: 'Nova',
    birthDate: new Date('1998-02-02'),
    gender: 'female',
    termsVersion: '1.2',
    visibilityMode: 'visible' as const,
  };
  const createMany = tx.userInterest.createMany as jest.Mock;

  it('grava bio sem as pontas, o @ normalizado e só os interesses do catálogo (sem repetido)', async () => {
    kv.set(`sms:verified:${NEW}`, '1');
    await service.register({
      ...base,
      name: '  Nova   Silva ',
      bio: '  café, praia e samba \n',
      instagram: 'https://www.instagram.com/Nova.Silva/?hl=pt-br',
      interests: ['Música', 'Música', 'Praia', 'Não existe'],
      lookingFor: 'casual',
    });
    expect(created[0]).toMatchObject({
      name: 'Nova Silva',
      bio: 'café, praia e samba',
      instagramHandle: 'nova.silva',
      // nome 10 + intenção 5 + bio 15 (2 interesses ainda não somam)
      profileCompleteness: 30,
    });
    expect(createMany).toHaveBeenCalledWith({
      data: [
        { userId: created[0].id, interestId: 1 },
        { userId: created[0].id, interestId: 9 },
      ],
      skipDuplicates: true,
    });
  });

  it('sem as etapas opcionais: bio e @ nulos, nenhum interesse gravado', async () => {
    kv.set(`sms:verified:${NEW}`, '1');
    await service.register({ ...base, bio: '   ', instagram: '' });
    expect(created[0]).toMatchObject({ bio: null, instagramHandle: null, profileCompleteness: 10 });
    expect(tx.interest.findMany).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });

  it('3+ interesses do catálogo contam na completude', async () => {
    kv.set(`sms:verified:${NEW}`, '1');
    await service.register({ ...base, interests: ['Música', 'Viagem', 'Praia'] });
    expect(created[0].profileCompleteness).toBe(25);
  });

  it('@ fora da regra ou nome vazio: 400 claro e a prova do SMS continua valendo (dá pra corrigir e seguir)', async () => {
    kv.set(`sms:verified:${NEW}`, '1');
    await expect(service.register({ ...base, instagram: '.fulana' })).rejects.toMatchObject({
      response: { error: 'instagram_invalid' },
    });
    await expect(service.register({ ...base, name: '  a ' })).rejects.toMatchObject({
      response: { error: 'name_invalid' },
    });
    expect(proofOf(NEW)).toBe(true);
    expect(created).toHaveLength(0);
    // corrigiu: agora cria
    await service.register({ ...base, instagram: '@fulana' });
    expect(created[0].instagramHandle).toBe('fulana');
    expect(proofOf(NEW)).toBe(false);
  });

  it('filtro de abuso: 400 text_blocked com o campo (o app volta pra etapa) e a prova do SMS continua valendo', async () => {
    kv.set(`sms:verified:${NEW}`, '1');
    await expect(service.register({ ...base, bio: 'vou te matar' })).rejects.toMatchObject({
      response: { error: 'text_blocked', field: 'bio', reason: 'threat' },
    });
    await expect(service.register({ ...base, name: 'Caralho' })).rejects.toMatchObject({
      response: { error: 'text_blocked', field: 'name' },
    });
    expect(created).toHaveLength(0);
    expect(proofOf(NEW)).toBe(true);
  });

  it('app antigo mandando "non_binary": grava "other"', async () => {
    kv.set(`sms:verified:${NEW}`, '1');
    await service.register({ ...base, gender: 'non_binary' });
    expect(created[0].gender).toBe('other');
  });
});

describe('helpers', () => {
  it('maskName: inicial + 3 bolinhas por nome (tamanho fixo), até 3 palavras', () => {
    expect(maskName('Ana Paula')).toBe('A••• P•••');
    expect(maskName('Bruna Paula')).toBe('B••• P•••');
    expect(maskName('  joão   da silva souza ')).toBe('j••• d••• s•••');
    expect(maskName('Ó')).toBe('Ó•••');
    expect(maskName('😀 Maximiliano')).toBe('😀••• M•••');
    // nome curto e nome longo com a mesma inicial ficam iguais
    expect(maskName('Bo')).toBe(maskName('Bartolomeu'));
    expect(maskName('')).toBe('••••');
    expect(maskName(null)).toBe('••••');
  });

  it('isAnonymousSignup: só "visible" nasce visível; ausente (app antigo) nasce invisível', () => {
    expect(isAnonymousSignup('visible')).toBe(false);
    expect(isAnonymousSignup('anonymous')).toBe(true);
    expect(isAnonymousSignup(undefined)).toBe(true);
    expect(isAnonymousSignup(null)).toBe(true);
  });

  it('sameBirthDate compara o dia da coluna @db.Date com AAAA-MM-DD', () => {
    expect(sameBirthDate(new Date('1990-07-21'), '1990-07-21')).toBe(true);
    expect(sameBirthDate(new Date('1990-07-21'), '1990-7-21')).toBe(false);
    expect(sameBirthDate(new Date('invalid'), '1990-07-21')).toBe(false);
  });
});
