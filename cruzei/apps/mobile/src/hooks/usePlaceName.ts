import { useQuery } from '@tanstack/react-query';
import type { GeoLabelResponse } from '@cruzei/shared-types';
import { decodeGeohash, encodeGeohash } from '@cruzei/shared-utils';
import { api } from '../services/api';

export const PLACE_NAME_FALLBACK = 'Por perto';

/** Monta 'Cidade · Bairro' a partir do GET /geo/label (exportado pra teste). */
export function placeNameFromLabel(res: Pick<GeoLabelResponse, 'city' | 'neighborhood'>): string | null {
  const { city, neighborhood: hood } = res;
  if (city && hood && city !== hood) return `${city} · ${hood}`;
  return city ?? hood ?? null;
}

async function fetchPlaceName(geohash: string): Promise<string | null> {
  // só o centro da célula geohash-6 (~1,2 km) sai do app: bairro/cidade não precisam de mais
  const c = decodeGeohash(geohash);
  const res = await api.get<GeoLabelResponse>('/geo/label', { timeout: 8_000, params: { lat: c.latitude, lng: c.longitude } });
  return placeNameFromLabel(res.data);
}

/**
 * Nome do lugar ('Uberlândia · Centro') pelo backend (polígonos de bairro do OSM no nosso banco), cacheado por
 * geohash precisão 6 (~1,2 km). Fallback 'Por perto' enquanto carrega, sem posição ou fora das áreas importadas.
 */
export function usePlaceName(lat: number | null, lng: number | null): string {
  const geohash = lat != null && lng != null ? encodeGeohash(lat, lng, 6) : null;

  const query = useQuery({
    queryKey: ['placeName', geohash],
    enabled: Boolean(geohash),
    staleTime: 10 * 60_000,
    gcTime: 60 * 60_000,
    retry: 1,
    queryFn: () => fetchPlaceName(geohash as string),
  });

  return query.data ?? PLACE_NAME_FALLBACK;
}
