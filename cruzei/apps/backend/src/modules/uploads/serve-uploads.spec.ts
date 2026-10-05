import * as fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

import type { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';

import { isServableUploadPath, mountUploads } from './serve-uploads';

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

  it('held/ (foto retida por denúncia) e qualquer pasta fora de p/ e fakes/: 404 no guard, em toda grafia', () => {
    const f = fakeApp();
    mountUploads(f.app, { NODE_ENV: 'development', UPLOAD_DIR: dir });
    const guard = f.mounted[0].handler;
    const id = '3f2b8c1e-9a4d-4e2f-8b7a-1c2d3e4f5a6b';
    for (const p of [
      `/held/${id}.jpg`,
      `/HELD/${id}.jpg`,
      `/%68eld/${id}.jpg`,
      `/held%2F${id}.jpg`,
      `/held./${id}.jpg`,
      `/held%5C${id}.jpg`,
      `/p\\..\\held\\${id}.jpg`,
      `/p/../held/${id}.jpg`,
      `/p//${id}.jpg`,
      `/held::$INDEX_ALLOCATION/${id}.jpg`,
      `/outra/${id}.jpg`,
      `/p/sub/${id}.jpg`,
    ]) {
      const res = fakeRes();
      const next = jest.fn();
      guard({ method: 'GET', path: p }, res, next);
      expect({ p, next: next.mock.calls.length }).toEqual({ p, next: 0 });
      expect(res.statusCode).toBe(404);
    }
    expect(isServableUploadPath(`/${id}.jpg`)).toBe(true);
    expect(isServableUploadPath(`/p/${id}-t.jpg`)).toBe(true);
    expect(isServableUploadPath('/fakes/fake-1.jpg')).toBe(true);
  });

  it('servidor de verdade (express.static): held/ no disco nunca sai; p/ sai', async () => {
    const root = path.join(dir, 'real');
    const id = '3f2b8c1e-9a4d-4e2f-8b7a-1c2d3e4f5a6b';
    fs.mkdirSync(path.join(root, 'held'), { recursive: true });
    fs.mkdirSync(path.join(root, 'p'), { recursive: true });
    fs.writeFileSync(path.join(root, 'held', `${id}.jpg`), 'PROVA');
    fs.writeFileSync(path.join(root, 'p', `${id}.jpg`), 'PUBLICA');
    const app = express();
    mountUploads(app as unknown as NestExpressApplication, {
      NODE_ENV: 'development',
      UPLOAD_DIR: root,
    });
    const server = app.listen(0);
    try {
      const port = (server.address() as AddressInfo).port;
      const get = (p: string) => fetch(`http://127.0.0.1:${port}/uploads${p}`);
      const ok = await get(`/p/${id}.jpg`);
      expect(ok.status).toBe(200);
      expect(await ok.text()).toBe('PUBLICA');
      for (const p of [
        `/held/${id}.jpg`,
        `/HELD/${id}.jpg`,
        `/%68eld/${id}.jpg`,
        `/held%2F${id}.jpg`,
        `/p/..%2Fheld/${id}.jpg`,
        `/held./${id}.jpg`,
      ]) {
        const r = await get(p);
        expect({ p, status: r.status }).toEqual({ p, status: 404 });
        expect(await r.text()).not.toContain('PROVA');
      }
    } finally {
      await new Promise((r) => server.close(r));
    }
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
