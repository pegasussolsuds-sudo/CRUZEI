// Kit da chapelaria: referencial da cabeça (cabeça unitária → avatar), volume do cabelo por baixo do chapéu, tons de
// material e as receitas que chapéus, óculos e acessórios compartilham (copa com volume, sombra projetada, palha,
// tricô, cetim, metal, gema, vidro e neon). Dono: chapelaria.
//
// Referencial (cabeça unitária, multiplique por an.head.s): centro da cabeça em (0, 0); topo do crânio y = −11,1
// (CROWN_DY); o crânio é quase uma elipse de centro (0, −4,4), rx = largura do crânio do formato do rosto (7,6–8,8) e
// ry = 6,7; linha do cabelo −7,6; sobrancelha ≈ −1,5; olhos ≈ 0,9; topo da orelha ≈ −0,2; queixo 12–14. Tudo sai daqui
// e das âncoras (headAnchors), então o chapéu acompanha o formato do rosto, a estatura e a idade.

import { CROWN_DY, faceDims, hairLiftOf, headAnchors, headPath, headPts, sampleSpline, smoothPath, taperPath, type HeadAnchors, type SP } from '../anatomy';
import type { LayerCtx } from '../ctx';
import { blob, isLite, keepsBlur, lum, mix } from '../shading';
import type { AvatarGradient, AvatarLayer, AvatarStop, Pt } from '../types';

export { blob, isLite, keepsBlur, lum, mix, smoothPath, taperPath, type SP };

/** centro (y) da elipse do crânio e o raio vertical dela (cabeça unitária) */
export const SKULL_CY = -4.4;
export const SKULL_RY = SKULL_CY - CROWN_DY;

/**
 * volume do cabelo por baixo de um chapéu justo (cabeça unitária): o chapéu cresce um pouco pra caber o cabelo, que o
 * dono do cabelo achata embaixo dele (hat-modes.ts). Id desconhecido = 0,8 (cabelo médio).
 */
export const HAIR_BULK: Record<string, number> = {
  bald: 0,
  buzz: 0.15,
  receding: 0.3,
  thinning: 0.3,
  short: 0.6,
  side: 0.6,
  classic: 0.6,
  pixie: 0.5,
  quiff: 0.9,
  pompadour: 1.0,
  undercut: 0.6,
  side_shave: 0.5,
  mohawk: 0.5,
  mullet: 0.7,
  curtain: 0.7,
  long: 0.7,
  bob: 0.8,
  wavy: 0.9,
  ponytail: 0.6,
  low_bun: 0.6,
  bun: 0.6,
  updo: 0.7,
  space_buns: 0.6,
  braids: 0.6,
  braid_crown: 0.9,
  cornrows: 0.25,
  twists: 1.0,
  dreads: 1.1,
  curly: 1.3,
  long_curly: 1.3,
  afro_puff: 0.6,
  afro: 1.9,
};

export function hairBulk(hair: string | null | undefined): number {
  return hair ? (HAIR_BULK[hair] ?? 0.8) : 0.8;
}

/** referencial da cabeça pra chapelaria */
export interface HeadFrame {
  cx: number;
  cy: number;
  /** escala da cabeça */
  s: number;
  /** cabeça unitária → avatar (ponto de contorno com suavidade opcional) */
  P(x: number, y: number, sm?: number): SP;
  /** só o ponto (Pt) */
  Q(x: number, y: number): Pt;
  /** medidas do formato do rosto em unidades da cabeça (já com a idade) */
  Wu: number;
  Tu: number;
  Cu: number;
  Ju: number;
  chinU: number;
  /** topo do crânio (avatar) */
  T: number;
  ha: HeadAnchors;
  /** volume do cabelo por baixo de um chapéu justo (cabeça unitária) */
  bulk: number;
  /** quanto o cabelo solto sobe acima do crânio (cabeça unitária; HAIR_LIFT) */
  hairLift: number;
  lite: boolean;
  /** contorno da cabeça (rosto + crânio) */
  head: string;
  /** cabeça + cabelo rente (recorte das sombras de contato: nada vaza pro fundo) */
  near: string;
  /**
   * chapéu escuro sobre cabelo escuro (preto/marinho sobre preto/castanho-escuro): sem ajuda, chapéu e cabelo viram uma
   * mancha só na miniatura — a copa ganha luz de recorte no topo e nas laterais e o brilho fica mais forte
   */
  pop: boolean;
  /** x do contorno da cabeça à direita (avatar) numa altura y (avatar) */
  headX(y: number): number;
}

const frameCache = new WeakMap<object, HeadFrame>();

export function headFrame(ctx: LayerCtx): HeadFrame {
  const key = ctx.an as unknown as object;
  const hit = frameCache.get(key);
  const pop = lum(ctx.col.hat) < 0.04 && lum(ctx.col.hair) < 0.05;
  if (hit && hit.lite === isLite(ctx) && hit.bulk === hairBulk(ctx.cfg.hair) && hit.pop === pop) return hit;
  const an = ctx.an;
  const { cx, cy, s } = an.head;
  const fd = faceDims(an);
  const ha = headAnchors(an);
  const bulk = hairBulk(ctx.cfg.hair);
  const pts = headPts(an);
  // metade direita do contorno (do topo ao queixo) amostrada pra achar o x numa altura
  const right = sampleSpline(pts.slice(0, Math.ceil(pts.length / 2) + 1), 40);
  const headX = (y: number): number => {
    for (let i = 1; i < right.length; i++) {
      const a = right[i - 1];
      const b = right[i];
      if ((a[1] - y) * (b[1] - y) <= 0 && a[1] !== b[1]) return a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
    }
    return cx + fd.cheek;
  };
  const hf: HeadFrame = {
    cx,
    cy,
    s,
    P: (x, y, sm) => (sm == null ? [cx + x * s, cy + y * s] : [cx + x * s, cy + y * s, sm]),
    Q: (x, y) => [cx + x * s, cy + y * s],
    Wu: fd.cranium / s,
    Tu: fd.temple / s,
    Cu: fd.cheek / s,
    Ju: fd.jaw / s,
    chinU: fd.chinY / s,
    T: fd.crownY,
    ha,
    bulk,
    hairLift: hairLiftOf(ctx.cfg.hair, ctx.cfg.hat),
    lite: isLite(ctx),
    head: ha.headPath,
    near: headPath(an, (0.6 + bulk) * s),
    pop,
    headX,
  };
  frameCache.set(key, hf);
  return hf;
}

// ---------------------------------------------------------------------------------------------------------------
// tons
// ---------------------------------------------------------------------------------------------------------------

/** tons de um material a partir da cor base: luz quente, sombra fria e escura, rebatida e linha */
export interface Tones {
  base: string;
  light: string;
  lighter: string;
  shade: string;
  deep: string;
  /** borda da luz (sheen) */
  sheen: string;
  /** linha/costura escura */
  line: string;
  /** cor muito escura (preto/marinho): os brilhos mandam no volume */
  dark: boolean;
  /** cor muito clara (branco/bege): as sombras mandam */
  pale: boolean;
}

const toneCache = new Map<string, Tones>();

export function tones(c: string): Tones {
  const hit = toneCache.get(c);
  if (hit) return hit;
  const L = lum(c);
  const dark = L < 0.04;
  const pale = L > 0.55;
  const t: Tones = {
    base: c,
    light: mix(c, '#FFF6EC', dark ? 0.13 : pale ? 0.35 : 0.2),
    lighter: mix(c, '#FFFFFF', dark ? 0.26 : pale ? 0.6 : 0.42),
    shade: mix(c, pale ? '#3A3550' : '#0A0812', dark ? 0.32 : pale ? 0.2 : 0.26),
    deep: mix(c, '#05030A', dark ? 0.55 : pale ? 0.42 : 0.5),
    sheen: mix(c, '#F4F7FF', dark ? 0.32 : 0.55),
    line: mix(c, '#05030A', dark ? 0.6 : 0.55),
    dark,
    pale,
  };
  if (toneCache.size > 96) toneCache.clear();
  toneCache.set(c, t);
  return t;
}

/** cor "cheia" pra brilho de neon/gema: cinza, preto e branco viram a cor da marca */
export function vivid(c: string, fallback: string): string {
  const h = c.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  return mx - mn < 60 || mx < 90 ? fallback : c;
}

// ---------------------------------------------------------------------------------------------------------------
// geometria
// ---------------------------------------------------------------------------------------------------------------

/** arco de elipse em unidades da cabeça: ângulos em graus (0 = direita, 90 = em cima) */
export function arcU(hf: HeadFrame, cxu: number, cyu: number, rx: number, ry: number, a0: number, a1: number, n: number, sm?: number): SP[] {
  const out: SP[] = [];
  for (let i = 0; i < n; i++) {
    const a = ((a0 + ((a1 - a0) * i) / (n - 1)) * Math.PI) / 180;
    out.push(hf.P(cxu + Math.cos(a) * rx, cyu - Math.sin(a) * ry, sm));
  }
  return out;
}

/**
 * borda de baixo de uma copa vista de frente (unidades da cabeça), da DIREITA pra ESQUERDA: a faixa contorna a cabeça e
 * desce pra trás, então o meio fica mais alto e as laterais caem (`yS`); `p` = quão chato é o meio.
 */
export function bandU(hf: HeadFrame, w: number, yC: number, yS: number, n = 7, p = 2.2, skew = 0): SP[] {
  const out: SP[] = [];
  for (let i = 0; i < n; i++) {
    const u = 1 - (2 * i) / (n - 1);
    out.push(hf.P(u * w, yC + (yS - yC) * Math.pow(Math.abs(u), p) + skew * u));
  }
  return out;
}

/**
 * copa que cobre o crânio (unidades da cabeça): elipse do crânio afastada `lift`, com `extra` de altura no topo, laterais
 * descendo até `yS` (esquerda/direita podem diferir) e borda de baixo pela faixa (bandU). Devolve os pontos do contorno.
 */
export function domeU(hf: HeadFrame, o: { lift: number; extra?: number; yC: number; yS: number; skew?: number; flat?: number; p?: number; inset?: number; lean?: number }): SP[] {
  const w = hf.Wu + o.lift;
  const ry = SKULL_RY + o.lift + (o.extra ?? 0);
  const sk = o.skew ?? 0;
  const flat = o.flat ?? 0;
  const lean = o.lean ?? 0;
  const ins = o.inset ?? 0.25;
  const top: SP[] = [];
  const A = [180, 158, 136, 114, 90, 66, 44, 22, 0];
  for (const a of A) {
    const r = (a * Math.PI) / 180;
    const sy = Math.sin(r);
    // topo achatado (flat 0..1): o seno sobe mais rápido e o topo fica reto
    const k = flat ? Math.pow(sy, 1 - flat * 0.6) : sy;
    top.push(hf.P(Math.cos(r) * w + lean * sy * sy, SKULL_CY - k * ry));
  }
  const yL = o.yS - sk;
  const yR = o.yS + sk;
  const left: SP[] = [hf.P(-w + ins, yL, 0), hf.P(-w - 0.05, (yL + SKULL_CY) / 2)];
  const rightS: SP[] = [hf.P(w + 0.05, (yR + SKULL_CY) / 2), hf.P(w - ins, yR, 0)];
  const band = bandU(hf, w - ins, o.yC, o.yS, 7, o.p ?? 2.2, sk).slice(1, -1);
  return [...left, ...top.slice(1, -1), ...rightS, ...band];
}

/** caixa (avatar) de uma lista de pontos */
export function boxOf(pts: readonly SP[]): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p[0]);
    y0 = Math.min(y0, p[1]);
    x1 = Math.max(x1, p[0]);
    y1 = Math.max(y1, p[1]);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** desloca pontos (avatar) */
export function shift(pts: readonly SP[], dx: number, dy: number): SP[] {
  return pts.map((p) => (p.length > 2 ? ([p[0] + dx, p[1] + dy, p[2] as number] as SP) : ([p[0] + dx, p[1] + dy] as SP)));
}

/** limita o topo de uma forma alta ao viewBox: devolve o fator de compressão vertical em volta de `baseY` */
export function fitTop(topY: number, baseY: number, minY = 0.7): number {
  if (topY >= minY) return 1;
  return Math.max(0.45, (baseY - minY) / Math.max(0.01, baseY - topY));
}

/** comprime pontos verticalmente em volta de baseY */
export function squash(pts: readonly SP[], baseY: number, k: number): SP[] {
  if (k === 1) return pts.slice();
  return pts.map((p) => (p.length > 2 ? ([p[0], baseY + (p[1] - baseY) * k, p[2] as number] as SP) : ([p[0], baseY + (p[1] - baseY) * k] as SP)));
}

// ---------------------------------------------------------------------------------------------------------------
// receitas de volume
// ---------------------------------------------------------------------------------------------------------------

/** gradiente da copa: luz em cima à esquerda, sombra embaixo à direita (radial com foco puxado pra luz) */
export function domeGradient(b: { x: number; y: number; w: number; h: number }, t: Tones, k = 1): AvatarGradient {
  const r = Math.max(b.w, b.h) * 0.95;
  return {
    t: 'r',
    cx: b.x + b.w * 0.42,
    cy: b.y + b.h * 0.42,
    r,
    fx: b.x + b.w * 0.3,
    fy: b.y + b.h * 0.18,
    s: [
      [0, mix(t.base, t.light, Math.min(1, 1.15 * k))],
      [0.45, t.base],
      [0.85, mix(t.base, t.shade, Math.min(1, 0.85 * k))],
      [1, t.shade],
    ],
  };
}

/** gradiente linear em faixa (aba, fita): claro em cima à esquerda */
export function bandGradient(b: { x: number; y: number; w: number; h: number }, t: Tones, k = 1): AvatarGradient {
  return {
    t: 'l',
    x1: b.x,
    y1: b.y,
    x2: b.x + b.w * 0.6,
    y2: b.y + b.h + b.w * 0.25,
    s: [
      [0, mix(t.base, t.light, k)],
      [0.5, t.base],
      [1, mix(t.base, t.shade, k)],
    ],
  };
}

/**
 * peça com volume: base em gradiente + sombra própria do lado direito (recortada) + luz macia em cima à esquerda +
 * luz de recorte na borda. `pts` = contorno; `core` = quanto escurece o lado da sombra.
 */
export function shapeVolume(
  ctx: LayerCtx,
  hf: HeadFrame,
  pts: readonly SP[],
  t: Tones,
  o: { core?: number; sheen?: number; rim?: number; g?: AvatarGradient; extra?: Partial<AvatarLayer>; sheenAt?: [number, number]; sheenR?: [number, number] } = {},
): string {
  const d = smoothPath(pts, true);
  const b = boxOf(pts);
  ctx.push(d, t.base, { gf: o.g ?? domeGradient(b, t), ...o.extra });
  const core = o.core ?? 0.42;
  if (core > 0) {
    // crescente de sombra: o próprio contorno deslocado pra esquerda/cima, em evenodd, sobra a borda de baixo/direita
    const moved = smoothPath(shift(pts, -b.w * 0.16, -b.h * 0.1), true);
    ctx.push(d + moved, t.deep, { r: 'evenodd', o: core * (t.dark ? 0.7 : 1), cp: d, ...(hf.lite ? {} : { b: Math.max(0.35, b.w * 0.04) }) });
  }
  const sh = o.sheen ?? 0.3;
  if (sh > 0) {
    const at = o.sheenAt ?? [0.32, 0.3];
    const rr = o.sheenR ?? [0.22, 0.16];
    ctx.push(blob(b.x + b.w * at[0], b.y + b.h * at[1], b.w * rr[0], b.h * rr[1], -0.3), t.lighter, { o: Math.min(0.6, sh * (t.dark ? 1.1 : 1) * (hf.pop ? 1.35 : 1)), cp: d, ...(hf.lite ? {} : { b: Math.max(0.4, b.w * 0.07) }) });
  }
  const rim = o.rim ?? 0.3;
  if (rim > 0 && hf.pop) {
    // chapéu escuro sobre cabelo escuro: luz de recorte no topo e nas DUAS laterais (contorno deslocado pra dentro dos
    // dois lados, um path só), também no 'lite' — é o que separa a silhueta do chapéu da do cabelo
    const moved = smoothPath(shift(pts, 0.42, 0.38), true) + smoothPath(shift(pts, -0.42, 0.38), true);
    ctx.stroke(moved, mix(t.sheen, '#C8D2F0', 0.25), hf.lite ? 0.42 : 0.5, { o: hf.lite ? 0.5 : 0.42, cp: d, ...(hf.lite ? {} : { b: 0.2 }) });
  } else if (rim > 0 && !hf.lite) {
    const moved = smoothPath(shift(pts, 0.55, 0.45), true);
    ctx.stroke(moved, t.sheen, 0.9, { o: rim, b: 0.35, cp: d });
  }
  return d;
}

/**
 * sombra que a peça projeta logo abaixo de uma borda: faixa estreita e fraca que some nas pontas (sem corte seco),
 * recortada na CABEÇA (testa/têmporas e o cabelo por cima delas) — o cabelo longo ao lado do rosto não recebe a faixa,
 * senão ela vira um bloco cinza com ponta dura. A sobrancelha continua aparecendo. Desfocada no completo e no busto leve.
 */
export function castShadow(ctx: LayerCtx, hf: HeadFrame, edge: readonly SP[], o: { w?: number; dy?: number; o?: number; b?: number; cp?: string } = {}): void {
  const w = o.w ?? 1.4;
  const dy = o.dy ?? 0.75;
  ctx.push(taperPath(shift(edge, 0.25, dy), (u) => w * Math.min(1, Math.sin(Math.PI * u) * 1.7)), '#120A10', { o: o.o ?? 0.22, cp: o.cp ?? hf.head, ...(keepsBlur(ctx) ? { b: o.b ?? 0.7 } : {}) });
}

/** oclusão dentro da peça ao longo de uma borda (faixa escura macia recortada na peça) */
export function edgeShade(ctx: LayerCtx, hf: HeadFrame, edge: readonly SP[], clip: string, color: string, o: { w?: number; o?: number; dy?: number } = {}): void {
  const w = o.w ?? 1.0;
  ctx.push(taperPath(shift(edge, 0, o.dy ?? -0.2), [w * 0.4, w, w, w * 0.4]), color, { o: o.o ?? 0.35, cp: clip, ...(hf.lite ? {} : { b: 0.4 }) });
}

// ---------------------------------------------------------------------------------------------------------------
// texturas e materiais
// ---------------------------------------------------------------------------------------------------------------

/** palha trançada: anéis concêntricos (fileiras da trança) + fibras cruzadas; num path cada (só no completo) */
export function strawWeave(ctx: LayerCtx, hf: HeadFrame, clip: string, rows: readonly (readonly SP[])[], t: Tones, o: { o?: number; fine?: boolean } = {}): void {
  if (hf.lite) return;
  let dark = '';
  let lite = '';
  for (const row of rows) {
    dark += smoothPath(row, false);
    lite += smoothPath(shift(row, -0.12, -0.28), false);
  }
  const op = o.o ?? 1;
  ctx.stroke(dark, t.deep, o.fine ? 0.18 : 0.26, { o: 0.45 * op, cp: clip });
  ctx.stroke(lite, t.lighter, o.fine ? 0.16 : 0.22, { o: 0.55 * op, cp: clip });
  // fibras: tracinhos diagonais alternados ao longo de cada fileira (a trança)
  let fib = '';
  for (const row of rows) {
    const pts = sampleSpline(row, Math.max(6, Math.round(row.length * (o.fine ? 6 : 4))));
    for (let i = 1; i < pts.length; i++) {
      const [x, y] = pts[i];
      const a = i % 2 ? 0.32 : -0.32;
      fib += `M${(x - 0.22).toFixed(2)},${(y - 0.24 + a * 0.2).toFixed(2)}l${(0.44).toFixed(2)},${(0.48 * (i % 2 ? 1 : -1) * 0.5).toFixed(2)}`;
    }
  }
  ctx.stroke(fib, t.shade, 0.16, { o: 0.4 * op, cp: clip });
}

/** tricô canelado: colunas de "V" seguindo a curva da peça (um path de traço) */
export function knitRib(ctx: LayerCtx, hf: HeadFrame, clip: string, top: readonly SP[], bottom: readonly SP[], t: Tones, n: number): void {
  const A = sampleSpline(top, n);
  const B = sampleSpline(bottom, n);
  let valley = '';
  let ridge = '';
  for (let i = 0; i < n; i++) {
    const a = A[i];
    const b = B[i];
    valley += `M${a[0].toFixed(2)},${a[1].toFixed(2)}L${b[0].toFixed(2)},${b[1].toFixed(2)}`;
    if (i < n - 1) {
      const a2 = A[i + 1];
      const b2 = B[i + 1];
      ridge += `M${((a[0] + a2[0]) / 2 - 0.12).toFixed(2)},${((a[1] + a2[1]) / 2).toFixed(2)}L${((b[0] + b2[0]) / 2 - 0.12).toFixed(2)},${((b[1] + b2[1]) / 2).toFixed(2)}`;
    }
  }
  ctx.stroke(valley, t.deep, hf.lite ? 0.32 : 0.34, { o: hf.lite ? 0.28 : 0.42, cp: clip });
  if (!hf.lite) ctx.stroke(ridge, t.lighter, 0.3, { o: 0.22, cp: clip });
}

/** pontinhos de trama (feltro, tweed, atoalhado): um path */
export function fleck(ctx: LayerCtx, hf: HeadFrame, clip: string, b: { x: number; y: number; w: number; h: number }, color: string, o: { n?: number; r?: number; seed?: number; op?: number; dash?: boolean } = {}): void {
  if (hf.lite) return;
  let s = (o.seed ?? 11) >>> 0;
  const rnd = () => {
    s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
    return (s >>> 8) / 16777216;
  };
  const n = o.n ?? 40;
  const r = o.r ?? 0.2;
  let d = '';
  for (let i = 0; i < n; i++) {
    const x = b.x + rnd() * b.w;
    const y = b.y + rnd() * b.h;
    if (o.dash) {
      const a = rnd() > 0.5 ? 1 : -1;
      d += `M${x.toFixed(2)},${y.toFixed(2)}l${(r * 1.6).toFixed(2)},${(r * 1.4 * a).toFixed(2)}`;
    } else d += `M${(x - r).toFixed(2)},${y.toFixed(2)}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0Z`;
  }
  if (o.dash) ctx.stroke(d, color, r * 0.9, { o: o.op ?? 0.35, cp: clip });
  else ctx.push(d, color, { o: o.op ?? 0.35, cp: clip });
}

/** espinha de peixe (tweed): colunas de traços diagonais alternando o sentido; dois paths de traço (escuro + claro) */
export function herringbone(ctx: LayerCtx, hf: HeadFrame, clip: string, b: { x: number; y: number; w: number; h: number }, t: Tones, gap = 0.9, o = 0.2): void {
  if (hf.lite) return;
  let dk = '';
  let lt = '';
  const step = gap * 0.7;
  for (let i = 0; b.x + i * gap < b.x + b.w; i++) {
    const x = b.x + i * gap;
    const dir = i % 2 ? 1 : -1;
    for (let y = b.y; y < b.y + b.h; y += step) {
      const seg = `M${x.toFixed(2)},${y.toFixed(2)}l${(gap * 0.5).toFixed(2)},${(gap * 0.42 * dir).toFixed(2)}`;
      if (i % 2) dk += seg;
      else lt += seg;
    }
  }
  ctx.stroke(dk, t.deep, gap * 0.24, { o, cp: clip });
  ctx.stroke(lt, t.lighter, gap * 0.2, { o: o * 0.8, cp: clip });
}

/** ouro polido: paradas do gradiente (claro → médio → escuro quente) */
export const GOLD_STOPS: readonly AvatarStop[] = [
  [0, '#FFF6C8'],
  [0.28, '#FFD75A'],
  [0.62, '#D49A1E'],
  [1, '#8A5A0C'],
];
export const SILVER_STOPS: readonly AvatarStop[] = [
  [0, '#FFFFFF'],
  [0.3, '#E4E8F2'],
  [0.65, '#A9B0C2'],
  [1, '#626A80'],
];

export function metalGrad(b: { x: number; y: number; w: number; h: number }, stops: readonly AvatarStop[]): AvatarGradient {
  return { t: 'l', x1: b.x, y1: b.y, x2: b.x + b.w * 0.45, y2: b.y + b.h + 0.3, s: stops };
}

/** gema lapidada: corpo radial, faceta escura embaixo, brilho em cima à esquerda e ponto de luz */
export function gem(ctx: LayerCtx, hf: HeadFrame, cx: number, cy: number, r: number, color: string, o: { shape?: 'round' | 'drop' | 'oval'; glint?: boolean } = {}): void {
  const shape = o.shape ?? 'round';
  const d =
    shape === 'drop'
      ? smoothPath([[cx, cy - r * 1.45, 0], [cx + r * 0.85, cy + r * 0.05], [cx + r * 0.55, cy + r * 0.8], [cx, cy + r], [cx - r * 0.55, cy + r * 0.8], [cx - r * 0.85, cy + r * 0.05]], true)
      : shape === 'oval'
        ? blob(cx, cy, r * 0.75, r)
        : blob(cx, cy, r, r);
  const dk = mix(color, '#05030A', 0.55);
  ctx.push(d, color, { gf: { t: 'r', cx: cx - r * 0.25, cy: cy - r * 0.3, r: r * 1.4, s: [[0, mix(color, '#FFFFFF', 0.55)], [0.45, color], [1, dk]] } });
  if (!hf.lite || r > 0.9) {
    // faceta de baixo (escura) e de cima (clara): leitura de pedra lapidada
    ctx.push(smoothPath([[cx - r * 0.7, cy + r * 0.05, 0], [cx + r * 0.7, cy + r * 0.05, 0], [cx, cy + r * 0.95, 0]], true), dk, { o: 0.35, cp: d });
    ctx.push(smoothPath([[cx - r * 0.55, cy - r * 0.1, 0], [cx - r * 0.1, cy - r * 0.7, 0], [cx + r * 0.15, cy - r * 0.1, 0]], true), '#FFFFFF', { o: 0.55, cp: d });
  }
  if (o.glint !== false) ctx.push(blob(cx - r * 0.35, cy - r * 0.38, r * 0.22, r * 0.16), '#FFFFFF', { o: 0.95 });
}

/** pérola: esfera com brilho rosado e reflexo */
export function pearl(ctx: LayerCtx, hf: HeadFrame, cx: number, cy: number, r: number): void {
  ctx.push(blob(cx, cy, r, r), '#F2ECE4', { gf: { t: 'r', cx: cx - r * 0.3, cy: cy - r * 0.35, r: r * 1.5, s: [[0, '#FFFFFF'], [0.45, '#F3EEE8'], [0.8, '#D9CCD8'], [1, '#A89AA8']] } });
  if (!hf.lite) ctx.push(blob(cx + r * 0.25, cy + r * 0.35, r * 0.5, r * 0.3), '#FFD9E6', { o: 0.35 });
  ctx.push(blob(cx - r * 0.35, cy - r * 0.38, r * 0.26, r * 0.2), '#FFFFFF', { o: 0.95 });
}

/** brilho de neon: halo largo desfocado + tubo colorido + miolo quase branco (traços no mesmo path) */
export function neon(ctx: LayerCtx, hf: HeadFrame, d: string, color: string, w: number, o: { glow?: number } = {}): void {
  const g = o.glow ?? 1;
  ctx.stroke(d, color, w * 3.2, { o: 0.32 * g, ...(hf.lite ? { o: 0.22 * g } : { b: w * 1.4 }) });
  ctx.stroke(d, color, w, {});
  ctx.stroke(d, mix(color, '#FFFFFF', 0.75), w * 0.38, { o: 0.9 });
}

/** brilho em estrela de 4 pontas (gema, metal, glitter) */
export function sparkle(cx: number, cy: number, r: number): string {
  const k = r * 0.22;
  return smoothPath(
    [
      [cx, cy - r, 0],
      [cx + k, cy - k],
      [cx + r, cy, 0],
      [cx + k, cy + k],
      [cx, cy + r, 0],
      [cx - k, cy + k],
      [cx - r, cy, 0],
      [cx - k, cy - k],
    ],
    true,
    0.6,
  );
}

/** pontos de um path tracejado como forma afilada (costura em relevo, borda de aba) */
export function stitch(ctx: LayerCtx, hf: HeadFrame, pts: readonly SP[], color: string, o: { w?: number; o?: number; dash?: number[]; cp?: string } = {}): void {
  if (hf.lite) return;
  ctx.stroke(smoothPath(pts, false), color, o.w ?? 0.2, { o: o.o ?? 0.7, da: o.dash ?? [0.7, 0.5], c: 'butt', cp: o.cp });
}
