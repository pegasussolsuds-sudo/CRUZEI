import { USER_FILTER_DELETION_HELD } from '@cruzei/shared-types';
import { Prisma } from '@prisma/client';

import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import type { PrismaService } from '../../database/prisma.service';

import { AdminUsersService } from './admin-users.service';

// Lista de usuários: excluída nunca aparece, a não ser no filtro "Exclusão segurada" (limpeza adiada pela moderação).

const sqls: string[] = [];
const prisma = {
  $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    sqls.push(Prisma.sql(strings, ...values).text);
    return strings.join('').includes('count(*)') ? [{ n: 0 }] : [];
  }),
} as unknown as PrismaService;

const none = {} as never;
const service = new AdminUsersService(prisma, none, none, none, none, none, none, none, none);
const viewer = { id: 'a', role: 'admin' } as AuthenticatedUser;

beforeEach(() => {
  sqls.length = 0;
});

describe('filtro de contas excluídas seguradas', () => {
  it('sem filtro: só contas não excluídas', async () => {
    await service.list(viewer, {});
    expect(sqls).toHaveLength(2);
    for (const s of sqls) {
      expect(s).toMatch(/u\.deleted_at IS NULL/);
      expect(s).not.toMatch(/hold_reason/);
    }
  });

  it('status=deletion_held: excluídas ainda não limpas com o pedido pendente adiado', async () => {
    await service.list(viewer, { status: USER_FILTER_DELETION_HELD });
    for (const s of sqls) {
      expect(s).toMatch(/u\.deleted_at IS NOT NULL AND u\.purged_at IS NULL/);
      expect(s).toMatch(/d\.status = 'pending' AND d\.hold_reason IS NOT NULL/);
      expect(s).not.toMatch(/u\.deleted_at IS NULL/);
      // não vira filtro de account_status
      expect(s).not.toMatch(/account_status = /);
    }
  });
});
