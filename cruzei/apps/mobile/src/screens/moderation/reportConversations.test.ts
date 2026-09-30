import { isConversationOpen, reportConversationIds } from './reportConversations';

// Ficha da moderação no app: a denúncia automática de golpe cita várias conversas; cada uma abre na ficha.

describe('conversas citadas na denúncia', () => {
  it('a do contexto + as da lista, sem repetir; só as que a ficha trouxe', () => {
    const ctx = {
      source: 'auto_filter' as const,
      conversationId: 'c1',
      occurrences: [{ conversationId: 'c1', messageId: 'm1' }, { conversationId: 'c2' }, { conversationId: 'c3' }],
    };
    expect(reportConversationIds(ctx)).toEqual(['c1', 'c2', 'c3']);
    expect(reportConversationIds(ctx, new Set(['c1', 'c3']))).toEqual(['c1', 'c3']);
    expect(reportConversationIds({ source: 'profile' })).toEqual([]);
    expect(reportConversationIds(null)).toEqual([]);
  });

  it('só a 1ª conversa começa aberta; a escolha manda', () => {
    expect(isConversationOpen({}, 'a', 0)).toBe(true);
    expect(isConversationOpen({}, 'b', 1)).toBe(false);
    expect(isConversationOpen({ b: true }, 'b', 1)).toBe(true);
    expect(isConversationOpen({ a: false }, 'a', 0)).toBe(false);
  });
});
