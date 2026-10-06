// Bichos fantásticos (dono: pets): mini dragão, unicórnio, robô-cão e fantasminha. Mesmo acabamento dos de verdade
// (volume, materiais próprios, olhos com reflexo), com o "algo a mais" vindo do material: membrana translúcida e
// escama no dragão, crina pastel e chifre de ouro no unicórnio, plástico brilhante + luz no robô, translucidez no
// fantasma. Espaço local: origem no chão/poleiro, y pra baixo, virado pra esquerda.

import type { PetDef, PetPoseDraw } from './pets';
import { glow, happyEye, mix, petEye, rim, shade, solid, sparkles, tones, type Pen, type SP } from './pets-kit';

type Draw = (pen: Pen, pose: PetPoseDraw) => void;

function defOf(k: number, box: { x0: number; x1: number; top: number; cy: number }, shadowW: number, draw: Draw, extra: Partial<PetDef> = {}): PetDef {
  return {
    draw: (pen, pose) => draw(pen.sub(0, 0, k), pose),
    box: { x0: box.x0 * k, x1: box.x1 * k, top: box.top * k, cy: box.cy * k },
    shadowW: shadowW * k,
    ...extra,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Mini dragão (sentadinho, asas abertas atrás)
// ---------------------------------------------------------------------------------------------------------------

function wingMembrane(q: Pen, sh: readonly [number, number], wr: readonly [number, number], tips: readonly (readonly [number, number])[], bone: string, skin: string, o: number): void {
  // membrana: do ombro ao punho, de dedo em dedo (borda recortada em arcos) e de volta ao corpo
  const pts: SP[] = [[sh[0], sh[1]], [wr[0], wr[1], 0.3]];
  for (let i = 0; i < tips.length; i++) {
    pts.push([tips[i][0], tips[i][1], 0]);
    const nx = i + 1 < tips.length ? tips[i + 1] : [sh[0] + 1.2, sh[1] + 2.4];
    const mx = (tips[i][0] + nx[0]) / 2;
    const my = (tips[i][1] + nx[1]) / 2;
    const cx = (wr[0] + mx) / 2;
    const cy = (wr[1] + my) / 2;
    pts.push([mx + (cx - mx) * 0.28, my + (cy - my) * 0.28]);
  }
  pts.push([sh[0] + 1.2, sh[1] + 2.4]);
  const d = q.path(pts);
  q.fill(d, skin, { o, gf: q.lg(sh[0], sh[1], wr[0], wr[1] - 4, [[0, shade(skin, -0.15)], [1, shade(skin, 0.25)]]) });
  let bones = q.path([[sh[0], sh[1]], [wr[0], wr[1]]], false);
  for (const t of tips) bones += q.path([[wr[0], wr[1]], [t[0], t[1]]], false);
  q.line(bones, bone, 0.55, { o: 0.95 });
  if (!q.lite) q.fill(q.ell(wr[0], wr[1], 0.6, 0.6), shade(bone, 0.3));
}

function dragon(q: Pen): void {
  const L = q.lite;
  const T = tones('#1F9C88');
  const B = tones('#F3D27A');
  const memb = '#62D9C2';
  const horn = tones('#F4E6C8');
  // asas (atrás de tudo): a de longe menor e mais escura
  wingMembrane(q, [-0.6, -10.4], [-3.6, -16.4], [[-6.4, -14.8], [-5.8, -12.0], [-3.6, -10.6]], T.shade, shade(memb, -0.25), 0.8);
  wingMembrane(q, [1.4, -10.0], [5.0, -16.8], [[10.4, -15.2], [9.8, -11.6], [7.4, -9.2], [4.4, -8.4]], T.base, memb, 0.82);
  // cauda enrolada com ponta de seta
  const tail = q.taper([[2.2, -2.6], [5.4, -1.4], [7.8, -3.4], [7.8, -6.4], [6.0, -7.4]], [1.9, 1.5, 1.1, 0.7, 0.35], { round: true });
  q.fill(tail, T.base, { gf: q.lg(2, -1, 8, -7, [[0, T.shade], [0.5, T.base], [1, T.light]]) });
  q.fill(q.path([[6.4, -7.0], [4.6, -8.6, 0], [5.6, -6.2], [4.8, -5.2, 0]]), T.light);
  // corpo
  const bodyPts: SP[] = [
    [-1.0, -11.2],
    [1.6, -10.6],
    [3.2, -7.4],
    [3.4, -3.6],
    [2.2, -0.8],
    [-0.6, -0.2],
    [-2.8, -1.2],
    [-3.6, -4.4],
    [-3.2, -8.0],
  ];
  const body = q.path(bodyPts);
  solid(q, body, T, { cx: 0, cy: -5.6, r: 4 }, { core: 0.3, hl: 0.2 });
  // barriga em placas
  const belly = q.path([[-2.0, -9.6], [-0.4, -9.8], [0.4, -6.0], [0.2, -1.6], [-1.6, -0.6], [-2.9, -2.2], [-3.2, -5.6]]);
  q.fill(belly, B.base, { cp: body, gf: q.lg(-2, -10, 0, -1, [[0, B.lighter], [1, B.shade]]) });
  if (!L) {
    let d = '';
    for (const y of [-8.2, -6.6, -5.0, -3.4, -1.9]) d += q.path([[-3.4, y + 0.2], [-1.4, y + 0.5], [0.6, y]], false);
    q.line(d, B.deep, 0.18, { o: 0.55, cp: belly });
    // escamas: pontinhos de luz em escama no dorso
    let sc = '';
    for (const [x, y] of [
      [1.6, -8.4],
      [2.4, -6.6],
      [1.2, -5.0],
      [2.6, -4.2],
      [1.8, -2.4],
    ] as const)
      sc += q.path([[x - 0.5, y], [x, y + 0.4], [x + 0.5, y]], false);
    q.line(sc, T.lighter, 0.16, { o: 0.6, cp: body });
  }
  // espinhos do dorso
  let sp = '';
  for (const [x, y, a] of [
    [1.4, -10.4, -30],
    [2.8, -8.2, -5],
    [3.4, -5.6, 10],
    [3.2, -3.0, 30],
  ] as const) {
    const r = (a * Math.PI) / 180;
    sp += q.path([[x - Math.cos(r) * 0.6, y - Math.sin(r) * 0.6], [x + Math.sin(r) * 1.3 + 0.3, y - Math.cos(r) * 1.3], [x + Math.cos(r) * 0.6, y + Math.sin(r) * 0.6]]);
  }
  q.fill(sp, horn.base, { gf: q.lg(0, -11, 4, -2, [[0, horn.light], [1, horn.shade]]) });
  // coxa e pé, bracinhos com garras
  const thigh = q.ell(1.6, -3.0, 2.2, 2.6, -15);
  solid(q, thigh, T, { cx: 1.6, cy: -3, r: 2.4 }, { core: 0.3, hl: 0.25 });
  q.fill(q.path([[-1.4, -0.9], [2.6, -1.0], [3.0, 0, 0.5], [-1.8, 0, 0.5]]), T.shade);
  q.fill(q.taper([[-1.6, 0], [-2.2, -0.1]], [0.4, 0]) + q.taper([[-0.6, 0], [-1.2, -0.05]], [0.4, 0]), horn.base);
  const arm = q.taper([[-2.0, -7.6], [-3.2, -6.0], [-3.0, -4.8]], [1.1, 0.9, 0.7], { round: true });
  q.fill(arm, T.base, { gf: q.lg(-3, -8, -2, -4.6, [[0, T.light], [1, T.shade]]) });
  q.fill(q.taper([[-3.2, -4.8], [-3.7, -4.3]], [0.3, 0]) + q.taper([[-2.7, -4.6], [-3.0, -4.0]], [0.3, 0]), horn.base);
  // cabeça: focinho arredondado, chifres pra trás, babado na bochecha
  const hx = -1.4;
  const hy = -13.8;
  for (const [x0, y0, x1, y1, w] of [
    [0.2, -16.0, 3.0, -18.6, 0.75],
    [-1.4, -16.4, 0.4, -19.4, 0.65],
  ] as const) {
    const h = q.taper([[x0, y0], [(x0 + x1) / 2 + 0.3, (y0 + y1) / 2 + 0.3], [x1, y1]], [w, w * 0.7, 0], { n: 6 });
    q.fill(h, horn.base, { gf: q.lg(x0, y0, x1, y1, [[0, horn.shade], [1, horn.lighter]]) });
  }
  const head = q.path([[hx + 2.6, hy + 0.2], [hx + 2.0, hy - 2.2], [hx - 0.4, hy - 3.0], [hx - 2.6, hy - 2.2], [hx - 4.6, hy - 1.2], [hx - 5.4, hy + 0.4], [hx - 4.6, hy + 1.6], [hx - 1.8, hy + 2.4], [hx + 1.6, hy + 2.0]]);
  solid(q, head, T, { cx: hx - 0.8, cy: hy, r: 3.2 }, { core: 0.25, hl: 0.26 });
  q.fill(q.path([[hx - 4.8, hy + 1.2], [hx - 2.0, hy + 2.0], [hx + 0.4, hy + 1.6], [hx - 1.4, hy + 2.6], [hx - 4.0, hy + 2.0]]), B.base, { cp: head, o: 0.85 });
  // babado (orelha de dragão)
  const frill = q.path([[hx + 1.6, hy - 1.2], [hx + 4.2, hy - 2.6, 0], [hx + 3.4, hy - 0.8], [hx + 4.4, hy + 0.4, 0], [hx + 2.0, hy + 0.6]]);
  q.fill(frill, memb, { gf: q.lg(hx + 1.6, hy, hx + 4.4, hy - 2, [[0, T.base], [1, memb]]) });
  q.fill(q.ell(hx - 4.6, hy - 0.2, 0.35, 0.22, -20), T.deep);
  q.line(q.path([[hx - 5.0, hy + 1.0], [hx - 3.4, hy + 1.3], [hx - 2.2, hy + 0.8]], false), T.deep, 0.2, { o: 0.8 });
  petEye(q, hx - 1.4, hy - 0.9, 0.95, { iris: '#FFC23A', pupil: 'slit', open: 0.9, tilt: -8, look: [-0.15, 0.05], glow: L ? undefined : '#FFE08A' });
  if (!L) q.fill(q.taper([[hx - 2.6, hy - 2.2], [hx - 1.4, hy - 2.5], [hx - 0.2, hy - 2.1]], [0.15, 0.35, 0.15]), T.deep, { o: 0.6 });
  rim(q, head, [[hx - 5.0, hy - 0.4], [hx - 3.0, hy - 2.2], [hx, hy - 2.9]], '#E8FFF8', 0.3, 0.45);
  rim(q, body, [[-3.2, -7.6], [-1.0, -10.8], [1.4, -10.4]], '#E8FFF8', 0.25, 0.45);
}

// ---------------------------------------------------------------------------------------------------------------
// Unicórnio (pônei elegante, crina pastel, chifre de ouro em espiral)
// ---------------------------------------------------------------------------------------------------------------

const MANE = ['#FF9ACB', '#C7A2FF', '#8FD3FF', '#9EF0C8'];

function unicorn(q: Pen): void {
  const L = q.lite;
  const T = tones('#F7F4FF');
  const S = '#C9C2E8';
  const gold = tones('#E8B93A');
  const leg = (x: number, top: number, far: boolean) => {
    const pts: SP[] = [[x - 1.2, top], [x + 1.1, top], [x + 0.7, -5.0], [x + 0.6, -1.6], [x + 0.8, 0, 0.5], [x - 1.0, 0, 0.5], [x - 0.8, -1.6], [x - 0.8, -5.2]];
    const d = q.path(pts);
    q.fill(d, far ? S : T.base, { gf: far ? q.lg(x, top, x, 0, [[0, mix(S, T.base, 0.3)], [1, shade(S, -0.1)]]) : q.lg(x - 1, 0, x + 1, 0, [[0, T.lighter], [0.5, T.base], [1, S]]) });
    q.fill(q.path([[x - 0.95, -1.4], [x + 0.75, -1.4], [x + 0.85, 0, 0.4], [x - 1.05, 0, 0.4]]), far ? gold.shade : gold.base, { gf: q.lg(x - 1, -1.4, x + 1, 0, [[0, gold.lighter], [1, gold.shade]]) });
  };
  // pernas de longe, cauda
  leg(-3.6, -9.0, true);
  leg(7.6, -9.0, true);
  MANE.forEach((c, i) => {
    const d = q.taper([[8.4, -12.6 + i * 0.5], [11.4 + i * 0.3, -10.0 + i * 0.4], [11.6 - i * 0.4, -5.4 + i * 0.6], [13.0 - i * 0.6, -2.6 + i * 0.5]], [1.2, 1.3, 1.0, 0.2], { round: true });
    q.fill(d, c, { gf: q.lg(8, -12, 13, -2, [[0, shade(c, 0.25)], [1, c]]) });
  });
  // corpo
  const bodyPts: SP[] = [
    [-6.4, -14.6],
    [-2.0, -14.4],
    [4.0, -14.2],
    [7.6, -13.4],
    [8.8, -10.4],
    [8.2, -7.8],
    [5.4, -7.2],
    [0, -7.0],
    [-5.0, -7.6],
    [-7.4, -9.6],
    [-7.8, -12.6],
  ];
  const body = q.path(bodyPts);
  solid(q, body, T, { cx: 0.4, cy: -10.8, r: 8 }, { grad: q.lg(0, -14.6, 0.6, -7, [[0, '#FFFFFF'], [0.55, T.base], [1, S]]), core: 0.2, hl: 0.1 });
  // pescoço arqueado
  const neck = q.path([[-6.8, -13.2], [-8.2, -17.2], [-9.4, -20.4], [-7.2, -21.6], [-5.4, -18.4], [-3.4, -14.4]]);
  q.fill(neck, T.base, { gf: q.lg(-9, -20, -4, -14, [[0, '#FFFFFF'], [1, mix(T.base, S, 0.45)]]) });
  // pernas de perto
  leg(-5.6, -9.4, false);
  leg(6.0, -9.4, false);
  if (!L) {
    q.fill(q.ell(5.8, -10.2, 2.4, 2.8), S, { o: 0.35, b: 0.8, cp: body });
    q.fill(q.ell(-5.4, -10.4, 2.0, 2.2), S, { o: 0.3, b: 0.8, cp: body });
  }
  // crina pastel caindo no pescoço
  MANE.forEach((c, i) => {
    const off = i * 0.75;
    const d = q.taper([[-8.6 + off * 0.4, -22.2 + off * 0.2], [-6.6 + off, -19.8 + off * 0.5], [-5.0 + off, -16.8 + off * 0.5], [-3.6 + off * 0.8, -13.8 + off * 0.3]], [0.9, 1.25, 1.0, 0.3], { round: true });
    q.fill(d, c, { gf: q.lg(-8, -22, -3, -14, [[0, shade(c, 0.3)], [1, c]]) });
  });
  // cabeça
  const head = q.path([[-7.0, -24.0], [-6.6, -22.0], [-8.0, -20.2], [-10.6, -18.6], [-12.6, -18.8], [-13.2, -20.0], [-12.0, -22.4], [-9.6, -24.4]]);
  solid(q, head, T, { cx: -9.4, cy: -21.6, r: 3 }, { grad: q.lg(-11, -24.5, -9, -18.5, [[0, '#FFFFFF'], [0.6, T.base], [1, S]]), core: 0.2, hl: 0.15 });
  q.fill(q.ell(-12.2, -19.6, 1.3, 0.9, -15), '#F2C4D6', { o: 0.7, cp: head, b: L ? 0 : 0.3 });
  q.fill(q.ell(-12.5, -19.9, 0.28, 0.2, -20), '#8A6A8A');
  q.line(q.path([[-12.8, -19.0], [-11.8, -18.8]], false), '#8A6A8A', 0.16, { o: 0.7 });
  // orelha
  q.fill(q.path([[-7.8, -23.6], [-7.0, -26.6, 0.2], [-6.2, -23.2]]), T.base, { gf: q.lg(-7, -26, -7, -23, [[0, '#FFFFFF'], [1, S]]) });
  q.fill(q.path([[-7.5, -23.8], [-7.0, -25.8, 0.2], [-6.6, -23.6]]), '#F2C4D6', { o: 0.8 });
  // franja
  q.fill(q.taper([[-8.0, -24.4], [-9.2, -23.4], [-10.0, -22.4]], [0.9, 1.0, 0.2], { round: true }), MANE[0]);
  q.fill(q.taper([[-7.4, -24.2], [-8.2, -22.8], [-8.6, -21.8]], [0.7, 0.8, 0.2], { round: true }), MANE[1]);
  // olho grande com cílios
  petEye(q, -9.8, -21.6, 0.85, { iris: '#7A4FD0', open: 0.92, tilt: -10, look: [-0.2, 0.05] });
  if (!L) q.line(q.path([[-10.6, -22.4], [-11.2, -22.9]], false) + q.path([[-10.0, -22.6], [-10.3, -23.2]], false), '#3A2A4A', 0.16);
  // chifre em espiral
  const hornD = q.path([[-10.0, -23.8], [-9.2, -24.2], [-11.0, -30.2, 0.2], [-10.6, -24.0]]);
  q.fill(hornD, gold.base, { gf: q.lg(-10, -24, -11, -30, [[0, gold.shade], [0.5, gold.lighter], [1, gold.base]]) });
  if (!L) {
    let d = '';
    for (let i = 1; i <= 4; i++) {
      const y = -24.2 - i * 1.25;
      const x = -9.6 - i * 0.28;
      const w = 0.62 - i * 0.1;
      d += q.path([[x - w, y + 0.2], [x + w, y - 0.35]], false);
    }
    q.line(d, gold.deep, 0.16, { o: 0.65, cp: hornD });
    sparkles(q, [[-12.4, -29.0, 0.7], [11.4, -16.0, 0.6], [-14.0, -12.0, 0.5]], '#FFFFFF', 0.85);
  }
  rim(q, body, [[-7.4, -12.0], [-6.0, -14.4], [0, -14.4], [6.4, -13.8]], '#FFFFFF', 0.4, 0.5);
}

// ---------------------------------------------------------------------------------------------------------------
// Robô-cão (sentado: casco de plástico brilhante, juntas escuras, visor com olhos de LED)
// ---------------------------------------------------------------------------------------------------------------

function robotDog(q: Pen): void {
  const L = q.lite;
  const W = tones('#E9EDF3');
  const J = tones('#3A4152');
  const led = '#3FE6FF';
  const gloss = (d: string, x: number, y: number, rx: number, ry: number) => {
    if (!L) q.fill(q.ell(x, y, rx, ry, -20), '#FFFFFF', { o: 0.75, b: Math.min(rx, ry) * 0.5, cp: d });
  };
  // cauda-antena com luz na ponta
  q.line(q.path([[6.2, -3.8], [8.4, -6.0], [9.2, -9.0]], false), J.base, 0.5);
  if (!L) glow(q, 9.3, -9.4, 1.6, 1.6, led, 0.55);
  q.fill(q.ell(9.3, -9.4, 0.75, 0.75), led, { gf: q.rg(9.1, -9.6, 0.9, [[0, '#E8FDFF'], [1, led]]) });
  // pata de longe
  q.fill(q.path([[-4.4, -7.0], [-2.8, -7.0], [-2.9, -0.8], [-2.6, 0, 0.5], [-4.9, 0, 0.5], [-4.6, -0.8]]), J.base);
  // corpo (casco)
  const bodyPts: SP[] = [
    [-3.4, -12.8],
    [1.6, -12.4],
    [5.6, -9.8],
    [7.2, -5.8],
    [6.6, -1.8],
    [3.8, -0.4],
    [-1.6, -0.6],
    [-4.2, -2.8],
    [-4.8, -7.6],
    [-4.6, -10.8],
  ];
  const body = q.path(bodyPts);
  solid(q, body, W, { cx: 1.0, cy: -6.6, r: 6.4 }, { core: 0.28, hl: 0 });
  gloss(body, -1.6, -10.2, 2.6, 1.2);
  if (!L) {
    q.line(q.path([[-4.4, -7.0], [-1.0, -7.8], [3.4, -9.6], [5.6, -9.8]], false) + q.path([[0.6, -12.4], [0.2, -8.0]], false), shade(W.base, -0.3), 0.16, { o: 0.8, cp: body });
    // luz de coração no peito
    q.fill(q.path([[-2.6, -9.8], [-2.0, -10.4, 0.6], [-1.6, -9.8], [-1.2, -10.4, 0.6], [-0.6, -9.8], [-1.6, -8.8, 0]]), '#FF4FA0', { o: 0.95 });
    glow(q, -1.6, -9.6, 1.4, 1.2, '#FF4FA0', 0.4);
  }
  // coxa (disco com anel de junta) e pé
  const thigh = q.ell(3.6, -4.6, 3.4, 3.6);
  solid(q, thigh, W, { cx: 3.6, cy: -4.6, r: 3.5 }, { core: 0.3, hl: 0 });
  gloss(thigh, 2.6, -6.2, 1.4, 0.8);
  q.line(q.ell(3.6, -4.6, 1.5, 1.6), J.base, 0.45);
  q.fill(q.ell(3.6, -4.6, 0.6, 0.6), led, { o: 0.9 });
  const foot = q.path([[0.6, -1.4], [6.6, -1.6], [7.0, 0, 0.5], [0.4, 0, 0.5]]);
  q.fill(foot, J.base, { gf: q.lg(0, -1.6, 0, 0, [[0, J.light], [1, J.deep]]) });
  // pata da frente: segmentos com junta
  q.fill(q.path([[-2.6, -8.6], [-0.6, -8.4], [-0.8, -4.0], [-2.6, -4.2]]), W.base, { gf: q.lg(-2.6, 0, -0.6, 0, [[0, '#FFFFFF'], [1, W.shade]]) });
  q.fill(q.ell(-1.7, -4.0, 1.05, 0.9), J.base);
  q.fill(q.path([[-2.5, -3.6], [-0.9, -3.6], [-0.9, -1.0], [-2.5, -1.0]]), W.shade);
  q.fill(q.path([[-3.0, -1.2], [-0.4, -1.2], [-0.2, 0, 0.5], [-3.3, 0, 0.5]]), J.base);
  // pescoço e cabeça (caixa arredondada, visor escuro com olhos de LED felizes)
  q.fill(q.ell(-2.4, -12.8, 1.5, 1.0), J.base);
  const hx = -2.6;
  const hy = -16.6;
  const ear = (x: number, tilt: number) => {
    const d = q.taper([[x, hy - 2.6], [x + tilt * 0.5, hy - 4.0], [x + tilt, hy - 5.0]], [1.1, 0.9, 0.5], { round: true });
    q.fill(d, W.base, { gf: q.lg(x, hy - 2.6, x, hy - 5, [[0, W.shade], [1, '#FFFFFF']]) });
    q.fill(q.ell(x + tilt, hy - 5.0, 0.4, 0.4), led);
  };
  ear(0.6, 1.0);
  const head = q.path([[hx - 3.6, hy - 2.6, 0.6], [hx + 3.2, hy - 2.8, 0.6], [hx + 3.8, hy + 1.8, 0.6], [hx - 3.4, hy + 2.6, 0.6]]);
  solid(q, head, W, { cx: hx, cy: hy, r: 3.6 }, { core: 0.25, hl: 0 });
  gloss(head, hx - 1.6, hy - 2.0, 2.0, 0.7);
  ear(-4.0, -0.6);
  const visor = q.path([[hx - 4.2, hy - 1.4, 0.6], [hx + 1.4, hy - 1.6, 0.6], [hx + 1.6, hy + 1.8, 0.6], [hx - 4.0, hy + 2.0, 0.6]]);
  q.fill(visor, '#141826', { gf: q.lg(hx - 4, hy - 1.6, hx + 1.6, hy + 2, [[0, '#2A3044'], [1, '#0C0F18']]) });
  if (!L) glow(q, hx - 1.4, hy, 2.6, 1.4, led, 0.25);
  happyEye(q, hx - 2.8, hy - 0.1, 0.75, led);
  happyEye(q, hx - 0.2, hy - 0.2, 0.8, led);
  q.line(q.path([[hx - 2.0, hy + 1.0], [hx - 1.4, hy + 1.4], [hx - 0.8, hy + 1.0]], false), led, 0.22, { o: 0.9 });
  if (!L) q.fill(q.taper([[hx - 3.8, hy - 1.0], [hx - 2.4, hy - 1.3], [hx - 0.6, hy - 1.3]], [0.1, 0.32, 0.1]), '#FFFFFF', { o: 0.35 });
  rim(q, head, [[hx - 3.4, hy + 1.6], [hx - 3.5, hy - 2.4], [hx + 2.6, hy - 2.7]], '#FFFFFF', 0.5, 0.4);
}

// ---------------------------------------------------------------------------------------------------------------
// Fantasminha (translúcido, cauda ondulada, carinha fofa)
// ---------------------------------------------------------------------------------------------------------------

function ghost(q: Pen): void {
  const L = q.lite;
  const pts: SP[] = [
    [0, -14.2],
    [3.6, -12.8],
    [4.8, -9.0],
    [4.4, -5.0],
    [5.6, -2.6],
    [6.8, -0.6, 0.4],
    [4.4, -1.0],
    [3.0, 0.2, 0.4],
    [1.0, -1.2],
    [-1.2, -0.2, 0.4],
    [-2.8, -1.8],
    [-4.4, -3.4],
    [-4.8, -7.4],
    [-4.4, -11.6],
    [-2.6, -13.6],
  ];
  const d = q.path(pts);
  if (!L) q.fill(d, '#C9C2FF', { o: 0.35, b: 1.6 });
  q.fill(d, '#F4F2FF', { o: 0.78, gf: q.rg(-1.2, -10.4, 10, [[0, '#FFFFFF'], [0.55, '#ECE9FF'], [1, '#B9B2F0']]) });
  if (!L) {
    q.fill(q.ell(2.2, -4.0, 3.4, 4.0, -15), '#8E86D8', { o: 0.25, b: 1.0, cp: d });
    q.fill(q.ell(-1.8, -11.6, 2.0, 1.1, -20), '#FFFFFF', { o: 0.7, b: 0.5, cp: d });
  }
  // bracinhos acenando
  q.fill(q.taper([[-4.4, -7.0], [-5.8, -8.2], [-6.4, -9.4]], [1.0, 0.8, 0.5], { round: true }), '#ECE9FF', { o: 0.85 });
  q.fill(q.taper([[4.4, -6.8], [5.6, -7.4], [6.2, -8.4]], [1.0, 0.8, 0.5], { round: true }), '#E2DEFF', { o: 0.85 });
  // carinha
  for (const x of [-2.0, 1.0]) {
    q.fill(q.ell(x, -9.2, 0.85, 1.15), '#241E3A');
    q.fill(q.ell(x - 0.25, -9.6, 0.32, 0.38), '#FFFFFF');
    if (!L) q.fill(q.ell(x + 0.3, -8.7, 0.14, 0.14), '#FFFFFF', { o: 0.8 });
  }
  q.fill(q.ell(-3.0, -7.6, 0.8, 0.45) + q.ell(2.2, -7.6, 0.8, 0.45), '#FF8FB8', { o: 0.55, b: L ? 0 : 0.25 });
  q.fill(q.path([[-1.2, -7.4], [0.2, -7.4], [-0.5, -6.4, 0.5]]), '#3A2A4A');
  rim(q, d, [[-4.4, -6.0], [-4.4, -11.0], [-1.6, -14.0], [2.6, -13.4]], '#FFFFFF', 0.5, 0.5);
}

export function drawFantasy(id: string): PetDef {
  switch (id) {
    case 'dragon':
      return defOf(1.1, { x0: -7, x1: 10.6, top: -19.6, cy: -10 }, 6, (q) => dragon(q), { glowColor: '#7FFFD4' });
    case 'unicorn':
      return defOf(1.0, { x0: -13.4, x1: 13.4, top: -30.4, cy: -15 }, 11, (q) => unicorn(q), { scale: { arms: 0.62 } });
    case 'robot_dog':
      return defOf(1.3, { x0: -6.4, x1: 10, top: -22, cy: -11 }, 8, (q) => robotDog(q));
    case 'ghost':
      return defOf(1.0, { x0: -6.6, x1: 7, top: -14.4, cy: -7.4 }, 5, (q) => ghost(q), { glowColor: '#C9C2FF' });
    default:
      return defOf(1, { x0: -5, x1: 5, top: -10, cy: -5 }, 5, (q) => q.fill(q.ell(0, -5, 5, 5), '#888888'));
  }
}

