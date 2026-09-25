// Regras de privacidade da descoberta por proximidade (brief PRIVACIDADE).
//
// Princípio: o Cruzei não mostra ONDE alguém está; mostra QUEM está disponível pra interagir perto de você.
// Tudo aqui roda no servidor. O cliente nunca recebe coordenada real, distância numérica, timestamp preciso,
// direção, velocidade ou histórico de outra pessoa — só faixa de proximidade, tipo de presença e, quando é
// seguro, uma posição VISUAL anonimizada (centro da célula + deslocamento diário) ou o ponto do lugar (POI).
//
// Todos os limites são configuráveis por variável de ambiente (valores padrão abaixo).
import * as ngeohash from 'ngeohash';
import { distanceMeters, offsetLatLng, positionJitter } from '@cruzei/shared-utils';

function envInt(name: string, def: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : def;
}

export const PRIVACY = {
  /** raio máximo da descoberta individual (m) — o cálculo exato fica no servidor */
  DISCOVERY_RADIUS_M: envInt('DISCOVERY_RADIUS_M', 350),
  /** limites das faixas: 0–100 muito perto, 100–250 perto, 250–raio na região */
  BAND_VERY_NEAR_M: envInt('DISCOVERY_BAND_VERY_NEAR_M', 100),
  BAND_NEAR_M: envInt('DISCOVERY_BAND_NEAR_M', 250),
  /** célula da posição visual: geohash precisão 7 ≈ 153 m × 153 m */
  CELL_PRECISION: envInt('DISCOVERY_CELL_PRECISION', 7),
  /** deslocamento diário máximo (m) a partir do centro da célula — espalha os pins sem sair da célula */
  CELL_JITTER_M: envInt('DISCOVERY_CELL_JITTER_M', 35),
  /** área de anonimato: geohash precisão 6 ≈ 1,2 km × 0,6 km; abaixo de MIN_AREA_K pessoas visíveis ali, ninguém ganha marcador individual */
  AREA_PRECISION: envInt('DISCOVERY_AREA_PRECISION', 6),
  MIN_AREA_K: envInt('DISCOVERY_MIN_AREA_K', 2),
  /** mínimo de pessoas num lugar (POI) pra nomear quem está lá */
  MIN_PLACE_K: envInt('DISCOVERY_MIN_PLACE_K', 2),
  /** presença expira (s) — quem não atualizou some da descoberta */
  PRESENCE_TTL_S: envInt('DISCOVERY_PRESENCE_TTL_S', 7_200),
  /** intervalo mínimo entre atualizações de posição aceitas (s) — anti-trilha */
  MIN_UPDATE_INTERVAL_S: envInt('DISCOVERY_MIN_UPDATE_INTERVAL_S', 20),
  /** "online" = atualizou há menos de X min; "recente" = menos de Y min; depois = "mais cedo" */
  ONLINE_MIN: envInt('DISCOVERY_ONLINE_MIN', 15),
  RECENT_MIN: envInt('DISCOVERY_RECENT_MIN', 60),
  /** residência automática: X noites (00h–06h, horário de Brasília) na mesma célula → área privada automática */
  HOME_MIN_NIGHTS: envInt('DISCOVERY_HOME_MIN_NIGHTS', 3),
  HOME_LEARN_DAYS: envInt('DISCOVERY_HOME_LEARN_DAYS', 45),
  /** área privada manual: raio permitido (m) */
  PRIVATE_AREA_MIN_RADIUS_M: envInt('PRIVATE_AREA_MIN_RADIUS_M', 50),
  PRIVATE_AREA_MAX_RADIUS_M: envInt('PRIVATE_AREA_MAX_RADIUS_M', 1_000),
  PRIVATE_AREA_DEFAULT_RADIUS_M: envInt('PRIVATE_AREA_DEFAULT_RADIUS_M', 150),
  PRIVATE_AREAS_MAX: envInt('PRIVATE_AREAS_MAX', 5),
  /** histórico de posição (grosseiro) no Postgres: casas decimais e retenção após expirar */
  HISTORY_DECIMALS: envInt('LOCATION_HISTORY_DECIMALS', 3),
  HISTORY_RETENTION_DAYS: envInt('LOCATION_HISTORY_RETENTION_DAYS', 3),
} as const;

export type ProximityBand = 'very_near' | 'near' | 'region';
export type PresenceType = 'place' | 'nearby';
export type LastSeen = 'online' | 'recent' | 'earlier';
export type HiddenReason = 'anonymous' | 'private_area' | 'home' | 'nobody' | 'no_presence' | 'paused';

export function proximityBand(distM: number): ProximityBand {
  if (distM <= PRIVACY.BAND_VERY_NEAR_M) return 'very_near';
  if (distM <= PRIVACY.BAND_NEAR_M) return 'near';
  return 'region';
}

export function lastSeenBand(updatedAt: number | null): LastSeen {
  if (!updatedAt) return 'earlier';
  const age = Date.now() - updatedAt;
  if (age < PRIVACY.ONLINE_MIN * 60_000) return 'online';
  if (age < PRIVACY.RECENT_MIN * 60_000) return 'recent';
  return 'earlier';
}

export function cellOf(lat: number, lng: number, precision = PRIVACY.CELL_PRECISION): string {
  return ngeohash.encode(lat, lng, precision);
}

export function cellCenter(cell: string): { lat: number; lng: number } {
  const d = ngeohash.decode(cell);
  return { lat: d.latitude, lng: d.longitude };
}

/** célula + vizinhas (quem mora na borda de uma célula oscila entre duas) */
export function cellWithNeighbors(cell: string): string[] {
  return [cell, ...ngeohash.neighbors(cell)];
}

/**
 * Posição VISUAL de alguém fora de um lugar: centro da célula (~150 m) + deslocamento determinístico do dia.
 * Não depende da posição real dentro da célula: andar 100 m dentro da mesma célula não move o pin; trocar de
 * célula move o pin pro centro da nova. Repetir consultas não refina nada além da célula.
 */
export function anonymizedCellPosition(seed: string, cell: string): { lat: number; lng: number } {
  const c = cellCenter(cell);
  const j = positionJitter(seed, 0, PRIVACY.CELL_JITTER_M);
  return offsetLatLng(c.lat, c.lng, j.dNorthM, j.dEastM);
}

/** Posição VISUAL de quem está num lugar: o ponto do lugar + deslocamento pequeno (só espalha os pins no bar). */
export function anonymizedPlacePosition(seed: string, poi: { lat: number; lng: number }): { lat: number; lng: number } {
  const j = positionJitter(seed, 8, 25);
  return offsetLatLng(poi.lat, poi.lng, j.dNorthM, j.dEastM);
}

export interface PrivateAreaLike {
  latitude: number;
  longitude: number;
  radiusM: number;
}

export function insidePrivateArea(lat: number, lng: number, areas: PrivateAreaLike[]): boolean {
  return areas.some((a) => distanceMeters(lat, lng, a.latitude, a.longitude) <= a.radiusM);
}

/** hora local (Brasília) — usada só pra aprender a célula de residência (madrugada) */
export function localHourBrazil(d = new Date()): number {
  const h = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }).format(d);
  const n = Number(h);
  return Number.isFinite(n) ? n % 24 : d.getUTCHours();
}

export function localDateBrazil(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** arredonda pra grade grosseira (3 casas ≈ 110 m) — o histórico nunca guarda a posição fina */
export function coarse(v: number, decimals = PRIVACY.HISTORY_DECIMALS): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

/** varre um objeto e devolve as chaves proibidas encontradas (usado pelos testes de segurança e pelo guard de resposta) */
export const FORBIDDEN_CLIENT_KEYS = new Set([
  'latitude', 'longitude', 'lat', 'lng', 'preciseLatitude', 'preciseLongitude', 'exactDistance', 'distanceM', 'distance',
  'locationHistory', 'previousCoordinates', 'heading', 'speed', 'movementHistory', 'routeHistory', 'recordedAt', 'coordinates', 'geohash',
]);
export function findForbiddenKeys(value: unknown, path = '', out: string[] = [], allowUnder: RegExp = /^(mapPosition|poi|pois|place)(\.|$)/): string[] {
  if (Array.isArray(value)) {
    value.forEach((v, i) => findForbiddenKeys(v, `${path}[${i}]`, out, allowUnder));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const p = path ? `${path}.${k}` : k;
      const leaf = p.replace(/\[\d+\]/g, '');
      if (FORBIDDEN_CLIENT_KEYS.has(k) && !allowUnder.test(leaf.split('.').slice(-2).join('.')) && !allowUnder.test(leaf)) out.push(p);
      findForbiddenKeys(v, p, out, allowUnder);
    }
  }
  return out;
}
