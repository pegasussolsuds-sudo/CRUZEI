import { createHash } from 'node:crypto';

import { HttpException, Logger } from '@nestjs/common';
import Redis from 'ioredis';

import { phoneHash } from '../../common/phone-hash';
import type { RedisService } from '../../redis/redis.service';

import { LogSmsProvider } from './sms/log.provider';
import { readSmsConfig, type SmsConfig } from './sms/sms-config';
import { phoneKeys } from './sms/sms-limits';
import { SmsSendError, type SmsMessage, type SmsProvider } from './sms/sms-provider';
import { SmsService } from './sms.service';

// SmsService contra o Redis local do dev (docker cruzei-redis) com prefixo próprio; pula se não estiver no ar.
// Os scripts Lua (tetos, espera, tentativas, trava) só se provam num Redis de verdade.

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
});
const PREFIX = `sms-test-${process.pid}`;
let up = true;

beforeAll(async () => {
  try {
    await redis.connect();
    await redis.ping();
  } catch {
    up = false;
  }
});

async function clean() {
  if (!up) return;
  const keys = await redis.keys(`${PREFIX}:*`);
  if (keys.length) await redis.del(...keys);
}
beforeEach(clean);
afterAll(async () => {
  await clean();
  redis.disconnect();
});
afterEach(() => jest.restoreAllMocks());

const asRedis = { client: redis } as unknown as RedisService;
const TWILIO_ENV = {
  SMS_DRIVER: 'twilio',
  TWILIO_ACCOUNT_SID: 'AC1',
  TWILIO_AUTH_TOKEN: 'token',
  TWILIO_FROM: '+15005550006',
};

function config(env: Record<string, string>, over: Partial<SmsConfig> = {}): SmsConfig {
  return { ...readSmsConfig(env), keyPrefix: PREFIX, ...over };
}
const devCfg = (over: Partial<SmsConfig> = {}) =>
  config({ NODE_ENV: 'development', DEV_SHORTCUTS: 'true' }, over);

/** provedor falso: guarda o que "mandou" (o código sai do texto, como a pessoa leria) */
function fakeProvider(fail?: () => Error): SmsProvider & { sent: SmsMessage[]; send: jest.Mock } {
  const sent: SmsMessage[] = [];
  const send = jest.fn(async (m: SmsMessage) => {
    if (fail) throw fail();
    sent.push(m);
  });
  return { name: 'twilio', sent, send };
}
const codeOf = (m: SmsMessage) => /(\d{6})/.exec(m.text)![1]!;

function make(cfg: SmsConfig = devCfg(), provider: SmsProvider = fakeProvider()) {
  return new SmsService(asRedis, provider, cfg);
}

let seq = 0;
/** celular novo por teste (DDD 34), sem colidir com outro teste */
const newPhone = () => `+55349${String(10_000_000 + process.pid * 100 + ++seq).slice(-8)}`;
const keysOf = (phone: string) => phoneKeys(PREFIX, phoneHash(phone).slice(0, 32));
/** simula os 30 s de espera passando */
const skipCooldown = (phone: string) => redis.del(keysOf(phone).last);

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

describe('código e devCode', () => {
  it('6 dígitos de fonte criptográfica; Redis guarda só o HMAC e nenhuma chave tem o telefone cru', async () => {
    if (!up) return;
    const rnd = jest.spyOn(Math, 'random');
    const phone = newPhone();
    const r = await make().sendCode(phone, '200.1.2.3');
    expect(r).toMatchObject({ sent: true, expiresIn: 300, resendIn: 30 });
    expect(r.devCode).toMatch(/^\d{6}$/);
    expect(rnd).not.toHaveBeenCalled();
    const stored = await redis.get(keysOf(phone).code);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).not.toContain(r.devCode!);
    expect(stored).not.toBe(createHash('sha256').update(r.devCode!).digest('hex'));
    const keys = await redis.keys(`${PREFIX}:*`);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      expect(k).not.toContain(phone.slice(3));
      expect(k).not.toContain('200.1.2.3');
    }
  });

  it('devCode só com driver log + atalhos de dev; nunca com twilio nem sem NODE_ENV', async () => {
    if (!up) return;
    const log = new LogSmsProvider({ showCode: false, showPhone: false });
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    expect((await make(devCfg(), log).sendCode(newPhone())).devCode).toMatch(/^\d{6}$/);
    const noFlag = config({ NODE_ENV: 'development' });
    expect(await make(noFlag, log).sendCode(newPhone())).not.toHaveProperty('devCode');
    const noEnv = config({ SMS_DRIVER: 'log', DEV_SHORTCUTS: 'true' });
    expect(await make(noEnv, log).sendCode(newPhone())).not.toHaveProperty('devCode');
    const tw = config({ NODE_ENV: 'development', DEV_SHORTCUTS: 'true', ...TWILIO_ENV });
    expect(await make(tw).sendCode(newPhone())).not.toHaveProperty('devCode');
  });

  it('produção: nenhum log leva os dígitos do telefone nem o código (nem na falha do provedor)', async () => {
    if (!up) return;
    const lines: string[] = [];
    for (const m of ['log', 'warn', 'error'] as const) {
      jest
        .spyOn(Logger.prototype, m)
        .mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(' ')));
    }
    const prod = config({ NODE_ENV: 'production', ...TWILIO_ENV });
    const ok = fakeProvider();
    const phone = newPhone();
    await make(prod, ok).sendCode(phone, '10.0.0.1');
    const code = codeOf(ok.sent[0]!);
    const failing = fakeProvider(() => new SmsSendError('provider', 'twilio', 500, '20500'));
    const phone2 = newPhone();
    await httpErr(make(prod, failing).sendCode(phone2, '10.0.0.1'));
    await httpErr(make(prod, ok).verifyCode(phone, '000000'));
    expect(lines.some((l) => /SMS não saiu/.test(l))).toBe(true);
    for (const l of lines) {
      expect(l).not.toContain(phone.slice(5));
      expect(l).not.toContain(phone2.slice(5));
      expect(l).not.toContain(code);
    }
  });
});

describe('espera e tetos de envio', () => {
  it("segundo pedido em 30 s: 429 sms_cooldown com retryAfter e 'Ns' na mensagem", async () => {
    if (!up) return;
    const s = make();
    const phone = newPhone();
    await s.sendCode(phone);
    const e = await httpErr(s.sendCode(phone));
    expect(e.status).toBe(429);
    expect(e.body.error).toBe('sms_cooldown');
    expect(e.body.retryAfter).toBeGreaterThanOrEqual(1);
    expect(e.body.retryAfter).toBeLessThanOrEqual(30);
    expect(String(e.body.message)).toMatch(/\d+s/);
  });

  it('teto por número na hora e no dia; pedido recusado não gasta cota', async () => {
    if (!up) return;
    const p = fakeProvider();
    const s = make(devCfg({ limits: { ...devCfg().limits, phonePerHour: 2, phonePerDay: 3 } }), p);
    const phone = newPhone();
    await s.sendCode(phone);
    await skipCooldown(phone);
    await s.sendCode(phone);
    await skipCooldown(phone);
    const e = await httpErr(s.sendCode(phone));
    expect(e).toMatchObject({ status: 429, body: { error: 'sms_rate_limited', scope: 'phone' } });
    expect(e.body.retryAfter).toBeGreaterThan(3_500);
    expect(await redis.get(keysOf(phone).hour)).toBe('2');
    expect(await redis.get(keysOf(phone).day)).toBe('2');
    expect(p.send).toHaveBeenCalledTimes(2);
    // a hora "passou": o dia ainda deixa 1
    await redis.del(keysOf(phone).hour);
    await s.sendCode(phone);
    await skipCooldown(phone);
    await redis.del(keysOf(phone).hour);
    const day = await httpErr(s.sendCode(phone));
    expect(day.body).toMatchObject({ error: 'sms_rate_limited', scope: 'phone' });
    expect(day.body.retryAfter).toBeGreaterThan(80_000);
  });

  it('teto por IP (números diferentes, mesma conexão); IPv6 do mesmo /64 divide a cota', async () => {
    if (!up) return;
    const s = make(devCfg({ limits: { ...devCfg().limits, ipPerHour: 2 } }));
    await s.sendCode(newPhone(), '2804:14c:5b80:9e01::1');
    await s.sendCode(newPhone(), '2804:14c:5b80:9e01:aaaa:bbbb:cccc:dddd');
    const e = await httpErr(s.sendCode(newPhone(), '2804:14c:5b80:9e01::ffff'));
    expect(e).toMatchObject({ status: 429, body: { error: 'sms_rate_limited', scope: 'ip' } });
    // outro /64 e pedido sem IP seguem
    await expect(s.sendCode(newPhone(), '2804:14c:5b80:9e02::1')).resolves.toMatchObject({
      sent: true,
    });
    await expect(s.sendCode(newPhone())).resolves.toMatchObject({ sent: true });
  });

  it('teto global da hora: 503 sms_unavailable', async () => {
    if (!up) return;
    const s = make(devCfg({ limits: { ...devCfg().limits, globalPerHour: 2 } }));
    await s.sendCode(newPhone(), '1.1.1.1');
    await s.sendCode(newPhone(), '2.2.2.2');
    const e = await httpErr(s.sendCode(newPhone(), '3.3.3.3'));
    expect(e).toMatchObject({ status: 503, body: { error: 'sms_unavailable' } });
  });

  it('provedor recusou (4xx): devolve a cota, apaga código e espera, 503; número recusado dá 400 phone_unreachable', async () => {
    if (!up) return;
    const cfg = devCfg({ limits: { ...devCfg().limits, globalPerHour: 10 } });
    const phone = newPhone();
    const down = make(
      cfg,
      fakeProvider(() => new SmsSendError('provider', 'twilio', 429, '20429')),
    );
    const e = await httpErr(down.sendCode(phone, '9.9.9.9'));
    expect(e).toMatchObject({ status: 503, body: { error: 'sms_unavailable' } });
    const k = keysOf(phone);
    expect(await redis.exists(k.code, k.last, k.hour, k.day, `${PREFIX}:g:h`)).toBe(0);
    expect(await redis.keys(`${PREFIX}:ip:*`)).toEqual([]);
    const bad = make(
      cfg,
      fakeProvider(() => new SmsSendError('invalid_number', 'twilio', 400, '21211')),
    );
    const e2 = await httpErr(bad.sendCode(phone, '9.9.9.9'));
    expect(e2).toMatchObject({ status: 400, body: { error: 'phone_unreachable' } });
    // nada ficou gasto: dá pra pedir de novo na hora
    await expect(make(cfg).sendCode(phone, '9.9.9.9')).resolves.toMatchObject({ sent: true });
  });

  it('timeout do provedor (pode ter saído): 503, código e cota ficam, só a espera é liberada', async () => {
    if (!up) return;
    const cfg = devCfg({ limits: { ...devCfg().limits, globalPerHour: 10 } });
    const phone = newPhone();
    let code = '';
    // o provedor "mandou" e a resposta se perdeu
    const lost = fakeProvider(() => new SmsSendError('provider', 'twilio', null, null, 'timeout'));
    lost.send.mockImplementationOnce(async (m: SmsMessage) => {
      code = codeOf(m);
      throw new SmsSendError('provider', 'twilio', null, null, 'timeout');
    });
    const s = make(cfg, lost);
    const e = await httpErr(s.sendCode(phone, '9.9.9.9'));
    expect(e).toMatchObject({ status: 503, body: { error: 'sms_unavailable' } });
    const k = keysOf(phone);
    expect(await redis.exists(k.last)).toBe(0);
    expect(await redis.exists(k.code)).toBe(1);
    expect(await redis.get(k.hour)).toBe('1');
    expect(await redis.get(k.day)).toBe('1');
    expect(await redis.get(`${PREFIX}:g:h`)).toBe('1');
    expect(await redis.keys(`${PREFIX}:ip:*`)).toHaveLength(2);
    // se o SMS chegou, o código vale
    await expect(s.verifyCode(phone, code)).resolves.toBe(true);
    // e dá pra pedir outro na hora (sem espera), contando de novo na cota
    await expect(make(cfg).sendCode(phone, '9.9.9.9')).resolves.toMatchObject({ sent: true });
    expect(await redis.get(k.hour)).toBe('2');
  });

  it('fixo dá 400 phone_not_mobile e DDD inexistente phone_invalid, sem chamar o provedor', async () => {
    if (!up) return;
    const p = fakeProvider();
    const s = make(devCfg(), p);
    expect(await httpErr(s.sendCode('(34) 3232-1234'))).toMatchObject({
      status: 400,
      body: { error: 'phone_not_mobile' },
    });
    expect(await httpErr(s.sendCode('(20) 99999-1234'))).toMatchObject({
      status: 400,
      body: { error: 'phone_invalid' },
    });
    expect(await httpErr(s.sendCode('123'))).toMatchObject({
      status: 400,
      body: { error: 'phone_invalid' },
    });
    expect(p.send).not.toHaveBeenCalled();
  });
});

describe('conferência do código', () => {
  it('certo: true e limpa código, erros e espera', async () => {
    if (!up) return;
    const p = fakeProvider();
    const s = make(devCfg(), p);
    const phone = newPhone();
    await s.sendCode(phone);
    await httpErr(
      s
        .verifyCode(phone, '000000')
        .catch((e) => (codeOf(p.sent[0]!) === '000000' ? undefined : Promise.reject(e))),
    );
    await expect(s.verifyCode(phone, codeOf(p.sent[0]!))).resolves.toBe(true);
    const k = keysOf(phone);
    expect(await redis.exists(k.code, k.fails, k.last)).toBe(0);
    // usado: não vale de novo
    expect(await httpErr(s.verifyCode(phone, codeOf(p.sent[0]!)))).toMatchObject({
      status: 401,
      body: { error: 'code_expired' },
    });
  });

  it('errado: 401 code_invalid com 4, 3, 2, 1; o 5º trava (429 sms_locked ~900 s) e apaga o código', async () => {
    if (!up) return;
    const p = fakeProvider();
    const s = make(devCfg(), p);
    const phone = newPhone();
    await s.sendCode(phone);
    const right = codeOf(p.sent[0]!);
    const wrong = right === '111111' ? '222222' : '111111';
    for (const left of [4, 3, 2, 1]) {
      const e = await httpErr(s.verifyCode(phone, wrong));
      expect(e).toMatchObject({ status: 401, body: { error: 'code_invalid', attemptsLeft: left } });
    }
    const locked = await httpErr(s.verifyCode(phone, wrong));
    expect(locked).toMatchObject({ status: 429, body: { error: 'sms_locked' } });
    expect(locked.body.retryAfter).toBeGreaterThan(890);
    expect(await redis.exists(keysOf(phone).code)).toBe(0);
    // nem o certo entra durante a trava
    expect(await httpErr(s.verifyCode(phone, right))).toMatchObject({
      status: 429,
      body: { error: 'sms_locked' },
    });
  });

  it('durante a trava o request-code dá 429 sms_locked sem chamar o provedor', async () => {
    if (!up) return;
    const p = fakeProvider();
    const s = make(devCfg(), p);
    const phone = newPhone();
    await redis.set(keysOf(phone).lock, '1', 'EX', 900);
    const e = await httpErr(s.sendCode(phone));
    expect(e).toMatchObject({ status: 429, body: { error: 'sms_locked' } });
    expect(p.send).not.toHaveBeenCalled();
  });

  it('código novo NÃO devolve as chances; sem código guardado é code_expired sem contar tentativa', async () => {
    if (!up) return;
    const p = fakeProvider();
    const s = make(devCfg(), p);
    const phone = newPhone();
    expect(await httpErr(s.verifyCode(phone, '123456'))).toMatchObject({
      status: 401,
      body: { error: 'code_expired' },
    });
    expect(await redis.exists(keysOf(phone).fails)).toBe(0);
    await s.sendCode(phone);
    const wrong = codeOf(p.sent[0]!) === '111111' ? '222222' : '111111';
    await httpErr(s.verifyCode(phone, wrong));
    await httpErr(s.verifyCode(phone, wrong));
    await skipCooldown(phone);
    await s.sendCode(phone);
    const wrong2 = codeOf(p.sent[1]!) === '111111' ? '222222' : '111111';
    expect(await httpErr(s.verifyCode(phone, wrong2))).toMatchObject({
      body: { error: 'code_invalid', attemptsLeft: 2 },
    });
  });

  it('rajada: 10 erros em paralelo comparam no máximo 5, a trava fica gravada e nenhum passa', async () => {
    if (!up) return;
    const p = fakeProvider();
    const s = make(devCfg(), p);
    const phone = newPhone();
    await s.sendCode(phone);
    const wrong = codeOf(p.sent[0]!) === '111111' ? '222222' : '111111';
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => s.verifyCode(phone, wrong)),
    );
    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    const bodies = results.map(
      (r) =>
        ((r as PromiseRejectedResult).reason as HttpException).getResponse() as { error: string },
    );
    expect(bodies.filter((b) => b.error === 'code_invalid')).toHaveLength(4);
    expect(bodies.filter((b) => b.error === 'sms_locked')).toHaveLength(6);
    expect(await redis.ttl(keysOf(phone).lock)).toBeGreaterThan(890);
  });
});

describe('número de revisão das lojas', () => {
  const REVIEW = { REVIEW_PHONE: '(34) 99888-7766', REVIEW_CODE: '482913' };
  const reviewPhone = '+5534998887766';

  it('não chama o provedor, não conta nos tetos, nunca devolve devCode; o código fixo confere', async () => {
    if (!up) return;
    const p = fakeProvider();
    const s = make(config({ NODE_ENV: 'development', DEV_SHORTCUTS: 'true', ...REVIEW }), p);
    expect(s.isReviewPhone('34998887766')).toBe(true);
    const r = await s.sendCode('(34) 99888-7766', '5.5.5.5');
    expect(r).toEqual({ sent: true, expiresIn: 300, resendIn: 30 });
    expect(p.send).not.toHaveBeenCalled();
    const k = keysOf(reviewPhone);
    expect(await redis.exists(k.hour, k.day)).toBe(0);
    expect(await redis.keys(`${PREFIX}:ip:*`)).toEqual([]);
    await expect(s.verifyCode(reviewPhone, '482913')).resolves.toBe(true);
  });

  it('código errado conta tentativa e trava igual a qualquer número', async () => {
    if (!up) return;
    const s = make(config({ NODE_ENV: 'development', ...REVIEW }));
    await s.sendCode(reviewPhone);
    for (const left of [4, 3, 2, 1]) {
      expect(await httpErr(s.verifyCode(reviewPhone, '111111'))).toMatchObject({
        body: { attemptsLeft: left },
      });
    }
    expect(await httpErr(s.verifyCode(reviewPhone, '111111'))).toMatchObject({
      status: 429,
      body: { error: 'sms_locked' },
    });
    expect(await httpErr(s.verifyCode(reviewPhone, '482913'))).toMatchObject({ status: 429 });
  });

  it('sem REVIEW_* o mesmo número é um número qualquer (manda SMS, código aleatório)', async () => {
    if (!up) return;
    const p = fakeProvider();
    const s = make(devCfg(), p);
    expect(s.isReviewPhone(reviewPhone)).toBe(false);
    await s.sendCode(reviewPhone);
    expect(p.send).toHaveBeenCalledTimes(1);
  });
});
