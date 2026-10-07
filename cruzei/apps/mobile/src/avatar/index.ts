// Ponto de entrada do sistema de avatar no app.
// - `resolveAvatar` garante que TODO usuário tem um avatar (null no backend → determinístico pelo id).
// - `buildAvatarLayers` produz as camadas usadas pelo <CruzeiAvatar/>, pelo <AvatarStage/> e pelo mapa (defineAvatar).
// - pose.ts / scene.ts / rig.ts: esqueleto, cena (veículo/pet) e matemática das matrizes, iguais nos três renderizadores.

import type { AvatarConfig, Gender } from '@cruzei/shared-types';
import { avatarKey, normalizeAvatarConfig, randomAvatarConfig } from '@cruzei/shared-utils';

import { MemCache } from '../services/memCache';

import type { AvatarLayer } from './types';

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
export const AVATAR_RENDER_VERSION = 'a8';

/**
 * configs prontas (LRU): o mapa resolve as 300 pessoas do nearby a cada busca, as listas a mesma pessoa várias vezes.
 * Antes: chave com o seed (duas pessoas com o mesmo visual = duas entradas) e 800 itens que caíam todos de uma vez.
 */
export const RESOLVED_CACHE_MAX = 600;
/** bytes estimados de uma config normalizada (~45 campos) além da chave */
const RESOLVED_BYTES = 1024;
const resolvedCache = new MemCache<AvatarConfig>('avatar.resolved', RESOLVED_CACHE_MAX * 2 * RESOLVED_BYTES, RESOLVED_CACHE_MAX);

/**
 * Config pronta pra desenhar. `seed` costuma ser o id do usuário; `gender` só influencia o fallback.
 * Resultado é memoizado pela config (o seed só conta sem config) — chamada barata em listas.
 */
export function resolveAvatar(
  config: AvatarConfig | null | undefined,
  seed: string,
  gender?: Gender | null,
): AvatarConfig {
  // com config o resultado não depende do seed
  const cacheKey = config ? 'c' + JSON.stringify(config) : `s${seed}|${gender ?? ''}`;
  const hit = resolvedCache.get(cacheKey);
  if (hit) return hit;
  const resolved = config ? normalizeAvatarConfig(config) : randomAvatarConfig(seed, { gender: gender ?? null });
  return resolvedCache.set(cacheKey, resolved, cacheKey.length + RESOLVED_BYTES);
}

/** bytes por camada além das strings de path (objeto, cores, gradiente), medido no node com strings achatadas */
const LAYER_OVERHEAD = 512;

/** bytes estimados retidos por uma montagem de camadas (as strings de path são quase tudo: 1 byte por caractere) */
export function layersBytes(layers: readonly Pick<AvatarLayer, 'd' | 'cp'>[]): number {
  let b = 0;
  for (const l of layers) b += LAYER_OVERHEAD + l.d.length + (l.cp ? l.cp.length : 0);
  return b;
}

/** chave curta e estável do visual (cache de imagem no mapa / memo) */
export function keyOf(config: AvatarConfig): string {
  return avatarKey(config);
}
