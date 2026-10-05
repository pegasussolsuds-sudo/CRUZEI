import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

import { Body, Controller, Get, Post, RequestMethod } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';

import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { API_CSP, HSTS_VALUE } from '../common/security-headers';
import { LEGAL_PAGE_CSP, LegalPagesController } from '../modules/legal/legal.controller';
import { LegalService } from '../modules/legal/legal.service';

import { configureHttpSecurity } from './http-security';

// App Nest de verdade numa porta aleatória (mesma ordem do main.ts), com um controller e um gateway de teste:
// cabeçalhos, CORS do HTTP, limite de corpo e Origin do socket, em produção e em dev.

const ADMIN = 'https://admin.metch.app';
const EVIL = 'https://evil.example';

@Controller()
class PingController {
  @Get('ping')
  ping() {
    return { ok: true };
  }

  @Post('echo')
  echo(@Body() body: Record<string, unknown>) {
    return { keys: Object.keys(body ?? {}).length };
  }

  @Get('fora')
  fora() {
    return { ok: true };
  }
}

@WebSocketGateway({ transports: ['websocket', 'polling'] })
class PingGateway {
  @SubscribeMessage('ping')
  ping() {
    return 'pong';
  }
}

type Srv = { app: NestExpressApplication; url: string; port: number };

async function makeApp(env: NodeJS.ProcessEnv): Promise<Srv> {
  const mod = await Test.createTestingModule({
    controllers: [PingController, LegalPagesController],
    providers: [
      PingGateway,
      { provide: LegalService, useValue: { html: () => '<html><style>b{}</style></html>' } },
    ],
  }).compile();
  const app = mod.createNestApplication<NestExpressApplication>({ logger: false });
  app.setGlobalPrefix('v1', {
    exclude: [
      { path: 'fora', method: RequestMethod.GET },
      { path: 'legal/:slug', method: RequestMethod.GET },
    ],
  });
  app.useGlobalFilters(new HttpExceptionFilter());
  configureHttpSecurity(app, env, 'v1');
  await app.listen(0, '127.0.0.1');
  const port = (app.getHttpServer().address() as AddressInfo).port;
  return { app, port, url: `http://127.0.0.1:${port}` };
}

type Res = { status: number; headers: http.IncomingHttpHeaders; body: string };

function request(
  srv: Srv,
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: string,
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const h: http.OutgoingHttpHeaders = { ...headers };
    if (body !== undefined) {
      h['content-type'] = 'application/json';
      h['content-length'] = Buffer.byteLength(body);
    }
    const req = http.request(
      { hostname: '127.0.0.1', port: srv.port, path, method, headers: h },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

const open: ClientSocket[] = [];

/** 'connected' ou o erro do connect (websocket, sem reconexão) */
function connectWith(srv: Srv, origin?: string): Promise<ClientSocket | Error> {
  return new Promise((resolve) => {
    const s = ioClient(srv.url, {
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
      timeout: 4000,
      extraHeaders: origin ? { origin } : {},
    });
    open.push(s);
    s.on('connect', () => resolve(s));
    s.on('connect_error', (e) => resolve(e));
  });
}

let prod: Srv;
let dev: Srv;

beforeAll(async () => {
  prod = await makeApp({ NODE_ENV: 'production', ALLOWED_ORIGINS: `${ADMIN}/` });
  dev = await makeApp({ NODE_ENV: 'development' });
});

afterAll(async () => {
  await prod?.app.close();
  await dev?.app.close();
});

afterEach(() => {
  open.splice(0).forEach((s) => s.close());
});

describe('cabeçalhos de segurança', () => {
  it('produção: nosniff, DENY, CSP, no-referrer, COOP, HSTS e no-store na API; sem X-Powered-By', async () => {
    const r = await request(prod, 'GET', '/v1/ping');
    expect(r.status).toBe(200);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.headers['content-security-policy']).toBe(API_CSP);
    expect(r.headers['referrer-policy']).toBe('no-referrer');
    expect(r.headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(r.headers['x-permitted-cross-domain-policies']).toBe('none');
    expect(r.headers['strict-transport-security']).toBe(HSTS_VALUE);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['x-powered-by']).toBeUndefined();
  });

  it('fora do prefixo da API não recebe no-store (mas recebe os outros cabeçalhos)', async () => {
    const r = await request(prod, 'GET', '/fora');
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBeUndefined();
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });

  it('/V1/ping (o express não diferencia maiúsculas) também é API: no-store', async () => {
    const r = await request(prod, 'GET', '/V1/ping');
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('/legal/:slug troca a CSP (tem <style> inline) e mantém o cache público', async () => {
    const r = await request(prod, 'GET', '/legal/termos');
    expect(r.status).toBe(200);
    expect(r.headers['content-security-policy']).toBe(LEGAL_PAGE_CSP);
    expect(r.headers['content-security-policy']).toContain("style-src 'unsafe-inline'");
    expect(r.headers['cache-control']).toBe('public, max-age=300');
  });

  it('dev: sem HSTS, sem X-Powered-By, resto igual', async () => {
    const r = await request(dev, 'GET', '/v1/ping');
    expect(r.headers['strict-transport-security']).toBeUndefined();
    expect(r.headers['x-powered-by']).toBeUndefined();
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['cache-control']).toBe('no-store');
  });
});

describe('CORS do HTTP', () => {
  it('Origin do painel recebe ACAO (sem credentials); outra origem não recebe', async () => {
    const ok = await request(prod, 'GET', '/v1/ping', { origin: ADMIN });
    expect(ok.headers['access-control-allow-origin']).toBe(ADMIN);
    expect(ok.headers['access-control-allow-credentials']).toBeUndefined();

    const evil = await request(prod, 'GET', '/v1/ping', { origin: EVIL });
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
    expect(evil.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('preflight: painel liberado com max-age; evil sem ACAO', async () => {
    const pre = {
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type,authorization',
    };
    const ok = await request(prod, 'OPTIONS', '/v1/echo', { origin: ADMIN, ...pre });
    expect(ok.status).toBe(204);
    expect(ok.headers['access-control-allow-origin']).toBe(ADMIN);
    expect(ok.headers['access-control-max-age']).toBe('600');
    expect(ok.headers['access-control-allow-credentials']).toBeUndefined();

    const evil = await request(prod, 'OPTIONS', '/v1/echo', { origin: EVIL, ...pre });
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('produção sem ALLOWED_ORIGINS: nenhum navegador de outra origem', async () => {
    const bare = await makeApp({ NODE_ENV: 'production' });
    try {
      const r = await request(bare, 'GET', '/v1/ping', { origin: 'http://localhost:8081' });
      expect(r.status).toBe(200);
      expect(r.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      await bare.app.close();
    }
  });

  it('dev sem nada configurado: localhost do Expo continua liberado', async () => {
    const r = await request(dev, 'GET', '/v1/ping', { origin: 'http://localhost:8081' });
    expect(r.headers['access-control-allow-origin']).toBe('http://localhost:8081');
  });
});

describe('limite de corpo (100 KB)', () => {
  it('JSON de 150 KB dá 413 payload_too_large; 90 KB passa', async () => {
    const big = JSON.stringify({ blob: 'x'.repeat(150 * 1024) });
    const r = await request(prod, 'POST', '/v1/echo', {}, big);
    expect(r.status).toBe(413);
    expect(JSON.parse(r.body)).toMatchObject({ error: 'payload_too_large', status: 413 });

    const small = JSON.stringify({ blob: 'x'.repeat(90 * 1024) });
    const ok = await request(prod, 'POST', '/v1/echo', {}, small);
    expect(ok.status).toBe(201);
  });
});

describe('socket.io: Origin e teto de mensagem', () => {
  it('produção: Origin de fora não conecta', async () => {
    const r = await connectWith(prod, EVIL);
    expect(r).toBeInstanceOf(Error);
  });

  it('produção: sem Origin (nativo), Origin do painel e Origin igual ao host (RN) conectam', async () => {
    for (const origin of [undefined, ADMIN, prod.url]) {
      const r = await connectWith(prod, origin);
      expect(r).not.toBeInstanceOf(Error);
      expect(await (r as ClientSocket).emitWithAck('ping')).toBe('pong');
    }
  });

  it('produção: polling com Origin de fora é 403; do painel recebe ACAO sem credentials', async () => {
    const evil = await request(prod, 'GET', '/socket.io/?EIO=4&transport=polling', {
      origin: EVIL,
    });
    expect(evil.status).toBe(403);
    const ok = await request(prod, 'GET', '/socket.io/?EIO=4&transport=polling', { origin: ADMIN });
    expect(ok.status).toBe(200);
    expect(ok.headers['access-control-allow-origin']).toBe(ADMIN);
    expect(ok.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('dev: Origin de fora conecta (como antes; o proxy do Vite troca o Host)', async () => {
    const r = await connectWith(dev, EVIL);
    expect(r).not.toBeInstanceOf(Error);
  });

  it('mensagem acima de 64 KB derruba a conexão', async () => {
    const s = (await connectWith(prod)) as ClientSocket;
    expect(s).not.toBeInstanceOf(Error);
    const gone = new Promise<string>((resolve) => s.on('disconnect', (reason) => resolve(reason)));
    s.emit('ping', 'x'.repeat(70 * 1024));
    expect(await gone).toBeTruthy();
  });
});
