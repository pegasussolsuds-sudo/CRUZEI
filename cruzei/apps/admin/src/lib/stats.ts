// Séries diárias do painel (30 dias, dia de São Paulo).
import type { DailyPoint } from '@cruzei/shared-types';

function addDaysToDay(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const t = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) + delta * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** completa os dias sem registro com 0 (o gráfico não pode "pular" dia) terminando em endDay (padrão: último da série) */
export function fillDays(points: readonly DailyPoint[], days = 30, endDay?: string): DailyPoint[] {
  const last = endDay ?? [...points].map((p) => p.day).sort().at(-1);
  if (!last) return [];
  const byDay = new Map(points.map((p) => [p.day, p.n]));
  const out: DailyPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = addDaysToDay(last, -i);
    out.push({ day, n: byDay.get(day) ?? 0 });
  }
  return out;
}

export function sumPoints(points: readonly DailyPoint[]): number {
  return points.reduce((acc, p) => acc + p.n, 0);
}

/** abaixo disso a porcentagem engana ("+3.500%" com 1 contra 36): não mostra variação */
export const MIN_DELTA_BASE = 10;

/** soma dos últimos n dias contra os n anteriores; ratio null quando a base é pequena demais pra comparar */
export function periodDelta(points: readonly DailyPoint[], n = 7): { current: number; previous: number; ratio: number | null } {
  const sorted = [...points].sort((a, b) => a.day.localeCompare(b.day));
  const current = sumPoints(sorted.slice(-n));
  const previous = sumPoints(sorted.slice(-2 * n, -n));
  return { current, previous, ratio: previous >= MIN_DELTA_BASE ? (current - previous) / previous : null };
}

export function average(points: readonly DailyPoint[]): number {
  return points.length ? sumPoints(points) / points.length : 0;
}
