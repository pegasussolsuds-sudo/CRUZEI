// Orquestrador das camadas vetoriais do avatar Metch a partir de uma AvatarConfig.
// Uma única fonte de verdade de geometria: o app desenha com react-native-svg (<CruzeiAvatar/>), o palco anima com
// Skia (<AvatarStage/>) e o mapa nativo rasteriza as mesmas camadas com Skia de CPU (screens/map/native/images/draw.ts).
//
// Sistema de coordenadas: viewBox 0 0 100 140 (corpo inteiro, pés em y≈134, sombra no chão em y≈135).
// Este arquivo só decide a ORDEM; cada parte desenha o que é dela (parts/*), com o contexto de ctx.ts e as medidas de
// anatomy.ts. Ordem de desenho (contrato):
//    1 sombra no chão                       14 pet no colo
//    2 veículo (trás)                       15 antebraços, mãos, pulso, pulseira de orgulho, objeto, bandeirinha
//    3 costas: mochila, capa (bag/pride)        (+ 15b frente da bolsa por cima do braço)
//    4 cabelo de trás                       16 pescoço e cabeça base
//    5 capuz                                17 formato do rosto e detalhes
//    6 pernas, parte de baixo e sapatos     18 barba
//    7 pet no chão                          19 expressão (k:'face')
//    8 tronco e parte de cima               20 pintura de orgulho
//    9 sobreposição (outer)                 21 cabelo da frente
//   10 orgulho no peito                     22 acessórios de cabeça e orelha
//   11 pescoço (colar, corrente, cachecol)  23 óculos
//   12 braços (pele e mangas)               24 chapéu (+ 24b fone por cima do chapéu)
//   13 veículo (frente)                     25 pet no ombro · 26 pet flutuando

import type { AvatarConfig } from '@cruzei/shared-types';
import { avatarKey } from '@cruzei/shared-utils';

import { buildAnatomy, bustViewBox, rigFromAnatomy } from './anatomy';
import { createCtx, fillConfig, type BuildOptions, type LayerCtx } from './ctx';
import * as body from './parts/body';
import * as clothes from './parts/clothes';
import * as face from './parts/face';
import * as hair from './parts/hair';
import * as headwear from './parts/headwear';
import * as held from './parts/held';
import * as lower from './parts/lower';
import * as pets from './parts/pets';
import * as pride from './parts/pride';
import * as vehicles from './parts/vehicles';
import { resolveScene, type AvatarScene } from './scene';
import type { AvatarGroup, AvatarLayer, AvatarLayerTag, AvatarRig } from './types';

export type { AvatarGradient, AvatarGroup, AvatarLayer, AvatarLayerTag, AvatarRig, AvatarStop } from './types';
export type { BuildOptions } from './ctx';

export const AVATAR_VIEWBOX = { x: 0, y: 0, w: 100, h: 140 } as const;
/**
 * recorte "busto" (cabeça + ombros do corpo novo), 1:1, fixo: cobre todas as estaturas e o black power (que nunca passa
 * de y=1). Quem desenha uma config usa o enquadramento por pessoa (bustBoxFor); este fica de reserva.
 */
export const AVATAR_BUST_VIEWBOX = { x: 27.5, y: 1.5, w: 45, h: 45 } as const;

/** cena usada na montagem (o busto ignora o veículo pra não mudar o enquadramento) */
export function sceneFor(cfg: AvatarConfig, opts: BuildOptions = {}): AvatarScene {
  return resolveScene(fillConfig(cfg), { noVehicle: opts.mode === 'bust' });
}

const bustCache = new Map<string, { x: number; y: number; w: number; h: number }>();

/**
 * recorte de busto desta pessoa (olhos a 42%, topo logo acima do cabelo/chapéu, estatura dela) — o mesmo no
 * <CruzeiAvatar/>, no palco e na folha de contato. Cache pequeno por config (lista rola muito).
 */
export function bustBoxFor(cfg: AvatarConfig): { x: number; y: number; w: number; h: number } {
  const key = avatarKey(cfg);
  const hit = bustCache.get(key);
  if (hit) return hit;
  const full = fillConfig(cfg);
  const vb = bustViewBox(buildAnatomy(full, sceneFor(cfg, { mode: 'bust' })), full);
  if (bustCache.size > 400) bustCache.clear();
  bustCache.set(key, vb);
  return vb;
}

/** Pivôs do rig pra uma config (vêm da anatomia, que depende do tipo de corpo e da cena) + a cena resolvida. */
export function buildAvatarRig(cfg: AvatarConfig, opts: BuildOptions = {}): AvatarRig {
  const scene = sceneFor(cfg, opts);
  return rigFromAnatomy(buildAnatomy(fillConfig(cfg), scene), scene);
}

/** roda uma etapa com grupo e etiqueta próprios (a etiqueta volta a nenhuma depois) */
function step(ctx: LayerCtx, g: AvatarGroup, k: AvatarLayerTag | null, fn: (c: LayerCtx) => void): void {
  ctx.group(g).tag(k);
  fn(ctx);
  ctx.tag(null);
}

export function buildAvatarLayers(cfg: AvatarConfig, opts: BuildOptions = {}): AvatarLayer[] {
  const scene = sceneFor(cfg, opts);
  const ctx = createCtx(cfg, scene, opts);
  const bust = opts.mode === 'bust';
  const pet = scene.petPose;

  // 1. sombra no chão
  step(ctx, 'shadow', null, body.groundShadow);
  // 2. veículo (parte de trás)
  if (scene.mount && !bust) step(ctx, 'mount', 'mount', vehicles.vehicleBack);
  // 3. costas: mochila, capa
  step(ctx, 'body', null, lower.bagBack);
  step(ctx, 'body', 'pride', pride.prideBack);
  // 4. cabelo de trás
  step(ctx, 'head', null, hair.hairBack);
  // 5. capuz
  step(ctx, 'body', null, clothes.hood);
  // 6. pernas (pele), parte de baixo e sapatos — o busto não mostra
  if (!scene.hideLegs && !bust) {
    step(ctx, 'legL', null, body.legsSkin);
    step(ctx, 'legL', null, lower.bottom);
    step(ctx, 'shinL', null, lower.shoes);
  }
  // 7. pet no chão
  if (pet === 'side' && !bust) step(ctx, 'pet', 'pet', pets.petGround);
  // 8. tronco e parte de cima
  step(ctx, 'body', null, clothes.top);
  // 9. sobreposição
  step(ctx, 'body', null, clothes.outer);
  // 10. orgulho no peito
  step(ctx, 'body', 'pride', pride.prideChest);
  // 11. pescoço
  step(ctx, 'body', null, clothes.neck);
  // 12. braços: pele e mangas
  step(ctx, 'armL', null, body.upperArms);
  step(ctx, 'armL', null, clothes.sleevesUpper);
  // 13. veículo (parte da frente)
  if (scene.mount && !bust) step(ctx, 'mount', 'mount', vehicles.vehicleFront);
  // 14. pet no colo
  if (pet === 'arms') step(ctx, 'pet', 'pet', pets.petCradle);
  // 15. antebraços, mãos, pulso, pulseira de orgulho, objeto e bandeirinha
  step(ctx, 'foreL', null, body.forearms);
  step(ctx, 'foreL', null, clothes.sleevesLower);
  step(ctx, 'foreL', 'hand', body.hands);
  step(ctx, 'foreL', null, lower.wrist);
  step(ctx, 'foreR', 'pride', pride.prideWrist);
  if (scene.showHeld) step(ctx, 'foreR', 'held', held.heldItem);
  if (scene.showLeftHandFlag) step(ctx, 'foreL', 'pride', pride.prideHandFlag);
  // 15b. frente da bolsa (por cima do braço, como no desenho antigo)
  step(ctx, 'body', null, lower.bagFront);
  // 16. pescoço e cabeça base
  step(ctx, 'body', null, body.neckAndHead);
  // 17. formato do rosto e detalhes
  step(ctx, 'head', null, face.faceBase);
  // 18. barba
  step(ctx, 'head', null, hair.facialHair);
  // 19. expressão
  step(ctx, 'head', 'face', face.expression);
  // 20. pintura de orgulho
  step(ctx, 'head', 'pride', pride.pridePaint);
  // 21. cabelo da frente
  step(ctx, 'head', null, hair.hairFront);
  // 22. acessórios de cabeça e orelha
  step(ctx, 'head', null, headwear.headAccessory);
  // 23. óculos
  step(ctx, 'head', null, headwear.glasses);
  // 24. chapéu (+ fone por cima)
  step(ctx, 'head', null, headwear.hat);
  step(ctx, 'head', null, headwear.overHat);
  // 25. pet no ombro · 26. pet flutuando
  if (pet === 'shoulder') step(ctx, 'pet', 'pet', pets.petShoulder);
  if (pet === 'float') step(ctx, 'pet', 'pet', pets.petFloat);

  return ctx.layers;
}

/** só as camadas com uma etiqueta (o palco usa pra montar expressões e objetos alternativos) */
export function layersWithTag(layers: readonly AvatarLayer[], k: AvatarLayerTag | readonly AvatarLayerTag[]): AvatarLayer[] {
  const set = Array.isArray(k) ? k : [k];
  return layers.filter((l) => l.k != null && set.includes(l.k));
}
