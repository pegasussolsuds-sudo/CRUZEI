import { Logger } from '@nestjs/common';

import { fcmMessageOf, PushService, type PushMessage, type PushOutcome } from './push.service';

// PushService sem FCM: lotes de 500, token morto apagado, erro temporário não apaga nada, sem credencial = desligado.

const payload = {
  title: 't',
  body: 'b',
  channelId: 'default',
  data: { notificationId: 'n', type: 'campaign' },
};

function setup(
  devices: { userId: string; token: string }[],
  outcome: (m: PushMessage) => PushOutcome | 'throw',
) {
  const deleted: string[][] = [];
  const prisma = {
    deviceToken: {
      findMany: jest.fn(async () => devices),
      deleteMany: jest.fn(async (a: { where: { token: { in: string[] } } }) => {
        deleted.push(a.where.token.in);
        return { count: a.where.token.in.length };
      }),
    },
  };
  const batches: number[] = [];
  const transport = {
    sendEach: jest.fn(async (msgs: PushMessage[]) => {
      batches.push(msgs.length);
      if (msgs.some((m) => outcome(m) === 'throw')) throw new Error('FCM fora do ar');
      return msgs.map((m) => outcome(m) as PushOutcome);
    }),
  };
  const svc = new PushService(prisma as never, transport);
  return { svc, deleted, batches, transport };
}

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

describe('PushService', () => {
  it('um push por aparelho, com o payload de cada pessoa; token morto apagado', async () => {
    const t = setup(
      [
        { userId: 'a', token: 'ta1' },
        { userId: 'a', token: 'ta2' },
        { userId: 'b', token: 'tb' },
      ],
      (m) => (m.token === 'ta2' ? 'invalid' : 'ok'),
    );
    const r = await t.svc.sendToUsers([
      { userId: 'a', payload: { ...payload, title: 'pra A' } },
      { userId: 'b', payload: { ...payload, title: 'pra B' } },
    ]);
    expect(r).toEqual({ sent: 2, failed: 1, removed: 1 });
    expect(t.deleted).toEqual([['ta2']]);
    const msgs = t.transport.sendEach.mock.calls[0][0];
    expect(msgs.find((m) => m.token === 'tb')?.payload.title).toBe('pra B');
  });

  it('lotes de 500 (limite do FCM)', async () => {
    const devices = Array.from({ length: 1_203 }, (_, i) => ({ userId: `u${i}`, token: `t${i}` }));
    const t = setup(devices, () => 'ok');
    const r = await t.svc.sendToUsers(devices.map((d) => ({ userId: d.userId, payload })));
    expect(t.batches).toEqual([500, 500, 203]);
    expect(r.sent).toBe(1_203);
  });

  it('erro temporário (lote inteiro falhou ou erro que não é de token) não apaga nada', async () => {
    const t = setup([{ userId: 'a', token: 'ta' }], () => 'throw');
    expect(await t.svc.sendToUsers([{ userId: 'a', payload }])).toEqual({
      sent: 0,
      failed: 1,
      removed: 0,
    });
    const t2 = setup([{ userId: 'a', token: 'ta' }], () => 'error');
    expect(await t2.svc.sendToUsers([{ userId: 'a', payload }])).toEqual({
      sent: 0,
      failed: 1,
      removed: 0,
    });
    expect(t.deleted).toEqual([]);
    expect(t2.deleted).toEqual([]);
  });

  it('sem FCM_SERVICE_ACCOUNT_FILE: desligado, não consulta nada', async () => {
    const old = process.env.FCM_SERVICE_ACCOUNT_FILE;
    delete process.env.FCM_SERVICE_ACCOUNT_FILE;
    const prisma = { deviceToken: { findMany: jest.fn() } };
    const svc = new PushService(prisma as never);
    svc.onModuleInit();
    expect(svc.enabled).toBe(false);
    expect(await svc.sendToUsers([{ userId: 'a', payload }])).toEqual({
      sent: 0,
      failed: 0,
      removed: 0,
    });
    expect(prisma.deviceToken.findMany).not.toHaveBeenCalled();
    if (old !== undefined) process.env.FCM_SERVICE_ACCOUNT_FILE = old;
  });

  it('arquivo de credencial ilegível: desligado (sem derrubar o servidor)', () => {
    const old = process.env.FCM_SERVICE_ACCOUNT_FILE;
    process.env.FCM_SERVICE_ACCOUNT_FILE = 'C:/nao/existe/conta.json';
    const svc = new PushService({} as never);
    svc.onModuleInit();
    expect(svc.enabled).toBe(false);
    if (old !== undefined) process.env.FCM_SERVICE_ACCOUNT_FILE = old;
    else delete process.env.FCM_SERVICE_ACCOUNT_FILE;
  });
});

describe('fcmMessageOf (mensagem do FCM HTTP v1)', () => {
  it('push da central: prioridade alta, canal e som; sem tag, collapse, ttl nem visibility', () => {
    const m = fcmMessageOf({ token: 'tk', payload });
    expect(m).toEqual({
      token: 'tk',
      notification: { title: 't', body: 'b' },
      data: { notificationId: 'n', type: 'campaign' },
      android: { priority: 'high', notification: { sound: 'default', channelId: 'default' } },
      apns: { payload: { aps: { sound: 'default' } } },
    });
  });

  it('push social: tag (uma por conversa na bandeja), collapseKey, ttl em ms e fora da tela bloqueada (secret)', () => {
    const m = fcmMessageOf({
      token: 'tk',
      payload: {
        ...payload,
        channelId: 'messages',
        data: { notificationId: '', type: 'message', target: '{"kind":"conversation"}' },
        tag: 'conv:c1',
        collapseKey: 'likes',
        ttlSeconds: 3_600,
        visibility: 'secret',
      },
    });
    expect(m.android).toEqual({
      priority: 'high',
      collapseKey: 'likes',
      ttl: 3_600_000,
      notification: {
        sound: 'default',
        channelId: 'messages',
        tag: 'conv:c1',
        visibility: 'secret',
      },
    });
    expect(m.data).toEqual({
      notificationId: '',
      type: 'message',
      target: '{"kind":"conversation"}',
    });
  });

  it('ttl zero ou sem visibility não entram; private passa como private', () => {
    const m = fcmMessageOf({
      token: 'tk',
      payload: { ...payload, ttlSeconds: 0, visibility: undefined },
    });
    expect(m.android).toEqual({
      priority: 'high',
      notification: { sound: 'default', channelId: 'default' },
    });
    const p = fcmMessageOf({
      token: 'tk',
      payload: { ...payload, channelId: 'social', visibility: 'private' },
    });
    expect(p.android?.notification?.visibility).toBe('private');
  });
});
