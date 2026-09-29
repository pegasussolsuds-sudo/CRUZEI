// Sentry do backend. Importado no main.ts logo depois do load-env e ANTES do @nestjs/core: o SDK precisa se instalar
// antes de http/express serem carregados. Lê process.env direto (roda antes do ConfigService). Sem SENTRY_DSN, nada.
//
// LGPD / app de encontros: nada de localização, telefone, JWT, token do Mapbox, e-mail, corpo, query, cookies,
// headers ou IP nos eventos. Tracing desligado (sem tracesSampleRate): só erros.
import * as Sentry from '@sentry/nestjs';
import type { Breadcrumb, ErrorEvent } from '@sentry/nestjs';

// ---- sanitização (mesmas regras do app: apps/mobile/src/services/sentry.ts) ----

// token do Mapbox: pk. (público), sk. (secreto), tk. (temporário)
const MAPBOX_TOKEN = /\b[pst]k\.[\w-]+\.[\w-]+/g;
const JWT = /eyJ[\w-]+\.[\w-]+\.[\w-]+/g;
const BEARER = /\bBearer\s+[\w.~+/=-]+/gi;
const SECRET_PARAM = /\b(access_token|refresh_token|refreshToken|token|password|code)=[^&\s#]+/gi;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
// 4+ casas decimais já é posição (~11 m); pega também número solto, o que é aceitável
const COORD = /-?\d{1,3}\.\d{4,}/g;
// celular/fixo BR com ou sem +55, parênteses, espaço, ponto ou hífen: (11) 98765-4321, +55 11 987654321…
const PHONE_BR = /(?<![\w-])(?:\+?55[\s.-]?)?\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}(?![\w-])/g;
// qualquer sequência solta de 10 a 13 dígitos (telefone sem máscara, com DDI); não mexe em trecho de UUID
const LONG_DIGITS = /(?<![\w.-])\+?\d{10,13}(?![\w.-])/g;

export function sanitizeText(text: string): string {
  return text
    .replace(MAPBOX_TOKEN, '[token]')
    .replace(JWT, '[jwt]')
    .replace(BEARER, 'Bearer [redacted]')
    .replace(SECRET_PARAM, '$1=[redacted]')
    .replace(EMAIL, '[email]')
    .replace(COORD, '[coord]')
    .replace(PHONE_BR, '[phone]')
    .replace(LONG_DIGITS, '[phone]');
}

/** query e fragmento saem inteiros (lat/lng, busca, access_token do Mapbox); o caminho passa pelo sanitizeText */
export function sanitizeUrl(url: string): string {
  return sanitizeText(url.split(/[?#]/, 1)[0] ?? '');
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return sanitizeText(value);
  if (depth >= 4 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => sanitizeValue(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = sanitizeValue(v, depth + 1);
  return out;
}

function beforeBreadcrumb(crumb: Breadcrumb): Breadcrumb {
  const data: Record<string, unknown> | undefined = crumb.data ? { ...crumb.data } : undefined;
  if (data) {
    // chamadas de saída (Mapbox, FCM, AWS): a query leva token e posição
    delete data['http.query'];
    delete data['http.fragment'];
    if (typeof data.url === 'string') data.url = sanitizeUrl(data.url);
    // console.*: só a mensagem limpa, nunca os objetos crus
    delete data.arguments;
  }
  return {
    ...crumb,
    message: typeof crumb.message === 'string' ? sanitizeText(crumb.message) : crumb.message,
    data: data ? (sanitizeValue(data) as Record<string, unknown>) : undefined,
  };
}

function beforeSend(event: ErrorEvent): ErrorEvent {
  for (const ex of event.exception?.values ?? []) {
    if (typeof ex.value === 'string') ex.value = sanitizeText(ex.value);
  }
  if (typeof event.message === 'string') event.message = sanitizeText(event.message);
  if (event.logentry) {
    const { message } = event.logentry;
    if (typeof message === 'string') event.logentry.message = sanitizeText(message);
    delete event.logentry.params;
  }
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map(beforeBreadcrumb);
  if (event.extra) event.extra = sanitizeValue(event.extra) as Record<string, unknown>;
  if (event.request) {
    delete event.request.query_string;
    delete event.request.cookies;
    delete event.request.data;
    delete event.request.headers;
    if (event.request.url) event.request.url = sanitizeUrl(event.request.url);
  }
  // usuário só pelo id (o backend nem define hoje; garante que IP/e-mail/nome nunca vão)
  const id = event.user?.id;
  if (id !== undefined && id !== '') event.user = { id: String(id) };
  else delete event.user;
  return event;
}

const dsn = process.env.SENTRY_DSN?.trim() ?? '';

/** true se o Sentry foi inicializado (há SENTRY_DSN) */
export const sentryEnabled = dsn !== '';

if (sentryEnabled) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    // não acrescente dataCollection sem preencher TODAS as chaves: com ele presente o sendDefaultPii é ignorado e
    // o que faltar volta pro padrão (coleta tudo)
    sendDefaultPii: false,
    integrations: [
      // corpo das requisições nunca é lido pelo SDK
      Sentry.httpIntegration({ maxIncomingRequestBodySize: 'none' }),
      // do request só método e URL (a URL ainda perde a query no beforeSend)
      Sentry.requestDataIntegration({
        include: { data: false, query_string: false, cookies: false, ip: false, headers: false },
      }),
      // mesmo comportamento de sem Sentry: rejeição não tratada derruba o processo (o cluster recria o worker).
      // O padrão do SDK ('warn') só registraria e deixaria o processo seguir.
      Sentry.onUnhandledRejectionIntegration({ mode: 'strict' }),
    ],
    maxBreadcrumbs: 50,
    beforeBreadcrumb,
    beforeSend,
  });
}
