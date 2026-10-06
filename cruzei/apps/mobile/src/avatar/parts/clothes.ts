// Roupas de cima: parte de cima (31 peças, inclusive vestido, vestido de gala e camiseta do orgulho), sobreposição (13),
// pescoço (12 itens), capuz e mangas. Dono: guarda-roupa (parte de cima).
//
// Etapas do orquestrador (layers.ts) que chamam este arquivo:
//    5 hood (capuz deitado do moletom; costas da capa de herói e do manto)  ·  8 top  ·  9 outer  ·  11 neck
//   12 sleevesUpper (manga do ombro ao cotovelo, grupos armX)  ·  15 sleevesLower (cotovelo ao pulso, grupos foreX)
//
// Arquivos:
//   clothes-kit.ts    tabela das peças, tons por material, corte (decote, cava, barra), volume, gola, mangas
//   clothes-tops.ts   as 31 partes de cima e o capuz
//   clothes-outer.ts  as sobreposições (frente, mangas e costas da capa/manto)
//   clothes-neck.ts   colares, gravatas, lenços, cachecol, medalha, amuleto
//
// Contratos com os outros donos (funções opcionais que eles leem sob demanda):
//   - sleeveKind(cfg)    → parts/body.ts: quanto de braço de pele desenhar ('none' | 'short' | 'long')
//   - neckCoverY(cfg,an) → parts/body.ts: até onde a gola cobre o pescoço (gola alta, colarinho, cachecol, choker…)
//   - topHemY(ctx)       → parts/lower-common.ts: barra da parte de cima (a calça começa logo acima dela)
//   - waistShown(cfg)    → parts/lower-common.ts: o cós aparece (cropped)
//   - bottomKind(cfg)    → parts/lower-common.ts / body.ts: 'dress' quando a parte de cima é vestido (pernas de pele)
//
// A parte de baixo, calçados, bolsas e pulso são do parts/lower.ts.

import type { AvatarConfig } from '@cruzei/shared-types';

import { headAnchors, type Anatomy } from '../anatomy';
import type { LayerCtx } from '../ctx';
import { lodCtx } from '../shading';

import { SIDES, hemOf, outerDef, sleeveLenRank, sleeveLower, sleeveUpper, topDef } from './clothes-kit';
import { chokerY, drawNeck, neckItem } from './clothes-neck';
import { drawOuter, outerBack, outerSleevesLower, outerSleevesUpper } from './clothes-outer';
import { collarStandY, drawTop, hoodBack, topArmExtras, topSleeveChain, topSleeveSpec } from './clothes-tops';

export { teeFit, teeHemY, type TeeFit } from './clothes-kit';
export { neckItem } from './clothes-neck';

/** partes de cima que são vestido (fazem o papel da parte de baixo) */
const DRESS_TOPS = new Set(['dress', 'gown']);

export type SleeveKind = 'none' | 'short' | 'long';

/**
 * que manga cobre o braço (o corpo usa pra saber quanto de braço de pele desenhar): 'long' = cobre até o pulso (sem pele
 * no braço); 'short' = a pele do braço aparece em algum trecho (a manga desenha por cima); 'none' = sem manga. Considera
 * a sobreposição (blazer, jaqueta…).
 */
export function sleeveKind(cfg: AvatarConfig): SleeveKind {
  const o = outerDef(cfg);
  const r = Math.max(sleeveLenRank(topDef(cfg).sl), o ? sleeveLenRank(o.sl) : 0);
  return r >= 2 ? 'long' : r === 1 ? 'short' : 'none';
}

/** o que cobre as pernas: 'dress' quando a parte de cima é um vestido (curto ou de gala); senão a parte de baixo */
export function bottomKind(cfg: AvatarConfig): string {
  return DRESS_TOPS.has(cfg.top) ? 'dress' : cfg.bottom;
}

/** o cós da calça aparece (parte de cima curta)? */
export function waistShown(cfg: AvatarConfig): boolean {
  return cfg.top === 'crop';
}

/**
 * Até onde a gola cobre o pescoço (y), pro corpo desenhar só o pedaço de pescoço acima dela (parts/body.ts lê). null =
 * gola redonda normal. Gola alta, gola careca alta (zíper, armadura, traje real, cyber), colarinho (camisa, polo,
 * xadrez, smoking), puffer, cachecol, lenço, bandana e choker.
 */
export function neckCoverY(cfg: AvatarConfig, an: Anatomy): number | null {
  const chin = headAnchors(an).chin[1];
  const base = an.collarY - 2.6;
  const ys: number[] = [];
  const n = neckItem(cfg);
  if (n === 'scarf') ys.push(chin + 2.2);
  else if (n === 'silk' || n === 'bandana') ys.push(base - 1.6);
  else if (n === 'choker') ys.push(chokerY(an) - 0.55);
  const d = topDef(cfg);
  if (d.neck === 'turtle') ys.push(chin + 1.9);
  else if (d.neck === 'mock') ys.push(base - (cfg.top === 'armor' ? 3.2 : cfg.top === 'royal' ? 2.6 : cfg.top === 'cyber' ? 1.8 : 2.0) + 0.3);
  else if (d.neck === 'collar' || cfg.top === 'tux') ys.push(collarStandY(an) - 0.3);
  if (cfg.outer === 'puffer') ys.push(base - 2.4);
  if (!ys.length) return null;
  return Math.min(...ys);
}

/** barra da peça de cima (y): a calça começa logo acima dela (parts/lower-common.ts lê). Peça longa: no gancho. */
export function topHemY(ctx: LayerCtx): number {
  const { an } = ctx;
  return Math.min(hemOf(ctx, topDef(ctx.cfg)), an.torsoBottom - 0.5);
}

/** 5. capuz (atrás do corpo): capuz deitado do moletom, costas da capa de herói e do manto */
export function hood(ctx: LayerCtx): void {
  hoodBack(ctx);
  outerBack(ctx);
}

/** 8. tronco e parte de cima (inclui a saia do vestido e os detalhes de cada peça) */
export function top(ctx: LayerCtx): void {
  drawTop(ctx);
}

/** 9. peça por cima (blazer, cardigã, jaqueta, capa…) — slot `outer`, cor ctx.col.outer */
export function outer(ctx: LayerCtx): void {
  drawOuter(ctx);
}

/** 11. pescoço: colares, corrente, cachecol, gravatas, lenços, medalha, amuleto (slot `neck`; aceita o `accessory` antigo) */
export function neck(ctx: LayerCtx): void {
  drawNeck(ctx);
}

/** 12b. manga (ombro → cotovelo): a da parte de cima e, por cima, a da sobreposição */
export function sleevesUpper(ctx0: LayerCtx): void {
  const ctx = lodCtx(ctx0);
  const o = outerDef(ctx.cfg);
  const covered = !!o && sleeveLenRank(o.sl) === 2;
  const sp = topSleeveSpec(ctx);
  if (sp && !covered) for (const s of SIDES) sleeveUpper(ctx, s, { ...sp, chain: topSleeveChain(ctx, s) });
  if (!covered) for (const s of SIDES) topArmExtras(ctx, s);
  outerSleevesUpper(ctx);
}

/** 15b. manga (cotovelo → pulso) e punho */
export function sleevesLower(ctx0: LayerCtx): void {
  const ctx = lodCtx(ctx0);
  const o = outerDef(ctx.cfg);
  const covered = !!o && sleeveLenRank(o.sl) === 2;
  const sp = topSleeveSpec(ctx);
  if (sp && !covered) for (const s of SIDES) sleeveLower(ctx, s, sp);
  outerSleevesLower(ctx);
}

