import type { PrismaService } from '../../database/prisma.service';
import type { ChatGateway } from '../../realtime/chat.gateway';
import type { RedisService } from '../../redis/redis.service';
import type { NotifyService } from '../notifications/notify.service';
import type { UsersService } from '../users/users.service';

import {
  ANONYMOUS_EXPIRED_TEXT,
  PREMIUM_EXPIRED_TEXT,
  PremiumLifecycleService,
  type DowngradedRow,
  type ExpiredAnonRow,
} from './premium-lifecycle.service';
import { PremiumTask } from './premium.task';
import { PLANS, trialDaysFor, withoutTrial } from './subscriptions.service';

// Regras do Premium sem banco: teste grátis (quem ganha), pós-rebaixamento (avisos, salas, socket) e a ordem da
// tarefa. O SQL de verdade está em test/db/premium-rules.db-spec.ts.

describe('teste grátis', () => {
  const monthly = PLANS.find((p) => p.id === 'premium_monthly')!;
  const yearly = PLANS.find((p) => p.id === 'premium_yearly')!;

  it('só o mensal tem 7 dias de teste', () => {
    expect(monthly.trialDays).toBe(7);
    expect(PLANS.filter((p) => p.trialDays)).toHaveLength(1);
  });

  it('ganha só com conta que nunca assinou E número que nunca ganhou', () => {
    expect(trialDaysFor(monthly, { trialUsedAt: null, phoneClaimed: true })).toBe(7);
    expect(trialDaysFor(monthly, { trialUsedAt: new Date(), phoneClaimed: true })).toBe(0);
    expect(trialDaysFor(monthly, { trialUsedAt: null, phoneClaimed: false })).toBe(0);
    expect(trialDaysFor(yearly, { trialUsedAt: null, phoneClaimed: true })).toBe(0);
  });

  it('withoutTrial tira só o trialDays (a Paywall para de prometer)', () => {
    const p = withoutTrial(monthly);
    expect(p).not.toHaveProperty('trialDays');
    expect(p).toMatchObject({ id: 'premium_monthly', priceCents: monthly.priceCents });
    expect(monthly.trialDays).toBe(7); // não muda o original
  });
});

function lifecycleWith(rows: unknown[]) {
  const prisma = {
    $queryRaw: jest.fn(async () => rows),
    $executeRaw: jest.fn(async () => 0),
  };
  const redis = { invalidateProfile: jest.fn(async () => undefined) };
  const users = {
    downgradeAvatar: jest.fn(async (_id: string, _tiers: ReadonlySet<string>) => null),
  };
  const gateway = { emitToUser: jest.fn(), leaveAllConversations: jest.fn(async () => undefined) };
  const notify = { notify: jest.fn(async () => ({ notified: 1, pushSent: 0, pushFailed: 0 })) };
  const svc = new PremiumLifecycleService(
    prisma as unknown as PrismaService,
    redis as unknown as RedisService,
    users as unknown as UsersService,
    gateway as unknown as ChatGateway,
    notify as unknown as NotifyService,
  );
  return { svc, prisma, redis, users, gateway, notify };
}

describe('PremiumLifecycleService', () => {
  it('rebaixou: avatar free, só o invisível sai das salas, /me cai, socket premium_expired e aviso conforme o modo', async () => {
    const rows: DowngradedRow[] = [
      { id: 'vis', anonymous: false, released: false },
      { id: 'anon', anonymous: true, released: false },
      { id: 'liberado', anonymous: false, released: true },
    ];
    const t = lifecycleWith(rows);
    expect(await t.svc.downgradeExpired()).toEqual(rows);

    // tier efetivo depois do rebaixamento = free: o avatar fica só com itens free
    expect(t.users.downgradeAvatar.mock.calls.map((c) => [c[0], [...c[1]]])).toEqual([
      ['vis', ['free']],
      ['anon', ['free']],
      ['liberado', ['free']],
    ]);
    expect(t.gateway.leaveAllConversations).toHaveBeenCalledTimes(1);
    expect(t.gateway.leaveAllConversations).toHaveBeenCalledWith('anon');
    expect(t.redis.invalidateProfile).toHaveBeenCalledTimes(3);
    for (const id of ['vis', 'anon', 'liberado']) {
      expect(t.gateway.emitToUser).toHaveBeenCalledWith(id, 'account:changed', {
        reason: 'premium_expired',
      });
    }
    // número liberado (conta antiga) não recebe aviso; os outros, com o texto do modo
    expect(t.notify.notify).toHaveBeenCalledTimes(2);
    expect(t.notify.notify).toHaveBeenCalledWith(['vis'], {
      type: 'premium_expired',
      title: PREMIUM_EXPIRED_TEXT.title,
      body: PREMIUM_EXPIRED_TEXT.visible,
      target: { kind: 'premium' },
    });
    expect(t.notify.notify).toHaveBeenCalledWith(
      ['anon'],
      expect.objectContaining({ type: 'premium_expired', body: PREMIUM_EXPIRED_TEXT.anonymous }),
    );
  });

  it('nada vencido: nenhum efeito', async () => {
    const t = lifecycleWith([]);
    expect(await t.svc.downgradeExpired()).toEqual([]);
    expect(await t.svc.downgradeOne('x')).toBe(false);
    expect(t.notify.notify).not.toHaveBeenCalled();
    expect(t.gateway.emitToUser).not.toHaveBeenCalled();
  });

  it('uma falha no pós-rebaixamento de uma pessoa não derruba as outras', async () => {
    const t = lifecycleWith([
      { id: 'a', anonymous: false, released: false },
      { id: 'b', anonymous: false, released: false },
    ]);
    t.users.downgradeAvatar.mockRejectedValueOnce(new Error('boom'));
    await t.svc.downgradeExpired();
    expect(t.gateway.emitToUser).toHaveBeenCalledWith('b', 'account:changed', {
      reason: 'premium_expired',
    });
    expect(t.notify.notify).toHaveBeenCalledWith(
      ['a', 'b'],
      expect.objectContaining({ type: 'premium_expired' }),
    );
  });

  it('fim do invisível: socket visibility + aviso anonymous_expired (abre o mapa); liberado não é avisado', async () => {
    const rows: ExpiredAnonRow[] = [
      { id: 'a', released: false, isPaused: false, pausedUntil: null },
      { id: 'z', released: true, isPaused: true, pausedUntil: null },
    ];
    const t = lifecycleWith(rows);
    expect(await t.svc.expireFreeAnonymous()).toEqual(['a', 'z']);
    expect(t.redis.invalidateProfile).toHaveBeenCalledWith('a');
    expect(t.gateway.emitToUser).toHaveBeenCalledWith('a', 'account:changed', {
      reason: 'visibility',
    });
    expect(t.gateway.emitToUser).toHaveBeenCalledWith('z', 'account:changed', {
      reason: 'visibility',
    });
    expect(t.notify.notify).toHaveBeenCalledTimes(1);
    expect(t.notify.notify).toHaveBeenCalledWith(['a'], {
      type: 'anonymous_expired',
      title: ANONYMOUS_EXPIRED_TEXT.title,
      body: ANONYMOUS_EXPIRED_TEXT.body,
      target: { kind: 'map' },
    });
  });

  it('fim do invisível com o perfil PAUSADO: volta a visible sem o aviso "voltou pro mapa"; pausa vencida avisa', async () => {
    const rows: ExpiredAnonRow[] = [
      {
        id: 'pausada',
        released: false,
        isPaused: true,
        pausedUntil: new Date(Date.now() + 3_600_000),
      },
      { id: 'pausada-sem-prazo', released: false, isPaused: true, pausedUntil: null },
      {
        id: 'pausa-vencida',
        released: false,
        isPaused: true,
        pausedUntil: new Date(Date.now() - 60_000),
      },
    ];
    const t = lifecycleWith(rows);
    // todas voltaram a visible no banco (o UPDATE não olha a pausa)
    expect(await t.svc.expireFreeAnonymous()).toEqual([
      'pausada',
      'pausada-sem-prazo',
      'pausa-vencida',
    ]);
    // /me muda pra todas (o app destrava as conversas): cache e sinal silencioso vão igual
    for (const r of rows) {
      expect(t.redis.invalidateProfile).toHaveBeenCalledWith(r.id);
      expect(t.gateway.emitToUser).toHaveBeenCalledWith(r.id, 'account:changed', {
        reason: 'visibility',
      });
    }
    // só quem está no mapa de verdade recebe o aviso
    expect(t.notify.notify).toHaveBeenCalledTimes(1);
    expect(t.notify.notify).toHaveBeenCalledWith(
      ['pausa-vencida'],
      expect.objectContaining({ type: 'anonymous_expired' }),
    );
  });

  it('fim do invisível só de gente pausada: nenhum aviso', async () => {
    const t = lifecycleWith([
      { id: 'p', released: false, isPaused: true, pausedUntil: null },
    ] satisfies ExpiredAnonRow[]);
    expect(await t.svc.expireFreeAnonymous()).toEqual(['p']);
    expect(t.notify.notify).not.toHaveBeenCalled();
  });
});

describe('PremiumTask', () => {
  const setup = () => {
    const order: string[] = [];
    const lifecycle = {
      downgradeExpired: jest.fn(async (): Promise<void> => void order.push('downgrade')),
      openMissingWindows: jest.fn(async (): Promise<void> => void order.push('open')),
      expireFreeAnonymous: jest.fn(async (): Promise<void> => void order.push('expire')),
    };
    const redis = { client: { del: jest.fn(async () => 1) } };
    const task = new PremiumTask(lifecycle as never, redis as never);
    return { task, lifecycle, order, redis };
  };

  it('rebaixa ANTES de expirar o invisível (senão Premium vencido invisível voltaria ao mapa sem as 24 h)', async () => {
    const { task, order, redis } = setup();
    await task.tick();
    expect(order).toEqual(['downgrade', 'open', 'expire']);
    // a chave antiga do Redis sai uma vez só
    await task.tick();
    expect(redis.client.del).toHaveBeenCalledTimes(1);
    expect(redis.client.del).toHaveBeenCalledWith('anon:free:until');
  });

  it('não empilha execuções e não estoura com erro', async () => {
    const { task, lifecycle } = setup();
    let release!: () => void;
    lifecycle.downgradeExpired.mockImplementationOnce(
      () => new Promise<void>((r) => (release = r)),
    );
    const first = task.tick();
    await task.tick(); // ocupado: volta na hora
    expect(lifecycle.downgradeExpired).toHaveBeenCalledTimes(1);
    release();
    await first;
    lifecycle.downgradeExpired.mockRejectedValueOnce(new Error('db fora'));
    await expect(task.tick()).resolves.toBeUndefined();
  });
});
