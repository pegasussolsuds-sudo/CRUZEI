// Posição do PRÓPRIO usuário como vai pro POST /location/update (puro: sem expo-location, testável).
// GPS falso (GPS_GUARD no servidor): o Android diz quando a posição veio de um app de GPS falso (mocked) e o servidor
// checa saltos impossíveis. Posição velha do cache do sistema parece "teletransporte": não vai pro servidor.

export type CruzeiLocation = {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  /** Android: posição simulada (LocationObject.mocked); iOS não informa */
  mocked?: boolean;
  /** última posição conhecida do sistema com mais de FIX_MAX_AGE_MS: só atualiza a tela, não vai pro servidor */
  stale?: boolean;
};

/** posição do cache do sistema (getLastKnownPositionAsync) só vale se tiver até 5 min */
export const FIX_MAX_AGE_MS = 5 * 60_000;
/** 'location_unverified' (salto ainda não confirmado): o app manda um fix novo a cada ~50 s, até 3 vezes */
export const UNVERIFIED_RETRY_MS = 50_000;
export const UNVERIFIED_MAX_RETRIES = 3;

interface PositionLike {
  coords: { latitude: number; longitude: number; accuracy?: number | null };
  timestamp?: number;
  mocked?: boolean;
}

/** LocationObject do expo-location → CruzeiLocation (mocked só quando o sistema diz que sim) */
export function toCruzeiLocation(pos: PositionLike, opts: { lastKnown?: boolean; now?: number } = {}): CruzeiLocation {
  const loc: CruzeiLocation = {
    latitude: pos.coords.latitude,
    longitude: pos.coords.longitude,
    accuracyMeters: Math.round(pos.coords.accuracy ?? 0),
  };
  if (pos.mocked === true) loc.mocked = true;
  if (opts.lastKnown && !isFreshFix(pos.timestamp, opts.now)) loc.stale = true;
  return loc;
}

/** sem horário = não dá pra saber a idade: trata como velha */
export function isFreshFix(timestamp: number | undefined, now = Date.now(), maxAgeMs = FIX_MAX_AGE_MS): boolean {
  return typeof timestamp === 'number' && Number.isFinite(timestamp) && now - timestamp <= maxAgeMs;
}

/**
 * Corpo do POST /location/update: só os campos que o servidor aceita (o ValidationPipe recusa campo a mais).
 * `mocked` só vai quando é true — backend antigo (sem o campo) não quebra o envio de todo mundo.
 */
export function locationUpdateBody(loc: CruzeiLocation): { latitude: number; longitude: number; accuracyMeters?: number; mocked?: true } {
  const body: { latitude: number; longitude: number; accuracyMeters?: number; mocked?: true } = { latitude: loc.latitude, longitude: loc.longitude };
  if (loc.accuracyMeters != null && loc.accuracyMeters > 0) body.accuracyMeters = loc.accuracyMeters;
  if (loc.mocked === true) body.mocked = true;
  return body;
}
