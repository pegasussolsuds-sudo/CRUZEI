import { createHmac } from 'node:crypto';

import { HttpException, Logger } from '@nestjs/common';

import { phoneHash, phoneHashSecret } from '../../common/phone-hash';
import type { RedisService } from '../../redis/redis.service';

import { readSmsConfig, type SmsConfig } from './sms/sms-config';
import {
  SEND_COOLDOWN,
  SEND_GLOBAL_LIMIT,
  SEND_IP_LIMIT,
  SEND_LOCKED,
  SEND_OK,
  SEND_PHONE_LIMIT,
  VERIFY_EXPIRED,
  VERIFY_INVALID,
  VERIFY_LOCKED,
  VERIFY_OK,
} from './sms/sms-limits';
import {
  isExplicitRefusal,
  SmsSendError,
  type SmsMessage,
  type SmsProvider,
} from './sms/sms-provider';
import { randomSmsCode, smsText, SmsService } from './sms.service';

// SmsService sem Redis: os comandos Lua viram jest.fn (o comportamento deles é provado em sms.service.spec.ts, contra
// o Redis de verdade). Aqui: o que vai pro Redis (só HMAC), o mapeamento status → erro do contrato, devolução da cota,
// número de revisão e devCode. Roda em qualquer máquina, com ou sem Redis.

const PHONE = '+5534991234567';

function fakeRedis(send: unknown = [SEND_OK, 0], verify: unknown = [VERIFY_OK, 0]) {
  const client = {
    defineCommand: jest.fn(),
    metchSmsSend: jest.fn(async () => send),
    metchSmsRefund: jest.fn(async () => 1),
    metchSmsVerify: jest.fn(async () => verify),
    set: jest.fn(async () => 'OK'),
    del: jest.fn(async () => 1),
  };
  return { client, svc: { client } as unknown as RedisService };
}

function fakeProvider(
  fail?: Error,
): SmsProvider & { send: jest.Mock<Promise<void>, [SmsMessage]> } {
  return {
    name: 'twilio',
    send: jest.fn(async (_msg: SmsMessage) => {
      if (fail) throw fail;
    }),
  };
}

const cfg = (env: Record<string, string> = {}, over: Partial<SmsConfig> = {}): SmsConfig => ({
  ...readSmsConfig({ NODE_ENV: 'development', ...env }),
  keyPrefix: 'tsms',
  ...over,
});

async function httpErr(
  p: Promise<unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    await p;
  } catch (e) {
    if (!(e instanceof HttpException)) throw e;
    return { status: e.getStatus(), body: e.getResponse() as Record<string, unknown> };
  }
  throw new Error('era pra ter lançado');
}

const hmac = (phone: string, code: string) =>
  createHmac('sha256', phoneHashSecret()).update(`sms-code:${phone}:${code}`).digest('hex');
const pk = (phone: string) => phoneHash(phone).slice(0, 32);

beforeEach(() => {
  for (const m of ['log', 'warn'] as const)
    jest.spyOn(Logger.prototype, m).mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('código', () => {
  it('randomSmsCode: sempre 6 dígitos, inclusive os que começam com 0, sem Math.random', () => {
    const rnd = jest.spyOn(Math, 'random');
    const codes = Array.from({ length: 3000 }, randomSmsCode);
    expect(codes.every((c) => /^\d{6}$/.test(c))).toBe(true);
    expect(codes.some((c) => c.startsWith('0'))).toBe(true);
    expect(new Set(codes).size).toBeGreaterThan(2900);
    expect(rnd).not.toHaveBeenCalled();
  });

  it('smsText: só ASCII (1 segmento GSM-7) e com o código', () => {
    const t = smsText('048213');
    expect(t).toContain('048213');
    expect(/^[\x20-\x7e]+$/.test(t)).toBe(true);
    expect(t.length).toBeLessThanOrEqual(160);
  });
});

describe('sendCode', () => {
  it('grava só o HMAC (amarrado ao telefone) com chave do hash; o provedor recebe o código no texto', async () => {
    const { client, svc } = fakeRedis();
    const provider = fakeProvider();
    const r = await new SmsService(svc, provider, cfg()).sendCode('(34) 99123-4567', '200.1.2.3');
    expect(r).toEqual({ sent: true, expiresIn: 300, resendIn: 30 });
    const msg = provider.send.mock.calls[0]![0];
    expect(msg.to).toBe(PHONE);
    expect(msg.text).toContain(msg.code);
    const [key, stored, ex, ttl] = client.set.mock.calls[0] as unknown as [
      string,
      string,
      string,
      number,
    ];
    expect(key).toBe(`tsms:c:${pk(PHONE)}`);
    expect(key).not.toContain('991234567');
    expect(stored).toBe(hmac(PHONE, msg.code));
    expect(stored).not.toContain(msg.code);
    expect([ex, ttl]).toEqual(['EX', 300]);
    // o mesmo código pra outro número dá outro HMAC
    expect(hmac('+5534991234568', msg.code)).not.toBe(stored);
  });

  it('passa espera e tetos da config pro script; sem IP o teto por conexão não entra', async () => {
    const { client, svc } = fakeRedis();
    const c = cfg({ SMS_MAX_PER_PHONE_HOUR: '3', SMS_MAX_PER_HOUR_GLOBAL: '100' });
    const s = new SmsService(svc, fakeProvider(), c);
    await s.sendCode(PHONE, '::ffff:10.0.0.1');
    let args = client.metchSmsSend.mock.calls[0] as unknown as Array<string | number>;
    // 7 chaves, depois: espera, nº/h, nº/dia, ip/h, ip/dia, global, tem IP, conta nos tetos
    expect(args.slice(7)).toEqual([30, 3, 10, 20, 60, 100, '1', '1']);
    expect(String(args[4])).not.toContain('10.0.0.1');
    await s.sendCode('+5534991234568', null);
    args = client.metchSmsSend.mock.calls[1] as unknown as Array<string | number>;
    expect(args[13]).toBe('0');
  });

  it.each([
    [SEND_LOCKED, 120, 429, { error: 'sms_locked', retryAfter: 120 }],
    [
      SEND_COOLDOWN,
      17,
      429,
      { error: 'sms_cooldown', retryAfter: 17, message: 'Aguarde 17s antes de pedir outro código' },
    ],
    [SEND_PHONE_LIMIT, 2520, 429, { error: 'sms_rate_limited', scope: 'phone', retryAfter: 2520 }],
    [SEND_IP_LIMIT, 3600, 429, { error: 'sms_rate_limited', scope: 'ip', retryAfter: 3600 }],
    [SEND_GLOBAL_LIMIT, 900, 503, { error: 'sms_unavailable', retryAfter: 900 }],
  ])(
    'status %i do script → %i %o, sem código gravado nem SMS',
    async (status, wait, http, body) => {
      const { client, svc } = fakeRedis([status, wait]);
      const provider = fakeProvider();
      const e = await httpErr(new SmsService(svc, provider, cfg()).sendCode(PHONE, '1.2.3.4'));
      expect(e.status).toBe(http);
      expect(e.body).toMatchObject(body);
      expect(client.set).not.toHaveBeenCalled();
      expect(provider.send).not.toHaveBeenCalled();
    },
  );

  it('provedor recusou (4xx): devolve a cota com o HMAC gravado; número recusado = 400, resto = 503', async () => {
    const { client, svc } = fakeRedis();
    const refusedQuota = new SmsService(
      svc,
      fakeProvider(new SmsSendError('provider', 'twilio', 429, '20429')),
      cfg(),
    );
    expect(await httpErr(refusedQuota.sendCode(PHONE, '1.2.3.4'))).toMatchObject({
      status: 503,
      body: { error: 'sms_unavailable' },
    });
    const stored = (client.set.mock.calls[0] as unknown as string[])[1];
    const refund = client.metchSmsRefund.mock.calls[0] as unknown as string[];
    expect(refund[7]).toBe(stored);
    expect(refund.slice(8)).toEqual(['1', '0']);

    const bad = new SmsService(
      svc,
      fakeProvider(new SmsSendError('invalid_number', 'twilio', 400, '21211')),
      cfg(),
    );
    expect(await httpErr(bad.sendCode(PHONE))).toMatchObject({
      status: 400,
      body: { error: 'phone_unreachable' },
    });
    expect(client.metchSmsRefund).toHaveBeenCalledTimes(2);
    expect(client.del).not.toHaveBeenCalled();
  });

  it.each([
    ['timeout', new SmsSendError('provider', 'twilio', null, null, 'timeout')],
    ['rede', new SmsSendError('provider', 'zenvia', null, null, 'network')],
    ['5xx', new SmsSendError('provider', 'twilio', 500, '20500')],
    ['erro inesperado', new Error(`falha com ${PHONE}`)],
  ])('envio incerto (%s): 503, mantém código e cota e só libera a espera', async (_label, fail) => {
    const { client, svc } = fakeRedis();
    const s = new SmsService(svc, fakeProvider(fail), cfg());
    expect(await httpErr(s.sendCode(PHONE, '1.2.3.4'))).toMatchObject({
      status: 503,
      body: { error: 'sms_unavailable' },
    });
    expect(client.metchSmsRefund).not.toHaveBeenCalled();
    expect(client.del).toHaveBeenCalledTimes(1);
    expect(client.del).toHaveBeenCalledWith(`tsms:last:${pk(PHONE)}`);
    // o código gravado continua lá (nada apagou a chave dele)
    expect(client.del).not.toHaveBeenCalledWith(`tsms:c:${pk(PHONE)}`);
  });

  it('devolução da cota (ou liberação da espera) que falha não esconde o erro do provedor', async () => {
    const { client, svc } = fakeRedis();
    client.metchSmsRefund.mockRejectedValueOnce(new Error('redis caiu'));
    client.del.mockRejectedValueOnce(new Error('redis caiu'));
    const refused = new SmsService(
      svc,
      fakeProvider(new SmsSendError('invalid_number', 'twilio', 400, '21211')),
      cfg(),
    );
    expect(await httpErr(refused.sendCode(PHONE))).toMatchObject({
      status: 400,
      body: { error: 'phone_unreachable' },
    });
    const timeout = new SmsService(
      svc,
      fakeProvider(new SmsSendError('provider', 'twilio', null, null, 'timeout')),
      cfg(),
    );
    expect(await httpErr(timeout.sendCode(PHONE))).toMatchObject({
      status: 503,
      body: { error: 'sms_unavailable' },
    });
  });

  it('isExplicitRefusal: só número recusado ou 4xx do provedor', () => {
    expect(isExplicitRefusal(new SmsSendError('invalid_number', 'zenvia', 400, null))).toBe(true);
    expect(isExplicitRefusal(new SmsSendError('provider', 'twilio', 401, '20003'))).toBe(true);
    expect(isExplicitRefusal(new SmsSendError('provider', 'zenvia', 429, null))).toBe(true);
    expect(isExplicitRefusal(new SmsSendError('provider', 'twilio', 500, null))).toBe(false);
    expect(isExplicitRefusal(new SmsSendError('provider', 'twilio', 503, null))).toBe(false);
    expect(isExplicitRefusal(new SmsSendError('provider', 'twilio', null, null, 'timeout'))).toBe(
      false,
    );
    expect(isExplicitRefusal(new SmsSendError('provider', 'twilio', null, null, 'network'))).toBe(
      false,
    );
    // sem status (http) não prova recusa
    expect(isExplicitRefusal(new SmsSendError('provider', 'twilio'))).toBe(false);
    expect(isExplicitRefusal(new Error('qualquer'))).toBe(false);
    expect(isExplicitRefusal(null)).toBe(false);
  });

  it('devCode só com a config ligada (driver log + atalhos de dev)', async () => {
    const { svc } = fakeRedis();
    const on = cfg({ DEV_SHORTCUTS: 'true' });
    expect(on.devCode).toBe(true);
    expect((await new SmsService(svc, fakeProvider(), on).sendCode(PHONE)).devCode).toMatch(
      /^\d{6}$/,
    );
    expect(await new SmsService(svc, fakeProvider(), cfg()).sendCode(PHONE)).not.toHaveProperty(
      'devCode',
    );
  });

  it('fixo, DDD inexistente e lixo: 400 sem tocar no Redis', async () => {
    const { client, svc } = fakeRedis();
    const s = new SmsService(svc, fakeProvider(), cfg());
    expect(await httpErr(s.sendCode('(34) 3232-1234'))).toMatchObject({
      body: { error: 'phone_not_mobile' },
    });
    expect(await httpErr(s.sendCode('(20) 99999-1234'))).toMatchObject({
      body: { error: 'phone_invalid' },
    });
    expect(await httpErr(s.sendCode(undefined as unknown as string))).toMatchObject({
      body: { error: 'phone_invalid' },
    });
    expect(client.metchSmsSend).not.toHaveBeenCalled();
  });
});

describe('número de revisão das lojas', () => {
  const REVIEW = { REVIEW_PHONE: '(34) 99888-7766', REVIEW_CODE: '482913', DEV_SHORTCUTS: 'true' };

  it('sem provedor, fora dos tetos, sem devCode; grava o HMAC do código fixo', async () => {
    const { client, svc } = fakeRedis();
    const provider = fakeProvider();
    const s = new SmsService(svc, provider, cfg(REVIEW));
    expect(s.isReviewPhone('34998887766')).toBe(true);
    expect(s.isReviewPhone(PHONE)).toBe(false);
    const r = await s.sendCode('34 99888 7766', '1.2.3.4');
    expect(r).toEqual({ sent: true, expiresIn: 300, resendIn: 30 });
    expect(provider.send).not.toHaveBeenCalled();
    expect((client.metchSmsSend.mock.calls[0] as unknown as string[])[14]).toBe('0');
    expect((client.set.mock.calls[0] as unknown as string[])[1]).toBe(
      hmac('+5534998887766', '482913'),
    );
  });

  it('a trava e a espera continuam valendo pro número de revisão', async () => {
    const { svc } = fakeRedis([SEND_LOCKED, 600]);
    const s = new SmsService(svc, fakeProvider(), cfg(REVIEW));
    expect(await httpErr(s.sendCode('34998887766'))).toMatchObject({
      status: 429,
      body: { error: 'sms_locked' },
    });
  });

  it('sem REVIEW_* nenhum número é de revisão', () => {
    const { svc } = fakeRedis();
    expect(new SmsService(svc, fakeProvider(), cfg()).isReviewPhone('34998887766')).toBe(false);
  });
});

describe('verifyCode', () => {
  it('manda o HMAC do digitado com tentativas e trava da config; acerto = true', async () => {
    const { client, svc } = fakeRedis();
    const s = new SmsService(
      svc,
      fakeProvider(),
      cfg({ SMS_VERIFY_MAX_ATTEMPTS: '4', SMS_VERIFY_LOCK_S: '600' }),
    );
    await expect(s.verifyCode(PHONE, '048213')).resolves.toBe(true);
    const args = client.metchSmsVerify.mock.calls[0] as unknown as Array<string | number>;
    expect(args.slice(0, 4)).toEqual([
      `tsms:lock:${pk(PHONE)}`,
      `tsms:c:${pk(PHONE)}`,
      `tsms:f:${pk(PHONE)}`,
      `tsms:last:${pk(PHONE)}`,
    ]);
    expect(args.slice(4)).toEqual([hmac(PHONE, '048213'), 4, 600, 3600]);
  });

  it('formato errado nunca bate (vai um HMAC impossível e conta como erro)', async () => {
    const { client, svc } = fakeRedis(undefined, [VERIFY_INVALID, 4]);
    const s = new SmsService(svc, fakeProvider(), cfg());
    for (const code of ['12345', 'abcdef', '1234567', '']) {
      await httpErr(s.verifyCode(PHONE, code));
    }
    for (const call of client.metchSmsVerify.mock.calls as unknown as Array<Array<string>>)
      expect(call[4]).toBe('-');
  });

  it('status do script → erro do contrato', async () => {
    const run = async (r: [number, number]) => {
      const { svc } = fakeRedis(undefined, r);
      return httpErr(new SmsService(svc, fakeProvider(), cfg()).verifyCode(PHONE, '111111'));
    };
    expect(await run([VERIFY_INVALID, 3])).toMatchObject({
      status: 401,
      body: {
        error: 'code_invalid',
        attemptsLeft: 3,
        message: 'Código errado. Restam 3 tentativas.',
      },
    });
    expect((await run([VERIFY_INVALID, 1])).body.message).toBe(
      'Código errado. Última tentativa antes de uma pausa de 15 min.',
    );
    expect(await run([VERIFY_LOCKED, 900])).toMatchObject({
      status: 429,
      body: { error: 'sms_locked', retryAfter: 900 },
    });
    expect(await run([VERIFY_EXPIRED, 0])).toMatchObject({
      status: 401,
      body: { error: 'code_expired' },
    });
    // resposta estranha do Redis nunca vira acerto
    expect(await run([99, 0])).toMatchObject({ status: 401, body: { error: 'code_expired' } });
  });
});
