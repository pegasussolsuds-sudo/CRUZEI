// Métricas (só admin): quem usa o app, onde a pessoa desiste do cadastro e quem volta depois de criar a conta.
// Tudo agregado no servidor (nenhuma pessoa aparece aqui), sem localização e sem empresa de fora.
import { useMemo, useState, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, CalendarRange, Repeat, RefreshCw, ShieldCheck, UserCheck, UserPlus, Users } from 'lucide-react';
import {
  ONBOARDING_STEP_LABELS,
  type AdminActive,
  type AdminFunnel,
  type AdminRetention,
  type AdminRetentionCell,
  type DailyPoint,
  type WeeklyPoint,
} from '@cruzei/shared-types';
import { adminApi } from '@/api/admin';
import { qk } from '@/api/keys';
import { formatCompact, formatDay, formatNumber, formatPercent, formatRelative } from '@/lib/format';
import { useCurrentTheme } from '@/lib/hooks';
import { biggestDrop, continueRatio, formatPct, heatLevel, HEAT_STEPS, ratio, stepShare, weekRange } from '@/lib/metrics';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Choice';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { PageHeader } from '@/components/ui/misc';
import '@/styles/metrics.css';

type Period = '7' | '30' | '90';
const PERIODS = [
  { value: '7' as const, label: '7 dias' },
  { value: '30' as const, label: '30 dias' },
  { value: '90' as const, label: '90 dias' },
];
/** grupos de cadastro na retenção (não depende do período: cada grupo precisa de 30 dias pra fechar o D30) */
const RETENTION_WEEKS = 12;
const REFRESH_MS = 5 * 60_000;
const MONO = "'JetBrains Mono Variable', ui-monospace, monospace";

function readColors() {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
  return {
    series: v('--chart-series', '#52a800'),
    grid: v('--chart-grid', 'rgba(255,255,255,0.06)'),
    axis: v('--chart-axis', '#80809a'),
    cursor: v('--chart-cursor', 'rgba(255,255,255,0.28)'),
    surface: v('--surface', '#13132a'),
    band: v('--surface-hover', 'rgba(255,255,255,0.04)'),
  };
}

function Kpi({ icon, label, value, sub }: { icon: ReactNode; label: string; value: string; sub?: ReactNode }) {
  return (
    <div className="card kpi">
      <div className="kpi-label">
        {icon}
        {label}
      </div>
      <div className="kpi-value">{value}</div>
      {sub ? <div className="kpi-sub">{sub}</div> : null}
    </div>
  );
}

export default function MetricsPage() {
  const [period, setPeriod] = useState<Period>('30');
  const days = Number(period);
  const funnel = useQuery({
    queryKey: qk.metricsFunnel(days),
    queryFn: () => adminApi.metricsFunnel(days),
    placeholderData: keepPreviousData,
    refetchInterval: REFRESH_MS,
  });
  const active = useQuery({
    queryKey: qk.metricsActive(days),
    queryFn: () => adminApi.metricsActive(days),
    placeholderData: keepPreviousData,
    refetchInterval: REFRESH_MS,
  });
  const retention = useQuery({
    queryKey: qk.metricsRetention(RETENTION_WEEKS),
    queryFn: () => adminApi.metricsRetention(RETENTION_WEEKS),
    refetchInterval: REFRESH_MS,
  });
  const fetching = funnel.isFetching || active.isFetching || retention.isFetching;
  const updated = [funnel.data?.generatedAt, active.data?.generatedAt, retention.data?.generatedAt].filter(Boolean).sort()[0];

  return (
    <div className="content">
      <PageHeader
        title="Métricas"
        sub={
          <>
            Quem usa, onde desiste do cadastro e quem volta · só números agregados
            {updated ? <> · atualizado {formatRelative(updated)}</> : null}
          </>
        }
        actions={
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw size={14} />}
            loading={fetching}
            onClick={() => {
              void funnel.refetch();
              void active.refetch();
              void retention.refetch();
            }}
          >
            Atualizar
          </Button>
        }
      />

      <div className="metrics-filters">
        <Segmented label="Período" options={PERIODS} value={period} onChange={setPeriod} />
        <span className="metrics-note">
          <CalendarRange size={13} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 4 }} />
          vale pros ativos por dia e pro funil · dias de São Paulo
        </span>
      </div>

      <ActiveSection q={active} />
      <FunnelSection q={funnel} days={days} />
      <RetentionSection q={retention} />

      <p className="metrics-note row" style={{ gap: 6 }}>
        <ShieldCheck size={14} aria-hidden="true" />
        Nenhum evento guarda localização nem conteúdo. Antes da conta, a instalação tem um id aleatório; os eventos somem
        depois de 13 meses.
      </p>
    </div>
  );
}

// ─────────────────────────── ativos ───────────────────────────

function ActiveSection({ q }: { q: { data?: AdminActive; isError: boolean; error: unknown; isPlaceholderData: boolean; isFetching: boolean; refetch: () => unknown } }) {
  const a = q.data;
  const stickiness = a ? ratio(a.dau, a.mau) : null;
  return (
    <section aria-labelledby="m-active" className="stack">
      <h2 id="m-active" className="section-title">
        Uso
      </h2>
      {q.isError && !a ? (
        <div className="card">
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        </div>
      ) : !a ? (
        <div className="kpi-grid">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} height={118} radius={16} />
          ))}
        </div>
      ) : (
        <div className={`stack${q.isPlaceholderData && q.isFetching ? ' metrics-refetching' : ''}`}>
          <div className="kpi-grid">
            <Kpi icon={<UserCheck size={16} />} label="Ativas hoje" value={formatCompact(a.dau)} sub="contas que abriram o app hoje" />
            <Kpi icon={<Users size={16} />} label="Ativas em 7 dias" value={formatCompact(a.wau)} />
            <Kpi icon={<Users size={16} />} label="Ativas em 30 dias" value={formatCompact(a.mau)} />
            <Kpi
              icon={<Repeat size={16} />}
              label="Voltam todo dia"
              value={formatPercent(stickiness)}
              sub="ativas hoje ÷ ativas em 30 dias"
            />
          </div>
          <div className="trend-grid">
            <DailyChart points={a.daily} />
            <WeeklyChart points={a.weekly} />
          </div>
        </div>
      )}
    </section>
  );
}

interface TooltipBits {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: unknown }>;
}

function DailyTooltip({ active, payload }: TooltipBits) {
  const p = payload?.[0]?.payload as DailyPoint | undefined;
  if (!active || !p) return null;
  return (
    <div className="chart-tooltip">
      <div className="value">{formatNumber(p.n)}</div>
      <div className="label">
        <span className="chart-key" aria-hidden="true" />
        ativas · {formatDay(p.day)}
      </div>
    </div>
  );
}

function WeeklyTooltip({ active, payload }: TooltipBits) {
  const p = payload?.[0]?.payload as WeeklyPoint | undefined;
  if (!active || !p) return null;
  return (
    <div className="chart-tooltip">
      <div className="value">{formatNumber(p.n)}</div>
      <div className="label">
        <span className="chart-key" aria-hidden="true" />
        ativas · {weekRange(p.week)}
      </div>
    </div>
  );
}

function DailyChart({ points }: { points: DailyPoint[] }) {
  const theme = useCurrentTheme();
  const colors = useMemo(() => readColors(), [theme]);
  const last = points.at(-1);
  const peak = points.reduce((m, p) => Math.max(m, p.n), 0);
  return (
    <figure className="card trend" aria-label={`Contas ativas por dia: hoje ${formatNumber(last?.n ?? 0)}`}>
      <figcaption className="trend-head">
        <div>
          <div className="trend-title">Ativas por dia</div>
          <div className="trend-total num">{formatNumber(last?.n ?? 0)}</div>
          <div className="kpi-sub">hoje · pico do período {formatNumber(peak)}</div>
        </div>
      </figcaption>
      <div className="trend-plot">
        {points.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="wash-metrics-daily" x1="0" y1="0" x2="0" y2="1">
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
              <Tooltip content={(props) => <DailyTooltip {...props} />} cursor={{ stroke: colors.cursor, strokeWidth: 1 }} isAnimationActive={false} />
              <Area
                type="monotone"
                dataKey="n"
                stroke={colors.series}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="url(#wash-metrics-daily)"
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
      <NumbersTable
        head={['Dia', 'Ativas']}
        rows={[...points].reverse().map((p) => [formatDay(p.day), formatNumber(p.n)])}
      />
    </figure>
  );
}

function WeeklyChart({ points }: { points: WeeklyPoint[] }) {
  const theme = useCurrentTheme();
  const colors = useMemo(() => readColors(), [theme]);
  const last = points.at(-1);
  const prev = points.at(-2);
  return (
    <figure className="card trend" aria-label={`Contas ativas por semana: esta semana ${formatNumber(last?.n ?? 0)}`}>
      <figcaption className="trend-head">
        <div>
          <div className="trend-title">Ativas por semana</div>
          <div className="trend-total num">{formatNumber(last?.n ?? 0)}</div>
          <div className="kpi-sub">
            esta semana (até agora){prev ? <> · anterior {formatNumber(prev.n)}</> : null}
          </div>
        </div>
      </figcaption>
      <div className="trend-plot">
        {points.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke={colors.grid} strokeWidth={1} />
              <XAxis
                dataKey="week"
                tickFormatter={formatDay}
                tick={{ fill: colors.axis, fontSize: 11, fontFamily: MONO }}
                tickLine={false}
                axisLine={{ stroke: colors.grid }}
                minTickGap={16}
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
              <Tooltip content={(props) => <WeeklyTooltip {...props} />} cursor={{ fill: colors.band }} isAnimationActive={false} />
              <Bar dataKey="n" fill={colors.series} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="state state-compact small">Sem dados no período.</div>
        )}
      </div>
      <NumbersTable
        head={['Semana', 'Ativas']}
        rows={[...points].reverse().map((p) => [weekRange(p.week), formatNumber(p.n)])}
      />
    </figure>
  );
}

/** a tabela por trás do gráfico (quem não enxerga o gráfico lê aqui) */
function NumbersTable({ head, rows }: { head: [string, string]; rows: string[][] }) {
  return (
    <details className="trend-table">
      <summary>Ver os números</summary>
      <div className="table-wrap" style={{ maxHeight: 220 }}>
        <table className="table">
          <thead>
            <tr>
              <th scope="col">{head[0]}</th>
              <th scope="col" className="right">
                {head[1]}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <td className="num">{k}</td>
                <td className="num right">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

// ─────────────────────────── funil ───────────────────────────

function FunnelSection({ q, days }: { q: { data?: AdminFunnel; isError: boolean; error: unknown; isPlaceholderData: boolean; isFetching: boolean; refetch: () => unknown }; days: number }) {
  const f = q.data;
  const worst = f ? biggestDrop(f.steps) : null;
  return (
    <section aria-labelledby="m-funnel" className="stack">
      <h2 id="m-funnel" className="section-title">
        Funil do cadastro
      </h2>
      {q.isError && !f ? (
        <div className="card">
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        </div>
      ) : !f ? (
        <Skeleton height={420} radius={16} />
      ) : (
        <div className={`stack${q.isPlaceholderData && q.isFetching ? ' metrics-refetching' : ''}`}>
          <div className="kpi-grid">
            <Kpi icon={<Users size={16} />} label="Abriram o cadastro" value={formatCompact(f.installs)} sub={`instalações nos últimos ${days} dias`} />
            <Kpi icon={<UserPlus size={16} />} label="Contas criadas" value={formatCompact(f.signups)} />
            <Kpi
              icon={<UserCheck size={16} />}
              label="Viraram conta"
              value={formatPercent(ratio(f.signups, f.installs))}
              sub="contas criadas ÷ abriram o cadastro"
            />
          </div>
          {f.installs === 0 && f.steps.every((s) => s.viewed === 0) ? (
            <div className="card">
              <EmptyState
                title="Ainda sem cadastro no período"
                text="Os números aparecem quando o app com as métricas começar a mandar as etapas do cadastro."
              />
            </div>
          ) : (
            <>
              {worst ? (
                <div className="banner banner-warning" role="note">
                  <AlertTriangle size={16} aria-hidden="true" />
                  <span>
                    Maior queda em <strong>{ONBOARDING_STEP_LABELS[worst.step]}</strong>: {formatPct(worst.dropOffPct)} de quem viu
                    essa etapa não seguiu ({formatNumber(worst.viewed - Math.min(worst.done, worst.viewed))} de{' '}
                    {formatNumber(worst.viewed)}).
                  </span>
                </div>
              ) : null}
              <div className="card">
                <div className="table-wrap">
                  <table className="table funnel-table">
                    <caption className="sr-only">Etapas do cadastro: quantas instalações viram, concluíram e desistiram</caption>
                    <thead>
                      <tr>
                        <th scope="col">Etapa</th>
                        <th scope="col" aria-label="Quantas viram, em relação à etapa mais vista" />
                        <th scope="col" className="right">
                          Viram
                        </th>
                        <th scope="col" className="right">
                          Concluíram
                        </th>
                        <th scope="col" className="right">
                          Seguem
                        </th>
                        <th scope="col" className="right">
                          Desistem
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {f.steps.map((s, i) => {
                        const isWorst = worst?.step === s.step;
                        const share = stepShare(s.viewed, f.steps);
                        return (
                          <tr key={s.step} data-worst={isWorst}>
                            <td>
                              <span className="funnel-step">
                                <span className="funnel-index">{i + 1}</span>
                                {ONBOARDING_STEP_LABELS[s.step]}
                                {isWorst ? (
                                  <Badge tone="warning" icon={<AlertTriangle size={12} aria-hidden="true" />}>
                                    maior queda
                                  </Badge>
                                ) : null}
                              </span>
                            </td>
                            <td className="funnel-bar-cell">
                              <div
                                className="funnel-bar"
                                title={`${ONBOARDING_STEP_LABELS[s.step]}: ${formatNumber(s.viewed)} viram (${formatPercent(share)} da etapa mais vista)`}
                              >
                                {s.viewed > 0 ? <span style={{ width: `${Math.max(1, share * 100)}%` }} /> : null}
                              </div>
                            </td>
                            <td className="num right">{formatNumber(s.viewed)}</td>
                            <td className="num right">{formatNumber(s.done)}</td>
                            <td className="num right">{formatPercent(continueRatio(s))}</td>
                            <td className={`num right${isWorst ? ' strong' : ''}`}>{formatPct(s.dropOffPct)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              <p className="metrics-note">
                Conta instalações distintas. Quem só entrou numa conta que já existia (aparelho novo) fica de fora. Etapas
                opcionais (interesses, bio, Instagram) contam como concluídas quando a pessoa pula.
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
}

// ─────────────────────────── retenção ───────────────────────────

function HeatCell({ cell, day, signups }: { cell: AdminRetentionCell | null; day: number; signups: number }) {
  if (signups === 0) {
    return (
      <td className="heat" data-level={0}>
        —
      </td>
    );
  }
  if (!cell) {
    return (
      <td className="heat" data-level={0} data-pending="true" title={`Dia ${day}: o prazo ainda não chegou pra semana inteira`}>
        ainda não
      </td>
    );
  }
  const level = heatLevel(cell.pct);
  return (
    <td
      className="heat"
      data-level={level}
      tabIndex={0}
      title={`Dia ${day}: ${formatNumber(cell.returned)} de ${formatNumber(signups)} voltaram (${formatPct(cell.pct)})`}
    >
      {formatPct(cell.pct)}
      <span className="sub">
        {formatNumber(cell.returned)} de {formatNumber(signups)}
      </span>
    </td>
  );
}

function RetentionSection({ q }: { q: { data?: AdminRetention; isError: boolean; error: unknown; refetch: () => unknown } }) {
  const r = q.data;
  const legend = [
    { level: 0, label: '0%' },
    { level: 1, label: `até ${HEAT_STEPS[1]}%` },
    { level: 2, label: `até ${HEAT_STEPS[2]}%` },
    { level: 3, label: `até ${HEAT_STEPS[3]}%` },
    { level: 4, label: `até ${HEAT_STEPS[4]}%` },
    { level: 5, label: `mais de ${HEAT_STEPS[4]}%` },
  ];
  return (
    <section aria-labelledby="m-retention" className="stack">
      <h2 id="m-retention" className="section-title">
        Quem volta
      </h2>
      <p className="metrics-note" style={{ marginTop: -4 }}>
        Contas criadas em cada semana (segunda a domingo) e quantas abriram o app exatamente 1, 7 e 30 dias depois do
        cadastro. Últimas {RETENTION_WEEKS} semanas, não depende do período acima.
      </p>
      {q.isError && !r ? (
        <div className="card">
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        </div>
      ) : !r ? (
        <Skeleton height={360} radius={16} />
      ) : r.cohorts.every((c) => c.signups === 0) ? (
        <div className="card">
          <EmptyState title="Nenhuma conta criada nessas semanas" />
        </div>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table className="table retention-table">
              <caption className="sr-only">Retenção por semana de cadastro: porcentagem que voltou no dia 1, 7 e 30</caption>
              <thead>
                <tr>
                  <th scope="col">Semana do cadastro</th>
                  <th scope="col" className="right">
                    Contas
                  </th>
                  <th scope="col" style={{ textAlign: 'center' }}>
                    Dia 1
                  </th>
                  <th scope="col" style={{ textAlign: 'center' }}>
                    Dia 7
                  </th>
                  <th scope="col" style={{ textAlign: 'center' }}>
                    Dia 30
                  </th>
                </tr>
              </thead>
              <tbody>
                {r.cohorts.map((c) => (
                  <tr key={c.week}>
                    <td className="num nowrap">{weekRange(c.week)}</td>
                    <td className="num right">{formatNumber(c.signups)}</td>
                    <HeatCell cell={c.d1} day={1} signups={c.signups} />
                    <HeatCell cell={c.d7} day={7} signups={c.signups} />
                    <HeatCell cell={c.d30} day={30} signups={c.signups} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="heat-legend" style={{ padding: 'var(--space-3) var(--space-4)' }} aria-label="Legenda das cores">
            {legend.map((l) => (
              <span key={l.level}>
                <span className="swatch" data-level={l.level} aria-hidden="true" />
                {l.label}
              </span>
            ))}
            <span>· “ainda não” = o dia ainda não chegou pra semana inteira</span>
          </div>
        </div>
      )}
    </section>
  );
}
