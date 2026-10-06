// Animação assinatura do avatar: a que a pessoa escolheu no slot `emote`, tocada uma vez quando alguém toca no avatar
// (mapa, perfil, prévia, cartão, match). Sem escolha (ou uma que pede pet sem pet), o avatar acena: o toque sempre
// responde. Puro TS (sem RN/Skia): usado pelo <SignatureAvatar/> e pelo motor do mapa.

import type { AvatarConfig } from '@cruzei/shared-types';

import { emoteDef } from '../../avatar/emotes';
import type { EmoteDef } from '../../avatar/emotes/types';

/** animação de quem não escolheu nenhuma */
export const FALLBACK_SIGNATURE = 'wave';

/** id da animação assinatura desta config (sempre um id registrado, ou null se nem o aceno existir) */
export function signatureEmote(cfg: Pick<AvatarConfig, 'emote' | 'pet'> | null | undefined): string | null {
  const id = cfg?.emote;
  const def = emoteDef(id);
  const hasPet = !!cfg?.pet && cfg.pet !== 'none';
  if (def && (!def.needsPet || hasPet)) return def.id;
  return emoteDef(FALLBACK_SIGNATURE) ? FALLBACK_SIGNATURE : null;
}

/** definição da animação assinatura (null = nada registrado) */
export function signatureDef(cfg: Pick<AvatarConfig, 'emote' | 'pet'> | null | undefined): EmoteDef | null {
  return emoteDef(signatureEmote(cfg));
}
