import type { PrismaService } from '../../database/prisma.service';
import type { ChatGateway } from '../../realtime/chat.gateway';
import type { RedisService } from '../../redis/redis.service';
import type { PhotoModerationService } from '../moderation/photo-moderation.service';

import { UsersService } from './users.service';

// PATCH /me/settings sem banco: a faixa de idade muda no máximo 5 vezes por dia de São Paulo (429 age_range_limit).
// Igual ao gravado não gasta; faixa final fora da regra é 400 sem gastar. Com banco: test/db/signup-profile.db-spec.ts.

const ID = 'ana';

function setup(start = { ageMin: 18, ageMax: 99 }) {
  const row = { ...start };
  const counters = new Map<string, number>();
  const prisma = {
    user: {
      findUnique: jest.fn(async () => ({ ...row })),
      // trava de uma ponta só, como no Postgres: { ageMax: { gte } } / { ageMin: { lte } }
      updateMany: jest.fn(
        async (q: {
          where: { ageMax?: { gte: number }; ageMin?: { lte: number } };
          data: { ageMin?: number; ageMax?: number };
        }) => {
          if (q.where.ageMax && row.ageMax < q.where.ageMax.gte) return { count: 0 };
          if (q.where.ageMin && row.ageMin > q.where.ageMin.lte) return { count: 0 };
          Object.assign(row, q.data);
          return { count: 1 };
        },
      ),
      update: jest.fn(async () => ({})),
    },
  };
  const redis = {
    incrRate: jest.fn(async (userId: string, action: string) => {
      const k = `rate:${userId}:${action}`;
      const n = (counters.get(k) ?? 0) + 1;
      counters.set(k, n);
      return n;
    }),
    invalidateProfile: jest.fn(async () => undefined),
  };
  const svc = new UsersService(
    prisma as unknown as PrismaService,
    redis as unknown as RedisService,
    {} as PhotoModerationService,
    {} as ChatGateway,
  );
  return { svc, row, redis };
}

async function errorOf(p: Promise<unknown>): Promise<{ status?: number; body?: unknown }> {
  try {
    await p;
  } catch (e) {
    const err = e as { getStatus?: () => number; getResponse?: () => unknown };
    return { status: err.getStatus?.(), body: err.getResponse?.() };
  }
  throw new Error('era pra ter falhado');
}

afterEach(() => jest.useRealTimers());

describe('faixa de idade: até 5 mudanças por dia', () => {
  it('5 mudanças passam; a 6ª leva 429 amigável e não grava nada', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-03T15:00:00Z'), doNotFake: ['nextTick'] });
    const { svc, row, redis } = setup();
    const ranges = [
      [20, 30],
      [21, 30],
      [22, 30],
      [23, 30],
      [24, 30],
    ];
    for (const [ageMin, ageMax] of ranges) await svc.updateSettings(ID, { ageMin, ageMax });
    expect(row).toEqual({ ageMin: 24, ageMax: 30 });
    const e = await errorOf(svc.updateSettings(ID, { ageMin: 25, ageMax: 30, showMe: 'men' }));
    expect(e.status).toBe(429);
    expect(e.body).toEqual({
      error: 'age_range_limit',
      message: 'Dá pra mudar a faixa de idade 5 vezes por dia. Amanhã libera de novo 😉',
      limit: 5,
      // meia-noite de São Paulo (UTC-3)
      resetsAt: '2026-10-04T03:00:00.000Z',
    });
    expect(row).toEqual({ ageMin: 24, ageMax: 30 });
    // o contador é por pessoa e dia de São Paulo
    expect(redis.incrRate).toHaveBeenCalledWith(ID, 'age_range:2026-10-03', 2 * 86_400);
  });

  it('mandar a faixa que já está gravada não gasta (nem depois do limite)', async () => {
    const { svc, redis } = setup({ ageMin: 25, ageMax: 35 });
    for (let i = 0; i < 8; i++) await svc.updateSettings(ID, { ageMin: 25, ageMax: 35 });
    await svc.updateSettings(ID, { ageMax: 35 });
    expect(redis.incrRate).not.toHaveBeenCalled();
  });

  it('faixa final fora da regra (encosta na ponta gravada): 400 sem gastar mudança', async () => {
    const { svc, row, redis } = setup({ ageMin: 25, ageMax: 35 });
    const e = await errorOf(svc.updateSettings(ID, { ageMin: 33 }));
    expect(e.status).toBe(400);
    expect((e.body as { error: string }).error).toBe('age_range_invalid');
    // vão de 4 anos direto na requisição também
    expect((await errorOf(svc.updateSettings(ID, { ageMin: 30, ageMax: 32 }))).status).toBe(400);
    expect(redis.incrRate).not.toHaveBeenCalled();
    expect(row).toEqual({ ageMin: 25, ageMax: 35 });
  });

  it('virou o dia em São Paulo: libera de novo', async () => {
    jest.useFakeTimers({ now: new Date('2026-10-04T02:30:00Z'), doNotFake: ['nextTick'] }); // 23h30 em SP
    const { svc, row } = setup();
    for (let i = 0; i < 5; i++) await svc.updateSettings(ID, { ageMin: 20 + i, ageMax: 40 });
    expect((await errorOf(svc.updateSettings(ID, { ageMin: 30, ageMax: 40 }))).status).toBe(429);
    jest.setSystemTime(new Date('2026-10-04T03:00:01Z')); // 00h00 em SP
    await svc.updateSettings(ID, { ageMin: 30, ageMax: 40 });
    expect(row).toEqual({ ageMin: 30, ageMax: 40 });
  });

  it('só a faixa conta: mudar outras opções não gasta', async () => {
    const { svc, redis } = setup();
    await svc.updateSettings(ID, { showMe: 'women', showAge: false });
    expect(redis.incrRate).not.toHaveBeenCalled();
  });
});
