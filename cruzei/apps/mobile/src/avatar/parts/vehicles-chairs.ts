// Cadeiras de rodas (seat): a do dia a dia (quadro rígido moderno, encosto com punhos) e a esportiva (rodas com
// cambagem, encosto baixo, para-choque na frente). Dono: veículos.
//
// Dignidade em primeiro lugar: é um objeto de design bonito e bem-acabado, do tamanho da pessoa, nunca um "aparelho".
// Quadro na cor escolhida (tinta metálica), estofado de tecido escuro, aros de impulsão cromados, rodas grandes com
// raios (ou discos de carbono na esportiva) e rodízios pequenos na frente.
//
// Tudo sai da anatomia sentada do dono da base: assento logo abaixo do quadril (`joints.hipL[1] + 1,2`), apoio dos pés
// na sola sentada (`foot.soleY` = 132,4), largura pelo quadril da pessoa e o encosto no tronco (que desce `seatDrop`).
//
// Etapas: chairBack (2: sombra, encosto, punhos, assento, quadro da frente, apoio dos pés, rodízios, eixo) e
// chairFront (13: rodas grandes com aro de impulsão dos lados do quadril, protetor e para-choque da esportiva).

import type { Anatomy } from '../anatomy';
import type { LayerCtx } from '../ctx';
import { fmt } from '../geometry';
import { isLite } from '../shading';

import {
  chromeGrad,
  contact,
  curve,
  curveArc,
  ell,
  floorShadow,
  paintOf,
  paintPanel,
  rrect,
  rubberGrad,
  shape,
  sideWheel,
  tube,
  type Paint,
} from './vehicles-kit';

type ChairId = 'wheelchair' | 'wheelchair_sport';

interface ChairGeom {
  /** topo do assento (almofada) */
  seatY: number;
  /** meia-largura do assento */
  seatHW: number;
  /** topo do encosto e altura dos punhos (no espaço do veículo: o tronco já desceu) */
  backY: number;
  handleY: number;
  /** rodas grandes: centro x (±) e y, raio, quanto do aro aparece (0..1) e cambagem (graus) */
  wheelX: number;
  wheelY: number;
  R: number;
  turn: number;
  camber: number;
  /** apoio dos pés (y do topo) e meia-largura */
  plateY: number;
  plateHW: number;
}

function chairGeom(an: Anatomy, id: ChairId): ChairGeom {
  const sport = id === 'wheelchair_sport';
  const seatY = Math.max(an.joints.hipL[1], an.joints.hipR[1]) + 1.2;
  const seatHW = an.w.hip + 2.2;
  const drop = an.seatDrop;
  const R = sport ? 20.4 : 19.6;
  return {
    seatY,
    seatHW,
    backY: sport ? an.waistY + drop + 2.5 : an.waistY + drop - 7.5,
    handleY: an.waistY + drop - 11,
    wheelX: seatHW + (sport ? 4.2 : 4.6),
    wheelY: 134 - R,
    R,
    turn: sport ? 0.3 : 0.27,
    camber: sport ? 11 : 0,
    plateY: an.foot.soleY - 0.4,
    plateHW: 12.8,
  };
}

/** tubo do quadro na cor (tinta metálica) */
function frameTube(ctx: LayerCtx, d: string, w: number, p: Paint): void {
  tube(ctx, d, w, p.base, { lo: p.deep, hi: p.sky, shine: 0.7 });
}

// ---------------------------------------------------------------------------------------------------------------
// 2. trás
// ---------------------------------------------------------------------------------------------------------------

export function chairBack(ctx: LayerCtx, id: ChairId): void {
  const { an } = ctx;
  const cx = an.cx;
  const lite = isLite(ctx);
  const sport = id === 'wheelchair_sport';
  const G = chairGeom(an, id);
  const p = paintOf(ctx.col.vehicle);
  const fab = '#25262D';
  floorShadow(ctx, cx, 134.7, G.wheelX + 9, 2.8, 0.5, 1.6);
  // eixo (barra de cambagem) entre as rodas, atrás das pernas
  frameTube(ctx, `M${fmt(cx - G.wheelX)},${fmt(G.wheelY)}L${fmt(cx + G.wheelX)},${fmt(G.wheelY)}`, 1.6, p);
  // encosto (tecido) entre os tubos de trás e, na do dia a dia, punhos de empurrar
  const bx = G.seatHW - 0.6;
  const back = shape([
    [cx - bx, G.seatY + 0.5, 0.3],
    [cx - bx - 0.3, G.backY + 2],
    [cx - bx + 1.6, G.backY, 0.6],
    [cx + bx - 1.6, G.backY, 0.6],
    [cx + bx + 0.3, G.backY + 2],
    [cx + bx, G.seatY + 0.5, 0.3],
  ]);
  ctx.push(back, fab, { gf: { t: 'l', x1: cx - bx, y1: G.backY, x2: cx + bx, y2: G.seatY, s: [[0, '#3C3E48'], [0.5, fab], [1, '#15161B']] } });
  if (!lite) {
    // gomos horizontais do estofado e vivo claro em cima
    let v = '';
    for (let y = G.backY + 3.4; y < G.seatY - 1; y += 3.4) v += `M${fmt(cx - bx + 0.8)},${fmt(y)}H${fmt(cx + bx - 0.8)}`;
    ctx.stroke(v, '#0C0C10', 0.4, { o: 0.5, cp: back });
    ctx.stroke(curve([[cx - bx + 1.4, G.backY + 0.5], [cx, G.backY + 0.2], [cx + bx - 1.4, G.backY + 0.5]]), '#7A7E8C', 0.4, { o: 0.6 });
  }
  for (const g of [-1, 1]) {
    const x = cx + g * (bx + 0.6);
    if (sport) {
      frameTube(ctx, `M${fmt(x)},${fmt(G.seatY + 1)}L${fmt(x)},${fmt(G.backY + 0.6)}`, 1.5, p);
    } else {
      // tubo de trás sobe até o punho; o punho aponta pra trás (encurtado), com ponteira de borracha
      frameTube(ctx, curve([[x, G.seatY + 1], [x, G.backY], [x + g * 0.2, G.handleY + 1.6]]), 1.6, p);
      ctx.push(rrect(x - 1.25, G.handleY - 1.6, 2.5, 3.6, 1.2), '#18191E', { gf: rubberGrad(x - 1.25, G.handleY - 1.6, x + 1.25, G.handleY + 2) });
    }
  }
  // assento (almofada) — aparece dos lados das coxas
  const seat = rrect(cx - G.seatHW, G.seatY - 1.4, G.seatHW * 2, 3.4, 1.4);
  ctx.push(seat, fab, { gf: { t: 'l', x1: cx, y1: G.seatY - 1.4, x2: cx, y2: G.seatY + 2, s: [[0, '#4A4C57'], [0.4, fab], [1, '#121317']] } });
  // trilho do assento (quadro na cor) por baixo
  frameTube(ctx, `M${fmt(cx - G.seatHW + 0.4)},${fmt(G.seatY + 2.4)}H${fmt(cx + G.seatHW - 0.4)}`, 1.4, p);
  // quadro da frente: desce do assento ao apoio dos pés afunilando (atrás das canelas)
  for (const g of [-1, 1]) {
    const d = curve([
      [cx + g * (G.seatHW - 1.2), G.seatY + 2.4],
      [cx + g * (G.seatHW - 2.2), G.seatY + 14],
      [cx + g * (G.plateHW - 0.6), G.plateY + 0.6],
    ]);
    frameTube(ctx, d, 1.5, p);
  }
  // apoio dos pés (alumínio com antiderrapante) logo abaixo das solas
  const plate = rrect(cx - G.plateHW, G.plateY, G.plateHW * 2, 2.0, 0.8);
  ctx.push(plate, '#3A3D47', { gf: { t: 'l', x1: cx, y1: G.plateY, x2: cx, y2: G.plateY + 2, s: [[0, '#8E95A4'], [0.35, '#4A4E5A'], [1, '#22242B']] } });
  if (!lite) ctx.stroke(`M${fmt(cx - G.plateHW + 0.8)},${fmt(G.plateY + 0.35)}H${fmt(cx + G.plateHW - 0.8)}`, '#D7DCE5', 0.3, { o: 0.7 });
  // rodízios da frente: garfinho + rodinha (vista três-quartos)
  const cr = sport ? 2.4 : 3.0;
  const cxo = sport ? G.plateHW - 2.5 : G.plateHW + 1.8;
  for (const g of [-1, 1]) {
    const x = cx + g * cxo;
    const y = 134 - cr;
    ctx.stroke(`M${fmt(x)},${fmt(G.plateY - 3.4)}L${fmt(x)},${fmt(y)}`, '#9AA1AF', 1.0);
    ctx.push(rrect(x - 1.5, G.plateY - 4.4, 3.0, 1.8, 0.7), p.base, { gf: { t: 'l', x1: x - 1.5, y1: 0, x2: x + 1.5, y2: 0, s: [[0, p.hi], [1, p.deep]] } });
    sideWheel(ctx, [x, y], cr, { turn: 0.55, tire: cr * 0.32, disc: true, rim: '#C9CFDA' });
    contact(ctx, x, 134.4, 1.6, 0.5);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// 13. frente: rodas grandes dos lados do quadril
// ---------------------------------------------------------------------------------------------------------------

export function chairFront(ctx: LayerCtx, id: ChairId): void {
  const { an } = ctx;
  const cx = an.cx;
  const lite = isLite(ctx);
  const sport = id === 'wheelchair_sport';
  const G = chairGeom(an, id);
  const p = paintOf(ctx.col.vehicle);
  for (const g of [-1, 1]) {
    const x = cx + g * G.wheelX;
    const rot = g * -G.camber; // topo da roda pra dentro (cambagem)
    contact(ctx, x + g * G.R * Math.sin((G.camber * Math.PI) / 180) * 0.9, 134.5, 3.6, 0.8);
    if (sport) {
      // disco de carbono com aro na cor
      sideWheel(ctx, [x, G.wheelY], G.R, { turn: G.turn, tire: 1.9, disc: true, rim: '#2B2D35', rot, rimW: 1.0 });
      const inner = ell(x, G.wheelY, Math.max(0.5, (G.R - 1.9) * G.turn), G.R - 1.9, rot);
      ctx.push(inner, '#1A1B21', { gf: { t: 'l', x1: x - 4, y1: G.wheelY - G.R, x2: x + 4, y2: G.wheelY + G.R, s: [[0, '#4C4F5A'], [0.45, '#1E1F25'], [0.55, '#2C2E36'], [1, '#0F1014']] } });
      if (!lite) {
        // trama de carbono e anel na cor do quadro
        ctx.stroke(ell(x, G.wheelY, Math.max(0.4, (G.R - 5) * G.turn), G.R - 5, rot), p.base, 0.9, { o: 0.9 });
        ctx.stroke(curveArc([x, G.wheelY], (G.R - 3.6) * G.turn, G.R - 3.6, 200, 290, rot), '#FFFFFF', 0.4, { o: 0.4 });
      } else {
        ctx.stroke(ell(x, G.wheelY, Math.max(0.4, (G.R - 5) * G.turn), G.R - 5, rot), p.base, 1.1);
      }
      ctx.push(ell(x, G.wheelY, 1.2, 1.4, rot), '#C9CFDA', { gf: chromeGrad(x - 1.2, G.wheelY - 1.4, x + 1.2, G.wheelY + 1.4) });
    } else {
      sideWheel(ctx, [x, G.wheelY], G.R, { turn: G.turn, tire: 2.0, spokes: 16, rim: '#C9CFDA', rimW: 0.8, rot });
    }
    // aro de impulsão (cromado), um pouco pra fora da roda
    const prx = Math.max(0.6, (G.R - 2.6) * G.turn);
    const ring = ell(x + g * 1.4, G.wheelY, prx, G.R - 2.6, rot);
    ctx.stroke(ring, '#4E5462', 1.1);
    ctx.stroke(ring, '#E2E7EF', 0.7, { gs: chromeGrad(x - prx, G.wheelY - G.R, x + prx, G.wheelY + G.R) });
    if (!lite) {
      // presilhas do aro (3 pontinhos visíveis)
      let tabs = '';
      for (const a of [-60, 0, 60]) {
        const t = (a * Math.PI) / 180;
        tabs += ell(x + g * 0.7 + Math.cos(t) * prx * 0.6 * -g, G.wheelY + Math.sin(t) * (G.R - 2.6), 0.35, 0.35);
      }
      ctx.push(tabs, '#C9CFDA', { o: 0.9 });
    }
    // protetor de roupa (aba na cor) acompanhando o alto da roda, do lado do assento
    const gx = cx + g * (G.seatHW + 0.6);
    const guard = shape([
      [gx - g * 0.6, G.seatY + 1.2],
      [gx + g * 0.4, G.seatY - 4.2],
      [gx + g * 2.6, G.seatY - 5.6],
      [gx + g * 3.4, G.seatY - 4.4],
      [gx + g * 2.2, G.seatY + 1.6],
    ]);
    paintPanel(ctx, guard, { x: Math.min(gx, gx + g * 3.4), y: G.seatY - 5.6, w: 3.4, h: 7.2 }, sport ? paintOf('#2A2C33') : p, { hz: 0.5, rim: false });
  }
  if (sport) {
    // para-choque (tubo) na frente dos pés
    const by = an.foot.soleY + 0.9;
    const d = curve([
      [cx - G.plateHW - 0.8, G.plateY - 3],
      [cx - G.plateHW + 0.4, by + 0.4],
      [cx, by + 1.0],
      [cx + G.plateHW - 0.4, by + 0.4],
      [cx + G.plateHW + 0.8, G.plateY - 3],
    ]);
    frameTube(ctx, d, 1.5, p);
  }
}
