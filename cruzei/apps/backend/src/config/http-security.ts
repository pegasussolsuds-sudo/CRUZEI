import type { NestExpressApplication } from '@nestjs/platform-express';

import { securityHeaders } from '../common/security-headers';
import { SOCKET_MAX_BUFFER, SecureIoAdapter } from '../realtime/secure-io.adapter';

import { appEnv, isProduction, resolveAllowedOrigins, type AppEnv } from './security';

/** corpo JSON/urlencoded: o mesmo padrão do body-parser, agora declarado (upload de foto é multipart, 10 MB à parte) */
export const BODY_LIMIT = '100kb';
/** preflight em cache por 10 min no navegador */
export const CORS_MAX_AGE_S = 600;

export type HttpSecuritySummary = { env: AppEnv; origins: string[] };

/**
 * Cabeçalhos, limite de corpo, CORS do HTTP e do socket. Chamar logo depois do trust proxy e ANTES de /uploads e do
 * listen (a ordem dos app.use é a ordem de execução). Devolve só ambiente e origens (nada de segredo) pro log de boot.
 */
export function configureHttpSecurity(
  app: NestExpressApplication,
  env: NodeJS.ProcessEnv = process.env,
  apiPrefix = 'v1',
): HttpSecuritySummary {
  const production = isProduction(env);
  const origins = resolveAllowedOrigins(env);

  app.disable('x-powered-by');
  app.use(securityHeaders({ hsts: production, apiPrefix }));
  // registrados antes do init: o Nest não põe os parsers padrão por cima (mesmo nome)
  app.useBodyParser('json', { limit: BODY_LIMIT });
  app.useBodyParser('urlencoded', { limit: BODY_LIMIT, extended: true });
  // sem cookie (painel e app usam Bearer): credentials desligado; lista vazia = nenhum navegador de outra origem
  app.enableCors({
    origin: origins.length ? origins : false,
    credentials: false,
    maxAge: CORS_MAX_AGE_S,
  });
  app.useWebSocketAdapter(
    new SecureIoAdapter(app, { production, origins, maxHttpBufferSize: SOCKET_MAX_BUFFER }),
  );
  return { env: appEnv(env), origins };
}
