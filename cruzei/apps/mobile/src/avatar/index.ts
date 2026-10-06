// Ponto de entrada do sistema de avatar no app.
// - `resolveAvatar` garante que TODO usuário tem um avatar (null no backend → determinístico pelo id).
// - `buildAvatarLayers` produz as camadas usadas pelo <CruzeiAvatar/>, pelo <AvatarStage/> e pelo mapa (defineAvatar).
// - pose.ts / scene.ts / rig.ts: esqueleto, cena (veículo/pet) e matemática das matrizes, iguais nos três renderizadores.

import type { AvatarConfig, Gender } from '@cruzei/shared-types';
import { avatarKey, normalizeAvatarConfig, randomAvatarConfig } from '@cruzei/shared-utils';

export { buildAvatarLayers, buildAvatarRig, bustBoxFor, layersWithTag, sceneFor, AVATAR_VIEWBOX, AVATAR_BUST_VIEWBOX } from './layers';
export type { BuildOptions } from './layers';
export type { AvatarGradient, AvatarGroup, AvatarHands, AvatarLayer, AvatarLayerTag, AvatarRig, AvatarSceneInfo, AvatarStop, Pt } from './types';
export { AVATAR_GROUPS } from './types';
export type { Pose, PoseVariation } from './pose';
export { NEUTRAL_VARIATION, addPose, blend, breathe, clonePose, idle, poseIsFinite, variationFor, zero } from './pose';
export { applyScene, resolveScene, EMPTY_SCENE } from './scene';
export type { AvatarScene } from './scene';
export { groupMatrix, mToSkia, mToSvg, type Mat } from './rig';

/**
 * versão do DESENHO do avatar (não da config): suba a cada mudança de visual pra invalidar caches de imagem por chave
 * (o mapa guarda PNG em disco por avatarKey; a chave das figuras no MapEngine inclui esta versão).
 */
export const AVATAR_RENDER_VERSION = 'a6';

const resolvedCache = new Map<string, AvatarConfig>();

/**
 * Config pronta pra desenhar. `seed` costuma ser o id do usuário; `gender` só influencia o fallback.
 * Resultado é memoizado por (seed + config) — chamada barata em listas.
 */
export function resolveAvatar(
  config: AvatarConfig | null | undefined,
  seed: string,
  gender?: Gender | null,
): AvatarConfig {
  const cacheKey = config ? `${seed}|${JSON.stringify(config)}` : `${seed}|${gender ?? ''}`;
  const hit = resolvedCache.get(cacheKey);
  if (hit) return hit;
  const resolved = config ? normalizeAvatarConfig(config) : randomAvatarConfig(seed, { gender: gender ?? null });
  if (resolvedCache.size > 800) resolvedCache.clear();
  resolvedCache.set(cacheKey, resolved);
  return resolved;
}

/** chave curta e estável do visual (cache de imagem no mapa / memo) */
export function keyOf(config: AvatarConfig): string {
  return avatarKey(config);
}
