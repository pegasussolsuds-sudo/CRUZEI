// Regras puras dos campos do perfil: orientação (dado sensível, opcional; exibir por escolha), @ do Instagram, nome,
// bio, interesses, completude, faixa de idade do "quem ver" e a última atividade em FAIXA no cartão público. Sem banco nem Nest: o users.service e o cartão (GET /users/:id) usam
// daqui. O filtro "Mostrar" e a ordem "mesma orientação primeiro" moram na descoberta (location/discovery-order.ts).
import {
  AGE_MAX,
  AGE_MIN,
  AGE_RANGE_DAILY_CHANGES,
  AGE_RANGE_MIN_GAP,
  PROFILE_LIMITS,
  type Orientation,
} from '@cruzei/shared-types';
import {
  isValidAgeRange,
  isValidInstagramHandle,
  normalizeInstagramHandle,
} from '@cruzei/shared-utils';

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

// ---- nome, bio e interesses (cadastro e PATCH /me) ----

/** corpo do 400 quando o nome fica curto demais depois de tirar os espaços */
export const NAME_INVALID = {
  error: 'name_invalid',
  message: 'Seu nome precisa ter pelo menos 2 letras',
} as const;

/** nome sem espaços sobrando (nas pontas e repetidos no meio); curto (< 2) ou longo demais → null */
export function cleanName(raw: string | null | undefined): string | null {
  const name = (raw ?? '').replace(/\s+/g, ' ').trim();
  return name.length >= 2 && name.length <= PROFILE_LIMITS.nameMax ? name : null;
}

/** bio: undefined = não mexe; só espaço ou vazio = sem bio (null); o resto vai sem as pontas */
export function cleanBio(raw: string | null | undefined): string | null | undefined {
  if (raw === undefined) return undefined;
  const bio = (raw ?? '').trim();
  return bio ? bio.slice(0, PROFILE_LIMITS.bioMax) : null;
}

/** nomes do catálogo: sem pontas, sem vazio, sem repetido, no máximo PROFILE_LIMITS.interestsMax (o resto some) */
export function cleanInterestNames(names: readonly string[] | null | undefined): string[] {
  const out: string[] = [];
  for (const raw of names ?? []) {
    const n = typeof raw === 'string' ? raw.trim() : '';
    if (n && !out.includes(n)) out.push(n);
    if (out.length >= PROFILE_LIMITS.interestsMax) break;
  }
  return out;
}

/** completude do perfil (0–100): mesma conta no cadastro e depois de cada edição */
export function profileCompleteness(p: {
  name?: string | null;
  bio?: string | null;
  photos: number;
  interests: number;
  lookingFor?: string | null;
  isVerified?: boolean;
}): number {
  let score = 0;
  if (p.name) score += 10;
  if (p.bio) score += 15;
  if (p.photos >= 1) score += 20;
  if (p.photos >= 2) score += 10;
  if (p.photos >= 4) score += 5;
  if (p.interests >= 3) score += 15;
  if (p.interests >= 6) score += 5;
  if (p.lookingFor && p.lookingFor !== 'unspecified') score += 5;
  if (p.isVerified) score += 15;
  return Math.min(100, score);
}

// ---- faixa de idade do "quem ver" (PATCH /me/settings) ----

/** corpo do 400 (ApiErrorCode 'age_range_invalid'); o CHECK users_age_range_chk viraria 500 */
export const AGE_RANGE_INVALID = {
  error: 'age_range_invalid',
  message: `A faixa de idade vai de ${AGE_MIN} a 80+, com pelo menos ${AGE_RANGE_MIN_GAP} anos entre o "de" e o "até"`,
} as const;

/**
 * Corpo do 429 (ApiErrorCode 'age_range_limit'): a faixa já mudou AGE_RANGE_DAILY_CHANGES vezes hoje. O limite existe
 * porque trocar a faixa sem parar e olhar quem some ajudaria a descobrir a idade de quem esconde.
 */
export function ageRangeLimitBody(resetsAt: Date) {
  return {
    error: 'age_range_limit' as const,
    message: `Dá pra mudar a faixa de idade ${AGE_RANGE_DAILY_CHANGES} vezes por dia. Amanhã libera de novo 😉`,
    limit: AGE_RANGE_DAILY_CHANGES,
    resetsAt: resetsAt.toISOString(),
  };
}

/**
 * A faixa depois do PATCH (a ponta que não veio sai do banco): null = fora da regra; `changed` = muda algo (igual ao
 * gravado não gasta mudança do dia).
 */
export function nextAgeRange(
  cur: { ageMin: number; ageMax: number },
  data: { ageMin?: number; ageMax?: number },
): { ageMin: number; ageMax: number; changed: boolean } | null {
  const ageMin = data.ageMin ?? cur.ageMin;
  const ageMax = data.ageMax ?? cur.ageMax;
  if (!isValidAgeRange(ageMin, ageMax)) return null;
  return { ageMin, ageMax, changed: ageMin !== cur.ageMin || ageMax !== cur.ageMax };
}

/**
 * O que gravar da faixa. As duas pontas: confere a regra inteira (com o vão mínimo). Só uma: confere os limites dela
 * e devolve a trava (`guard`) contra a outra ponta que está no banco — o UPDATE só pega se a faixa continuar válida,
 * vão incluído (sem corrida com outro PATCH). Nada → null (não mexe).
 */
export function ageRangeUpdate(
  ageMin: number | undefined,
  ageMax: number | undefined,
):
  | null
  | { ok: false }
  | {
      ok: true;
      data: { ageMin?: number; ageMax?: number };
      guard: { ageMax: { gte: number } } | { ageMin: { lte: number } } | null;
    } {
  if (ageMin === undefined && ageMax === undefined) return null;
  if (ageMin !== undefined && ageMax !== undefined) {
    return isValidAgeRange(ageMin, ageMax)
      ? { ok: true, data: { ageMin, ageMax }, guard: null }
      : { ok: false };
  }
  if (ageMin !== undefined) {
    return isValidAgeRange(ageMin, AGE_MAX)
      ? { ok: true, data: { ageMin }, guard: { ageMax: { gte: ageMin + AGE_RANGE_MIN_GAP } } }
      : { ok: false };
  }
  return isValidAgeRange(AGE_MIN, ageMax)
    ? {
        ok: true,
        data: { ageMax: ageMax as number },
        guard: { ageMin: { lte: (ageMax as number) - AGE_RANGE_MIN_GAP } },
      }
    : { ok: false };
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
