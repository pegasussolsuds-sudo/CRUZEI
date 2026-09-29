// Paletas Day/Dusk/Night do mapa (docs 06/17) e a luz 3D "assada" nas cores.
//
// O WebView ligava luzes v3 (map.setLights: ambiente + direcional, mapbox-html.ts:254-259) que multiplicavam a cor de
// fundo, fill, line, circle e prédios — é o que deixava a noite escura e roxa. O @rnmapbox/maps não expõe setLights,
// então a mesma conta roda aqui, uma vez por tema, e o BaseTheme já manda a cor final pro estilo.
//
// Fórmula = shader do GL JS v3.7 (_prelude_lighting.glsl: apply_lighting_with_emission_ground + calculateGroundRadiance):
//   ambienteLin = cor_ambiente^2.2 * intensidade; direcionalLin = cor_dir^2.2 * intensidade
//   radianciaLin = ambienteLin * fatorAmbiente + direcionalLin * dir.z
//   radianciaSrgb = radianciaLin^(1/2.2)          (por canal)
//   cor final = clamp(cor * radianciaSrgb, 0, 1)   (emissive 0; com emissive e: mix(cor * rad, cor, e))
// Chão (normal 0,0,1): fatorAmbiente = 1 (NdotL + 1 ≥ 1 e fator vertical 1) e dir.z = cos(polar).
//
// Radiância resultante (r, g, b):
//   day   ≈ 1.135, 1.125, 1.093  → > 1: clareia e satura (o fundo #E8F5E8 vira #FFFFFE, como era no WebView)
//   dusk  ≈ 0.974, 0.730, 0.844  (fundo #3A2A44 → #391F39)
//   night ≈ 0.628, 0.391, 0.681  → escurece puxando pro magenta (fundo #0A0A1A → #060412, branco → #A064AE)
//
// NÃO recebem luz (emissive 1 no original, ou fora do pipeline de luz): camadas cz-* do Metch, o neon (cz-glow-*), o
// céu/neblina e os símbolos do estilo base — no GL JS v3.7 text-emissive-strength e icon-emissive-strength têm default 1,
// então textos e ícones maki nunca foram escurecidos.

import type { MapTheme } from '../../bridge';

export type Rgb = readonly [number, number, number];

export interface Palette {
  bg: string;
  water: string;
  park: string;
  parkAlpha: number;
  landuse: string;
  road: string;
  roadCase: string;
  primary: string;
  secondary: string;
  highway: string;
  /** prédio 3D na base (altura 0) e no topo (60 m+) */
  bBase: string;
  bTop: string;
  text: string;
  halo: string;
  /** opacidade do neon das ruas (0 = desligado) */
  glow: number;
  /** neblina: [color, high-color, space-color] */
  fog: readonly [string, string, string];
  star: number;
  /** luz ambiente: [cor, intensidade] */
  ambient: readonly [string, number];
  /** luz direcional: [cor, intensidade] */
  dir: readonly [string, number];
}

// cópia exata de mapbox-html.ts:90-100
// prettier-ignore
export const PALETTES: Record<MapTheme, Palette> = {
  day:   { bg:'#E8F5E8', water:'#40E0D0', park:'#7FFF00', parkAlpha:0.55, landuse:'#E1EBDD', road:'#FFFFFF', roadCase:'#D6DCD6', primary:'#FFD700', secondary:'#FFF1B8', highway:'#FF6B6B',
           bBase:'#D4D4AA', bTop:'#FAFAFA', text:'#0A0A1A', halo:'#FAFAFA', glow:0.0, fog:['#E8F5E8','#CFE9FF','#DDE8FF'], star:0,
           ambient:['#FFFFFF',0.9], dir:['#FFF8E0',0.55] },
  dusk:  { bg:'#3A2A44', water:'#1E5B6B', park:'#3E7A2A', parkAlpha:0.7, landuse:'#3E3050', road:'#7A6A8A', roadCase:'#2E2438', primary:'#FF7AB8', secondary:'#9A5A88', highway:'#B8FF6B',
           bBase:'#4A3A5E', bTop:'#8A7AA0', text:'#FAFAFA', halo:'#1A1A2A', glow:0.18, fog:['#3A2A44','#FF6B9A','#1A1A2E'], star:0.2,
           ambient:['#FFD1E8',0.6], dir:['#FF9AC8',0.45] },
  night: { bg:'#0A0A1A', water:'#0A3D4D', park:'#1A4D1A', parkAlpha:0.85, landuse:'#101024', road:'#2A2A3A', roadCase:'#12121E', primary:'#FF1493', secondary:'#5A2452', highway:'#7FFF00',
           bBase:'#1A1A2A', bTop:'#3A3A5A', text:'#FAFAFA', halo:'#0A0A1A', glow:0.35, fog:['#0A0A1A','#1A1A3A','#05050F'], star:0.55,
           ambient:['#8AA0FF',0.35], dir:['#FF1493',0.35] },
};

/** direção da luz direcional do original: [azimute 210°, polar 40°] (mapbox-html.ts:257) */
const SUN_POLAR_DEG = 40;
/** z do vetor da luz (sphericalDirectionToCartesian do GL JS): cos(polar); o azimute não entra na conta do chão */
const SUN_DIR_Z = Math.cos((SUN_POLAR_DEG * Math.PI) / 180);
/** gama que o GL JS usa pra ir e voltar do linear (pow 2.2, não a curva sRGB exata) */
const GAMMA = 2.2;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** '#RGB' ou '#RRGGBB' -> [r, g, b] em 0..1; null se não for hex */
function parseHex(hex: string): Rgb | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function hslToRgb(hDeg: number, s: number, l: number): Rgb {
  const h = (((hDeg % 360) + 360) % 360) / 360;
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number): number => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };
  return [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)];
}

/** cor CSS do estilo ('#hex', 'rgb[a](...)', 'hsl[a](...)') -> rgb 0..1 + alfa; null se não for cor */
function parseCssColor(css: string): { rgb: Rgb; a: number } | null {
  const hex = parseHex(css);
  if (hex) return { rgb: hex, a: 1 };
  const m = /^\s*(rgba?|hsla?)\(\s*([^)]*)\)\s*$/i.exec(css);
  if (!m) return null;
  const parts = m[2].split(',').map((s) => s.trim());
  if (parts.length < 3 || parts.length > 4) return null;
  const nums = parts.map((s) => parseFloat(s));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const a = parts.length === 4 ? clamp01(nums[3]) : 1;
  if (m[1].toLowerCase().startsWith('rgb')) {
    return { rgb: [clamp01(nums[0] / 255), clamp01(nums[1] / 255), clamp01(nums[2] / 255)], a };
  }
  return { rgb: hslToRgb(nums[0], clamp01(nums[1] / 100), clamp01(nums[2] / 100)), a };
}

const to255 = (v: number): number => Math.round(clamp01(v) * 255);

function toHex(rgb: Rgb): string {
  return (
    '#' +
    rgb
      .map((v) => to255(v).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

/** radiância do chão em sRGB (u_ground_radiance do GL JS) */
function computeGroundRadiance(p: Palette): Rgb {
  const amb = parseHex(p.ambient[0]) ?? [1, 1, 1];
  const dir = parseHex(p.dir[0]) ?? [1, 1, 1];
  const channel = (i: 0 | 1 | 2): number => {
    const ambientLin = Math.pow(amb[i], GAMMA) * p.ambient[1];
    const dirLin = Math.pow(dir[i], GAMMA) * p.dir[1];
    return Math.pow(ambientLin * 1 + dirLin * SUN_DIR_Z, 1 / GAMMA);
  };
  return [channel(0), channel(1), channel(2)];
}

const RADIANCE: Record<MapTheme, Rgb> = {
  day: computeGroundRadiance(PALETTES.day),
  dusk: computeGroundRadiance(PALETTES.dusk),
  night: computeGroundRadiance(PALETTES.night),
};

/** multiplicador sRGB por canal que a luz do tema aplica no chão (pode passar de 1 de dia) */
export function groundRadiance(theme: MapTheme): Rgb {
  return RADIANCE[theme] ?? RADIANCE.day;
}

/** luminância da radiância, limitada a 0..1 — um multiplicador escalar, pra quem só aceita brilho (ex.: ícones) */
export function groundLuminance(theme: MapTheme): number {
  const [r, g, b] = groundRadiance(theme);
  return clamp01(0.2126 * r + 0.7152 * g + 0.0722 * b);
}

function litRgb(rgb: Rgb, theme: MapTheme, emissive: number): Rgb {
  const rad = groundRadiance(theme);
  const e = clamp01(emissive);
  const ch = (i: 0 | 1 | 2): number => clamp01(rgb[i] * rad[i] * (1 - e) + rgb[i] * e);
  return [ch(0), ch(1), ch(2)];
}

/**
 * cor '#RRGGBB' com a luz do tema assada (chão/teto iluminado). `emissive` 0..1 = quanto a cor ignora a luz, igual ao
 * *-emissive-strength do original (os prédios cz-3d tinham 0.05). Entrada que não for hex volta sem mudança.
 */
export function lit(hex: string, theme: MapTheme, emissive = 0): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  return toHex(litRgb(rgb, theme, emissive));
}

/**
 * como lit, mas aceita qualquer cor CSS do estilo (hsl/hsla/rgb/rgba/hex) e preserva o alfa: '#RRGGBB' se opaca,
 * senão 'rgba(r, g, b, a)'. null se a string não for uma cor.
 */
export function litColor(css: string, theme: MapTheme): string | null {
  const c = parseCssColor(css);
  if (!c) return null;
  const rgb = litRgb(c.rgb, theme, 0);
  if (c.a >= 1) return toHex(rgb);
  return `rgba(${to255(rgb[0])}, ${to255(rgb[1])}, ${to255(rgb[2])}, ${Math.round(c.a * 1000) / 1000})`;
}

/**
 * assa a luz em todas as cores literais de um valor de estilo (cor solta ou expressão interpolate/match/...); o resto
 * (operadores, rótulos do match, números) passa intacto. Serve pras camadas do streets-v12 que têm cor própria.
 */
export function litExpr<T>(value: T, theme: MapTheme): T {
  if (typeof value === 'string') return (litColor(value, theme) ?? value) as T;
  if (Array.isArray(value)) return value.map((v: unknown) => litExpr(v, theme)) as T;
  return value;
}
