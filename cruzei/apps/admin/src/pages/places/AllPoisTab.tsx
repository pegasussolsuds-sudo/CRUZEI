// Catálogo de lugares: busca, criar (com seletor no mapa), editar, ocultar/mostrar.
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff, MapPinned, Pencil, Plus, Search } from 'lucide-react';
import type { AdminPoi } from '@cruzei/shared-types';
import { adminApi } from '@/api/admin';
import { qk } from '@/api/keys';
import { useCursorQuery } from '@/api/useCursorQuery';
import { errorMessage } from '@/api/http';
import { useDebouncedValue } from '@/lib/hooks';
import { poiCategoryLabel } from '@/lib/labels';
import { LazyMap } from '@/components/pickers';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Segmented } from '@/components/ui/Choice';
import { EmptyState, ErrorState, LoadMore, SkeletonRows } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { PoiFormDialog } from './PoiFormDialog';

export function AllPoisTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const [text, setText] = useState('');
  const q = useDebouncedValue(text.trim(), 300);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminPoi | 'new' | null>(null);
  const [hiding, setHiding] = useState<AdminPoi | null>(null);

  const [hidden, setHidden] = useState<'' | '0' | '1'>('');
  const list = useCursorQuery(qk.pois(q, hidden), (cursor) => adminApi.pois(q, cursor, hidden));
  const items = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const markers = useMemo(
    () =>
      items.map((p) => ({
        id: p.id,
        lat: p.lat,
        lng: p.lng,
        label: p.name,
        selected: p.id === selected,
        color: p.hiddenAt ? '#9a9ab0' : p.isPartner ? '#FFD700' : p.eventId ? '#FF1493' : '#7FFF00',
      })),
    [items, selected],
  );

  const toggleHidden = async (p: AdminPoi, hidden: boolean) => {
    await adminApi.setPoiHidden(p.id, hidden);
    toast.success(hidden ? `${p.name} saiu do mapa` : `${p.name} voltou pro mapa`);
    void qc.invalidateQueries({ queryKey: qk.placesAll });
  };

  return (
    <div className="stack">
      <div className="toolbar">
        <div className="input-with-icon">
          <Search size={16} aria-hidden="true" />
          <input className="input" type="search" placeholder="Buscar lugar pelo nome" aria-label="Buscar lugares" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <Segmented<'' | '0' | '1'>
          label="Mostrar lugares"
          value={hidden}
          onChange={setHidden}
          options={[
            { value: '', label: 'Todos' },
            { value: '0', label: 'No mapa' },
            { value: '1', label: 'Ocultos' },
          ]}
        />
        <span className="spacer" />
        <Button variant="primary" icon={<Plus size={16} />} onClick={() => setEditing('new')}>
          Novo lugar
        </Button>
      </div>

      <div className="split">
        <div className="card split-list">
          {list.isPending ? (
            <SkeletonRows rows={8} height={56} />
          ) : list.isError ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : !items.length ? (
            <EmptyState icon={<MapPinned size={22} />} title={q ? `Nenhum lugar com “${q}”` : 'Nenhum lugar ainda'} action={<Button onClick={() => setEditing('new')}>Criar lugar</Button>} />
          ) : (
            <>
              <ul className="list" aria-label="Lugares">
                {items.map((p) => (
                  <li key={p.id}>
                    <div
                      className="place-item place-item-compact"
                      data-selected={p.id === selected}
                      role="button"
                      tabIndex={0}
                      aria-pressed={p.id === selected}
                      onClick={() => setSelected(p.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelected(p.id);
                        }
                      }}
                    >
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="row row-wrap">
                          <span className="strong truncate">{p.name}</span>
                          {p.isPartner ? <Badge tone="gold">Parceiro</Badge> : null}
                          {p.eventId ? <Badge tone="premium">Evento</Badge> : null}
                          {p.hiddenAt ? <Badge tone="danger">Oculto</Badge> : null}
                        </div>
                        <div className="xsmall faint truncate">
                          {poiCategoryLabel(p.category)} · {[p.address, p.city].filter(Boolean).join(' · ') || 'sem endereço'} · fonte {p.source}
                        </div>
                      </div>
                      <span className="row" role="presentation" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                        <Button size="sm" variant="ghost" iconOnly icon={<Pencil size={14} />} aria-label={`Editar ${p.name}`} onClick={() => setEditing(p)} />
                        {p.hiddenAt ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            iconOnly
                            icon={<Eye size={14} />}
                            aria-label={`Mostrar ${p.name} no mapa`}
                            onClick={() => void toggleHidden(p, false).catch((e: unknown) => toast.error(errorMessage(e)))}
                          />
                        ) : (
                          <Button size="sm" variant="ghost" iconOnly icon={<EyeOff size={14} />} aria-label={`Ocultar ${p.name} do mapa`} onClick={() => setHiding(p)} />
                        )}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
              <LoadMore hasMore={!!list.hasNextPage} loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()} />
            </>
          )}
        </div>
        <div className="split-map">
          <LazyMap ariaLabel="Mapa dos lugares" markers={markers} onMarkerClick={setSelected} fitMarkers height="100%" overlay={`${items.length} lugares carregados`} />
        </div>
      </div>

      <PoiFormDialog open={editing !== null} onClose={() => setEditing(null)} poi={editing === 'new' ? null : editing} />
      <ConfirmDialog
        open={!!hiding}
        onClose={() => setHiding(null)}
        icon={<EyeOff size={20} />}
        title={`Ocultar “${hiding?.name ?? ''}”?`}
        description="Some do mapa e da busca do app. Dá pra mostrar de novo depois."
        confirmLabel="Ocultar do mapa"
        onConfirm={async () => {
          if (hiding) await toggleHidden(hiding, true);
        }}
      />
    </div>
  );
}
