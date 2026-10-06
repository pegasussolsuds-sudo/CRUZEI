// Bichos com desenho próprio (dono: pets): salsicha, coelho, hamster, jabuti, capivara, bicho-preguiça e axolote.
// Cada um é desenhado UMA vez no espaço local (origem no chão, y pra baixo, virado pra esquerda da tela em
// três-quartos) com volume (gradiente + sombra própria recortada + luz de cima-esquerda), pelo/casco/pele com textura
// própria e olhos com reflexo. Posição, escala e espelho por pose ficam em pets.ts.
//
// Escala: 1 unidade ≈ 1,4 cm (o avatar mede ~124). Os tamanhos seguem o bicho de verdade, com um empurrãozinho nos
// pequenos (hamster) pra continuarem legíveis no colo e no mapa.

import type { PetDef, PetPoseDraw } from './pets';
import {
  ballGrad,
  dogNose,
  furEdge,
  mix,
  petEye,
  petMouth,
  rim,
  shade,
  solid,
  tones,
  tufts,
  whiskers,
  type Pen,
  type SP,
  type Tones,
} from './pets-kit';

type Draw = (pen: Pen, pose: PetPoseDraw) => void;

/** PetDef com escala interna `k` (o desenho é feito na escala 1 e a caixa acompanha) */
function defOf(k: number, box: { x0: number; x1: number; top: number; cy: number }, shadowW: number, draw: Draw, extra: Partial<PetDef> = {}): PetDef {
  return {
    draw: (pen, pose) => draw(pen.sub(0, 0, k), pose),
    box: { x0: box.x0 * k, x1: box.x1 * k, top: box.top * k, cy: box.cy * k },
    shadowW: shadowW * k,
    ...extra,
  };
}

/** sombra de contato macia (elipse escura desfocada recortada numa forma) */
function occl(q: Pen, cx: number, cy: number, rx: number, ry: number, clip: string, o = 0.3, rot = 0): void {
  if (q.lite) return;
  q.fill(q.ell(cx, cy, rx, ry, rot), '#000000', { o, b: Math.max(0.3, Math.min(rx, ry) * 0.6), cp: clip });
}

// ---------------------------------------------------------------------------------------------------------------
// Salsicha (em pé, corpo comprido, orelha caída)
// ---------------------------------------------------------------------------------------------------------------

function dachshund(q: Pen): void {
  const L = q.lite;
  const T = tones('#9C4A22');
  const D = tones('#6A2C13');
  const leg = (x: number, w: number, top: number): SP[] => [
    [x - w * 0.5, top],
    [x + w * 0.55, top],
    [x + w * 0.5, -2.4],
    [x + w * 0.6, -1.0],
    [x + w * 0.45, 0, 0.5],
    [x - w * 1.2, 0, 0.5],
    [x - w * 1.12, -0.95],
    [x - w * 0.55, -2.1],
  ];
  // cauda (atrás), pernas de longe (mais escuras)
  const tail = q.taper([[10.4, -10.4], [12.8, -12.2], [14.6, -15.2]], [1.4, 1.0, 0.25], { round: true });
  q.fill(tail, T.base, { gf: q.lg(10, -10, 15, -15, [[0, T.shade], [0.5, T.base], [1, T.light]]) });
  for (const x of [-5.2, 9.8]) {
    const d = q.path(leg(x, 2.1, -6.6));
    q.fill(d, T.shade, { gf: q.lg(x - 1.5, -6, x + 1.5, 0, [[0, T.shade], [1, T.deep]]) });
  }
  // orelha de longe espiando atrás do crânio
  q.fill(q.path([[-13.2, -18.7], [-15.2, -18.7], [-16.0, -17.0], [-14.6, -16.3]]), D.base);
  // corpo (pescoço grosso, peito fundo perto do chão, linha de cima reta)
  const bodyPts: SP[] = [
    [-10.2, -15.8],
    [-6.0, -12.9],
    [2.0, -12.2],
    [8.5, -11.8],
    [11.2, -9.8],
    [11.0, -6.6],
    [8.6, -4.8],
    [4.0, -5.6],
    [-3.0, -4.3],
    [-7.6, -4.0],
    [-10.6, -6.2],
    [-11.9, -9.0],
    [-13.4, -12.6],
  ];
  const body = q.path(bodyPts);
  solid(q, body, T, { cx: 0, cy: -8.6, r: 9 }, { grad: q.lg(0, -13, 1.5, -4, [[0, T.light], [0.45, T.base], [1, T.shade]]), core: 0.22, hl: 0.12 });
  if (!L) {
    // dorso mais escuro (sela), barriga na sombra, ombro e coxa com volume
    q.fill(q.path([[-8, -13.6], [2, -13.2], [10, -12.6], [10.4, -10.6], [2, -10.6], [-7, -11.4]]), D.base, { o: 0.35, b: 0.9, cp: body });
    occl(q, 1.0, -3.8, 9.5, 1.6, body, 0.3);
    q.fill(q.ell(-7.6, -9.6, 2.6, 3.4, -10), T.lighter, { o: 0.2, b: 0.9, cp: body });
    q.fill(q.ell(8.4, -8.4, 2.6, 2.8), T.lighter, { o: 0.16, b: 0.8, cp: body });
    occl(q, 6.0, -7.4, 1.0, 2.6, body, 0.22, 20);
    tufts(q, [[-11.6, -9.6, 110, 1.2, 0.3], [-10.8, -7.4, 100, 1.1, 0.28], [-9.4, -11.2, 120, 1.0, 0.28]], T.lighter, 0.35, body);
  }
  rim(q, body, [[-9.6, -15.4], [-5.8, -12.6], [3, -12.0], [9.4, -11.4]], '#FFE2C8', 0.3, 0.55);
  // pernas de perto (traseira com jarrete, dianteira curtinha e torta)
  const rear = q.path([[6.0, -7.2], [9.4, -7.0], [9.0, -3.4], [8.4, -1.2], [8.6, 0, 0.5], [5.2, 0, 0.5], [5.5, -1.0], [6.4, -2.8]]);
  q.fill(rear, T.base, { gf: q.lg(5.5, -7, 9.5, 0, [[0, T.light], [0.6, T.base], [1, T.shade]]) });
  const front = q.path(leg(-7.6, 2.4, -7.2));
  q.fill(front, T.base, { gf: q.lg(-9, -7, -6, 0, [[0, T.light], [0.6, T.base], [1, T.shade]]) });
  if (!L) {
    q.line(q.path([[-9.4, -0.9], [-9.5, -0.1]], false) + q.path([[-8.4, -0.9], [-8.45, -0.1]], false) + q.path([[6.2, -0.9], [6.15, -0.1]], false), T.deep, 0.18, { o: 0.6 });
    occl(q, -7.4, -7.0, 2.0, 0.9, front, 0.3);
  }
  // coleira
  const cy = -11.4;
  q.fill(q.taper([[-13.8, cy - 0.6], [-11.8, cy + 0.6], [-9.6, cy - 0.2]], [0.75, 0.85, 0.75], { round: true }), '#2EA36A', { gf: q.lg(0, cy - 0.8, 0, cy + 1.2, [[0, '#62D79A'], [1, '#1A6B44']]) });
  q.fill(q.ell(-11.9, cy + 1.7, 0.65, 0.75), '#E8B23A', { gf: q.rg(-12.1, cy + 1.4, 1, [[0, '#FFF0B0'], [0.5, '#E8B23A'], [1, '#9A6A10']]) });
  // cabeça (crânio + focinho comprido)
  const headPts: SP[] = [
    [-11.0, -18.4],
    [-13.8, -19.1],
    [-16.2, -17.7],
    [-19.8, -15.9],
    [-20.5, -14.6],
    [-19.6, -13.6],
    [-16.4, -13.2],
    [-13.6, -12.5],
    [-10.6, -13.4],
    [-9.9, -15.8],
  ];
  const head = q.path(headPts);
  solid(q, head, T, { cx: -14, cy: -16, r: 4 }, { core: 0.22, hl: 0.2 });
  if (!L) {
    q.fill(q.ell(-16.4, -16.6, 0.9, 1.6, -15), T.deep, { o: 0.25, b: 0.5, cp: head });
    q.fill(q.ell(-18.0, -16.0, 2.4, 0.7, -20), T.lighter, { o: 0.3, b: 0.4, cp: head });
    occl(q, -16.5, -12.9, 4.0, 0.8, head, 0.28);
  }
  petEye(q, -16.7, -16.8, 0.62, { iris: '#4A2412', open: 0.92, look: [-0.2, 0.05] });
  petEye(q, -14.1, -16.5, 0.86, { iris: '#4A2412', open: 0.95, look: [-0.2, 0.05] });
  if (!L) q.fill(q.ell(-14.0, -17.9, 0.9, 0.35, -8) + q.ell(-16.6, -18.0, 0.7, 0.3, 8), T.lighter, { o: 0.45, b: 0.2 });
  dogNose(q, -20.0, -15.4, 0.85, '#2A1612');
  q.line(q.path([[-19.8, -13.9], [-18.2, -13.5], [-16.6, -13.9]], false), T.deep, 0.22, { o: 0.75 });
  // orelha de perto: comprida, caindo sobre o pescoço
  const ear = q.path([[-11.4, -18.3], [-9.4, -17.7], [-8.5, -14.4], [-8.7, -11.0], [-9.9, -9.7], [-11.4, -10.7], [-11.9, -14.6]]);
  q.fill(ear, D.base, { gf: q.lg(-11.5, -18, -9, -10, [[0, D.light], [0.55, D.base], [1, D.deep]]) });
  if (!L) {
    occl(q, -10.6, -17.6, 1.8, 0.8, ear, 0.35);
    rim(q, ear, [[-9.3, -17.2], [-8.7, -13.6], [-8.9, -11.2]], '#FFD0B0', 0.25, 0.45);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Coelho (sentado)
// ---------------------------------------------------------------------------------------------------------------

function bunny(q: Pen): void {
  const L = q.lite;
  const T = tones('#B4977B');
  const B = tones('#F1E6D8');
  const P = tones('#E7A3A2');
  // orelha de longe (atrás da cabeça)
  const farEar = q.taper([[-3.2, -15.0], [-3.9, -19.4], [-4.6, -23.2]], [2.0, 2.4, 0.9], { round: true });
  q.fill(farEar, T.shade, { gf: q.lg(-3, -15, -5, -23, [[0, T.shade], [1, T.base]]) });
  q.fill(q.taper([[-3.4, -16.0], [-4.0, -19.4], [-4.5, -22.4]], [0.9, 1.3, 0.4], { round: true }), P.shade, { o: 0.75 });
  // corpo em pera com o dorso fofo
  const bodyPts: SP[] = [
    [-1.0, -12.2],
    [2.8, -11.0],
    [6.4, -8.0],
    [7.8, -4.2],
    [7.0, -1.0],
    [3.4, 0],
    [-1.6, 0],
    [-4.2, -0.6],
    [-5.0, -3.2],
    [-5.2, -7.2],
    [-4.4, -10.2],
  ];
  const body = q.path(furEdge(bodyPts, 1, 4, 0.4, 2));
  solid(q, body, T, { cx: 1.4, cy: -6, r: 6.5 }, { core: 0.26, hl: 0.18 });
  // pompom
  const tail = q.path(furEdge([[7.4, -5.2], [9.2, -3.4], [7.6, -1.4], [5.8, -3.2]], 0, 4, 0.35, 2));
  q.fill(tail, B.base, { gf: ballGrad(q, 7.4, -3.3, 1.9, tones('#FFFFFF')) });
  // anca (coxa traseira grande) e o pé comprido no chão
  const haunch = q.ell(3.0, -4.4, 4.6, 4.2, -10);
  if (!L) occl(q, 0.2, -5.0, 1.6, 3.6, body, 0.28, 10);
  solid(q, haunch, T, { cx: 3.0, cy: -4.6, r: 4.6 }, { core: 0.3, hl: 0.24 });
  const foot = q.path([[-1.6, -1.3], [3.6, -1.7], [6.6, -1.0], [6.4, 0, 0.5], [-1.9, 0, 0.5]]);
  q.fill(foot, T.base, { gf: q.lg(0, -1.7, 0, 0, [[0, T.light], [1, B.shade]]) });
  // peito claro, patinhas da frente
  q.fill(q.path([[-4.8, -8.4], [-2.4, -10.6], [-1.0, -6.0], [-2.2, -1.6], [-4.6, -2.4]]), B.base, { cp: body, o: 0.92, b: L ? 0 : 0.5 });
  for (const [x, t] of [
    [-3.9, T.shade],
    [-2.0, T.base],
  ] as const) {
    q.fill(q.taper([[x - 0.9, -5.2], [x - 0.3, -2.6], [x, -0.8]], [1.4, 1.2, 1.0], { round: true }), t, { gf: q.lg(x - 1, -5, x + 1, -1, [[0, mix(t, B.base, 0.4)], [1, t]]) });
    q.fill(q.ell(x, -0.65, 1.05, 0.7), mix(t, B.base, 0.55));
  }
  if (!L) tufts(q, [[-4.8, -6.4, 120, 1.1, 0.35], [-4.4, -8.6, 135, 1.0, 0.32], [6.8, -7.0, 40, 1.0, 0.3], [4.6, -9.6, 60, 1.0, 0.3]], B.lighter, 0.5, body);
  // cabeça com bochechas cheias embaixo
  const headPts: SP[] = [
    [-2.4, -16.4],
    [0.4, -15.6],
    [1.2, -13.0],
    [0.4, -10.4],
    [-2.6, -9.4],
    [-5.0, -10.0],
    [-6.4, -11.6],
    [-6.2, -13.6],
    [-4.8, -15.6],
  ];
  const head = q.path(furEdge(headPts, 2, 5, 0.3, 1));
  solid(q, head, T, { cx: -2.6, cy: -12.8, r: 3.8 }, { core: 0.22, hl: 0.22 });
  q.fill(q.ell(-5.0, -11.2, 1.8, 1.4), B.base, { cp: head, o: 0.9, b: L ? 0 : 0.45 });
  if (!L) q.fill(q.ell(-1.4, -11.4, 1.4, 1.0), P.base, { o: 0.25, b: 0.6, cp: head });
  petEye(q, -5.6, -13.5, 0.7, { iris: '#3A2418', pupil: 'none', open: 0.95, look: [-0.15, 0] });
  petEye(q, -3.1, -13.4, 1.02, { iris: '#3A2418', pupil: 'none', open: 0.97, look: [-0.15, 0] });
  // narizinho em Y e boca
  q.fill(q.path([[-6.7, -12.3], [-5.7, -12.4], [-6.15, -11.7, 0.4]]), P.shade);
  petMouth(q, -6.1, -11.0, 0.55, T.deep, { smile: 0.5, philtrum: 0.6, width: 0.16 });
  whiskers(q, -6.0, -11.5, 4.2, '#FFFFFF', 0.45);
  // orelha de perto
  const ear = q.taper([[-1.2, -15.4], [-0.2, -19.6], [0.8, -23.8]], [2.1, 2.6, 1.0], { round: true });
  q.fill(ear, T.base, { gf: q.lg(-1.5, -15, 1, -24, [[0, T.base], [0.6, T.light], [1, T.base]]) });
  q.fill(q.taper([[-0.9, -16.4], [-0.1, -19.6], [0.6, -22.8]], [0.9, 1.4, 0.45], { round: true }), P.base, { gf: q.lg(0, -16, 0, -23, [[0, P.shade], [1, P.light]]) });
  if (!L) occl(q, -0.9, -15.4, 1.6, 0.8, head, 0.3);
}

// ---------------------------------------------------------------------------------------------------------------
// Hamster (bolinha dourada segurando uma semente)
// ---------------------------------------------------------------------------------------------------------------

function hamster(q: Pen): void {
  const L = q.lite;
  const T = tones('#E3A15A');
  const B = tones('#FFF3E0');
  const P = tones('#F2A7A0');
  q.fill(q.ell(-3.0, -6.9, 0.9, 0.95), T.shade);
  const bodyPts: SP[] = [
    [-1.2, -7.6],
    [2.0, -7.4],
    [4.0, -5.4],
    [4.4, -2.6],
    [3.2, -0.4],
    [0, 0.1],
    [-3.0, -0.2],
    [-4.6, -1.6],
    [-5.0, -3.8],
    [-4.2, -6.2],
  ];
  const body = q.path(furEdge(bodyPts, 0, 5, 0.3, 2));
  solid(q, body, T, { cx: 0, cy: -3.9, r: 4.4 }, { core: 0.28, hl: 0.26 });
  // barriga e bochecha claras (a faixa branca sobe pela bochecha)
  q.fill(q.path([[-5.0, -3.6], [-3.0, -4.4], [-0.6, -3.2], [0.8, -0.6], [-2.6, 0.1], [-4.6, -1.2]]), B.base, { cp: body, b: L ? 0 : 0.45 });
  if (!L) {
    q.fill(q.ell(-3.4, -3.4, 1.3, 1.0), '#FFFFFF', { o: 0.4, b: 0.4, cp: body });
    tufts(q, [[2.6, -6.4, -40, 0.9, 0.3], [3.8, -4.0, 0, 0.9, 0.3], [0.6, -7.2, -70, 0.8, 0.28]], T.lighter, 0.55, body);
  }
  // orelha de perto
  q.fill(q.ell(0.0, -7.3, 1.05, 1.0), T.base, { gf: ballGrad(q, 0, -7.3, 1.05, T) });
  q.fill(q.ell(0.05, -7.25, 0.6, 0.58), P.base, { o: 0.85 });
  petEye(q, -3.9, -5.1, 0.42, { iris: '#1A0F0A', pupil: 'none', open: 1 });
  petEye(q, -2.1, -5.0, 0.6, { iris: '#1A0F0A', pupil: 'none', open: 1 });
  q.fill(q.ell(-4.75, -4.1, 0.38, 0.3), P.shade);
  if (!L) q.line(q.path([[-4.75, -3.8], [-4.6, -3.3]], false), T.deep, 0.12, { o: 0.6 });
  whiskers(q, -4.6, -3.9, 2.8, '#FFFFFF', 0.4);
  // semente de girassol nas patinhas
  const seed = q.ell(-3.0, -2.0, 0.55, 0.95, 20);
  q.fill(seed, '#3A3A40', { gf: q.lg(-3.4, -2.8, -2.6, -1.2, [[0, '#55555E'], [1, '#26262C']]) });
  if (!L) q.line(q.path([[-3.25, -2.8], [-2.85, -1.2]], false), '#E8E8EE', 0.14, { o: 0.75 });
  q.fill(q.ell(-3.5, -2.3, 0.45, 0.38) + q.ell(-2.45, -2.1, 0.45, 0.38), P.base);
  q.fill(q.ell(-2.4, -0.1, 0.7, 0.32) + q.ell(1.4, -0.05, 0.7, 0.32), P.base);
}

// ---------------------------------------------------------------------------------------------------------------
// Jabuti-piranga (casco alto com placas de centro amarelo, escamas laranja na cabeça e nas patas)
// ---------------------------------------------------------------------------------------------------------------

function turtle(q: Pen): void {
  const L = q.lite;
  const S = tones('#4A3A30');
  const R = '#E2582A';
  const shellPts: SP[] = [
    [-8.4, -3.4],
    [-7.8, -7.4],
    [-5.0, -10.4],
    [-0.4, -11.6],
    [4.4, -10.8],
    [7.6, -8.0],
    [8.8, -4.2],
    [8.2, -2.8],
    [0, -2.4],
    [-7.6, -2.6],
  ];
  const shell = q.path(shellPts);
  // patas de longe espiando, rabinho
  q.fill(q.path([[-3.6, -3.0], [-1.6, -3.0], [-1.6, -0.4], [-3.8, -0.3]]), S.deep);
  q.fill(q.path([[2.6, -3.0], [4.4, -3.0], [4.6, -0.3], [2.6, -0.4]]), S.deep);
  q.fill(q.path([[8.0, -3.4], [10.2, -2.4], [8.2, -2.2]]), S.shade);
  // cabeça e pescoço (saindo de baixo do casco)
  const head = q.path([[-7.0, -5.4], [-9.6, -6.8], [-11.6, -7.1], [-12.9, -6.0], [-12.9, -4.6], [-11.6, -3.8], [-9.4, -3.5], [-7.0, -3.3]]);
  solid(q, head, S, { cx: -10.5, cy: -5.4, r: 2.4 }, { core: 0.25, hl: 0.25 });
  q.fill(q.ell(-11.5, -6.4, 0.95, 0.6, -10) + q.ell(-9.9, -6.5, 0.6, 0.4) + q.ell(-12.2, -4.8, 0.45, 0.35) + q.ell(-10.6, -4.2, 0.5, 0.3), R, { o: 0.92 });
  if (!L) q.line(q.path([[-12.8, -4.9], [-11.6, -4.6], [-10.6, -4.8]], false), S.deep, 0.18, { o: 0.8 });
  petEye(q, -11.0, -5.7, 0.55, { iris: '#2A1408', open: 0.85, look: [-0.25, 0] });
  // patas de perto: colunas de elefante com escamas laranja e unhas
  for (const x of [-6.0, 6.0]) {
    const leg = q.path([[x - 1.2, -4.2], [x + 1.2, -4.0], [x + 1.35, -1.0], [x + 1.6, 0, 0.5], [x - 1.9, 0, 0.5], [x - 1.5, -1.0]]);
    solid(q, leg, S, { cx: x, cy: -2, r: 1.8 }, { core: 0.25, hl: 0.2 });
    q.fill(q.ell(x - 0.3, -2.6, 0.55, 0.45) + q.ell(x + 0.6, -1.6, 0.5, 0.4) + q.ell(x - 0.9, -1.2, 0.45, 0.35), R, { o: 0.85, cp: leg });
    if (!L) q.line(q.path([[x - 1.5, -0.2], [x - 1.2, 0]], false) + q.path([[x - 0.5, -0.2], [x - 0.3, 0]], false), '#E9DCC4', 0.22, { o: 0.9 });
  }
  // casco: base escura, placas com aréola amarela, plastrão por baixo
  q.fill(shell, '#2B2119', { gf: q.lg(-2, -12, 2, -2, [[0, '#4A3A2C'], [1, '#1E1712']]) });
  const scute = (cx: number, cy: number, rx: number, ry: number) => {
    const pts: SP[] = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, 0.45]);
    }
    const d = q.path(pts);
    q.fill(d, '#5A4128', { cp: shell, gf: q.rg(cx - rx * 0.1, cy - ry * 0.15, Math.max(rx, ry) * 1.05, [[0, '#F0C25A'], [0.32, '#D39A3A'], [0.62, '#6E4C26'], [1, '#33251A']]) });
    if (!L) q.line(q.ell(cx, cy, rx * 0.62, ry * 0.6), '#2A1E14', 0.16, { o: 0.45, cp: d });
  };
  for (const [x, y] of [
    [-4.2, -9.0],
    [0.0, -10.0],
    [4.2, -9.1],
  ] as const)
    scute(x, y, 2.3, 1.7);
  for (const [x, y] of [
    [-5.8, -5.8],
    [-1.6, -6.6],
    [2.7, -6.5],
    [6.5, -5.3],
  ] as const)
    scute(x, y, 2.2, 2.0);
  if (!L) {
    let d = '';
    for (let x = -7.4; x <= 7.8; x += 2.2) d += q.path([[x, -2.9], [x + 0.2, -4.0]], false);
    q.line(d, '#1A120C', 0.2, { o: 0.6, cp: shell });
  }
  q.fill(q.path([[-8.0, -2.9], [-3.0, -1.9], [2.0, -1.9], [8.0, -3.1], [7.6, -2.3], [0, -1.3], [-7.6, -2.3]]), '#C9A35A', { gf: q.lg(0, -3, 0, -1.3, [[0, '#E2C27A'], [1, '#9A7638']]) });
  // volume do domo: sombra embaixo-direita, brilho de verniz em cima-esquerda
  if (!L) {
    q.fill(q.ell(4.6, -4.6, 6.0, 3.6, -15), '#000000', { o: 0.32, b: 1.4, cp: shell });
    q.fill(q.ell(-3.6, -9.4, 3.0, 1.0, -22), '#FFF4DC', { o: 0.38, b: 0.5, cp: shell });
  }
  rim(q, shell, [[-8.0, -5.0], [-6.2, -9.0], [-2.0, -11.2], [2.6, -11.1]], '#FFE9C0', 0.35, 0.5);
}

// ---------------------------------------------------------------------------------------------------------------
// Capivara (sentada nos quartos, cabeça quadrada e cara de paz)
// ---------------------------------------------------------------------------------------------------------------

function capybara(q: Pen): void {
  const L = q.lite;
  const T = tones('#9E6C44');
  const D = tones('#86593A');
  // pata da frente de longe
  q.fill(q.path([[-6.4, -9.0], [-4.4, -9.0], [-4.5, -1.0], [-4.4, 0, 0.5], [-7.0, 0, 0.5], [-6.6, -1.2]]), T.shade, { gf: q.lg(-7, -9, -4, 0, [[0, T.shade], [1, T.deep]]) });
  // orelha de longe
  q.fill(q.ell(-2.6, -21.3, 0.75, 0.62), D.shade);
  // tronco: barril grande, peito projetado pra frente por cima das patas
  const bodyPts: SP[] = [
    [-4.8, -15.0],
    [-0.4, -16.4],
    [4.6, -14.4],
    [8.4, -10.4],
    [9.6, -5.2],
    [8.6, -1.2],
    [4.2, 0],
    [-1.6, -0.3],
    [-4.6, -2.0],
    [-6.6, -6.4],
    [-7.0, -10.8],
  ];
  const body = q.path(furEdge(bodyPts, 1, 5, 0.3, 2));
  solid(q, body, T, { cx: 1.4, cy: -8.4, r: 8.8 }, { core: 0.26, hl: 0.14 });
  // anca
  const haunch = q.ell(4.8, -4.8, 4.7, 4.5, -8);
  occl(q, 1.4, -5.6, 1.4, 3.8, body, 0.28, 12);
  solid(q, haunch, T, { cx: 4.8, cy: -5, r: 4.7 }, { core: 0.28, hl: 0.18 });
  const foot = q.path([[0.8, -1.2], [6.0, -1.6], [8.8, -0.9], [8.6, 0, 0.5], [0.6, 0, 0.5]]);
  q.fill(foot, D.base, { gf: q.lg(0, -1.6, 0, 0, [[0, D.light], [1, D.shade]]) });
  if (!L) q.line(q.path([[1.6, -0.8], [1.5, 0]], false) + q.path([[2.8, -0.9], [2.7, 0]], false), D.deep, 0.18, { o: 0.6 });
  // pelo grosso (fios curtos seguindo o corpo)
  if (!L) {
    const st: (readonly [number, number, number, number, number?])[] = [
      [7.6, -9.4, 115, 1.6, 0.32],
      [8.6, -6.2, 100, 1.5, 0.3],
      [5.0, -12.8, 140, 1.5, 0.3],
      [1.0, -14.4, 160, 1.4, 0.3],
      [5.4, -7.4, 120, 1.3, 0.28],
      [-5.6, -9.8, 100, 1.3, 0.28],
      [-3.0, -12.6, 130, 1.2, 0.28],
    ];
    tufts(q, st, T.deep, 0.35, body + haunch);
    tufts(q, st.map(([x, y, a, l, w]) => [x - 0.45, y - 0.3, a, l * 0.75, w] as const), T.lighter, 0.3, body + haunch);
  }
  // pata da frente de perto (embaixo do peito)
  const leg = q.path([[-4.6, -9.6], [-2.2, -9.4], [-2.4, -2.6], [-2.1, -0.9], [-2.3, 0, 0.5], [-5.2, 0, 0.5], [-5.0, -0.9], [-4.6, -2.8]]);
  q.fill(leg, T.base, { gf: q.lg(-4.8, 0, -2.2, 0, [[0, T.light], [0.5, T.base], [1, T.shade]]) });
  if (!L) {
    occl(q, -3.6, -9.2, 1.6, 0.9, leg, 0.3);
    q.line(q.path([[-4.4, -0.8], [-4.45, 0]], false) + q.path([[-3.4, -0.8], [-3.4, 0]], false), T.deep, 0.18, { o: 0.6 });
  }
  // cabeça grande, comprida e rombuda: linha de cima quase reta, focinho alto e reto na frente
  const headPts: SP[] = [
    [-1.6, -21.5],
    [-6.0, -21.2],
    [-10.4, -19.9],
    [-11.8, -18.6, 0.6],
    [-11.7, -15.8],
    [-10.6, -14.2, 0.6],
    [-7.6, -13.6],
    [-4.4, -13.5],
    [-1.2, -14.6],
    [0.5, -17.2],
    [0.2, -20.2],
  ];
  const head = q.path(headPts);
  occl(q, -2.4, -14.6, 3.8, 1.3, body, 0.35);
  solid(q, head, D, { cx: -5.4, cy: -17.6, r: 5.6 }, { grad: q.lg(-6, -21.5, -5, -13.5, [[0, D.light], [0.5, D.base], [1, D.shade]]), core: 0.22, hl: 0.16 });
  if (!L) {
    // bochecha (masseter) com volume, plano de cima do focinho iluminado, sombra sob a mandíbula
    q.fill(q.ell(-4.6, -16.4, 2.6, 1.9), D.lighter, { o: 0.2, b: 0.8, cp: head });
    q.fill(q.ell(-3.8, -14.6, 3.6, 0.9), D.deep, { o: 0.35, b: 0.6, cp: head });
    q.fill(q.ell(-7.8, -20.6, 3.4, 0.7, 10), D.lighter, { o: 0.32, b: 0.5, cp: head });
    tufts(q, [[-1.6, -20.6, -60, 1.0, 0.28], [0.0, -18.0, 0, 1.0, 0.28], [-2.4, -15.0, 110, 0.9, 0.26]], D.deep, 0.4, head);
  }
  // focinho: almofada escura na frente, narinas no alto, lábio partido
  q.fill(q.ell(-11.0, -17.6, 1.5, 2.2, -8), D.deep, { o: 0.5, b: L ? 0 : 0.5, cp: head });
  q.fill(q.taper([[-11.5, -19.0], [-11.0, -18.4]], [0.34, 0.16]) + q.taper([[-10.1, -19.4], [-9.8, -18.8]], [0.3, 0.14]), '#1E120A', { o: 0.85 });
  q.line(q.path([[-11.0, -17.9], [-11.1, -16.2], [-11.4, -15.4]], false) + q.path([[-11.1, -16.2], [-8.8, -15.1]], false), '#2A180C', 0.2, { o: 0.7 });
  // olhos no alto da cabeça, pálpebra pesada (cara de paz)
  for (const [x, y, r] of [
    [-8.5, -19.7, 0.42],
    [-5.2, -19.3, 0.72],
  ] as const) {
    petEye(q, x, y, r, { iris: '#3A2414', open: 0.72, look: [-0.2, 0.1] });
    q.fill(q.path([[x - r * 1.35, y - r * 0.05], [x, y - r * 1.3], [x + r * 1.35, y - r * 0.1], [x + r * 1.2, y - r * 0.55], [x, y - r * 0.42], [x - r * 1.2, y - r * 0.45]]), D.base, { gf: q.lg(x, y - r * 1.2, x, y, [[0, D.light], [1, D.base]]) });
    if (!L) q.line(q.path([[x - r * 1.2, y - r * 0.44], [x, y - r * 0.4], [x + r * 1.2, y - r * 0.52]], false), D.deep, 0.16, { o: 0.75 });
  }
  // orelha de perto (pequena e redonda, lá atrás)
  const ear = q.path([[-2.2, -21.0], [-1.7, -22.4], [-0.5, -22.3], [-0.1, -21.0]]);
  q.fill(ear, D.base, { gf: q.lg(-1, -22.4, -1, -21, [[0, D.light], [1, D.shade]]) });
  q.fill(q.ell(-1.1, -21.5, 0.5, 0.42), D.deep, { o: 0.5 });
  if (!L) {
    let d = '';
    for (const [x, y, a] of [
      [-11.4, -17.0, 200],
      [-11.3, -16.6, 170],
      [-10.4, -16.8, 205],
    ] as const) {
      const r = (a * Math.PI) / 180;
      d += q.path([[x, y], [x + Math.cos(r) * 1.6, y + Math.sin(r) * 1.6]], false);
    }
    q.line(d, '#2A1A10', 0.1, { o: 0.6 });
  }
  rim(q, head, [[-11.6, -16.4], [-11.2, -19.0], [-6.4, -21.0], [-1.8, -21.3]], '#FFE0C4', 0.3, 0.5);
}

// ---------------------------------------------------------------------------------------------------------------
// Bicho-preguiça (filhote abraçando: de frente, braços pra cima, máscara no rosto)
// ---------------------------------------------------------------------------------------------------------------

function sloth(q: Pen): void {
  const L = q.lite;
  const T = tones('#8D7A62');
  const F = tones('#E8DCC4');
  const stripe = '#3A2A20';
  const claw = '#E9DFC8';
  const claws = (x: number, y: number, dir: 1 | -1) => {
    let d = '';
    for (let i = 0; i < 3; i++) {
      const x0 = x + (i - 1) * 0.75;
      d += q.taper([[x0, y], [x0 + dir * 0.25, y + 1.0], [x0 - dir * 0.15, y + 1.8]], [0.42, 0.32, 0], { n: 6 });
    }
    q.fill(d, claw, { gf: q.lg(x, y, x, y + 1.8, [[0, '#FFF8E8'], [1, '#B8A88C']]) });
  };
  // pernas penduradas
  for (const x of [-3.2, 3.2]) {
    const lg = q.taper([[x * 0.8, -4.0], [x, -1.6], [x * 1.05, 0.2]], [2.4, 2.1, 1.7], { round: true });
    q.fill(lg, T.shade, { gf: q.lg(x - 1, -4, x + 1, 0, [[0, T.base], [1, T.shade]]) });
    claws(x * 1.05, 0.2, x < 0 ? -1 : 1);
  }
  // corpo desgrenhado
  const bodyPts: SP[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    bodyPts.push([Math.cos(a) * 6.2, -9.0 + Math.sin(a) * 8.0]);
  }
  const body = q.path(furEdge(bodyPts, 0, 12, 0.45, 1));
  solid(q, body, T, { cx: 0, cy: -9, r: 7 }, { core: 0.26, hl: 0.16 });
  if (!L) {
    const st: (readonly [number, number, number, number, number?])[] = [
      [-3.6, -11.0, 110, 1.6, 0.35],
      [3.4, -10.0, 70, 1.6, 0.35],
      [-1.0, -6.0, 95, 1.4, 0.32],
      [2.0, -4.6, 80, 1.4, 0.32],
      [-4.2, -5.4, 105, 1.3, 0.3],
    ];
    tufts(q, st, T.deep, 0.4, body);
    tufts(q, st.map(([x, y, a, l, w]) => [x - 0.4, y - 0.4, a, l * 0.75, w] as const), T.lighter, 0.35, body);
  }
  // braços erguidos (abraço), com as garras agarrando
  for (const sg of [-1, 1] as const) {
    const arm = q.taper([[sg * 4.4, -13.8], [sg * 7.4, -16.2], [sg * 9.4, -18.4]], [2.6, 2.2, 1.8], { round: true });
    if (!L) q.fill(q.ell(sg * 4.6, -13.2, 1.8, 1.0), '#000000', { o: 0.3, b: 0.6, cp: body });
    q.fill(arm, T.base, { gf: q.lg(sg * 4, -18, sg * 9, -13, [[0, T.light], [1, T.shade]]) });
    if (!L) tufts(q, [[sg * 6.6, -14.6, sg < 0 ? 120 : 60, 1.2, 0.32]], T.deep, 0.4, arm);
    claws(sg * 9.6, -18.6, sg);
  }
  // cabeça e máscara
  const headPts: SP[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    headPts.push([Math.cos(a) * 5.0, -19.2 + Math.sin(a) * 4.4]);
  }
  const head = q.path(furEdge(headPts, 7, 10, 0.4, 1));
  occl(q, 0, -14.6, 4.2, 1.2, body, 0.35);
  solid(q, head, T, { cx: 0, cy: -19.2, r: 4.8 }, { core: 0.22, hl: 0.18 });
  const mask = q.ell(0, -18.6, 4.0, 3.1);
  q.fill(mask, F.base, { gf: ballGrad(q, 0, -18.8, 4, F, { hot: 0.4 }), b: L ? 0 : 0.4 });
  for (const sg of [-1, 1]) {
    q.fill(q.taper([[sg * 0.9, -19.5], [sg * 2.4, -19.3], [sg * 3.9, -18.0]], [0.9, 1.25, 0.35], { round: true }), stripe, { o: 0.92 });
    petEye(q, sg * 1.7, -19.3, 0.55, { iris: '#1A0F0A', pupil: 'none', open: 0.9, rim: stripe });
  }
  q.fill(q.ell(0, -17.6, 0.85, 0.58), '#2A1E18', { gf: q.rg(-0.2, -17.8, 0.9, [[0, '#5A4A40'], [1, '#1E1410']]) });
  q.line(q.path([[-1.3, -16.7], [0, -16.0], [1.3, -16.7]], false), '#4A362A', 0.24, { o: 0.85 });
  if (!L) {
    q.fill(q.ell(-2.6, -17.0, 0.9, 0.5) + q.ell(2.6, -17.0, 0.9, 0.5), '#E8A0A0', { o: 0.35, b: 0.35 });
    tufts(q, [[-1.6, -22.8, -100, 1.1, 0.4], [0.2, -23.3, -85, 1.2, 0.4], [1.8, -22.8, -70, 1.0, 0.38]], T.deep, 0.6);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Axolote (num aquário redondo no colo; numa bolha d'água flutuando)
// ---------------------------------------------------------------------------------------------------------------

function axolotlBody(q: Pen): void {
  const L = q.lite;
  const T = tones('#F6A9C6');
  const G = tones('#E2457A');
  const gill = (x: number, y: number, ang: number, len: number, t: Tones) => {
    const a = (ang * Math.PI) / 180;
    const ex = x + Math.cos(a) * len;
    const ey = y + Math.sin(a) * len;
    const d = q.taper([[x, y], [(x + ex) / 2, (y + ey) / 2 - 0.2], [ex, ey]], [0.55, 0.5, 0.2], { round: true });
    q.fill(d, t.base, { gf: q.lg(x, y, ex, ey, [[0, t.shade], [1, t.light]]) });
    if (!L) {
      const items: [number, number, number, number, number][] = [];
      for (let i = 1; i <= 3; i++) {
        const px = x + (ex - x) * (i / 3.6);
        const py = y + (ey - y) * (i / 3.6);
        items.push([px, py, ang - 70, 0.8, 0.28], [px, py, ang + 70, 0.8, 0.28]);
      }
      tufts(q, items, t.light, 0.85);
    }
  };
  // guelras de longe e cauda com barbatana translúcida
  for (const a of [-115, -90]) gill(-4.6, -7.6, a, 2.2, tones(G.shade));
  const fin = q.path([[2.4, -6.8], [6.0, -7.8], [10.6, -7.4], [9.4, -5.8], [6.0, -3.6], [3.2, -3.6]]);
  q.fill(fin, T.light, { o: 0.6, gf: q.lg(2, -7, 10, -5, [[0, T.base], [1, mix(T.lighter, '#FFFFFF', 0.4)]]) });
  const tail = q.taper([[-0.6, -5.2], [2.8, -5.0], [6.0, -5.4], [9.4, -6.6]], [3.4, 3.0, 2.0, 0.4], { round: true });
  q.fill(tail, T.base, { gf: q.lg(0, -7, 0, -3.4, [[0, T.light], [0.5, T.base], [1, T.shade]]) });
  // patas
  for (const [x, y] of [
    [4.4, -3.9],
    [-2.0, -3.1],
  ] as const) {
    q.fill(q.taper([[x, y - 0.6], [x - 0.4, y + 0.7], [x - 0.9, y + 1.2]], [0.8, 0.65, 0.4], { round: true }), T.shade);
    if (!L) q.line(q.path([[x - 1.5, y + 1.3], [x - 0.9, y + 1.15], [x - 0.3, y + 1.4]], false), T.shade, 0.25);
  }
  // cabeça larga e achatada
  const head = q.path([[-3.0, -8.0], [-0.6, -7.6], [0.6, -5.6], [0.0, -3.4], [-2.6, -2.6], [-5.6, -3.0], [-7.0, -4.6], [-6.6, -6.6], [-5.0, -7.8]]);
  solid(q, head, T, { cx: -3.2, cy: -5.4, r: 3.6 }, { core: 0.2, hl: 0.3 });
  q.fill(q.ell(-3.6, -3.6, 2.6, 0.9), mix(T.base, '#FFF0F4', 0.5), { o: 0.6, b: L ? 0 : 0.4, cp: head });
  // guelras de perto (três penachos)
  for (const [a, len] of [
    [-112, 2.8],
    [-78, 3.1],
    [-44, 2.7],
  ] as const)
    gill(-0.4, -6.6, a, len, G);
  petEye(q, -5.6, -6.3, 0.4, { iris: '#1A0F0A', pupil: 'none', open: 1 });
  petEye(q, -3.3, -6.2, 0.5, { iris: '#1A0F0A', pupil: 'none', open: 1 });
  q.line(q.path([[-6.7, -4.6], [-5.2, -3.9], [-3.4, -4.1]], false), shade(T.base, -0.45), 0.2, { o: 0.85 });
  if (!L) q.fill(q.ell(-2.2, -4.6, 0.8, 0.45) + q.ell(-6.4, -5.2, 0.5, 0.35), '#FF6F9A', { o: 0.4, b: 0.3 });
}

function axolotl(q: Pen, pose: PetPoseDraw): void {
  const L = q.lite;
  if (pose === 'float') {
    // bolha d'água: o axolote nadando dentro, borda iridescente, reflexo e bolhinhas
    const cx = 0;
    const cy = -8.2;
    const r = 8.2;
    const bub = q.ell(cx, cy, r, r);
    q.fill(bub, '#9FE3FF', { o: 0.28, gf: q.rg(cx - 2, cy - 3, r * 1.1, [[0, '#E8FAFF'], [0.7, '#9FE3FF'], [1, '#58B8E8']]) });
    axolotlBody(q.sub(0.4, -3.4, 0.82));
    if (!L) {
      q.line(bub, '#FFFFFF', 0.45, { o: 0.55, gs: q.lg(cx - r, cy - r, cx + r, cy + r, [[0, '#FFFFFF'], [0.45, '#FF9AD5'], [0.75, '#8FE9FF'], [1, '#FFFFFF']]) });
      q.fill(q.taper([[cx - 5.6, cy - 3.4], [cx - 4.2, cy - 5.6], [cx - 1.8, cy - 7.0]], [0.4, 0.8, 0.3], { round: true }), '#FFFFFF', { o: 0.7 });
      q.fill(q.ell(cx + 4.6, cy + 4.4, 0.8, 0.6), '#FFFFFF', { o: 0.4 });
      q.line(q.ell(9.6, -15.4, 1.1, 1.1) + q.ell(-9.0, -2.4, 0.7, 0.7), '#CFF4FF', 0.22, { o: 0.7 });
    }
    return;
  }
  if (pose === 'arms') {
    // aquário redondo de vidro: água até 2/3, boca larga, o axolote dentro
    const cx = 0.6;
    const cy = -7.4;
    const r = 7.8;
    const bowl = q.path([[cx - 4.2, cy - r * 0.86], [cx - r * 0.95, cy - r * 0.3], [cx - r * 0.9, cy + r * 0.45], [cx - r * 0.5, cy + r * 0.92], [cx + r * 0.5, cy + r * 0.92], [cx + r * 0.9, cy + r * 0.45], [cx + r * 0.95, cy - r * 0.3], [cx + 4.2, cy - r * 0.86]]);
    q.fill(bowl, '#BFEAFF', { o: 0.18 });
    const water = q.path([[cx - r, cy - 5.0], [cx + r, cy - 5.0], [cx + r, cy + r + 1], [cx - r, cy + r + 1]]);
    q.fill(water, '#6CCBF2', { o: 0.45, cp: bowl, gf: q.lg(cx, cy - 3, cx, cy + r, [[0, '#A8E6FF'], [1, '#3A9AD0']]) });
    // pedrinhas no fundo
    q.fill(q.ell(cx - 2.6, cy + r * 0.8, 1.2, 0.6) + q.ell(cx + 0.2, cy + r * 0.85, 1.0, 0.5) + q.ell(cx + 2.8, cy + r * 0.78, 1.3, 0.6), '#C9B48A', { cp: bowl, o: 0.95 });
    axolotlBody(q.sub(cx + 0.6, cy + 1.0, 0.72));
    if (!L) {
      q.line(q.path([[cx - r * 0.95, cy - 5.0], [cx + r * 0.95, cy - 5.0]], false), '#FFFFFF', 0.25, { o: 0.6, cp: bowl });
      q.fill(q.taper([[cx - 5.6, cy - 3.6], [cx - 6.0, cy], [cx - 4.8, cy + 3.6]], [0.4, 0.9, 0.3], { round: true }), '#FFFFFF', { o: 0.55 });
      q.fill(q.ell(cx + 4.8, cy - 3.2, 0.5, 1.2, 20), '#FFFFFF', { o: 0.4 });
    }
    q.line(bowl, '#DDF4FF', 0.35, { o: 0.75 });
    q.fill(q.ell(cx, cy - r * 0.86, 4.2, 0.9), '#DDF4FF', { o: 0.5 });
    q.line(q.ell(cx, cy - r * 0.86, 4.2, 0.9), '#FFFFFF', 0.4, { o: 0.85 });
    return;
  }
  axolotlBody(q);
}

/** definição de cada bicho próprio */
export function drawCritter(id: string): PetDef {
  switch (id) {
    case 'dachshund':
      return defOf(1.1, { x0: -20.6, x1: 15, top: -19.3, cy: -10 }, 13, (q) => dachshund(q));
    case 'bunny':
      return defOf(0.95, { x0: -7, x1: 9.4, top: -24.4, cy: -12 }, 8, (q) => bunny(q));
    case 'hamster':
      return defOf(1.2, { x0: -5.2, x1: 4.6, top: -8.4, cy: -4 }, 4.6, (q) => hamster(q), { scale: { arms: 1.5 } });
    case 'turtle':
      return defOf(1.25, { x0: -13.2, x1: 10.4, top: -11.8, cy: -6 }, 10, (q) => turtle(q), { scale: { arms: 0.8 } });
    case 'capybara':
      return defOf(1.3, { x0: -12, x1: 9.8, top: -22.6, cy: -11 }, 10, (q) => capybara(q));
    case 'sloth':
      return defOf(1.0, { x0: -11, x1: 11, top: -24, cy: -12 }, 8, (q) => sloth(q));
    case 'axolotl':
      return defOf(1.0, { x0: -8.6, x1: 9.2, top: -16.4, cy: -8 }, 7, (q, pose) => axolotl(q, pose), { glowColor: '#9FE3FF' });
    default:
      return defOf(1, { x0: -5, x1: 5, top: -10, cy: -5 }, 5, (q) => q.fill(q.ell(0, -5, 5, 5), '#888888'));
  }
}

