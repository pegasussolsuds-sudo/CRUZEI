import {
  emitEvent,
  flushInboxEvents,
  leaveEvent,
  messagePushTargets,
  withoutHeld,
  type InboxGatewayPort,
} from './inbox.events';

// Os eventos saem na ordem em que a transação juntou, só pras salas user:<id> do par; mesmo payload pros dois = um emit.

function fakeGateway() {
  const calls: unknown[][] = [];
  const gw: InboxGatewayPort = {
    emitToUser: (...a) => void calls.push(['emitToUser', ...a]),
    emitToUsers: (...a) => void calls.push(['emitToUsers', ...a]),
    removeFromConversation: (...a) => void calls.push(['removeFromConversation', ...a]),
  };
  return { gw, calls };
}

describe('flushInboxEvents', () => {
  it('um destino → emitToUser; dois → um emitToUsers; saída da sala → removeFromConversation; na ordem', () => {
    const { gw, calls } = fakeGateway();
    flushInboxEvents(gw, [
      emitEvent('a', 'message:new', { conversationId: 'c', message: {} as never, unreadCount: 0 }),
      emitEvent(['a', 'b'], 'conversation:promoted', {
        conversationId: 'c',
        reason: 'bounce',
        promotedAt: 't',
      }),
      emitEvent(['a', 'b'], 'conversation:removed', { conversationId: 'c' }),
      leaveEvent('c', ['a', 'b']),
    ]);
    expect(calls.map((c) => c[0])).toEqual([
      'emitToUser',
      'emitToUsers',
      'emitToUsers',
      'removeFromConversation',
    ]);
    expect(calls[1]).toEqual([
      'emitToUsers',
      ['a', 'b'],
      'conversation:promoted',
      { conversationId: 'c', reason: 'bounce', promotedAt: 't' },
    ]);
    expect(calls[3]).toEqual(['removeFromConversation', 'c', ['a', 'b']]);
  });

  it('lista vazia não emite nada', () => {
    const { gw, calls } = fakeGateway();
    flushInboxEvents(gw, []);
    flushInboxEvents(gw, [{ kind: 'emit', to: [], event: 'message:read', payload: {} as never }]);
    expect(calls).toEqual([]);
  });
});

describe('withoutHeld (invisível sem Premium não recebe)', () => {
  const msg = { conversationId: 'c', message: {} as never, unreadCount: 1 };
  it('tira quem está retido dos eventos de entrega; emit que fica sem ninguém some', () => {
    const events = [
      emitEvent('ana', 'message:new', msg),
      emitEvent('bia', 'message:new', msg),
      emitEvent(['ana', 'bia'], 'conversation:promoted', {
        conversationId: 'c',
        reason: 'bounce',
        promotedAt: 'x',
      }),
      emitEvent(['ana', 'bia'], 'message:read', {
        conversationId: 'c',
        readerId: 'ana',
        upToMessageId: null,
        readAt: 'x',
      }),
    ];
    const out = withoutHeld(events, new Set(['bia']));
    expect(out.map((e) => (e.kind === 'emit' ? [e.event, e.to] : e.kind))).toEqual([
      ['message:new', ['ana']],
      ['conversation:promoted', ['ana']],
      ['message:read', ['ana']],
    ]);
  });

  it('saída da sala, remoção e curtida passam intactas; ninguém retido = a mesma lista', () => {
    const events = [
      leaveEvent('c', ['bia']),
      emitEvent('bia', 'conversation:removed', { conversationId: 'c' }),
      emitEvent('bia', 'like_received', { isSuper: false }),
    ];
    expect(withoutHeld(events, new Set(['bia']))).toEqual(events);
    expect(withoutHeld(events, new Set())).toEqual(events);
  });
});

describe('messagePushTargets (quem recebe push de mensagem nova)', () => {
  const message = (senderId: string, extra: Record<string, unknown> = {}) =>
    ({
      id: 'm1',
      conversationId: 'c',
      senderId,
      body: 'oi',
      mediaUrl: null,
      createdAt: 't',
      readAt: null,
      systemKind: null,
      messageType: 'text',
      ...extra,
    }) as never;

  it('só a outra ponta: quem enviou não recebe push da própria mensagem', () => {
    const events = [
      emitEvent('ana', 'message:new', {
        conversationId: 'c',
        message: message('ana'),
        unreadCount: 0,
      }),
      emitEvent('bia', 'message:new', {
        conversationId: 'c',
        message: message('ana'),
        unreadCount: 3,
      }),
    ];
    expect(messagePushTargets(events)).toEqual([
      { to: 'bia', conversationId: 'c', senderId: 'ana', messageType: 'text', body: 'oi' },
    ]);
  });

  it('mensagem de sistema (curtida mútua) não vira push de mensagem: o match tem o dele', () => {
    const sys = message('ana', { systemKind: 'mutual_like', messageType: 'system' });
    const events = [
      emitEvent('ana', 'message:new', { conversationId: 'c', message: sys, unreadCount: 0 }),
      emitEvent('bia', 'message:new', { conversationId: 'c', message: sys, unreadCount: 0 }),
    ];
    expect(messagePushTargets(events)).toEqual([]);
  });

  it('quem foi retido (invisível sem Premium) já saiu no withoutHeld: sem push', () => {
    const events = withoutHeld(
      [
        emitEvent('ana', 'message:new', {
          conversationId: 'c',
          message: message('ana'),
          unreadCount: 0,
        }),
        emitEvent('bia', 'message:new', {
          conversationId: 'c',
          message: message('ana'),
          unreadCount: 1,
        }),
      ],
      new Set(['bia']),
    );
    expect(messagePushTargets(events)).toEqual([]);
  });

  it('outros eventos não contam; a mesma conversa pra mesma pessoa sai uma vez só', () => {
    const events = [
      emitEvent(['ana', 'bia'], 'conversation:promoted', {
        conversationId: 'c',
        reason: 'bounce',
        promotedAt: 'x',
      }),
      emitEvent('bia', 'like_received', { isSuper: false }),
      emitEvent('bia', 'message:new', {
        conversationId: 'c',
        message: message('ana'),
        unreadCount: 1,
      }),
      emitEvent('bia', 'message:new', {
        conversationId: 'c',
        message: message('ana'),
        unreadCount: 2,
      }),
      leaveEvent('c', ['bia']),
    ];
    expect(messagePushTargets(events).map((t) => t.to)).toEqual(['bia']);
  });
});
