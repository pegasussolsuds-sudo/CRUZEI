// Aves (dono: pets): arara-azul, papagaio-verdadeiro e fênix. Um desenho paramétrico por pose:
//   'shoulder' — empoleirada (origem = onde os pés agarram), corpo em pé, asa dobrada, cauda pendendo;
//   'float'    — voando (origem = chão imaginário embaixo), asas abertas pra cima, cauda pra trás.
// Pena em camadas (coberteiras em escama, rêmiges separadas com ponta escura), bico de papagaio com gancho e mandíbula,
// olho com anel de pele, pés zigodáctilos. A fênix troca pena por chama (núcleo claro, borda vermelha, brilho).

import type { AvatarStop } from '../types';

import type { PetDef, PetPoseDraw } from './pets';
import { glow, mix, petEye, rim, shade, solid, sparkles, tones, type Pen, type SP } from './pets-kit';

interface BirdSpec {
  k: number;
  body: string;
  belly: string;
  head: string;
  wing: string;
  /** ponta das rêmiges */
  tip: string;
  tail: string;
  /** comprimento da cauda (unidades, escala 1) */
  tailLen: number;
  beak: string;
  /** bico grande (arara) */
  bigBeak?: boolean;
  /** pele nua em volta do olho */
  eyeRing: string;
  iris: string;
  /** faixa amarela na base da mandíbula (arara-azul) */
  lappet?: string;
  /** testa (papagaio: azul) */
  forehead?: string;
  /** rosto (papagaio: amarelo) */
  face?: string;
  /** encontro da asa (papagaio: vermelho) */
  shoulder?: string;
  /** penas de fogo */
  fire?: boolean;
}

const SPECS: Record<string, BirdSpec> = {
  arara: { k: 1.12, body: '#2B47BC', belly: '#2A42AE', head: '#2E4CC4', wing: '#2440B0', tip: '#14267A', tail: '#2B48C2', tailLen: 10, beak: '#1E1E26', bigBeak: true, eyeRing: '#FFD43B', iris: '#2A1A10', lappet: '#FFC93A' },
  parrot: { k: 1.0, body: '#45B04E', belly: '#62C25A', head: '#4CB653', wing: '#2F9440', tip: '#2A57B4', tail: '#3FA548', tailLen: 5, beak: '#3A3A42', eyeRing: '#F2D7B0', iris: '#F08A24', forehead: '#4AA6E4', face: '#F6D43C', shoulder: '#E23B2E' },
  phoenix: { k: 1.12, body: '#FF7A1E', belly: '#FFC24A', head: '#FF8A2A', wing: '#FF5A1A', tip: '#D8261C', tail: '#FF6A1A', tailLen: 12, beak: '#FFD45A', eyeRing: '#FFE7A0', iris: '#FFB000', fire: true },
};

const FIRE: readonly AvatarStop[] = [
  [0, '#FFF6B8'],
  [0.35, '#FFC23A'],
  [0.7, '#FF6A1A'],
  [1, '#D8261C'],
];

/** chama (forma afilada ondulada) da base (x0,y0) até a ponta (x1,y1) */
function flame(q: Pen, x0: number, y0: number, x1: number, y1: number, w: number, o = 1): void {
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const nx = -(y1 - y0);
  const ny = x1 - x0;
  const n = Math.hypot(nx, ny) || 1;
  const wob = 0.18 * Math.hypot(x1 - x0, y1 - y0);
  const spine: SP[] = [[x0, y0], [mx + (nx / n) * wob, my + (ny / n) * wob], [x1, y1]];
  const d = q.taper(spine, [w, w * 0.75, 0], { n: 10 });
  q.fill(d, '#FF7A1A', { o, gf: q.lg(x0, y0, x1, y1, FIRE) });
  if (!q.lite) q.fill(q.taper(spine.slice(0, 2), [w * 0.45, w * 0.2], { n: 6 }), '#FFF6C8', { o: 0.7 * o, b: w * 0.2 });
}

/** coberteiras em escama (arcos claros) dentro de uma forma */
function scallops(q: Pen, rows: readonly (readonly [number, number, number, number])[], color: string, clip: string, o = 0.45): void {
  if (q.lite) return;
  let d = '';
  for (const [x0, y0, x1, y1] of rows) {
    const n = 4;
    for (let i = 0; i < n; i++) {
      const ax = x0 + ((x1 - x0) * i) / n;
      const ay = y0 + ((y1 - y0) * i) / n;
      const bx = x0 + ((x1 - x0) * (i + 1)) / n;
      const by = y0 + ((y1 - y0) * (i + 1)) / n;
      d += q.path([[ax, ay], [(ax + bx) / 2, (ay + by) / 2 + 0.55], [bx, by]], false);
    }
  }
  q.line(d, color, 0.22, { o, cp: clip });
}

/** rêmiges: penas compridas separadas em leque a partir de pontos de base, com a ponta mais escura */
function remiges(q: Pen, sp: BirdSpec, items: readonly (readonly [number, number, number, number])[], w: number): void {
  const W = tones(sp.wing);
  items.forEach(([x, y, ang, len], i) => {
    const a = (ang * Math.PI) / 180;
    const ex = x + Math.cos(a) * len;
    const ey = y + Math.sin(a) * len;
    if (sp.fire) {
      flame(q, x, y, ex, ey, w * 1.1, 0.95);
      return;
    }
    const d = q.taper([[x, y], [x + Math.cos(a) * len * 0.55, y + Math.sin(a) * len * 0.55], [ex, ey]], [w, w * 0.95, w * 0.35], { round: true });
    const c = i % 2 ? W.base : W.shade;
    q.fill(d, c, { gf: q.lg(x, y, ex, ey, [[0, c], [0.55, mix(c, sp.tip, 0.35)], [1, sp.tip]]) });
    if (!q.lite) q.line(q.path([[x, y], [x + Math.cos(a) * len * 0.85, y + Math.sin(a) * len * 0.85]], false), shade(sp.wing, 0.35), 0.12, { o: 0.45 });
  });
}

/** cabeça (centro hx,hy, raio r) olhando pra esquerda: rosto, olho com anel, bico com gancho */
function birdHead(q: Pen, sp: BirdSpec, hx: number, hy: number, r: number): void {
  const L = q.lite;
  const H = tones(sp.head);
  const head = q.path([[hx + r * 0.95, hy + r * 0.2], [hx + r * 0.6, hy - r * 0.85], [hx - r * 0.3, hy - r * 1.02], [hx - r * 1.0, hy - r * 0.35], [hx - r * 1.05, hy + r * 0.55], [hx - r * 0.2, hy + r * 1.05], [hx + r * 0.7, hy + r * 0.9]]);
  solid(q, head, H, { cx: hx, cy: hy, r }, { core: 0.25, hl: sp.fire ? 0.35 : 0.24 });
  if (sp.forehead) q.fill(q.ell(hx - r * 0.45, hy - r * 0.78, r * 0.75, r * 0.42, -15), sp.forehead, { cp: head, b: L ? 0 : r * 0.12 });
  if (sp.face) q.fill(q.ell(hx - r * 0.4, hy + r * 0.05, r * 0.72, r * 0.62), sp.face, { cp: head, b: L ? 0 : r * 0.14 });
  if (sp.fire && !L) {
    // crista de chama
    for (const [dx, a, l] of [
      [0.1, -100, 2.6],
      [0.5, -78, 3.2],
      [0.85, -55, 2.6],
    ] as const) {
      const x0 = hx + r * dx;
      const y0 = hy - r * 0.9;
      const rad = (a * Math.PI) / 180;
      flame(q, x0, y0, x0 + Math.cos(rad) * l, y0 + Math.sin(rad) * l, 0.7);
    }
  }
  // bico (mandíbula de cima com gancho, de baixo menor)
  const bs = sp.bigBeak ? 1.35 : 1;
  const bx = hx - r * 0.82;
  const by = hy - r * 0.05;
  const B = tones(sp.beak);
  const lower = q.path([[bx + 0.2 * bs, by + 0.9 * bs], [bx - 1.0 * bs, by + 1.0 * bs], [bx - 1.6 * bs, by + 1.7 * bs], [bx - 0.6 * bs, by + 2.3 * bs], [bx + 0.6 * bs, by + 1.8 * bs]]);
  q.fill(lower, B.shade, { gf: q.lg(bx, by + 0.9 * bs, bx, by + 2.3 * bs, [[0, B.base], [1, B.deep]]) });
  const upper = q.path([[bx + 0.5 * bs, by - 1.2 * bs], [bx - 1.0 * bs, by - 1.3 * bs], [bx - 2.2 * bs, by - 0.2 * bs], [bx - 2.4 * bs, by + 1.5 * bs, 0.5], [bx - 1.9 * bs, by + 2.0 * bs, 0.3], [bx - 1.6 * bs, by + 0.9 * bs], [bx - 0.6 * bs, by + 0.5 * bs], [bx + 0.6 * bs, by + 0.7 * bs]]);
  q.fill(upper, B.base, { gf: q.rg(bx - 0.8 * bs, by - 0.9 * bs, 2.6 * bs, [[0, B.lighter], [0.5, B.base], [1, B.deep]]) });
  if (!L) q.fill(q.ell(bx - 0.9 * bs, by - 0.6 * bs, 0.9 * bs, 0.3 * bs, -20), '#FFFFFF', { o: 0.3, b: 0.15 });
  if (sp.lappet) q.fill(q.taper([[bx + 0.7 * bs, by + 0.6 * bs], [bx + 0.1 * bs, by + 1.3 * bs], [bx - 0.6 * bs, by + 1.25 * bs]], [0.5, 0.55, 0.2], { round: true }), sp.lappet);
  // olho com anel de pele
  const ex = hx - r * 0.18;
  const ey = hy - r * 0.18;
  const er = r * 0.24;
  q.fill(q.ell(ex, ey, er * 1.85, er * 1.7), sp.eyeRing, { gf: q.rg(ex - er * 0.4, ey - er * 0.5, er * 2.2, [[0, shade(sp.eyeRing, 0.35)], [1, sp.eyeRing]]) });
  petEye(q, ex, ey, er, { iris: sp.iris, open: 1, pupilR: sp.iris === '#2A1A10' ? 0.4 : 0.42, look: [-0.15, 0], glow: sp.fire ? '#FFD060' : undefined });
  rim(q, head, [[hx - r * 0.9, hy + r * 0.2], [hx - r * 0.6, hy - r * 0.75], [hx + r * 0.2, hy - r * 1.0]], sp.fire ? '#FFF6C8' : '#FFFFFF', 0.28, 0.45);
}

/** pés zigodáctilos agarrando (em volta de x, no y do poleiro) */
function feet(q: Pen, x: number, y: number): void {
  const c = '#7E7A80';
  const d = q.taper([[x - 1.4, y - 0.9], [x - 1.7, y - 0.1], [x - 2.4, y + 0.2]], [0.45, 0.38, 0.22], { round: true }) + q.taper([[x + 0.2, y - 0.9], [x + 0.1, y - 0.1], [x - 0.6, y + 0.25]], [0.45, 0.38, 0.22], { round: true }) + q.taper([[x + 0.4, y - 0.6], [x + 1.2, y + 0.1], [x + 1.6, y + 0.3]], [0.4, 0.32, 0.2], { round: true });
  q.fill(d, c, { gf: q.lg(x, y - 1, x, y + 0.4, [[0, '#A09CA4'], [1, '#55505A']]) });
}

function perched(q: Pen, sp: BirdSpec): void {
  const L = q.lite;
  const Bd = tones(sp.body);
  const W = tones(sp.wing);
  const Tl = tones(sp.tail);
  const tl = sp.tailLen;
  // cauda pendendo (atrás do corpo e da asa)
  if (sp.fire) {
    flame(q, 1.2, -2.4, 3.0 + tl * 0.25, tl, 1.6);
    flame(q, 1.6, -2.0, 5.6 + tl * 0.2, tl * 0.8, 1.2, 0.9);
    flame(q, 0.6, -2.0, 0.6 + tl * 0.1, tl * 0.85, 1.1, 0.9);
  } else {
    const tail = q.taper([[1.0, -2.6], [2.2, 0.8], [3.0, tl * 0.5], [3.6, tl]], [2.4, 2.1, 1.5, 0.35], { round: true });
    q.fill(tail, Tl.base, { gf: q.lg(1, -2, 3.6, tl, [[0, Tl.base], [0.6, Tl.shade], [1, mix(Tl.shade, sp.tip, 0.5)]]) });
    if (!L) q.line(q.path([[1.6, -1.0], [2.7, tl * 0.5], [3.4, tl * 0.92]], false), Tl.lighter, 0.16, { o: 0.45, cp: tail });
  }
  // corpo em pé
  const bodyPts: SP[] = [
    [0.4, -10.8],
    [2.6, -8.8],
    [3.2, -5.2],
    [2.4, -2.0],
    [0.6, -0.4],
    [-1.6, -0.6],
    [-3.2, -2.6],
    [-3.8, -6.0],
    [-3.4, -8.8],
  ];
  const body = q.path(bodyPts);
  solid(q, body, Bd, { cx: -0.4, cy: -5.2, r: 4.2 }, { core: 0.3, hl: 0.2, grad: sp.fire ? q.lg(0, -10, 0, 0, [[0, '#FFB43A'], [0.6, sp.body], [1, '#E0401E']]) : undefined });
  q.fill(q.ell(-2.0, -4.0, 1.9, 3.2, 12), sp.belly, { o: 0.65, cp: body, b: L ? 0 : 0.8 });
  if (!L) scallops(q, [[-3.2, -7.6, -0.6, -7.2], [-3.4, -5.6, -0.8, -5.0], [-3.0, -3.4, -0.8, -2.8]], Bd.lighter, body, 0.35);
  feet(q, -0.4, 0);
  // asa dobrada: coberteiras em escama em cima, rêmiges compridas embaixo indo pra cauda
  remiges(q, sp, [
    [0.4, -4.6, 72, 6.6],
    [1.2, -4.8, 70, 6.2],
    [2.0, -5.0, 68, 5.6],
  ], 1.2);
  const wing = q.path([[-0.6, -9.0], [2.2, -8.4], [3.4, -5.0], [3.0, -1.6], [1.4, 0.4, 0.5], [0.0, -1.6], [-1.0, -4.4], [-1.4, -7.0]]);
  q.fill(wing, W.base, { gf: sp.fire ? q.lg(0, -9, 2, 0, FIRE) : q.lg(-1, -9, 3, 0, [[0, W.light], [0.55, W.base], [1, W.shade]]) });
  if (sp.shoulder) q.fill(q.ell(-0.2, -7.6, 1.0, 1.5, 20), sp.shoulder, { cp: wing });
  if (!L) {
    scallops(q, [[-1.0, -6.8, 2.6, -6.4], [-0.8, -4.6, 2.8, -4.0], [-0.2, -2.4, 2.6, -1.8]], sp.fire ? '#FFF2B0' : W.lighter, wing, 0.5);
    q.fill(q.ell(0.4, -3.6, 1.6, 4.4, 15), '#000000', { o: 0.22, b: 0.8, cp: body });
  }
  rim(q, wing, [[-0.4, -8.8], [2.0, -8.2], [3.2, -5.2]], sp.fire ? '#FFF6C8' : '#FFFFFF', 0.3, 0.45);
  birdHead(q, sp, -1.6, -11.3, 2.8);
}

function flying(q: Pen, sp: BirdSpec): void {
  const L = q.lite;
  const Bd = tones(sp.body);
  const W = tones(sp.wing);
  const Tl = tones(sp.tail);
  const tl = sp.tailLen;
  // asa de longe (atrás, mais escura)
  const farW = q.path([[-1.6, -10.2], [-2.8, -14.6], [-1.6, -18.6], [1.6, -21.0], [2.8, -19.8], [3.4, -17.0], [3.2, -13.6], [2.0, -10.4]]);
  q.fill(farW, W.shade, { gf: sp.fire ? q.lg(0, -10, 1, -21, FIRE) : q.lg(0, -10, 1, -21, [[0, W.shade], [1, mix(W.shade, sp.tip, 0.6)]]) });
  // cauda pra trás
  if (sp.fire) {
    flame(q, 3.6, -8.4, 4.2 + tl, -6.0 + tl * 0.2, 1.7);
    flame(q, 3.4, -7.6, 3.6 + tl * 0.85, -3.4 + tl * 0.3, 1.3, 0.9);
    flame(q, 3.8, -9.0, 4.6 + tl * 0.9, -10.6, 1.2, 0.85);
  } else {
    const tail = q.taper([[3.4, -8.0], [5.6, -7.4], [3.4 + tl * 0.8, -6.6 + tl * 0.15], [3.6 + tl, -6.2 + tl * 0.22]], [2.4, 2.2, 1.4, 0.35], { round: true });
    q.fill(tail, Tl.base, { gf: q.lg(3.4, -8, 3.6 + tl, -6, [[0, Tl.base], [0.6, Tl.shade], [1, mix(Tl.shade, sp.tip, 0.5)]]) });
  }
  // corpo na horizontal
  const body = q.path([[-3.6, -11.0], [0, -10.6], [3.6, -9.6], [5.4, -7.8], [4.0, -6.0], [0, -5.4], [-3.4, -6.0], [-5.0, -7.8]]);
  solid(q, body, Bd, { cx: 0, cy: -8.2, r: 4.6 }, { core: 0.3, hl: 0.2, grad: sp.fire ? q.lg(0, -11, 0, -5.4, [[0, '#FFB43A'], [0.6, sp.body], [1, '#E0401E']]) : undefined });
  q.fill(q.ell(-1.0, -6.4, 3.4, 1.2), sp.belly, { o: 0.6, cp: body, b: L ? 0 : 0.7 });
  // pés recolhidos
  q.fill(q.ell(0.6, -5.4, 1.0, 0.5, 10), '#7E7A80');
  // asa de perto aberta: rêmiges em leque na ponta, coberteiras em escama
  remiges(q, sp, [
    [5.2, -16.6, -40, 4.0],
    [5.6, -15.4, -25, 4.4],
    [5.8, -14.0, -10, 4.4],
    [5.6, -12.6, 5, 4.0],
    [4.8, -11.4, 20, 3.4],
  ], 1.15);
  const nearW = q.path([[-0.4, -9.8], [0.2, -14.6], [2.4, -18.2], [6.0, -20.0], [7.4, -19.4], [6.8, -16.6], [6.6, -13.6], [5.4, -11.0], [3.4, -9.6]]);
  q.fill(nearW, W.base, { gf: sp.fire ? q.lg(0, -10, 7, -20, FIRE) : q.lg(0, -10, 6, -19, [[0, W.light], [0.6, W.base], [1, W.shade]]) });
  if (sp.shoulder) q.fill(q.ell(1.0, -13.4, 0.9, 1.6, 30), sp.shoulder, { cp: nearW });
  if (!L) scallops(q, [[0.4, -12.6, 5.6, -12.0], [1.2, -15.2, 6.0, -14.4], [2.4, -17.6, 6.0, -17.4]], sp.fire ? '#FFF2B0' : W.lighter, nearW, 0.5);
  rim(q, nearW, [[0.0, -11.0], [1.0, -15.6], [3.4, -18.8], [6.4, -19.8]], sp.fire ? '#FFF6C8' : '#FFFFFF', 0.32, 0.45);
  birdHead(q, sp, -4.8, -10.8, 2.7);
}

function draw(q: Pen, sp: BirdSpec, pose: PetPoseDraw): void {
  if (sp.fire && !q.lite) glow(q, 0, pose === 'float' ? -11 : -5, 9, 9, '#FF9A2A', 0.3);
  if (pose === 'float') flying(q, sp);
  else perched(q, sp);
  if (sp.fire && !q.lite) sparkles(q, pose === 'float' ? [[-6, -16, 0.8], [9, -14, 0.6], [12, -4, 0.7]] : [[-5, -14, 0.7], [5, -10, 0.6], [5, 6, 0.6]], '#FFE9A0', 0.85);
}

export function drawBird(id: string): PetDef {
  const sp = SPECS[id] ?? SPECS.parrot;
  const k = sp.k;
  const tl = sp.tailLen;
  return {
    draw: (pen, pose) => draw(pen.sub(0, 0, k), sp, pose),
    // caixa do voo (o poleiro só usa a origem)
    box: { x0: -7.8 * k, x1: (4 + tl) * k, top: -21.5 * k, cy: -12 * k },
    shadowW: 5 * k,
    glowColor: sp.fire ? '#FFB040' : undefined,
    noGlow: !sp.fire,
  };
}

