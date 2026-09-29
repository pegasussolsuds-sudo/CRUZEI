// Série diária de 30 dias: uma série só (sem legenda — o título diz o que é), linha 2px + véu 10%,
// linha-guia que acompanha o ponteiro e tabela com os números pra quem não enxerga o gráfico.
import { useMemo } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DailyPoint } from '@cruzei/shared-types';
import { formatCompact, formatDay, formatNumber } from '@/lib/format';
import { fillDays, periodDelta, sumPoints } from '@/lib/stats';
import { useCurrentTheme } from '@/lib/hooks';
import { Delta } from '@/components/Delta';

const MONO = "'JetBrains Mono Variable', ui-monospace, monospace";

interface ChartColors {
  series: string;
  grid: string;
  axis: string;
  cursor: string;
  surface: string;
}

function readColors(): ChartColors {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
  return {
    series: v('--chart-series', '#52a800'),
    grid: v('--chart-grid', 'rgba(255,255,255,0.06)'),
    axis: v('--chart-axis', '#80809a'),
    cursor: v('--chart-cursor', 'rgba(255,255,255,0.28)'),
    surface: v('--surface', '#13132a'),
  };
}

/** só o que o balão usa do Tooltip do recharts (o ponto do dia vem em payload[0].payload) */
interface TooltipBits {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: unknown }>;
}

function ChartTooltip({ active, payload, unit }: TooltipBits & { unit: string }) {
  const point = payload?.[0]?.payload as DailyPoint | undefined;
  if (!active || !point) return null;
  return (
    <div className="chart-tooltip">
      <div className="value">{formatNumber(point.n)}</div>
      <div className="label">
        <span className="chart-key" aria-hidden="true" />
        {unit} · {formatDay(point.day)}
      </div>
    </div>
  );
}

export function TrendChart({ title, points, unit, sumLabel = 'em 30 dias' }: { title: string; points: DailyPoint[]; unit: string; sumLabel?: string }) {
  const theme = useCurrentTheme();
  // relê as cores do tema quando ele troca
  const colors = useMemo(() => readColors(), [theme]);
  const data = useMemo(() => fillDays(points, 30), [points]);
  const total = sumPoints(data);
  const delta = periodDelta(data, 7);
  const last = data.at(-1);
  const gradientId = `wash-${title.replace(/\W/g, '')}`;

  return (
    <figure className="card trend" aria-label={`${title}: ${formatNumber(total)} ${sumLabel}`}>
      <figcaption className="trend-head">
        <div>
          <div className="trend-title">{title}</div>
          <div className="trend-total num">{formatNumber(total)}</div>
          <div className="kpi-sub">
            <span>{sumLabel}</span>
            <Delta ratio={delta.ratio} label="últimos 7 dias contra os 7 anteriores" />
          </div>
        </div>
        {last ? (
          <div className="trend-last">
            <span className="xsmall faint">hoje</span>
            <span className="num strong">{formatNumber(last.n)}</span>
          </div>
        ) : null}
      </figcaption>
      <div className="trend-plot">
        {data.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={colors.series} stopOpacity={0.16} />
                  <stop offset="100%" stopColor={colors.series} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke={colors.grid} strokeWidth={1} />
              <XAxis
                dataKey="day"
                tickFormatter={formatDay}
                tick={{ fill: colors.axis, fontSize: 11, fontFamily: MONO }}
                tickLine={false}
                axisLine={{ stroke: colors.grid }}
                minTickGap={28}
                interval="preserveStartEnd"
              />
              <YAxis
                allowDecimals={false}
                tickFormatter={(n: number) => formatCompact(n)}
                tick={{ fill: colors.axis, fontSize: 11, fontFamily: MONO }}
                tickLine={false}
                axisLine={false}
                width={44}
              />
              <Tooltip
                content={(props) => <ChartTooltip {...props} unit={unit} />}
                cursor={{ stroke: colors.cursor, strokeWidth: 1 }}
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="n"
                stroke={colors.series}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill={`url(#${gradientId})`}
                activeDot={{ r: 4, fill: colors.series, stroke: colors.surface, strokeWidth: 2 }}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="state state-compact small">Sem dados no período.</div>
        )}
      </div>
      <details className="trend-table">
        <summary>Ver números por dia</summary>
        <div className="table-wrap" style={{ maxHeight: 220 }}>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Dia</th>
                <th scope="col" className="right">
                  {unit}
                </th>
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((p) => (
                <tr key={p.day}>
                  <td className="num">{formatDay(p.day)}</td>
                  <td className="num right">{formatNumber(p.n)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
