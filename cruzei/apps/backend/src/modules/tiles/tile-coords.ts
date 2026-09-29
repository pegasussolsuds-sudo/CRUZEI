/** Coordenadas de tile XYZ (esquema do MapLibre/OSM: y cresce pro sul) e utilidades HTTP dos tiles. */
export interface TileCoords {
  z: number;
  x: number;
  y: number;
}

/** maior zoom aceito na URL (o MapLibre não pede acima de 24); acima disso é 400 */
export const MAX_TILE_ZOOM = 24;

// só dígitos, sem zero à esquerda nem sinal (nada de "1e3", "0x10", " 12", "+3")
const Z_RE = /^(0|[1-9][0-9]?)$/;
const XY_RE = /^(0|[1-9][0-9]{0,7})$/;

/** z/x/y da URL → inteiros dentro da faixa do zoom; null = inválido */
export function parseTileCoords(zRaw: unknown, xRaw: unknown, yRaw: unknown): TileCoords | null {
  if (typeof zRaw !== 'string' || typeof xRaw !== 'string' || typeof yRaw !== 'string') return null;
  if (!Z_RE.test(zRaw) || !XY_RE.test(xRaw) || !XY_RE.test(yRaw)) return null;
  const z = Number(zRaw);
  const x = Number(xRaw);
  const y = Number(yRaw);
  if (z > MAX_TILE_ZOOM) return null;
  const n = 2 ** z;
  if (x >= n || y >= n) return null;
  return { z, x, y };
}

/** caixa [oeste, sul, leste, norte] (graus) do tile, com margem em fração do tile */
export type LngLatBox = [number, number, number, number];

export function tileBounds({ z, x, y }: TileCoords, margin = 0): LngLatBox {
  const n = 2 ** z;
  const lng = (tx: number) => (tx / n) * 360 - 180;
  const lat = (ty: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n))) * 180) / Math.PI;
  return [lng(x - margin), lat(y + 1 + margin), lng(x + 1 + margin), lat(y - margin)];
}

export function boxesIntersect(a: LngLatBox, b: LngLatBox): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}

/** metros de Web Mercator por unidade do tile (extent) no zoom z */
export function mercatorUnit(z: number, extent: number): number {
  return 40_075_016.685_578_49 / 2 ** z / extent;
}

/** Accept-Encoding aceita gzip? (gzip ou *, sem q=0) */
export function acceptsGzip(header: string | string[] | undefined): boolean {
  const raw = Array.isArray(header) ? header.join(',') : (header ?? '');
  let star: boolean | null = null;
  for (const part of raw.split(',')) {
    const [name, ...params] = part.trim().toLowerCase().split(';');
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    const ok = !q || Number(q.slice(2)) > 0;
    if (name === 'gzip' || name === 'x-gzip') return ok;
    if (name === '*') star = ok;
  }
  return star === true;
}

/** If-None-Match bate com a ETag? (comparação fraca: ignora o W/) */
export function etagMatches(header: string | string[] | undefined, etag: string): boolean {
  const raw = Array.isArray(header) ? header.join(',') : header;
  if (!raw) return false;
  const opaque = (t: string) => t.trim().replace(/^W\//, '');
  const mine = opaque(etag);
  return raw.split(',').some((t) => t.trim() === '*' || opaque(t) === mine);
}
