import axios from 'axios';
import { useQuery } from '@tanstack/react-query';
import { encodeGeohash } from '@cruzei/shared-utils';
import { config } from '../config';

export const PLACE_NAME_FALLBACK = 'Por perto';

const GEOCODE_URL = 'https://api.mapbox.com/search/geocode/v6/reverse';

interface GeocodeContextEntry {
  name?: string;
}

interface GeocodeFeature {
  properties?: {
    feature_type?: string;
    name?: string;
    context?: {
      neighborhood?: GeocodeContextEntry;
      locality?: GeocodeContextEntry;
      place?: GeocodeContextEntry;
    };
  };
}

interface GeocodeResponse {
  features?: GeocodeFeature[];
}

/** Monta 'Cidade · Bairro' a partir da resposta do Geocoding v6 (exportado pra teste). */
export function placeNameFromGeocode(res: GeocodeResponse): string | null {
  const features = res.features ?? [];
  let city: string | undefined;
  let hood: string | undefined;

  for (const f of features) {
    const p = f.properties;
    if (!p) continue;
    const t = p.feature_type;
    if (t === 'place' && !city) city = p.name;
    if ((t === 'neighborhood' || t === 'locality') && !hood) hood = p.name;
    if (!city) city = p.context?.place?.name;
    if (!hood) hood = p.context?.neighborhood?.name ?? p.context?.locality?.name;
  }

  if (city && hood && city !== hood) return `${city} · ${hood}`;
  return city ?? hood ?? null;
}

/** ~1 km: bairro/cidade não precisam de mais que isso, e a posição fina não sai do app. */
const roundCoord = (v: number) => Math.round(v * 100) / 100;

async function fetchPlaceName(lat: number, lng: number): Promise<string | null> {
  // axios "cru" de propósito: o interceptor da api mandaria o Bearer do Cruzei pro Mapbox
  const res = await axios.get<GeocodeResponse>(GEOCODE_URL, {
    timeout: 8_000,
    params: {
      longitude: roundCoord(lng),
      latitude: roundCoord(lat),
      types: 'neighborhood,locality,place',
      language: 'pt',
      access_token: config.mapboxToken,
    },
  });
  return placeNameFromGeocode(res.data);
}

/**
 * Nome do lugar ('Uberlândia · Centro') via reverse geocode, cacheado por geohash precisão 6 (~1,2 km).
 * A coordenada enviada ao Mapbox é arredondada (~1 km) — o resultado é bairro/cidade, não precisa de mais.
 * Fallback 'Por perto' enquanto carrega, sem posição ou sem token.
 */
export function usePlaceName(lat: number | null, lng: number | null): string {
  const geohash = lat != null && lng != null ? encodeGeohash(lat, lng, 6) : null;

  const query = useQuery({
    queryKey: ['placeName', geohash],
    enabled: Boolean(geohash) && Boolean(config.mapboxToken),
    staleTime: 10 * 60_000,
    gcTime: 60 * 60_000,
    retry: 1,
    queryFn: () => fetchPlaceName(lat as number, lng as number),
  });

  return query.data ?? PLACE_NAME_FALLBACK;
}
