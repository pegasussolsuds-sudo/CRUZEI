// Regras puras dos campos do perfil: orientação (dado sensível, opcional; exibir por escolha), @ do Instagram e a
// última atividade em FAIXA no cartão público. Sem banco nem Nest: o users.service e o cartão (GET /users/:id) usam
// daqui. O filtro "Mostrar" e a ordem "mesma orientação primeiro" moram na descoberta (location/discovery-order.ts).
import type { Orientation } from '@cruzei/shared-types';
import { isValidInstagramHandle, normalizeInstagramHandle } from '@cruzei/shared-utils';

import { PRIVACY } from '../location/discovery-privacy';

/** corpo do 400 quando o @ foge da regra do Instagram (ApiErrorCode 'instagram_invalid') */
export const INSTAGRAM_INVALID = {
  error: 'instagram_invalid',
  message:
    'Esse @ não rola no Instagram: só letras, números, ponto e _ (até 30), sem ponto no começo ou no fim',
} as const;

/** corpo do 400 quando liga "mostrar orientação" ou "mesma orientação primeiro" sem ter orientação (o CHECK viraria 500) */
export const ORIENTATION_REQUIRED = {
  error: 'orientation_required',
  message: 'Escolhe sua orientação em Editar perfil antes de ligar isso',
} as const;

// ---- orientação ----

/** o que o cartão público pode mostrar: só quando a pessoa EXIBE (show_orientation) */
export function publicOrientation(u: {
  orientation: Orientation | null;
  showOrientation: boolean;
}): Orientation | null {
  return u.showOrientation && u.orientation ? u.orientation : null;
}

/**
 * PATCH /me orientation: undefined = não mexe; null = apaga e revoga o consentimento (flags e carimbo zeram — LGPD
 * art. 18, IX); valor novo = grava e carimba orientation_consented_at; mesmo valor = nada.
 */
export function orientationPatch(
  current: Orientation | null,
  next: Orientation | null | undefined,
  now: Date = new Date(),
): Record<string, unknown> {
  if (next === undefined) return {};
  if (next === null) {
    return current == null
      ? {}
      : {
          orientation: null,
          showOrientation: false,
          sameOrientationFirst: false,
          orientationConsentedAt: null,
        };
  }
  if (next === current) return {};
  return { orientation: next, orientationConsentedAt: now };
}

/** PATCH /me/settings: ligar exibir/ordem sem orientação guardada é pedido inválido (400 orientation_required) */
export function orientationFlagsBlocked(
  dto: { showOrientation?: boolean; sameOrientationFirst?: boolean },
  orientation: Orientation | null,
): boolean {
  return orientation == null && (dto.showOrientation === true || dto.sameOrientationFirst === true);
}

// ---- Instagram ----

export type InstagramInput = { ok: true; handle: string | null } | { ok: false };

/**
 * PATCH /me instagram: aceita @, link colado (instagram.com/fulano?hl=pt) e maiúsculas; '' ou null apaga;
 * undefined = não mexe; fora da regra do Instagram → ok:false (400 instagram_invalid).
 */
export function parseInstagramInput(raw: string | null | undefined): InstagramInput | undefined {
  if (raw === undefined) return undefined;
  const handle = normalizeInstagramHandle(raw);
  if (handle == null) return { ok: true, handle: null };
  return isValidInstagramHandle(handle) ? { ok: true, handle } : { ok: false };
}

// ---- última atividade (cartão público) ----

/**
 * Cartão público: nunca o horário exato. Só a faixa 'online' (< 15 min) ou 'recent' (< 60 min), e só pra quem tem
 * direito (descobre a pessoa agora ou deu match); mais antigo ou sem direito → null. Mesmo em faixa, consultar em
 * loop revelaria a rotina de um estranho — por isso a trava.
 */
export function cardLastSeen(
  lastActiveAt: Date | null | undefined,
  canSee: boolean,
  now: number = Date.now(),
): 'online' | 'recent' | null {
  if (!canSee || !lastActiveAt) return null;
  const age = now - lastActiveAt.getTime();
  if (age < 0) return 'online'; // relógio adiantado: conta como agora
  if (age < PRIVACY.ONLINE_MIN * 60_000) return 'online';
  if (age < PRIVACY.RECENT_MIN * 60_000) return 'recent';
  return null;
}
