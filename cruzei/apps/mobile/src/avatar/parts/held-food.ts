// Comidas e bebidas na mão (dono: pets): cafezinho, água de coco, milk-shake, bubble tea, sorvete e pipoca.
// Espaço do objeto: origem na pegada, −y rumo ao cotovelo, x+ pro lado de fora (mindinho). Papel, plástico, vidro e
// líquido com materiais diferentes (vidro quase transparente com reflexo, líquido com luz entrando, papel fosco com
// cinta).
//
// Pegada de recipiente: o copo fica NA FRENTE da palma (o dorso da mão continua atrás, acima do copo) e os quatro dedos
// abraçam a frente dele, nascendo na borda de fora e seguindo a curva do cilindro, com unha na ponta e sombra de
// contato no copo. Por isso o recipiente cobre os dedos da mão relaxada (x −2,1..2,35 e y −0,6..5,2 em unidades da mão)
// e a função devolve null (sem redesenhar a mão por cima).

import { tonesOf } from './body';
import type { HeldDef } from './held';
import { ballGrad, cylX, glassy, mix, tones, type Pen, type SP } from './pets-kit';

/** canudo listrado (espinha, largura, cor da listra) */
function straw(q: Pen, spine: readonly SP[], w: number, base: string, stripe: string | null): void {
  const d = q.taper(spine, [w, w, w], { n: 10 });
  const t = tones(base);
  const a = spine[0];
  const b = spine[spine.length - 1];
  const nx = -(b[1] - a[1]);
  const ny = b[0] - a[0];
  const n = Math.hypot(nx, ny) || 1;
  q.fill(d, base, { gf: q.lg(a[0] - (nx / n) * w, a[1] - (ny / n) * w, a[0] + (nx / n) * w, a[1] + (ny / n) * w, [[0, t.lighter], [0.5, t.base], [1, t.shade]]) });
  if (stripe && !q.lite) q.line(q.path(spine, false), stripe, w * 1.9, { da: [0.55, 0.55], cp: d });
}

/** bordas do recipiente na altura y: [x esquerda, x direita] */
type Edge = (y: number) => [number, number];

/** trapézio: borda de cima (y0, meia-largura w0) e de baixo (y1, w1), centro cx */
function trap(y0: number, w0: number, y1: number, w1: number, cx = 0.15): Edge {
  return (y) => {
    const k = Math.max(0, Math.min(1, (y - y0) / (y1 - y0)));
    const w = w0 + (w1 - w0) * k;
    return [cx - w, cx + w];
  };
}

// dedos de cima pra baixo: indicador, médio, anelar, mindinho — [grossura, alcance (fração da largura)]
const FINGERS: readonly (readonly [number, number])[] = [
  [1.0, 0.72],
  [1.04, 0.8],
  [1.0, 0.74],
  [0.86, 0.6],
];

/**
 * dedos abraçando a frente do recipiente a partir de `top` (y do indicador). `cp` = recipiente (a sombra de contato fica
 * recortada nele); `curve` = quanto a faixa desce no meio (frente do cilindro vista de cima).
 */
function grip(q: Pen, top: number, edge: Edge, cp: string, o: { curve?: number; reach?: number } = {}): void {
  const t = tonesOf(q.ctx);
  const curve = o.curve ?? 0.16;
  let y = top;
  let fingers = '';
  let shadow = '';
  let grooves = '';
  let lights = '';
  let nails = '';
  FINGERS.forEach(([fw, reach], i) => {
    const yc = y + fw / 2;
    y += fw + 0.04;
    const [xl, xr] = edge(yc);
    const hw = (xr - xl) / 2;
    const cx = (xl + xr) / 2;
    const dip = (x: number): number => yc + curve * hw * Math.sqrt(Math.max(0, 1 - ((x - cx) / hw) ** 2));
    const x0 = xr + 0.42;
    const x1 = xr - reach * (o.reach ?? 1) * (xr - xl);
    const spine: SP[] = [];
    for (let k = 0; k <= 4; k++) {
      const x = x0 + ((x1 - x0) * k) / 4;
      spine.push([x, dip(Math.min(xr, x)) - (x > xr ? (x - xr) * 0.25 : 0)]);
    }
    const w = [fw * 1.08, fw, fw * 0.96, fw * 0.9, fw * 0.8];
    fingers += q.taper(spine, w, { n: 8, round: true });
    shadow += q.taper(spine.map(([x, yy]) => [x - 0.15, yy + 0.32] as SP), w, { n: 8, round: true });
    if (i > 0) grooves += q.path(spine.slice(0, 4).map(([x, yy]) => [x, yy - fw * 0.5] as SP), false);
    lights += q.path(spine.slice(1, 4).map(([x, yy]) => [x, yy - fw * 0.22] as SP), false);
    const tip = spine[4];
    nails += q.ell(tip[0] + 0.12, tip[1] - 0.04, 0.3, fw * 0.28, 8);
  });
  const L = q.lite;
  if (!L) q.fill(shadow, '#1A0A08', { o: 0.3, b: 0.35, cp });
  const span = y - top;
  q.fill(fingers, t.base, { gf: q.lg(0, top, 0.6, top + span, [[0, t.light], [0.45, t.base], [1, mix(t.base, t.shade, 0.7)]]) });
  q.line(grooves, t.deep, L ? 0.16 : 0.13, { o: L ? 0.5 : 0.65 });
  if (L) return;
  q.line(lights, t.lighter, 0.18, { o: 0.32, b: 0.08 });
  q.fill(nails, mix(t.lighter, '#FFE8E0', 0.4), { o: 0.7 });
}

function coffee(q: Pen): string | null {
  const L = q.lite;
  const W = tones('#F3EFE8');
  const K = tones('#B67E4E');
  const y0 = -2.6;
  const y1 = 6.2;
  const e = trap(y0, 2.85, y1, 2.35);
  const cup = q.path([[e(y0)[0], y0, 0.3], [e(y0)[1], y0, 0.3], [e(y1)[1], y1, 0.3], [e(y1)[0], y1, 0.3]]);
  q.fill(cup, W.base, { gf: cylX(q, e(y0)[0], e(y0)[1], 0, W, true) });
  if (!L) q.fill(q.path([[e(y1 - 0.5)[0], y1 - 0.5], [e(y1 - 0.5)[1], y1 - 0.5], [e(y1)[1], y1], [e(y1)[0], y1]]), W.shade, { o: 0.8 });
  // cinta de papelão canelado (por cima dos dedos não: começa acima deles)
  const s0 = -1.9;
  const s1 = 2.4;
  const sleeve = q.path([[e(s0)[0] + 0.05, s0], [e(s0)[1] - 0.05, s0], [e(s1)[1] - 0.05, s1], [e(s1)[0] + 0.05, s1]]);
  q.fill(sleeve, K.base, { gf: cylX(q, e(s0)[0], e(s0)[1], 0, K) });
  if (!L) {
    let d = '';
    for (let x = -2.1; x <= 2.4; x += 0.55) d += q.path([[x, s0 + 0.1], [x * 0.95, s1 - 0.1]], false);
    q.line(d, K.deep, 0.1, { o: 0.32, cp: sleeve });
    // logo: coraçãozinho
    q.fill(q.path([[-0.45, -1.15], [-0.22, -1.48, 0.6], [0.02, -1.2], [0.26, -1.48, 0.6], [0.49, -1.15], [0.02, -0.55, 0]]), '#FFF6EA', { o: 0.9 });
  }
  // tampa: aba e domo de plástico, furo de beber
  const rim = q.path([[-2.95, y0 + 0.15, 0.5], [3.25, y0 + 0.15, 0.5], [3.25, y0 - 0.75, 0.5], [-2.95, y0 - 0.75, 0.5]]);
  q.fill(rim, '#FFFFFF', { gf: cylX(q, -2.95, 3.25, 0, tones('#ECEEF2'), true) });
  const dome = q.path([[-2.6, y0 - 0.7], [2.9, y0 - 0.7], [2.3, y0 - 1.8, 0.5], [-2.0, y0 - 1.8, 0.5]]);
  q.fill(dome, '#F6F7FA', { gf: cylX(q, -2.6, 2.9, 0, tones('#E6E8EE'), true) });
  q.fill(q.ell(-0.8, y0 - 1.55, 0.55, 0.18), '#3A2A22', { o: 0.8 });
  if (!L) {
    // vapor
    q.fill(q.taper([[-0.6, y0 - 2.4], [-1.2, y0 - 3.8], [-0.4, y0 - 5.2], [-1.1, y0 - 6.6]], [0.55, 0.5, 0.38, 0], { n: 10 }), '#FFFFFF', { o: 0.3, b: 0.3 });
    q.fill(q.taper([[0.8, y0 - 2.6], [1.3, y0 - 3.8], [0.7, y0 - 5.0], [1.2, y0 - 6.0]], [0.45, 0.4, 0.3, 0], { n: 10 }), '#FFFFFF', { o: 0.22, b: 0.3 });
  }
  grip(q, -0.35, e, cup);
  return null;
}

function coconut(q: Pen): string | null {
  const L = q.lite;
  const G = tones('#5DA82E');
  const cx = 0.25;
  const cy = 1.7;
  const rx = 3.65;
  const ry = 4.1;
  const cut = cy - ry * 0.86;
  const body = q.path([[cx - rx * 0.62, cut], [cx - rx, cy - 0.6], [cx - rx * 0.86, cy + ry * 0.55], [cx - rx * 0.3, cy + ry * 0.97], [cx + 0.2, cy + ry, 0.6], [cx + rx * 0.4, cy + ry * 0.95], [cx + rx * 0.9, cy + ry * 0.5], [cx + rx, cy - 0.6], [cx + rx * 0.62, cut]]);
  const e: Edge = (y) => {
    const k = Math.max(-1, Math.min(1, (y - cy) / ry));
    const w = rx * Math.sqrt(1 - k * k);
    return [cx - w, cx + w];
  };
  // canudo (atrás da borda de cima)
  straw(q, [[0.9, cut + 0.4], [1.7, cut - 3.4], [2.2, cut - 5.2], [3.1, cut - 6.0]], 0.46, '#FFE04A', '#FF5A8A');
  q.fill(body, G.base, { gf: ballGrad(q, cx, cy, rx, G) });
  if (!L) {
    q.line(q.path([[cx - 2.0, cut + 0.3], [cx - 2.9, cy], [cx - 1.6, cy + 3.6]], false) + q.path([[cx + 0.6, cut + 0.1], [cx + 0.9, cy + 0.4], [cx + 0.4, cy + 4.0]], false) + q.path([[cx + 2.4, cut + 0.5], [cx + 2.9, cy + 0.4], [cx + 1.8, cy + 3.3]], false), G.deep, 0.16, { o: 0.35, cp: body });
    q.fill(q.ell(cx - 1.8, cy - 1.2, 1.1, 2.2, 15), '#FFFFFF', { o: 0.22, b: 0.6, cp: body });
  }
  // topo cortado: polpa branca com a água no meio
  q.fill(q.ell(cx, cut, rx * 0.64, 0.95), '#F6F2E2', { gf: q.lg(0, cut - 0.9, 0, cut + 0.9, [[0, '#FFFFFF'], [1, '#E2DAC0']]) });
  q.fill(q.ell(cx + 0.15, cut + 0.05, rx * 0.38, 0.5), '#D9D2B4');
  // o canudo sai da água (parte da frente por cima da polpa)
  straw(q, [[0.85, cut + 0.1], [1.05, cut - 1.0]], 0.46, '#FFE04A', '#FF5A8A');
  // hibisco
  const fx = cx - 2.5;
  const fy = cut + 0.5;
  let pd = '';
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
    pd += q.ell(fx + Math.cos(a) * 0.7, fy + Math.sin(a) * 0.65, 0.68, 0.55, (a * 180) / Math.PI);
  }
  q.fill(pd, '#FF5C8D', { gf: q.rg(fx, fy, 1.4, [[0, '#C21E5A'], [0.4, '#FF5C8D'], [1, '#FF9DBC']]) });
  q.fill(q.ell(fx + 0.2, fy - 0.2, 0.24, 0.24), '#FFD84A');
  grip(q, 0.0, e, body, { curve: 0.22, reach: 0.9 });
  return null;
}

function milkshake(q: Pen): string | null {
  const L = q.lite;
  const y0 = -3.6;
  const y1 = 5.4;
  const e = trap(y0, 3.0, y1, 2.3);
  const glass = q.path([[e(y0)[0], y0], [e(y0)[1], y0], [e(y1)[1], y1], [e(y1)[1] + 0.25, y1 + 0.7, 0.4], [e(y1)[0] - 0.25, y1 + 0.7, 0.4], [e(y1)[0], y1]]);
  const shake = q.path([[e(y0 + 0.4)[0] + 0.2, y0 + 0.4], [e(y0 + 0.4)[1] - 0.2, y0 + 0.4], [e(y1 - 0.2)[1] - 0.2, y1 - 0.2], [e(y1 - 0.2)[0] + 0.2, y1 - 0.2]]);
  // canudo listrado (sai do chantili)
  straw(q, [[1.0, y0], [1.7, y0 - 3.6], [2.3, y0 - 5.8]], 0.4, '#FFFFFF', '#E8344E');
  q.fill(shake, '#F7A1C4', { gf: q.lg(-2.6, 0, 2.9, 0, [[0, '#FFC4DA'], [0.35, '#F7A1C4'], [1, '#D86C98']]) });
  if (!L) q.fill(q.ell(-0.4, y0 + 0.5, 2.2, 0.55), '#FFFFFF', { o: 0.3, b: 0.3, cp: shake });
  glassy(q, glass, e(y0)[0], e(y0)[1], y0, y1 + 0.7, '#E8F6FF', 0.25);
  q.line(q.ell(0.15, y0, 3.0, 0.4), '#FFFFFF', 0.18, { o: 0.7 });
  // chantili e cereja
  const cream = q.path([[-2.85, y0 + 0.2], [-2.5, y0 - 1.1], [-1.2, y0 - 2.2], [0.2, y0 - 2.7], [1.5, y0 - 2.1], [2.6, y0 - 1.0], [3.15, y0 + 0.2], [0.15, y0 + 0.6]]);
  q.fill(cream, '#FFFDF8', { gf: ballGrad(q, -0.4, y0 - 1.2, 3.0, tones('#F6F0E8')) });
  if (!L) q.line(q.path([[-2.1, y0 - 0.6], [-0.5, y0 - 1.4], [1.1, y0 - 0.8], [2.3, y0 - 0.4]], false) + q.path([[-1.2, y0 - 1.8], [0.4, y0 - 2.2], [1.4, y0 - 1.6]], false), '#D9D0C4', 0.18, { o: 0.7, cp: cream });
  q.line(q.path([[0.5, y0 - 3.5], [0.9, y0 - 4.5], [1.6, y0 - 4.9]], false), '#5A7A2A', 0.15);
  q.fill(q.ell(0.4, y0 - 3.4, 0.85, 0.8), '#D81E3A', { gf: ballGrad(q, 0.4, y0 - 3.4, 0.85, tones('#D81E3A')) });
  if (!L) q.fill(q.ell(0.13, y0 - 3.7, 0.24, 0.17, -20), '#FFFFFF', { o: 0.85 });
  grip(q, -0.3, e, glass);
  return null;
}

function boba(q: Pen): string | null {
  const L = q.lite;
  const y0 = -2.8;
  const y1 = 6.2;
  const e = trap(y0, 2.85, y1, 2.35);
  const cup = q.path([[e(y0)[0], y0], [e(y0)[1], y0], [e(y1)[1], y1, 0.3], [e(y1)[0], y1, 0.3]]);
  // canudo grosso (atrás do copo, aparece pelo plástico)
  straw(q, [[0.4, 5.0], [0.8, y0], [1.5, y0 - 6.0]], 0.55, '#B9A2F0', null);
  const tea = q.path([[e(y0 + 0.7)[0] + 0.1, y0 + 0.7], [e(y0 + 0.7)[1] - 0.1, y0 + 0.7], [e(y1 - 0.1)[1] - 0.1, y1 - 0.1], [e(y1 - 0.1)[0] + 0.1, y1 - 0.1]]);
  q.fill(tea, '#D9B48A', { o: 0.94, gf: q.lg(0, y0, 0, y1, [[0, '#EBD2B2'], [1, '#C69A6A']]) });
  // pérolas de tapioca no fundo (aparecem embaixo dos dedos)
  let pd = '';
  let hl = '';
  for (const [x, y] of [
    [-1.4, 5.6],
    [-0.35, 5.7],
    [0.7, 5.6],
    [1.7, 5.5],
    [-1.8, 4.7],
    [-0.8, 4.8],
    [0.2, 4.75],
    [1.2, 4.7],
    [2.1, 4.6],
  ] as const) {
    pd += q.ell(x, y, 0.46, 0.46);
    hl += q.ell(x - 0.15, y - 0.16, 0.13, 0.1);
  }
  q.fill(pd, '#2A1A12', { cp: tea });
  if (!L) q.fill(hl, '#FFFFFF', { o: 0.6, cp: tea });
  glassy(q, cup, e(y0)[0], e(y0)[1], y0, y1, '#F2FAFF', 0.18);
  // tampa em domo transparente
  const dome = q.path([[-2.95, y0], [3.25, y0], [2.6, y0 - 1.4], [0.15, y0 - 2.1, 0.6], [-2.3, y0 - 1.4]]);
  q.fill(dome, '#F2FAFF', { o: 0.3 });
  q.line(dome, '#FFFFFF', 0.16, { o: 0.75 });
  if (!L) q.fill(q.taper([[-1.9, y0 - 0.4], [-1.2, y0 - 1.4], [-0.1, y0 - 1.8]], [0.15, 0.32, 0.1]), '#FFFFFF', { o: 0.75 });
  q.line(q.path([[-2.9, y0], [3.2, y0]], false), '#FFFFFF', 0.25, { o: 0.8 });
  grip(q, -0.4, e, cup);
  return null;
}

function iceCream(q: Pen): string | null {
  const L = q.lite;
  const W = tones('#D9A15A');
  const y0 = 0.1;
  const yTip = 9.6;
  const e = trap(y0, 2.75, yTip, 0.1, 0.1);
  const cone = q.path([[e(y0)[0], y0], [e(y0)[1], y0], [0.35, yTip - 0.1, 0.4], [-0.1, yTip, 0.4]]);
  q.fill(cone, W.base, { gf: q.lg(-2.6, 0, 2.8, 0, [[0, W.light], [0.4, W.base], [1, W.shade]]) });
  if (!L) {
    let d = '';
    for (let i = -4; i <= 5; i++) d += q.path([[-2.8 + i * 1.1, y0 - 0.2], [-0.4 + i * 1.1 + 2.8, yTip]], false) + q.path([[2.8 - i * 1.1, y0 - 0.2], [0.4 - i * 1.1 - 2.8, yTip]], false);
    q.line(d, W.deep, 0.16, { o: 0.5, cp: cone });
  }
  q.fill(q.path([[-2.95, y0 - 0.5, 0.4], [3.15, y0 - 0.5, 0.4], [2.95, y0 + 0.5, 0.4], [-2.75, y0 + 0.5, 0.4]]), W.light, { gf: q.lg(0, y0 - 0.5, 0, y0 + 0.5, [[0, W.lighter], [1, W.shade]]) });
  // bolas: morango (com escorrido) e menta com gotas de chocolate
  const S = tones('#F48FB1');
  const b = y0 - 0.4;
  const s1 = q.path([[-2.9, b], [-2.7, b - 2.0], [-1.2, b - 3.5], [1.2, b - 3.5], [2.8, b - 2.0], [3.1, b], [2.4, b + 0.5], [1.8, b + 1.3, 0.6], [1.2, b + 0.5], [0.3, b + 0.7], [-0.6, b + 0.4], [-1.2, b + 1.5, 0.6], [-1.8, b + 0.5]]);
  q.fill(s1, S.base, { gf: ballGrad(q, 0, b - 1.6, 3.1, S) });
  const M = tones('#9BE3C8');
  const c = b - 3.0;
  const s2 = q.path([[-2.3, c], [-2.0, c - 1.9], [-0.5, c - 3.1], [1.1, c - 3.0], [2.4, c - 1.8], [2.6, c], [1.8, c + 0.6], [0.9, c + 0.3], [-0.1, c + 0.6], [-1.3, c + 0.4]]);
  q.fill(s2, M.base, { gf: ballGrad(q, 0.2, c - 1.4, 2.6, M) });
  if (!L) {
    q.fill(q.ell(-0.6, c - 1.9, 0.27, 0.22) + q.ell(0.9, c - 1.1, 0.27, 0.22) + q.ell(0.2, c - 0.3, 0.24, 0.2) + q.ell(1.6, c - 2.1, 0.24, 0.2) + q.ell(-1.4, c - 0.7, 0.22, 0.18), '#4A2A1A', { cp: s2 });
    let d = '';
    for (const [x, y, a] of [
      [-1.6, b - 1.4, 20],
      [-0.3, b - 2.5, -30],
      [1.3, b - 1.7, 60],
      [0.7, b - 0.6, 10],
      [-0.9, b - 0.4, -60],
    ] as const) {
      const r = (a * Math.PI) / 180;
      d += q.path([[x - Math.cos(r) * 0.32, y - Math.sin(r) * 0.32], [x + Math.cos(r) * 0.32, y + Math.sin(r) * 0.32]], false);
    }
    q.line(d, '#FFFFFF', 0.2, { o: 0.9, cp: s1 });
  }
  grip(q, 0.75, e, cone, { curve: 0.1, reach: 0.95 });
  return null;
}

function popcorn(q: Pen): string | null {
  const L = q.lite;
  const y0 = -3.4;
  const y1 = 6.0;
  const e = trap(y0, 3.4, y1, 2.45);
  const bucket = q.path([[e(y0)[0], y0], [e(y0)[1], y0], [e(y1)[1], y1, 0.3], [e(y1)[0], y1, 0.3]]);
  // pipoca transbordando (atrás da borda)
  const puffs: [number, number, number][] = [
    [-2.7, -4.0, 1.05],
    [-1.4, -4.6, 1.2],
    [0.1, -4.8, 1.25],
    [1.6, -4.6, 1.15],
    [2.9, -4.0, 1.0],
    [-2.0, -5.8, 1.05],
    [-0.5, -6.3, 1.15],
    [1.0, -6.1, 1.1],
    [2.2, -5.6, 0.95],
    [0.3, -7.4, 1.0],
    [-1.1, -7.2, 0.85],
  ];
  const P = tones('#FFF1CC');
  let pd = '';
  for (const [x, y, r] of puffs) pd += q.path([[x - r, y + 0.1], [x - r * 0.6, y - r * 0.7], [x, y - r * 0.9], [x + r * 0.7, y - r * 0.6], [x + r, y + 0.1], [x + r * 0.3, y + r * 0.7], [x - r * 0.5, y + r * 0.6]]);
  q.fill(pd, P.base, { gf: q.rg(-0.6, -6.6, 4.6, [[0, '#FFFFFF'], [0.55, P.base], [1, '#E8B850']]) });
  if (!L) {
    let sh = '';
    for (const [x, y, r] of puffs) sh += q.ell(x + r * 0.35, y + r * 0.3, r * 0.45, r * 0.32);
    q.fill(sh, '#C8902A', { o: 0.3, b: 0.25, cp: pd });
  }
  // balde listrado
  const W = tones('#FAF7F2');
  q.fill(bucket, W.base, { gf: cylX(q, e(y0)[0], e(y0)[1], 0, W) });
  let sd = '';
  for (let i = -2; i <= 2; i++) {
    const t0 = i * 0.42 - 0.1;
    const t1 = t0 + 0.21;
    sd += q.path([[0.15 + t0 * 3.4 * 1.15, y0], [0.15 + t1 * 3.4 * 1.15, y0], [0.15 + t1 * 2.45 * 1.15, y1], [0.15 + t0 * 2.45 * 1.15, y1]]);
  }
  const R = tones('#E3263A');
  q.fill(sd, R.base, { cp: bucket, gf: cylX(q, e(y0)[0], e(y0)[1], 0, R) });
  if (!L) q.fill(q.ell(2.2, 1.6, 1.3, 4.2, -8), '#000000', { o: 0.18, b: 0.6, cp: bucket });
  q.fill(q.path([[-3.45, y0 - 0.3, 0.4], [3.75, y0 - 0.3, 0.4], [3.6, y0 + 0.4, 0.4], [-3.3, y0 + 0.4, 0.4]]), '#FFFFFF', { gf: cylX(q, -3.45, 3.75, 0, tones('#F2EEE8'), true) });
  grip(q, -0.2, e, bucket);
  return null;
}

export const HELD_FOOD: Record<string, HeldDef> = {
  coffee: { draw: coffee },
  coconut: { draw: coconut },
  milkshake: { draw: milkshake },
  boba: { draw: boba },
  ice_cream: { draw: iceCream },
  popcorn: { draw: popcorn },
};
