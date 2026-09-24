// Distância APROXIMADA (privacidade): nunca expor 37 m / 43 m; só degraus 50 / 100 / 250 / 500 / 1 km...
// Usado no backend (payloads) e no app (rótulos) — os dois lados falam a mesma coisa.

const STEPS_M = [50, 100, 250, 500, 1000];

/** Arredonda pra cima pro degrau de privacidade (metros). */
export function approxDistanceM(distanceM: number): number {
  if (!Number.isFinite(distanceM) || distanceM < 0) return 50;
  for (const step of STEPS_M) if (distanceM <= step) return step;
  if (distanceM <= 5000) return Math.ceil(distanceM / 500) * 500;
  return Math.ceil(distanceM / 1000) * 1000;
}

/** '~100 m' | '~1 km' | '~2,5 km' */
export function formatApproxDistance(distanceM: number): string {
  const m = approxDistanceM(distanceM);
  if (m < 1000) return `~${m} m`;
  const km = m / 1000;
  return `~${Number.isInteger(km) ? km : km.toFixed(1).replace('.', ',')} km`;
}

/**
 * Deslocamento determinístico (metros) pra "borrar" a posição de alguém.
 * A seed é montada pelo caller (backend) como `${LOCATION_SALT}:${diaUTC}:${userId}`: mesma seed → mesmo
 * deslocamento (repetir requests no mesmo dia não triangula), e o dia na seed rotaciona o deslocamento
 * a cada 24h (não dá pra acumular histórico). O salt impede recalcular o deslocamento fora do servidor.
 */
export function positionJitter(seed: string, minM = 20, maxM = 60): { dNorthM: number; dEastM: number } {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const angle = ((h % 3600) / 3600) * Math.PI * 2;
  const dist = minM + ((h >>> 12) % Math.max(1, maxM - minM));
  return { dNorthM: dist * Math.cos(angle), dEastM: dist * Math.sin(angle) };
}

/** Aplica um deslocamento em metros a uma coordenada. */
export function offsetLatLng(lat: number, lng: number, dNorthM: number, dEastM: number): { lat: number; lng: number } {
  const dLat = dNorthM / 111_320;
  const dLng = dEastM / (111_320 * Math.cos((lat * Math.PI) / 180));
  return { lat: lat + dLat, lng: lng + dLng };
}

/** Arredonda a coordenada pra uma grade (~11 m em 4 casas) — junto com o jitter, some a posição exata. */
export function snapLatLng(lat: number, lng: number, decimals = 4): { lat: number; lng: number } {
  const f = 10 ** decimals;
  return { lat: Math.round(lat * f) / f, lng: Math.round(lng * f) / f };
}
