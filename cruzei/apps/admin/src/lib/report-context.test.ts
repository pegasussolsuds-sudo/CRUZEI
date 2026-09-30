import { describe, expect, it, vi } from 'vitest';
import { convAnchor, openConversation, reportConversationIds } from './report-context';

// Ficha: a denúncia automática de golpe cita várias conversas (context.occurrences); cada uma abre o seu bloco.

describe('conversas citadas na denúncia', () => {
  it('a do contexto + as da lista, sem repetir; sem contexto → nenhuma', () => {
    expect(
      reportConversationIds({
        source: 'auto_filter',
        conversationId: 'c1',
        occurrences: [{ conversationId: 'c1', messageId: 'm1' }, { conversationId: 'c2' }],
      }),
    ).toEqual(['c1', 'c2']);
    expect(reportConversationIds({ source: 'chat', conversationId: 'c9' })).toEqual(['c9']);
    expect(reportConversationIds({ source: 'profile' })).toEqual([]);
    expect(reportConversationIds(null)).toEqual([]);
  });

  it('abrir: acha o bloco pela âncora, abre e rola até ele', () => {
    const el = { open: false, scrollIntoView: vi.fn() };
    const doc = { getElementById: vi.fn((id: string) => (id === convAnchor('c2') ? el : null)) };
    expect(openConversation('c2', doc as unknown as Document)).toBe(true);
    expect(el.open).toBe(true);
    expect(el.scrollIntoView).toHaveBeenCalled();
    expect(openConversation('nao-tem', doc as unknown as Document)).toBe(false);
  });
});
