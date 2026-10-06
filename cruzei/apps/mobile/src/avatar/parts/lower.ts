// Parte de baixo, calçados, bolsas/costas e pulso. Dono: guarda-roupa (parte de baixo).
// As versões antigas dessas funções em clothes.ts viram código morto e saem na integração.
//
// Etapas do orquestrador (layers.ts):
//   3 bagBack (grupo body)  ·  6 bottom (legL; cada pedaço troca pra legX/shinX/body)  ·  6 shoes (shinL; idem)
//   15 wrist (foreL)  ·  15b bagFront (body; a clutch vai pra mão esquerda, foreL)
//
// Divisão:
//   lower-common.ts   lados, grupos, tons de material, o que a parte de cima decide (barra, vestido)
//   lower-bottoms.ts  calças, shorts, bermuda e saias (+ barra da calça por cima do calçado)
//   lower-shoes.ts    os 16 calçados a partir do pé 3D da anatomia
//   lower-bags.ts     mochila, transversal, ecobag, clutch, pochete, violão, asas e jetpack
//   lower-wrist.ts    relógios e pulseiras no pulso esquerdo da tela

import type { LayerCtx } from '../ctx';

import { drawBagBack, drawBagFront } from './lower-bags';
import { drawBottom } from './lower-bottoms';
import { drawShoes } from './lower-shoes';
import { drawWrist } from './lower-wrist';

export { legsVisible, lowerKind } from './lower-common';

/** 3. costas: mochila, violão, asas, jetpack, corpo da ecobag (atrás do tronco e dos braços) */
export function bagBack(ctx: LayerCtx): void {
  drawBagBack(ctx);
}

/** 6b. parte de baixo */
export function bottom(ctx: LayerCtx): void {
  drawBottom(ctx);
}

/** 6c. calçados */
export function shoes(ctx: LayerCtx): void {
  drawShoes(ctx);
}

/** 15. pulso (antebraço esquerdo da tela) */
export function wrist(ctx: LayerCtx): void {
  drawWrist(ctx);
}

/** 15b. frente da bolsa: alças, transversal, pochete, clutch na mão */
export function bagFront(ctx: LayerCtx): void {
  drawBagFront(ctx);
}
