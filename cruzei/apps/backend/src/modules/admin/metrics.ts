import {
  ONBOARDING_STEPS,
  type AdminFunnelStep,
  type AdminRetentionCell,
  type OnboardingStep,
} from '@cruzei/shared-types';

// Contas do painel de Métricas (funções puras, testadas em metrics.spec.ts). As consultas ficam no MetricsService.

/** número da query string dentro da faixa; ausente/inválido = padrão */
export function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  const n =
    typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** % com uma casa (0–100) */
export function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10;
}

/** % de quem viu a etapa e não concluiu; null sem ninguém. Concluiu > viu (evento de "ver" perdido) = 0 */
export function dropOffPct(viewed: number, done: number): number | null {
  if (viewed <= 0) return null;
  return pct(Math.max(0, viewed - done), viewed);
}

/** linhas do banco (só as etapas com evento) → todas as etapas, na ordem do funil */
export function funnelSteps(
  rows: readonly { step: string; viewed: number; done: number }[],
): AdminFunnelStep[] {
  const by = new Map(rows.map((r) => [r.step, r]));
  return ONBOARDING_STEPS.map((step: OnboardingStep) => {
    const r = by.get(step);
    const viewed = r?.viewed ?? 0;
    const done = r?.done ?? 0;
    return { step, viewed, done, dropOffPct: dropOffPct(viewed, done) };
  });
}

/** 'AAAA-MM-DD' + n dias, sem fuso (conta de calendário) */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) + n * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/**
 * O "dia N" já terminou pra TODO mundo do grupo? O último do grupo nasceu no domingo (segunda + 6); o dia N dele é
 * segunda + 6 + N, e só conta quando esse dia já passou (hoje, em São Paulo, é depois dele).
 */
export function cohortReady(week: string, n: number, today: string): boolean {
  return addDays(week, 6 + n) < today;
}

/** célula da retenção: null enquanto o prazo não chegou pro grupo inteiro */
export function retentionCell(
  signups: number,
  returned: number,
  ready: boolean,
): AdminRetentionCell | null {
  if (!ready) return null;
  return { returned, pct: pct(returned, signups) };
}
