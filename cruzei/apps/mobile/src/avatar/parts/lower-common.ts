// Comum da parte de baixo, calçados, bolsas e pulso: lados, grupos, tons de material e o que a parte de cima decide
// (barra da camiseta, vestido cobrindo as pernas). Dono: guarda-roupa (parte de baixo).
//
// As funções opcionais do dono da parte de cima (parts/clothes.ts) são lidas sob demanda: se ele exportar
// `topHemY(ctx)`, `bottomKind(cfg)` ou `waistShown(cfg)`, a parte de baixo obedece; sem elas, vale o padrão daqui.

import type { AvatarConfig } from '@cruzei/shared-types';

import { type Side, type SP } from '../anatomy';
import type { LayerCtx } from '../ctx';
import { lum, mix } from '../shading';
import type { AvatarGroup, Pt } from '../types';

import * as clothesMod from './clothes';

export const SIDES: readonly Side[] = ['L', 'R'];
export const NONE = 'none';

export const legG = (s: Side): AvatarGroup => (s === 'L' ? 'legL' : 'legR');
export const shinG = (s: Side): AvatarGroup => (s === 'L' ? 'shinL' : 'shinR');
export const foreG = (s: Side): AvatarGroup => (s === 'L' ? 'foreL' : 'foreR');
/** sinal do lado de FORA do corpo na tela (L = esquerda = −1) */
export const outSign = (s: Side): number => (s === 'L' ? -1 : 1);

/** tons de um material: luz, base, sombra, fundo e luz rebatida (sombra fria; preto ganha brilho visível) */
export interface Tones {
  light: string;
  base: string;
  shade: string;
  deep: string;
  bounce: string;
}

export function fabric(c: string): Tones {
  const L = lum(c);
  return {
    light: mix(c, '#FFFFFF', L < 0.03 ? 0.14 : L > 0.7 ? 0.5 : 0.17),
    base: c,
    shade: mix(c, '#0B0816', L > 0.7 ? 0.16 : L < 0.03 ? 0.35 : 0.27),
    deep: mix(c, '#05030C', L > 0.7 ? 0.32 : 0.5),
    bounce: mix(c, '#2A2A48', L > 0.7 ? 0.1 : 0.16),
  };
}

/** couro: tons mais contrastados que o tecido (brilho mais claro e sombra mais funda) */
export function leatherTones(c: string): Tones {
  const L = lum(c);
  return {
    light: mix(c, '#FFF6EC', L < 0.03 ? 0.2 : L > 0.7 ? 0.55 : 0.26),
    base: c,
    shade: mix(c, '#0A0508', L > 0.7 ? 0.2 : L < 0.03 ? 0.4 : 0.34),
    deep: mix(c, '#030103', L > 0.7 ? 0.38 : 0.58),
    bounce: mix(c, '#3A2A30', 0.18),
  };
}

/** linha de costura (cor de linha) que aparece sobre o tecido */
export function threadOf(c: string): string {
  return lum(c) < 0.05 ? mix(c, '#8A7A60', 0.5) : lum(c) > 0.6 ? mix(c, '#6A5A40', 0.45) : mix(c, '#E8C27A', 0.55);
}

function clothesFn<T>(name: string): T | null {
  const fn = (clothesMod as unknown as Record<string, unknown>)[name];
  return typeof fn === 'function' ? (fn as T) : null;
}

/** partes de cima que fazem o papel da parte de baixo (vestido) */
const DRESS_TOPS = new Set(['dress', 'gown']);

/**
 * o que cobre as pernas: o id da parte de baixo, ou 'dress' quando a parte de cima é um vestido (o dono da parte de
 * cima manda nisso se exportar bottomKind(cfg): qualquer valor diferente do id da parte de baixo vira 'dress').
 */
export function lowerKind(cfg: AvatarConfig): string {
  if (DRESS_TOPS.has(cfg.top)) return 'dress';
  const fn = clothesFn<(c: AvatarConfig) => string>('bottomKind');
  const k = fn ? fn(cfg) : cfg.bottom;
  return k && k !== cfg.bottom ? 'dress' : cfg.bottom;
}

/** partes de baixo que deixam a perna (pele) à mostra */
export const LEG_REVEAL = new Set(['shorts', 'bermuda', 'skirt', 'pleated', 'midi', 'kilt', 'tutu']);

/** a perna aparece (o corpo desenha a pele)? — pedido ao dono do corpo: ler daqui em vez do LEG_REVEAL dele */
export function legsVisible(cfg: AvatarConfig): boolean {
  const k = lowerKind(cfg);
  return k === 'dress' || LEG_REVEAL.has(k);
}

/** saias (desenhadas no grupo do tronco) */
export const SKIRTS = new Set(['skirt', 'pleated', 'midi', 'kilt', 'tutu']);
/** calças compridas (a barra é redesenhada por cima do calçado) */
export const LONG_PANTS = new Set(['jeans', 'pants', 'tailored', 'cargo', 'ripped', 'metallic', 'wide', 'joggers', 'leggings']);

/**
 * topo do quadril da calça/saia (y): logo acima da barra da parte de cima (o cós fica escondido debaixo dela), ou a
 * cintura + 1,5 quando a parte de cima não informa a barra.
 */
export function pantsTopY(ctx: LayerCtx): number {
  const { an } = ctx;
  const base = an.waistY + 1.5;
  if (waistShown(ctx.cfg)) return base;
  let fn = clothesFn<(c: LayerCtx) => number>('topHemY');
  if (!fn && ctx.cfg.top === 'tee') fn = clothesFn<(c: LayerCtx) => number>('teeHemY');
  if (!fn) return base;
  const h = fn(ctx);
  return Number.isFinite(h) ? Math.max(base, h - 2.2) : base;
}

/** o cós aparece (parte de cima curta)? */
export function waistShown(cfg: AvatarConfig): boolean {
  const fn = clothesFn<(c: AvatarConfig) => boolean>('waistShown');
  if (fn) return !!fn(cfg);
  return cfg.top === 'crop';
}

/** desloca um ponto */
export const add = (p: Pt, dx: number, dy: number): Pt => [p[0] + dx, p[1] + dy];
/** ponto entre a e b */
export const lerpPt = (a: Pt | SP, b: Pt | SP, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** caixa dos pontos */
export function bbox(pts: readonly (Pt | SP)[]): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[1] > y1) y1 = p[1];
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** gerador determinístico 0..1 (semente fixa: nada de Math.random) */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
    return (s >>> 8) / 16777216;
  };
}
