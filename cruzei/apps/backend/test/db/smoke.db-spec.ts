import { PrismaClient } from '@prisma/client';

import { assertTestDatabase, TEST_DB_NAME } from './env';

// Smoke do banco de TESTE: conecta no cruzei_test e confere as tabelas e travas da inbox (migration
// 20261001000000_inbox) de que o InboxService depende. Banco fora do ar = teste FALHA (nada de passar em silêncio).
// Recriar o banco: bash test/db/setup-test-db.sh

const prisma = new PrismaClient();

// TRUNCATE não dispara o trigger de linha do audit_log (deleteMany de usuário falharia)
const resetDb = () =>
  prisma.$executeRawUnsafe('TRUNCATE conversations, users RESTART IDENTITY CASCADE');

const newUser = (name: string) =>
  prisma.user.create({
    data: { name, birthDate: new Date('1995-01-01'), gender: 'female' },
    select: { id: true },
  });

/** par canônico: a mesma ordem do CHECK conv_pair_order (uuid do Postgres = string minúscula no JS) */
const pairOf = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);

beforeAll(async () => {
  await assertTestDatabase(prisma);
  await resetDb();
});

afterAll(async () => {
  await resetDb();
  await prisma.$disconnect();
});

describe('banco de teste (cruzei_test) — inbox', () => {
  it('está conectado no cruzei_test', async () => {
    const [row] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
    expect(row.db).toBe(TEST_DB_NAME);
  });

  it('tem as tabelas, colunas e o enum novos', async () => {
    const cols = await prisma.$queryRaw<{ t: string; c: string; nullable: string }[]>`
      SELECT table_name AS t, column_name AS c, is_nullable AS nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name IN ('conversations', 'conversation_members', 'messages')`;
    const colsOf = (t: string) =>
      cols
        .filter((r) => r.t === t)
        .map((r) => r.c)
        .sort();
    const nullable = (t: string, c: string) => cols.find((r) => r.t === t && r.c === c)?.nullable;

    expect(colsOf('conversations')).toEqual([
      'created_at',
      'id',
      'last_message_at',
      'promoted_at',
      'promoted_reason',
      'user_high_id',
      'user_low_id',
    ]);
    expect(colsOf('conversation_members')).toEqual([
      'archived_at',
      'conversation_id',
      'is_muted',
      'role',
      'unread_count',
      'user_id',
    ]);
    expect(colsOf('messages')).toEqual(
      expect.arrayContaining(['conversation_id', 'system_kind', 'content', 'match_id']),
    );
    expect(nullable('messages', 'conversation_id')).toBe('NO');
    expect(nullable('messages', 'match_id')).toBe('YES');

    const roles = await prisma.$queryRaw<{ v: string }[]>`
      SELECT unnest(enum_range(NULL::member_role))::text AS v`;
    expect(roles.map((r) => r.v)).toEqual(['REQUESTER', 'RECIPIENT']);

    // match congelado: a mensagem não depende mais dele
    const fks = await prisma.$queryRaw<{ name: string }[]>`
      SELECT conname AS name FROM pg_constraint WHERE conrelid = 'messages'::regclass AND contype = 'f'`;
    expect(fks.map((r) => r.name).sort()).toEqual([
      'messages_conversation_id_fkey',
      'messages_sender_id_fkey',
    ]);
  });

  it('uma conversa por par, par ordenado, contador >= 0 e motivo de promoção válido', async () => {
    const a = await newUser('Ana');
    const b = await newUser('Bia');
    const [low, high] = pairOf(a.id, b.id);

    const conv = await prisma.conversation.create({
      data: {
        userLowId: low,
        userHighId: high,
        members: {
          create: [
            { userId: a.id, role: 'REQUESTER' },
            { userId: b.id, role: 'RECIPIENT' },
          ],
        },
      },
      include: { members: true },
    });
    expect(conv.id).toMatch(/^[0-9a-f-]{36}$/); // default gen_random_uuid() do banco
    expect(conv.promotedAt).toBeNull();
    expect(conv.members.map((m) => m.unreadCount)).toEqual([0, 0]);

    // o mesmo par de novo: UNIQUE conv_pair_uq
    await expect(
      prisma.conversation.create({ data: { userLowId: low, userHighId: high } }),
    ).rejects.toMatchObject({
      code: 'P2002',
    });
    // par fora de ordem: CHECK conv_pair_order
    await expect(
      prisma.conversation.create({ data: { userLowId: high, userHighId: low } }),
    ).rejects.toThrow(/conv_pair_order/);
    // não lidas nunca negativas
    await expect(
      prisma.conversationMember.update({
        where: { conversationId_userId: { conversationId: conv.id, userId: b.id } },
        data: { unreadCount: -1 },
      }),
    ).rejects.toThrow(/conv_members_unread_chk/);
    // motivo fora de mutual | bounce | manual
    await expect(
      prisma.conversation.update({
        where: { id: conv.id },
        data: { promotedAt: new Date(), promotedReason: 'x' },
      }),
    ).rejects.toThrow(/conv_promoted_reason_chk/);
  });

  it('mensagem de sistema é única por conversa; as normais não colidem; body grava em content', async () => {
    const a = await newUser('Caio');
    const b = await newUser('Duda');
    const [low, high] = pairOf(a.id, b.id);
    const conv = await prisma.conversation.create({ data: { userLowId: low, userHighId: high } });

    await prisma.message.createMany({
      data: [
        { conversationId: conv.id, senderId: a.id, body: 'oi' },
        { conversationId: conv.id, senderId: a.id, body: 'tudo bem?' },
      ],
    });
    await prisma.message.create({
      data: {
        conversationId: conv.id,
        senderId: b.id,
        messageType: 'system',
        systemKind: 'mutual_like',
        body: 'x',
      },
    });
    await expect(
      prisma.message.create({
        data: {
          conversationId: conv.id,
          senderId: a.id,
          messageType: 'system',
          systemKind: 'mutual_like',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    const raw = await prisma.$queryRaw<{ content: string | null; match_id: string | null }[]>`
      SELECT content, match_id FROM messages WHERE conversation_id = ${conv.id}::uuid AND system_kind IS NULL
      ORDER BY content`;
    expect(raw).toEqual([
      { content: 'oi', match_id: null },
      { content: 'tudo bem?', match_id: null },
    ]);

    // apagar a conversa leva membros e mensagens junto
    await prisma.conversation.delete({ where: { id: conv.id } });
    expect(await prisma.message.count({ where: { conversationId: conv.id } })).toBe(0);
  });
});
