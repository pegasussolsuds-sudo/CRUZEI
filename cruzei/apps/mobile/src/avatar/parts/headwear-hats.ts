// Chapéus: copa que encaixa no crânio da anatomia (formato do rosto, estatura e volume do cabelo por baixo), aba vista
// levemente de cima, faixa e material próprio de cada peça (feltro, palha trançada, tricô canelado, sarja de algodão,
// cetim, couro, metal com gemas lapidadas, luz). Dono: chapelaria.
//
// Convivência com o cabelo: parts/hat-modes.ts (o cabelo lê o modo e decide o que desenhar embaixo).
// Grupo 'head' em tudo, menos o caimento do hijab nos ombros (grupo 'body', fica parado quando a cabeça inclina).
// Medidas em unidades da cabeça (hf.P): ver o cabeçalho de headwear-kit.ts.

import { torsoProfile } from '../anatomy';
import type { LayerCtx } from '../ctx';

import {
  GOLD_STOPS,
  SILVER_STOPS,
  SKULL_CY,
  SKULL_RY,
  arcU,
  bandGradient,
  bandU,
  blob,
  boxOf,
  castShadow,
  domeGradient,
  domeU,
  edgeShade,
  fitTop,
  fleck,
  gem,
  herringbone,
  knitRib,
  metalGrad,
  mix,
  neon,
  pearl,
  shapeVolume,
  shift,
  smoothPath,
  sparkle,
  squash,
  stitch,
  strawWeave,
  taperPath,
  tones,
  vivid,
  type HeadFrame,
  type SP,
  type Tones,
} from './headwear-kit';

type HatFn = (ctx: LayerCtx, hf: HeadFrame) => void;

const STRAW = '#E2C27E';
const PANAMA = '#EEE2C2';

// ---------------------------------------------------------------------------------------------------------------
// aba (anel visto levemente de cima) — fedora, panamá, palha, vaqueiro, cartola, bruxa, bucket
// ---------------------------------------------------------------------------------------------------------------

interface BrimSpec {
  /** centro do anel (y, cabeça unitária) */
  yB: number;
  /** meia-largura e meia-altura (escorço) do anel */
  R: number;
  r: number;
  /** laterais sobem (vaqueiro, cartola) */
  curl?: number;
  /** laterais caem (palha mole) */
  droop?: number;
  /** frente desce (aba quebrada) */
  dip?: number;
  /** borda ondulada (bruxa) */
  wave?: number;
  waveN?: number;
}

/** contorno do anel da aba (avatar), horário a partir da direita: metade de cima = parte de trás */
function brimPts(hf: HeadFrame, b: BrimSpec, n = 32): SP[] {
  const pts: SP[] = [];
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2;
    const c = Math.cos(th);
    const s = Math.sin(th);
    const side = c * c * c * c;
    let y = b.yB - b.r * s - (b.curl ?? 0) * side + (b.droop ?? 0) * side;
    if (s < 0) y += (b.dip ?? 0) * s * s;
    if (b.wave) y += b.wave * Math.sin(th * (b.waveN ?? 5) + 0.6);
    pts.push(hf.P(b.R * c, y));
  }
  return pts;
}

/** borda da frente da aba (da direita pra esquerda), pra sombra projetada e espessura */
function brimFront(hf: HeadFrame, b: BrimSpec, a0 = 8, a1 = 172, n = 13): SP[] {
  const out: SP[] = [];
  for (let i = 0; i < n; i++) {
    const th = -((a0 + ((a1 - a0) * i) / (n - 1)) * Math.PI) / 180;
    const c = Math.cos(th);
    const s = Math.sin(th);
    const side = c * c * c * c;
    let y = b.yB - b.r * s - (b.curl ?? 0) * side + (b.droop ?? 0) * side;
    y += (b.dip ?? 0) * s * s;
    if (b.wave) y += b.wave * Math.sin(th * (b.waveN ?? 5) + 0.6);
    out.push(hf.P(b.R * c, y));
  }
  return out;
}

/** anel interno (onde a copa encontra a aba): curva de "sorriso" — a frente fica mais baixa, as laterais no centro */
function innerRing(hf: HeadFrame, b: BrimSpec, w: number, n = 7): { yC: number; yS: number; pts: SP[] } {
  const yC = b.yB + b.r * (w / b.R) + (b.dip ?? 0) * 0.45 * (w / b.R);
  const yS = b.yB - (b.curl ?? 0) * Math.pow(w / b.R, 4) + (b.droop ?? 0) * Math.pow(w / b.R, 4);
  return { yC, yS, pts: bandU(hf, w, yC, yS, n, 2) };
}

/** desenha a aba com volume: superfície de cima iluminada, sombra da copa à direita, espessura da borda e trama */
function drawBrim(ctx: LayerCtx, hf: HeadFrame, b: BrimSpec, w: number, t: Tones, o: { weave?: 'straw' | 'panama'; stitchRows?: number; under?: number } = {}): { d: string; front: SP[] } {
  const pts = brimPts(hf, b);
  const d = smoothPath(pts, true);
  const bx = boxOf(pts);
  // luz: a frente da aba (perto da gente) recebe mais luz; o fundo, perto da copa, fica na sombra dela
  ctx.push(d, t.base, {
    gf: { t: 'r', cx: bx.x + bx.w * 0.4, cy: bx.y + bx.h * 0.95, r: bx.w * 0.62, fx: bx.x + bx.w * 0.32, fy: bx.y + bx.h * 1.05, s: [[0, t.light], [0.55, t.base], [1, mix(t.base, t.shade, 0.8)]] },
  });
  // sombra que a copa projeta na aba (luz de cima-esquerda → sombra pra direita e pra trás)
  ctx.push(blob(hf.cx + (w * 0.55) * hf.s, hf.cy + (b.yB - b.r * 0.15) * hf.s, w * 0.75 * hf.s, b.r * 0.9 * hf.s, 0.1), t.deep, { o: 0.4, cp: d, ...(hf.lite ? {} : { b: 0.9 }) });
  // oclusão no pé da copa (dobra entre copa e aba)
  const ring = innerRing(hf, b, w);
  edgeShade(ctx, hf, ring.pts, d, t.deep, { w: 1.2, o: 0.4, dy: 0.45 });
  if (o.weave) {
    // fileiras da trança acompanham o anel
    const rows: SP[][] = [];
    const nR = o.weave === 'panama' ? 6 : 5;
    for (let k = 1; k <= nR; k++) {
      const f = k / (nR + 0.6);
      const bb: BrimSpec = { ...b, R: w + (b.R - w) * f, r: b.r * (0.55 + 0.45 * f) };
      rows.push(brimFront(hf, bb, -8, 188, 15));
    }
    strawWeave(ctx, hf, d, rows, t, { fine: o.weave === 'panama', o: o.weave === 'panama' ? 0.7 : 1 });
  }
  if (o.stitchRows && !hf.lite) {
    for (let k = 1; k <= o.stitchRows; k++) {
      const f = 1 - k * 0.13;
      stitch(ctx, hf, brimFront(hf, { ...b, R: w + (b.R - w) * f, r: b.r * (0.6 + 0.4 * f) }, -4, 184, 17), t.line, { w: 0.17, o: 0.55, dash: [0.55, 0.42] });
    }
  }
  // espessura: a borda da frente vira pra baixo (aresta escura fina) com uma luz logo acima
  const front = brimFront(hf, b);
  ctx.push(taperPath(shift(front, 0, 0.12), [0.1, 0.55, 0.62, 0.55, 0.1]), t.deep, { o: 0.9 * (o.under ?? 1) });
  if (!hf.lite) ctx.stroke(smoothPath(shift(front, 0.05, -0.32), false), t.lighter, 0.35, { o: 0.4, cp: d, b: 0.15 });
  return { d, front };
}

/** faixa (fita) em volta da copa, logo acima do anel interno */
function ribbon(ctx: LayerCtx, hf: HeadFrame, b: BrimSpec, w: number, h: number, color: string, o: { bow?: boolean; buckle?: boolean; satin?: boolean } = {}): string {
  const lo = innerRing(hf, b, w + 0.08, 9);
  const hi = bandU(hf, w * 0.985, lo.yC - h, lo.yS - h, 9, 2);
  const pts = [...hi.slice().reverse(), ...lo.pts];
  const t = tones(color);
  const d = smoothPath(pts, true);
  const bx = boxOf(pts);
  ctx.push(d, color, { gf: bandGradient(bx, t, 1) });
  if (o.satin && !hf.lite) ctx.push(taperPath(shift(hi.slice(2, 7), 0, h * 0.42), [0, h * 0.28, h * 0.32, h * 0.2, 0]), t.sheen, { o: 0.55, cp: d, b: 0.2 });
  edgeShade(ctx, hf, lo.pts, d, t.deep, { w: h * 0.4, o: 0.4, dy: -h * 0.12 });
  if (!hf.lite) ctx.stroke(smoothPath(shift(hi, 0, 0.12), false), t.lighter, 0.2, { o: 0.4, cp: d });
  if (o.bow) {
    // laço plano do lado esquerdo (feltro): duas pontas dobradas + nó
    const [bxp, byp] = hf.Q(-w * 0.72, lo.yS + (lo.yC - lo.yS) * 0.3 - h * 0.5);
    const k = hf.s * h;
    const bow = smoothPath([[bxp - 0.9 * k, byp - 0.55 * k], [bxp + 0.15 * k, byp - 0.2 * k], [bxp + 0.15 * k, byp + 0.25 * k], [bxp - 0.95 * k, byp + 0.6 * k], [bxp - 0.75 * k, byp + 0.02 * k]], true);
    ctx.push(bow, t.base, { gf: bandGradient(boxOf([[bxp - k, byp - k], [bxp + k, byp + k]]), t, 1.2) });
    ctx.push(blob(bxp + 0.05 * k, byp + 0.02 * k, 0.28 * k, 0.48 * k), t.deep, { o: 0.75 });
  }
  if (o.buckle) {
    const [qx, qy] = hf.Q(0, lo.yC - h * 0.5);
    const k = h * hf.s;
    const bd = smoothPath([[qx - 0.95 * k, qy - 0.62 * k, 0.3], [qx + 0.95 * k, qy - 0.62 * k, 0.3], [qx + 0.95 * k, qy + 0.62 * k, 0.3], [qx - 0.95 * k, qy + 0.62 * k, 0.3]], true);
    const ins = smoothPath([[qx - 0.5 * k, qy - 0.25 * k, 0.3], [qx + 0.5 * k, qy - 0.25 * k, 0.3], [qx + 0.5 * k, qy + 0.25 * k, 0.3], [qx - 0.5 * k, qy + 0.25 * k, 0.3]], true);
    ctx.push(bd + ins, '#E2B23A', { r: 'evenodd', gf: metalGrad(boxOf([[qx - k, qy - k], [qx + k, qy + k]]), GOLD_STOPS) });
  }
  return d;
}

// ---------------------------------------------------------------------------------------------------------------
// bonés
// ---------------------------------------------------------------------------------------------------------------

function cap(ctx: LayerCtx, hf: HeadFrame, back: boolean): void {
  const t = tones(ctx.col.hat);
  const L = 0.85 + hf.bulk * 0.8;
  const w = hf.Wu + L;
  const yC = -4.35;
  const yS = -1.5;
  const topU = SKULL_CY - (SKULL_RY + L + 0.5);
  const yb = (u: number) => yC + (yS - yC) * Math.pow(Math.abs(u), 2.4);
  if (back) {
    // aba virada pra trás: aparece por cima da copa, vista por baixo (mais escura)
    const bill = smoothPath([hf.P(-0.5 * w, topU + 1.6), hf.P(-0.62 * w, topU + 0.2), hf.P(-0.3 * w, topU - 1.15), hf.P(0.3 * w, topU - 1.15), hf.P(0.62 * w, topU + 0.2), hf.P(0.5 * w, topU + 1.6)], true);
    ctx.push(bill, t.shade, { gf: { t: 'l', x1: 0, y1: hf.Q(0, topU - 1.2)[1], x2: 0, y2: hf.Q(0, topU + 1.2)[1], s: [[0, t.light], [0.25, t.base], [1, t.deep]] } });
    if (!hf.lite) stitch(ctx, hf, [hf.P(-0.5 * w, topU + 0.1), hf.P(-0.28 * w, topU - 0.72), hf.P(0.28 * w, topU - 0.72), hf.P(0.5 * w, topU + 0.1)], t.line, { w: 0.16, o: 0.5 });
  }
  const pts = domeU(hf, { lift: L, extra: 0.5, yC, yS, p: 2.4 });
  castShadow(ctx, hf, bandU(hf, w, yC, yS, 9, 2.4), { w: 1.3, dy: 0.55, o: 0.32 });
  const d = shapeVolume(ctx, hf, pts, t, { core: 0.42, sheen: 0.3, sheenAt: [0.32, 0.22], sheenR: [0.2, 0.14] });
  // gomos: costuras que descem do botão até a faixa (sarja de algodão)
  const seam = (u: number): SP[] => [hf.P(u * 0.04, topU + 0.25), hf.P(u * 0.32 * w, topU + 1.9), hf.P(u * 0.5 * w, -7.0), hf.P(u * 0.58 * w, yb(0.58) - 0.05)];
  const seams = back ? [seam(-1), seam(1), [hf.P(0, topU + 0.25), hf.P(0, -7.5), hf.P(0, yC - 2.2)]] : [seam(-1), seam(1), [hf.P(0, topU + 0.25), hf.P(0, -7.5), hf.P(0, yC)]];
  let valley = '';
  for (const sm of seams) valley += smoothPath(sm, false);
  ctx.stroke(valley, t.deep, hf.lite ? 0.3 : 0.32, { o: hf.lite ? 0.3 : 0.5, cp: d });
  if (!hf.lite) {
    let ridge = '';
    for (const sm of seams) ridge += smoothPath(shift(sm, -0.32, 0.05), false);
    ctx.stroke(ridge, t.lighter, 0.24, { o: 0.32, cp: d });
    for (const sm of seams) stitch(ctx, hf, shift(sm, 0.42, 0), t.line, { w: 0.13, o: 0.45, dash: [0.42, 0.34], cp: d });
    // ilhoses de ventilação nos gomos laterais
    let eye = '';
    for (const g of [-1, 1]) {
      const [ex, ey] = hf.Q(g * 0.72 * w, -8.2);
      eye += `M${(ex - 0.32).toFixed(2)},${ey.toFixed(2)}a0.32,0.26 0 1,0 0.64,0a0.32,0.26 0 1,0 -0.64,0Z`;
    }
    ctx.push(eye, t.deep, { o: 0.75 });
  }
  // botão no topo
  const [bx, by] = hf.Q(0, topU + 0.1);
  ctx.push(blob(bx, by, 0.75 * hf.s, 0.5 * hf.s), t.base, { gf: { t: 'r', cx: bx - 0.25, cy: by - 0.25, r: 1, s: [[0, t.lighter], [0.6, t.base], [1, t.deep]] } });
  if (back) {
    // abertura do regulador: mostra a testa/cabelo e a tira de plástico com pinos
    const open = smoothPath([hf.P(-1.7, yC + 0.05, 0), hf.P(-1.45, yC - 1.6), hf.P(0, yC - 2.5), hf.P(1.45, yC - 1.6), hf.P(1.7, yC + 0.05, 0)], true);
    const bald = ctx.cfg.hair === 'bald' || ctx.cfg.hair === 'buzz';
    const inner = bald ? ctx.col.skin : ctx.col.hairShade;
    ctx.push(open, inner, { gf: { t: 'l', x1: 0, y1: hf.Q(0, yC - 2.4)[1], x2: 0, y2: hf.Q(0, yC)[1], s: [[0, mix(inner, '#05030A', 0.45)], [1, inner]] } });
    edgeShade(ctx, hf, [hf.P(-1.6, yC - 0.4), hf.P(-1.3, yC - 1.7), hf.P(0, yC - 2.45), hf.P(1.3, yC - 1.7), hf.P(1.6, yC - 0.4)], open, '#0A0508', { w: 0.9, o: 0.5, dy: 0.25 });
    const strap = smoothPath([hf.P(-2.1, yC - 0.95, 0.4), hf.P(2.1, yC - 0.95, 0.4), hf.P(2.1, yC - 0.05, 0.4), hf.P(-2.1, yC - 0.05, 0.4)], true);
    const st = tones('#1A1A22');
    ctx.push(strap, st.base, { gf: bandGradient(boxOf([hf.P(-2.1, yC - 1), hf.P(2.1, yC)]), st, 1.4) });
    let studs = '';
    for (const x of [-1.25, -0.42, 0.42, 1.25]) {
      const [sx, sy] = hf.Q(x, yC - 0.5);
      studs += `M${(sx - 0.24).toFixed(2)},${sy.toFixed(2)}a0.24,0.24 0 1,0 0.48,0a0.24,0.24 0 1,0 -0.48,0Z`;
    }
    ctx.push(studs, '#3A3A48', { o: 0.95 });
    return;
  }
  // aba (pala) curvada pra frente: superfície de cima + aresta escura embaixo + sombra forte na testa
  const ub = 0.86;
  const backEdge: SP[] = [];
  for (let i = 0; i <= 8; i++) {
    const u = ub - (2 * ub * i) / 8;
    backEdge.push(hf.P(u * w, yb(u) - 0.05));
  }
  const frontEdge: SP[] = [hf.P(-0.96 * w, yb(-0.96) + 0.2, 0.4), hf.P(-0.72 * w, yC + 2.05), hf.P(-0.36 * w, yC + 2.8), hf.P(0, yC + 3.0), hf.P(0.36 * w, yC + 2.8), hf.P(0.72 * w, yC + 2.05), hf.P(0.96 * w, yb(0.96) + 0.2, 0.4)];
  castShadow(ctx, hf, frontEdge.slice(1, -1), { w: 2.2, dy: 1.15, o: 0.5, b: 0.9 });
  const billPts = [...frontEdge, ...backEdge];
  const bill = smoothPath(billPts, true);
  const bb = boxOf(billPts);
  ctx.push(bill, t.base, { gf: { t: 'r', cx: bb.x + bb.w * 0.42, cy: bb.y + bb.h * 0.9, r: bb.w * 0.58, fx: bb.x + bb.w * 0.36, fy: bb.y + bb.h * 0.85, s: [[0, t.light], [0.5, t.base], [0.85, mix(t.base, t.shade, 0.7)], [1, t.shade]] } });
  // oclusão onde a pala encontra a copa e brilho largo na curvatura
  edgeShade(ctx, hf, backEdge, bill, t.deep, { w: 1.0, o: 0.42, dy: 0.35 });
  ctx.push(blob(hf.cx - w * 0.3 * hf.s, hf.cy + (yC + 1.55) * hf.s, w * 0.32 * hf.s, 0.55 * hf.s, -0.06), t.lighter, { o: 0.32, cp: bill, ...(hf.lite ? {} : { b: 0.5 }) });
  if (!hf.lite) {
    for (const f of [0.22, 0.4, 0.58]) stitch(ctx, hf, frontEdge.slice(1, -1).map((p, i) => [p[0], p[1] - f * (1.2 + 0.4 * Math.sin((i / 4) * Math.PI))] as SP), t.line, { w: 0.14, o: 0.5, dash: [0.45, 0.35], cp: bill });
  }
  ctx.push(taperPath(shift(frontEdge.slice(1, -1), 0, 0.08), [0.15, 0.5, 0.6, 0.5, 0.15]), t.deep, { o: 0.95 });
}

// ---------------------------------------------------------------------------------------------------------------
// gorro, bucket, faixa
// ---------------------------------------------------------------------------------------------------------------

function beanie(ctx: LayerCtx, hf: HeadFrame): void {
  const t = tones(ctx.col.hat);
  const L = 1.1 + hf.bulk * 0.85;
  const w = hf.Wu + L;
  const yC = -3.35;
  const yS = -0.7;
  const cuffH = 2.75;
  const pts = domeU(hf, { lift: L, extra: 1.4, yC: yC - cuffH + 0.4, yS: yS - cuffH + 0.4, lean: 0.5, p: 2.3 });
  castShadow(ctx, hf, bandU(hf, w + 0.3, yC, yS, 9, 2.3), { w: 1.4, dy: 0.6, o: 0.34 });
  const d = shapeVolume(ctx, hf, pts, t, { core: 0.4, sheen: 0.24, rim: 0.22 });
  const topU = SKULL_CY - (SKULL_RY + L + 1.4);
  // colunas de tricô convergindo pro topo
  const crown = arcU(hf, 0.4, topU + 1.3, w * 0.22, 0.5, 170, 10, 9);
  const cuffTop = bandU(hf, w + 0.3, yC - cuffH, yS - cuffH, 13, 2.3).reverse();
  knitRib(ctx, hf, d, crown, cuffTop, t, hf.lite ? 9 : 17);
  // dobra (barra virada, mais grossa que o corpo)
  const lo = bandU(hf, w + 0.38, yC, yS, 13, 2.3);
  const cuffPts = [...cuffTop.map((p) => [p[0], p[1]] as SP), ...lo];
  const cuff = smoothPath(cuffPts, true);
  const cb = boxOf(cuffPts);
  // sombra da dobra no corpo, logo acima
  ctx.push(taperPath(shift(cuffTop, 0, -0.35), [0, 0.9, 0.9, 0]), t.deep, { o: 0.35, cp: d, ...(hf.lite ? {} : { b: 0.4 }) });
  ctx.push(cuff, t.base, { gf: { t: 'l', x1: cb.x, y1: cb.y, x2: cb.x + cb.w * 0.4, y2: cb.y + cb.h * 1.4, s: [[0, t.light], [0.4, t.base], [1, t.shade]] } });
  knitRib(ctx, hf, cuff, cuffTop, lo.slice().reverse(), t, hf.lite ? 14 : 30);
  ctx.push(taperPath(shift(lo.slice().reverse(), 0, -0.4), [0.2, 0.8, 0.8, 0.2]), t.deep, { o: 0.35, cp: cuff, ...(hf.lite ? {} : { b: 0.35 }) });
  if (!hf.lite) ctx.stroke(smoothPath(shift(cuffTop, 0.1, 0.25), false), t.lighter, 0.4, { o: 0.4, cp: cuff, b: 0.2 });
  // dobra macia no topo (o gorro "cai" pra trás)
  if (!hf.lite) ctx.push(taperPath([hf.P(-0.5 * w, topU + 2.6), hf.P(0.05 * w, topU + 1.8), hf.P(0.6 * w, topU + 2.4)], [0, 0.9, 0]), t.deep, { o: 0.22, cp: d, b: 0.5 });
}

function bucket(ctx: LayerCtx, hf: HeadFrame): void {
  const t = tones(ctx.col.hat);
  const L = 0.95 + hf.bulk * 0.8;
  const w = hf.Wu + L;
  const b: BrimSpec = { yB: -4.5, R: w + 3.3, r: 2.4, droop: 1.15, dip: 0.5 };
  const ring = innerRing(hf, b, w);
  const brim = drawBrim(ctx, hf, b, w, t, { stitchRows: 3 });
  castShadow(ctx, hf, brim.front.slice(2, -2), { w: 2.0, dy: 1.2, o: 0.36, b: 1.0 });
  // copa baixa de topo achatado, costura no pé
  const pts = domeU(hf, { lift: L, extra: -0.6, yC: ring.yC, yS: ring.yS, flat: 0.55, p: 2 });
  const d = shapeVolume(ctx, hf, pts, t, { core: 0.4, sheen: 0.26 });
  const topU = SKULL_CY - (SKULL_RY + L - 0.6);
  if (!hf.lite) {
    stitch(ctx, hf, bandU(hf, w * 0.98, ring.yC - 0.55, ring.yS - 0.55, 11, 2).reverse(), t.line, { w: 0.15, o: 0.5, cp: d });
    stitch(ctx, hf, arcU(hf, 0, topU + 1.8, w * 0.7, 1.0, 172, 8, 11), t.line, { w: 0.15, o: 0.45, cp: d });
    fleck(ctx, hf, d, boxOf(pts), t.deep, { n: 50, r: 0.24, seed: 5, op: 0.16, dash: true });
  }
  // dobra do pano na lateral da copa
  if (!hf.lite) ctx.push(taperPath([hf.P(0.55 * w, topU + 2.4), hf.P(0.68 * w, -6.4), hf.P(0.62 * w, ring.yS + 0.4)], [0, 0.8, 0]), t.deep, { o: 0.3, cp: d, b: 0.4 });
  edgeShade(ctx, hf, ring.pts, d, t.deep, { w: 0.9, o: 0.3, dy: -0.3 });
}

function headband(ctx: LayerCtx, hf: HeadFrame): void {
  const t = tones(ctx.col.hat);
  const w = hf.Wu + hf.bulk + 0.45;
  const hi = bandU(hf, w, -7.0, -5.3, 11, 2.2).reverse();
  const lo = bandU(hf, w + 0.1, -4.55, -2.9, 11, 2.2);
  castShadow(ctx, hf, lo.slice().reverse(), { w: 1.1, dy: 0.45, o: 0.32 });
  const pts = [...hi, ...lo];
  const d = smoothPath(pts, true);
  const bb = boxOf(pts);
  ctx.push(d, t.base, { gf: { t: 'l', x1: bb.x, y1: bb.y, x2: bb.x + bb.w * 0.25, y2: bb.y + bb.h, s: [[0, t.light], [0.45, t.base], [1, t.shade]] } });
  // atoalhado: canelado horizontal fino + pontinhos de felpa; volume no meio da faixa
  if (!hf.lite) {
    for (const f of [0.33, 0.66]) {
      const row = hi.map((p, i) => [p[0] + (lo[lo.length - 1 - i][0] - p[0]) * f, p[1] + (lo[lo.length - 1 - i][1] - p[1]) * f] as SP);
      ctx.stroke(smoothPath(row, false), t.deep, 0.22, { o: 0.25, cp: d });
    }
    fleck(ctx, hf, d, bb, t.lighter, { n: 90, r: 0.13, seed: 9, op: 0.35 });
    fleck(ctx, hf, d, bb, t.deep, { n: 70, r: 0.12, seed: 21, op: 0.3 });
  }
  ctx.push(taperPath(shift(hi, 0.1, 0.5), [0, 0.8, 0.8, 0]), t.lighter, { o: 0.3, cp: d, ...(hf.lite ? {} : { b: 0.3 }) });
  edgeShade(ctx, hf, lo.slice().reverse(), d, t.deep, { w: 0.9, o: 0.35, dy: -0.25 });
  // borda lateral (a faixa contorna a cabeça): escurece onde vira
  ctx.push(blob(hf.cx + w * 0.92 * hf.s, hf.cy - 4.4 * hf.s, 1.0 * hf.s, 1.9 * hf.s), t.deep, { o: 0.35, cp: d, ...(hf.lite ? {} : { b: 0.5 }) });
}

// ---------------------------------------------------------------------------------------------------------------
// chapéus de aba
// ---------------------------------------------------------------------------------------------------------------

/** copa de chapéu de aba (unidades da cabeça): laterais do anel até o topo, com afinamento, vinco e covas */
function crownPts(hf: HeadFrame, ring: { yC: number; yS: number }, w: number, o: { top: number; taper?: number; dent?: number; pinch?: number; flare?: number; round?: number }): SP[] {
  const tp = o.taper ?? 0.82;
  const yS = ring.yS;
  const top = o.top;
  const h = yS - top;
  const fl = o.flare ?? 0;
  const dent = o.dent ?? 0;
  const pinch = o.pinch ?? 0;
  const rd = o.round ?? 0.8;
  const side = (g: 1 | -1): SP[] => [
    hf.P(g * w, yS, 0),
    hf.P(g * (w * (1 - (1 - tp) * 0.25) + fl * 0.3), yS - h * 0.35),
    hf.P(g * (w * (1 - (1 - tp) * 0.7) + fl * 0.7 - pinch * 0.4), yS - h * 0.72),
    hf.P(g * (w * tp + fl), top + h * 0.12 * rd, rd),
  ];
  const L = side(-1);
  const R = side(1).reverse();
  const topPts: SP[] = [hf.P(-w * tp * 0.62 - fl * 0.6, top + 0.15 * rd), hf.P(-w * tp * 0.25, top + dent * 0.35), hf.P(0, top + dent), hf.P(w * tp * 0.25, top + dent * 0.35), hf.P(w * tp * 0.62 + fl * 0.6, top + 0.15 * rd)];
  const band = bandU(hf, w, ring.yC, yS, 7, 2).slice(1, -1);
  return [...L, ...topPts, ...R, ...band];
}

/** sombra do vinco (vale) e das covas laterais na copa */
function crownDent(ctx: LayerCtx, hf: HeadFrame, d: string, t: Tones, w: number, top: number, yS: number, dent: number, pinch: number): void {
  if (dent > 0) {
    ctx.push(taperPath([hf.P(0.1, top + dent + 0.1), hf.P(0.35, top + dent + (yS - top) * 0.25), hf.P(0.2, top + (yS - top) * 0.48)], [1.1 * hf.s, 0.9 * hf.s, 0]), t.deep, { o: 0.4, cp: d, ...(hf.lite ? {} : { b: 0.45 }) });
    if (!hf.lite) ctx.push(taperPath([hf.P(-0.55, top + dent + 0.2), hf.P(-0.75, top + (yS - top) * 0.3)], [0.8 * hf.s, 0]), t.lighter, { o: 0.28, cp: d, b: 0.35 });
  }
  if (pinch > 0) {
    for (const g of [-1, 1]) {
      ctx.push(blob(hf.cx + g * w * 0.5 * hf.s, hf.cy + (top + (yS - top) * 0.36) * hf.s, w * 0.17 * hf.s, (yS - top) * 0.2 * hf.s, g * 0.25), g > 0 ? t.deep : t.shade, { o: g > 0 ? 0.42 : 0.3, cp: d, ...(hf.lite ? {} : { b: 0.5 }) });
    }
  }
}

/** chapéu de aba completo: aba, copa com volume, fita; devolve a geometria pra detalhes */
function brimmedHat(
  ctx: LayerCtx,
  hf: HeadFrame,
  t: Tones,
  b: BrimSpec,
  w: number,
  c: { top: number; taper?: number; dent?: number; pinch?: number; flare?: number; round?: number },
  o: { weave?: 'straw' | 'panama'; band?: string; bandH?: number; bow?: boolean; buckle?: boolean; satin?: boolean; stitchRows?: number; sheen?: number } = {},
): { d: string; ring: { yC: number; yS: number; pts: SP[] }; top: number; k: number } {
  const ring = innerRing(hf, b, w);
  // cabe no viewBox: a copa encolhe na vertical se passar do topo
  const k = fitTop(hf.Q(0, c.top)[1], hf.Q(0, ring.yS)[1], 0.8);
  const top = ring.yS + (c.top - ring.yS) * k;
  const brim = drawBrim(ctx, hf, b, w, t, { weave: o.weave, stitchRows: o.stitchRows });
  castShadow(ctx, hf, brim.front.slice(2, -2), { w: 2.2, dy: 1.3, o: 0.38, b: 1.0 });
  const pts = crownPts(hf, ring, w, { ...c, top });
  const d = shapeVolume(ctx, hf, pts, t, { core: 0.38, sheen: o.sheen ?? 0.28, sheenAt: [0.3, 0.35], sheenR: [0.16, 0.26] });
  crownDent(ctx, hf, d, t, w, top, ring.yS, c.dent ?? 0, c.pinch ?? 0);
  if (o.weave) {
    const rows: SP[][] = [];
    const n = o.weave === 'panama' ? 7 : 6;
    for (let i = 1; i < n; i++) {
      const y = ring.yS - ((ring.yS - top) * i) / n;
      const ww = w * (1 - (1 - (c.taper ?? 0.82)) * (i / n));
      rows.push(bandU(hf, ww * 1.02, y + (ring.yC - ring.yS) * (1 - i / n) * 0.9, y, 9, 2).reverse());
    }
    strawWeave(ctx, hf, d, rows, t, { fine: o.weave === 'panama', o: o.weave === 'panama' ? 0.7 : 1 });
  } else {
    fleck(ctx, hf, d, boxOf(pts), t.lighter, { n: 40, r: 0.1, seed: 17, op: 0.1 });
  }
  if (o.band) ribbon(ctx, hf, b, w, o.bandH ?? 1.3, o.band, { bow: o.bow, buckle: o.buckle, satin: o.satin });
  else edgeShade(ctx, hf, ring.pts, d, t.deep, { w: 0.9, o: 0.32, dy: -0.3 });
  return { d, ring, top, k };
}

function fedora(ctx: LayerCtx, hf: HeadFrame): void {
  const t = tones(ctx.col.hat);
  const w = hf.Wu + 0.9 + hf.bulk * 0.7;
  const b: BrimSpec = { yB: -5.6, R: w + 3.1, r: 1.9, curl: 0.75, dip: 0.85 };
  const bandC = t.dark ? '#3A2E28' : mix(ctx.col.hat, '#0A0812', 0.62);
  brimmedHat(ctx, hf, t, b, w, { top: -14.9, taper: 0.8, dent: 1.0, pinch: 1 }, { band: bandC, bandH: 1.25, bow: true, satin: true });
}

function panama(ctx: LayerCtx, hf: HeadFrame): void {
  const t = tones(PANAMA);
  const w = hf.Wu + 0.9 + hf.bulk * 0.7;
  const b: BrimSpec = { yB: -5.5, R: w + 3.7, r: 2.1, curl: 0.35, dip: 0.75 };
  brimmedHat(ctx, hf, t, b, w, { top: -14.1, taper: 0.78, dent: 0.75, pinch: 0.8 }, { weave: 'panama', band: ctx.col.hat, bandH: 1.15, satin: true, sheen: 0.2 });
}

function straw(ctx: LayerCtx, hf: HeadFrame): void {
  const t = tones(STRAW);
  const w = hf.Wu + 1.0 + hf.bulk * 0.75;
  const b: BrimSpec = { yB: -5.0, R: w + 7.0, r: 2.6, droop: 1.3, dip: 0.35, wave: 0.18, waveN: 7 };
  const g = brimmedHat(ctx, hf, t, b, w, { top: -13.6, taper: 0.86, round: 1 }, { weave: 'straw', band: ctx.col.hat, bandH: 1.45, satin: true, sheen: 0.22 });
  // laço da fita caindo do lado direito
  const rt = tones(ctx.col.hat);
  const [x0, y0] = hf.Q(w * 0.82, g.ring.yS + (g.ring.yC - g.ring.yS) * 0.12 - 0.7);
  const k = hf.s;
  const tail = (dx: number, dy: number) => taperPath([[x0, y0], [x0 + dx * 0.5 * k, y0 + dy * 0.45 * k], [x0 + dx * k, y0 + dy * k]], [1.0 * k, 0.9 * k, 0.75 * k], { round: true });
  const tails = tail(1.4, 3.6) + tail(2.6, 2.9);
  ctx.push(tails, rt.base, { gf: bandGradient(boxOf([[x0, y0], [x0 + 3 * k, y0 + 4 * k]]), rt, 1.2) });
  ctx.push(blob(x0 + 0.2 * k, y0 + 0.1 * k, 0.75 * k, 0.6 * k), rt.shade, {});
}

function cowboy(ctx: LayerCtx, hf: HeadFrame): void {
  const t = tones(ctx.col.hat);
  const w = hf.Wu + 0.9 + hf.bulk * 0.7;
  const b: BrimSpec = { yB: -5.4, R: w + 4.4, r: 2.0, curl: 2.4, dip: 0.95 };
  const g = brimmedHat(ctx, hf, t, b, w, { top: -15.4, taper: 0.84, dent: 1.25, pinch: 1.1, round: 0.6 }, { band: mix(ctx.col.hat, '#2A1608', t.dark ? 0.2 : 0.65), bandH: 0.95, buckle: true, stitchRows: 1 });
  // couro: reflexo especular duro na copa
  if (!hf.lite) ctx.push(taperPath([hf.P(-0.6 * w, g.top + 1.6), hf.P(-0.66 * w, g.top + (g.ring.yS - g.top) * 0.5), hf.P(-0.62 * w, g.ring.yS - 1.6)], [0, 0.55 * hf.s, 0]), t.sheen, { o: 0.2, cp: g.d, b: 0.45 });
}

function topHat(ctx: LayerCtx, hf: HeadFrame): void {
  const t = tones(ctx.col.hat);
  const w = hf.Wu + 0.75 + hf.bulk * 0.6;
  const b: BrimSpec = { yB: -5.8, R: w + 2.5, r: 1.4, curl: 0.95, dip: 0.4 };
  const bandC = t.dark ? '#2C2834' : mix(ctx.col.hat, '#0A0812', 0.55);
  const g = brimmedHat(ctx, hf, t, b, w * 0.94, { top: -18.6, taper: 1.04, flare: 0.25, round: 0.35 }, { band: bandC, bandH: 1.7, satin: true, sheen: 0.18 });
  // seda: faixa de brilho vertical longa do lado da luz
  ctx.push(taperPath([hf.P(-0.55 * w, g.top + 0.6), hf.P(-0.6 * w, g.ring.yS - 3)], [0.9 * hf.s, 0.6 * hf.s]), t.sheen, { o: t.dark ? 0.32 : 0.4, cp: g.d, ...(hf.lite ? {} : { b: 0.35 }) });
  ctx.push(taperPath([hf.P(0.5 * w, g.top + 0.8), hf.P(0.55 * w, g.ring.yS - 3)], [0.5 * hf.s, 0.4 * hf.s]), t.sheen, { o: 0.14, cp: g.d, ...(hf.lite ? {} : { b: 0.3 }) });
}

function witch(ctx: LayerCtx, hf: HeadFrame): void {
  const t = tones(ctx.col.hat);
  const w = hf.Wu + 0.9 + hf.bulk * 0.7;
  const b: BrimSpec = { yB: -5.3, R: w + 6.2, r: 2.3, dip: 0.55, wave: 0.32, waveN: 5 };
  const ring = innerRing(hf, b, w);
  const brim = drawBrim(ctx, hf, b, w, t, {});
  castShadow(ctx, hf, brim.front.slice(2, -2), { w: 2.2, dy: 1.3, o: 0.4, b: 1.0 });
  // cone com a ponta dobrada pra direita (cabe no viewBox: comprime se precisar)
  const yS = ring.yS;
  const tip: SP = hf.P(5.6, -18.8);
  const k = fitTop(Math.min(tip[1], hf.Q(0, -19.6)[1]), hf.Q(0, yS)[1], 0.9);
  const cone: SP[] = [
    hf.P(-w * 0.94, yS, 0),
    hf.P(-w * 0.7, yS - 3.6),
    hf.P(-w * 0.38, yS - 8.0),
    hf.P(-w * 0.1, yS - 11.6),
    hf.P(0.9, yS - 13.9),
    hf.P(3.0, yS - 14.3),
    hf.P(5.6, yS - 13.3, 0),
    hf.P(3.4, yS - 12.9),
    hf.P(1.8, yS - 11.9),
    hf.P(w * 0.22, yS - 9.0),
    hf.P(w * 0.52, yS - 5.0),
    hf.P(w * 0.82, yS - 1.8),
    hf.P(w * 0.94, yS, 0),
    ...bandU(hf, w * 0.94, ring.yC, yS, 7, 2).slice(1, -1),
  ];
  const pts = squash(cone, hf.Q(0, yS)[1], k);
  const d = shapeVolume(ctx, hf, pts, t, { core: 0.42, sheen: 0.26, sheenAt: [0.3, 0.45], sheenR: [0.14, 0.25] });
  // dobras do feltro no cone e na quebra da ponta
  if (!hf.lite) {
    const q = (x: number, y: number) => squash([hf.P(x, y)], hf.Q(0, yS)[1], k)[0];
    ctx.push(taperPath([q(-0.4, yS - 12.2), q(0.6, yS - 9.5), q(0.2, yS - 6.6)], [0, 0.9 * hf.s, 0]) + taperPath([q(1.4, yS - 12.6), q(2.6, yS - 13.2)], [0, 0.6 * hf.s, 0]), t.deep, { o: 0.32, cp: d, b: 0.35 });
    ctx.push(taperPath([q(-1.2, yS - 11.6), q(-0.4, yS - 9.2), q(-0.9, yS - 6.4)], [0, 0.6 * hf.s, 0]), t.lighter, { o: 0.22, cp: d, b: 0.3 });
  }
  const bandC = mix(ctx.col.hat, '#0A0812', 0.55);
  ribbon(ctx, hf, b, w * 0.94, 1.5, bandC, { buckle: true });
}

// ---------------------------------------------------------------------------------------------------------------
// boinas
// ---------------------------------------------------------------------------------------------------------------

function flatcap(ctx: LayerCtx, hf: HeadFrame): void {
  const t = tones(ctx.col.hat);
  const L = 1.0 + hf.bulk * 0.75;
  const w = hf.Wu + L;
  const yC = -4.2;
  const yS = -2.4;
  // corpo: copa baixa de topo chato, um pouco mais larga que a cabeça (lã encorpada)
  const pts = domeU(hf, { lift: L + 0.3, extra: -1.8, yC, yS, flat: 0.8, p: 2.3 });
  castShadow(ctx, hf, bandU(hf, w, yC, yS, 9, 2.3), { w: 1.3, dy: 0.55, o: 0.3 });
  const d = shapeVolume(ctx, hf, pts, t, { core: 0.4, sheen: 0.16 });
  herringbone(ctx, hf, d, boxOf(pts), t, 0.8, 0.16);
  // painel de cima puxado pra frente por cima da aba: pega a luz de cima, borda arredondada que projeta sombra
  const panel: SP[] = [hf.P(-0.93 * w, -4.6), hf.P(-0.78 * w, -6.6), hf.P(-0.4 * w, -7.75), hf.P(0.1 * w, -7.95), hf.P(0.55 * w, -7.55), hf.P(0.86 * w, -6.4), hf.P(0.95 * w, -4.4), hf.P(0.62 * w, -3.55), hf.P(0, -3.2), hf.P(-0.62 * w, -3.55)];
  const pd = smoothPath(panel, true);
  const pb = boxOf(panel);
  ctx.push(taperPath([hf.P(-0.8 * w, -6.4), hf.P(-0.4 * w, -7.55), hf.P(0.1 * w, -7.75), hf.P(0.55 * w, -7.35), hf.P(0.84 * w, -6.2)], [0, 1.1, 1.2, 1.1, 0]), t.deep, { o: 0.42, cp: d, ...(hf.lite ? {} : { b: 0.5 }) });
  ctx.push(pd, t.base, { gf: { t: 'l', x1: pb.x, y1: pb.y, x2: pb.x + pb.w * 0.45, y2: pb.y + pb.h * 1.3, s: [[0, t.light], [0.5, mix(t.base, t.light, 0.3)], [1, t.shade]] } });
  herringbone(ctx, hf, pd, pb, t, 0.8, 0.18);
  ctx.push(pd + smoothPath(shift(panel, -pb.w * 0.12, -0.2), true), t.deep, { r: 'evenodd', o: 0.38, cp: pd, ...(hf.lite ? {} : { b: 0.5 }) });
  if (!hf.lite) ctx.stroke(smoothPath(shift(panel.slice(0, 7), 0.25, 0.35), false), t.lighter, 0.4, { o: 0.3, cp: pd, b: 0.25 });
  stitch(ctx, hf, [hf.P(-0.85 * w, -4.4), hf.P(-0.6 * w, -3.95), hf.P(0, -3.65), hf.P(0.6 * w, -3.95), hf.P(0.88 * w, -4.2)], t.line, { w: 0.14, o: 0.5, cp: pd });
  // botão de pressão no centro do painel
  const [sx, sy] = hf.Q(0, -4.3);
  ctx.push(blob(sx, sy, 0.6 * hf.s, 0.48 * hf.s), t.shade, { gf: { t: 'r', cx: sx - 0.2, cy: sy - 0.2, r: 0.8, s: [[0, t.lighter], [0.6, t.base], [1, t.deep]] } });
  // aba curta e rígida: só a borda aparece embaixo do painel
  const frontEdge: SP[] = [hf.P(-0.8 * w, -3.4, 0.4), hf.P(-0.45 * w, -2.75), hf.P(0, -2.5), hf.P(0.45 * w, -2.75), hf.P(0.8 * w, -3.4, 0.4)];
  const backEdge: SP[] = [hf.P(0.66 * w, -3.75), hf.P(0, -3.35), hf.P(-0.66 * w, -3.75)];
  castShadow(ctx, hf, frontEdge.slice(1, -1), { w: 1.8, dy: 0.95, o: 0.45 });
  const bpts = [...frontEdge, ...backEdge];
  const bill = smoothPath(bpts, true);
  ctx.push(bill, t.shade, { gf: bandGradient(boxOf(bpts), t, 1) });
  edgeShade(ctx, hf, backEdge.map((p) => [p[0], p[1] + 0.15] as SP), bill, t.deep, { w: 0.7, o: 0.55, dy: 0.15 });
  ctx.push(taperPath(shift(frontEdge.slice(1, -1), 0, 0.05), [0.1, 0.4, 0.45, 0.4, 0.1]), t.deep, { o: 0.9 });
}

function beret(ctx: LayerCtx, hf: HeadFrame): void {
  const t = tones(ctx.col.hat);
  const L = 0.6 + hf.bulk * 0.75;
  const w = hf.Wu + L;
  // borda justa inclinada: mais alta à esquerda, desce até perto da orelha direita
  const lo: SP[] = [hf.P(w * 0.98, -2.2, 0), hf.P(w * 0.6, -4.6), hf.P(0, -6.0), hf.P(-w * 0.6, -6.9), hf.P(-w * 0.97, -6.6, 0)];
  castShadow(ctx, hf, lo, { w: 1.2, dy: 0.5, o: 0.3 });
  // disco macio que transborda pro lado direito
  const topU = SKULL_CY - (SKULL_RY + L);
  const disc: SP[] = [
    hf.P(-w * 0.97, -6.6, 0),
    hf.P(-w * 1.05, -8.4),
    hf.P(-w * 0.8, topU + 0.6),
    hf.P(-w * 0.2, topU - 0.75),
    hf.P(w * 0.5, topU - 0.55),
    hf.P(w * 1.2, topU + 1.3),
    hf.P(w * 1.42, -7.4),
    hf.P(w * 1.3, -5.0),
    hf.P(w * 1.08, -3.2),
    ...lo.slice(0, -1),
  ];
  const d = shapeVolume(ctx, hf, disc, t, { core: 0.45, sheen: 0.3, sheenAt: [0.3, 0.2], sheenR: [0.24, 0.12] });
  fleck(ctx, hf, d, boxOf(disc), t.lighter, { n: 60, r: 0.12, seed: 41, op: 0.22 });
  // a borda do disco vira por baixo (sombra) acima do debrum
  ctx.push(taperPath([hf.P(-w * 0.95, -7.4), hf.P(0, -7.0), hf.P(w * 0.75, -5.5), hf.P(w * 1.18, -3.6)], [0, 1.1 * hf.s, 1.3 * hf.s, 0]), t.deep, { o: 0.42, cp: d, ...(hf.lite ? {} : { b: 0.5 }) });
  // debrum (couro) justo na cabeça
  const lo2 = shift(lo, 0, -0.75);
  const rim = [...lo2.slice().reverse(), ...lo];
  const rt = tones(mix(ctx.col.hat, '#0A0812', 0.45));
  ctx.push(smoothPath(rim, true), rt.base, { gf: bandGradient(boxOf(rim), rt, 1) });
  // cabinho no topo
  const [px, py] = hf.Q(w * 0.2, topU - 0.6);
  ctx.push(taperPath([[px, py + 0.2], [px + 0.15, py - 0.5], [px + 0.45, py - 0.9]], [0.5 * hf.s, 0.4 * hf.s, 0.3 * hf.s], { round: true }), t.shade, {});
}

// ---------------------------------------------------------------------------------------------------------------
// coroas e luz
// ---------------------------------------------------------------------------------------------------------------

/** base (y, unidades da cabeça) de um item que senta no topo do cabelo */
function seatY(hf: HeadFrame, k = 0.72): number {
  return -9.5 - hf.hairLift * k;
}

function crown(ctx: LayerCtx, hf: HeadFrame): void {
  const yC = seatY(hf, 0.6) + 0.5;
  const wr = hf.Wu * 0.74;
  const yS = yC - 0.8;
  // altura das pontas (cabe no viewBox)
  const H = 5.0;
  const k = fitTop(hf.Q(0, yC - 1.3 - H)[1], hf.Q(0, yC)[1], 0.6);
  const h = (x: number) => H * k * x;
  const bandH = 1.3 * Math.max(0.75, k);
  const lo = bandU(hf, wr, yC, yS, 9, 2);
  const hi = bandU(hf, wr * 0.99, yC - bandH, yS - bandH, 9, 2).reverse();
  // veludo por dentro (aparece entre as pontas)
  const velvet = smoothPath([...arcU(hf, 0, yS - bandH, wr * 0.92, h(0.7), 180, 0, 9), ...hi.slice().reverse()], true);
  const vt = tones('#8E1257');
  ctx.push(velvet, vt.base, { gf: domeGradient(boxOf(arcU(hf, 0, yS - bandH, wr * 0.92, h(0.7), 180, 0, 9)), vt, 1.2) });
  // pontas: 5 arcos pontudos
  const tops = [-1, -0.5, 0, 0.5, 1];
  const ht = [0.62, 0.8, 1, 0.8, 0.62];
  const pts: SP[] = [];
  const hiL = hi; // esquerda → direita
  const at = (u: number): SP => {
    const i = Math.round(((u + 1) / 2) * (hiL.length - 1));
    return hiL[Math.max(0, Math.min(hiL.length - 1, i))];
  };
  pts.push([at(-1)[0], at(-1)[1] + 0.2, 0]);
  tops.forEach((u, i) => {
    const base = at(u);
    const tipY = base[1] - h(ht[i]);
    pts.push([base[0], tipY, 0]);
    if (i < tops.length - 1) {
      const m = at((u + tops[i + 1]) / 2);
      pts.push([m[0], m[1] - h(0.22)]);
    }
  });
  pts.push([at(1)[0], at(1)[1] + 0.2, 0]);
  const shapePts = [...pts, ...lo];
  const d = smoothPath(shapePts, true);
  const bx = boxOf(shapePts);
  ctx.push(d, '#E0A82A', { gf: metalGrad(bx, GOLD_STOPS) });
  // gravação: friso escuro entre a faixa e as pontas + brilho especular
  ctx.stroke(smoothPath(hi, false), '#7A4E0A', 0.32, { o: 0.75, cp: d });
  ctx.stroke(smoothPath(shift(hi, 0, 0.32), false), '#FFF3C0', 0.22, { o: 0.75, cp: d });
  ctx.push(taperPath(shift(lo.slice(1, -1).reverse(), 0, -bandH * 0.62), [0, 0.35, 0.4, 0.35, 0]), '#FFFBE6', { o: 0.6, cp: d });
  if (!hf.lite) ctx.push(blob(bx.x + bx.w * 0.28, bx.y + bx.h * 0.45, bx.w * 0.1, bx.h * 0.35, 0.2), '#FFFFFF', { o: 0.35, cp: d, b: 0.4 });
  edgeShade(ctx, hf, lo, d, '#5A3606', { w: 0.6, o: 0.45, dy: -0.15 });
  // pérolas nas pontas e gemas na faixa
  tops.forEach((u, i) => {
    const base = at(u);
    pearl(ctx, hf, base[0], base[1] - h(ht[i]) - 0.35 * hf.s, (i === 2 ? 0.62 : 0.5) * hf.s);
  });
  const mid = (u: number) => {
    const a = at(u);
    return [a[0], a[1] + bandH * 0.5 * hf.s] as const;
  };
  const [gx, gy] = mid(0);
  gem(ctx, hf, gx, gy, 0.72 * hf.s, '#2FBF71', { shape: 'oval' });
  for (const u of [-0.55, 0.55]) {
    const [x, y] = mid(u);
    gem(ctx, hf, x, y, 0.55 * hf.s, '#E8157F');
  }
  if (!hf.lite) ctx.push(sparkle(gx - 1.2, gy - 1.6, 0.7), '#FFFFFF', { o: 0.85 });
}

function tiara(ctx: LayerCtx, hf: HeadFrame): void {
  const yC = -8.4 - hf.hairLift * 0.35;
  const w = hf.Wu * 0.82 + hf.bulk * 0.6;
  const yS = yC + 1.6;
  // aro fino que some atrás do cabelo nas laterais (frown: visto de baixo)
  const band = bandU(hf, w, yC, yS, 11, 2).reverse();
  const bandUp = shift(band, 0, -0.42 * hf.s);
  const bt = [...bandUp, ...band.slice().reverse()];
  const bd = smoothPath(bt, true);
  ctx.push(bd, '#D8DEEA', { gf: metalGrad(boxOf(bt), SILVER_STOPS) });
  // filigrana: arcos que sobem até o pico central
  const accent = vivid(ctx.col.hat, '#FF1493');
  const peak = (x: number, hgt: number) => {
    const [px, py] = hf.Q(x, yC - 0.2 + (yS - yC) * Math.pow(Math.abs(x / w), 2));
    return [px, py, hgt] as const;
  };
  let fil = '';
  const centers = [-0.62, -0.32, 0, 0.32, 0.62].map((u) => u * w);
  const hs = [1.1, 1.8, 3.0, 1.8, 1.1];
  centers.forEach((x, i) => {
    const [px, py] = peak(x, 0);
    const H = hs[i] * hf.s;
    const ww = (i === 2 ? 1.25 : 0.95) * hf.s;
    fil += smoothPath([[px - ww, py, 0], [px - ww * 0.55, py - H * 0.55], [px, py - H, 0], [px + ww * 0.55, py - H * 0.55], [px + ww, py, 0]], false);
  });
  ctx.stroke(fil, '#E9EDF6', hf.lite ? 0.45 : 0.32, { gs: metalGrad(boxOf(band.concat([hf.P(0, yC - 3.5)])), SILVER_STOPS) });
  if (!hf.lite) ctx.stroke(fil, '#FFFFFF', 0.12, { o: 0.8 });
  // gemas: grande no centro (cor do chapéu), pequenas nas pontas
  centers.forEach((x, i) => {
    const [px, py] = peak(x, 0);
    const H = hs[i] * hf.s;
    if (i === 2) gem(ctx, hf, px, py - H * 0.45, 0.62 * hf.s, accent, { shape: 'drop' });
    else gem(ctx, hf, px, py - H - 0.12, 0.3 * hf.s, '#EAF6FF', { glint: !hf.lite });
  });
  if (!hf.lite) ctx.push(sparkle(...(hf.Q(-1.6, yC - 3.4) as [number, number]), 0.65) + sparkle(...(hf.Q(2.4, yC - 1.8) as [number, number]), 0.45), '#FFFFFF', { o: 0.9 });
}

function halo(ctx: LayerCtx, hf: HeadFrame): void {
  const [cx0, cyRaw] = hf.Q(0, -12.6 - hf.hairLift * 0.95);
  const cy0 = Math.max(1.9, cyRaw);
  const rx = 5.6 * hf.s;
  const ry = 1.45 * hf.s;
  const ring = `M${cx0 - rx},${cy0}a${rx},${ry} 0 1,0 ${2 * rx},0a${rx},${ry} 0 1,0 ${-2 * rx},0Z`;
  // brilho quente desfocado em volta + anel de ouro claro com miolo de luz
  ctx.stroke(ring, '#FFE27A', 2.6 * hf.s, { o: hf.lite ? 0.2 : 0.38, ...(hf.lite ? {} : { b: 1.3 }) });
  ctx.stroke(ring, '#F2C040', 1.15 * hf.s, { gs: { t: 'l', x1: cx0 - rx, y1: cy0 - ry, x2: cx0 + rx, y2: cy0 + ry, s: [[0, '#FFF7CC'], [0.4, '#FFD75A'], [1, '#C98A12']] } });
  ctx.stroke(ring, '#FFFBEA', 0.38 * hf.s, { o: 0.9 });
  if (!hf.lite) {
    ctx.push(sparkle(cx0 - rx * 0.6, cy0 - ry * 1.1, 0.75) + sparkle(cx0 + rx * 0.85, cy0 + ry * 0.4, 0.5), '#FFFFFF', { o: 0.95 });
    // luz suave que cai no topo da cabeça/cabelo
    ctx.push(blob(cx0, cy0 + 2.6 * hf.s, rx * 0.8, 1.4 * hf.s), '#FFE9A0', { o: 0.18, cp: hf.near, b: 1.2 });
  }
}

function neonCrown(ctx: LayerCtx, hf: HeadFrame): void {
  const c = vivid(ctx.col.hat, '#7FFF00');
  const c2 = c === '#7FFF00' ? '#FF1493' : '#FFD700';
  const yC = seatY(hf, 0.82) - 1.2;
  const wr = hf.Wu * 0.68;
  const H = 4.4;
  const k = fitTop(hf.Q(0, yC - 0.6 - H)[1], hf.Q(0, yC)[1], 1.2);
  const hgt = (f: number) => H * k * f;
  const base = bandU(hf, wr, yC, yC - 0.8, 9, 2).reverse();
  const tops = [-1, -0.5, 0, 0.5, 1];
  const ht = [0.62, 0.82, 1, 0.82, 0.62];
  const zig: SP[] = [];
  tops.forEach((u, i) => {
    const x = u * wr;
    const yb = yC + (-0.8) * Math.pow(Math.abs(u), 2);
    zig.push(hf.P(x, yb - hgt(ht[i])));
    if (i < tops.length - 1) {
      const u2 = (u + tops[i + 1]) / 2;
      zig.push(hf.P(u2 * wr, yC - 0.8 * u2 * u2 - hgt(0.3)));
    }
  });
  const outline = smoothPath([[base[0][0], base[0][1], 0], ...zig.map((p) => [p[0], p[1], 0] as SP), [base[base.length - 1][0], base[base.length - 1][1], 0]], false, 0);
  neon(ctx, hf, smoothPath(base, false), c2, 0.5 * hf.s, { glow: 0.8 });
  neon(ctx, hf, outline, c, 0.55 * hf.s);
  // pontos de luz nas pontas
  let dots = '';
  zig.forEach((p, i) => {
    if (i % 2 === 0) dots += `M${(p[0] - 0.42).toFixed(2)},${p[1].toFixed(2)}a0.42,0.42 0 1,0 0.84,0a0.42,0.42 0 1,0 -0.84,0Z`;
  });
  ctx.push(dots, '#FFFFFF', {});
  if (!hf.lite) {
    ctx.push(dots, c2, { o: 0.55, b: 0.6 });
    ctx.push(blob(hf.cx, hf.Q(0, yC + 1.5)[1], wr * hf.s, 1.4 * hf.s), c, { o: 0.16, cp: hf.near, b: 1.2 });
  }
}

function party(ctx: LayerCtx, hf: HeadFrame): void {
  const t = tones(ctx.col.hat);
  const yC = seatY(hf, 0.75) + 0.5;
  // cone inclinado pra direita, preso por elástico
  const H0 = 10.2;
  const k = fitTop(hf.Q(3.0, yC - H0 - 1.5)[1], hf.Q(0, yC)[1], 0.6);
  // sem espaço no viewBox (corpo alto, black power): primeiro o chapéu fica menor (até 65%), depois inclina um pouco
  // (mantém ~√k do comprimento) — nunca deita de lado
  const sc = k < 1 ? Math.max(0.65, k) : 1;
  const k2 = Math.min(1, k / sc);
  const bw = 4.3 * Math.max(0.8, sc);
  const H = H0 * sc;
  const lean = Math.min(0.5 * H, Math.sqrt(Math.max(0, k2 - k2 * k2)) * H);
  const tip: SP = hf.P(k2 < 1 ? Math.max(3.0 * sc * k2, lean) : 3.0 * sc, yC - H * k2);
  const bl = hf.P(-bw - 0.3, yC + 0.25);
  const br = hf.P(bw - 0.5, yC - 0.45);
  const baseCurve: SP[] = [br, hf.P(bw * 0.4, yC + 0.45), hf.P(-bw * 0.4, yC + 0.6), bl];
  const pts: SP[] = [[bl[0], bl[1], 0], [tip[0], tip[1], 0], [br[0], br[1], 0], ...baseCurve.slice(1, -1)];
  // sombra do cone no cabelo
  ctx.push(blob(hf.cx + 0.6, hf.Q(0, yC + 0.7)[1], bw * hf.s, 0.9 * hf.s), '#120A10', { o: 0.32, cp: hf.near, ...(hf.lite ? {} : { b: 0.6 }) });
  const d = smoothPath(pts, true);
  const bx = boxOf(pts);
  ctx.push(d, t.base, { gf: { t: 'l', x1: bx.x, y1: bx.y, x2: bx.x + bx.w, y2: bx.y + bx.h * 0.4, s: [[0, t.light], [0.45, t.base], [1, t.shade]] } });
  // faixas em espiral (papel metalizado) + confete
  const stripeC = t.pale ? '#FF1493' : '#FFFFFF';
  let st = '';
  for (let i = 1; i <= 3; i++) {
    const f = i / 4;
    const a: SP = [bl[0] + (tip[0] - bl[0]) * f, bl[1] + (tip[1] - bl[1]) * f];
    const b2: SP = [br[0] + (tip[0] - br[0]) * (f - 0.12), br[1] + (tip[1] - br[1]) * (f - 0.12)];
    const w0 = 0.75 * (1 - f * 0.6) * hf.s;
    st += taperPath([a, [(a[0] + b2[0]) / 2, (a[1] + b2[1]) / 2 + 0.3], b2], [w0, w0, w0]);
  }
  ctx.push(st, stripeC, { o: 0.88, cp: d });
  let dots = '';
  const conf: [number, number, string][] = [[0.35, 0.35, '#FFD700'], [0.6, 0.62, '#7FFF00'], [0.3, 0.7, '#00E5FF'], [0.7, 0.3, '#FFD700']];
  for (const [fx, fy] of conf) {
    const x = bx.x + bx.w * fx;
    const y = bx.y + bx.h * fy;
    dots += `M${(x - 0.32).toFixed(2)},${y.toFixed(2)}a0.32,0.32 0 1,0 0.64,0a0.32,0.32 0 1,0 -0.64,0Z`;
  }
  ctx.push(dots, '#FFD700', { o: 0.95, cp: d });
  ctx.push(d + smoothPath(shift(pts, -bx.w * 0.25, 0), true), t.deep, { r: 'evenodd', o: 0.4, cp: d, ...(hf.lite ? {} : { b: 0.4 }) });
  if (!hf.lite) ctx.push(taperPath([[bl[0] + 0.9, bl[1] - 0.6], [tip[0] - 0.5, tip[1] + 1.4]], [0.55, 0.15]), '#FFFFFF', { o: 0.45, cp: d, b: 0.2 });
  // pompom de franjinha na ponta
  const pr = 1.2 * hf.s;
  let fr = '';
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    fr += taperPath([[tip[0], tip[1]], [tip[0] + Math.cos(a) * pr, tip[1] + Math.sin(a) * pr]], [0.5 * hf.s, 0.2 * hf.s], { round: true });
  }
  const pc = t.pale ? '#FF1493' : '#FFD700';
  ctx.push(fr, pc, { gf: { t: 'r', cx: tip[0] - 0.3, cy: tip[1] - 0.3, r: pr * 1.2, s: [[0, mix(pc, '#FFFFFF', 0.5)], [1, mix(pc, '#5A2A00', 0.3)]] } });
}

// ---------------------------------------------------------------------------------------------------------------
// orelhinhas, chifres
// ---------------------------------------------------------------------------------------------------------------

function catEars(ctx: LayerCtx, hf: HeadFrame): void {
  const t = tones(ctx.col.hat);
  const yC = -10.2 - hf.hairLift * 0.55;
  const w = hf.Wu * 0.92 + hf.bulk * 0.7;
  const yS = yC + 3.6;
  // arco fino (tiara) de plástico
  const band = bandU(hf, w, yC, yS, 11, 2).reverse();
  const bt = [...shift(band, 0, -0.5 * hf.s), ...band.slice().reverse()];
  const bandC = t.dark ? '#2A2A34' : t.shade;
  const btn = tones(bandC);
  ctx.push(smoothPath(bt, true), bandC, { gf: bandGradient(boxOf(bt), btn, 1.4) });
  for (const g of [-1, 1] as const) {
    const bx = g * w * 0.5;
    const by = yC + (yS - yC) * 0.25 - 0.2;
    const tilt = g * 0.6;
    const ear: SP[] = [hf.P(bx - 2.0 + tilt * 0.2, by + 0.2, 0.6), hf.P(bx - 1.2 + tilt, by - 2.6), hf.P(bx - 0.1 + tilt * 1.9, by - 4.3, 0.5), hf.P(bx + 0.9 + tilt * 1.2, by - 2.8), hf.P(bx + 2.0 + tilt * 0.2, by + 0.2, 0.6)];
    const inner: SP[] = [hf.P(bx - 1.1 + tilt * 0.3, by - 0.1), hf.P(bx - 0.55 + tilt * 0.9, by - 2.2), hf.P(bx - 0.05 + tilt * 1.7, by - 3.3, 0.5), hf.P(bx + 0.55 + tilt * 1.1, by - 2.2), hf.P(bx + 1.1 + tilt * 0.3, by - 0.1)];
    const d = shapeVolume(ctx, hf, ear, t, { core: 0.4, sheen: 0.3, rim: 0.25 });
    const id = smoothPath(inner, true);
    ctx.push(id, '#F49AB8', { gf: { t: 'l', x1: 0, y1: hf.Q(0, by - 3.3)[1], x2: 0, y2: hf.Q(0, by)[1], s: [[0, '#FFC2D6'], [1, '#D86F93']] } });
    if (!hf.lite) {
      // pelinho: tufos claros saindo da borda interna
      let fur = '';
      for (let i = 0; i < 4; i++) {
        const [fx, fy] = hf.Q(bx - 0.7 + i * 0.45 + tilt * 0.4, by - 0.4 - (i % 2) * 0.4);
        fur += taperPath([[fx, fy], [fx + g * 0.1, fy - 1.1], [fx + g * 0.25, fy - 1.8]], [0.32, 0.22, 0]);
      }
      ctx.push(fur, mix(t.base, '#FFFFFF', 0.7), { o: 0.6, cp: id });
    }
    void d;
  }
}

function horns(ctx: LayerCtx, hf: HeadFrame): void {
  const base = vivid(ctx.col.hat, '#C8102E');
  const t = tones(base);
  const yC = -9.6 - hf.hairLift * 0.62;
  for (const g of [-1, 1] as const) {
    const x0 = g * hf.Wu * 0.46;
    const spine: SP[] = [hf.P(x0, yC + 0.6), hf.P(x0 + g * 0.5, yC - 1.4), hf.P(x0 + g * 1.4, yC - 3.0), hf.P(x0 + g * 2.6, yC - 3.9)];
    const d = taperPath(spine, (u) => 1.55 * hf.s * (1 - u) ** 0.85 + 0.05);
    const bx = boxOf(spine);
    ctx.push(d, t.base, { gf: { t: 'l', x1: bx.x - 1, y1: bx.y, x2: bx.x + bx.w + 1, y2: bx.y + bx.h, s: [[0, t.lighter], [0.35, t.base], [1, t.deep]] } });
    if (!hf.lite) {
      // anéis (sulcos) e brilho especular
      let rings = '';
      for (const f of [0.18, 0.36, 0.54]) {
        const i = f * 3;
        const a = spine[Math.floor(i)];
        const b = spine[Math.min(3, Math.floor(i) + 1)];
        const m: [number, number] = [a[0] + (b[0] - a[0]) * (i % 1), a[1] + (b[1] - a[1]) * (i % 1)];
        const r = 0.78 * hf.s * (1 - f);
        rings += smoothPath([[m[0] - r, m[1] + 0.1], [m[0], m[1] + 0.35 * r], [m[0] + r, m[1] - 0.1]], false);
      }
      ctx.stroke(rings, t.deep, 0.2, { o: 0.55, cp: d });
      ctx.push(taperPath(shift(spine, -0.35 * g, 0).slice(0, 3), [0.45, 0.3, 0]), '#FFFFFF', { o: 0.55, cp: d, b: 0.12 });
    }
    // sombra na raiz (o chifre sai do cabelo)
    ctx.push(blob(hf.Q(x0, yC + 0.6)[0], hf.Q(x0, yC + 0.6)[1], 1.4 * hf.s, 0.45 * hf.s), '#120A10', { o: 0.35, cp: hf.near, ...(hf.lite ? {} : { b: 0.4 }) });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// tecidos enrolados: turbante, durag, hijab
// ---------------------------------------------------------------------------------------------------------------

function turban(ctx: LayerCtx, hf: HeadFrame): void {
  const t = tones(ctx.col.hat);
  const L = 1.6 + hf.bulk * 0.45;
  const w = hf.Wu + L;
  const yC = -4.9;
  const yS = -1.0;
  const pts = domeU(hf, { lift: L, extra: 1.9, yC, yS, flat: 0.25, p: 1.6 });
  castShadow(ctx, hf, bandU(hf, w, yC, yS, 9, 1.6), { w: 1.4, dy: 0.55, o: 0.34 });
  const d = shapeVolume(ctx, hf, pts, t, { core: 0.42, sheen: 0.24 });
  const topU = SKULL_CY - (SKULL_RY + L + 1.9);
  // voltas do tecido: faixas diagonais que cruzam na frente formando um "V" com nó torcido no centro
  const wraps: { spine: SP[]; w: number }[] = [];
  for (let i = 0; i < 4; i++) {
    const f = i / 3;
    const yL = yS - 0.8 - f * 5.8;
    wraps.push({ spine: [hf.P(-w - 0.2, yL), hf.P(-w * 0.55, yL - 1.6 - f * 0.8), hf.P(-0.4, yC - 1.4 - f * 3.4)], w: 2.4 - f * 0.25 });
    wraps.push({ spine: [hf.P(w + 0.2, yL - 0.6), hf.P(w * 0.55, yL - 2.0 - f * 0.8), hf.P(0.4, yC - 1.9 - f * 3.4)], w: 2.4 - f * 0.25 });
  }
  let sh = '';
  let li = '';
  for (const wr of wraps) {
    const ww = wr.w * hf.s;
    sh += taperPath(shift(wr.spine, 0, ww * 0.42), [ww * 0.2, ww * 0.42, ww * 0.12]);
    li += taperPath(shift(wr.spine, -0.1, -ww * 0.2), [ww * 0.15, ww * 0.35, ww * 0.1]);
  }
  ctx.push(sh, t.deep, { o: 0.45, cp: d, ...(hf.lite ? {} : { b: 0.35 }) });
  ctx.push(li, t.lighter, { o: 0.3, cp: d, ...(hf.lite ? {} : { b: 0.4 }) });
  // dobra do topo (o tecido faz uma "coroa" mais clara)
  ctx.push(taperPath([hf.P(-w * 0.75, topU + 2.4), hf.P(-w * 0.2, topU + 0.9), hf.P(w * 0.5, topU + 1.2), hf.P(w * 0.85, topU + 2.8)], [0, 1.2 * hf.s, 1.0 * hf.s, 0]), t.deep, { o: 0.25, cp: d, ...(hf.lite ? {} : { b: 0.5 }) });
  // nó torcido no centro da testa
  const kn: SP[] = [hf.P(-1.35, yC - 0.1), hf.P(-1.55, yC - 2.2), hf.P(-0.6, yC - 3.9), hf.P(0.7, yC - 3.7), hf.P(1.5, yC - 2.0), hf.P(1.3, yC - 0.1), hf.P(0, yC + 0.5)];
  const kd = smoothPath(kn, true);
  ctx.push(kd, t.base, { gf: domeGradient(boxOf(kn), t, 1.3) });
  ctx.push(taperPath([hf.P(-0.9, yC - 0.6), hf.P(0.1, yC - 2.0), hf.P(0.7, yC - 3.4)], [0.2, 0.7 * hf.s, 0.2]), t.deep, { o: 0.5, cp: kd, ...(hf.lite ? {} : { b: 0.2 }) });
  ctx.push(taperPath([hf.P(-1.0, yC - 1.4), hf.P(-0.5, yC - 3.0)], [0.5 * hf.s, 0.1]), t.lighter, { o: 0.45, cp: kd, ...(hf.lite ? {} : { b: 0.2 }) });
  edgeShade(ctx, hf, bandU(hf, w, yC, yS, 9, 1.6), d, t.deep, { w: 0.9, o: 0.32, dy: -0.25 });
}

function durag(ctx: LayerCtx, hf: HeadFrame): void {
  const t = tones(ctx.col.hat);
  const L = 0.45 + hf.bulk * 0.45;
  const w = hf.Wu + L;
  const yC = -5.6;
  const yS = -0.6;
  const pts = domeU(hf, { lift: L, extra: 0.25, yC, yS, p: 1.9 });
  castShadow(ctx, hf, bandU(hf, w, yC, yS, 9, 1.9), { w: 1.0, dy: 0.45, o: 0.3 });
  const bx = boxOf(pts);
  const d = smoothPath(pts, true);
  // cetim: contraste alto, brilhos longos que acompanham a curva
  ctx.push(d, t.base, { gf: { t: 'r', cx: bx.x + bx.w * 0.42, cy: bx.y + bx.h * 0.4, r: bx.w * 0.75, fx: bx.x + bx.w * 0.3, fy: bx.y + bx.h * 0.2, s: [[0, t.lighter], [0.25, t.light], [0.55, t.base], [0.85, t.deep], [1, t.shade]] } });
  ctx.push(d + smoothPath(shift(pts, -bx.w * 0.14, -bx.h * 0.05), true), t.deep, { r: 'evenodd', o: 0.5, cp: d, ...(hf.lite ? {} : { b: 0.5 }) });
  const topU = SKULL_CY - (SKULL_RY + L + 0.25);
  ctx.push(taperPath([hf.P(-w * 0.82, -4.0), hf.P(-w * 0.6, topU + 2.2), hf.P(-w * 0.1, topU + 0.7), hf.P(w * 0.3, topU + 0.9)], [0, 1.0 * hf.s, 0.7 * hf.s, 0]), t.sheen, { o: t.dark ? 0.42 : 0.55, cp: d, ...(hf.lite ? {} : { b: 0.3 }) });
  if (!hf.lite) ctx.push(taperPath([hf.P(w * 0.45, topU + 1.6), hf.P(w * 0.78, -6.5), hf.P(w * 0.82, -3.0)], [0, 0.5 * hf.s, 0]), t.sheen, { o: 0.22, cp: d, b: 0.25 });
  // costura central (da testa ao topo) em relevo
  const seam: SP[] = [hf.P(0, yC - 0.2), hf.P(0.1, -8.4), hf.P(0, topU + 0.2)];
  ctx.stroke(smoothPath(seam, false), t.deep, 0.4, { o: 0.55, cp: d });
  if (!hf.lite) ctx.stroke(smoothPath(shift(seam, -0.35, 0), false), t.sheen, 0.3, { o: 0.35, cp: d, b: 0.12 });
  // aba da testa: tira dobrada de lado a lado
  const lo = bandU(hf, w, yC, yS, 11, 1.9);
  const hi = bandU(hf, w - 0.1, yC - 1.3, yS - 1.0, 11, 1.9).reverse();
  const fp = [...hi, ...lo];
  const fd = smoothPath(fp, true);
  ctx.push(fd, t.base, { gf: bandGradient(boxOf(fp), t, 1.3) });
  ctx.push(taperPath(shift(hi, 0, 0.42), [0, 0.5, 0.6, 0.5, 0]), t.sheen, { o: 0.4, cp: fd, ...(hf.lite ? {} : { b: 0.2 }) });
  edgeShade(ctx, hf, lo.slice().reverse(), fd, t.deep, { w: 0.6, o: 0.4, dy: -0.15 });
}

/** hijab: emoldura o rosto (abertura recortada), cobre orelhas, pescoço e ombros com caimento */
function hijab(ctx: LayerCtx, hf: HeadFrame): void {
  const t = tones(ctx.col.hat);
  const an = ctx.an;
  const ha = hf.ha;
  const chin = ha.chin[1];
  // ---- caimento (corpo): o tecido desce rente ao pescoço, acompanha o trapézio e cobre o ombro como uma capinha,
  // com a barra em curva mais baixa na frente; a ponta da direita cruza por baixo do queixo e cai sobre o ombro
  // esquerdo (camada de cima com sombra na borda). Dobras em "U" (drapeado) embaixo do queixo.
  const cx = an.cx;
  const nk = an.w.neck;
  const sh = an.w.shoulder;
  const hemC = an.armpitY + 6.4;
  const jawX = (hf.Ju + 1.5) * hf.s;
  const side = (sg: -1 | 1): SP[] => {
    const p = torsoProfile(an, sg < 0 ? 'L' : 'R');
    const o = (q: SP, d: number, dy: number, sm?: number): SP => (sm == null ? [q[0] + sg * d, q[1] + dy] : [q[0] + sg * d, q[1] + dy, sm]);
    const hemS = Math.max(p[5][1] + 3.2, an.armpitY - 0.6) + (sg < 0 ? 0.7 : 0);
    // de cima (junto da mandíbula) pra baixo (barra no meio do peito)
    return [
      // começa EM CIMA do contorno da moldura (canto vivo pra dentro: nada de aba saltando pra fora)
      [cx + sg * (hf.Cu + 1.25) * hf.s, hf.Q(0, 7.0)[1], 0],
      [cx + sg * (hf.Ju + 1.6) * hf.s, hf.Q(0, hf.chinU + 1.6)[1]],
      // o tecido cai quase reto da mandíbula pro trapézio (não marca o pescoço)
      [cx + sg * Math.max(nk + 2.6, (hf.Ju + 1.2) * hf.s), p[0][1] + 1.0],
      o(p[2], 1.0, -0.8),
      o(p[3], 1.0, -0.8),
      o(p[4], 1.0, -0.7),
      o(p[5], 1.1, 0.4),
      [p[5][0] + sg * 0.5, hemS, 0.7],
      [cx + sg * sh * 0.58, an.armpitY + 3.6 + (sg < 0 ? 0.8 : 0)],
      [cx + sg * sh * 0.22, hemC - 0.5 + (sg < 0 ? 0.5 : 0)],
    ];
  };
  const L0 = side(-1);
  const R0 = side(1);
  const drape: SP[] = [...L0, [cx + 0.4, hemC + 0.25], ...R0.slice().reverse(), [cx + hf.Ju * 0.7 * hf.s, chin + 0.5], [cx + 0.3, chin + 1.4], [cx - hf.Ju * 0.7 * hf.s, chin + 0.5]];
  // ---- moldura da cabeça (grupo head): contorno externo com volume e abertura do rosto
  // contorno: redondo no crânio, afina pela maçã até a mandíbula (sem "capuz" reto) e some dentro do caimento
  const L = 1.0 + hf.bulk * 0.3;
  const Wo = hf.Wu + L;
  const outer: SP[] = [
    hf.P(0, CROWN_TOP - L),
    hf.P(Wo * 0.64, CROWN_TOP - L + 1.2),
    hf.P(Wo * 0.96, SKULL_CY - 4.0),
    hf.P(Wo + 0.05, SKULL_CY + 0.6),
    hf.P(hf.Cu + 1.6, 3.2),
    hf.P(hf.Cu + 1.25, 7.0),
    hf.P(hf.Ju + 1.6, hf.chinU + 1.6),
    hf.P(0, hf.chinU + 3.4),
    hf.P(-hf.Ju - 1.6, hf.chinU + 1.6),
    hf.P(-hf.Cu - 1.25, 7.0),
    hf.P(-hf.Cu - 1.6, 3.2),
    hf.P(-Wo - 0.05, SKULL_CY + 0.6),
    hf.P(-Wo * 0.96, SKULL_CY - 4.0),
    hf.P(-Wo * 0.64, CROWN_TOP - L + 1.2),
  ];
  // abertura: da testa (logo abaixo da linha do cabelo) pelas laterais do rosto até embaixo do queixo
  const fy = -6.5;
  const face: SP[] = [
    hf.P(0, fy),
    hf.P(-hf.Tu * 0.62, fy + 0.65),
    hf.P(-hf.Tu * 0.93, -3.0),
    hf.P(-hf.Cu * 0.95, 1.6),
    hf.P(-hf.Cu * 0.9, 5.4),
    hf.P(-hf.Ju * 0.86, hf.chinU - 3.0),
    hf.P(-hf.Ju * 0.5, hf.chinU - 0.2),
    hf.P(0, hf.chinU + 0.75),
    hf.P(hf.Ju * 0.5, hf.chinU - 0.2),
    hf.P(hf.Ju * 0.86, hf.chinU - 3.0),
    hf.P(hf.Cu * 0.9, 5.4),
    hf.P(hf.Cu * 0.95, 1.6),
    hf.P(hf.Tu * 0.93, -3.0),
    hf.P(hf.Tu * 0.62, fy + 0.65),
  ];
  const od = smoothPath(outer, true);
  const fd = smoothPath(face, true);
  const frame = od + fd;
  const bx = boxOf(outer);
  ctx.push(frame, t.base, { r: 'evenodd', gf: domeGradient(bx, t, 1) });
  // sombra própria do lado direito (o tecido vira pra longe da luz) e luz no alto da cabeça
  ctx.push(od + smoothPath(shift(outer, -bx.w * 0.14, -bx.h * 0.04), true), t.deep, { r: 'evenodd', o: 0.42, cp: od, ...(hf.lite ? {} : { b: 0.7 }) });
  ctx.push(blob(hf.cx - Wo * 0.3 * hf.s, hf.Q(0, CROWN_TOP - L + 3.2)[1], Wo * 0.42 * hf.s, 2.4 * hf.s, -0.2), t.lighter, { o: 0.18, cp: od, ...(hf.lite ? {} : { b: 1.0 }) });
  // borda interna dobrada (o tecido vira em volta do rosto): faixa um tom acima com aresta de luz e sombra no rosto
  const innerBand = smoothPath(face, true);
  const ring2 = smoothPath(offsetFace(face, 0.9 * hf.s), true);
  // a borda dobrada pega luz em cima/à esquerda e some embaixo (gradiente no anel)
  ctx.push(ring2 + innerBand, t.light, { r: 'evenodd', o: 0.7, gf: { t: 'l', x1: hf.cx - 6, y1: hf.Q(0, fy)[1], x2: hf.cx + 4, y2: hf.Q(0, hf.chinU)[1], s: [[0, t.lighter], [0.5, t.light], [1, t.base]] } });
  if (!hf.lite) ctx.stroke(innerBand, t.lighter, 0.25, { o: 0.35, b: 0.15 });
  // sombra que a moldura faz no rosto (recortada na cabeça)
  ctx.stroke(innerBand, '#140A10', 1.4 * hf.s, { o: 0.3, cp: hf.head, ...(hf.lite ? {} : { b: 0.6 }) });
  // dobras: do alto da cabeça descendo pelas laterais e embaixo do queixo
  const folds: { spine: SP[]; w: number }[] = [
    { spine: [hf.P(-Wo * 0.55, CROWN_TOP - L + 2.2), hf.P(-Wo * 0.9, SKULL_CY + 1.5), hf.P(-hf.Cu - 1.2, 6.5)], w: 1.0 },
    { spine: [hf.P(Wo * 0.5, CROWN_TOP - L + 2.0), hf.P(Wo * 0.92, SKULL_CY + 1.2), hf.P(hf.Cu + 1.3, 6.8)], w: 1.2 },
    { spine: [hf.P(-hf.Ju * 0.6, hf.chinU + 2.2), hf.P(0.2, hf.chinU + 3.0), hf.P(hf.Ju * 0.7, hf.chinU + 2.0)], w: 0.9 },
  ];
  let vs = '';
  for (const f of folds) vs += taperPath(f.spine, [0, f.w * hf.s, f.w * 0.6 * hf.s, 0]);
  ctx.push(vs, t.deep, { o: 0.34, cp: od, ...(hf.lite ? {} : { b: 0.5 }) });
  // ---- caimento por cima da moldura: a borda de cima passa por baixo do queixo e esconde o fim da moldura
  ctx.withGroup('body', () => {
    const dd = smoothPath(drape, true);
    const bx = boxOf(drape);
    ctx.push(dd, t.base, { gf: { t: 'r', cx: bx.x + bx.w * 0.36, cy: bx.y + bx.h * 0.2, r: bx.w * 0.75, fx: bx.x + bx.w * 0.3, fy: bx.y, s: [[0, t.light], [0.5, t.base], [1, t.shade]] } });
    // sombra que a cabeça faz no tecido embaixo do queixo
    ctx.push(blob(cx + 0.6, chin + 2.0, hf.Ju * hf.s * 1.05, 2.6), t.deep, { o: 0.45, cp: dd, ...(hf.lite ? {} : { b: 1.0 }) });
    // drapeado: dobras em U que pendem entre os dois lados do pescoço (vale escuro embaixo, crista clara em cima)
    let vs = '';
    let rs = '';
    for (let i = 0; i < 3; i++) {
      const y0 = chin + 2.6 + i * 2.1;
      const hw = nk + 0.6 + i * 1.5;
      const sag = 2.0 + i * 0.9;
      const spine: SP[] = [[cx - hw, y0], [cx - hw * 0.45, y0 + sag * 0.85], [cx + 0.5, y0 + sag], [cx + hw * 0.5, y0 + sag * 0.8], [cx + hw, y0 - 0.2]];
      const w = 0.95 - i * 0.12;
      vs += taperPath(spine, [0, w * 0.8, w, w * 0.8, 0]);
      rs += taperPath(shift(spine, 0, -0.75), [0, w * 0.6, w * 0.75, w * 0.6, 0]);
    }
    // dobras do ombro: do pescoço descendo pela capinha
    for (const sg of [-1, 1] as const) {
      const P0 = sg < 0 ? L0 : R0;
      const sp: SP[] = [[cx + sg * (nk + 1.2), P0[2][1] + 1.6], [(P0[4][0] + cx + sg * nk) / 2, P0[5][1] + 1.6], [P0[6][0] - sg * 1.6, P0[7][1] - 0.6]];
      vs += taperPath(sp, [0, 0.9, 0.7, 0]);
      rs += taperPath(shift(sp, -0.6, -0.5), [0, 0.7, 0.5, 0]);
    }
    ctx.push(vs, t.deep, { o: 0.4, cp: dd, ...(hf.lite ? {} : { b: 0.5 }) });
    if (!hf.lite) ctx.push(rs, t.lighter, { o: 0.26, cp: dd, b: 0.5 });
    // ponta cruzada: sai de baixo do queixo à direita e cai em diagonal sobre o ombro esquerdo até a barra
    const wrap: SP[] = [
      [cx + jawX * 0.85, chin - 0.4],
      [cx + jawX * 0.35, chin + 2.6],
      [cx - nk * 0.6, chin + 6.2],
      [L0[5][0] + 1.6, L0[5][1] + 2.4],
      L0[6],
      L0[7],
      L0[8],
      L0[9],
      [cx + 0.4, hemC + 0.25],
      [cx + sh * 0.12, hemC - 1.2],
      [cx + 0.6, chin + 8.4],
      [cx + jawX * 0.6, chin + 3.6],
    ];
    const wd = smoothPath(wrap, true);
    const edge = wrap.slice(0, 5);
    // sombra que a ponta faz no tecido de baixo (desce à direita da borda)
    if (!hf.lite) ctx.push(taperPath(shift(edge, 0.7, 0.9), [0, 1.1, 1.4, 1.2, 0]), t.deep, { o: 0.4, cp: dd, b: 0.7 });
    ctx.push(wd, t.base, { cp: dd, gf: { t: 'l', x1: cx - sh * 0.7, y1: chin, x2: cx + sh * 0.3, y2: hemC, s: [[0, t.lighter], [0.45, t.light], [1, t.base]] } });
    // dobras diagonais da ponta (acompanham a borda)
    let wv = '';
    for (let i = 1; i <= 2; i++) wv += taperPath(shift(edge.slice(1), -1.2 * i, 1.9 * i), [0, 0.8, 0.9, 0]);
    ctx.push(wv, t.deep, { o: 0.3, cp: wd, ...(hf.lite ? {} : { b: 0.45 }) });
    // aresta de luz na borda da ponta
    if (!hf.lite) ctx.stroke(smoothPath(shift(edge, -0.25, 0.1), false), t.lighter, 0.35, { o: 0.45, cp: wd, b: 0.12 });
    // barra: borda virada com uma luz fina e sombra no avesso
    const hem: SP[] = [...L0.slice(6), [cx + 0.4, hemC + 0.25], ...R0.slice(6).reverse()];
    if (!hf.lite) ctx.stroke(smoothPath(hem.map((p) => [p[0], p[1] - 0.35] as SP), false), t.lighter, 0.3, { o: 0.32, cp: dd, b: 0.15 });
    edgeShade(ctx, hf, hem, dd, t.deep, { w: 0.8, o: 0.3, dy: -0.3 });
  });
  // alfinete na lateral: haste dourada entrando no tecido + cabeça de pérola com sombrinha
  if (!hf.lite) {
    const [px, py] = hf.Q(hf.Cu + 0.6, 7.2);
    ctx.push(blob(px + 0.25, py + 0.35, 0.45 * hf.s, 0.35 * hf.s), t.deep, { o: 0.4, b: 0.3 });
    ctx.stroke(`M${(px - 1.1 * hf.s).toFixed(2)},${(py + 0.55 * hf.s).toFixed(2)}L${px.toFixed(2)},${py.toFixed(2)}`, '#D4A437', 0.14 * hf.s, { o: 0.9 });
    pearl(ctx, hf, px, py, 0.42 * hf.s);
  }
}

/** contorno da abertura do rosto empurrado pra fora (borda dobrada) */
function offsetFace(face: readonly SP[], d: number): SP[] {
  let cx = 0;
  let cy = 0;
  for (const p of face) {
    cx += p[0];
    cy += p[1];
  }
  cx /= face.length;
  cy /= face.length;
  return face.map((p) => {
    const dx = p[0] - cx;
    const dy = p[1] - cy;
    const L = Math.hypot(dx, dy) || 1;
    return [p[0] + (dx / L) * d, p[1] + (dy / L) * d] as SP;
  });
}

const CROWN_TOP = SKULL_CY - SKULL_RY;

// ---------------------------------------------------------------------------------------------------------------

/**
 * topo e lateral (cabeça unitária, acima do crânio / além da largura do crânio) dos chapéus justos, pro arco do fone
 * passar por cima (headwear-acc.ts). Mantenha junto com as medidas de cada chapéu acima.
 */
export const HAT_TOP: Record<string, (bulk: number) => { top: number; side: number }> = {
  cap: (b) => ({ top: 1.35 + 0.8 * b, side: 0.85 + 0.8 * b }),
  cap_back: (b) => ({ top: 1.35 + 0.8 * b, side: 0.85 + 0.8 * b }),
  beanie: (b) => ({ top: 2.5 + 0.85 * b, side: 1.4 + 0.85 * b }),
  flatcap: (b) => ({ top: Math.max(0.2, -0.5 + 0.75 * b), side: 1.3 + 0.75 * b }),
  durag: (b) => ({ top: 0.7 + 0.45 * b, side: 0.45 + 0.45 * b }),
  turban: (b) => ({ top: 3.5 + 0.45 * b, side: 1.6 + 0.45 * b }),
  hijab: (b) => ({ top: 1.0 + 0.3 * b, side: 1.3 + 0.3 * b }),
};

export const HATS: Record<string, HatFn> = {
  cap: (c, h) => cap(c, h, false),
  cap_back: (c, h) => cap(c, h, true),
  beanie,
  bucket,
  headband,
  straw,
  crown,
  fedora,
  flatcap,
  beret,
  panama,
  cowboy,
  party,
  turban,
  hijab,
  durag,
  tiara,
  top_hat: topHat,
  witch,
  cat_ears: catEars,
  horns,
  halo,
  neon_crown: neonCrown,
};
