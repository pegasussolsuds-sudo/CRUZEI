// Chapelaria: acessórios de cabeça e orelha (brincos, argolas, pérolas, piercing, ear cuff, aparelho auditivo, flor,
// borboletas, coroa de flores, fones e headset), óculos e chapéus. Dono: chapelaria.
//
// Tudo sai das âncoras da cabeça nova (headAnchors/faceDims) pelo referencial de headwear-kit.ts, então cada peça
// acompanha o formato do rosto, a estatura, a idade e o volume do cabelo. Cada função começa com lodCtx (nível 'lite'
// pula trama, costura e brilho miúdo).
//
// Arquivos:
//   headwear-kit.ts      referencial da cabeça, tons e receitas de material (feltro, palha, tricô, cetim, metal, gema…)
//   headwear-hats.ts     os 23 chapéus (+ 'none')
//   headwear-glasses.ts  os 14 óculos (+ 'none')
//   headwear-acc.ts      os 11 acessórios (+ 'none'); fone e headset passam por cima do chapéu (overHat)
//
// Etapas do orquestrador (layers.ts):
//   22 headAccessory (brinco, flor…)  ·  23 glasses  ·  24 hat  ·  24b overHat (fone/headset por cima do chapéu)
// Grupo: 'head' em tudo (o caimento do hijab sobre os ombros vai no grupo 'body').
// Convivência com o cabelo: hat-modes.ts.

import type { LayerCtx } from '../ctx';
import { lodCtx } from '../shading';

import { ACCESSORIES, OVER_HAT } from './headwear-acc';
import { GLASSES } from './headwear-glasses';
import { HATS } from './headwear-hats';
import { headFrame } from './headwear-kit';

export { HAIR_BULK, hairBulk, headFrame, type HeadFrame } from './headwear-kit';

/** ids que esta parte sabe desenhar (os testes conferem contra o catálogo) */
export const HEADWEAR_IDS = {
  hat: Object.keys(HATS),
  glasses: Object.keys(GLASSES),
  accessory: [...new Set([...Object.keys(ACCESSORIES), ...Object.keys(OVER_HAT)])],
} as const;

/** 22. acessórios de cabeça e orelha que ficam por baixo dos óculos e do chapéu */
export function headAccessory(ctx: LayerCtx): void {
  ctx = lodCtx(ctx);
  const fn = ACCESSORIES[ctx.cfg.accessory];
  if (!fn) return;
  ctx.group('head');
  fn(ctx, headFrame(ctx));
}

/** 23. óculos */
export function glasses(ctx: LayerCtx): void {
  ctx = lodCtx(ctx);
  const fn = GLASSES[ctx.cfg.glasses];
  if (!fn) return;
  ctx.group('head');
  fn(ctx, headFrame(ctx));
}

/** 24. chapéu */
export function hat(ctx: LayerCtx): void {
  ctx = lodCtx(ctx);
  const fn = HATS[ctx.cfg.hat];
  if (!fn) return;
  ctx.group('head');
  fn(ctx, headFrame(ctx));
  ctx.group('head');
}

/** 24b. por cima do chapéu: fone e headset (a haste passa por cima do boné; as conchas por cima da haste dos óculos) */
export function overHat(ctx: LayerCtx): void {
  ctx = lodCtx(ctx);
  const fn = OVER_HAT[ctx.cfg.accessory];
  if (!fn) return;
  ctx.group('head');
  fn(ctx, headFrame(ctx));
}
