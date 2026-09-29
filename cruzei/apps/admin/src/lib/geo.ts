// Contas de mapa sem biblioteca (e testáveis): círculo do raio, enquadramento, colar coordenadas.

export interface LatLng {
  lat: number;
  lng: number;
}

/** Uberlândia: onde o Metch nasceu (centro padrão quando não há ponto) */
export const DEFAULT_CENTER: LatLng = { lat: -18.9186, lng: -48.2772 };

const EARTH_M = 6_371_008.8;

export function isValidLatLng(lat: number | null | undefined, lng: number | null | undefined): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
  );
}

/** anel [lng, lat] fechado de um círculo geodésico (bom o bastante até ~100 km) */
export function circleRing(center: LatLng, radiusM: number, steps = 64): [number, number][] {
  const lat1 = (center.lat * Math.PI) / 180;
  const lng1 = (center.lng * Math.PI) / 180;
  const d = radiusM / EARTH_M;
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const brng = (2 * Math.PI * (i % steps)) / steps;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng));
    const lng2 = lng1 + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    ring.push([round6((((lng2 * 180) / Math.PI + 540) % 360) - 180), round6((lat2 * 180) / Math.PI)]);
  }
  return ring;
}

/** [[oeste, sul], [leste, norte]] dos pontos válidos; null sem pontos */
export function boundsOf(points: readonly LatLng[]): [[number, number], [number, number]] | null {
  const valid = points.filter((p) => isValidLatLng(p.lat, p.lng));
  if (!valid.length) return null;
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const p of valid) {
    w = Math.min(w, p.lng);
    e = Math.max(e, p.lng);
    s = Math.min(s, p.lat);
    n = Math.max(n, p.lat);
  }
  return [
    [w, s],
    [e, n],
  ];
}

/**
 * Lê coordenadas coladas: "-18.9186, -48.2772", "-18,9186 -48,2772" ou um link com "@-18.91,-48.27".
 * Vírgula decimal só vale quando o par vem separado por espaço/ponto e vírgula.
 */
export function parseLatLng(text: string): LatLng | null {
  const t = text.trim();
  if (!t) return null;
  const at = /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/.exec(t);
  const dotted = /(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)/.exec(t);
  const commaDecimal = /(-?\d+,\d+)\s*[;\s]\s*(-?\d+,\d+)/.exec(t);
  const m = at ?? (commaDecimal && !/\./.test(t) ? commaDecimal : dotted);
  if (!m?.[1] || !m[2]) return null;
  const lat = Number(m[1].replace(',', '.'));
  const lng = Number(m[2].replace(',', '.'));
  return isValidLatLng(lat, lng) ? { lat, lng } : null;
}

export function formatLatLng(p: LatLng | null | undefined): string {
  if (!p || !isValidLatLng(p.lat, p.lng)) return '—';
  return `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
}

/** 800 → "800 m"; 2500 → "2,5 km"; 10000 → "10 km" */
export function formatRadius(m: number): string {
  if (!Number.isFinite(m)) return '—';
  if (m < 1000) return `${Math.round(m)} m`;
  const km = m / 1000;
  return `${km.toLocaleString('pt-BR', { maximumFractionDigits: km < 10 ? 1 : 0 })} km`;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
