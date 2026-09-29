// Regras de privacidade da descoberta por proximidade (brief PRIVACIDADE).
//
// Princípio: o Cruzei não mostra ONDE alguém está; mostra QUEM está disponível pra interagir perto de você.
// Tudo aqui roda no servidor. O cliente nunca recebe coordenada real, distância numérica, timestamp preciso,
// direção, velocidade ou histórico de outra pessoa — só faixa de proximidade, tipo de presença e, quando é
// seguro, uma posição VISUAL anonimizada (centro da célula + deslocamento diário) ou o ponto do lugar (POI).
//
// Todos os limites são configuráveis por variável de ambiente (valores padrão abaixo).
import * as ngeohash from 'ngeohash';
import { createHmac } from 'node:crypto';
import { distanceMeters, offsetLatLng, positionJitter } from '@cruzei/shared-utils';

function envInt(name: string, def: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : def;
}

export const PRIVACY = {
  /** raio máximo da descoberta individual (m) — o cálculo exato fica no servidor */
  DISCOVERY_RADIUS_M: envInt('DISCOVERY_RADIUS_M', 350),
  /** carga: descobertas simultâneas por instância (o resto espera) e teto de pessoas por resposta */
  DISCOVERY_MAX_CONCURRENCY: envInt('DISCOVERY_MAX_CONCURRENCY', 16),
  DISCOVERY_MAX_USERS: envInt('DISCOVERY_MAX_USERS', 300),
  /** carga: quantas descobertas podem esperar vaga e por quanto tempo (ms) — além disso responde 503 na hora (o app tenta de novo) */
  DISCOVERY_MAX_QUEUE: envInt('DISCOVERY_MAX_QUEUE', 2_000),
  DISCOVERY_MAX_WAIT_MS: envInt('DISCOVERY_MAX_WAIT_MS', 15_000),
  /**
   * prazo de SEGURANÇA das flags de privacidade de um candidato (visível/anônimo, pausado, excluído, modo de
   * descoberta, mostrar foto/idade) em cache (ms). Quem muda alguma delas é esquecido NA HORA em todos os processos
   * (RedisService.invalidateProfile → canal de invalidação); o prazo só vale se o aviso se perder. Antes eram 5 s sem
   * aviso: com 40 mil pessoas, cada processo revalidava a região inteira a cada 5 s (centenas de milhares de linhas/s).
   */
  DISCOVERY_CANDIDATE_TTL_MS: envInt('DISCOVERY_CANDIDATE_TTL_MS', 60_000),
  /** o resto do perfil (nome, fotos, avatar, interesses) muda pouco e custa caro de carregar: reaproveita por mais tempo */
  DISCOVERY_PROFILE_TTL_MS: envInt('DISCOVERY_PROFILE_TTL_MS', 60_000),
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

// formatadores criados uma vez: construir um Intl.DateTimeFormat custa dezenas de µs e isso rodava a cada update
let hourFmt: Intl.DateTimeFormat | null = null;
let dateFmt: Intl.DateTimeFormat | null = null;

/** hora local (Brasília) — usada só pra aprender a célula de residência (madrugada) */
export function localHourBrazil(d = new Date()): number {
  hourFmt ??= new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false });
  const n = Number(hourFmt.format(d));
  return Number.isFinite(n) ? n % 24 : d.getUTCHours();
}

export function localDateBrazil(d = new Date()): string {
  dateFmt ??= new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
  return dateFmt.format(d);
}

/** arredonda pra grade grosseira (3 casas ≈ 110 m) — o histórico nunca guarda a posição fina */
export function coarse(v: number, decimals = PRIVACY.HISTORY_DECIMALS): number {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
}

// ---------------------------------------------------------------------------------------------
// Descoberta de lugares pela galera (brief 28/09): "muita gente fica no mesmo ponto" → lugar novo no mapa.
// Só AGREGADOS: HyperLogLog de hashes com chave (nunca o id cru) + contagens por sub-célula, apagados em 4 dias.
// O lugar publicado é SEMPRE um lugar público do catálogo (nome e ponto dele) — nunca um centro calculado de pessoas.
// ---------------------------------------------------------------------------------------------
function envNum(name: string, def: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : def;
}
function envFlag(name: string, def: boolean): boolean {
  const v = (process.env[name] ?? '').trim().toLowerCase();
  if (!v) return def;
  return ['1', 'true', 'on', 'yes', 'sim'].includes(v);
}

export const CROWD = {
  /** grava o sinal de multidão no caminho quente da localização */
  RECORD_ENABLED: envFlag('CROWD_RECORD_ENABLED', true),
  /** off = não roda; shadow = só registra "promoveria N"; on = publica */
  MODE: ((process.env.CROWD_MODE ?? 'on').trim().toLowerCase() as 'off' | 'shadow' | 'on'),
  /** janela de detecção (dias de Brasília) — igual à retenção do histórico, sem nova exceção de retenção */
  WINDOW_DAYS: envInt('CROWD_WINDOW_DAYS', 3),
  /** pessoas distintas num dia pra ele contar como "ativo" (acima do piso de anonimato 2) */
  MIN_DAILY: envInt('CROWD_MIN_DAILY', 3),
  MIN_ACTIVE_DAYS: envInt('CROWD_MIN_ACTIVE_DAYS', 2),
  /** pessoas distintas na janela inteira (maior que um grupo de amigos) */
  MIN_UNION: envInt('CROWD_MIN_UNION', 8),
  /** soma diária ÷ distintos: casa/escritório/escola repete as mesmas pessoas todo dia (≈ 2,5–3); bar ≈ 1,0–1,4 */
  MAX_REPEAT: envNum('CROWD_MAX_REPEAT', 1.6),
  /** fatia máxima de permanência de madrugada (04–08 h): madrugada parado = casa */
  NIGHT_MAX_SHARE: envNum('CROWD_NIGHT_MAX_SHARE', 0.35),
  /** só conta quem PERMANECE: X min na mesma célula (ou vizinha) — quem passa de carro/andando não conta */
  DWELL_MS: envInt('CROWD_DWELL_MIN', 8) * 60_000,
  /** conta nova precisa de X dias (ou selfie verificada) pra contar e pra contribuir; 0 no dev pra testar */
  MIN_ACCOUNT_AGE_D: envNum('CROWD_MIN_ACCOUNT_AGE_D', 7),
  /** raio (m) em volta de um lugar do catálogo pra atribuir a permanência a ele */
  VENUE_RADIUS_M: envInt('CROWD_VENUE_RADIUS_M', 45),
  /** fatia mínima da permanência da célula que um lugar precisa ter; dois lugares acima disso = ambíguo */
  VENUE_MIN_SHARE: envNum('CROWD_VENUE_MIN_SHARE', 0.3),
  /** chaves de multidão vivem janela + 1 dia */
  get KEY_TTL_S(): number {
    return (this.WINDOW_DAYS + 1) * 86_400;
  },
} as const;

/** precisão da célula de multidão (geohash-7 ≈ 153 m) e da sub-célula (geohash-8 ≈ 38 × 19 m) */
export const CROWD_CELL_PRECISION = 7;

/** hash com chave do id: o HyperLogLog nunca guarda o id cru (sem o LOCATION_SALT não dá pra testar "fulano esteve aqui") */
export function crowdMember(salt: string, userId: string): string {
  return createHmac('sha256', salt).update('crowd:' + userId).digest('base64url').slice(0, 16);
}

/** faixa do dia (Brasília): 0 = 04–08 h (madrugada/casa), 1 = 08–18 h, 2 = 18–04 h (noite) */
export function dwellBand(hour: number): 0 | 1 | 2 {
  if (hour >= 4 && hour < 8) return 0;
  if (hour >= 8 && hour < 18) return 1;
  return 2;
}

/** nunca podem aparecer numa resposta dos fluxos de contribuição (quem sugeriu, votou, quando, quantos) */
export const CONTRIBUTOR_KEYS = new Set(['userId', 'suggestedBy', 'voters', 'confirmations', 'createdAt', 'firstSeenOn', 'cell', 'reason', 'votes', 'count']);

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
