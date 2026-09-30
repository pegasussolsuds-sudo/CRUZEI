// Filtro "Mostrar" e ordem da descoberta (mapa, lista e deck saem do mesmo GET /location/nearby).
//
// Puro (sem Redis, sem banco): o LocationService monta as chaves e chama selectTop com compareDiscovery.
// Ordem: boost ativo → mesma orientação (só de quem EXIBE a orientação) → faixa → rotação justa → id.
// Privacidade: a orientação de quem NÃO exibe nunca entra na conta (senão a posição no deck vazaria o dado).
import type { ProximityBand } from '@cruzei/shared-types';
import { PROXIMITY_BAND_RANK } from '@cruzei/shared-utils';

/** gênero como vem do banco ('female' | 'male' | 'non_binary' | 'other'); null = desconhecido */
type GenderLike = string | null | undefined;
/** 'women' | 'men' | 'everyone'; null/desconhecido conta como 'everyone' (coluna nova: nunca esvazia a descoberta) */
type ShowMeLike = string | null | undefined;

/** UM lado do "Mostrar": quem escolheu `showMe` aceita ver alguém do gênero `gender`? non_binary/other só em Todos */
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
