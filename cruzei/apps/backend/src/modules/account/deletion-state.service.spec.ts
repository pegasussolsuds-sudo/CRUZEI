import { ForbiddenException, UnauthorizedException } from '@nestjs/common';

import type { PrismaService } from '../../database/prisma.service';
import type { RedisService } from '../../redis/redis.service';

import type { AccountStateService } from './account-state.service';
import {
  blockedState,
  DELETION_CHALLENGE_TTL_S,
  deletionChallengeKey,
  DeletionStateService,
  pendingMessage,
} from './deletion-state.service';

// Arrependimento da exclusão: o login com SMS confirmado NÃO restaura sozinho; devolve um desafio de uso único e o
// cancelamento troca o desafio pela conta de volta (pedido 'cancelled', deleted_at NULL, cache 'gone' esquecido).

const U = '0a000000-0000-4000-8000-00000000000a';
const PHONE = '+5534999990000';
const REQ = '0d000000-0000-4000-8000-00000000000d';
const DAY = 86_400_000;

interface UserRow {
  phone: string | null;
  deleted_at: Date | null;
  purged_at: Date | null;
  account_status: string;
  suspended_until: Date | null;
  moderation_reason: string | null;
}

let user: UserRow;
let request: { id: string; requested_at: Date; scheduled_for: Date; status: string } | null;
const updates: { model: string; data: Record<string, unknown> }[] = [];

const kv = new Map<string, string>();
const ttl = new Map<string, number>();
const redis = {
  client: {
    set: jest.fn(async (k: string, v: string, _ex: string, s: number) => {
      kv.set(k, v);
      ttl.set(k, s);
      return 'OK';
    }),
    get: jest.fn(async (k: string) => kv.get(k) ?? null),
    del: jest.fn(async (k: string) => Number(kv.delete(k))),
  },
  invalidateProfile: jest.fn(async () => undefined),
} as unknown as RedisService;

/** ordem das travas (FOR UPDATE) dentro da transação */
const locks: string[] = [];
/** erro de banco simulado na próxima transação */
let failNextTx: Error | null = null;

const tx = {
  $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join('?');
    if (sql.includes('FROM users')) {
      locks.push('users');
      return [user];
    }
    if (sql.includes('FROM data_deletion_requests')) {
      locks.push('request');
      // desafio novo traz o id do pedido: só cancela aquele
      if (sql.includes('WHERE id =') && values[0] !== request?.id) return [];
      return request && request.status === 'pending' ? [request] : [];
    }
    return [];
  }),
  dataDeletionRequest: {
    update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      updates.push({ model: 'ddr', data });
      if (request) request.status = String(data.status);
      return {};
    }),
  },
  user: {
    update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      updates.push({ model: 'user', data });
      if ('deletedAt' in data) user.deleted_at = data.deletedAt as Date | null;
      return {};
    }),
  },
};

const prisma = {
  $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => {
    if (failNextTx) {
      const e = failNextTx;
      failNextTx = null;
      throw e;
    }
    return fn(tx);
  }),
  dataDeletionRequest: {
    findFirst: jest.fn(async () =>
      request && request.status === 'pending' && !user.purged_at
        ? { id: request.id, requestedAt: request.requested_at, scheduledFor: request.scheduled_for }
        : null,
    ),
  },
  user: {
    findUnique: jest.fn(async () => ({
      accountStatus: user.account_status,
      suspendedUntil: user.suspended_until,
      moderationReason: user.moderation_reason,
    })),
  },
} as unknown as PrismaService;

const accounts = { invalidate: jest.fn(async () => undefined) } as unknown as AccountStateService;
const service = new DeletionStateService(prisma, redis, accounts);

beforeEach(() => {
  jest.clearAllMocks();
  kv.clear();
  ttl.clear();
  updates.length = 0;
  locks.length = 0;
  failNextTx = null;
  const requestedAt = new Date(Date.now() - 2 * DAY);
  user = {
    phone: PHONE,
    deleted_at: requestedAt,
    purged_at: null,
    account_status: 'active',
    suspended_until: null,
    moderation_reason: null,
  };
  request = {
    id: REQ,
    requested_at: requestedAt,
    scheduled_for: new Date(requestedAt.getTime() + 30 * DAY),
    status: 'pending',
  };
});

describe('loginChallenge', () => {
  it('pedido pendente: corpo do 409 e desafio de 10 min no Redis', async () => {
    const body = await service.loginChallenge(U, PHONE);
    expect(body).toMatchObject({
      error: 'account_deletion_pending',
      requestedAt: request!.requested_at.toISOString(),
      scheduledFor: request!.scheduled_for.toISOString(),
      expiresIn: DELETION_CHALLENGE_TTL_S,
    });
    expect(body!.message).toContain('Quer cancelar a exclusão');
    const key = deletionChallengeKey(body!.challengeId);
    expect(JSON.parse(kv.get(key)!)).toEqual({ u: U, p: PHONE, r: REQ });
    expect(ttl.get(key)).toBe(600);
  });

  it('sem pedido (exclusão antiga ou já limpa): null, o login segue o caminho de antes', async () => {
    request = null;
    expect(await service.loginChallenge(U, PHONE)).toBeNull();
    expect(kv.size).toBe(0);
  });

  it('banida: 403 de sempre, sem desafio', async () => {
    user.account_status = 'banned';
    await expect(service.loginChallenge(U, PHONE)).rejects.toBeInstanceOf(ForbiddenException);
    expect(kv.size).toBe(0);
  });
});

describe('cancelByChallenge', () => {
  it('restaura: pedido cancelado, deleted_at NULL, corte de sessão no segundo, caches esquecidos', async () => {
    const { challengeId } = (await service.loginChallenge(U, PHONE))!;
    const out = await service.cancelByChallenge(challengeId);
    expect(out).toEqual({
      userId: U,
      restored: {
        requestedAt: request!.requested_at.toISOString(),
        scheduledFor: request!.scheduled_for.toISOString(),
      },
    });
    expect(request!.status).toBe('cancelled');
    expect(user.deleted_at).toBeNull();
    const userUpdate = updates.find((u) => u.model === 'user')!.data;
    expect((userUpdate.sessionsValidAfter as Date).getMilliseconds()).toBe(0);
    expect(updates.find((u) => u.model === 'ddr')!.data).toMatchObject({
      status: 'cancelled',
      holdReason: null,
    });
    expect(accounts.invalidate).toHaveBeenCalledWith(U);
    expect(redis.invalidateProfile).toHaveBeenCalledWith(U);
  });

  it('uso único: o mesmo desafio de novo dá 401 deletion_challenge_expired', async () => {
    const { challengeId } = (await service.loginChallenge(U, PHONE))!;
    await service.cancelByChallenge(challengeId);
    await expect(service.cancelByChallenge(challengeId)).rejects.toMatchObject({
      response: { error: 'deletion_challenge_expired' },
    });
  });

  it('desafio desconhecido ou corrompido: 401', async () => {
    await expect(service.cancelByChallenge('nao-existe')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    kv.set(deletionChallengeKey('x'), '{lixo');
    await expect(service.cancelByChallenge('x')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('número saiu da conta ou a limpeza ganhou a corrida: 401, nada muda', async () => {
    const { challengeId } = (await service.loginChallenge(U, PHONE))!;
    user.phone = null;
    user.purged_at = new Date();
    await expect(service.cancelByChallenge(challengeId)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(updates).toHaveLength(0);
  });

  it('banida no meio do caminho: 403 e o pedido continua pendente', async () => {
    const { challengeId } = (await service.loginChallenge(U, PHONE))!;
    user.account_status = 'banned';
    await expect(service.cancelByChallenge(challengeId)).rejects.toBeInstanceOf(ForbiddenException);
    expect(request!.status).toBe('pending');
    // o desafio não serve mais pra nada
    expect(kv.has(deletionChallengeKey(challengeId))).toBe(false);
  });

  it('trava na MESMA ordem da limpeza: pedido primeiro, depois users (sem deadlock)', async () => {
    const { challengeId } = (await service.loginChallenge(U, PHONE))!;
    await service.cancelByChallenge(challengeId);
    expect(locks).toEqual(['request', 'users']);
  });

  it('pedido que já saiu de pendente: nem trava users', async () => {
    const { challengeId } = (await service.loginChallenge(U, PHONE))!;
    request!.status = 'completed';
    await expect(service.cancelByChallenge(challengeId)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(locks).toEqual(['request']);
  });

  it('desafio só sai depois do commit: erro de banco devolve o erro e dá pra tentar de novo', async () => {
    const { challengeId } = (await service.loginChallenge(U, PHONE))!;
    const key = deletionChallengeKey(challengeId);
    failNextTx = new Error('connection reset');
    await expect(service.cancelByChallenge(challengeId)).rejects.toThrow('connection reset');
    expect(kv.has(key)).toBe(true);
    expect(request!.status).toBe('pending');
    // segunda tentativa com o MESMO desafio funciona e aí ele some
    await expect(service.cancelByChallenge(challengeId)).resolves.toMatchObject({ userId: U });
    expect(kv.has(key)).toBe(false);
  });

  it('desafio de um pedido antigo não cancela o pedido novo', async () => {
    const { challengeId } = (await service.loginChallenge(U, PHONE))!;
    // a pessoa voltou e excluiu de novo: outro pedido pendente
    request = { ...request!, id: '0e000000-0000-4000-8000-00000000000e' };
    await expect(service.cancelByChallenge(challengeId)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(request.status).toBe('pending');
  });

  it('desafio de antes (sem o id do pedido) ainda vale pro pendente da conta', async () => {
    kv.set(deletionChallengeKey('velho'), JSON.stringify({ u: U, p: PHONE }));
    await expect(service.cancelByChallenge('velho')).resolves.toMatchObject({ userId: U });
    expect(request!.status).toBe('cancelled');
  });
});

describe('helpers', () => {
  it('blockedState: suspensão vencida não bloqueia', () => {
    const base = { suspended_until: null, moderation_reason: 'x' };
    expect(blockedState({ ...base, account_status: 'banned' })).toMatchObject({ status: 'banned' });
    expect(blockedState({ ...base, account_status: 'suspended' })).toMatchObject({
      status: 'suspended',
      until: null,
    });
    expect(
      blockedState({
        ...base,
        account_status: 'suspended',
        suspended_until: new Date(Date.now() - 1000),
      }),
    ).toBeNull();
    expect(blockedState({ ...base, account_status: 'active' })).toBeNull();
  });

  it('pendingMessage traz a data dd/mm de São Paulo', () => {
    expect(pendingMessage(new Date('2026-11-03T12:00:00Z'))).toContain('03/11');
  });
});
