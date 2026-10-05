import { INBOX_EVENTS } from '@cruzei/shared-types';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { PrismaService } from '../../database/prisma.service';
import type { ChatGateway } from '../../realtime/chat.gateway';
import type { RedisService } from '../../redis/redis.service';
import type { AccountStateService } from '../account/account-state.service';

import { AccountDeletionService, isDeletionReason } from './account-deletion.service';

// Pedido de exclusão: confirmação exata, conta da equipe barrada, idempotente (inclusive na corrida do índice único);
// na hora: sessões e push cortados, presença fora, conversa some ao vivo do outro lado e o socket cai.

const U = '0a000000-0000-4000-8000-00000000000a';
const PEER = '0b000000-0000-4000-8000-00000000000b';
const PEER2 = '0c000000-0000-4000-8000-00000000000c';
const C1 = '0d000000-0000-4000-8000-00000000000d';
const C2 = '0e000000-0000-4000-8000-00000000000e';
const DAY = 86_400_000;
const NOW = new Date('2026-10-05T12:00:00.000Z');

let role = 'user';
let deletedAt: Date | null = null;
let pending: { requestedAt: Date; scheduledFor: Date } | null = null;
let createError: Error | null = null;
const created: Record<string, unknown>[] = [];
const userUpdates: Record<string, unknown>[] = [];

const tx = {
  $queryRaw: jest.fn(async () => [{ role, deleted_at: deletedAt }]),
  dataDeletionRequest: {
    findFirst: jest.fn(async () => pending),
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      if (createError) throw createError;
      created.push(data);
      return { requestedAt: data.requestedAt, scheduledFor: data.scheduledFor };
    }),
  },
  user: {
    update: jest.fn(
      async ({ data }: { data: Record<string, unknown> }) => void userUpdates.push(data),
    ),
  },
  deviceToken: { deleteMany: jest.fn(async () => ({ count: 1 })) },
};

const prisma = {
  $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  dataDeletionRequest: { findFirst: jest.fn(async () => pending) },
  user: { findUnique: jest.fn(async () => ({ role })) },
  subscription: { findFirst: jest.fn(async () => null) },
  conversation: {
    findMany: jest.fn(async () => [
      // a outra pessoa vê a conversa: some ao vivo
      {
        id: C1,
        userLowId: U,
        userHighId: PEER,
        members: [
          { userId: U, archivedAt: null },
          { userId: PEER, archivedAt: null },
        ],
      },
      // a outra pessoa já arquivou: não precisa avisar
      { id: C2, userLowId: PEER2, userHighId: U, members: [{ userId: PEER2, archivedAt: NOW }] },
    ]),
  },
} as unknown as PrismaService;

const redisClient = {
  hget: jest.fn(async () => '6upq8c'),
  multi: jest.fn(() => {
    const m: { zrem: jest.Mock; del: jest.Mock; exec: jest.Mock } = {
      zrem: jest.fn(),
      del: jest.fn(),
      exec: jest.fn(async () => []),
    };
    m.zrem.mockReturnValue(m);
    m.del.mockReturnValue(m);
    return m;
  }),
};
const redis = {
  client: redisClient,
  markPresenceHidden: jest.fn(async () => undefined),
  invalidateProfile: jest.fn(async () => undefined),
} as unknown as RedisService;
const accounts = { invalidate: jest.fn(async () => undefined) } as unknown as AccountStateService;
const gateway = {
  emitToUsers: jest.fn(),
  removeFromConversation: jest.fn(),
  disconnectUser: jest.fn(),
};
const service = new AccountDeletionService(
  prisma,
  redis,
  accounts,
  gateway as unknown as ChatGateway,
);

const ORIGINAL_GRACE = process.env.ACCOUNT_DELETION_GRACE_DAYS;

beforeEach(() => {
  jest.clearAllMocks();
  role = 'user';
  deletedAt = null;
  pending = null;
  createError = null;
  created.length = 0;
  userUpdates.length = 0;
  delete process.env.ACCOUNT_DELETION_GRACE_DAYS;
});

afterAll(() => {
  if (ORIGINAL_GRACE === undefined) delete process.env.ACCOUNT_DELETION_GRACE_DAYS;
  else process.env.ACCOUNT_DELETION_GRACE_DAYS = ORIGINAL_GRACE;
});

describe('request', () => {
  it('confirmação errada: 400 confirm_required, nada muda', async () => {
    for (const confirm of [undefined, 'excluir', 'EXCLUIR ', 1]) {
      await expect(service.request(U, { confirm }, NOW)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('conta da equipe: 409 staff_account', async () => {
    role = 'moderator';
    await expect(service.request(U, { confirm: 'EXCLUIR' }, NOW)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(created).toHaveLength(0);
    expect(userUpdates).toHaveLength(0);
  });

  it('cria o pedido com 30 dias, some na hora e corta sessões e push', async () => {
    const out = await service.request(U, { confirm: 'EXCLUIR', reason: 'privacy' }, NOW);
    expect(out).toEqual({
      requestedAt: NOW.toISOString(),
      scheduledFor: new Date(NOW.getTime() + 30 * DAY).toISOString(),
      graceDays: 30,
      created: true,
    });
    expect(created[0]).toMatchObject({
      userId: U,
      status: 'pending',
      source: 'app',
      reason: 'privacy',
    });
    expect(userUpdates[0]).toEqual({ deletedAt: NOW, sessionsValidAfter: NOW });
    expect(tx.deviceToken.deleteMany).toHaveBeenCalledWith({ where: { userId: U } });
  });

  it('motivo fora da lista é ignorado; prazo vem do ambiente', async () => {
    process.env.ACCOUNT_DELETION_GRACE_DAYS = '7';
    const out = await service.request(U, { confirm: 'EXCLUIR', reason: 'hacker' }, NOW);
    expect(created[0].reason).toBeNull();
    expect(out.graceDays).toBe(7);
    expect(out.scheduledFor).toBe(new Date(NOW.getTime() + 7 * DAY).toISOString());
  });

  it('idempotente: pedido pendente devolve o mesmo, sem criar outro', async () => {
    pending = {
      requestedAt: new Date(NOW.getTime() - DAY),
      scheduledFor: new Date(NOW.getTime() + 29 * DAY),
    };
    deletedAt = pending.requestedAt;
    const out = await service.request(U, { confirm: 'EXCLUIR' }, NOW);
    expect(out.created).toBe(false);
    expect(out.requestedAt).toBe(pending.requestedAt.toISOString());
    expect(created).toHaveLength(0);
    // deleted_at original fica
    expect(userUpdates[0].deletedAt).toBe(pending.requestedAt);
  });

  it('corrida no índice único (P2002): devolve o pedido do outro', async () => {
    createError = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: '5.20.0',
    });
    const first = { requestedAt: NOW, scheduledFor: new Date(NOW.getTime() + 30 * DAY) };
    (prisma.dataDeletionRequest.findFirst as jest.Mock).mockResolvedValueOnce(first);
    const out = await service.request(U, { confirm: 'EXCLUIR' }, NOW);
    expect(out).toMatchObject({ created: false, requestedAt: NOW.toISOString() });
  });

  it('depois do commit: estado da conta, presença, conversas do outro lado e socket', async () => {
    await service.request(U, { confirm: 'EXCLUIR' }, NOW);
    expect(accounts.invalidate).toHaveBeenCalledWith(U);
    expect(redis.markPresenceHidden).toHaveBeenCalledWith(U);
    expect(redisClient.multi).toHaveBeenCalled();
    // só quem ainda via a conversa recebe o "sumiu"
    expect(gateway.emitToUsers).toHaveBeenCalledTimes(1);
    expect(gateway.emitToUsers).toHaveBeenCalledWith([PEER], INBOX_EVENTS.conversationRemoved, {
      conversationId: C1,
    });
    expect(gateway.removeFromConversation).toHaveBeenCalledWith(C1, [U, PEER]);
    expect(gateway.removeFromConversation).toHaveBeenCalledWith(C2, [PEER2, U]);
    expect(redis.invalidateProfile).toHaveBeenCalledWith(PEER);
    expect(redis.invalidateProfile).toHaveBeenCalledWith(PEER2);
    expect(gateway.disconnectUser).toHaveBeenCalledWith(
      U,
      expect.objectContaining({ error: 'account_gone' }),
    );
  });
});

describe('preview', () => {
  it('prazo, assinatura de loja ativa e conta da equipe', async () => {
    (prisma.subscription.findFirst as jest.Mock).mockResolvedValueOnce({
      platform: 'android',
      expiresAt: new Date(NOW.getTime() + 10 * DAY),
    });
    const p = await service.preview(U, NOW);
    expect(p).toEqual({
      graceDays: 30,
      wouldCompleteAt: new Date(NOW.getTime() + 30 * DAY).toISOString(),
      activeSubscription: {
        platform: 'android',
        expiresAt: new Date(NOW.getTime() + 10 * DAY).toISOString(),
      },
      staff: false,
    });
    role = 'admin';
    expect((await service.preview(U, NOW)).staff).toBe(true);
  });
});

describe('isDeletionReason', () => {
  it('só os da lista', () => {
    expect(isDeletionReason('met_someone')).toBe(true);
    expect(isDeletionReason('other')).toBe(true);
    expect(isDeletionReason('x')).toBe(false);
    expect(isDeletionReason(null)).toBe(false);
  });
});
