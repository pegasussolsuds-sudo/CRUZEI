import { QueryClient, QueryObserver, type UseQueryOptions } from '@tanstack/react-query';
import type { ChatMessage, ConversationDetail } from '@cruzei/shared-types';

// sem rede nem socket: o GET é controlado pelo teste (promessas que ele resolve na ordem que quiser)
jest.mock('../services/api', () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn() },
  toApiError: (e: unknown) => ({ status: (e as { status?: number } | null)?.status ?? 0, message: 'erro' }),
}));
jest.mock('../services/socket', () => ({ inboxPollMs: 120_000 }));

import { api } from '../services/api';
import {
  applyPromoted,
  conversationMessagesQuery,
  conversationQuery,
  inboxKeys,
  likerIdOf,
  settleOutbox,
  upsertMessage,
  type CachedMessage,
  type OutboxMessage,
} from './useInbox';

const CONV = '00000000-0000-4000-8000-0000000000c1';
const ME = '00000000-0000-4000-8000-0000000000a1';
const PEER = '00000000-0000-4000-8000-0000000000b1';
const get = api.get as jest.Mock;

function msg(id: string, at: string, over: Partial<CachedMessage> = {}): CachedMessage {
  return {
    id,
    conversationId: CONV,
    senderId: PEER,
    body: id,
    mediaUrl: null,
    createdAt: at,
    readAt: null,
    systemKind: null,
    messageType: 'text',
    ...over,
  } as ChatMessage;
}

function detail(route: 'request' | 'principal', requestMessagesLeft: number | null): ConversationDetail {
  return {
    id: CONV,
    peer: { id: PEER, name: 'Bia', avatar: null, mainPhotoUrl: null },
    folder: 'inbox', // quem pediu vê na principal (selo "aguardando")
    route,
    myRole: 'REQUESTER',
    awaitingReply: route === 'request',
    lastMessage: null,
    lastMessageAt: null,
    unreadCount: 0,
    isMuted: false,
    promotedAt: route === 'principal' ? '2026-09-29T10:00:05.000Z' : null,
    promotedReason: route === 'principal' ? 'bounce' : null,
    likeStatus: 'NONE',
    createdAt: '2026-09-29T10:00:00.000Z',
    archivedAt: null,
    requestMessagesLeft,
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** deixa as promessas resolvidas andarem (React Query grava o resultado em microtasks) */
const flush = () => new Promise<void>((r) => setTimeout(() => r(), 0));

let qc: QueryClient;
let unsubs: Array<() => void> = [];

function watch<T, K extends readonly unknown[]>(options: UseQueryOptions<T, Error, T, K>) {
  // observer = tela aberta (query ativa): é o que o invalidate busca de novo
  const obs = new QueryObserver<T, Error, T, T, K>(qc, options);
  unsubs.push(obs.subscribe(() => undefined));
  return obs;
}

beforeEach(() => {
  get.mockReset();
  qc = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
});

afterEach(() => {
  unsubs.forEach((u) => u());
  unsubs = [];
  qc.clear();
});

describe('evento do socket com busca em andamento (achado 11)', () => {
  it('message:new durante a 1ª carga do histórico: a resposta velha (sem a mensagem) é descartada e a busca refeita', async () => {
    const A = msg('m-a', '2026-09-29T10:00:00.000Z');
    const M = msg('m-new', '2026-09-29T10:00:01.000Z');
    const stale = deferred<{ data: CachedMessage[] }>();
    const fresh = deferred<{ data: CachedMessage[] }>();
    get.mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise);

    watch(conversationMessagesQuery(qc, CONV));
    expect(get).toHaveBeenCalledTimes(1);

    upsertMessage(qc, CONV, M); // chega antes da resposta (o SELECT dela rodou antes do commit de M)
    expect(get).toHaveBeenCalledTimes(2);

    stale.resolve({ data: [A] });
    await flush();
    expect(qc.getQueryData(inboxKeys.messages(CONV))).toBeUndefined();

    fresh.resolve({ data: [A, M] });
    await flush();
    expect(qc.getQueryData<CachedMessage[]>(inboxKeys.messages(CONV))?.map((m) => m.id)).toEqual(['m-a', 'm-new']);
  });

  it('message:new durante um refetch do histórico: a mensagem continua lá depois da resposta velha', async () => {
    const A = msg('m-a', '2026-09-29T10:00:00.000Z');
    const M = msg('m-new', '2026-09-29T10:00:01.000Z', { senderId: ME, clientId: 'c_1' });
    get.mockResolvedValueOnce({ data: [A] });
    watch(conversationMessagesQuery(qc, CONV));
    await flush();

    const stale = deferred<{ data: CachedMessage[] }>();
    const fresh = deferred<{ data: CachedMessage[] }>();
    get.mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise);
    void qc.invalidateQueries({ queryKey: inboxKeys.messages(CONV) }); // ex.: reconexão do socket
    upsertMessage(qc, CONV, M);
    expect(qc.getQueryData<CachedMessage[]>(inboxKeys.messages(CONV))?.map((m) => m.id)).toEqual(['m-a', 'm-new']);
    expect(get).toHaveBeenCalledTimes(3);

    stale.resolve({ data: [A] });
    await flush();
    // o servidor manda o histórico sem o clientId: o do eco fica (balão não remonta)
    fresh.resolve({ data: [A, { ...M, clientId: undefined }] });
    await flush();
    const got = qc.getQueryData<CachedMessage[]>(inboxKeys.messages(CONV));
    expect(got?.map((m) => m.id)).toEqual(['m-a', 'm-new']);
    expect(got?.[1].clientId).toBe('c_1');
  });

  it('sem busca em voo o evento só acerta o cache (nenhuma requisição a mais)', async () => {
    get.mockResolvedValueOnce({ data: [msg('m-a', '2026-09-29T10:00:00.000Z')] });
    watch(conversationMessagesQuery(qc, CONV));
    await flush();
    upsertMessage(qc, CONV, msg('m-b', '2026-09-29T10:00:02.000Z'));
    expect(get).toHaveBeenCalledTimes(1);
    expect(qc.getQueryData<CachedMessage[]>(inboxKeys.messages(CONV))?.map((m) => m.id)).toEqual(['m-a', 'm-b']);
  });

  it('chat fechado (sem query do histórico): o evento é ignorado e nada é buscado', () => {
    upsertMessage(qc, CONV, msg('m-a', '2026-09-29T10:00:00.000Z'));
    expect(get).not.toHaveBeenCalled();
    expect(qc.getQueryData(inboxKeys.messages(CONV))).toBeUndefined();
  });

  it('conversation:promoted com o GET do detalhe em voo: a resposta velha não devolve a conversa pra solicitação', async () => {
    get.mockResolvedValueOnce({ data: detail('request', 1) });
    watch(conversationQuery(CONV));
    await flush();

    // o REQUESTER mandou a 3ª: o chat invalida o detalhe pra saber quantas ainda cabem
    const stale = deferred<{ data: ConversationDetail }>();
    const fresh = deferred<{ data: ConversationDetail }>();
    get.mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise);
    void qc.invalidateQueries({ queryKey: inboxKeys.conversation(CONV) });

    applyPromoted(qc, { conversationId: CONV, reason: 'bounce', promotedAt: '2026-09-29T10:00:05.000Z' });
    expect(qc.getQueryData<ConversationDetail>(inboxKeys.conversation(CONV))?.route).toBe('principal');
    expect(get).toHaveBeenCalledTimes(3);

    stale.resolve({ data: detail('request', 0) });
    await flush();
    expect(qc.getQueryData<ConversationDetail>(inboxKeys.conversation(CONV))?.route).toBe('principal');

    fresh.resolve({ data: detail('principal', null) });
    await flush();
    const d = qc.getQueryData<ConversationDetail>(inboxKeys.conversation(CONV));
    expect(d?.route).toBe('principal');
    expect(d?.requestMessagesLeft).toBeNull();
  });
});

describe('settleOutbox: reenvio no rascunho (achado 12)', () => {
  const base = (clientId: string, over: Partial<OutboxMessage> = {}): OutboxMessage => ({
    ...msg(clientId, '2026-09-29T10:00:00.000Z', { senderId: ME, conversationId: '' }),
    clientId,
    ...over,
  });

  it('balão "não foi" cujo clientId o servidor já tem vira a mensagem real (sem reenviar)', () => {
    const failed = base('c_1', { failed: true });
    const other = base('c_2', { pending: true });
    const real = msg('m-real', '2026-09-29T10:00:00.500Z', { senderId: ME, clientId: 'c_1' });
    const out = settleOutbox([failed, other], new Map([['c_1', real]]));
    expect(out[0]).toMatchObject({ id: 'm-real', conversationId: CONV, clientId: 'c_1', failed: false, pending: false, sent: true });
    expect(out[1]).toBe(other);
  });

  it('nada a reconciliar devolve o mesmo array (sem re-render)', () => {
    const sent = base('c_1', { id: 'm-real', sent: true });
    const outbox = [sent, base('c_2', { pending: true })];
    expect(settleOutbox(outbox, new Map([['c_1', msg('m-real', '2026-09-29T10:00:00.500Z', { clientId: 'c_1' })]]))).toBe(outbox);
    expect(settleOutbox(outbox, new Map())).toBe(outbox);
  });
});

describe('likerIdOf: like_received sem identidade pra quem não é Premium+', () => {
  it.each([
    [{ isSuper: false }, null],
    [{ isSuper: true, isMutual: false }, null],
    [{ fromUserId: '', isSuper: false }, null],
    [{ fromUserId: 42, isSuper: false }, null],
    [null, null],
    [undefined, null],
    ['u', null],
    [{ fromUserId: PEER, isSuper: false, isMutual: true }, PEER],
  ])('%j → %s', (payload, expected) => {
    expect(likerIdOf(payload)).toBe(expected);
  });
});
