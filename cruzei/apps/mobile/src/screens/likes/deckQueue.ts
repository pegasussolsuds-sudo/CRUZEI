// Fila do deck de curtidas (regras puras). O servidor já manda o deck pronto (GET /location/nearby?deck=1): quem me
// deu super curtida primeiro, sem quem eu passei nos últimos 30 dias nem quem eu já curti. Aqui só entra o que muda
// antes da próxima carga: quem acabei de curtir/passar some, e o cartão devolvido pelo "Voltar" volta pro topo.
import type { DeckUser } from '@cruzei/shared-types';

export function buildDeckQueue(
  users: readonly DeckUser[],
  acted: ReadonlySet<string>,
  front: DeckUser | null,
  iLikedThem: (u: DeckUser) => boolean,
): DeckUser[] {
  // invisível não entra (não dá pra curtir quem não se revelou); curtido (sozinho ou os dois) também não
  const ok = (u: DeckUser) => !u.isAnonymous && !iLikedThem(u) && !acted.has(u.id);
  const rest = users.filter((u) => ok(u) && u.id !== front?.id);
  return front && ok(front) ? [front, ...rest] : rest;
}

/** contagens do cabeçalho: no raio, em destaque (Boost) e super curtidas pendentes (podem vir de longe, sem faixa) */
export function deckCounts(queue: readonly DeckUser[]): { inRadius: number; boosted: number; superPending: number } {
  let inRadius = 0;
  let boosted = 0;
  let superPending = 0;
  for (const u of queue) {
    if (u.superLikedMe) superPending++;
    if (u.proximityBand === 'boost') boosted++;
    else if (u.proximityBand != null) inRadius++;
  }
  return { inRadius, boosted, superPending };
}
