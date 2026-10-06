// Calçados: tênis, cano alto, bota, sandália, tênis neon, mocassim, sapato social, sapatilha, salto, coturno, bota
// texana, chinelo, plataforma, patins, sapatinho de cristal e botas antigravidade. Dono: guarda-roupa (parte de baixo).
//
// Tudo sai do pé 3D da anatomia (footFrame/footHull: de frente, um pouco de cima, girado pra fora conforme a perna),
// no grupo da canela. Materiais com valores separados (STYLE.md §4): sola, entressola, cabedal, biqueira, contraforte.
// Salto e cristal giram o pé na bola (o calcanhar sobe) com um projetor próprio. Canos altos seguem a canela.
// Calçado aberto (sandália, chinelo, salto, sapatilha, cristal, plataforma) desenha o pé descalço por baixo.
// Depois de cada pé, a barra da calça comprida é redesenhada por cima (pantHemOverShoe) ou franze em cima do cano alto.

import { footFrame, footHull, legAxis, limbWidthAt, shinPath, smoothPath, taperPath, type FootFrame, type Side, type SP } from '../anatomy';
import type { LayerCtx } from '../ctx';
import { ellipse } from '../geometry';
import { blob, cylGradient, isLite, lodCtx, lum, mix, saturate, starPath } from '../shading';
import type { AvatarGradient, Pt } from '../types';

import { tonesOf } from './body';
import { pantBlouseOverShaft, pantHemOverShoe } from './lower-bottoms';
import { LONG_PANTS, SIDES, bbox, fabric, leatherTones, lowerKind, shinG, threadOf, type Tones } from './lower-common';

type Proj = (u: number, v: number, h: number) => Pt;

/** contexto de um pé */
interface SC {
  ctx: LayerCtx;
  s: Side;
  fr: FootFrame;
  P: Proj;
  lite: boolean;
  /** lado de fora na tela */
  sg: number;
  c: string;
  t: Tones;
}

const hp = (pts: Pt[]): string => smoothPath(pts, true);

/** pé com o calcanhar erguido (salto): gira na bola do pé; `k` = quanto sobe por unidade atrás da bola */
function liftFrame(fr: FootFrame, k: number, vb = 8): FootFrame {
  return { ...fr, P: (u, v, h) => fr.P(u, v, h + Math.max(0, vb - v) * k) };
}

// ---------------------------------------------------------------------------------------------------------------
// entrada
// ---------------------------------------------------------------------------------------------------------------

/** 6c. calçados (grupo da canela de cada lado) */
export function drawShoes(ctx: LayerCtx): void {
  ctx = lodCtx(ctx);
  const id = ctx.cfg.shoes;
  const fn = SHOES[id] ?? sneakers;
  for (const s of SIDES) {
    ctx.withGroup(shinG(s), () => {
      const fr = footFrame(ctx.an, s);
      const t = fabric(ctx.col.shoes);
      fn({ ctx, s, fr, P: fr.P, lite: isLite(ctx), sg: s === 'L' ? -1 : 1, c: ctx.col.shoes, t });
    });
  }
}

/** depois do calçado: barra da calça por cima (recortada no calçado pra sombra) */
function hem(sc: SC, clip: string): void {
  pantHemOverShoe(sc.ctx, sc.s, clip);
}

const pantsOn = (ctx: LayerCtx): boolean => LONG_PANTS.has(lowerKind(ctx.cfg)) && lowerKind(ctx.cfg) !== 'leggings';
/** a calça (ou legging) cobre o tornozelo: nada de pele/meia por cima dela */
const ankleCovered = (ctx: LayerCtx): boolean => LONG_PANTS.has(lowerKind(ctx.cfg));

// ---------------------------------------------------------------------------------------------------------------
// peças comuns
// ---------------------------------------------------------------------------------------------------------------

/** pé descalço (pele) com tornozelo, peito do pé com luz, maléolo, dedos separados e unhas */
function bareFoot(sc: SC, fr: FootFrame = sc.fr, o: { stub?: boolean; toes?: boolean } = {}): string {
  const { ctx, s, lite } = sc;
  const { an } = ctx;
  const sk = tonesOf(ctx);
  const P = fr.P;
  const ax = legAxis(an, s);
  const skinGrad = cylGradient(ax.a, ax.b, ax.wl, ax.wr, { light: sk.light, base: sk.base, shade: sk.shade, bounce: mix(sk.shade, sk.bounce, 0.45) });
  // tornozelo (a pele da canela pode não existir: calça comprida por cima)
  if (o.stub !== false && !ankleCovered(ctx)) ctx.push(shinPath(an, s, { from: 0.8, endExt: 1.6 }), sk.base, { gf: skinGrad });
  const pts = footHull(fr, { ease: 0.05 });
  const d = hp(pts);
  const b = bbox(pts);
  const top = P(0.1, 4.8, fr.top(4.8));
  ctx.push(d, sk.base, { gf: { t: 'r', cx: top[0] - sc.sg * 0.4, cy: top[1], r: Math.max(b.w, b.h) * 0.85, fx: top[0] - sc.sg * 0.6, fy: top[1] - 0.4, s: [[0, sk.lighter], [0.4, sk.light], [0.78, sk.base], [1, sk.shade]] } });
  // lado de dentro (arco) na sombra e contato com o chão
  const inner = P(-(fr.inner(5) + 0.1), 5.0, 1.0);
  ctx.push(blob(inner[0], inner[1], 0.9 * fr.s, 2.0 * fr.s), sk.deep, { o: 0.35, b: lite ? 0 : 0.6, cp: d });
  // maléolo (osso do tornozelo) do lado de fora
  if (!lite) {
    const mal = P(fr.outer(2.6) * 0.75, 2.6, 3.4);
    ctx.push(blob(mal[0], mal[1], 0.55, 0.6), sk.lighter, { o: 0.35, b: 0.3, cp: d });
  }
  if (o.toes !== false) toes(sc, fr, d);
  return d;
}

/** dedos: sulcos entre os dedos, dedão destacado e unhas claras (só no completo; no lite só a unha do dedão) */
function toes(sc: SC, fr: FootFrame, clip: string): void {
  const { ctx, lite } = sc;
  const sk = tonesOf(ctx);
  const P = fr.P;
  // u, ponta (v) de cada dedo — do dedão (lado de dentro, u < 0) ao mindinho
  const T: [number, number, number][] = [
    [-1.05, 11.45, 0.62],
    [-0.12, 11.35, 0.42],
    [0.5, 11.0, 0.38],
    [1.02, 10.5, 0.34],
    [1.45, 9.9, 0.3],
  ];
  if (!lite) {
    let gro = '';
    for (let i = 0; i < T.length - 1; i++) {
      const um = (T[i][0] + T[i + 1][0]) / 2 + (i === 0 ? 0.08 : 0);
      const vt = Math.min(T[i][1], T[i + 1][1]);
      gro += taperPath([P(um, vt - 1.5, 1.0), P(um, vt - 0.35, 0.45), P(um, vt + 0.05, 0.1)], [0, 0.22, 0.3]);
    }
    ctx.push(gro, sk.deep, { o: 0.42, cp: clip });
  }
  let nails = '';
  for (const [u, v, r] of lite ? T.slice(0, 1) : T) {
    const c = P(u, v - r * 0.75, 0.95);
    nails += ellipse(c[0], c[1], r * 0.5 * fr.s, r * 0.36 * fr.s);
  }
  ctx.push(nails, mix(sk.lighter, '#FFE9E2', 0.3), { o: lite ? 0.35 : 0.45, cp: clip });
}

/** sola fina (faixa escura) + borda; devolve o path */
function sole(sc: SC, fr: FootFrame, o: { ease: number; h1: number; color: string; toe?: number; wk?: number; v0?: number }): string {
  const d = hp(footHull(fr, { ease: o.ease, h1: o.h1, toe: o.toe, wk: o.wk, v0: o.v0 }));
  sc.ctx.push(d, o.color);
  return d;
}

/** gradiente radial do cabedal: luz no peito do pé e na biqueira, sombra no calcanhar e embaixo */
function upperGrad(sc: SC, fr: FootFrame, pts: Pt[], t: Tones, o: { hi?: string; lo?: string; mid?: string } = {}): AvatarGradient {
  const b = bbox(pts);
  const toeP = fr.P(0, 10, 1.6);
  const f = fr.P(0, 7, 3);
  return {
    t: 'r',
    cx: toeP[0] - sc.sg * 0.6,
    cy: b.y + b.h / 2 - 0.4,
    r: b.w * 0.85,
    fx: f[0] - 0.6,
    fy: f[1],
    s: [
      [0, o.hi ?? t.light],
      [0.42, o.mid ?? t.base],
      [0.82, t.shade],
      [1, o.lo ?? t.deep],
    ],
  };
}

/** brilho especular de couro/verniz no bico e na lateral */
function shine(sc: SC, fr: FootFrame, clip: string, o: { o?: number; hard?: boolean; toe?: number } = {}): void {
  const { ctx, lite } = sc;
  const P = fr.P;
  const a = P(0.25, 9.4 + (o.toe ?? 0) * 0.3, 2.1);
  ctx.push(blob(a[0], a[1], 1.05 * fr.s * 0.8, 0.38 * fr.s * 0.8, sc.sg * 0.3), '#FFFFFF', { o: o.o ?? 0.55, b: lite || o.hard ? 0 : 0.25, cp: clip });
  if (lite) return;
  const side: Pt[] = [P(fr.outer(3) + 0.25, 3, 2.4), P(fr.outer(5.2) + 0.3, 5.2, 2.0), P(fr.outer(7.2) + 0.25, 7.2, 1.6)];
  ctx.push(taperPath(side, [0, 0.45, 0]), '#FFFFFF', { o: (o.o ?? 0.55) * 0.6, b: o.hard ? 0 : 0.2, cp: clip });
}

/** cano que segue a canela (bota, coturno, cano alto): bordas da canela de t0 até abaixo do tornozelo, boca curva */
function shaftPath(sc: SC, t0: number, ease: number, flare = 0.2, dip = 0.7): { d: string; topL: Pt; topR: Pt; topC: Pt } {
  const { an } = sc.ctx;
  const s = sc.s;
  const pts: SP[] = [];
  const L: Pt[] = [];
  const R: Pt[] = [];
  const n = 5;
  for (let i = 0; i <= n; i++) {
    const tt = t0 + ((1 - t0) * i) / n;
    const q = limbWidthAt(an, 'shin', s, tt);
    let lx = -q.dir[1];
    let ly = q.dir[0];
    if (lx > 0) {
      lx = -lx;
      ly = -ly;
    }
    const f = flare * (1 - (tt - t0) / (1 - t0));
    L.push([q.at[0] + lx * (q.l + ease + f), q.at[1] + ly * (q.l + ease + f)]);
    R.push([q.at[0] - lx * (q.r + ease + f), q.at[1] - ly * (q.r + ease + f)]);
  }
  const a = s === 'L' ? an.joints.ankleL : an.joints.ankleR;
  const q1 = limbWidthAt(an, 'shin', s, 1);
  const bot = a[1] + 2.4;
  const top = limbWidthAt(an, 'shin', s, t0);
  const topC: Pt = [top.at[0], top.at[1] + dip];
  pts.push([L[0][0], L[0][1], 0.3]);
  pts.push(...L.slice(1));
  pts.push([L[n][0] - 0.1, bot], [R[n][0] + 0.1, bot]);
  pts.push(...R.slice(1).reverse());
  pts.push([R[0][0], R[0][1], 0.3]);
  pts.push([(R[0][0] + topC[0]) / 2, (R[0][1] + topC[1]) / 2 + dip * 0.25], topC, [(L[0][0] + topC[0]) / 2, (L[0][1] + topC[1]) / 2 + dip * 0.25]);
  void q1;
  return { d: smoothPath(pts, true), topL: L[0], topR: R[0], topC };
}

/** gradiente de cilindro do cano (mesmo eixo da perna: o cano continua o volume da canela) */
function shaftGrad(sc: SC, t: Tones, widen: number): AvatarGradient {
  const ax = legAxis(sc.ctx.an, sc.s);
  return cylGradient(ax.a, ax.b, ax.wl + widen, ax.wr + widen, { light: t.light, base: t.base, shade: t.shade, bounce: t.bounce });
}

/** sola tratorada (coturno, bota): borracha grossa com cravos embaixo e vira costurada por cima */
function lugSole(sc: SC, o: { ease: number; h: number; color?: string; welt?: string; toe?: number }): string {
  const { ctx, fr, lite } = sc;
  const P = fr.P;
  const col = o.color ?? '#23201F';
  const d = hp(footHull(fr, { ease: o.ease + 0.25, h1: o.h, toe: o.toe }));
  const pts = footHull(fr, { ease: o.ease + 0.25, h1: o.h, toe: o.toe });
  const b = bbox(pts);
  ctx.push(d, col, { gf: { t: 'l', x1: 0, y1: b.y, x2: 0, y2: b.y + b.h, s: [[0, mix(col, '#FFFFFF', 0.18)], [0.5, col], [1, mix(col, '#000000', 0.4)]] } });
  if (!lite) {
    // cravos: entalhes verticais curtos ao longo da borda de baixo (bico e lado de fora)
    let lugs = '';
    for (let i = 0; i < 9; i++) {
      const k = -1 + (2 * i) / 8;
      const v = 7.2 + (1 - k * k) * 4.2;
      const u = k * (k < 0 ? fr.inner(v) : fr.outer(v)) * 1.05 + k * 0.3;
      const p0 = P(u, v + 0.2, 0.05);
      const p1 = P(u, v + 0.15, o.h * 0.55);
      lugs += `M${p0[0].toFixed(2)},${p0[1].toFixed(2)}L${p1[0].toFixed(2)},${p1[1].toFixed(2)}`;
    }
    ctx.stroke(lugs, '#000000', 0.32, { o: 0.45, cp: d, c: 'butt' });
  }
  // vira (faixa por cima da sola) com pesponto
  const welt = hp(footHull(fr, { ease: o.ease + 0.15, h0: o.h - 0.15, h1: o.h + 0.45, toe: o.toe }));
  ctx.push(welt, o.welt ?? mix(col, '#6A4A30', 0.4));
  if (!lite) {
    const st: Pt[] = [];
    for (let i = 0; i <= 10; i++) {
      const k = -1 + (2 * i) / 10;
      const v = 6.5 + (1 - k * k) * 5.0;
      st.push(P(k * (k < 0 ? fr.inner(v) : fr.outer(v)) * 1.06 + k * 0.32, v, o.h + 0.15));
    }
    ctx.stroke(smoothPath(st, false), '#E8D8B0', 0.16, { o: 0.7, da: [0.45, 0.35], c: 'butt', cp: welt });
  }
  return d;
}

/** cadarço cruzado com sombra e ilhoses, de v0 a v1 no peito do pé */
function laces(sc: SC, fr: FootFrame, vs: number[], o: { color?: string; eye?: string; w?: number; hOff?: number } = {}): void {
  const { ctx, lite } = sc;
  const P = fr.P;
  let lace = '';
  let laceSh = '';
  let eyes = '';
  const w = o.w ?? 1.15;
  vs.forEach((v, i) => {
    const h = fr.top(v) + (o.hOff ?? 0.36);
    const a = P(-w, v + (i % 2 ? 0.25 : -0.2), h);
    const m = P(0, v + 0.12, h + 0.14);
    const b = P(w, v + (i % 2 ? -0.2 : 0.25), h);
    lace += taperPath([a, m, b], [0.42, 0.5, 0.42], { round: true });
    laceSh += taperPath([[a[0], a[1] + 0.4], [m[0], m[1] + 0.45], [b[0], b[1] + 0.4]], [0.3, 0.36, 0.3], { round: true });
    if (!lite) eyes += ellipse(a[0], a[1], 0.24, 0.2) + ellipse(b[0], b[1], 0.24, 0.2);
  });
  if (!lite) ctx.push(laceSh, '#1A1420', { o: 0.32 });
  ctx.push(lace, o.color ?? '#F4F4F8', { o: 0.98 });
  if (eyes) ctx.push(eyes, o.eye ?? '#2A2830', { o: 0.85 });
}

// ---------------------------------------------------------------------------------------------------------------
// tênis (base comum do tênis, cano alto, tênis neon e patins)
// ---------------------------------------------------------------------------------------------------------------

interface SneakerOpts {
  /** entressola (cor) e solado */
  mid?: string;
  out?: string;
  /** entressola mais alta (tênis de corrida) */
  midH?: number;
  /** cadarço e linhas */
  lace?: string;
  laceVs?: number[];
  /** sem painel lateral (cano alto tem o próprio) */
  noPanel?: boolean;
  /** lingueta mais alta (cano alto) */
  tongueUp?: number;
}

/**
 * tênis a partir do volume 3D do pé: solado escuro fino, entressola creme com friso, cabedal na cor do tênis (couro
 * sintético com brilho macio), contraforte e colarinho do calcanhar, painel lateral, biqueira com costura em U,
 * lingueta, faixas dos ilhoses e cadarço cruzado. Sem marca. Devolve o contorno do cabedal (pra barra da calça).
 */
function sneakerBase(sc: SC, o: SneakerOpts = {}): { body: string; outerAll: string } {
  const { ctx, fr, P, lite, sg, c, t } = sc;
  const L = lum(c);
  const E = 0.8;
  const e = E / fr.s;
  const white = L > 0.75;
  const darkShoe = L < 0.06;
  const midC = o.mid ?? (white ? '#EDE4D3' : '#F2EFE8');
  const outC = o.out ?? (white ? '#9A8F80' : darkShoe ? '#2A2830' : '#4E4A54');
  const midH = o.midH ?? 1.5;
  ctx.push(hp(footHull(fr, { ease: E + 0.2, h1: 0.42 })), outC);
  const midPts = footHull(fr, { ease: E + 0.14, h0: 0.25, h1: midH });
  const mys = midPts.map((p) => p[1]);
  const mid = hp(midPts);
  ctx.push(mid, midC, { gf: { t: 'l', x1: 0, y1: Math.min(...mys), x2: 0, y2: Math.max(...mys), s: [[0, mix(midC, '#FFFFFF', 0.6)], [0.45, midC], [1, mix(midC, '#6A6070', 0.35)]] } });
  if (!lite) {
    const fl: Pt[] = [];
    const fo: Pt[] = [];
    for (let i = 0; i <= 12; i++) {
      const v = 0.6 + (10.8 * i) / 12;
      fl.push(P(-(fr.inner(v) + e + 0.1), v, midH * 0.52));
      fo.push(P(fr.outer(v) + e + 0.1, v, midH * 0.52));
    }
    ctx.stroke(smoothPath(fl, false) + smoothPath(fo, false), mix(midC, '#5A5060', 0.45), 0.16, { o: 0.55, cp: mid });
  }
  const pts = footHull(fr, { ease: E, h0: midH - 0.2 });
  const body = hp(pts);
  ctx.push(body, c, { gf: upperGrad(sc, fr, pts, t, { hi: white ? '#FFFFFF' : t.light, mid: white ? '#F1F2F6' : t.base, lo: white ? '#B9BDCB' : t.deep }) });
  const heel = hp(footHull(fr, { ease: E + 0.02, v1: 3.0, h1: 3.8 }));
  ctx.push(heel, white ? '#D8DBE4' : mix(c, '#000000', 0.2), { cp: body, o: 0.95 });
  const collar = hp(footHull(fr, { ease: E + 0.05, v1: 2.6, h0: fr.top(1.2) - 0.7 }));
  ctx.push(collar, white ? '#C7CBD7' : mix(c, '#000000', 0.32), { cp: body, o: 0.9 });
  if (!lite && !o.noPanel) {
    const side: Pt[] = [];
    for (const v of [2.2, 4.0, 5.8, 7.4]) side.push(P(fr.outer(v) + e + 0.05, v, midH + 0.1 + (v - 2.2) * 0.14));
    ctx.push(taperPath(side, [0.5, 1.0, 0.75, 0]), white ? '#C4C9D6' : mix(c, '#FFFFFF', 0.3), { o: 0.8, cp: body });
  }
  const capPts = footHull(fr, { ease: E + 0.03, v0: 9.0, h0: midH - 0.3 });
  const cap = hp(capPts);
  ctx.push(cap, white ? '#F6F7FA' : mix(c, '#FFFFFF', 0.06), { cp: body, o: 0.9 });
  if (!lite) {
    const seamU: Pt[] = [];
    for (let i = 0; i <= 8; i++) {
      const k = -1 + (2 * i) / 8;
      const u = k * (k < 0 ? fr.inner(9.1) + e : fr.outer(9.1) + e) * 0.95;
      seamU.push(P(u, 9.05 - (1 - k * k) * 0.25, midH - 0.15 + (1 - k * k) * 1.05));
    }
    ctx.stroke(smoothPath(seamU, false), white ? '#9EA3B4' : t.deep, 0.16, { o: 0.5, cp: body });
  }
  // lingueta e faixas dos ilhoses
  const tongue: Pt[] = [];
  const up = o.tongueUp ?? 0;
  const vT = [0.9, 2.0, 3.4, 4.8, 6.2, 7.4];
  for (const v of vT) tongue.push(P(-0.95, v, fr.top(v) + 0.3 + (v < 1.6 ? 0.5 + up : 0)));
  for (const v of vT.slice().reverse()) tongue.push(P(0.95, v, fr.top(v) + 0.3 + (v < 1.6 ? 0.5 + up : 0)));
  const outerAll = hp(footHull(fr, { ease: E + 0.5 }));
  ctx.push(hp(tongue), white ? '#E3E5EC' : mix(c, '#000000', 0.12), { cp: up ? undefined : outerAll });
  const stay = (g: number): Pt[] => [2.4, 3.8, 5.2, 6.6, 7.6].map((v) => P(g * 1.15, v, fr.top(v) + 0.22));
  if (!lite) ctx.push(taperPath(stay(-1), [0.5, 0.75, 0.75, 0.7, 0]) + taperPath(stay(1), [0.5, 0.75, 0.75, 0.7, 0]), white ? '#CDD1DC' : mix(c, '#000000', 0.25), { o: 0.9 });
  laces(sc, fr, o.laceVs ?? (lite ? [3.3, 5.5] : [2.9, 4.1, 5.3, 6.5]), { color: o.lace ?? (white ? '#FBFBFD' : '#F4F4F8'), eye: white ? '#7E8496' : '#2A2830' });
  // costura da entressola com o cabedal (o cabedal "senta" na sola)
  {
    const seam: Pt[] = [];
    const seamO: Pt[] = [];
    for (let i = 0; i <= 10; i++) {
      const v = 0.8 + (10.8 * i) / 10;
      seam.push(P(-(fr.inner(v) + e) * 1.02, v, midH - 0.1));
      seamO.push(P((fr.outer(v) + e) * 1.02, v, midH - 0.1));
    }
    ctx.stroke(smoothPath(seam, false) + smoothPath(seamO, false), '#0A0610', 0.5, { o: 0.22, ...(lite ? {} : { b: 0.25 }), cp: body });
  }
  if (!lite) {
    const h0 = P(0.2, 9.6, 2.2);
    ctx.push(blob(h0[0], h0[1], 1.0, 0.42, sg * 0.25), '#FFFFFF', { o: white ? 0.5 : 0.28, b: 0.35, cp: cap });
    const edge: Pt[] = [];
    for (let i = 0; i <= 8; i++) {
      const k = -1 + (2 * i) / 8;
      const v = 7.5 + (1 - k * k) * 3.6;
      edge.push(P(k * (k < 0 ? fr.inner(v) + e : fr.outer(v) + e) * 1.03, v, midH - 0.08));
    }
    ctx.stroke(smoothPath(edge, false), '#FFFFFF', 0.22, { o: 0.6, cp: mid });
  }
  return { body, outerAll };
}

function sneakers(sc: SC): void {
  const { outerAll } = sneakerBase(sc);
  hem(sc, outerAll);
}

/** cano alto: cano acolchoado acima do tornozelo, cadarço subindo pelo cano, remendo redondo no tornozelo */
function hightops(sc: SC): void {
  const { ctx, lite, c, t } = sc;
  const white = lum(c) > 0.75;
  const covered = pantsOn(ctx);
  // o cano abraça o tornozelo (não abre em funil): folga pequena e boca quase do tamanho da canela
  const sh = shaftPath(sc, 0.8, 0.8, 0.05, 0.45);
  if (!covered) {
  ctx.push(sh.d, c, { gf: shaftGrad(sc, white ? { ...t, light: '#FFFFFF', base: '#F1F2F6', shade: '#C3C7D3', deep: '#9EA3B4', bounce: '#D6D9E2' } : t, 1.2) });
  // colarinho acolchoado (rolo na boca do cano)
  const pad = smoothPath([[sh.topL[0] - 0.15, sh.topL[1] - 0.25], [sh.topC[0], sh.topC[1] - 0.5], [sh.topR[0] + 0.15, sh.topR[1] - 0.25], [sh.topR[0] + 0.05, sh.topR[1] + 0.85], [sh.topC[0], sh.topC[1] + 0.6], [sh.topL[0] - 0.05, sh.topL[1] + 0.85]], true);
  ctx.push(pad, white ? '#E6E8EE' : mix(c, '#000000', 0.18));
  ctx.push(taperPath([[sh.topL[0], sh.topL[1] + 0.95], [sh.topC[0], sh.topC[1] + 0.75], [sh.topR[0], sh.topR[1] + 0.95]], [0.4, 0.6, 0.4]), '#0A0610', { o: 0.3, b: lite ? 0 : 0.3, cp: sh.d });
  // remendo redondo do lado de fora do tornozelo (sem marca)
  const a = sc.s === 'L' ? ctx.an.joints.ankleL : ctx.an.joints.ankleR;
  const px = a[0] + sc.sg * (ctx.an.spec.ankle - 0.1);
  // remendo pequeno e meio de lado (o tornozelo é redondo: achata no sentido da curva)
  ctx.push(ellipse(px, a[1] - 0.2, 0.75, 0.95), white ? '#2A2A34' : '#ECECF2', { o: 0.85, cp: sh.d });
  if (!lite) ctx.push(ellipse(px, a[1] - 0.2, 0.42, 0.55), white ? '#E6E8EE' : mix(c, '#000000', 0.2), { o: 0.85, cp: sh.d });
  }
  const { outerAll } = sneakerBase(sc, { noPanel: false, tongueUp: covered ? 0 : 1.2 });
  // cadarço continuando pelo cano
  const top = limbWidthAt(ctx.an, 'shin', sc.s, 0.84);
  let lace = '';
  for (let i = 0; i < (lite ? 1 : 3); i++) {
    const y = top.at[1] + 0.8 + i * 1.25;
    lace += taperPath([[top.at[0] - 1.2, y - 0.2], [top.at[0], y + 0.15], [top.at[0] + 1.2, y + 0.05]], [0.38, 0.45, 0.38], { round: true });
  }
  if (!covered) ctx.push(lace, white ? '#FBFBFD' : '#F4F4F8', { o: 0.95 });
  hem(sc, outerAll);
}

/** tênis neon (corrida): cabedal de malha, entressola esculpida lima com brilho, aba refletiva no calcanhar */
function runners(sc: SC): void {
  const { ctx, fr, P, lite } = sc;
  const LIME = '#7FFF00';
  const { body, outerAll } = sneakerBase(sc, { mid: LIME, out: '#14161A', midH: 1.9, noPanel: true });
  // brilho da entressola (luz própria) e malha
  if (!lite) {
    const glow = hp(footHull(fr, { ease: 1.1, h0: 0.2, h1: 1.9 }));
    ctx.push(glow, LIME, { o: 0.28, b: 0.6 });
    let knit = '';
    for (let v = 3.0; v < 9.6; v += 0.7) {
      const a = P(-fr.inner(v) - 0.3, v, fr.top(v) * 0.75);
      const b = P(fr.outer(v) + 0.3, v, fr.top(v) * 0.75);
      knit += `M${a[0].toFixed(2)},${a[1].toFixed(2)}L${b[0].toFixed(2)},${b[1].toFixed(2)}`;
    }
    ctx.stroke(knit, '#000000', 0.12, { o: 0.18, cp: body });
  }
  // faixa lateral curva e aba refletiva
  const side: Pt[] = [];
  for (const v of [1.6, 3.6, 5.6, 7.6, 9.0]) side.push(P(fr.outer(v) + 0.75, v, 2.0 + (v - 1.6) * 0.05));
  ctx.push(taperPath(side, [0.3, 0.9, 0.8, 0.5, 0]), LIME, { o: 0.9, cp: body });
  const tab = P(0, 0.4, fr.top(0.6) + 0.6);
  ctx.push(ellipse(tab[0], tab[1], 0.55, 0.45), '#E8F0FF', { o: 0.9 });
  hem(sc, outerAll);
}

// ---------------------------------------------------------------------------------------------------------------
// botas
// ---------------------------------------------------------------------------------------------------------------

/** bota de trabalho: couro com pesponto, sola tratorada, ganchos de metal, colarinho acolchoado (cano médio) */
function boots(sc: SC): void {
  const { ctx, fr, P, lite, c } = sc;
  const t = leatherTones(c);
  // calça comprida quebra por cima do cano (não aparece cano acima da barra)
  const covered = pantsOn(ctx);
  if (!covered) {
    const sh = shaftPath(sc, 0.82, 1.0, 0.3, 0.55);
    ctx.push(sh.d, c, { gf: shaftGrad(sc, t, 1.3) });
    ctx.push(smoothPath([[sh.topL[0] - 0.25, sh.topL[1] - 0.2], [sh.topC[0], sh.topC[1] - 0.4], [sh.topR[0] + 0.25, sh.topR[1] - 0.2], [sh.topR[0] + 0.1, sh.topR[1] + 1.1], [sh.topC[0], sh.topC[1] + 0.8], [sh.topL[0] - 0.1, sh.topL[1] + 1.1]], true), mix(c, '#000000', 0.3));
  }
  lugSole(sc, { ease: 0.95, h: 1.0 });
  const pts = footHull(fr, { ease: 0.95, h0: 0.95, toe: 0.4 });
  const body = hp(pts);
  ctx.push(body, c, { gf: upperGrad(sc, fr, pts, t) });
  // biqueira com pesponto e lingueta acolchoada
  const cap = hp(footHull(fr, { ease: 0.98, v0: 8.6, h0: 1.0, toe: 0.4 }));
  ctx.push(cap, mix(c, '#000000', 0.08), { cp: body });
  if (!lite) {
    const seamU: Pt[] = [];
    for (let i = 0; i <= 8; i++) {
      const k = -1 + (2 * i) / 8;
      seamU.push(P(k * (k < 0 ? fr.inner(8.7) : fr.outer(8.7)) * 1.05 + k * 0.5, 8.65 - (1 - k * k) * 0.3, 1.1 + (1 - k * k) * 1.0));
    }
    ctx.stroke(smoothPath(seamU, false), threadOf(c), 0.15, { o: 0.65, da: [0.4, 0.3], c: 'butt', cp: body });
  }
  laces(sc, fr, lite ? [3.2, 5.2] : [2.8, 4.0, 5.2, 6.4], { color: '#B88A4A', eye: '#C9B07A', w: 1.2 });
  // ganchos de metal no cano
  if (!lite && !covered) {
    const top = limbWidthAt(ctx.an, 'shin', sc.s, 0.88);
    let hk = '';
    for (const g of [-1, 1]) for (let i = 0; i < 2; i++) hk += ellipse(top.at[0] + g * 1.25, top.at[1] + i * 1.3, 0.3, 0.26);
    ctx.push(hk, '#D4C08A');
  }
  shine(sc, fr, body, { o: 0.32 });
  hem(sc, hp(footHull(fr, { ease: 1.4 })));
}

/** coturno: cano alto até o meio da canela, muitos ilhoses, colarinho acolchoado, alça atrás, sola tratorada grossa */
function combat(sc: SC): void {
  const { ctx, fr, P, lite, c, s } = sc;
  const { an } = ctx;
  const t = leatherTones(c);
  const T0 = 0.6;
  // alça de puxar atrás (aparece acima do colarinho)
  const top = limbWidthAt(an, 'shin', s, T0);
  ctx.push(smoothPath([[top.at[0] + 0.6, top.at[1] - 0.2], [top.at[0] + 1.0, top.at[1] - 2.6], [top.at[0] + 2.6, top.at[1] - 2.4], [top.at[0] + 2.4, top.at[1] + 0.2]], true, 0.8), mix(c, '#000000', 0.35));
  const sh = shaftPath(sc, T0, 1.1, 0.45, 0.6);
  ctx.push(sh.d, c, { gf: shaftGrad(sc, t, 1.4) });
  ctx.push(smoothPath([[sh.topL[0] - 0.3, sh.topL[1] - 0.3], [sh.topC[0], sh.topC[1] - 0.5], [sh.topR[0] + 0.3, sh.topR[1] - 0.3], [sh.topR[0] + 0.15, sh.topR[1] + 1.4], [sh.topC[0], sh.topC[1] + 1.1], [sh.topL[0] - 0.15, sh.topL[1] + 1.4]], true), mix(c, '#000000', 0.28));
  // lingueta + ilhoses e cadarço pelo cano todo
  const rows = lite ? 3 : 6;
  let lace = '';
  let eyes = '';
  let sh2 = '';
  for (let i = 0; i < rows; i++) {
    const tt = T0 + 0.06 + ((0.96 - T0 - 0.06) * i) / (rows - 1);
    const q = limbWidthAt(an, 'shin', s, tt);
    const w = Math.min(1.5, (q.l + q.r) * 0.32);
    const y = q.at[1];
    lace += taperPath([[q.at[0] - w, y - 0.25], [q.at[0], y + 0.12], [q.at[0] + w, y + 0.0]], [0.4, 0.46, 0.4], { round: true });
    sh2 += taperPath([[q.at[0] - w, y + 0.2], [q.at[0], y + 0.55], [q.at[0] + w, y + 0.4]], [0.3, 0.36, 0.3]);
    eyes += ellipse(q.at[0] - w - 0.15, y - 0.2, 0.3, 0.27) + ellipse(q.at[0] + w + 0.15, y - 0.05, 0.3, 0.27);
  }
  const tongue = smoothPath([[top.at[0] - 1.2, top.at[1] - 0.8], [top.at[0] + 1.2, top.at[1] - 0.8], [top.at[0] + 1.4, top.at[1] + 8], [top.at[0] - 1.4, top.at[1] + 8]], true, 0.6);
  ctx.push(tongue, mix(c, '#000000', 0.15), { cp: sh.d });
  if (!lite) ctx.push(sh2, '#000000', { o: 0.3, cp: sh.d });
  ctx.push(eyes, '#B8BCC6');
  ctx.push(lace, lum(c) < 0.1 ? '#2E2E36' : '#1E1E24');
  pantBlouseOverShaft(ctx, s, T0);
  lugSole(sc, { ease: 1.0, h: 1.25, welt: '#2A2522' });
  const pts = footHull(fr, { ease: 1.0, h0: 1.2, toe: 0.5 });
  const body = hp(pts);
  ctx.push(body, c, { gf: upperGrad(sc, fr, pts, t) });
  const cap = hp(footHull(fr, { ease: 1.03, v0: 8.4, h0: 1.2, toe: 0.5 }));
  ctx.push(cap, mix(c, '#FFFFFF', 0.05), { cp: body });
  if (!lite) ctx.stroke(smoothPath([P(-fr.inner(8.5) - 0.6, 8.5, 1.4), P(0, 8.2, 3.0), P(fr.outer(8.5) + 0.6, 8.5, 1.4)], false), mix(c, '#000000', 0.45), 0.2, { o: 0.6, cp: body });
  laces(sc, fr, lite ? [4.0] : [3.4, 4.6, 5.8], { color: lum(c) < 0.1 ? '#2E2E36' : '#1E1E24', eye: '#B8BCC6' });
  shine(sc, fr, body, { o: 0.45 });
  void P;
}

/** bota texana: bico fino, salto cubano, cano com recorte em V, alças laterais e bordado de arabescos */
function texan(sc: SC): void {
  const { ctx, fr, P, lite, c, s } = sc;
  const { an } = ctx;
  const t = leatherTones(c);
  const vamp = mix(c, '#2A1408', 0.38);
  const tv = leatherTones(vamp);
  const T0 = 0.58;
  // cano justo na panturrilha com leve boca de sino e recorte em V descendo no meio da frente (o "scallop" do faroeste)
  const sh = shaftPath(sc, T0, 0.95, 0.75, 1.5);
  // alças de puxar (dos dois lados, saindo da boca)
  ctx.push(smoothPath([[sh.topL[0] + 0.3, sh.topL[1] + 0.4], [sh.topL[0] - 0.3, sh.topL[1] - 1.6], [sh.topL[0] + 1.0, sh.topL[1] - 1.9], [sh.topL[0] + 1.4, sh.topL[1] + 0.3]], true, 0.8) + smoothPath([[sh.topR[0] - 0.3, sh.topR[1] + 0.4], [sh.topR[0] + 0.3, sh.topR[1] - 1.6], [sh.topR[0] - 1.0, sh.topR[1] - 1.9], [sh.topR[0] - 1.4, sh.topR[1] + 0.3]], true, 0.8), mix(c, '#000000', 0.3));
  ctx.push(sh.d, c, { gf: shaftGrad(sc, t, 1.6) });
  // recorte em V na frente (a boca sobe nos lados e desce no meio): borda costurada
  ctx.stroke(smoothPath([sh.topL, [sh.topC[0], sh.topC[1]], sh.topR], false), mix(c, '#000000', 0.4), 0.35, { o: 0.6, cp: sh.d });
  if (!lite) {
    // bordado: arabescos simétricos (duas volutas e uma haste) em linha clara
    const q = limbWidthAt(an, 'shin', s, T0 + 0.18);
    const x = q.at[0];
    const y = q.at[1];
    const w = (q.l + q.r) * 0.45;
    const scroll = (g: number) => smoothPath([[x, y + 4.5], [x + g * w * 0.3, y + 2.2], [x + g * w * 0.85, y + 0.6], [x + g * w * 0.65, y - 1.4], [x + g * w * 0.15, y - 0.9], [x + g * w * 0.35, y + 0.2]], false);
    ctx.stroke(scroll(-1) + scroll(1) + smoothPath([[x, y + 4.8], [x, y - 2.6]], false), mix(c, '#F6E2B0', 0.65), 0.22, { o: 0.85, cp: sh.d });
  }
  pantBlouseOverShaft(ctx, s, T0 - 0.02);
  // salto cubano (aparece atrás, inclinado)
  const hb = P(0, 0.6, 0);
  const ht = P(0, 1.2, 1.6);
  ctx.push(smoothPath([[ht[0] - 1.1, ht[1]], [ht[0] + 1.1, ht[1]], [hb[0] + 0.9, hb[1] + 1.4], [hb[0] - 0.9, hb[1] + 1.4]], true, 0.2), mix(c, '#000000', 0.55));
  sole(sc, fr, { ease: 0.95, h1: 0.45, color: '#3A2416', toe: 1.5, wk: 0.94 });
  const pts = footHull(fr, { ease: 0.9, h0: 0.4, toe: 1.5, wk: 0.94 });
  const body = hp(pts);
  ctx.push(body, vamp, { gf: upperGrad(sc, fr, pts, tv) });
  if (!lite) {
    // pesponto decorativo no peito do pé (onda)
    ctx.stroke(smoothPath([P(-1.2, 8.8, 2.2), P(-0.5, 7.4, fr.top(7.4) + 0.25), P(0, 6.6, fr.top(6.6) + 0.3), P(0.5, 7.4, fr.top(7.4) + 0.25), P(1.3, 8.8, 2.2)], false), mix(vamp, '#F6E2B0', 0.6), 0.18, { o: 0.75, cp: body });
  }
  shine(sc, fr, body, { o: 0.42, toe: 1.5 });
}

// ---------------------------------------------------------------------------------------------------------------
// sociais e baixos
// ---------------------------------------------------------------------------------------------------------------

/** meia baixa (sapato social): tornozelo na cor da meia */
function sockStub(sc: SC, color: string): void {
  const { ctx, s } = sc;
  const t = fabric(color);
  ctx.push(shinPath(ctx.an, s, { from: 0.78, endExt: 1.6, ease: 0.1 }), color, { gf: shaftGrad(sc, t, 0.4) });
}

/** mocassim: couro polido, costura de avental no bico, presilha com recorte, salto baixo, boca baixa */
function loafers(sc: SC): void {
  const { ctx, fr, P, lite, c } = sc;
  const t = leatherTones(c);
  bareFoot(sc, fr, { toes: false });
  sole(sc, fr, { ease: 0.62, h1: 0.4, color: mix(c, '#1A0E08', 0.6), toe: 0.6 });
  const heelBlock = hp(footHull(fr, { ease: 0.64, v1: 2.6, h1: 0.9 }));
  ctx.push(heelBlock, mix(c, '#1A0E08', 0.55));
  const sides = footHull(fr, { ease: 0.6, h0: 0.35, topH: 2.6, toe: 0.6 });
  const vamp = footHull(fr, { ease: 0.6, v0: 5.0, h0: 0.35, toe: 0.6 });
  const g = upperGrad(sc, fr, sides, t);
  const dS = hp(sides);
  const dV = hp(vamp);
  ctx.push(dS, c, { gf: g });
  ctx.push(dV, c, { gf: g });
  // borda da boca (forro escuro aparecendo) e costura de avental em U
  const mouth = [P(-fr.inner(3.2) - 0.45, 3.2, 2.55), P(-1.0, 5.0, fr.top(5) + 0.2), P(1.0, 5.0, fr.top(5) + 0.2), P(fr.outer(3.2) + 0.45, 3.2, 2.55)];
  ctx.stroke(smoothPath(mouth, false), mix(c, '#000000', 0.55), 0.3, { o: 0.7 });
  if (!lite) {
    const ap: Pt[] = [];
    for (let i = 0; i <= 8; i++) {
      const k = -1 + (2 * i) / 8;
      const v = 5.6 + (1 - Math.abs(k)) * 0 + (Math.abs(k) > 0.8 ? 0 : 0);
      ap.push(P(k * 1.25, v + (1 - k * k) * 3.3, fr.top(v + (1 - k * k) * 3.3) + 0.15));
    }
    ctx.stroke(smoothPath(ap, false), mix(c, '#000000', 0.35), 0.2, { o: 0.6, cp: dV });
    ctx.stroke(smoothPath(ap.map((p) => [p[0], p[1] - 0.25] as Pt), false), threadOf(c), 0.12, { o: 0.5, da: [0.3, 0.25], c: 'butt', cp: dV });
  }
  // presilha (tira atravessada com o recorte de "moeda")
  const sA = P(-1.4, 5.6, fr.top(5.6) + 0.15);
  const sB = P(1.4, 5.6, fr.top(5.6) + 0.15);
  const sC = P(0, 5.9, fr.top(5.9) + 0.32);
  const strap = taperPath([sA, sC, sB], [0.9, 1.05, 0.9], { round: true });
  ctx.push(taperPath([[sA[0], sA[1] + 0.5], [sC[0], sC[1] + 0.6], [sB[0], sB[1] + 0.5]], [0.7, 0.8, 0.7]), '#000000', { o: 0.3, b: lite ? 0 : 0.25, cp: dV });
  ctx.push(strap, mix(c, '#000000', 0.12));
  if (!lite) ctx.push(ellipse(sC[0], sC[1] + 0.05, 0.42, 0.2), mix(c, '#000000', 0.6), { o: 0.8 });
  shine(sc, fr, dV, { o: 0.6, toe: 0.6 });
  hem(sc, hp(footHull(fr, { ease: 1.1 })));
}

/** sapato social: couro bem engraxado, biqueira reta (cap toe), fechamento com 3 passadas, bico alongado */
function oxford(sc: SC): void {
  const { ctx, fr, P, lite, c } = sc;
  const t = leatherTones(c);
  if (!ankleCovered(ctx)) sockStub(sc, '#1E1E26');
  sole(sc, fr, { ease: 0.58, h1: 0.36, color: mix(c, '#140A06', 0.65), toe: 1.0, wk: 0.96 });
  ctx.push(hp(footHull(fr, { ease: 0.6, v1: 2.6, h1: 0.95 })), mix(c, '#140A06', 0.6));
  const pts = footHull(fr, { ease: 0.56, h0: 0.32, topH: 3.7, toe: 1.0, wk: 0.96 });
  const body = hp(pts);
  ctx.push(body, c, { gf: upperGrad(sc, fr, pts, t) });
  // biqueira (cap toe): costura reta atravessando o bico
  const capLine: Pt[] = [];
  for (let i = 0; i <= 6; i++) {
    const k = -1 + (2 * i) / 6;
    capLine.push(P(k * (k < 0 ? fr.inner(8.9) : fr.outer(8.9)) * 1.04 + k * 0.4, 8.9 - (1 - k * k) * 0.15, 1.0 + (1 - k * k) * 1.25));
  }
  ctx.stroke(smoothPath(capLine, false), mix(c, '#000000', 0.5), 0.22, { o: 0.65, cp: body });
  if (!lite) ctx.stroke(smoothPath(capLine.map((p) => [p[0], p[1] - 0.3] as Pt), false), mix(c, '#FFFFFF', 0.2), 0.12, { o: 0.4, cp: body });
  // gáspea fechada: duas abas se encontrando no meio + cadarço fino (3 passadas)
  const tab = (g: number): Pt[] => [P(g * 0.15, 3.4, fr.top(3.4) + 0.12), P(g * 1.25, 3.6, fr.top(3.6) + 0.1), P(g * 1.35, 6.4, fr.top(6.4) + 0.12), P(g * 0.2, 6.6, fr.top(6.6) + 0.14)];
  ctx.push(hp(tab(-1)) + hp(tab(1)), mix(c, '#000000', 0.12), { o: 0.9 });
  laces(sc, fr, lite ? [4.6] : [4.0, 5.0, 6.0], { color: mix(c, '#000000', 0.5), eye: mix(c, '#000000', 0.5), w: 1.0, hOff: 0.22 });
  shine(sc, fr, body, { o: 0.7, hard: true, toe: 1.0 });
  if (!lite) {
    const hi = P(-0.6, 4.6, fr.top(4.6) - 0.6);
    ctx.push(blob(hi[0], hi[1], 0.6, 0.25, -sc.sg * 0.4), '#FFFFFF', { o: 0.45, cp: body });
  }
  hem(sc, hp(footHull(fr, { ease: 1.1, toe: 1 })));
}

/** sapatilha: boca baixa mostrando o peito do pé, bico arredondado, lacinho, sola fina, cetim macio */
function flats(sc: SC): void {
  const { ctx, fr, P, lite, c, t } = sc;
  bareFoot(sc, fr, { toes: false });
  sole(sc, fr, { ease: 0.42, h1: 0.3, color: mix(c, '#2A1A14', 0.5) });
  const sides = footHull(fr, { ease: 0.38, h0: 0.25, topH: 1.8 });
  const box = footHull(fr, { ease: 0.4, v0: 7.6, h0: 0.25 });
  const g = upperGrad(sc, fr, sides, t);
  const dS = hp(sides);
  const dB = hp(box);
  ctx.push(dS, c, { gf: g });
  ctx.push(dB, c, { gf: g });
  // borda da boca com debrum
  const edge = [P(-fr.inner(3) - 0.35, 3, 1.75), P(-fr.inner(6.8) - 0.3, 6.8, 1.8), P(-0.9, 7.8, fr.top(7.8) + 0.12), P(0.9, 7.8, fr.top(7.8) + 0.12), P(fr.outer(6.8) + 0.3, 6.8, 1.8), P(fr.outer(3) + 0.35, 3, 1.75)];
  ctx.stroke(smoothPath(edge, false), mix(c, '#000000', 0.35), 0.28, { o: 0.65 });
  // lacinho
  const k = P(0, 7.9, fr.top(7.9) + 0.25);
  const bow = blob(k[0] - 0.75, k[1], 0.75, 0.4, 0.25) + blob(k[0] + 0.75, k[1], 0.75, 0.4, -0.25);
  ctx.push(bow, mix(c, '#000000', 0.12));
  ctx.push(ellipse(k[0], k[1], 0.32, 0.3), mix(c, '#000000', 0.25));
  if (!lite) ctx.push(blob(k[0] - 0.85, k[1] - 0.12, 0.4, 0.15, 0.3), '#FFFFFF', { o: 0.45 });
  shine(sc, fr, dB, { o: 0.35 });
  hem(sc, hp(footHull(fr, { ease: 0.9 })));
}

/**
 * boca em U (salto, plataforma): o peito do pé aparece por cima do cabedal — pele recortada no pé, sombra da borda na
 * pele, linha da boca e o comecinho do decote dos dedos no fundo do U. `vT` = fundo do U, `hSide` = altura nas laterais.
 */
function instepU(sc: SC, fr: FootFrame, footClip: string, o: { vT: number; hSide: number; v0?: number }): void {
  const { ctx, lite } = sc;
  const sk = tonesOf(ctx);
  const P = fr.P;
  const v0 = o.v0 ?? 2.2;
  const mouth: Pt[] = [];
  for (let i = 0; i <= 8; i++) {
    const th = -Math.PI / 2 + (Math.PI * i) / 8;
    const sn = Math.sin(th);
    const cs = Math.cos(th);
    const v = v0 + (o.vT - v0) * cs;
    const u = sn < 0 ? sn * (fr.inner(v) + 0.1) : sn * (fr.outer(v) + 0.1);
    const h = o.hSide + (fr.top(v) + 0.12 - o.hSide) * cs * cs;
    mouth.push(P(u, v, h));
  }
  const region = smoothPath([...mouth, P(fr.outer(v0) + 0.6, v0 - 0.4, 5.4), P(0, v0 - 1.6, 6.2), P(-fr.inner(v0) - 0.6, v0 - 0.4, 5.4)], true);
  const top = P(0.1, 4.8, fr.top(4.8));
  ctx.push(region, sk.base, { cp: footClip, gf: { t: 'r', cx: top[0] - sc.sg * 0.4, cy: top[1], r: 6 * fr.s, fx: top[0] - sc.sg * 0.6, fy: top[1] - 0.4, s: [[0, sk.lighter], [0.4, sk.light], [0.78, sk.base], [1, sk.shade]] } });
  // sombra fina da borda do sapato na pele + linha da boca + decote dos dedos
  if (!lite) ctx.push(taperPath(mouth.map((p) => [p[0], p[1] - 0.35] as SP), [0.2, 0.5, 0.6, 0.6, 0.6, 0.6, 0.6, 0.5, 0.2]), sk.deep, { o: 0.35, b: 0.25, cp: region });
  ctx.stroke(smoothPath(mouth, false), mix(sc.c, '#000000', 0.45), 0.24, { o: 0.65 });
  if (!lite) {
    const c = P(-0.25, o.vT - 0.15, fr.top(o.vT) + 0.15);
    ctx.stroke(smoothPath([[c[0] - 0.35, c[1] - 0.55], [c[0], c[1] - 0.05], [c[0] + 0.3, c[1] - 0.5]], false), sk.deep, 0.16, { o: 0.5 });
  }
}

/** escarpim de verniz: calcanhar erguido, bico fino, boca em U mostrando o peito do pé, salto agulha atrás */
function heels(sc: SC): void {
  const { ctx, fr, lite, c } = sc;
  const fh = liftFrame(fr, 0.3);
  const P = fh.P;
  const t = leatherTones(saturate(c, 0.1));
  // salto agulha (atrás do pé, do calcanhar erguido até o chão)
  const cup = P(0, 0.55, 0);
  const gnd = fr.P(0, 0.55, 0);
  ctx.push(taperPath([cup, [gnd[0], gnd[1] + 0.6]], [1.2, 0.4], { round: true }), mix(c, '#000000', 0.45));
  const foot = bareFoot(sc, fh, { toes: false });
  const pts = footHull(fh, { ease: 0.42, toe: 1.6, wk: 0.92 });
  const up = hp(pts);
  ctx.push(up, c, { gf: upperGrad(sc, fh, pts, { ...t, light: mix(c, '#FFFFFF', 0.5) }) });
  instepU(sc, fh, foot, { vT: 7.1, hSide: 1.7, v0: 2.0 });
  // verniz: reflexo duro e fino na lateral e no bico (sem "olho" no meio)
  const side: Pt[] = [P(fh.outer(3.6) + 0.3, 3.6, 1.2), P(fh.outer(6) + 0.35, 6, 1.0), P(fh.outer(8.6) + 0.15, 8.6, 0.9)];
  ctx.push(taperPath(side, [0, 0.5, 0]), '#FFFFFF', { o: 0.75 });
  const tp: Pt[] = [P(-0.6, 9.3, 1.5), P(0.1, 10.4, 1.1), P(0.4, 11.2, 0.7)];
  ctx.push(taperPath(tp, [0, 0.45, 0]), '#FFFFFF', { o: lite ? 0.6 : 0.8 });
  if (!lite) ctx.push(taperPath([P(-fh.inner(4) - 0.35, 4, 1.3), P(-fh.inner(6) - 0.3, 6, 1.1)], [0.1, 0.45]), '#FFFFFF', { o: 0.45, cp: up });
  ctx.push(hp(footHull(fh, { ease: 0.5, v0: 6.8, h1: 0.22, toe: 1.6, wk: 0.92 })), mix(c, '#000000', 0.6), { o: 0.9 });
  hem(sc, hp(footHull(fh, { ease: 0.9, toe: 1.6 })));
}

/** sapatinho de cristal: como o salto, mas de vidro — pé visível por dentro, facetas, reflexos e brilhinhos */
function glassSlipper(sc: SC): void {
  const { ctx, fr, lite } = sc;
  const fh = liftFrame(fr, 0.3);
  const P = fh.P;
  const ICE = '#BFEFFF';
  const cup = P(0, 0.55, 0);
  const gnd = fr.P(0, 0.55, 0);
  const heel = taperPath([cup, [gnd[0], gnd[1] + 0.6]], [1.3, 0.55], { round: true });
  ctx.push(heel, ICE, { o: 0.55 });
  ctx.stroke(heel, '#FFFFFF', 0.18, { o: 0.8 });
  bareFoot(sc, fh, { toes: true });
  const sides = footHull(fh, { ease: 0.42, topH: 2.2, toe: 1.4, wk: 0.94 });
  const box = footHull(fh, { ease: 0.44, v0: 7.3, toe: 1.4, wk: 0.94 });
  const dS = hp(sides);
  const dB = hp(box);
  const b = bbox(sides);
  const tint: AvatarGradient = { t: 'l', x1: b.x, y1: b.y, x2: b.x + b.w, y2: b.y + b.h, s: [[0, '#FFFFFF', 0.5], [0.4, ICE, 0.25], [1, '#7FC8E8', 0.45]] };
  ctx.push(dS, ICE, { gf: tint, o: 0.85 });
  ctx.push(dB, ICE, { gf: tint, o: 0.85 });
  ctx.stroke(dS, '#EFFBFF', 0.16, { o: 0.6 });
  ctx.stroke(dB, '#EFFBFF', 0.16, { o: 0.6 });
  // facetas (retas) e reflexo diagonal
  if (!lite) {
    const f1 = [P(-1.2, 8.2, 1.8), P(0.2, 10.4, 1.0)];
    const f2 = [P(0.9, 7.9, 2.0), P(1.6, 9.8, 0.8)];
    ctx.stroke(smoothPath(f1, false) + smoothPath(f2, false), '#FFFFFF', 0.16, { o: 0.7, cp: dB });
  }
  shine(sc, fh, dB, { o: 0.9, hard: true, toe: 1.4 });
  const sp = P(0.6, 9.2, 2.4);
  ctx.push(starPath(sp[0] + 0.6, sp[1] - 0.8, 0.85, 4, 0.28) + (lite ? '' : starPath(sp[0] - 1.8, sp[1] + 0.6, 0.5, 4, 0.3)), '#FFFFFF', { o: 0.95 });
  if (!lite) ctx.push(starPath(sp[0] + 0.6, sp[1] - 0.8, 1.6, 4, 0.18), '#DFF8FF', { o: 0.5, b: 0.4 });
  hem(sc, hp(footHull(fh, { ease: 0.9, toe: 1.4 })));
}

// ---------------------------------------------------------------------------------------------------------------
// abertos
// ---------------------------------------------------------------------------------------------------------------

/** tira que atravessa o peito do pé em `v` (largura `w` ao longo do pé), da borda de dentro à de fora da sola */
function crossStrap(fr: FootFrame, v: number, w: number, h0 = 0.7, lift = 0.25): string {
  const edge = (vv: number): Pt[] => {
    const out: Pt[] = [];
    for (let i = 0; i <= 6; i++) {
      const k = -1 + (2 * i) / 6;
      const u = k * (k < 0 ? fr.inner(vv) : fr.outer(vv)) * 1.06;
      const h = h0 + (fr.top(vv) + lift - h0) * Math.pow(1 - k * k, 0.55);
      out.push(fr.P(u, vv, h));
    }
    return out;
  };
  const a = edge(v - w / 2);
  const b = edge(v + w / 2).reverse();
  return smoothPath([...a.map((p, i) => (i === 0 || i === a.length - 1 ? ([p[0], p[1], 0.4] as SP) : p)), ...b.map((p, i) => (i === 0 || i === b.length - 1 ? ([p[0], p[1], 0.4] as SP) : p))], true);
}

/** sandália de duas tiras: palmilha de cortiça, tira larga no peito do pé, tira nos dedos, tira do tornozelo com fivela */
function sandals(sc: SC): void {
  const { ctx, fr, P, lite, c } = sc;
  const cork = '#C9A47A';
  const sp = footHull(fr, { ease: 0.62, h1: 0.7 });
  const b = bbox(sp);
  ctx.push(hp(sp), cork, { gf: { t: 'l', x1: 0, y1: b.y, x2: 0, y2: b.y + b.h, s: [[0, '#E8CDA8'], [0.6, cork], [1, '#8A6A48']] } });
  ctx.push(hp(footHull(fr, { ease: 0.62, h1: 0.22 })), '#4A3628');
  if (!lite) {
    const dots: string[] = [];
    for (let i = 0; i < 10; i++) {
      const p = P(-1.6 + (i % 5) * 0.8, 9 + Math.floor(i / 5) * 1.3, 0.62);
      dots.push(ellipse(p[0], p[1], 0.12, 0.08));
    }
    ctx.push(dots.join(''), '#8A6A48', { o: 0.5 });
  }
  bareFoot(sc, fr);
  const t = leatherTones(c);
  const grad: AvatarGradient = { t: 'l', x1: b.x, y1: b.y - 6, x2: b.x + b.w, y2: b.y + b.h, s: [[0, t.light], [0.5, t.base], [1, t.shade]] };
  const s1 = crossStrap(fr, 5.0, 1.6, 0.7, 0.3);
  const s2 = crossStrap(fr, 8.3, 1.15, 0.7, 0.2);
  // tira do tornozelo (passa por trás do calcanhar) + presilha que desce até a sola
  const ank = taperPath([P(-fr.inner(1.6) - 0.3, 1.6, 4.4), P(0, 2.7, 5.0), P(fr.outer(1.6) + 0.3, 1.6, 4.4)], [0.75, 0.8, 0.75], { round: true });
  const post = taperPath([P(fr.outer(1.8) + 0.25, 1.8, 4.3), P(fr.outer(2.2) + 0.3, 2.2, 0.8)], [0.7, 0.7], { round: true });
  if (!lite) ctx.push(s1 + s2 + ank, '#000000', { o: 0.28, b: 0.3 });
  ctx.push(s1 + s2 + ank + post, c, { gf: grad });
  if (!lite) {
    // pesponto das tiras e brilho do couro
    ctx.stroke(smoothPath([P(-fr.inner(4.5) * 0.9, 4.5, 1.0), P(0, 4.45, fr.top(4.45) + 0.3), P(fr.outer(4.5) * 0.9, 4.5, 1.0)], false), threadOf(c), 0.12, { o: 0.6, da: [0.3, 0.25], c: 'butt', cp: s1 });
    ctx.push(taperPath([P(-1.2, 4.6, fr.top(4.6) + 0.3), P(-0.2, 4.6, fr.top(4.6) + 0.35)], [0.1, 0.4]), '#FFFFFF', { o: 0.4, cp: s1 });
  }
  // fivela do tornozelo (lado de fora)
  const fb = P(fr.outer(1.7) + 0.2, 1.7, 4.35);
  ctx.push(ellipse(fb[0], fb[1], 0.5, 0.45), '#D9C28A', { o: 0.95 });
  if (!lite) ctx.push(ellipse(fb[0], fb[1], 0.24, 0.2), mix(c, '#000000', 0.4));
  hem(sc, hp(footHull(fr, { ease: 0.9 })));
}

/** chinelo: solado de borracha fino com duas camadas e tira em Y entre o dedão e o segundo dedo */
function slides(sc: SC): void {
  const { ctx, fr, P, lite, c } = sc;
  const sp = footHull(fr, { ease: 0.78, h1: 0.6 });
  const b = bbox(sp);
  // camada de baixo branca, de cima na cor (aparece em volta do pé, visto um pouco de cima)
  ctx.push(hp(sp), '#F2F0EA', { gf: { t: 'l', x1: 0, y1: b.y, x2: 0, y2: b.y + b.h, s: [[0, '#FFFFFF'], [1, '#C9C4BA']] } });
  ctx.push(hp(footHull(fr, { ease: 0.72, h0: 0.32, h1: 0.62 })), c, { gf: { t: 'l', x1: 0, y1: b.y, x2: 0, y2: b.y + b.h, s: [[0, mix(c, '#FFFFFF', 0.25)], [1, mix(c, '#000000', 0.2)]] } });
  bareFoot(sc, fr);
  // tira em Y
  const thong = P(-0.62, 10.3, 0.8);
  const top = P(-0.3, 8.0, fr.top(8.0) + 0.1);
  const L = P(-fr.inner(5.4) - 0.2, 5.4, 0.62);
  const R = P(fr.outer(5.0) + 0.2, 5.0, 0.62);
  const strapC = mix(c, lum(c) > 0.6 ? '#000000' : '#FFFFFF', 0.15);
  const strap = taperPath([L, [(L[0] + top[0]) / 2, (L[1] + top[1]) / 2 - 0.25], top, [(R[0] + top[0]) / 2, (R[1] + top[1]) / 2 - 0.25], R], [0.8, 0.8, 0.85, 0.8, 0.8], { round: true }) + taperPath([top, thong], [0.6, 0.35], { round: true });
  if (!lite) ctx.push(strap, '#000000', { o: 0.3, b: 0.3 });
  ctx.push(strap, strapC);
  ctx.push(ellipse(thong[0], thong[1], 0.38, 0.3), mix(strapC, '#000000', 0.25));
  hem(sc, hp(footHull(fr, { ease: 0.9 })));
}

/** plataforma: sola alta no tom do sapato (mais escura, com frisos e borda de luz), boneca de verniz com tira e fivela */
function platform(sc: SC): void {
  const { ctx, fr, P, lite, c } = sc;
  const H = 2.5;
  const foot = bareFoot(sc, fr, { toes: false });
  const sp = footHull(fr, { ease: 0.85, h1: H, toe: 0.3 });
  const b = bbox(sp);
  const soleC = lum(c) < 0.06 ? '#2E2A34' : mix(c, '#1A1018', 0.42);
  const sd = hp(sp);
  ctx.push(sd, soleC, { gf: { t: 'l', x1: 0, y1: b.y, x2: 0, y2: b.y + b.h, s: [[0, mix(soleC, '#FFFFFF', 0.25)], [0.45, soleC], [1, mix(soleC, '#000000', 0.45)]] } });
  if (!lite) {
    let ribs = '';
    for (const h of [0.75, 1.45]) {
      const r: Pt[] = [];
      for (let i = 0; i <= 10; i++) {
        const k = -1 + (2 * i) / 10;
        const v = 6.2 + (1 - k * k) * 5.4;
        r.push(P(k * (k < 0 ? fr.inner(v) : fr.outer(v)) * 1.08 + k * 0.7, v, h));
      }
      ribs += smoothPath(r, false);
    }
    ctx.stroke(ribs, mix(soleC, '#000000', 0.35), 0.2, { o: 0.6, cp: sd });
  }
  // borda de cima da sola (luz)
  const lip: Pt[] = [];
  for (let i = 0; i <= 10; i++) {
    const k = -1 + (2 * i) / 10;
    const v = 6.0 + (1 - k * k) * 5.6;
    lip.push(P(k * (k < 0 ? fr.inner(v) : fr.outer(v)) * 1.08 + k * 0.7, v, H - 0.1));
  }
  ctx.stroke(smoothPath(lip, false), mix(soleC, '#FFFFFF', 0.4), 0.3, { o: 0.7, cp: sd });
  const t = leatherTones(c);
  const pts = footHull(fr, { ease: 0.62, h0: H - 0.2, toe: 0.3 });
  const up = hp(pts);
  const g = upperGrad(sc, fr, pts, { ...t, light: mix(c, '#FFFFFF', 0.45) });
  ctx.push(up, c, { gf: g });
  instepU(sc, fr, foot, { vT: 7.4, hSide: H + 0.9, v0: 2.6 });
  // tira de boneca no peito do pé com fivela do lado de fora
  const sA = P(-fr.inner(4.4) - 0.45, 4.4, H + 0.9);
  const sM = P(0, 4.6, fr.top(4.6) + 0.3);
  const sB = P(fr.outer(4.4) + 0.45, 4.4, H + 0.9);
  if (!lite) ctx.push(taperPath([[sA[0], sA[1] + 0.4], [sM[0], sM[1] + 0.5], [sB[0], sB[1] + 0.4]], [0.8, 0.9, 0.8]), '#000000', { o: 0.3, b: 0.25 });
  ctx.push(taperPath([sA, sM, sB], [0.9, 1.0, 0.9], { round: true }), c, { gf: g });
  ctx.push(ellipse(sB[0] - sc.sg * 0.1, sB[1], 0.48, 0.42), '#E2C77A');
  if (!lite) ctx.push(ellipse(sB[0] - sc.sg * 0.1, sB[1], 0.22, 0.18), mix(c, '#000000', 0.5));
  // verniz: reflexo fino no bico e na lateral
  ctx.push(taperPath([P(-0.5, 9.4, H + 1.2), P(0.2, 10.4, H + 0.8), P(0.4, 11.1, H + 0.4)], [0, 0.45, 0]), '#FFFFFF', { o: 0.75 });
  if (!lite) ctx.push(taperPath([P(fr.outer(5) + 0.4, 5, H + 0.4), P(fr.outer(8) + 0.3, 8, H + 0.3)], [0, 0.4, 0]), '#FFFFFF', { o: 0.5 });
  hem(sc, hp(footHull(fr, { ease: 1.0 })));
}

// ---------------------------------------------------------------------------------------------------------------
// especiais
// ---------------------------------------------------------------------------------------------------------------

/** patins: bota de cano alto com cadarço, base de metal, quatro rodinhas e freio de borracha na frente */
function skates(sc: SC): void {
  const { ctx, fr, P, lite, c, s } = sc;
  const WHEEL = '#FF1493';
  const t = leatherTones(c);
  // rodinhas de trás (aparecem atrás, mais altas) e da frente
  const wheel = (u: number, v: number, h: number): string => {
    const p = P(u, v, h);
    return smoothPath([[p[0] - 0.75, p[1] - 1.25], [p[0] + 0.75, p[1] - 1.25], [p[0] + 0.8, p[1] + 1.2], [p[0] - 0.8, p[1] + 1.2]], true, 0.9);
  };
  const back = wheel(-1.3, 1.6, -1.3) + wheel(1.3, 1.6, -1.3);
  ctx.push(back, mix(WHEEL, '#000000', 0.25));
  const sh = shaftPath(sc, 0.78, 1.05, 0.35, 0.5);
  ctx.push(sh.d, c, { gf: shaftGrad(sc, t, 1.3) });
  ctx.push(smoothPath([[sh.topL[0] - 0.25, sh.topL[1] - 0.3], [sh.topC[0], sh.topC[1] - 0.5], [sh.topR[0] + 0.25, sh.topR[1] - 0.3], [sh.topR[0] + 0.1, sh.topR[1] + 1.2], [sh.topC[0], sh.topC[1] + 0.9], [sh.topL[0] - 0.1, sh.topL[1] + 1.2]], true), mix(c, '#000000', 0.15));
  pantBlouseOverShaft(ctx, s, 0.78);
  // base de metal
  const plate = hp(footHull(fr, { ease: 0.7, h0: -0.6, h1: 0.1, v0: 0.8, v1: 10.4 }));
  ctx.push(plate, '#9AA1B0', { gf: { t: 'l', x1: 0, y1: P(0, 6, 0)[1] - 1, x2: 0, y2: P(0, 6, 0)[1] + 1.2, s: [[0, '#E6EAF2'], [0.5, '#9AA1B0'], [1, '#5A606E']] } });
  sole(sc, fr, { ease: 0.95, h1: 0.5, color: mix(c, '#000000', 0.5) });
  const pts = footHull(fr, { ease: 0.9, h0: 0.45 });
  const body = hp(pts);
  ctx.push(body, c, { gf: upperGrad(sc, fr, pts, t) });
  laces(sc, fr, lite ? [3.4, 5.4] : [2.8, 4.0, 5.2, 6.4], { color: '#FFFFFF', w: 1.15 });
  // rodinhas da frente + freio
  const front = wheel(-1.4, 8.6, -1.3) + wheel(1.4, 8.6, -1.3);
  ctx.push(front, WHEEL, { gf: { t: 'l', x1: P(-2, 8.6, 0)[0], y1: 0, x2: P(2, 8.6, 0)[0], y2: 0, s: [[0, mix(WHEEL, '#FFFFFF', 0.4)], [0.5, WHEEL], [1, mix(WHEEL, '#000000', 0.3)]] } });
  if (!lite) {
    let hubs = '';
    for (const u of [-1.4, 1.4]) {
      const p = P(u, 8.6, -1.3);
      hubs += ellipse(p[0], p[1], 0.32, 0.55);
    }
    ctx.push(hubs, '#E6EAF2', { o: 0.9 });
  }
  const stop = P(0, 11.0, -0.4);
  ctx.push(ellipse(stop[0], stop[1], 0.95, 0.85), '#2A2630');
  shine(sc, fr, body, { o: 0.4 });
}

/** botas antigravidade: casco liso metálico, faixas de luz, sola emissora e um disco de luz embaixo (flutuam) */
function hoverBoots(sc: SC): void {
  const { ctx, fr, P, lite, c, s } = sc;
  const LIGHT = '#00E5FF';
  const t: Tones = { light: mix(c, '#FFFFFF', 0.65), base: mix(c, '#E8ECF4', 0.35), shade: mix(c, '#20263A', 0.45), deep: mix(c, '#0A0E1A', 0.6), bounce: mix(c, LIGHT, 0.25) };
  // disco de luz embaixo (o pé flutua): halo largo + anel
  const g0 = P(0, 6, -0.9);
  ctx.push(ellipse(g0[0], g0[1] + 0.6, 4.6, 1.4), LIGHT, { o: 0.35, b: lite ? 0 : 1.1 });
  if (!lite) ctx.stroke(ellipse(g0[0], g0[1] + 0.5, 3.4, 0.9), LIGHT, 0.35, { o: 0.8 });
  const T0 = 0.6;
  const sh = shaftPath(sc, T0, 0.85, 0.25, 0.4);
  ctx.push(sh.d, t.base, { gf: shaftGrad(sc, t, 1.4) });
  // faixas de luz no cano (laterais) e anel no tornozelo
  const q0 = limbWidthAt(ctx.an, 'shin', s, T0 + 0.06);
  const q1 = limbWidthAt(ctx.an, 'shin', s, 0.95);
  const strip = (k: number) => taperPath([[q0.at[0] + k * (k < 0 ? q0.l : q0.r) * 0.62, q0.at[1]], [q1.at[0] + k * (k < 0 ? q1.l : q1.r) * 0.62, q1.at[1]]], [0.5, 0.4], { round: true });
  const strips = strip(-1) + strip(1);
  if (!lite) ctx.push(strips, LIGHT, { o: 0.6, b: 0.5, cp: sh.d });
  ctx.push(strips, '#E6FDFF', { o: 0.95, cp: sh.d });
  ctx.push(smoothPath([[sh.topL[0] - 0.2, sh.topL[1] - 0.2], [sh.topC[0], sh.topC[1] - 0.3], [sh.topR[0] + 0.2, sh.topR[1] - 0.2], [sh.topR[0] + 0.1, sh.topR[1] + 0.9], [sh.topC[0], sh.topC[1] + 0.7], [sh.topL[0] - 0.1, sh.topL[1] + 0.9]], true), t.shade);
  pantBlouseOverShaft(ctx, s, T0);
  // sola emissora
  const sd = hp(footHull(fr, { ease: 1.0, h1: 0.9 }));
  ctx.push(sd, '#1A2030');
  ctx.push(hp(footHull(fr, { ease: 1.05, h0: 0.25, h1: 0.6 })), LIGHT, { o: 0.95 });
  if (!lite) ctx.push(hp(footHull(fr, { ease: 1.4, h0: 0.1, h1: 0.8 })), LIGHT, { o: 0.4, b: 0.6 });
  const pts = footHull(fr, { ease: 0.95, h0: 0.85 });
  const body = hp(pts);
  ctx.push(body, t.base, { gf: upperGrad(sc, fr, pts, t) });
  // painel do peito do pé e linha de luz na biqueira
  const panel = hp(footHull(fr, { ease: 0.6, v0: 3.2, v1: 8.2, h0: 2.2 }));
  ctx.push(panel, t.shade, { o: 0.55, cp: body });
  const cap: Pt[] = [];
  for (let i = 0; i <= 6; i++) {
    const k = -1 + (2 * i) / 6;
    cap.push(P(k * (k < 0 ? fr.inner(8.8) : fr.outer(8.8)) * 1.05 + k * 0.6, 8.8 - (1 - k * k) * 0.2, 1.2 + (1 - k * k) * 1.2));
  }
  ctx.stroke(smoothPath(cap, false), '#E6FDFF', 0.3, { o: 0.95, cp: body });
  if (!lite) ctx.stroke(smoothPath(cap, false), LIGHT, 0.8, { o: 0.4, b: 0.4, cp: body });
  shine(sc, fr, body, { o: 0.6, hard: true });
}

const SHOES: Record<string, (sc: SC) => void> = {
  sneakers,
  hightops,
  boots,
  sandals,
  runners,
  loafers,
  oxford,
  flats,
  heels,
  combat,
  texan,
  slides,
  platform,
  skates,
  glass: glassSlipper,
  hover: hoverBoots,
};

/** (testes) calçados com desenho próprio */
export const SHOE_KINDS = Object.keys(SHOES);
