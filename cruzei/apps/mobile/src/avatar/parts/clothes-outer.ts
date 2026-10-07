// Sobreposições (slot `outer`, cor ctx.col.outer): blazer, cardigã, colete, jaqueta jeans, de couro, bomber, college,
// sobretudo, puffer, kimono, capa de herói, ombreiras mecha e manto real. Dono: guarda-roupa (parte de cima).
//
// A peça aberta é o contorno do tronco com folga maior, cortado no meio por uma curva de abertura (V das lapelas, frente
// aberta da jaqueta): dois painéis por cima da parte de cima, que aparece no vão. Mangas longas por cima das da parte de
// cima (que nem são desenhadas), começando na linha do ombro da peça. Capa e manto têm costas (etapa 5, atrás do corpo).

import { smoothPath, taperPath, torsoPts, torsoXAt, type Anatomy, type Side, type SP } from '../anatomy';
import type { LayerCtx } from '../ctx';
import { fmt } from '../geometry';
import { blob, isLite, leather, lodCtx, lum, metal, mix, starPath, weave } from '../shading';
import type { Pt } from '../types';

import {
  FRONT_OUTERS,
  NONE,
  SIDES,
  armG,
  boxOf,
  buttons,
  chestPocket,
  coverHip,
  hemFinish,
  og,
  outerDef,
  rng,
  shadeTorso,
  shoulderChain,
  sleeveLower,
  sleeveUpper,
  threadOf,
  toneOf,
  torsoGrad,
  type Cut,
  type OuterDef,
  type SleeveSpec,
  type Tone,
} from './clothes-kit';
import { lapels, mockCollar, shirtCollar } from './clothes-tops';
import { curvesSurface, flagFolds, surfacePath, type FlagFold, type FlagSurface } from './flags';

// ===============================================================================================================
// Corte: contorno com folga, barra, abertura da frente e painéis
// ===============================================================================================================

interface OuterCut extends Cut {
  /** painéis esquerdo e direito (paths) e a união dos dois (recorte) */
  left: string;
  right: string;
  /** meia-abertura da frente em função do y */
  gap: (y: number) => number;
}

/** barra da sobreposição (y): quadril + n; sentado, no colo */
function outerHemY(an: Anatomy, o: OuterDef): number {
  const y = Math.max(an.hipY + o.hem, an.waistY + 4);
  return an.seated ? Math.min(y, an.hj + 1.2) : y;
}

/** meia-abertura da frente por peça (V das lapelas até o botão, frente aberta da jaqueta…) */
function gapFn(an: Anatomy, id: string, hemY: number): (y: number) => number {
  const top = an.collarY - 2.6;
  const cw = an.collarW;
  const lin = (y: number, y0: number, g0: number, y1: number, g1: number) => g0 + (g1 - g0) * Math.max(0, Math.min(1, (y - y0) / (y1 - y0 || 1)));
  switch (id) {
    case 'blazer':
    case 'trench': {
      // V das lapelas até o botão; abaixo dele as frentes se abrem só um pouco (cutaway)
      const yb = id === 'trench' ? an.waistY - 1.0 : an.waistY - 1.6;
      return (y) => (y < yb ? lin(y, top, cw - 0.4, yb, 0) : lin(y, yb, 0, hemY, id === 'trench' ? 1.2 : 2.2));
    }
    case 'vest': {
      const yb = an.waistY - 3.5;
      return (y) => (y < yb ? lin(y, top, cw - 0.2, yb, 0) : lin(y, yb, 0, hemY, 0.4));
    }
    case 'cardigan': {
      const yb = an.waistY - 0.5;
      return (y) => (y < yb ? lin(y, top, cw - 0.6, yb, 0.6) : 0.6);
    }
    case 'kimono':
      return (y) => lin(y, top, cw + 0.4, hemY, 2.6);
    case 'puffer':
      return (y) => lin(y, top, 0.4, hemY, 1.2);
    default:
      // jaquetas abertas: frente aberta mostrando a parte de cima
      return (y) => lin(y, top, cw - 0.6, an.waistY, an.w.waist * 0.32 + 0.8) + (y > an.waistY ? (y - an.waistY) * 0.05 : 0);
  }
}

/** subdivide um contorno fechado (pra recortar curvas sem perder a forma) */
function densify(pts: readonly SP[], k: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    for (let j = 0; j < k; j++) out.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
  }
  return out;
}

/** tira pontos colados (< 1,4) do contorno: o painel é recorte de muitas camadas, cada ponto custa em todas */
function thin(pts: readonly SP[]): SP[] {
  const out: SP[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || p.length > 2 || q.length > 2 || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1.4) out.push(p);
  }
  return out;
}

/**
 * recorta um contorno fechado pelo lado de uma curva x = cx ± gap(y) (Sutherland–Hodgman com função): o trecho que cai
 * na fronteira segue a curva (amostrada), não uma reta.
 */
function clipSide(pts: readonly Pt[], cx: number, gap: (y: number) => number, g: number): SP[] {
  const f = (p: Pt) => g * (p[0] - cx) - gap(p[1]);
  const out: { p: Pt; edge: boolean }[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    const fp = f(p);
    const fq = f(q);
    if (fp >= 0) out.push({ p, edge: false });
    if (fp >= 0 !== fq >= 0) {
      const t = fp / (fp - fq);
      out.push({ p: [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t], edge: true });
    }
  }
  const res: SP[] = [];
  for (let i = 0; i < out.length; i++) {
    const a = out[i];
    const b = out[(i + 1) % out.length];
    res.push(a.edge ? [a.p[0], a.p[1], 0.3] : a.p);
    if (a.edge && b.edge && Math.abs(b.p[1] - a.p[1]) > 2.4) {
      const m = Math.ceil(Math.abs(b.p[1] - a.p[1]) / 2.4);
      for (let j = 1; j < m; j++) {
        const y = a.p[1] + ((b.p[1] - a.p[1]) * j) / m;
        res.push([cx + g * gap(y), y]);
      }
    }
  }
  return res;
}

/** prolonga o contorno até a barra longa: laterais retas abrindo em A e barra levemente curva */
function extendLong(an: Anatomy, raw: SP[], hemY: number): SP[] {
  const neck = raw.slice(-3);
  const body = raw.slice(0, -3);
  let iHem = 0;
  for (let i = 0; i < body.length; i++) if (body[i][1] > body[iHem][1]) iHem = i;
  // pontos da barra curta (os mais baixos, perto do meio) saem; ficam as laterais
  const yCut = body[iHem][1] - 1.6;
  const left = body.slice(0, iHem).filter((p) => p[1] < yCut);
  const right = body.slice(iHem).filter((p) => p[1] < yCut);
  const lb = left[left.length - 1];
  const rb = right[0];
  const k = (hemY - lb[1]) * 0.1;
  const tl = an.tilt.hip * 0.3;
  const hem: SP[] = [
    [lb[0] - k * 0.5, (lb[1] + hemY) / 2],
    [lb[0] - k, hemY - 0.6 - tl, 0.6],
    [an.cx - (an.cx - lb[0]) * 0.5, hemY + 0.5],
    [an.cx, hemY + 0.7],
    [an.cx + (rb[0] - an.cx) * 0.5, hemY + 0.5],
    [rb[0] + k, hemY - 0.6 + tl, 0.6],
    [rb[0] + k * 0.5, (rb[1] + hemY) / 2],
  ];
  return [...left, ...hem, ...right, ...neck];
}

function outerCut(ctx: LayerCtx, id: string, o: OuterDef): OuterCut {
  const { an } = ctx;
  const ease = o.ease * (an.bodyId === 'broad' ? 0.8 : 1);
  const hemY = outerHemY(an, o);
  const color = ctx.col.outer;
  const tone = toneOf(color, o.mat);
  const belly = Math.min(1, an.spec.belly / 3);
  const curvy = an.w.hip - an.w.waist > 5;
  const drape = (id === 'puffer' || id === 'bomber' ? 1 : 0.85) * (an.spec.belly > 1.5 ? 0.45 : curvy ? 0.5 : 1);
  const long = hemY > an.torsoBottom - 1;
  let raw = torsoPts(an, { bottom: long ? an.torsoBottom - 1 : hemY, ease, hem: an.seated ? 1.1 : 0.7 - belly * 1.2, collar: true, drape, round: long ? 0 : 1.0 });
  raw = coverHip(an, raw);
  // peças longas (sobretudo, kimono): abaixo do quadril caem retas e abrem em A até a barra (sem afunilar)
  if (long) raw = extendLong(an, raw, hemY);
  const pts = raw.slice(0, -3); // sem o decote careca: a abertura da frente faz o decote
  const gap = gapFn(an, id, hemY);
  const dense = densify(pts, 2);
  const left = smoothPath(thin(clipSide(dense, an.cx, gap, -1)));
  const right = smoothPath(thin(clipSide(dense, an.cx, gap, 1)));
  return { pts: raw, d: left + right, left, right, gap, neck: '', neckPts: [], hemY, ease, grad: torsoGrad(an, tone, o.mat, ease), tone, color, mat: o.mat };
}

// ===============================================================================================================
// Frente
// ===============================================================================================================

export function drawOuter(ctx0: LayerCtx): void {
  const ctx = lodCtx(ctx0);
  const id = ctx.cfg.outer;
  const o = outerDef(ctx.cfg);
  if (!o || !id || id === NONE || prideCapeReplaces(ctx)) return;
  ctx.group('body');
  if (id === 'cape') return capeFront(ctx);
  if (id === 'mantle') return mantleFront(ctx);
  if (id === 'mecha') return mechaHarness(ctx);
  frontOuter(ctx, id, o);
}

/**
 * capa do orgulho + capa/manto na sobreposição: a do orgulho substitui (as duas juntas sobravam um filete de arco-íris
 * contornando a capa lisa, que lia como falha)
 */
function prideCapeReplaces(ctx: LayerCtx): boolean {
  return ctx.cfg.pride === 'cape' && (ctx.cfg.outer === 'cape' || ctx.cfg.outer === 'mantle');
}

/**
 * abertura da frente da sobreposição (o vão entre os painéis, da gola até a barra) — a gravata desce DENTRO dela e
 * termina onde a frente fecha. null = sem sobreposição de frente
 */
export function outerOpening(ctx: LayerCtx): { gap: (y: number) => number; top: number; hemY: number } | null {
  const id = ctx.cfg.outer;
  const o = outerDef(ctx.cfg);
  if (!o || !id || !FRONT_OUTERS.has(id)) return null;
  const hemY = outerHemY(ctx.an, o);
  return { gap: gapFn(ctx.an, id, hemY), top: ctx.an.collarY - 2.6, hemY };
}

function frontOuter(ctx: LayerCtx, id: string, o: OuterDef): void {
  const { an } = ctx;
  const { cx } = an;
  const lite = isLite(ctx);
  const cut = outerCut(ctx, id, o);
  const c = cut.color;
  const t = cut.tone;
  // sombra da sobreposição sobre a parte de cima, ao longo da abertura (a peça tem espessura)
  const edge = (g: number): SP[] => {
    const ys: SP[] = [];
    for (let y = an.collarY - 2; y < cut.hemY; y += 2) ys.push([cx + g * (cut.gap(y) - 0.1), y]);
    return ys;
  };
  ctx.push(taperPath(edge(-1).map((p) => [p[0] + 0.9, p[1]] as SP), (k) => 1.4 * Math.sin(Math.PI * Math.min(1, k * 1.2))) + taperPath(edge(1).map((p) => [p[0] - 0.9, p[1]] as SP), (k) => 1.4 * Math.sin(Math.PI * Math.min(1, k * 1.2))), '#0A0610', { o: 0.32, ...(lite ? {} : { b: 0.6 }) });
  // painéis
  if (id === 'varsity' || id === 'puffer' || id === 'bomber' || id === 'denim' || id === 'leather' || id === 'kimono') {
    ctx.push(cut.d, c, { gf: cut.grad });
  } else ctx.push(cut.d, c, { gf: cut.grad });
  // material
  if (o.mat === 'denim' && !lite) weave(ctx, cut.d, boxOf(cut.pts), c, { gap: 0.8, o: 0.07, light: true });
  if (o.mat === 'knit' && !lite) {
    const bb = boxOf(cut.pts);
    let col = '';
    for (let x = bb.x + 0.4; x < bb.x + bb.w; x += 1.1) col += `M${fmt(x)},${fmt(bb.y)}V${fmt(bb.y + bb.h)}`;
    ctx.stroke(col, t.deep, 0.13, { o: 0.2, cp: cut.d });
  }
  if (id === 'kimono') kimonoPattern(ctx, cut);
  if (id === 'puffer') pufferBaffles(ctx, cut);
  shadeTorso(ctx, cut, { folds: o.mat === 'nylon' || o.mat === 'leather' ? 'crisp' : o.mat === 'satin' ? 'flow' : 'soft', rim: o.mat === 'leather' ? 1.3 : 1 });
  if (o.mat === 'leather') {
    for (const p of [cut.left, cut.right]) leather(ctx, p, boxOf(cut.pts), c);
  }
  if (o.mat === 'nylon') ctx.push(blob(cx - an.w.chest * 0.55, an.armpitY + 3, an.w.chest * 0.3, 6, 0.15), '#FFFFFF', { o: 0.2, ...(lite ? {} : { b: 1.0 }), cp: cut.d });
  // borda da abertura (vista com espessura: luz fina na beira do painel esquerdo, sombra no direito)
  for (const g of [-1, 1]) {
    const e = edge(g);
    ctx.stroke(smoothPath(e, false), g < 0 ? t.light : t.deep, 0.35, { o: 0.45, cp: g < 0 ? cut.left : cut.right });
  }
  // barra
  const band = id === 'bomber' || id === 'varsity' ? 'rib' : id === 'cardigan' ? 'rib' : id === 'denim' ? 'band' : id === 'leather' ? 'band' : 'hem';
  hemFinish(ctx, cut, band, id === 'varsity' ? varsityRib(c) : undefined);
  if (id === 'varsity' && !lite) {
    // listras da ribana
    const yb = cut.hemY - 1.0;
    ctx.stroke(smoothPath([[torsoXAt(an, 'L', yb, cut.ease), yb], [cx, yb + 0.3], [torsoXAt(an, 'R', yb, cut.ease), yb]], false), c, 0.4, { cp: cut.d });
  }
  // gola, lapelas e detalhes por peça
  switch (id) {
    case 'blazer': {
      lapels(ctx, cut, an.waistY - 1.6, {});
      buttons(ctx, [[cx - 0.2, an.waistY - 0.6]], 0.55, mix(c, '#1A1410', 0.45), { cp: cut.d });
      flapPockets(ctx, cut, an.waistY + 3.2, 2.6);
      ctx.stroke(`M${fmt(cx + an.w.chest * 0.32)},${fmt(an.armpitY + 1.4)}h${fmt(3.2)}`, t.deep, 0.5, { o: 0.5, cp: cut.d });
      break;
    }
    case 'trench': {
      lapels(ctx, cut, an.waistY - 1.0, { peak: false });
      // fileira dupla de botões e cinto com fivela
      const ys = [an.armpitY + 3, an.waistY - 2.2];
      buttons(ctx, ys.flatMap((y) => [[cx - 2.4, y], [cx + 2.4, y]] as Pt[]), 0.55, mix(c, '#2A1A10', 0.55), { cp: cut.d });
      belt(ctx, cut, an.waistY + 0.4, c, t);
      flapPockets(ctx, cut, an.waistY + 4.5, 3.0);
      break;
    }
    case 'vest': {
      const ys: Pt[] = [];
      for (let i = 0; i < 4; i++) ys.push([cx + 0.15, an.waistY - 3.5 + i * 2.1]);
      buttons(ctx, ys, 0.42, mix(c, '#1A1410', 0.4), { cp: cut.d });
      for (const g of [-1, 1]) ctx.stroke(`M${fmt(cx + g * an.w.waist * 0.6 - 1.5)},${fmt(an.waistY + 0.6)}h3`, t.deep, 0.45, { o: 0.55, cp: cut.d });
      // ponta da frente (bico) abaixo do último botão
      break;
    }
    case 'cardigan': {
      // vista dos botões nas duas bordas da frente
      const yb = an.waistY - 0.5;
      const ps: Pt[] = [];
      for (let i = 0; i < 4; i++) {
        const y = yb - 9 + i * 3.6;
        if (y > an.collarY + 1) ps.push([cx - cut.gap(y) - 0.9, y]);
      }
      for (const g of [-1, 1]) ctx.stroke(smoothPath(edge(g).map((p) => [p[0] - g * 0.8, p[1]] as SP), false), mix(c, '#000000', 0.15), 1.4, { o: 0.6, cp: g < 0 ? cut.left : cut.right });
      buttons(ctx, ps, 0.45, mix(c, '#F4ECD8', 0.5), { cp: cut.d });
      break;
    }
    case 'denim': {
      shirtCollar(ctx, { ...cut, neckPts: [] }, { open: true, color: c });
      chestPocket(ctx, cut, cx - an.w.chest * 0.5, an.armpitY + 0.8, 3.6, 3.8, true);
      chestPocket(ctx, cut, cx + an.w.chest * 0.5, an.armpitY + 0.8, 3.6, 3.8, true);
      // pala (costura curva atravessando o peito) e as costuras verticais
      if (!lite) {
        const yy = an.armpitY - 1.6;
        const th = threadOf(c);
        ctx.stroke(smoothPath([[torsoXAt(an, 'L', yy, cut.ease), yy], [cx - 4, yy + 1.4], [cx - cut.gap(yy + 1.4), yy + 1.4]], false) + smoothPath([[torsoXAt(an, 'R', yy, cut.ease), yy], [cx + 4, yy + 1.4], [cx + cut.gap(yy + 1.4), yy + 1.4]], false), th, 0.16, { o: 0.6, da: [0.5, 0.35], cp: cut.d });
        for (const g of [-1, 1]) ctx.stroke(`M${fmt(cx + g * an.w.chest * 0.5)},${fmt(an.armpitY + 4.8)}L${fmt(cx + g * an.w.waist * 0.55)},${fmt(cut.hemY - 1.6)}`, th, 0.15, { o: 0.5, da: [0.5, 0.35], cp: cut.d });
      }
      buttons(ctx, [[cx - cut.gap(an.waistY) - 1.0, an.waistY + 0.2], [cx - cut.gap(cut.hemY - 1) - 1.0, cut.hemY - 1.0]], 0.42, '#B9A06A', { cp: cut.d });
      break;
    }
    case 'leather': {
      // biker: lapelas largas com pressão, zíper diagonal no painel e cinto na barra
      lapels(ctx, cut, an.armpitY + 4.5, { color: c, tone: t, sheen: true });
      const zx0 = cx - cut.gap(an.armpitY + 4) - 0.6;
      ctx.stroke(smoothPath([[zx0 - 1.5, an.armpitY + 4], [zx0 - 2.6, an.waistY], [zx0 - 2.2, cut.hemY - 1]], false), '#C9CCD6', lite ? 0.6 : 0.45, { o: 0.9, cp: cut.d });
      if (!lite) ctx.stroke(smoothPath([[cx + an.w.chest * 0.25, an.armpitY + 2.4], [cx + an.w.chest * 0.62, an.armpitY + 1.4]], false), '#C9CCD6', 0.4, { o: 0.85, cp: cut.d });
      belt(ctx, cut, cut.hemY - 1.6, mix(c, '#000000', 0.15), t);
      buttons(ctx, [[cx - an.collarW - 2.6, an.collarY + 3.8], [cx + an.collarW + 2.6, an.collarY + 3.8]], 0.3, '#C9CCD6', { holes: false });
      break;
    }
    case 'bomber': {
      mockCollar(ctx, { ...cut, neckPts: [] }, 1.6, { color: varsityRib(c), tone: toneOf(varsityRib(c), 'knit') });
      for (const g of [-1, 1]) ctx.stroke(smoothPath(edge(g).map((p) => [p[0] - g * 0.4, p[1]] as SP), false), '#C9CCD6', 0.35, { o: 0.85, cp: g < 0 ? cut.left : cut.right });
      break;
    }
    case 'varsity': {
      mockCollar(ctx, { ...cut, neckPts: [] }, 1.6, { color: varsityRib(c), tone: toneOf(varsityRib(c), 'knit'), trim: c });
      const ps: Pt[] = [];
      for (let i = 0; i < 4; i++) ps.push([cx - cut.gap(an.armpitY + i * 4.2) - 1.0, an.armpitY + i * 4.2]);
      buttons(ctx, ps, 0.48, '#F2EEE4', { holes: false, cp: cut.d });
      // emblema de feltro no peito (estrela com borda), sem letra nem marca
      const sx = cx + an.w.chest * 0.48;
      const sy = an.armpitY + 2.6;
      ctx.push(starPath(sx, sy, 2.7, 5, 0.45), '#F2EEE4', { o: 0.95, cp: cut.d });
      ctx.push(starPath(sx, sy, 2.0, 5, 0.45), mix(c, '#FFFFFF', 0.1), { o: 0.95, cp: cut.d });
      break;
    }
    case 'puffer': {
      mockCollar(ctx, { ...cut, neckPts: [] }, 2.4, { color: c, tone: t, zip: true });
      ctx.stroke(`M${fmt(cx + 0.2)},${fmt(an.collarY)}V${fmt(cut.hemY)}`, '#C9CCD6', 0.4, { o: 0.8 });
      break;
    }
    case 'kimono': {
      // faixa larga de outra cor na borda da frente e na volta do pescoço
      const bc = lum(c) > 0.45 ? mix(c, '#1A1A2A', 0.75) : mix(c, '#F4E6C8', 0.8);
      for (const g of [-1, 1]) {
        const e = edge(g);
        const top: SP = [cx + g * (an.collarW + 1.2), an.collarY - 3.2];
        ctx.stroke(smoothPath([top, ...e.map((p) => [p[0] - g * 1.1, p[1]] as SP)], false), bc, lite ? 2.4 : 2.2, { cp: g < 0 ? cut.left : cut.right, c: 'butt' });
        if (!lite) ctx.stroke(smoothPath([top, ...e.map((p) => [p[0] - g * 2.2, p[1]] as SP)], false), mix(bc, '#000000', 0.3), 0.2, { o: 0.5, cp: g < 0 ? cut.left : cut.right });
      }
      break;
    }
    default:
      break;
  }
}

/** cor da ribana (gola/punho/barra) da bomber e da college: contraste discreto */
function varsityRib(c: string): string {
  return lum(c) > 0.45 ? mix(c, '#1C1C26', 0.7) : mix(c, '#F2EEE4', 0.12);
}

/** bolsos com aba na altura do quadril (blazer, sobretudo) */
function flapPockets(ctx: LayerCtx, cut: OuterCut, y: number, w: number): void {
  const { an } = ctx;
  const lite = isLite(ctx);
  const t = cut.tone;
  for (const s of SIDES) {
    const g = og(s);
    const x = an.cx + g * (an.w.waist * 0.6 + 1);
    const fl = smoothPath([[x - w, y, 0.2], [x + w, y - g * 0.15, 0.2], [x + w - 0.1, y + 1.7], [x - w + 0.1, y + 1.8]]);
    ctx.push(fl, '#0A0610', { o: 0.25, ...(lite ? {} : { b: 0.35 }), cp: cut.d });
    ctx.push(fl, cut.color, { gf: { t: 'l', x1: x, y1: y, x2: x, y2: y + 1.8, s: [[0, t.light], [1, t.base]] }, cp: cut.d });
    if (!lite) ctx.stroke(fl, t.deep, 0.15, { o: 0.4, cp: cut.d });
  }
}

/** cinto de tecido/couro com fivela (sobretudo, jaqueta de couro) */
function belt(ctx: LayerCtx, cut: OuterCut, y: number, c: string, t: Tone): void {
  const { an } = ctx;
  const lite = isLite(ctx);
  const tl = an.tilt.hip * 0.3;
  const xl = torsoXAt(an, 'L', y, cut.ease) - 0.2;
  const xr = torsoXAt(an, 'R', y, cut.ease) + 0.2;
  const band = smoothPath([[xl, y - 0.9 - tl, 0], [xr, y - 0.9 + tl, 0], [xr, y + 0.9 + tl, 0], [xl, y + 0.9 - tl, 0]]);
  ctx.push(band, '#0A0610', { o: 0.25, ...(lite ? {} : { b: 0.4 }), cp: cut.d });
  ctx.push(band, c, { gf: { t: 'l', x1: an.cx, y1: y - 1, x2: an.cx, y2: y + 1, s: [[0, t.light], [0.5, t.base], [1, t.shade]] }, cp: cut.d });
  // fivela: no meio quando a frente está fechada; na jaqueta aberta, na ponta do cinto do painel esquerdo (antes ficava
  // no meio do corpo, flutuando sobre a camiseta no vão, sem cinto ligando)
  const g = cut.gap(y);
  const bx = g > 1.0 ? an.cx - g - 1.6 : an.cx - 0.3;
  ctx.stroke(smoothPath([[bx - 1.3, y - 1.2, 0], [bx + 1.3, y - 1.2, 0], [bx + 1.3, y + 1.2, 0], [bx - 1.3, y + 1.2, 0]], true, 0), '#C8B07A', lite ? 0.6 : 0.45, { cp: cut.d });
}

/** puffer: gomos horizontais com brilho em cima e sombra embaixo (corpo) */
function pufferBaffles(ctx: LayerCtx, cut: OuterCut): void {
  const { an } = ctx;
  const lite = isLite(ctx);
  const bb = boxOf(cut.pts);
  const step = lite ? 4.2 : 3.6;
  let seams = '';
  let lights = '';
  for (let y = an.collarY + 2.5; y < cut.hemY - 1; y += step) {
    seams += smoothPath([[bb.x, y + 0.3], [an.cx, y + 0.9], [bb.x + bb.w, y + 0.3]], false);
    lights += taperPath([[bb.x + 2, y + step * 0.42], [an.cx - 3, y + step * 0.32 + 0.6], [bb.x + bb.w * 0.55, y + step * 0.4 + 0.6]], [0, 0.9, 0]);
  }
  ctx.stroke(seams, cut.tone.deep, lite ? 0.8 : 0.9, { o: 0.55, ...(lite ? {} : { b: 0.35 }), cp: cut.d });
  ctx.push(lights, '#FFFFFF', { o: 0.22, ...(lite ? {} : { b: 0.5 }), cp: cut.d });
}

/** kimono: florzinhas douradas espalhadas */
function kimonoPattern(ctx: LayerCtx, cut: OuterCut): void {
  const lite = isLite(ctx);
  const r = rng(23);
  const bb = boxOf(cut.pts);
  const col = lum(cut.color) > 0.5 ? mix(cut.color, '#8A2040', 0.6) : '#E8C46A';
  let d = '';
  const n = lite ? 10 : 22;
  for (let i = 0; i < n; i++) {
    const x = bb.x + r() * bb.w;
    const y = bb.y + 4 + r() * (bb.h - 4);
    const rr = 0.55 + r() * 0.35;
    for (let k = 0; k < 5; k++) {
      const a = (k * Math.PI * 2) / 5 + i;
      d += blob(x + Math.cos(a) * rr, y + Math.sin(a) * rr, rr * 0.55, rr * 0.55);
    }
  }
  ctx.push(d, col, { o: 0.8, cp: cut.d });
}

// ===============================================================================================================
// Mangas
// ===============================================================================================================

function outerSleeveSpec(ctx: LayerCtx): SleeveSpec | null {
  const o = outerDef(ctx.cfg);
  if (!o || o.sl === 'none') return null;
  const id = ctx.cfg.outer;
  const c = id === 'varsity' ? (lum(ctx.col.outer) > 0.6 ? '#2A2A36' : '#EFE8DA') : ctx.col.outer;
  const tone = toneOf(c, id === 'varsity' ? 'leather' : o.mat);
  const sp: SleeveSpec = {
    len: o.sl,
    ease: o.sEase * (ctx.an.bodyId === 'broad' ? 0.75 : 1),
    flare: id === 'kimono' ? 3.6 : 0,
    cuff: o.cuff,
    color: c,
    tone,
    mat: o.mat,
    to: 1,
    sheen: o.mat === 'nylon' ? 0.7 : o.mat === 'satin' ? 1 : o.mat === 'leather' ? 0.5 : 0,
  };
  if (id === 'varsity' || id === 'bomber') sp.cuffColor = varsityRib(ctx.col.outer);
  if (id === 'kimono') sp.cuffColor = lum(ctx.col.outer) > 0.45 ? mix(ctx.col.outer, '#1A1A2A', 0.75) : mix(ctx.col.outer, '#F4E6C8', 0.8);
  if (id === 'denim') sp.pattern = (c2, clip, a, b) => weave(c2, clip, { ...boxOf([a, b]), x: Math.min(a[0], b[0]) - 6, w: Math.abs(b[0] - a[0]) + 12, h: Math.abs(b[1] - a[1]) + 6 }, c, { gap: 0.8, o: 0.07, light: true });
  if (id === 'puffer') sp.pattern = (c2, clip, a, b, w) => pufferSleeve(c2, clip, a, b, w, tone);
  if (id === 'kimono') sp.pattern = (c2, clip, a, b) => kimonoSleeveDots(c2, clip, a, b, ctx.col.outer);
  return sp;
}

/** gomos da manga do puffer (perpendiculares ao braço) */
function pufferSleeve(ctx: LayerCtx, clip: string, a: Pt, b: Pt, w: number, t: Tone): void {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const u: Pt = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  const n: Pt = [-u[1], u[0]];
  let d = '';
  for (let s = 3; s < L + 2; s += 3.6) {
    const p: Pt = [a[0] + u[0] * s, a[1] + u[1] * s];
    d += `M${fmt(p[0] + n[0] * (w + 2))},${fmt(p[1] + n[1] * (w + 2))}Q${fmt(p[0] + u[0] * 0.8)},${fmt(p[1] + u[1] * 0.8)} ${fmt(p[0] - n[0] * (w + 2))},${fmt(p[1] - n[1] * (w + 2))}`;
  }
  ctx.stroke(d, t.deep, 0.8, { o: 0.5, ...(isLite(ctx) ? {} : { b: 0.3 }), cp: clip });
}

function kimonoSleeveDots(ctx: LayerCtx, clip: string, a: Pt, b: Pt, c: string): void {
  const r = rng(Math.round(a[0] * 7));
  const col = lum(c) > 0.5 ? mix(c, '#8A2040', 0.6) : '#E8C46A';
  let d = '';
  for (let i = 0; i < 4; i++) {
    const p: Pt = [a[0] + (b[0] - a[0]) * r() + (r() - 0.5) * 4, a[1] + (b[1] - a[1]) * r()];
    d += blob(p[0], p[1], 0.6, 0.6);
  }
  ctx.push(d, col, { o: 0.8, cp: clip });
}

export function outerSleevesUpper(ctx0: LayerCtx): void {
  const ctx = lodCtx(ctx0);
  const id = ctx.cfg.outer;
  if (id === 'mecha') return mechaPads(ctx);
  const sp = outerSleeveSpec(ctx);
  const o = outerDef(ctx.cfg);
  if (!sp || !o) return;
  const cut = outerCut(ctx, id, o);
  for (const s of SIDES) sleeveUpper(ctx, s, { ...sp, chain: shoulderChain(ctx.an, cut.pts, s, cut.ease, id === 'puffer' ? 0.6 : 0) });
  if (id === 'trench') for (const s of SIDES) epaulette(ctx, s, sp.color, sp.tone);
}

export function outerSleevesLower(ctx0: LayerCtx): void {
  const ctx = lodCtx(ctx0);
  const sp = outerSleeveSpec(ctx);
  if (!sp) return;
  for (const s of SIDES) sleeveLower(ctx, s, sp);
}

/** platina no ombro do sobretudo (no grupo do braço) */
function epaulette(ctx: LayerCtx, s: Side, c: string, t: Tone): void {
  const { an } = ctx;
  const sh = s === 'L' ? an.joints.shoulderL : an.joints.shoulderR;
  const g = og(s);
  const y = sh[1] - an.spec.upperArm * 0.7;
  ctx.withGroup(armG(s), () => {
    const d = smoothPath([[sh[0] - g * 3.2, y - 0.6, 0], [sh[0] + g * 1.6, y + 0.3, 0.3], [sh[0] + g * 1.6, y + 1.6, 0.3], [sh[0] - g * 3.2, y + 1.0, 0]]);
    ctx.push(d, c, { gf: { t: 'l', x1: sh[0], y1: y - 0.6, x2: sh[0], y2: y + 1.6, s: [[0, t.light], [1, t.shade]] } });
    buttons(ctx, [[sh[0] - g * 2.4, y + 0.3]], 0.32, mix(c, '#2A1A10', 0.55), { holes: false });
  });
}

// ===============================================================================================================
// Capa de herói, manto real e ombreiras mecha
// ===============================================================================================================

/** cores da capa/manto: tecido (cor da peça), forro (contraste) e debrum */
function cloakTones(ctx: LayerCtx): { c: string; t: Tone; lining: string } {
  const c = ctx.col.outer;
  // forro de cetim: dourado velho no manto e na capa escura; na capa clara, a própria cor bem mais escura
  return { c, t: toneOf(c, ctx.cfg.outer === 'mantle' ? 'velvet' : 'satin'), lining: ctx.cfg.outer === 'mantle' ? '#C79A35' : lum(c) > 0.4 ? mix(c, '#1A1A2A', 0.7) : '#D8A93A' };
}

/**
 * superfície das costas da capa/manto (u 0..1 de um lado ao outro, v 0..1 do ombro à barra): nasce nos ombros (acompanha
 * a largura de cada corpo), abre na cintura e cai em leque até a barra, que sobe nos vales e desce nas cristas das pregas
 */
function cloakSurface(an: Anatomy, mantle: boolean): { surf: FlagSurface; folds: FlagFold[]; hemY: number; x0: number; x1: number } {
  const { cx } = an;
  const wS = an.w.shoulder + (mantle ? 1.0 : 0.3);
  const sY = an.shoulderY;
  const tl = an.tilt.shoulder * 0.5;
  const j = an.joints;
  const hemY = an.seated ? an.hj + (mantle ? 12 : 9) : mantle ? 132.6 : Math.min(124, (j.kneeL[1] + j.ankleL[1]) / 2 + 2);
  const midY = an.seated ? an.waistY + 2 : an.waistY + 3;
  const flare = (mantle ? 13.5 : 9.5) + (an.w.hip - 13) * 0.25;
  // pregas: vale (k < 0, sombra) e crista (k > 0, luz) alternados, 4 de cada lado, abrindo em leque pra fora
  const folds: FlagFold[] = [
    { u: 0.05, w: 0.024, k: 0.85, v0: 0.14, slant: -0.02 },
    { u: 0.115, w: 0.03, k: -1, v0: 0.16, slant: -0.03 },
    { u: 0.185, w: 0.028, k: 0.8, v0: 0.2, slant: -0.02 },
    { u: 0.26, w: 0.034, k: -0.9, v0: 0.26 },
    { u: 0.74, w: 0.034, k: -0.9, v0: 0.26 },
    { u: 0.815, w: 0.028, k: 0.8, v0: 0.2, slant: 0.02 },
    { u: 0.885, w: 0.03, k: -1, v0: 0.16, slant: 0.03 },
    { u: 0.95, w: 0.024, k: 0.85, v0: 0.14, slant: 0.02 },
  ];
  const top: SP[] = [
    [cx - wS - 0.4, sY + 3.4 - tl],
    [cx - wS * 0.66, sY - 0.2 - tl],
    [cx, an.collarY - 3.8],
    [cx + wS * 0.66, sY - 0.2 + tl],
    [cx + wS + 0.4, sY + 3.4 + tl],
  ];
  const side = mantle ? 6.2 : 4.6;
  const mid: SP[] = [
    [cx - wS - side, midY],
    [cx - wS * 0.6, midY - 1.5],
    [cx, midY - 2],
    [cx + wS * 0.6, midY - 1.5],
    [cx + wS + side, midY],
  ];
  const x0 = cx - wS - flare;
  const x1 = cx + wS + flare;
  const hem: SP[] = [];
  const N = 25;
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    let dy = 0;
    for (const f of folds) dy += -Math.sign(f.k) * (mantle ? 1.0 : 1.3) * Math.exp(-Math.pow((u - f.u) / 0.035, 2));
    dy += Math.pow(Math.abs(u - 0.5) * 2, 2) * (mantle ? 0.6 : 1.2);
    hem.push([x0 + (x1 - x0) * u, Math.min(134.6, hemY + dy)]);
  }
  return { surf: curvesSurface([top, mid, hem], { n: 32 }), folds, hemY, x0, x1 };
}

/** linha horizontal da superfície em v (borda a borda) */
function surfaceLineAt(s: FlagSurface, v: number): string {
  const pts: SP[] = [];
  for (let i = 0; i <= 24; i++) pts.push(s.at(i / 24, v));
  return smoothPath(pts, false);
}

/** borda do lado da luz (u = 0), do ombro à barra */
function surfaceEdge(s: FlagSurface): string {
  const pts: SP[] = [];
  for (let i = 2; i <= 16; i++) pts.push(s.at(0.004, i / 16));
  return smoothPath(pts, false);
}

/** 5. costas da capa (até a panturrilha) e do manto (até o chão): aparecem dos lados do corpo, com pregas e barra ondulada */
export function outerBack(ctx0: LayerCtx): void {
  const ctx = lodCtx(ctx0);
  const id = ctx.cfg.outer;
  if ((id !== 'cape' && id !== 'mantle') || prideCapeReplaces(ctx)) return;
  const { an } = ctx;
  const lite = isLite(ctx);
  const { c, t, lining } = cloakTones(ctx);
  const mantle = id === 'mantle';
  const k = cloakSurface(an, mantle);
  const surf: FlagSurface = lite ? { ...k.surf, n: 16 } : k.surf;
  const outline = surfacePath(surf);
  const sY = an.shoulderY;
  ctx.group('body');
  // tecido: cilindro (luz à esquerda, sombra própria à direita); veludo com contraste maior
  ctx.push(outline, c, { gf: { t: 'l', x1: k.x0, y1: 0, x2: k.x1, y2: 0, s: [[0, mix(t.light, t.base, 0.25)], [0.22, t.base], [0.62, t.shade], [1, t.deep]] } });
  // por dentro: o corpo faz sombra embaixo dos ombros e o pano clareia onde abre, na barra
  const INK = '#0A0612';
  ctx.push(outline, INK, { gf: { t: 'l', x1: 0, y1: sY, x2: 0, y2: k.hemY, s: [[0, INK, 0.6], [0.35, INK, 0.32], [0.8, INK, 0.08], [1, INK, 0.02]] } });
  // pregas: vales escuros e cristas claras (o veludo brilha mais na crista)
  flagFolds(ctx, surf, k.folds, { clip: outline, o: lite ? 0.36 : mantle ? 0.62 : 0.5, b: lite ? 0 : 0.9, dark: mix(t.deep, INK, 0.5), light: mantle ? t.bounce : '#FFFFFF', k: undefined });
  // barra virada: o forro aparece numa faixa fina na borda de baixo e nas pontas de fora, sem contorno em volta da peça
  const facing = surfacePath(surf, 0, 1, 0.98, 1);
  ctx.push(facing, lining, { gf: { t: 'l', x1: k.x0, y1: 0, x2: k.x1, y2: 0, s: [[0, mix(lining, '#FFFFFF', 0.2)], [0.5, lining], [1, mix(lining, '#000000', 0.35)]] } });
  // ponta virada nos cantos de fora: um triângulo do avesso, mais largo embaixo (não é faixa na borda)
  for (const [u, du] of [
    [0, 0.06],
    [1, -0.06],
  ] as const) {
    const flip = smoothPath([[...surf.at(u, 0.84), 0], [...surf.at(u + du * 0.35, 0.93)], [...surf.at(u + du, 1), 0], [...surf.at(u, 1), 0]] as SP[]);
    ctx.push(flip, lining, { gf: { t: 'l', x1: 0, y1: surf.at(u, 0.84)[1], x2: 0, y2: k.hemY, s: [[0, mix(lining, '#000000', 0.4)], [1, mix(lining, '#FFFFFF', 0.1)]] } });
  }
  if (!lite) {
    // bainha (pesponto fino acima da faixa) e filete de luz na borda do lado da luz
    ctx.stroke(surfaceLineAt(surf, 0.955), mix(t.deep, INK, 0.3), 0.18, { o: 0.5, cp: outline, da: [0.55, 0.35] });
    ctx.stroke(surfaceEdge(surf), '#FFFFFF', 0.5, { o: 0.16, b: 0.3, cp: outline });
  }
}

/** frente da capa: gola de pé atrás do pescoço, as bordas da capa sobre os ombros e o fecho com dois broches */
function capeFront(ctx: LayerCtx): void {
  const { an } = ctx;
  const { cx } = an;
  const lite = isLite(ctx);
  const { c, t } = cloakTones(ctx);
  const sw = an.w.shoulder + 0.9;
  const y0 = an.shoulderY - 0.8;
  for (const s of SIDES) {
    const g = og(s);
    // a capa passa por cima do ombro (faixa curva do pescoço até a ponta do ombro)
    const d = smoothPath([[cx + g * (an.collarW + 0.6), an.collarY - 3.4, 0.5], [cx + g * (sw - 3), y0 - 0.6], [cx + g * (sw + 0.5), y0 + 2.4], [cx + g * (sw - 0.6), y0 + 3.6], [cx + g * (sw - 4.5), y0 + 1.6], [cx + g * (an.collarW + 1.2), an.collarY - 0.6]]);
    ctx.push(d, '#0A0610', { o: 0.25, ...(lite ? {} : { b: 0.5 }) });
    ctx.push(d, c, { gf: { t: 'l', x1: cx + g * an.collarW, y1: y0 - 1, x2: cx + g * sw, y2: y0 + 3, s: g < 0 ? [[0, t.light], [1, t.base]] : [[0, t.base], [1, t.shade]] } });
  }
  // fecho: cordão dourado entre dois broches redondos
  const by = an.collarY + 0.4;
  const bx = an.collarW + 1.2;
  ctx.stroke(smoothPath([[cx - bx, by], [cx, by + 1.0], [cx + bx, by]], false), '#E2B33C', lite ? 0.7 : 0.5);
  for (const g of [-1, 1]) {
    ctx.push(blob(cx + g * bx, by, 1.2, 1.2), '#E2B33C', { gf: { t: 'r', cx: cx + g * bx - 0.4, cy: by - 0.4, r: 1.6, s: [[0, '#FFF0B0'], [0.5, '#E2B33C'], [1, '#8E6A1C']] } });
    if (!lite) ctx.push(blob(cx + g * bx, by, 0.5, 0.5), mix(c, '#FFFFFF', 0.2));
  }
}

/** frente do manto: gola de arminho por cima dos ombros, bordas de arminho descendo e corrente dourada no peito */
function mantleFront(ctx: LayerCtx): void {
  const { an } = ctx;
  const { cx } = an;
  const lite = isLite(ctx);
  const { c, t } = cloakTones(ctx);
  const sw = an.w.shoulder + 2.2;
  const y0 = an.shoulderY - 1;
  for (const s of SIDES) {
    const g = og(s);
    // a borda do manto desce pela frente (aberta), por fora do tronco
    const edge = smoothPath([[cx + g * (sw - 1.5), y0 + 2], [cx + g * (sw + 0.8), y0 + 6], [cx + g * (sw + 1.6), an.waistY], [cx + g * (sw + 2.2), an.hipY + 6], [cx + g * (sw - 1.6), an.hipY + 6], [cx + g * (sw - 2.6), an.waistY], [cx + g * (sw - 3.6), y0 + 5]]);
    ctx.push(edge, c, { gf: { t: 'l', x1: cx + g * (sw - 4), y1: 0, x2: cx + g * (sw + 2), y2: 0, s: [[0, t.light], [1, t.deep]] } });
  }
  furCollar(ctx, sw, y0);
  // corrente dourada atravessando o peito
  const yC = an.collarY + 5.5;
  ctx.stroke(smoothPath([[cx - an.w.chest * 0.62, yC - 1.5], [cx, yC + 1.2], [cx + an.w.chest * 0.62, yC - 1.5]], false), '#E2B33C', lite ? 0.8 : 0.6, { da: lite ? undefined : [0.7, 0.25] });
  ctx.push(blob(cx, yC + 1.4, 0.9, 0.9), '#E2B33C', { gf: { t: 'r', cx: cx - 0.3, cy: yC + 1.1, r: 1.2, s: [[0, '#FFF0B0'], [1, '#B8901E']] } });
}

/**
 * gola de arminho do manto: rolo de pelo volumoso por cima dos ombros (não faixa de contorno) — borda de baixo em tufos
 * desencontrados, luz de cima, sombra própria no rolo e sombra macia no peito, mechas de pelo e poucas pontas pretas
 */
function furCollar(ctx: LayerCtx, sw: number, y0: number): void {
  const { an } = ctx;
  const { cx } = an;
  const lite = isLite(ctx);
  const r = rng(17);
  // espinha do rolo (de um ombro ao outro, passando atrás do pescoço) e espessura que engorda nos ombros
  const spine: SP[] = [];
  const N = lite ? 10 : 16;
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const g = u * 2 - 1;
    // cai acompanhando o ombro (não é uma barra reta): sobe atrás do pescoço e desce bem nas pontas
    const x = cx + g * (sw - 0.5);
    const y = y0 + 1.0 - Math.cos(g * 1.35) * 3.0 + Math.pow(Math.abs(g), 1.6) * 3.4;
    spine.push([x, y]);
  }
  const thick = (i: number) => {
    const g = Math.abs((i / N) * 2 - 1);
    return 2.7 + g * 1.5;
  };
  const top: SP[] = spine.map((p, i) => [p[0], p[1] - thick(i) * 0.55]);
  const bot: SP[] = [];
  spine.forEach((p, i) => {
    // borda de baixo em tufos: alterna saliência e reentrância com tamanhos desencontrados
    const k = thick(i) * (0.62 + (i % 2 ? 0.22 : -0.02) + (r() - 0.5) * 0.12);
    bot.push([p[0] + (r() - 0.5) * 0.4, p[1] + k]);
  });
  const fur = smoothPath([...top, [cx + sw + 0.5, spine[N][1] + 0.9], ...bot.reverse(), [cx - sw - 0.5, spine[0][1] + 0.9]]);
  // sombra que o rolo faz no peito e nos ombros (recortada no corpo, não vaza)
  const body = smoothPath(torsoPts(an, { top: an.collarY - 4 }));
  ctx.push(taperPath(bot.map((p) => [p[0], p[1] + 0.5] as SP), (k) => 1.1 * Math.sin(Math.PI * Math.min(1, k * 1.1 + 0.02)) + 0.2), '#0A0610', { o: 0.22, ...(lite ? {} : { b: 0.6 }), cp: body });
  // rolo: luz de cima, miolo creme e sombra própria embaixo (volume de cilindro)
  const yT = Math.min(...top.map((p) => p[1]));
  const yB = Math.max(...bot.map((p) => p[1]));
  ctx.push(fur, '#F2EDE3', { gf: { t: 'l', x1: 0, y1: yT, x2: 0, y2: yB, s: [[0, '#FFFFFF'], [0.45, '#F1ECE2'], [0.8, '#D2C9BC'], [1, '#A89F94']] } });
  ctx.push(fur, '#7A7088', { gf: { t: 'l', x1: cx - sw, y1: 0, x2: cx + sw, y2: 0, s: [[0, '#7A7088', 0], [0.6, '#7A7088', 0.05], [1, '#4A4258', 0.3]] } });
  if (!lite) {
    // mechas de pelo: traços curtos saindo da borda de baixo e do alto (luz e sombra), num path cada
    let hl = '';
    let sh = '';
    for (let i = 0; i <= N * 2; i++) {
      const p = spine[Math.min(N, Math.round(i / 2))];
      const x = p[0] + (r() - 0.5) * 1.6;
      const y = p[1] + (r() - 0.3) * 1.6;
      const a = Math.PI / 2 + (x - cx) * 0.05 + (r() - 0.5) * 0.6;
      const L = 0.9 + r() * 0.8;
      const seg = taperPath([[x, y], [x + Math.cos(a) * L * 0.5, y + Math.sin(a) * L * 0.5], [x + Math.cos(a) * L, y + Math.sin(a) * L]], [0.22, 0.16, 0]);
      if (i % 3 === 0) sh += seg;
      else hl += seg;
    }
    ctx.push(sh, '#9A9086', { o: 0.5, cp: fur });
    ctx.push(hl, '#FFFFFF', { o: 0.75, cp: fur });
    // poucas pontas de cauda (arminho), pequenas e em gota
    let tails = '';
    for (const u of [0.18, 0.38, 0.62, 0.82]) {
      const p = spine[Math.round(u * N)];
      tails += smoothPath([[p[0], p[1] - 0.2], [p[0] + 0.32, p[1] + 0.5], [p[0], p[1] + 1.1], [p[0] - 0.32, p[1] + 0.5]]);
    }
    ctx.push(tails, '#16141C', { o: 0.85, cp: fur });
  }
  // brilho macio no alto do rolo
  ctx.push(taperPath(top.map((p) => [p[0], p[1] + 0.7] as SP), [0, 0.8, 0.9, 0.8, 0]), '#FFFFFF', { o: 0.5, ...(lite ? {} : { b: 0.4 }), cp: fur });
}

/** ombreiras mecha: arnês no peito (alças + núcleo luminoso); as placas vão nos braços */
function mechaHarness(ctx: LayerCtx): void {
  const { an } = ctx;
  const { cx } = an;
  const lite = isLite(ctx);
  const glow = '#7FFF00';
  const t = toneOf(ctx.col.outer, 'metal');
  const metalC = mix('#9AA2B4', ctx.col.outer, 0.35);
  for (const s of SIDES) {
    const g = og(s);
    const strap = smoothPath([[cx + g * (an.collarW + 1.6), an.collarY - 3.2, 0], [cx + g * (an.collarW + 4.0), an.collarY - 2.4, 0], [cx + g * 3.2, an.armpitY + 3.6, 0], [cx + g * 1.4, an.armpitY + 2.6, 0]]);
    ctx.push(strap, '#0A0610', { o: 0.3, ...(lite ? {} : { b: 0.4 }) });
    ctx.push(strap, metalC, { gf: { t: 'l', x1: cx, y1: an.collarY - 3, x2: cx + g * 5, y2: an.armpitY + 3, s: [[0, t.light], [1, t.shade]] } });
  }
  const core = smoothPath([[cx - 3.4, an.armpitY + 0.6, 0.3], [cx + 3.4, an.armpitY + 0.6, 0.3], [cx + 2.6, an.armpitY + 5.6, 0.3], [cx - 2.6, an.armpitY + 5.6, 0.3]]);
  ctx.push(core, metalC, { gf: { t: 'l', x1: cx - 3, y1: an.armpitY, x2: cx + 3, y2: an.armpitY + 6, s: [[0, t.light], [0.5, t.base], [1, t.deep]] } });
  metal(ctx, core, { x: cx - 3.4, y: an.armpitY + 0.6, w: 6.8, h: 5 }, metalC);
  // núcleo: LED pequeno EMBUTIDO num soquete escuro (o brilho é detalhe, não o desenho)
  const ly = an.armpitY + 3.1;
  ctx.push(blob(cx, ly, 1.25, 1.25), '#14181F', { gf: { t: 'r', cx, cy: ly + 0.3, r: 1.3, s: [[0, '#05070A'], [0.7, '#1A1E28'], [1, t.light]] } });
  if (!lite) ctx.push(blob(cx, ly, 1.3, 1.3), glow, { o: 0.22, b: 0.6 });
  ctx.push(blob(cx, ly, 0.62, 0.62), mix(glow, '#FFFFFF', 0.25), { o: 0.9 });
  ctx.push(blob(cx - 0.2, ly - 0.2, 0.22, 0.22), '#FFFFFF', { o: 0.85 });
}

/** placas mecha nos ombros (grupo do braço): lâminas angulosas com frisos de luz */
function mechaPads(ctx: LayerCtx): void {
  const { an } = ctx;
  const lite = isLite(ctx);
  const glow = '#7FFF00';
  const metalC = mix('#9AA2B4', ctx.col.outer, 0.35);
  const t = toneOf(metalC, 'metal');
  for (const s of SIDES) {
    const g = og(s);
    const sh = s === 'L' ? an.joints.shoulderL : an.joints.shoulderR;
    const ua = an.spec.upperArm + 1.6;
    ctx.withGroup(armG(s), () => {
      const big = smoothPath([[sh[0] - g * ua * 0.9, sh[1] - ua * 0.55, 0], [sh[0] + g * ua * 0.5, sh[1] - ua * 1.05, 0.3], [sh[0] + g * ua * 1.35, sh[1] - ua * 0.2, 0.3], [sh[0] + g * ua * 1.25, sh[1] + ua * 0.9, 0], [sh[0] + g * ua * 0.2, sh[1] + ua * 0.55, 0], [sh[0] - g * ua * 0.75, sh[1] + ua * 0.05, 0]]);
      ctx.push(big, '#0A0610', { o: 0.3, ...(lite ? {} : { b: 0.5 }) });
      ctx.push(big, metalC, { gf: { t: 'l', x1: sh[0] - ua, y1: sh[1] - ua, x2: sh[0] + ua, y2: sh[1] + ua, s: [[0, t.light], [0.45, t.base], [0.8, t.shade], [1, t.deep]] } });
      metal(ctx, big, { x: sh[0] - ua, y: sh[1] - ua, w: ua * 2.4, h: ua * 2 }, metalC);
      // friso GRAVADO entre as lâminas (sulco escuro com fio de luz embaixo) e um LED pequeno embutido perto da ponta
      const line = smoothPath([[sh[0] - g * ua * 0.55, sh[1] - ua * 0.25], [sh[0] + g * ua * 0.55, sh[1] - ua * 0.6], [sh[0] + g * ua * 1.05, sh[1] + ua * 0.1]], false);
      ctx.stroke(line, t.deep, lite ? 0.45 : 0.34, { o: 0.75, cp: big });
      if (!lite) {
        const lit = smoothPath([[sh[0] - g * ua * 0.55, sh[1] - ua * 0.25 + 0.3], [sh[0] + g * ua * 0.55, sh[1] - ua * 0.6 + 0.3], [sh[0] + g * ua * 1.05, sh[1] + ua * 0.1 + 0.3]], false);
        ctx.stroke(lit, t.light, 0.16, { o: 0.7, cp: big });
      }
      const led: Pt = [sh[0] + g * ua * 0.82, sh[1] + ua * 0.42];
      ctx.push(blob(led[0], led[1], 0.6, 0.38), '#10141A');
      if (!lite) ctx.push(blob(led[0], led[1], 0.8, 0.55), glow, { o: 0.25, b: 0.45 });
      ctx.push(blob(led[0], led[1], 0.36, 0.2), mix(glow, '#FFFFFF', 0.2), { o: 0.95 });
      ctx.stroke(big, '#1E222C', 0.3, { o: 0.6 });
    });
  }
}
