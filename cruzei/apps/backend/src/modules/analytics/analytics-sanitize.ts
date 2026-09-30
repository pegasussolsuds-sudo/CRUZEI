import {
  ANALYTICS_EVENTS,
  ANALYTICS_LIMITS,
  ANALYTICS_PROP_KEYS,
  ONBOARDING_STEPS,
  type AnalyticsEventName,
  type AnalyticsPropKey,
} from '@cruzei/shared-types';

// Saneamento dos eventos do app (funções puras, testadas em analytics-sanitize.spec.ts).
// Regra geral: evento ruim é DESCARTADO sozinho, nunca derruba o lote. Posição nunca entra (props só com chaves fixas).

const EVENT_SET = new Set<string>(ANALYTICS_EVENTS);
const STEP_SET = new Set<string>(ONBOARDING_STEPS);
const PROP_SET = new Set<string>(ANALYTICS_PROP_KEYS);

/** texto de props: curto (versão, plataforma…) */
export const PROP_STRING_MAX = 64;
/** passo do tour do mapa (map_tour_*): id curto em snake_case */
const TOUR_STEP = /^[a-z0-9_]{1,40}$/;
/** id da instalação: gerado no app (uuid v4); aceita só letras, números, - e _ */
const INSTALL_ID = new RegExp(`^[A-Za-z0-9_-]{8,${ANALYTICS_LIMITS.installIdMax}}$`);

export type CleanProps = Partial<Record<AnalyticsPropKey, string | number | boolean | null>>;

export interface CleanEvent {
  name: AnalyticsEventName;
  step: string | null;
  props: CleanProps | null;
  at: Date;
}

export function isValidInstallId(v: unknown): v is string {
  return typeof v === 'string' && INSTALL_ID.test(v);
}

/** só as chaves da lista, valores simples; nada sobrando = null; passou de 1 KB = null (o evento fica) */
export function sanitizeProps(raw: unknown): CleanProps | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: CleanProps = {};
  let n = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!PROP_SET.has(k)) continue;
    const key = k as AnalyticsPropKey;
    if (v === null || typeof v === 'boolean') out[key] = v;
    else if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
    else if (typeof v === 'string') out[key] = v.trim().slice(0, PROP_STRING_MAX);
    else continue;
    n++;
  }
  if (!n) return null;
  return Buffer.byteLength(JSON.stringify(out), 'utf8') <= ANALYTICS_LIMITS.propsMaxBytes
    ? out
    : null;
}

/**
 * hora do evento: ausente/inválida = agora; no futuro (relógio do aparelho adiantado) = agora; mais velha que
 * ANALYTICS_LIMITS.maxAgeHours = null (descarta: contaria no dia errado)
 */
export function resolveAt(raw: unknown, now: Date): Date | null {
  if (raw == null || raw === '') return now;
  if (typeof raw !== 'string') return now;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return now;
  if (t > now.getTime()) return now;
  if (now.getTime() - t > ANALYTICS_LIMITS.maxAgeHours * 3_600_000) return null;
  return new Date(t);
}

/**
 * Um evento do lote → evento limpo ou null (descartado): nome fora da lista, etapa do cadastro desconhecida,
 * `signup_done` vindo do app (quem grava é o servidor, no cadastro) ou hora velha demais.
 */
export function sanitizeEvent(raw: unknown, now: Date): CleanEvent | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== 'string' || !EVENT_SET.has(r.name)) return null;
  const name = r.name as AnalyticsEventName;
  if (name === 'signup_done') return null;
  let step: string | null = null;
  if (name === 'onboarding_step_view' || name === 'onboarding_step_done') {
    if (typeof r.step !== 'string' || !STEP_SET.has(r.step)) return null;
    step = r.step;
  } else if (name === 'map_tour_done' || name === 'map_tour_skipped') {
    step = typeof r.step === 'string' && TOUR_STEP.test(r.step) ? r.step : null;
  }
  const at = resolveAt(r.at, now);
  if (!at) return null;
  return { name, step, props: sanitizeProps(r.props), at };
}

// ─── quem pode gravar o quê (o installId é livre: sem conta, qualquer um inventa um) ───

/** sem conta: POSTs por minuto por IP (com conta vale o teto por conta da rota) */
export const ANON_EVENTS_PER_MINUTE = 20;
/** instalações NOVAS (as que mandam o 1º passo pela primeira vez) por IP por dia */
export const NEW_INSTALLS_PER_IP_DAY = 20;
/** 1º passo do funil: a instalação só vale pras métricas depois de mandar ele */
export const FIRST_STEP = ONBOARDING_STEPS[0];

/** sem conta só entra o funil do cadastro e o app_open (o tour do mapa e o resto são de quem já tem conta) */
const ANON_EVENTS = new Set<AnalyticsEventName>([
  'app_open',
  'onboarding_step_view',
  'onboarding_step_done',
]);

export function isFirstStep(e: CleanEvent): boolean {
  return (
    (e.name === 'onboarding_step_view' || e.name === 'onboarding_step_done') &&
    e.step === FIRST_STEP
  );
}

/** o que a conta (ou a falta dela) pode mandar */
export function allowedEvents(events: CleanEvent[], hasAccount: boolean): CleanEvent[] {
  return hasAccount ? events : events.filter((e) => ANON_EVENTS.has(e.name));
}

/**
 * instalação que o banco ainda não viu mandar o 1º passo: o lote só entra se trouxer o 1º passo agora; senão é
 * ignorado — menos o app_open de quem tem conta (conta antiga que atualizou o app nunca passa pelas boas-vindas)
 */
export function gateUnstarted(events: CleanEvent[], hasAccount: boolean): CleanEvent[] {
  if (events.some(isFirstStep)) return events;
  return hasAccount ? events.filter((e) => e.name === 'app_open') : [];
}

/** dia de São Paulo (AAAA-MM-DD) de um instante — o Brasil não tem horário de verão desde 2019, mas o Intl cobre */
const SP_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
export function spDay(d: Date): string {
  return SP_DAY.format(d);
}

/**
 * lote inteiro: saneia e tira app_open repetido no mesmo dia de São Paulo (o app já segura 1x/dia; isto cobre
 * fila reenviada). O banco confere de novo contra o que já foi gravado.
 */
export function sanitizeBatch(raw: readonly unknown[], now: Date): CleanEvent[] {
  const out: CleanEvent[] = [];
  const openDays = new Set<string>();
  for (const r of raw.slice(0, ANALYTICS_LIMITS.batchMax)) {
    const e = sanitizeEvent(r, now);
    if (!e) continue;
    if (e.name === 'app_open') {
      const day = spDay(e.at);
      if (openDays.has(day)) continue;
      openDays.add(day);
    }
    out.push(e);
  }
  return out;
}
