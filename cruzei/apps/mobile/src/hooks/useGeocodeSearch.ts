import axios from 'axios';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { config } from '../config';

const FORWARD_URL = 'https://api.mapbox.com/search/geocode/v6/forward';

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
}

interface ForwardFeature {
  id?: string;
  properties?: {
    name?: string;
    feature_type?: string;
    place_formatted?: string;
    full_address?: string;
    coordinates?: { longitude?: number; latitude?: number };
  };
}

const ZOOM_BY_TYPE: Record<GeocodeType, number> = {
  place: 12.5,
  locality: 14,
  neighborhood: 14.5,
  street: 16,
  address: 17,
  other: 15,
};

/** ~1 km: a proximidade enviada ao Mapbox é o centro do MAPA arredondado, nunca a posição fina de alguém */
const roundCoord = (v: number) => Math.round(v * 100) / 100;

export function parseForward(features: ForwardFeature[]): GeocodeResult[] {
  const out: GeocodeResult[] = [];
  for (const f of features) {
    const p = f.properties;
    const lat = p?.coordinates?.latitude;
    const lng = p?.coordinates?.longitude;
    if (!p?.name || typeof lat !== 'number' || typeof lng !== 'number') continue;
    const raw = p.feature_type ?? 'other';
    const type: GeocodeType = raw === 'place' || raw === 'locality' || raw === 'neighborhood' || raw === 'street' || raw === 'address' ? raw : 'other';
    out.push({
      id: f.id ?? `${lat},${lng}`,
      name: p.name,
      context: p.place_formatted ?? p.full_address ?? '',
      type,
      lat,
      lng,
      zoom: ZOOM_BY_TYPE[type],
    });
  }
  return out;
}

/**
 * Busca de lugares/bairros/ruas no Mapbox (Geocoding v6) pra "ir até lá" no mapa.
 * Só dispara com ≥ 3 caracteres e token configurado; o texto deve chegar com debounce.
 */
export function useGeocodeSearch(q: string, proximity: { lat: number; lng: number } | null, enabled: boolean) {
  const text = q.trim();
  return useQuery({
    queryKey: ['geocode', text.toLowerCase(), proximity ? `${roundCoord(proximity.lat)},${roundCoord(proximity.lng)}` : ''],
    enabled: enabled && text.length >= 3 && Boolean(config.mapboxToken),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    placeholderData: keepPreviousData,
    retry: 1,
    queryFn: async () => {
      // axios "cru" de propósito: o interceptor da api mandaria o Bearer do app pro Mapbox
      const res = await axios.get<{ features?: ForwardFeature[] }>(FORWARD_URL, {
        timeout: 8_000,
        params: {
          q: text,
          country: 'br',
          language: 'pt',
          limit: 6,
          types: 'place,locality,neighborhood,street,address',
          ...(proximity ? { proximity: `${roundCoord(proximity.lng)},${roundCoord(proximity.lat)}` } : {}),
          access_token: config.mapboxToken,
        },
      });
      return parseForward(res.data.features ?? []);
    },
  });
}
