// Carros de frente (cover): conversível, retrô, jipe e esportivo neon. Dono: veículos.
//
// Leitura: o carro ocupa da cintura pra baixo; a pessoa aparece atrás do para-brisa com as mãos no volante. O que faz
// cada um ser reconhecível em 48 px: faróis claros nos cantos, grade escura no meio, pneus pretos embaixo e a lataria
// colorida com reflexo de céu no capô. Detalhe fino (tela da grade, sulco do pneu, costura do banco) só no completo.
//
// Etapas: carBack (2: sombra no chão, assentos, deque traseiro, santantônio) e carFront (13: painel, volante, vidro,
// moldura, capô, frente, pneus, retrovisores). O volante e as mãos vêm de vehicles-geom.carGeom (a cena leva a palma
// até o aro). O pet passageiro (pets.ts) senta à direita da tela, atrás do painel.

import type { LayerCtx } from '../ctx';
import { fmt, shade } from '../geometry';
import { isLite, mix } from '../shading';
import type { Pt } from '../types';

import { carGeom, type CarGeom } from './vehicles-geom';
import {
  chromeGrad,
  contact,
  curve,
  ell,
  floorShadow,
  glassPane,
  glowGrad,
  headlamp,
  leatherGrad,
  neonLine,
  paintOf,
  paintPanel,
  rrect,
  rubberGrad,
  shape,
  symShape,
  tireFront,
  tube,
  type Paint,
  type SP,
} from './vehicles-kit';

type CarId = 'car' | 'classic' | 'jeep' | 'sport';

interface CarStyle {
  /** meia-largura máxima da lataria */
  half: number;
  /** pneus: meia-distância do centro do pneu ao eixo, largura e topo */
  tireX: number;
  tireW: number;
  tireTop: number;
  /** base da lataria (para-choque) */
  bottom: number;
  /** cor do banco */
  seat: string;
  /** acabamento da moldura do para-brisa */
  frame: 'dark' | 'chrome' | 'body';
}

const STYLE: Record<CarId, CarStyle> = {
  car: { half: 45, tireX: 37.5, tireW: 12.5, tireTop: 110.5, bottom: 125.5, seat: '#2A2A31', frame: 'dark' },
  classic: { half: 44, tireX: 36.5, tireW: 11.5, tireTop: 112, bottom: 123.5, seat: '#E8DCC2', frame: 'chrome' },
  jeep: { half: 43, tireX: 35.5, tireW: 15.5, tireTop: 108, bottom: 122.5, seat: '#3A3328', frame: 'dark' },
  sport: { half: 47, tireX: 38.5, tireW: 14, tireTop: 114, bottom: 127.5, seat: '#1E1E24', frame: 'body' },
};

function styleOf(id: string): CarStyle {
  return (STYLE as Record<string, CarStyle>)[id] ?? STYLE.car;
}

/** cor de destaque do esportivo (neon que contrasta com a lataria) */
function neonOf(body: string): string {
  const b = body.toUpperCase();
  if (b === '#7FFF00' || b === '#3BAF6E' || b === '#6E7A3B') return '#FF1493';
  return '#7FFF00';
}

// ---------------------------------------------------------------------------------------------------------------
// 2. trás: sombra, assentos e o que fica atrás da pessoa
// ---------------------------------------------------------------------------------------------------------------

export function carBack(ctx: LayerCtx, id: CarId): void {
  const { an } = ctx;
  const lite = isLite(ctx);
  const cx = an.cx;
  const G = carGeom(an, id);
  const S = styleOf(id);
  const p = paintOf(ctx.col.vehicle);
  // sombra no chão (larga, embaixo da carroceria) e o escuro embaixo do para-choque
  floorShadow(ctx, cx, 134.4, S.half + 2, 3.2, 0.5, 1.8);
  if (id === 'sport') {
    // luz de baixo (underglow) no chão
    const n = neonOf(ctx.col.vehicle);
    ctx.push(ell(cx, 133.6, S.half - 2, 3.6), n, { gf: glowGrad(cx, 133.6, S.half - 2, n, 0.55), g: 'shadow' });
  }
  // deque traseiro (atrás dos bancos): a lataria que aparece pelo para-brisa e dos lados do tronco
  const deckY = G.dash - 9.5;
  const deck = shape([
    [cx - G.half + 7, G.dash + 0.5, 0],
    [cx - G.half + 9, deckY + 2],
    [cx - 20, deckY],
    [cx + 20, deckY],
    [cx + G.half - 9, deckY + 2],
    [cx + G.half - 7, G.dash + 0.5, 0],
  ]);
  ctx.push(deck, p.lo, { gf: { t: 'l', x1: cx, y1: deckY, x2: cx, y2: G.dash, s: [[0, mix(p.base, p.sky, 0.25)], [0.4, p.lo], [1, p.deep]] } });
  // bancos: o do motorista atrás do tronco (as abas aparecem dos lados) e o do passageiro à direita da tela
  const seatTop = Math.min(G.top - 7, an.shoulderY + 6);
  seat(ctx, cx, 15.5, seatTop, G.dash + 0.5, S.seat, lite, id === 'classic');
  seat(ctx, cx + 27, 10.5, seatTop + 3, G.dash + 0.5, S.seat, lite, id === 'classic');
  if (id === 'jeep') {
    // santantônio (arco de proteção) atrás dos bancos
    const rb: SP[] = [
      [cx - 33, G.dash - 1],
      [cx - 32, an.shoulderY - 2],
      [cx - 26, an.shoulderY - 9],
      [cx + 26, an.shoulderY - 9],
      [cx + 32, an.shoulderY - 2],
      [cx + 33, G.dash - 1],
    ];
    tube(ctx, curve(rb), 2.2, '#2A2C33', { hi: '#8D94A6' });
  }
}

/** encosto + apoio de cabeça (couro) centrado em x */
function seat(ctx: LayerCtx, x: number, hw: number, top: number, bottom: number, color: string, lite: boolean, bench: boolean): void {
  const back = shape([
    [x - hw, bottom, 0],
    [x - hw - 0.6, top + 8],
    [x - hw + 1.5, top + 1.2],
    [x, top - 0.4],
    [x + hw - 1.5, top + 1.2],
    [x + hw + 0.6, top + 8],
    [x + hw, bottom, 0],
  ]);
  ctx.push(back, color, { gf: leatherGrad(x - hw, top, x + hw, bottom, color) });
  if (!lite) {
    // gomos do estofado (vincos verticais) e a borda de luz em cima
    const k = bench ? 4 : 3;
    let v = '';
    for (let i = 1; i < k; i++) {
      const xx = x - hw + (2 * hw * i) / k;
      v += `M${fmt(xx)},${fmt(top + 2.5)}V${fmt(bottom - 1)}`;
    }
    ctx.stroke(v, shade(color, -0.3), 0.45, { o: 0.55, cp: back });
    ctx.stroke(curve([[x - hw + 1.5, top + 1.9], [x, top + 0.7], [x + hw - 1.5, top + 1.9]]), shade(color, 0.35), 0.6, { o: 0.5, cp: back });
  }
  if (!bench) {
    // apoio de cabeça
    const hy = top - 6.2;
    const hr = ell(x, hy, Math.min(6.2, hw * 0.45), 3.6);
    ctx.stroke(`M${fmt(x - 1.6)},${fmt(hy + 2.5)}V${fmt(top + 0.5)}M${fmt(x + 1.6)},${fmt(hy + 2.5)}V${fmt(top + 0.5)}`, '#8B92A2', 0.55);
    ctx.push(hr, color, { gf: leatherGrad(x - 6, hy - 3.6, x + 6, hy + 3.6, color) });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// 13. frente
// ---------------------------------------------------------------------------------------------------------------

export function carFront(ctx: LayerCtx, id: CarId): void {
  const { an } = ctx;
  const cx = an.cx;
  const G = carGeom(an, id);
  const S = styleOf(id);
  const p = paintOf(ctx.col.vehicle);
  const lite = isLite(ctx);

  // painel (interior) e volante, vistos pelo para-brisa
  dashAndWheel(ctx, G, id);
  // vidro e moldura
  windshield(ctx, G, S, p, id);
  // pneus (atrás da lataria: o para-lama cobre o topo)
  for (const g of [-1, 1]) {
    const x = cx + g * S.tireX - S.tireW / 2;
    tireFront(ctx, x, S.tireTop, S.tireW, 134 - S.tireTop, { grooves: id === 'jeep' ? 6 : 8 });
    if (id === 'jeep' && !lite) {
      // cravos do pneu de trilha (blocos alternados nas bordas)
      let blk = '';
      for (let i = 0; i < 6; i++) {
        const yy = S.tireTop + 2 + i * ((134 - S.tireTop - 4) / 6);
        const xl = i % 2 ? x + 0.6 : x + 1.4;
        blk += rrect(xl, yy, 2.6, 1.6, 0.5) + rrect(x + S.tireW - 3.2 - (i % 2 ? 0 : 0.8), yy + 1.2, 2.6, 1.6, 0.5);
      }
      ctx.push(blk, '#3E404B', { o: 0.75 });
    }
    contact(ctx, cx + g * S.tireX, 134.3, S.tireW * 0.55, 0.9);
  }
  switch (id) {
    case 'classic':
      classicBody(ctx, G, S, p);
      break;
    case 'jeep':
      jeepBody(ctx, G, S, p);
      break;
    case 'sport':
      sportBody(ctx, G, S, p);
      break;
    default:
      convertibleBody(ctx, G, S, p);
  }
}

/** painel, coluna e volante (o aro passa onde a cena põe as palmas) */
function dashAndWheel(ctx: LayerCtx, G: CarGeom, id: CarId): void {
  const { an } = ctx;
  const cx = an.cx;
  const lite = isLite(ctx);
  const [wx, wy] = G.wheel;
  const rx = G.wheelR;
  const ry = G.wheelR * 0.76;
  const rimC = id === 'classic' ? '#EFE6D2' : '#22232A';
  // coluna de direção
  ctx.stroke(`M${fmt(wx)},${fmt(wy + 1)}L${fmt(wx)},${fmt(G.dash)}`, '#15161B', 2.4);
  // aro (anel) com luz no arco de cima à esquerda
  const ring = ell(wx, wy, rx + 0.8, ry + 0.8) + ell(wx, wy, rx - 0.8, ry - 0.8);
  ctx.push(ring, rimC, { r: 'evenodd', gf: leatherGrad(wx - rx, wy - ry, wx + rx, wy + ry, rimC) });
  // raios e cubo
  const spokeC = id === 'classic' ? '#C9CFDA' : '#3A3C46';
  ctx.stroke(`M${fmt(wx - rx + 1)},${fmt(wy + 0.6)}L${fmt(wx)},${fmt(wy + 1.2)}L${fmt(wx + rx - 1)},${fmt(wy + 0.6)}M${fmt(wx)},${fmt(wy + 1.2)}L${fmt(wx)},${fmt(wy + ry - 0.6)}`, spokeC, 1.1);
  ctx.push(ell(wx, wy + 1.1, 2.3, 1.7), '#2A2B33', { gf: { t: 'r', cx: wx - 0.6, cy: wy + 0.4, r: 2.6, s: [[0, '#5B5F6C'], [1, '#17181E']] } });
  if (!lite) {
    ctx.push(ell(wx, wy + 1.0, 0.8, 0.6), '#C9CFDA', { gf: chromeGrad(wx - 0.8, wy + 0.4, wx + 0.8, wy + 1.6) });
    ctx.stroke(`M${fmt(wx - rx * 0.86)},${fmt(wy - ry * 0.35)}Q${fmt(wx - rx * 0.4)},${fmt(wy - ry * 1.05)} ${fmt(wx + rx * 0.2)},${fmt(wy - ry * 0.98)}`, '#FFFFFF', 0.45, { o: id === 'classic' ? 0.6 : 0.3 });
  }
  // tampa do painel (cobre a base do aro e o tronco abaixo dela) com o capuz do quadro de instrumentos
  const dTop = G.dash - 2.6;
  const dash = shape([
    [cx - 33.5, G.dash + 0.6, 0],
    [cx - 32.5, dTop + 0.4],
    [cx - 9, dTop],
    [cx - 6.5, dTop - 1.4],
    [cx + 6.5, dTop - 1.4],
    [cx + 9, dTop],
    [cx + 32.5, dTop + 0.4],
    [cx + 33.5, G.dash + 0.6, 0],
  ]);
  const dc = id === 'classic' ? mix(paintOf(ctx.col.vehicle).base, '#2A2420', 0.35) : '#1D1E25';
  ctx.push(dash, dc, { gf: { t: 'l', x1: cx, y1: dTop - 1.4, x2: cx, y2: G.dash, s: [[0, shade(dc, 0.28)], [0.35, dc], [1, shade(dc, -0.4)]] } });
  if (!lite) ctx.stroke(curve([[cx - 32, dTop + 0.6], [cx - 9, dTop + 0.2], [cx - 6.5, dTop - 1.1], [cx + 6.5, dTop - 1.1], [cx + 9, dTop + 0.2], [cx + 32, dTop + 0.6]]), '#FFFFFF', 0.4, { o: 0.22 });
}

/** para-brisa: vidro bem leve (os antebraços passam por cima) e moldura */
function windshield(ctx: LayerCtx, G: CarGeom, S: CarStyle, p: Paint, id: CarId): void {
  const { an } = ctx;
  const cx = an.cx;
  const lite = isLite(ctx);
  const b = G.dash + 0.3;
  const t = G.top;
  const wb = id === 'jeep' ? 31.5 : id === 'sport' ? 35 : 33.5;
  const wt = id === 'jeep' ? 31 : id === 'sport' ? 27 : id === 'classic' ? 29.5 : 29;
  const bow = id === 'jeep' ? 0 : id === 'sport' ? 2.2 : 1.1;
  const pts: SP[] = [
    [cx - wb, b, 0],
    [cx - wt, t + 1.2],
    [cx - wt + 1.6, t, 0.6],
    [cx, t - bow],
    [cx + wt - 1.6, t, 0.6],
    [cx + wt, t + 1.2],
    [cx + wb, b, 0],
  ];
  const glass = shape(pts);
  glassPane(ctx, glass, { x: cx - wb, y: t - bow, w: wb * 2, h: b - t + bow }, { o: lite ? 0.35 : 0.42, streaks: [[0.015, 0.06], [0.1, 0.018], [0.86, 0.03]] });
  // moldura (sem a base: a base é o capô)
  const frame = curve(pts.slice(0, 7).map((q) => [q[0], q[1]] as SP));
  const fc = S.frame === 'chrome' ? '#C9CFDA' : S.frame === 'body' ? p.base : '#1E2027';
  if (S.frame === 'chrome') {
    ctx.stroke(frame, '#5A606E', 1.7);
    ctx.stroke(frame, '#D9DEE8', 1.15, { gs: chromeGrad(cx, t - 2, cx, b) });
  } else {
    ctx.stroke(frame, shade(fc, -0.4), id === 'jeep' ? 2.4 : 1.7);
    ctx.stroke(frame, fc, id === 'jeep' ? 1.8 : 1.2);
    if (!lite) ctx.stroke(frame, '#FFFFFF', 0.3, { o: 0.25 });
  }
  if (id === 'classic' && !lite) {
    // para-brisa bipartido (coluna central cromada)
    ctx.stroke(`M${fmt(cx)},${fmt(t - bow + 0.4)}L${fmt(cx)},${fmt(b - 0.6)}`, '#C9CFDA', 0.7, { o: 0.9 });
  }
  if (id === 'jeep') {
    // barra de luz no alto da moldura
    const ly = t - 2.6;
    ctx.push(rrect(cx - 15, ly - 1.4, 30, 2.8, 1), '#1A1B21');
    let leds = '';
    for (let i = 0; i < 6; i++) leds += ell(cx - 12.5 + i * 5, ly, 1.7, 0.9);
    ctx.push(leds, '#FFF8E2', { gf: { t: 'l', x1: cx, y1: ly - 1, x2: cx, y2: ly + 1, s: [[0, '#FFFFFF'], [1, '#E8DDB8']] } });
    ctx.stroke(`M${fmt(cx - 13)},${fmt(ly + 1.4)}L${fmt(cx - 15)},${fmt(t + 0.6)}M${fmt(cx + 13)},${fmt(ly + 1.4)}L${fmt(cx + 15)},${fmt(t + 0.6)}`, '#1A1B21', 0.8);
  }
  // retrovisores
  for (const g of [-1, 1]) {
    const bx = cx + g * (wb - 0.6);
    const by = b - 2.2;
    const mx = cx + g * Math.min(S.half + 1.2, 45.2);
    const my = b - 4.5;
    ctx.stroke(`M${fmt(bx)},${fmt(by)}Q${fmt((bx + mx) / 2)},${fmt(by - 0.4)} ${fmt(mx - g * 2.6)},${fmt(my + 0.6)}`, '#202128', 1.1);
    const m = shape([
      [mx - g * 3.4, my - 1.8],
      [mx + g * 1.6, my - 2.2],
      [mx + g * 2.9, my],
      [mx + g * 1.8, my + 2.0],
      [mx - g * 3.2, my + 1.7],
    ]);
    paintPanel(ctx, m, { x: mx - 3.4, y: my - 2.2, w: 6.3, h: 4.2 }, id === 'jeep' ? paintOf('#1E1F25') : p, { hz: 0.55, rim: false });
  }
}

// ----- carrocerias ----------------------------------------------------------------------------------------------

interface BodyShape {
  outline: SP[];
  hood: SP[];
}

/** contorno da lataria (metade esquerda espelhada) com as caixas de roda em cima dos pneus */
function bodyOutline(cx: number, G: CarGeom, S: CarStyle, k: { fender: number; shoulder: number; arch: number; chin: number; cowl: number }): SP[] {
  const h = S.half;
  const tx = S.tireX;
  const tw = S.tireW;
  return [
    [cx - 10, G.dash - 0.4],
    [cx - 31, G.dash - 0.2 + k.cowl],
    [cx - h + 6, G.dash + 0.9 - k.fender],
    [cx - h + 1.6, G.dash + 4.2 - k.fender * 0.6],
    [cx - h, G.dash + 9.5],
    [cx - h - 0.3, G.nose + 6],
    [cx - h + 0.2, S.tireTop + 0.6 - k.shoulder],
    [cx - tx - tw / 2 - 0.4, S.tireTop + 0.4, 0],
    [cx - tx, S.tireTop - k.arch],
    [cx - tx + tw / 2 + 0.6, S.tireTop + 0.6, 0],
    [cx - tx + tw / 2 + 1.0, S.bottom - 6],
    [cx - tx + tw / 2 + 2.6, S.bottom - 1.2],
    [cx - 18, S.bottom - k.chin],
    [cx - 6, S.bottom],
  ];
}

function hoodOutline(cx: number, G: CarGeom, S: CarStyle, k: { fender: number; cowl: number; edge: number; mid: number }): SP[] {
  const h = S.half;
  return [
    [cx - 10, G.dash - 0.1],
    [cx - 31, G.dash + 0.1 + k.cowl],
    [cx - h + 6, G.dash + 1.2 - k.fender],
    [cx - h + 1.8, G.dash + 4.4 - k.fender * 0.6],
    [cx - h + 0.6, G.dash + 8.6],
    [cx - h + 6, G.nose - 0.4 + k.edge],
    [cx - 22, G.nose + k.mid * 0.5],
    [cx - 7, G.nose + k.mid],
  ];
}

/** pinta a lataria inteira + capô (plano de cima, reflexo de céu) + volume lateral */
function paintBody(ctx: LayerCtx, cx: number, G: CarGeom, S: CarStyle, p: Paint, B: BodyShape): { body: string; hood: string } {
  const lite = isLite(ctx);
  const body = symShape(B.outline, cx);
  const hood = symShape(B.hood, cx);
  const y0 = G.dash - 1;
  // frente: horizonte escuro logo abaixo da borda do capô, chão claro embaixo
  const hz = Math.min(0.5, Math.max(0.12, (G.nose + 3.5 - y0) / (S.bottom - y0)));
  paintPanel(ctx, body, { x: cx - S.half, y: y0, w: S.half * 2, h: S.bottom - y0 }, p, {
    hz,
    core: shape([
      [cx + S.half - 9, G.nose],
      [cx + S.half + 2, G.nose - 2],
      [cx + S.half + 2, S.bottom],
      [cx + S.half - 12, S.bottom],
    ]),
    rim: false,
  });
  // capô: plano de cima, recebe o céu (mais claro) e o especular
  ctx.push(hood, p.sky, {
    gf: { t: 'l', x1: cx - S.half * 0.6, y1: G.dash, x2: cx + S.half * 0.5, y2: G.nose + 1, s: [[0, mix(p.sky, '#FFFFFF', p.dark ? 0.08 : 0.2)], [0.5, p.sky], [1, mix(p.sky, p.base, 0.55)]] },
  });
  // reflexo do para-brisa no capô (faixa escura macia logo à frente do vidro)
  ctx.push(shape([[cx - 30, G.dash + 0.3], [cx + 30, G.dash + 0.3], [cx + 27, G.dash + 2.6], [cx - 27, G.dash + 2.6]]), p.horizon, { o: 0.45, cp: hood, b: lite ? undefined : 0.6 });
  if (!lite) {
    // lâmina de especular no capô (alto à esquerda) e brilho na quina do para-lama
    ctx.push(shape([[cx - S.half + 9, G.dash + 5.2], [cx - 18, G.dash + 3.6], [cx - 4, G.dash + 4.2], [cx - 17, G.dash + 5.6]]), p.spec, { o: p.dark ? 0.42 : 0.55, cp: hood, b: 0.5 });
    ctx.stroke(curve([[cx - S.half + 1.4, G.dash + 7], [cx - S.half + 3.2, G.nose + 1], [cx - S.half + 0.9, S.tireTop - 1]]), p.hi, 0.7, { o: 0.45, cp: body, b: 0.3 });
    // linha da borda do capô (luz em cima, sombra embaixo)
    const edge = B.hood.slice(Math.min(5, B.hood.length - 2));
    ctx.stroke(curve(edge.concat(mirrorTail(edge, cx))), p.deep, 0.55, { o: 0.55 });
  }
  return { body, hood };
}

function mirrorTail(pts: SP[], cx: number): SP[] {
  return pts
    .slice()
    .reverse()
    .map((q) => [2 * cx - q[0], q[1]] as SP);
}

/** grade com tela (cruzado fininho) e moldura */
function grille(ctx: LayerCtx, d: string, box: { x: number; y: number; w: number; h: number }, o: { mesh?: 'cross' | 'bars' | 'slats' | 'none'; frame?: 'chrome' | 'dark' | null; color?: string; bars?: number } = {}): void {
  const lite = isLite(ctx);
  const c = o.color ?? '#14151B';
  ctx.push(d, c, { gf: { t: 'l', x1: box.x, y1: box.y, x2: box.x, y2: box.y + box.h, s: [[0, shade(c, 0.12)], [1, shade(c, -0.3)]] } });
  const mesh = o.mesh ?? 'cross';
  if (mesh === 'cross' && !lite) {
    let m = '';
    for (let x = box.x - box.h; x < box.x + box.w; x += 1.5) m += `M${fmt(x)},${fmt(box.y + box.h)}l${fmt(box.h)},${fmt(-box.h)}M${fmt(x)},${fmt(box.y)}l${fmt(box.h)},${fmt(box.h)}`;
    ctx.stroke(m, '#3B3E4A', 0.3, { cp: d, o: 0.9, c: 'butt' });
  } else if (mesh === 'bars' || mesh === 'slats') {
    const n = o.bars ?? 5;
    let m = '';
    for (let i = 1; i <= n; i++) {
      const y = box.y + (box.h * i) / (n + 1);
      m += `M${fmt(box.x)},${fmt(y)}H${fmt(box.x + box.w)}`;
    }
    if (mesh === 'bars') {
      ctx.stroke(m, '#5D6372', 0.85, { cp: d, c: 'butt' });
      ctx.stroke(m, '#E8ECF4', 0.4, { cp: d, c: 'butt', gs: chromeGrad(box.x, box.y, box.x + box.w * 0.3, box.y + box.h) });
    } else {
      ctx.stroke(m, '#3C3F4A', 1.0, { cp: d, c: 'butt' });
      if (!lite) ctx.stroke(m.replace(/,([\d.]+)H/g, (_s, y) => `,${fmt(parseFloat(y) - 0.35)}H`), '#6A6F7E', 0.3, { cp: d, c: 'butt', o: 0.8 });
    }
  }
  if (o.frame === 'chrome') {
    ctx.stroke(d, '#565C6A', 1.3);
    ctx.stroke(d, '#E2E7F0', 0.8, { gs: chromeGrad(box.x, box.y, box.x + box.w * 0.4, box.y + box.h) });
  } else if (o.frame === 'dark') {
    ctx.stroke(d, '#0B0C10', 0.8, { o: 0.9 });
  }
  // fundo escuro (profundidade) embaixo
  if (!lite) ctx.push(rrect(box.x, box.y + box.h * 0.62, box.w, box.h * 0.38, 0.5), '#000000', { o: 0.28, cp: d, b: 0.5 });
}

/** placa (sem texto: só a faixa de cima e dois traços de "caracteres") */
function plate(ctx: LayerCtx, cx: number, y: number, w = 13, h = 4.2): void {
  const lite = isLite(ctx);
  const d = rrect(cx - w / 2, y, w, h, 0.6);
  ctx.push(d, '#E9ECF2', { gf: { t: 'l', x1: cx, y1: y, x2: cx, y2: y + h, s: [[0, '#FFFFFF'], [1, '#C9CED8']] } });
  ctx.push(rrect(cx - w / 2, y, w, h * 0.24, 0.5), '#2F5BC2', { cp: d });
  if (!lite) ctx.stroke(`M${fmt(cx - w * 0.32)},${fmt(y + h * 0.64)}h${fmt(w * 0.28)}M${fmt(cx + w * 0.04)},${fmt(y + h * 0.64)}h${fmt(w * 0.28)}`, '#3A3E4A', 0.9, { o: 0.75, c: 'butt' });
}

// conversível moderno: faróis amendoados, grade trapezoidal com tela, entrada de ar baixa e para-choque liso
function convertibleBody(ctx: LayerCtx, G: CarGeom, S: CarStyle, p: Paint): void {
  const cx = ctx.an.cx;
  const lite = isLite(ctx);
  const B: BodyShape = {
    outline: bodyOutline(cx, G, S, { fender: 1.6, shoulder: 0, arch: 1.4, chin: 0.3, cowl: 0 }),
    hood: hoodOutline(cx, G, S, { fender: 1.6, cowl: 0, edge: 0.3, mid: 0.9 }),
  };
  const { body } = paintBody(ctx, cx, G, S, p, B);
  const n = G.nose;
  // vinco que desce do farol ao para-choque (luz + sombra)
  if (!lite) {
    for (const g of [-1, 1]) {
      ctx.stroke(curve([[cx + g * 24, n + 5.5], [cx + g * 25.5, n + 13], [cx + g * 28, S.bottom - 3]]), p.deep, 0.6, { o: 0.4, cp: body, b: 0.25 });
      ctx.stroke(curve([[cx + g * 23.2, n + 5.6], [cx + g * 24.7, n + 13], [cx + g * 27.2, S.bottom - 3]]), p.hi, 0.45, { o: 0.4, cp: body, b: 0.25 });
    }
  }
  // faróis amendoados (varridos pra fora)
  for (const g of [-1, 1]) {
    const pts: SP[] = [
      [cx + g * 42.5, n + 2.2],
      [cx + g * 35, n + 0.9],
      [cx + g * 26.5, n + 2.0],
      [cx + g * 24.2, n + 3.8],
      [cx + g * 30, n + 6.4],
      [cx + g * 39.5, n + 5.6],
    ];
    const d = shape(pts);
    headlamp(ctx, d, [cx + g * 33, n + 3.6], 3.2, { glow: 0.42 });
    if (!lite) ctx.stroke(curve([[cx + g * 41, n + 3.4], [cx + g * 33, n + 2.6], [cx + g * 27, n + 3.6]]), '#FFFFFF', 0.5, { o: 0.85 }); // DRL
  }
  // grade trapezoidal com moldura cromada + emblema genérico
  const gy = n + 8.5;
  const gr = symShape(
    [
      [cx - 9, gy],
      [cx - 15.5, gy + 0.6],
      [cx - 17.5, gy + 4.6],
      [cx - 14, gy + 11.2],
      [cx - 6, gy + 11.8],
    ],
    cx,
  );
  grille(ctx, gr, { x: cx - 17.5, y: gy, w: 35, h: 11.8 }, { mesh: 'cross', frame: 'chrome' });
  ctx.push(ell(cx, gy + 1.9, 1.5, 1.1), '#D0D5DF', { gf: chromeGrad(cx - 1.5, gy + 0.8, cx + 1.5, gy + 3) });
  // entrada de ar baixa, faróis de neblina e placa
  const iy = S.bottom - 7.8;
  const intake = symShape(
    [
      [cx - 10, iy],
      [cx - 25, iy + 0.4],
      [cx - 27, iy + 3.2],
      [cx - 23, iy + 5.6],
      [cx - 8, iy + 5.9],
    ],
    cx,
  );
  ctx.push(intake, '#121318', { gf: { t: 'l', x1: cx, y1: iy, x2: cx, y2: iy + 6, s: [[0, '#2A2C34'], [1, '#0A0A0E']] } });
  for (const g of [-1, 1]) {
    const fx = cx + g * 22.5;
    ctx.push(ell(fx, iy + 2.9, 1.6, 1.25), '#FFF5D8', { gf: { t: 'r', cx: fx - 0.4, cy: iy + 2.5, r: 1.8, s: [[0, '#FFFFFF'], [0.6, '#F4E9C8'], [1, '#8E8A7E']] } });
  }
  plate(ctx, cx, iy + 0.5, 12.5, 4.0);
  // lábio do para-choque (sombra embaixo) e luz rebatida do chão
  if (!lite) ctx.stroke(curve([[cx - 30, S.bottom - 1.0], [cx, S.bottom + 0.1], [cx + 30, S.bottom - 1.0]]), '#000000', 1.0, { o: 0.25, cp: body });
}

// retrô: para-lamas redondos, faróis redondos com aro cromado, grade larga de barras e para-choque cromado grosso
function classicBody(ctx: LayerCtx, G: CarGeom, S: CarStyle, p: Paint): void {
  const cx = ctx.an.cx;
  const lite = isLite(ctx);
  const n = G.nose;
  const B: BodyShape = {
    outline: bodyOutline(cx, G, S, { fender: 3.8, shoulder: 1.5, arch: 2.6, chin: 1.2, cowl: 0.6 }),
    hood: hoodOutline(cx, G, S, { fender: 3.8, cowl: 0.6, edge: 1.4, mid: -0.6 }),
  };
  const { body } = paintBody(ctx, cx, G, S, p, B);
  // para-lamas abaulados: sombra entre o para-lama e a grade (forma de "pontão")
  if (!lite) {
    for (const g of [-1, 1]) ctx.stroke(curve([[cx + g * 25, n + 1], [cx + g * 23, n + 9], [cx + g * 24.5, S.bottom - 6]]), p.deep, 1.1, { o: 0.4, cp: body, b: 0.5 });
  }
  // faróis redondos com aro cromado
  for (const g of [-1, 1]) {
    const c: Pt = [cx + g * 33.5, n + 5.2];
    ctx.push(ell(c[0], c[1], 5.0, 4.8), '#C9CFDA', { gf: chromeGrad(c[0] - 5, c[1] - 5, c[0] + 3, c[1] + 5) });
    headlamp(ctx, ell(c[0], c[1], 3.9, 3.7), c, 3.7, { glow: 0.45, housing: '#3A3F4C' });
    if (!lite) ctx.push(ell(c[0] - 1.2, c[1] - 1.3, 1.3, 0.8, -30), '#FFFFFF', { o: 0.75 });
    // pisca redondo âmbar embaixo
    ctx.push(ell(cx + g * 28.5, n + 13, 1.4, 1.2), '#F2A33A', { gf: { t: 'r', cx: cx + g * 28.2, cy: n + 12.6, r: 1.6, s: [[0, '#FFE2A8'], [1, '#C46A12']] } });
  }
  // grade larga oval de barras cromadas
  const gy = n + 3.5;
  const gr = symShape(
    [
      [cx - 10, gy],
      [cx - 19, gy + 0.8],
      [cx - 21.5, gy + 6],
      [cx - 19, gy + 11.6],
      [cx - 10, gy + 12.2],
    ],
    cx,
  );
  grille(ctx, gr, { x: cx - 21.5, y: gy, w: 43, h: 12.2 }, { mesh: 'bars', frame: 'chrome', color: '#1A1B22', bars: 5 });
  if (!lite) {
    // barras verticais finas
    let v = '';
    for (let i = -4; i <= 4; i++) v += `M${fmt(cx + i * 4.2)},${fmt(gy + 0.5)}V${fmt(gy + 11.8)}`;
    ctx.stroke(v, '#C6CCD8', 0.35, { cp: gr, o: 0.8 });
  }
  // enfeite do capô (lança cromada genérica)
  ctx.push(shape([[cx - 0.9, n - 0.4], [cx, n - 3.6], [cx + 0.9, n - 0.4], [cx, n + 0.4]]), '#D6DBE5', { gf: chromeGrad(cx - 1, n - 3.6, cx + 1, n + 0.4) });
  // para-choque cromado grosso com garras
  const by = S.bottom - 6.6;
  const bump = symShape(
    [
      [cx - 10, by],
      [cx - 40, by + 0.2],
      [cx - S.half - 0.6, by + 1.6],
      [cx - S.half - 0.2, by + 4.2],
      [cx - 40, by + 5.4],
      [cx - 10, by + 5.6],
    ],
    cx,
  );
  ctx.push(bump, '#C9CFDA', { gf: chromeGrad(cx, by - 0.4, cx, by + 5.8) });
  for (const g of [-1, 1]) {
    const ox = cx + g * 15;
    ctx.push(shape([[ox - 1.6, by + 0.2], [ox, by - 3.4], [ox + 1.6, by + 0.2], [ox + 1.4, by + 4.6], [ox - 1.4, by + 4.6]]), '#D2D7E1', { gf: chromeGrad(ox - 1.6, by - 3.4, ox + 1.6, by + 4.6) });
  }
  plate(ctx, cx, by + 0.7, 11.5, 3.8);
}

// jipe: lataria quadrada, para-lamas pretos salientes, grade de lâminas horizontais, faróis redondos em caixas,
// para-choque de aço com guincho e ganchos
function jeepBody(ctx: LayerCtx, G: CarGeom, S: CarStyle, p: Paint): void {
  const cx = ctx.an.cx;
  const lite = isLite(ctx);
  const n = G.nose;
  const h = S.half;
  // lataria quadrada (cantos quase vivos)
  const outline: SP[] = [
    [cx - 10, G.dash - 0.4],
    [cx - 32, G.dash - 0.4, 0.3],
    [cx - 34, G.dash + 1, 0.3],
    [cx - 34.5, n, 0.3],
    [cx - 35, S.bottom - 2, 0.2],
    [cx - 33, S.bottom, 0.2],
    [cx - 6, S.bottom, 0],
  ];
  const hood: SP[] = [
    [cx - 10, G.dash - 0.1],
    [cx - 32, G.dash - 0.1, 0.3],
    [cx - 33.8, G.dash + 1.2, 0.3],
    [cx - 34.2, n - 0.2, 0.2],
    [cx - 7, n + 0.3, 0],
  ];
  const { body } = paintBody(ctx, cx, G, { ...S, half: 34.5 }, p, { outline, hood });
  // para-lamas salientes (plástico preto texturizado) em cima dos pneus
  for (const g of [-1, 1]) {
    const fl = shape([
      [cx + g * 30, n - 2.2, 0.4],
      [cx + g * (h + 1.5), n - 1.2, 0.5],
      [cx + g * (h + 2.2), S.tireTop + 2.2, 0.4],
      [cx + g * (h - 1), S.tireTop + 3.0, 0.2],
      [cx + g * (S.tireX - S.tireW / 2 - 0.8), S.tireTop + 1.4, 0.3],
      [cx + g * (S.tireX - S.tireW / 2 - 0.4), S.tireTop + 3.4, 0.2],
      [cx + g * 32.2, S.tireTop + 3.4, 0.3],
    ]);
    ctx.push(fl, '#23242B', { gf: { t: 'l', x1: cx + g * 30, y1: n - 2, x2: cx + g * 30, y2: S.tireTop + 3, s: [[0, '#4A4C57'], [0.35, '#2A2B32'], [1, '#121318']] } });
    if (!lite) ctx.stroke(curve([[cx + g * 30.5, n - 1.4], [cx + g * (h + 1), n - 0.6]]), '#7A7F8E', 0.4, { o: 0.7 });
  }
  // faróis redondos em caixas quadradas
  for (const g of [-1, 1]) {
    const c: Pt = [cx + g * 26.5, n + 6.2];
    ctx.push(rrect(c[0] - 4.8, c[1] - 4.6, 9.6, 9.2, 2), '#22232A', { gf: rubberGrad(c[0] - 4.8, c[1] - 4.6, c[0] + 4.8, c[1] + 4.6) });
    ctx.push(ell(c[0], c[1], 3.9, 3.8), '#C9CFDA', { gf: chromeGrad(c[0] - 4, c[1] - 4, c[0] + 3, c[1] + 4) });
    headlamp(ctx, ell(c[0], c[1], 3.1, 3.0), c, 3.0, { glow: 0.42 });
  }
  // grade de lâminas horizontais (entre os faróis)
  const gy = n + 2.2;
  const gr = rrect(cx - 19.5, gy, 39, 10.8, 1.2);
  grille(ctx, gr, { x: cx - 19.5, y: gy, w: 39, h: 10.8 }, { mesh: 'slats', frame: 'dark', color: '#17181E', bars: 4 });
  // para-choque de aço preto com guincho, ganchos vermelhos e placa
  const by = S.bottom - 7.4;
  const bump = rrect(cx - h - 1, by, 2 * h + 2, 5.2, 1.0);
  ctx.push(bump, '#202128', { gf: { t: 'l', x1: cx, y1: by, x2: cx, y2: by + 5.2, s: [[0, '#5A5E6B'], [0.3, '#2B2D35'], [1, '#121318']] } });
  if (!lite) ctx.stroke(`M${fmt(cx - h)},${fmt(by + 0.6)}H${fmt(cx + h)}`, '#8B91A0', 0.35, { o: 0.8 });
  for (const g of [-1, 1]) {
    const hx = cx + g * 30;
    ctx.stroke(`M${fmt(hx - 1.2)},${fmt(by + 2.6)}a1.2,1.2 0 1,0 2.4,0`, '#D8342F', 0.9);
  }
  ctx.push(rrect(cx - 4.2, by - 1.6, 8.4, 4.6, 1.2), '#2E3038', { gf: rubberGrad(cx - 4.2, by - 1.6, cx + 4.2, by + 3) });
  if (!lite) ctx.stroke(`M${fmt(cx - 3)},${fmt(by - 0.4)}h6M${fmt(cx - 3)},${fmt(by + 0.6)}h6M${fmt(cx - 3)},${fmt(by + 1.6)}h6`, '#9097A6', 0.3, { o: 0.9 });
  plate(ctx, cx, by + 5.6 - 0.2, 11, 3.6);
  void body;
}

// esportivo neon: muito largo e baixo, faróis em lâmina de LED, entradas de ar de carbono e filete neon
function sportBody(ctx: LayerCtx, G: CarGeom, S: CarStyle, p: Paint): void {
  const cx = ctx.an.cx;
  const lite = isLite(ctx);
  const n = G.nose;
  const neon = neonOf(ctx.col.vehicle);
  const B: BodyShape = {
    outline: bodyOutline(cx, G, S, { fender: 3.2, shoulder: 0.5, arch: 1.0, chin: 0, cowl: -0.3 }),
    hood: hoodOutline(cx, G, S, { fender: 3.2, cowl: -0.3, edge: -0.6, mid: 1.6 }),
  };
  const { body, hood } = paintBody(ctx, cx, G, S, p, B);
  // nervuras do capô (duas linhas em V)
  if (!lite) {
    for (const g of [-1, 1]) {
      ctx.stroke(curve([[cx + g * 9, G.dash + 0.6], [cx + g * 6, n + 1.2]]), p.deep, 0.7, { o: 0.5, cp: hood });
      ctx.stroke(curve([[cx + g * 9.8, G.dash + 0.6], [cx + g * 6.8, n + 1.2]]), p.hi, 0.4, { o: 0.45, cp: hood });
    }
  }
  // faróis em lâmina (LED neon) bem finos e varridos
  for (const g of [-1, 1]) {
    const d = shape([
      [cx + g * 44, n + 0.6, 0.2],
      [cx + g * 31, n + 1.4],
      [cx + g * 22, n + 3.6, 0.2],
      [cx + g * 24, n + 5.0],
      [cx + g * 33, n + 4.0],
      [cx + g * 42.5, n + 3.4],
    ]);
    ctx.push(d, '#0E0F14');
    neonLine(ctx, curve([[cx + g * 42.5, n + 1.6], [cx + g * 31.5, n + 2.4], [cx + g * 23.5, n + 4.2]]), neon, 0.75, { halo: 0.3 });
    ctx.push(ell(cx + g * 33, n + 2.6, 7, 3.4), neon, { gf: glowGrad(cx + g * 33, n + 2.6, 7, neon, 0.35) });
  }
  // entrada de ar central grande (carbono) e as laterais
  const iy = n + 7.5;
  const intake = symShape(
    [
      [cx - 8, iy + 0.6],
      [cx - 18, iy],
      [cx - 22, iy + 5],
      [cx - 18.5, S.bottom - 3.2],
      [cx - 6, S.bottom - 2.6],
    ],
    cx,
  );
  const carbon = (d: string, x: number, y: number, w: number, hh: number) => {
    ctx.push(d, '#121318', { gf: { t: 'l', x1: x, y1: y, x2: x, y2: y + hh, s: [[0, '#2B2D35'], [1, '#08080B']] } });
    if (!lite) {
      let m = '';
      for (let xx = x - hh; xx < x + w; xx += 1.2) m += `M${fmt(xx)},${fmt(y + hh)}l${fmt(hh)},${fmt(-hh)}`;
      ctx.stroke(m, '#3A3D47', 0.35, { cp: d, o: 0.7, c: 'butt' });
    }
  };
  carbon(intake, cx - 22, iy, 44, S.bottom - iy);
  for (const g of [-1, 1]) {
    const si = shape([
      [cx + g * 26, iy + 3, 0.3],
      [cx + g * 41, iy + 1.5, 0.3],
      [cx + g * 40, S.bottom - 6, 0.3],
      [cx + g * 28.5, S.bottom - 4.5, 0.3],
    ]);
    carbon(si, cx + Math.min(g * 26, g * 41), iy + 1.5, 15, S.bottom - 4.5 - iy);
  }
  // splitter com filete neon
  const sy = S.bottom - 1.6;
  ctx.push(shape([[cx - 34, sy - 1, 0.3], [cx + 34, sy - 1, 0.3], [cx + 36, sy + 1.4, 0.2], [cx - 36, sy + 1.4, 0.2]]), '#0D0E12');
  neonLine(ctx, `M${fmt(cx - 33)},${fmt(sy + 1.3)}H${fmt(cx + 33)}`, neon, 0.5, { halo: 0.35 });
  // emblema genérico (losango) no bico
  ctx.push(shape([[cx, n - 0.4, 0], [cx + 1.6, n + 1.2, 0], [cx, n + 2.8, 0], [cx - 1.6, n + 1.2, 0]], 0), '#D0D5DF', { gf: chromeGrad(cx - 1.6, n - 0.4, cx + 1.6, n + 2.8) });
  void body;
}
