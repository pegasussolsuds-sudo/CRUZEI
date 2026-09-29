// Usuários: busca + filtros (na URL, dá pra compartilhar o link) e paginação por cursor.
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Flag, Search, UserX } from 'lucide-react';
import type { AccountStatus, PremiumTier, UserRole } from '@cruzei/shared-types';
import { adminApi } from '@/api/admin';
import { qk } from '@/api/keys';
import { useCursorQuery } from '@/api/useCursorQuery';
import { formatDate, formatNumber, formatRelative } from '@/lib/format';
import { ACCOUNT_STATUS_LABEL, ROLE_LABEL, TIER_LABEL } from '@/lib/labels';
import { useDebouncedValue } from '@/lib/hooks';
import { AccountStatusBadge, RoleBadge, TierBadge } from '@/components/badges';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, LoadMore, SkeletonRows } from '@/components/ui/States';
import { PageHeader } from '@/components/ui/misc';

const PAGE = 30;

export default function UsersPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get('q') ?? '');
  const q = useDebouncedValue(text.trim(), 300);
  const status = (params.get('status') ?? '') as AccountStatus | '';
  const tier = (params.get('tier') ?? '') as PremiumTier | '';
  const role = (params.get('role') ?? '') as UserRole | '';
  const reports: 'pending' | '' = params.get('denuncias') === 'pendentes' ? 'pending' : '';

  // a partir da URL de AGORA (window.location): dois filtros trocados em seguida não trazem de volta o que foi limpo.
  // O `params` da renderização — e até a forma funcional do setSearchParams, que o react-router resolve com ele —
  // ainda é o de antes do 1º filtro, e o 2º reescrevia a URL velha
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(window.location.search);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  // ?q= e o campo andam juntos: "written" é o último valor que já está nos dois (evita um sobrescrever o outro)
  const written = useRef(params.get('q') ?? '');
  useEffect(() => {
    // a busca do topo mudou ?q= com a tela aberta
    const urlQ = params.get('q') ?? '';
    if (urlQ !== written.current) {
      written.current = urlQ;
      setText(urlQ);
    }
  }, [params]);
  useEffect(() => {
    if (q !== written.current) {
      written.current = q;
      setParam('q', q);
    }
  }, [q]); // só quando a busca digitada assenta

  const filters = { q, status, tier, role, reports, limit: PAGE };
  const list = useCursorQuery(qk.users(filters), (cursor, signal) => adminApi.users({ ...filters, cursor }, signal));

  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  const total = list.data?.pages[0]?.total ?? null;
  const filtered = !!(q || status || tier || role || reports);

  return (
    <div className="content">
      <PageHeader title="Usuários" sub={total != null ? `${formatNumber(total)} ${filtered ? (total === 1 ? 'encontrada' : 'encontradas') : total === 1 ? 'conta no Metch' : 'contas no Metch'}` : 'Todo mundo que tem conta no Metch'} />

      <div className="toolbar" role="search">
        <div className="input-with-icon">
          <Search size={16} aria-hidden="true" />
          <input className="input" type="search" placeholder="Nome, telefone ou id" aria-label="Buscar usuários" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <select className="select" aria-label="Filtrar por situação da conta" value={status} onChange={(e) => setParam('status', e.target.value)}>
          <option value="">Qualquer situação</option>
          {(Object.keys(ACCOUNT_STATUS_LABEL) as AccountStatus[]).map((s) => (
            <option key={s} value={s}>
              {ACCOUNT_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select className="select" aria-label="Filtrar por plano" value={tier} onChange={(e) => setParam('tier', e.target.value)}>
          <option value="">Qualquer plano</option>
          {(Object.keys(TIER_LABEL) as PremiumTier[]).map((t) => (
            <option key={t} value={t}>
              {TIER_LABEL[t]}
            </option>
          ))}
        </select>
        <select className="select" aria-label="Filtrar por papel" value={role} onChange={(e) => setParam('role', e.target.value)}>
          <option value="">Qualquer papel</option>
          {(Object.keys(ROLE_LABEL) as UserRole[]).map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          variant={reports ? 'primary' : 'secondary'}
          icon={<Flag size={14} />}
          aria-pressed={!!reports}
          onClick={() => setParam('denuncias', reports ? '' : 'pendentes')}
          title="Só quem tem denúncia esperando decisão"
        >
          Com denúncias pendentes
        </Button>
        {filtered ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setText('');
              setParams(new URLSearchParams(), { replace: true });
            }}
          >
            Limpar filtros
          </Button>
        ) : null}
      </div>

      <div className="card">
        {list.isPending ? (
          <SkeletonRows rows={8} />
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : !rows.length ? (
          <EmptyState icon={<UserX size={22} />} title={filtered ? 'Ninguém com esses filtros' : 'Nenhuma conta ainda'} text={filtered ? 'Tenta outro nome, o telefone com DDD ou o id completo.' : undefined} />
        ) : (
          <>
            <div className="table-wrap" style={{ opacity: list.isFetching && !list.isFetchingNextPage ? 0.6 : 1 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Pessoa</th>
                    <th scope="col">Telefone</th>
                    <th scope="col">Situação</th>
                    <th scope="col">Plano</th>
                    <th scope="col" className="right">
                      Denúncias
                    </th>
                    <th scope="col">Entrou</th>
                    <th scope="col">Última vez</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((u) => (
                    <tr
                      key={u.id}
                      className="clickable"
                      // clique na linha abre a ficha (atalho do mouse); o teclado e o ctrl/cmd+clique usam o link do nome
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('a, button')) return;
                        if (e.ctrlKey || e.metaKey || e.shiftKey) window.open(`/usuarios/${u.id}`, '_blank', 'noopener');
                        else navigate(`/usuarios/${u.id}`);
                      }}
                    >
                      <td>
                        <div className="row-3">
                          <Avatar name={u.name} url={u.avatarUrl} premium={u.premiumTier !== 'free'} />
                          <div style={{ minWidth: 0 }}>
                            <div className="row">
                              <Link to={`/usuarios/${u.id}`} className="strong truncate user-link" title={`Abrir ficha de ${u.name}`}>
                                {u.name}
                              </Link>
                              {u.age ? <span className="faint small">{u.age}</span> : null}
                              <RoleBadge role={u.role} />
                            </div>
                            <div className="xsmall faint">{u.visibilityMode === 'anonymous' ? 'modo anônimo' : 'visível'}</div>
                          </div>
                        </div>
                      </td>
                      <td className="num small nowrap">{u.phone ?? '—'}</td>
                      <td>
                        <AccountStatusBadge status={u.accountStatus} until={u.suspendedUntil} />
                      </td>
                      <td>
                        <TierBadge tier={u.premiumTier} />
                      </td>
                      <td className="right">
                        {u.reportsPending > 0 ? (
                          <Badge tone="danger" icon={<Flag />}>
                            {u.reportsPending}
                          </Badge>
                        ) : (
                          <span className="faint">—</span>
                        )}
                      </td>
                      <td className="small nowrap">{formatDate(u.createdAt)}</td>
                      <td className="small nowrap muted">{formatRelative(u.lastActiveAt)}</td>
                    </tr>
                  ))}
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
