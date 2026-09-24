// Ponto de entrada do sistema de avatar no app.
// - `resolveAvatar` garante que TODO usuário tem um avatar (null no backend → determinístico pelo id).
// - `buildAvatarLayers` produz as camadas usadas pelo <CruzeiAvatar/> e pelo mapa (defineAvatar).

import type { AvatarConfig } from '@cruzei/shared-types';
import { avatarKey, normalizeAvatarConfig, randomAvatarConfig } from '@cruzei/shared-utils';

export { buildAvatarLayers, buildAvatarRig, AVATAR_VIEWBOX, AVATAR_BUST_VIEWBOX } from './layers';
export type { AvatarLayer, AvatarGroup, AvatarRig, BuildOptions } from './layers';

const resolvedCache = new Map<string, AvatarConfig>();

/**
 * Config pronta pra desenhar. `seed` costuma ser o id do usuário; `gender` só influencia o fallback.
 * Resultado é memoizado por (seed + config) — chamada barata em listas.
 */
export function resolveAvatar(
  config: AvatarConfig | null | undefined,
  seed: string,
  gender?: 'female' | 'male' | 'non_binary' | 'other' | null,
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
