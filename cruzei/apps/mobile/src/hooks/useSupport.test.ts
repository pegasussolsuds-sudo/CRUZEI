import type { SupportMessage, SupportThreadResponse } from '@cruzei/shared-types';

// sem rede nem socket: só as funções puras do suporte
jest.mock('../services/api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../services/socket', () => ({ getSocket: () => null }));

import {
  createTypingEmitter,
  mergeFetchedThread,
  mergeSupportView,
  normalizeThreadResponse,
  pruneSupportOutbox,
  parseSendResponse,
  settleSupportOutbox,
  upsertSupportMessage,
  type SupportOutboxMessage,
} from './useSupport';

const T1 = '00000000-0000-4000-8000-0000000000d1';
const T2 = '00000000-0000-4000-8000-0000000000d2';
const ME = '00000000-0000-4000-8000-0000000000a1';

function msg(id: string, at: string, over: Partial<SupportMessage> = {}): SupportMessage {
  return { id, threadId: T1, author: 'staff', senderId: 's1', senderName: 'Equipe Metch', body: id, internal: false, createdAt: at, ...over };
}

function mine(id: string, at: string, clientId?: string, over: Partial<SupportMessage> = {}): SupportMessage {
  return msg(id, at, { author: 'user', senderId: ME, senderName: null, ...(clientId ? { clientId } : {}), ...over });
}

function optimistic(clientId: string, body: string, over: Partial<SupportOutboxMessage> = {}): SupportOutboxMessage {
  return { ...mine(clientId, '2026-09-29T12:00:09.000Z', clientId, { body, threadId: T1 }), pending: true, ...over };
}

function data(messages: SupportMessage[], over: Partial<SupportThreadResponse['thread'] & object> = {}): SupportThreadResponse {
  return {
    thread: { id: T1, status: 'open', createdAt: '2026-09-29T12:00:00.000Z', lastMessageAt: '2026-09-29T12:00:05.000Z', unread: 0, rating: null, ...over },
    messages,
  };
}

describe('envio otimista: reconciliação pelo clientId', () => {
  it('eco/histórico com o mesmo clientId: o balão "enviando" vira a mensagem real', () => {
    const outbox = [optimistic('c1', 'oi')];
    const real = mine('m1', '2026-09-29T12:00:10.000Z', 'c1', { body: 'oi' });
    const next = settleSupportOutbox(outbox, new Map([['c1', real]]));
    expect(next[0]).toMatchObject({ id: 'm1', clientId: 'c1', pending: false, failed: false, sent: true });
  });

  it('o "não foi · toca pra reenviar" cuja mensagem o servidor já tem também vira a real (sem reenviar)', () => {
    const outbox = [optimistic('c1', 'oi', { pending: false, failed: true })];
    const next = settleSupportOutbox(outbox, new Map([['c1', mine('m1', '2026-09-29T12:00:10.000Z', 'c1')]]));
    expect(next[0]).toMatchObject({ id: 'm1', failed: false, sent: true });
  });

  it('nada a reconciliar devolve o mesmo array (sem re-render)', () => {
    const outbox = [optimistic('c1', 'oi')];
    expect(settleSupportOutbox(outbox, new Map([['outro', mine('m9', '2026-09-29T12:00:10.000Z', 'outro')]]))).toBe(outbox);
  });

  it('lista na tela: a otimista some quando o histórico traz o mesmo clientId (sem balão duplicado)', () => {
    const history = [msg('s1', '2026-09-29T12:00:01.000Z'), mine('m1', '2026-09-29T12:00:10.000Z', 'c1', { body: 'oi' })];
    const view = mergeSupportView(history, [optimistic('c1', 'oi')]);
    expect(view.map((m) => m.id)).toEqual(['s1', 'm1']);
  });

  it('confirmada pelo POST e histórico sem clientId: sem duplicar e o balão herda o clientId (não remonta)', () => {
    const history = [mine('m1', '2026-09-29T12:00:10.000Z', undefined, { body: 'oi' })];
    const outbox = [optimistic('c1', 'oi', { id: 'm1', pending: false, sent: true })];
    const view = mergeSupportView(history, outbox);
    expect(view).toHaveLength(1);
    expect(view[0]).toMatchObject({ id: 'm1', clientId: 'c1' });
  });

  it('as ainda no ar ficam depois do histórico, na ordem de envio', () => {
    const history = [msg('s1', '2026-09-29T12:00:01.000Z')];
    const view = mergeSupportView(history, [optimistic('c1', 'a'), optimistic('c2', 'b', { pending: false, failed: true })]);
    expect(view.map((m) => m.clientId ?? m.id)).toEqual(['s1', 'c1', 'c2']);
  });

  it('atendimento novo na tela: as confirmadas do anterior saem; no ar e falhas ficam', () => {
    const outbox: SupportOutboxMessage[] = [
      optimistic('c1', 'velha', { id: 'm1', threadId: T1, pending: false, sent: true }),
      optimistic('c2', 'nova', { id: 'm2', threadId: T2, pending: false, sent: true }),
      optimistic('c3', 'no ar', { threadId: T1 }),
      optimistic('c4', 'falhou', { threadId: T1, pending: false, failed: true }),
    ];
    expect(pruneSupportOutbox(outbox, T2).map((o) => o.clientId)).toEqual(['c2', 'c3', 'c4']);
    const same = [optimistic('c3', 'no ar')];
    expect(pruneSupportOutbox(same, T2)).toBe(same);
  });

  it('resposta do POST: a mensagem pura ou {message, thread}', () => {
    const m = mine('m1', '2026-09-29T12:00:10.000Z', 'c1');
    expect(parseSendResponse(m)).toEqual({ message: m, thread: null });
    const t = data([]).thread;
    expect(parseSendResponse({ message: m, thread: t })).toEqual({ message: m, thread: t });
    expect(parseSendResponse({ ok: true })).toEqual({ message: null, thread: null });
  });
});

describe("'support:message' no cache", () => {
  it('troca a otimista do cache pelo eco (mesmo clientId) e mantém a ordem', () => {
    const prev = data([msg('s1', '2026-09-29T12:00:01.000Z'), mine('c1', '2026-09-29T12:00:09.000Z', 'c1')]);
    const { next, stale } = upsertSupportMessage(prev, { threadId: T1, message: mine('m1', '2026-09-29T12:00:10.000Z', 'c1') });
    expect(stale).toBe(false);
    expect(next?.messages.map((m) => m.id)).toEqual(['s1', 'm1']);
    expect(next?.thread?.lastMessageAt).toBe('2026-09-29T12:00:10.000Z');
  });

  it('mensagem repetida (mesmo id) não duplica', () => {
    const prev = data([msg('s1', '2026-09-29T12:00:01.000Z')]);
    const { next } = upsertSupportMessage(prev, { threadId: T1, message: msg('s1', '2026-09-29T12:00:01.000Z') });
    expect(next?.messages).toHaveLength(1);
  });

  it('fora de ordem (reconexão) entra no lugar certo', () => {
    const prev = data([msg('s1', '2026-09-29T12:00:01.000Z'), msg('s3', '2026-09-29T12:00:03.000Z')]);
    const { next } = upsertSupportMessage(prev, { threadId: T1, message: msg('s2', '2026-09-29T12:00:02.000Z') });
    expect(next?.messages.map((m) => m.id)).toEqual(['s1', 's2', 's3']);
  });

  it('atendimento novo (outro threadId): o cache não serve, busca de novo', () => {
    const prev = data([msg('s1', '2026-09-29T12:00:01.000Z')], { status: 'resolved' });
    const { next, stale } = upsertSupportMessage(prev, { threadId: T2, message: mine('m1', '2026-09-29T12:10:00.000Z', 'c1', { threadId: T2 }) });
    expect(stale).toBe(true);
    expect(next).toBe(prev);
  });

  it('sem atendimento no cache (1ª mensagem da vida): busca de novo', () => {
    expect(upsertSupportMessage({ thread: null, messages: [] }, { threadId: T1, message: mine('m1', '2026-09-29T12:00:10.000Z') }).stale).toBe(true);
  });

  it('mensagem de sistema (encerrado, reaberto) pede o atendimento de novo (o status mudou)', () => {
    const prev = data([msg('s1', '2026-09-29T12:00:01.000Z')]);
    const { next, stale } = upsertSupportMessage(prev, { threadId: T1, message: msg('x1', '2026-09-29T12:00:20.000Z', { author: 'system', senderId: null }) });
    expect(stale).toBe(true);
    expect(next?.messages.map((m) => m.id)).toEqual(['s1', 'x1']);
  });

  it('nota interna nunca entra (segunda trava; o servidor já não manda)', () => {
    const prev = data([msg('s1', '2026-09-29T12:00:01.000Z')]);
    const { next } = upsertSupportMessage(prev, { threadId: T1, message: msg('i1', '2026-09-29T12:00:02.000Z', { internal: true }) });
    expect(next).toBe(prev);
    expect(normalizeThreadResponse({ thread: prev.thread, messages: [msg('i1', 'x', { internal: true }), msg('s1', 'y')] }).messages.map((m) => m.id)).toEqual(['s1']);
  });

  it('GET que volta depois de um evento: não perde o que chegou pelo socket e mantém o clientId', () => {
    const prev = data([mine('m1', '2026-09-29T12:00:10.000Z', 'c1'), msg('s2', '2026-09-29T12:00:20.000Z')]);
    const fetched = data([mine('m1', '2026-09-29T12:00:10.000Z')]);
    const merged = mergeFetchedThread(prev, fetched);
    expect(merged.messages.map((m) => m.id)).toEqual(['m1', 's2']);
    expect(merged.messages[0].clientId).toBe('c1');
  });

  it('GET de outro atendimento substitui o cache inteiro', () => {
    const prev = data([msg('s1', '2026-09-29T12:00:01.000Z')]);
    const fetched: SupportThreadResponse = { ...data([mine('m9', '2026-09-29T13:00:00.000Z', undefined, { threadId: T2 })], { id: T2 }) };
    expect(mergeFetchedThread(prev, fetched)).toBe(fetched);
  });
});

describe('"digitando" com moderação', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('true só na mudança, repetido a cada 3 s enquanto digita, e false ao parar', () => {
    let now = 0;
    const sent: boolean[] = [];
    const t = createTypingEmitter((v) => sent.push(v), { now: () => now, repeatMs: 3000, idleMs: 1500 });
    t.input(1);
    now = 500;
    t.input(2);
    now = 1000;
    t.input(3);
    expect(sent).toEqual([true]);
    now = 3000;
    t.input(4); // 3 s depois do primeiro: repete
    expect(sent).toEqual([true, true]);
    jest.advanceTimersByTime(1500); // parou de digitar
    expect(sent).toEqual([true, true, false]);
  });

  it('apagar tudo ou enviar para na hora; um false solto nunca sai', () => {
    const sent: boolean[] = [];
    const t = createTypingEmitter((v) => sent.push(v));
    t.stop();
    t.input(0);
    expect(sent).toEqual([]);
    t.input(3);
    t.input(0);
    expect(sent).toEqual([true, false]);
    t.input(2);
    t.stop();
    t.dispose();
    jest.runAllTimers();
    expect(sent).toEqual([true, false, true, false]);
  });
});
