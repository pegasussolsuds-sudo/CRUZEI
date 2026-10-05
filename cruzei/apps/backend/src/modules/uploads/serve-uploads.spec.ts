import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { NestExpressApplication } from '@nestjs/platform-express';

import { mountUploads } from './serve-uploads';

// /uploads do driver local: só extensão de imagem chega no disco; tudo sai com nosniff e CSP sandbox (o polyglot
// .html/.svg legado nunca é servido) e CORS aberto pro canvas do mapa. Com s3 nada é montado.

type Handler = (req: unknown, res: unknown, next: () => void) => void;

function fakeApp() {
  const mounted: { path: string; handler: Handler }[] = [];
  const app = { use: (p: string, h: Handler) => mounted.push({ path: p, handler: h }) };
  return { app: app as unknown as NestExpressApplication, mounted };
}

function fakeRes() {
  const headers: Record<string, string> = {};
  const res = {
    headers,
    statusCode: 200,
    ended: false,
    setHeader: (k: string, v: string) => (headers[k.toLowerCase()] = v),
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    end() {
      res.ended = true;
    },
  };
  return res;
}

const dir = path.join(os.tmpdir(), 'metch-serve-uploads-spec');
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('mountUploads', () => {
  it('driver s3: não monta nada', () => {
    const f = fakeApp();
    const ok = mountUploads(f.app, {
      NODE_ENV: 'production',
      STORAGE_DRIVER: 's3',
      STORAGE_PUBLIC_BASE_URL: 'https://fotos.metch.app',
      STORAGE_S3_ENDPOINT: 'https://conta.r2.cloudflarestorage.com',
      STORAGE_S3_BUCKET: 'metch-fotos',
      STORAGE_S3_ACCESS_KEY_ID: 'a',
      STORAGE_S3_SECRET_ACCESS_KEY: 'b',
    });
    expect(ok).toBe(false);
    expect(f.mounted).toHaveLength(0);
  });

  it('driver local: extensão fora da lista dá 404 com cabeçalhos seguros; imagem segue pro disco', () => {
    const f = fakeApp();
    expect(mountUploads(f.app, { NODE_ENV: 'development', UPLOAD_DIR: dir })).toBe(true);
    expect(f.mounted.map((m) => m.path)).toEqual(['/uploads', '/uploads', '/uploads']);
    const guard = f.mounted[0].handler;

    for (const p of ['/x.html', '/p/x.svg', '/p/x.jpg.abc.tmp', '/', '/p/']) {
      const res = fakeRes();
      const next = jest.fn();
      guard({ method: 'GET', path: p }, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(404);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
      expect(res.headers['access-control-allow-origin']).toBe('*');
    }
    for (const p of [
      '/p/3f2b8c1e-9a4d-4e2f-8b7a-1c2d3e4f5a6b.jpg',
      '/fakes/fake-1.JPG',
      '/a.webp',
    ]) {
      const next = jest.fn();
      guard({ method: 'GET', path: p }, fakeRes(), next);
      expect(next).toHaveBeenCalled();
    }
    // POST/OPTIONS seguem pro router
    const next = jest.fn();
    guard({ method: 'POST', path: '/x.html' }, fakeRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('arquivo que não existe: 404 limpo com CORS (só GET/HEAD)', () => {
    const f = fakeApp();
    mountUploads(f.app, { NODE_ENV: 'development', UPLOAD_DIR: dir });
    const last = f.mounted[2].handler;
    const res = fakeRes();
    last({ method: 'HEAD', path: '/p/sumiu.jpg' }, res, jest.fn());
    expect(res.statusCode).toBe(404);
    expect(res.headers['access-control-allow-origin']).toBe('*');
    const next = jest.fn();
    last({ method: 'OPTIONS', path: '/p/sumiu.jpg' }, fakeRes(), next);
    expect(next).toHaveBeenCalled();
  });
});
