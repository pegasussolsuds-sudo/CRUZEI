import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { encodeGeohash } from '@cruzei/shared-utils';
import type { VibeFilter, VibeResponse } from '@cruzei/shared-types';
import { api } from '../services/api';

export const VIBE_RADIUS_M = 8000;

export interface VibeParams {
  /** centro da busca (centro do mapa); null = sem posição ainda */
  center: { lat: number; lng: number } | null;
  /** minha posição — o filtro "perto de mim" só roda com ela (nunca cai no centro do mapa) */
  myLocation: { lat: number; lng: number } | null;
  filter: VibeFilter;
  /** texto já com debounce */
  q: string;
  category: string | null;
  enabled: boolean;
  /** atualização periódica (desligue com o app em background) — default true */
  polling?: boolean;
}

/** de onde a busca parte, pela mesma regra do servidor: "perto de mim" = eu; o resto = centro do mapa */
export function vibeOrigin(filter: VibeFilter, center: VibeParams['center'], myLocation: VibeParams['myLocation']) {
  return filter === 'near' ? myLocation : center;
}

/**
 * GET /pois/vibe — lugares ranqueados pela energia ao vivo (gente agora, tendência, eventos).
 * Cache por célula do centro (~1,2 km) + filtro + texto; enquanto o overlay está aberto, atualiza a cada 45 s.
 */
export function useVibe({ center, myLocation, filter, q, category, enabled, polling = true }: VibeParams) {
  const origin = vibeOrigin(filter, center, myLocation);
  const cell = origin ? encodeGeohash(origin.lat, origin.lng, 6) : null;
  const text = q.trim().toLowerCase();

  return useQuery({
    queryKey: ['vibe', cell, filter, text, category ?? ''],
    enabled: enabled && Boolean(origin),
    staleTime: 20_000,
    refetchInterval: enabled && polling ? 45_000 : false,
    placeholderData: keepPreviousData,
    retry: 1,
    queryFn: async () => {
      const o = origin as { lat: number; lng: number };
      const res = await api.get<VibeResponse>('/pois/vibe', {
        params: {
          lat: o.lat,
          lng: o.lng,
          radius_meters: VIBE_RADIUS_M,
          filter,
          ...(text ? { q: text } : {}),
          ...(category ? { category } : {}),
          limit: 40,
        },
      });
      return res.data;
    },
  });
}
