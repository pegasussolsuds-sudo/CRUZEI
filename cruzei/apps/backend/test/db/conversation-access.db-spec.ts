import { PrismaClient } from '@prisma/client';

import { canJoinConversation } from '../../src/realtime/conversation-access';

import { assertTestDatabase } from './env';

// SQL de canJoinConversation (entrada na sala conv:<id> do gateway) contra o Postgres do cruzei_test:
// membro + não arquivado pra ele + sem Block em nenhum sentido. Banco fora do ar = teste FALHA.
// Recriar o banco: bash test/db/setup-test-db.sh

const prisma = new PrismaClient();

// TRUNCATE não dispara o trigger de linha do audit_log; o CASCADE leva members, messages e blocks
const resetDb = () =>
  prisma.$executeRawUnsafe('TRUNCATE conversations, users RESTART IDENTITY CASCADE');

const newUser = async (name: string) =>
  (
    await prisma.user.create({
      data: { name, birthDate: new Date('1995-01-01'), gender: 'female' },
      select: { id: true },
    })
  ).id;

/** conversa do par (a = REQUESTER, b = RECIPIENT) na ordem canônica do CHECK conv_pair_order */
async function newConversation(a: string, b: string) {
  const [low, high] = a < b ? [a, b] : [b, a];
  const c = await prisma.conversation.create({
    data: {
      userLowId: low,
      userHighId: high,
      members: {
        create: [
          { userId: a, role: 'REQUESTER' },
          { userId: b, role: 'RECIPIENT', unreadCount: 1 },
        ],
      },
    },
    select: { id: true },
  });
  return c.id;
}

const can = (conversationId: unknown, userId: unknown) =>
  canJoinConversation(prisma, conversationId, userId);

let ana = '';
let bia = '';
let cris = '';
let conv = '';

beforeAll(async () => {
  await assertTestDatabase(prisma);
});

beforeEach(async () => {
  await resetDb();
  [ana, bia, cris] = [await newUser('Ana'), await newUser('Bia'), await newUser('Cris')];
  conv = await newConversation(ana, bia);
});

afterAll(async () => {
  await resetDb();
  await prisma.$disconnect();
});

describe('canJoinConversation (sala conv:<id> do gateway)', () => {
  it('os dois membros entram (inclusive quem só recebeu a solicitação); mais ninguém', async () => {
    expect(await can(conv, ana)).toBe(true);
    expect(await can(conv, bia)).toBe(true);
    expect(await can(conv, cris)).toBe(false);
    expect(await can('00000000-0000-4000-8000-000000000000', ana)).toBe(false);
  });

  it('id que não é uuid (ou nem string) é recusado sem erro de cast no Postgres', async () => {
    await expect(can('nao-e-uuid', ana)).resolves.toBe(false);
    await expect(can(conv, "x' OR 1=1 --")).resolves.toBe(false);
    await expect(can({ $ne: null }, ana)).resolves.toBe(false);
    await expect(can(conv, undefined)).resolves.toBe(false);
  });

  it('arquivada pra uma pessoa: só ela fica de fora', async () => {
    await prisma.conversationMember.update({
      where: { conversationId_userId: { conversationId: conv, userId: bia } },
      data: { archivedAt: new Date() },
    });
    expect(await can(conv, bia)).toBe(false);
    expect(await can(conv, ana)).toBe(true);
  });

  it.each([
    ['Ana bloqueou Bia', () => ({ blockerId: ana, blockedId: bia })],
    ['Bia bloqueou Ana', () => ({ blockerId: bia, blockedId: ana })],
  ])('Block em qualquer sentido tira os dois, mesmo sem arquivar (%s)', async (_nome, pair) => {
    await prisma.block.create({ data: pair() });
    expect(await can(conv, ana)).toBe(false);
    expect(await can(conv, bia)).toBe(false);
  });

  it('Block com outra pessoa não afeta esta conversa', async () => {
    await prisma.block.create({ data: { blockerId: ana, blockedId: cris } });
    await prisma.block.create({ data: { blockerId: cris, blockedId: bia } });
    expect(await can(conv, ana)).toBe(true);
    expect(await can(conv, bia)).toBe(true);
  });

  it('desbloquear não desarquiva: continua de fora até a conversa voltar pro inbox', async () => {
    // efeito do bloqueio (BlocksService): Block + os dois arquivados com unread zerado
    await prisma.block.create({ data: { blockerId: bia, blockedId: ana } });
    await prisma.conversationMember.updateMany({
      where: { conversationId: conv },
      data: { archivedAt: new Date(), unreadCount: 0 },
    });
    await prisma.block.deleteMany({ where: { blockerId: bia, blockedId: ana } });
    expect(await can(conv, ana)).toBe(false);
    expect(await can(conv, bia)).toBe(false);

    // nova mensagem de Ana desarquiva só o lado dela
    await prisma.conversationMember.update({
      where: { conversationId_userId: { conversationId: conv, userId: ana } },
      data: { archivedAt: null },
    });
    expect(await can(conv, ana)).toBe(true);
    expect(await can(conv, bia)).toBe(false);
  });
});
