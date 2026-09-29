// Denúncias de lugar agrupadas por lugar: ocultar do mapa ou manter (dispensar as denúncias).
import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCheck, Eye, EyeOff, Flag } from 'lucide-react';
import type { AdminPoi } from '@cruzei/shared-types';
import { adminApi } from '@/api/admin';
import { qk } from '@/api/keys';
import { errorMessage } from '@/api/http';
import { formatDayOrDate } from '@/lib/format';
import { poiCategoryLabel, poiReportReasonLabel } from '@/lib/labels';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';

export function PoiReportsTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const reports = useQuery({ queryKey: qk.poiReports, queryFn: adminApi.poiReports });
  const [hiding, setHiding] = useState<AdminPoi | null>(null);
  const [dismissing, setDismissing] = useState<AdminPoi | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.placesAll });
    void qc.invalidateQueries({ queryKey: qk.stats });
  };

  if (reports.isPending) {
    return (
      <div className="stack">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} height={140} radius={16} />
        ))}
      </div>
    );
  }
  if (reports.isError) {
    return (
      <div className="card">
        <ErrorState error={reports.error} onRetry={() => void reports.refetch()} />
      </div>
    );
  }
  if (!reports.data.items.length) {
    return (
      <div className="card">
        <EmptyState icon={<Flag size={22} />} title="Nenhum lugar denunciado" text="Quando alguém avisar que um lugar fechou, não existe ou é perigoso, aparece aqui." />
      </div>
    );
  }

  return (
    <div className="stack">
      {reports.data.items.map(({ poi, reports: list }) => (
        <article key={poi.id} className="card">
          <header className="card-head">
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="row row-wrap">
                <h3 className="section-title">{poi.name}</h3>
                <span className="xsmall faint">{poiCategoryLabel(poi.category)}</span>
                {poi.hiddenAt ? <Badge tone="danger">Oculto do mapa</Badge> : <Badge tone="success">No mapa</Badge>}
                {poi.isPartner ? <Badge tone="gold">Parceiro</Badge> : null}
              </div>
              <div className="small muted">{[poi.address, poi.city].filter(Boolean).join(' · ') || 'Sem endereço'}</div>
            </div>
            <Badge tone="danger" icon={<Flag />}>
              {list.length}
            </Badge>
          </header>
          <ul className="list">
            {list.map((r) => (
              <li key={r.id} className="report-item">
                <div className="row">
                  <span className="grow">{poiReportReasonLabel(r.reason)}</span>
                  <span className="xsmall faint">{formatDayOrDate(r.createdAt)}</span>
                </div>
                {r.reporterId ? (
                  <Link to={`/usuarios/${r.reporterId}`} className="xsmall">
                    Quem denunciou
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
          <footer className="card-foot">
            <Button size="sm" icon={<CheckCheck size={14} />} onClick={() => setDismissing(poi)}>
              Manter e dispensar
            </Button>
            {poi.hiddenAt ? (
              <Button
                size="sm"
                icon={<Eye size={14} />}
                onClick={async () => {
                  try {
                    await adminApi.setPoiHidden(poi.id, false);
                    toast.success(`${poi.name} voltou pro mapa`);
                    refresh();
                  } catch (e) {
                    toast.error(errorMessage(e));
                  }
                }}
              >
                Mostrar de novo
              </Button>
            ) : (
              <Button size="sm" variant="danger-soft" icon={<EyeOff size={14} />} onClick={() => setHiding(poi)}>
                Ocultar do mapa
              </Button>
            )}
          </footer>
        </article>
      ))}

      <ConfirmDialog
        open={!!hiding}
        onClose={() => setHiding(null)}
        icon={<EyeOff size={20} />}
        title={`Ocultar “${hiding?.name ?? ''}”?`}
        description="O lugar some do mapa e da busca do app e as denúncias são fechadas. Dá pra mostrar de novo depois."
        confirmLabel="Ocultar do mapa"
        reason={{ label: 'Nota interna (opcional)', maxLength: 300, placeholder: 'Ex.: confirmado que fechou' }}
        onConfirm={async (note) => {
          if (!hiding) return;
          await adminApi.resolvePoiReports(hiding.id, note ? { action: 'hide', note } : { action: 'hide' });
          toast.success(`${hiding.name} saiu do mapa`);
          refresh();
        }}
      />
      <ConfirmDialog
        open={!!dismissing}
        onClose={() => setDismissing(null)}
        tone="primary"
        icon={<CheckCheck size={20} />}
        title={`Manter “${dismissing?.name ?? ''}” no mapa?`}
        description="As denúncias são descartadas e param de contar pra retirada automática. Se alguém denunciar de novo, volta pra cá."
        confirmLabel="Dispensar denúncias"
        reason={{ label: 'Nota interna (opcional)', maxLength: 300, placeholder: 'Ex.: lugar segue aberto, conferi hoje' }}
        onConfirm={async (note) => {
          if (!dismissing) return;
          await adminApi.resolvePoiReports(dismissing.id, note ? { action: 'dismiss', note } : { action: 'dismiss' });
          toast.success('Denúncias dispensadas');
          refresh();
        }}
      />
    </div>
  );
}
