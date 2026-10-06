// Duas rodas de frente (straddle): bicicleta, moto e lambreta. Dono: veículos.
//
// Leitura em 48 px: a roda da frente no meio (escura, comprida), o guidão largo embaixo das mãos e as pernas abertas
// por cima do quadro. Cada um tem uma assinatura que sobra no tamanho de mapa:
//   bike     roda fina e alta com raios, garfo e guidão riser, farolete
//   moto     farol redondo cromado entre os garfos, tanque entre os joelhos, motor aletado e escapes cromados
//   lambreta escudo (legshield) curvo na frente das pernas, para-lama redondo, farol no guidão e as "ancas" laterais
//
// Etapas: twoBack (2, atrás das pernas: banco, tanque, motor, ancas, pedivela) e twoFront (13: roda, garfo, farol,
// guidão, escudo). As manoplas ficam onde a cena põe as palmas (vehicles-geom.barsGeom).

import type { LayerCtx } from '../ctx';
import { fmt } from '../geometry';
import { isLite, mix } from '../shading';

import { barsGeom } from './vehicles-geom';
import {
  alloyGrad,
  chromeGrad,
  contact,
  curve,
  curveArc,
  ell,
  floorShadow,
  headlamp,
  leatherGrad,
  paintOf,
  paintPanel,
  rrect,
  rubberGrad,
  shape,
  sideWheel,
  symShape,
  tireFront,
  tube,
  type SP,
} from './vehicles-kit';

type TwoId = 'bike' | 'moto' | 'lambreta';

export function twoBack(ctx: LayerCtx, id: TwoId): void {
  if (id === 'moto') motoBack(ctx);
  else if (id === 'lambreta') lambretaBack(ctx);
  else bikeBack(ctx);
}

export function twoFront(ctx: LayerCtx, id: TwoId): void {
  if (id === 'moto') motoFront(ctx);
  else if (id === 'lambreta') lambretaFront(ctx);
  else bikeFront(ctx);
}

// ---------------------------------------------------------------------------------------------------------------
// Peças comuns
// ---------------------------------------------------------------------------------------------------------------

/** manopla de borracha (com frisos no completo) centrada em (x, y), comprimento `l` */
function grip(ctx: LayerCtx, x: number, y: number, l: number, h = 2.2): void {
  const d = rrect(x - l / 2, y - h / 2, l, h, h / 2);
  ctx.push(d, '#1A1B21', { gf: rubberGrad(x, y - h / 2, x, y + h / 2) });
  if (!isLite(ctx)) {
    let r = '';
    for (let i = 1; i < 5; i++) r += `M${fmt(x - l / 2 + (l * i) / 5)},${fmt(y - h / 2 + 0.3)}v${fmt(h - 0.6)}`;
    ctx.stroke(r, '#000000', 0.25, { o: 0.5, c: 'butt', cp: d });
    ctx.stroke(`M${fmt(x - l / 2 + 0.6)},${fmt(y - h * 0.22)}H${fmt(x + l / 2 - 0.6)}`, '#6B6E7B', 0.35, { o: 0.55 });
  }
}

/** manete de freio (lâmina de alumínio que sai do guidão e desce pra frente dos dedos) */
function lever(ctx: LayerCtx, x: number, y: number, g: number, l = 5): void {
  if (isLite(ctx)) return;
  const d = curve([
    [x, y],
    [x + g * l * 0.55, y + 1.2],
    [x + g * l, y + 1.0],
  ]);
  ctx.stroke(d, '#5E6472', 0.9);
  ctx.stroke(d, '#DDE2EB', 0.45, { o: 0.9 });
}

/** banco de couro visto de frente (o nariz do selim/banco entre as coxas) */
function saddle(ctx: LayerCtx, cx: number, y: number, hw: number, h: number, color = '#24242B'): void {
  const d = shape([
    [cx - hw, y + h * 0.35],
    [cx - hw * 0.7, y - h * 0.15],
    [cx, y - h * 0.5],
    [cx + hw * 0.7, y - h * 0.15],
    [cx + hw, y + h * 0.35],
    [cx + hw * 0.6, y + h * 0.6],
    [cx - hw * 0.6, y + h * 0.6],
  ]);
  ctx.push(d, color, { gf: leatherGrad(cx - hw, y - h / 2, cx + hw * 0.6, y + h / 2, color) });
  if (!isLite(ctx)) ctx.stroke(curve([[cx - hw * 0.6, y - h * 0.18], [cx, y - h * 0.4], [cx + hw * 0.5, y - h * 0.2]]), '#FFFFFF', 0.4, { o: 0.25 });
}

/** espelho redondo cromado na ponta do guidão (fica além das mãos) */
function barEndMirror(ctx: LayerCtx, x: number, y: number, g: number, r = 2.4): void {
  const lite = isLite(ctx);
  const mx = x + g * 3.4;
  const my = y - 4.2;
  ctx.stroke(curve([[x, y], [x + g * 2.2, y - 1.2], [mx, my + r * 0.8]]), '#3E4350', 0.8);
  ctx.push(ell(mx, my, r + 0.45, r + 0.45), '#C9CFDA', { gf: chromeGrad(mx - r, my - r, mx + r, my + r) });
  ctx.push(ell(mx, my, r, r), '#8FA6C8', {
    gf: { t: 'l', x1: mx - r, y1: my - r, x2: mx + r * 0.4, y2: my + r, s: [[0, '#E8F0FF'], [0.45, '#9CB2D2'], [0.55, '#4E5F7E'], [1, '#B8C8E2']] },
  });
  if (!lite) ctx.push(ell(mx - r * 0.35, my - r * 0.4, r * 0.35, r * 0.2, -35), '#FFFFFF', { o: 0.7 });
}

// ---------------------------------------------------------------------------------------------------------------
// Bicicleta: quadro na cor, roda alta com raios, garfo, guidão riser, farolete e campainha
// ---------------------------------------------------------------------------------------------------------------

function bikeBack(ctx: LayerCtx): void {
  const { an } = ctx;
  const cx = an.cx;
  const G = barsGeom(an, 'bike');
  const p = paintOf(ctx.col.vehicle);
  const lite = isLite(ctx);
  floorShadow(ctx, cx, 134.7, 8.5, 1.9, 0.5, 1.2);
  // canote e selim no gancho (o nariz do selim aparece entre as coxas)
  const sy = an.torsoBottom + 0.4;
  ctx.stroke(`M${fmt(cx)},${fmt(sy + 1.4)}V${fmt(sy + 9)}`, '#3A3E4A', 1.6);
  saddle(ctx, cx, sy, 4.4, 3.2);
  // tubo do selim descendo até o movimento central (atrás da roda da frente) e pedivela com pedais
  const bb: [number, number] = [cx, G.wheel[1] + 5.5];
  tube(ctx, `M${fmt(cx + 0.4)},${fmt(sy + 8)}L${fmt(bb[0])},${fmt(bb[1])}`, 2.2, p.lo);
  const pedal = (x: number, y: number) => {
    ctx.push(rrect(x - 2.6, y - 0.9, 5.2, 1.8, 0.6), '#202128', { gf: rubberGrad(x, y - 0.9, x, y + 0.9) });
    if (!lite) ctx.stroke(`M${fmt(x - 2)},${fmt(y - 0.5)}H${fmt(x + 2)}`, '#8E95A6', 0.3, { o: 0.8 });
  };
  // coroa (de lado = elipse fininha) do lado direito do ciclista (esquerda da tela)
  ctx.push(ell(bb[0] - 3, bb[1], 1.1, 6.8), '#9AA1B0', { gf: chromeGrad(bb[0] - 4, bb[1] - 7, bb[0] - 2, bb[1] + 7) });
  ctx.stroke(`M${fmt(bb[0] - 3.4)},${fmt(bb[1])}L${fmt(bb[0] - 5.6)},${fmt(bb[1] - 7.2)}M${fmt(bb[0] + 3.4)},${fmt(bb[1])}L${fmt(bb[0] + 5.6)},${fmt(bb[1] + 7.2)}`, '#C3C9D5', 1.0);
  pedal(bb[0] - 7.4, bb[1] - 7.4);
  pedal(bb[0] + 7.4, bb[1] + 7.4);
}

function bikeFront(ctx: LayerCtx): void {
  const { an } = ctx;
  const cx = an.cx;
  const lite = isLite(ctx);
  const G = barsGeom(an, 'bike');
  const p = paintOf(ctx.col.vehicle);
  const [wx, wy] = G.wheel;
  const R = G.wheelR;
  const turn = 0.24;
  const crownY = wy - R - 3.2;
  // roda (esterçada um tico pra ler como roda), contato no chão
  contact(ctx, wx, 134.5, 3.4, 0.7);
  sideWheel(ctx, [wx, wy], R, { turn, spokes: 18, tire: 2.3, rim: '#D5DAE3', rimW: 0.75 });
  // para-lama na cor do quadro acompanhando o pneu
  const fender = curveArc([wx, wy], R * turn + 1.1, R + 1.2, 205, 335);
  ctx.stroke(fender, p.lo, 2.0);
  ctx.stroke(fender, p.base, 1.4, { gs: { t: 'l', x1: wx - 4, y1: wy - R, x2: wx + 4, y2: wy - R + 6, s: [[0, p.sky], [0.5, p.base], [1, p.lo]] } });
  // garfo: duas lâminas do eixo à mesa, na cor do quadro com luz à esquerda
  for (const g of [-1, 1]) {
    const d = curve([
      [wx + g * 3.1, wy],
      [wx + g * 2.9, wy - R * 0.5],
      [wx + g * 2.3, crownY + 1.2],
    ]);
    tube(ctx, d, 1.5, g < 0 ? p.base : p.lo, { hi: p.hi, shine: 0.6 });
  }
  ctx.push(ell(wx, wy, 1.1, 1.1), '#B8BFCC', { gf: chromeGrad(wx - 1.1, wy - 1.1, wx + 1.1, wy + 1.1) });
  // mesa do garfo e caixa de direção (tubo grosso na cor) até a mesa do guidão
  const ht = rrect(cx - 1.9, G.barY + 2.2, 3.8, crownY + 2 - (G.barY + 2.2), 1.4);
  paintPanel(ctx, ht, { x: cx - 1.9, y: G.barY + 2.2, w: 3.8, h: crownY - G.barY }, p, { hz: 0.5, rim: false });
  ctx.push(rrect(cx - 3.2, crownY - 0.2, 6.4, 2.4, 1.1), p.base, { gf: { t: 'l', x1: cx - 3, y1: crownY, x2: cx + 3, y2: crownY + 2.4, s: [[0, p.hi], [0.5, p.base], [1, p.deep]] } });
  // farolete na frente da caixa de direção
  const ly = crownY - 3.4;
  headlamp(ctx, ell(cx, ly, 1.9, 1.7), [cx, ly], 1.7, { glow: 0.5, housing: '#26272E' });
  // mesa (alumínio) e guidão riser
  ctx.push(rrect(cx - 1.6, G.barY - 1.0, 3.2, 3.6, 0.9), '#AEB5C2', { gf: alloyGrad(cx - 1.6, G.barY - 1, cx + 1.6, G.barY + 2.6) });
  const [gL, gR] = G.grips;
  const bar = curve([
    [gL[0] - 2.4, gL[1] - 0.3],
    [gL[0] + 3, gL[1] + 0.2],
    [cx - 6, G.barY + 0.5],
    [cx, G.barY + 0.4],
    [cx + 6, G.barY + 0.5],
    [gR[0] - 3, gR[1] + 0.2],
    [gR[0] + 2.4, gR[1] - 0.3],
  ]);
  ctx.stroke(bar, '#3D424E', 1.7);
  ctx.stroke(bar, '#C3C9D4', 1.15, { gs: alloyGrad(cx, G.barY - 0.6, cx, G.barY + 1.2, '#B7BECB') });
  if (!lite) ctx.stroke(bar, '#FFFFFF', 0.3, { o: 0.55 });
  for (const [x, y, g] of [
    [gL[0], gL[1], -1],
    [gR[0], gR[1], 1],
  ] as const) {
    grip(ctx, x + g * 0.4, y - 0.2, 5.2, 2.3);
    lever(ctx, x - g * 2.4, y - 0.4, -g, 5.2);
  }
  // campainha (cúpula cromada) do lado esquerdo da mesa
  if (!lite) ctx.push(ell(cx - 5.2, G.barY - 0.9, 1.3, 1.0), '#D0D5DF', { gf: chromeGrad(cx - 6.5, G.barY - 2, cx - 3.9, G.barY) });
}

// ---------------------------------------------------------------------------------------------------------------
// Moto (roadster clássica): tanque em gota na frente das coxas (os joelhos abraçam), motor aletado e escapes cromados
// na frente das canelas, garfos grossos, para-lama na cor, farol redondo com aro cromado e guidão largo
// ---------------------------------------------------------------------------------------------------------------

function motoBack(ctx: LayerCtx): void {
  const { an } = ctx;
  const cx = an.cx;
  const lite = isLite(ctx);
  floorShadow(ctx, cx, 134.6, 16, 2.7, 0.55, 1.6);
  // banco atrás do gancho (pesponto no completo)
  saddle(ctx, cx, an.torsoBottom + 0.4, 8.4, 3.8, '#1E1E24');
  if (!lite) ctx.stroke(curve([[cx - 7, an.torsoBottom + 1.2], [cx, an.torsoBottom + 2.4], [cx + 7, an.torsoBottom + 1.2]]), '#52535E', 0.35, { o: 0.7, da: [0.6, 0.5] });
}

function motoFront(ctx: LayerCtx): void {
  const { an } = ctx;
  const cx = an.cx;
  const lite = isLite(ctx);
  const G = barsGeom(an, 'moto');
  const p = paintOf(ctx.col.vehicle);
  const [wx, wy] = G.wheel;
  const R = G.wheelR;
  const top = wy - R;
  const tw = 9.0;
  // tanque em gota, por cima das coxas (os joelhos encostam dos lados)
  const ty = G.barY + 1.6;
  const tank = symShape(
    [
      [cx - 2.4, ty],
      [cx - 8, ty + 1.0],
      [cx - 12.2, ty + 6.4],
      [cx - 11.2, ty + 12.6],
      [cx - 6, ty + 15.4],
    ],
    cx,
  );
  paintPanel(ctx, tank, { x: cx - 12.2, y: ty, w: 24.4, h: 15.4 }, p, {
    hz: 0.56,
    spec: shape([
      [cx - 10, ty + 4.2],
      [cx - 6.4, ty + 1.8],
      [cx - 4.6, ty + 2.6],
      [cx - 8.6, ty + 8],
    ]),
    core: shape([
      [cx + 3, ty + 11],
      [cx + 13, ty + 5],
      [cx + 13, ty + 17],
      [cx + 2, ty + 17],
    ]),
  });
  // faixa dupla clássica no meio, borrachas de joelho e tampa cromada
  const sc = p.light ? p.deep : mix(p.base, '#FFFFFF', 0.85);
  ctx.push(rrect(cx - 2.6, ty, 1.6, 15.4, 0.6) + rrect(cx + 1.0, ty, 1.6, 15.4, 0.6), sc, { o: 0.9, cp: tank });
  for (const g of [-1, 1]) {
    ctx.push(ell(cx + g * 10.4, ty + 8.6, 1.7, 3.9), '#1C1D23', { o: 0.95, cp: tank });
    if (!lite) ctx.stroke(`M${fmt(cx + g * 10.4)},${fmt(ty + 5.6)}V${fmt(ty + 11.6)}`, '#3A3C45', 0.3, { cp: tank });
  }
  if (!lite) ctx.push(ell(cx - 5.4, ty + 2.0, 1.3, 0.7), '#D3D8E2', { gf: chromeGrad(cx - 6.7, ty + 1.3, cx - 4.1, ty + 2.7) });
  // motor: cilindros aletados abrindo pros lados (na frente das canelas) e cárter polido
  const ey = ty + 14.2;
  for (const g of [-1, 1]) {
    const cyl = shape([
      [cx + g * 3.4, ey + 0.8, 0.4],
      [cx + g * 12.8, ey - 0.6, 0.4],
      [cx + g * 13.6, ey + 8.8, 0.4],
      [cx + g * 4.2, ey + 9.8, 0.4],
    ]);
    ctx.push(cyl, '#8C93A2', { gf: alloyGrad(cx + g * 3.4, ey, cx + g * 13.4, ey + 9.8, '#9BA2B0') });
    let fins = '';
    for (let i = 1; i < 6; i++) fins += `M${fmt(cx + g * 4.2)},${fmt(ey + i * 1.6)}L${fmt(cx + g * 13.4)},${fmt(ey - 0.3 + i * 1.6)}`;
    ctx.stroke(fins, '#3F4450', lite ? 0.6 : 0.45, { cp: cyl, c: 'butt' });
    if (!lite) ctx.stroke(fins.replace(/,([\d.]+)L/g, (_m, y) => `,${fmt(parseFloat(y) - 0.45)}L`), '#E2E6EE', 0.25, { cp: cyl, c: 'butt', o: 0.8 });
    ctx.push(ell(cx + g * 13.2, ey + 4.4, 1.1, 2.6), '#C5CBD6', { gf: chromeGrad(cx + g * 12, ey + 1.8, cx + g * 14.3, ey + 7) });
  }
  const crank = symShape(
    [
      [cx - 3, ey + 9],
      [cx - 9, ey + 10],
      [cx - 9.4, ey + 16.8],
      [cx - 4.4, ey + 19.6],
    ],
    cx,
  );
  ctx.push(crank, '#9EA5B3', { gf: chromeGrad(cx - 9.4, ey + 9, cx - 9.4, ey + 19.6) });
  // escapes cromados descendo pros lados
  for (const g of [-1, 1]) {
    const d = curve([
      [cx + g * 7.4, ey + 7.6],
      [cx + g * 9, ey + 13],
      [cx + g * 8.2, 124],
      [cx + g * 10.6, 129],
    ]);
    ctx.stroke(d, '#4A4F5C', 2.4);
    ctx.stroke(d, '#DCE1EA', 1.6, { gs: chromeGrad(cx + g * 6, ey + 7, cx + g * 11, 129) });
    if (!lite) ctx.stroke(d, '#FFFFFF', 0.4, { o: 0.75 });
  }
  // pneu largo (banda de rodagem de frente) e contato
  contact(ctx, wx, 134.5, 6, 0.85);
  tireFront(ctx, wx - tw / 2, top + 4, tw, 134 - top - 4, { grooves: 9 });
  // garfos: bengalas cromadas + botas de alumínio, do eixo à mesa de baixo
  const clampY = G.barY + 5.8;
  const fx = tw / 2 + 2.2;
  for (const g of [-1, 1]) {
    const x = wx + g * fx;
    ctx.push(rrect(x - 1.25, clampY, 2.5, wy - clampY - 6, 1.1), '#D7DCE6', { gf: chromeGrad(x - 1.25, clampY, x + 1.25, clampY + 4) });
    ctx.push(rrect(x - 1.75, wy - 9.5, 3.5, 10.8, 1.4), '#9AA1AF', { gf: alloyGrad(x - 1.75, wy - 9.5, x + 1.75, wy + 1.3, '#A3AAB8') });
  }
  ctx.stroke(`M${fmt(wx - fx)},${fmt(wy)}H${fmt(wx + fx)}`, '#5C6270', 1.1);
  ctx.push(ell(wx, wy, 1.2, 1.2), '#C9CFDA', { gf: chromeGrad(wx - 1.2, wy - 1.2, wx + 1.2, wy + 1.2) });
  // para-lama na cor (abraça o pneu)
  const fy = top + 2.6;
  const fw = tw / 2 + 1.3;
  const fender = shape([
    [wx - fw + 0.1, fy + 10, 0.4],
    [wx - fw, fy + 2.6],
    [wx - fw * 0.5, fy - 0.3],
    [wx + fw * 0.5, fy - 0.3],
    [wx + fw, fy + 2.6],
    [wx + fw - 0.1, fy + 10, 0.4],
    [wx + fw - 1.1, fy + 10.4],
    [wx + fw - 1.5, fy + 3.4],
    [wx - fw + 1.5, fy + 3.4],
    [wx - fw + 1.1, fy + 10.4],
  ]);
  paintPanel(ctx, fender, { x: wx - fw, y: fy - 0.3, w: 2 * fw, h: 10.7 }, p, { hz: 0.42, spec: ell(wx - 2.4, fy + 1.2, 2, 0.6, -10), rim: false });
  // mesas (alumínio)
  ctx.push(rrect(cx - fx - 2, clampY - 1.3, 2 * fx + 4, 2.8, 1.2), '#A9B0BE', { gf: alloyGrad(cx - fx - 2, clampY - 1.3, cx + fx + 2, clampY + 1.5) });
  ctx.push(rrect(cx - fx - 1.4, G.barY + 1.2, 2 * fx + 2.8, 2.3, 1.0), '#B5BCC9', { gf: alloyGrad(cx - fx - 1.4, G.barY + 1.2, cx + fx + 1.4, G.barY + 3.5) });
  // farol redondo: concha na cor, aro cromado, refletor e lente
  const ly = clampY + 5.2;
  const lr = 5.8;
  const shell = ell(cx, ly + 0.6, lr + 1.4, lr + 1.2);
  paintPanel(ctx, shell, { x: cx - lr - 1.4, y: ly - lr, w: 2 * lr + 2.8, h: 2 * lr + 2.2 }, p, { hz: 0.62, rim: false });
  ctx.push(ell(cx, ly, lr + 0.6, lr + 0.6), '#CCD2DD', { gf: chromeGrad(cx - lr, ly - lr, cx + lr * 0.6, ly + lr) });
  headlamp(ctx, ell(cx, ly, lr - 0.3, lr - 0.3), [cx, ly], lr - 0.3, { glow: 0.55, housing: '#2D313C' });
  if (!lite) {
    ctx.push(ell(cx - 2, ly - 2.2, 1.7, 1.0, -30), '#FFFFFF', { o: 0.8 });
    ctx.stroke(`M${fmt(cx - lr + 1.4)},${fmt(ly + 1.3)}H${fmt(cx + lr - 1.4)}`, '#FFFFFF', 0.25, { o: 0.35 });
  }
  // piscas âmbar em hastes
  for (const g of [-1, 1]) {
    const x = cx + g * (lr + 5.4);
    ctx.stroke(`M${fmt(cx + g * (lr + 1))},${fmt(ly - 0.6)}L${fmt(x - g * 1.4)},${fmt(ly - 0.8)}`, '#2B2D35', 1.0);
    ctx.push(ell(x, ly - 0.8, 1.7, 1.3), '#F29A2E', { gf: { t: 'r', cx: x - 0.4, cy: ly - 1.2, r: 1.9, s: [[0, '#FFE1A6'], [0.6, '#F29A2E'], [1, '#A85A10']] } });
  }
  // painel: dois relógios redondos em cima da mesa
  for (const g of [-1, 1]) {
    const x = cx + g * 2.8;
    const y = G.barY - 0.8;
    ctx.push(ell(x, y, 2.2, 2.1), '#C9CFDA', { gf: chromeGrad(x - 2.2, y - 2.1, x + 2.2, y + 2.1) });
    ctx.push(ell(x, y, 1.7, 1.6), '#14161C');
    if (!lite) ctx.stroke(`M${fmt(x)},${fmt(y)}L${fmt(x - g * 1.0)},${fmt(y - 0.9)}`, '#FF5A3C', 0.3);
  }
  // guidão cromado largo com manoplas, manetes e espelhos na ponta
  const [gL, gR] = G.grips;
  const bar = curve([
    [gL[0] - 2.6, gL[1] - 0.2],
    [gL[0] + 3.6, gL[1] - 0.1],
    [cx - 5, G.barY + 0.6],
    [cx + 5, G.barY + 0.6],
    [gR[0] - 3.6, gR[1] - 0.1],
    [gR[0] + 2.6, gR[1] - 0.2],
  ]);
  ctx.stroke(bar, '#4A4F5C', 1.9);
  ctx.stroke(bar, '#DCE1EA', 1.3, { gs: chromeGrad(cx, G.barY - 0.6, cx, G.barY + 1.6) });
  if (!lite) ctx.stroke(bar, '#FFFFFF', 0.3, { o: 0.7 });
  for (const [x, y, g] of [
    [gL[0], gL[1], -1],
    [gR[0], gR[1], 1],
  ] as const) {
    grip(ctx, x + g * 0.6, y - 0.1, 5.6, 2.5);
    lever(ctx, x - g * 2.8, y - 0.3, -g, 5.6);
    barEndMirror(ctx, x + g * 3.4, y - 0.2, g, 2.3);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Lambreta: escudo curvo na frente das pernas, gravata cromada, para-lama redondo, farol no guidão e ancas laterais
// ---------------------------------------------------------------------------------------------------------------

/** creme do bicolor (frisos e banco) que combina com qualquer tinta */
const CREAM = '#F1E7D2';

function lambretaBack(ctx: LayerCtx): void {
  const { an } = ctx;
  const cx = an.cx;
  const G = barsGeom(an, 'lambreta');
  const p = paintOf(ctx.col.vehicle);
  const lite = isLite(ctx);
  floorShadow(ctx, cx, 134.6, 16, 2.6, 0.52, 1.6);
  // banco atrás do gancho (marrom com vivo creme)
  saddle(ctx, cx, an.torsoBottom + 0.8, 8, 3.8, '#5A3A26');
  // ancas laterais (carenagem de trás) aparecendo dos dois lados das pernas
  const y0 = G.barY + 19;
  for (const g of [-1, 1]) {
    const d = shape([
      [cx + g * 9, y0],
      [cx + g * 15.4, y0 + 3],
      [cx + g * 18.2, y0 + 12],
      [cx + g * 17.2, 126.5],
      [cx + g * 12, 128.2],
      [cx + g * 9, 126],
    ]);
    paintPanel(ctx, d, { x: cx + Math.min(g * 9, g * 18.2), y: y0, w: 9.2, h: 128.2 - y0 }, p, {
      hz: 0.5,
      spec: g < 0 ? ell(cx - 14.6, y0 + 7, 1.4, 3.4, 15) : null,
      core: g > 0 ? ell(cx + 17, y0 + 15, 3, 10) : ell(cx - 11, y0 + 18, 2.6, 8),
    });
    if (!lite) {
      // grelha de ventilação (frisos) na anca
      let v = '';
      for (let i = 0; i < 4; i++) v += `M${fmt(cx + g * 13.6)},${fmt(y0 + 13 + i * 1.6)}h${fmt(g * 3)}`;
      ctx.stroke(v, p.deep, 0.5, { o: 0.6, c: 'butt' });
    }
  }
  // assoalho com estrias de borracha (entre os pés, atrás do escudo)
  ctx.push(rrect(cx - 12, 126.2, 24, 2.6, 1.0), '#2A2B31', { gf: rubberGrad(cx, 126.2, cx, 128.8) });
  ctx.stroke(`M${fmt(cx - 12)},${fmt(126.4)}H${fmt(cx + 12)}`, CREAM, 0.45, { o: 0.8 });
}

function lambretaFront(ctx: LayerCtx): void {
  const { an } = ctx;
  const cx = an.cx;
  const lite = isLite(ctx);
  const G = barsGeom(an, 'lambreta');
  const p = paintOf(ctx.col.vehicle);
  const [wx, wy] = G.wheel;
  const R = G.wheelR;
  // pneu pequeno e contato
  contact(ctx, wx, 134.5, 3.6, 0.7);
  tireFront(ctx, wx - 2.9, wy - R + 2.5, 5.8, 134 - (wy - R + 2.5), { grooves: 5 });
  // para-lama redondo (capacete) na cor, com friso cromado
  const fy = wy - R - 1.6;
  const fender = shape([
    [wx - 5.6, fy + 9.4, 0.3],
    [wx - 5.8, fy + 3.6],
    [wx - 3.2, fy],
    [wx + 3.2, fy],
    [wx + 5.8, fy + 3.6],
    [wx + 5.6, fy + 9.4, 0.3],
    [wx + 4.0, fy + 9.6],
    [wx + 3.8, fy + 5],
    [wx - 3.8, fy + 5],
    [wx - 4.0, fy + 9.6],
  ]);
  paintPanel(ctx, fender, { x: wx - 5.8, y: fy, w: 11.6, h: 9.6 }, p, { hz: 0.4, spec: ell(wx - 2.4, fy + 1.6, 1.8, 0.7, -12), rim: false });
  if (!lite) ctx.stroke(`M${fmt(wx)},${fmt(fy + 0.2)}V${fmt(fy + 4.8)}`, '#E2E7F0', 0.5, { o: 0.9 });
  // coluna de direção curta entre o guidão e o escudo
  const shTop = G.barY + 7.4;
  ctx.push(rrect(cx - 1.6, G.barY + 2, 3.2, shTop - G.barY, 1), '#2C2E36', { gf: { t: 'l', x1: cx - 1.6, y1: 0, x2: cx + 1.6, y2: 0, s: [[0, '#555A66'], [1, '#1C1D23']] } });
  // escudo (legshield): sobe estreito, abre embaixo, com vinco central
  const sb = fy + 2.2;
  const half: SP[] = [
    [cx - 3, shTop - 0.4],
    [cx - 9.6, shTop + 0.6],
    [cx - 12.2, shTop + 10],
    [cx - 13.8, sb - 3],
    [cx - 12.6, sb + 0.8, 0.5],
    [cx - 6.4, sb + 0.2],
  ];
  const shield = symShape(half, cx);
  paintPanel(ctx, shield, { x: cx - 13.8, y: shTop - 0.4, w: 27.6, h: sb - shTop + 1.2 }, p, {
    hz: 0.38,
    spec: shape([
      [cx - 11.2, shTop + 3],
      [cx - 8.4, shTop + 1.6],
      [cx - 7.8, shTop + 3.2],
      [cx - 10.6, shTop + 13],
    ]),
    core: shape([
      [cx + 6, shTop + 4],
      [cx + 14, shTop + 3],
      [cx + 14, sb + 1],
      [cx + 5, sb + 1],
    ]),
  });
  if (!lite) {
    // vinco central (luz à esquerda, sombra à direita) e friso cromado na borda
    ctx.stroke(`M${fmt(cx - 0.3)},${fmt(shTop + 11)}L${fmt(cx - 0.3)},${fmt(sb)}`, p.hi, 0.5, { o: 0.5, cp: shield });
    ctx.stroke(`M${fmt(cx + 0.4)},${fmt(shTop + 11)}L${fmt(cx + 0.4)},${fmt(sb)}`, p.deep, 0.6, { o: 0.45, cp: shield });
    ctx.stroke(curve(half.slice(1, 5).map((q) => [q[0], q[1]] as SP)), '#E4E8F0', 0.45, { o: 0.85 });
    ctx.stroke(curve(half.slice(1, 5).map((q) => [2 * cx - q[0], q[1]] as SP)), '#E4E8F0', 0.45, { o: 0.85 });
  }
  // gravata (grade da buzina) cromada no alto do escudo
  const ty = shTop + 1.2;
  const tie = shape([
    [cx - 2.8, ty, 0.3],
    [cx + 2.8, ty, 0.3],
    [cx + 2.2, ty + 6],
    [cx, ty + 10.4, 0],
    [cx - 2.2, ty + 6],
  ]);
  ctx.push(tie, '#C9CFDA', { gf: chromeGrad(cx - 2.8, ty, cx + 2.8, ty + 10.4) });
  if (!lite) {
    let sl = '';
    for (let i = 0; i < 5; i++) sl += `M${fmt(cx - 1.9 + i * 0.1)},${fmt(ty + 1.4 + i * 1.6)}H${fmt(cx + 1.9 - i * 0.1)}`;
    ctx.stroke(sl, '#3B404C', 0.5, { cp: tie, c: 'butt' });
  }
  // guidão carenado (na cor) com farol redondo no meio
  const hy = G.barY;
  const head = symShape(
    [
      [cx - 3, hy - 3.6],
      [cx - 8.4, hy - 3.2],
      [cx - 12.6, hy - 0.4],
      [cx - 12.4, hy + 1.8],
      [cx - 7, hy + 3.6],
    ],
    cx,
  );
  paintPanel(ctx, head, { x: cx - 12.6, y: hy - 3.6, w: 25.2, h: 7.2 }, p, { hz: 0.62, spec: ell(cx - 7.6, hy - 1.6, 2.4, 0.6, -6) });
  ctx.push(ell(cx, hy - 0.2, 3.5, 3.3), '#CCD2DD', { gf: chromeGrad(cx - 3.5, hy - 3.5, cx + 2, hy + 3) });
  headlamp(ctx, ell(cx, hy - 0.2, 2.8, 2.6), [cx, hy - 0.2], 2.6, { glow: 0.5, housing: '#2D313C' });
  if (!lite) ctx.push(ell(cx - 1, hy - 1.2, 0.9, 0.55, -30), '#FFFFFF', { o: 0.8 });
  const [gL, gR] = G.grips;
  for (const [x, y, g] of [
    [gL[0], gL[1], -1],
    [gR[0], gR[1], 1],
  ] as const) {
    ctx.stroke(`M${fmt(cx + g * 12.2)},${fmt(y)}H${fmt(x - g * 2)}`, '#B9C0CC', 1.2);
    grip(ctx, x + g * 0.4, y, 5.4, 2.4);
    lever(ctx, x - g * 2.6, y - 0.4, -g, 5);
    barEndMirror(ctx, x + g * 3.2, y - 0.1, g, 2.2);
  }
}

