// Óculos: aro com espessura certa, lente de vidro (reflexo diagonal, leve transparência; escuras em gradiente), ponte,
// plaquetas e haste até a orelha. Tudo sai dos olhos da anatomia (headAnchors) pelo referencial da cabeça, então a
// armação acompanha o espaçamento dos olhos, a altura da sobrancelha e a largura do rosto. Dono: chapelaria.
//
// Lente local: (0,0) no centro, x pra FORA (têmpora), y pra baixo; a lente da esquerda da tela é o espelho.
// Ordem: sombra na pele → hastes → lentes → ponte → aros → plaquetas/rebites/brilhos.

import type { LayerCtx } from '../ctx';
import { speckle } from '../shading';
import type { AvatarGradient, AvatarStop } from '../types';

import { GOLD_STOPS, SILVER_STOPS, blob, boxOf, fleck, gem, metalGrad, neon, smoothPath, sparkle, taperPath, tones, type HeadFrame, type SP, type Tones } from './headwear-kit';

type GlassesFn = (ctx: LayerCtx, hf: HeadFrame) => void;
type Pt2 = [number, number];

const GUNMETAL: readonly AvatarStop[] = [
  [0, '#D5DAE4'],
  [0.35, '#8E95A6'],
  [0.7, '#4C5262'],
  [1, '#2A2E38'],
];
const SHADOW = '#1E0F0A';

/** medidas dos olhos pra armação (avatar) */
export interface EyeBox {
  /** centro entre as lentes e altura do centro das lentes */
  cx: number;
  cy: number;
  /** meia-distância entre os centros das lentes */
  dx: number;
  /** meia-largura e meia-altura da lente padrão */
  hw: number;
  hh: number;
  /** meia-largura da cabeça na altura dos olhos */
  edge: number;
  /** altura onde a haste encosta na orelha */
  earY: number;
  s: number;
}

export function eyeBox(hf: HeadFrame): EyeBox {
  const { ha, s } = hf;
  const y = (ha.eyeL[1] + ha.eyeR[1]) / 2;
  const cx = (ha.eyeL[0] + ha.eyeR[0]) / 2;
  const dx = (ha.eyeR[0] - ha.eyeL[0]) / 2;
  const edge = hf.headX(y) - cx;
  const hw = Math.max(1.6 * s, Math.min(ha.eyeW * 1.48, edge - dx - 0.8 * s, dx - 0.72 * s));
  const cy = y + 0.2 * s;
  const hh = Math.max(1.45 * s, Math.min(2.3 * s, cy - ha.browY - 0.42 * s));
  const earY = ha.earR[1] - 2.3 * s * 0.9;
  return { cx, cy, dx, hw, hh, edge, earY, s };
}

// ---------------------------------------------------------------------------------------------------------------
// formas de lente (local)
// ---------------------------------------------------------------------------------------------------------------

/** superelipse (n = 2 elipse, n alto = retângulo arredondado); `f` deforma cada ponto */
function superE(w: number, h: number, n: number, f?: (x: number, y: number) => Pt2, N = 26): SP[] {
  const out: SP[] = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    const x = w * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
    const y = h * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / n);
    out.push(f ? f(x, y) : [x, y]);
  }
  return out;
}

function circleShape(r: number): SP[] {
  return superE(r, r, 2, undefined, 22);
}

/** wayfarer: mais larga em cima, canto de fora mais alto */
function wayfarer(w: number, h: number): SP[] {
  return superE(w, h, 3.4, (x, y) => [x * (1 + 0.1 * (-y / h)), y < 0 ? y - 0.14 * h * (x / w) : y - 0.04 * h * (x / w)]);
}

/** aviador: topo quase reto, gota funda puxada pro nariz */
function aviatorShape(w: number, h: number): SP[] {
  return [
    [0.98 * w, -0.7 * h],
    [0.97 * w, 0.02 * h],
    [0.66 * w, 0.74 * h],
    [0.06 * w, 1.05 * h],
    [-0.52 * w, 0.86 * h],
    [-0.9 * w, 0.26 * h],
    [-0.99 * w, -0.5 * h],
    [-0.66 * w, -0.9 * h],
    [0.05 * w, -0.97 * h],
    [0.7 * w, -0.92 * h],
  ];
}

/** gatinho: canto de fora de cima puxado pra cima e pra fora */
function catShape(w: number, h: number): SP[] {
  return superE(w, h * 0.9, 2.5, (x, y) => {
    const ux = Math.max(0, x / w);
    const uy = Math.max(0, -y / h);
    return [x + 0.3 * w * ux * ux * ux * uy, y - 0.85 * h * Math.pow(ux, 3.2) * Math.min(1, uy + 0.2)];
  });
}

/** meia-lua: topo reto, metade de baixo de elipse */
function halfMoon(w: number, h: number): SP[] {
  const out: SP[] = [];
  const N = 11;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI;
    out.push([Math.cos(a) * w, Math.sin(a) * h]);
  }
  // cantos de cima levemente arredondados e topo um tico arqueado
  out[0] = [w, 0, 0.4];
  out[N] = [-w, 0, 0.4];
  out.push([-0.4 * w, -0.06 * h], [0.4 * w, -0.06 * h]);
  return out;
}

/** coração (gira levemente pra fora) */
function heartShape(w: number, h: number): SP[] {
  const out: SP[] = [];
  const N = 24;
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
    const X = (x / 16) * w;
    const Y = ((y + 2.5) / 14.5) * h;
    out.push(i === 0 ? [X, Y, 0.2] : i === N / 2 ? [X, Y, 0.35] : [X, Y]);
  }
  return out;
}

/** estrela de 5 pontas com as pontas arredondadas */
function starShape(r: number, inner = 0.52): SP[] {
  const out: SP[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * inner : r;
    out.push([Math.cos(a) * rr, Math.sin(a) * rr, i % 2 ? 0.55 : 0.18]);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// geometria
// ---------------------------------------------------------------------------------------------------------------

function area(pts: readonly SP[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** desloca o contorno pra fora por d(ponto) (espessura variável do aro) */
function offsetVar(pts: readonly SP[], d: (p: SP) => number): SP[] {
  const n = pts.length;
  const sg = area(pts) > 0 ? 1 : -1;
  return pts.map((p, i) => {
    const a = pts[(i - 1 + n) % n];
    const b = pts[(i + 1) % n];
    let tx = b[0] - a[0];
    let ty = b[1] - a[1];
    const L = Math.hypot(tx, ty) || 1;
    tx /= L;
    ty /= L;
    const k = d(p);
    const q: Pt2 = [p[0] + ty * k * sg, p[1] - tx * k * sg];
    return p.length > 2 ? ([q[0], q[1], p[2] as number] as SP) : q;
  });
}

/** maior trecho contínuo (com volta) de pontos que satisfazem `pred`, como linha aberta */
function runWhere(pts: readonly SP[], pred: (p: SP, i: number) => boolean): SP[] {
  const n = pts.length;
  let start = -1;
  for (let i = 0; i < n; i++) if (pred(pts[i], i) && !pred(pts[(i - 1 + n) % n], (i - 1 + n) % n)) start = i;
  if (start < 0) return pred(pts[0], 0) ? [...pts, pts[0]] : [];
  const out: SP[] = [];
  for (let j = 0; j < n; j++) {
    const i = (start + j) % n;
    if (!pred(pts[i], i)) break;
    out.push([pts[i][0], pts[i][1]]);
  }
  return out;
}

const shiftPts = (pts: readonly SP[], dx: number, dy: number): SP[] => pts.map((p) => (p.length > 2 ? ([p[0] + dx, p[1] + dy, p[2] as number] as SP) : ([p[0] + dx, p[1] + dy] as SP)));

// ---------------------------------------------------------------------------------------------------------------
// armação genérica
// ---------------------------------------------------------------------------------------------------------------

interface FrameMat {
  kind: 'acetate' | 'metal' | 'clear';
  /** acetato: tons; metal: paradas */
  t?: Tones;
  stops?: readonly AvatarStop[];
  /** força do brilho especular (0..1) */
  gloss?: number;
  /** opacidade do aro (acetato cristal) */
  o?: number;
  /** casco de tartaruga */
  tortoise?: boolean;
  /** glitter (pontinhos de luz no aro) */
  glitter?: boolean;
}

interface LensSpec {
  /** cor da lente clara (opacidade `o`) */
  tint?: string;
  o?: number;
  /** gradiente vertical (lente escura/colorida), paradas com opacidade */
  stops?: readonly AvatarStop[];
  /** força dos reflexos (0..1) */
  refl?: number;
  /** lente escura: sombra colorida na bochecha e reflexo de horizonte */
  dark?: boolean;
}

interface PairSpec {
  /** contorno da lente (local, x pra fora) */
  shape: SP[];
  /** espessura do aro (avatar) e extra por ponto (local) */
  th: number;
  extra?: (p: SP) => number;
  mat: FrameMat;
  lens: LensSpec;
  bridge: 'key' | 'bar' | 'double' | 'none';
  pads?: boolean;
  rivets?: boolean;
  /** desloca o centro das lentes (avatar) */
  dy?: number;
  /** meia-distância própria entre lentes (padrão eb.dx) */
  dx?: number;
  /** só a lente da direita da tela (monóculo) */
  only?: 'R';
  /** largura da haste (padrão ~th) */
  temple?: number;
  /** hastes: altura da dobradiça (fração de h, negativo = acima do centro) */
  hingeY?: number;
}

interface LensOut {
  side: 1 | -1;
  inner: SP[];
  outer: SP[];
  lensD: string;
  ringD: string;
  box: { x: number; y: number; w: number; h: number };
  /** local → avatar */
  W: (p: SP) => SP;
}

function frameGrad(b: { x: number; y: number; w: number; h: number }, m: FrameMat): AvatarGradient {
  if (m.kind !== 'acetate') return metalGrad(b, m.stops ?? GOLD_STOPS);
  const t = m.t as Tones;
  return {
    t: 'l',
    x1: b.x,
    y1: b.y,
    x2: b.x + b.w * 0.55,
    y2: b.y + b.h * 1.1,
    s: [
      [0, t.lighter],
      [0.3, t.base],
      [0.75, t.base],
      [1, t.shade],
    ],
  };
}

function frameMid(m: FrameMat): string {
  if (m.kind !== 'acetate') return (m.stops ?? GOLD_STOPS)[1][1];
  return (m.t as Tones).base;
}

function drawPair(ctx: LayerCtx, hf: HeadFrame, eb: EyeBox, p: PairSpec): LensOut[] {
  const s = eb.s;
  const lite = hf.lite;
  const th = lite ? Math.max(p.th, p.mat.kind === 'metal' ? 0.56 : 0.74) : p.th;
  const dx = p.dx ?? eb.dx;
  const cy = eb.cy + (p.dy ?? 0);
  const ys = p.shape.map((q) => q[1]);
  const hTop = -Math.min(...ys);
  const hBot = Math.max(...ys);
  const wOut = Math.max(...p.shape.map((q) => q[0]));
  const thick = (q: SP): number => (p.mat.kind === 'clear' ? 0 : th + (p.extra ? p.extra(q) : 0));
  const sides: (1 | -1)[] = p.only ? [1] : [-1, 1];
  const lenses: LensOut[] = sides.map((side) => {
    const ox = eb.cx + side * dx;
    const W = (q: SP): SP => (q.length > 2 ? [ox + side * q[0], cy + q[1], q[2] as number] : [ox + side * q[0], cy + q[1]]);
    const outerL = offsetVar(p.shape, thick);
    const inner = p.shape.map(W);
    const outer = outerL.map(W);
    const lensD = smoothPath(inner, true);
    const outD = smoothPath(outer, true);
    return { side, inner, outer, lensD, ringD: outD + lensD, box: boxOf(outer), W };
  });
  const head = hf.head;
  const mid = frameMid(p.mat);

  // 1. sombra da armação na pele (recortada na cabeça) e, na lente escura, a sombra colorida na bochecha
  let sh = '';
  for (const L of lenses) sh += smoothPath(shiftPts(L.outer, 0.15 * s, 0.6 * s), true);
  if (p.mat.kind !== 'clear') ctx.stroke(sh, SHADOW, Math.max(0.45, th * 1.15), { o: lite ? 0.14 : 0.2, cp: head, b: 0.5 });
  if (p.lens.dark) {
    let ls = '';
    for (const L of lenses) ls += smoothPath(shiftPts(L.inner, 0.2 * s, 0.75 * s), true);
    ctx.push(ls, SHADOW, { o: 0.1, cp: head, b: 0.7 });
  }

  // 2. hastes: da dobradiça (canto de fora) até a orelha; somem quando a lente já passa da cabeça
  const tw = p.temple ?? Math.max(0.32, th * 0.85);
  const hy = (p.hingeY ?? -0.42) * (p.hingeY != null && p.hingeY > 0 ? hBot : hTop);
  const earX = hf.headX(eb.earY) - eb.cx + 0.2 * s;
  for (const L of lenses) {
    if (p.only) break;
    const hinge = L.W([wOut + th * 0.3, hy]);
    const endX = eb.cx + L.side * earX;
    if ((endX - hinge[0]) * L.side < 0.3 * s) continue;
    const spine: SP[] = [hinge, [endX, eb.earY]];
    const d = taperPath(spine, [tw, tw * 0.72], { n: 4 });
    const b = boxOf(spine);
    ctx.push(d, mid, { gf: frameGrad({ x: b.x, y: b.y - tw, w: b.w + 0.01, h: b.h + tw * 2 }, p.mat) });
    if (!lite) ctx.push(taperPath(shiftPts(spine, 0, tw * 0.55), [tw * 0.5, tw * 0.4], { n: 4 }), SHADOW, { o: 0.22, cp: head, b: 0.3 });
  }

  // 3. lentes: tinta (ou gradiente), reflexo diagonal, borda da lente e brilho
  for (const L of lenses) {
    const b = boxOf(L.inner);
    if (p.lens.stops) ctx.push(L.lensD, p.lens.tint ?? '#20242E', { gf: { t: 'l', x1: b.x + b.w * 0.5, y1: b.y, x2: b.x + b.w * 0.5, y2: b.y + b.h, s: p.lens.stops } });
    else ctx.push(L.lensD, p.lens.tint ?? '#E4F0FF', { o: p.lens.o ?? 0.12 });
    const r = p.lens.refl ?? 0.32;
    const band = (a: number, w: number): string => `M${(b.x + b.w * a).toFixed(2)},${(b.y + b.h + 0.2).toFixed(2)}L${(b.x + b.w * (a + 0.45)).toFixed(2)},${(b.y - 0.2).toFixed(2)}L${(b.x + b.w * (a + 0.45 + w)).toFixed(2)},${(b.y - 0.2).toFixed(2)}L${(b.x + b.w * (a + w)).toFixed(2)},${(b.y + b.h + 0.2).toFixed(2)}Z`;
    ctx.push(band(0.02, 0.2), '#FFFFFF', { o: r, cp: L.lensD });
    if (!lite) ctx.push(band(0.34, 0.07), '#FFFFFF', { o: r * 0.7, cp: L.lensD });
    if (p.lens.dark) ctx.push(blob(b.x + b.w * 0.55, b.y + b.h * 0.86, b.w * 0.5, b.h * 0.16, -0.08), '#A9C1E2', { o: 0.2, cp: L.lensD, ...(lite ? {} : { b: 0.35 }) });
    if (!lite) ctx.stroke(smoothPath(runWhere(L.inner, (q) => q[1] > cy + hBot * 0.1), false), '#FFFFFF', 0.2 * s, { o: 0.22, cp: L.lensD });
    ctx.push(blob(b.x + b.w * 0.27, b.y + b.h * 0.24, (lite ? 0.36 : 0.3) * s, (lite ? 0.24 : 0.19) * s, -0.5), '#FFFFFF', { o: p.lens.dark ? 0.75 : 0.85 });
  }

  // 4. ponte
  if (p.bridge !== 'none' && lenses.length === 2) {
    const [A, B] = lenses;
    const innerAt = (L: LensOut, fy: number): SP => {
      // ponto da borda de dentro do aro na altura fy·h
      const y = cy + fy * hTop;
      let best = L.outer[0];
      let bd = Infinity;
      for (const q of L.outer) {
        const sc = Math.abs(q[1] - y) + Math.max(0, (q[0] - eb.cx) * L.side) * 0.6;
        if (sc < bd && (q[0] - eb.cx) * L.side < dx) {
          bd = sc;
          best = q;
        }
      }
      return [best[0] - L.side * th * 0.35, best[1]];
    };
    const bw = p.bridge === 'key' ? th * 1.05 : Math.max(0.3, th * 0.8);
    const lift = p.bridge === 'key' ? 0.5 : 0.55;
    const spine: SP[] = [innerAt(A, -0.38), [eb.cx, cy - hTop * lift - 0.12 * s], innerAt(B, -0.38)];
    const d = taperPath(spine, [bw, bw * 0.82, bw], { n: 7 });
    ctx.stroke(smoothPath(shiftPts(spine, 0.12 * s, 0.55 * s), false), SHADOW, bw, { o: lite ? 0.12 : 0.18, cp: head, b: 0.4 });
    const bb = boxOf(spine);
    ctx.push(d, mid, { gf: frameGrad({ x: bb.x, y: bb.y - bw, w: bb.w, h: bb.h + bw * 2 }, p.mat), ...(p.mat.o ? { o: p.mat.o } : {}) });
    if (p.bridge === 'double') {
      const top: SP[] = [innerAt(A, -0.95), [eb.cx, cy - hTop * 1.0 - 0.05 * s], innerAt(B, -0.95)];
      ctx.push(taperPath(top, [bw * 0.9, bw * 0.8, bw * 0.9], { n: 7 }), mid, { gf: frameGrad(boxOf(top), p.mat) });
    }
    if (!lite) ctx.stroke(smoothPath(shiftPts(spine, 0, -bw * 0.22), false), '#FFFFFF', bw * 0.26, { o: 0.45 * (p.mat.gloss ?? 0.6), cp: d });
  }

  // 5. aros
  for (const L of lenses) {
    if (p.mat.kind === 'clear') {
      // sem aro: só a lapidação da borda (luz em cima à esquerda, escuro embaixo à direita)
      ctx.stroke(smoothPath(runWhere(L.inner, (q) => q[1] < cy - hTop * 0.15 || (q[0] - eb.cx) * L.side < dx - wOut * 0.5), false), '#FFFFFF', 0.24 * s, { o: lite ? 0.55 : 0.6 });
      ctx.stroke(smoothPath(runWhere(L.inner, (q) => q[1] > cy + hBot * 0.2), false), '#4E5C72', 0.22 * s, { o: lite ? 0.45 : 0.4 });
      continue;
    }
    const g = frameGrad(L.box, p.mat);
    ctx.push(L.ringD, mid, { r: 'evenodd', gf: g, ...(p.mat.o ? { o: p.mat.o } : {}) });
    if (p.mat.tortoise && !lite) {
      // casco: manchas macias e irregulares (escuras grandes, âmbar translúcido menor), nunca bolinha
      speckle(ctx, L.box, '#2A1205', { n: 20, r: [0.3 * s, 0.62 * s], seed: L.side > 0 ? 7 : 19, o: 0.5, cp: L.ringD, b: 0.22 });
      speckle(ctx, L.box, '#F0B060', { n: 14, r: [0.18 * s, 0.4 * s], seed: L.side > 0 ? 3 : 23, o: 0.38, cp: L.ringD, b: 0.18 });
    }
    if (p.mat.glitter && !lite) fleck(ctx, hf, L.ringD, L.box, '#FFFFFF', { n: 22, r: 0.12 * s, seed: L.side > 0 ? 5 : 9, op: 0.8 });
    // brilho especular no arco de cima (meio do aro) e escuro no de baixo
    const midRing = offsetVar(p.shape, (q) => thick(q) * 0.5).map(L.W);
    const gl = p.mat.gloss ?? 0.6;
    if (gl > 0) ctx.stroke(smoothPath(runWhere(midRing, (q) => q[1] < cy - hTop * 0.35), false), '#FFFFFF', Math.max(0.12, th * 0.3), { o: (lite ? 0.35 : 0.55) * gl, cp: L.ringD });
    if (!lite) ctx.stroke(smoothPath(runWhere(midRing, (q) => q[1] > cy + hBot * 0.3), false), SHADOW, th * 0.35, { o: 0.25, cp: L.ringD });
  }

  // 6. plaquetas, rebites e o ponto de luz
  if (!lite && p.pads && lenses.length === 2) {
    let pad = '';
    let arm = '';
    for (const sd of [-1, 1]) {
      const px = eb.cx + sd * 0.68 * s;
      const py = cy + hBot * 0.05;
      pad += blob(px, py, 0.26 * s, 0.46 * s, sd * 0.25);
      arm += `M${(eb.cx + sd * 1.0 * s).toFixed(2)},${(cy - hTop * 0.42).toFixed(2)}Q${(px + sd * 0.1 * s).toFixed(2)},${(py - 0.9 * s).toFixed(2)} ${px.toFixed(2)},${(py - 0.4 * s).toFixed(2)}`;
    }
    ctx.stroke(arm, mid, 0.14 * s, { o: 0.9 });
    ctx.push(pad, '#EEF5FF', { o: 0.5 });
  }
  if (!lite && p.rivets) {
    let rv = '';
    for (const L of lenses) {
      const [x, y] = L.W([wOut * 0.8, -hTop * 0.62]);
      rv += blob(x, y, 0.17 * s, 0.17 * s);
    }
    ctx.push(rv, '#E9EDF5', { o: 0.9 });
  }
  return lenses;
}

// ---------------------------------------------------------------------------------------------------------------
// os óculos
// ---------------------------------------------------------------------------------------------------------------

const ACETATE_BLACK = tones('#17161C');

function round(ctx: LayerCtx, hf: HeadFrame): void {
  const eb = eyeBox(hf);
  const r = Math.min(eb.hw * 0.98, eb.hh * 1.25);
  drawPair(ctx, hf, eb, { shape: circleShape(r), th: 0.58 * eb.s, mat: { kind: 'acetate', t: tones('#7A4520'), tortoise: true, gloss: 0.55 }, lens: {}, bridge: 'key', rivets: true });
}

function square(ctx: LayerCtx, hf: HeadFrame): void {
  const eb = eyeBox(hf);
  drawPair(ctx, hf, eb, {
    shape: superE(eb.hw, eb.hh * 0.94, 4.2),
    th: 0.64 * eb.s,
    extra: (q) => (q[1] < 0 ? 0.16 * eb.s * Math.min(1, -q[1] / eb.hh) : 0),
    mat: { kind: 'acetate', t: ACETATE_BLACK, gloss: 0.3 },
    lens: {},
    bridge: 'key',
    rivets: true,
  });
}

function sun(ctx: LayerCtx, hf: HeadFrame): void {
  const eb = eyeBox(hf);
  drawPair(ctx, hf, eb, {
    shape: wayfarer(eb.hw * 1.04, eb.hh * 1.08),
    th: 0.68 * eb.s,
    extra: (q) => (q[1] < 0 ? 0.3 * eb.s * Math.min(1, -q[1] / eb.hh) : 0),
    mat: { kind: 'acetate', t: tones('#101014'), gloss: 0.85 },
    lens: { dark: true, refl: 0.22, stops: [[0, '#0B0D13', 0.96], [0.55, '#1A212D', 0.92], [1, '#3A4659', 0.86]] },
    bridge: 'key',
    rivets: true,
    dy: 0.1 * eb.s,
  });
}

function aviator(ctx: LayerCtx, hf: HeadFrame): void {
  const eb = eyeBox(hf);
  const w = Math.min(eb.hw * 1.08, eb.dx - 0.55 * eb.s);
  drawPair(ctx, hf, eb, {
    shape: aviatorShape(w, eb.hh * 1.22),
    th: 0.3 * eb.s,
    mat: { kind: 'metal', stops: GOLD_STOPS, gloss: 0.9 },
    lens: { dark: true, refl: 0.26, stops: [[0, '#2E1A12', 0.94], [0.5, '#6E4128', 0.8], [1, '#C8925C', 0.6]] },
    bridge: 'double',
    pads: true,
    dy: 0.3 * eb.s,
    temple: 0.3 * eb.s,
    hingeY: -0.7,
  });
}

function reading(ctx: LayerCtx, hf: HeadFrame): void {
  const eb = eyeBox(hf);
  const s = eb.s;
  const w = eb.hw * 0.92;
  const h = 1.75 * s;
  // na pontinha do nariz: o topo reto fica logo abaixo da pupila
  const dy = hf.ha.eyeR[1] + 0.62 * s - eb.cy;
  const lenses = drawPair(ctx, hf, eb, { shape: halfMoon(w, h), th: 0.32 * s, mat: { kind: 'metal', stops: GUNMETAL, gloss: 0.8 }, lens: { o: 0.1 }, bridge: 'bar', pads: true, dy, temple: 0.28 * s, hingeY: -0.02 });
  // cordinha de contas: das pontas das hastes até abaixo da mandíbula, por trás do pescoço
  if (!hf.lite) {
    const chinY = hf.ha.chin[1];
    const nk = ctx.an.w.neck;
    for (const L of lenses) {
      // cai da ponta da haste por trás da mandíbula e some atrás do pescoço
      const x0 = eb.cx + L.side * (hf.headX(eb.earY) - eb.cx + 0.1 * s);
      const pts: SP[] = [[x0, eb.earY + 0.2 * s], [x0 + L.side * 0.45 * s, eb.earY + 3.6 * s], [eb.cx + L.side * (nk + 1.3 * s), chinY + 0.6 * s], [eb.cx + L.side * nk * 0.9, chinY + 3.4 * s]];
      const d = smoothPath(pts, false);
      ctx.stroke(d, '#7A5A1E', 0.3 * s, { o: 0.75, da: [0.3 * s, 0.22 * s], c: 'round' });
      ctx.stroke(d, '#F2D78A', 0.16 * s, { o: 0.9, da: [0.12 * s, 0.4 * s], c: 'round' });
    }
  }
}

function catEye(ctx: LayerCtx, hf: HeadFrame): void {
  const eb = eyeBox(hf);
  const s = eb.s;
  const w = eb.hw * 1.02;
  const h = eb.hh;
  const lenses = drawPair(ctx, hf, eb, {
    shape: catShape(w, h),
    th: 0.5 * s,
    extra: (q) => 0.7 * s * Math.pow(Math.max(0, q[0] / w), 2) * Math.min(1, Math.max(0, -q[1] / h + 0.1)),
    mat: { kind: 'acetate', t: tones('#3A0E1C'), gloss: 0.75 },
    lens: {},
    bridge: 'key',
    hingeY: -0.55,
  });
  // strass dourado na pontinha
  for (const L of lenses) {
    const tip = L.W([w * 1.12, -h * 1.12]);
    gem(ctx, hf, tip[0], tip[1], (hf.lite ? 0.34 : 0.28) * s, '#FFD36A', { glint: !hf.lite });
  }
}

function rimless(ctx: LayerCtx, hf: HeadFrame): void {
  const eb = eyeBox(hf);
  const s = eb.s;
  const w = eb.hw * 0.96;
  const h = eb.hh * 0.88;
  const lenses = drawPair(ctx, hf, eb, { shape: superE(w, h, 3.1), th: 0.3 * s, mat: { kind: 'clear', stops: SILVER_STOPS, gloss: 0.8 }, lens: { o: 0.14, refl: 0.36 }, bridge: 'bar', pads: true, temple: 0.26 * s });
  // ponteiras de metal presas na lente (dobradiça) e a ponte presa por parafuso
  let bits = '';
  for (const L of lenses) {
    const [x, y] = L.W([w * 0.92, -h * 0.4]);
    bits += blob(x + L.side * 0.25 * s, y, 0.42 * s, 0.26 * s);
  }
  ctx.push(bits, '#C9CFDA', { gf: metalGrad(boxOf(lenses.flatMap((L) => [L.W([w, -h * 0.7]), L.W([w, -h * 0.1])])), SILVER_STOPS) });
}

function big(ctx: LayerCtx, hf: HeadFrame): void {
  const eb = eyeBox(hf);
  const s = eb.s;
  const w = Math.min(eb.hw * 1.3, eb.dx - 0.5 * s);
  const h = eb.hh * 1.42;
  drawPair(ctx, hf, eb, {
    shape: superE(w, h, 3.3, (x, y) => [x * (1 + 0.06 * (-y / h)), y]),
    th: 0.8 * s,
    mat: { kind: 'acetate', t: tones('#F0488F'), gloss: 0.9, o: 0.94 },
    lens: { stops: [[0, '#FFB0D2', 0.24], [1, '#FFFFFF', 0.06]], refl: 0.34 },
    bridge: 'key',
    dy: -0.25 * s,
    hingeY: -0.5,
  });
}

function roundGold(ctx: LayerCtx, hf: HeadFrame): void {
  const eb = eyeBox(hf);
  const r = Math.min(eb.hw * 1.0, eb.hh * 1.28);
  const lenses = drawPair(ctx, hf, eb, { shape: circleShape(r), th: 0.28 * eb.s, mat: { kind: 'metal', stops: GOLD_STOPS, gloss: 1 }, lens: { o: 0.1, refl: 0.36 }, bridge: 'bar', pads: true, temple: 0.26 * eb.s, hingeY: -0.3 });
  // filete interno (aro duplo de ourives)
  if (!hf.lite) for (const L of lenses) ctx.stroke(L.lensD, '#8A5A0C', 0.1 * eb.s, { o: 0.6 });
}

function heart(ctx: LayerCtx, hf: HeadFrame): void {
  const eb = eyeBox(hf);
  const s = eb.s;
  const w = Math.min(eb.hw * 1.04, eb.dx - 0.5 * s);
  drawPair(ctx, hf, eb, {
    shape: heartShape(w, eb.hh * 1.32),
    th: 0.5 * s,
    mat: { kind: 'acetate', t: tones('#D81B4E'), gloss: 0.9 },
    lens: { stops: [[0, '#C2185B', 0.86], [1, '#FF7AB0', 0.62]], refl: 0.3, dark: true },
    bridge: 'key',
    dy: -0.1 * s,
    hingeY: -0.35,
  });
}

function star(ctx: LayerCtx, hf: HeadFrame): void {
  const eb = eyeBox(hf);
  const s = eb.s;
  const r = Math.min(eb.dx * 0.86, eb.hh * 1.6);
  const lenses = drawPair(ctx, hf, eb, {
    shape: starShape(r),
    th: 0.44 * s,
    mat: { kind: 'metal', stops: GOLD_STOPS, gloss: 0.9, glitter: true },
    lens: { stops: [[0, '#9B2CFF', 0.8], [0.6, '#FF1493', 0.66], [1, '#FF8AC8', 0.5]], refl: 0.3, dark: true },
    bridge: 'bar',
    dy: -0.1 * s,
    hingeY: -0.1,
  });
  // brilho de estrela na ponta de cima de uma das lentes
  const tip = lenses[lenses.length - 1].W([0, -r - 0.1 * s]);
  ctx.push(sparkle(tip[0] + 0.5 * s, tip[1] + 0.1 * s, (hf.lite ? 0.9 : 0.75) * s), '#FFFFFF', { o: 0.95 });
}

function monocle(ctx: LayerCtx, hf: HeadFrame): void {
  const eb = eyeBox(hf);
  const s = eb.s;
  const r = Math.min(eb.hw * 0.98, eb.hh * 1.25);
  const [L] = drawPair(ctx, hf, eb, { shape: circleShape(r), th: 0.4 * s, mat: { kind: 'metal', stops: GOLD_STOPS, gloss: 1 }, lens: { o: 0.12, refl: 0.4 }, bridge: 'none', only: 'R' });
  // argolinha e a correntinha descendo pela bochecha até a gola
  const a = L.W([r * 0.72, r * 0.72]);
  const ring = blob(a[0] + 0.32 * s, a[1] + 0.32 * s, 0.34 * s, 0.34 * s);
  ctx.stroke(ring, '#B8860B', 0.16 * s, { o: 0.95 });
  const chinY = hf.ha.chin[1];
  const x0 = a[0] + 0.5 * s;
  const pts: SP[] = [[x0, a[1] + 0.6 * s], [x0 + 0.9 * s, a[1] + 3.6 * s], [x0 + 1.1 * s, chinY - 0.5 * s], [x0 + 0.2 * s, chinY + 4.5 * s]];
  const d = smoothPath(pts, false);
  ctx.stroke(smoothPath(shiftPts(pts, 0.15 * s, 0.4 * s), false), SHADOW, 0.3 * s, { o: 0.18, cp: hf.head, b: 0.3 });
  if (hf.lite) ctx.stroke(d, '#D9A93A', 0.3 * s, { o: 0.8 });
  else {
    ctx.stroke(d, '#8A5A0C', 0.3 * s, { da: [0.34 * s, 0.16 * s], c: 'round' });
    ctx.stroke(d, '#FFE7A0', 0.13 * s, { o: 0.9, da: [0.16 * s, 0.34 * s], c: 'round' });
  }
}

function visor(ctx: LayerCtx, hf: HeadFrame): void {
  const eb = eyeBox(hf);
  const s = eb.s;
  const { cx, cy, hh, dx } = eb;
  const ex = eb.edge + 0.35 * s;
  const top: SP[] = [[cx - ex, cy - hh * 0.55], [cx - dx, cy - hh * 1.02], [cx, cy - hh * 1.12], [cx + dx, cy - hh * 1.02], [cx + ex, cy - hh * 0.55]];
  const pts: SP[] = [
    ...top,
    [cx + ex + 0.15 * s, cy + hh * 0.15],
    [cx + dx + 1.2 * s, cy + hh * 0.95],
    [cx + 1.25 * s, cy + hh * 0.85],
    [cx, cy + hh * 0.18],
    [cx - 1.25 * s, cy + hh * 0.85],
    [cx - dx - 1.2 * s, cy + hh * 0.95],
    [cx - ex - 0.15 * s, cy + hh * 0.15],
  ];
  const d = smoothPath(pts, true);
  const b = boxOf(pts);
  ctx.stroke(smoothPath(shiftPts(pts, 0.15 * s, 0.6 * s), true), SHADOW, 0.6, { o: 0.16, cp: hf.head, b: 0.5 });
  ctx.push(d, '#7FFF00', { gf: { t: 'l', x1: cx, y1: b.y, x2: cx, y2: b.y + b.h, s: [[0, '#2E9400', 0.72], [0.55, '#7FFF00', 0.42], [1, '#D2FF9C', 0.34]] } });
  ctx.push(`M${(b.x + b.w * 0.1).toFixed(2)},${(b.y + b.h).toFixed(2)}L${(b.x + b.w * 0.24).toFixed(2)},${b.y.toFixed(2)}L${(b.x + b.w * 0.36).toFixed(2)},${b.y.toFixed(2)}L${(b.x + b.w * 0.22).toFixed(2)},${(b.y + b.h).toFixed(2)}Z`, '#FFFFFF', { o: 0.32, cp: d });
  if (!hf.lite) ctx.push(`M${(b.x + b.w * 0.55).toFixed(2)},${(b.y + b.h).toFixed(2)}L${(b.x + b.w * 0.66).toFixed(2)},${b.y.toFixed(2)}L${(b.x + b.w * 0.69).toFixed(2)},${b.y.toFixed(2)}L${(b.x + b.w * 0.58).toFixed(2)},${(b.y + b.h).toFixed(2)}Z`, '#FFFFFF', { o: 0.22, cp: d });
  // barra de cima em grafite com o tubo de neon embaixo
  const bar = taperPath(top, [0.5 * s, 0.75 * s, 0.8 * s, 0.75 * s, 0.5 * s], { n: 12 });
  const gt = tones('#2A2D36');
  ctx.push(bar, gt.base, { gf: { t: 'l', x1: cx, y1: b.y - 0.6, x2: cx, y2: b.y + 0.8, s: [[0, gt.lighter], [0.5, gt.base], [1, gt.deep]] } });
  neon(ctx, hf, smoothPath(pts.slice(5), false), '#7FFF00', 0.26 * s, { glow: 0.9 });
  ctx.push(blob(b.x + b.w * 0.24, b.y + b.h * 0.3, 0.32 * s, 0.2 * s, -0.5), '#FFFFFF', { o: 0.85 });
}

function cyber(ctx: LayerCtx, hf: HeadFrame): void {
  const eb = eyeBox(hf);
  const s = eb.s;
  const { cx, cy, hh, dx } = eb;
  const ex = eb.edge + 0.1 * s;
  const pts: SP[] = [
    [cx - ex, cy - hh * 0.7, 0],
    [cx - 1.4 * s, cy - hh * 1.0, 0],
    [cx, cy - hh * 0.82, 0],
    [cx + 1.4 * s, cy - hh * 1.0, 0],
    [cx + ex, cy - hh * 0.7, 0],
    [cx + ex - 0.25 * s, cy + hh * 0.35, 0],
    [cx + dx + 0.6 * s, cy + hh * 0.98, 0],
    [cx + 1.1 * s, cy + hh * 0.86, 0],
    [cx, cy + hh * 0.12, 0],
    [cx - 1.1 * s, cy + hh * 0.86, 0],
    [cx - dx - 0.6 * s, cy + hh * 0.98, 0],
    [cx - ex + 0.25 * s, cy + hh * 0.35, 0],
  ];
  const d = smoothPath(pts, true);
  const b = boxOf(pts);
  ctx.stroke(smoothPath(shiftPts(pts, 0.15 * s, 0.6 * s), true), SHADOW, 0.7, { o: 0.2, cp: hf.head, b: 0.5 });
  ctx.push(d, '#1A0B2E', { gf: { t: 'l', x1: b.x, y1: b.y, x2: b.x + b.w, y2: b.y + b.h, s: [[0, '#140826', 0.9], [0.45, '#3A0F5A', 0.82], [0.8, '#0C3550', 0.8], [1, '#00B8D9', 0.7]] } });
  ctx.push(`M${(b.x + b.w * 0.06).toFixed(2)},${(b.y + b.h).toFixed(2)}L${(b.x + b.w * 0.2).toFixed(2)},${b.y.toFixed(2)}L${(b.x + b.w * 0.3).toFixed(2)},${b.y.toFixed(2)}L${(b.x + b.w * 0.16).toFixed(2)},${(b.y + b.h).toFixed(2)}Z`, '#FFFFFF', { o: 0.18, cp: d });
  // HUD: retícula ciano na lente da direita, barras e marcações magenta
  const [rx, ry] = hf.ha.eyeR;
  if (!hf.lite) {
    ctx.stroke(blob(rx, ry, 1.2 * s, 1.2 * s), '#00E5FF', 0.14 * s, { o: 0.85, da: [0.5 * s, 0.3 * s], c: 'butt' });
    ctx.stroke(`M${(rx - 1.8 * s).toFixed(2)},${ry.toFixed(2)}h${(0.9 * s).toFixed(2)}M${(rx + 0.9 * s).toFixed(2)},${ry.toFixed(2)}h${(0.9 * s).toFixed(2)}M${rx.toFixed(2)},${(ry - 1.7 * s).toFixed(2)}v${(0.7 * s).toFixed(2)}`, '#00E5FF', 0.14 * s, { o: 0.8 });
    const [lx, ly] = hf.ha.eyeL;
    let bars = '';
    for (let i = 0; i < 4; i++) bars += `M${(lx - 1.6 * s + i * 0.55 * s).toFixed(2)},${(ly + 1.1 * s).toFixed(2)}v${(-(0.4 + i * 0.25) * s).toFixed(2)}`;
    ctx.stroke(bars, '#FF1493', 0.28 * s, { o: 0.9, c: 'butt' });
    ctx.stroke(`M${(lx - 1.7 * s).toFixed(2)},${(ly - 1.2 * s).toFixed(2)}h${(2.2 * s).toFixed(2)}`, '#FF1493', 0.14 * s, { o: 0.75, da: [0.35 * s, 0.2 * s], c: 'butt' });
  } else ctx.stroke(`M${(rx - 1 * s).toFixed(2)},${ry.toFixed(2)}h${(2 * s).toFixed(2)}`, '#00E5FF', 0.3, { o: 0.7 });
  neon(ctx, hf, d, '#FF1493', 0.26 * s, { glow: 0.85 });
  // módulo na têmpora com LED
  const mx = cx + ex - 0.1 * s;
  const mod = smoothPath([[mx - 0.2 * s, cy - hh * 0.75, 0.4], [mx + 1.0 * s, cy - hh * 0.6, 0.4], [mx + 1.0 * s, cy + hh * 0.05, 0.4], [mx - 0.2 * s, cy + hh * 0.2, 0.4]], true);
  const gt = tones('#22242E');
  ctx.push(mod, gt.base, { gf: { t: 'l', x1: mx, y1: cy - hh, x2: mx + 1, y2: cy + hh * 0.3, s: [[0, gt.lighter], [0.5, gt.base], [1, gt.deep]] } });
  ctx.push(blob(mx + 0.45 * s, cy - hh * 0.3, 0.26 * s, 0.26 * s), '#00E5FF', {});
  if (!hf.lite) ctx.push(blob(mx + 0.45 * s, cy - hh * 0.3, 0.7 * s, 0.7 * s), '#00E5FF', { o: 0.35, b: 0.5 });
}

export const GLASSES: Record<string, GlassesFn> = {
  round,
  square,
  sun,
  aviator,
  visor,
  reading,
  cat_eye: catEye,
  rimless,
  big,
  round_gold: roundGold,
  heart,
  star,
  monocle,
  cyber,
};
