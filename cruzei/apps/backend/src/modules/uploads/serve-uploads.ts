// /uploads do driver local: só imagem, com nosniff e CSP que não executa nada (fecha o polyglot legado: um .html
// "imagem" enviado antes do reprocessamento nunca mais é servido). CORS aberto: o mapa desenha as fotos em canvas.
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { NestExpressApplication } from '@nestjs/platform-express';
import * as express from 'express';

import { storageConfigFromEnv } from './storage/object-storage';

export const SERVED_IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.heic',
  '.heif',
]);

function imageHeaders(res: { setHeader(name: string, value: string): unknown }): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
}

/** monta /uploads quando o driver é local; com s3 as fotos saem do domínio do bucket. Devolve se montou. */
export function mountUploads(
  app: NestExpressApplication,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const cfg = storageConfigFromEnv(env);
  if (cfg.driver !== 'local') return false;
  fs.mkdirSync(cfg.localDir, { recursive: true });

  // extensão fora da lista (ex.: .html, .svg): 404 antes de chegar no disco
  app.use('/uploads', (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (SERVED_IMAGE_EXTENSIONS.has(path.extname(req.path).toLowerCase())) return next();
    imageHeaders(res);
    res.status(404).end();
  });
  app.use(
    '/uploads',
    express.static(cfg.localDir, {
      index: false,
      dotfiles: 'deny',
      redirect: false,
      cacheControl: false,
      setHeaders: (res) => {
        imageHeaders(res);
        res.setHeader('Cache-Control', cfg.cacheControl);
      },
    }),
  );
  // foto que não existe mais: 404 limpo (com CORS) em vez de erro de CORS no console do WebView — só GET/HEAD
  app.use('/uploads', (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    imageHeaders(res);
    res.status(404).end();
  });
  return true;
}
