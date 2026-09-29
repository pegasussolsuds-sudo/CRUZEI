import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import type { PrismaService } from '../../database/prisma.service';
import type { RedisService } from '../../redis/redis.service';
import type { AccountStateService } from '../account/account-state.service';

import { AuthService, canRenewWith, isRefreshPayload, type JwtPayload } from './auth.service';
import type { SmsService } from './sms.service';
import { JwtStrategy } from './strategies/jwt.strategy';

// Access e refresh usam o MESMO segredo: o tipo no payload é o que impede o refresh de 30 dias de virar Bearer
// (HTTP e socket) e o access de renovar sessão. Token antigo, sem tipo, ainda renova (ninguém cai no deploy).

const SECRET = 'segredo-do-teste-de-auth';
const USER = '0a000000-0000-4000-8000-00000000000a';

// como no AuthModule: o segredo vem do registro do módulo (o sign do serviço não passa segredo)
const jwt = new JwtService({ secret: SECRET });
const cfg = {
  get: (k: string) =>
    k === 'jwt.secret'
      ? SECRET
      : k === 'jwt.accessTtl'
        ? 900
        : k === 'jwt.refreshTtl'
          ? 2_592_000
          : undefined,
} as unknown as ConfigService;
const prisma = {
  user: {
    findUnique: jest.fn(async () => ({
      id: USER,
      name: 'Ana',
      phone: '+5534999990000',
      deletedAt: null,
    })),
  },
} as unknown as PrismaService;
const accounts = {
  assertActive: jest.fn(async () => ({
    status: 'active',
    until: null,
    reason: null,
    role: 'user',
  })),
} as unknown as AccountStateService;

const service = new AuthService(prisma, jwt, cfg, {} as SmsService, {} as RedisService, accounts);
const strategy = new JwtStrategy(cfg, accounts);

const decode = (t: string) =>
  jwt.verify<JwtPayload & { exp: number; iat: number }>(t, { secret: SECRET });
const sign = (p: object, expiresIn = 900) => jwt.sign(p, { secret: SECRET, expiresIn });

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
