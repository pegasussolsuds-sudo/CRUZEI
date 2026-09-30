// Moderação: fila de denúncias (agrupadas por pessoa, mais urgente primeiro) e fotos em análise.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Ban, BellRing, CheckCheck, ChevronRight, Flag, ImageOff, PauseCircle, RefreshCw, ShieldCheck, ShieldOff } from 'lucide-react';
import type { ModerationDecision, ModerationReportGroup } from '@cruzei/shared-types';
import { adminApi } from '@/api/admin';
import { qk } from '@/api/keys';
import { useMe } from '@/auth/AuthProvider';
import { formatRelative, formatShortDateTime } from '@/lib/format';
import { canModerateAccount } from '@/lib/permissions';
import { REPORT_REASON_LABEL, REPORT_SOURCE_LABEL, URGENT_REASONS } from '@/lib/labels';
import { AccountStatusBadge } from '@/components/badges';
import { ModerationActionDialog } from '@/components/moderation/ModerationActionDialog';
import { PhotoDecisionButtons } from '@/components/moderation/PhotoDecision';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Tabs } from '@/components/ui/Tabs';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { PageHeader } from '@/components/ui/misc';

type Tab = 'denuncias' | 'fotos';

export default function ModerationPage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('aba') === 'fotos' ? 'fotos' : 'denuncias';
  const queue = useQuery({ queryKey: qk.queue, queryFn: adminApi.queue, refetchInterval: 60_000 });
  const [acting, setActing] = useState<{ group: ModerationReportGroup; action: ModerationDecision } | null>(null);

  const reports = queue.data?.reports ?? [];
  const photos = queue.data?.photos ?? [];

  return (
    <div className="content">
      <PageHeader
        title="Moderação"
        sub="Decisões aqui valem na hora no app. Na dúvida, abra a ficha completa."
        actions={
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} loading={queue.isFetching} onClick={() => void queue.refetch()}>
            Atualizar
          </Button>
        }
      />

      <Tabs<Tab>
        label="Filas de moderação"
        value={tab}
        onChange={(k) => setParams(k === 'fotos' ? { aba: 'fotos' } : {}, { replace: true })}
        items={[
          { key: 'denuncias', label: 'Denúncias', count: queue.data ? reports.length : null, icon: <Flag size={16} /> },
          { key: 'fotos', label: 'Fotos em análise', count: queue.data ? photos.length : null, icon: <ImageOff size={16} /> },
        ]}
      >
        {queue.isPending ? (
          <div className="stack">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} height={180} radius={16} />
            ))}
          </div>
        ) : queue.isError ? (
          <div className="card">
            <ErrorState error={queue.error} onRetry={() => void queue.refetch()} />
          </div>
        ) : tab === 'denuncias' ? (
          !reports.length ? (
            <div className="card">
              <EmptyState icon={<ShieldCheck size={22} />} title="Fila zerada" text="Nenhuma denúncia esperando. A galera está se comportando." />
            </div>
          ) : (
            <div className="stack">
              {reports.map((g) => (
                <ReportGroupCard key={g.user.id} group={g} onAct={(action) => setActing({ group: g, action })} />
              ))}
            </div>
          )
        ) : !photos.length ? (
          <div className="card">
            <EmptyState icon={<ImageOff size={22} />} title="Nenhuma foto esperando" text="Quando a análise automática ficar em dúvida, a foto aparece aqui." />
          </div>
        ) : (
          <div className="mod-photo-grid">
            {photos.map((p) => (
              <article key={p.id} className="card mod-photo">
                <a className="thumb mod-photo-img" href={p.url} target="_blank" rel="noreferrer noopener" aria-label={`Abrir foto de ${p.userName} em tamanho real`}>
                  <img src={p.url} alt={`Foto em análise de ${p.userName}`} loading="lazy" />
                </a>
                <div className="card-body stack" style={{ gap: 10 }}>
                  <div className="row">
                    <Link to={`/usuarios/${p.userId}`} className="strong truncate">
                      {p.userName}
                    </Link>
                    <span className="spacer" />
                    <span className="xsmall faint">{formatRelative(p.createdAt)}</span>
                  </div>
                  {p.labels.length ? (
                    <div className="row row-wrap" style={{ gap: 6 }}>
                      {p.labels.map((l) => (
                        <Badge key={l} tone="warning">
                          {l}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <span className="xsmall faint">Sem rótulos da análise automática.</span>
                  )}
                  <PhotoDecisionButtons photoId={p.id} userId={p.userId} compact />
                </div>
              </article>
            ))}
          </div>
        )}
      </Tabs>

      {acting ? <ModerationActionDialog open onClose={() => setActing(null)} action={acting.action} user={acting.group.user} /> : null}
    </div>
  );
}

function ReportGroupCard({ group, onAct }: { group: ModerationReportGroup; onAct: (a: ModerationDecision) => void }) {
  const me = useMe();
  const u = group.user;
  const urgent = group.reports.some((r) => URGENT_REASONS.has(r.reason));
  // mesma regra da ficha (e do servidor): conta da equipe só admin modera; a própria, ninguém
  const canModerate = canModerateAccount(me, u);
  return (
    <article className="card report-group" data-urgent={urgent}>
      <header className="report-group-head">
        <Avatar name={u.name} url={u.mainPhotoUrl} size={56} />
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="row row-wrap">
            <Link to={`/usuarios/${u.id}`} className="strong report-name">
              {u.name}, {u.age}
            </Link>
            <AccountStatusBadge status={u.accountStatus} until={u.suspendedUntil} />
            {u.reviewHoldAt ? <Badge tone="warning">Em revisão</Badge> : null}
            {urgent ? <Badge tone="danger">Urgente</Badge> : null}
          </div>
          <div className="small muted">
            {group.reports.length} {group.reports.length === 1 ? 'denúncia' : 'denúncias'}{' '}
            {/* denúncia sem denunciante = automática (ex.: GPS suspeito); não conta como pessoa */}
            {group.distinctReporters === 0 && group.reports.every((r) => !r.reporterId)
              ? group.reports.length === 1
                ? 'automática'
                : 'automáticas'
              : `de ${group.distinctReporters} ${group.distinctReporters === 1 ? 'pessoa' : 'pessoas'}`}{' '}
            · primeira {formatRelative(group.firstAt)} · prioridade{' '}
            <span className="num strong">{group.priority}</span>
          </div>
        </div>
        <Link to={`/usuarios/${u.id}`} className="btn btn-ghost btn-sm">
          Ficha completa <ChevronRight size={14} />
        </Link>
      </header>
      <ul className="list report-list">
        {group.reports.map((r) => (
          <li key={r.id} className="report-item">
            <div className="row row-wrap">
              <Badge tone={URGENT_REASONS.has(r.reason) ? 'danger' : 'warning'}>{REPORT_REASON_LABEL[r.reason]}</Badge>
              {r.context?.source ? <span className="xsmall faint">pelo {REPORT_SOURCE_LABEL[r.context.source]}</span> : null}
              {!r.reporterId ? <span className="xsmall faint">· automática</span> : null}
              <span className="spacer" />
              <span className="xsmall faint">{formatShortDateTime(r.createdAt)}</span>
            </div>
            {r.description ? <p className="small pre-wrap">{r.description}</p> : null}
          </li>
        ))}
      </ul>
      <footer className="card-foot row-wrap">
        {canModerate ? (
          <>
            <Button size="sm" icon={<CheckCheck size={14} />} onClick={() => onAct('dismiss')}>
              Dispensar
            </Button>
            <Button size="sm" icon={<BellRing size={14} />} onClick={() => onAct('warn')}>
              Avisar
            </Button>
            {u.accountStatus === 'active' ? (
              <Button size="sm" variant="danger-soft" icon={<PauseCircle size={14} />} onClick={() => onAct('suspend')}>
                Suspender
              </Button>
            ) : null}
            {u.accountStatus !== 'banned' ? (
              <Button size="sm" variant="danger-soft" icon={<Ban size={14} />} onClick={() => onAct('ban')}>
                Banir
              </Button>
            ) : null}
          </>
        ) : (
          <span className="small faint row">
            <ShieldOff size={14} /> {me.id === u.id ? 'Denúncia contra a sua conta: outra pessoa da equipe decide.' : 'Conta da equipe: só um admin decide.'}
          </span>
        )}
      </footer>
    </article>
  );
}
