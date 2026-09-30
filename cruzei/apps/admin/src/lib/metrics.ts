// Contas da página Métricas (funções puras; testadas em metrics.test.ts).
import type { AdminFunnelStep } from '@cruzei/shared-types';
import { formatDay } from './format';

/** abaixo disso a queda de uma etapa é ruído (2 de 3 pessoas "desistiram"): só vale se nenhuma etapa tiver isso */
export const MIN_DROP_SAMPLE = 10;

/**
 * Etapa com a maior queda (quem viu e não concluiu). Prefere etapas com amostra mínima; sem nenhuma, olha todas
 * as que alguém viu. Empate: a primeira do funil. null quando ninguém desistiu.
 */
export function biggestDrop(steps: readonly AdminFunnelStep[], minViewed = MIN_DROP_SAMPLE): AdminFunnelStep | null {
  const seen = steps.filter((s) => s.viewed > 0 && s.dropOffPct != null);
  const pool = seen.some((s) => s.viewed >= minViewed) ? seen.filter((s) => s.viewed >= minViewed) : seen;
  let best: AdminFunnelStep | null = null;
  for (const s of pool) {
    if ((s.dropOffPct ?? 0) > (best?.dropOffPct ?? 0)) best = s;
  }
  return best;
}

/** largura da barra (0–1): quem viu a etapa contra a etapa mais vista (normalmente as boas-vindas) */
export function stepShare(viewed: number, steps: readonly AdminFunnelStep[]): number {
  const top = Math.max(0, ...steps.map((s) => s.viewed));
  return top > 0 ? Math.min(1, viewed / top) : 0;
}

/** % de quem viu e seguiu (concluiu) a etapa; null sem ninguém */
export function continueRatio(s: Pick<AdminFunnelStep, 'viewed' | 'done'>): number | null {
  if (s.viewed <= 0) return null;
  return Math.min(1, s.done / s.viewed);
}

/** fração (0–1) ou null quando a base é zero */
export function ratio(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

/**
 * Tom da célula de retenção (escala sequencial de um tom só, do fundo pro verde): 0 = nada, 1–5 = cada vez mais
 * forte. Faixas pensadas pra retenção de app de encontros (D30 de 20% já é bom).
 */
export const HEAT_STEPS = [0, 10, 20, 35, 50] as const;
export function heatLevel(pct: number | null | undefined): 0 | 1 | 2 | 3 | 4 | 5 {
  if (pct == null || !Number.isFinite(pct) || pct <= 0) return 0;
  if (pct <= HEAT_STEPS[1]) return 1;
  if (pct <= HEAT_STEPS[2]) return 2;
  if (pct <= HEAT_STEPS[3]) return 3;
  if (pct <= HEAT_STEPS[4]) return 4;
  return 5;
}

function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) + n * 86_400_000).toISOString().slice(0, 10);
}

/** semana (segunda AAAA-MM-DD) → "21/09 – 27/09" */
export function weekRange(week: string): string {
  return `${formatDay(week)} – ${formatDay(addDays(week, 6))}`;
}

/** % com uma casa quando for fracionário: 33.3 → "33,3%", 50 → "50%" */
export function formatPct(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return '—';
  return `${pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}
