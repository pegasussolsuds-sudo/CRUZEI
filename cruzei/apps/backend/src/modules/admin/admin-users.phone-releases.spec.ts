import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import type { PrismaService } from '../../database/prisma.service';

import { AdminUsersService } from './admin-users.service';

// Histórico de número reciclado na ficha: na conta limpa (excluída, não banida) o número que veio PRA ela era o dela —
// some das linhas 'incoming'. As linhas em que o número saiu dela (já viraram hash na limpeza) seguem como estão.

const U = '0a000000-0000-4000-8000-00000000000a';
const OLD = '0b000000-0000-4000-8000-00000000000b';
const NEW = '0c000000-0000-4000-8000-00000000000c';
const PHONE = '+5534999990000';

const rows = [
  // o número veio pra U (da conta antiga OLD)
  {
    userId: OLD,
    newUserId: U,
    phone: PHONE,
    reason: 'not_mine',
    accountStatus: 'banned',
    releasedBy: null,
    createdAt: new Date('2026-06-01T00:00:00Z'),
  },
  // o número saiu de U (hash na limpeza: phone null)
  {
    userId: U,
    newUserId: NEW,
    phone: null,
    reason: 'account_deleted',
    accountStatus: 'active',
    releasedBy: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
  },
];

const prisma = {
  phoneRelease: { findMany: jest.fn(async () => rows) },
  user: { findMany: jest.fn(async () => []) },
} as unknown as PrismaService;
const none = {} as never;
const service = new AdminUsersService(prisma, none, none, none, none, none, none, none, none);
type Releases = (
  viewer: AuthenticatedUser,
  userId: string,
  purged?: boolean,
) => Promise<{ phone: string | null; incoming?: boolean; oldUserId?: string | null }[]>;
const releasesOf = (service as unknown as { phoneReleasesOf: Releases }).phoneReleasesOf.bind(
  service,
);
const admin = { id: 'adm', role: 'admin' } as AuthenticatedUser;
const mod = { id: 'mod', role: 'moderator' } as AuthenticatedUser;

describe('ficha × número reciclado de conta limpa', () => {
  it('conta viva: admin vê o número inteiro na linha incoming; moderador, mascarado', async () => {
    const asAdmin = await releasesOf(admin, U, false);
    expect(asAdmin[0]).toMatchObject({ incoming: true, phone: PHONE, oldUserId: OLD });
    const asMod = await releasesOf(mod, U, false);
    expect(asMod[0].phone).toContain('0000');
    expect(asMod[0].phone).not.toBe(PHONE);
  });

  it('conta limpa: o número some das linhas incoming (pra admin e moderador)', async () => {
    for (const viewer of [admin, mod]) {
      const out = await releasesOf(viewer, U, true);
      const incoming = out.find((r) => r.incoming)!;
      expect(incoming.phone).toBeNull();
      expect(JSON.stringify(out)).not.toContain('99990000');
    }
  });

  it('a linha em que o número saiu da conta limpa segue como está (já é hash: phone null)', async () => {
    const out = await releasesOf(admin, U, true);
    expect(out.find((r) => !r.incoming)).toMatchObject({ incoming: false, phone: null });
  });
});
