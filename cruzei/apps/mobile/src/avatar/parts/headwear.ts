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
//   21a earAccessory (brinco, argola, ear cuff, aparelho: chamado pelo cabelo, POR BAIXO da frente dele)
//   22 headAccessory (flor, borboletas, coroa de flores, piercing)  ·  23 glasses  ·  24 hat
//   24b overHat (fone/headset por cima do chapéu; borboletas pousadas no chapéu)
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

/**
 * acessórios de ORELHA (brincos, argolas, pérolas, ear cuff, aparelho auditivo): saem POR BAIXO do cabelo da frente —
 * o cabelo (parts/hair.ts hairFront) chama earAccessory antes de desenhar a frente. Com cabelo longo cobrindo a orelha,
 * eles ficavam boiando por cima do cabelo, sem orelha embaixo.
 */
const EAR_ACC = new Set(['earrings', 'hoops', 'pearl_earrings', 'ear_cuff', 'hearing_aid']);
/** montagens (pela lista de camadas, uma por buildAvatarLayers) em que o acessório de orelha já saiu pelo cabelo */
const earDone = new WeakSet<object>();

/** 21a (chamado pelo cabelo, antes da frente dele): acessório de orelha, uma vez só por montagem */
export function earAccessory(ctx: LayerCtx): void {
  if (!EAR_ACC.has(ctx.cfg.accessory) || earDone.has(ctx.layers)) return;
  const fn = ACCESSORIES[ctx.cfg.accessory];
  if (!fn) return;
  earDone.add(ctx.layers);
  const prev = ctx.g;
  const c = lodCtx(ctx);
  c.group('head');
  fn(c, headFrame(c));
  ctx.group(prev);
}

/**
 * 22. acessórios de cabeça que ficam por cima do cabelo e por baixo dos óculos e do chapéu. O de orelha já saiu por
 * baixo do cabelo (earAccessory); se a etapa do cabelo não rodou (etapa isolada), sai aqui.
 */
export function headAccessory(ctx: LayerCtx): void {
  if (EAR_ACC.has(ctx.cfg.accessory)) return earAccessory(ctx);
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
  // busto leve: só a sombra da aba e o vinco da copa pedem desfoque (castShadow/crownDent); o resto já sai sem no 'lite'
  ctx = lodCtx(ctx, { bustBlur: true });
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
