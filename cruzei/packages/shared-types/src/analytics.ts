// Métricas próprias (sem empresa de fora: nada de Google/Firebase Analytics). Tabela analytics_events no nosso Postgres.
// Regras: lista FECHADA de eventos (CHECK analytics_events_name_chk no banco — mudar os dois juntos), nunca localização,
// retenção de ANALYTICS_RETENTION_MONTHS com limpeza. Antes da conta existir vale o installId (id anônimo da
// instalação, gerado no app e guardado no aparelho); no cadastro (RegisterRequest.installId) ou no login
// (POST /v1/analytics/link) os eventos daquela instalação ganham o user_id.
import type { DailyPoint } from './admin';

/**
 * - app_open: 1x por dia por aparelho (o app segura; o servidor conta distinto por dia de São Paulo)
 * - onboarding_step_view / onboarding_step_done: etapa do cadastro vista / concluída (step obrigatório)
 * - signup_done: conta criada (o servidor grava no POST /auth/register quando vem installId)
 * - map_tour_done / map_tour_skipped: tour do mapa terminado / pulado (step = último passo visto, opcional)
 */
export const ANALYTICS_EVENTS = [
  'app_open',
  'onboarding_step_view',
  'onboarding_step_done',
  'signup_done',
  'map_tour_done',
  'map_tour_skipped',
] as const;
export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];

/**
 * Etapas do cadastro, na ordem do funil (o painel mostra nessa ordem). Antes da conta: welcome → phone → code → as
 * etapas do ProfileSetup (name … prefs; o POST /auth/register sai no fim de 'prefs', que tem o aceite dos Termos).
 * Depois da conta: avatar → photo → map_ready (primeiro mapa pronto; é aí que o tour do mapa aparece).
 * 'show_me' = "Quem você quer ver?"; interests, bio e instagram são opcionais (pular conta como done).
 */
export const ONBOARDING_STEPS = [
  'welcome',
  'phone',
  'code',
  'name',
  'birth',
  'gender',
  'show_me',
  'orientation',
  'looking',
  'interests',
  'bio',
  'instagram',
  'prefs',
  'avatar',
  'photo',
  'map_ready',
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const ONBOARDING_STEP_LABELS: Record<OnboardingStep, string> = {
  welcome: 'Boas-vindas',
  phone: 'Telefone',
  code: 'Código do SMS',
  name: 'Nome',
  birth: 'Nascimento',
  gender: 'Gênero',
  show_me: 'Quem quer ver',
  orientation: 'Orientação',
  looking: 'O que procura',
  interests: 'Interesses',
  bio: 'Bio',
  instagram: 'Instagram',
  prefs: 'Como aparecer + Termos',
  avatar: 'Avatar',
  photo: 'Fotos',
  map_ready: 'Primeiro mapa',
};

/** chaves aceitas em props (o servidor descarta o resto; posição NUNCA) */
export const ANALYTICS_PROP_KEYS = ['platform', 'appVersion', 'osVersion', 'durationMs', 'skipped', 'stepIndex'] as const;
export type AnalyticsPropKey = (typeof ANALYTICS_PROP_KEYS)[number];

export const ANALYTICS_LIMITS = {
  /** eventos por POST */
  batchMax: 50,
  /** tamanho do installId */
  installIdMax: 64,
  /** props serializado (bytes) */
  propsMaxBytes: 1024,
  /** POSTs por minuto por aparelho/IP */
  perMinute: 30,
  /** o servidor ignora `at` mais velho que isso (h) e usa a hora do recebimento se vier no futuro */
  maxAgeHours: 72,
} as const;

/** apaga eventos mais velhos que isso */
export const ANALYTICS_RETENTION_MONTHS = 13;

export interface AnalyticsEventInput {
  name: AnalyticsEventName;
  /** obrigatório nos onboarding_step_* (ONBOARDING_STEPS); opcional nos map_tour_* */
  step?: OnboardingStep | string;
  props?: Partial<Record<AnalyticsPropKey, string | number | boolean | null>>;
  /** quando aconteceu no aparelho (ISO); ausente = hora do recebimento */
  at?: string;
}

/**
 * POST /v1/analytics/events (login OPCIONAL: com Bearer válido o servidor grava o user_id; sem, só o installId) →
 * AnalyticsBatchResult. Até ANALYTICS_LIMITS.batchMax eventos; nome fora da lista, etapa desconhecida ou props demais
 * são descartados (não derrubam o lote). Throttle de ANALYTICS_LIMITS.perMinute por instalação. Sem conta: só
 * onboarding_* e app_open, teto menor por IP e limite de instalações novas por IP por dia (429 = tenta mais tarde).
 * Instalação que nunca mandou o 1º passo (ONBOARDING_STEPS[0]) tem o lote ignorado, menos o app_open com conta.
 */
export interface AnalyticsBatch {
  installId: string;
  events: AnalyticsEventInput[];
}

export interface AnalyticsBatchResult {
  accepted: number;
}

/**
 * POST /v1/analytics/link {installId} (logado) → 204: liga à MINHA conta os eventos anônimos (user_id null) das
 * últimas 24 h desta instalação — nada se ela já tem evento de OUTRA conta. O cadastro já faz isso sozinho com
 * RegisterRequest.installId (mesmas regras); o app chama no login.
 */
export interface AnalyticsLinkRequest {
  installId: string;
}

// ─────────────────────────── painel (só admin: permissão 'metrics') ───────────────────────────

/** uma etapa do funil: instalações distintas que viram / concluíram (no período) */
export interface AdminFunnelStep {
  step: OnboardingStep;
  viewed: number;
  done: number;
  /** % de quem viu e não concluiu esta etapa (onde desiste); null quando ninguém viu */
  dropOffPct: number | null;
}

/** GET /v1/admin/metrics/funnel?days=30 (1–90; padrão 30) */
export interface AdminFunnel {
  /** período (ISO) */
  from: string;
  to: string;
  /** instalações que abriram o cadastro (viram 'welcome') */
  installs: number;
  /** contas criadas no período (signup_done) */
  signups: number;
  /** na ordem de ONBOARDING_STEPS */
  steps: AdminFunnelStep[];
  generatedAt: string;
}

/** volta no dia N: quantas contas do grupo abriram o app nesse dia e a % do grupo */
export interface AdminRetentionCell {
  returned: number;
  pct: number;
}

/**
 * grupo = contas criadas na semana (segunda a domingo, fuso de São Paulo). D1/D7/D30 = abriu o app (app_open ou
 * access_logs) EXATAMENTE no dia 1/7/30 depois do dia do cadastro (dia de São Paulo). null = o prazo ainda não
 * chegou pra semana inteira.
 */
export interface AdminRetentionCohort {
  /** segunda-feira da semana (AAAA-MM-DD) */
  week: string;
  signups: number;
  d1: AdminRetentionCell | null;
  d7: AdminRetentionCell | null;
  d30: AdminRetentionCell | null;
}

/** GET /v1/admin/metrics/retention?weeks=12 (1–52; padrão 12), semana mais recente primeiro */
export interface AdminRetention {
  cohorts: AdminRetentionCohort[];
  generatedAt: string;
}

export interface WeeklyPoint {
  /** segunda-feira da semana (AAAA-MM-DD, São Paulo) */
  week: string;
  n: number;
}

/** GET /v1/admin/metrics/active?days=30 (7–90; padrão 30) — contas distintas que abriram o app */
export interface AdminActive {
  /** ativos por dia (São Paulo) */
  daily: DailyPoint[];
  /** ativos por semana (últimas 12) */
  weekly: WeeklyPoint[];
  /** hoje, últimos 7 e últimos 30 dias */
  dau: number;
  wau: number;
  mau: number;
  generatedAt: string;
}
