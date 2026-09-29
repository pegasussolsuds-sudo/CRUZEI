// Eventos: próximos / acontecendo / passados / rascunhos / cancelados.
import { Link, useSearchParams } from 'react-router';
import { CalendarDays, MapPin, Megaphone, Pencil, Plus } from 'lucide-react';
import type { AdminEvent } from '@cruzei/shared-types';
import { adminApi } from '@/api/admin';
import { qk } from '@/api/keys';
import { useCursorQuery } from '@/api/useCursorQuery';
import { EVENT_TABS, eventPhase, type EventTabKey } from '@/lib/events';
import { formatShortDateTime, formatTime, plural } from '@/lib/format';
import { EVENT_CATEGORY_LABEL } from '@/lib/labels';
import { EventPhaseBadge } from '@/components/badges';
import { Badge } from '@/components/ui/Badge';
import { Tabs } from '@/components/ui/Tabs';
import { EmptyState, ErrorState, LoadMore, Skeleton } from '@/components/ui/States';
import { PageHeader } from '@/components/ui/misc';
import { EventActions } from './EventActions';

export default function EventsPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('aba') as EventTabKey | null;
  const tab = EVENT_TABS.find((t) => t.key === raw) ?? EVENT_TABS[0]!;

  const list = useCursorQuery(qk.events(tab.key), (cursor) => adminApi.events({ ...tab.query, cursor }));
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="content">
      <PageHeader
        title="Eventos"
        sub="Publicado vira lugar de evento no mapa até terminar. Cancelado some na hora."
        actions={
          <Link to="/eventos/novo" className="btn btn-primary">
            <Plus size={16} /> Novo evento
          </Link>
        }
      />
      <Tabs<EventTabKey> label="Eventos por momento" value={tab.key} onChange={(k) => setParams(k === 'upcoming' ? {} : { aba: k }, { replace: true })} items={EVENT_TABS.map((t) => ({ key: t.key, label: t.label }))}>
        {list.isPending ? (
          <div className="event-grid">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} height={300} radius={16} />
            ))}
          </div>
        ) : list.isError ? (
          <div className="card">
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          </div>
        ) : !items.length ? (
          <div className="card">
            <EmptyState
              icon={<CalendarDays size={22} />}
              title={tab.empty}
              action={
                tab.key === 'upcoming' || tab.key === 'drafts' ? (
                  <Link to="/eventos/novo" className="btn btn-secondary btn-sm">
                    <Plus size={14} /> Criar evento
                  </Link>
                ) : undefined
              }
            />
          </div>
        ) : (
          <>
            <div className="event-grid">
              {items.map((e) => (
                <EventCard key={e.id} event={e} />
              ))}
            </div>
            <LoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()} />
          </>
        )}
      </Tabs>
    </div>
  );
}

function sameDay(a: string, b: string): boolean {
  const f = (s: string) => new Date(s).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  return f(a) === f(b);
}

function EventCard({ event: e }: { event: AdminEvent }) {
  const phase = eventPhase(e);
  const sent = e.announcements.filter((a) => a.status === 'sent').length;
  const scheduled = e.announcements.filter((a) => a.status === 'scheduled').length;
  return (
    <article className="card event-card" data-phase={phase}>
      <div className="event-cover" style={e.coverUrl ? undefined : { background: 'linear-gradient(135deg, #1d1d45, #0a0a1a 60%, #3a0c2a)' }}>
        {e.coverUrl ? <img src={e.coverUrl} alt="" loading="lazy" /> : <CalendarDays size={32} aria-hidden="true" />}
        <div className="event-cover-badges">
          <EventPhaseBadge phase={phase} />
          <Badge tone="outline">{EVENT_CATEGORY_LABEL[e.category]}</Badge>
        </div>
      </div>
      <div className="card-body stack" style={{ gap: 8 }}>
        <h3 className="event-title">
          <Link to={`/eventos/${e.id}`}>{e.title}</Link>
        </h3>
        <div className="small muted row">
          <CalendarDays size={14} aria-hidden="true" />
          <span>
            {formatShortDateTime(e.startsAt)} → {sameDay(e.startsAt, e.endsAt) ? formatTime(e.endsAt) : formatShortDateTime(e.endsAt)}
          </span>
        </div>
        <div className="small muted row">
          <MapPin size={14} aria-hidden="true" />
          <span className="truncate">{[e.venueName, e.city].filter(Boolean).join(' · ') || 'Local no mapa'}</span>
        </div>
        {sent || scheduled ? (
          <div className="xsmall row faint">
            <Megaphone size={12} aria-hidden="true" />
            {sent ? plural(sent, 'aviso enviado', 'avisos enviados') : ''}
            {sent && scheduled ? ' · ' : ''}
            {scheduled ? plural(scheduled, 'agendado', 'agendados') : ''}
          </div>
        ) : null}
      </div>
      <footer className="card-foot row-wrap">
        <Link to={`/eventos/${e.id}`} className="btn btn-ghost btn-sm">
          <Pencil size={14} /> Editar
        </Link>
        <span className="spacer" />
        <EventActions event={e} afterDelete={() => undefined} />
      </footer>
    </article>
  );
}
