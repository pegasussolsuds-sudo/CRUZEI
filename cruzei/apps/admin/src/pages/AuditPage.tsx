// Auditoria (só admin): quem fez o quê, em quem, quando.
import { useState } from 'react';
import { Link } from 'react-router';
import { Search, ScrollText } from 'lucide-react';
import type { AdminAuditEntry } from '@cruzei/shared-types';
import { adminApi } from '@/api/admin';
import { qk } from '@/api/keys';
import { useCursorQuery } from '@/api/useCursorQuery';
import { formatDateTime, formatRelative } from '@/lib/format';
import { AUDIT_TARGET_LABEL } from '@/lib/labels';
import { useDebouncedValue } from '@/lib/hooks';
import { RoleBadge } from '@/components/badges';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, LoadMore, SkeletonRows } from '@/components/ui/States';
import { CopyId, PageHeader } from '@/components/ui/misc';

function targetLink(t: NonNullable<AdminAuditEntry['target']>): string | null {
  switch (t.kind) {
    case 'user':
      return `/usuarios/${t.id}`;
    case 'event':
      return `/eventos/${t.id}`;
    case 'support':
      return `/suporte/${t.id}`;
    case 'campaign':
      return '/notificacoes';
    case 'poi':
    case 'candidate':
      return '/lugares?aba=todos';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function AuditPage() {
  const [action, setAction] = useState('');
  const [actorId, setActorId] = useState('');
  const [targetId, setTargetId] = useState('');
  const filters = {
    action: useDebouncedValue(action.trim(), 350),
    actorId: useDebouncedValue(actorId.trim(), 350),
    targetId: useDebouncedValue(targetId.trim(), 350),
  };
  // id pela metade não vai pro servidor (ele espera o id inteiro)
  const actorOk = !filters.actorId || UUID.test(filters.actorId);
  const targetOk = !filters.targetId || UUID.test(filters.targetId);
  const query = { action: filters.action, actorId: actorOk ? filters.actorId : '', targetId: targetOk ? filters.targetId : '' };

  const list = useCursorQuery(qk.audit(query), (cursor) => adminApi.audit({ ...query, cursor }));
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = !!(query.action || query.actorId || query.targetId);

  return (
    <div className="content">
      <PageHeader title="Auditoria" sub="Tudo o que a equipe faz no painel fica registrado aqui." />
      <div className="toolbar" role="search">
        <div className="input-with-icon">
          <Search size={16} aria-hidden="true" />
          <input className="input" placeholder="Ação (ex.: ban, premium, campaign)" aria-label="Filtrar por ação" value={action} onChange={(e) => setAction(e.target.value)} />
        </div>
        <input
          className="input num"
          style={{ width: 300 }}
          placeholder="id de quem fez"
          aria-label="Filtrar por id de quem fez"
          aria-invalid={!actorOk || undefined}
          value={actorId}
          onChange={(e) => setActorId(e.target.value)}
        />
        <input
          className="input num"
          style={{ width: 300 }}
          placeholder="id do alvo"
          aria-label="Filtrar por id do alvo"
          aria-invalid={!targetOk || undefined}
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
        />
        {action || actorId || targetId ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setAction('');
              setActorId('');
              setTargetId('');
            }}
          >
            Limpar
          </Button>
        ) : null}
      </div>
      {!actorOk || !targetOk ? <div className="small text-warning">Cole o id completo (formato uuid) pra filtrar por pessoa ou alvo.</div> : null}

      <div className="card">
        {list.isPending ? (
          <SkeletonRows rows={10} height={44} />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : !items.length ? (
          <EmptyState icon={<ScrollText size={22} />} title={filtered ? 'Nada com esses filtros' : 'Nenhum registro ainda'} />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Quando</th>
                    <th scope="col">Quem</th>
                    <th scope="col">Ação</th>
                    <th scope="col">Alvo</th>
                    <th scope="col">Detalhe</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((a) => {
                    const link = a.target ? targetLink(a.target) : null;
                    return (
                      <tr key={a.id}>
                        <td className="nowrap small">
                          <div>{formatDateTime(a.at)}</div>
                          <div className="xsmall faint">{formatRelative(a.at)}</div>
                        </td>
                        <td>
                          {a.actor ? (
                            <div className="row">
                              <button type="button" className="btn btn-ghost btn-sm" style={{ paddingInline: 6 }} onClick={() => setActorId(a.actor?.id ?? '')} title="Filtrar por essa pessoa">
                                {a.actor.name}
                              </button>
                              <RoleBadge role={a.actor.role} />
                            </div>
                          ) : (
                            <span className="faint">sistema</span>
                          )}
                        </td>
                        <td>
                          <button type="button" className="chip num" onClick={() => setAction(a.action)} title="Filtrar por essa ação">
                            {a.action}
                          </button>
                        </td>
                        <td>
                          {a.target ? (
                            <div className="col" style={{ gap: 2 }}>
                              <span className="xsmall faint">{AUDIT_TARGET_LABEL[a.target.kind]}</span>
                              {link ? <Link to={link}>{a.target.label ?? 'abrir'}</Link> : <span>{a.target.label ?? '—'}</span>}
                              <CopyId id={a.target.id} />
                            </div>
                          ) : (
                            <span className="faint">—</span>
                          )}
                        </td>
                        <td className="small muted pre-wrap" style={{ maxWidth: 420 }}>
                          {a.detail ?? '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <LoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()} />
          </>
        )}
      </div>
    </div>
  );
}
