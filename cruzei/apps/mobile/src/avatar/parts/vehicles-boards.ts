// Veículos de ficar em pé (stand): patinete elétrico, skate e hoverboard. Dono: veículos.
//
// O piloto sobe `lift` (vehicles-geom) e o deque fica embaixo das solas de verdade (riderSoles). A câmera do avatar é
// de frente e um tico de cima: o plano de cima do deque aparece como uma faixa fina atrás dos pés e a face da frente
// (espessura) logo abaixo. Em 48 px: patinete = haste vertical + guidão + rodinha; skate = prancha comprida com bicos
// levantados e rodinhas claras; hoverboard = barra com duas rodas nas pontas e filete de luz.
//
// Etapas: boardBack (2: sombra, deque, rodas) e boardFront (13: haste, farol e guidão do patinete). O skate e o
// hoverboard ficam todos atrás (os sapatos pisam por cima).

import type { LayerCtx } from '../ctx';
import { fmt } from '../geometry';
import { isLite, mix } from '../shading';

import { barsGeom } from './vehicles-geom';
import {
  alloyGrad,
  chromeGrad,
  contact,
  curve,
  ell,
  floorShadow,
  glowGrad,
  headlamp,
  neonLine,
  paintOf,
  paintPanel,
  riderSoles,
  rrect,
  rubberGrad,
  shape,
  symShape,
  tireFront,
  tube,
} from './vehicles-kit';

type BoardId = 'kick' | 'skate' | 'hoverboard';

export function boardBack(ctx: LayerCtx, id: BoardId): void {
  if (id === 'kick') kickBack(ctx);
  else if (id === 'hoverboard') hoverBack(ctx);
  else skateBack(ctx);
}

export function boardFront(ctx: LayerCtx, id: BoardId): void {
  if (id === 'kick') kickFront(ctx);
}

/** y das solas no espaço do veículo (o deque encosta aqui) */
function soleY(ctx: LayerCtx): number {
  const [L, R] = riderSoles(ctx);
  return Math.max(L[1], R[1]);
}

/** luz de destaque que contrasta com a tinta (lima da marca; magenta se a tinta já for verde) */
function accentOf(hex: string): string {
  const h = hex.toUpperCase();
  return h === '#7FFF00' || h === '#3BAF6E' || h === '#6E7A3B' || h === '#2E8B57' ? '#FF1493' : '#7FFF00';
}

// ---------------------------------------------------------------------------------------------------------------
// Patinete elétrico: deque com lixa, haste na cor, rodinha da frente, farol na haste, visor e guidão reto
// ---------------------------------------------------------------------------------------------------------------

function kickBack(ctx: LayerCtx): void {
  const { an } = ctx;
  const cx = an.cx;
  const lite = isLite(ctx);
  const p = paintOf(ctx.col.vehicle);
  const y = soleY(ctx);
  const acc = accentOf(p.base);
  floorShadow(ctx, cx, 134.7, 14, 1.9, 0.5, 1.2);
  // luz de chão embaixo do deque (patinete elétrico): é o que faz ele ler no mapa, até na tinta escura
  ctx.push(ell(cx, 134.5, 13, 1.5), acc, { gf: glowGrad(cx, 134.5, 13, acc, 0.42), g: 'shadow' });
  // deque visto um tico de cima: plano de cima (lixa) atrás dos pés e face da frente na cor
  const top = shape([
    [cx - 12.2, y + 0.6, 0.4],
    [cx - 10.4, y - 2.4],
    [cx + 10.4, y - 2.4],
    [cx + 12.2, y + 0.6, 0.4],
  ]);
  ctx.push(top, '#24252C', { gf: { t: 'l', x1: cx, y1: y - 2.4, x2: cx, y2: y + 0.6, s: [[0, '#191A1F'], [1, '#33353E']] } });
  if (!lite) ctx.stroke(curve([[cx - 10.6, y - 2.1], [cx, y - 2.3], [cx + 10.6, y - 2.1]]), '#6C7080', 0.3, { o: 0.6 });
  const face = shape([
    [cx - 12.4, y + 0.4, 0.3],
    [cx + 12.4, y + 0.4, 0.3],
    [cx + 11.8, y + 2.8, 0.5],
    [cx - 11.8, y + 2.8, 0.5],
  ]);
  paintPanel(ctx, face, { x: cx - 12.4, y: y + 0.4, w: 24.8, h: 2.4 }, p, { hz: 0.35, rim: false });
  neonLine(ctx, `M${fmt(cx - 9.5)},${fmt(y + 1.9)}H${fmt(cx + 9.5)}`, acc, 0.6, { halo: 0.3 });
}

function kickFront(ctx: LayerCtx): void {
  const { an } = ctx;
  const cx = an.cx;
  const lite = isLite(ctx);
  const p = paintOf(ctx.col.vehicle);
  const G = barsGeom(an, 'kick');
  const y = soleY(ctx);
  const wy = 134 - G.wheelR;
  // rodinha da frente (pneu cheio de frente) e para-lama
  contact(ctx, cx, 134.5, 2.6, 0.6);
  tireFront(ctx, cx - 2.6, wy - G.wheelR + 0.6, 5.2, 134 - (wy - G.wheelR + 0.6), { grooves: 4 });
  const fy = wy - G.wheelR - 0.6;
  ctx.push(
    shape([
      [cx - 3.1, fy + 3.6, 0.3],
      [cx - 3, fy + 0.8],
      [cx, fy - 0.2],
      [cx + 3, fy + 0.8],
      [cx + 3.1, fy + 3.6, 0.3],
      [cx + 2.2, fy + 3.6],
      [cx, fy + 1.4],
      [cx - 2.2, fy + 3.6],
    ]),
    '#1E1F25',
    { gf: rubberGrad(cx - 3, fy, cx + 3, fy + 3.6) },
  );
  // garfo curto (alumínio) + trava de dobrar
  for (const g of [-1, 1]) ctx.stroke(`M${fmt(cx + g * 2.6)},${fmt(wy)}L${fmt(cx + g * 1.7)},${fmt(fy - 2.6)}`, '#9AA1AF', 1.0);
  ctx.push(rrect(cx - 2.4, fy - 4.6, 4.8, 2.6, 0.9), '#B6BDC9', { gf: chromeGrad(cx - 2.4, fy - 4.6, cx + 2.4, fy - 2) });
  // haste na cor, do garfo ao guidão (luz na esquerda, sombra na direita)
  const stem = rrect(cx - 2.2, G.barY + 1.2, 4.4, fy - 4.4 - (G.barY + 1.2), 1.7);
  paintPanel(ctx, stem, { x: cx - 2.2, y: G.barY + 1.2, w: 4.4, h: fy - G.barY }, p, { hz: 0.5, rim: false });
  // fio de luz na quina esquerda (lê no mapa mesmo com tinta preta)
  ctx.stroke(`M${fmt(cx - 1.1)},${fmt(G.barY + 2.5)}V${fmt(fy - 5.4)}`, mix(p.hi, '#FFFFFF', 0.35), 0.7, { o: 0.75, cp: stem });
  ctx.stroke(`M${fmt(cx + 1.2)},${fmt(G.barY + 2.5)}V${fmt(fy - 5.4)}`, p.deep, 0.5, { o: 0.5, cp: stem });
  // farol na haste (sobre a altura da canela)
  const ly = Math.min(fy - 9, y - 9);
  ctx.push(rrect(cx - 2.3, ly - 1.9, 4.6, 3.8, 1.6), '#1C1D23');
  headlamp(ctx, ell(cx, ly, 1.7, 1.4), [cx, ly], 1.5, { glow: 0.6, housing: '#2A2C34' });
  // guidão reto com visor no meio e manoplas
  const [gL, gR] = G.grips;
  const bar = `M${fmt(gL[0] - 2.4)},${fmt(gL[1])}L${fmt(gR[0] + 2.4)},${fmt(gR[1])}`;
  tube(ctx, bar, 1.5, '#3A3D47', { hi: '#A6ADBB' });
  const scr = rrect(cx - 3.2, G.barY - 1.6, 6.4, 3.0, 1.0);
  ctx.push(scr, '#111216', { gf: { t: 'l', x1: cx, y1: G.barY - 1.6, x2: cx, y2: G.barY + 1.4, s: [[0, '#2E3038'], [1, '#0A0A0D']] } });
  if (!lite) {
    // visor: barrinhas de bateria acesas
    const a = accentOf(p.base);
    let bars = '';
    for (let i = 0; i < 4; i++) bars += rrect(cx - 2.2 + i * 1.15, G.barY - 0.6, 0.8, 1.0, 0.2);
    ctx.push(bars, a, { o: 0.95 });
  }
  for (const [x, yy, g] of [
    [gL[0], gL[1], -1],
    [gR[0], gR[1], 1],
  ] as const) {
    const d = rrect(x + g * 0.4 - 2.7, yy - 1.15, 5.4, 2.3, 1.15);
    ctx.push(d, '#1A1B21', { gf: rubberGrad(x, yy - 1.15, x, yy + 1.15) });
    if (!lite) ctx.stroke(`M${fmt(x - g * 2.4)},${fmt(yy - 0.3)}q${fmt(-g * 2.4)},1.4 ${fmt(-g * 4.4)},1.0`, '#B9C0CC', 0.5);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Skate: prancha comprida com bicos levantados, lixa escura, borda na cor (lâminas de madeira), trucks e rodinhas
// ---------------------------------------------------------------------------------------------------------------

function skateBack(ctx: LayerCtx): void {
  const { an } = ctx;
  const cx = an.cx;
  const lite = isLite(ctx);
  const p = paintOf(ctx.col.vehicle);
  const y = soleY(ctx);
  const hw = 27;
  floorShadow(ctx, cx, 134.8, hw + 1, 1.7, 0.5, 1.1);
  // trucks (metal) e rodinhas (uretano creme) — atrás da prancha: aparecem embaixo dela
  const wy = 134 - 2.15;
  for (const g of [-1, 1]) {
    const tx = cx + g * (hw - 8);
    ctx.push(rrect(tx - 3.6, y + 2.6, 7.2, 1.6, 0.6), '#9AA1AF', { gf: alloyGrad(tx - 3.6, y + 2.6, tx + 3.6, y + 4.2) });
    for (const k of [-1, 1]) {
      const x = tx + k * 3.6;
      ctx.push(ell(x, wy, 2.0, 2.15), '#EDE3C8', {
        gf: { t: 'r', cx: x - 0.5, cy: wy - 0.6, r: 2.7, s: [[0, '#FFFBEE'], [0.6, '#E6D9B4'], [1, '#9C8E6A']] },
      });
    }
    contact(ctx, tx, 134.6, 6, 0.55);
  }
  // prancha: plano de cima (lixa) com bicos que sobem nas pontas
  const kick = 2.4;
  const top: SPt[] = [
    [cx - hw - 0.4, y - kick - 0.8, 0.6],
    [cx - hw + 5, y - 1.2],
    [cx, y - 1.6],
    [cx + hw - 5, y - 1.2],
    [cx + hw + 0.4, y - kick - 0.8, 0.6],
    [cx + hw + 0.2, y - kick + 0.8, 0.6],
    [cx + hw - 5, y + 0.9],
    [cx, y + 0.9],
    [cx - hw + 5, y + 0.9],
    [cx - hw - 0.2, y - kick + 0.8, 0.6],
  ];
  const deck = shape(top);
  ctx.push(deck, '#1E1F25', { gf: { t: 'l', x1: cx, y1: y - 2, x2: cx, y2: y + 1, s: [[0, '#2C2E36'], [1, '#17181D']] } });
  if (!lite) ctx.push(deck, '#FFFFFF', { o: 0.05, gf: { t: 'l', x1: cx - hw, y1: y, x2: cx + hw, y2: y, s: [[0, '#FFFFFF', 0.2], [0.25, '#FFFFFF', 0], [1, '#FFFFFF', 0]] } });
  // borda (face da frente) na cor, com a linha clara das lâminas de madeira embaixo
  const edge = shape([
    [cx - hw - 0.2, y - kick + 0.8, 0.6],
    [cx - hw + 5, y + 0.9],
    [cx, y + 0.9],
    [cx + hw - 5, y + 0.9],
    [cx + hw + 0.2, y - kick + 0.8, 0.6],
    [cx + hw - 0.4, y - kick + 2.8, 0.6],
    [cx + hw - 5, y + 3.0],
    [cx, y + 3.0],
    [cx - hw + 5, y + 3.0],
    [cx - hw + 0.4, y - kick + 2.8, 0.6],
  ]);
  paintPanel(ctx, edge, { x: cx - hw, y: y - kick, w: hw * 2, h: kick + 3.0 }, p, { hz: 0.3, rim: false });
  ctx.stroke(curve([[cx - hw + 0.6, y - kick + 2.5], [cx - hw + 5, y + 2.7], [cx + hw - 5, y + 2.7], [cx + hw - 0.6, y - kick + 2.5]]), '#E9D6AE', 0.4, { o: 0.85 });
  if (!lite) {
    // estampa: duas faixas claras na borda (cada ponta)
    for (const g of [-1, 1]) ctx.stroke(`M${fmt(cx + g * (hw - 11))},${fmt(y + 1.3)}h${fmt(g * 4)}`, mix(p.base, '#FFFFFF', 0.7), 0.6, { o: 0.8, c: 'butt' });
    // parafusos do truck na lixa
    let bolts = '';
    for (const g of [-1, 1]) for (const k of [-1, 1]) bolts += ell(cx + g * (hw - 8) + k * 1.4, y - 0.4, 0.3, 0.22);
    ctx.push(bolts, '#B9C0CC', { o: 0.85 });
  }
}

type SPt = readonly [number, number] | readonly [number, number, number];

// ---------------------------------------------------------------------------------------------------------------
// Hoverboard: corpo com para-lamas nas pontas, rodas grandes, pisantes de borracha, faróis e filete de luz
// ---------------------------------------------------------------------------------------------------------------

function hoverBack(ctx: LayerCtx): void {
  const { an } = ctx;
  const cx = an.cx;
  const lite = isLite(ctx);
  const p = paintOf(ctx.col.vehicle);
  const y = soleY(ctx);
  const acc = accentOf(p.base);
  const hw = 24;
  const R = (134 - y) / 2 + 1.6;
  const wy = 134 - R;
  floorShadow(ctx, cx, 134.8, hw + 6, 1.9, 0.5, 1.2);
  // luz de baixo no chão
  ctx.push(ell(cx, 134.4, hw - 2, 1.8), acc, { gf: glowGrad(cx, 134.4, hw - 2, acc, 0.4), g: 'shadow' });
  // rodas (pneu de frente) nas pontas
  for (const g of [-1, 1]) {
    const x = cx + g * (hw + 1.6);
    tireFront(ctx, x - 3.2, wy - R, 6.4, 2 * R, { grooves: 5 });
    contact(ctx, x, 134.5, 3.4, 0.6);
  }
  // corpo: barra arredondada com para-lamas que sobem por cima das rodas
  const half: SPt[] = [
    [cx - 3, y - 0.8],
    [cx - hw + 4, y - 0.8],
    [cx - hw - 0.6, wy - R - 1.6],
    [cx - hw - 4.8, wy - R - 1.4],
    [cx - hw - 5.6, wy - R + 2.4, 0.5],
    [cx - hw - 4.6, wy - R + 2.2],
    [cx - hw + 0.4, y + 2.4],
    [cx - hw + 2, y + 3.6, 0.5],
    [cx - 3, y + 3.6],
  ];
  const body = symShape(half, cx);
  paintPanel(ctx, body, { x: cx - hw - 5.6, y: wy - R - 1.6, w: 2 * hw + 11.2, h: y + 3.6 - (wy - R - 1.6) }, p, {
    hz: 0.45,
    spec: shape([
      [cx - hw - 3.6, wy - R - 0.8],
      [cx - hw - 0.8, wy - R - 1.0],
      [cx - hw + 1, y - 0.4],
      [cx - hw - 0.6, y - 0.2],
    ]),
  });
  // plano de cima (pisantes de borracha) atrás dos pés
  for (const g of [-1, 1]) {
    const px = cx + g * 9.5;
    ctx.push(rrect(px - 6.4, y - 1.4, 12.8, 1.8, 0.9), '#1A1B20', { gf: rubberGrad(px, y - 1.4, px, y + 0.4) });
  }
  // junta do meio (pivô) e filete de luz na face da frente
  ctx.push(rrect(cx - 1.6, y - 1.0, 3.2, 4.4, 1.0), '#1E1F25', { gf: { t: 'l', x1: cx - 1.6, y1: 0, x2: cx + 1.6, y2: 0, s: [[0, '#4A4D58'], [1, '#14151A']] } });
  neonLine(ctx, `M${fmt(cx - hw + 3.2)},${fmt(y + 2.0)}H${fmt(cx - 3)}M${fmt(cx + 3)},${fmt(y + 2.0)}H${fmt(cx + hw - 3.2)}`, acc, 0.55, { halo: 0.3 });
  // faróis brancos nas pontas
  for (const g of [-1, 1]) {
    const lx = cx + g * (hw - 2.6);
    ctx.push(ell(lx, y + 1.6, 1.3, 0.8), '#FFFFFF', { gf: { t: 'r', cx: lx, cy: y + 1.5, r: 1.4, s: [[0, '#FFFFFF'], [1, '#C9D6EE']] } });
    if (!lite) ctx.push(ell(lx, y + 1.6, 3.6, 2.4), '#EAF2FF', { gf: glowGrad(lx, y + 1.6, 3.6, '#EAF2FF', 0.45) });
  }
}
