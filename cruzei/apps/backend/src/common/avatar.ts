import type { AvatarConfig } from '@cruzei/shared-types';
import { randomAvatarConfig } from '@cruzei/shared-utils';

type Gender = 'female' | 'male' | 'non_binary' | 'other';

/**
 * Avatar a devolver pro cliente: o salvo ou, pra contas antigas sem avatar_config, um determinístico
 * a partir do id — mesma seed em todos os endpoints (/me, /nearby, /users/:id, matches), logo o mesmo boneco.
 */
export function avatarOrFallback(u: { id: string; gender?: string | null; avatarConfig?: unknown }): AvatarConfig {
  if (u.avatarConfig != null && typeof u.avatarConfig === 'object') return u.avatarConfig as AvatarConfig;
  return randomAvatarConfig(u.id, { gender: (u.gender as Gender | null | undefined) ?? null });
}
