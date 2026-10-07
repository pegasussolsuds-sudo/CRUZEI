// As 22 auras do avatar, escritas contra a caneta de fx-core (Skia no palco e na folha de prova; SVG nas listas).
// Dono: efeitos.
//
// Espaço de desenho: unidades do viewBox do avatar (100x140). FxFrame diz onde está a figura (elipse que envolve o
// corpo, cabeça, chão) e o que está visível do canvas (a aura transborda a caixa do avatar no palco). Cada aura tem
// camada de trás (atrás do corpo) e da frente (poucas partículas que passam por cima, sempre se afastando do rosto).
//
// Intensidade (auraLevel): soft/medium/max mudam a contagem de partículas (AURA_PARTICLES: 12/20/32), a alfa e o
// tamanho. Tinta (auraColor): `retint` leva a paleta inteira pro matiz escolhido mantendo luz e sombra; 'a_auto' (tint
// null) = cores originais. A aura do orgulho usa as listras da bandeira (a tinta vale só pro brilho e as faíscas).
// Movimento reduzido: o palco desenha um quadro parado escolhido a dedo (AuraSpec.still).

import type { AvatarConfig } from '@cruzei/shared-types';

import { buildAnatomy, headAnchors } from '../../../avatar/anatomy';
import { fillConfig } from '../../../avatar/ctx';
import type { FlagDef } from '../../../avatar/parts/flags';
import { resolveScene } from '../../../avatar/scene';

import { TAU, arcCmds, clamp01, darken, fract, hexRgb, lighten, life, mixN, mixRgb, noise1, retint, rnd, sampleCycle, smooth, type FxGrad, type Pen, type Rgb } from './fx-core';

export type AuraLevel = 'soft' | 'medium' | 'max';

/** teto de partículas por intensidade */
export const AURA_PARTICLES: Record<AuraLevel, number> = { soft: 12, medium: 20, max: 32 };

/** onde está a figura e o que é visível, em unidades do viewBox */
export interface FxFrame {
  /** unidade → px (canvas = ox + x·s) */
  ox: number;
  oy: number;
  s: number;
  bust: boolean;
  /** elipse que envolve a figura */
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** região visível */
  l: number;
  r: number;
  t: number;
  b: number;
  /** chão (sola dos pés) */
  g: number;
  /** cabeça */
  hx: number;
  hy: number;
  hr: number;
  /** escala das partículas (busto = close: partículas menores em unidades) */
  u: number;
  /** meia largura extra das roupas largas (asas, capa, saia de gala) além dos ombros; 0 = sem */
  wide?: number;
}

export interface AuraSpec {
  id: string;
  /** partículas (já reduzidas no lite) */
  n: number;
  /** 0 suave, 1 média, 2 intensa */
  lv: number;
  /** multiplicador de alfa */
  k: number;
  /** multiplicador de tamanho */
  z: number;
  /** paleta (índice 0 = principal), já com a tinta */
  c: Rgb[];
  /** cores da bandeira, de fora pra dentro, e pesos (aura do orgulho) */
  flag: Rgb[];
  flagW: number[];
  /** quadro parado (movimento reduzido) */
  still: number;
}

/** paletas originais (índice 0 = cor principal, que é a referência da tinta) */
export const AURA_PALETTES: Record<string, Rgb[]> = {
  lime: [0x7fff00, 0xdcffa3, 0x3f9e00, 0xffffff],
  magenta: [0xff1493, 0xff9bd3, 0xa1005e, 0xffe3f2],
  gold: [0xffd700, 0xfff4a8, 0xc58a00, 0xffffff],
  fest: [0xff1493, 0x7fff00, 0xffd700, 0x00e5ff, 0xffffff],
  sparkle: [0xfff1c2, 0xffffff, 0xbfe6ff],
  pride: [0xffffff, 0xffffff],
  galaxy: [0x9b5cff, 0x3f6bff, 0xff4fd8, 0x7fe7ff, 0xffffff],
  flames: [0xff7a1a, 0xffc53a, 0xfff3c8, 0xe2321e, 0x7a1206],
  electric: [0x5fd4ff, 0xcdf3ff, 0x2f6bff, 0xa07dff, 0xffffff],
  crystals: [0x7fe7ff, 0xeafcff, 0x2a86c8, 0xc8b6ff, 0xffffff],
  mist: [0xc4d0ff, 0xa6b4ff, 0xdcc3ff, 0xffffff],
  stardust: [0xffe27a, 0xfff7dd, 0xffb86b, 0xffffff],
  petals: [0xff8fc0, 0xffe2ef, 0xe0507f, 0xffffff],
  hologram: [0x5ff4ff, 0xcafdff, 0x2f86ff, 0xff4fd8, 0xffffff],
  golden: [0xffd23a, 0xfff2b3, 0xc8901a, 0xffffff],
  rainbow: [0xff3b5c, 0xff9a1f, 0xffe83a, 0x3ddc84, 0x3aa0ff, 0x9b5cff],
  hearts: [0xff4f9a, 0xffa8cd, 0xd81e5b, 0xffffff],
  bubbles: [0xa8e8ff, 0xffb3e6, 0xfff3a1, 0xffffff],
  snow: [0xdff1ff, 0xffffff, 0xa6d4ff],
  fireflies: [0xe6ff5a, 0xfff7b3, 0xffc93a, 0xffffff],
  music: [0xb98cff, 0xff7ad9, 0x6fe3ff, 0xffffff],
  supernova: [0xff4fd8, 0xffd700, 0x6fe9ff, 0xffffff, 0xffb3f0],
};

/** cor original (principal) de cada aura, em hex (miniaturas, chips do editor) */
export const AURA_BASE: Record<string, string> = Object.fromEntries(
  Object.entries(AURA_PALETTES).map(([k, v]) => [k, '#' + v[0].toString(16).padStart(6, '0').toUpperCase()]),
);
// cor de base de cada aura distinta das vizinhas (no mapa a aura vira uma poça dessa cor): o orgulho fica rosa (o mapa
// deve usar a bandeira), o arco-íris vai pro verde da paleta, os cianos/amarelos/rosas se separam
AURA_BASE.pride = '#FF5AA7';
AURA_BASE.rainbow = '#3DDC84';
AURA_BASE.fest = '#FF6FB1';
AURA_BASE.electric = '#4F8BFF';
AURA_BASE.crystals = '#BDF4FF';
AURA_BASE.golden = '#FFAA2B';
AURA_BASE.stardust = '#FFF3B8';
AURA_BASE.hearts = '#FF3B5C';
AURA_BASE.petals = '#FFA8CF';
AURA_BASE.supernova = '#D46BFF';

/** ids com desenho (todas as auras do catálogo menos 'none') */
export const AURA_IDS = Object.keys(AURA_PALETTES);

/** quadro parado bonito de cada aura (s) */
const STILL: Record<string, number> = { supernova: 0.62, electric: 0.31, magenta: 0.9, bubbles: 2.2, hologram: 1.1, flames: 1.7 };

const LEVEL_K = [0.8, 1, 1.15];
const LEVEL_Z = [0.92, 1.05, 1.18];

/** cores da bandeira de fora pra dentro, com peso; os desenhos extras viram anéis de dentro */
export function flagRings(flag: FlagDef): { c: Rgb[]; w: number[] } {
  const c: Rgb[] = [];
  const w: number[] = [];
  for (const st of flag.stripes) {
    c.push(hexRgb(st.hex, 0xffffff));
    w.push(st.w ?? 1);
  }
  const add = (hexes: number[], ww = 0.7) => {
    for (const h of hexes) {
      c.push(h);
      w.push(ww);
    }
  };
  if (flag.overlay === 'progress') add([0x000000, 0x784f17, 0x5bcefa, 0xf5a9b8, 0xffffff]);
  else if (flag.overlay === 'demi') add([0x000000], 1.4);
  else if (flag.overlay === 'ally') add([0xe40303, 0xff8c00, 0xffed00, 0x008026, 0x004dff, 0x750787]);
  else if (flag.overlay === 'intersex') {
    // anel roxo no meio do amarelo
    const y = c[0] ?? 0xffd800;
    return { c: [y, 0x7902aa, y], w: [1.4, 0.8, 1.4] };
  }
  if (!c.length) return { c: [0xe40303, 0xff8c00, 0xffed00, 0x008026, 0x004dff, 0x750787], w: [1, 1, 1, 1, 1, 1] };
  return { c, w };
}

/**
 * Parâmetros de uma aura pro desenho (JS, uma vez por visual). null = sem aura.
 * `lite` = versão estática das listas (menos partículas).
 */
export function auraSpec(aura: string | null | undefined, tint: string | null, level: string | null | undefined, flag: FlagDef, lite = false): AuraSpec | null {
  if (!aura || aura === 'none') return null;
  const id = AURA_PALETTES[aura] ? aura : 'lime';
  const lv = level === 'soft' ? 0 : level === 'max' ? 2 : 1;
  const base = AURA_PALETTES[id];
  const t = tint ? hexRgb(tint, -1) : -1;
  const rings = flagRings(flag);
  let c = base.slice();
  if (id === 'pride') {
    // brilho da aura do orgulho: a tinta ou uma cor clara da própria bandeira
    const bright = rings.c.reduce((best, x) => (lum(x) > lum(best) && lum(x) < 0.92 ? x : best), rings.c[0]);
    c = [t >= 0 ? t : mixRgb(bright, 0xffffff, 0.25), 0xffffff];
  } else if (t >= 0) {
    c = base.map((x) => retint(x, base[0], t));
  }
  const n0 = AURA_PARTICLES[(['soft', 'medium', 'max'] as const)[lv]];
  const n = lite ? Math.max(4, Math.round(n0 * 0.35)) : n0;
  return { id, n, lv, k: LEVEL_K[lv], z: LEVEL_Z[lv], c, flag: rings.c, flagW: rings.w, still: STILL[id] ?? 1.35 };
}

function lum(c: Rgb): number {
  return (0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255)) / 255;
}

/** medidas da figura que a aura envolve (unidades do viewBox), tiradas da anatomia da config */
export interface AuraFigure {
  /** centro e raio da cabeça */
  hx: number;
  hy: number;
  hr: number;
  /** topo do crânio e sola dos pés */
  top: number;
  sole: number;
  /** meia largura dos ombros */
  hw: number;
  /** meia largura extra das roupas largas (asas, capa, saia de gala), 0 = sem */
  wide?: number;
}

/** corpo médio em pé (reserva quando o palco não passa a figura) */
export const DEFAULT_FIGURE: AuraFigure = { hx: 50, hy: 22.8, hr: 10.6, top: 12.6, sole: 134, hw: 14.3 };

/** figura de uma config (JS, uma vez por visual): estatura, cabeça e ombros variam por corpo; sentado desce */
export function auraFigure(cfg: AvatarConfig, mode: 'full' | 'bust' = 'full'): AuraFigure {
  const full = fillConfig(cfg);
  const scene = resolveScene(full, { noVehicle: mode === 'bust' });
  const an = buildAnatomy(full, scene);
  const dy = (scene.lift || 0) + (scene.seated ? an.seatDrop : 0);
  const top = headAnchors(an).top[1];
  // roupa larga: a aura que nasce do contorno (chamas) acompanha a silhueta da roupa, não só a do corpo
  const wings = typeof full.bag === 'string' && full.bag.startsWith('wings');
  const cape = full.outer === 'cape' || full.outer === 'mantle' || full.pride === 'cape';
  const skirt = full.top === 'gown' || full.top === 'wizard' || full.bottom === 'tutu';
  const wide = wings ? 28 : skirt ? 8 : cape ? 6 : 0;
  return { hx: an.head.cx, hy: an.head.cy + dy, hr: an.head.r, top: top + dy, sole: an.foot.soleY, hw: (an.x1 - an.x0) / 2, wide };
}

type FigureBox = Pick<FxFrame, 'cx' | 'cy' | 'rx' | 'ry' | 'hx' | 'hy' | 'hr' | 'u' | 'wide'>;

/** elipse da figura em unidades: corpo inteiro (cabelo até os pés) ou busto (cabeça e ombros dentro do recorte) */
function figure(fig: AuraFigure, bustVb: { x: number; y: number; w: number; h: number } | null): FigureBox {
  const head = { hx: fig.hx, hy: fig.hy, hr: fig.hr };
  if (bustVb) {
    const top = fig.top - 3;
    const bot = bustVb.y + bustVb.h;
    return { cx: fig.hx, cy: (top + bot) / 2, rx: bustVb.w * 0.47, ry: (bot - top) / 2, ...head, u: bustVb.w / 72 };
  }
  const top = fig.top - 4;
  return { cx: fig.hx, cy: (top + fig.sole) / 2, rx: 22 + fig.hw, ry: (fig.sole - top) / 2 + 2, ...head, u: 1, wide: fig.wide ?? 0 };
}

/**
 * Enquadramento da aura no palco: `body` = caixa do avatar no canvas (full = viewBox inteiro; busto = recorte
 * `bustVb`); `box` = canvas; `fig` = figura da config (auraFigure).
 */
export function auraFrame(box: { w: number; h: number }, body: { x: number; y: number; w: number; h: number }, bustVb: { x: number; y: number; w: number; h: number } | null, fig: AuraFigure = DEFAULT_FIGURE): FxFrame {
  const s = bustVb ? body.w / bustVb.w : body.w / 100;
  const ox = bustVb ? body.x - bustVb.x * s : body.x;
  const oy = bustVb ? body.y - bustVb.y * s : body.y;
  const l = -ox / s;
  const r = (box.w - ox) / s;
  const t = -oy / s;
  const b = (box.h - oy) / s;
  return { ox, oy, s, bust: !!bustVb, ...figure(fig, bustVb), l, r, t, b, g: bustVb ? b : fig.sole + 1 };
}

/** enquadramento no SVG estático (o viewBox já é o espaço do avatar: nada transborda) */
export function svgAuraFrame(vb: { x: number; y: number; w: number; h: number }, bust: boolean, fig: AuraFigure = DEFAULT_FIGURE): FxFrame {
  return { ox: 0, oy: 0, s: 1, bust, ...figure(fig, bust ? vb : null), l: vb.x, r: vb.x + vb.w, t: vb.y, b: vb.y + vb.h, g: bust ? vb.y + vb.h : fig.sole + 1 };
}

// ---------------------------------------------------------------------------------------------------------------
// ajudantes de desenho (worklets; antes de quem usa)
// ---------------------------------------------------------------------------------------------------------------
/** 0 em cima do rosto → 1 longe dele (partículas da frente nunca tampam a cara) */
function faceFade(F: FxFrame, x: number, y: number): number {
  'worklet';
  const dx = (x - F.hx) / (F.hr * 1.1);
  const dy = (y - F.hy) / (F.hr * 1.3);
  return smooth(0.95, 1.6, Math.sqrt(dx * dx + dy * dy));
}

/** 0 perto da cabeça (raio k × o do rosto, contando orelhas e cabelo) → 1 longe */
function headFade(F: FxFrame, x: number, y: number, k: number): number {
  'worklet';
  const dx = (x - F.hx) / (F.hr * k);
  const dy = (y - F.hy) / (F.hr * k * 1.1);
  return smooth(0.9, 1.3, Math.sqrt(dx * dx + dy * dy));
}

/** 0 sobre o corpo (coluna do tronco às pernas e pés) → 1 fora: partícula da frente não gruda na virilha, no joelho, no pé */
function bodyFade(F: FxFrame, x: number, y: number): number {
  'worklet';
  if (F.bust) return 1;
  if (y < F.hy + F.hr * 1.2 || y > F.g + 9) return 1;
  return smooth(F.rx * 0.3, F.rx * 0.5, Math.abs(x - F.cx));
}

/** a partícula i vai na frente? (~1/3) */
function inFront(i: number, share: number): boolean {
  'worklet';
  return rnd(i, 901) < share;
}

function halo(P: Pen, F: FxFrame, c: Rgb, a: number): void {
  'worklet';
  P.glowOval(F.cx, F.cy, F.rx * 1.3, F.ry * 1.08, c, a * 1.3);
  P.glowOval(F.cx, F.cy + F.ry * 0.04, F.rx * 0.78, F.ry * 0.86, c, a * 0.9, 1);
}

/** faísca: brilho + estrela de 4 pontas + miolo */
function spark(P: Pen, x: number, y: number, sz: number, c: Rgb, a: number, rot: number): void {
  'worklet';
  if (a <= 0.01) return;
  P.glow(x, y, sz * 2.6, c, 0.5 * a, 1);
  P.shape('sparkle', x, y, sz, rot, { c: lighten(c, 0.7), a });
  P.circle(x, y, sz * 0.16, { c: 0xffffff, a });
}

/** ponto de luz com miolo (vaga-lume, brasa, poeira) */
function mote(P: Pen, x: number, y: number, r: number, c: Rgb, a: number): void {
  'worklet';
  if (a <= 0.01) return;
  P.glow(x, y, r * 3.2, c, 0.42 * a, 1);
  P.circle(x, y, r * 0.42, { c: lighten(c, 0.75), a: Math.min(1, a * 1.1) });
}

function easeOut3(k: number): number {
  'worklet';
  const x = 1 - clamp01(k);
  return 1 - x * x * x;
}

// ---------------------------------------------------------------------------------------------------------------
// auras
// ---------------------------------------------------------------------------------------------------------------
/** Brilhinho (grátis): faíscas que acendem e apagam em volta, cada ciclo num lugar novo */
function auraSparkle(P: Pen, S: AuraSpec, F: FxFrame, t: number, front: boolean): void {
  'worklet';
  if (!front) halo(P, F, S.c[0], 0.12 * S.k);
  for (let i = 0; i < S.n; i++) {
    if (inFront(i, 0.34) !== front) continue;
    const [ph, cyc] = life(t, 1.7 + rnd(i, 1) * 1.3, rnd(i, 2));
    const ang = rnd(i * 31 + cyc, 5) * TAU;
    const rho = 0.62 + 0.48 * rnd(i * 17 + cyc, 6);
    const x = F.cx + Math.cos(ang) * F.rx * rho * 1.08;
    const y = F.cy + Math.sin(ang) * F.ry * rho - ph * 5 * F.u;
    const tw = Math.sin(Math.PI * ph);
    // longe do corpo nas duas camadas: atrás, entre os pés, a faísca ficava grudada no chão
    const a = tw * tw * S.k * bodyFade(F, x, y) * (front ? faceFade(F, x, y) : 1);
    const sz = (1.6 + 2 * rnd(i, 7)) * F.u * S.z * (0.55 + 0.45 * tw);
    spark(P, x, y, sz, rnd(i, 8) < 0.3 ? S.c[2] : S.c[0], a, 12 * ph);
  }
}

/** Aura lima: energia Metch — cometas em órbitas inclinadas (como um átomo) + faíscas subindo */
function auraLime(P: Pen, S: AuraSpec, F: FxFrame, t: number, front: boolean): void {
  'worklet';
  const [cm, cl] = S.c;
  if (!front) {
    halo(P, F, cm, 0.2 * S.k);
    P.glowOval(F.cx, F.cy - F.ry * 0.12, F.rx * 0.85, F.ry * 0.62, cl, 0.1 * S.k, 1);
  }
  const orbits = S.lv === 2 ? 3 : 2;
  for (let o = 0; o < orbits; o++) {
    const tilt = o === 0 ? -27 : o === 1 ? 25 : 90;
    const A = (o === 2 ? F.ry * 0.5 : F.rx * 0.5) * (F.bust ? 1.25 : 1);
    const B = o === 2 ? F.rx * 0.22 : F.ry * 0.9;
    const ocx = F.cx;
    const ocy = o === 2 ? F.cy + F.ry * 0.05 : F.cy - F.ry * 0.04;
    P.save();
    P.translate(ocx, ocy);
    P.rotate(tilt);
    // órbita: metade da frente (x local > 0) na camada da frente, em pedaços que somem perto do rosto
    const rt = (tilt * Math.PI) / 180;
    for (let q = 0; q < 12; q++) {
      const a0 = (front ? -90 : 90) + q * 15;
      const am = ((a0 + 7.5) * Math.PI) / 180;
      const mx = Math.cos(am) * A;
      const my = Math.sin(am) * B;
      const ff = front ? faceFade(F, ocx + mx * Math.cos(rt) - my * Math.sin(rt), ocy + mx * Math.sin(rt) + my * Math.cos(rt)) : 1;
      if (ff <= 0.02) continue;
      P.path(arcCmds(0, 0, A, B, a0, 15.2), { c: cm, a: 0.12 * S.k * ff, w: 2.2 * F.u, b: 1, cap: 1 });
      P.path(arcCmds(0, 0, A, B, a0, 15.2), { c: cl, a: 0.4 * S.k * ff, w: 0.5 * F.u, b: 1, cap: 1 });
    }
    // cometa: cabeça + cauda de pontos
    const sp = (o % 2 ? -1 : 1) * 1.15;
    const ph0 = t * sp + o * 2.1;
    for (let j = 9; j >= 0; j--) {
      const ph = ph0 - j * 0.075 * Math.sign(sp);
      const lx = Math.cos(ph) * A;
      const ly = Math.sin(ph) * B;
      if (lx > 0 !== front) continue;
      const fade = (1 - j / 10) * (front ? faceFade(F, ocx + lx * Math.cos(rt) - ly * Math.sin(rt), ocy + lx * Math.sin(rt) + ly * Math.cos(rt)) : 1);
      if (fade <= 0.02) continue;
      if (j === 0) {
        P.glow(lx, ly, 6.5 * F.u * S.z, cm, 0.7 * S.k * fade, 1);
        P.circle(lx, ly, 1.25 * F.u * S.z, { c: 0xffffff, a: 0.95 * fade });
      } else {
        P.circle(lx, ly, (1.3 - j * 0.09) * F.u * S.z, { c: j < 4 ? cl : cm, a: 0.8 * fade * S.k, b: 1 });
      }
    }
    P.restore();
  }
  const motes = S.n - orbits;
  for (let i = 0; i < motes; i++) {
    if (inFront(i, 0.3) !== front) continue;
    const [ph, cyc] = life(t, 2.6 + rnd(i, 3) * 1.8, rnd(i, 4));
    const x = F.cx + (rnd(i * 13 + cyc, 5) - 0.5) * 2 * F.rx * 1.12 + Math.sin(ph * 5 + i) * 2 * F.u;
    const y = F.cy + F.ry * 0.85 - ph * F.ry * 1.75;
    const a = Math.sin(Math.PI * ph) * S.k * (front ? faceFade(F, x, y) : 1);
    mote(P, x, y, (0.7 + 0.6 * rnd(i, 6)) * F.u * S.z, rnd(i, 7) < 0.35 ? cl : cm, a);
  }
}

/** Aura magenta: ondas de luz se abrindo do corpo + brilhos que surfam nas ondas */
function auraMagenta(P: Pen, S: AuraSpec, F: FxFrame, t: number, front: boolean): void {
  'worklet';
  const [cm, cl, , ch] = S.c;
  const T = 2.7;
  // o anel de fora não passa da caixa visível (no SVG estático a caixa é o viewBox: cortava reto em cima e embaixo)
  const cy0 = F.cy - F.ry * 0.04;
  const mg = 3 * F.u;
  const Rmax = Math.max(0.6, Math.min(1.28, (F.b - cy0 - mg) / (F.ry * 0.94), (cy0 - F.t - mg) / (F.ry * 0.94), (F.r - F.cx - mg) / F.rx, (F.cx - F.l - mg) / F.rx));
  if (!front) {
    halo(P, F, cm, 0.22 * S.k);
    for (let j = 0; j < 3; j++) {
      const k = fract(t / T + j / 3);
      const R = mixN(0.38, Rmax, easeOut3(k));
      const a = smooth(0, 0.12, k) * Math.pow(1 - k, 1.5) * S.k;
      const rx = F.rx * R;
      const ry = F.ry * R * 0.94;
      P.oval(F.cx, F.cy - F.ry * 0.04, rx, ry, { c: cm, a: 0.2 * a, w: 5 * F.u, b: 1 });
      P.oval(F.cx, F.cy - F.ry * 0.04, rx, ry, { c: cl, a: 0.85 * a, w: 0.8 * F.u, b: 1 });
    }
  }
  for (let i = 0; i < S.n; i++) {
    if (inFront(i, 0.3) !== front) continue;
    const j = i % 3;
    const k = fract(t / T + j / 3 + 0.04 * rnd(i, 3));
    const cyc = Math.floor(t / T + j / 3);
    const R = mixN(0.38, Rmax, easeOut3(k));
    const ang = rnd(i * 7 + cyc, 9) * TAU;
    const x = F.cx + Math.cos(ang) * F.rx * R;
    const y = F.cy - F.ry * 0.04 + Math.sin(ang) * F.ry * R * 0.94;
    const a = smooth(0, 0.15, k) * (1 - k) * S.k * (front ? faceFade(F, x, y) : 1);
    if (rnd(i, 5) < 0.45) spark(P, x, y, (1.2 + rnd(i, 6) * 1.2) * F.u * S.z, ch, a, 45 * k);
    else mote(P, x, y, 0.8 * F.u * S.z, cl, a);
  }
}

/** Aura dourada: estrelas douradas girando devagar, cintilando, e pó de ouro */
function auraGold(P: Pen, S: AuraSpec, F: FxFrame, t: number, front: boolean): void {
  'worklet';
  const [cm, cl, cd] = S.c;
  if (!front) {
    halo(P, F, cm, 0.2 * S.k);
    P.glowOval(F.cx, F.cy - F.ry * 0.3, F.rx * 0.9, F.ry * 0.5, cl, 0.12 * S.k, 1);
  }
  for (let i = 0; i < S.n; i++) {
    if (inFront(i, 0.3) !== front) continue;
    const dir = rnd(i, 1) < 0.5 ? -1 : 1;
    const ang = rnd(i, 2) * TAU + t * 0.22 * dir;
    const rho = 0.66 + 0.5 * rnd(i, 3);
    const x = F.cx + Math.cos(ang) * F.rx * rho * 1.05;
    const y = F.cy + Math.sin(ang) * F.ry * rho * 0.95 + Math.sin(t * 1.4 + i) * 1.5 * F.u;
    const tw = 0.5 + 0.5 * Math.sin(t * (2.2 + rnd(i, 4) * 2) + i * 1.7);
    const a = (0.45 + 0.55 * tw) * S.k * (front ? faceFade(F, x, y) : 1);
    if (a <= 0.01) continue;
    if (i % 3 === 1) {
      mote(P, x, y, 0.55 * F.u * S.z, cl, a * 0.9);
      continue;
    }
    const sz = (1.9 + 1.9 * rnd(i, 5)) * F.u * S.z * (0.85 + 0.2 * tw);
    const rot = rnd(i, 6) * 72 + t * 20 * dir;
    P.glow(x, y, sz * 2.8, cm, 0.4 * a, 1);
    const g: FxGrad = { t: 'r', cx: -0.25, cy: -0.3, r: 1.2, s: [[0, 0xffffff, 1], [0.35, cl, 1], [0.8, cm, 1], [1, cd, 1]] };
    P.shape('star5', x, y, sz, rot, { g, a });
    if (tw > 0.85) P.shape('glint', x, y, sz * 2.2 * (tw - 0.85) * 6.6, 0, { c: 0xffffff, a: a * 0.8 });
  }
}

/**
 * um trecho de fita de papel: polígono liso pelos pontos (xs, ys) de a até b, meia largura pela torção |ws| e afinando
 * nas pontas; cor = face da fita (verso mais escuro)
 */
function ribbonRun(P: Pen, xs: number[], ys: number[], ws: number[], a: number, b: number, seg: number, col: Rgb, unit: number, alpha: number): void {
  'worklet';
  const L: number[] = [];
  const R: number[] = [];
  for (let k = a; k <= b; k++) {
    const kp = k > 0 ? k - 1 : 0;
    const kn = k < seg ? k + 1 : seg;
    let dx = xs[kn] - xs[kp];
    let dy = ys[kn] - ys[kp];
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    dx /= len;
    dy /= len;
    const taper = Math.pow(Math.sin((Math.PI * k) / seg), 0.6);
    const hw = (0.22 + 0.68 * Math.abs(ws[k])) * unit * taper;
    L.push(xs[k] - dy * hw, ys[k] + dx * hw);
    R.push(xs[k] + dy * hw, ys[k] - dx * hw);
  }
  if (L.length < 4) return;
  const cmds: number[] = [0, L[0], L[1]];
  for (let q = 2; q < L.length; q += 2) cmds.push(1, L[q], L[q + 1]);
  for (let q = R.length - 2; q >= 0; q -= 2) cmds.push(1, R[q], R[q + 1]);
  cmds.push(4);
  P.path(cmds, { c: ws[(a + b) >> 1] < 0 ? darken(col, 0.3) : col, a: alpha });
}

/** Aura Metch Fest: serpentinas espiralando em volta + confete nas cores da marca */
function auraFest(P: Pen, S: AuraSpec, F: FxFrame, t: number, front: boolean): void {
  'worklet';
  const cols = S.c;
  if (!front) {
    P.glowOval(F.cx - F.rx * 0.2, F.cy - F.ry * 0.1, F.rx * 1.05, F.ry * 0.9, cols[0], 0.16 * S.k);
    P.glowOval(F.cx + F.rx * 0.25, F.cy + F.ry * 0.15, F.rx * 0.95, F.ry * 0.8, cols[1], 0.12 * S.k);
  }
  // serpentinas: fitas de papel em hélice, só a metade de trás (passam por trás do corpo e aparecem dos lados). Cada trecho
  // visível vira UM polígono liso (antes: um traço reto por segmento, que lia como graveto quebrado); a largura segue a
  // torção, o verso é mais escuro e as fitas começam abaixo do queixo (atrás da cabeça liam como espeto no rosto)
  if (!front) {
    const ribbons = P.lite ? 2 : 3;
    const seg = P.lite ? 44 : 64;
    const y0 = F.bust ? F.cy - F.ry * 0.9 : Math.max(F.cy - F.ry * 0.9, F.hy + F.hr * 1.3);
    const y1 = F.cy + F.ry * 0.85;
    const xs: number[] = [];
    const ys: number[] = [];
    const zs: number[] = [];
    const ws: number[] = [];
    for (let j = 0; j < ribbons; j++) {
      const col = cols[j % 3];
      for (let k = 0; k <= seg; k++) {
        const sk = k / seg;
        const ang = sk * TAU * 1.3 + t * 1.2 + j * 2.1;
        xs[k] = F.cx + Math.cos(ang) * F.rx * (1.02 + 0.08 * Math.sin(sk * 6 + j));
        ys[k] = mixN(y0, y1, sk);
        // perto da cabeça a fita some (vale como "na frente"): no busto ela atravessava atrás da cabeça na altura dos olhos
        zs[k] = headFade(F, xs[k], ys[k], 1.5) < 0.5 ? 1 : Math.sin(ang);
        ws[k] = Math.cos(sk * 9 + t * 2 + j);
      }
      // trechos contínuos da metade de trás; troca de face (torção passa por zero, a fita está no mais fino) = trecho novo
      let st = -1;
      for (let k = 0; k <= seg; k++) {
        if (zs[k] >= 0) {
          if (st >= 0 && k - 1 > st) ribbonRun(P, xs, ys, ws, st, k - 1, seg, col, F.u * S.z, 0.8 * S.k);
          st = -1;
          continue;
        }
        if (st < 0) {
          st = k;
          continue;
        }
        if (ws[k] < 0 !== ws[k - 1] < 0) {
          ribbonRun(P, xs, ys, ws, st, k, seg, col, F.u * S.z, 0.8 * S.k);
          st = k;
        }
      }
      if (st >= 0 && seg > st) ribbonRun(P, xs, ys, ws, st, seg, seg, col, F.u * S.z, 0.8 * S.k);
    }
  }
  for (let i = 0; i < S.n; i++) {
    if (inFront(i, 0.35) !== front) continue;
    const [ph, cyc] = life(t, 3 + rnd(i, 1) * 2, rnd(i, 2));
    const x = F.l + 3 + rnd(i * 5 + cyc, 3) * (F.r - F.l - 6) + Math.sin(t * 1.7 + i) * 3 * F.u;
    const y = F.t - 4 + ph * (F.b - F.t + 8);
    const a = smooth(0, 0.08, ph) * (1 - smooth(0.85, 1, ph)) * S.k * (front ? faceFade(F, x, y) : 1);
    if (a <= 0.01) continue;
    const flip = Math.cos(t * (4 + rnd(i, 4) * 3) + i);
    const c = cols[i % 4];
    P.save();
    P.translate(x, y);
    P.rotate(rnd(i, 5) * 180 + t * 90 * (i % 2 ? 1 : -1));
    P.scale(1, 0.25 + 0.75 * Math.abs(flip));
    P.rect(-0.9 * F.u * S.z, -0.5 * F.u * S.z, 1.8 * F.u * S.z, 1.0 * F.u * S.z, { c: flip < 0 ? darken(c, 0.25) : c, a });
    P.restore();
  }
}

/** Aura do orgulho: portal de luz com as listras da bandeira, brilho correndo em volta e faíscas nas cores */
function auraPride(P: Pen, S: AuraSpec, F: FxFrame, t: number, front: boolean): void {
  'worklet';
  const breathe = 1 + 0.018 * Math.sin(t * 1.6);
  const cx = F.cx;
  const cy = F.cy - F.ry * 0.05;
  const rx0 = F.rx * (F.bust ? 1.02 : 1.06) * breathe;
  const ry0 = F.ry * (F.bust ? 1.0 : 0.97) * breathe;
  const W = (F.bust ? 4.4 : 6) * S.z;
  if (!front) {
    halo(P, F, S.c[0], 0.14 * S.k);
    // luz do portal: anel de brilho macio nas cores da bandeira (fora e dentro das listras)
    for (let i = 0; i < 6; i++) {
      const ang = (i * TAU) / 6 + t * 0.4;
      P.glow(cx + Math.cos(ang) * rx0, cy + Math.sin(ang) * ry0, W * 3.2, S.flag[(i * 2) % S.flag.length] === 0 ? S.c[0] : S.flag[(i * 2) % S.flag.length], 0.22 * S.k, 1);
    }
    let tw = 0;
    for (let i = 0; i < S.flagW.length; i++) tw += S.flagW[i];
    let acc = 0;
    for (let i = 0; i < S.flag.length; i++) {
      const wi = (W * S.flagW[i]) / tw;
      const off = W / 2 - acc - wi / 2;
      acc += wi;
      P.oval(cx, cy, rx0 + off, ry0 + off, { c: S.flag[i], a: 0.82 * S.k, w: wi + 0.25 });
    }
    // brilho correndo pelo portal (dois, opostos)
    for (let j = 0; j < 2; j++) {
      const ang = t * 0.9 + j * Math.PI;
      const x = cx + Math.cos(ang) * rx0;
      const y = cy + Math.sin(ang) * ry0;
      P.glow(x, y, W * 1.6, 0xffffff, 0.4 * S.k, 1);
      P.glow(x, y, W * 0.6, 0xffffff, 0.6 * S.k, 1);
    }
    // borda de luz fina por dentro e por fora
    P.oval(cx, cy, rx0 - W / 2, ry0 - W / 2, { c: 0xffffff, a: 0.35 * S.k, w: 0.35 * F.u });
    P.oval(cx, cy, rx0 + W / 2, ry0 + W / 2, { c: 0xffffff, a: 0.25 * S.k, w: 0.35 * F.u });
  }
  for (let i = 0; i < S.n; i++) {
    if (inFront(i, 0.3) !== front) continue;
    const [ph, cyc] = life(t, 2.2 + rnd(i, 1) * 1.5, rnd(i, 2));
    const ang = rnd(i * 11 + cyc, 3) * TAU;
    const rho = 0.85 + 0.35 * rnd(i * 3 + cyc, 4);
    const x = cx + Math.cos(ang) * rx0 * rho;
    const y = cy + Math.sin(ang) * ry0 * rho - ph * 4 * F.u;
    const tw = Math.sin(Math.PI * ph);
    const a = tw * S.k * (front ? faceFade(F, x, y) : 1);
    spark(P, x, y, (1.1 + rnd(i, 5) * 1.2) * F.u * S.z * (0.6 + 0.4 * tw), S.flag[i % S.flag.length] === 0 ? 0x5a5a66 : S.flag[i % S.flag.length], a, 0);
  }
}

/** Aura galáctica: nebulosa colorida girando atrás + disco espiral de estrelas em volta da cintura (metade na frente) */
function auraGalaxy(P: Pen, S: AuraSpec, F: FxFrame, t: number, front: boolean): void {
  'worklet';
  const c = S.c;
  const dcx = F.cx;
  const dcy = F.cy + F.ry * (F.bust ? 0.3 : 0.06);
  const Rd = F.rx * (F.bust ? 1.25 : 1.36);
  const flat = 0.3;
  const tilt = (-12 * Math.PI) / 180;
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  if (!front) {
    // nebulosa: nuvens grandes de cores diferentes girando devagar em volta do corpo
    P.glowOval(F.cx, F.cy, F.rx * 1.35, F.ry * 1.05, c[0], 0.22 * S.k);
    for (let j = 0; j < 6; j++) {
      const ang = (j * TAU) / 6 + t * 0.15;
      const x = F.cx + Math.cos(ang) * F.rx * 0.62;
      const y = F.cy - F.ry * 0.05 + Math.sin(ang) * F.ry * 0.55;
      P.glowOval(x, y, F.rx * (0.75 + 0.2 * rnd(j, 71)), F.rx * (0.6 + 0.2 * rnd(j, 72)), c[j % 4], 0.3 * S.k, 1);
    }
    // braços da espiral: nuvens de poeira macias ao longo da curva (crescem pra fora) + um fio de luz contínuo
    const seg = P.lite ? 8 : 16;
    for (let arm = 0; arm < 2; arm++) {
      const col = c[arm ? 2 : 0];
      const pts: number[] = [];
      for (let k = 0; k <= seg; k++) {
        const s = 0.12 + (k / seg) * 0.9;
        const ang = arm * Math.PI + s * 3.6 + t * 0.35;
        const lx = Math.cos(ang) * Rd * s;
        const ly = Math.sin(ang) * Rd * s * flat;
        const x = dcx + lx * ct - ly * st;
        const y = dcy + lx * st + ly * ct;
        pts.push(x, y);
        const fade = Math.sin(Math.PI * (0.08 + 0.84 * (k / seg)));
        const rr = (3.8 + 5.2 * s) * F.u * S.z;
        P.glowOval(x, y, rr, rr * 0.5, k % 3 === 2 ? c[1] : col, 0.58 * fade * S.k, 1);
      }
      // fio liso: quadráticas pelos pontos médios (sem quinas, mesmo com poucos pontos no lite)
      const cmds: number[] = [0, pts[0], pts[1]];
      for (let q = 2; q < pts.length - 2; q += 2) cmds.push(2, pts[q], pts[q + 1], (pts[q] + pts[q + 2]) / 2, (pts[q + 1] + pts[q + 3]) / 2);
      cmds.push(1, pts[pts.length - 2], pts[pts.length - 1]);
      P.path(cmds, { c: lighten(col, 0.55), a: 0.2 * S.k, w: 0.7 * F.u * S.z, b: 1 });
    }
    P.glowOval(dcx, dcy, Rd * 0.42, Rd * flat * 0.9, c[4], 0.35 * S.k, 1);
    // estrelas do fundo (fixas, cintilando)
    const stars = Math.round(S.n * 0.45);
    for (let i = 0; i < stars; i++) {
      const x = F.l + 2 + rnd(i, 41) * (F.r - F.l - 4);
      const y = F.t + 2 + rnd(i, 42) * (F.b - F.t - 4) * 0.92;
      const tw = 0.5 + 0.5 * Math.sin(t * (1.5 + rnd(i, 43) * 2) + i * 2.3);
      const sz = (0.7 + rnd(i, 44) * 1.1) * F.u;
      P.circle(x, y, sz * 0.4, { c: 0xffffff, a: (0.4 + 0.6 * tw) * S.k });
      if (rnd(i, 45) < 0.4) P.shape('glint', x, y, sz * 2.6 * tw, 0, { c: c[3], a: 0.8 * tw * S.k });
    }
  }
  // estrelas do disco (as da frente passam por cima, longe do rosto)
  for (let i = 0; i < S.n; i++) {
    const arm = i % 2;
    const s = 0.2 + 0.85 * rnd(i, 51);
    const ang = arm * Math.PI + s * 3.6 + t * 0.35 + (rnd(i, 52) - 0.5) * 0.6;
    const lx = Math.cos(ang) * Rd * s;
    const ly = Math.sin(ang) * Rd * s * flat;
    const z = Math.sin(ang);
    if (z > 0 !== front) continue;
    const x = dcx + lx * ct - ly * st;
    const y = dcy + lx * st + ly * ct;
    // na frente, longe do rosto E da coluna do corpo (o quadro parado deixava uma faísca bem na virilha)
    const ff = front ? faceFade(F, x, y) * bodyFade(F, x, y) : 1;
    const tw = 0.55 + 0.45 * Math.sin(t * (2 + rnd(i, 53) * 3) + i);
    const col = sampleCycle([c[0], c[1], c[2], c[3]], rnd(i, 54));
    const a = tw * S.k * ff;
    const sz = (0.75 + 0.75 * rnd(i, 55)) * F.u * S.z;
    mote(P, x, y, sz, col, a);
    if (rnd(i, 56) < 0.3) P.shape('glint', x, y, sz * 3 * tw, 0, { c: 0xffffff, a: 0.85 * a });
  }
}

/** comandos de uma língua de fogo: base arredondada em (x, g), ponta em (x+sway, g-h) */
function flameCmds(x: number, g: number, w: number, h: number, sway: number): number[] {
  'worklet';
  const hw = w / 2;
  return [
    0, x - hw, g,
    3, x - hw, g - h * 0.32, x - w * 0.3 + sway * 0.4, g - h * 0.56, x - w * 0.08 + sway * 0.78, g - h * 0.8,
    2, x + sway * 0.98 - w * 0.03, g - h * 0.93, x + sway, g - h,
    2, x + w * 0.12 + sway * 0.66, g - h * 0.74, x + w * 0.24 + sway * 0.32, g - h * 0.55,
    3, x + w * 0.44, g - h * 0.34, x + hw, g - h * 0.18, x + hw, g,
    2, x, g + w * 0.28, x - hw, g,
    4,
  ];
}

/** Chamas: línguas de fogo subindo do chão em volta do corpo (mistura aditiva) + brasas */
function auraFlames(P: Pen, S: AuraSpec, F: FxFrame, t: number, front: boolean): void {
  'worklet';
  const [cOr, cYe, cCore, cRed, cDeep] = S.c;
  const g = F.bust ? F.b + 2 : F.g + 1;
  // soft = língua que nasce do contorno: a base some por ~35% da altura (antes ficava opaca já em 6% e o núcleo quase
  // branco: blocos empilhados com base reta e faixa cor de pêssego); a fogueira do chão mantém a base no brilho do chão
  const draw = (x: number, base: number, w: number, h: number, sway: number, a: number, soft: boolean) => {
    const outer: FxGrad = soft
      ? { t: 'l', x1: 0, y1: base, x2: 0, y2: base - h, s: [[0, cRed, 0], [0.34, cOr, 0.55 * a], [0.52, cOr, 0.82 * a], [0.8, cRed, 0.5 * a], [1, cDeep, 0]] }
      : { t: 'l', x1: 0, y1: base, x2: 0, y2: base - h, s: [[0, cRed, 0], [0.1, cRed, 0.7 * a], [0.32, cOr, 0.85 * a], [0.72, cRed, 0.5 * a], [1, cDeep, 0]] };
    P.path(flameCmds(x, base, w, h, sway), { g: outer, b: 1 });
    const ih = h * 0.52;
    const inner: FxGrad = soft
      ? { t: 'l', x1: 0, y1: base, x2: 0, y2: base - ih, s: [[0, cYe, 0], [0.42, cYe, 0.5 * a], [0.7, cOr, 0.32 * a], [1, cOr, 0]] }
      : { t: 'l', x1: 0, y1: base, x2: 0, y2: base - ih, s: [[0, cYe, 0], [0.14, mixRgb(cYe, cCore, 0.35), 0.62 * a], [0.5, cYe, 0.45 * a], [1, cOr, 0]] };
    P.path(flameCmds(x + sway * 0.15, base, w * 0.52, ih, sway * 0.55), { g: inner, b: 1 });
  };
  if (!front) {
    // brilho quente colado na silhueta + chão em brasa
    P.glowOval(F.cx, F.cy + F.ry * 0.1, F.rx * 0.95, F.ry * 0.95, cOr, 0.2 * S.k, 1);
    P.glowOval(F.cx, g - 3, F.rx * 1.1, (F.bust ? 10 : 10) * F.u, cOr, 0.55 * S.k, 1);
    // línguas de fogo nascendo do contorno do corpo (dos pés aos ombros), inclinadas pra fora: a parte de dentro fica
    // escondida atrás do corpo e o que aparece é um contorno de fogo
    const shY = F.hy + F.hr * 1.9;
    const per = P.lite ? 3 : 5 + S.lv;
    for (let side = -1; side <= 1; side += 2) {
      for (let k = 0; k < per; k++) {
        const id = k * 2 + (side > 0 ? 1 : 0);
        const v = per === 1 ? 0.5 : k / (per - 1);
        const y = mixN(g - 6, shY + 2, v) + (rnd(id, 11) - 0.5) * 4;
        // a base nasce DENTRO da silhueta (fica escondida atrás do corpo); roupa larga (asas, capa, saia) empurra pra borda
        // dela, senão as línguas somem atrás da roupa
        const hwb = F.bust ? F.rx * 0.58 : mixN(F.rx * 0.16, F.rx * 0.24, v) + (F.wide ?? 0) * (0.35 + 0.55 * v);
        const x = F.cx + side * hwb;
        const fl = 0.75 + 0.4 * noise1(t * 2.9 + id * 4.7, id + 3);
        const h = (19 + 14 * (1 - v * 0.4) + 12 * rnd(id, 12)) * fl * S.z * F.u * (F.bust ? 0.8 : 1);
        const w = (7 + 3 * rnd(id, 13)) * F.u * S.z;
        // inclinada pra fora: a base fica atrás do corpo e a língua sai pela lateral
        const sway = side * w * (1.7 + 0.6 * v) + (noise1(t * 2.1 + id * 3.1, id + 40) - 0.5) * w * 1.1;
        draw(x, y + w * 0.3, w, h, sway, S.k * 0.72, true);
        P.glow(x + sway * 0.5, y - h * 0.55, h * 0.5, cOr, 0.1 * S.k, 1);
      }
    }
    // fogueira baixa nos pés
    const nb = P.lite ? 3 : 5;
    for (let j = 0; j < nb; j++) {
      const xn = j / (nb - 1) - 0.5;
      const fl = 0.8 + 0.3 * noise1(t * 2.7 + j * 7.1, j);
      const h = (F.bust ? 10 : 18) * (1 - Math.abs(xn) * 0.6) * fl * S.z * F.u;
      const w = (10 + 4 * rnd(j, 3)) * F.u * S.z;
      draw(F.cx + xn * F.rx * 0.8, g, w, h, (noise1(t * 1.8 + j * 3.3, j + 50) - 0.5) * w, S.k, false);
    }
  } else {
    // na frente: só lambidas baixas nos lados dos pés (o sapato continua visível)
    const nf = P.lite ? 2 : 4;
    for (let j = 0; j < nf; j++) {
      const sideX = j % 2 ? 1 : -1;
      const x = F.cx + sideX * F.rx * (0.5 + 0.22 * Math.floor(j / 2)) + (rnd(j, 9) - 0.5) * 3;
      const fl = 0.75 + 0.35 * noise1(t * 3.1 + j * 5.3, j + 20);
      const h = (F.bust ? 7 : 12) * fl * S.z * F.u;
      const w = (6 + 2.5 * rnd(j, 8)) * F.u * S.z;
      const sway = (noise1(t * 2.2 + j * 2.9, j + 70) - 0.5) * w;
      draw(x, g + 2, w, h, sway, S.k * 0.8, false);
    }
  }
  for (let i = 0; i < S.n; i++) {
    if (inFront(i, 0.35) !== front) continue;
    const [ph, cyc] = life(t, 1.3 + rnd(i, 1) * 1.1, rnd(i, 2));
    const x0 = F.cx + (rnd(i * 5 + cyc, 3) - 0.5) * F.rx * 2.1;
    const x = x0 + Math.sin(ph * 7 + i) * 2.4 * F.u;
    const y = g - 2 - ph * F.ry * (F.bust ? 1.6 : 1.25);
    const a = (1 - ph) * smooth(0, 0.1, ph) * S.k * (front ? faceFade(F, x, y) : 1);
    mote(P, x, y, (0.45 + 0.5 * rnd(i, 4)) * F.u * S.z, mixRgb(cYe, cRed, ph), a);
  }
}

/** pontos de um raio entre dois ângulos da elipse, com zigue-zague sorteado pelo quadro */
function boltCmds(F: FxFrame, a0: number, a1: number, rho: number, seed: number, amp: number): number[] {
  'worklet';
  const out: number[] = [];
  const n = 9;
  for (let k = 0; k <= n; k++) {
    const s = k / n;
    const a = a0 + (a1 - a0) * s;
    const r = rho + 0.16 * Math.sin(Math.PI * s);
    const j = k === 0 || k === n ? 0 : (rnd(seed, k) - 0.5) * 2 * amp;
    const x = F.cx + Math.cos(a) * (F.rx * r + j);
    // dentro da caixa visível (no SVG estático o raio de baixo saía cortado reto pela base)
    const y = Math.max(F.t + 2, Math.min(F.b - 2, F.cy + Math.sin(a) * (F.ry * r * 0.96 + j)));
    out.push(k ? 1 : 0, x, y);
  }
  return out;
}

/** Energia elétrica: raios ramificados piscando em volta + faíscas elétricas */
function auraElectric(P: Pen, S: AuraSpec, F: FxFrame, t: number, front: boolean): void {
  'worklet';
  const [cm, cl, cb, cv] = S.c;
  if (!front) {
    halo(P, F, cm, 0.16 * S.k);
    P.glowOval(F.cx, F.cy, F.rx * 1.05, F.ry * 0.9, cv, 0.08 * S.k, 1);
  }
  const nb = front ? (F.bust ? 0 : 1 + (S.lv === 2 ? 1 : 0)) : 3 + S.lv;
  for (let j = 0; j < nb; j++) {
    const id = front ? j + 10 : j;
    const slot = Math.floor(t * 7 + id * 0.37);
    const on = rnd(id, slot) < (P.lite ? 1 : 0.64);
    if (!on) continue;
    const flash = 0.65 + 0.35 * rnd(id, slot + 99);
    let a0 = rnd(id * 13 + slot, 21) * TAU;
    if (front) a0 = (0.15 + rnd(id * 13 + slot, 22) * 0.45) * Math.PI; // frente: só embaixo (longe do rosto)
    const span = (0.55 + 0.6 * rnd(id, slot + 7)) * (rnd(id, slot + 3) < 0.5 ? -1 : 1);
    const amp = 2.6 * F.u;
    const main = boltCmds(F, a0, a0 + span, 0.9, id * 1000 + slot, amp);
    const br = boltCmds(F, a0 + span * 0.45, a0 + span * 0.8, 1.05, id * 1000 + slot + 500, amp * 0.8);
    const k = flash * S.k;
    P.path(main, { c: cb, a: 0.25 * k, w: 5 * F.u, b: 1 });
    P.path(main, { c: cm, a: 0.6 * k, w: 2 * F.u, b: 1 });
    P.path(main, { c: 0xffffff, a: 0.95 * k, w: 0.65 * F.u });
    P.path(br, { c: cm, a: 0.4 * k, w: 1.1 * F.u, b: 1 });
    P.path(br, { c: cl, a: 0.85 * k, w: 0.38 * F.u });
    const ex = F.cx + Math.cos(a0) * F.rx * 0.9;
    const ey = F.cy + Math.sin(a0) * F.ry * 0.9 * 0.96;
    P.glow(ex, ey, 4 * F.u, cm, 0.5 * k, 1);
  }
  for (let i = 0; i < S.n; i++) {
    if (inFront(i, 0.3) !== front) continue;
    const slot = Math.floor(t * 9 + i * 0.29);
    const ang = rnd(i * 3 + slot, 31) * TAU;
    const rho = 0.8 + 0.35 * rnd(i * 5 + slot, 32);
    const x = F.cx + Math.cos(ang) * F.rx * rho;
    const y = F.cy + Math.sin(ang) * F.ry * rho * 0.96;
    const a = (0.4 + 0.6 * rnd(i, slot)) * S.k * (front ? faceFade(F, x, y) : 1);
    mote(P, x, y, 0.55 * F.u * S.z, rnd(i, 33) < 0.3 ? cv : cl, a);
  }
}

/** um cristal facetado (bipirâmide hexagonal) girando no próprio eixo */
function crystal(P: Pen, S: AuraSpec, x: number, y: number, sz: number, spin: number, tilt: number, a: number): void {
  'worklet';
  const [cm, cl, cd, ci] = S.c;
  P.glow(x, y, sz * 2.8, cm, 0.42 * a, 1);
  P.save();
  P.translate(x, y);
  P.rotate(tilt);
  P.scale(sz, sz);
  const m = Math.sin(spin) * 0.42;
  const L: number[] = [0, 0, -1.5, 1, -0.55, -0.45, 1, -0.55, 0.5, 1, 0, 1.4, 1, m, 0.5, 1, m, -0.45, 4];
  const R: number[] = [0, 0, -1.5, 1, m, -0.45, 1, m, 0.5, 1, 0, 1.4, 1, 0.55, 0.5, 1, 0.55, -0.45, 4];
  P.path(L, { g: { t: 'l', x1: -0.6, y1: -1.5, x2: 0.4, y2: 1.4, s: [[0, cm, 1], [1, cd, 1]] }, a });
  P.path(R, { g: { t: 'l', x1: 0, y1: -1.5, x2: 0.6, y2: 1.4, s: [[0, 0xffffff, 1], [0.45, cl, 1], [1, mixRgb(cm, ci, 0.5), 1]] }, a });
  // faceta de cima mais clara e quina de luz
  P.path([0, 0, -1.5, 1, m, -0.45, 1, 0.55, -0.45, 4], { c: 0xffffff, a: 0.45 * a });
  P.path([0, 0, -1.5, 1, m, -0.45, 1, m, 0.5, 1, 0, 1.4], { c: 0xffffff, a: 0.7 * a, w: 0.09 });
  P.path([0, 0, -1.5, 1, 0.55, -0.45, 1, 0.55, 0.5, 1, 0, 1.4, 1, -0.55, 0.5, 1, -0.55, -0.45, 4], { c: cd, a: 0.5 * a, w: 0.07 });
  P.restore();
}

/** Cristais flutuantes: cristais facetados orbitando em dois anéis (os da frente passam por cima) + lascas cintilando */
function auraCrystals(P: Pen, S: AuraSpec, F: FxFrame, t: number, front: boolean): void {
  'worklet';
  const [cm, cl] = S.c;
  if (!front) halo(P, F, cm, 0.16 * S.k);
  const M = P.lite ? 4 : Math.max(5, Math.min(9, Math.round(S.n * 0.32)));
  for (let i = 0; i < M; i++) {
    const upper = i % 2 === 0;
    const dir = upper ? 1 : -1;
    const ph = (i * TAU) / M + t * 0.42 * dir;
    const R = F.rx * (upper ? 1.0 : 1.12) * (F.bust ? 1.05 : 1);
    const ocy = F.bust ? F.cy + (upper ? -4 : 8) : F.cy + (upper ? -F.ry * 0.28 : F.ry * 0.18);
    const z = Math.sin(ph);
    if (z > 0 !== front) continue;
    const x = F.cx + Math.cos(ph) * R;
    const y = ocy + z * R * 0.26 + Math.sin(t * 1.3 + i * 1.9) * 1.6 * F.u;
    const sz = (3.9 + 1.4 * rnd(i, 1)) * F.u * S.z * (0.82 + 0.18 * z);
    const a = S.k * (front ? faceFade(F, x, y) : 0.92);
    crystal(P, S, x, y, sz, t * 1.6 + i * 1.3, Math.sin(t * 0.9 + i) * 14, a);
    const gl = Math.sin(t * 2.1 + i * 2.7);
    if (gl > 0.9) P.shape('glint', x, y - sz * 1.4, sz * 2.5 * (gl - 0.9) * 10, 0, { c: 0xffffff, a: 0.9 * a });
  }
  for (let i = M; i < S.n; i++) {
    if (inFront(i, 0.3) !== front) continue;
    const ang = rnd(i, 61) * TAU + t * 0.25 * (i % 2 ? 1 : -1);
    const rho = 0.7 + 0.5 * rnd(i, 62);
    const x = F.cx + Math.cos(ang) * F.rx * rho * 1.1;
    const y = F.cy + Math.sin(ang) * F.ry * rho * 0.9 + Math.sin(t + i) * 1.5;
    const tw = 0.5 + 0.5 * Math.sin(t * (2 + rnd(i, 63) * 2) + i);
    const a = (0.35 + 0.65 * tw) * S.k * (front ? faceFade(F, x, y) : 1);
    P.glow(x, y, 2 * F.u, cm, 0.35 * a, 1);
    P.shape('diamond', x, y, (0.7 + 0.5 * rnd(i, 64)) * F.u * S.z, t * 40 + i * 30, { c: cl, a });
  }
}

/** Névoa mágica: bancos de névoa nos pés, fitas de fumaça subindo em S e pontinhos de luz */
function auraMist(P: Pen, S: AuraSpec, F: FxFrame, t: number, front: boolean): void {
  'worklet';
  const [cm, c2, c3] = S.c;
  const g = F.bust ? F.b - 2 : F.g - 3;
  if (!front) {
    halo(P, F, cm, 0.16 * S.k);
    // fitas de fumaça: cada uma nasce no chão, sobe ondulando e some; traço largo e macio por cima de um fino
    const K = P.lite ? 3 : 6;
    const seg = P.lite ? 10 : 14;
    for (let j = 0; j < K; j++) {
      const [ph] = life(t, 5 + rnd(j, 1) * 2.5, rnd(j, 2));
      const x0 = F.cx + (j / (K - 1) - 0.5) * 2 * F.rx * 0.95;
      const H = F.ry * (F.bust ? 1.3 : 1.15) * (0.75 + 0.3 * rnd(j, 3));
      const life01 = Math.sin(Math.PI * ph);
      const col = j % 2 ? c3 : c2;
      const y0 = g - ph * 0.35 * H;
      const y1 = y0 - 0.65 * H;
      const cmds: number[] = [];
      for (let q = 0; q <= seg; q++) {
        const s = q / seg;
        cmds.push(q ? 1 : 0, x0 + Math.sin(s * 4 + ph * 5 + j * 1.7) * 5 * F.u * (0.4 + s), mixN(y0, y1, s));
      }
      const a = life01 * S.k;
      const grad = (k: number): FxGrad => ({ t: 'l', x1: 0, y1: y0, x2: 0, y2: y1, s: [[0, col, 0], [0.22, col, k * a], [0.6, col, k * a * 0.5], [1, col, 0]] });
      // seis traços de largura crescente e alfa decrescente: borda macia (três traços liam como pente de faixas duras)
      P.path(cmds, { g: grad(0.05), w: 21 * F.u * S.z, b: 1 });
      P.path(cmds, { g: grad(0.06), w: 15.5 * F.u * S.z, b: 1 });
      P.path(cmds, { g: grad(0.07), w: 11 * F.u * S.z, b: 1 });
      P.path(cmds, { g: grad(0.08), w: 7.2 * F.u * S.z, b: 1 });
      P.path(cmds, { g: grad(0.1), w: 4.2 * F.u * S.z, b: 1 });
      P.path(cmds, { g: grad(0.16), w: 1.8 * F.u * S.z, b: 1 });
    }
  }
  const banks = front ? (P.lite ? 2 : 3) : P.lite ? 3 : 5;
  for (let j = 0; j < banks; j++) {
    const id = front ? j + 20 : j;
    const rx = (17 + 7 * rnd(id, 6)) * F.u * S.z;
    const x0 = F.cx + (j / (banks - 1) - 0.5) * 2 * F.rx * (front ? 0.8 : 1.15) + Math.sin(t * 0.35 + id * 1.7) * 7 * F.u;
    // o banco cabe na caixa visível (no SVG estático a borda do viewBox cortava a névoa reto)
    const x = Math.max(F.l + rx * 0.85, Math.min(F.r - rx * 0.85, x0));
    const y = g + (front ? 1.5 : -2) - rnd(id, 5) * 3;
    P.glowOval(x, y, rx, rx * 0.36, id % 2 ? c2 : cm, (front ? 0.4 : 0.62) * S.k);
    P.glowOval(x, y - rx * 0.06, rx * 0.6, rx * 0.16, lighten(cm, 0.5), (front ? 0.2 : 0.28) * S.k, 1);
  }
  for (let i = 0; i < S.n; i++) {
    if (inFront(i, 0.3) !== front) continue;
    const [ph, cyc] = life(t, 3.5 + rnd(i, 1) * 2.5, rnd(i, 2));
    const x = F.cx + (rnd(i * 7 + cyc, 3) - 0.5) * 2 * F.rx * 1.1 + Math.sin(ph * 4 + i) * 3 * F.u;
    const y = g - ph * F.ry * 1.5;
    const a = Math.sin(Math.PI * ph) * S.k * (front ? faceFade(F, x, y) : 1);
    mote(P, x, y, 0.75 * F.u * S.z, i % 3 ? c3 : 0xffffff, a);
  }
}

/** Poeira de estrelas: hélice dupla de poeira cintilante descendo devagar em volta do corpo */
function auraStardust(P: Pen, S: AuraSpec, F: FxFrame, t: number, front: boolean): void {
  'worklet';
  const [cm, cl, cp] = S.c;
  const top = F.cy - F.ry * 1.0;
  const H = F.ry * 2.0;
  const helix = (s: number, strand: number): [number, number, number] => {
    const ang = s * TAU * 2.1 + t * 0.9 + strand * Math.PI;
    const x = F.cx + Math.cos(ang) * F.rx * (0.82 + 0.2 * Math.sin(s * Math.PI));
    return [x, top + s * H, Math.sin(ang)];
  };
  if (!front) halo(P, F, cm, 0.12 * S.k);
  // rastro das fitas (largo + fino): cada trecho visível vira UMA curva lisa pelos pontos médios, com o esmaecimento das
  // pontas num gradiente vertical (antes: traços retos de ~6,7 por volta, que liam como gaiola de arame hexagonal)
  const seg = P.lite ? 48 : 64;
  const fadeG = (c: Rgb, k: number): FxGrad => ({ t: 'l', x1: 0, y1: top, x2: 0, y2: top + H, s: [[0, c, 0], [0.15, c, 0.6 * k], [0.5, c, k], [0.85, c, 0.6 * k], [1, c, 0]] });
  const strandPath = (pts: number[]) => {
    if (pts.length < 6) return;
    const cmds: number[] = [0, pts[0], pts[1]];
    for (let q = 2; q < pts.length - 2; q += 2) cmds.push(2, pts[q], pts[q + 1], (pts[q] + pts[q + 2]) / 2, (pts[q + 1] + pts[q + 3]) / 2);
    cmds.push(1, pts[pts.length - 2], pts[pts.length - 1]);
    P.path(cmds, { g: fadeG(cm, 0.08 * S.k), w: 4 * F.u * S.z, b: 1, cap: 1 });
    P.path(cmds, { g: fadeG(cl, 0.19 * S.k), w: 0.35 * F.u, b: 1, cap: 1 });
  };
  for (let strand = 0; strand < 2; strand++) {
    let run: number[] = [];
    for (let k = 0; k <= seg; k++) {
      const q = helix(k / seg, strand);
      if (q[2] > 0 === front && (!front || faceFade(F, q[0], q[1]) > 0.5)) {
        run.push(q[0], q[1]);
      } else {
        strandPath(run);
        run = [];
      }
    }
    strandPath(run);
  }
  // no quadro parado das listas (poucas partículas), mais poeira brilhando em cima das fitas
  const N = S.n + (P.lite ? 8 : 0);
  for (let i = 0; i < N; i++) {
    const fall = i < S.n && i % 4 === 3;
    let x: number;
    let y: number;
    let z: number;
    if (fall) {
      const [ph, cyc] = life(t, 3.2 + rnd(i, 1) * 2, rnd(i, 2));
      x = F.cx + (rnd(i + cyc * 7, 3) - 0.5) * 2 * F.rx * 1.15;
      y = F.t + ph * (F.b - F.t);
      z = inFront(i, 0.3) ? 1 : -1;
    } else {
      const s = fract(i / N + rnd(i, 4) * 0.05 + t * 0.05);
      [x, y, z] = helix(s, i % 2);
      x += (rnd(i, 5) - 0.5) * 3 * F.u;
      y += (rnd(i, 6) - 0.5) * 3 * F.u;
    }
    if (z > 0 !== front) continue;
    const tw = 0.5 + 0.5 * Math.sin(t * (3 + rnd(i, 7) * 3) + i * 1.3);
    const a = (0.4 + 0.6 * tw) * S.k * (front ? faceFade(F, x, y) : 1) * (fall ? 0.8 : 1);
    if (a <= 0.01) continue;
    const sz = (0.6 + 0.6 * rnd(i, 8)) * F.u * S.z;
    const col = i % 3 === 0 ? cp : i % 3 === 1 ? cm : cl;
    P.glow(x, y, sz * 3, col, 0.4 * a, 1);
    P.shape('glint', x, y, sz * (1.2 + 1.4 * tw), 0, { c: 0xffffff, a });
  }
}

/** Pétalas: pétalas caindo com vento, girando e virando (verso mais escuro), na frente e atrás */
function auraPetals(P: Pen, S: AuraSpec, F: FxFrame, t: number, front: boolean): void {
  'worklet';
  const [cm, cl, cd] = S.c;
  if (!front) halo(P, F, cm, 0.12 * S.k);
  for (let i = 0; i < S.n; i++) {
    const fr = inFront(i, 0.35);
    if (fr !== front) continue;
    const [ph, cyc] = life(t, 4.6 + rnd(i, 1) * 2.6, rnd(i, 2));
    const x0 = F.l + 2 + rnd(i * 3 + cyc, 3) * (F.r - F.l - 4);
    const x = x0 + Math.sin(t * 0.9 + i * 1.7) * 4.5 * F.u + (ph - 0.5) * 9 * F.u;
    const y = F.t - 5 + ph * (F.b - F.t + 10);
    const flip = Math.cos(t * (1.5 + rnd(i, 4)) + i * 2.1);
    const rot = rnd(i, 5) * 360 + t * (35 + rnd(i, 6) * 45) * (i % 2 ? 1 : -1);
    const sz = (2.8 + 1.4 * rnd(i, 7)) * F.u * S.z * (fr ? 1.25 : 1);
    const a = smooth(0, 0.06, ph) * (1 - smooth(0.92, 1, ph)) * S.k * (front ? faceFade(F, x, y) : 0.9);
    if (a <= 0.01) continue;
    const back = flip < 0;
    const g: FxGrad = { t: 'l', x1: 0, y1: 1, x2: 0, y2: -1, s: [[0, back ? darken(cd, 0.1) : cd, 1], [0.55, back ? cm : mixRgb(cm, cl, 0.4), 1], [1, back ? mixRgb(cm, cl, 0.3) : cl, 1]] };
    P.shape('petal', x, y, sz, rot, { g, a }, 0.2 + 0.8 * Math.abs(flip), 1);
  }
}

/** Holograma: projetor no chão, feixe, linhas de varredura subindo, faixa de scan e glitch leve */
function auraHologram(P: Pen, S: AuraSpec, F: FxFrame, t: number, front: boolean): void {
  'worklet';
  const [cm, cl, cb, cg] = S.c;
  const g = F.bust ? F.b - 1 : F.g + 0.5;
  const drx = F.rx * (F.bust ? 1.0 : 0.82);
  const dry = (F.bust ? 3.2 : 4.6) * S.z;
  if (!front) {
    halo(P, F, cm, 0.1 * S.k);
    // feixe: trapézio do disco pra cima, some no alto
    const topY = F.bust ? F.t : F.cy - F.ry * 1.05;
    // borda macia: cinco trapézios encaixados (o SVG não tem gradiente nos dois sentidos; um só tinha borda reta e dura)
    const beam: FxGrad = { t: 'l', x1: 0, y1: g, x2: 0, y2: topY, s: [[0, cm, 0.056 * S.k], [0.6, cm, 0.017 * S.k], [1, cm, 0]] };
    for (let q = 0; q < 5; q++) {
      const f = 1.08 - q * 0.17;
      P.path([0, F.cx - drx * f, g, 1, F.cx - drx * 1.25 * f, topY, 1, F.cx + drx * 1.25 * f, topY, 1, F.cx + drx * f, g, 4], { g: beam, b: 1 });
    }
    // linhas de varredura dentro da elipse da aura
    if (!P.lite) {
      P.save();
      P.clipOval(F.cx, F.cy - (F.bust ? 0 : F.ry * 0.02), F.rx * 1.22, F.ry * 1.04);
      const step = 2.6 * F.u;
      const off = (t * 5 * F.u) % step;
      for (let y = F.cy + F.ry * 1.05 - off; y > F.cy - F.ry * 1.05; y -= step) P.path([0, F.l, y, 1, F.r, y], { c: cl, a: 0.09 * S.k, w: 0.3 * F.u, cap: 1 });
      P.restore();
    }
    // metade de trás do projetor
    P.path(arcCmds(F.cx, g, drx, dry, 180, 180), { c: cm, a: 0.75 * S.k, w: 0.7 * F.u, b: 1 });
    P.glowOval(F.cx, g, drx * 0.9, dry * 1.3, cm, 0.4 * S.k, 1);
  } else {
    // metade da frente do projetor + anel tracejado girando
    P.path(arcCmds(F.cx, g, drx, dry, 0, 180), { c: cl, a: 0.85 * S.k, w: 0.7 * F.u, b: 1 });
    const dash = P.lite ? 6 : 12;
    for (let d = 0; d < dash; d++) {
      const a0 = (d * 360) / dash + t * 40;
      if (Math.sin(((a0 + 7) * Math.PI) / 180) < 0) continue;
      P.path(arcCmds(F.cx, g, drx * 0.72, dry * 0.72, a0, 360 / dash / 2), { c: cm, a: 0.8 * S.k, w: 0.5 * F.u, cap: 1, b: 1 });
    }
    // faixa de scan passando pelo corpo
    if (!P.lite) {
      const yb = g - fract(t * 0.32) * (F.bust ? F.b - F.t : F.ry * 2.1);
      const fa = 0.5 + 0.5 * faceFade(F, F.hx, yb);
      const band: FxGrad = { t: 'l', x1: 0, y1: yb - 2.2, x2: 0, y2: yb + 2.2, s: [[0, cm, 0], [0.5, cm, 0.2 * S.k * fa], [1, cm, 0]] };
      P.save();
      P.clipOval(F.cx, F.cy, F.rx * 1.2, F.ry * 1.05);
      P.rect(F.l, yb - 2.2, F.r - F.l, 4.4, { g: band, b: 1 });
      P.path([0, F.l, yb, 1, F.r, yb], { c: cl, a: 0.45 * S.k * fa, w: 0.25 * F.u, cap: 1, b: 1 });
      P.restore();
      // glitch: fatias deslocadas com aberração de cor
      const slot = Math.floor(t * 5);
      if (rnd(slot, 77) < 0.32) {
        for (let q = 0; q < 2; q++) {
          const y = F.cy + (rnd(slot * 3 + q, 78) - 0.3) * F.ry * 1.1;
          const h = (0.6 + rnd(slot, q + 80) * 1.4) * F.u;
          const w = F.rx * (0.5 + rnd(slot, q + 81) * 0.6);
          const x = F.cx - w / 2 + (rnd(slot, q + 82) - 0.5) * 10;
          const fa2 = faceFade(F, x + w / 2, y);
          P.rect(x - 0.8, y, w, h, { c: cg, a: 0.3 * S.k * fa2, b: 1 });
          P.rect(x + 0.8, y, w, h, { c: cb, a: 0.3 * S.k * fa2, b: 1 });
        }
      }
    }
  }
  for (let i = 0; i < S.n; i++) {
    if (inFront(i, 0.25) !== front) continue;
    const [ph, cyc] = life(t, 2.2 + rnd(i, 1) * 1.6, rnd(i, 2));
    const x = F.cx + (rnd(i * 7 + cyc, 3) - 0.5) * 2 * drx * (1 + ph * 0.25);
    const y = g - 2 - ph * F.ry * (F.bust ? 1.6 : 1.5);
    const fl = rnd(i, Math.floor(t * 8)) < 0.85 ? 1 : 0.2;
    const a = Math.sin(Math.PI * ph) * S.k * fl * (front ? faceFade(F, x, y) : 1);
    if (a <= 0.01) continue;
    const sz = (0.5 + 0.5 * rnd(i, 4)) * F.u * S.z;
    P.rect(x - sz, y - sz, sz * 2, sz * 2, { c: cl, a: 0.85 * a });
    P.glow(x, y, sz * 3, cm, 0.3 * a, 1);
  }
}

/** Aura dourada real: raios de sol girando atrás da cabeça, auréola fina e faíscas douradas */
function auraGolden(P: Pen, S: AuraSpec, F: FxFrame, t: number, front: boolean): void {
  'worklet';
  const [cm, cl, cd] = S.c;
  const ccx = F.hx;
  const ccy = F.hy + F.hr * 0.55;
  if (!front) {
    halo(P, F, cm, 0.16 * S.k);
    P.glow(ccx, ccy, F.hr * 2.6, cl, 0.32 * S.k, 1);
    const L = (F.bust ? F.ry * 1.05 : F.ry * 0.62) * S.z;
    const r0 = F.hr * 0.9;
    for (let ring = 0; ring < 2; ring++) {
      const R = P.lite ? 12 : 16 + S.lv * 4;
      const Lr = L * (ring ? 0.72 : 1);
      const rg: FxGrad = { t: 'r', cx: 0, cy: 0, r: Lr, s: [[0, cl, 0], [0.2, cl, (ring ? 0.35 : 0.5) * S.k], [0.55, cm, 0.2 * S.k], [1, cd, 0]] };
      P.save();
      P.translate(ccx, ccy);
      P.rotate(ring ? -t * 9 + 7 : t * 6);
      for (let i = 0; i < R; i++) {
        const long = i % 2 === 0;
        const len = Lr * (long ? 1 : 0.7) * (0.9 + 0.14 * Math.sin(t * 1.3 + i * 1.7 + ring));
        const half = ((long ? 1.7 : 1.1) * Math.PI) / 180;
        const a = (i * TAU) / R;
        P.path([0, Math.cos(a - half * 0.3) * r0, Math.sin(a - half * 0.3) * r0, 1, Math.cos(a - half) * len, Math.sin(a - half) * len, 2, Math.cos(a) * len * 1.02, Math.sin(a) * len * 1.02, Math.cos(a + half) * len, Math.sin(a + half) * len, 1, Math.cos(a + half * 0.3) * r0, Math.sin(a + half * 0.3) * r0, 4], { g: rg, b: 1 });
      }
      P.restore();
    }
    // auréola
    P.oval(ccx, F.hy - F.hr * 0.05, F.hr * 1.55, F.hr * 1.55, { c: cl, a: 0.18 * S.k, w: 3.2 * F.u, b: 1 });
    P.oval(ccx, F.hy - F.hr * 0.05, F.hr * 1.55, F.hr * 1.55, { c: cl, a: 0.8 * S.k, w: 0.5 * F.u, b: 1 });
  }
  for (let i = 0; i < S.n; i++) {
    if (inFront(i, 0.3) !== front) continue;
    const [ph, cyc] = life(t, 2.4 + rnd(i, 1) * 1.6, rnd(i, 2));
    const ang = rnd(i * 9 + cyc, 3) * TAU;
    const rho = 0.6 + 0.55 * rnd(i * 5 + cyc, 4);
    const x = F.cx + Math.cos(ang) * F.rx * rho * 1.1;
    const y = F.cy + Math.sin(ang) * F.ry * rho - ph * 6 * F.u;
    const tw = Math.sin(Math.PI * ph);
    const a = tw * S.k * (front ? faceFade(F, x, y) : 1);
    spark(P, x, y, (1.2 + 1.3 * rnd(i, 5)) * F.u * S.z * (0.6 + 0.4 * tw), rnd(i, 6) < 0.3 ? 0xffffff : cm, a, 0);
  }
}

/** Arco-íris: anel de cores girando (varredura) em volta da cintura como um planeta, halo colorido e faíscas */
function auraRainbow(P: Pen, S: AuraSpec, F: FxFrame, t: number, front: boolean): void {
  'worklet';
  const cols = S.c;
  // no busto o anel principal fica nos ombros (abaixo do queixo) e o segundo vira uma auréola acima da cabeça
  const ringY = F.bust ? F.hy + F.hr * 2.1 : F.cy + F.ry * 0.07;
  const rr = F.rx * (F.bust ? 1.12 : 1.2);
  const ry = rr * 0.27;
  const W = (F.bust ? 2.4 : 3.2) * S.z;
  if (!front) {
    for (let j = 0; j < 6; j++) {
      const ang = (j * TAU) / 6 + t * 0.25;
      P.glow(F.cx + Math.cos(ang) * F.rx * 0.6, F.cy - F.ry * 0.05 + Math.sin(ang) * F.ry * 0.55, F.rx * 0.8, cols[j % cols.length], 0.13 * S.k, 1);
    }
  }
  const a0 = front ? 0 : 180;
  // segundo anel, mais fino e inclinado, no peito
  P.save();
  P.translate(F.cx, F.bust ? F.hy - F.hr * 1.3 : F.cy - F.ry * 0.3);
  P.rotate(F.bust ? -8 : -14);
  const r2 = F.bust ? F.hr * 1.25 / 0.9 : rr;
  // brilho largo da frente mais fraco: por cima da camiseta clara lia como faixa esbranquiçada
  P.ring(0, 0, r2 * 0.9, r2 * 0.27 * 0.9, W * 3.2, cols, -t * 70, (front ? 0.06 : 0.12) * S.k, a0, 180, 1);
  P.ring(0, 0, r2 * 0.9, r2 * 0.27 * 0.9, W * 0.55, cols, -t * 70, 0.85 * S.k, a0, 180);
  P.restore();
  P.ring(F.cx, ringY, rr, ry, W * 3, cols, t * 55, (front ? 0.08 : 0.16) * S.k, a0, 180, 1);
  P.ring(F.cx, ringY, rr, ry, W, cols, t * 55, 0.92 * S.k, a0, 180);
  P.ring(F.cx, ringY - W * 0.18, rr, ry, W * 0.25, [0xffffff, 0xffffff], 0, 0.45 * S.k, a0, 180);
  for (let i = 0; i < S.n; i++) {
    if (inFront(i, 0.3) !== front) continue;
    const [ph, cyc] = life(t, 2 + rnd(i, 1) * 1.4, rnd(i, 2));
    const ang = rnd(i * 13 + cyc, 3) * TAU;
    const rho = 0.6 + 0.55 * rnd(i * 7 + cyc, 4);
    const x = F.cx + Math.cos(ang) * F.rx * rho * 1.1;
    const y = F.cy + Math.sin(ang) * F.ry * rho * 0.95;
    const tw = Math.sin(Math.PI * ph);
    const a = tw * S.k * (front ? faceFade(F, x, y) : 1);
    spark(P, x, y, (1 + 1.2 * rnd(i, 5)) * F.u * S.z * (0.6 + 0.4 * tw), sampleCycle(cols, rnd(i, 6)), a, 0);
  }
}

/** um coração com volume (gradiente + brilho) */
function heart(P: Pen, S: AuraSpec, x: number, y: number, sz: number, rot: number, a: number): void {
  'worklet';
  const [cm, cl, cd] = S.c;
  // sumindo, clareia (a parada escura do volume com pouca alfa virava mancha bordô quase preta)
  const lt = clamp01((0.75 - a) / 0.75);
  P.glow(x, y, sz * 2.2, cm, 0.3 * a, 1);
  P.save();
  P.translate(x, y);
  P.rotate(rot);
  P.scale(sz, sz);
  P.shape('heart', 0, 0, 1, 0, { g: { t: 'r', cx: -0.35, cy: -0.45, r: 1.55, s: [[0, cl, 1], [0.5, mixRgb(cm, cl, lt * 0.5), 1], [1, mixRgb(cd, cm, lt), 1]] }, a });
  P.save();
  P.translate(-0.45, -0.46);
  P.rotate(-35);
  P.oval(0, 0, 0.24, 0.13, { c: 0xffffff, a: 0.7 * a });
  P.restore();
  P.restore();
}

/** Corações: coraçõezinhos subindo, balançando e batendo */
function auraHearts(P: Pen, S: AuraSpec, F: FxFrame, t: number, front: boolean): void {
  'worklet';
  if (!front) halo(P, F, S.c[0], 0.16 * S.k);
  for (let i = 0; i < S.n; i++) {
    const fr = inFront(i, 0.3);
    if (fr !== front) continue;
    const [ph, cyc] = life(t, 2.8 + rnd(i, 1) * 1.6, rnd(i, 2));
    const x0 = F.cx + (rnd(i * 3 + cyc, 3) - 0.5) * 2 * F.rx * 1.08;
    const x = x0 + Math.sin(ph * 6 + i) * 3 * F.u;
    const y = F.cy + F.ry * 0.85 - ph * F.ry * 1.9;
    const beat = 1 + 0.09 * Math.max(0, Math.sin(t * 7 + i));
    const sz = (2.1 + 1.9 * rnd(i, 4)) * F.u * S.z * beat * (fr ? 1.15 : 1);
    const a = smooth(0, 0.14, ph) * (1 - smooth(0.7, 1, ph)) * S.k * (front ? faceFade(F, x, y) : 1);
    // quadro parado das listas: coração no meio do sumiço lê como sujeira
    if (a <= (P.lite ? 0.35 : 0.01)) continue;
    heart(P, S, x, y, sz, Math.sin(ph * 5 + i) * 14, a);
  }
}

/** Bolhas de sabão: bolhas iridescentes subindo, bamboleando, e estourando no fim */
function auraBubbles(P: Pen, S: AuraSpec, F: FxFrame, t: number, front: boolean): void {
  'worklet';
  const [cm, cp, cy] = S.c;
  if (!front) halo(P, F, cm, 0.08 * S.k);
  const iri: Rgb[] = [cm, cp, cy, cm];
  for (let i = 0; i < S.n; i++) {
    const fr = inFront(i, 0.35);
    if (fr !== front) continue;
    const [ph, cyc] = life(t, 4.2 + rnd(i, 1) * 2.4, rnd(i, 2));
    const x0 = F.cx + (rnd(i * 3 + cyc, 3) - 0.5) * 2 * F.rx * 1.12;
    const x = x0 + Math.sin(t * 1.8 + i) * 2.4 * F.u;
    const y = F.cy + F.ry * 0.92 - ph * F.ry * 2.0;
    const r = (2.2 + 2.6 * rnd(i, 4)) * F.u * S.z * (fr ? 1.15 : 1);
    const ff = front ? faceFade(F, x, y) : 1;
    const a = smooth(0, 0.08, ph) * S.k * ff;
    if (ph < 0.9) {
      const wob = 0.05 * Math.sin(t * 4 + i);
      P.save();
      P.translate(x, y);
      P.scale(1 + wob, 1 - wob);
      P.circle(0, 0, r, { g: { t: 'r', cx: -r * 0.2, cy: -r * 0.25, r: r * 1.15, s: [[0, 0xffffff, 0.02 * a], [0.65, cp, 0.14 * a], [1, cm, 0.45 * a]] } });
      P.ring(0, 0, r, r, Math.max(0.32, r * 0.12), iri, t * 40 + i * 30, 0.95 * a);
      P.path(arcCmds(0, 0, r * 0.72, r * 0.72, 195, 70), { c: 0xffffff, a: 0.85 * a, w: Math.max(0.3, r * 0.11) });
      P.circle(r * 0.42, r * 0.42, r * 0.09, { c: 0xffffff, a: 0.6 * a });
      P.restore();
    } else {
      // estouro: um anel fino que some se abrindo + gotinhas voando pra fora
      const k = (ph - 0.9) / 0.1;
      const rr = r * (1 + 0.5 * k);
      const pa = (1 - k) * S.k * ff;
      for (let q = 0; q < 6; q++) {
        const ang = q * 1.047 + rnd(i, 9) * 1.2;
        const d = rr * (1.05 + 0.5 * k);
        P.circle(x + Math.cos(ang) * d, y + Math.sin(ang) * d, 0.35 * F.u * (1 - k * 0.5), { c: q % 2 ? 0xffffff : cp, a: pa });
      }
    }
  }
}

/** Neve: flocos caindo devagar (pontos macios e cristais de 6 braços girando) */
function auraSnow(P: Pen, S: AuraSpec, F: FxFrame, t: number, front: boolean): void {
  'worklet';
  const [cm, , cb] = S.c;
  if (!front) halo(P, F, cb, 0.1 * S.k);
  for (let i = 0; i < S.n; i++) {
    const fr = inFront(i, 0.35);
    if (fr !== front) continue;
    const [ph, cyc] = life(t, 5 + rnd(i, 1) * 3, rnd(i, 2));
    const x0 = F.l + 2 + rnd(i * 3 + cyc, 3) * (F.r - F.l - 4);
    const x = x0 + Math.sin(t * 0.8 + i * 1.3) * 3.5 * F.u + ph * 3 * F.u;
    const y = F.t - 4 + ph * (F.b - F.t + 8);
    // floco colado na orelha/cabelo ou na frente do joelho lia como defeito
    const a = smooth(0, 0.06, ph) * (1 - smooth(0.9, 1, ph)) * S.k * headFade(F, x, y, 1.7) * (front ? faceFade(F, x, y) * bodyFade(F, x, y) : 0.9);
    if (a <= 0.01) continue;
    const big = fr ? 1.3 : 1;
    if (rnd(i, 4) < 0.42) {
      const sz = (1.5 + 1.1 * rnd(i, 5)) * F.u * S.z * big;
      P.glow(x, y, sz * 1.7, cb, 0.3 * a, 1);
      P.shape('flake', x, y, sz, t * 22 * (i % 2 ? 1 : -1) + i * 30, { c: cm, a, w: 0.3 * F.u });
      P.circle(x, y, sz * 0.14, { c: 0xffffff, a });
    } else {
      const r = (0.5 + 0.6 * rnd(i, 6)) * F.u * S.z * big;
      P.glow(x, y, r * 2.6, cm, 0.45 * a, 1);
      P.circle(x, y, r * 0.75, { c: 0xffffff, a: 0.95 * a });
    }
  }
}

/** Vaga-lumes: luzinhas passeando em laços e piscando */
function auraFireflies(P: Pen, S: AuraSpec, F: FxFrame, t: number, front: boolean): void {
  'worklet';
  const [cm, cl, cw] = S.c;
  if (!front) P.glowOval(F.cx, F.cy + F.ry * 0.45, F.rx * 1.3, F.ry * 0.6, cw, 0.08 * S.k);
  for (let i = 0; i < S.n; i++) {
    if (inFront(i, 0.4) !== front) continue;
    const bx = F.cx + (rnd(i, 1) - 0.5) * 2 * F.rx * 1.15;
    const by = F.cy + (rnd(i, 2) - 0.42) * F.ry * 1.65;
    const x = bx + Math.sin(t * (0.5 + 0.4 * rnd(i, 3)) + i * 2.1) * 6 * F.u + Math.sin(t * 1.3 + i) * 1.8 * F.u;
    const y = by + Math.cos(t * (0.45 + 0.35 * rnd(i, 4)) + i * 1.3) * 5 * F.u;
    const bl = Math.pow(0.5 + 0.5 * Math.sin(t * (1.1 + rnd(i, 5) * 1.2) + i * 2.7), 3);
    // miniatura (lite, ~150 px): maiores e acesos, senão a aura lia como "Sem efeito"
    const a = (P.lite ? 0.6 + 0.4 * bl : 0.18 + 0.82 * bl) * S.k * (front ? faceFade(F, x, y) : 1);
    if (a <= 0.01) continue;
    const c = rnd(i, 6) < 0.3 ? cw : cm;
    const zz = P.lite ? 1.5 : 1;
    P.glow(x, y, 6.5 * F.u * S.z * zz, c, 0.45 * a, 1);
    P.glow(x, y, 2 * F.u * S.z * zz, cl, 0.9 * a, 1);
    P.circle(x, y, 0.42 * F.u * S.z * zz, { c: 0xffffff, a: 0.95 * a });
  }
}

/** y da pauta no x (fita que atravessa atrás do corpo na diagonal) */
function staffY(F: FxFrame, x: number, t: number): number {
  'worklet';
  const k = (x - F.l) / Math.max(1, F.r - F.l);
  return mixN(F.cy + F.ry * (F.bust ? 0.4 : 0.42), F.cy - F.ry * (F.bust ? 0.25 : 0.32), k) + Math.sin(x * 0.085 + t * 1.4) * 6 * F.u;
}

/** Notas musicais: pauta ondulando atrás do corpo e notas subindo, balançando */
function auraMusic(P: Pen, S: AuraSpec, F: FxFrame, t: number, front: boolean): void {
  'worklet';
  const cols = [S.c[0], S.c[1], S.c[2]];
  if (!front) {
    halo(P, F, S.c[0], 0.13 * S.k);
    const lines = P.lite ? 3 : 5;
    const pts = P.lite ? 12 : 26;
    const x0 = F.l + 1;
    const x1 = F.r - 1;
    for (let ln = 0; ln < lines; ln++) {
      const c: number[] = [];
      for (let k = 0; k <= pts; k++) {
        const x = x0 + ((x1 - x0) * k) / pts;
        c.push(k ? 1 : 0, x, staffY(F, x, t) + (ln - (lines - 1) / 2) * 1.25 * F.u);
      }
      const g: FxGrad = { t: 'l', x1: x0, y1: 0, x2: x1, y2: 0, s: [[0, S.c[0], 0], [0.2, S.c[0], 0.6 * S.k], [0.8, S.c[1], 0.6 * S.k], [1, S.c[1], 0]] };
      P.path(c, { g, w: 0.32 * F.u });
    }
  }
  for (let i = 0; i < S.n; i++) {
    const fr = inFront(i, 0.3);
    if (fr !== front) continue;
    const [ph, cyc] = life(t, 2.6 + rnd(i, 1) * 1.4, rnd(i, 2));
    const xs = F.l + 4 + rnd(i * 3 + cyc, 3) * (F.r - F.l - 8);
    const x = xs + Math.sin(ph * 5 + i) * 3 * F.u;
    const y = staffY(F, xs, t) - ph * F.ry * (F.bust ? 1.3 : 0.95);
    const a = smooth(0, 0.12, ph) * (1 - smooth(0.72, 1, ph)) * S.k * (front ? faceFade(F, x, y) : 1);
    if (a <= 0.01) continue;
    const c = cols[i % 3];
    const sz = (2.9 + 1.5 * rnd(i, 4)) * F.u * S.z * (fr ? 1.15 : 1);
    P.glow(x, y, sz * 1.8, c, 0.35 * a, 1);
    P.shape(rnd(i, 5) < 0.3 ? 'notes2' : 'note', x, y, sz, Math.sin(ph * 4 + i) * 16, { g: { t: 'l', x1: 0, y1: -1, x2: 0, y2: 1, s: [[0, lighten(c, 0.6), 1], [1, c, 1]] }, a });
  }
}

/** Supernova (lendária): estrela pulsando atrás dos ombros (o brilho aparece em volta da cabeça), ondas de choque em anéis e explosão de partículas */
function auraSupernova(P: Pen, S: AuraSpec, F: FxFrame, t: number, front: boolean): void {
  'worklet';
  const [cm, cg, cc, cw, cp] = S.c;
  const T = 2.6;
  const ccx = F.cx;
  const ccy = F.hy + F.hr * (F.bust ? 1.6 : 2.1);
  const pulse = 0.88 + 0.12 * Math.sin(t * 2.4);
  const age0 = fract(t / T);
  if (!front) {
    P.glow(ccx, ccy, F.rx * 1.45 * pulse, cm, 0.3 * S.k, 1);
    P.glow(ccx, ccy, F.rx * 0.7 * pulse, cg, 0.38 * S.k, 1);
    P.glow(ccx, ccy, 9 * F.u * pulse, cw, 0.85 * S.k, 1);
    if (age0 < 0.1) P.glow(ccx, ccy, F.rx * 1.3, cw, ((0.1 - age0) / 0.1) * 0.35 * S.k, 1);
    // risco de lente horizontal (anamórfico) e um vertical menor, finos
    P.glowOval(ccx, ccy, F.rx * 1.7 * pulse, 1.6 * F.u, cw, 0.7 * S.k, 1);
    P.glowOval(ccx, ccy, F.rx * 1.1 * pulse, 4 * F.u, cp, 0.3 * S.k, 1);
    P.glowOval(ccx, ccy, 1.3 * F.u, F.ry * 0.42 * pulse, cw, 0.45 * S.k, 1);
    const ringCols = [cm, cg, cc];
    for (let j = 0; j < 3; j++) {
      const age = fract((t - j * 0.22) / T);
      const R = easeOut3(age) * F.rx * (F.bust ? 1.35 : 1.65);
      const a = Math.pow(1 - age, 2) * smooth(0, 0.04, age) * S.k;
      if (a <= 0.01 || R <= 0.5) continue;
      P.oval(ccx, ccy, R, R * 0.94, { c: ringCols[j], a: 0.22 * a, w: 6 * F.u, b: 1 });
      P.oval(ccx, ccy, R, R * 0.94, { c: lighten(ringCols[j], 0.45), a: 0.9 * a, w: 0.9 * F.u, b: 1 });
    }
    // recarga: entre uma explosão e outra a energia volta num anel girando que encolhe até o núcleo (nenhum quadro vazio)
    const charge = smooth(0.35, 0.98, age0);
    if (charge > 0.01) {
      const Rc = F.rx * (F.bust ? 1.2 : 1.45) * (1 - 0.45 * charge);
      P.ring(ccx, ccy, Rc, Rc * 0.94, 5 * F.u, [cm, cg, cc, cp], t * 70, 0.22 * charge * S.k, undefined, undefined, 1);
      P.ring(ccx, ccy, Rc, Rc * 0.94, 1 * F.u, [cm, cg, cc, cp], t * 70, 0.85 * charge * S.k, undefined, undefined, 1);
      const m = P.lite ? 3 : 6;
      for (let j = 0; j < m; j++) {
        const ang = (j * TAU) / m + t * 1.6;
        mote(P, ccx + Math.cos(ang) * Rc, ccy + Math.sin(ang) * Rc * 0.94, 0.7 * F.u * S.z, [cm, cg, cc][j % 3], charge * S.k);
      }
    }
  }
  for (let i = 0; i < S.n; i++) {
    if (inFront(i, 0.3) !== front) continue;
    const age = fract(t / T - rnd(i, 1) * 0.06);
    const ang = rnd(i + Math.floor(t / T) * 31, 2) * TAU;
    const dist = easeOut3(age) * F.rx * (0.7 + 0.9 * rnd(i, 3)) * (F.bust ? 1.1 : 1.3);
    const dx = Math.cos(ang);
    const dy = Math.sin(ang) * 0.94;
    const x = ccx + dx * dist;
    const y = ccy + dy * dist;
    const a = Math.pow(1 - age, 1.3) * smooth(0, 0.03, age) * S.k * (front ? faceFade(F, x, y) : 1);
    if (a <= 0.01) continue;
    const c = [cm, cg, cc, cp][i % 4];
    const len = 3.2 * F.u * (1 - age);
    P.path([0, x - dx * len, y - dy * len, 1, x, y], { c, a: 0.8 * a, w: 0.5 * F.u * S.z, b: 1 });
    mote(P, x, y, 0.55 * F.u * S.z, c, a);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// despacho (worklet)
// ---------------------------------------------------------------------------------------------------------------
/** desenha uma camada da aura em unidades do viewBox (o chamador já aplicou ox/oy/s se for o palco) */
export function drawAuraUnits(P: Pen, S: AuraSpec, F: FxFrame, t: number, front: boolean): void {
  'worklet';
  switch (S.id) {
    case 'sparkle':
      return auraSparkle(P, S, F, t, front);
    case 'lime':
      return auraLime(P, S, F, t, front);
    case 'magenta':
      return auraMagenta(P, S, F, t, front);
    case 'gold':
      return auraGold(P, S, F, t, front);
    case 'fest':
      return auraFest(P, S, F, t, front);
    case 'pride':
      return auraPride(P, S, F, t, front);
    case 'galaxy':
      return auraGalaxy(P, S, F, t, front);
    case 'flames':
      return auraFlames(P, S, F, t, front);
    case 'electric':
      return auraElectric(P, S, F, t, front);
    case 'crystals':
      return auraCrystals(P, S, F, t, front);
    case 'mist':
      return auraMist(P, S, F, t, front);
    case 'stardust':
      return auraStardust(P, S, F, t, front);
    case 'petals':
      return auraPetals(P, S, F, t, front);
    case 'hologram':
      return auraHologram(P, S, F, t, front);
    case 'golden':
      return auraGolden(P, S, F, t, front);
    case 'rainbow':
      return auraRainbow(P, S, F, t, front);
    case 'hearts':
      return auraHearts(P, S, F, t, front);
    case 'bubbles':
      return auraBubbles(P, S, F, t, front);
    case 'snow':
      return auraSnow(P, S, F, t, front);
    case 'fireflies':
      return auraFireflies(P, S, F, t, front);
    case 'music':
      return auraMusic(P, S, F, t, front);
    case 'supernova':
      return auraSupernova(P, S, F, t, front);
    default:
      return auraLime(P, S, F, t, front);
  }
}

/** camada da aura no canvas do palco (px): aplica o enquadramento e desenha */
export function drawAura(P: Pen, S: AuraSpec, F: FxFrame, t: number, front: boolean): void {
  'worklet';
  P.save();
  P.translate(F.ox, F.oy);
  P.scale(F.s, F.s);
  drawAuraUnits(P, S, F, t, front);
  P.restore();
}
