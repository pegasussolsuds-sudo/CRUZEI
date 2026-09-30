import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import {
  contextConversationId,
  contextConversationIds,
  contextOccurrences,
} from './report-context';
import { UserReportDto } from './report.dto';
import { sanitizeContext } from './reports.service';

// Contexto da denúncia: só campos conhecidos e uuids válidos; o formato de antes da inbox (matchId, origem
// 'matches') continua valendo — a migração criou cada conversa com o mesmo id do match.

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

  it('origens de sistema (emergência, filtro automático): o app não manda; a leitura gravada aceita', () => {
    for (const source of ['emergency', 'auto_filter'] as const) {
      expect(sanitizeContext({ source: source as never })).toBeNull();
      expect(
        sanitizeContext({ source: source as never, conversationId: CONV }, { stored: true }),
      ).toEqual({
        source,
        conversationId: CONV,
      });
    }
  });

  it('conversationId vale (normalizado em minúsculas)', () => {
    expect(sanitizeContext({ source: 'requests', conversationId: CONV })).toEqual({
      source: 'requests',
      conversationId: CONV,
    });
    expect(sanitizeContext({ source: 'chat', conversationId: CONV.toUpperCase() })).toEqual({
      source: 'chat',
      conversationId: CONV,
    });
  });

  it('build antigo: matchId vira conversationId (mesmo uuid) e a origem matches vira inbox', () => {
    expect(sanitizeContext({ source: 'chat', matchId: OTHER })).toEqual({
      source: 'chat',
      conversationId: OTHER,
    });
    expect(sanitizeContext({ source: 'matches', matchId: OTHER.toUpperCase() })).toEqual({
      source: 'inbox',
      conversationId: OTHER,
    });
    // os dois vieram: vale o conversationId
    expect(sanitizeContext({ source: 'chat', conversationId: CONV, matchId: OTHER })).toEqual({
      source: 'chat',
      conversationId: CONV,
    });
    // matchId que não é uuid é descartado
    expect(sanitizeContext({ source: 'chat', matchId: 'x' })).toEqual({ source: 'chat' });
  });

  it('origem que não existe (nem entre as antigas) → null; chave estranha não vira origem', () => {
    expect(sanitizeContext({ source: 'constructor' as never })).toBeNull();
    expect(sanitizeContext({ source: '__proto__' as never })).toBeNull();
    expect(sanitizeContext({ source: 1 as never })).toBeNull();
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

describe('contextConversationId (moderação lendo denúncias antigas e novas)', () => {
  it('conversationId, senão matchId; minúsculas; lixo → null', () => {
    expect(contextConversationId({ source: 'chat', conversationId: CONV })).toBe(CONV);
    expect(contextConversationId({ source: 'chat', matchId: OTHER.toUpperCase() })).toBe(OTHER);
    expect(contextConversationId({ conversationId: CONV, matchId: OTHER })).toBe(CONV);
    expect(contextConversationId({ conversationId: 'x', matchId: OTHER })).toBe(OTHER);
    expect(contextConversationId({ matchId: 42 })).toBeNull();
    expect(contextConversationId(null)).toBeNull();
    expect(contextConversationId('texto')).toBeNull();
  });
});

describe('lista de conversas da denúncia automática (context.occurrences)', () => {
  const conv = (i: number) => `c0000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
  const msg = (i: number) => `d0000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

  it('gravada: mantém a lista (uuids válidos, sem repetir conversa, até 10); o app não consegue mandar', () => {
    const occurrences = [
      { conversationId: conv(1), messageId: msg(1) },
      { conversationId: conv(1).toUpperCase(), messageId: msg(2) },
      { conversationId: 'lixo' },
      { conversationId: conv(2), messageId: 'x' },
      ...Array.from({ length: 12 }, (_, i) => ({ conversationId: conv(i + 3) })),
    ];
    const stored = sanitizeContext(
      { source: 'auto_filter' as never, conversationId: conv(1), messageId: msg(1), occurrences },
      { stored: true },
    );
    expect(stored?.occurrences).toHaveLength(10);
    expect(stored?.occurrences?.[0]).toEqual({ conversationId: conv(1), messageId: msg(1) });
    expect(stored?.occurrences?.[1]).toEqual({ conversationId: conv(2) });
    expect(contextOccurrences({ occurrences })).toEqual(stored?.occurrences);
    // entrada do app: descarta
    expect(sanitizeContext({ source: 'chat', occurrences } as never)).toEqual({ source: 'chat' });
    // lixo
    expect(contextOccurrences({ occurrences: 'x' })).toEqual([]);
    expect(contextOccurrences(null)).toEqual([]);
  });

  it('contextConversationIds: a do contexto + as da lista, sem repetir', () => {
    expect(
      contextConversationIds({
        conversationId: conv(1),
        occurrences: [{ conversationId: conv(1) }, { conversationId: conv(2) }],
      }),
    ).toEqual([conv(1), conv(2)]);
    expect(contextConversationIds({ matchId: OTHER })).toEqual([OTHER]);
    expect(contextConversationIds({ source: 'chat' })).toEqual([]);
  });
});

describe('UserReportDto (build antigo não perde a denúncia com o forbidNonWhitelisted)', () => {
  const errorsOf = (body: unknown) =>
    validateSync(plainToInstance(UserReportDto, body) as object, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

  it('aceita o contexto de hoje e o antigo (matchId, origem matches)', () => {
    expect(
      errorsOf({ reason: 'spam', context: { source: 'requests', conversationId: CONV } }),
    ).toEqual([]);
    expect(errorsOf({ reason: 'spam', context: { source: 'matches', matchId: OTHER } })).toEqual(
      [],
    );
  });

  it('recusa origem desconhecida, matchId que não é uuid e campo estranho', () => {
    expect(errorsOf({ reason: 'spam', context: { source: 'feed' } })).not.toEqual([]);
    expect(errorsOf({ reason: 'spam', context: { source: 'chat', matchId: 'x' } })).not.toEqual([]);
    expect(errorsOf({ reason: 'spam', context: { source: 'chat', extra: 1 } })).not.toEqual([]);
  });
});
