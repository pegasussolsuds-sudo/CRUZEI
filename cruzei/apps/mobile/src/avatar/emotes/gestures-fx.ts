// Partículas das animações (EmoteDef.fx): corações, beijo, notas, brilhos, confete, estrelas, bolhas, flash, fogos,
// "HA" e pétalas. Dono: gestos. Desenho contra a caneta dos efeitos (components/avatar/stage/fx-core.ts): o EmoteFx do
// palco grava uma SkPicture por quadro com a skiaPen, e a folha de prova roda o MESMO código no CanvasKit em node.
//
// Como funciona (sem estado, sem Math.random):
//   - cada efeito emite partículas em instantes fixos (início da janela + i/taxa, com um tremor sorteado por hash da
//     partícula): o quadro do instante t sabe sozinho quem está viva e em que idade, então pular quadros ou pausar não
//     muda nada e o mesmo t desenha sempre o mesmo quadro;
//   - a partícula sai da âncora (posição ATUAL, em px do canvas): quem sai da mão acompanha a mão;
//   - no máximo FX_MAX (32) vivas no total, divididas entre os efeitos pelo tamanho de cada um;
//   - gesto (sem loop): a vida encurta perto do fim pra todas sumirem antes do último quadro; em loop, as partículas do
//     ciclo anterior continuam até morrer;
//   - unidade de tamanho = unidade do viewBox do avatar (a âncora 'above' fica sempre 10 unidades acima do topo da
//     cabeça: a escala sai daí, então o mesmo desenho vale em qualquer tamanho de palco).
// ATENÇÃO (plugin de worklets): helper tem de vir ANTES de quem usa.

import { darken, hexRgb, lighten, rnd, smooth, type Pen, type Rgb } from '../../components/avatar/stage/fx-core';
import { SHAPES, svgCmds } from '../../components/avatar/stage/fx-shapes';
import { easeBack, easeOut } from '../pose';

import type { EmoteAnchor, EmoteDef, EmoteFxKind } from './types';

export type FxPoint = { x: number; y: number };
export type FxAnchors = Record<EmoteAnchor, FxPoint>;

/** teto de partículas vivas (todas as camadas de efeito da animação juntas) */
export const FX_MAX = 32;

/** vida de cada partícula (s) */
export const FX_LIFE: Record<EmoteFxKind, number> = {
  hearts: 1.6,
  kiss: 1.3,
  notes: 1.9,
  sparkles: 0.75,
  confetti: 2.0,
  stars: 1.7,
  bubbles: 2.3,
  flash: 0.4,
  fireworks: 1.7,
  haha: 1.2,
  petals: 2.4,
};

/** paletas (índice 0 = principal); `color` do efeito troca pela cor pedida */
export const FX_PALETTE: Record<EmoteFxKind, Rgb[]> = {
  hearts: [0xff2d7a, 0xff6fa5, 0xff1493],
  kiss: [0xe8245c, 0xff5c8a, 0xb0103e],
  notes: [0x7fff00, 0xff1493, 0xffd700, 0x00e5ff, 0xb98cff],
  sparkles: [0xfff3c4, 0xffffff, 0xffd700],
  confetti: [0x7fff00, 0xff1493, 0xffd700, 0x00e5ff, 0x9b5cff, 0xffffff],
  stars: [0xffd700, 0xfff1a8, 0xffffff],
  bubbles: [0xbfe9ff, 0xff9bd3, 0xfff59e, 0xb7a6ff],
  flash: [0xffffff, 0xfff6d8],
  fireworks: [0xff1493, 0x7fff00, 0xffd700, 0x00e5ff, 0xff6a00, 0x9b5cff],
  haha: [0xffd84a, 0xfff2b0, 0x5a2a00],
  petals: [0xffb3c9, 0xff8fb1, 0xffe3ec],
};

/** formas próprias das partículas (somadas às de fx-shapes; prefixo em_ pra não colidir no cache da caneta) */
const EM_OWN: Record<string, number[]> = {
  /** marca de beijo: lábio de cima com arco do cupido e lábio de baixo cheio */
  em_lips: svgCmds(
    'M-1,0 C-0.72,-0.46 -0.36,-0.66 -0.12,-0.44 Q0,-0.33 0.12,-0.44 C0.36,-0.66 0.72,-0.46 1,0 C0.55,-0.1 0.25,-0.02 0,-0.07 C-0.25,-0.02 -0.55,-0.1 -1,0 Z ' +
      'M-0.98,0.06 C-0.55,0.1 -0.25,0.13 0,0.11 C0.25,0.13 0.55,0.1 0.98,0.06 C0.72,0.58 0.32,0.7 0,0.7 C-0.32,0.7 -0.72,0.58 -0.98,0.06 Z',
  ),
};

/** tabela de formas que a caneta do EmoteFx recebe */
export const EMOTE_SHAPES: Record<string, number[]> = { ...SHAPES, ...EM_OWN };

/** letras do "HA" (traço, unidade: altura 1,3) */
const HA_CMDS: number[] = [
  // H
  0, -1.3, -0.62, 1, -1.3, 0.62, 0, -0.42, -0.62, 1, -0.42, 0.62, 0, -1.3, 0, 1, -0.42, 0,
  // A
  0, 0.22, 0.62, 1, 0.74, -0.62, 1, 1.26, 0.62, 0, 0.42, 0.16, 1, 1.06, 0.16,
];

const KIND_ID: Record<EmoteFxKind, number> = { hearts: 1, kiss: 2, notes: 3, sparkles: 4, confetti: 5, stars: 6, bubbles: 7, flash: 8, fireworks: 9, haha: 10, petals: 11 };

export interface FxEmitter {
  kind: EmoteFxKind;
  from: EmoteAnchor;
  /** janela em segundos dentro do ciclo */
  t0: number;
  t1: number;
  rate: number;
  life: number;
  /** máximo de vivas deste efeito */
  cap: number;
  pal: Rgb[];
  seed: number;
}

/** o que o quadro precisa (plano, sem funções: vai pra thread de UI) */
export interface EmoteFxSpec {
  D: number;
  loop: boolean;
  em: FxEmitter[];
}

/** spec das partículas de uma animação (JS, uma vez por animação); null = sem partículas */
export function emoteFxSpec(def: Pick<EmoteDef, 'dur' | 'loop' | 'fx'> | null | undefined): EmoteFxSpec | null {
  if (!def || !def.fx || !def.fx.length) return null;
  const D = Math.max(0.1, def.dur);
  const raw = def.fx.map((f, i) => {
    const life = FX_LIFE[f.kind] ?? 1.5;
    const c = f.color ? hexRgb(f.color, FX_PALETTE[f.kind][0]) : -1;
    const pal = c >= 0 ? [c, lighten(c, 0.45), darken(c, 0.3)] : FX_PALETTE[f.kind];
    return { kind: f.kind, from: f.from, t0: f.start * D, t1: f.end * D, rate: Math.max(0.1, f.rate), life, cap: 0, pal, seed: KIND_ID[f.kind] * 101 + i * 977 };
  });
  // vivas esperadas de cada efeito (taxa × vida, limitadas pela janela) → divide o teto proporcionalmente
  const want = raw.map((e) => Math.max(1, Math.ceil(e.rate * Math.min(e.life, e.t1 - e.t0 + e.life))));
  const tot = want.reduce((a, b) => a + b, 0);
  raw.forEach((e, i) => {
    e.cap = tot <= FX_MAX ? want[i] : Math.max(2, Math.floor((FX_MAX * want[i]) / tot));
  });
  // arredondamento com mínimo 2 pode passar do teto: corta do maior
  let sum = raw.reduce((a, e) => a + e.cap, 0);
  while (sum > FX_MAX) {
    let j = 0;
    for (let i = 1; i < raw.length; i++) if (raw[i].cap > raw[j].cap) j = i;
    raw[j].cap--;
    sum--;
  }
  return { D, loop: !!def.loop, em: raw };
}

// ---------------------------------------------------------------------------------------------------------------
// formas das partículas (worklets). Cada uma recebe o contexto do quadro (caneta, escala, rosto), posição da âncora em
// px, idade a (0..1), aleatórios fixos r1..r4 e paleta. Unidades = viewBox do avatar (× s = px).
// ---------------------------------------------------------------------------------------------------------------

/** contexto do quadro: caneta, px por unidade e o oval do rosto (as partículas desviam dele) */
interface FxCtx {
  P: Pen;
  s: number;
  fx: number;
  fy: number;
  frx: number;
  fry: number;
}

/** entra com estalo nos primeiros `k` da vida */
function popIn(a: number, k: number): number {
  'worklet';
  return a < k ? easeBack(a / k) : 1;
}

function fadeOut(a: number, from: number): number {
  'worklet';
  return 1 - smooth(from, 1, a);
}

function pick(pal: Rgb[], r: number): Rgb {
  'worklet';
  return pal[Math.min(pal.length - 1, Math.floor(r * pal.length))];
}

/**
 * x desviado do rosto: dentro do oval do rosto a partícula escorrega pra borda do lado dela (side −1/+1), contínuo — o
 * que sobe do peito contorna a cabeça em vez de passar por cima dos olhos
 */
function dodge(C: FxCtx, x: number, y: number, side: number, rad: number): number {
  'worklet';
  const ry = C.fry + rad * 0.6;
  const dy = (y - C.fy) / ry;
  if (dy <= -1 || dy >= 1) return x;
  const edge = (C.frx + rad * 0.8) * Math.sqrt(1 - dy * dy);
  const dx = x - C.fx;
  const sd = dx === 0 ? side : dx > 0 ? 1 : -1;
  return Math.abs(dx) >= edge ? x : C.fx + sd * edge;
}

function heart(C: FxCtx, x: number, y: number, size: number, rot: number, c: Rgb, al: number): void {
  'worklet';
  const P = C.P;
  P.glow(x, y, size * 1.9, c, 0.24 * al, 1);
  P.shape('heart', x, y, size, rot, { g: { t: 'r', cx: -0.35, cy: -0.5, r: 1.7, s: [[0, lighten(c, 0.55), al], [0.5, c, al], [1, darken(c, 0.32), al]] } });
  P.save();
  P.translate(x, y);
  P.rotate(rot);
  P.scale(size, size);
  P.oval(-0.46, -0.5, 0.26, 0.16, { c: 0xffffff, a: 0.8 * al });
  P.circle(0.5, -0.38, 0.07, { c: 0xffffff, a: 0.5 * al });
  P.restore();
}

function drawHearts(C: FxCtx, x0: number, y0: number, a: number, r1: number, r2: number, r3: number, r4: number, pal: Rgb[], side: number): void {
  'worklet';
  const s = C.s;
  const e = easeOut(a);
  const y = y0 - s * (3 + 26 * e);
  const size = s * (2.4 + 1.6 * r3) * popIn(a, 0.16);
  const x = dodge(C, x0 + s * (side * (7 + 14 * r1) * e + 2.4 * Math.sin(a * Math.PI * 2 * (0.8 + r2))), y, side, size);
  const rot = side * (6 + 14 * r4) + 8 * Math.sin(a * 7);
  heart(C, x, y, size, rot, pick(pal, r2 * 0.999), fadeOut(a, 0.62));
}

function drawKiss(C: FxCtx, x0: number, y0: number, a: number, r1: number, r2: number, r3: number, r4: number, pal: Rgb[], side: number): void {
  'worklet';
  const P = C.P;
  const s = C.s;
  const e = easeOut(a);
  const y = y0 - s * ((4 + 10 * r2) * e - 3 * a * a);
  const size = s * (2.6 + 1.2 * r3) * (0.55 + 0.45 * popIn(a, 0.2));
  const x = dodge(C, x0 + s * side * (10 + 14 * r1) * e, y, side, size);
  const rot = side * (8 + 16 * r4) - side * 10 * a;
  const al = fadeOut(a, 0.6);
  const c = pal[0];
  P.glow(x, y, size * 1.6, c, 0.2 * al, 1);
  P.shape('em_lips', x, y, size, rot, { g: { t: 'l', x1: 0, y1: -0.6, x2: 0, y2: 0.7, s: [[0, darken(c, 0.14), al], [0.45, c, al], [1, lighten(c, 0.28), al]] } });
  P.save();
  P.translate(x, y);
  P.rotate(rot);
  P.scale(size, size);
  P.path([0, -0.85, 0.06, 2, 0, 0.18, 0.85, 0.06], { c: darken(c, 0.45), a: 0.45 * al, w: 0.07 });
  P.oval(0.28, 0.38, 0.24, 0.09, { c: 0xffffff, a: 0.6 * al });
  P.oval(-0.42, -0.24, 0.16, 0.06, { c: 0xffffff, a: 0.4 * al });
  P.restore();
}

function drawNotes(C: FxCtx, x0: number, y0: number, a: number, r1: number, r2: number, r3: number, r4: number, pal: Rgb[], side: number): void {
  'worklet';
  const s = C.s;
  const e = easeOut(a);
  const y = y0 - s * (2 + 26 * e);
  const size = s * (2.7 + 1.6 * r3) * popIn(a, 0.18);
  const x = dodge(C, x0 + s * (side * (5 + 12 * r1) * e + 3.2 * Math.sin(a * Math.PI * 2 * (1 + r2))), y, side, size);
  const rot = side * 10 + 14 * Math.sin(a * Math.PI * 3 + r4 * 6);
  const al = fadeOut(a, 0.6);
  const c = pick(pal, r4 * 0.999);
  C.P.glow(x, y, size * 1.7, c, 0.28 * al, 1);
  C.P.shape(r2 > 0.62 ? 'notes2' : 'note', x, y, size, rot, { g: { t: 'l', x1: -1, y1: -1, x2: 1, y2: 1, s: [[0, lighten(c, 0.6), al], [0.6, c, al], [1, darken(c, 0.2), al]] } });
}

function glint(C: FxCtx, x: number, y: number, size: number, rot: number, c: Rgb, al: number): void {
  'worklet';
  const P = C.P;
  P.glow(x, y, size * 2.3, c, 0.34 * al, 1);
  P.shape('sparkle', x, y, size, rot, { g: { t: 'r', cx: 0, cy: 0, r: 1, s: [[0, 0xffffff, al], [0.45, lighten(c, 0.5), al], [1, c, 0.7 * al]] } });
  P.shape('glint', x, y, size * 0.55, rot + 45, { c: 0xffffff, a: 0.7 * al });
  P.circle(x, y, size * 0.15, { c: 0xffffff, a: al });
}

function drawSparkles(C: FxCtx, x0: number, y0: number, a: number, r1: number, r2: number, r3: number, r4: number, pal: Rgb[], side: number, wide: boolean): void {
  'worklet';
  const s = C.s;
  const ang = r1 * Math.PI * 2;
  const d = s * (wide ? 6 + 24 * r2 : 3 + 11 * r2) * easeOut(a);
  const y = y0 + Math.sin(ang) * d * 0.8 - s * 3 * a + (wide ? s * r3 * 16 : 0);
  const tw = Math.pow(Math.sin(Math.PI * a), 0.7);
  const size = s * (1.8 + 1.9 * r3) * tw;
  const x = dodge(C, x0 + Math.cos(ang) * d + (wide ? s * (r4 - 0.5) * 40 : 0), y, side, size * 0.6);
  glint(C, x, y, size, 45 * r4 + a * 80, pick(pal, r2 * 0.999), 0.95);
}

function drawConfetti(C: FxCtx, x0: number, y0: number, a: number, r1: number, r2: number, r3: number, r4: number, pal: Rgb[], side: number, life: number, spread: boolean): void {
  'worklet';
  const P = C.P;
  const s = C.s;
  const ts = a * life;
  // de cima ('above' fica no alto do canvas): estoura pouco pra cima, espalhado dos lados da cabeça; de outra âncora
  // (mão, peito): estouro alto
  const vx = (r1 - 0.5) * 40;
  const vy = spread ? -(4 + 10 * r2) : -(16 + 24 * r2);
  const g = 70;
  const vt = 15;
  // sobe, para e cai em velocidade-limite (papel), balançando
  const tStar = (vt - vy) / g;
  const dy = ts < tStar ? vy * ts + 0.5 * g * ts * ts : vy * tStar + 0.5 * g * tStar * tStar + vt * (ts - tStar);
  const dx = (vx * (1 - Math.exp(-2.2 * ts))) / 2.2 + 2.4 * Math.sin(ts * 5 + r3 * 6);
  const y = y0 + s * (dy + (spread ? 3 + 9 * r3 : 0));
  const x = dodge(C, x0 + s * (dx + (spread ? (r4 - 0.5) * 50 : 0)), y, side, s * 1.2);
  const al = fadeOut(a, 0.72);
  const c = pick(pal, r3 * 0.999);
  const flip = Math.cos(ts * (7 + 6 * r4) + r1 * 6);
  P.save();
  P.translate(x, y);
  P.rotate(r4 * 360 + ts * (160 + 260 * r2));
  P.scale(s, s * Math.max(0.18, Math.abs(flip)));
  if (r2 < 0.26) P.circle(0, 0, 1.25, { c, a: al });
  else P.rrect(-0.95, -1.8, 1.9, 3.6, 0.35, { c: flip > 0 ? c : darken(c, 0.28), a: al });
  P.restore();
}

function star(C: FxCtx, x: number, y: number, size: number, rot: number, c: Rgb, al: number): void {
  'worklet';
  C.P.glow(x, y, size * 2.1, c, 0.32 * al, 1);
  C.P.shape('star5', x, y, size, rot, { g: { t: 'r', cx: -0.2, cy: -0.3, r: 1.3, s: [[0, 0xffffff, al], [0.4, lighten(c, 0.35), al], [1, darken(c, 0.22), al]] } });
}

function drawStars(C: FxCtx, x0: number, y0: number, a: number, r1: number, r2: number, r3: number, r4: number, pal: Rgb[], side: number, rain: boolean): void {
  'worklet';
  const s = C.s;
  let x: number;
  let y: number;
  if (rain) {
    // chuva: nasce espalhada acima e dos lados da cabeça e cai devagar, balançando
    y = y0 + s * (-4 + r2 * 10 + 50 * a * (0.6 + 0.4 * a));
    x = dodge(C, x0 + s * ((r1 - 0.5) * 72 + 3 * Math.sin(a * Math.PI * 2 + r2 * 6)), y, side, s * 3);
  } else {
    // estouro: sai em leque pra cima e pros lados e cai
    const ang = -Math.PI / 2 + (r1 - 0.5) * 2.6;
    const d = s * (6 + 15 * r2) * easeOut(a);
    y = y0 + Math.sin(ang) * d + s * 12 * a * a;
    x = dodge(C, x0 + Math.cos(ang) * d, y, side, s * 3);
  }
  const tw = 0.78 + 0.22 * Math.sin(a * Math.PI * 6 + r3 * 6);
  const size = s * (2.0 + 2.0 * r3) * popIn(a, 0.14) * tw;
  star(C, x, y, size, r4 * 72 + a * 50, pick(pal, r4 * 0.999), fadeOut(a, rain ? 0.75 : 0.6));
}

function drawBubbles(C: FxCtx, x0: number, y0: number, a: number, r1: number, r2: number, r3: number, r4: number, pal: Rgb[], side: number): void {
  'worklet';
  const P = C.P;
  const s = C.s;
  const y = y0 - s * (2 + 24 * a);
  const pop = smooth(0.86, 1, a);
  const r = s * (2.0 + 2.2 * r3) * (0.6 + 0.4 * popIn(a, 0.2)) * (1 + 0.3 * pop);
  const x = dodge(C, x0 + s * (side * (7 + 14 * r1) * easeOut(a) + 2.6 * Math.sin(a * Math.PI * 3 + r2 * 6)), y, side, r);
  const al = 1 - pop;
  if (al <= 0.01) return;
  P.circle(x, y, r, { c: pick(pal, r4 * 0.999), a: 0.12 * al });
  P.ring(x, y, r, r, r * 0.13, [0xff9bd3, 0x9ff3ff, 0xfff59e, 0xc7a6ff, 0xff9bd3], a * 160 + r4 * 360, 0.85 * al);
  P.oval(x - r * 0.38, y - r * 0.42, r * 0.26, r * 0.15, { c: 0xffffff, a: 0.85 * al });
  P.circle(x + r * 0.42, y + r * 0.38, r * 0.08, { c: 0xffffff, a: 0.6 * al });
}

function drawFlash(C: FxCtx, x0: number, y0: number, a: number, r1: number, r2: number, r3: number, r4: number, pal: Rgb[], side: number, wide: boolean): void {
  'worklet';
  const P = C.P;
  const s = C.s;
  const ang = r1 * Math.PI * 2;
  const d = s * (wide ? 12 + 24 * r2 : 3 + 9 * r2);
  const y = y0 + Math.sin(ang) * d * 0.6 + (wide ? s * 10 * r3 : 0);
  const x = dodge(C, x0 + Math.cos(ang) * d * (wide ? 1.3 : 1), y, side, s * 4);
  const k = a < 0.18 ? a / 0.18 : Math.pow(1 - (a - 0.18) / 0.82, 2);
  const c = pick(pal, r4 * 0.999);
  P.glow(x, y, s * 8 * k, c, 0.55 * k, 1);
  P.shape('glint', x, y, s * (4 + 3 * r3) * k, 0, { c: 0xffffff, a: 0.95 * k });
  P.shape('glint', x, y, s * (2 + 1.5 * r3) * k, 45, { c: 0xffffff, a: 0.7 * k });
}

function drawFirework(C: FxCtx, x0: number, y0: number, a: number, r1: number, r2: number, r3: number, r4: number, pal: Rgb[], side: number): void {
  'worklet';
  const P = C.P;
  const s = C.s;
  // centro do estouro: dos lados da cabeça, da altura dela até acima dos ombros (nunca em cima do rosto)
  const bx = x0 + s * side * (21 + 16 * r2);
  const by = y0 + s * (3 + 22 * r3);
  const c = pick(pal, r4 * 0.999);
  const c2 = pick(pal, ((r4 + 0.37) % 1) * 0.999);
  const LAUNCH = 0.26;
  if (a < LAUNCH) {
    // foguete subindo com rastro de faíscas
    const p = easeOut(a / LAUNCH);
    const ry = by + s * 40 * (1 - p);
    P.path([0, bx, ry + s * 9 * (1 - p * 0.5), 1, bx, ry], { c: lighten(c, 0.5), a: 0.5, w: s * 0.55 });
    P.glow(bx, ry, s * 2.6, c, 0.65, 1);
    P.circle(bx, ry, s * 0.6, { c: 0xffffff, a: 0.95 });
    return;
  }
  const p = (a - LAUNCH) / (1 - LAUNCH);
  const R = s * (11 + 7 * r1);
  const al = Math.pow(1 - p, 1.2);
  if (p < 0.25) P.glow(bx, by, R * (1.1 - p * 2), 0xffffff, 0.6 * (1 - p * 4), 1);
  const n = 14;
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + r3 * 0.5;
    const pa = Math.max(0, p - 0.14);
    const e1 = easeOut(p);
    const e0 = easeOut(pa);
    const xa = bx + Math.cos(ang) * R * e0;
    const ya = by + Math.sin(ang) * R * e0 + s * 8 * pa * pa;
    const xb = bx + Math.cos(ang) * R * e1;
    const yb = by + Math.sin(ang) * R * e1 + s * 8 * p * p;
    const cc = i % 2 ? c : c2;
    P.path([0, xa, ya, 1, xb, yb], { c: cc, a: 0.8 * al, w: s * 0.55 });
    P.glow(xb, yb, s * 1.9, cc, 0.55 * al, 1);
    P.circle(xb, yb, s * 0.42, { c: lighten(cc, 0.7), a: al });
  }
}

function drawHaha(C: FxCtx, x0: number, y0: number, a: number, r1: number, r2: number, r3: number, pal: Rgb[], side: number, slot: number): void {
  'worklet';
  const P = C.P;
  const s = C.s;
  const e = easeOut(a);
  // vagas alternadas em volta da cabeça (dois lados, duas alturas): os "HA" não se amontoam
  const x = x0 + s * side * (15 + 5 * r1 + 3 * e + slot * 4);
  const y = y0 + s * (9 - slot * 9 - 4 * r2 - 8 * e);
  const size = s * (2.7 + 0.9 * r3) * popIn(a, 0.22);
  const al = fadeOut(a, 0.62);
  P.save();
  P.translate(x, y);
  P.rotate(side * (8 + 10 * r3) - side * 6 * a);
  P.scale(size, size);
  P.path(HA_CMDS, { c: pal[2], a: 0.6 * al, w: 0.66 });
  P.path(HA_CMDS, { c: pal[0], a: al, w: 0.38 });
  P.path(HA_CMDS, { c: pal[1], a: 0.75 * al, w: 0.12 });
  P.restore();
}

function drawPetals(C: FxCtx, x0: number, y0: number, a: number, r1: number, r2: number, r3: number, r4: number, pal: Rgb[], side: number): void {
  'worklet';
  const P = C.P;
  const s = C.s;
  const y = y0 + s * (-2 + r2 * 8 + 44 * a);
  const x = dodge(C, x0 + s * ((r1 - 0.5) * 70 + 5 * Math.sin(a * Math.PI * 3 + r2 * 6)), y, side, s * 2.5);
  const al = fadeOut(a, 0.78) * smooth(0, 0.08, a);
  const c = pick(pal, r3 * 0.999);
  const flip = Math.cos(a * Math.PI * 3 + r4 * 6);
  const size = s * (2.6 + 1.6 * r3);
  P.save();
  P.translate(x, y);
  P.rotate(r4 * 360 + a * 160 + 50 * Math.sin(a * 5));
  P.scale(size * Math.max(0.25, Math.abs(flip)), size);
  P.shape('petal', 0, 0, 1, 0, { g: { t: 'l', x1: 0, y1: -1, x2: 0, y2: 1, s: [[0, lighten(c, 0.5), al], [0.6, c, al], [1, darken(c, 0.2), al]] } });
  P.path([0, 0, -0.7, 2, 0.08, 0, 0, 0.75], { c: darken(c, 0.28), a: 0.35 * al, w: 0.08 });
  P.restore();
}

/** uma partícula: escolhe a forma pelo tipo (aleatórios fixos pela partícula e pela semente) */
function particle(C: FxCtx, e: FxEmitter, x0: number, y0: number, a: number, i: number, sd: number, life: number): void {
  'worklet';
  const r1 = rnd(i, sd + 1);
  const r2 = rnd(i, sd + 2);
  const r3 = rnd(i, sd + 3);
  const r4 = rnd(i, sd + 4);
  const side = i % 2 === 0 ? -1 : 1;
  const k = e.kind;
  const above = e.from === 'above';
  if (k === 'hearts') drawHearts(C, x0, y0, a, r1, r2, r3, r4, e.pal, side);
  else if (k === 'kiss') drawKiss(C, x0, y0, a, r1, r2, r3, r4, e.pal, side);
  else if (k === 'notes') drawNotes(C, x0, y0, a, r1, r2, r3, r4, e.pal, side);
  else if (k === 'sparkles') drawSparkles(C, x0, y0, a, r1, r2, r3, r4, e.pal, side, above);
  else if (k === 'confetti') drawConfetti(C, x0, y0, a, r1, r2, r3, r4, e.pal, side, life, above);
  else if (k === 'stars') drawStars(C, x0, y0, a, r1, r2, r3, r4, e.pal, side, above);
  else if (k === 'bubbles') drawBubbles(C, x0, y0, a, r1, r2, r3, r4, e.pal, side);
  else if (k === 'flash') drawFlash(C, x0, y0, a, r1, r2, r3, r4, e.pal, side, above);
  else if (k === 'fireworks') drawFirework(C, x0, y0, a, r1, r2, r3, r4, e.pal, side);
  else if (k === 'haha') drawHaha(C, x0, y0, a, r1, r2, r3, e.pal, side, Math.floor(i / 2) % 2);
  else if (k === 'petals') drawPetals(C, x0, y0, a, r1, r2, r3, r4, e.pal, side);
}

/**
 * desenha as partículas vivas de um efeito no instante tt (s desde o início do ciclo `cyc`); devolve quantas desenhou.
 * Vida encurtada perto do fim quando não há loop (todas morrem até D).
 */
function emitter(C: FxCtx, S: EmoteFxSpec, e: FxEmitter, A: FxAnchors, tt: number, cyc: number, budget: number): number {
  'worklet';
  if (budget <= 0 || tt < e.t0) return 0;
  const n = Math.max(1, Math.floor((e.t1 - e.t0) * e.rate + 0.999));
  const hi = Math.min(n - 1, Math.floor((tt - e.t0) * e.rate));
  const lo = Math.max(0, Math.floor((tt - e.t0 - e.life) * e.rate) - 1);
  const sd = e.seed + cyc * 7919;
  const an = A[e.from];
  if (!an || !Number.isFinite(an.x) || !Number.isFinite(an.y)) return 0;
  let drawn = 0;
  for (let i = hi; i >= lo && drawn < e.cap && drawn < budget; i--) {
    const born = e.t0 + (i + 0.6 * rnd(i, sd)) / e.rate;
    if (born > tt || born >= e.t1) continue;
    let life = e.life;
    if (!S.loop) life = Math.min(life, S.D - 0.04 - born);
    if (life < 0.22) continue;
    const a = (tt - born) / life;
    if (a < 0 || a >= 1) continue;
    particle(C, e, an.x, an.y, a, i, sd, life);
    drawn++;
  }
  return drawn;
}

/** oval do rosto em unidades do viewBox: meia-largura e meia-altura mínima (a âncora 'head' é o topo da cabeça) */
export const FX_FACE = { rx: 12, ry: 15 };

/**
 * Desenha o quadro das partículas no instante t (s desde o início da animação; ≤ 0 = nada). `still` (movimento
 * reduzido/pausa) não muda o desenho: o quadro é função só de t (o palco congela t). Devolve quantas desenhou.
 */
export function drawEmoteFx(P: Pen, S: EmoteFxSpec | null, t: number, A: FxAnchors, still: boolean): number {
  'worklet';
  void still;
  if (!S || !(t > 0) || !A) return 0;
  if (!S.loop && t >= S.D) return 0;
  const head = A.head;
  const ab = A.above;
  const mo = A.mouth;
  let s = head && ab ? (head.y - ab.y) / 10 : 0;
  if (!(s > 0.05) || !Number.isFinite(s)) s = 2;
  // rosto: do topo da cabeça até um pouco abaixo da boca, centrado na boca
  const fx = mo ? mo.x : head ? head.x : 0;
  const top = head ? head.y : 0;
  const bot = mo ? mo.y + 5 * s : top + 30 * s;
  const C: FxCtx = { P, s, fx, fy: (top + bot) / 2, frx: FX_FACE.rx * s, fry: Math.max(FX_FACE.ry * s, (bot - top) / 2) };
  const cycN = S.loop ? Math.floor(t / S.D) : 0;
  const tl = S.loop ? t - cycN * S.D : t;
  let total = 0;
  for (let j = 0; j < S.em.length; j++) {
    const e = S.em[j];
    total += emitter(C, S, e, A, tl, cycN, FX_MAX - total);
    // loop: as do ciclo anterior que ainda estão no ar
    if (S.loop && cycN > 0) total += emitter(C, S, e, A, tl + S.D, cycN - 1, FX_MAX - total);
  }
  return total;
}

/** instante (s) do quadro parado pra movimento reduzido e miniatura: o quadro-chave da animação */
export function emoteFxStillT(def: Pick<EmoteDef, 'dur' | 'keyK'>): number {
  return Math.max(0.01, def.keyK * def.dur);
}
