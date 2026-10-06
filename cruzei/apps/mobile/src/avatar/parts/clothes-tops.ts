// As 31 partes de cima (inclusive vestido, vestido de gala e camiseta do orgulho) e o capuz. Dono: guarda-roupa (parte
// de cima). Fluxo de toda peça: pele por baixo (se o decote/cava mostra) → corpo da peça com o gradiente do material →
// estampa → volume e dobras (shadeTorso) → barra → gola pelo tipo → detalhes da peça (botões, bolso, zíper, bordado).

import type { AvatarConfig } from '@cruzei/shared-types';

import { headAnchors, smoothPath, taperPath, torsoPath, torsoXAt, type Anatomy, type Side, type SP } from '../anatomy';
import type { LayerCtx } from '../ctx';
import { LIME, fmt, luminance, shade } from '../geometry';
import { blob, creases, isLite, lodCtx, lum, metal, mix, plaid, speckle, starPath, stripes } from '../shading';
import type { AvatarGradient, Pt } from '../types';

import {
  FIT,
  NONE,
  SIDES,
  TOPS,
  boxOf,
  buttons,
  chestPocket,
  contrastOf,
  easeOf,
  edgeShadow,
  shoulderChain,
  hemFinish,
  hemLine,
  lerp2,
  neckCutOf,
  neckRib,
  og,
  placket,
  rng,
  sampleOn,
  shadeTorso,
  skinUnder,
  teeFit,
  threadOf,
  toneOf,
  topCut,
  topDef,
  torsoGrad,
  type Cut,
  type SleeveSpec,
  type Tone,
} from './clothes-kit';
import { drawFlagOn, boxSurface, flagOf } from './flags';

/** y do alto do colarinho em pé (camisa/polo/smoking): a gola sobe ~1,5 pelo pescoço */
export function collarStandY(an: Anatomy): number {
  return an.collarY - 2.6 - 1.5;
}

/** peças cujo decote/cava mostra pele (o tronco de pele vai por baixo) */
function needsSkin(cfg: AvatarConfig): boolean {
  const d = topDef(cfg);
  return !!d.skin || d.sl === 'none' || d.hem === 'crop' || (d.depth ?? 0) > 0.6;
}

// ===============================================================================================================
// Estampas
// ===============================================================================================================

/** listras perpendiculares a um eixo a→b (manga): faixas que "abraçam" o braço e giram junto */
function axisStripes(ctx: LayerCtx, clip: string, a: Pt, b: Pt, w: number, color: string, gap: number, sw: number, o = 1, from = -4): void {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const u: Pt = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  const n: Pt = [-u[1], u[0]];
  const W = w + 3;
  let d = '';
  for (let s = from; s < L + 4; s += gap) {
    const p0: Pt = [a[0] + u[0] * s, a[1] + u[1] * s];
    const p1: Pt = [p0[0] + u[0] * sw, p0[1] + u[1] * sw];
    d += `M${fmt(p0[0] + n[0] * W)},${fmt(p0[1] + n[1] * W)}L${fmt(p0[0] - n[0] * W)},${fmt(p0[1] - n[1] * W)}L${fmt(p1[0] - n[0] * W)},${fmt(p1[1] - n[1] * W)}L${fmt(p1[0] + n[0] * W)},${fmt(p1[1] + n[1] * W)}Z`;
  }
  ctx.push(d, color, { cp: clip, o });
}

/** cor das listras da marinière (contraste com a base) */
function stripeColor(c: string): string {
  return lum(c) > 0.5 ? '#1F2A4A' : '#F3EFE6';
}

/** flor de hibisco (5 pétalas arredondadas) como path */
function hibiscus(cx: number, cy: number, r: number, rot: number): string {
  let d = '';
  for (let i = 0; i < 5; i++) {
    const a = rot + (i * Math.PI * 2) / 5;
    d += blob(cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55, r * 0.55, r * 0.36, a);
  }
  return d;
}

/** estampa floral (camisa florida): hibiscos + folhas espalhados por semente fixa dentro de uma caixa */
export function floral(ctx: LayerCtx, clip: string, box: { x: number; y: number; w: number; h: number }, base: string, seed: number, n: number): void {
  const lite = isLite(ctx);
  const r = rng(seed);
  const petal = lum(base) > 0.55 ? '#E2445C' : '#FFF4E4';
  const leaf = mix(base, lum(base) > 0.55 ? '#1E7A4E' : '#3FB27F', 0.7);
  let flowers = '';
  let centers = '';
  let leaves = '';
  const cnt = lite ? Math.ceil(n * 0.6) : n;
  for (let i = 0; i < cnt; i++) {
    const x = box.x + r() * box.w;
    const y = box.y + r() * box.h;
    const rr = (lite ? 1.9 : 1.5) + r() * 0.8;
    const rot = r() * Math.PI;
    leaves += blob(x + rr * 1.1, y + rr * 0.7, rr * 0.95, rr * 0.38, rot + 0.6) + blob(x - rr * 0.9, y + rr * 0.9, rr * 0.8, rr * 0.32, rot - 0.9);
    flowers += hibiscus(x, y, rr, rot);
    centers += blob(x, y, rr * 0.2, rr * 0.2);
  }
  ctx.push(leaves, leaf, { cp: clip, o: 0.92 });
  ctx.push(flowers, petal, { cp: clip, o: 0.95 });
  if (!lite) ctx.push(centers, '#FFC94A', { cp: clip, o: 0.9 });
}

/** estampa da camiseta: sol retrô com faixas (dourado → magenta) e uma onda embaixo — sem marca */
function graphicPrint(ctx: LayerCtx, cut: Cut): void {
  const { an } = ctx;
  const lite = isLite(ctx);
  const cx = an.cx - 0.3;
  const cy = an.armpitY + 5.2;
  const R = an.w.chest * 0.42;
  const sun = blob(cx, cy, R, R);
  const grad: AvatarGradient = { t: 'l', x1: cx, y1: cy - R, x2: cx, y2: cy + R, s: [[0, '#FFD45A'], [0.55, '#FF7A59'], [1, '#E0337A']] };
  // faixas horizontais cortando a parte de baixo do sol (cor da camiseta por cima)
  ctx.push(sun, '#FF8A50', { gf: grad, cp: cut.d, o: 0.95 });
  let cuts = '';
  for (let i = 0; i < 4; i++) {
    const y = cy + R * (0.12 + i * 0.22);
    cuts += `M${fmt(cx - R - 1)},${fmt(y)}h${fmt(2 * R + 2)}v${fmt(0.32 + i * 0.16)}h${fmt(-2 * R - 2)}Z`;
  }
  ctx.push(cuts, cut.color, { cp: sun });
  // onda (linha grossa em S) atravessando embaixo
  const wy = cy + R + 1.2;
  ctx.stroke(smoothPath([[cx - R * 1.15, wy], [cx - R * 0.55, wy - 0.9], [cx, wy], [cx + R * 0.55, wy + 0.9], [cx + R * 1.15, wy]], false), '#3FC6D8', lite ? 0.9 : 0.7, { cp: cut.d });
  // textura de impressão gasta (falhas finas) só no completo
  if (!lite) speckle(ctx, { x: cx - R, y: cy - R, w: 2 * R, h: 2 * R + 2 }, cut.color, { n: 26, r: [0.08, 0.16], seed: 5, o: 0.55, cp: sun });
}

// ===============================================================================================================
// Golas
// ===============================================================================================================

/** colarinho de camisa/polo: pé da gola em volta do pescoço e as duas abas pousadas no peito */
export function shirtCollar(ctx: LayerCtx, cut: Cut, o: { soft?: boolean; open?: boolean; color?: string } = {}): void {
  const { an } = ctx;
  const { cx } = an;
  const lite = isLite(ctx);
  const c = o.color ?? cut.color;
  const t = o.color ? toneOf(c, 'cotton') : cut.tone;
  const nw = an.w.neck;
  const top = collarStandY(an) - 0.8;
  const cw = an.collarW;
  const yS = an.collarY - 2.6;
  // pé da gola (faixa atrás e dos lados do pescoço; o pescoço cobre o meio de cima)
  const stand = smoothPath([[cx - nw - 1.4, top + 0.6], [cx - nw * 0.4, top], [cx + nw * 0.4, top], [cx + nw + 1.4, top + 0.6], [cx + cw + 0.4, yS + 0.6], [cx + 1.0, an.collarY - 0.4], [cx - 1.0, an.collarY - 0.4], [cx - cw - 0.4, yS + 0.6]]);
  ctx.push(stand, t.shade, { gf: { t: 'l', x1: cx - cw, y1: 0, x2: cx + cw, y2: 0, s: [[0, t.base], [0.5, t.shade], [1, t.deep]] } });
  // abas: do lado do pescoço até a ponta no peito (a da esquerda pega luz); a ponta vira levemente pra fora
  const drop = o.soft ? 3.4 : 4.0;
  const wing = (g: number): string => {
    const s0: Pt = [cx + g * (nw + 1.2), top + 0.9];
    const s1: Pt = [cx + g * (cw + 0.9), yS + 0.9];
    const tip: Pt = [cx + g * (o.open ? 4.2 : 3.0), an.collarY + drop];
    const inner: Pt = [cx + g * (o.open ? 1.6 : 0.5), an.collarY + (o.open ? 0.6 : -0.2)];
    return smoothPath([[s0[0], s0[1], 0.5], [s1[0], s1[1]], [tip[0], tip[1], 0], [inner[0], inner[1], 0], [cx + g * (nw * 0.6), top + 1.5]]);
  };
  const wl = wing(-1);
  const wr = wing(1);
  // sombra das abas no peito (recortada na peça)
  ctx.push(wl + wr, '#0A0610', { o: 0.26, ...(lite ? {} : { b: 0.45 }), cp: cut.d });
  ctx.push(wl, c, { gf: { t: 'l', x1: cx - cw - 1, y1: top, x2: cx, y2: an.collarY + drop, s: [[0, t.light], [0.6, t.base], [1, t.shade]] } });
  ctx.push(wr, c, { gf: { t: 'l', x1: cx + cw + 1, y1: top, x2: cx, y2: an.collarY + drop, s: [[0, t.base], [0.6, t.shade], [1, t.deep]] } });
  if (!lite) {
    // pesponto na borda das abas e o vinco de dobra
    ctx.stroke(wl + wr, threadOf(c), 0.12, { o: 0.35, da: [0.45, 0.3] });
    ctx.stroke(smoothPath([[cx - nw - 1.1, top + 1.2], [cx - cw - 0.6, yS + 1.1]], false) + smoothPath([[cx + nw + 1.1, top + 1.2], [cx + cw + 0.6, yS + 1.1]], false), t.deep, 0.22, { o: 0.4 });
  }
}

/** gola alta (rolê): tubo dobrado em volta do pescoço até perto do queixo, com dobras horizontais macias */
function turtleCollar(ctx: LayerCtx, cut: Cut): void {
  const { an } = ctx;
  const { cx } = an;
  const lite = isLite(ctx);
  const t = cut.tone;
  const top = headAnchors(an).chin[1] + 1.6;
  const nw = an.w.neck + 0.9;
  const bot = an.collarY - 0.6;
  const cw = an.collarW + 0.6;
  const tube = smoothPath([[cx - nw, top + 0.2], [cx, top - 0.35], [cx + nw, top + 0.2], [cx + nw + 0.5, top + (bot - top) * 0.55], [cx + cw, bot - 0.8], [cx, bot + 0.6], [cx - cw, bot - 0.8], [cx - nw - 0.5, top + (bot - top) * 0.55]]);
  ctx.push(tube, t.base, { gf: { t: 'l', x1: cx - nw - 1, y1: 0, x2: cx + nw + 1, y2: 0, s: [[0, t.light], [0.35, t.base], [0.8, t.shade], [1, t.deep]] } });
  // a dobra do rolê: faixa de sombra no meio e luz na borda de cima
  const mid = top + (bot - top) * 0.48;
  ctx.push(taperPath([[cx - nw - 0.3, mid - 0.2], [cx, mid + 0.5], [cx + nw + 0.3, mid - 0.2]], [0.5, 1.0, 0.5]), t.deep, { o: 0.4, ...(lite ? {} : { b: 0.3 }), cp: tube });
  ctx.push(taperPath([[cx - nw + 0.4, top + 0.5], [cx, top + 0.15], [cx + nw - 0.4, top + 0.5]], [0.3, 0.6, 0.3]), t.light, { o: 0.45, cp: tube });
  if (!lite) {
    let rib = '';
    for (let x = cx - nw + 0.5; x < cx + nw; x += 0.85) rib += `M${fmt(x)},${fmt(top + 0.2)}V${fmt(bot)}`;
    ctx.stroke(rib, t.deep, 0.12, { o: 0.22, cp: tube });
  }
  // sombra do queixo na gola
  ctx.push(blob(cx + 0.3, top + 0.4, an.w.neck * 0.9, 0.9), '#140A10', { o: 0.3, ...(lite ? {} : { b: 0.5 }), cp: tube });
}

/** gola careca alta (jaqueta de zíper, armadura, traje real): faixa em pé em volta do pescoço */
export function mockCollar(ctx: LayerCtx, cut: Cut, h: number, o: { color?: string; tone?: Tone; zip?: boolean; trim?: string } = {}): string {
  const { an } = ctx;
  const { cx } = an;
  const t = o.tone ?? cut.tone;
  const c = o.color ?? cut.color;
  const base = an.collarY - 2.6;
  const top = base - h;
  const nw = an.w.neck + 0.7;
  const cw = an.collarW + 0.3;
  const band = smoothPath([[cx - nw, top + 0.3], [cx, top - 0.2], [cx + nw, top + 0.3], [cx + cw, base + 0.6], [cx, an.collarY + 0.4], [cx - cw, base + 0.6]]);
  ctx.push(band, c, { gf: { t: 'l', x1: cx - cw, y1: 0, x2: cx + cw, y2: 0, s: [[0, t.light], [0.4, t.base], [0.85, t.shade], [1, t.deep]] } });
  ctx.push(taperPath([[cx - cw + 0.4, base + 0.4], [cx, an.collarY + 0.2], [cx + cw - 0.4, base + 0.4]], [0.4, 0.9, 0.4]), t.deep, { o: 0.35, cp: band });
  if (o.trim) ctx.stroke(smoothPath([[cx - nw + 0.1, top + 0.45], [cx, top - 0.05], [cx + nw - 0.1, top + 0.45]], false), o.trim, 0.45, { o: 0.95 });
  if (o.zip) ctx.stroke(`M${fmt(cx + 0.1)},${fmt(top + 0.2)}V${fmt(an.collarY + 0.4)}`, t.deep, 0.35, { o: 0.6 });
  return band;
}

/** lapelas entalhadas (jaqueta, smoking): duas faixas dobradas do pescoço até o ponto do botão */
export function lapels(ctx: LayerCtx, cut: Cut, yBreak: number, o: { peak?: boolean; color?: string; tone?: Tone; sheen?: boolean } = {}): void {
  const { an } = ctx;
  const { cx } = an;
  const lite = isLite(ctx);
  const t = o.tone ?? cut.tone;
  const c = o.color ?? cut.color;
  const cw = an.collarW;
  const yS = an.collarY - 2.6;
  for (const s of SIDES) {
    const g = og(s);
    const notchY = an.collarY + 3.6;
    const outerX = cx + g * (cw + 3.4 + (o.peak ? 0.8 : 0));
    const pts: SP[] = [
      [cx + g * (cw - 0.2), yS + 0.2, 0.4],
      [cx + g * (cw + 1.3), notchY - 1.6],
      [outerX, notchY + (o.peak ? -1.2 : 0.3), 0],
      [cx + g * (cw + 2.2), notchY + 1.1, 0],
      [cx + g * (cw * 0.55 + 2.2), (notchY + yBreak) / 2 + 1.5],
      [cx + g * 0.6, yBreak, 0],
      [cx + g * 0.9, yBreak - 1.2, 0],
      [cx + g * (cw * 0.4), an.collarY + 1.5],
    ];
    const d = smoothPath(pts);
    const lit = s === 'L';
    ctx.push(d, '#0A0610', { o: 0.3, ...(lite ? {} : { b: 0.5 }), cp: cut.d });
    ctx.push(d, c, { gf: { t: 'l', x1: cx + g * cw, y1: yS, x2: cx, y2: yBreak, s: lit ? [[0, t.light], [0.6, t.base], [1, t.shade]] : [[0, t.base], [0.55, t.shade], [1, t.deep]] } });
    if (o.sheen) ctx.push(taperPath([[cx + g * (cw + 0.6), yS + 2.5], [cx + g * (cw * 0.7 + 1.4), (notchY + yBreak) / 2 + 1], [cx + g * 1.6, yBreak - 2]], [0, 0.9, 0]), '#FFFFFF', { o: lit ? 0.35 : 0.16, ...(lite ? {} : { b: 0.3 }), cp: d });
    // a borda dobrada (roll line) do lado de dentro
    if (!lite) ctx.stroke(smoothPath([[cx + g * (cw - 0.1), yS + 0.6], [cx + g * (cw * 0.5 + 0.4), an.collarY + 4], [cx + g * 0.8, yBreak - 1]], false), t.deep, 0.22, { o: 0.4 });
  }
}

// ===============================================================================================================
// Saias (vestido, vestido de gala, túnica de mago) e drapeado no colo (sentado)
// ===============================================================================================================

/** saia em A do vestido: da cintura até `hemY`, abrindo `flare` de cada lado, barra macia ondulada */
function skirt(ctx: LayerCtx, top: number, hemY: number, flare: number, c: string, t: Tone, mat: 'chiffon' | 'satin' | 'wool', o: { open?: boolean } = {}): string {
  const { an } = ctx;
  const { cx } = an;
  const lite = isLite(ctx);
  const tl = an.tilt.hip * 0.5;
  const xw = (s: Side, y: number, e: number) => torsoXAt(an, s, y, e);
  const hipY = an.hipY;
  const r = rng(hemY * 10);
  const waves = 5;
  const wl = cx - (an.w.hip + flare);
  const wr = cx + an.w.hip + flare;
  const hem: SP[] = [];
  for (let i = 0; i <= waves * 2; i++) {
    const u = i / (waves * 2);
    hem.push([wr + (wl - wr) * u, hemY + (i % 2 ? 0.55 : -0.25) + Math.sin(u * Math.PI) * 0.8 + (r() - 0.5) * 0.3]);
  }
  const pts: SP[] = [
    [xw('L', top, 0.3), top - tl, 0.5],
    [xw('R', top, 0.3), top + tl, 0.5],
    [xw('R', hipY, 1.2) + flare * 0.15, hipY + tl],
    [wr, hemY - 1.0],
    ...hem,
    [wl, hemY - 1.0],
    [xw('L', hipY, 1.2) - flare * 0.15, hipY - tl],
  ];
  const d = smoothPath(pts);
  const sw = an.w.hip + flare;
  ctx.withGroup('body', () => {
    if (mat === 'satin') {
      ctx.push(d, c, { gf: { t: 'l', x1: cx - sw, y1: 0, x2: cx + sw, y2: 0, s: [[0, t.shade], [0.14, mix(t.base, t.light, 0.7)], [0.27, t.base], [0.42, t.shade], [0.56, mix(t.base, t.light, 0.35)], [0.72, t.shade], [0.88, t.deep], [1, t.bounce]] } });
    } else {
      ctx.push(d, c, { gf: { t: 'l', x1: cx - sw, y1: 0, x2: cx + sw, y2: 0, s: [[0, t.base], [0.18, t.light], [0.45, t.base], [0.82, t.shade], [1, t.bounce]] } });
    }
    // sombra embaixo da cintura e do quadril (o tecido cai do quadril)
    ctx.push(taperPath([[xw('L', top, 0.3), top + 1], [cx, top + 1.6], [xw('R', top, 0.3), top + 1]], [0.8, 1.4, 0.8]), t.deep, { o: 0.3, ...(lite ? {} : { b: 0.6 }), cp: d });
    // dobras verticais que abrem do quadril até a barra (os vales caem nas ondas da barra)
    const folds: { spine: SP[]; w: number }[] = [];
    const lights: string[] = [];
    for (let i = 1; i < waves * 2; i += 2) {
      const h = hem[i];
      const u = i / (waves * 2);
      const x0 = cx + (an.w.hip * 0.8) * (1 - 2 * u);
      folds.push({ spine: [[x0, hipY + 1.5], [(x0 + h[0]) / 2, (hipY + hemY) / 2], [h[0], hemY - 0.2]], w: 1.0 + (mat === 'chiffon' ? 0.2 : 0) });
      const hl = hem[i - 1];
      lights.push(taperPath([[x0 - 1.5, hipY + 2.5], [(x0 - 1.5 + hl[0]) / 2, (hipY + hemY) / 2], [hl[0], hemY - 0.6]], [0, 1.2, 0.6]));
    }
    if (!lite) creases(ctx, folds, c, { o: mat === 'satin' ? 0.32 : 0.28, cp: d, light: false });
    else ctx.push(folds.map((f) => taperPath(f.spine, [0, f.w, f.w * 0.6])).join(''), t.deep, { o: 0.22, cp: d });
    ctx.push(lights.join(''), t.light, { o: mat === 'satin' ? 0.3 : 0.2, ...(lite ? {} : { b: 0.5 }), cp: d });
    // avesso aparecendo na barra (borda escura fina) e sombra da barra nas pernas
    ctx.stroke(smoothPath(hem, false), t.deep, 0.35, { o: 0.45, cp: d });
    if (o.open) ctx.stroke(`M${fmt(cx + 0.2)},${fmt(top + 1)}L${fmt(cx + 0.6)},${fmt(hemY + 0.4)}`, t.deep, 0.4, { o: 0.5, cp: d });
  });
  return d;
}

/** sentado: a peça longa pousa no colo (trapézio do quadril aos joelhos) e, se longa, cai na frente das canelas */
function lapDrape(ctx: LayerCtx, c: string, t: Tone, toAnkle: boolean): void {
  const { an } = ctx;
  const { cx } = an;
  const lite = isLite(ctx);
  // as juntas da perna sentada já incluem a queda do assento; o grupo 'body' desce por ela na pose (applyScene), então
  // aqui tudo volta pro espaço do tronco em pé
  const up = (p: Pt): Pt => [p[0], p[1] - an.seatDrop];
  const j = { hipL: up(an.joints.hipL), hipR: up(an.joints.hipR), kneeL: up(an.joints.kneeL), kneeR: up(an.joints.kneeR), ankleL: up(an.joints.ankleL), ankleR: up(an.joints.ankleR) };
  const kL = j.kneeL;
  const kR = j.kneeR;
  const hy = Math.min((j.hipL[1] + j.hipR[1]) / 2, an.hj + 0.4);
  const th = an.spec.thigh;
  const bottom = toAnkle ? Math.min(j.ankleL[1], j.ankleR[1]) + 1.2 : Math.max(kL[1], kR[1]) + an.spec.knee * 0.9;
  // começa na cintura (cobre o quadril sentado), abre até o colo e pousa nos joelhos
  const wy = an.waistY + 0.4;
  const pts: SP[] = [
    [torsoXAt(an, 'L', wy, 0.4), wy, 0.6],
    [torsoXAt(an, 'R', wy, 0.4), wy, 0.6],
    [Math.max(j.hipR[0] + th * 1.15, torsoXAt(an, 'R', hy, 0.6)), hy - 0.5],
    [kR[0] + an.spec.knee * 1.5, kR[1] + 0.4],
    [kR[0] + an.spec.knee * (toAnkle ? 1.8 : 1.1), bottom],
    [cx + 0.8, bottom + 0.6],
    [kL[0] - an.spec.knee * (toAnkle ? 1.8 : 1.1), bottom],
    [kL[0] - an.spec.knee * 1.5, kL[1] + 0.4],
    [Math.min(j.hipL[0] - th * 1.15, torsoXAt(an, 'L', hy, 0.6)), hy - 0.5],
  ];
  const d = smoothPath(pts);
  ctx.withGroup('body', () => {
    ctx.push(d, c, { gf: { t: 'l', x1: cx, y1: hy, x2: cx, y2: bottom, s: [[0, t.light], [0.35, t.base], [toAnkle ? 0.55 : 0.8, t.shade], [1, t.deep]] } });
    // o vão entre os joelhos afunda; a frente dos joelhos pega luz
    ctx.push(taperPath([[cx, hy + 1], [cx + 0.3, (hy + kL[1]) / 2 + 2], [cx + 0.5, bottom - 0.5]], [0, 1.4, 0.8]), t.deep, { o: 0.35, ...(lite ? {} : { b: 0.6 }), cp: d });
    ctx.push(blob(kL[0] - 0.4, kL[1] - 0.6, an.spec.knee * 0.8, 1.4) + blob(kR[0] - 0.2, kR[1] - 0.6, an.spec.knee * 0.8, 1.4), t.light, { o: 0.35, ...(lite ? {} : { b: 0.6 }), cp: d });
  });
}

// ===============================================================================================================
// Mangas da parte de cima
// ===============================================================================================================

/** especificação das mangas da parte de cima (comprimento, folga, punho, estampa) */
export function topSleeveSpec(ctx: LayerCtx): SleeveSpec | null {
  const { cfg, an } = ctx;
  const d = topDef(cfg);
  if (d.sl === 'none') return null;
  const color = ctx.col.top;
  const tone = toneOf(color, d.mat);
  const broad = an.bodyId === 'broad' ? 0.62 : 1;
  const tee = d.ease === 'tee';
  const F = FIT[teeFit(cfg)];
  const ease = (tee ? F.sEase : (d.sEase ?? 0.5)) * broad;
  const sp: SleeveSpec = {
    len: d.sl,
    ease,
    flare: d.flare ?? 0.1,
    cuff: d.cuff ?? 'hem',
    color,
    tone,
    mat: d.mat,
    to: tee ? F.sleeve : d.sl === 'short' ? (cfg.top === 'polo' ? 0.5 : cfg.top === 'crop' ? 0.42 : 0.5) : 1,
    sheen: d.mat === 'satin' || d.mat === 'holo' ? 1 : d.mat === 'nylon' ? 0.6 : 0,
  };
  const top = cfg.top;
  if (top === 'striped') {
    const sc = stripeColor(color);
    sp.pattern = (c, clip, a, b, w) => axisStripes(c, clip, a, b, w, sc, isLite(c) ? 2.8 : 2.1, isLite(c) ? 1.2 : 0.9);
  } else if (top === 'flannel') {
    sp.pattern = (c, clip, a, b) => {
      const bb = boxOf([a, b]);
      plaid(c, clip, { x: bb.x - 8, y: bb.y - 6, w: bb.w + 16, h: bb.h + 12 }, color, { cell: 3.6, accent: mix(color, '#FFF2C8', 0.7) });
    };
  } else if (top === 'hawaiian') {
    sp.pattern = (c, clip, a, b) => {
      const bb = boxOf([a, b]);
      floral(c, clip, { x: bb.x - 3, y: bb.y - 2, w: bb.w + 6, h: bb.h + 3 }, color, 77 + Math.round(a[0]), 3);
    };
  } else if (top === 'jersey') {
    sp.cuffColor = contrastOf(color, '#F4F4F8', '#1C1C28');
  } else if (top === 'wizard' || top === 'royal') {
    sp.cuffColor = '#E2B33C';
  } else if (top === 'neon_jacket') {
    sp.cuffColor = mix(color, '#101018', 0.6);
  } else if (top === 'holo') {
    sp.pattern = (c, clip, a, b, w) => holoSheen(c, clip, a, b, w);
  } else if (top === 'armor') {
    sp.pattern = (c, clip, a, b, w) => armorBands(c, clip, a, b, w);
  }
  return sp;
}

/** linha do ombro da parte de cima (a manga começa nela); ombro caído no oversized */
export function topSleeveChain(ctx: LayerCtx, s: Side): SP[] {
  const d = topDef(ctx.cfg);
  return shoulderChain(ctx.an, topCut(ctx).pts, s, easeOf(ctx, d), ctx.cfg.top === 'oversized' ? 1.8 : 0);
}

/** faixa iridescente (holográfico): ciano → violeta → magenta → lima, discreta, recortada */
function holoSheen(ctx: LayerCtx, clip: string, a: Pt, b: Pt, w: number): void {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const nx = -(b[1] - a[1]) / L;
  const ny = (b[0] - a[0]) / L;
  const m = lerp2(a, b, 0.5);
  ctx.push(taperPath([a, m, b], [w * 0.9, w * 1.1, w * 0.9]), '#9B7BFF', {
    gf: { t: 'l', x1: m[0] - nx * w, y1: m[1] - ny * w - 6, x2: m[0] + nx * w, y2: m[1] + ny * w + 6, s: [[0, '#5EF2FF'], [0.35, '#B08BFF'], [0.65, '#FF6AD5'], [1, '#C8FF7A']] },
    o: 0.38,
    cp: clip,
  });
}

/** placas da armadura no braço (braçal segmentado com reflexo em faixa) */
function armorBands(ctx: LayerCtx, clip: string, a: Pt, b: Pt, w: number): void {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const u: Pt = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  const n: Pt = [-u[1], u[0]];
  let seams = '';
  let lights = '';
  for (let s = L * 0.3; s < L; s += L * 0.28) {
    const p: Pt = [a[0] + u[0] * s, a[1] + u[1] * s];
    seams += `M${fmt(p[0] + n[0] * (w + 2))},${fmt(p[1] + n[1] * (w + 2))}Q${fmt(p[0] + u[0] * 0.9)},${fmt(p[1] + u[1] * 0.9)} ${fmt(p[0] - n[0] * (w + 2))},${fmt(p[1] - n[1] * (w + 2))}`;
    const q: Pt = [p[0] - u[0] * 1.0, p[1] - u[1] * 1.0];
    lights += `M${fmt(q[0] + n[0] * (w + 2))},${fmt(q[1] + n[1] * (w + 2))}Q${fmt(q[0] + u[0] * 0.9)},${fmt(q[1] + u[1] * 0.9)} ${fmt(q[0] - n[0] * (w + 2))},${fmt(q[1] - n[1] * (w + 2))}`;
  }
  ctx.stroke(seams, '#23262E', 0.45, { o: 0.7, cp: clip });
  ctx.stroke(lights, '#FFFFFF', 0.4, { o: 0.45, cp: clip });
  ctx.push(taperPath([lerp2(a, b, 0.05), lerp2(a, b, 0.95)], [w * 0.22, w * 0.22]), '#FFFFFF', { o: 0.35, cp: clip });
}

// ===============================================================================================================
// A peça
// ===============================================================================================================

export function drawTop(ctx0: LayerCtx): void {
  const ctx = lodCtx(ctx0);
  const { an, cfg } = ctx;
  const { cx } = an;
  const lite = isLite(ctx);
  const d = topDef(cfg);
  const top = TOP_KIND(cfg.top);
  ctx.group('body');
  // vestido longo/curto e túnica de mago: a saia vem antes do corpete (o corpete cobre a emenda)
  const c = ctx.col.top;
  const t = toneOf(c, d.mat);
  const cut = topCut(ctx);
  // pele do tronco só até a barra da peça (o cropped mostra a barriga até o cós): por baixo dela já está a calça
  if (needsSkin(cfg)) skinUnder(ctx, d.hem === 'crop' ? an.waistY + 2.2 : cut.hemY - 1.2);
  if (top === 'dress' || top === 'gown' || top === 'wizard') {
    const j = an.joints;
    const kneeY = (j.kneeL[1] + j.kneeR[1]) / 2;
    const ankleY = (j.ankleL[1] + j.ankleR[1]) / 2;
    if (an.seated) lapDrape(ctx, c, t, top !== 'dress');
    else if (top === 'dress') skirt(ctx, cut.hemY - 1.2, kneeY + 3.5, an.w.hip * 0.35 + 2.5, c, t, 'chiffon');
    else if (top === 'gown') skirt(ctx, cut.hemY - 1.2, ankleY + 2.6, an.w.hip * 0.55 + 5, c, t, 'satin');
    else skirt(ctx, cut.hemY - 1.2, kneeY + (ankleY - kneeY) * 0.55, an.w.hip * 0.45 + 4, c, t, 'wool', { open: true });
  }
  ctx.push(cut.d, c, { gf: cut.grad });
  // estampas (antes do volume, que passa por cima)
  switch (top) {
    case 'striped': {
      const sc = stripeColor(c);
      const bb = boxOf(cut.pts);
      stripes(ctx, cut.d, { x: bb.x - 1, y: an.collarY + 1.2, w: bb.w + 2, h: bb.h + 4 }, sc, { gap: lite ? 2.8 : 2.1, w: lite ? 1.2 : 0.9 });
      break;
    }
    case 'flannel': {
      const bb = boxOf(cut.pts);
      plaid(ctx, cut.d, { x: bb.x - 2, y: bb.y - 2, w: bb.w + 4, h: bb.h + 4 }, c, { cell: 3.6, accent: mix(c, '#FFF2C8', 0.7) });
      break;
    }
    case 'hawaiian': {
      const bb = boxOf(cut.pts);
      floral(ctx, cut.d, { x: bb.x, y: bb.y + 1, w: bb.w, h: bb.h }, c, 31, Math.round(bb.w * bb.h / 70));
      break;
    }
    case 'graphic':
      graphicPrint(ctx, cut);
      break;
    case 'pride_tee': {
      // faixa larga com as listras da bandeira atravessando o peito, curvando com o tronco
      const flag = flagOf(cfg.prideFlag);
      const ch = an.w.chest + 3;
      const y0 = an.armpitY - 1.2;
      drawFlagOn(ctx, flag, boxSurface({ x: cx - ch, y: y0, w: ch * 2, h: Math.min(11, (an.waistY - y0) * 0.75) }, { bow: 0.9 }), { clip: cut.d });
      break;
    }
    case 'sequin':
      sequinTexture(ctx, cut);
      break;
    case 'holo': {
      const bb = boxOf(cut.pts);
      ctx.push(cut.d, '#B08BFF', { gf: { t: 'l', x1: bb.x, y1: bb.y, x2: bb.x + bb.w, y2: bb.y + bb.h, s: [[0, '#5EF2FF'], [0.3, '#B08BFF'], [0.55, '#FF6AD5'], [0.8, '#C8FF7A'], [1, '#5EF2FF']] }, o: 0.34 });
      break;
    }
    case 'jersey':
    case 'basket':
      sportPanels(ctx, cut);
      break;
    case 'cyber':
      cyberPanels(ctx, cut);
      break;
    case 'armor':
      armorPlates(ctx, cut);
      break;
    default:
      break;
  }
  // volume e dobras
  const tee = d.ease === 'tee';
  shadeTorso(ctx, cut, {
    folds: d.folds,
    sleeveless: d.sl === 'none',
    rim: d.mat === 'metal' ? 0 : d.mat === 'satin' ? 1.4 : 1,
    noChest: top === 'armor',
    relaxed: (tee && teeFit(cfg) === 'relaxed') || top === 'oversized',
  });
  // materiais
  if (d.mat === 'satin') satinSheen(ctx, cut);
  if (d.mat === 'linen' && !lite) linenSlub(ctx, cut);
  if ((d.mat === 'rib' || top === 'sweater') && !lite) knitColumns(ctx, cut, d.mat === 'rib' ? 0.9 : 1.15);
  if (d.mat === 'pique' && !lite) speckle(ctx, boxOf(cut.pts), shade(c, luminance(c) > 0.5 ? -0.25 : 0.25), { n: 90, r: [0.07, 0.12], seed: 3, o: 0.35, cp: cut.d });
  if (d.mat === 'mesh' && !lite) meshDots(ctx, cut);
  if (d.mat === 'nylon') nylonSheen(ctx, cut);
  if (d.mat === 'velvet') velvetNap(ctx, cut);
  // barra
  if (d.hem !== 'bodice' && d.hem !== 'crop') hemFinish(ctx, cut, d.hemBand, top === 'jersey' || top === 'basket' ? contrastOf(c, '#F4F4F8', '#1C1C28') : top === 'royal' ? '#D9A931' : undefined);
  if (d.hem === 'crop') {
    hemFinish(ctx, cut, 'hem');
    edgeShadow(ctx, hemLine(ctx, cut, 0.6), torsoPath(an, {}), 1.0, 0.28);
  }
  // cava das peças sem manga (sombra da borda sobre a pele + borda)
  if (d.sl === 'none' && d.hem !== 'bodice') armholeEdges(ctx, cut, top === 'basket' ? contrastOf(c, '#F4F4F8', '#1C1C28') : undefined);
  if (d.sl === 'none' && d.hem === 'bodice') armholeEdges(ctx, cut, top === 'gown' ? mix(c, '#FFFFFF', 0.25) : undefined);
  // gola
  neckFinish(ctx, cut);
  // detalhes por peça
  details(ctx, cut);
}

/** id efetivo (desconhecido = camiseta) */
function TOP_KIND(id: string): string {
  return id in TOPS ? id : 'tee';
}

/** acabamento da gola pelo tipo */
function neckFinish(ctx: LayerCtx, cut: Cut): void {
  const { an, cfg } = ctx;
  const d = topDef(cfg);
  const c = cut.color;
  const nk = neckCutOf(an, d);
  const lite = isLite(ctx);
  // sombra da borda do decote sobre a pele (V, canoa, cava funda)
  if (needsSkin(cfg) && nk.depth > 0.4) edgeShadow(ctx, cut.neckPts, torsoPath(an, {}), 1.0, 0.26);
  switch (d.neck) {
    case 'crew':
      neckRib(ctx, cut, cfg.top === 'sweater' ? 2.4 : cfg.top === 'oversized' ? 2.3 : 2.0);
      break;
    case 'v':
      if (cfg.top === 'jersey') neckRib(ctx, cut, 1.6, contrastOf(c, '#F4F4F8', '#1C1C28'));
      else if (cfg.top === 'wizard') neckRib(ctx, cut, 1.4, '#E2B33C');
      else if (cfg.top === 'tunic') {
        neckRib(ctx, cut, 1.2, shade(c, -0.12));
        if (!lite) embroidery(ctx, cut);
      } else if (cfg.top === 'dress' || cfg.top === 'gown' || cfg.top === 'blouse') {
        ctx.stroke(cut.neck, cut.tone.shade, 0.7, { o: 0.5, cp: cut.d });
        if (!lite) ctx.stroke(cut.neck, cut.tone.light, 0.25, { o: 0.45, cp: cut.d });
      } else neckRib(ctx, cut, 1.4);
      break;
    case 'scoop':
    case 'boat':
    case 'square':
      neckRib(ctx, cut, cfg.top === 'basket' ? 1.3 : 1.0, cfg.top === 'basket' ? contrastOf(c, '#F4F4F8', '#1C1C28') : cfg.top === 'sequin' ? mix(c, '#FFFFFF', 0.3) : undefined);
      break;
    case 'collar':
      shirtCollar(ctx, cut, { soft: cfg.top === 'polo' });
      break;
    case 'open':
      openCollar(ctx, cut);
      break;
    case 'turtle':
      turtleCollar(ctx, cut);
      break;
    case 'mock':
      if (cfg.top === 'armor') mockCollar(ctx, cut, 3.2, { color: '#B9BFCB', tone: toneOf('#B9BFCB', 'metal'), trim: '#E2B33C' });
      else if (cfg.top === 'royal') mockCollar(ctx, cut, 2.6, { trim: '#E2B33C' });
      else if (cfg.top === 'cyber') mockCollar(ctx, cut, 1.8, { color: '#1A1D26', tone: toneOf('#1A1D26', 'leather'), trim: '#3DF5FF' });
      else mockCollar(ctx, cut, 2.0, { zip: true, trim: cfg.top === 'neon_jacket' ? LIME : undefined });
      break;
    case 'hood':
      hoodFront(ctx, cut);
      break;
    case 'jacket':
      break;
    default:
      break;
  }
}

/** gola aberta (camisa de linho, florida, cetim): abas abertas em V, pescoço e pele à mostra */
function openCollar(ctx: LayerCtx, cut: Cut): void {
  const { an } = ctx;
  const { cx } = an;
  const lite = isLite(ctx);
  const t = cut.tone;
  const c = cut.color;
  const nk = neckCutOf(an, topDef(ctx.cfg));
  const yV = an.collarY + nk.depth;
  const yS = an.collarY - 2.6;
  for (const s of SIDES) {
    const g = og(s);
    const pts: SP[] = [
      [cx + g * (nk.w - 0.6), yS - 0.4, 0.5],
      [cx + g * (nk.w + 2.2), yS + 1.2],
      [cx + g * (nk.w + 2.6), yS + 4.6, 0],
      [cx + g * 1.2, yV + 0.4, 0],
      [cx + g * (nk.w * 0.55), (yS + yV) / 2 - 0.4],
    ];
    const d = smoothPath(pts);
    ctx.push(d, '#0A0610', { o: 0.24, ...(lite ? {} : { b: 0.45 }), cp: cut.d });
    ctx.push(d, c, { gf: { t: 'l', x1: cx + g * nk.w, y1: yS, x2: cx, y2: yV, s: s === 'L' ? [[0, t.light], [1, t.base]] : [[0, t.base], [1, t.shade]] } });
    if (ctx.cfg.top === 'hawaiian') floral(ctx, d, boxOf(pts), c, 9 + (s === 'L' ? 1 : 2), 1);
    if (!lite) ctx.stroke(smoothPath([pts[0], [cx + g * (nk.w * 0.5 + 0.4), (yS + yV) / 2], [cx + g * 1.3, yV - 0.2]], false), t.deep, 0.22, { o: 0.4 });
  }
  // carcela a partir do V até a barra, com botões (os de cima abertos)
  placket(ctx, cut, yV + 0.6, cut.hemY - 0.8, { buttons: 4, firstOpen: false, color: ctx.cfg.top === 'satin' ? mix(c, '#FFFFFF', 0.4) : undefined });
}

/** frente do capuz do moletom: as bordas do capuz descem dos ombros e se cruzam na base do pescoço + cordão */
function hoodFront(ctx: LayerCtx, cut: Cut): void {
  const { an } = ctx;
  const { cx } = an;
  const lite = isLite(ctx);
  const t = cut.tone;
  const c = cut.color;
  const cw = an.collarW;
  const yS = an.collarY - 2.6;
  const yC = an.collarY + 1.4;
  for (const s of SIDES) {
    const g = og(s);
    // a borda do capuz: faixa grossa do ombro ao meio, a da direita por cima
    const band = smoothPath([
      [cx + g * (cw + 2.6), yS - 0.6, 0.5],
      [cx + g * (cw + 3.4), yS + 1.6],
      [cx + g * (cw * 0.5 + 1.0), yC + 1.0],
      [cx - g * 0.6, yC + 1.6, 0],
      [cx - g * 0.2, yC - 0.4, 0],
      [cx + g * (cw * 0.5), yS + 2.0],
      [cx + g * (cw - 0.2), yS - 0.4],
    ]);
    ctx.push(band, '#0A0610', { o: 0.25, ...(lite ? {} : { b: 0.5 }), cp: cut.d });
    ctx.push(band, c, { gf: { t: 'l', x1: cx + g * (cw + 3), y1: yS, x2: cx, y2: yC + 1, s: s === 'L' ? [[0, t.light], [0.6, t.base], [1, t.shade]] : [[0, t.shade], [0.6, t.base], [1, t.shade]] } });
    if (!lite) ctx.stroke(smoothPath([[cx + g * (cw + 2.3), yS + 0.2], [cx + g * (cw * 0.5 + 0.8), yC], [cx - g * 0.3, yC + 0.7]], false), t.deep, 0.2, { o: 0.35 });
  }
  // cordões com ponteira
  const cord = contrastOf(c, '#F2F0EA', '#2A2A34');
  for (const g of [-1, 1]) {
    const x0 = cx + g * 2.0;
    const len = 7.5 + (g > 0 ? 1.2 : 0);
    ctx.stroke(smoothPath([[x0, yC + 0.6], [x0 + g * 0.3, yC + len * 0.5], [x0 - g * 0.1, yC + len]], false), cord, lite ? 0.55 : 0.42, { o: 0.95 });
    ctx.push(blob(x0 - g * 0.1, yC + len + 0.7, 0.32, 0.75), mix(cord, '#888888', 0.3));
  }
}

/** bordado em volta do V (túnica): pontinhos e traços de outra cor seguindo a borda */
function embroidery(ctx: LayerCtx, cut: Cut): void {
  const col = lum(cut.color) > 0.45 ? '#B23A48' : '#F2C94C';
  const pts = cut.neckPts;
  let dots = '';
  for (let i = 0; i <= 18; i++) {
    const p = sampleOn(pts, i / 18);
    dots += blob(p[0], p[1] + 1.5, 0.28, 0.28) + (i % 2 ? '' : blob(p[0], p[1] + 2.5, 0.18, 0.4));
  }
  ctx.push(dots, col, { o: 0.9, cp: cut.d });
}

// ---------------------------------------------------------------------------------------------------------------
// materiais
// ---------------------------------------------------------------------------------------------------------------

/** cetim: faixas largas de brilho que seguem o caimento (do ombro pro quadril) */
function satinSheen(ctx: LayerCtx, cut: Cut): void {
  const { an } = ctx;
  const { cx } = an;
  const lite = isLite(ctx);
  const ch = an.w.chest;
  const y0 = an.armpitY - 2;
  const y1 = cut.hemY;
  ctx.push(
    taperPath([[cx - ch * 0.55, y0], [cx - ch * 0.62, (y0 + y1) / 2], [cx - ch * 0.5, y1]], [0.4, 1.4, 0.6]) + taperPath([[cx + ch * 0.2, y0 + 3], [cx + ch * 0.28, (y0 + y1) / 2 + 1], [cx + ch * 0.18, y1]], [0.2, 0.8, 0.3]),
    '#FFFFFF',
    { o: lum(cut.color) > 0.6 ? 0.5 : 0.3, ...(lite ? {} : { b: 0.7 }), cp: cut.d },
  );
}

/** linho: fiapos irregulares (slub) e amassado leve */
function linenSlub(ctx: LayerCtx, cut: Cut): void {
  const r = rng(41);
  const bb = boxOf(cut.pts);
  let d = '';
  for (let i = 0; i < 46; i++) {
    const x = bb.x + r() * bb.w;
    const y = bb.y + r() * bb.h;
    const l = 0.8 + r() * 1.8;
    d += `M${fmt(x)},${fmt(y)}h${fmt(l)}`;
  }
  ctx.stroke(d, shade(cut.color, lum(cut.color) > 0.5 ? -0.2 : 0.25), 0.14, { o: 0.4, cp: cut.d });
}

/** malha canelada / tricô: colunas verticais finas */
function knitColumns(ctx: LayerCtx, cut: Cut, gap: number): void {
  const bb = boxOf(cut.pts);
  let d = '';
  for (let x = bb.x + 0.4; x < bb.x + bb.w; x += gap) d += `M${fmt(x)},${fmt(bb.y)}V${fmt(bb.y + bb.h)}`;
  ctx.stroke(d, cut.tone.deep, 0.13, { o: 0.2, cp: cut.d });
  if (ctx.cfg.top === 'sweater') {
    // tranças (cable knit) em duas colunas
    const { an } = ctx;
    let cab = '';
    for (const x of [an.cx - an.w.chest * 0.45, an.cx + an.w.chest * 0.42]) {
      for (let y = an.collarY + 2; y < cut.hemY - 2; y += 2.2) cab += `M${fmt(x - 0.8)},${fmt(y)}C${fmt(x - 0.8)},${fmt(y + 1)} ${fmt(x + 0.8)},${fmt(y + 1.2)} ${fmt(x + 0.8)},${fmt(y + 2.2)}M${fmt(x + 0.8)},${fmt(y)}C${fmt(x + 0.8)},${fmt(y + 0.7)} ${fmt(x + 0.3)},${fmt(y + 0.9)} ${fmt(x + 0.1)},${fmt(y + 1.0)}`;
    }
    ctx.stroke(cab, cut.tone.deep, 0.32, { o: 0.32, cp: cut.d });
    ctx.stroke(cab, cut.tone.light, 0.14, { o: 0.35, cp: cut.d });
  }
}

/** tela furadinha (camisa de time) */
function meshDots(ctx: LayerCtx, cut: Cut): void {
  const bb = boxOf(cut.pts);
  let d = '';
  for (let y = bb.y; y < bb.y + bb.h; y += 0.9) for (let x = bb.x + ((Math.round(y / 0.9) % 2) * 0.45); x < bb.x + bb.w; x += 0.9) d += `M${fmt(x)},${fmt(y)}h0.16`;
  ctx.stroke(d, cut.tone.deep, 0.16, { o: 0.32, cp: cut.d });
}

/** náilon: brilho largo e liso no peito */
function nylonSheen(ctx: LayerCtx, cut: Cut): void {
  const { an } = ctx;
  const lite = isLite(ctx);
  ctx.push(blob(an.cx - an.w.chest * 0.45, an.armpitY + 3, an.w.chest * 0.32, 5.5, 0.2), '#FFFFFF', { o: 0.22, ...(lite ? {} : { b: 1.0 }), cp: cut.d });
}

/** veludo: miolo fundo e borda clara (a luz pega no pelo de lado) */
function velvetNap(ctx: LayerCtx, cut: Cut): void {
  const lite = isLite(ctx);
  ctx.stroke(cut.d, cut.tone.light, 1.6, { o: 0.22, ...(lite ? {} : { b: 0.8 }), cp: cut.d });
}

/** paetê: pontos de luz e sombra + estrelinhas de brilho */
function sequinTexture(ctx: LayerCtx, cut: Cut): void {
  const lite = isLite(ctx);
  const bb = boxOf(cut.pts);
  const c = cut.color;
  // contraste pelo tom: em cor clara o paetê virado fica cinza-azulado e o brilho ganha um reflexo iridescente (senão a
  // blusa branca lia regata lisa); em cor escura/média, sombra e luz da própria cor
  const pale = lum(c) > 0.6;
  speckle(ctx, bb, pale ? mix(c, '#4A5266', 0.45) : mix(c, '#000000', 0.35), { n: lite ? 40 : 150, r: lite ? [0.3, 0.45] : [0.2, 0.32], seed: 13, o: pale ? 0.62 : 0.5, cp: cut.d });
  speckle(ctx, bb, pale ? '#FFFFFF' : mix(c, '#FFFFFF', 0.55), { n: lite ? 30 : 120, r: lite ? [0.28, 0.42] : [0.18, 0.3], seed: 29, o: 0.75, cp: cut.d });
  if (pale) speckle(ctx, bb, mix(c, '#9FB8FF', 0.7), { n: lite ? 14 : 60, r: lite ? [0.28, 0.4] : [0.18, 0.28], seed: 41, o: 0.7, cp: cut.d });
  if (!lite) {
    const r = rng(7);
    let st = '';
    for (let i = 0; i < 7; i++) st += starPath(bb.x + r() * bb.w, bb.y + r() * bb.h * 0.8, 0.9 + r() * 0.6, 4, 0.22);
    ctx.push(st, '#FFFFFF', { o: 0.9, cp: cut.d });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// painéis (esporte, cyber, armadura)
// ---------------------------------------------------------------------------------------------------------------

/** recortes laterais de outra cor (camisa de time, regata de basquete) */
function sportPanels(ctx: LayerCtx, cut: Cut): void {
  const { an } = ctx;
  const { cx } = an;
  const col = contrastOf(cut.color, '#F4F4F8', '#1C1C28');
  const ay = an.armpitY;
  let d = '';
  for (const s of SIDES) {
    const g = og(s);
    const xa = torsoXAt(an, s, ay + 1, cut.ease);
    const xb = torsoXAt(an, s, cut.hemY, cut.ease);
    d += smoothPath([[xa - g * 0.2, ay - 1, 0], [xa - g * 2.4, ay + 1.5], [cx + g * (an.w.waist * 0.72), an.waistY], [xb - g * 2.2, cut.hemY + 1.5, 0], [xb + g * 2, cut.hemY + 1.5, 0], [xa + g * 2, ay - 1, 0]]);
  }
  ctx.push(d, col, { cp: cut.d, o: 0.95 });
  // filete fino de terceira cor na borda do recorte
  ctx.stroke(d, mix(col, cut.color, 0.5), 0.3, { o: 0.6, cp: cut.d });
}

/** top cyber: placas escuras com costuras de luz (lima/ciano) e um emblema hexagonal brilhando */
function cyberPanels(ctx: LayerCtx, cut: Cut): void {
  const { an } = ctx;
  const { cx } = an;
  const lite = isLite(ctx);
  const glow = '#3DF5FF';
  const ay = an.armpitY;
  // placa do peito
  const plate = smoothPath([[cx - an.w.chest * 0.8, ay - 1.5], [cx + an.w.chest * 0.8, ay - 1.5], [cx + an.w.chest * 0.62, ay + 6.5], [cx, ay + 8.5, 0], [cx - an.w.chest * 0.62, ay + 6.5]]);
  ctx.push(plate, '#1A1D26', { gf: { t: 'l', x1: cx - 8, y1: ay - 2, x2: cx + 8, y2: ay + 8, s: [[0, '#3A4152'], [0.5, '#1E222D'], [1, '#0E1016']] }, o: 0.92, cp: cut.d });
  const lines = smoothPath([[cx - an.w.chest * 0.8, ay - 1.5], [cx - an.w.chest * 0.62, ay + 6.5], [cx, ay + 8.5, 0], [cx + an.w.chest * 0.62, ay + 6.5], [cx + an.w.chest * 0.8, ay - 1.5]], false) + `M${fmt(cx)},${fmt(ay + 8.5)}V${fmt(cut.hemY)}`;
  if (!lite) ctx.stroke(lines, glow, 1.2, { o: 0.35, b: 0.6, cp: cut.d });
  ctx.stroke(lines, glow, 0.35, { o: 0.95, cp: cut.d });
  // emblema
  const hex: SP[] = [];
  for (let i = 0; i < 6; i++) hex.push([cx + Math.cos((i * Math.PI) / 3) * 1.6, ay + 3 + Math.sin((i * Math.PI) / 3) * 1.6, 0]);
  const hd = smoothPath(hex, true, 0);
  if (!lite) ctx.push(hd, glow, { o: 0.5, b: 0.8 });
  ctx.push(hd, '#0E1016', { o: 0.95 });
  ctx.stroke(hd, glow, 0.35, { o: 1 });
  ctx.push(blob(cx, ay + 3, 0.6, 0.6), glow, { o: 0.95 });
}

/** armadura: peitoral com reflexo em faixa, placas do abdome e filetes dourados */
function armorPlates(ctx: LayerCtx, cut: Cut): void {
  const { an } = ctx;
  const { cx } = an;
  const lite = isLite(ctx);
  const t = cut.tone;
  const ay = an.armpitY;
  const ch = an.w.chest + cut.ease;
  const trim = '#E2B33C';
  // peitoral (forma de escudo curva) com a quilha no meio
  const breast = smoothPath([[cx - ch + 0.5, an.collarY - 0.5], [cx + ch - 0.5, an.collarY - 0.5], [cx + ch - 0.2, ay + 4], [cx + ch * 0.55, an.waistY - 1.5], [cx, an.waistY - 0.4, 0], [cx - ch * 0.55, an.waistY - 1.5], [cx - ch + 0.2, ay + 4]]);
  ctx.push(breast, t.base, { gf: torsoGrad(an, t, 'metal', cut.ease), cp: cut.d });
  metal(ctx, breast, { x: cx - ch, y: an.collarY, w: ch * 2, h: an.waistY - an.collarY }, t.base);
  ctx.push(taperPath([[cx, an.collarY + 1], [cx, ay + 4], [cx, an.waistY - 1]], [0.3, 0.7, 0.2]), t.light, { o: 0.6, cp: breast });
  ctx.stroke(breast, trim, 0.5, { o: 0.95, cp: cut.d });
  // placas do abdome (faixas sobrepostas) até a barra
  let bands = '';
  let lights = '';
  for (let y = an.waistY + 0.2; y < cut.hemY - 0.5; y += 2.4) {
    bands += smoothPath([[cx - ch - 1, y], [cx, y + 0.9], [cx + ch + 1, y]], false);
    lights += smoothPath([[cx - ch - 1, y + 0.6], [cx, y + 1.5], [cx + ch + 1, y + 0.6]], false);
  }
  ctx.stroke(bands, '#1E2028', 0.5, { o: 0.75, cp: cut.d });
  ctx.stroke(lights, '#FFFFFF', 0.35, { o: lite ? 0.3 : 0.45, cp: cut.d });
  // rebites
  if (!lite) {
    let rv = '';
    for (const g of [-1, 1]) for (const y of [an.collarY + 1.5, ay + 3]) rv += blob(cx + g * (ch - 1.4), y, 0.32, 0.32);
    ctx.push(rv, trim, { o: 0.95 });
  }
  // a cor da peça aparece no saiote de tecido por baixo das placas (barra)
  ctx.push(smoothPath([[cx - ch - 1, cut.hemY - 1.6], [cx + ch + 1, cut.hemY - 1.6], [cx + ch + 1, cut.hemY + 2], [cx - ch - 1, cut.hemY + 2]]), mix(cut.color, '#7A1E2C', lum(cut.color) > 0.6 ? 0.6 : 0.1), { o: 0.9, cp: cut.d });
}

/** cava das peças sem manga: borda debruada e sombra sobre a pele do ombro */
function armholeEdges(ctx: LayerCtx, cut: Cut, tint?: string): void {
  const { an } = ctx;
  const lite = isLite(ctx);
  const t = cut.tone;
  // a cava vai do ponto da alça até o flanco: pega os pontos do contorno entre o canto da alça e a axila
  const yA = an.armpitY + 4.5;
  let d = '';
  for (const s of SIDES) {
    const g = og(s);
    const side = cut.pts.filter((p) => Math.sign(p[0] - an.cx) === g && p[1] < yA && Math.abs(p[0] - an.cx) > an.collarW + 1);
    if (side.length > 1) d += smoothPath(side.sort((a, b) => a[1] - b[1]), false);
  }
  if (!d) return;
  ctx.stroke(d, tint ?? shade(cut.color, luminance(cut.color) > 0.6 ? -0.1 : 0.06), tint ? 1.1 : 0.8, { cp: cut.d });
  if (!lite) ctx.stroke(d, t.deep, 0.18, { o: 0.4, cp: cut.d });
}

// ---------------------------------------------------------------------------------------------------------------
// detalhes por peça
// ---------------------------------------------------------------------------------------------------------------

function details(ctx: LayerCtx, cut: Cut): void {
  const { an, cfg } = ctx;
  const { cx } = an;
  const lite = isLite(ctx);
  const c = cut.color;
  const t = cut.tone;
  const top = TOP_KIND(cfg.top);
  switch (top) {
    case 'polo':
      placket(ctx, cut, an.collarY - 0.6, an.collarY + 6.5, { buttons: 2, w: 1.1 });
      break;
    case 'shirt':
      placket(ctx, cut, an.collarY - 0.3, cut.hemY - 0.6, { buttons: 5 });
      chestPocket(ctx, cut, cx + an.w.chest * 0.45, an.armpitY + 0.5, 3.6, 4.0);
      break;
    case 'flannel':
      placket(ctx, cut, an.collarY - 0.3, cut.hemY - 0.6, { buttons: 5, color: mix(c, '#2A1A14', 0.5) });
      chestPocket(ctx, cut, cx - an.w.chest * 0.45, an.armpitY + 0.4, 3.6, 4.0, true);
      chestPocket(ctx, cut, cx + an.w.chest * 0.45, an.armpitY + 0.4, 3.6, 4.0, true);
      break;
    case 'hoodie': {
      // bolso canguru com sombra das aberturas e pesponto
      const y0 = an.waistY + 0.5;
      const y1 = cut.hemY - 2.6;
      const w0 = an.w.waist * 0.62;
      const pk = smoothPath([[cx - w0, y0, 0.4], [cx + w0, y0, 0.4], [cx + w0 + 2.2, y1, 0.5], [cx - w0 - 2.2, y1, 0.5]]);
      ctx.push(pk, '#0A0610', { o: 0.2, ...(lite ? {} : { b: 0.4 }), cp: cut.d });
      ctx.push(pk, c, { gf: { t: 'l', x1: cx - w0, y1: y0, x2: cx + w0, y2: y1, s: [[0, t.light], [0.5, t.base], [1, t.shade]] } });
      ctx.push(taperPath([[cx - w0, y0 + 0.4], [cx - w0 - 1.6, (y0 + y1) / 2 + 0.6], [cx - w0 - 2.0, y1 - 0.4]], [0.6, 0.9, 0.5]) + taperPath([[cx + w0, y0 + 0.4], [cx + w0 + 1.6, (y0 + y1) / 2 + 0.6], [cx + w0 + 2.0, y1 - 0.4]], [0.6, 0.9, 0.5]), t.deep, { o: 0.45, cp: cut.d });
      if (!lite) ctx.stroke(pk, threadOf(c), 0.12, { o: 0.35, da: [0.5, 0.35] });
      break;
    }
    case 'jacket':
    case 'tux':
      jacketFront(ctx, cut, top === 'tux');
      break;
    case 'neon_jacket':
    case 'holo': {
      // zíper no meio e (neon) vivos de luz no zíper e no recorte do peito
      const zipC = top === 'neon_jacket' ? LIME : '#E8E8F4';
      ctx.stroke(`M${fmt(cx + 0.1)},${fmt(an.collarY)}V${fmt(cut.hemY)}`, t.deep, 0.7, { o: 0.6, cp: cut.d });
      if (!lite) ctx.stroke(`M${fmt(cx + 0.1)},${fmt(an.collarY)}V${fmt(cut.hemY)}`, '#C8C8D0', 0.22, { o: 0.9, da: [0.3, 0.3], cp: cut.d });
      if (top === 'neon_jacket') {
        const yy = an.armpitY - 0.5;
        const pip = smoothPath([[torsoXAt(an, 'L', yy + 1, cut.ease) + 0.3, yy + 1], [cx - an.collarW - 1.2, an.collarY - 1.0], [cx - an.collarW + 0.4, an.collarY - 2.2]], false) + smoothPath([[torsoXAt(an, 'R', yy + 1, cut.ease) - 0.3, yy + 1], [cx + an.collarW + 1.2, an.collarY - 1.0], [cx + an.collarW - 0.4, an.collarY - 2.2]], false) + `M${fmt(cx - 1.0)},${fmt(an.collarY + 1)}V${fmt(cut.hemY - 0.5)}M${fmt(cx + 1.2)},${fmt(an.collarY + 1)}V${fmt(cut.hemY - 0.5)}`;
        // vivo refletivo costurado (filete claro com sulco embaixo), brilho só de leve: material, não tubo de neon
        const pipC = mix(zipC, '#F2FFE0', 0.35);
        ctx.stroke(pip, t.deep, lite ? 0.5 : 0.42, { o: 0.45, cp: cut.d });
        if (!lite) ctx.stroke(pip, zipC, 0.7, { o: 0.16, b: 0.4, cp: cut.d });
        ctx.stroke(pip, pipC, lite ? 0.32 : 0.24, { o: 0.85, cp: cut.d });
      }
      ctx.push(blob(cx + 0.2, an.collarY + 0.8, 0.45, 0.8), '#D8D8E0', { o: 0.95 });
      break;
    }
    case 'crop':
      break;
    case 'blouse':
      if (!lite) {
        // babadinho na borda do V
        let r = '';
        for (let i = 1; i < 12; i++) {
          const p = sampleOn(cut.neckPts, i / 12);
          r += blob(p[0], p[1] + 0.8, 0.6, 0.45);
        }
        ctx.push(r, t.light, { o: 0.4, cp: cut.d });
      }
      break;
    case 'tunic': {
      // fendas laterais na barra
      for (const s of SIDES) {
        const g = og(s);
        const x = torsoXAt(an, s, cut.hemY - 1, cut.ease) - g * 0.6;
        ctx.stroke(`M${fmt(x)},${fmt(cut.hemY - 4.5)}L${fmt(x + g * 0.4)},${fmt(cut.hemY + 0.4)}`, t.deep, 0.35, { o: 0.5, cp: cut.d });
      }
      break;
    }
    case 'dress':
    case 'gown': {
      // costura/faixa da cintura do corpete e (gala) um broche de brilho no meio
      const y = cut.hemY - 0.4;
      ctx.push(taperPath([[torsoXAt(an, 'L', y, cut.ease), y - 0.2], [cx, y + 0.3], [torsoXAt(an, 'R', y, cut.ease), y - 0.2]], [1.1, 1.3, 1.1]), top === 'gown' ? t.shade : mix(c, '#000000', 0.18), { o: 0.8 });
      if (top === 'gown') {
        ctx.push(starPath(cx + 0.2, y + 0.1, 1.3, 4, 0.35), '#FFFFFF', { o: 0.95 });
        if (!lite) ctx.push(blob(cx + 0.2, y + 0.1, 1.6, 1.6), '#FFFFFF', { o: 0.35, b: 0.8 });
      }
      break;
    }
    case 'wizard': {
      // cordão na cintura + estrelas e luas bordadas em dourado
      const y = cut.hemY - 0.6;
      ctx.stroke(smoothPath([[torsoXAt(an, 'L', y, cut.ease), y], [cx, y + 0.5], [torsoXAt(an, 'R', y, cut.ease), y]], false), '#E2B33C', lite ? 1.0 : 0.8);
      ctx.stroke(smoothPath([[cx + 1.4, y + 0.4], [cx + 1.9, y + 4], [cx + 1.5, y + 7]], false), '#E2B33C', 0.55);
      ctx.push(blob(cx + 1.5, y + 7.4, 0.55, 0.8), '#E2B33C');
      if (!lite) {
        const r = rng(19);
        let st = '';
        const bb = boxOf(cut.pts);
        for (let i = 0; i < 6; i++) st += starPath(bb.x + 2 + r() * (bb.w - 4), bb.y + 6 + r() * (bb.h - 8), 0.55 + r() * 0.3, 5, 0.45);
        ctx.push(st, '#F2C94C', { o: 0.9, cp: cut.d });
      }
      break;
    }
    case 'royal': {
      // alamares dourados (cordões horizontais com botão) e dragonas nos ombros (nas mangas)
      let frog = '';
      const ys: Pt[] = [];
      for (let i = 0; i < 4; i++) {
        const y = an.collarY + 3 + i * 3.4;
        frog += smoothPath([[cx - 3.2, y], [cx - 1.4, y - 0.5], [cx, y]], false) + smoothPath([[cx + 3.2, y], [cx + 1.4, y - 0.5], [cx, y]], false);
        ys.push([cx, y]);
      }
      ctx.stroke(frog, '#E2B33C', lite ? 0.75 : 0.55, { o: 0.95 });
      buttons(ctx, ys, 0.45, '#F2C94C', { holes: false });
      break;
    }
    case 'basket':
    case 'jersey':
      break;
    default:
      break;
  }
}

/** frente da jaqueta (aberta, com camiseta por dentro) e do smoking (camisa branca, lapelas de cetim, gravata-borboleta) */
function jacketFront(ctx: LayerCtx, cut: Cut, tux: boolean): void {
  const { an, cfg } = ctx;
  const { cx } = an;
  const lite = isLite(ctx);
  const c = cut.color;
  const t = cut.tone;
  const yBreak = tux ? an.waistY - 1.5 : an.armpitY + 6;
  // o "V" aberto mostra a peça de baixo: camisa branca com peitilho (smoking) ou camiseta (jaqueta)
  const inner = tux ? '#F4F2EE' : contrastOf(c, '#F2F0EA', '#262630');
  const it = toneOf(inner, 'cotton');
  const cw = an.collarW;
  const vee = smoothPath([[cx - cw + 0.2, an.collarY - 2.4], [cx + cw - 0.2, an.collarY - 2.4], [cx + 1.2, yBreak, 0], [cx - 1.2, yBreak, 0]]);
  ctx.push(vee, inner, { gf: { t: 'l', x1: cx - cw, y1: 0, x2: cx + cw, y2: 0, s: [[0, it.light], [0.5, it.base], [1, it.shade]] }, cp: cut.d });
  if (tux) {
    // peitilho: pregas verticais e botões pequenos
    if (!lite) ctx.stroke(`M${fmt(cx - 1.4)},${fmt(an.collarY)}L${fmt(cx - 0.8)},${fmt(yBreak - 1)}M${fmt(cx + 1.4)},${fmt(an.collarY)}L${fmt(cx + 0.8)},${fmt(yBreak - 1)}`, it.shade, 0.25, { o: 0.6, cp: vee });
    buttons(ctx, [[cx, an.collarY + 3], [cx, an.collarY + 6]], 0.3, '#22222A', { holes: false, cp: vee });
    shirtCollar(ctx, cut, { color: inner });
  } else {
    neckRib(ctx, { ...cut, color: inner, tone: it, neckPts: [[cx - cw + 0.2, an.collarY - 2.4], [cx, an.collarY + 0.4], [cx + cw - 0.2, an.collarY - 2.4]], neck: smoothPath([[cx - cw + 0.2, an.collarY - 2.4], [cx, an.collarY + 0.4], [cx + cw - 0.2, an.collarY - 2.4]], false), d: vee }, 1.4);
  }
  // sombra das bordas da frente sobre a peça de baixo
  ctx.push(taperPath([[cx - cw + 0.5, an.collarY - 1.5], [cx - 1.5, yBreak - 2], [cx - 1.0, yBreak]], [0.4, 1.2, 0.4]) + taperPath([[cx + cw - 0.5, an.collarY - 1.5], [cx + 1.5, yBreak - 2], [cx + 1.0, yBreak]], [0.4, 1.2, 0.4]), '#0A0610', { o: 0.3, ...(lite ? {} : { b: 0.4 }), cp: vee });
  // lapelas (smoking: de cetim com bico)
  lapels(ctx, cut, yBreak, tux ? { peak: true, color: mix(c, '#000000', 0.15), tone: toneOf(mix(c, '#000000', 0.15), 'satin'), sheen: true } : {});
  // borda da frente fechando embaixo do botão e botão(ões)
  ctx.stroke(`M${fmt(cx + 0.3)},${fmt(yBreak)}L${fmt(cx + 0.6)},${fmt(cut.hemY + 0.4)}`, t.deep, 0.35, { o: 0.55, cp: cut.d });
  buttons(ctx, tux ? [[cx - 0.4, yBreak + 1.2]] : [[cx - 0.4, yBreak + 1.4], [cx - 0.4, yBreak + 5.4]], 0.5, tux ? mix(c, '#000000', 0.3) : mix(c, '#2A1A14', 0.4), { cp: cut.d });
  // bolsos: jaqueta com aba nos dois lados; smoking com debrum discreto
  for (const s of SIDES) {
    const g = og(s);
    const x = cx + g * an.w.waist * 0.58;
    const y = an.waistY + 2.2;
    if (tux) ctx.stroke(`M${fmt(x - 2)},${fmt(y)}h4`, t.light, 0.35, { o: 0.5, cp: cut.d });
    else {
      const fl = smoothPath([[x - 2.4, y, 0.2], [x + 2.4, y - g * 0.15, 0.2], [x + 2.3, y + 1.6], [x - 2.3, y + 1.7]]);
      ctx.push(fl, '#0A0610', { o: 0.25, ...(lite ? {} : { b: 0.35 }), cp: cut.d });
      ctx.push(fl, c, { gf: { t: 'l', x1: x, y1: y, x2: x, y2: y + 1.7, s: [[0, t.light], [1, t.base]] }, cp: cut.d });
    }
  }
  // smoking: gravata-borboleta (se o pescoço não tiver outra coisa) e lenço no bolso do peito
  if (tux) {
    if (neckFree(cfg)) bowTie(ctx, cx, an.collarY - 0.9, '#121218');
    ctx.push(smoothPath([[cx + an.w.chest * 0.42, an.armpitY + 1.0], [cx + an.w.chest * 0.42 + 2.6, an.armpitY + 0.2], [cx + an.w.chest * 0.42 + 2.2, an.armpitY + 1.5]]), '#F4F2EE', { o: 0.95, cp: cut.d });
    ctx.stroke(`M${fmt(cx + an.w.chest * 0.42 - 0.6)},${fmt(an.armpitY + 1.5)}h4`, t.light, 0.3, { o: 0.4, cp: cut.d });
  }
}

/** o slot pescoço está livre (gravata embutida do smoking só aparece aí) */
function neckFree(cfg: AvatarConfig): boolean {
  return !cfg.neck || cfg.neck === NONE;
}

/** gravata-borboleta (também usada pelo item de pescoço) */
export function bowTie(ctx: LayerCtx, x: number, y: number, color: string): void {
  const lite = isLite(ctx);
  const t = toneOf(color, 'satin');
  const wing = (g: number) => smoothPath([[x + g * 0.6, y - 0.5], [x + g * 2.8, y - 1.5], [x + g * 3.4, y - 0.2], [x + g * 2.9, y + 1.3], [x + g * 0.6, y + 0.6]]);
  ctx.push(wing(-1) + wing(1), '#0A0610', { o: 0.3, ...(lite ? {} : { b: 0.35 }) });
  ctx.push(wing(-1), color, { gf: { t: 'l', x1: x - 3.4, y1: y - 1.5, x2: x, y2: y + 1.3, s: [[0, t.light], [0.5, t.base], [1, t.shade]] } });
  ctx.push(wing(1), color, { gf: { t: 'l', x1: x + 3.4, y1: y - 1.5, x2: x, y2: y + 1.3, s: [[0, t.base], [0.6, t.shade], [1, t.deep]] } });
  ctx.push(smoothPath([[x - 0.75, y - 0.7], [x + 0.75, y - 0.7], [x + 0.6, y + 0.8], [x - 0.6, y + 0.8]]), color, { gf: { t: 'l', x1: x - 0.8, y1: y, x2: x + 0.8, y2: y, s: [[0, t.light], [1, t.shade]] } });
  if (!lite) ctx.stroke(smoothPath([[x - 2.6, y - 0.7], [x - 1.4, y - 0.1]], false) + smoothPath([[x + 2.6, y - 0.7], [x + 1.4, y - 0.1]], false), t.deep, 0.2, { o: 0.5 });
}

// ===============================================================================================================
// Capuz (etapa 5, atrás do corpo): capuz deitado nas costas do moletom
// ===============================================================================================================

/** capuz do moletom deitado nas costas: aparece como uma gola grossa atrás do pescoço, dos dois lados */
export function hoodBack(ctx0: LayerCtx): void {
  const ctx = lodCtx(ctx0);
  if (ctx.cfg.top !== 'hoodie') return;
  const { an } = ctx;
  const { cx } = an;
  const lite = isLite(ctx);
  const c = ctx.col.top;
  const t = toneOf(c, 'knit');
  const cw = an.collarW;
  const yS = an.collarY - 2.6;
  const top = headAnchors(an).chin[1] - 0.2;
  const hood = smoothPath([
    [cx - cw - 4.2, yS + 2.2],
    [cx - cw - 2.6, top + 2.0],
    [cx - an.w.neck - 0.4, top],
    [cx, top - 0.6],
    [cx + an.w.neck + 0.4, top],
    [cx + cw + 2.6, top + 2.0],
    [cx + cw + 4.2, yS + 2.2],
    [cx, yS + 3.5],
  ]);
  ctx.group('body');
  ctx.push(hood, t.shade, { gf: { t: 'l', x1: cx - cw - 4, y1: 0, x2: cx + cw + 4, y2: 0, s: [[0, t.base], [0.3, t.shade], [0.7, t.shade], [1, t.deep]] } });
  // o vão de dentro do capuz (forro) aparece atrás do pescoço
  ctx.push(blob(cx, top + 2.4, an.w.neck + 1.6, 1.8), t.deep, { o: 0.75, ...(lite ? {} : { b: 0.5 }), cp: hood });
  if (!lite) ctx.stroke(smoothPath([[cx - cw - 3.4, yS + 1.4], [cx - cw - 1.8, top + 2.6], [cx - an.w.neck, top + 1]], false) + smoothPath([[cx + cw + 3.4, yS + 1.4], [cx + cw + 1.8, top + 2.6], [cx + an.w.neck, top + 1]], false), t.light, 0.4, { o: 0.35, cp: hood });
}


// ===============================================================================================================
// Extras no braço (grupo armX): dragonas do traje real e ombreira da armadura
// ===============================================================================================================

export function topArmExtras(ctx0: LayerCtx, s: Side): void {
  const ctx = lodCtx(ctx0);
  const top = TOP_KIND(ctx.cfg.top);
  if (top !== 'royal' && top !== 'armor') return;
  const { an } = ctx;
  const lite = isLite(ctx);
  const g = og(s);
  const sh = s === 'L' ? an.joints.shoulderL : an.joints.shoulderR;
  const ua = an.spec.upperArm + 1.2;
  ctx.withGroup(s === 'L' ? 'armL' : 'armR', () => {
    if (top === 'royal') {
      // dragona: placa oval dourada com franja
      const pad = blob(sh[0] + g * 0.6, sh[1] - ua * 0.35, ua * 0.95, ua * 0.48, g * 0.12);
      ctx.push(pad, '#E2B33C', { gf: { t: 'l', x1: sh[0] - ua, y1: sh[1] - ua, x2: sh[0] + ua, y2: sh[1], s: [[0, '#FFE38A'], [0.5, '#E2B33C'], [1, '#8E6A1C']] } });
      let fr = '';
      for (let k = -0.8; k <= 0.81; k += 0.32) fr += `M${fmt(sh[0] + g * 0.6 + k * ua * 0.9)},${fmt(sh[1] - ua * 0.1)}v${fmt(lite ? 1.6 : 2.0)}`;
      ctx.stroke(fr, '#E2B33C', lite ? 0.45 : 0.32, { o: 0.95 });
    } else {
      // ombreira: duas lâminas sobrepostas com reflexo e filete dourado
      for (let i = 1; i >= 0; i--) {
        const y = sh[1] - ua * 0.45 + i * 1.8;
        const plate = smoothPath([[sh[0] - g * ua * 0.55, y + 0.6], [sh[0] + g * 0.4, y - 0.9], [sh[0] + g * ua * 1.15, y + 0.4], [sh[0] + g * ua * 1.05, y + 2.4], [sh[0] - g * ua * 0.4, y + 2.6]]);
        const t = toneOf('#B9BFCB', 'metal');
        ctx.push(plate, t.base, { gf: { t: 'l', x1: sh[0] - ua, y1: y - 1, x2: sh[0] + ua, y2: y + 3, s: [[0, t.light], [0.4, t.base], [0.75, t.shade], [1, t.deep]] } });
        ctx.stroke(plate, '#E2B33C', 0.35, { o: 0.9 });
      }
    }
  });
}
