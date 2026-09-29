// Histórico de campanhas com números: alvo, notificados, push ok/falhou, abertos e taxa de abertura.
import { useState } from 'react';
import { useQueryClient, type UseInfiniteQueryResult } from '@tanstack/react-query';
import type { CursorData } from '@/api/useCursorQuery';
import { History, XCircle } from 'lucide-react';
import type { AdminCampaign, AdminCampaignList } from '@cruzei/shared-types';
import { adminApi } from '@/api/admin';
import { qk } from '@/api/keys';
import { describeAudience, describeChannels, describeTarget } from '@/lib/audience';
import { openRate, pushSuccessRate } from '@/lib/campaign';
import { formatNumber, formatPercent, formatShortDateTime } from '@/lib/format';
import { CampaignStatusBadge } from '@/components/badges';
import { Button } from '@/components/ui/Button';
import { Card, CardHead } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState, ErrorState, LoadMore, SkeletonRows } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';

export function CampaignHistory({ history }: { history: UseInfiniteQueryResult<CursorData<AdminCampaignList>, Error> }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [cancelling, setCancelling] = useState<AdminCampaign | null>(null);
  const items = history.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Card>
      <CardHead title="Histórico" icon={<History size={16} />} />
      {history.isPending ? (
        <SkeletonRows rows={5} height={52} />
      ) : history.isError ? (
        <ErrorState error={history.error} onRetry={() => void history.refetch()} />
      ) : !items.length ? (
        <EmptyState icon={<History size={22} />} title="Nenhuma campanha ainda" text="A primeira que você mandar aparece aqui com os números." />
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Campanha</th>
                  <th scope="col">Situação</th>
                  <th scope="col">Público</th>
                  <th scope="col" className="right">
                    Alvo
                  </th>
                  <th scope="col" className="right">
                    Notificados
                  </th>
                  <th scope="col" className="right">
                    Push ok / falhou
                  </th>
                  <th scope="col" className="right">
                    Abertos
                  </th>
                  <th scope="col">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => {
                  const rate = openRate(c.stats);
                  const pushRate = pushSuccessRate(c.stats);
                  return (
                    <tr key={c.id}>
                      <td style={{ maxWidth: 340 }}>
                        <div className="strong truncate">{c.title}</div>
                        <div className="xsmall faint truncate">{c.body}</div>
                        <div className="xsmall faint">
                          {describeTarget(c.target)} · {describeChannels(c.channels)}
                          {c.eventId ? ' · aviso de evento' : ''}
                          {c.createdBy ? ` · ${c.createdBy.name}` : ''}
                        </div>
                      </td>
                      <td>
                        <div className="col" style={{ gap: 4 }}>
                          <CampaignStatusBadge status={c.status} />
                          <span className="xsmall faint nowrap">
                            {c.status === 'scheduled' ? `para ${formatShortDateTime(c.scheduledAt)}` : c.sentAt ? formatShortDateTime(c.sentAt) : formatShortDateTime(c.createdAt)}
                          </span>
                        </div>
                      </td>
                      <td className="small">{describeAudience(c.audience)}</td>
                      <td className="num right">{formatNumber(c.stats.targetCount)}</td>
                      <td className="num right">{formatNumber(c.stats.notified)}</td>
                      <td className="num right nowrap">
                        {c.channels.push ? (
                          <>
                            {formatNumber(c.stats.pushSent)} / <span className={c.stats.pushFailed ? 'text-danger' : undefined}>{formatNumber(c.stats.pushFailed)}</span>
                            {pushRate != null ? <div className="xsmall faint">{formatPercent(pushRate)} ok</div> : null}
                          </>
                        ) : (
                          <span className="faint">—</span>
                        )}
                      </td>
                      <td className="num right">
                        {formatNumber(c.stats.opened)}
                        {rate != null ? <div className="xsmall faint">{formatPercent(rate, 1)}</div> : null}
                      </td>
                      <td className="right">
                        {c.status === 'scheduled' ? (
                          <Button size="sm" variant="ghost" icon={<XCircle size={14} />} onClick={() => setCancelling(c)}>
                            Cancelar
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <LoadMore hasMore={!!history.hasNextPage} loading={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()} />
        </>
      )}
      <ConfirmDialog
        open={!!cancelling}
        onClose={() => setCancelling(null)}
        icon={<XCircle size={20} />}
        title="Cancelar campanha agendada?"
        description={cancelling ? `“${cancelling.title}” não vai ser enviada.` : undefined}
        confirmLabel="Cancelar envio"
        onConfirm={async () => {
          if (!cancelling) return;
          await adminApi.cancelCampaign(cancelling.id);
          toast.success('Campanha cancelada');
          void qc.invalidateQueries({ queryKey: qk.campaigns });
        }}
      />
    </Card>
  );
}
