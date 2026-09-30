// Fila da comemoração do match pra quem recebe: o mesmo match chega pelo socket, pelo push e pelos pendentes e aparece
// UMA vez; uma de cada vez; espera o modal de quem curtiu; vista no servidor ao APARECER.

jest.mock('../../services/api', () => ({
  api: { get: jest.fn(), post: jest.fn(() => Promise.resolve({ data: null })) },
}));

import type { MatchCelebration } from '@cruzei/shared-types';
import * as apiModule from '../../services/api';
import { toReceivedMatch, useMatchCelebrationStore } from '../matchCelebration';

const apiMock = apiModule as unknown as { api: { get: jest.Mock; post: jest.Mock } };

const store = () => useMatchCelebrationStore.getState();

function celebration(peerId: string, matchedAt = '2026-10-03T12:00:00.000Z', extra: Partial<MatchCelebration> = {}): MatchCelebration {
  return {
    peer: { id: peerId, name: `Pessoa ${peerId}`, avatar: { body: 1 } as never, mainPhotoUrl: null },
    conversationId: null,
    matchedAt,
    ...extra,
  };
}

/** o servidor devolve essas pendentes (mais nova primeiro, como a API) */
function serverPending(list: MatchCelebration[]) {
  apiMock.api.get.mockResolvedValue({ data: list });
}

const seenCalls = () => apiMock.api.post.mock.calls.map((c) => c[0] as string);

beforeEach(() => {
  store().reset();
  apiMock.api.get.mockReset();
  apiMock.api.post.mockClear();
  serverPending([]);
});

describe('toReceivedMatch', () => {
  it('vira o que o MatchModal precisa (+ o momento do match)', () => {
    expect(toReceivedMatch(celebration('b', 't1', { conversationId: 'c1' }))).toEqual({
      userId: 'b',
      name: 'Pessoa b',
      photo: null,
      avatar: { body: 1 },
      conversationId: 'c1',
      matchedAt: 't1',
    });
  });

  it('payload quebrado não entra', () => {
    expect(toReceivedMatch({} as never)).toBeNull();
    expect(toReceivedMatch({ peer: { id: 'b' } } as never)).toBeNull();
    expect(store().enqueue({ peer: null } as never)).toBe(false);
    expect(store().queue).toEqual([]);
  });
});

describe('dedupe entre socket, push e pendentes', () => {
  it('o mesmo match (pessoa + momento) entra uma vez só, venha por onde vier', async () => {
    expect(store().enqueue(celebration('b'))).toBe(true); // socket
    serverPending([celebration('b')]);
    await store().syncPending(); // pendentes ao conectar
    store().fromPush('b'); // push com o app aberto: já conhecido, nem busca
    expect(apiMock.api.get).toHaveBeenCalledTimes(1);
    expect(store().queue.map((m) => m.userId)).toEqual(['b']);

    // já mostrado e fechado: o socket atrasado não traz de volta
    store().pump();
    store().close();
    expect(store().enqueue(celebration('b'))).toBe(false);
    expect(store().queue).toEqual([]);
  });

  it('um match NOVO com a mesma pessoa (curtiu de novo depois de dias) entra', () => {
    store().enqueue(celebration('b', 't1'));
    expect(store().enqueue(celebration('b', 't2'))).toBe(true);
    expect(store().queue).toHaveLength(2);
  });

  it('pendentes entram na ordem em que aconteceram (a API manda a mais nova primeiro)', async () => {
    serverPending([celebration('c', 't2'), celebration('b', 't1')]);
    await store().syncPending();
    expect(store().queue.map((m) => m.userId)).toEqual(['b', 'c']);
  });

  it('push de match com o app aberto e o socket caído: busca as pendentes', async () => {
    serverPending([celebration('d')]);
    store().fromPush('d');
    await store().syncPending(); // a mesma busca em voo
    expect(apiMock.api.get).toHaveBeenCalledTimes(1);
    expect(apiMock.api.get).toHaveBeenCalledWith('/likes/matches/pending');
    expect(store().queue.map((m) => m.userId)).toEqual(['d']);
  });

  it('servidor fora: a busca falha em silêncio e dá pra tentar de novo', async () => {
    apiMock.api.get.mockRejectedValueOnce(new Error('Network Error'));
    await expect(store().syncPending()).resolves.toBeUndefined();
    serverPending([celebration('e')]);
    await store().syncPending();
    expect(store().queue.map((m) => m.userId)).toEqual(['e']);
  });
});

describe('fila: uma de cada vez', () => {
  it('pump mostra a próxima e marca vista no servidor NA HORA de mostrar', () => {
    store().enqueue(celebration('b'));
    store().enqueue(celebration('c'));
    expect(seenCalls()).toEqual([]); // enfileirar não marca

    store().pump();
    expect(store().current?.userId).toBe('b');
    expect(seenCalls()).toEqual(['/likes/matches/b/seen']);

    store().pump(); // já tem uma na tela: nada muda
    expect(store().current?.userId).toBe('b');

    store().close();
    expect(store().current).toBeNull(); // a próxima espera o host
    store().pump();
    expect(store().current?.userId).toBe('c');
    expect(seenCalls()).toEqual(['/likes/matches/b/seen', '/likes/matches/c/seen']);
  });

  it('modal de match de quem curtiu aberto: a fila espera até ele fechar', () => {
    const release = store().holdLocal();
    const release2 = store().holdLocal();
    store().enqueue(celebration('b'));
    store().pump();
    expect(store().current).toBeNull();

    release();
    release(); // soltar duas vezes não desconta de novo
    expect(store().localOpen).toBe(1);
    store().pump();
    expect(store().current).toBeNull();

    release2();
    store().pump();
    expect(store().current?.userId).toBe('b');
  });

  it('fila vazia: pump não faz nada', () => {
    store().pump();
    expect(store().current).toBeNull();
    expect(seenCalls()).toEqual([]);
  });
});

describe('toque no push do match (open)', () => {
  it('coloca essa pessoa na frente da fila', async () => {
    store().enqueue(celebration('b'));
    store().enqueue(celebration('c'));
    expect(await store().open('c')).toBe(true);
    expect(store().queue.map((m) => m.userId)).toEqual(['c', 'b']);
    expect(apiMock.api.get).not.toHaveBeenCalled();
  });

  it('ainda não conhecido: busca os pendentes antes', async () => {
    serverPending([celebration('d')]);
    expect(await store().open('d')).toBe(true);
    expect(store().queue.map((m) => m.userId)).toEqual(['d']);
  });

  it('já comemorado (aqui ou em outro aparelho): false (quem chama abre a conversa)', async () => {
    expect(await store().open('x')).toBe(false);
    store().enqueue(celebration('b'));
    store().pump();
    expect(await store().open('b')).toBe(true); // é a que está na tela
    store().close();
    expect(await store().open('b')).toBe(false);
  });
});

describe('logout', () => {
  it('reset limpa a fila, a atual, o contador e o dedupe', () => {
    store().holdLocal();
    store().enqueue(celebration('b'));
    store().reset();
    expect(store()).toMatchObject({ queue: [], current: null, localOpen: 0 });
    expect(store().enqueue(celebration('b'))).toBe(true); // outra conta no mesmo aparelho
  });
});
