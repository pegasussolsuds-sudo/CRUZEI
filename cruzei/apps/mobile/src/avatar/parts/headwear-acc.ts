// Acessórios de cabeça e orelha: brincos (ponto de luz, argolas, pérolas), ear cuff, piercing no nariz, aparelho
// auditivo atrás da orelha, flor atrás da orelha, borboletas pousadas no cabelo, coroa de flores, fone e headset.
// Tudo sai das âncoras da cabeça (orelha, nariz, boca) e do volume do cabelo (hf.bulk/hairLift). Dono: chapelaria.
//
// Duas etapas:
//   ACCESSORIES (22, por baixo dos óculos e do chapéu)
//   OVER_HAT    (24b, por cima do chapéu): conchas do fone/headset e o arco quando o chapéu é justo (boné, gorro,
//               turbante, hijab) ou não há chapéu. Com aba, coroa, tiara etc. o arco vai na etapa 22 (o chapéu cobre).

import type { LayerCtx } from '../ctx';
import type { AvatarStop } from '../types';

import { hatModeOf } from './hat-modes';
import { HAT_TOP } from './headwear-hats';
import { GOLD_STOPS, SILVER_STOPS, SKULL_CY, SKULL_RY, bandU, blob, boxOf, gem, metalGrad, mix, neon, pearl, smoothPath, sparkle, taperPath, tones, type HeadFrame, type SP } from './headwear-kit';

type AccFn = (ctx: LayerCtx, hf: HeadFrame) => void;
type Pt2 = [number, number];

const SHADOW = '#1E0F0A';

const fx = (n: number): string => n.toFixed(2);
const dot = (x: number, y: number, r: number): string => `M${fx(x - r)},${fx(y)}a${fx(r)},${fx(r)} 0 1,0 ${fx(2 * r)},0a${fx(r)},${fx(r)} 0 1,0 ${fx(-2 * r)},0Z`;

/** referencial da orelha: u pra FORA da cabeça, v pra baixo, em unidades da orelha (mesmo de earShapes) */
function ear(ctx: LayerCtx, hf: HeadFrame, side: 1 | -1): { k: number; P: (u: number, v: number) => Pt2 } {
  const c = side > 0 ? hf.ha.earR : hf.ha.earL;
  const k = hf.s * 0.9 * (1 + ctx.an.feat.age * 0.07);
  return { k, P: (u, v) => [c[0] + side * u * k, c[1] + v * k] };
}

const SIDES: readonly (1 | -1)[] = [-1, 1];

// ---------------------------------------------------------------------------------------------------------------
// orelha e nariz
// ---------------------------------------------------------------------------------------------------------------

/** brincos: ponto de luz (cristal lapidado em garra dourada) */
function earrings(ctx: LayerCtx, hf: HeadFrame): void {
  for (const sd of SIDES) {
    const e = ear(ctx, hf, sd);
    const [x, y] = e.P(0.05, 2.5);
    const r = (hf.lite ? 0.72 : 0.48) * e.k;
    ctx.push(dot(x, y, r * 1.22), '#C99A2E', { gf: metalGrad({ x: x - r, y: y - r, w: 2 * r, h: 2 * r }, GOLD_STOPS) });
    gem(ctx, hf, x, y, r, '#DDF3FF', { glint: true });
    if (sd > 0) ctx.push(sparkle(x - 0.55 * e.k, y - 0.55 * e.k, (hf.lite ? 0.85 : 0.7) * e.k), '#FFFFFF', { o: 0.95 });
  }
}

/** argolas douradas */
function hoops(ctx: LayerCtx, hf: HeadFrame): void {
  for (const sd of SIDES) {
    const e = ear(ctx, hf, sd);
    const [x, y] = e.P(0.05, 2.55);
    const R = 1.55 * e.k;
    const rx = R * 0.62;
    const cy = y + R;
    const cxh = x + sd * 0.12 * e.k;
    const d = `M${fx(cxh)},${fx(y)}a${fx(rx)},${fx(R)} 0 1,1 -0.001,0`;
    const w = (hf.lite ? 0.42 : 0.34) * e.k;
    if (!hf.lite) ctx.stroke(`M${fx(cxh + 0.15)},${fx(y + 0.4)}a${fx(rx)},${fx(R)} 0 1,1 -0.001,0`, SHADOW, w, { o: 0.18, b: 0.3 });
    ctx.stroke(d, '#D9A93A', w, { gs: metalGrad({ x: cxh - rx, y, w: rx * 2, h: R * 2 }, GOLD_STOPS) });
    // luz no lado de fora (esquerda de quem olha) e um ponto de brilho
    ctx.stroke(`M${fx(cxh - rx * 0.92)},${fx(cy + R * 0.35)}A${fx(rx)},${fx(R)} 0 0,1 ${fx(cxh - rx * 0.35)},${fx(y + R * 0.08)}`, '#FFF4C4', w * 0.35, { o: 0.85 });
    ctx.push(dot(cxh - rx * 0.78, cy - R * 0.25, w * 0.32), '#FFFFFF', { o: 0.9 });
  }
}

/** brincos de pérola: botão de pérola + gota pendurada num elo dourado */
function pearlEarrings(ctx: LayerCtx, hf: HeadFrame): void {
  for (const sd of SIDES) {
    const e = ear(ctx, hf, sd);
    const [x, y] = e.P(0.05, 2.45);
    const r1 = (hf.lite ? 0.5 : 0.44) * e.k;
    const r2 = (hf.lite ? 0.66 : 0.6) * e.k;
    const y2 = y + 1.55 * e.k;
    ctx.stroke(`M${fx(x)},${fx(y + r1 * 0.6)}L${fx(x + sd * 0.05)},${fx(y2 - r2 * 0.8)}`, '#C99A2E', 0.16 * e.k, { gs: metalGrad({ x: x - 0.2, y, w: 0.4, h: y2 - y }, GOLD_STOPS) });
    if (!hf.lite) ctx.push(blob(x + 0.15, y2 + r2 * 0.4, r2 * 0.9, r2 * 0.5), SHADOW, { o: 0.15, b: 0.35 });
    pearl(ctx, hf, x, y, r1);
    ctx.push(blob(x + sd * 0.05, y2 - r2 * 0.92, r2 * 0.38, r2 * 0.22), '#E0B44A', { gf: metalGrad({ x: x - r2 * 0.4, y: y2 - r2 * 1.1, w: r2 * 0.8, h: r2 * 0.4 }, GOLD_STOPS) });
    pearl(ctx, hf, x + sd * 0.05, y2, r2);
  }
}

/** ear cuff: argola presa no alto da hélice + três cristais subindo pela borda da orelha (orelha direita da tela) */
function earCuff(ctx: LayerCtx, hf: HeadFrame): void {
  const e = ear(ctx, hf, 1);
  const k = e.k;
  const crystals: [number, number, number][] = [
    [0.02, 2.45, 0.34],
    [0.55, 1.45, 0.3],
    [0.85, 0.3, 0.27],
  ];
  for (const [u, v, r] of crystals) {
    const [x, y] = e.P(u, v);
    const rr = (hf.lite ? r * 1.25 : r) * k;
    ctx.push(dot(x, y, rr * 1.25), '#C9CFDA', { gf: metalGrad({ x: x - rr, y: y - rr, w: rr * 2, h: rr * 2 }, SILVER_STOPS) });
    gem(ctx, hf, x, y, rr, '#E6F6FF', { glint: !hf.lite });
  }
  // a argola abraça a hélice: faixa de metal que passa por cima da borda
  const spine: SP[] = [e.P(0.25, -2.6), e.P(0.75, -2.25), e.P(1.2, -1.8)];
  const w = (hf.lite ? 0.55 : 0.46) * k;
  const b = boxOf(spine);
  ctx.push(taperPath(spine, [w * 0.7, w, w * 0.8], { n: 6 }), '#C9CFDA', { gf: metalGrad({ x: b.x, y: b.y - w, w: b.w, h: b.h + w * 2 }, SILVER_STOPS) });
  if (!hf.lite) ctx.stroke(smoothPath([e.P(0.3, -2.73), e.P(0.75, -2.4), e.P(1.15, -1.97)], false), '#FFFFFF', 0.12 * k, { o: 0.8 });
  const [sx, sy] = e.P(0.75, -2.25);
  ctx.push(sparkle(sx + 0.3 * k, sy - 0.5 * k, (hf.lite ? 0.8 : 0.65) * k), '#FFFFFF', { o: 0.9 });
}

/** piercing: argolinha de prata na asa direita do nariz (lado direito da tela) */
function noseRing(ctx: LayerCtx, hf: HeadFrame): void {
  const { nose, noseW } = hf.ha;
  const s = hf.s;
  const r = 0.42 * s;
  const cx = nose[0] + noseW * 0.86;
  const cy = nose[1] + 0.32 * s;
  // começa dentro da narina (em cima, escondido), dá a volta por fora e por baixo
  const a0 = (-160 * Math.PI) / 180;
  const a1 = (60 * Math.PI) / 180;
  const p0: Pt2 = [cx + Math.cos(a0) * r, cy + Math.sin(a0) * r];
  const p1: Pt2 = [cx + Math.cos(a1) * r, cy + Math.sin(a1) * r];
  const d = `M${fx(p0[0])},${fx(p0[1])}A${fx(r)},${fx(r)} 0 1,0 ${fx(p1[0])},${fx(p1[1])}`;
  const w = (hf.lite ? 0.28 : 0.18) * s;
  if (!hf.lite) ctx.stroke(d, SHADOW, w, { o: 0.2, b: 0.2, cp: hf.head });
  ctx.stroke(d, '#C9CFDA', w, { gs: metalGrad({ x: cx - r, y: cy - r, w: 2 * r, h: 2 * r }, SILVER_STOPS) });
  ctx.push(dot(cx - r * 0.55, cy + r * 0.7, w * 0.42), '#FFFFFF', { o: 0.95 });
}

/** aparelho auditivo atrás da orelha (as duas), com o tubinho transparente até a concha */
function hearingAid(ctx: LayerCtx, hf: HeadFrame): void {
  const c = tones('#A9AFB8');
  for (const sd of SIDES) {
    const e = ear(ctx, hf, sd);
    const k = e.k;
    const body: SP[] = [e.P(0.15, -3.6), e.P(0.95, -3.62), e.P(1.6, -2.8), e.P(1.85, -1.45), e.P(1.7, -0.2), e.P(1.32, 0.35), e.P(1.08, 0.0), e.P(1.22, -1.25), e.P(1.06, -2.45), e.P(0.5, -3.08)];
    const d = smoothPath(body, true);
    const b = boxOf(body);
    if (!hf.lite) ctx.push(smoothPath(body.map((p) => [p[0] - sd * 0.3, p[1] + 0.35] as SP), true), SHADOW, { o: 0.2, b: 0.35 });
    ctx.push(d, c.base, { gf: { t: 'l', x1: b.x, y1: b.y, x2: b.x + b.w * 0.8, y2: b.y + b.h, s: [[0, c.lighter], [0.35, c.base], [1, c.shade]] } });
    ctx.stroke(d, c.deep, (hf.lite ? 0.22 : 0.13) * k, { o: 0.5 });
    if (!hf.lite) {
      ctx.stroke(smoothPath([e.P(0.45, -3.38), e.P(1.0, -3.35), e.P(1.45, -2.75)], false), '#FFFFFF', 0.18 * k, { o: 0.7 });
      // botão de programa
      const [bx, by] = e.P(1.42, -1.6);
      ctx.push(dot(bx, by, 0.2 * k), c.deep, { o: 0.6 });
    }
    // tubinho transparente por cima da hélice até a concha + olivinha
    const tube: SP[] = [e.P(0.3, -3.45), e.P(-0.3, -3.2), e.P(-0.6, -2.0), e.P(-0.25, -0.85), e.P(0.05, -0.55)];
    const td = smoothPath(tube, false);
    ctx.stroke(td, '#DDE6EC', (hf.lite ? 0.3 : 0.24) * k, { o: hf.lite ? 0.7 : 0.65 });
    if (!hf.lite) ctx.stroke(smoothPath(tube.map((p) => [p[0] - 0.06 * k, p[1] - 0.06 * k] as SP), false), '#FFFFFF', 0.08 * k, { o: 0.8 });
    const [ox, oy] = e.P(0.05, -0.5);
    ctx.push(dot(ox, oy, 0.3 * k), '#F2F5F7', { o: 0.85 });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// flores e borboletas
// ---------------------------------------------------------------------------------------------------------------

function rotPts(pts: readonly Pt2[], x: number, y: number, sc: number, a: number, sx = 1): SP[] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return pts.map(([u, v]) => [x + (u * sx * c - v * s) * sc, y + (u * sx * s + v * c) * sc] as SP);
}

function leaf(x: number, y: number, len: number, a: number, wk = 0.36): { d: string; rib: string } {
  const pts: Pt2[] = [
    [0, 0],
    [0.35, -wk],
    [0.75, -wk * 0.75],
    [1, 0],
    [0.75, wk * 0.6],
    [0.35, wk * 0.85],
  ];
  const P = rotPts(pts, x, y, len, a);
  const rib = rotPts(
    [
      [0.05, 0],
      [0.55, -0.03],
      [0.92, 0],
    ],
    x,
    y,
    len,
    a,
  );
  return { d: smoothPath([[P[0][0], P[0][1], 0], ...P.slice(1, 3), [P[3][0], P[3][1], 0], ...P.slice(4)], true), rib: smoothPath(rib, false) };
}

const LEAF_STOPS: readonly AvatarStop[] = [
  [0, '#9BE07A'],
  [0.5, '#3E9B3A'],
  [1, '#1F5E2A'],
];

/** flor atrás da orelha: hibisco com pétalas onduladas, veios, garganta escura e estame */
function flower(ctx: LayerCtx, hf: HeadFrame): void {
  const s = hf.s;
  const [x, y] = hf.Q(hf.Wu * 0.92 + hf.bulk * 0.55, -4.0);
  const r = 2.3 * s;
  // folhas por trás (apontando pra fora e pra cima)
  const l1 = leaf(x, y, r * 1.45, -0.55);
  const l2 = leaf(x, y, r * 1.2, 0.35);
  const lb = boxOf([[x, y - r], [x + r * 1.4, y + r * 0.6]]);
  ctx.push(l1.d + l2.d, '#3E9B3A', { gf: { t: 'l', x1: lb.x, y1: lb.y, x2: lb.x + lb.w, y2: lb.y + lb.h, s: LEAF_STOPS } });
  if (!hf.lite) ctx.stroke(l1.rib + l2.rib, '#C8F0A8', 0.12 * s, { o: 0.6 });
  // sombra no cabelo/cabeça
  ctx.push(blob(x + 0.35 * s, y + 0.6 * s, r * 0.95, r * 0.8), SHADOW, { o: 0.28, cp: hf.near, b: 0.8 });
  // pétalas (um path, um gradiente radial a partir do centro)
  const petal: Pt2[] = [
    [0, 0],
    [0.38, -0.36],
    [0.8, -0.46],
    [1.0, -0.2],
    [1.04, 0.06],
    [0.9, 0.36],
    [0.4, 0.34],
  ];
  let pd = '';
  const lines: string[] = [];
  for (let i = 0; i < 5; i++) {
    const a = -0.4 + (i * Math.PI * 2) / 5;
    const P = rotPts(petal, x, y, r, a);
    pd += smoothPath([[P[0][0], P[0][1], 0], ...P.slice(1)], true);
    const vein = rotPts(
      [
        [0.12, 0],
        [0.5, -0.04],
        [0.85, -0.1],
      ],
      x,
      y,
      r,
      a,
    );
    lines.push(smoothPath(vein, false));
  }
  ctx.push(pd, '#FF5C8A', { gf: { t: 'r', cx: x - 0.3 * s, cy: y - 0.3 * s, r: r * 1.1, s: [[0, '#9E0E45'], [0.3, '#E2306A'], [0.72, '#FF6F92'], [1, '#FFB1C3']] } });
  // separação entre pétalas (sombra macia nas bordas que se sobrepõem) + veios claros
  let sep = '';
  for (let i = 0; i < 5; i++) {
    const a = -0.4 + (i * Math.PI * 2) / 5 + 0.52;
    sep += taperPath(rotPts([[0.1, 0], [0.55, 0.02], [0.95, 0.04]], x, y, r, a), [0.05 * s, 0.32 * s, 0.05 * s]);
  }
  ctx.push(sep, '#7A0B36', { o: 0.32, cp: pd, ...(hf.lite ? {} : { b: 0.25 }) });
  if (!hf.lite) {
    ctx.stroke(lines.join(''), '#FFD0DC', 0.1 * s, { o: 0.45, cp: pd });
    ctx.push(blob(x - r * 0.45, y - r * 0.45, r * 0.4, r * 0.22, -0.7), '#FFFFFF', { o: 0.22, cp: pd, b: 0.3 });
  }
  ctx.push(blob(x, y, r * 0.3, r * 0.3), '#7A0B36', { gf: { t: 'r', cx: x, cy: y, r: r * 0.34, s: [[0, '#4A0420'], [1, '#B0154F', 0]] } });
  // estame com pólen
  const st: SP[] = [[x, y], [x - r * 0.35, y - r * 0.55], [x - r * 0.42, y - r * 0.95]];
  ctx.push(taperPath(st, [0.32 * s, 0.24 * s, 0.18 * s], { n: 5 }), '#FFE9C2', { gf: { t: 'l', x1: x, y1: y, x2: x - r * 0.4, y2: y - r, s: [[0, '#E2306A'], [0.5, '#FFD6A8'], [1, '#FFF2D8']] } });
  const [tx, ty] = st[2];
  let pol = '';
  for (let i = 0; i < 5; i++) pol += dot(tx + Math.cos(i * 1.26) * 0.35 * s, ty + Math.sin(i * 1.26) * 0.3 * s, (hf.lite ? 0.24 : 0.17) * s);
  ctx.push(pol, '#FFC21A', { gf: { t: 'r', cx: tx - 0.2, cy: ty - 0.2, r: 0.8 * s, s: [[0, '#FFF3A0'], [1, '#E09000']] } });
}

interface BflyPal {
  c: [string, string, string];
  edge: string;
}

const BFLY: readonly BflyPal[] = [
  { c: ['#E6FBFF', '#3FA9FF', '#4B2BD0'], edge: '#140C34' },
  { c: ['#FFE8F6', '#FF4FB2', '#7A1FD0'], edge: '#2A0A2E' },
  { c: ['#FFF8D2', '#FFC93C', '#E8560A'], edge: '#2E1606' },
];

/** borboleta vista em 3/4: asa da frente inteira, a de trás estreitada pela perspectiva */
function butterfly(ctx: LayerCtx, hf: HeadFrame, x: number, y: number, sz: number, a: number, pal: BflyPal): void {
  const up: Pt2[] = [
    [0.1, -0.15],
    [0.75, -1.25],
    [1.5, -1.2],
    [1.55, -0.55],
    [0.95, -0.02],
    [0.18, 0.05],
  ];
  const lo: Pt2[] = [
    [0.15, 0.05],
    [0.95, 0.2],
    [1.18, 0.82],
    [0.78, 1.3],
    [0.35, 1.05],
    [0.1, 0.45],
  ];
  const wings = [rotPts(up, x, y, sz, a), rotPts(lo, x, y, sz, a), rotPts(up, x, y, sz, a, -0.62), rotPts(lo, x, y, sz, a, -0.62)];
  let wd = '';
  for (const w of wings) wd += smoothPath(w, true);
  if (!hf.lite) {
    ctx.push(blob(x, y, sz * 1.5, sz * 1.2), pal.c[1], { o: 0.3, b: sz * 0.6 });
    ctx.push(blob(x + 0.3 * sz, y + 0.5 * sz, sz * 1.1, sz * 0.7, a), SHADOW, { o: 0.22, cp: hf.near, b: 0.4 });
  }
  ctx.push(wd, pal.c[1], { gf: { t: 'r', cx: x, cy: y, r: sz * 1.7, s: [[0, pal.c[0]], [0.5, pal.c[1]], [1, pal.c[2]]] } });
  ctx.stroke(wd, pal.edge, (hf.lite ? 0.3 : 0.24) * sz, { o: 0.85, cp: wd });
  if (!hf.lite) {
    // pintinhas brancas na borda e veios
    let dots = '';
    for (const [u, v] of [
      [1.3, -1.0],
      [1.45, -0.7],
      [1.0, 1.12],
    ] as Pt2[]) {
      const [px, py] = rotPts([[u, v]], x, y, sz, a)[0];
      dots += dot(px, py, 0.09 * sz);
    }
    ctx.push(dots, '#FFFFFF', { o: 0.85 });
    let veins = '';
    for (const [u, v] of [
      [1.2, -1.0],
      [1.35, -0.4],
      [0.9, 0.95],
    ] as Pt2[])
      veins += smoothPath(rotPts([[0.1, 0], [u * 0.55, v * 0.5], [u, v]], x, y, sz, a), false);
    ctx.stroke(veins, pal.edge, 0.07 * sz, { o: 0.45, cp: wd });
    const [hx, hy] = rotPts([[0.6, -0.7]], x, y, sz, a)[0];
    ctx.push(blob(hx, hy, sz * 0.35, sz * 0.15, a - 0.7), '#FFFFFF', { o: 0.35, cp: wd });
  }
  // corpo e antenas
  ctx.push(taperPath(rotPts([[0, -0.35], [0, 0.3], [0, 0.95]], x, y, sz, a), [0.2 * sz, 0.24 * sz, 0.1 * sz], { n: 5 }), pal.edge, {});
  if (!hf.lite) {
    const ant = smoothPath(rotPts([[0, -0.35], [0.12, -0.75], [0.42, -1.05]], x, y, sz, a), false) + smoothPath(rotPts([[0, -0.35], [-0.08, -0.78], [-0.28, -1.08]], x, y, sz, a), false);
    ctx.stroke(ant, pal.edge, 0.06 * sz, { o: 0.9 });
  }
}

function butterflies(ctx: LayerCtx, hf: HeadFrame): void {
  const s = hf.s;
  const top = SKULL_CY - SKULL_RY;
  const clampY = (p: Pt2, sz: number): Pt2 => [p[0], Math.max(1.5 + sz * 1.3, p[1])];
  const b1 = clampY(hf.Q(hf.Wu * 0.5 + 0.3, top + 1.4 - hf.hairLift * 0.85), 1.25 * s);
  const b2 = clampY(hf.Q(-(hf.Wu + hf.bulk * 0.8) + 0.4, -5.6), 0.95 * s);
  const b3 = clampY(hf.Q(hf.Wu + 2.2 + hf.bulk * 0.5, top - 0.6 - hf.hairLift * 0.5), 0.72 * s);
  butterfly(ctx, hf, b3[0], b3[1], 0.72 * s, 0.6, BFLY[2]);
  butterfly(ctx, hf, b2[0], b2[1], 0.95 * s, -0.55, BFLY[1]);
  butterfly(ctx, hf, b1[0], b1[1], 1.25 * s, 0.35, BFLY[0]);
}

/** coroa de flores: rosas, margaridas e florzinhas lilás sobre um ramo de folhas */
function flowerCrown(ctx: LayerCtx, hf: HeadFrame): void {
  const s = hf.s;
  const w = hf.Wu + hf.bulk * 0.85 + 0.55;
  const yC = -7.6 - Math.min(hf.hairLift, 3) * 0.35;
  const yS = -4.4;
  const N = 11;
  const pts = bandU(hf, w, yC, yS, N, 2.0);
  // sombra do ramo no cabelo/testa
  ctx.push(taperPath(pts.map((p) => [p[0] + 0.2, p[1] + 1.0 * s] as SP), [0.4 * s, 1.6 * s, 1.8 * s, 1.6 * s, 0.4 * s]), SHADOW, { o: 0.26, cp: hf.near, ...(hf.lite ? {} : { b: 0.8 }) });
  // folhas: pares ao longo do ramo
  let lv = '';
  let rib = '';
  for (let i = 0; i < N - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const a = Math.atan2(y1 - y0, x1 - x0);
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    const L1 = leaf(mx, my, 1.7 * s, a - 0.75 - Math.PI);
    const L2 = leaf(mx, my, 1.5 * s, a + 0.7 - Math.PI);
    lv += L1.d + L2.d;
    rib += L1.rib + L2.rib;
  }
  const bb = boxOf(pts);
  ctx.push(lv, '#3E9B3A', { gf: { t: 'l', x1: bb.x, y1: bb.y - 2, x2: bb.x + bb.w * 0.4, y2: bb.y + bb.h + 2, s: LEAF_STOPS } });
  if (!hf.lite) ctx.stroke(rib, '#C8F0A8', 0.1 * s, { o: 0.5 });
  // flores: dos lados pro centro (a do meio por cima)
  const order = Array.from({ length: N }, (_, i) => i).sort((a, b) => Math.abs(b - (N - 1) / 2) - Math.abs(a - (N - 1) / 2));
  const kinds = ['blossom', 'daisy', 'rose', 'daisy', 'blossom', 'rose', 'blossom', 'daisy', 'rose', 'daisy', 'blossom'] as const;
  let daisy = '';
  let daisyC = '';
  let blos = '';
  let blosC = '';
  let swirl = '';
  for (const i of order) {
    const u = Math.abs(1 - (2 * i) / (N - 1));
    const r = (1.0 + 0.5 * (1 - u)) * s;
    const [x, y] = pts[i];
    const kind = kinds[i];
    if (kind === 'rose') {
      const pink = i === 5 ? '#FF4F8B' : '#FF7FAE';
      ctx.push(blob(x, y, r * 1.08, r), pink, { gf: { t: 'r', cx: x - r * 0.35, cy: y - r * 0.4, r: r * 1.5, s: [[0, mix(pink, '#FFFFFF', 0.45)], [0.5, pink], [1, mix(pink, '#4A0420', 0.5)]] } });
      swirl += `M${fx(x - r * 0.75)},${fx(y + r * 0.15)}Q${fx(x - r * 0.2)},${fx(y + r * 0.85)} ${fx(x + r * 0.6)},${fx(y + r * 0.2)}`;
      swirl += `M${fx(x - r * 0.4)},${fx(y - r * 0.1)}Q${fx(x)},${fx(y - r * 0.6)} ${fx(x + r * 0.45)},${fx(y - r * 0.15)}Q${fx(x + r * 0.3)},${fx(y + r * 0.35)} ${fx(x - r * 0.05)},${fx(y + r * 0.1)}`;
    } else if (kind === 'daisy') {
      for (let k = 0; k < 9; k++) {
        const a = (k * Math.PI * 2) / 9 + i;
        daisy += smoothPath(rotPts([[0.15, 0], [0.6, -0.2], [1.05, 0], [0.6, 0.2]], x, y, r, a), true);
      }
      daisyC += dot(x, y, r * 0.34);
    } else {
      for (let k = 0; k < 5; k++) {
        const a = (k * Math.PI * 2) / 5 + i * 0.7;
        const [px, py] = [x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.5];
        blos += dot(px, py, r * 0.46);
      }
      blosC += dot(x, y, r * 0.22);
    }
  }
  if (swirl) ctx.stroke(swirl, '#8E0D3E', (hf.lite ? 0.22 : 0.16) * s, { o: 0.55 });
  if (daisy) {
    const db = boxOf(pts);
    ctx.push(daisy, '#FFFFFF', { gf: { t: 'l', x1: db.x, y1: db.y - 2, x2: db.x, y2: db.y + db.h + 2, s: [[0, '#FFFFFF'], [1, '#E6DCEB']] } });
    if (!hf.lite) ctx.stroke(daisy, '#B9A9C6', 0.08 * s, { o: 0.5 });
    ctx.push(daisyC, '#FFC21A', { gf: { t: 'l', x1: db.x, y1: db.y - 1, x2: db.x, y2: db.y + db.h + 1, s: [[0, '#FFE680'], [1, '#E08E00']] } });
  }
  if (blos) {
    ctx.push(blos, '#C59BFF', { gf: { t: 'l', x1: bb.x, y1: bb.y - 2, x2: bb.x, y2: bb.y + bb.h + 2, s: [[0, '#E6D4FF'], [1, '#9B6BE8']] } });
    ctx.push(blosC, '#FFE27A', {});
  }
}

// ---------------------------------------------------------------------------------------------------------------
// fone e headset
// ---------------------------------------------------------------------------------------------------------------

type PhoneStyle = 'phones' | 'headset';

/** o arco vai por baixo do chapéu (etapa 22)? aba, coroa, tiara, auréola, bucket e boina: sim */
function bandUnderHat(hat: string): boolean {
  const m = hatModeOf(hat);
  return m === 'brim' || m === 'band' || m === 'crown' || hat === 'bucket' || hat === 'beret';
}

/** quanto o arco sobe acima do crânio e quanto abre dos lados (cabeça unitária) */
function bandLift(ctx: LayerCtx, hf: HeadFrame): { top: number; side: number } {
  const hat = ctx.cfg.hat;
  const top = HAT_TOP[hat];
  if (top && !bandUnderHat(hat)) {
    const t = top(hf.bulk);
    return { top: t.top + 0.25, side: t.side + 0.3 };
  }
  return { top: Math.min(hf.hairLift, 4) + 0.2, side: hf.bulk * 0.9 + 0.35 };
}

interface CupGeo {
  x: number;
  y: number;
  hw: number;
  hh: number;
}

function cupsGeo(hf: HeadFrame, style: PhoneStyle): Record<'L' | 'R', CupGeo> {
  const s = hf.s;
  const out = (Math.max(0.55, hf.bulk * 0.55) + (style === 'headset' ? 0.1 : 0.25)) * s;
  const hw = (style === 'headset' ? 1.25 : 1.5) * s;
  const hh = (style === 'headset' ? 2.45 : 2.85) * s;
  const mk = (p: readonly number[], sd: number): CupGeo => ({ x: p[0] + sd * out, y: p[1] + 0.15 * s, hw, hh });
  return { L: mk(hf.ha.earL, -1), R: mk(hf.ha.earR, 1) };
}

function band(ctx: LayerCtx, hf: HeadFrame, style: PhoneStyle): void {
  const s = hf.s;
  const lift = bandLift(ctx, hf);
  const cups = cupsGeo(hf, style);
  const yE = hf.cy + SKULL_CY * s;
  const rx = Math.max((hf.Wu + lift.side) * s, cups.R.x - hf.cx - 0.2 * s);
  const ry = (SKULL_RY + lift.top) * s;
  const arc: SP[] = [];
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * Math.PI;
    arc.push([hf.cx + Math.cos(a) * rx, yE - Math.sin(a) * ry]);
  }
  const bw = (style === 'headset' ? 0.75 : 1.0) * s;
  // sombra no cabelo/chapéu, almofada por baixo e o arco
  ctx.push(taperPath(arc.map((p) => [p[0] + 0.15, p[1] + 0.8 * s] as SP), [0, bw * 1.1, bw * 1.2, bw * 1.1, 0], { n: 14 }), SHADOW, { o: 0.25, ...(hf.lite ? {} : { b: 0.6 }) });
  const inner = arc.map(([x, y]) => [hf.cx + (x - hf.cx) * (1 - (0.55 * s) / rx), yE + (y - yE) * (1 - (0.55 * s) / ry)] as SP);
  const pad = taperPath(inner.slice(2, -2), [0.2 * s, 0.75 * s, 0.85 * s, 0.75 * s, 0.2 * s], { n: 12 });
  ctx.push(pad, '#3A3D48', { gf: { t: 'l', x1: hf.cx, y1: yE - ry, x2: hf.cx, y2: yE, s: [[0, '#5A5E6C'], [1, '#2A2C34']] } });
  const g = tones(style === 'headset' ? '#1C1D26' : '#262832');
  const bd = taperPath(arc, [bw * 0.85, bw, bw, bw, bw * 0.85], { n: 16 });
  ctx.push(bd, g.base, { gf: { t: 'l', x1: hf.cx - rx, y1: yE - ry, x2: hf.cx + rx * 0.6, y2: yE + ry * 0.2, s: [[0, g.lighter], [0.35, g.base], [1, g.deep]] } });
  if (style === 'headset') neon(ctx, hf, smoothPath(arc.slice(2, -2).map(([x, y]) => [hf.cx + (x - hf.cx) * (1 + (0.15 * s) / rx), y - 0.12 * s] as SP), false), '#FF1493', 0.2 * s, { glow: 0.8 });
  else if (!hf.lite) ctx.stroke(smoothPath(arc.slice(3, 8).map(([x, y]) => [x, y - bw * 0.25] as SP), false), '#FFFFFF', bw * 0.22, { o: 0.32, cp: bd });
  // hastes de metal (do arco até a concha), com a ferragem
  for (const [c, sd] of [
    [cups.L, -1],
    [cups.R, 1],
  ] as const) {
    const top: SP = [hf.cx + sd * rx, yE];
    const yk: SP[] = [top, [(top[0] + c.x) / 2, (yE + c.y - c.hh) / 2], [c.x, c.y - c.hh * 0.85]];
    const yb = boxOf(yk);
    ctx.push(taperPath(yk, [bw * 0.75, bw * 0.55, bw * 0.5], { n: 6 }), '#B8BFCC', { gf: metalGrad({ x: yb.x - 0.5, y: yb.y, w: yb.w + 1, h: yb.h }, SILVER_STOPS) });
    ctx.push(blob(top[0], top[1] + 0.2 * s, bw * 0.62, bw * 0.75), g.base, { gf: { t: 'l', x1: top[0] - bw, y1: top[1] - bw, x2: top[0] + bw, y2: top[1] + bw, s: [[0, g.lighter], [1, g.deep]] } });
  }
}

function cups(ctx: LayerCtx, hf: HeadFrame, style: PhoneStyle): void {
  const s = hf.s;
  const geo = cupsGeo(hf, style);
  const g = tones(style === 'headset' ? '#1C1D26' : '#262832');
  for (const sd of [-1, 1] as const) {
    const c = sd < 0 ? geo.L : geo.R;
    const shell: SP[] = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const cs = Math.cos(a);
      const sn = Math.sin(a);
      // cápsula: lado de fora mais bojudo
      const bulge = cs * sd > 0 ? 1.08 : 0.92;
      shell.push([c.x + Math.sign(cs) * Math.pow(Math.abs(cs), 0.8) * c.hw * bulge, c.y + Math.sign(sn) * Math.pow(Math.abs(sn), 0.85) * c.hh]);
    }
    const d = smoothPath(shell, true);
    const b = boxOf(shell);
    // sombra da concha no rosto/cabelo
    ctx.push(blob(c.x - sd * c.hw * 0.6, c.y + 0.5 * s, c.hw * 0.9, c.hh * 0.95), SHADOW, { o: 0.3, cp: hf.near, ...(hf.lite ? {} : { b: 0.7 }) });
    ctx.push(d, g.base, { gf: { t: 'l', x1: b.x, y1: b.y, x2: b.x + b.w, y2: b.y + b.h, s: [[0, g.lighter], [0.4, g.base], [1, g.deep]] } });
    // almofada (lado da cabeça): couro macio mais claro, separada por um friso escuro
    const cush: SP[] = shell.filter((p) => (p[0] - c.x) * sd < c.hw * 0.05);
    const cx0 = c.x - sd * c.hw * 0.35;
    const cd = smoothPath([...cush, [cx0, c.y + c.hh * 0.75], [cx0 + sd * 0.15 * s, c.y], [cx0, c.y - c.hh * 0.75]], true);
    ctx.push(cd, '#3C3F4A', { gf: { t: 'l', x1: b.x, y1: b.y, x2: b.x, y2: b.y + b.h, s: [[0, '#5C6070'], [0.5, '#3A3D48'], [1, '#22242C']] }, cp: d });
    ctx.stroke(smoothPath([[cx0, c.y - c.hh * 0.8], [cx0 + sd * 0.15 * s, c.y], [cx0, c.y + c.hh * 0.8]], false), '#0E0F14', 0.2 * s, { o: 0.7, cp: d });
    if (!hf.lite) ctx.push(blob(c.x - c.hw * 0.25, c.y - c.hh * 0.5, c.hw * 0.35, c.hh * 0.22, -0.3), '#FFFFFF', { o: 0.22, cp: d, b: 0.3 });
    // detalhe: anel de luz no lado de fora (lima no fone, ciano/magenta no headset)
    const ring = smoothPath(
      shell.filter((p) => (p[0] - c.x) * sd > c.hw * 0.3).map((p) => [c.x + (p[0] - c.x) * 0.8, c.y + (p[1] - c.y) * 0.82] as SP),
      false,
    );
    if (style === 'headset') neon(ctx, hf, ring, sd > 0 ? '#00E5FF' : '#FF1493', 0.22 * s, { glow: 0.9 });
    else ctx.stroke(ring, '#7FFF00', (hf.lite ? 0.3 : 0.2) * s, { o: 0.9 });
  }
  if (style === 'headset') {
    // microfone: braço saindo da concha da esquerda da tela até o canto da boca, com a ponta acesa
    const c = geo.L;
    const m = hf.ha.mouth;
    const tip: SP = [m[0] - hf.ha.mouthW - 0.7 * s, m[1] + 0.2 * s];
    const arm: SP[] = [[c.x + 0.1 * s, c.y + c.hh * 0.55], [c.x + 0.8 * s, c.y + c.hh * 1.15], [(c.x + tip[0]) / 2 + 0.5 * s, tip[1] + 1.2 * s], tip];
    if (!hf.lite) ctx.stroke(smoothPath(arm.map((p) => [p[0] + 0.15, p[1] + 0.5] as SP), false), SHADOW, 0.4 * s, { o: 0.2, cp: hf.head, b: 0.35 });
    ctx.stroke(smoothPath(arm, false), '#2A2C36', (hf.lite ? 0.42 : 0.36) * s, {});
    if (!hf.lite) ctx.stroke(smoothPath(arm.map((p) => [p[0], p[1] - 0.1 * s] as SP), false), '#6A6E80', 0.1 * s, { o: 0.8 });
    ctx.push(blob(tip[0], tip[1], 0.55 * s, 0.42 * s), '#1C1D26', {});
    ctx.push(blob(tip[0] + 0.2 * s, tip[1], 0.28 * s, 0.24 * s), '#FF1493', {});
    if (!hf.lite) ctx.push(blob(tip[0] + 0.2 * s, tip[1], 0.8 * s, 0.7 * s), '#FF1493', { o: 0.35, b: 0.5 });
  }
}

/** etapa 22: o arco por baixo do chapéu de aba/coroa */
const phonesUnder =
  (style: PhoneStyle): AccFn =>
  (ctx, hf) => {
    if (bandUnderHat(ctx.cfg.hat)) band(ctx, hf, style);
  };

/** etapa 24b: o arco por cima (sem chapéu ou chapéu justo) e as conchas */
const phonesOver =
  (style: PhoneStyle): AccFn =>
  (ctx, hf) => {
    if (!bandUnderHat(ctx.cfg.hat)) band(ctx, hf, style);
    cups(ctx, hf, style);
  };

export const ACCESSORIES: Record<string, AccFn> = {
  earrings,
  hoops,
  pearl_earrings: pearlEarrings,
  ear_cuff: earCuff,
  nose_ring: noseRing,
  hearing_aid: hearingAid,
  flower,
  butterflies,
  flower_crown: flowerCrown,
  headphones: phonesUnder('phones'),
  headset: phonesUnder('headset'),
};

export const OVER_HAT: Record<string, AccFn> = {
  headphones: phonesOver('phones'),
  headset: phonesOver('headset'),
};
