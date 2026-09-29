// Sentry (diagnóstico de falhas). Sem EXPO_PUBLIC_SENTRY_DSN nada aqui roda: não inicializa, helpers viram no-op.
//
// LGPD / app de encontros: nada de localização, telefone, nome de terceiros, foto, JWT ou token do Mapbox em
// eventos e breadcrumbs. Breadcrumbs, usuário e tags passam pelo filtro daqui ANTES de o SDK espelhá-los no escopo
// nativo — então o crash nativo (tombstone do SIGSEGV no libhwui), que não passa pelo beforeSend do JS, sai com
// o mesmo contexto já limpo.
import * as Sentry from '@sentry/react-native';
import type { Breadcrumb, ErrorEvent } from '@sentry/react-native';
import type { ComponentType } from 'react';

import { config } from '../config';

/** true só depois de um init com DSN */
export let sentryEnabled = false;

// ---- sanitização (mesmas regras do backend: apps/backend/src/instrument.ts) ----

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

/** query e fragmento saem inteiros (lat/lng, token, busca); o caminho ainda passa pelo sanitizeText */
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

const ROUTE_NAME = /^[\w-]{1,64}$/;
const routeName = (v: unknown) => (typeof v === 'string' && ROUTE_NAME.test(v) ? v : undefined);

function beforeBreadcrumb(crumb: Breadcrumb): Breadcrumb | null {
  const category = crumb.category ?? '';
  // toque e rage tap: o rótulo vem do accessibilityLabel/texto da tela ("Curtir Fulana") — nome de terceiro
  if (category === 'touch' || category === 'ui.multiClick') return null;

  if (category === 'navigation') {
    // só nomes de rota; params (id de perfil, match…) nunca
    const to = routeName(crumb.data?.to);
    return {
      ...crumb,
      message: to ? `Navigation to ${to}` : undefined,
      data: { from: routeName(crumb.data?.from), to },
    };
  }

  const data: Record<string, unknown> | undefined = crumb.data ? { ...crumb.data } : undefined;
  if (data && (category === 'xhr' || category === 'fetch' || category === 'http')) {
    if (typeof data.url === 'string') data.url = sanitizeUrl(data.url);
    delete data['http.query'];
    delete data['http.fragment'];
  } else if (data && category === 'console') {
    // os argumentos crus do console.* podem ser objetos inteiros (perfil, posição); fica só a mensagem limpa
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
  // breadcrumbs nativos (lifecycle, rede) entram no evento sem passar pelo beforeBreadcrumb: filtra de novo aqui
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map(beforeBreadcrumb).filter((b): b is Breadcrumb => b !== null);
  }
  if (event.extra) event.extra = sanitizeValue(event.extra) as Record<string, unknown>;
  if (event.request) {
    delete event.request.query_string;
    delete event.request.cookies;
    delete event.request.data;
    if (event.request.url) event.request.url = sanitizeUrl(event.request.url);
  }
  // usuário só pelo id (pseudônimo); ip 0.0.0.0 impede o Sentry de inferir o IP da conexão
  const id = event.user?.id;
  event.user = id !== undefined && id !== '' ? { id: String(id), ip_address: '0.0.0.0' } : { ip_address: '0.0.0.0' };
  return event;
}

/** Chamado na 1ª linha do index.js, antes de o App (e tudo que ele importa) ser avaliado. Idempotente. */
export function initSentry(): void {
  if (sentryEnabled || !config.sentryDsn) return;
  try {
    Sentry.init({
      dsn: config.sentryDsn,
      environment: config.env,
      // sem override, o SDK nativo preenche app.metch@versão+build / build — o mesmo formato do upload dos source maps
      release: config.sentryRelease || undefined,
      dist: config.sentryDist || undefined,
      sendDefaultPii: false,
      enableNative: true,
      enableNativeCrashHandling: true,
      enableNdk: true,
      // Android 12+: o tombstone do ApplicationExitInfo traz todas as threads e os símbolos do sistema — é o que
      // mostra o SIGSEGV no RenderThread/libhwui (o frame do app sozinho não explica esse crash)
      enableTombstone: true,
      attachScreenshot: false,
      attachViewHierarchy: false,
      enableCaptureFailedRequests: false,
      enableLogs: false,
      maxBreadcrumbs: 50,
      // sem tracesSampleRate (tracing desligado) e sem replay: só erros e crashes
      beforeBreadcrumb,
      beforeSend,
    });
    sentryEnabled = true;
  } catch (e) {
    // o diagnóstico nunca pode derrubar o boot
    if (__DEV__) console.warn('[sentry] init falhou:', (e as Error).message);
  }
}

/** Raiz registrada no index.js: com o Sentry ligado vai embrulhada pelo Sentry.wrap; sem ele, como está. */
export function wrapRoot<P extends Record<string, unknown>>(Root: ComponentType<P>): ComponentType<P> {
  if (!sentryEnabled) return Root;
  return Sentry.wrap(Root, {
    // o texto dos filhos e o rage tap viram rótulo de breadcrumb (nome de quem aparece na tela) — desligados
    touchEventBoundaryProps: { extractTextFromChildren: false, enableRageTapDetection: false },
  });
}

/** Usuário da sessão, só pelo id; null no logout. */
export function setSentryUser(id: string | null): void {
  if (!sentryEnabled) return;
  Sentry.setUser(id ? { id, ip_address: '0.0.0.0' } : null);
}

export function setSentryTag(key: string, value: string): void {
  if (!sentryEnabled) return;
  Sentry.setTag(key, value);
}
