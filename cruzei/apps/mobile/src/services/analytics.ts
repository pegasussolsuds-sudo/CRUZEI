// Métricas próprias (POST /v1/analytics/events em lote; contrato em @cruzei/shared-types analytics.ts). Nada de
// empresa de fora e NUNCA localização: só a lista fechada de eventos, com props pequenos (plataforma, versão, etapa).
//
// - installId: id ALEATÓRIO desta instalação (uuid v4 gerado aqui e guardado no SecureStore) — não é id do aparelho;
//   reinstalar gera outro. Antes da conta existir é ele que liga as etapas do cadastro.
// - fila em memória + lote: junta por alguns segundos e manda até 50 de uma vez; manda na hora quando o app vai pro
//   fundo (quem fecha no meio do cadastro é justamente quem o funil precisa ver). Falhou (sem rede, servidor fora)?
//   guarda e tenta de novo com espera crescente. Métrica nunca derruba nem trava nada do app.
import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { AppState, Platform, type NativeEventSubscription } from 'react-native';
import {
  ANALYTICS_LIMITS,
  ONBOARDING_STEPS,
  type AnalyticsBatch,
  type AnalyticsEventInput,
  type AnalyticsEventName,
  type OnboardingStep,
} from '@cruzei/shared-types';
import { BRAND } from '../brand';
import { api } from './api';

const INSTALL_KEY = 'metch.analytics.installId';
/** último dia (São Paulo) em que o app_open saiu */
const OPEN_DAY_KEY = 'metch.analytics.openDay';
/** `${installId}:${userId}` já ligado no servidor (não repete o /link a cada abertura) */
const LINKED_KEY = 'metch.analytics.linked';

/** espera pra juntar eventos num lote só */
export const FLUSH_DELAY_MS = 2_000;
/** fila cheia: sai o mais velho */
export const QUEUE_MAX = 200;
/** a partir disso manda sem esperar */
const FLUSH_NOW_AT = 20;
/** depois de falha: 30 s, 1 min, 2 min… até 10 min */
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 10 * 60_000;

const INSTALL_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

let queue: AnalyticsEventInput[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let sending: Promise<void> | null = null;
let failures = 0;
let installPromise: Promise<string | null> | null = null;
let lastOpenDay: string | null = null;
let appStateSub: NativeEventSubscription | null = null;
/** etapa já registrada nesta abertura (view/done): re-render não vira evento repetido */
const seenSteps = new Set<string>();

// ─── id da instalação ───

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) {
    try {
      c.getRandomValues(out);
      return out;
    } catch {
      /* cai no Math.random */
    }
  }
  for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

/** uuid v4 aleatório (não sai de nada do aparelho) */
export function newInstallId(): string {
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** id anônimo desta instalação (vai no RegisterRequest.installId); null só se nem gerar deu */
export function getInstallId(): Promise<string | null> {
  installPromise ??= (async () => {
    try {
      const saved = await SecureStore.getItemAsync(INSTALL_KEY);
      if (saved && INSTALL_ID_RE.test(saved)) return saved;
    } catch {
      /* sem keystore: gera um que vale só nesta abertura */
    }
    try {
      const id = newInstallId();
      await SecureStore.setItemAsync(INSTALL_KEY, id).catch(() => undefined);
      return id;
    } catch {
      return null;
    }
  })();
  return installPromise;
}

// ─── fila e envio ───

/** dia de São Paulo (UTC-3; o Brasil não tem horário de verão) — o servidor confere de novo */
export function spDay(d: Date): string {
  return new Date(d.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
}

function baseProps(): AnalyticsEventInput['props'] {
  return { platform: Platform.OS, appVersion: Constants.expoConfig?.version ?? BRAND.version };
}

function listenAppState(): void {
  if (appStateSub) return;
  // foi pro fundo: manda o que tem (depois disso o sistema pode matar o app)
  appStateSub = AppState.addEventListener('change', (s) => {
    if (s === 'background' || s === 'inactive') void flush();
  });
}

function schedule(delay: number): void {
  if (timer) {
    if (delay > 0) return;
    clearTimeout(timer);
  }
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, delay);
}

function retryDelay(): number {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, failures - 1));
}

/** 400/403/413/422: o lote não vai melhorar (ou a conta foi bloqueada) — descarta; resto (rede, 5xx, 429, 404) tenta de novo */
function isPermanent(e: unknown): boolean {
  const status = axios.isAxiosError(e) ? e.response?.status : undefined;
  return status === 400 || status === 403 || status === 413 || status === 422;
}

/** manda a fila agora (lotes de até ANALYTICS_LIMITS.batchMax); uma leva por vez */
export function flush(): Promise<void> {
  if (sending) return sending;
  if (!queue.length) return Promise.resolve();
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  sending = (async () => {
    const installId = await getInstallId();
    if (!installId) {
      queue = [];
      return;
    }
    while (queue.length) {
      const batch = queue.splice(0, ANALYTICS_LIMITS.batchMax);
      const body: AnalyticsBatch = { installId, events: batch };
      try {
        await api.post('/analytics/events', body, { timeout: 10_000 });
        failures = 0;
      } catch (e) {
        if (isPermanent(e)) continue;
        // volta pra frente da fila (o que chegou enquanto isso fica depois) e espera
        queue = [...batch, ...queue].slice(-QUEUE_MAX);
        failures++;
        break;
      }
    }
  })()
    .catch(() => undefined)
    .finally(() => {
      sending = null;
      if (queue.length) schedule(failures ? retryDelay() : FLUSH_DELAY_MS);
    });
  return sending;
}

/** registra um evento da lista fechada (ANALYTICS_EVENTS). `step`: etapa (onboarding_step_* exigem; map_tour_* opcional) */
export function track(name: AnalyticsEventName, props?: AnalyticsEventInput['props'], step?: string): void {
  try {
    const ev: AnalyticsEventInput = { name, props: { ...baseProps(), ...props }, at: new Date().toISOString() };
    if (step) ev.step = step;
    queue.push(ev);
    if (queue.length > QUEUE_MAX) queue.splice(0, queue.length - QUEUE_MAX);
    listenAppState();
    // falhando: espera o reenvio agendado, não martela o servidor
    if (!sending && !failures) schedule(queue.length >= FLUSH_NOW_AT ? 0 : FLUSH_DELAY_MS);
    else if (!timer && !sending) schedule(retryDelay());
  } catch {
    /* métrica nunca derruba o app */
  }
}

/** etapa do cadastro vista ('view', ao aparecer) ou concluída ('done', ao avançar/pular) — uma vez por abertura */
export function trackOnboardingStep(step: OnboardingStep, phase: 'view' | 'done'): void {
  const key = `${phase}:${step}`;
  if (seenSteps.has(key)) return;
  seenSteps.add(key);
  track(
    phase === 'view' ? 'onboarding_step_view' : 'onboarding_step_done',
    { stepIndex: ONBOARDING_STEPS.indexOf(step) },
    step,
  );
}

// ─── etapas do funil que não são de uma tela só ───

let lastRoute: string | undefined;
let lastPhase: 'avatar' | 'photo' | null | undefined;
let awaitingMap = false;

/**
 * Antes da conta, pela rota atual do navegador: boas-vindas ('Onboarding') → telefone ('Login') → código ('Code') →
 * cadastro ('Register') ou número reciclado ('ClaimAccount'). Chegar na próxima tela = concluiu a anterior. As etapas
 * do ProfileSetup (nome … prefs) a própria tela registra.
 */
export function trackOnboardingRoute(route: string | undefined): void {
  if (!route || route === lastRoute) return;
  lastRoute = route;
  switch (route) {
    case 'Onboarding':
      trackOnboardingStep('welcome', 'view');
      break;
    case 'Login':
      trackOnboardingStep('welcome', 'done');
      trackOnboardingStep('phone', 'view');
      break;
    case 'Code':
      trackOnboardingStep('phone', 'done');
      trackOnboardingStep('code', 'view');
      break;
    case 'Register':
    case 'ClaimAccount':
      trackOnboardingStep('code', 'done');
      break;
    default:
      break;
  }
}

/**
 * Depois da conta, pela fase do cadastro no store (avatar → foto → fim) e o primeiro mapa pronto em seguida
 * ('map_ready', onde o tour do mapa aparece). Quem só fez login nunca passa por aqui.
 */
export function trackOnboardingPhase(phase: 'avatar' | 'photo' | null, mapReady: boolean): void {
  const prev = lastPhase;
  lastPhase = phase;
  if (phase === 'avatar') trackOnboardingStep('avatar', 'view');
  if (phase === 'photo') {
    if (prev === 'avatar') trackOnboardingStep('avatar', 'done');
    trackOnboardingStep('photo', 'view');
  }
  if (!phase && prev) {
    trackOnboardingStep(prev, 'done');
    awaitingMap = true;
  }
  if (awaitingMap && !phase && mapReady) {
    awaitingMap = false;
    trackOnboardingStep('map_ready', 'view');
    trackOnboardingStep('map_ready', 'done');
  }
}

/**
 * app_open no máximo 1x por dia (São Paulo) por instalação — chamar ao abrir e ao voltar pro app. Vai com a conta
 * quando tem sessão (o Bearer entra sozinho), então chamar DEPOIS de hidratar a sessão. true = registrou.
 */
export async function trackAppOpen(now = new Date()): Promise<boolean> {
  const day = spDay(now);
  if (lastOpenDay === day) return false;
  lastOpenDay = day;
  const saved = await SecureStore.getItemAsync(OPEN_DAY_KEY).catch(() => null);
  if (saved === day) return false;
  await SecureStore.setItemAsync(OPEN_DAY_KEY, day).catch(() => undefined);
  track('app_open');
  return true;
}

/**
 * depois do login/cadastro: liga à conta os eventos anônimos desta instalação (POST /v1/analytics/link). Com `userId`,
 * lembra que já ligou e não repete; falhou, tenta na próxima abertura.
 */
export async function linkInstallToUser(userId?: string): Promise<void> {
  try {
    const installId = await getInstallId();
    if (!installId) return;
    const key = userId ? `${installId}:${userId}` : null;
    if (key && (await SecureStore.getItemAsync(LINKED_KEY).catch(() => null)) === key) return;
    // o que está na fila vai antes (já com a conta)
    await flush();
    await api.post('/analytics/link', { installId }, { timeout: 10_000 });
    if (key) await SecureStore.setItemAsync(LINKED_KEY, key).catch(() => undefined);
  } catch {
    /* tenta na próxima abertura */
  }
}

/** só testes: estado do módulo */
export function __analyticsState() {
  return { queued: queue.length, failures, hasTimer: timer != null, sending: sending != null };
}
