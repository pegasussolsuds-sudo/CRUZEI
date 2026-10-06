// Os 15 fundos do avatar, escritos contra a caneta de fx-core (Skia no palco e na folha de prova; SVG nas listas).
// Dono: efeitos.
//
// Cada fundo é uma cena ilustrada em três partes, pra o palco não regravar o que não mexe:
//   0 = fundo parado (céu, chão, prédios…), gravado UMA vez numa SkPicture no JS;
//   1 = o que anima (nuvens, estrelas, confete, holofote…), gravado por quadro na thread de UI;
//   2 = frente parada (cortina, montanhas na frente da aurora, linhas da grade), gravada uma vez.
// Coordenadas: a caixa do fundo (px no palco; unidades do viewBox no SVG), com `u` = largura/100 pra tamanhos, `g` =
// chão (sola dos pés) e `hz` = horizonte. Nada de Math.random: tudo sai de rnd() com semente fixa.
// Movimento reduzido: o palco desenha as três partes paradas no quadro `still`.


import { flagShapes, type FlagDef } from '../../../avatar/parts/flags';

import { TAU, clamp01, darken, fract, hexRgb, lighten, life, mixN, mixRgb, rnd, smooth, type FxGrad, type FxPaint, type FxStop, type Pen, type Rgb } from './fx-core';
import { svgCmds } from './fx-shapes';
import { STAGE_INNER, STAGE_TOP } from './layout';

/** ids com desenho (todos os fundos do catálogo menos 'none') */
export const BACKDROP_IDS = ['sunset', 'beach', 'hearts', 'garden', 'studio', 'pride', 'night_city', 'neon_grid', 'galaxy', 'aurora', 'confetti', 'gold_luxe', 'carnival', 'stage'];

export interface BackdropSpec {
  id: string;
  /** quadro parado (movimento reduzido, miniatura) */
  still: number;
  /** peças da bandeira já na caixa (fundo 'pride'): comandos, cor, evenodd */
  flag: { c: number[]; f: Rgb; eo: boolean }[];
}

/** caixa do fundo */
export interface BdFrame {
  w: number;
  h: number;
  /** chão (sola dos pés) */
  g: number;
  /** horizonte */
  hz: number;
  /** unidade de tamanho (largura / 100) */
  u: number;
  bust: boolean;
}

const STILL: Record<string, number> = { neon_grid: 0.35, aurora: 2.4, stage: 1.6, confetti: 2.2, carnival: 1.4 };

/** parâmetros de um fundo (JS, uma vez por visual e tamanho). null = sem fundo. */
export function backdropSpec(id: string | null | undefined, flag: FlagDef, box: { w: number; h: number }): BackdropSpec | null {
  if (!id || id === 'none') return null;
  const bid = BACKDROP_IDS.includes(id) ? id : 'sunset';
  let pieces: BackdropSpec['flag'] = [];
  if (bid === 'pride') {
    pieces = flagShapes(flag, { x: -box.w * 0.04, y: -box.h * 0.02, w: box.w * 1.08, h: box.h * 1.04 }).map((p) => ({ c: svgCmds(p.d), f: hexRgb(p.f, 0xffffff), eo: p.r === 'evenodd' }));
  }
  return { id: bid, still: STILL[bid] ?? 1.2, flag: pieces };
}

/** caixa do palco (box = canvas): chão e horizonte saem do enquadramento (layout.ts) */
export function stageBdFrame(box: { w: number; h: number }): BdFrame {
  'worklet';
  const bust = Math.abs(box.w - box.h) < 1;
  const g = bust ? box.h * 1.1 : box.h * (STAGE_TOP + (STAGE_INNER * 134.5) / 140);
  return { w: box.w, h: box.h, g, hz: bust ? box.h * 0.8 : box.h * 0.66, u: box.w / 100, bust };
}

/** caixa no SVG estático: o viewBox inteiro é o avatar (full: pés em 134 de 140) */
export function svgBdFrame(vb: { w: number; h: number }, bust: boolean): BdFrame {
  const g = bust ? vb.h * 1.1 : (vb.h * 134.5) / 140;
  return { w: vb.w, h: vb.h, g, hz: bust ? vb.h * 0.8 : vb.h * 0.68, u: vb.w / 100, bust };
}

// ---------------------------------------------------------------------------------------------------------------
// ajudantes (worklets; antes de quem usa)
// ---------------------------------------------------------------------------------------------------------------
function vgrad(y0: number, y1: number, s: FxStop[]): FxGrad {
  'worklet';
  return { t: 'l', x1: 0, y1: y0, x2: 0, y2: y1, s };
}

function band(P: Pen, B: BdFrame, y0: number, y1: number, s: FxStop[]): void {
  'worklet';
  P.rect(-1, y0, B.w + 2, y1 - y0, { g: vgrad(y0, y1, s) });
}

/** escurece as bordas (o avatar no meio fica em destaque) */
function vignette(P: Pen, B: BdFrame, a: number, c: Rgb = 0x000000): void {
  'worklet';
  const r = Math.max(B.w, B.h) * 0.8;
  P.rect(-1, -1, B.w + 2, B.h + 2, { g: { t: 'r', cx: B.w / 2, cy: B.h * 0.46, r, s: [[0, c, 0], [0.58, c, 0], [1, c, a]] } });
}

/** silhueta de morros/colinas a partir de y (picos sorteados), preenchida até `bottom` */
function ridge(P: Pen, B: BdFrame, y: number, amp: number, n: number, seed: number, fill: FxPaint, bottom?: number, sharp = false): void {
  'worklet';
  const bot = bottom == null ? B.h + 1 : bottom;
  const cmds: number[] = [0, -2, bot, 1, -2, y - amp * rnd(0, seed)];
  let px = -2;
  let py = y - amp * rnd(0, seed);
  for (let k = 1; k <= n; k++) {
    const x = (B.w + 4) * (k / n) - 2;
    const yy = y - amp * (0.25 + 0.75 * rnd(k, seed));
    if (sharp) cmds.push(1, (px + x) / 2, Math.min(py, yy) - amp * 0.35 * rnd(k, seed + 1), 1, x, yy);
    else cmds.push(2, (px + x) / 2, Math.min(py, yy) - amp * 0.45 * rnd(k, seed + 1), x, yy);
    px = x;
    py = yy;
  }
  cmds.push(1, B.w + 2, bot, 4);
  P.path(cmds, fill);
}

/** nuvem fofa: bolotas com luz em cima e sombra embaixo */
function cloud(P: Pen, x: number, y: number, s: number, c: Rgb, shade: Rgb, a: number): void {
  'worklet';
  const g: FxGrad = { t: 'l', x1: 0, y1: y - s * 1.1, x2: 0, y2: y + s * 0.6, s: [[0, lighten(c, 0.3), a], [0.6, c, a], [1, shade, a]] };
  P.circle(x - s * 1.2, y, s * 0.62, { g });
  P.circle(x - s * 0.45, y - s * 0.45, s * 0.85, { g });
  P.circle(x + s * 0.5, y - s * 0.3, s * 0.95, { g });
  P.circle(x + s * 1.35, y + s * 0.05, s * 0.6, { g });
  P.rrect(x - s * 1.8, y - s * 0.1, s * 3.75, s * 0.68, s * 0.34, { g });
}

/** estrela de fundo: ponto + brilho em cruz quando cintila */
function star(P: Pen, x: number, y: number, r: number, c: Rgb, a: number, glint: number): void {
  'worklet';
  if (a <= 0.01) return;
  P.circle(x, y, r, { c, a });
  if (glint > 0.05) P.shape('glint', x, y, r * 5 * glint, 0, { c: lighten(c, 0.5), a: a * 0.85 });
}

function confettiPiece(P: Pen, x: number, y: number, s: number, kind: number, c: Rgb, rot: number, flip: number, a: number): void {
  'worklet';
  P.save();
  P.translate(x, y);
  P.rotate(rot);
  P.scale(1, 0.2 + 0.8 * Math.abs(flip));
  const col = flip < 0 ? darken(c, 0.28) : c;
  if (kind === 0) P.rect(-s, -s * 0.55, s * 2, s * 1.1, { c: col, a });
  else if (kind === 1) P.circle(0, 0, s * 0.75, { c: col, a });
  else P.path([0, -s * 1.3, 0, 2, -s * 0.65, -s * 1.1, 0, 0, 2, s * 0.65, s * 1.1, s * 1.3, 0], { c: col, a, w: s * 0.5 });
  P.restore();
}

function heartShape(P: Pen, x: number, y: number, s: number, rot: number, cl: Rgb, cm: Rgb, cd: Rgb, a: number): void {
  'worklet';
  P.save();
  P.translate(x, y);
  P.rotate(rot);
  P.scale(s, s);
  P.shape('heart', 0, 0, 1, 0, { g: { t: 'r', cx: -0.35, cy: -0.45, r: 1.6, s: [[0, cl, 1], [0.5, cm, 1], [1, cd, 1]] }, a });
  P.save();
  P.translate(-0.45, -0.46);
  P.rotate(-35);
  P.oval(0, 0, 0.24, 0.12, { c: 0xffffff, a: 0.6 * a });
  P.restore();
  P.restore();
}

/** folha comprida com nervura (palmeira, pluma) */
function frond(P: Pen, x: number, y: number, len: number, wid: number, rot: number, c0: Rgb, c1: Rgb, a: number): void {
  'worklet';
  P.save();
  P.translate(x, y);
  P.rotate(rot);
  P.path([0, 0, 0, 3, len * 0.25, -wid, len * 0.7, -wid * 0.8, len, wid * 0.25, 3, len * 0.7, wid * 0.35, len * 0.3, wid * 0.7, 0, 0, 4], { g: { t: 'l', x1: 0, y1: -wid, x2: 0, y2: wid, s: [[0, c1, 1], [1, c0, 1]] }, a });
  P.path([0, 0, 0, 2, len * 0.5, -wid * 0.15, len, wid * 0.25], { c: darken(c0, 0.35), a: 0.6 * a, w: Math.max(0.3, wid * 0.08) });
  P.restore();
}

// ---------------------------------------------------------------------------------------------------------------
// fundos
// ---------------------------------------------------------------------------------------------------------------
/** Pôr do sol: céu em degradê quente, sol se pondo no mar, nuvens finas iluminadas por baixo, reflexo cintilando */
function bdSunset(P: Pen, B: BdFrame, t: number, part: number): void {
  'worklet';
  const { w, h, hz, u } = B;
  const sea1 = B.bust ? h + 1 : B.g - 7 * u;
  const sx = w * 0.7;
  const sr = 12 * u;
  if (part === 0) {
    band(P, B, -1, hz + 1, [[0, 0x24195a, 1], [0.38, 0x6e2c86, 1], [0.66, 0xe0527a, 1], [0.86, 0xff9a52, 1], [1, 0xffcf7a, 1]]);
    P.glow(sx, hz, 62 * u, 0xffb35a, 0.55);
    P.glow(sx, hz, 26 * u, 0xffe0a0, 0.6);
    P.circle(sx, hz - 3 * u, sr, { g: { t: 'r', cx: sx, cy: hz - 6 * u, r: sr * 1.1, s: [[0, 0xfff6d6, 1], [0.55, 0xffcf72, 1], [1, 0xff8a4a, 1]] } });
    band(P, B, hz, sea1 + 1, [[0, 0xb4507a, 1], [0.35, 0x6a3478, 1], [1, 0x2a1840, 1]]);
    // reflexo do sol na água: faixa clara que afina pra baixo
    P.path([0, sx - sr * 1.1, hz, 1, sx + sr * 1.1, hz, 1, sx + sr * 0.35, sea1, 1, sx - sr * 0.35, sea1, 4], { g: vgrad(hz, sea1, [[0, 0xffd28a, 0.65], [1, 0xff9a6a, 0.05]]), b: 2 });
    // morros distantes nos lados
    P.save();
    P.clipRRect(-1, -1, w * 0.36, h + 2, 0);
    ridge(P, B, hz + 0.5 * u, 9 * u, 4, 11, { c: 0x4a2860 }, hz + 2 * u);
    P.restore();
    P.save();
    P.clipRRect(w * 0.7, -1, w * 0.3 + 1, h + 2, 0);
    ridge(P, B, hz + 0.5 * u, 6 * u, 4, 12, { c: 0x55306a }, hz + 2 * u);
    P.restore();
    if (!B.bust) {
      // calçadão de areia escura onde a pessoa pisa
      P.path([0, -1, sea1 + 2 * u, 2, w * 0.5, sea1 - 2.5 * u, w + 1, sea1 + 2 * u, 1, w + 1, h + 1, 1, -1, h + 1, 4], { g: vgrad(sea1 - 2 * u, h, [[0, 0x6a3a5a, 1], [0.25, 0x3e2240, 1], [1, 0x1e1028, 1]]) });
      P.glowOval(sx, sea1 - 1 * u, w * 0.4, 3 * u, 0xffb070, 0.3, 2);
    }
    vignette(P, B, 0.35, 0x1a0820);
  } else if (part === 1) {
    // nuvens compridas atravessando devagar, iluminadas por baixo
    for (let i = 0; i < 4; i++) {
      const y = h * (0.12 + 0.11 * i) + rnd(i, 3) * 4 * u;
      const L = (30 + 18 * rnd(i, 4)) * u;
      const x = fract(rnd(i, 5) + t * (0.006 + 0.003 * i)) * (w + L * 2) - L;
      const c = i < 2 ? 0xff8ab4 : 0xffb07a;
      P.glowOval(x, y, L, 2.6 * u, c, 0.5);
      P.glowOval(x + L * 0.1, y + 0.9 * u, L * 0.7, 0.9 * u, 0xffe2b8, 0.55, 2);
    }
    // brilhos na água
    if (hz < sea1) {
      for (let i = 0; i < 10; i++) {
        const y = mixN(hz + 1.5 * u, sea1 - 1 * u, rnd(i, 7));
        const k = (y - hz) / Math.max(1, sea1 - hz);
        const x = sx + (rnd(i, 8) - 0.5) * sr * (2.2 - 1.4 * k);
        const tw = Math.max(0, Math.sin(t * (1.5 + rnd(i, 9) * 2) + i * 2.1));
        P.rrect(x - (2 + 3 * rnd(i, 10)) * u, y, (4 + 6 * rnd(i, 10)) * u, 0.5 * u, 0.25 * u, { c: 0xfff0c8, a: 0.75 * tw });
      }
    }
  }
}

/** Praia: céu claro, sol, mar turquesa com espuma indo e voltando, areia, coqueiro e nuvens passando */
function bdBeach(P: Pen, B: BdFrame, t: number, part: number): void {
  'worklet';
  const { w, h, hz, u } = B;
  const shore = B.bust ? h + 1 : hz + 0.11 * h;
  if (part === 0) {
    band(P, B, -1, hz + 1, [[0, 0x3e9ef0, 1], [0.6, 0x8fd2ff, 1], [1, 0xdff4ff, 1]]);
    P.glow(w * 0.82, h * 0.12, 34 * u, 0xfff6c8, 0.75);
    P.circle(w * 0.82, h * 0.12, 6 * u, { c: 0xfffbe8 });
    band(P, B, hz, shore + 1, [[0, 0x1b7fc8, 1], [0.5, 0x22b0d0, 1], [1, 0x52dccc, 1]]);
    P.rect(-1, hz - 0.3 * u, w + 2, 0.6 * u, { c: 0xffffff, a: 0.4 });
    if (!B.bust) {
      P.path([0, -1, shore + 1.5 * u, 2, w * 0.35, shore - 1 * u, w * 0.6, shore + 0.5 * u, 2, w * 0.85, shore + 1.8 * u, w + 1, shore, 1, w + 1, h + 1, 1, -1, h + 1, 4], { g: vgrad(shore - u, h, [[0, 0xd8b98a, 1], [0.12, 0xf2d8a6, 1], [1, 0xe6bf86, 1]]) });
      // grãos e sombras suaves na areia
      for (let i = 0; i < 9; i++) P.glowOval(w * rnd(i, 21), mixN(shore + 4 * u, h, rnd(i, 22)), (6 + 6 * rnd(i, 23)) * u, 1.2 * u, 0xc79a62, 0.25);
      P.glowOval(w * 0.5, B.g, 18 * u, 2.4 * u, 0x9a7044, 0.35);
    }
    // coqueiro à esquerda
    const bx = w * 0.06;
    const by = B.bust ? h + 2 : h + 1;
    const tx = w * 0.17;
    const ty = h * (B.bust ? 0.22 : 0.3);
    P.path([0, bx - 2.4 * u, by, 3, bx, by - (by - ty) * 0.5, tx - 6 * u, ty + (by - ty) * 0.25, tx - 1.1 * u, ty, 1, tx + 1.1 * u, ty, 3, tx - 3.6 * u, ty + (by - ty) * 0.25, bx + 4 * u, by - (by - ty) * 0.5, bx + 2.6 * u, by, 4], { g: { t: 'l', x1: bx - 3 * u, y1: 0, x2: bx + 3 * u, y2: 0, s: [[0, 0x6a4424, 1], [0.6, 0x9a6a3e, 1], [1, 0x5a3a20, 1]] } });
    for (let k = 0; k < 7; k++) {
      const ang = -170 + k * 30 + (rnd(k, 31) - 0.5) * 14;
      frond(P, tx, ty, (17 + 5 * rnd(k, 32)) * u, 3.4 * u, ang, 0x1f7a3a, 0x5cc45a, 1);
    }
    P.circle(tx - 1.2 * u, ty + 1.6 * u, 1.4 * u, { c: 0x6a4a1e });
    P.circle(tx + 1.2 * u, ty + 1.9 * u, 1.3 * u, { c: 0x7a5a26 });
    vignette(P, B, 0.18, 0x0a3050);
  } else if (part === 1) {
    for (let i = 0; i < 3; i++) {
      const s = (4.5 + 2 * rnd(i, 41)) * u;
      const x = fract(rnd(i, 42) + t * 0.01 * (1 + i * 0.4)) * (w + s * 8) - s * 4;
      cloud(P, x, h * (0.1 + 0.12 * i), s, 0xffffff, 0xcfe4f4, 0.95);
    }
    if (!B.bust) {
      // espuma: linha ondulada que vai e volta na areia
      const k = 0.5 + 0.5 * Math.sin(t * 0.8);
      const y = shore + (0.5 + 2.4 * k) * u;
      const cm: number[] = [];
      for (let q = 0; q <= 10; q++) cm.push(q ? 1 : 0, (w * q) / 10, y + Math.sin(q * 1.7 + t * 1.3) * 0.8 * u);
      P.path(cm, { c: 0xffffff, a: 0.75 * (1 - k * 0.5), w: 0.9 * u });
      P.path(cm, { c: 0x9ae8e0, a: 0.35, w: 2.6 * u });
    }
    for (let i = 0; i < 8; i++) {
      const tw = Math.max(0, Math.sin(t * (1.2 + rnd(i, 51)) + i * 2.3));
      P.rrect(w * rnd(i, 52), mixN(hz + u, shore - u, rnd(i, 53)), 3 * u, 0.45 * u, 0.2 * u, { c: 0xffffff, a: 0.7 * tw });
    }
  }
}

/** Corações: degradê rosado, corações grandes desfocados ao fundo e coraçõezinhos subindo */
function bdHearts(P: Pen, B: BdFrame, t: number, part: number): void {
  'worklet';
  const { w, h, u } = B;
  if (part === 0) {
    P.rect(-1, -1, w + 2, h + 2, { g: { t: 'r', cx: w / 2, cy: h * 0.42, r: Math.max(w, h) * 0.85, s: [[0, 0xff9ccc, 1], [0.45, 0xe0408e, 1], [1, 0x5e1246, 1]] } });
    for (let i = 0; i < 6; i++) {
      const x = w * rnd(i, 61);
      const y = h * (0.1 + 0.8 * rnd(i, 62));
      const s = (10 + 9 * rnd(i, 63)) * u;
      P.save();
      P.translate(x, y);
      P.scale(s, s);
      P.shape('heart', 0, 0, 1, (rnd(i, 64) - 0.5) * 40, { c: 0xffd0e6, a: 0.14 });
      P.restore();
    }
    P.glow(w / 2, h * 0.45, 45 * u, 0xffe6f2, 0.35);
    vignette(P, B, 0.35, 0x3a0828);
  } else if (part === 1) {
    for (let i = 0; i < 14; i++) {
      const [ph, cyc] = life(t, 7 + rnd(i, 1) * 4, rnd(i, 2));
      const x0 = w * (0.04 + 0.92 * rnd(i * 3 + cyc, 3));
      const x = x0 + Math.sin(t * 0.9 + i * 1.7) * 3 * u;
      const y = h + 6 * u - ph * (h + 12 * u);
      const s = (1.8 + 2.4 * rnd(i, 4)) * u;
      const a = smooth(0, 0.1, ph) * (1 - smooth(0.85, 1, ph)) * (0.55 + 0.45 * rnd(i, 5));
      P.glow(x, y, s * 2.2, 0xff5aa7, 0.3 * a, 1);
      heartShape(P, x, y, s, Math.sin(t + i) * 15, 0xffc2dc, 0xff4f9a, 0xc2185b, a);
    }
  }
}

/** Jardim: céu de manhã, copas ao longe, cerca viva, gramado, arbustos floridos e raios de sol com pólen */
function bdGarden(P: Pen, B: BdFrame, t: number, part: number): void {
  'worklet';
  const { w, h, hz, u } = B;
  if (part === 0) {
    band(P, B, -1, hz, [[0, 0x9cd6f2, 1], [0.6, 0xd9f1e6, 1], [1, 0xf5f0d4, 1]]);
    ridge(P, B, hz - 9 * u, 8 * u, 7, 71, { g: vgrad(hz - 18 * u, hz, [[0, 0x9ccfb0, 1], [1, 0x7bb894, 1]]) }, hz + 2 * u);
    ridge(P, B, hz - 2 * u, 6 * u, 9, 72, { g: vgrad(hz - 9 * u, hz + 3 * u, [[0, 0x5aa86a, 1], [1, 0x2f7a42, 1]]) }, hz + 3 * u);
    band(P, B, hz + 2 * u, h + 1, [[0, 0x6fbe5e, 1], [0.5, 0x58a84a, 1], [1, 0x3a8434, 1]]);
    if (!B.bust) P.glowOval(w / 2, B.g, 20 * u, 2.6 * u, 0x24561e, 0.4);
    // arbustos floridos nos cantos
    for (let side = 0; side < 2; side++) {
      const cx = side ? w * 0.94 : w * 0.06;
      const cy = B.bust ? h * 0.98 : hz + 0.16 * h;
      for (let k = 0; k < 4; k++) {
        const bx = cx + (k - 1.5) * 6 * u * (side ? -1 : 1);
        const by = cy - (k % 2) * 4 * u;
        const r = (8 + 3 * rnd(k + side * 7, 73)) * u;
        P.circle(bx, by, r, { g: { t: 'r', cx: bx - r * 0.3, cy: by - r * 0.4, r: r * 1.3, s: [[0, 0x6cc45c, 1], [0.6, 0x3a8e3e, 1], [1, 0x245e2a, 1]] } });
      }
      for (let k = 0; k < 7; k++) {
        const fx = cx + (rnd(k + side * 11, 74) - 0.5) * 22 * u;
        const fy = cy - 9 * u + rnd(k + side * 11, 75) * 10 * u;
        const col = [0xff7aa8, 0xffffff, 0xffd84a, 0xff9ad0][k % 4];
        P.shape('flower', fx, fy, 1.7 * u, rnd(k, 76) * 72, { c: col });
        P.circle(fx, fy, 0.6 * u, { c: k % 4 === 2 ? 0xff8a3a : 0xffd84a });
      }
    }
    vignette(P, B, 0.2, 0x0e3a1a);
  } else if (part === 1) {
    // raios de sol entrando na diagonal, respirando devagar
    for (let k = 0; k < 3; k++) {
      const x = w * (0.1 + 0.22 * k);
      const a = (0.1 + 0.05 * Math.sin(t * 0.6 + k * 1.9)) * (k === 1 ? 1.3 : 1);
      P.path([0, x, -1, 1, x + 7 * u, -1, 1, x + 42 * u, h, 1, x + 24 * u, h, 4], { g: { t: 'l', x1: x, y1: 0, x2: x + 30 * u, y2: h, s: [[0, 0xfffbe0, a], [1, 0xfffbe0, 0]] }, b: 2 });
    }
    for (let i = 0; i < 10; i++) {
      const x = w * rnd(i, 81) + Math.sin(t * 0.5 + i * 2) * 4 * u;
      const y = h * (0.15 + 0.7 * rnd(i, 82)) + Math.cos(t * 0.4 + i) * 3 * u;
      const tw = 0.5 + 0.5 * Math.sin(t * 1.3 + i * 1.7);
      P.glow(x, y, 1.6 * u, 0xfff2a0, 0.7 * tw, 1);
    }
  }
}

/** Estúdio: fundo infinito cinza, luz de recorte atrás, softboxes nos lados, piso com poça de luz */
function bdStudio(P: Pen, B: BdFrame, t: number, part: number): void {
  'worklet';
  const { w, h, u } = B;
  const floor = B.bust ? h + 1 : B.g - 10 * u;
  if (part === 0) {
    band(P, B, -1, h + 1, [[0, 0x2e2e3e, 1], [0.6, 0x1c1c28, 1], [1, 0x121219, 1]]);
    P.glowOval(w / 2, h * 0.4, w * 0.5, h * 0.42, 0xfff0dc, 0.3);
    P.glowOval(w / 2, h * 0.36, w * 0.24, h * 0.22, 0xffffff, 0.14, 2);
    if (!B.bust) {
      // piso: curva do fundo infinito e reflexo
      P.path([0, -1, floor + 4 * u, 2, w / 2, floor - 3 * u, w + 1, floor + 4 * u, 1, w + 1, h + 1, 1, -1, h + 1, 4], { g: vgrad(floor - 3 * u, h, [[0, 0x2a2a38, 1], [0.4, 0x343444, 1], [1, 0x1e1e28, 1]]) });
      P.glowOval(w / 2, B.g, w * 0.36, 5 * u, 0xfff2e0, 0.3);
    }
    // softboxes
    for (let side = 0; side < 2; side++) {
      const x = side ? w - 4 * u - 13 * u : 4 * u;
      const y = h * (B.bust ? 0.18 : 0.2);
      const sw = 13 * u;
      const sh = 18 * u;
      P.glowOval(x + sw / 2, y + sh / 2, sw * 1.6, sh * 1.2, 0xfff6ea, 0.22);
      P.rrect(x, y, sw, sh, 1.6 * u, { g: { t: 'l', x1: x, y1: y, x2: x + sw, y2: y + sh, s: [[0, 0xffffff, 1], [0.6, 0xf2ede4, 1], [1, 0xc9c2b6, 1]] } });
      P.rrect(x + 1.2 * u, y + 1.2 * u, sw - 2.4 * u, sh - 2.4 * u, 1 * u, { c: 0xffffff, a: 0.85 });
      const sx = x + sw / 2;
      const base = B.bust ? h + 2 : floor + 6 * u;
      P.path([0, sx, y + sh, 1, sx, base], { c: 0x4a4a58, w: 0.9 * u });
      P.path([0, sx, base - 5 * u, 1, sx - 4 * u, base, 0, sx, base - 5 * u, 1, sx + 4 * u, base], { c: 0x4a4a58, w: 0.7 * u });
    }
    vignette(P, B, 0.5, 0x050508);
  } else if (part === 1) {
    for (let i = 0; i < 8; i++) {
      const [ph] = life(t, 9 + rnd(i, 1) * 5, rnd(i, 2));
      const x = w * (0.3 + 0.4 * rnd(i, 91)) + Math.sin(t * 0.3 + i) * 5 * u;
      const y = h * 0.85 - ph * h * 0.7;
      P.circle(x, y, 0.35 * u, { c: 0xffffff, a: 0.5 * Math.sin(Math.PI * ph) });
    }
  }
}

/** Bandeira: a bandeira escolhida como um pano grande ao fundo, com dobras ondulando e luz atrás do avatar */
function bdPride(P: Pen, S: BackdropSpec, B: BdFrame, t: number, part: number): void {
  'worklet';
  const { w, h, u } = B;
  if (part === 0) {
    P.rect(-1, -1, w + 2, h + 2, { c: S.flag.length ? S.flag[0].f : 0xffffff });
    for (let i = 0; i < S.flag.length; i++) P.path(S.flag[i].c, { c: S.flag[i].f, eo: S.flag[i].eo });
    P.glowOval(w / 2, h * 0.48, w * 0.45, h * 0.45, 0xffffff, 0.28, 2);
  } else if (part === 1) {
    // dobras do pano: vales escuros e cristas claras andando na diagonal
    for (let k = 0; k < 4; k++) {
      const x = fract(k / 4 + t * 0.035) * (w + 40 * u) - 20 * u;
      const W = (14 + 6 * rnd(k, 3)) * u;
      P.path([0, x - W, -1, 1, x + W, -1, 1, x + W - 12 * u, h + 1, 1, x - W - 12 * u, h + 1, 4], { g: { t: 'l', x1: x - W, y1: 0, x2: x + W, y2: 0, s: [[0, 0x000000, 0], [0.45, 0x000000, 0.2], [0.62, 0xffffff, 0.16], [1, 0xffffff, 0]] } });
    }
  } else {
    vignette(P, B, 0.45, 0x000000);
  }
}

/** prédios de uma camada da cidade (silhueta + janelas paradas acesas) */
function skyline(P: Pen, B: BdFrame, base: number, hMin: number, hMax: number, n: number, seed: number, col: Rgb, win: Rgb, winA: number, lowMid: boolean): void {
  'worklet';
  const { w, u } = B;
  let x = -2 * u;
  for (let i = 0; i < n && x < w; i++) {
    const bw = (7 + 7 * rnd(i, seed)) * u;
    const mid = Math.abs(x + bw / 2 - w / 2) / (w / 2);
    const hh = mixN(hMin, hMax, rnd(i, seed + 1)) * (lowMid ? 0.55 + 0.45 * mid : 1);
    const top = base - hh;
    P.rect(x, top, bw + 0.3 * u, hh + 1, { c: col });
    const roof = rnd(i, seed + 2);
    if (roof < 0.25) P.rect(x + bw * 0.25, top - 3 * u, bw * 0.5, 3 * u, { c: col });
    else if (roof < 0.4) P.path([0, x + bw / 2, top - 6 * u, 1, x + bw / 2, top], { c: col, w: 0.6 * u });
    if (winA > 0) {
      const cols = Math.max(1, Math.floor(bw / (2.6 * u)));
      const rows = Math.floor(hh / (3.4 * u));
      for (let r = 1; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (rnd(i * 97 + r * 13 + c, seed + 3) < 0.42) P.rect(x + (c + 0.3) * (bw / cols), top + r * 3.4 * u, (bw / cols) * 0.4, 1.4 * u, { c: win, a: winA * (0.5 + 0.5 * rnd(r + c * 7, i + seed)) });
        }
      }
    }
    x += bw + (rnd(i, seed + 4) < 0.3 ? 1.5 * u : 0);
  }
}

/** Cidade à noite: céu violeta, lua, estrelas, duas camadas de prédios com janelas e brilho da cidade no horizonte */
function bdNightCity(P: Pen, B: BdFrame, t: number, part: number): void {
  'worklet';
  const { w, h, hz, u } = B;
  const base = B.bust ? h + 1 : hz + 6 * u;
  if (part === 0) {
    band(P, B, -1, base, [[0, 0x090b2a, 1], [0.55, 0x1e1850, 1], [0.85, 0x4a2a70, 1], [1, 0x7a3a7a, 1]]);
    P.glow(w * 0.22, h * 0.14, 16 * u, 0xd8d4ff, 0.45);
    P.circle(w * 0.22, h * 0.14, 5 * u, { g: { t: 'r', cx: w * 0.2, cy: h * 0.12, r: 6 * u, s: [[0, 0xfffbea, 1], [1, 0xd8d0ff, 1]] } });
    P.circle(w * 0.235, h * 0.13, 0.9 * u, { c: 0xc8c0ea, a: 0.6 });
    P.circle(w * 0.205, h * 0.155, 0.6 * u, { c: 0xc8c0ea, a: 0.5 });
    P.glowOval(w / 2, base - 6 * u, w * 0.7, 16 * u, 0xff6ab8, 0.35, 2);
    skyline(P, B, base, 14 * u, 34 * u, 16, 101, 0x2c2660, 0xffd27a, 0.35, false);
    skyline(P, B, base + 1 * u, 18 * u, 52 * u, 14, 111, 0x120f2c, 0xffd88a, 0.85, true);
    if (!B.bust) {
      band(P, B, base, h + 1, [[0, 0x1a1636, 1], [1, 0x0a0918, 1]]);
      // reflexos das luzes no chão molhado
      for (let i = 0; i < 7; i++) P.glowOval(w * (0.08 + 0.84 * rnd(i, 121)), base + 4 * u, 1.6 * u, 6 * u, i % 2 ? 0xffd27a : 0xff7ac0, 0.3, 2);
      P.glowOval(w / 2, B.g, 18 * u, 2.4 * u, 0x000000, 0.4);
    }
    vignette(P, B, 0.4, 0x05030f);
  } else if (part === 1) {
    for (let i = 0; i < 14; i++) {
      const x = w * rnd(i, 131);
      const y = h * 0.02 + rnd(i, 132) * (base - 46 * u - h * 0.02);
      const tw = 0.5 + 0.5 * Math.sin(t * (1 + rnd(i, 133) * 2) + i * 2.3);
      star(P, x, y, (0.3 + 0.35 * rnd(i, 134)) * u, 0xffffff, 0.4 + 0.6 * tw, rnd(i, 135) < 0.3 ? tw : 0);
    }
    // luz de antena piscando e um avião cruzando
    const blink = fract(t * 0.7) < 0.15 ? 1 : 0.15;
    P.glow(w * 0.86, base - 50 * u, 1.6 * u, 0xff3a3a, 0.9 * blink, 1);
    const px = fract(t * 0.025) * (w + 20 * u) - 10 * u;
    P.circle(px, h * 0.2, 0.35 * u, { c: 0xffffff, a: fract(t * 1.2) < 0.2 ? 1 : 0.35 });
  }
}

/** Grade neon: céu synthwave, sol listrado, montanhas de arame e grade em perspectiva correndo pro horizonte */
function bdNeonGrid(P: Pen, B: BdFrame, t: number, part: number): void {
  'worklet';
  const { w, h, hz, u } = B;
  const sx = w / 2;
  const sr = 19 * u;
  const sy = hz - 7 * u;
  if (part === 0) {
    band(P, B, -1, hz + 1, [[0, 0x08031e, 1], [0.5, 0x2a0a50, 1], [1, 0x7a1a78, 1]]);
    P.glow(sx, sy, 50 * u, 0xff3d9a, 0.4);
    P.save();
    P.clipRRect(sx - sr, sy - sr, sr * 2, sr + (hz - sy), 0);
    P.circle(sx, sy, sr, { g: vgrad(sy - sr, sy + sr * 0.7, [[0, 0xfff05a, 1], [0.5, 0xff9a3a, 1], [1, 0xff2d8a, 1]]) });
    for (let k = 0; k < 6; k++) {
      const yy = sy - sr * 0.05 + k * k * 0.42 * u + k * 2.2 * u;
      P.rect(sx - sr - 1, yy, sr * 2 + 2, 0.5 * u + k * 0.35 * u, { c: 0x5a1460 });
    }
    P.restore();
    // montanhas de arame
    for (let side = 0; side < 2; side++) {
      P.save();
      P.clipRRect(side ? w * 0.62 : -1, -1, w * 0.4, h + 2, 0);
      ridge(P, B, hz, 16 * u, 5, 141 + side, { g: vgrad(hz - 18 * u, hz, [[0, 0x2a0a4a, 1], [1, 0x14052a, 1]]) }, hz + 0.5 * u, true);
      ridge(P, B, hz, 16 * u, 5, 141 + side, { c: 0xff3dc8, a: 0.7, w: 0.45 * u }, hz + 0.5 * u, true);
      P.restore();
    }
    band(P, B, hz, h + 1, [[0, 0x2a0640, 1], [1, 0x0c0218, 1]]);
  } else if (part === 1) {
    // linhas horizontais da grade vindo na direção de quem olha
    const N = 9;
    for (let k = 0; k < N; k++) {
      const f = (k + fract(t * 0.5)) / N;
      const y = hz + (h - hz) * f * f;
      P.path([0, -1, y, 1, w + 1, y], { c: 0xff3dc8, a: 0.25 + 0.7 * f, w: (0.25 + 0.6 * f) * u, cap: 1 });
    }
  } else {
    for (let k = -8; k <= 8; k++) {
      const xb = sx + k * 13 * u;
      P.path([0, sx + k * 1.6 * u, hz, 1, xb + (xb - sx) * 0.6, h + 1], { c: 0x3de0ff, a: 0.55, w: 0.4 * u, cap: 1 });
    }
    P.glowOval(sx, hz, w * 0.6, 2.2 * u, 0xff6ad8, 0.8, 1);
    P.rect(-1, hz - 0.2 * u, w + 2, 0.4 * u, { c: 0xffd0f4, a: 0.9 });
    vignette(P, B, 0.35, 0x05010d);
  }
}

/** Galáxia: espaço fundo com nebulosas, campo de estrelas, galáxia espiral ao longe e planeta com anel */
function bdGalaxy(P: Pen, B: BdFrame, t: number, part: number): void {
  'worklet';
  const { w, h, u } = B;
  if (part === 0) {
    band(P, B, -1, h + 1, [[0, 0x04041a, 1], [0.6, 0x0b0628, 1], [1, 0x140a2e, 1]]);
    const neb: Rgb[] = [0x6a2aff, 0xff3aa8, 0x2a6aff, 0x2ad8ff, 0xb03aff];
    for (let i = 0; i < 7; i++) P.glowOval(w * (0.1 + 0.8 * rnd(i, 151)), h * (0.1 + 0.8 * rnd(i, 152)), (24 + 16 * rnd(i, 153)) * u, (14 + 10 * rnd(i, 154)) * u, neb[i % 5], 0.3, 1);
    for (let i = 0; i < 46; i++) P.circle(w * rnd(i, 161), h * rnd(i, 162), (0.15 + 0.3 * rnd(i, 163)) * u, { c: 0xffffff, a: 0.35 + 0.5 * rnd(i, 164) });
    // galáxia espiral distante
    P.save();
    P.translate(w * 0.78, h * 0.16);
    P.rotate(-24);
    P.scale(1, 0.42);
    P.glow(0, 0, 9 * u, 0xd8c8ff, 0.5, 1);
    for (let arm = 0; arm < 2; arm++) for (let k = 0; k < 6; k++) {
      const s = 0.2 + k * 0.14;
      const ang = arm * Math.PI + s * 4.2;
      P.glow(Math.cos(ang) * 9 * u * s, Math.sin(ang) * 9 * u * s, 2.4 * u, 0xb8a8ff, 0.4, 1);
    }
    P.circle(0, 0, 0.9 * u, { c: 0xffffff });
    P.restore();
    // planeta com anel
    const px = w * 0.12;
    const py = h * (B.bust ? 0.82 : 0.72);
    const pr = 8 * u;
    P.save();
    P.translate(px, py);
    P.rotate(-18);
    P.path([0, -pr * 1.9, 0, 2, 0, -pr * 0.6, pr * 1.9, 0], { c: 0xe8c8ff, a: 0.5, w: 1.1 * u });
    P.restore();
    P.circle(px, py, pr, { g: { t: 'r', cx: px - pr * 0.4, cy: py - pr * 0.45, r: pr * 1.5, s: [[0, 0xffb38a, 1], [0.5, 0xc0507a, 1], [1, 0x2a103a, 1]] } });
    P.save();
    P.translate(px, py);
    P.rotate(-18);
    P.path([0, -pr * 1.9, 0, 2, 0, pr * 0.62, pr * 1.9, 0], { c: 0xf2dcff, a: 0.85, w: 1.2 * u });
    P.restore();
    vignette(P, B, 0.45, 0x020210);
  } else if (part === 1) {
    for (let i = 0; i < 14; i++) {
      const tw = 0.5 + 0.5 * Math.sin(t * (1.2 + rnd(i, 171) * 2) + i * 2.1);
      star(P, w * rnd(i, 172), h * rnd(i, 173), (0.35 + 0.35 * rnd(i, 174)) * u, rnd(i, 175) < 0.3 ? 0xbfe6ff : 0xffffff, 0.5 + 0.5 * tw, tw);
    }
    // estrela cadente de vez em quando
    const [ph, cyc] = life(t, 6, 0.3);
    if (ph < 0.18) {
      const k = ph / 0.18;
      const x0 = w * (0.2 + 0.5 * rnd(cyc, 181));
      const y0 = h * (0.05 + 0.2 * rnd(cyc, 182));
      const x = x0 + k * 30 * u;
      const y = y0 + k * 12 * u;
      P.path([0, x - 10 * u, y - 4 * u, 1, x, y], { g: { t: 'l', x1: x - 10 * u, y1: y - 4 * u, x2: x, y2: y, s: [[0, 0xffffff, 0], [1, 0xffffff, 0.9 * (1 - k)]] }, w: 0.5 * u });
      P.glow(x, y, 1.5 * u, 0xffffff, 0.8 * (1 - k), 1);
    }
  }
}

/** Aurora boreal: céu de noite polar, cortinas de luz ondulando, montanhas nevadas, pinheiros e neve */
function bdAurora(P: Pen, B: BdFrame, t: number, part: number): void {
  'worklet';
  const { w, h, hz, u } = B;
  if (part === 0) {
    band(P, B, -1, hz + 2, [[0, 0x020818, 1], [0.5, 0x062038, 1], [1, 0x0c3a4c, 1]]);
    for (let i = 0; i < 30; i++) P.circle(w * rnd(i, 191), hz * 0.9 * rnd(i, 192), (0.15 + 0.25 * rnd(i, 193)) * u, { c: 0xffffff, a: 0.4 + 0.5 * rnd(i, 194) });
  } else if (part === 1) {
    // cortinas: raios verticais ao longo de uma curva que ondula; a base é mais forte e verde, o topo some em violeta
    const cols: [Rgb, Rgb][] = [
      [0x3dffa0, 0x8a5aff],
      [0x2ae8ff, 0x3dffa0],
    ];
    for (let r = 0; r < 2; r++) {
      const N = 16;
      const yb = h * (r ? 0.38 : 0.27);
      for (let k = 0; k <= N; k++) {
        const s = k / N;
        const x = -2 * u + s * (w + 4 * u);
        const y = yb + Math.sin(s * 5 + t * 0.6 + r * 2) * 5 * u + Math.sin(s * 11 - t * 0.9) * 1.6 * u;
        const L = (20 + 10 * Math.sin(s * 7 + t * 0.8 + r)) * u * (B.bust ? 0.8 : 1);
        const a = (0.36 + 0.16 * Math.sin(s * 9 + t * 1.3 + r * 3)) * (0.35 + 0.65 * Math.sin(Math.PI * clamp01(s * 1.05)));
        P.path([0, x, y, 1, x, y - L], { g: { t: 'l', x1: 0, y1: y, x2: 0, y2: y - L, s: [[0, cols[r][0], 0], [0.08, cols[r][0], a], [0.5, mixRgb(cols[r][0], cols[r][1], 0.5), a * 0.5], [1, cols[r][1], 0]] }, w: (w / N) * 1.25, b: 1, cap: 1 });
      }
    }
  } else {
    // montanhas nevadas, pinheiros e chão de neve com reflexo da aurora
    ridge(P, B, hz - 4 * u, 18 * u, 5, 201, { g: vgrad(hz - 22 * u, hz + 2 * u, [[0, 0x6a8aa8, 1], [0.35, 0x2a4a6a, 1], [1, 0x14283e, 1]]) }, hz + 3 * u, true);
    ridge(P, B, hz + 1 * u, 9 * u, 7, 202, { g: vgrad(hz - 9 * u, hz + 3 * u, [[0, 0x1e3a54, 1], [1, 0x0e1e30, 1]]) }, hz + 4 * u, true);
    band(P, B, hz + 3 * u, h + 1, [[0, 0xa8d4e8, 1], [0.3, 0xd8eef8, 1], [1, 0xb8d8ea, 1]]);
    P.glowOval(w / 2, hz + 6 * u, w * 0.5, 4 * u, 0x3dffa0, 0.25, 1);
    for (let i = 0; i < 6; i++) {
      const side = i % 2 ? 1 : -1;
      const x = w / 2 + side * w * (0.32 + 0.06 * Math.floor(i / 2)) + (rnd(i, 211) - 0.5) * 3 * u;
      const s = (5 + 2.5 * rnd(i, 212)) * u * (B.bust ? 0.8 : 1);
      const y = (B.bust ? h * 0.95 : hz + 6 * u) - s;
      P.shape('pine', x, y, s, 0, { g: vgrad(y - s, y + s, [[0, 0x1e4a3a, 1], [1, 0x0a2018, 1]]) });
      P.path([0, x - s * 0.3, y - s * 0.4, 1, x, y - s * 0.6, 1, x + s * 0.3, y - s * 0.4], { c: 0xffffff, a: 0.6, w: 0.5 * u });
    }
    if (!B.bust) P.glowOval(w / 2, B.g, 18 * u, 2.4 * u, 0x5a7a9a, 0.4);
    vignette(P, B, 0.35, 0x010510);
  }
}

/** Confete: festa em degradê quente, raios de luz atrás, balões nos cantos e confete caindo */
function bdConfetti(P: Pen, B: BdFrame, t: number, part: number): void {
  'worklet';
  const { w, h, u } = B;
  const C: Rgb[] = [0xff1493, 0x7fff00, 0xffd700, 0x00e5ff, 0x9b5cff, 0xffffff];
  if (part === 0) {
    band(P, B, -1, h + 1, [[0, 0xffc75a, 1], [0.5, 0xff7a6a, 1], [1, 0xd8336e, 1]]);
    // raios de luz saindo de trás do avatar
    P.save();
    P.translate(w / 2, h * 0.42);
    for (let k = 0; k < 12; k++) {
      const a0 = (k * TAU) / 12;
      const R = Math.max(w, h);
      P.path([0, 0, 0, 1, Math.cos(a0 - 0.12) * R, Math.sin(a0 - 0.12) * R, 1, Math.cos(a0 + 0.12) * R, Math.sin(a0 + 0.12) * R, 4], { c: 0xffffff, a: 0.09 });
    }
    P.restore();
    P.glow(w / 2, h * 0.42, 40 * u, 0xfff0c8, 0.5);
    // balões
    for (let i = 0; i < 3; i++) {
      const x = i === 2 ? w * 0.9 : w * (0.07 + 0.11 * i);
      const y = h * (0.14 + 0.08 * i);
      const r = (6 + 1.5 * i) * u;
      const c = [0xff1493, 0xffd700, 0x00c8ff][i];
      P.path([0, x, y + r * 1.15, 2, x - 2 * u, y + r * 2.4, x + 1 * u, y + r * 4], { c: 0xffffff, a: 0.6, w: 0.3 * u });
      P.oval(x, y, r * 0.86, r, { g: { t: 'r', cx: x - r * 0.35, cy: y - r * 0.4, r: r * 1.4, s: [[0, lighten(c, 0.6), 1], [0.45, c, 1], [1, darken(c, 0.35), 1]] } });
      P.path([0, x - 0.9 * u, y + r * 1.12, 1, x + 0.9 * u, y + r * 1.12, 1, x, y + r * 0.96, 4], { c: darken(c, 0.2) });
      P.oval(x - r * 0.35, y - r * 0.42, r * 0.18, r * 0.28, { c: 0xffffff, a: 0.55 });
    }
    vignette(P, B, 0.3, 0x5a0a28);
  } else if (part === 1) {
    for (let i = 0; i < 24; i++) {
      const [ph, cyc] = life(t, 5 + rnd(i, 1) * 3, rnd(i, 2));
      const x = w * rnd(i * 5 + cyc, 3) + Math.sin(t * 1.4 + i) * 3 * u;
      const y = -4 * u + ph * (h + 8 * u);
      const near = rnd(i, 4) < 0.25;
      const s = (near ? 1.6 : 0.9 + 0.5 * rnd(i, 5)) * u;
      confettiPiece(P, x, y, s, i % 3, C[i % C.length], rnd(i, 6) * 180 + t * 80 * (i % 2 ? 1 : -1), Math.cos(t * (3 + rnd(i, 7) * 3) + i), near ? 0.95 : 0.85);
    }
  }
}

/** Dourado luxo: preto e ouro art déco — leque de arcos, moldura com cantoneiras, luz quente e brilho de ouro */
function bdGoldLuxe(P: Pen, B: BdFrame, t: number, part: number): void {
  'worklet';
  const { w, h, u } = B;
  const gold: FxGrad = { t: 'l', x1: 0, y1: 0, x2: w, y2: h, s: [[0, 0xffe9a0, 1], [0.35, 0xd4a03a, 1], [0.6, 0xfff0b8, 1], [1, 0xa8741e, 1]] };
  if (part === 0) {
    band(P, B, -1, h + 1, [[0, 0x1e1608, 1], [0.55, 0x120d05, 1], [1, 0x060402, 1]]);
    P.glowOval(w / 2, h * 0.46, w * 0.55, h * 0.45, 0xffc85a, 0.22);
    // leque art déco saindo de baixo, atrás do avatar
    const fx = w / 2;
    const fy = B.bust ? h * 1.02 : B.g + 2 * u;
    for (let k = 1; k <= 6; k++) {
      const R = k * 11 * u;
      P.circle(fx, fy, R, { g: gold, a: 0.22 + 0.03 * k, w: 0.35 * u });
    }
    for (let k = 0; k <= 12; k++) {
      const a0 = Math.PI + (k / 12) * Math.PI;
      P.path([0, fx + Math.cos(a0) * 11 * u, fy + Math.sin(a0) * 11 * u, 1, fx + Math.cos(a0) * 70 * u, fy + Math.sin(a0) * 70 * u], { g: gold, a: 0.2, w: 0.3 * u });
    }
    // moldura com cantoneiras
    const m = 4 * u;
    P.rrect(m, m, w - m * 2, h - m * 2, 2 * u, { g: gold, a: 0.75, w: 0.5 * u });
    P.rrect(m + 1.4 * u, m + 1.4 * u, w - m * 2 - 2.8 * u, h - m * 2 - 2.8 * u, 1.5 * u, { g: gold, a: 0.4, w: 0.3 * u });
    for (let c = 0; c < 4; c++) {
      const x = c % 2 ? w - m : m;
      const y = c < 2 ? m : h - m;
      P.shape('diamond', x, y, 2.4 * u, 0, { g: gold });
      P.shape('diamond', x, y, 1.2 * u, 0, { c: 0x1a1208 });
    }
    vignette(P, B, 0.5, 0x000000);
  } else if (part === 1) {
    for (let i = 0; i < 16; i++) {
      const x = w * rnd(i, 221) + Math.sin(t * 0.25 + i) * 4 * u;
      const y = h * rnd(i, 222) - fract(t * 0.01 + rnd(i, 223)) * 6 * u;
      const tw = 0.5 + 0.5 * Math.sin(t * (1 + rnd(i, 224) * 1.5) + i * 2.7);
      const r = (0.8 + 2.2 * rnd(i, 225)) * u;
      if (rnd(i, 226) < 0.55) P.glow(x, y, r * 2, 0xffd36a, 0.3 * tw, 1);
      else star(P, x, y, 0.35 * u, 0xfff2c0, 0.4 + 0.6 * tw, tw);
    }
  }
}

/** Carnaval: noite roxa com luzes desfocadas, bandeirinhas balançando, plumas nos cantos, serpentina e confete */
function bdCarnival(P: Pen, B: BdFrame, t: number, part: number): void {
  'worklet';
  const { w, h, u } = B;
  const C: Rgb[] = [0xff1493, 0xffd700, 0x00e5ff, 0x7fff00, 0xff6a00, 0x9b5cff];
  if (part === 0) {
    band(P, B, -1, h + 1, [[0, 0x2a0a5a, 1], [0.55, 0x7a1a8a, 1], [1, 0xd8307a, 1]]);
    for (let i = 0; i < 9; i++) P.glow(w * rnd(i, 231), h * (0.2 + 0.6 * rnd(i, 232)), (6 + 8 * rnd(i, 233)) * u, C[i % C.length], 0.25, 1);
    // plumas nos cantos de baixo
    for (let side = 0; side < 2; side++) {
      const x = side ? w + 2 * u : -2 * u;
      const y = h + 2 * u;
      for (let k = 0; k < 5; k++) {
        const ang = side ? -100 - k * 14 : -80 + k * 14;
        const col = [0x2ad86a, 0xffd700, 0xff1493, 0x00c8ff, 0xff6a00][(k + side * 2) % 5];
        frond(P, x, y, (28 + 6 * (k % 2)) * u * (B.bust ? 0.8 : 1), 5 * u, ang, darken(col, 0.3), lighten(col, 0.3), 0.95);
      }
    }
    vignette(P, B, 0.3, 0x14031e);
  } else if (part === 1) {
    // bandeirinhas em dois varais, balançando
    for (let r = 0; r < 2; r++) {
      const y0 = h * (0.06 + 0.1 * r);
      const sag = 6 * u + Math.sin(t * 1.2 + r) * 0.8 * u;
      const n = 9;
      const cm: number[] = [];
      for (let k = 0; k <= n; k++) {
        const s = k / n;
        cm.push(k ? 1 : 0, -2 + s * (w + 4), y0 + Math.sin(Math.PI * s) * sag);
      }
      P.path(cm, { c: 0xffffff, a: 0.6, w: 0.3 * u });
      for (let k = 0; k < n; k++) {
        const s = (k + 0.5) / n;
        const x = -2 + s * (w + 4);
        const y = y0 + Math.sin(Math.PI * s) * sag;
        const sw = Math.sin(t * 2 + k * 1.3 + r) * 6;
        P.save();
        P.translate(x, y);
        P.rotate(sw);
        P.path([0, -2.6 * u, 0, 1, 2.6 * u, 0, 1, 0, 5 * u, 4], { c: C[(k + r * 3) % C.length] });
        P.restore();
      }
    }
    for (let i = 0; i < 16; i++) {
      const [ph, cyc] = life(t, 6 + rnd(i, 1) * 3, rnd(i, 2));
      const x = w * rnd(i * 5 + cyc, 3) + Math.sin(t + i) * 3 * u;
      const y = h * 0.15 + ph * h * 0.9;
      confettiPiece(P, x, y, (0.9 + 0.6 * rnd(i, 4)) * u, i % 3 === 2 ? 2 : i % 2, C[i % C.length], rnd(i, 5) * 180 + t * 70, Math.cos(t * 3.5 + i), smooth(0, 0.1, ph) * 0.9);
    }
  }
}

/** Palco: cortinas de veludo, piso de madeira com poça de luz, holofotes varrendo e névoa */
function bdStage(P: Pen, B: BdFrame, t: number, part: number): void {
  'worklet';
  const { w, h, u } = B;
  const floor = B.bust ? h + 1 : B.g - 9 * u;
  if (part === 0) {
    band(P, B, -1, h + 1, [[0, 0x0a0614, 1], [0.7, 0x180a24, 1], [1, 0x0e0614, 1]]);
    // painel de luzinhas ao fundo
    for (let r = 0; r < 6; r++) for (let c = 0; c < 9; c++) P.circle(w * (0.14 + c * 0.09), h * (0.14 + r * 0.075), 0.35 * u, { c: 0xffc8f0, a: 0.15 + 0.15 * rnd(r * 9 + c, 241) });
    P.glowOval(w / 2, h * 0.45, w * 0.45, h * 0.4, 0x8a3aff, 0.22, 1);
    if (!B.bust) {
      band(P, B, floor, h + 1, [[0, 0x4a2a18, 1], [0.5, 0x2e1a0e, 1], [1, 0x160c06, 1]]);
      for (let k = -6; k <= 6; k++) P.path([0, w / 2 + k * 6 * u, floor, 1, w / 2 + k * 11 * u, h + 1], { c: 0x140a04, a: 0.6, w: 0.3 * u, cap: 1 });
      P.rect(-1, floor - 0.4 * u, w + 2, 0.8 * u, { c: 0xffd8a0, a: 0.35 });
      P.glowOval(w / 2, B.g, w * 0.34, 4.5 * u, 0xfff0d0, 0.5, 2);
    }
  } else if (part === 1) {
    // holofotes de cima, varrendo devagar (aditivo) + névoa nos feixes
    const cols: Rgb[] = [0xff5ad8, 0xfff0d0, 0x5ad8ff];
    for (let k = 0; k < 3; k++) {
      const ox = w * (0.18 + 0.32 * k);
      const ang = Math.sin(t * 0.5 + k * 2.1) * 0.35 + (k - 1) * -0.25;
      const L = h * 1.05;
      const tx = ox + Math.sin(ang) * L;
      const ty = Math.cos(ang) * L;
      const sp = 11 * u;
      P.path([0, ox - 1.5 * u, -2, 1, ox + 1.5 * u, -2, 1, tx + sp, ty, 1, tx - sp, ty, 4], { g: { t: 'l', x1: ox, y1: 0, x2: tx, y2: ty, s: [[0, cols[k], 0.4], [0.7, cols[k], 0.1], [1, cols[k], 0]] }, b: 1 });
      P.glow(ox, -1, 5 * u, cols[k], 0.7, 1);
    }
    for (let i = 0; i < 10; i++) {
      const x = w * rnd(i, 251) + Math.sin(t * 0.3 + i) * 6 * u;
      const y = h * (0.2 + 0.6 * rnd(i, 252)) + Math.cos(t * 0.25 + i) * 4 * u;
      P.glow(x, y, (5 + 4 * rnd(i, 253)) * u, 0xd8c8ff, 0.06, 1);
    }
  } else {
    // cortinas de veludo com dobras e bambinela no topo
    for (let side = 0; side < 2; side++) {
      const x0 = side ? w - 16 * u : -1;
      const cw = 16 * u + 1;
      P.save();
      P.clipRRect(x0, -1, cw, h + 2, 0);
      P.rect(x0, -1, cw, h + 2, { c: 0x5a0a20 });
      for (let k = 0; k < 4; k++) {
        const fx = x0 + (k + 0.5) * (cw / 4);
        P.rect(fx - cw / 8, -1, cw / 4, h + 2, { g: { t: 'l', x1: fx - cw / 8, y1: 0, x2: fx + cw / 8, y2: 0, s: [[0, 0x3a0012, 1], [0.45, 0xb0183c, 1], [0.6, 0xd83a5a, 1], [1, 0x3a0012, 1]] } });
      }
      P.restore();
      P.path(side ? [0, w - 16 * u, -1, 2, w - 10 * u, h * 0.5, w - 15 * u, h + 1] : [0, 16 * u, -1, 2, 10 * u, h * 0.5, 15 * u, h + 1], { c: 0x000000, a: 0.35, w: 2.4 * u });
    }
    const vh = 7 * u;
    P.rect(-1, -1, w + 2, vh, { g: vgrad(0, vh, [[0, 0x6a0a24, 1], [1, 0xa01838, 1]]) });
    for (let k = 0; k < 8; k++) P.oval(w * (k + 0.5) / 8, vh, w / 16 + 0.5, 2.6 * u, { g: vgrad(vh - 2.6 * u, vh + 2.6 * u, [[0, 0xa01838, 1], [1, 0x5a0a20, 1]]) });
    P.rect(-1, vh - 0.6 * u, w + 2, 0.5 * u, { c: 0xffd36a, a: 0.8 });
    vignette(P, B, 0.4, 0x020004);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// despacho (worklet)
// ---------------------------------------------------------------------------------------------------------------
/** desenha uma parte (0 parada de trás, 1 animada, 2 parada da frente) do fundo na caixa B */
export function drawBackdropPart(P: Pen, S: BackdropSpec, B: BdFrame, t: number, part: number): void {
  'worklet';
  switch (S.id) {
    case 'sunset':
      return bdSunset(P, B, t, part);
    case 'beach':
      return bdBeach(P, B, t, part);
    case 'hearts':
      return bdHearts(P, B, t, part);
    case 'garden':
      return bdGarden(P, B, t, part);
    case 'studio':
      return bdStudio(P, B, t, part);
    case 'pride':
      return bdPride(P, S, B, t, part);
    case 'night_city':
      return bdNightCity(P, B, t, part);
    case 'neon_grid':
      return bdNeonGrid(P, B, t, part);
    case 'galaxy':
      return bdGalaxy(P, B, t, part);
    case 'aurora':
      return bdAurora(P, B, t, part);
    case 'confetti':
      return bdConfetti(P, B, t, part);
    case 'gold_luxe':
      return bdGoldLuxe(P, B, t, part);
    case 'carnival':
      return bdCarnival(P, B, t, part);
    case 'stage':
      return bdStage(P, B, t, part);
    default:
      return bdSunset(P, B, t, part);
  }
}

/** uma parte do fundo do palco, recortada nos cantos arredondados do canvas */
export function drawBackdropStage(P: Pen, S: BackdropSpec, box: { w: number; h: number }, radius: number, t: number, part: number): void {
  'worklet';
  const B = stageBdFrame(box);
  P.save();
  P.clipRRect(0, 0, box.w, box.h, radius);
  drawBackdropPart(P, S, B, t, part);
  P.restore();
}

/** fundo inteiro parado (as três partes no quadro `still`) — folha de prova e testes */
export function drawBackdrop(P: Pen, S: BackdropSpec, box: { w: number; h: number }, radius: number, t: number): void {
  for (let part = 0; part < 3; part++) drawBackdropStage(P, S, box, radius, t, part);
}

/** fundo estático no SVG das listas, no espaço do viewBox (recorte: círculo no busto, cantos no corpo inteiro) */
export function drawBackdropSvg(P: Pen, S: BackdropSpec, vb: { x: number; y: number; w: number; h: number }, bust: boolean): void {
  const B = svgBdFrame(vb, bust);
  P.save();
  P.translate(vb.x, vb.y);
  P.clipRRect(0, 0, vb.w, vb.h, bust ? vb.w / 2 : vb.w * 0.12);
  for (let part = 0; part < 3; part++) drawBackdropPart(P, S, B, S.still, part);
  P.restore();
}
