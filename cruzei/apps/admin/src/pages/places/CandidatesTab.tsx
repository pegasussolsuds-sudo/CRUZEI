// Sugestões "Pôr no Metch": lista + mapa lado a lado; aprovar põe no mapa, recusar pede motivo.
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, MapPinPlus, ThumbsDown, ThumbsUp, UserCheck, X } from 'lucide-react';
import type { AdminPlaceCandidate, CandidateStatus } from '@cruzei/shared-types';
import { adminApi } from '@/api/admin';
import { qk } from '@/api/keys';
import { useCursorQuery } from '@/api/useCursorQuery';
import { formatDayOrDate, formatNumber } from '@/lib/format';
import { CANDIDATE_STATUS_LABEL, poiCategoryLabel } from '@/lib/labels';
import { CandidateStatusBadge } from '@/components/badges';
import { LazyMap } from '@/components/pickers';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Segmented } from '@/components/ui/Choice';
import { EmptyState, ErrorState, LoadMore, SkeletonRows } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';

const STATUS_ORDER: CandidateStatus[] = ['pending', 'promoted', 'rejected', 'expired'];

export function CandidatesTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<CandidateStatus>('pending');
  const [selected, setSelected] = useState<string | null>(null);
  const [approving, setApproving] = useState<AdminPlaceCandidate | null>(null);
  const [rejecting, setRejecting] = useState<AdminPlaceCandidate | null>(null);

  const list = useCursorQuery(qk.candidates(status), (cursor) => adminApi.candidates(status, cursor));
  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);

  const markers = useMemo(
    () =>
      items.map((c) => ({
        id: c.id,
        lat: c.lat,
        lng: c.lng,
        label: c.name,
        selected: c.id === selected,
        color: c.status === 'pending' ? '#FFD700' : c.status === 'promoted' ? '#7FFF00' : '#9a9ab0',
      })),
    [items, selected],
  );

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['places'] });
    void qc.invalidateQueries({ queryKey: qk.stats });
  };

  return (
    <div className="stack">
      <div className="toolbar">
        <Segmented<CandidateStatus>
          label="Situação da sugestão"
          value={status}
          onChange={(s) => {
            setStatus(s);
            setSelected(null);
          }}
          options={STATUS_ORDER.map((s) => ({ value: s, label: CANDIDATE_STATUS_LABEL[s] }))}
        />
      </div>

      <div className="split">
        <div className="card split-list">
          {list.isPending ? (
            <SkeletonRows rows={6} height={92} />
          ) : list.isError ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : !items.length ? (
            <EmptyState
              icon={<MapPinPlus size={22} />}
              title={status === 'pending' ? 'Nenhuma sugestão esperando' : 'Nada por aqui'}
              text={status === 'pending' ? 'Quando a galera pedir pra pôr um lugar no Metch, ele aparece aqui.' : undefined}
            />
          ) : (
            <>
              <ul className="list" aria-label="Sugestões de lugar">
                {items.map((c) => (
                  <li key={c.id}>
                    <div
                      className="place-item"
                      data-selected={c.id === selected}
                      role="button"
                      tabIndex={0}
                      aria-pressed={c.id === selected}
                      onClick={() => setSelected(c.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelected(c.id);
                        }
                      }}
                    >
                      <div className="row row-wrap">
                        <span className="strong">{c.name}</span>
                        <span className="xsmall faint">{poiCategoryLabel(c.category)}</span>
                        <span className="spacer" />
                        <CandidateStatusBadge status={c.status} />
                      </div>
                      <div className="small muted">{[c.address, c.neighborhood, c.city].filter(Boolean).join(' · ') || 'Sem endereço'}</div>
                      <div className="row row-wrap small">
                        <span className="vote" title="Pedidos pra pôr no Metch">
                          <ThumbsUp size={13} /> <span className="num">{formatNumber(c.votes.requests)}</span> pedidos
                        </span>
                        <span className="vote" title="Confirmações de quem estava no local">
                          <UserCheck size={13} /> <span className="num">{formatNumber(c.votes.onsite)}</span> no local
                        </span>
                        <span className="vote" title="Pessoas dizendo que não existe">
                          <ThumbsDown size={13} /> <span className="num">{formatNumber(c.votes.deny)}</span> negações
                        </span>
                      </div>
                      {c.crowdHint ? <div className="xsmall hint-pill">Robô da galera: {c.crowdHint}</div> : null}
                      <div className="row">
                        <span className="xsmall faint">
                          visto desde {formatDayOrDate(c.firstSeenOn)}
                          {c.lastEvidenceOn ? ` · última evidência ${formatDayOrDate(c.lastEvidenceOn)}` : ''}
                        </span>
                        <span className="spacer" />
                        {c.status === 'pending' ? (
                          <span className="row" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} role="presentation">
                            <Button size="sm" variant="danger-soft" icon={<X size={14} />} onClick={() => setRejecting(c)}>
                              Recusar
                            </Button>
                            <Button size="sm" variant="primary" icon={<Check size={14} />} onClick={() => setApproving(c)}>
                              Aprovar
                            </Button>
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              <LoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()} />
            </>
          )}
        </div>
        <div className="split-map">
          <LazyMap ariaLabel="Mapa das sugestões" markers={markers} onMarkerClick={setSelected} fitMarkers height="100%" overlay={`${items.length} no mapa`} />
        </div>
      </div>

      <ConfirmDialog
        open={!!approving}
        onClose={() => setApproving(null)}
        tone="primary"
        icon={<MapPinPlus size={20} />}
        title={`Pôr “${approving?.name ?? ''}” no mapa?`}
        description="Vira um lugar do Metch na hora, visível pra todo mundo."
        confirmLabel="Aprovar e pôr no mapa"
        onConfirm={async () => {
          if (!approving) return;
          await adminApi.approveCandidate(approving.id);
          toast.success(`${approving.name} entrou no mapa`);
          refresh();
        }}
      />
      <ConfirmDialog
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        icon={<X size={20} />}
        title={`Recusar “${rejecting?.name ?? ''}”?`}
        description="A sugestão sai da fila. O motivo fica no histórico."
        confirmLabel="Recusar sugestão"
        reason={{ label: 'Motivo', required: true, placeholder: 'Ex.: Residência particular / Lugar já existe como “Bar do Zé”.' }}
        onConfirm={async (reason) => {
          if (!rejecting) return;
          await adminApi.rejectCandidate(rejecting.id, { reason });
          toast.success('Sugestão recusada');
          refresh();
        }}
      />
    </div>
  );
}
