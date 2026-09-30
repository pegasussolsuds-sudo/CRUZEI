import type { DeckUser } from '@cruzei/shared-types';

import { buildDeckQueue, deckCounts } from './deckQueue';

const u = (id: string, extra: Partial<DeckUser> = {}): DeckUser =>
  ({ id, name: id, isAnonymous: false, proximityBand: 'near', ...extra }) as DeckUser;
const liked = new Set(['liked']);
const iLiked = (x: DeckUser) => liked.has(x.id);
const ids = (q: DeckUser[]) => q.map((x) => x.id);

describe('fila do deck', () => {
  it('tira invisível, quem eu já curti e quem acabei de curtir/passar', () => {
    const users = [u('a'), u('anon', { isAnonymous: true }), u('liked'), u('b'), u('c')];
    expect(ids(buildDeckQueue(users, new Set(['b']), null, iLiked))).toEqual(['a', 'c']);
  });

  it('"Voltar": o cartão devolvido vai pro topo, sem duplicar, mesmo que a carga nova não traga ele', () => {
    const users = [u('a'), u('b')];
    expect(ids(buildDeckQueue(users, new Set(), u('b'), iLiked))).toEqual(['b', 'a']);
    expect(ids(buildDeckQueue(users, new Set(), u('z'), iLiked))).toEqual(['z', 'a', 'b']);
    // passou de novo: some
    expect(ids(buildDeckQueue(users, new Set(['z']), u('z'), iLiked))).toEqual(['a', 'b']);
  });

  it('super curtida pendente de longe (sem faixa) não conta como "no raio"', () => {
    const q = [u('s1', { superLikedMe: true, proximityBand: null }), u('s2', { superLikedMe: true }), u('a'), u('b', { proximityBand: 'boost' })];
    expect(deckCounts(q)).toEqual({ inRadius: 2, boosted: 1, superPending: 2 });
  });
});
