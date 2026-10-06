// Materiais e peças comuns dos veículos: pintura metálica (céu, linha do horizonte e especular), cromo, borracha,
// vidro, luz (farol com brilho em gradiente, sem desfoque: as listas desenham desfoque aproximado), tubos, rodas e
// sombras no chão. Dono: veículos.
//
// Luz do avatar: suave, de CIMA e da ESQUERDA. Na lataria a parte de cima reflete o céu (clara e fria), uma faixa escura
// marca o horizonte e embaixo volta o tom do chão; o especular é uma lâmina branca curta e macia no alto à esquerda.
// Nada de contorno preto: as bordas saem do contraste de valores e de um brilho de borda fino.

import { footBox, rigFromAnatomy, smoothPath, type SP } from '../anatomy';
import type { LayerCtx } from '../ctx';
import { fmt, shade } from '../geometry';
import { zero } from '../pose';
import { groupMatrix, mApply } from '../rig';
import { applyScene } from '../scene';
import { isLite, lum, mix, saturate } from '../shading';
import type { AvatarGradient, AvatarGroup, AvatarLayer, Pt } from '../types';

export { smoothPath, type SP };

// ---------------------------------------------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------------------------------------------

/** elipse (opcionalmente girada, em graus) como path de 4 arcos cúbicos */
export function ell(cx: number, cy: number, rx: number, ry: number, rotDeg = 0): string {
  const k = 0.5523;
  const a = (rotDeg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const P = (x: number, y: number): string => `${fmt(cx + x * c - y * s)},${fmt(cy + x * s + y * c)}`;
  return (
    `M${P(rx, 0)}` +
    `C${P(rx, ry * k)} ${P(rx * k, ry)} ${P(0, ry)}` +
    `C${P(-rx * k, ry)} ${P(-rx, ry * k)} ${P(-rx, 0)}` +
    `C${P(-rx, -ry * k)} ${P(-rx * k, -ry)} ${P(0, -ry)}` +
    `C${P(rx * k, -ry)} ${P(rx, -ry * k)} ${P(rx, 0)}Z`
  );
}

/** retângulo arredondado (arcos) */
export function rrect(x: number, y: number, w: number, h: number, r: number): string {
  const q = Math.max(0, Math.min(r, w / 2, h / 2));
  return (
    `M${fmt(x + q)},${fmt(y)}H${fmt(x + w - q)}A${fmt(q)},${fmt(q)} 0 0 1 ${fmt(x + w)},${fmt(y + q)}` +
    `V${fmt(y + h - q)}A${fmt(q)},${fmt(q)} 0 0 1 ${fmt(x + w - q)},${fmt(y + h)}` +
    `H${fmt(x + q)}A${fmt(q)},${fmt(q)} 0 0 1 ${fmt(x)},${fmt(y + h - q)}` +
    `V${fmt(y + q)}A${fmt(q)},${fmt(q)} 0 0 1 ${fmt(x + q)},${fmt(y)}Z`
  );
}

/** polilinha aberta */
export function line(pts: readonly Pt[]): string {
  return pts.map((p, i) => `${i ? 'L' : 'M'}${fmt(p[0])},${fmt(p[1])}`).join('');
}

/** curva suave aberta pelos pontos */
export function curve(pts: readonly SP[]): string {
  return smoothPath(pts, false);
}

/** forma fechada suave pelos pontos */
export function shape(pts: readonly SP[], s = 1): string {
  return smoothPath(pts, true, s);
}

/** espelha pontos em volta de x = cx (lado esquerdo → direito), invertendo a ordem pra manter o sentido */
export function mirrorX(pts: readonly SP[], cx: number): SP[] {
  return pts.map((p) => (p.length > 2 ? ([2 * cx - p[0], p[1], p[2] as number] as SP) : ([2 * cx - p[0], p[1]] as SP))).reverse();
}

/** forma simétrica a partir da metade esquerda (de cima pra baixo): espelha e fecha */
export function symShape(half: readonly SP[], cx: number, s = 1): string {
  return smoothPath([...half, ...mirrorX(half, cx)], true, s);
}

// ---------------------------------------------------------------------------------------------------------------
// Cor
// ---------------------------------------------------------------------------------------------------------------

/** tons de uma tinta (lataria, quadro, plástico pintado) */
export interface Paint {
  base: string;
  /** reflexo do céu (alto da peça) */
  sky: string;
  /** luz forte */
  hi: string;
  /** sombra própria */
  lo: string;
  /** sombra funda (vãos, embaixo) */
  deep: string;
  /** faixa escura do horizonte refletido */
  horizon: string;
  /** cor do especular (branco, um pouco frio na tinta escura) */
  spec: string;
  /** tinta escura (preto, marinho…): reflexos mais marcados */
  dark: boolean;
  /** tinta bem clara (branco, bege): sombras frias em vez de escuras */
  light: boolean;
}

const paintCache = new Map<string, Paint>();
/** c_gold do catálogo */
const GOLD_HEX = '#FFD700';

export function paintOf(hex: string): Paint {
  const hit = paintCache.get(hex);
  if (hit) return hit;
  if (hex.toUpperCase() === GOLD_HEX) {
    // dourado é metal, não amarelo: sombras âmbar quentes e horizonte bronze (senão fica igual ao c_yellow)
    const g: Paint = { base: hex, sky: '#FFF4C2', hi: '#FFF0A0', lo: '#B57E12', deep: '#5E3A06', horizon: '#8C5C0E', spec: '#FFFFFF', dark: false, light: false };
    paintCache.set(hex, g);
    return g;
  }
  const L = lum(hex);
  const dark = L < 0.05;
  const light = L > 0.55;
  const p: Paint = {
    base: hex,
    sky: dark ? mix(hex, '#B9C6E6', 0.3) : light ? mix(hex, '#FFFFFF', 0.55) : mix(saturate(hex, -0.1), '#EAF0FF', 0.38),
    hi: dark ? mix(hex, '#8A97B8', 0.32) : mix(hex, '#FFFFFF', light ? 0.6 : 0.3),
    lo: light ? mix(hex, '#6C7690', 0.32) : mix(saturate(hex, 0.08), '#0A0B16', dark ? 0.3 : 0.36),
    deep: light ? mix(hex, '#3A4058', 0.55) : mix(hex, '#05060C', dark ? 0.55 : 0.62),
    horizon: light ? mix(hex, '#4E566E', 0.42) : mix(hex, '#0E0A14', dark ? 0.5 : 0.48),
    spec: dark ? '#E6EEFF' : '#FFFFFF',
    dark,
    light,
  };
  if (paintCache.size > 48) paintCache.clear();
  paintCache.set(hex, p);
  return p;
}

/**
 * gradiente de lataria de cima pra baixo: céu claro → tom → faixa do horizonte (mais escura, estreita) → tom do chão.
 * `hz` = posição do horizonte (0..1 da altura).
 */
export function bodyGrad(y0: number, y1: number, p: Paint, hz = 0.46, x = 50): AvatarGradient {
  return {
    t: 'l',
    x1: x,
    y1: y0,
    x2: x + (y1 - y0) * 0.12,
    y2: y1,
    s: [
      [0, p.sky],
      [Math.max(0.02, hz - 0.22), mix(p.sky, p.base, 0.55)],
      [hz - 0.04, p.base],
      [hz, p.horizon],
      [hz + 0.09, p.base],
      [1, p.lo],
    ],
  };
}

/** gradiente lateral de volume (borda da esquerda iluminada, direita na sombra) */
export function sideGrad(x0: number, x1: number, p: Paint, y = 100): AvatarGradient {
  return {
    t: 'l',
    x1: x0,
    y1: y,
    x2: x1,
    y2: y,
    s: [
      [0, p.lo],
      [0.12, p.hi],
      [0.4, p.base],
      [0.86, p.lo],
      [1, p.deep],
    ],
  };
}

/** cromo: faixas espelhadas duras (céu, horizonte escuro, chão claro) */
export function chromeGrad(x0: number, y0: number, x1: number, y1: number): AvatarGradient {
  return {
    t: 'l',
    x1: x0,
    y1: y0,
    x2: x1,
    y2: y1,
    s: [
      [0, '#F4F7FF'],
      [0.32, '#C5CCDA'],
      [0.46, '#5E6474'],
      [0.56, '#3A3E4A'],
      [0.64, '#B9C0CE'],
      [0.86, '#EEF2FA'],
      [1, '#8E95A6'],
    ],
  };
}

/** alumínio escovado / metal pintado fosco (sem o espelhado do cromo) */
export function alloyGrad(x0: number, y0: number, x1: number, y1: number, base = '#A8AFBD'): AvatarGradient {
  return {
    t: 'l',
    x1: x0,
    y1: y0,
    x2: x1,
    y2: y1,
    s: [
      [0, shade(base, 0.35)],
      [0.4, base],
      [0.75, shade(base, -0.25)],
      [1, shade(base, -0.05)],
    ],
  };
}

/** borracha (pneu, manopla): grafite fosco com brilho largo e fraco em cima */
export function rubberGrad(x0: number, y0: number, x1: number, y1: number): AvatarGradient {
  return {
    t: 'l',
    x1: x0,
    y1: y0,
    x2: x1,
    y2: y1,
    s: [
      [0, '#4A4C58'],
      [0.25, '#2C2E37'],
      [0.7, '#16171D'],
      [1, '#0C0C11'],
    ],
  };
}

/** couro (banco, volante): tom com especular macio */
export function leatherGrad(x0: number, y0: number, x1: number, y1: number, base: string): AvatarGradient {
  return {
    t: 'l',
    x1: x0,
    y1: y0,
    x2: x1,
    y2: y1,
    s: [
      [0, shade(base, 0.22)],
      [0.35, base],
      [1, shade(base, -0.35)],
    ],
  };
}

/** brilho radial que some no transparente (farol, neon, raio): sem desfoque, igual nos três renderizadores */
export function glowGrad(cx: number, cy: number, r: number, color: string, o = 1): AvatarGradient {
  return {
    t: 'r',
    cx,
    cy,
    r,
    s: [
      [0, color, 0.85 * o],
      [0.35, color, 0.45 * o],
      [0.7, color, 0.12 * o],
      [1, color, 0],
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Camadas prontas
// ---------------------------------------------------------------------------------------------------------------

/** sombra no chão (grupo 'shadow': fica no chão quando o veículo balança) */
export function floorShadow(ctx: LayerCtx, cx: number, cy: number, rx: number, ry: number, o = 0.4, b = 1.6): void {
  ctx.push(ell(cx, cy, rx, ry), '#04030A', { o, b, g: 'shadow' });
}

/** sombra de contato embaixo de uma roda/pé de apoio (no grupo atual) */
export function contact(ctx: LayerCtx, cx: number, cy: number, rx: number, ry: number, o = 0.55): void {
  ctx.push(ell(cx, cy, rx, ry), '#020205', { o, b: isLite(ctx) ? undefined : 0.5 });
}

/**
 * tubo metálico/pintado (traço com volume): sombra larga, corpo e um fio de luz deslocado pra cima-esquerda.
 * `d` aberto. Em lite, só corpo + luz.
 */
export function tube(ctx: LayerCtx, d: string, w: number, base: string, o: { hi?: string; lo?: string; cp?: string; shine?: number } = {}): void {
  const lo = o.lo ?? shade(base, -0.45);
  const hi = o.hi ?? mix(base, '#FFFFFF', 0.55);
  ctx.stroke(d, lo, w, { cp: o.cp });
  ctx.stroke(d, base, w * 0.72, { cp: o.cp });
  if (w >= 0.5) ctx.stroke(d, hi, Math.max(0.22, w * 0.26), { o: o.shine ?? 0.75, cp: o.cp, ...(isLite(ctx) ? {} : {}) });
}

/** desloca um path aberto de pontos (pra fio de luz em tubo curvo) */
export function shiftPts(pts: readonly SP[], dx: number, dy: number): SP[] {
  return pts.map((p) => (p.length > 2 ? ([p[0] + dx, p[1] + dy, p[2] as number] as SP) : ([p[0] + dx, p[1] + dy] as SP)));
}

/**
 * pintura de lataria numa forma: gradiente de céu/horizonte, sombra própria embaixo à direita (recortada), lâmina de
 * especular no alto à esquerda e brilho de borda fino. `box` = caixa da forma.
 */
export function paintPanel(
  ctx: LayerCtx,
  d: string,
  box: { x: number; y: number; w: number; h: number },
  p: Paint,
  o: { hz?: number; spec?: string | null; core?: string | null; rim?: boolean; extra?: Partial<AvatarLayer> } = {},
): void {
  const lite = isLite(ctx);
  ctx.push(d, p.base, { gf: bodyGrad(box.y, box.y + box.h, p, o.hz ?? 0.46, box.x + box.w / 2), ...o.extra });
  if (o.core) ctx.push(o.core, p.deep, { o: 0.32, cp: d, b: lite ? undefined : 1.0 });
  if (o.spec) ctx.push(o.spec, p.spec, { o: p.dark ? 0.5 : 0.62, cp: d, b: lite ? undefined : 0.35 });
  if (o.rim !== false && !lite) ctx.stroke(d, p.hi, 0.5, { o: 0.35, cp: d, b: 0.2 });
}

/**
 * vidro: tinta fria translúcida, borda mais escura embaixo e reflexos diagonais (uma lâmina larga e uma fina) que
 * ficam nos cantos (`streaks` em fração da largura, 0..1).
 */
export function glassPane(ctx: LayerCtx, d: string, box: { x: number; y: number; w: number; h: number }, o: { tint?: string; o?: number; streaks?: readonly [number, number][]; dark?: number } = {}): void {
  const { x, y, w, h } = box;
  ctx.push(d, o.tint ?? '#9FC2E8', {
    gf: { t: 'l', x1: x, y1: y, x2: x, y2: y + h, s: [[0, o.tint ?? '#BFD8F2', 0.5], [0.6, o.tint ?? '#7FA6D0', 0.22], [1, '#1A2236', o.dark ?? 0.45]] },
    o: o.o ?? 0.55,
  });
  const st = o.streaks ?? [
    [0.06, 0.16],
    [0.21, 0.04],
  ];
  let ds = '';
  for (const [u, ww] of st) {
    const x0 = x + w * u;
    const k = h * 0.55;
    ds += `M${fmt(x0)},${fmt(y + h)}L${fmt(x0 + k)},${fmt(y)}L${fmt(x0 + k + w * ww)},${fmt(y)}L${fmt(x0 + w * ww)},${fmt(y + h)}Z`;
  }
  ctx.push(ds, '#FFFFFF', { o: 0.22, cp: d });
}

/** farol: carcaça escura, refletor cromado radial, lente clara e brilho em volta (gradiente) */
export function headlamp(ctx: LayerCtx, d: string, c: Pt, r: number, o: { color?: string; glow?: number; housing?: string } = {}): void {
  const color = o.color ?? '#FFF6DC';
  ctx.push(d, o.housing ?? '#1C1E26');
  ctx.push(d, '#DDE3EE', {
    gf: { t: 'r', cx: c[0] - r * 0.2, cy: c[1] - r * 0.25, r: r * 1.15, s: [[0, '#FFFFFF'], [0.35, color], [0.75, '#9AA3B6'], [1, '#3C4150']] },
    cp: d,
  });
  if (o.glow !== 0) ctx.push(ell(c[0], c[1], r * 2.6, r * 2.6), color, { gf: glowGrad(c[0], c[1], r * 2.6, color, o.glow ?? 0.55) });
}

/**
 * pneu visto de frente (a banda de rodagem): borracha com brilho no alto, sulcos (completo) e a sombra do para-lama.
 * x, y = canto de cima; w, h.
 */
export function tireFront(ctx: LayerCtx, x: number, y: number, w: number, h: number, o: { grooves?: number; wall?: string } = {}): void {
  const d = rrect(x, y, w, h, Math.min(w * 0.42, 3.2));
  ctx.push(d, '#17181E', { gf: rubberGrad(x, y, x + w, y + h) });
  // ombro do pneu (as laterais arredondadas pegam luz rebatida)
  ctx.push(rrect(x + w * 0.08, y + 0.6, w * 0.84, h - 1.2, Math.min(w * 0.35, 2.6)), '#3A3C47', { o: 0.35, cp: d });
  if (!isLite(ctx)) {
    const n = o.grooves ?? 7;
    let g = '';
    for (let i = 1; i < n; i++) {
      const yy = y + (h * i) / n;
      g += `M${fmt(x + w * 0.22)},${fmt(yy)}h${fmt(w * 0.56)}`;
    }
    ctx.stroke(g, '#08080C', 0.5, { o: 0.7, c: 'butt', cp: d });
    ctx.stroke(`M${fmt(x + w * 0.5)},${fmt(y + 1)}V${fmt(y + h - 1)}`, '#08080C', 0.45, { o: 0.6, c: 'butt', cp: d });
  }
  if (o.wall) ctx.push(rrect(x + w * 0.04, y + h * 0.18, w * 0.18, h * 0.64, 1), o.wall, { o: 0.85, cp: d });
}

/**
 * roda vista de lado/esterçada (elipse): pneu (anel), aro metálico, raios e cubo. `turn` 0..1 = quanto da lateral
 * aparece (0 = de frente, fininha; 1 = de lado, redonda). `spokes` = número de raios (0 = aro cheio/disco).
 */
export function sideWheel(
  ctx: LayerCtx,
  c: Pt,
  R: number,
  o: { turn: number; tire?: number; rim?: string; spokes?: number; hub?: string; disc?: boolean; rot?: number; tireColor?: string; rimW?: number },
): void {
  const lite = isLite(ctx);
  const rx = Math.max(0.8, R * o.turn);
  const ry = R;
  const tw = o.tire ?? R * 0.2;
  const rot = o.rot ?? 0;
  const outer = ell(c[0], c[1], rx, ry, rot);
  const inner = ell(c[0], c[1], Math.max(0.3, rx - tw * o.turn), ry - tw, rot);
  // espessura do pneu visível do lado da câmera (banda de rodagem aparece como uma meia-lua escura à direita)
  ctx.push(ell(c[0] + tw * 0.35, c[1], rx + tw * 0.3, ry, rot), '#0D0D12', { gf: rubberGrad(c[0] - rx, c[1] - ry, c[0] + rx, c[1] + ry) });
  ctx.push(outer + inner, o.tireColor ?? '#1B1C23', { r: 'evenodd', gf: rubberGrad(c[0] - rx, c[1] - ry, c[0] + rx * 0.4, c[1] + ry) });
  const rimC = o.rim ?? '#C9CFDB';
  const rimW = o.rimW ?? Math.max(0.45, tw * 0.32);
  // aro
  ctx.stroke(inner, rimC, rimW, { gs: chromeGrad(c[0] - rx, c[1] - ry, c[0] + rx, c[1] + ry) });
  if (o.disc) {
    ctx.push(inner, rimC, { gf: alloyGrad(c[0] - rx, c[1] - ry, c[0] + rx, c[1] + ry, rimC), o: 0.95 });
  } else if (o.spokes && !lite) {
    let sp = '';
    const n = o.spokes;
    const a0 = (rot * Math.PI) / 180;
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2 + 0.3;
      const ex = Math.cos(t) * (rx - tw * o.turn);
      const ey = Math.sin(t) * (ry - tw);
      const px = c[0] + ex * Math.cos(a0) - ey * Math.sin(a0);
      const py = c[1] + ex * Math.sin(a0) + ey * Math.cos(a0);
      sp += `M${fmt(c[0])},${fmt(c[1])}L${fmt(px)},${fmt(py)}`;
    }
    ctx.stroke(sp, '#D7DCE6', Math.max(0.16, R * 0.012), { o: 0.8, c: 'butt' });
  }
  // cubo
  const hr = Math.max(0.6, R * 0.09);
  ctx.push(ell(c[0], c[1], Math.max(0.4, hr * Math.max(0.55, o.turn)), hr, rot), o.hub ?? '#AEB5C4', { gf: chromeGrad(c[0] - hr, c[1] - hr, c[0] + hr, c[1] + hr) });
  // brilho do pneu (luz da esquerda, em cima)
  if (!lite) ctx.stroke(curveArc(c, rx - tw * 0.3 * o.turn, ry - tw * 0.3, 200, 285, rot), '#6A6E7E', Math.max(0.3, tw * 0.3), { o: 0.5 });
}

/** arco de elipse aberto de a0 a a1 (graus, 0 = direita, 90 = baixo) */
export function curveArc(c: Pt, rx: number, ry: number, a0: number, a1: number, rotDeg = 0): string {
  const n = Math.max(3, Math.ceil(Math.abs(a1 - a0) / 18));
  const r = (rotDeg * Math.PI) / 180;
  const pts: SP[] = [];
  for (let i = 0; i <= n; i++) {
    const t = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    const x = Math.cos(t) * rx;
    const y = Math.sin(t) * ry;
    pts.push([c[0] + x * Math.cos(r) - y * Math.sin(r), c[1] + x * Math.sin(r) + y * Math.cos(r)]);
  }
  return smoothPath(pts, false);
}

/** brilho de neon (traço + halo em gradiente linear fino): usado no esportivo, hoverboard e disco */
export function neonLine(ctx: LayerCtx, d: string, color: string, w: number, o: { halo?: number; cp?: string } = {}): void {
  const lite = isLite(ctx);
  if (!lite) ctx.stroke(d, color, w * 3.2, { o: (o.halo ?? 0.22) * 0.8, b: 1.2, cp: o.cp });
  ctx.stroke(d, color, w, { cp: o.cp });
  ctx.stroke(d, mix(color, '#FFFFFF', 0.7), Math.max(0.2, w * 0.4), { o: 0.9, cp: o.cp });
}

// ---------------------------------------------------------------------------------------------------------------
// Onde o piloto fica (pra pedal, apoio, banco caírem embaixo do corpo de verdade)
// ---------------------------------------------------------------------------------------------------------------

/**
 * ponto `p` do grupo `g` do piloto, já posado pela cena (pernas montadas, subida, sentado), no espaço do veículo.
 * Usa a mesma matemática do rig (rig.ts) e a pose-base parada (t = 0: o veículo sem balanço).
 */
export function riderPoint(ctx: LayerCtx, g: AvatarGroup, p: Pt): Pt {
  const rig = rigFromAnatomy(ctx.an, ctx.scene);
  const pose = applyScene(zero(), ctx.scene, 0);
  return mApply(groupMatrix(g, rig, pose), p[0], p[1]);
}

/** centro da sola de cada pé (L, R) no espaço do veículo */
export function riderSoles(ctx: LayerCtx): [Pt, Pt] {
  const { an } = ctx;
  const L = footBox(an, 'L');
  const R = footBox(an, 'R');
  return [riderPoint(ctx, 'shinL', [L.cx, an.foot.soleY]), riderPoint(ctx, 'shinR', [R.cx, an.foot.soleY])];
}
