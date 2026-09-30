import type { PrismaService } from '../../database/prisma.service';

import { DETAIL_CONVERSATIONS_MAX, ModerationService } from './moderation.service';

// Ficha da moderação: traz TODAS as conversas citadas nas denúncias — inclusive as da lista da denúncia automática de
// golpe (context.occurrences, até 10) — e só as da pessoa denunciada.

const U = '0a000000-0000-4000-8000-00000000000a';
const OTHER = '0b000000-0000-4000-8000-00000000000b';
const conv = (i: number) => `c0000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

function setup(reports: { context: unknown }[], foreign: Set<string> = new Set()) {
  const prisma = {
    user: {
      findUnique: jest.fn(async () => ({
        id: U,
        name: 'Golpista',
        birthDate: new Date('1990-01-01'),
        accountStatus: 'active',
        suspendedUntil: null,
        reviewHoldAt: null,
        createdAt: new Date('2026-01-01'),
        role: 'user',
        bio: null,
        instagramHandle: null,
        phone: null,
        photos: [],
      })),
    },
    report: {
      findMany: jest.fn(async () =>
        reports.map((r, i) => ({
          id: `r${i}`,
          status: 'pending',
          reason: 'scam',
          description: null,
          reporterId: null,
          context: r.context,
          priority: 1,
          createdAt: new Date('2026-10-01'),
        })),
      ),
    },
    moderationAction: { findMany: jest.fn(async () => []) },
    conversation: {
      findUnique: jest.fn(async (a: { where: { id: string } }) =>
        foreign.has(a.where.id)
          ? { userLowId: '1', userHighId: '2' }
          : { userLowId: U < OTHER ? U : OTHER, userHighId: U < OTHER ? OTHER : U },
      ),
    },
    message: {
      findMany: jest.fn(async (a: { where: { conversationId: string } }) => [
        {
          id: `m-${a.where.conversationId}`,
          senderId: U,
          body: 'me manda um pix',
          messageType: 'text',
          createdAt: new Date('2026-10-01T12:00:00Z'),
        },
      ]),
    },
  };
  const svc = new ModerationService(
    prisma as unknown as PrismaService,
    ...([{}, {}, {}, {}, {}] as unknown as [never, never, never, never, never]),
  );
  return { svc, prisma };
}

describe('ModerationService.userDetail — conversas citadas', () => {
  it('abre cada conversa da lista da denúncia automática (e a lista sai no contexto)', async () => {
    const occurrences = Array.from({ length: 10 }, (_, i) => ({ conversationId: conv(i + 1) }));
    const t = setup([
      { context: { source: 'auto_filter', conversationId: conv(1), occurrences } },
      { context: { source: 'chat', conversationId: conv(11) } },
    ]);
    const d = await t.svc.userDetail(U);
    expect(d.conversations.map((c) => c.conversationId)).toEqual([
      ...occurrences.map((o) => o.conversationId),
      conv(11),
    ]);
    expect(d.conversations[0]).toMatchObject({
      otherUserId: OTHER,
      messages: [{ content: 'me manda um pix' }],
    });
    expect(d.reports[0].context?.occurrences).toHaveLength(10);
  });

  it('só conversa da pessoa denunciada; teto de conversas na ficha', async () => {
    const t = setup(
      [
        {
          context: {
            source: 'auto_filter',
            occurrences: Array.from({ length: 10 }, (_, i) => ({ conversationId: conv(i + 1) })),
          },
        },
        { context: { source: 'chat', conversationId: conv(20) } },
        { context: { source: 'chat', conversationId: conv(21) } },
        { context: { source: 'chat', conversationId: conv(22) } },
      ],
      new Set([conv(2)]),
    );
    const d = await t.svc.userDetail(U);
    const ids = d.conversations.map((c) => c.conversationId);
    expect(ids).not.toContain(conv(2));
    expect(t.prisma.conversation.findUnique).toHaveBeenCalledTimes(DETAIL_CONVERSATIONS_MAX);
    expect(ids).toHaveLength(DETAIL_CONVERSATIONS_MAX - 1);
  });
});
