import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { PlaceCategoryKey, PlaceSearchResponse } from '@cruzei/shared-types';
import { distanceMeters } from '@cruzei/shared-utils';
import { api } from '../services/api';

const PLACE_SEARCH_LIMIT = 10;

export interface PlaceSearchParams {
  /** texto já com debounce (>=2 chars). Vazio desliga. */
  q: string;
  /** chip de categoria do overlay (🍻 Bares etc.) — null = sem filtro */
  category: PlaceCategoryKey | null;
  /** centro do mapa (proximity=map) — sempre presente quando a overlay está aberta */
  mapCenter: { lat: number; lng: number } | null;
  /** minha posição (filtro "perto de mim") — opcional */
  myLocation: { lat: number; lng: number } | null;
  enabled: boolean;
}

/**
 * GET /v1/places/search: bares, baladas, restaurantes e outros lugares reais da cidade (Mapbox Search Box, via servidor).
 * Com texto busca pelo nome ("zenaide", "hub"); só com o chip lista os mais perto daquela categoria.
 * Cache por texto + categoria + célula do centro (~1 km); o debounce vem de quem chama.
 */
export function usePlaceSearch({ q, category, mapCenter, myLocation, enabled }: PlaceSearchParams) {
  const typed = q.trim();
  // uma letra só não busca nome; com chip ligado, vale a categoria sozinha
  const text = typed.length >= 2 ? typed : '';
  // busca em volta do que a pessoa está vendo (ela pode ter arrastado o mapa pra outro bairro ou cidade)
  const center = mapCenter ?? myLocation;
  // chave com a célula do centro (~1 km): cache por região, não por coordenada exata
  const cell = center ? `${Math.round(center.lat * 100) / 100},${Math.round(center.lng * 100) / 100}` : '';
  return useQuery({
    queryKey: ['places', 'search', text.toLowerCase(), category ?? '', cell] as const,
    enabled: enabled && (text.length >= 2 || Boolean(category)) && Boolean(center),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    placeholderData: keepPreviousData,
    retry: 1,
    queryFn: async ({ signal }) => {
      const o = center as { lat: number; lng: number };
      const res = await api.get<PlaceSearchResponse>('/places/search', {
        signal,
        params: {
          ...(text ? { q: text } : {}),
          ...(category ? { category } : {}),
          lat: o.lat,
          lng: o.lng,
          proximity: mapCenter ? 'map' : 'me',
          limit: PLACE_SEARCH_LIMIT,
        },
      });
      return res.data;
    },
    // distância mostrada é sempre a partir de mim (quando sei onde estou), não do centro do mapa
    select: (data) =>
      myLocation
        ? { ...data, places: data.places.map((p) => ({ ...p, distanceM: Math.round(distanceMeters(myLocation.lat, myLocation.lng, p.latitude, p.longitude)) })) }
        : data,
  });
}

/** devolve true se deve disparar a busca genérica (chip de categoria ligado OU texto com >=2 chars). */
export function shouldSearchPlaces(q: string, category: PlaceCategoryKey | null): boolean {
  return q.trim().length >= 2 || Boolean(category);
}
