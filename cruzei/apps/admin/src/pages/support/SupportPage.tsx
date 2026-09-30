// Suporte ao vivo: fila | conversa em tempo real | contexto da pessoa.
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Headphones, Inbox } from 'lucide-react';
import { adminApi } from '@/api/admin';
import { qk } from '@/api/keys';
import { useCursorQuery } from '@/api/useCursorQuery';
import { useMe } from '@/auth/AuthProvider';
import { filterOrder, SUPPORT_FILTERS, type SupportFilter } from '@/lib/support';
import { readPref, writePref } from '@/lib/prefs';
import { useSupportLive } from '@/realtime/SupportLive';
import { useSocket } from '@/realtime/SocketProvider';
import { Segmented } from '@/components/ui/Choice';
import { EmptyState, ErrorState, LoadMore, SkeletonRows } from '@/components/ui/States';
import { usePageTitle } from '@/components/layout/title';
import { ThreadRow } from './ThreadRow';
import { Conversation } from './Conversation';

function isFilter(v: string): v is SupportFilter {
  return SUPPORT_FILTERS.some((f) => f.key === v);
}

export default function SupportPage() {
  usePageTitle('Suporte');
  const { threadId } = useParams();
  const me = useMe();
  const { connected, socket } = useSocket();
  const { waiting, urgentCount, firstUrgent } = useSupportLive();
  const [filter, setFilterState] = useState<SupportFilter>(() => {
    const saved = readPref('support-filter', 'open');
    return isFilter(saved) ? saved : 'open';
  });
  const setFilter = (f: SupportFilter) => {
    setFilterState(f);
    writePref('support-filter', f);
  };

  const list = useCursorQuery(
    qk.supportThreads(filter),
    // Abertos: quem espera há mais tempo primeiro (a mesma ordem que a atualização ao vivo mantém)
    (cursor) =>
      adminApi.supportThreads(filter === 'mine' ? { mine: true, cursor } : { status: filter, order: filterOrder(filter) === 'oldest' ? 'oldest' : undefined, cursor }),
    // socket caiu: a fila se atualiza sozinha de 20 em 20 s
    { refetchInterval: connected ? false : 20_000 },
  );
  const threads = list.data?.pages.flatMap((p) => p.items) ?? [];
  // (Esc no tablet: a conversa decide, porque sabe se há texto, menu ou contexto abertos)

  return (
    <div className="support" data-has-thread={!!threadId}>
      <section className="support-queue" aria-label="Fila do suporte">
        <header className="support-queue-head">
          <div className="row">
            <h1 className="support-title">Suporte</h1>
            <span className="spacer" />
            <span className="row xsmall faint" title={connected ? 'Mensagens chegam na hora' : 'Sem tempo real: atualizando de tempos em tempos'}>
              <span className="live-dot" data-on={connected} aria-hidden="true" />
              {socket ? (connected ? 'ao vivo' : 'reconectando') : 'offline'}
            </span>
          </div>
          <div className="small muted">
            {waiting ? `${waiting} ${waiting === 1 ? 'pessoa esperando' : 'pessoas esperando'} resposta` : 'Ninguém esperando agora'}
            {filter === 'open' && threads.length > 1 ? ' · quem espera há mais tempo em cima' : ''}
          </div>
          <Segmented<SupportFilter> label="Filtrar fila" value={filter} onChange={setFilter} options={SUPPORT_FILTERS.map((f) => ({ value: f.key, label: f.label }))} />
          {/* botão de emergência sem resolver: faixa vermelha que abre o mais antigo (em qualquer filtro) */}
          {urgentCount > 0 && firstUrgent ? (
            <Link to={`/suporte/${firstUrgent.id}`} className="support-urgent-banner" role="alert">
              <span aria-hidden="true">🆘</span>
              <span className="grow">
                {urgentCount === 1 ? '1 emergência' : `${urgentCount} emergências`} esperando: {firstUrgent.user.name}
                {urgentCount > 1 ? ' e mais' : ''}
              </span>
              <span className="strong nowrap">Abrir</span>
            </Link>
          ) : null}
        </header>
        <div className="support-queue-list">
          {list.isPending ? (
            <SkeletonRows rows={7} height={64} />
          ) : list.isError ? (
            <ErrorState compact error={list.error} onRetry={() => void list.refetch()} />
          ) : !threads.length ? (
            <EmptyState
              compact
              icon={<Inbox size={22} />}
              title={filter === 'open' ? 'Tudo respondido' : filter === 'mine' ? 'Nada com você' : 'Nada aqui'}
              text={filter === 'open' ? 'Quando alguém chamar o suporte no app, aparece aqui na hora.' : undefined}
            />
          ) : (
            <>
              <ul className="list" aria-label="Atendimentos">
                {threads.map((t) => (
                  <li key={t.id}>
                    <ThreadRow thread={t} active={t.id === threadId} meId={me.id} />
                  </li>
                ))}
              </ul>
              <LoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()} />
            </>
          )}
        </div>
      </section>

      {threadId ? (
        <Conversation key={threadId} threadId={threadId} />
      ) : (
        <section className="support-empty" aria-label="Conversa">
          <EmptyState icon={<Headphones size={22} />} title="Escolha um atendimento" text="As mensagens chegam em tempo real. Enter envia, Shift+Enter quebra a linha." />
        </section>
      )}
    </div>
  );
}
