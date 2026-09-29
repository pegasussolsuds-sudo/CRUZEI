// Seletores prontos: pessoa, lugar, evento e ponto no mapa.
import { lazy, Suspense, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Crosshair, MapPin } from 'lucide-react';
import type { AdminEvent, AdminPoi, AdminUserRow } from '@cruzei/shared-types';
import { adminApi } from '@/api/admin';
import { errorMessage } from '@/api/http';
import { formatShortDateTime } from '@/lib/format';
import { formatLatLng, isValidLatLng, parseLatLng, type LatLng } from '@/lib/geo';
import { poiCategoryLabel } from '@/lib/labels';
import { AsyncPicker } from './AsyncPicker';
import { Avatar } from './ui/Avatar';
import { Button } from './ui/Button';
import { SelectField } from './ui/Field';
import { Skeleton } from './ui/States';
import type { MapViewProps } from './map/MapView';

const MapView = lazy(() => import('./map/MapView').then((m) => ({ default: m.MapView })));

/** mapa carregado sob demanda (o maplibre é pesado) */
export function LazyMap(props: MapViewProps) {
  return (
    <Suspense fallback={<Skeleton height={props.height ?? 360} radius={12} />}>
      <MapView {...props} />
    </Suspense>
  );
}

export function UserPicker({ value, onChange, label = 'Pessoa', error }: { value: AdminUserRow | null; onChange: (u: AdminUserRow | null) => void; label?: string; error?: string | null }) {
  return (
    <AsyncPicker<AdminUserRow>
      label={label}
      placeholder="Nome, telefone ou id"
      cacheKey="users"
      search={async (q, signal) => (await adminApi.users({ q, limit: 8 }, signal)).items}
      getId={(u) => u.id}
      value={value}
      onChange={onChange}
      error={error}
      renderItem={(u) => (
        <div className="row">
          <Avatar name={u.name} url={u.avatarUrl} size={28} />
          <div style={{ minWidth: 0 }}>
            <div className="strong truncate">{u.name}</div>
            <div className="xsmall faint num truncate">{u.phone ?? u.id}</div>
          </div>
        </div>
      )}
    />
  );
}

export function PoiPicker({ value, onChange, label = 'Lugar', error, hint }: { value: AdminPoi | null; onChange: (p: AdminPoi | null) => void; label?: string; error?: string | null; hint?: string }) {
  return (
    <AsyncPicker<AdminPoi>
      label={label}
      placeholder="Buscar lugar pelo nome"
      cacheKey="pois"
      search={async (q) => (await adminApi.pois(q)).items}
      getId={(p) => p.id}
      value={value}
      onChange={onChange}
      error={error}
      hint={hint}
      renderItem={(p) => (
        <div className="row">
          <MapPin size={16} className="faint" aria-hidden="true" />
          <div style={{ minWidth: 0 }}>
            <div className="strong truncate">{p.name}</div>
            <div className="xsmall faint truncate">
              {poiCategoryLabel(p.category)}
              {p.address ? ` · ${p.address}` : ''}
              {p.city ? ` · ${p.city}` : ''}
            </div>
          </div>
        </div>
      )}
    />
  );
}

/** eventos publicados (acontecendo + próximos) pra servir de destino de notificação */
export function EventSelect({ value, onChange, error }: { value: string | null; onChange: (e: AdminEvent | null) => void; error?: string | null }) {
  const events = useQuery({
    queryKey: ['event-select'],
    queryFn: async () => {
      const [live, upcoming] = await Promise.all([adminApi.events({ status: 'published', when: 'live' }), adminApi.events({ status: 'published', when: 'upcoming' })]);
      return [...live.items, ...upcoming.items];
    },
    staleTime: 60_000,
  });
  const list = events.data ?? [];
  return (
    <SelectField
      label="Evento"
      value={value ?? ''}
      error={error ?? (events.isError ? errorMessage(events.error) : null)}
      disabled={events.isPending}
      hint={!events.isPending && !list.length ? 'Nenhum evento publicado acontecendo ou pela frente.' : undefined}
      onChange={(e) => onChange(list.find((ev) => ev.id === e.target.value) ?? null)}
    >
      <option value="">{events.isPending ? 'Carregando eventos…' : 'Escolha um evento'}</option>
      {list.map((ev) => (
        <option key={ev.id} value={ev.id}>
          {ev.title} · {formatShortDateTime(ev.startsAt)}
        </option>
      ))}
    </SelectField>
  );
}

/** ponto no mapa + campo de coordenadas (dá pra colar "-18.91, -48.27" ou usar só o teclado) */
export function MapPointField({
  value,
  onChange,
  label = 'Onde',
  error,
  height = 320,
  circleRadiusM,
}: {
  value: LatLng | null;
  onChange: (p: LatLng) => void;
  label?: string;
  error?: string | null;
  height?: number;
  circleRadiusM?: number;
}) {
  const [text, setText] = useState(value ? formatLatLng(value) : '');
  const [textError, setTextError] = useState<string | null>(null);

  useEffect(() => {
    if (value && isValidLatLng(value.lat, value.lng)) setText(formatLatLng(value));
  }, [value?.lat, value?.lng]); // campo acompanha o clique/arraste no mapa

  const apply = () => {
    const p = parseLatLng(text);
    if (!p) {
      setTextError('Não entendi. Use "latitude, longitude", ex.: -18.9186, -48.2772');
      return;
    }
    setTextError(null);
    onChange(p);
  };

  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <LazyMap
        ariaLabel={`${label}: clique no mapa pra marcar o ponto`}
        picked={value}
        onPick={onChange}
        height={height}
        circle={value && circleRadiusM ? { center: value, radiusM: circleRadiusM } : null}
        overlay={value ? formatLatLng(value) : 'Clique no mapa pra marcar'}
      />
      <div className="row">
        <div className="input-with-icon grow">
          <Crosshair size={16} aria-hidden="true" />
          <input
            className="input num"
            aria-label="Coordenadas (latitude, longitude)"
            placeholder="-18.9186, -48.2772"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                apply();
              }
            }}
            aria-invalid={textError || error ? true : undefined}
          />
        </div>
        <Button size="sm" onClick={apply}>
          Usar coordenadas
        </Button>
      </div>
      {textError || error ? (
        <span className="field-error" role="alert">
          {textError ?? error}
        </span>
      ) : (
        <span className="field-hint">Clique no mapa, arraste o alfinete ou cole as coordenadas.</span>
      )}
    </div>
  );
}
