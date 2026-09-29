import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { GeoResultType, GeoSearchResponse, GeoSearchResult } from '@cruzei/shared-types';
import { distanceMeters } from '@cruzei/shared-utils';
import { api } from '../services/api';

/** tipo mostrado no overlay (ícone): 'place' = cidade, 'locality' = distrito/vila */
export type GeocodeType = 'place' | 'locality' | 'neighborhood' | 'street' | 'address' | 'other';

export interface GeocodeResult {
  id: string;
  name: string;
  /** "Centro, Uberlândia - MG" */
  context: string;
  type: GeocodeType;
  lat: number;
  lng: number;
  /** zoom sugerido pra levar a câmera até lá */
  zoom: number;
  /** [oeste, sul, leste, norte] pra enquadrar a rua/bairro inteiro; null quando não tem */
  bbox: [number, number, number, number] | null;
}

const ZOOM_BY_TYPE: Record<GeocodeType, number> = {
  place: 12.5,
  locality: 14,
  neighborhood: 14.5,
  street: 16,
  address: 17,
  other: 15,
};

const TYPE_OF: Record<GeoResultType, GeocodeType> = {
  city: 'place',
  locality: 'locality',
  neighborhood: 'neighborhood',
  street: 'street',
  address: 'address',
};

/** ~1 km: a proximidade enviada é o centro do MAPA arredondado, nunca a posição fina de alguém */
const roundCoord = (v: number) => Math.round(v * 100) / 100;

/** resposta do GET /geo/search → resultado do overlay */
export function fromGeoSearch(results: readonly GeoSearchResult[]): GeocodeResult[] {
  return results.map((r) => {
    const type = TYPE_OF[r.type] ?? 'other';
    return { id: r.id, name: r.name, context: r.context, type, lat: r.lat, lng: r.lng, zoom: ZOOM_BY_TYPE[type], bbox: r.bbox ?? null };
  });
}

/** rua, número e bairro só valem perto do mapa (a "Rua Livertino" de Goiás não é o que quem está em Uberlândia procura) */
const LOCAL_ONLY: ReadonlySet<GeocodeType> = new Set<GeocodeType>(['street', 'address', 'neighborhood']);
const LOCAL_MAX_M = 80_000;

/** cidades valem de qualquer lugar; rua/bairro longe some; o que está perto vem primeiro */
export function preferLocal(results: GeocodeResult[], center: { lat: number; lng: number } | null): GeocodeResult[] {
  if (!center) return results;
  const withDist = results.map((r, i) => ({ r, i, d: distanceMeters(center.lat, center.lng, r.lat, r.lng) }));
  return withDist
    .filter((x) => !(LOCAL_ONLY.has(x.r.type) && x.d > LOCAL_MAX_M))
    .sort((a, b) => Number(a.d > LOCAL_MAX_M) - Number(b.d > LOCAL_MAX_M) || a.i - b.i)
    .map((x) => x.r);
}

/**
 * Busca de bairros/ruas/cidades pra "ir até lá" no mapa: GET /geo/search do backend (nomes do OSM no nosso banco,
 * ou o Photon auto-hospedado). Só dispara com ≥ 3 caracteres; o texto deve chegar com debounce.
 */
export function useGeocodeSearch(q: string, proximity: { lat: number; lng: number } | null, enabled: boolean) {
  const text = q.trim();
  return useQuery({
    queryKey: ['geocode', text.toLowerCase(), proximity ? `${roundCoord(proximity.lat)},${roundCoord(proximity.lng)}` : ''],
    enabled: enabled && text.length >= 3,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    placeholderData: keepPreviousData,
    retry: 1,
    queryFn: async ({ signal }) => {
      const res = await api.get<GeoSearchResponse>('/geo/search', {
        signal,
        timeout: 8_000,
        params: {
          q: text,
          limit: 6,
          ...(proximity ? { lat: roundCoord(proximity.lat), lng: roundCoord(proximity.lng) } : {}),
        },
      });
      return preferLocal(fromGeoSearch(res.data.results ?? []), proximity);
    },
  });
}
