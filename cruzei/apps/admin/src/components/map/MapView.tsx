// Mapa do painel: MapLibre + estilo "liberty" do OpenFreeMap (tiles abertos, nada de Google).
// Serve pra listar pontos (sugestões, lugares), escolher um ponto (formulários) e mostrar um raio.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import maplibregl, { type GeoJSONSource, type Map as MlMap, type Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { boundsOf, circleRing, DEFAULT_CENTER, isValidLatLng, type LatLng } from '@/lib/geo';

export const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  /** texto pro leitor de tela e dica ao passar o mouse */
  label: string;
  color?: string;
  selected?: boolean;
}

export interface MapViewProps {
  ariaLabel: string;
  markers?: readonly MapMarker[];
  onMarkerClick?: (id: string) => void;
  /** ponto escolhido (vira alfinete arrastável quando onPick existe) */
  picked?: LatLng | null;
  onPick?: (p: LatLng) => void;
  circle?: { center: LatLng; radiusM: number } | null;
  center?: LatLng;
  zoom?: number;
  /** enquadra os marcadores quando a lista muda */
  fitMarkers?: boolean;
  height?: number | string;
  overlay?: ReactNode;
}

const CIRCLE_SOURCE = 'metch-radius';

function pinElement(label: string, color: string | undefined, onClick?: () => void): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'map-pin';
  el.setAttribute('aria-label', label);
  el.title = label;
  if (color) el.style.setProperty('--pin', color);
  if (onClick) {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
  } else {
    el.tabIndex = -1;
  }
  return el;
}

export function MapView({ ariaLabel, markers, onMarkerClick, picked, onPick, circle, center, zoom = 12, fitMarkers, height = 360, overlay }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markerRefs = useRef(new Map<string, Marker>());
  const pickRef = useRef<Marker | null>(null);
  const onPickRef = useRef(onPick);
  const onMarkerClickRef = useRef(onMarkerClick);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  onPickRef.current = onPick;
  onMarkerClickRef.current = onMarkerClick;

  // cria o mapa uma vez
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const start = picked && isValidLatLng(picked.lat, picked.lng) ? picked : (center ?? DEFAULT_CENTER);
    let map: MlMap;
    try {
      map = new maplibregl.Map({
        container,
        style: MAP_STYLE_URL,
        center: [start.lng, start.lat],
        zoom,
        attributionControl: { compact: true },
        cooperativeGestures: false,
      });
    } catch {
      setFailed('Esse navegador não conseguiu abrir o mapa (WebGL desligado?). Use os campos de coordenada.');
      return;
    }
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    let loaded = false;
    let giveUp: number | undefined;
    map.on('load', () => {
      loaded = true;
      window.clearTimeout(giveUp);
      setReady(true);
    });
    map.on('error', () => {
      // falha de tile isolada não derruba o mapa; só desiste se nem o estilo carregar em 10 s
      if (loaded || giveUp !== undefined) return;
      giveUp = window.setTimeout(() => {
        if (!loaded) setFailed('Não deu pra carregar o mapa agora. As coordenadas ainda funcionam.');
      }, 10_000);
    });
    map.on('click', (e) => {
      onPickRef.current?.({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    });
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(container);
    const markersMap = markerRefs.current;
    return () => {
      window.clearTimeout(giveUp);
      ro.disconnect();
      markersMap.forEach((m) => m.remove());
      markersMap.clear();
      pickRef.current?.remove();
      pickRef.current = null;
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
    // o mapa nasce uma vez; centro/zoom depois mudam pelos efeitos abaixo
  }, []);

  // cursor de mira quando dá pra escolher ponto
  useEffect(() => {
    const canvas = mapRef.current?.getCanvas();
    if (canvas) canvas.style.cursor = onPick ? 'crosshair' : '';
  }, [onPick, ready]);

  // marcadores
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const current = markerRefs.current;
    const next = new Set((markers ?? []).map((m) => m.id));
    current.forEach((mk, id) => {
      if (!next.has(id)) {
        mk.remove();
        current.delete(id);
      }
    });
    for (const m of markers ?? []) {
      if (!isValidLatLng(m.lat, m.lng)) continue;
      let mk = current.get(m.id);
      if (!mk) {
        const el = pinElement(m.label, m.color, onMarkerClickRef.current ? () => onMarkerClickRef.current?.(m.id) : undefined);
        mk = new maplibregl.Marker({ element: el, anchor: 'bottom-left', offset: [-3, 3] }).setLngLat([m.lng, m.lat]).addTo(map);
        current.set(m.id, mk);
      } else {
        mk.setLngLat([m.lng, m.lat]);
      }
      const el = mk.getElement();
      el.dataset.selected = String(!!m.selected);
      if (m.color) el.style.setProperty('--pin', m.color);
    }
  }, [markers]);

  // enquadrar
  const fitKey = fitMarkers ? (markers ?? []).map((m) => m.id).join(',') : '';
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fitMarkers) return;
    const b = boundsOf(markers ?? []);
    if (!b) return;
    if (b[0][0] === b[1][0] && b[0][1] === b[1][1]) map.easeTo({ center: b[0], zoom: 15 });
    else map.fitBounds(b, { padding: 56, maxZoom: 15, duration: 400 });
    // só quando o conjunto de pontos muda
  }, [fitKey]);

  // selecionado vai pro centro
  const selected = markers?.find((m) => m.selected);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selected || !isValidLatLng(selected.lat, selected.lng)) return;
    map.easeTo({ center: [selected.lng, selected.lat], zoom: Math.max(map.getZoom(), 14), duration: 350 });
  }, [selected?.id, selected?.lat, selected?.lng]);

  // alfinete do ponto escolhido
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!picked || !isValidLatLng(picked.lat, picked.lng)) {
      pickRef.current?.remove();
      pickRef.current = null;
      return;
    }
    if (!pickRef.current) {
      const el = pinElement('Ponto escolhido (arraste pra ajustar)', '#7FFF00');
      el.dataset.selected = 'true';
      const mk = new maplibregl.Marker({ element: el, anchor: 'bottom-left', offset: [-3, 3], draggable: !!onPickRef.current });
      mk.on('dragend', () => {
        const p = mk.getLngLat();
        onPickRef.current?.({ lat: p.lat, lng: p.lng });
      });
      pickRef.current = mk.setLngLat([picked.lng, picked.lat]).addTo(map);
    } else {
      pickRef.current.setLngLat([picked.lng, picked.lat]);
    }
    const b = map.getBounds();
    if (!b.contains([picked.lng, picked.lat])) map.easeTo({ center: [picked.lng, picked.lat], duration: 300 });
  }, [picked?.lat, picked?.lng]);

  // centro pedido de fora (ex.: evento escolhido)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !center || !isValidLatLng(center.lat, center.lng)) return;
    map.easeTo({ center: [center.lng, center.lat], duration: 300 });
  }, [center?.lat, center?.lng]);

  // raio
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const data: Parameters<GeoJSONSource['setData']>[0] = {
      type: 'FeatureCollection',
      features:
        circle && isValidLatLng(circle.center.lat, circle.center.lng)
          ? [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [circleRing(circle.center, circle.radiusM)] } }]
          : [],
    };
    const src = map.getSource(CIRCLE_SOURCE) as GeoJSONSource | undefined;
    if (src) {
      src.setData(data);
    } else {
      map.addSource(CIRCLE_SOURCE, { type: 'geojson', data });
      map.addLayer({ id: `${CIRCLE_SOURCE}-fill`, type: 'fill', source: CIRCLE_SOURCE, paint: { 'fill-color': '#7FFF00', 'fill-opacity': 0.12 } });
      map.addLayer({ id: `${CIRCLE_SOURCE}-line`, type: 'line', source: CIRCLE_SOURCE, paint: { 'line-color': '#4E9F00', 'line-width': 2 } });
    }
    if (circle && isValidLatLng(circle.center.lat, circle.center.lng)) {
      const ring = circleRing(circle.center, circle.radiusM, 32).map(([lng, lat]) => ({ lat, lng }));
      const b = boundsOf(ring);
      if (b) map.fitBounds(b, { padding: 32, duration: 300, maxZoom: 16 });
    }
  }, [ready, circle?.center.lat, circle?.center.lng, circle?.radiusM]);

  return (
    <div className="map" style={{ height }} role="region" aria-label={ariaLabel}>
      {failed ? (
        <div className="state state-compact small" style={{ height: '100%' }}>
          {failed}
        </div>
      ) : (
        <div ref={containerRef} className="map-canvas" />
      )}
      {overlay ? <div className="map-overlay">{overlay}</div> : null}
    </div>
  );
}
