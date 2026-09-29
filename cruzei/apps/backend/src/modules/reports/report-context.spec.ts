import { sanitizeContext } from './reports.service';

// Contexto da denúncia: só campos conhecidos e uuids válidos.

const CONV = '0f5c3a4e-1111-4222-8333-444455556666';
const OTHER = '9a8b7c6d-1111-4222-8333-444455556666';

describe('sanitizeContext', () => {
  it.each(['inbox', 'requests', 'chat', 'profile', 'map', 'likes'] as const)(
    'aceita a origem %s',
    (source) => {
      expect(sanitizeContext({ source })).toEqual({ source });
    },
  );

  it('origem desconhecida ou contexto ausente → null', () => {
    expect(sanitizeContext(undefined)).toBeNull();
    expect(sanitizeContext({ source: 'feed' as never })).toBeNull();
  });

  it('conversationId vale (normalizado em minúsculas); origem antiga matches e matchId saíram', () => {
    expect(sanitizeContext({ source: 'requests', conversationId: CONV })).toEqual({
      source: 'requests',
      conversationId: CONV,
    });
    expect(sanitizeContext({ source: 'chat', conversationId: CONV.toUpperCase() })).toEqual({
      source: 'chat',
      conversationId: CONV,
    });
    expect(sanitizeContext({ source: 'matches' as never })).toBeNull();
    expect(sanitizeContext({ source: 'chat', matchId: OTHER } as never)).toEqual({
      source: 'chat',
    });
  });

  it('descarta ids que não são uuid e campos estranhos', () => {
    const out = sanitizeContext({
      source: 'inbox',
      conversationId: 'x; drop table',
      messageId: '1',
      photoId: OTHER,
      extra: 1,
    } as never);
    expect(out).toEqual({ source: 'inbox', photoId: OTHER });
  });
});
