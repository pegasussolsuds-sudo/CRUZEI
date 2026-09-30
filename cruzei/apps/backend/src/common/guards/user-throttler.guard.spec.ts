import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

import {
  bearerOf,
  ipTracker,
  isAuthRoute,
  resolveTracker,
  UserThrottlerGuard,
} from './user-throttler.guard';

// Chave do rate limit: só um access token de assinatura válida vira cota de usuário ('u:<id>'). Bearer inventado,
// vencido, refresh ou qualquer rota /auth/* cai no IP — senão cada token falso era uma cota nova (força bruta livre).

const SECRET = 'segredo-do-teste-do-throttler';
const USER = '0a000000-0000-4000-8000-00000000000a';
const jwt = new JwtService({ secret: SECRET });
const verify = (t: string) => jwt.verify(t);

const req = (url: string, bearer?: string, ip = '203.0.113.7'): Record<string, unknown> => ({
  originalUrl: url,
  url,
  ip,
  ips: [],
  headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
});

describe('isAuthRoute / bearerOf / ipTracker', () => {
  it('reconhece /auth/* com ou sem o prefixo global', () => {
    expect(isAuthRoute(req('/v1/auth/claim/confirm'))).toBe(true);
    expect(isAuthRoute(req('/v1/auth/login?x=1'))).toBe(true);
    expect(isAuthRoute(req('/auth/refresh'))).toBe(true);
    expect(isAuthRoute(req('/v1/auth'))).toBe(true);
    expect(isAuthRoute(req('/v1/users/me'))).toBe(false);
    expect(isAuthRoute(req('/v1/authors'))).toBe(false);
  });

  it('extrai o Bearer e usa o 1º IP do proxy quando existe', () => {
    expect(bearerOf(req('/v1/x', 'abc.def.ghi'))).toBe('abc.def.ghi');
    expect(bearerOf({ headers: { authorization: 'Basic xyz' } })).toBeNull();
    expect(bearerOf({})).toBeNull();
    expect(ipTracker({ ips: ['198.51.100.1', '10.0.0.1'], ip: '10.0.0.1' })).toBe(
      'ip:198.51.100.1',
    );
    expect(ipTracker({ ip: '10.0.0.9' })).toBe('ip:10.0.0.9');
  });
});

describe('resolveTracker', () => {
  const access = () => jwt.sign({ sub: USER, typ: 'access' }, { expiresIn: 900 });

  it('access token válido fora de /auth: cota por conta (trocar de token não zera)', () => {
    const a = access();
    const b = jwt.sign({ sub: USER }, { expiresIn: 900 }); // token antigo, sem tipo
    expect(resolveTracker(req('/v1/location/nearby', a), verify)).toBe(`u:${USER}`);
    expect(resolveTracker(req('/v1/location/nearby', b), verify)).toBe(`u:${USER}`);
  });

  it('Bearer inventado, de outro segredo ou vencido: IP (nunca o hash de um token não verificado)', () => {
    const forged = new JwtService({ secret: 'outro' }).sign({ sub: USER, typ: 'access' });
    const expired = jwt.sign({ sub: USER, typ: 'access', exp: Math.floor(Date.now() / 1000) - 60 });
    for (const t of ['lixo', 'a.b.c', forged, expired]) {
      expect(resolveTracker(req('/v1/location/nearby', t, '198.51.100.9'), verify)).toBe(
        'ip:198.51.100.9',
      );
    }
  });

  it('cada token inventado NÃO vira uma cota nova: todos caem na mesma chave do IP', () => {
    const keys = new Set(
      Array.from({ length: 20 }, (_, i) =>
        resolveTracker(req('/v1/users/me', `fake-${i}`), verify),
      ),
    );
    expect([...keys]).toEqual(['ip:203.0.113.7']);
  });

  it('refresh token (mesmo segredo) não ganha cota de usuário', () => {
    const r = jwt.sign({ sub: USER, typ: 'refresh' }, { expiresIn: 2_592_000 });
    expect(resolveTracker(req('/v1/users/me', r), verify)).toBe('ip:203.0.113.7');
  });

  it('rotas /auth/* são sempre por IP, mesmo com um access válido', () => {
    expect(resolveTracker(req('/v1/auth/claim/confirm', access()), verify)).toBe('ip:203.0.113.7');
    expect(resolveTracker(req('/v1/auth/login'), verify)).toBe('ip:203.0.113.7');
  });

  it('sem token: IP', () => {
    expect(resolveTracker(req('/v1/pois'), verify)).toBe('ip:203.0.113.7');
  });
});

describe('UserThrottlerGuard.getTracker', () => {
  const make = (secret?: string) => {
    const g = new UserThrottlerGuard({ throttlers: [] }, {} as never, new Reflector());
    const cfg = {
      get: (k: string) => (k === 'jwt.secret' ? secret : undefined),
    } as unknown as ConfigService;
    Object.assign(g, { cfg });
    return g as unknown as { getTracker(r: Record<string, unknown>): Promise<string> };
  };

  it('confere o token com o segredo do jwt.secret e memoriza por pedido', async () => {
    const g = make(SECRET);
    const r = req('/v1/users/me', jwt.sign({ sub: USER, typ: 'access' }, { expiresIn: 900 }));
    expect(await g.getTracker(r)).toBe(`u:${USER}`);
    // o 2º throttler do mesmo pedido reaproveita
    (r.headers as Record<string, string>).authorization = 'Bearer lixo';
    expect(await g.getTracker(r)).toBe(`u:${USER}`);
  });

  it('sem segredo configurado nada valida: IP', async () => {
    const g = make(undefined);
    const r = req('/v1/users/me', jwt.sign({ sub: USER, typ: 'access' }, { expiresIn: 900 }));
    expect(await g.getTracker(r)).toBe('ip:203.0.113.7');
  });
});
