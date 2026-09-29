// Painel: números do dia, 30 dias em gráfico e atalhos pras filas que pedem gente.
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarDays,
  ChevronRight,
  Clock,
  EyeOff,
  Flag,
  Headphones,
  Heart,
  ImageOff,
  MapPinPlus,
  MessageCircle,
  RefreshCw,
  ShieldAlert,
  Smartphone,
  Sparkles,
  UserCheck,
  UserPlus,
  Users,
  Zap,
} from 'lucide-react';
import type { AdminPermission, AdminStats } from '@cruzei/shared-types';
import { adminApi } from '@/api/admin';
import { qk } from '@/api/keys';
import { useMe } from '@/auth/AuthProvider';
import { formatCompact, formatMinutes, formatNumber, formatRelative } from '@/lib/format';
import { hasPermission } from '@/lib/permissions';
import { TrendChart } from '@/components/charts/TrendChart';
import { Button } from '@/components/ui/Button';
import { ErrorState, Skeleton } from '@/components/ui/States';
import { PageHeader } from '@/components/ui/misc';

function Kpi({ icon, label, value, sub, tone }: { icon: ReactNode; label: string; value: string; sub?: ReactNode; tone?: 'premium' | 'gold' | 'danger' }) {
  return (
    <div className={`card kpi${tone ? ` kpi-${tone}` : ''}`}>
      <div className="kpi-label">
        {icon}
        {label}
      </div>
      <div className="kpi-value">{value}</div>
      {sub ? <div className="kpi-sub">{sub}</div> : null}
    </div>
  );
}

interface QueueShortcut {
  key: string;
  label: string;
  hint: string;
  count: number;
  to: string;
  icon: ReactNode;
  perm: AdminPermission;
  urgent?: boolean;
}

function queues(s: AdminStats): QueueShortcut[] {
  return [
    { key: 'reports', label: 'Denúncias', hint: 'denúncias esperando decisão', count: s.moderation.reportsPending, to: '/moderacao', icon: <Flag size={18} />, perm: 'users.moderate', urgent: true },
    { key: 'photos', label: 'Fotos em análise', hint: 'a análise automática pediu olho humano', count: s.moderation.photosPending, to: '/moderacao?aba=fotos', icon: <ImageOff size={18} />, perm: 'users.moderate' },
    { key: 'hold', label: 'Contas em revisão', hint: 'seguradas até alguém olhar', count: s.moderation.reviewHold, to: '/moderacao', icon: <ShieldAlert size={18} />, perm: 'users.moderate' },
    { key: 'candidates', label: 'Sugestões de lugar', hint: '"Pôr no Metch" da galera', count: s.places.candidatesPending, to: '/lugares', icon: <MapPinPlus size={18} />, perm: 'places' },
    { key: 'poiReports', label: 'Denúncias de lugar', hint: 'fechou, não existe, perigoso…', count: s.places.poiReportsPending, to: '/lugares?aba=denuncias', icon: <Flag size={18} />, perm: 'places' },
    { key: 'support', label: 'Suporte esperando', hint: `${s.support.unassigned} sem ninguém atribuído`, count: s.support.waitingStaff, to: '/suporte', icon: <Headphones size={18} />, perm: 'support', urgent: true },
  ];
}

export default function DashboardPage() {
  const me = useMe();
  const stats = useQuery({ queryKey: qk.stats, queryFn: adminApi.stats, refetchInterval: 60_000 });
  const s = stats.data;

  return (
    <div className="content">
      <PageHeader
        title={`Oi, ${me.name.split(' ')[0] ?? me.name}`}
        tabTitle="Painel"
        sub={s ? `Números de agora · atualizado ${formatRelative(s.generatedAt)}` : 'Como o Metch está agora'}
        actions={
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} loading={stats.isFetching} onClick={() => void stats.refetch()}>
            Atualizar
          </Button>
        }
      />

      {stats.isError && !s ? (
        <div className="card">
          <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />
        </div>
      ) : !s ? (
        <DashboardSkeleton />
      ) : (
        <>
          <section aria-labelledby="dash-queues" className="stack">
            <h2 id="dash-queues" className="section-title">
              Pede atenção
            </h2>
            <div className="queue-grid">
              {queues(s)
                .filter((q) => hasPermission(me, q.perm))
                .map((q) => (
                  <Link key={q.key} to={q.to} className="card card-interactive queue-card" data-hot={q.count > 0} data-urgent={q.urgent && q.count > 0}>
                    <span className="queue-icon" aria-hidden="true">
                      {q.icon}
                    </span>
                    <span className="grow">
                      <span className="queue-label">{q.label}</span>
                      <span className="queue-hint">{q.hint}</span>
                    </span>
                    <span className="queue-count num">{formatNumber(q.count)}</span>
                    <ChevronRight size={16} className="faint" aria-hidden="true" />
                  </Link>
                ))}
            </div>
          </section>

          <section aria-labelledby="dash-people" className="stack">
            <h2 id="dash-people" className="section-title">
              Pessoas
            </h2>
            <div className="kpi-grid">
              <Kpi
                icon={<Users size={16} />}
                label="Contas"
                value={formatCompact(s.users.total)}
                sub={
                  <>
                    <span className="text-accent strong num">+{formatNumber(s.users.new24h)}</span> em 24 h ·{' '}
                    <span className="num">+{formatNumber(s.users.new7d)}</span> em 7 dias
                  </>
                }
              />
              <Kpi
                icon={<UserCheck size={16} />}
                label="Ativas em 24 h"
                value={formatCompact(s.users.active24h)}
                sub={
                  <>
                    <span className="num">{formatNumber(s.users.active7d)}</span> em 7 dias
                  </>
                }
              />
              <Kpi
                icon={<Sparkles size={16} className="text-premium" />}
                label="Premium"
                tone="premium"
                value={formatCompact(s.users.premium + s.users.premiumPlus)}
                sub={
                  <>
                    <span className="num">{formatNumber(s.users.premiumPlus)}</span> no Premium+
                  </>
                }
              />
              <Kpi icon={<EyeOff size={16} />} label="No modo anônimo agora" value={formatCompact(s.users.anonymousNow)} />
              <Kpi
                icon={<ShieldAlert size={16} />}
                label="Suspensas / banidas"
                value={`${formatNumber(s.users.suspended)} / ${formatNumber(s.users.banned)}`}
              />
            </div>
          </section>

          <section aria-labelledby="dash-activity" className="stack">
            <h2 id="dash-activity" className="section-title">
              Últimas 24 horas
            </h2>
            <div className="kpi-grid">
              <Kpi icon={<MessageCircle size={16} />} label="Mensagens" value={formatCompact(s.activity.messages24h)} />
              <Kpi icon={<Heart size={16} />} label="Curtidas" value={formatCompact(s.activity.likes24h)} />
              <Kpi icon={<Zap size={16} className="text-gold" />} label="Curtidas mútuas" tone="gold" value={formatCompact(s.activity.mutualLikes24h)} />
              <Kpi icon={<UserPlus size={16} />} label="Conversas novas" value={formatCompact(s.activity.conversationsNew24h)} />
            </div>
          </section>

          <section aria-labelledby="dash-trends" className="stack">
            <h2 id="dash-trends" className="section-title">
              30 dias
            </h2>
            <div className="trend-grid">
              <TrendChart title="Cadastros" unit="cadastros" points={s.series.signups} />
              <TrendChart title="Pessoas ativas" unit="pessoas ativas" points={s.series.activeUsers} sumLabel="soma dos dias" />
              <TrendChart title="Mensagens" unit="mensagens" points={s.series.messages} />
              <TrendChart title="Curtidas" unit="curtidas" points={s.series.likes} />
            </div>
          </section>

          <section aria-labelledby="dash-ops" className="stack">
            <h2 id="dash-ops" className="section-title">
              Operação
            </h2>
            <div className="kpi-grid">
              {hasPermission(me, 'support') ? (
                <>
                  <Kpi
                    icon={<Headphones size={16} />}
                    label="Suporte aberto"
                    value={formatNumber(s.support.open)}
                    sub={
                      <>
                        <span className="num">{formatNumber(s.support.unassigned)}</span> sem atribuição
                      </>
                    }
                  />
                  <Kpi icon={<Clock size={16} />} label="1ª resposta (média 7 dias)" value={formatMinutes(s.support.avgFirstResponseMin7d)} />
                </>
              ) : null}
              {hasPermission(me, 'events') ? (
                <Link to="/eventos" className="card card-interactive kpi" style={{ textDecoration: 'none', color: 'inherit' }}>
                  <div className="kpi-label">
                    <CalendarDays size={16} />
                    Eventos
                  </div>
                  <div className="kpi-value">{formatNumber(s.places.eventsLive)}</div>
                  <div className="kpi-sub">
                    acontecendo · <span className="num">{formatNumber(s.places.eventsUpcoming)}</span> pela frente
                  </div>
                </Link>
              ) : null}
              <Kpi
                icon={<Smartphone size={16} />}
                label="Aparelhos com push"
                value={formatCompact(s.push.devices)}
                sub={
                  <>
                    <span className="num">{formatNumber(s.push.campaignsSent7d)}</span> campanhas em 7 dias
                  </>
                }
              />
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="stack-lg" role="status" aria-label="Carregando números">
      <div className="queue-grid">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} height={72} radius={16} />
        ))}
      </div>
      <div className="kpi-grid">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} height={118} radius={16} />
        ))}
      </div>
      <div className="trend-grid">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} height={300} radius={16} />
        ))}
      </div>
    </div>
  );
}
