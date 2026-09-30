import 'reflect-metadata';

import { EMERGENCY_PHONE, EMERGENCY_THROTTLED_ERROR } from '@cruzei/shared-types';
import { HttpException, type ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { ThrottlerStorage } from '@nestjs/throttler';

import { UserThrottlerGuard } from '../../common/guards/user-throttler.guard';

import { EmergencyController } from './emergency.controller';

// POST /safety/emergency passando pelo guard de rate limit DE VERDADE (mesmos throttlers do app.module, storage em
// memória): 3 por hora e 10 por dia por conta, e o 429 é o do botão (ligue 190 + o suporte, sem afirmar que a equipe foi avisada).

const SECRET = 'segredo-do-teste-da-emergencia';
const jwt = new JwtService({ secret: SECRET });
const HOUR = 3_600_000;

/** storage em memória com o mesmo contrato do RedisThrottlerStorage (janela fixa; passou do limite = bloqueado) */
function memoryStorage(clock: { now: number }) {
  const hits = new Map<string, { n: number; until: number }>();
  const blocked = new Map<string, number>();
  const storage: ThrottlerStorage = {
    async increment(key, ttl, limit, blockDuration, name) {
      const k = `${name}:${key}`;
      const b = blocked.get(k) ?? 0;
      if (b > clock.now) {
        return {
          totalHits: limit + 1,
          timeToExpire: 0,
          isBlocked: true,
          timeToBlockExpire: Math.ceil((b - clock.now) / 1000),
        };
      }
      let h = hits.get(k);
      if (!h || h.until <= clock.now) h = { n: 0, until: clock.now + ttl };
      h.n += 1;
      hits.set(k, h);
      if (h.n > limit) {
        blocked.set(k, clock.now + blockDuration);
        hits.delete(k);
        return {
          totalHits: h.n,
          timeToExpire: 0,
          isBlocked: true,
          timeToBlockExpire: Math.ceil(blockDuration / 1000),
        };
      }
      return {
        totalHits: h.n,
        timeToExpire: Math.ceil((h.until - clock.now) / 1000),
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    },
  };
  return storage;
}

// mesma regra do app.module: 'strict' só vale onde a rota declara
const hasStrictOverride = (ctx: ExecutionContext) =>
  Boolean(Reflect.getMetadata('THROTTLER:LIMITstrict', ctx.getHandler()));

async function makeGuard(clock: { now: number }) {
  const g = new UserThrottlerGuard(
    {
      throttlers: [
        { name: 'default', ttl: 60_000, limit: 600 },
        { name: 'strict', ttl: 60_000, limit: 5, skipIf: (ctx) => !hasStrictOverride(ctx) },
      ],
    },
    memoryStorage(clock),
    new Reflector(),
  );
  Object.assign(g, {
    cfg: {
      get: (k: string) => (k === 'jwt.secret' ? SECRET : undefined),
    } as unknown as ConfigService,
  });
  await g.onModuleInit();
  return g;
}

function ctxFor(userId: string): ExecutionContext {
  const token = jwt.sign({ sub: userId, typ: 'access' }, { expiresIn: 900 });
  const req = {
    originalUrl: '/v1/safety/emergency',
    url: '/v1/safety/emergency',
    ip: '203.0.113.7',
    ips: [],
    headers: { authorization: `Bearer ${token}` },
  };
  const res = { header: jest.fn() };
  return {
    getHandler: () => EmergencyController.prototype.emergency,
    getClass: () => EmergencyController,
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
}

async function press(g: UserThrottlerGuard, userId: string): Promise<HttpException | true> {
  try {
    return (await g.canActivate(ctxFor(userId))) as true;
  } catch (e) {
    return e as HttpException;
  }
}

describe('POST /safety/emergency — limite próprio', () => {
  let nowSpy: jest.SpyInstance;
  const clock = { now: Date.UTC(2026, 9, 1, 12) };
  beforeEach(() => {
    clock.now = Date.UTC(2026, 9, 1, 12);
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => clock.now);
  });
  afterEach(() => nowSpy.mockRestore());

  it('3 por hora por conta; a 4ª é 429 do botão (equipe avisada + ligue 190); outra conta não é afetada', async () => {
    const g = await makeGuard(clock);
    const A = '0a000000-0000-4000-8000-00000000000a';
    const B = '0b000000-0000-4000-8000-00000000000b';
    for (let i = 0; i < 3; i++) expect(await press(g, A)).toBe(true);
    const err = await press(g, A);
    expect(err).toBeInstanceOf(HttpException);
    const e = err as HttpException;
    expect(e.getStatus()).toBe(429);
    expect(e.getResponse()).toMatchObject({ error: EMERGENCY_THROTTLED_ERROR });
    const msg = (e.getResponse() as { message: string }).message;
    expect(msg).toContain(`ligue ${EMERGENCY_PHONE}`);
    expect(msg).toContain('190');
    expect(await press(g, B)).toBe(true);
  });

  it('10 por dia: mesmo espalhando pelas horas, a 11ª do dia é 429', async () => {
    const g = await makeGuard(clock);
    const A = '0c000000-0000-4000-8000-00000000000c';
    let ok = 0;
    for (let h = 0; h < 6; h++) {
      for (let i = 0; i < 2; i++) if ((await press(g, A)) === true) ok += 1;
      clock.now += HOUR + 1000;
    }
    // 6 horas × 2 = 12 tentativas, só 10 passam
    expect(ok).toBe(10);
    const err = await press(g, A);
    expect((err as HttpException).getStatus()).toBe(429);
    expect((err as HttpException).getResponse()).toMatchObject({
      error: EMERGENCY_THROTTLED_ERROR,
    });
  });

  it('outras rotas continuam com o 429 genérico', async () => {
    const g = await makeGuard(clock);
    const ctx = {
      getHandler: () => function other() {},
      getClass: () => class Other {},
    } as unknown as ExecutionContext;
    const call = (
      g as unknown as { throwThrottlingException(c: ExecutionContext): Promise<void> }
    ).throwThrottlingException(ctx);
    await expect(call).rejects.toMatchObject({ response: { error: 'too_many_requests' } });
  });
});
