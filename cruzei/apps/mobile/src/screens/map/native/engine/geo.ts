// Geometria simples em Web Mercator pro motor do mapa. O MLRN só projeta pontos por chamada assíncrona ao nativo;
// aqui fica o que precisa ser síncrono (LOD, deslocamento de câmera, enquadramento do match), aproximado mas estável.

export type LngLat = [number, number];

const EARTH_M = 111_320;
/** o MapLibre usa tiles de 512 px: metros por pixel no equador no zoom 0 */
const MPP_Z0 = 78_271.517;
/** tamanho do mundo em px no zoom 0 (tiles de 512) */
const WORLD_PX = 512;

export function distM(a: LngLat, b: LngLat): number {
  const dy = (b[1] - a[1]) * EARTH_M;
  const dx = (b[0] - a[0]) * EARTH_M * Math.cos((a[1] * Math.PI) / 180);
  return Math.sqrt(dx * dx + dy * dy);
}

export function metersPerPixel(lat: number, zoom: number): number {
  return (MPP_Z0 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, zoom);
}

/** desloca um ponto em metros (leste, norte) */
export function offsetMeters(p: LngLat, east: number, north: number): LngLat {
  const lat = p[1] + north / EARTH_M;
  const lng = p[0] + east / (EARTH_M * Math.cos((p[1] * Math.PI) / 180));
  return [lng, lat];
}

/**
 * Centro de câmera que deixa `target` `upPx` pixels ACIMA do ponto focal (o antigo `offset: [0, -upPx]` do easeTo).
 * Com pitch, um pixel de tela perto do centro cobre 1/cos(pitch) pixels de chão na direção do olhar; a direção "pra
 * cima" da tela é o bearing. Aproximação boa pro miolo da tela, que é onde isso é usado.
 */
export function offsetCenter(target: LngLat, upPx: number, zoom: number, bearing: number, pitch: number): LngLat {
  // pitch real nunca passa de 60 (teto do MapLibre Android): o enquadramento usa o mesmo teto
  const cosP = Math.max(0.2, Math.cos((Math.min(pitch, 60) * Math.PI) / 180));
  const d = (upPx * metersPerPixel(target[1], zoom)) / cosP;
  const b = (bearing * Math.PI) / 180;
  // o centro fica "atrás" do alvo na direção do olhar
  return offsetMeters(target, -d * Math.sin(b), -d * Math.cos(b));
}

function mercX(lng: number): number {
  return (lng + 180) / 360;
}
function mercY(lat: number): number {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}

/**
 * Zoom que enquadra dois pontos numa área útil (viewport menos padding), limitado a maxZoom — o cameraForBounds do GL JS.
 * O pitch entra só como encurtamento vertical (cos), aproximação boa pro miolo da tela.
 */
export function fitZoom(a: LngLat, b: LngLat, width: number, height: number, pad: { top: number; bottom: number; left: number; right: number }, maxZoom: number, pitch = 0): number {
  const w = Math.max(40, width - pad.left - pad.right);
  const h = Math.max(40, height - pad.top - pad.bottom);
  const dx = Math.abs(mercX(a[0]) - mercX(b[0])) * WORLD_PX;
  // com pitch, um pixel vertical de tela cobre ~1/cos(pitch) de chão: a distância vertical "encolhe" na tela
  const dy = Math.abs(mercY(a[1]) - mercY(b[1])) * WORLD_PX * Math.cos((Math.min(pitch, 60) * Math.PI) / 180);
  const zx = dx > 0 ? Math.log2(w / dx) : maxZoom;
  const zy = dy > 0 ? Math.log2(h / dy) : maxZoom;
  return Math.min(maxZoom, zx, zy);
}

/** centro geográfico que, com o padding dado, põe o meio dos pontos no centro da área útil */
export function midpoint(a: LngLat, b: LngLat): LngLat {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

export interface VisibleBounds {
  ne: LngLat;
  sw: LngLat;
}

/** está dentro dos limites visíveis (expandidos por `grow` de cada lado, fração do tamanho) */
export function inBounds(p: LngLat, b: VisibleBounds | null, grow = 0): boolean {
  if (!b) return true;
  const w = b.ne[0] - b.sw[0];
  const h = b.ne[1] - b.sw[1];
  return p[0] >= b.sw[0] - w * grow && p[0] <= b.ne[0] + w * grow && p[1] >= b.sw[1] - h * grow && p[1] <= b.ne[1] + h * grow;
}

export function isFiniteLngLat(p: unknown): p is LngLat {
  return Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]);
}
