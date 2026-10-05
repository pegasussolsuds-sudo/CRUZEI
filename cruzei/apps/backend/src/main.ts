// .env ANTES de tudo (constantes lidas no import dependem dele)
import './config/load-env';
// Sentry logo depois do .env (lê SENTRY_DSN) e antes do Nest/express carregarem; sem DSN não faz nada
import './instrument';
import 'reflect-metadata';
import cluster from 'node:cluster';

import { ValidationPipe, Logger, RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as Sentry from '@sentry/nestjs';

import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { configureHttpSecurity } from './config/http-security';
import { clusterWorkerCount, clusterWorkerIndex, resolveLogLevels } from './config/runtime';
import { devShortcutsEnabled } from './config/security';
import { mountUploads } from './modules/uploads/serve-uploads';
import { UPLOAD_DIR } from './modules/uploads/uploads.constants';

async function bootstrap() {
  const levels = resolveLogLevels();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    ...(levels ? { logger: levels } : {}),
  });

  const config = app.get(ConfigService);
  const worker = clusterWorkerIndex();
  const logger = new Logger(worker ? `Bootstrap#${worker}` : 'Bootstrap');

  // atrás de balanceador/proxy (TLS em produção): TRUST_PROXY_HOPS = nº EXATO de proxies na frente. Sem isso req.ip é o
  // do proxy (o limite de login/claim vira um balde só pra cidade toda) e as URLs de foto saem http://. Nunca "true":
  // o X-Forwarded-For mais à esquerda é forjável
  const proxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
  if (Number.isInteger(proxyHops) && proxyHops > 0) app.set('trust proxy', proxyHops);

  // /legal/:slug fica fora do prefixo: é a URL pública da política/termos (ficha das lojas, links fora do app)
  app.setGlobalPrefix(config.get<string>('apiPrefix') ?? 'v1', {
    exclude: [{ path: 'legal/:slug', method: RequestMethod.GET }],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  // cabeçalhos de segurança, sem X-Powered-By, corpo de 100 KB, CORS por lista (HTTP e socket) — antes de /uploads
  const sec = configureHttpSecurity(app, process.env, config.get<string>('apiPrefix') ?? 'v1');
  if (worker <= 1) {
    const dev = devShortcutsEnabled() ? '; atalhos de dev LIGADOS' : '';
    logger.log(
      `ambiente ${sec.env}; ${sec.origins.length} origem(ns) de navegador liberada(s)${dev}`,
    );
  }

  // fotos do driver local em /uploads (só imagem, nosniff, CSP sandbox, CORS aberto pro canvas do mapa); com
  // STORAGE_DRIVER=s3 as fotos saem do domínio do bucket e nada é montado aqui
  const servesUploads = mountUploads(app);

  app.enableShutdownHooks();

  const port = config.get<number>('port') ?? 3000;
  await app.listen(port, '0.0.0.0');
  logger.log(`🚀 Metch API rodando em http://localhost:${port}/${config.get('apiPrefix')}`);
  if (!worker && servesUploads) logger.log(`🖼️  Uploads em ${UPLOAD_DIR}`);
}

/**
 * CLUSTER_WORKERS > 1: o primário só cria e vigia os workers (cada um sobe o Nest inteiro e divide a porta).
 * O worker 1 roda os crons (IS_CRON_WORKER); worker que cai é recriado com espera crescente.
 */
function runPrimary(workers: number) {
  const log = new Logger('Cluster');
  const restarts = new Map<number, number>();
  const fork = (index: number) => {
    const w = cluster.fork({
      CLUSTER_WORKER_INDEX: String(index),
      IS_CRON_WORKER: process.env.IS_CRON_WORKER ?? (index === 1 ? '1' : '0'),
    });
    w.on('exit', (code, signal) => {
      const n = (restarts.get(index) ?? 0) + 1;
      restarts.set(index, n);
      const wait = Math.min(30_000, 500 * 2 ** Math.min(n, 6));
      log.warn(
        `worker ${index} saiu (code=${code} signal=${signal ?? '-'}); recriando em ${wait} ms`,
      );
      setTimeout(() => fork(index), wait);
    });
    w.on('listening', () => restarts.set(index, 0));
  };
  log.log(`subindo ${workers} workers (primário pid ${process.pid})`);
  for (let i = 1; i <= workers; i++) fork(i);
}

const workers = clusterWorkerCount();
if (workers > 1 && cluster.isPrimary) {
  runPrimary(workers);
} else {
  bootstrap().catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error('Falha ao subir:', err);
    // o exit mataria o envio no meio: espera até 2 s o evento sair
    if (Sentry.isInitialized()) {
      Sentry.captureException(err);
      await Sentry.flush(2000);
    }
    process.exit(1);
  });
}
