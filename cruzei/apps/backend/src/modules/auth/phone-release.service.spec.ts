import { phoneHash } from '../../common/phone-hash';
import type { PrismaService } from '../../database/prisma.service';
import type { RedisService } from '../../redis/redis.service';
import type { AccountStateService } from '../account/account-state.service';

import { claimFailsKey, PhoneReleaseService } from './phone-release.service';

// Liberação do número sem banco (a de verdade roda no phone-recycling.db-spec): a conta que já usou o teste grátis
// deixa a marca do número em trial_claims ANTES de perder o telefone (a conta nova com o número não ganha outro
// teste), e o contador de erros do "Essa conta é sua?" zera em qualquer liberação.

const ID = '0b000000-0000-4000-8000-00000000000b';
const PHONE = '+5534999991111';

interface Row {
  phone: string | null;
  accountStatus: string;
  trialUsedAt: Date | null;
}
let row: Row;
/** ordem das escritas dentro da transação */
const writes: string[] = [];
/** INSERTs crus: [sql, valores] */
const raw: { sql: string; values: unknown[] }[] = [];

const tx = {
  user: {
    findUnique: jest.fn(async () => ({ ...row })),
    updateMany: jest.fn(async ({ where }: { where: { phone: string } }) => {
      if (row.phone !== where.phone) return { count: 0 };
      writes.push('unlink');
      row.phone = null;
      return { count: 1 };
    }),
  },
  $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    writes.push('trial_claims');
    raw.push({ sql: strings.join('?'), values });
    return 1;
  }),
  phoneRelease: { create: jest.fn(async () => writes.push('history')) },
  deviceToken: { deleteMany: jest.fn(async () => writes.push('push')) },
  moderationAction: { create: jest.fn(async () => writes.push('moderation')) },
};
const prisma = {
  $queryRaw: jest.fn(async () => [{ at: new Date('2026-01-01T00:00:00Z') }]),
  $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
} as unknown as PrismaService;

const kv = new Map<string, string>();
const redis = {
  client: { del: jest.fn(async (k: string) => Number(kv.delete(k))) },
  markPresenceHidden: jest.fn(async () => undefined),
  invalidateProfile: jest.fn(async () => undefined),
} as unknown as RedisService;
const accounts = { invalidate: jest.fn(async () => undefined) } as unknown as AccountStateService;

const svc = new PhoneReleaseService(prisma, redis, accounts);

beforeEach(() => {
  jest.clearAllMocks();
  writes.length = 0;
  raw.length = 0;
  kv.clear();
  row = { phone: PHONE, accountStatus: 'active', trialUsedAt: null };
});

describe('liberação do número: teste grátis', () => {
  it('conta que usou o teste: grava trial_claims (hash do número, conta) ON CONFLICT DO NOTHING antes de desvincular', async () => {
    row.trialUsedAt = new Date('2026-05-01T00:00:00Z');
    await expect(svc.release({ userId: ID, phone: PHONE, reason: 'not_mine' })).resolves.toBe(true);
    expect(writes.indexOf('trial_claims')).toBeGreaterThanOrEqual(0);
    expect(writes.indexOf('trial_claims')).toBeLessThan(writes.indexOf('unlink'));
    expect(raw).toHaveLength(1);
    expect(raw[0].sql).toMatch(/INSERT INTO trial_claims \(phone_hash, user_id\)/);
    expect(raw[0].sql).toMatch(/ON CONFLICT \(phone_hash\) DO NOTHING/);
    // o mesmo helper do módulo de assinaturas (HMAC do número normalizado), nunca o número cru
    expect(raw[0].values).toEqual([phoneHash(PHONE), ID]);
    expect(raw[0].values).not.toContain(PHONE);
  });

  it('conta que nunca usou o teste: não marca o número', async () => {
    await expect(
      svc.release({ userId: ID, phone: PHONE, reason: 'admin', releasedBy: 'adm' }),
    ).resolves.toBe(true);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(writes).toContain('unlink');
  });

  it('a conta já não tem o número (outro pedido chegou antes): não marca nada e devolve false', async () => {
    row.phone = null;
    row.trialUsedAt = new Date();
    await expect(svc.release({ userId: ID, phone: PHONE, reason: 'not_mine' })).resolves.toBe(
      false,
    );
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(accounts.invalidate).not.toHaveBeenCalled();
  });
});

describe('liberação do número: contador de erros do "Essa conta é sua?"', () => {
  it('qualquer liberação (inclusive a do painel) zera o contador sem prazo', async () => {
    kv.set(claimFailsKey(ID), '2');
    await svc.release({ userId: ID, phone: PHONE, reason: 'admin', releasedBy: 'adm' });
    expect(kv.has(claimFailsKey(ID))).toBe(false);
    expect(accounts.invalidate).toHaveBeenCalledWith(ID);
  });

  it('liberação que não aconteceu não mexe no contador', async () => {
    kv.set(claimFailsKey(ID), '2');
    row.phone = '+5534900000000';
    await expect(svc.release({ userId: ID, phone: PHONE, reason: 'not_mine' })).resolves.toBe(
      false,
    );
    expect(kv.get(claimFailsKey(ID))).toBe('2');
  });
});
