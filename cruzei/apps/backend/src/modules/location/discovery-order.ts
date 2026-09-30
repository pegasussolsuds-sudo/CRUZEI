// Filtro "Mostrar" e ordem da descoberta (mapa, lista e deck saem do mesmo GET /location/nearby).
//
// Puro (sem Redis, sem banco): o LocationService monta as chaves e chama selectTop com compareDiscovery.
// Ordem: boost ativo → mesma orientação (só de quem EXIBE a orientação) → faixa → rotação justa → id.
// Privacidade: a orientação de quem NÃO exibe nunca entra na conta (senão a posição no deck vazaria o dado).
//
// Faixa de idade (settings.ageMin/ageMax): só o MEU lado (não recíproco). Quem mostra a idade: idade exata. Quem
// esconde: bloco de 5 anos (passa se o bloco encosta na faixa) — mexer na faixa nunca revela mais que o bloco, e a
// idade nunca sai do servidor. Deck (GET /location/nearby?deck=1): super curtidas pendentes primeiro; fora quem eu
// passei há menos de DECK.PASS_DAYS e quem eu já curti (o mapa e a lista não mudam).
import {
  AGE_MAX,
  AGE_MIN,
  DISCOVERY_PASS_DAYS_DEFAULT,
  type ProximityBand,
} from '@cruzei/shared-types';
import { PROXIMITY_BAND_RANK, ageBucketInRange, ageInRange } from '@cruzei/shared-utils';

/** DISCOVERY_PASS_DAYS (env): inteiro de 1 a 365; fora disso, o padrão */
export function deckPassDays(raw: string | undefined = process.env.DISCOVERY_PASS_DAYS): number {
  const n = Number(raw);
  return raw && Number.isInteger(n) && n >= 1 && n <= 365 ? n : DISCOVERY_PASS_DAYS_DEFAULT;
}

export const DECK = {
  /** quem eu passei não volta no deck por X dias (continua no mapa); também é a validade da super curtida pendente */
  PASS_DAYS: deckPassDays(),
  /** super curtidas pendentes no topo de uma resposta (as seguintes vêm depois de responder estas) */
  SUPER_MAX: 50,
  /** super curtidas lidas do banco antes dos filtros (bloqueio, conta fora do ar, "Mostrar", idade) */
  SUPER_SCAN: 200,
} as const;

/** idade em anos completos em `now` — a MESMA conta da idade mostrada no /nearby (filtro e número nunca divergem) */
export function ageOn(birth: Date, now: Date): number {
  let a = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) a -= 1;
  return a;
}

/** o que o filtro de idade olha no candidato */
export interface AgeCandidate {
  birthDate?: Date | null;
  /** só true usa a idade exata; false/ausente = escondida (bloco de 5 anos) */
  showAge?: boolean | null;
}

export type AgeOk = (cand: AgeCandidate) => boolean;

/**
 * Filtro de idade de quem vê. null = sem limite (18 até 80+): nenhum custo por candidato. Faixa inválida (min > max
 * ou não inteira) também vira "sem limite" — nunca esvazia a descoberta por um valor quebrado. Quem mostra a idade
 * passa pela idade exata (já é pública); quem esconde, pelo bloco de 5 anos (ageBucketInRange).
 */
export function ageFilter(
  range: { ageMin?: number | null; ageMax?: number | null },
  now: Date = new Date(),
): AgeOk | null {
  const min = range.ageMin ?? AGE_MIN;
  const max = range.ageMax ?? AGE_MAX;
  if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) return null;
  if (min <= AGE_MIN && max >= AGE_MAX) return null;
  return (c) => {
    // sem data de nascimento com filtro ligado: fora (não dá pra garantir a faixa)
    if (!c.birthDate) return false;
    const age = ageOn(c.birthDate, now);
    return c.showAge === true ? ageInRange(age, min, max) : ageBucketInRange(age, min, max);
  };
}

/**
 * Super curtida pendente que pode ir pro topo do MEU deck (o resto — bloqueio, invisível, pausa, análise, conta fora
 * do ar — já foi filtrado antes). Vale o MEU "Mostrar" (um lado: ela já quis me ver) e a MINHA faixa de idade; quem
 * está em "Ninguém" (fora da descoberta) não aparece.
 */
export function superLikerShown(
  me: { showMe?: ShowMeLike },
  liker: { gender?: GenderLike; discoveryMode?: string | null } & AgeCandidate,
  ageOk: AgeOk | null,
): boolean {
  if (liker.discoveryMode === 'nobody') return false;
  if (!showMeAllows(me.showMe, liker.gender)) return false;
  return !ageOk || ageOk(liker);
}

/** deck: super curtidas pendentes primeiro (na ordem dada), depois o resto sem repetir ninguém */
export function mergeDeck<T extends { id: string }>(superFirst: T[], rest: T[]): T[] {
  const seen = new Set(superFirst.map((u) => u.id));
  return superFirst.concat(rest.filter((u) => !seen.has(u.id)));
}

/** gênero como vem do banco ('female' | 'male' | 'other'); null = desconhecido */
type GenderLike = string | null | undefined;
/** 'women' | 'men' | 'everyone'; null/desconhecido conta como 'everyone' (coluna nova: nunca esvazia a descoberta) */
type ShowMeLike = string | null | undefined;

/** UM lado do "Mostrar": quem escolheu `showMe` aceita ver alguém do gênero `gender`? other só em Todos */
export function showMeAllows(showMe: ShowMeLike, gender: GenderLike): boolean {
  if (showMe === 'women') return gender === 'female';
  if (showMe === 'men') return gender === 'male';
  return true;
}

/** RECÍPROCO (como o resto das regras de descoberta): A e B se veem só se os DOIS querem ver o gênero do outro */
export function showMeMutual(
  a: { showMe?: ShowMeLike; gender?: GenderLike },
  b: { showMe?: ShowMeLike; gender?: GenderLike },
): boolean {
  return showMeAllows(a.showMe, b.gender) && showMeAllows(b.showMe, a.gender);
}

/**
 * "Mesma orientação primeiro": só sobe quem EXIBE a orientação no perfil e tem exatamente o mesmo valor de quem vê
 * (e quem vê ligou a opção e informou a própria orientação). Só ordena — nunca filtra.
 */
export function sameOrientationHit(
  me: { sameOrientationFirst?: boolean | null; orientation?: string | null },
  cand: { showOrientation?: boolean | null; orientation?: string | null },
): boolean {
  return (
    !!me.sameOrientationFirst &&
    !!me.orientation &&
    !!cand.showOrientation &&
    cand.orientation === me.orientation
  );
}

/** FNV-1a de 32 bits + mistura final (murmur3 fmix32): ids parecidos não saem em ordem parecida */
export function fnv1a32(s: string, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Janela de rotação de quem vê. Cada pessoa tem uma fase própria dentro da janela: nem todo mundo troca de recorte
 * no mesmo segundo (e o recorte não pisca entre as buscas de 45 s dentro da janela).
 */
export function rotationWindow(
  salt: string,
  viewerId: string,
  now: number,
  windowMs: number,
): number {
  const w = Math.max(1, Math.floor(windowMs));
  const phase = fnv1a32(`${salt}:phase:${viewerId}`) % w;
  return Math.floor((now + phase) / w);
}

/** semente da rotação: estável pra mesma pessoa na mesma janela; muda com a pessoa e com a janela (salt = LOCATION_SALT) */
export function rotationSeed(
  salt: string,
  viewerId: string,
  now: number,
  windowMs: number,
): number {
  return fnv1a32(`${salt}:rot:${viewerId}:${rotationWindow(salt, viewerId, now, windowMs)}`);
}

/** chave de ordenação de um candidato (b/o: 0 vem antes) */
export interface DiscoveryKey {
  /** 0 = boost ativo */
  b: 0 | 1;
  /** 0 = mesma orientação (exibida) de quem vê, com a opção ligada */
  o: 0 | 1;
  /** faixa: bem perto → perto → na região → em destaque (boost além do raio) */
  r: number;
  /** posição pseudoaleatória estável na janela (rotação justa quando o lugar lota) */
  h: number;
  id: string;
}

export function discoveryKey(input: {
  id: string;
  boosted: boolean;
  sameOrientation: boolean;
  band: ProximityBand | null;
  seed: number;
}): DiscoveryKey {
  return {
    b: input.boosted ? 0 : 1,
    o: input.sameOrientation ? 0 : 1,
    r: input.band ? PROXIMITY_BAND_RANK[input.band] : 9,
    h: fnv1a32(input.id, input.seed),
    id: input.id,
  };
}

/** boost → mesma orientação → faixa → rotação → id (desempate total: a ordem nunca depende da chegada) */
export function compareDiscovery(a: DiscoveryKey, b: DiscoveryKey): number {
  return (
    a.b - b.b || a.o - b.o || a.r - b.r || a.h - b.h || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}
