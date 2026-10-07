// Bolsas e costas: mochila, transversal, ecobag, clutch, pochete, violão nas costas, asas (anjo, borboleta, dragão,
// neon) e jetpack. Dono: guarda-roupa (parte de baixo).
//
// Duas etapas (layers.ts), as duas no grupo do tronco:
//   3  bagBack  — o que fica ATRÁS do corpo: corpo da mochila, ecobag pendurada, violão, asas e jetpack. Só aparece o
//                que sai da silhueta (acima dos ombros, no vão entre braço e cintura, além do quadril), e o tronco faz
//                sombra nele (oclusão recortada na peça).
//   15b bagFront — o que fica NA FRENTE: alças acolchoadas, alça transversal, bolsa no quadril, pochete, alça do violão.
//                Sombra de contato sempre recortada no tronco.
// A clutch vai na mão esquerda (grupo foreL) e é desenhada junto com o pulso (lower-wrist.ts chama drawClutchInHand).
// Tudo sai das âncoras da anatomia (bodyAnchors, torsoXAt, larguras do tronco): acompanha os 6 corpos e a pose sentada
// (o grupo do tronco desce junto).

import { bodyAnchors, handShapes, limbWidthAt, sampleSpline, smoothPath, taperPath, torsoPath, torsoXAt, type Anatomy, type Side, type SP } from '../anatomy';
import type { LayerCtx } from '../ctx';
import { ellipse } from '../geometry';
import { blob, cylGradient, isLite, lodCtx, mix } from '../shading';
import type { AvatarGradient, Pt } from '../types';

import { tonesOf } from './body';
import { outerDef, topDef } from './clothes-kit';
import { SIDES, fabric, leatherTones, threadOf } from './lower-common';

// ---------------------------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------------------------

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const gOf = (s: Side): number => (s === 'L' ? -1 : 1);

/** ponto em cima do ombro: k 0 = ponta da gola, 1 = acrômio */
function shoulderPt(an: Anatomy, s: Side, k: number): Pt {
  const ba = bodyAnchors(an);
  const c = s === 'L' ? ba.collarL : ba.collarR;
  const a = s === 'L' ? ba.shoulderL : ba.shoulderR;
  return [c[0] + (a[0] - c[0]) * k, c[1] + (a[1] - c[1]) * k - 0.15];
}

/** desloca uma linha aberta `d` unidades pra esquerda do sentido dela */
function offLine(pts: readonly SP[], d: number): SP[] {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const tx = b[0] - a[0];
    const ty = b[1] - a[1];
    const L = Math.hypot(tx, ty) || 1;
    return [p[0] + (ty / L) * d, p[1] - (tx / L) * d] as SP;
  });
}

/** contorno simétrico: meia-borda ESQUERDA (de cima pra baixo) + o espelho dela */
function sym(cx: number, half: readonly SP[]): SP[] {
  const right = half.map((p) => (p.length > 2 ? ([2 * cx - p[0], p[1], p[2] as number] as SP) : ([2 * cx - p[0], p[1]] as SP))).reverse();
  return [...half, ...right];
}

/** gradiente atravessando uma faixa (luz do lado esquerdo da tela) no meio da espinha */
function acrossGrad(spine: readonly SP[], w: number, stops: AvatarGradient['s']): AvatarGradient {
  const m = Math.floor(spine.length / 2);
  const a = spine[Math.max(0, m - 1)];
  const b = spine[Math.min(spine.length - 1, m + 1)];
  let nx = -(b[1] - a[1]);
  let ny = b[0] - a[0];
  const L = Math.hypot(nx, ny) || 1;
  nx /= L;
  ny /= L;
  if (nx > 0) {
    nx = -nx;
    ny = -ny;
  }
  const p = spine[m];
  return { t: 'l', x1: p[0] + nx * w, y1: p[1] + ny * w, x2: p[0] - nx * w, y2: p[1] - ny * w, s: stops };
}

interface StrapOpts {
  w: number | number[];
  color: string;
  /** recorte da sombra de contato (tronco) */
  shadow?: string;
  stitch?: boolean;
  /** acolchoada: luz no meio, bordas que viram */
  pad?: boolean;
  cp?: string;
}

/** alça: sombra de contato recortada, faixa com gradiente atravessado, borda clara e pesponto (completo) */
function strap(ctx: LayerCtx, spine: readonly SP[], o: StrapOpts): string {
  const lite = isLite(ctx);
  const ws = Array.isArray(o.w) ? o.w : [o.w];
  const wmax = Math.max(...ws);
  const t = fabric(o.color);
  const d = taperPath(spine, ws, { round: true });
  if (o.shadow) ctx.push(taperPath(spine.map((p) => [p[0] + 0.4, p[1] + 0.65] as SP), ws.map((w) => w * 1.2), { round: true }), '#0A0610', { o: 0.32, b: 0.6, cp: o.shadow });
  const stops: AvatarGradient['s'] = o.pad
    ? [
        [0, t.shade],
        [0.22, t.light],
        [0.5, t.base],
        [0.82, t.shade],
        [1, t.deep],
      ]
    : [
        [0, t.light],
        [0.4, t.base],
        [0.85, t.shade],
        [1, t.deep],
      ];
  ctx.push(d, o.color, { gf: acrossGrad(spine, wmax / 2, stops), ...(o.cp ? { cp: o.cp } : {}) });
  if (!lite && o.stitch && wmax > 1) {
    const k = wmax / 2 - 0.3;
    ctx.stroke(smoothPath(offLine(spine, k), false) + smoothPath(offLine(spine, -k), false), threadOf(o.color), 0.12, { o: 0.55, da: [0.42, 0.32], c: 'butt', cp: d });
  }
  return d;
}

/** gradiente de metal (ouro/prata) numa caixa, na diagonal */
function metalGrad(x: number, y: number, w: number, h: number, kind: 'gold' | 'silver' | 'chrome' = 'gold'): AvatarGradient {
  const s: AvatarGradient['s'] =
    kind === 'gold'
      ? [
          [0, '#FFF3C4'],
          [0.35, '#E6BE58'],
          [0.7, '#A97A26'],
          [1, '#6E4C16'],
        ]
      : kind === 'silver'
        ? [
            [0, '#FFFFFF'],
            [0.35, '#D5DAE3'],
            [0.7, '#959DAD'],
            [1, '#5C6372'],
          ]
        : [
            [0, '#F4F7FF'],
            [0.3, '#A9B2C4'],
            [0.5, '#4A5162'],
            [0.7, '#C9D0DE'],
            [1, '#5C6372'],
          ];
  return { t: 'l', x1: x, y1: y, x2: x + w, y2: y + h, s };
}

/** fivela plástica pequena (retângulo arredondado girado) */
function buckle(ctx: LayerCtx, c: Pt, w: number, h: number, rot: number, color = '#1C1E25'): void {
  const co = Math.cos(rot);
  const si = Math.sin(rot);
  const P = (x: number, y: number): SP => [c[0] + x * co - y * si, c[1] + x * si + y * co, 0.5];
  const d = smoothPath([P(-w / 2, -h / 2), P(w / 2, -h / 2), P(w / 2, h / 2), P(-w / 2, h / 2)], true, 0.6);
  ctx.push(d, color, { gf: { t: 'l', x1: c[0], y1: c[1] - h, x2: c[0], y2: c[1] + h, s: [[0, mix(color, '#FFFFFF', 0.35)], [0.5, color], [1, mix(color, '#000000', 0.4)]] } });
  if (!isLite(ctx)) ctx.stroke(smoothPath([P(-w / 2 + 0.3, 0), P(w / 2 - 0.3, 0)], false), '#000000', 0.16, { o: 0.45 });
}

/** oclusão do tronco numa peça de trás: o tronco fica na frente e escurece a peça rente à silhueta */
function torsoOcclusion(ctx: LayerCtx, clip: string, o = 0.5): void {
  if (isLite(ctx)) return;
  ctx.push(torsoPath(ctx.an, { ease: 1.4 }), '#05040A', { o, b: 1.3, cp: clip });
}

/** recorte do tronco pra sombras de contato */
const torsoClip = (an: Anatomy): string => torsoPath(an, { ease: 0.7 });

/**
 * borda de DENTRO do braço (pele + manga) em y, ou null se o braço não passa nessa altura: o que fica na frente do
 * tronco mas atrás do braço (cinto da pochete) termina aqui em vez de passar por cima do antebraço
 */
function armInnerX(ctx: LayerCtx, s: Side, y: number): number | null {
  const { an, cfg } = ctx;
  const o = outerDef(cfg);
  const e = o && o.sl !== 'none' ? o.sEase : (topDef(cfg).sEase ?? 0.4);
  for (const limb of ['upperArm', 'forearm'] as const) {
    const a = limbWidthAt(an, limb, s, 0);
    const b = limbWidthAt(an, limb, s, 1);
    if ((y - a.at[1]) * (y - b.at[1]) > 0) continue;
    const t = (y - a.at[1]) / (b.at[1] - a.at[1] || 1);
    const q = limbWidthAt(an, limb, s, t);
    return s === 'L' ? q.at[0] + q.r + e + 0.2 : q.at[0] - q.l - e - 0.2;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// entradas
// ---------------------------------------------------------------------------------------------------------------

/** 3. costas (grupo do tronco, atrás de tudo) */
export function drawBagBack(ctx: LayerCtx): void {
  ctx = lodCtx(ctx);
  switch (ctx.cfg.bag) {
    case 'backpack':
      return backpackBack(ctx);
    case 'tote':
      return toteBack(ctx);
    case 'guitar_back':
      return guitarBack(ctx);
    case 'wings_angel':
      return featherWings(ctx, 'angel');
    case 'wings_neon':
      return featherWings(ctx, 'neon');
    case 'wings_butterfly':
      return butterflyWings(ctx);
    case 'wings_dragon':
      return dragonWings(ctx);
    case 'jetpack':
      return jetpackBack(ctx);
    default:
      return;
  }
}

/** 15b. frente (grupo do tronco) */
export function drawBagFront(ctx: LayerCtx): void {
  ctx = lodCtx(ctx);
  switch (ctx.cfg.bag) {
    case 'backpack':
      return backpackStraps(ctx, '#33404F', false);
    case 'jetpack':
      return backpackStraps(ctx, '#1E2129', true);
    case 'crossbody':
      return crossbody(ctx);
    case 'tote':
      return toteFront(ctx);
    case 'fanny':
      return fanny(ctx);
    case 'guitar_back':
      return guitarStrap(ctx);
    case 'clutch':
      if (!clutchInHand(ctx)) return clutchOnChain(ctx);
      return;
    default:
      return;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// mochila
// ---------------------------------------------------------------------------------------------------------------

const PACK = '#3D4C5E';

function backpackBack(ctx: LayerCtx): void {
  const { an } = ctx;
  const { cx, w } = an;
  const lite = isLite(ctx);
  const t = fabric(PACK);
  const top = an.collarY - 4.4;
  const wTop = w.chest - 3;
  // o corpo fica dentro da silhueta do tronco (só o topo aparece acima dos ombros): nada de mancha escura solta no vão
  // entre o braço e a cintura nem bloco saindo do lado do braço
  const yBot = an.hipY - 1.5;
  const inside = (y: number) => Math.min(torsoXAt(an, 'R', y, -0.6) - cx, cx - torsoXAt(an, 'L', y, -0.6));
  const wMid = Math.min(w.chest + 0.6, inside(an.armpitY + 1.5));
  const wBot = Math.min(Math.max(w.waist + 3.4, w.chest - 0.2), inside(yBot - 5), inside(yBot));
  const half: SP[] = [
    [cx - wTop * 0.45, top - 0.5],
    [cx - wTop * 0.92, top + 1.2],
    [cx - wMid, an.armpitY + 1.5],
    [cx - wBot, yBot - 5],
    [cx - wBot + 1.4, yBot, 0.7],
    [cx - wBot * 0.4, yBot + 0.5],
  ];
  const pts = sym(cx, half);
  const d = smoothPath(pts, true);
  ctx.push(d, PACK, { gf: { t: 'l', x1: cx - wMid, y1: 0, x2: cx + wMid, y2: 0, s: [[0, t.light], [0.28, t.base], [0.72, t.shade], [1, t.deep]] } });
  // tampa de cima (painel mais claro com o zíper em arco) e base mais escura
  ctx.push(blob(cx, top + 2.8, wTop * 1.05, 3.4), t.light, { o: 0.35, b: lite ? 0 : 1.0, cp: d });
  ctx.push(blob(cx, yBot, wBot * 1.05, 3.5), t.deep, { o: 0.4, b: lite ? 0 : 1.2, cp: d });
  // zíper em arco no topo + puxadores pendurados
  if (!lite) {
    const z: SP[] = [];
    for (let i = 0; i <= 8; i++) {
      const k = -1 + (2 * i) / 8;
      z.push([cx + k * wTop * 0.9, top + 1.5 + k * k * 2.8]);
    }
    ctx.stroke(smoothPath(z, false), '#14181F', 0.42, { o: 0.75, cp: d });
    ctx.stroke(smoothPath(z, false), '#AEB8C6', 0.16, { o: 0.6, da: [0.18, 0.22], c: 'butt', cp: d });
  }
  let pulls = '';
  for (const s of SIDES) {
    const g = gOf(s);
    const p: Pt = [cx + g * wTop * 0.8, top + 1.5 + 0.64 * 2.8];
    pulls += taperPath([p, [p[0] + g * 0.4, p[1] + 1.6], [p[0] + g * 0.3, p[1] + 3.0]], [0.5, 0.6, 0.75], { round: true });
  }
  ctx.push(pulls, '#B07A4A');
  // rim de luz no topo (lado da luz) e oclusão do tronco
  if (!lite) ctx.stroke(smoothPath(half.slice(0, 3), false), mix(PACK, '#FFFFFF', 0.45), 0.5, { o: 0.4, b: 0.25, cp: d });
  torsoOcclusion(ctx, d);
}

/** alças acolchoadas (mochila; jetpack = arnês preto com placa no peito) */
function backpackStraps(ctx: LayerCtx, color: string, harness: boolean): void {
  const { an } = ctx;
  const lite = isLite(ctx);
  const clip = torsoClip(an);
  const yA = an.armpitY + 6.5;
  const yS = an.armpitY + 2.6;
  const ends: Pt[] = [];
  const sternum: Pt[] = [];
  for (const s of SIDES) {
    const g = gOf(s);
    const top = shoulderPt(an, s, 0.42);
    const xA = torsoXAt(an, s, yA) - g * 3.9;
    const mid: Pt = [(top[0] + xA) / 2 + g * 0.5, (top[1] + yA) / 2];
    const spine: SP[] = [[top[0] + g * 0.7, top[1] - 1.5], top, mid, [xA, yA]];
    strap(ctx, spine, { w: [2.0, 2.3, 2.25, 1.95], color, shadow: clip, stitch: true, pad: true });
    // fita que volta pela lateral até a mochila
    const yW = an.waistY - 0.5;
    const web: SP[] = [[xA, yA + 0.6], [(xA + torsoXAt(an, s, yW)) / 2 - g * 0.6, (yA + yW) / 2], [torsoXAt(an, s, yW) - g * 0.7, yW]];
    strap(ctx, web, { w: 0.95, color: mix(color, '#000000', 0.25), shadow: clip, cp: clip });
    buckle(ctx, [xA - g * 0.1, yA + 0.9], 2.1, 1.0, g * -0.25, harness ? '#C9CED8' : '#1C1E25');
    // ponta da fita pendurada
    if (!lite) ctx.push(taperPath([[xA - g * 0.6, yA + 1.4], [xA - g * 0.9, yA + 3.2], [xA - g * 0.8, yA + 4.4]], [0.8, 0.8, 0.7], { round: true }), mix(color, '#000000', 0.3));
    ends.push([xA, yA]);
    const k = (yS - top[1]) / (yA - top[1]);
    sternum.push([top[0] + (xA - top[0]) * k + g * 0.3, yS]);
  }
  // tira do peito (mochila: só no completo; jetpack: placa de controle com LED)
  if (harness) {
    strap(ctx, [sternum[0], [ctx.an.cx, yS + 0.4], sternum[1]], { w: 1.1, color: '#2A2E38', shadow: clip });
    const c: Pt = [an.cx, yS + 0.3];
    const plate = smoothPath([[c[0] - 2.2, c[1] - 1.5, 0.5], [c[0] + 2.2, c[1] - 1.5, 0.5], [c[0] + 2.5, c[1] + 1.4, 0.5], [c[0] - 2.5, c[1] + 1.4, 0.5]], true, 0.6);
    ctx.push(plate, '#0A0610', { o: 0.35, b: lite ? 0 : 0.5, cp: clip });
    ctx.push(plate, '#9AA3B5', { gf: metalGrad(c[0] - 2.5, c[1] - 1.5, 5, 3, 'chrome') });
    ctx.push(ellipse(c[0] - 0.9, c[1] - 0.1, 0.55, 0.55), '#7FFF00', { o: 0.95 });
    if (!lite) ctx.push(ellipse(c[0] - 0.9, c[1] - 0.1, 1.3, 1.3), '#7FFF00', { o: 0.4, b: 0.6 });
    ctx.push(ellipse(c[0] + 1.0, c[1] - 0.1, 0.4, 0.4) + ellipse(c[0] + 1.9, c[1] - 0.1, 0.25, 0.25), '#1A1E28');
  } else if (!lite) {
    strap(ctx, [sternum[0], [ctx.an.cx, yS + 0.35], sternum[1]], { w: 0.75, color: mix(color, '#000000', 0.2), shadow: clip });
    buckle(ctx, [an.cx, yS + 0.35], 1.7, 1.05, 0);
  }
  void ends;
}

// ---------------------------------------------------------------------------------------------------------------
// bolsa transversal (couro caramelo, aba com fecho de girar, alça do ombro esquerdo ao quadril direito)
// ---------------------------------------------------------------------------------------------------------------

interface HipBag {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** caixa da bolsa no quadril direito da tela (dentro da silhueta, longe da mão solta) */
function hipBagBox(an: Anatomy, w: number, h: number): HipBag {
  const y0 = an.hipY - h * 0.55;
  const x1 = torsoXAt(an, 'R', y0 + h * 0.5) - 0.7;
  return { x0: x1 - w, x1, y0, y1: y0 + h };
}

function leatherBag(ctx: LayerCtx, b: HipBag, color: string, o: { flap?: boolean; clasp?: 'turn' | 'gem' } = {}): void {
  const { an } = ctx;
  const lite = isLite(ctx);
  const lt = leatherTones(color);
  const { x0, x1, y0, y1 } = b;
  const w = x1 - x0;
  const h = y1 - y0;
  // sombra de contato no corpo
  ctx.push(blob((x0 + x1) / 2 + 0.4, y1 + 0.2, w * 0.55, 1.5), '#0A0610', { o: 0.35, b: lite ? 0 : 0.8, cp: torsoPath(an, { ease: 1.2 }) });
  const body = smoothPath([[x0 + 0.5, y0, 0.6], [x1 - 0.5, y0, 0.6], [x1 + 0.25, y0 + h * 0.55], [x1 - 0.5, y1, 0.7], [x0 + 0.5, y1, 0.7], [x0 - 0.25, y0 + h * 0.55]], true);
  ctx.push(body, color, { gf: { t: 'r', cx: x0 + w * 0.3, cy: y0 + h * 0.3, r: w * 0.85, s: [[0, lt.light], [0.45, lt.base], [0.85, lt.shade], [1, lt.deep]] } });
  // fole do lado direito (sombra) e base
  ctx.push(taperPath([[x1 - 0.4, y0 + 0.6], [x1 + 0.05, y0 + h * 0.55], [x1 - 0.5, y1 - 0.3]], [0.6, 1.2, 0.6]), lt.deep, { o: 0.45, b: lite ? 0 : 0.35, cp: body });
  ctx.push(blob((x0 + x1) / 2, y1, w * 0.5, 1.0), lt.deep, { o: 0.35, b: lite ? 0 : 0.6, cp: body });
  if (o.flap === false) return;
  const fy = y0 + h * 0.58;
  const flapPts: SP[] = [[x0 + 0.2, y0 - 0.25, 0.5], [x1 - 0.2, y0 - 0.25, 0.5], [x1 + 0.15, y0 + h * 0.4], [(x0 + x1) / 2, fy + 0.5], [x0 - 0.15, y0 + h * 0.4]];
  const flap = smoothPath(flapPts, true);
  ctx.push(taperPath([[x0 + 0.2, y0 + h * 0.42], [(x0 + x1) / 2, fy + 0.95], [x1 - 0.2, y0 + h * 0.42]], [0.6, 1.0, 0.6]), lt.deep, { o: 0.45, b: lite ? 0 : 0.35, cp: body });
  ctx.push(flap, color, { gf: { t: 'l', x1: 0, y1: y0, x2: 0, y2: fy, s: [[0, lt.light], [0.55, lt.base], [1, mix(lt.base, lt.shade, 0.5)]] } });
  if (!lite) {
    // brilho especular do couro, pesponto da aba
    ctx.push(taperPath([[x0 + w * 0.2, y0 + 0.5], [x0 + w * 0.42, y0 + 0.35], [x0 + w * 0.7, y0 + 0.6]], [0, 0.55, 0]), '#FFFFFF', { o: 0.35, cp: flap });
    ctx.stroke(smoothPath([[x0 + 0.6, y0 + h * 0.36], [(x0 + x1) / 2, fy - 0.05], [x1 - 0.6, y0 + h * 0.36]], false), threadOf(color), 0.13, { o: 0.6, da: [0.4, 0.3], c: 'butt', cp: flap });
  }
  const cc: Pt = [(x0 + x1) / 2, fy - 0.2];
  if (o.clasp === 'gem') {
    ctx.push(ellipse(cc[0], cc[1], 0.75, 0.75), '#E8C25A', { gf: metalGrad(cc[0] - 0.8, cc[1] - 0.8, 1.6, 1.6) });
    ctx.push(ellipse(cc[0], cc[1], 0.42, 0.42), '#F5F9FF', { gf: { t: 'r', cx: cc[0] - 0.12, cy: cc[1] - 0.15, r: 0.5, s: [[0, '#FFFFFF'], [0.6, '#BFD8FF'], [1, '#6A84B8']] } });
  } else {
    ctx.push(smoothPath([[cc[0] - 0.85, cc[1] - 0.55, 0.5], [cc[0] + 0.85, cc[1] - 0.55, 0.5], [cc[0] + 0.85, cc[1] + 0.55, 0.5], [cc[0] - 0.85, cc[1] + 0.55, 0.5]], true, 0.6), '#E6BE58', { gf: metalGrad(cc[0] - 0.9, cc[1] - 0.6, 1.8, 1.2) });
    if (!lite) ctx.push(blob(cc[0], cc[1], 0.32, 0.5), '#8A6420');
  }
}

function crossbody(ctx: LayerCtx): void {
  const { an } = ctx;
  const C = '#9A5A2E';
  const clip = torsoClip(an);
  const w = clamp(8.6 + an.w.hip * 0.1, 9, 11);
  const b = hipBagBox(an, w, w * 0.74);
  const ringL: Pt = [b.x0 + 0.9, b.y0 + 0.2];
  const ringR: Pt = [b.x1 - 0.9, b.y0 + 0.2];
  const sL = shoulderPt(an, 'L', 0.55);
  const mid: Pt = [(sL[0] + ringL[0]) / 2 + 0.6, (sL[1] + ringL[1]) / 2 + 0.6];
  strap(ctx, [[sL[0] - 0.3, sL[1] - 1.4], sL, mid, ringL], { w: 1.05, color: mix(C, '#000000', 0.1), shadow: clip, stitch: true });
  // a alça termina na argola da direita (antes ela seguia até a lateral e virava um toco por cima do antebraço)
  leatherBag(ctx, b, C, { clasp: 'turn' });
  let rings = '';
  for (const r of [ringL, ringR]) rings += ellipse(r[0], r[1] + 0.15, 0.55, 0.45);
  ctx.stroke(rings, '#D9B45A', 0.28);
}

// ---------------------------------------------------------------------------------------------------------------
// ecobag (lona crua com estampa de folhinha; alças no ombro direito, corpo pendurado atrás do braço)
// ---------------------------------------------------------------------------------------------------------------

const CANVAS = '#E6DCC4';

function toteBox(an: Anatomy): { x0: number; x1: number; y0: number; y1: number } {
  // pende pelo lado de FORA do braço/quadril (no corpo de cintura fina o braço fica bem pra fora da cintura: presa na
  // cintura, a bolsa sumia inteira atrás do braço); ~4 unidades ficam atrás do antebraço
  const fa = limbWidthAt(an, 'forearm', 'R', 0.75);
  const armOut = fa.at[0] + fa.r;
  const x0 = Math.max(torsoXAt(an, 'R', an.waistY) - 4.2, torsoXAt(an, 'R', an.hipY) - 3.5, armOut - 4.2);
  return { x0, x1: x0 + clamp(13 + an.w.hip * 0.1, 13, 16), y0: an.waistY - 4, y1: an.hipY + 7.5 };
}

function toteBack(ctx: LayerCtx): void {
  const { an } = ctx;
  const lite = isLite(ctx);
  const t = fabric(CANVAS);
  const { x0, x1, y0, y1 } = toteBox(an);
  const w = x1 - x0;
  const sh = shoulderPt(an, 'R', 0.6);
  // alças subindo até o ombro (por trás do braço)
  const hc = mix(CANVAS, '#6A5A40', 0.25);
  ctx.push(taperPath([[x0 + 2.4, y0 + 0.5], [sh[0] - 0.6, (sh[1] + y0) / 2], [sh[0] - 0.3, sh[1] + 0.8]], [1.1, 1.1, 1.1], { round: true }) + taperPath([[x1 - 2.8, y0 + 0.5], [sh[0] + 3.5, (sh[1] + y0) / 2], [sh[0] + 0.8, sh[1] + 0.8]], [1.1, 1.1, 1.1], { round: true }), hc);
  // corpo: trapézio macio que barriga embaixo (lona com peso)
  const pts: SP[] = [[x0 + 0.3, y0, 0.5], [x1 - 0.3, y0, 0.5], [x1 + 0.6, (y0 + y1) / 2], [x1 + 0.4, y1 - 0.6, 0.6], [(x0 + x1) / 2, y1 + 0.5], [x0 - 0.2, y1 - 0.6, 0.6], [x0 - 0.4, (y0 + y1) / 2]];
  const d = smoothPath(pts, true);
  ctx.push(d, CANVAS, { gf: { t: 'l', x1: x0, y1: 0, x2: x1, y2: 0, s: [[0, t.light], [0.35, t.base], [0.8, t.shade], [1, t.deep]] } });
  // bainha de cima (faixa dobrada) e dobras macias que caem das alças
  ctx.push(taperPath([[x0 + 0.3, y0 + 1.2], [(x0 + x1) / 2, y0 + 1.35], [x1 - 0.3, y0 + 1.2]], [0.5, 0.6, 0.5]), t.deep, { o: 0.3, cp: d });
  if (!lite) {
    ctx.push(
      taperPath([[x0 + 3, y0 + 1.6], [x0 + 3.8, (y0 + y1) / 2], [x0 + 3.4, y1 - 1]], [0, 1.1, 0]) + taperPath([[x1 - 3.2, y0 + 1.6], [x1 - 4.2, (y0 + y1) / 2 + 1], [x1 - 3.6, y1 - 1.5]], [0, 1.0, 0]),
      t.deep,
      { o: 0.22, b: 0.6, cp: d },
    );
    ctx.stroke(smoothPath([[x0 + 0.5, y0 + 2.1], [x1 - 0.5, y0 + 2.1]], false), threadOf(CANVAS), 0.13, { o: 0.6, da: [0.4, 0.3], c: 'butt', cp: d });
  }
  // estampa: raminho de folhas verde-oliva (o lado de fora fica à mostra, além do braço)
  const lx = x0 + w * 0.68;
  const ly = (y0 + y1) / 2 + 0.5;
  const leaf = (x: number, y: number, a: number, r: number) => blob(x + Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.9, r, r * 0.45, a);
  const leaves = leaf(lx, ly - 1.2, -2.2, 1.2) + leaf(lx, ly - 1.2, -0.9, 1.2) + leaf(lx, ly + 0.6, -2.5, 1.1) + leaf(lx, ly + 0.6, -0.6, 1.1) + leaf(lx, ly - 2.8, -1.57, 1.0);
  ctx.push(leaves, '#5E7A3A', { o: 0.9, cp: d });
  ctx.stroke(smoothPath([[lx, ly + 2.8], [lx + 0.1, ly], [lx, ly - 2.6]], false), '#4A6230', 0.22, { o: 0.9, cp: d });
  torsoOcclusion(ctx, d, 0.45);
}

function toteFront(ctx: LayerCtx): void {
  const { an } = ctx;
  const clip = torsoClip(an);
  const sh = shoulderPt(an, 'R', 0.6);
  const yA = an.armpitY + 2.5;
  const xA = torsoXAt(an, 'R', yA) - 0.3;
  const hc = mix(CANVAS, '#6A5A40', 0.18);
  for (const k of [-0.75, 0.75]) {
    const spine: SP[] = [[sh[0] + k * 0.6 + 0.4, sh[1] - 1.3], [sh[0] + k * 0.7, sh[1]], [(sh[0] + xA) / 2 + k * 0.8 + 0.3, (sh[1] + yA) / 2], [xA + k * 0.5, yA]];
    strap(ctx, spine, { w: 1.05, color: hc, shadow: clip, cp: clip });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// clutch (envelope acetinado caramelo com fecho de pedra; na mão esquerda, ou na correntinha se a mão está ocupada)
// ---------------------------------------------------------------------------------------------------------------

/** caramelo acetinado: lê em cima de calça preta e blazer escuro (o preto sumia) e do vestido branco (o creme sumia) */
const CLUTCH = '#C4915A';

/** a mão esquerda pode segurar a clutch? */
export function clutchHandFree(ctx: LayerCtx): boolean {
  const sc = ctx.scene;
  if (sc.hands !== 'free' && sc.hands !== 'rest') return false;
  if (ctx.cfg.pride === 'flag' && sc.showLeftHandFlag) return false;
  return true;
}

function clutchInHand(ctx: LayerCtx): boolean {
  return ctx.cfg.bag === 'clutch' && clutchHandFree(ctx);
}

/**
 * clutch na mão esquerda (grupo foreL): o envelope fica atrás dos dedos e sai dos dois lados da mão — a mão é
 * repintada por cima (pegada). Chamada pela etapa do pulso, que roda depois da mão.
 */
export function drawClutchInHand(ctx: LayerCtx): void {
  if (!clutchInHand(ctx)) return;
  ctx = lodCtx(ctx);
  const { an } = ctx;
  const lite = isLite(ctx);
  ctx.withGroup('foreL', () => {
    const h = handShapes(an, 'L');
    let ux = h.tip[0] - h.palm[0];
    let uy = h.tip[1] - h.palm[1];
    const L = Math.hypot(ux, uy) || 1;
    ux /= L;
    uy /= L;
    // eixo comprido QUASE PARALELO aos dedos (girado ~16 graus pra fora): a bolsa fica na mão, atrás dos dedos, sai um
    // pouco dos dois lados da mão e passa da ponta dos dedos — a mão abraça a bolsa (antes: bloco atravessado no pulso)
    const th = -0.28;
    const ax = ux * Math.cos(th) - uy * Math.sin(th);
    const ay = ux * Math.sin(th) + uy * Math.cos(th);
    let nx = -ay;
    let ny = ax;
    if (nx < 0) {
      nx = -nx;
      ny = -ny;
    }
    // centro um pouco pro lado de fora da mão (a bolsa aparece além do dorso) e abaixo da palma
    const c: Pt = [h.palm[0] + ux * 3.0 - nx * 0.7, h.palm[1] + uy * 3.0 - ny * 0.7];
    const hl = 4.5;
    const hh = 3.0;
    const P = (a: number, b: number, s?: number): SP => (s == null ? [c[0] + ax * a + nx * b, c[1] + ay * a + ny * b] : [c[0] + ax * a + nx * b, c[1] + ay * a + ny * b, s]);
    const lt = { light: '#EED3A8', base: CLUTCH, shade: '#93673A', deep: '#5A3C20' };
    // envelope de cetim caramelo: retângulo macio, brilho acetinado na diagonal e borda escura fina
    const body = smoothPath([P(-hl, -hh + 0.4, 0.5), P(-hl + 0.4, -hh, 0.5), P(hl - 0.4, -hh - 0.1, 0.5), P(hl, -hh + 0.4, 0.5), P(hl, hh - 0.4, 0.5), P(hl - 0.4, hh + 0.1, 0.5), P(-hl + 0.4, hh, 0.5), P(-hl, hh - 0.4, 0.5)], true);
    const g0 = P(0, -hh);
    const g1 = P(0, hh);
    ctx.push(body, CLUTCH, { gf: { t: 'l', x1: g0[0], y1: g0[1], x2: g1[0], y2: g1[1], s: [[0, lt.light], [0.35, lt.base], [0.78, lt.shade], [1, lt.deep]] } });
    if (!lite) ctx.push(taperPath([P(hl * 0.7, -hh * 0.6), P(0, -hh * 0.15), P(-hl * 0.6, hh * 0.45)], [0.3, 1.2, 0.3]), '#FFFFFF', { o: 0.35, b: 0.4, cp: body });
    ctx.stroke(body, lt.deep, lite ? 0.3 : 0.2, { o: 0.7 });
    // moldura dourada no topo (lado do pulso) com o fecho de beijinho
    const frame = taperPath([P(-hl + 0.2, -hh + 0.2), P(-hl - 0.15, 0), P(-hl + 0.2, hh - 0.2)], [0.45, 0.6, 0.45], { round: true });
    ctx.push(frame, '#E2BE5E', { gf: metalGrad(c[0] - hl, c[1] - hl, hl * 2, hl * 2, 'gold') });
    if (!lite) {
      const k1 = P(-hl - 0.55, -0.45);
      const k2 = P(-hl - 0.55, 0.45);
      ctx.push(ellipse(k1[0], k1[1], 0.4, 0.4) + ellipse(k2[0], k2[1], 0.4, 0.4), '#E2BE5E', { gf: metalGrad(k1[0] - 1, k1[1] - 1, 2, 2, 'gold') });
    }
    // a mão por cima (dedos fechando na bolsa) e a sombra dela no cetim
    const t = tonesOf(ctx);
    const hs = an.spec.hand;
    ctx.push(h.hand, '#140A0C', { o: 0.28, ...(lite ? {} : { b: 0.45 }), cp: body });
    ctx.push(h.hand, t.base, { gf: cylGradient([h.palm[0] - ux * 4, h.palm[1] - uy * 4], h.tip, 2.4 * hs, 2.4 * hs, { light: t.light, base: t.base, shade: t.shade }) });
    ctx.push(blob(h.tip[0], h.tip[1], 2.6 * hs, 1.4 * hs), mix(t.shade, t.blush, 0.25), { o: 0.4, ...(lite ? {} : { b: 0.6 }), cp: h.hand });
    ctx.push(h.grooves.join(''), t.deep, { o: lite ? 0.45 : 0.6 });
    if (!lite) ctx.push(h.nails, mix(t.lighter, '#FFE8E0', 0.4), { o: 0.6 });
  });
}

/** mão ocupada: a clutch vira bolsinha de festa com correntinha dourada no ombro */
function clutchOnChain(ctx: LayerCtx): void {
  const { an } = ctx;
  const lite = isLite(ctx);
  const b = hipBagBox(an, 7.2, 4.6);
  const sL = shoulderPt(an, 'L', 0.55);
  const a: Pt = [b.x0 + 0.7, b.y0 + 0.2];
  const spine: SP[] = [sL, [(sL[0] + a[0]) / 2 + 0.5, (sL[1] + a[1]) / 2 + 0.5], a];
  ctx.stroke(smoothPath(spine, false), '#0A0610', 0.5, { o: 0.25, b: lite ? 0 : 0.4, cp: torsoClip(an) });
  ctx.stroke(smoothPath(spine, false), '#E2BE5E', lite ? 0.5 : 0.42);
  if (!lite) ctx.stroke(smoothPath(spine, false), '#8A6420', 0.22, { o: 0.8, da: [0.3, 0.35], c: 'butt' });
  leatherBag(ctx, b, CLUTCH, { clasp: 'gem' });
}

// ---------------------------------------------------------------------------------------------------------------
// pochete (náilon grafite, cinto na cintura, zíper curvo e puxador de couro)
// ---------------------------------------------------------------------------------------------------------------

function fanny(ctx: LayerCtx): void {
  const { an } = ctx;
  const { cx } = an;
  const lite = isLite(ctx);
  const C = '#2A2D36';
  const t = fabric(C);
  const clip = torsoClip(an);
  const y = an.waistY + 2.8;
  const w = clamp(an.w.waist * 0.95 + 1.5, 10, 15);
  const h = 5.4;
  const xc = cx + 0.9;
  const tilt = an.tilt.hip * 0.25;
  // cinto: contorna a cintura e SOME atrás dos braços — termina na borda de dentro do antebraço/manga (antes passava
  // por cima dos dois antebraços e das mangas de jaqueta e puffer), largura constante, sem ponta afinando em espeto
  const yb = y - 1.2;
  const endX = (s: Side): number => {
    const tx = torsoXAt(an, s, y - 1.4) + (s === 'L' ? -0.2 : 0.2);
    const ax = armInnerX(ctx, s, yb);
    if (ax == null) return tx;
    return s === 'L' ? Math.max(tx, ax) : Math.min(tx, ax);
  };
  const bl: Pt = [endX('L'), yb - tilt];
  const br: Pt = [endX('R'), yb + tilt];
  const beltSpine: SP[] = [bl, [(bl[0] + cx) / 2, y - 0.85 - tilt * 0.5], [cx, y - 0.6], [(br[0] + cx) / 2, y - 0.85 + tilt * 0.5], br];
  ctx.push(taperPath(beltSpine.map((p) => [p[0] + 0.3, p[1] + 0.6] as SP), [1.1, 1.2, 1.2, 1.2, 1.1]), '#0A0610', { o: 0.32, ...(lite ? {} : { b: 0.6 }), cp: clip });
  ctx.push(taperPath(beltSpine, [1.0, 1.0, 1.0, 1.0, 1.0]), '#1A1C22', { gf: acrossGrad(beltSpine, 0.5, [[0, '#4A4E5A'], [0.4, '#1A1C22'], [0.85, '#0E0F14'], [1, '#050608']]) });
  buckle(ctx, [xc - w / 2 - 1.9, y - 1.0 - tilt * 0.5], 1.7, 1.15, 0.05);
  // corpo em meia-lua
  const pts: SP[] = [[xc - w / 2, y - h * 0.48 - tilt, 0.5], [xc + w / 2, y - h * 0.5 + tilt, 0.5], [xc + w / 2 + 0.5, y + h * 0.05], [xc + w * 0.3, y + h * 0.56], [xc - w * 0.3, y + h * 0.58], [xc - w / 2 - 0.5, y + h * 0.05]];
  const d = smoothPath(pts, true);
  ctx.push(blob(xc + 0.5, y + h * 0.62, w * 0.45, 1.3), '#0A0610', { o: 0.35, b: lite ? 0 : 0.7, cp: torsoPath(an, { ease: 1.2 }) });
  ctx.push(d, C, { gf: { t: 'r', cx: xc - w * 0.2, cy: y - h * 0.25, r: w * 0.75, s: [[0, t.light], [0.45, t.base], [0.85, t.shade], [1, t.deep]] } });
  // brilho do náilon (faixa larga e macia) e zíper curvo do bolso da frente
  if (!lite) ctx.push(taperPath([[xc - w * 0.42, y - h * 0.18], [xc - w * 0.1, y - h * 0.3], [xc + w * 0.25, y - h * 0.22]], [0, 1.1, 0]), '#FFFFFF', { o: 0.22, b: 0.5, cp: d });
  const zip: SP[] = [[xc - w * 0.44, y - h * 0.05], [xc, y + h * 0.12], [xc + w * 0.44, y - h * 0.08]];
  ctx.stroke(smoothPath(zip, false), '#0A0B10', 0.45, { o: 0.9, cp: d });
  if (!lite) ctx.stroke(smoothPath(zip, false), '#B8C0CC', 0.18, { o: 0.7, da: [0.18, 0.2], c: 'butt', cp: d });
  // puxador: argola de metal + linguinha de couro
  const zp: Pt = [xc + w * 0.3, y + h * 0.02];
  ctx.push(ellipse(zp[0], zp[1], 0.38, 0.32), '#C9CED8');
  ctx.push(taperPath([[zp[0], zp[1] + 0.2], [zp[0] + 0.15, zp[1] + 1.4], [zp[0] + 0.1, zp[1] + 2.2]], [0.55, 0.6, 0.65], { round: true }), '#B07A4A');
}

// ---------------------------------------------------------------------------------------------------------------
// violão nas costas (tampo de abeto, faixa e braço de jacarandá; braço sai acima do ombro direito)
// ---------------------------------------------------------------------------------------------------------------

/** projetor do violão: a = ao longo (do centro do bojo de baixo pra mão), b = de lado */
function guitarFrame(an: Anatomy): { P: (a: number, b: number) => Pt; len: number; ux: number; uy: number } {
  const lc: Pt = [an.cx - an.w.hip - 3.2, an.hipY + 7];
  const hd: Pt = [an.cx + an.w.shoulder + 0.8, Math.max(9, an.shoulderY - 16)];
  const len = Math.hypot(hd[0] - lc[0], hd[1] - lc[1]);
  const ux = (hd[0] - lc[0]) / len;
  const uy = (hd[1] - lc[1]) / len;
  const nx = -uy;
  const ny = ux;
  return { P: (a, b) => [lc[0] + ux * a + nx * b, lc[1] + uy * a + ny * b], len, ux, uy };
}

/** meia-largura do corpo do violão ao longo de a */
const GUITAR_W: [number, number][] = [
  [-7.4, 0],
  [-6.8, 3.0],
  [-5.2, 5.4],
  [-3, 6.8],
  [0, 7.4],
  [3, 6.8],
  [5.6, 5.3],
  [7.6, 4.6],
  [9.6, 5.1],
  [12, 5.7],
  [14.5, 5.1],
  [16.4, 3.4],
  [17.3, 0],
];

/**
 * violão nas costas visto de frente da pessoa = as COSTAS do violão: fundo de mogno com filete central, faixa lateral,
 * filete creme na borda e pino da correia; braço liso com o salto na junção; mão vista por trás com as tarraxas.
 */
function guitarBack(ctx: LayerCtx): void {
  const { an } = ctx;
  const lite = isLite(ctx);
  const { P, len } = guitarFrame(an);
  const n0 = 16.6;
  const n1 = len - 6.2;
  // braço (por trás): madeira de mogno arredondada com luz do lado esquerdo e o salto alargando na junção
  const neck = smoothPath([P(n0 - 1.6, 1.9), P(n0 + 1.4, 1.2), P(n1, 1.0), P(n1, -1.0), P(n0 + 1.4, -1.2), P(n0 - 1.6, -1.9)], true, 0.5);
  ctx.push(neck, '#9A5A30', { gf: { t: 'l', ...xy(P(0, 1.4), P(0, -1.4)), s: [[0, '#6A3A1C'], [0.25, '#C98A52'], [0.55, '#9A5A30'], [1, '#4A2410']] } });
  // mão vista por trás: tarraxas em caixinhas de metal e os botões saindo pros lados
  const head = smoothPath([P(n1 - 0.4, 1.05), P(n1 + 1.2, 1.75), P(len, 1.85), P(len + 0.35, 0), P(len, -1.85), P(n1 + 1.2, -1.75), P(n1 - 0.4, -1.05)], true, 0.5);
  ctx.push(head, '#5A3220', { gf: { t: 'l', ...xy(P(n1, 1.8), P(n1, -1.8)), s: [[0, '#7A4A2C'], [0.5, '#5A3220'], [1, '#2E180C']] } });
  let gears = '';
  let knobs = '';
  for (let i = 0; i < 3; i++) {
    const a = n1 + 1.4 + i * 1.65;
    for (const g of [-1, 1]) {
      const p = P(a, g * 1.0);
      gears += ellipse(p[0], p[1], 0.55, 0.5);
      const k = P(a, g * 2.55);
      knobs += ellipse(k[0], k[1], 0.52, 0.42);
    }
  }
  ctx.push(gears, '#C9CED8', { gf: metalGrad(P(n1, 1)[0] - 2, P(len, 1)[1] - 2, 4, 6, 'silver') });
  ctx.push(knobs, '#F2EDE2', { gf: metalGrad(P(n1, 2.5)[0] - 3, P(len, 2.5)[1] - 3, 6, 6, 'silver') });
  if (!lite) ctx.push(gears, '#000000', { o: 0.25, b: 0.15 });
  // corpo: faixa lateral (um pouco maior) e fundo de mogno
  const outline = (e: number): SP[] => [...GUITAR_W.map(([a, w]) => P(a, w + e)), ...GUITAR_W.slice(1, -1).reverse().map(([a, w]) => P(a, -w - e))];
  ctx.push(smoothPath(outline(0.6), true), '#3E1C0C');
  const bodyD = smoothPath(outline(0), true);
  const hl = P(1.5, 3.2);
  ctx.push(bodyD, '#7A3A1E', { gf: { t: 'r', cx: hl[0], cy: hl[1], r: 14, s: [[0, '#B8693A'], [0.4, '#8A4422'], [0.85, '#5A2810'], [1, '#3E1C0C']] } });
  if (!lite) {
    // veios da madeira ao longo do corpo
    let grain = '';
    for (const b of [-4.6, -2.4, 2.2, 4.4]) grain += smoothPath([P(-6, b * 0.8), P(4, b), P(14, b * 0.85)], false);
    ctx.stroke(grain, '#3E1C0C', 0.16, { o: 0.35, cp: bodyD });
    // filete central (marchetaria) e filete creme da borda
    ctx.stroke(smoothPath([P(-7.2, 0), P(17, 0)], false), '#2A1208', 0.55, { o: 0.7, cp: bodyD });
    ctx.stroke(smoothPath([P(-7.2, 0), P(17, 0)], false), '#E8D4A8', 0.22, { o: 0.9, cp: bodyD });
    ctx.stroke(bodyD, '#F0DEB8', 0.3, { o: 0.8 });
    // brilho do verniz
    ctx.push(blob(hl[0], hl[1], 3.5, 1.6, Math.atan2(P(1, 0)[1] - P(0, 0)[1], P(1, 0)[0] - P(0, 0)[0])), '#FFFFFF', { o: 0.22, b: 0.8, cp: bodyD });
  }
  // pino da correia embaixo
  const pin = P(-7.6, 0);
  ctx.push(ellipse(pin[0], pin[1], 0.55, 0.55), '#1A1A1E');
  torsoOcclusion(ctx, bodyD, 0.55);
  torsoOcclusion(ctx, neck, 0.45);
}

const xy = (a: Pt, b: Pt): { x1: number; y1: number; x2: number; y2: number } => ({ x1: a[0], y1: a[1], x2: b[0], y2: b[1] });

/** alça tecida do violão: do ombro direito, atravessando o peito, até o quadril esquerdo */
function guitarStrap(ctx: LayerCtx): void {
  const { an } = ctx;
  const lite = isLite(ctx);
  const clip = torsoClip(an);
  const sR = shoulderPt(an, 'R', 0.5);
  const yE = an.hipY - 1.5;
  const end: Pt = [torsoXAt(an, 'L', yE) + 0.2, yE];
  const mid: Pt = [(sR[0] + end[0]) / 2 + 0.4, (sR[1] + end[1]) / 2 + 0.8];
  const spine: SP[] = [[sR[0] + 0.3, sR[1] - 1.4], sR, mid, end];
  const d = strap(ctx, spine, { w: 1.7, color: '#5B3A29', shadow: clip, cp: clip });
  // trama: listra central mostarda tracejada e filetes creme
  ctx.stroke(smoothPath(spine, false), '#D9A43A', lite ? 0.6 : 0.5, { o: 0.9, da: lite ? undefined : [0.9, 0.5], c: 'butt', cp: d });
  if (!lite) {
    ctx.stroke(smoothPath(offLine(spine, 0.55), false) + smoothPath(offLine(spine, -0.55), false), '#EADBC0', 0.14, { o: 0.75, cp: d });
    ctx.stroke(smoothPath(spine, false), '#2E8C8C', 0.5, { o: 0.85, da: [0.5, 0.9], c: 'butt', cp: d });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// asas de pena (anjo: pérola com pena em camadas; neon: as mesmas penas em traço de luz lima → magenta)
// ---------------------------------------------------------------------------------------------------------------

interface Feather {
  base: Pt;
  tip: Pt;
  w: number;
}

interface WingGeo {
  /** fileiras de trás pra frente: rêmiges, coberteiras, penugem */
  rows: Feather[][];
  /** osso de cima (raiz → punho → ponta) */
  bone: SP[];
  /** massa da asa (preenche os vãos entre as penas) */
  mass: string;
  /** y de cima e de baixo (gradientes) */
  y0: number;
  y1: number;
}

/**
 * asa de penas: o osso sobe da omoplata até o punho (fora do ombro, o ponto mais alto) e desce até a ponta; as penas
 * caem do osso, abrindo pra fora na ponta (as rêmiges de fora são as mais longas) — vela grande com a borda de baixo em
 * festão. Meia-envergadura ≤ 43 (cabe no viewBox).
 */
function wingFeathers(an: Anatomy, s: Side): WingGeo {
  const g = gOf(s);
  const { cx } = an;
  const sy = an.shoulderY;
  const bone: SP[] = [
    [cx + g * 4, an.armpitY - 1.5],
    [cx + g * 11, sy - 9],
    [cx + g * 20, sy - 14.5],
    [cx + g * 25.5, sy - 13.5],
    [cx + g * 29, sy - 10],
  ];
  const line = sampleSpline(bone, 41);
  const along = (u: number): Pt => line[Math.round(clamp(u, 0, 1) * 40)];
  const row = (n: number, u0: number, u1: number, len: (u: number) => number, ang: (u: number) => number, w: (u: number) => number, drop: number): Feather[] => {
    const out: Feather[] = [];
    for (let i = 0; i < n; i++) {
      const u = u0 + ((u1 - u0) * i) / (n - 1);
      const b = along(u);
      const a = (ang(u) * Math.PI) / 180;
      const L = len(u);
      const base: Pt = [b[0], b[1] + drop];
      out.push({ base, tip: [base[0] + g * Math.sin(a) * L, base[1] + Math.cos(a) * L], w: w(u) });
    }
    return out;
  };
  const prim = row(15, 0.05, 1, (u) => 14 + 16 * Math.pow(u, 1.4), (u) => 2 + 26 * Math.pow(u, 1.5), (u) => 4.3 + 0.7 * u, 0.8);
  const cov = row(12, 0.03, 0.97, (u) => 7.5 + 5 * u, (u) => 4 + 24 * Math.pow(u, 1.5), () => 4.6, 0.3);
  const marg = row(10, 0, 0.95, (u) => 3.6 + 1.3 * u, (u) => 8 + 22 * u, () => 3.6, -0.3);
  const tips = prim.map((f) => f.tip).reverse();
  const mass = smoothPath([...bone, ...tips.map((p) => [p[0] - g * 0.4, p[1] - 1.2] as SP), [bone[0][0], bone[0][1] + 6]], true);
  let y1 = -Infinity;
  for (const f of prim) y1 = Math.max(y1, f.tip[1]);
  return { rows: [prim, cov, marg], bone, mass, y0: sy - 15, y1 };
}

/** pena: gota alongada da base à ponta, levemente curvada pra fora, ponta arredondada */
function featherPath(f: Feather, g: number): string {
  const m: Pt = [f.base[0] + (f.tip[0] - f.base[0]) * 0.55 + g * 0.5, f.base[1] + (f.tip[1] - f.base[1]) * 0.55];
  return taperPath([f.base, m, f.tip], [f.w * 0.62, f.w, f.w * 0.5], { round: true });
}

function featherWings(ctx: LayerCtx, kind: 'angel' | 'neon'): void {
  const { an } = ctx;
  const lite = isLite(ctx);
  const neon = kind === 'neon';
  for (const s of SIDES) {
    const g = gOf(s);
    const wg = wingFeathers(an, s);
    const { rows, bone, mass } = wg;
    if (neon) {
      // asas de luz: penas de vidro translúcido (membrana) em degradê — magenta na raiz, violeta no meio, lima nas pontas
      // — com raque fina clara e brilho interno macio. O neon fica no brilho, não num contorno aramado.
      const vgN = (top: string, bot: string, o: number): AvatarGradient => ({ t: 'l', x1: 0, y1: wg.y0, x2: 0, y2: wg.y1, s: [[0, top, o], [0.55, mix(top, bot, 0.5), o * 0.85], [1, bot, o * 0.7]] });
      if (!lite) ctx.push(mass, '#B04CFF', { o: 0.22, b: 2.6 });
      ctx.push(mass, '#3A1E5E', { gf: vgN('#5A2A7E', '#24304A', 0.5) });
      // fileiras de trás pra frente: longas (pontas lima), médias (violeta), cobertura perto do osso (magenta)
      const ROW: [string, string][] = [
        ['#C77DFF', '#B8FF6A'],
        ['#E05CD8', '#A47CFF'],
        ['#FF5CB0', '#D86BFF'],
      ];
      rows.forEach((r, i) => {
        const [top, bot] = ROW[i] ?? ROW[0];
        if (i > 0 && !lite) ctx.push(r.map((f) => featherPath({ base: [f.base[0], f.base[1] + 0.9], tip: [f.tip[0] + g * 0.2, f.tip[1] + 0.9], w: f.w }, g)).join(''), '#1A0A30', { o: 0.25, b: 0.7, cp: mass });
        const even = r.filter((_, k) => k % 2 === 0).map((f) => featherPath(f, g)).join('');
        const odd = r.filter((_, k) => k % 2 === 1).map((f) => featherPath(f, g)).join('');
        ctx.push(odd, top, { gf: vgN(mix(top, '#2A1446', 0.18), mix(bot, '#2A1446', 0.18), 0.72) });
        ctx.push(even, top, { gf: vgN(top, bot, 0.78) });
        if (!lite) {
          // raque (haste) clara e borda de luz bem fina: lê pena por pena sem virar arame
          let rq = '';
          for (const f of r) {
            const a: Pt = [f.base[0] + (f.tip[0] - f.base[0]) * 0.12, f.base[1] + (f.tip[1] - f.base[1]) * 0.12];
            const m: Pt = [f.base[0] + (f.tip[0] - f.base[0]) * 0.55 + g * 0.5, f.base[1] + (f.tip[1] - f.base[1]) * 0.55];
            const b: Pt = [f.base[0] + (f.tip[0] - f.base[0]) * 0.86, f.base[1] + (f.tip[1] - f.base[1]) * 0.86];
            rq += smoothPath([a, m, b], false);
          }
          ctx.stroke(rq, '#FFF4FF', 0.14, { o: 0.55 });
          ctx.stroke(even + odd, '#FFFFFF', 0.1, { o: 0.28 });
        }
      });
      if (!lite) {
        // brilho interno: luz quente perto do osso, fria nas pontas (vidro iluminado por dentro)
        ctx.push(blob(bone[2][0] - g * 2, bone[2][1] + 6, 10, 6, g * 0.3), '#FFB8E8', { o: 0.32, b: 2.0, cp: mass });
        ctx.push(blob(bone[4][0] + g * 4, wg.y1 - 6, 8, 7), '#D8FFB0', { o: 0.22, b: 2.0, cp: mass });
        ctx.stroke(smoothPath(bone, false), '#FFE6FF', 1.2, { o: 0.45, b: 0.6 });
      }
      ctx.stroke(smoothPath(bone, false), '#FFFFFF', lite ? 0.5 : 0.35, { o: 0.7 });
      continue;
    }
    const lit = s === 'L';
    const vg = (top: string, bot: string): AvatarGradient => ({ t: 'l', x1: 0, y1: wg.y0, x2: 0, y2: wg.y1, s: [[0, top], [0.55, mix(top, bot, 0.45)], [1, bot]] });
    ctx.push(mass, lit ? '#C3CBDE' : '#AEB7CE', { gf: vg(lit ? '#DCE2EF' : '#C9D0E2', lit ? '#9EA9C6' : '#8A95B4') });
    const tones: [string, string][] = [
      [lit ? '#F2F4FA' : '#DFE4EF', lit ? '#AEB8D2' : '#99A4C2'],
      [lit ? '#FAFBFE' : '#E8ECF4', lit ? '#C9D0E2' : '#B5BED5'],
      [lit ? '#FFFFFF' : '#F0F2F8', lit ? '#E2E7F2' : '#CDD4E5'],
    ];
    rows.forEach((r, i) => {
      // sombra da fileira de cima sobre a de baixo
      if (i > 0 && !lite) ctx.push(r.map((f) => featherPath({ base: [f.base[0], f.base[1] + 1.0], tip: [f.tip[0] + g * 0.2, f.tip[1] + 1.0], w: f.w }, g)).join(''), '#2E3858', { o: 0.2, b: 0.8, cp: mass });
      // penas alternadas em dois tons (lê pena por pena sem contorno)
      const even = r.filter((_, k) => k % 2 === 0).map((f) => featherPath(f, g)).join('');
      const odd = r.filter((_, k) => k % 2 === 1).map((f) => featherPath(f, g)).join('');
      ctx.push(odd, tones[i][0], { gf: vg(mix(tones[i][0], '#C8D0E4', 0.15), mix(tones[i][1], '#7A86A8', 0.12)) });
      ctx.push(even, tones[i][0], { gf: vg(tones[i][0], tones[i][1]) });
      if (!lite) {
        // ráquis (haste) e borda fina de cada pena
        let rq = '';
        for (const f of r) {
          const a: Pt = [f.base[0] + (f.tip[0] - f.base[0]) * 0.12, f.base[1] + (f.tip[1] - f.base[1]) * 0.12];
          const m: Pt = [f.base[0] + (f.tip[0] - f.base[0]) * 0.55 + g * 0.5, f.base[1] + (f.tip[1] - f.base[1]) * 0.55];
          const b: Pt = [f.base[0] + (f.tip[0] - f.base[0]) * 0.86, f.base[1] + (f.tip[1] - f.base[1]) * 0.86];
          rq += smoothPath([a, m, b], false);
        }
        ctx.stroke(rq, '#8B95B5', 0.13, { o: 0.4 });
        ctx.stroke(even + odd, '#7C87A8', 0.12, { o: 0.3 });
      }
    });
    if (!lite) {
      // brilho perolado: quente perto do osso, frio nas pontas; luz no osso
      ctx.push(blob(bone[2][0] - g * 2, bone[2][1] + 6, 10, 6, g * 0.3), '#FFF1D2', { o: lit ? 0.3 : 0.18, b: 2.0, cp: mass });
      ctx.push(blob(bone[4][0] + g * 4, wg.y1 - 6, 8, 7), '#D9E6FF', { o: 0.25, b: 2.0, cp: mass });
      ctx.stroke(smoothPath(bone, false), '#FFFFFF', 1.1, { o: 0.6, b: 0.45 });
    }
  }
  if (!neon) torsoShadowOnWings(ctx);
}

/** o tronco faz sombra na raiz das asas */
function torsoShadowOnWings(ctx: LayerCtx): void {
  if (isLite(ctx)) return;
  const { an } = ctx;
  ctx.push(blob(an.cx, an.armpitY + 6, an.w.chest + 4, 12), '#202840', { o: 0.25, b: 2.2 });
}

// ---------------------------------------------------------------------------------------------------------------
// asas de borboleta (membrana translúcida magenta → violeta → dourado, nervuras, borda escura com pintinhas)
// ---------------------------------------------------------------------------------------------------------------

function butterflyWings(ctx: LayerCtx): void {
  const { an } = ctx;
  const lite = isLite(ctx);
  const { cx } = an;
  for (const s of SIDES) {
    const g = gOf(s);
    const root: Pt = [cx + g * 3, an.armpitY + 1];
    const fore: SP[] = [root, [cx + g * 10, an.shoulderY - 14], [cx + g * 24, an.shoulderY - 21], [cx + g * 36, an.shoulderY - 19], [cx + g * 38, an.shoulderY - 9], [cx + g * 31, an.armpitY + 3], [cx + g * 16, an.armpitY + 5]];
    const hind: SP[] = [[cx + g * 4, an.armpitY + 4], [cx + g * 22, an.armpitY + 3], [cx + g * 31, an.waistY + 3], [cx + g * 26, an.waistY + 14], [cx + g * 15, an.waistY + 15], [cx + g * 6, an.waistY + 6]];
    const fd = smoothPath(fore, true);
    const hd = smoothPath(hind, true);
    const grad = (a: Pt, r: number): AvatarGradient => ({ t: 'r', cx: a[0], cy: a[1], r, s: [[0, '#FFD36A', 0.95], [0.3, '#FF4FB0', 0.9], [0.75, '#9B3CFF', 0.88], [1, '#3A1470', 0.95]] });
    ctx.push(hd, '#C040E0', { gf: grad(root, 26) });
    ctx.push(fd, '#FF3FA8', { gf: grad(root, 38) });
    // nervuras: do corpo pra borda
    if (!lite) {
      let v = '';
      for (const p of [fore[2], fore[3], fore[4], fore[5]]) v += smoothPath([root, [(root[0] + p[0]) / 2 + g * 0.5, (root[1] + p[1]) / 2 - 1.5], [p[0] - g * 2.5, p[1] + 0.5]], false);
      for (const p of [hind[2], hind[3], hind[4]]) v += smoothPath([hind[0], [(hind[0][0] + p[0]) / 2, (hind[0][1] + p[1]) / 2 + 1], [p[0] - g * 2, p[1] - 1.2]], false);
      ctx.stroke(v, '#2A0A3A', 0.32, { o: 0.65, cp: fd + hd });
    }
    // borda escura com pintinhas claras
    ctx.stroke(fd + hd, '#1E0A2E', lite ? 1.2 : 1.6, { o: 0.9, cp: fd + hd });
    if (!lite) {
      let dots = '';
      for (const p of [fore[2], fore[3], fore[4], hind[2], hind[3]]) dots += ellipse(p[0] - g * 1.2, p[1] + 0.8, 0.45, 0.45);
      ctx.push(dots, '#FFF2D0', { o: 0.95 });
      // brilho de seda na membrana
      ctx.push(blob(cx + g * 20, an.shoulderY - 13, 9, 3, g * -0.25), '#FFFFFF', { o: 0.28, b: 1.4, cp: fd });
    }
  }
  torsoShadowOnWings(ctx);
}

// ---------------------------------------------------------------------------------------------------------------
// asas de dragão (osso com dedos, membrana com festão entre as pontas, garrinha no punho)
// ---------------------------------------------------------------------------------------------------------------

function dragonWings(ctx: LayerCtx): void {
  const { an } = ctx;
  const lite = isLite(ctx);
  const { cx } = an;
  const BONE = '#1E3A3A';
  for (const s of SIDES) {
    const g = gOf(s);
    const lit = s === 'L';
    const root: Pt = [cx + g * 4, an.armpitY];
    const elbow: Pt = [cx + g * 15, an.shoulderY - 12];
    const wrist: Pt = [cx + g * 24, an.shoulderY - 19];
    const tips: Pt[] = [
      [cx + g * 38, an.shoulderY - 14],
      [cx + g * 39, an.armpitY + 2],
      [cx + g * 32, an.waistY + 4],
      [cx + g * 20, an.waistY + 9],
    ];
    // membrana: punho → pontas, com festão (arco pra dentro) entre as pontas, e de volta pela raiz
    const mem: SP[] = [root, elbow, wrist, [tips[0][0], tips[0][1], 0]];
    for (let i = 0; i < tips.length - 1; i++) {
      const a = tips[i];
      const b = tips[i + 1];
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      mem.push([mx - g * 3.2, my - 0.8], [b[0], b[1], 0]);
    }
    mem.push([(tips[3][0] + root[0]) / 2 + g * 1.5, (tips[3][1] + root[1]) / 2 + 2], [cx + g * 5, an.waistY]);
    const md = smoothPath(mem, true);
    ctx.push(md, '#2F6B66', { gf: { t: 'r', cx: wrist[0], cy: wrist[1] + 6, r: 30, s: [[0, lit ? '#5FA59C' : '#4A8C84', 0.92], [0.5, '#2F6B66', 0.9], [1, '#1A2E46', 0.95]] } });
    // dedos (ossos) do punho às pontas
    let bones = '';
    for (const tp of tips) bones += taperPath([wrist, [(wrist[0] + tp[0]) / 2 + g * 0.8, (wrist[1] + tp[1]) / 2 - 1], tp], [1.3, 0.9, 0.3], { round: true });
    bones += taperPath([root, elbow, wrist], [2.0, 1.8, 1.6], { round: true });
    if (!lite) {
      // veias finas na membrana e luz de translucidez
      let veins = '';
      for (let i = 0; i < tips.length - 1; i++) {
        const a = tips[i];
        const b = tips[i + 1];
        veins += smoothPath([[(wrist[0] + a[0] + b[0]) / 3, (wrist[1] + a[1] + b[1]) / 3], [(a[0] + b[0]) / 2 - g * 4, (a[1] + b[1]) / 2 - 1.6]], false);
      }
      ctx.stroke(veins, '#173232', 0.25, { o: 0.5, cp: md });
      ctx.push(blob(wrist[0] + g * 6, wrist[1] + 9, 8, 6), '#9FE0D2', { o: 0.22, b: 2.0, cp: md });
    }
    ctx.push(bones, BONE, { gf: { t: 'l', x1: wrist[0], y1: wrist[1] - 2, x2: wrist[0], y2: wrist[1] + 18, s: [[0, '#4C7A72'], [0.4, BONE], [1, '#0E1E22']] } });
    if (!lite) ctx.stroke(taperPath([root, elbow, wrist], [0.6, 0.6, 0.5]), '#8FC4B8', 0.2, { o: 0.5 });
    // garrinha no punho
    ctx.push(taperPath([wrist, [wrist[0] + g * 0.6, wrist[1] - 1.8], [wrist[0] + g * 1.6, wrist[1] - 2.6]], [1.0, 0.6, 0], {}), '#E8E0C8');
    // festão: borda mais escura
    if (!lite) ctx.stroke(md, '#0E1E22', 0.5, { o: 0.55, cp: md });
  }
  torsoShadowOnWings(ctx);
}

// ---------------------------------------------------------------------------------------------------------------
// jetpack (dois tanques de metal escovado com faixa lima, bocais e chama de luz)
// ---------------------------------------------------------------------------------------------------------------

function jetpackBack(ctx: LayerCtx): void {
  const { an } = ctx;
  const lite = isLite(ctx);
  const { cx } = an;
  // tanques altos atrás das costas: a tampa e a faixa lima aparecem acima dos ombros; o corpo dos tanques fica dentro
  // da silhueta (nada de bloco solto entre o braço e a cintura). Bocais e chamas ficam atrás do tronco, junto da coluna,
  // com brilho curto (antes as chamas saíam na altura das mãos e pareciam tochas)
  const yT = an.shoulderY - 10;
  const yB = an.waistY - 1;
  const r = 3.3;
  const plate = smoothPath(sym(cx, [[cx - 4, yT + 4], [cx - an.w.chest + 3, yT + 5.5], [cx - an.w.chest + 3, yB - 1], [cx - 4, yB + 1]]), true, 0.6);
  ctx.push(plate, '#3A404E', { gf: metalGrad(cx - an.w.chest, yT, an.w.chest * 2, yB - yT, 'silver') });
  for (const s of SIDES) {
    const g = gOf(s);
    const x = cx + g * Math.min(an.w.chest - r - 0.6, Math.abs(torsoXAt(an, s, an.armpitY + 2, -0.4) - cx) - r);
    const fy = yB + 3.2;
    const fx = cx + g * 3.4;
    // chama curta saindo do bocal pra baixo (atrás do quadril: só o brilho escapa)
    if (!lite) ctx.push(blob(fx, fy + 5, 2.6, 5.5), '#00E5FF', { o: 0.16, b: 1.6 });
    ctx.push(taperPath([[fx, fy - 0.4], [fx, fy + 4], [fx + g * 0.3, fy + 8]], [2.2, 1.6, 0]), '#FF8A2A', { o: 0.8, ...(lite ? {} : { b: 1.0 }) });
    ctx.push(taperPath([[fx, fy - 0.4], [fx, fy + 2.6], [fx, fy + 5]], [1.2, 0.8, 0]), '#FFF2C0', { o: 0.95, ...(lite ? {} : { b: 0.3 }) });
    // bocal (cone cromado) embaixo da placa, junto da coluna
    const noz = smoothPath([[fx - 1.4, yB - 0.5, 0.4], [fx + 1.4, yB - 0.5, 0.4], [fx + 1.9, fy, 0.3], [fx - 1.9, fy, 0.3]], true, 0.4);
    ctx.push(noz, '#2A2E38', { gf: metalGrad(fx - 2, yB, 4, 4, 'chrome') });
    // tanque: cápsula com tampa redonda, metal escovado
    const tank = smoothPath([[x - r, yT + r], [x - r * 0.7, yT + 0.6], [x, yT - 0.4], [x + r * 0.7, yT + 0.6], [x + r, yT + r], [x + r, yB, 0.5], [x - r, yB, 0.5]], true);
    ctx.push(tank, '#A6AEBC', { gf: { t: 'l', x1: x - r, y1: 0, x2: x + r, y2: 0, s: [[0, '#6A7282'], [0.18, '#F2F5FA'], [0.4, '#B7BFCC'], [0.75, '#6E7686'], [1, '#3E4452']] } });
    // faixa lima perto da tampa (aparece acima do ombro) e anel escuro
    const by = yT + 4.6;
    const bandD = smoothPath([[x - r, by - 0.75], [x, by - 0.35], [x + r, by - 0.75], [x + r, by + 0.75], [x, by + 1.15], [x - r, by + 0.75]], true, 0.6);
    ctx.push(bandD, '#7FFF00', { o: 0.95, cp: tank });
    if (!lite) {
      ctx.push(bandD, '#7FFF00', { o: 0.35, b: 0.8 });
      ctx.stroke(smoothPath([[x - r, yT + 2.4], [x, yT + 2.8], [x + r, yT + 2.4]], false), '#2A2E38', 0.3, { o: 0.7, cp: tank });
      ctx.push(blob(x - r * 0.4, yT + 1.4, 0.9, 1.3), '#FFFFFF', { o: 0.65, b: 0.3, cp: tank });
    }
    torsoOcclusion(ctx, tank, 0.4);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// (testes) ids com desenho próprio
// ---------------------------------------------------------------------------------------------------------------

export const BAG_KINDS = ['backpack', 'crossbody', 'tote', 'clutch', 'fanny', 'guitar_back', 'wings_angel', 'wings_butterfly', 'wings_dragon', 'jetpack', 'wings_neon'];

