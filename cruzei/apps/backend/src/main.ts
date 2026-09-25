import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as express from 'express';
import * as fs from 'node:fs';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { UPLOAD_DIR } from './modules/uploads/uploads.constants';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  app.setGlobalPrefix(config.get<string>('apiPrefix') ?? 'v1');
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

  app.enableCors({
    origin: (config.get<string>('corsOrigins') ?? '').split(','),
    credentials: true,
  });

  // Fotos de dev — servidas direto do disco (prod: R2/CDN)
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  // CORS aberto nas fotos: o mapa (WebView) desenha avatares em canvas e precisa de imagens não-tainted
  app.use(
    '/uploads',
    express.static(UPLOAD_DIR, {
      maxAge: '7d',
      immutable: true,
      setHeaders: (res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      },
    }),
  );
  // foto que não existe mais: 404 limpo (com CORS) em vez de erro de CORS no console do WebView — só GET/HEAD,
  // o resto segue pro router (POST /v1/uploads/photo não passa por aqui, mas não custa não engolir OPTIONS)
  app.use('/uploads', (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(404).end();
  });

  app.enableShutdownHooks();

  const port = config.get<number>('port') ?? 3000;
  await app.listen(port, '0.0.0.0');
  logger.log(`🚀 Metch API rodando em http://localhost:${port}/${config.get('apiPrefix')}`);
  logger.log(`🖼️  Uploads em ${UPLOAD_DIR}`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Falha ao subir:', err);
  process.exit(1);
});
