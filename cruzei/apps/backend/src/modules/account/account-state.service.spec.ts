import type { PrismaService } from '../../database/prisma.service';
import type { RedisService } from '../../redis/redis.service';

import { AccountStateService } from './account-state.service';

// sessions_valid_after (número liberado da conta): token com iat anterior cai com 401 session_revoked no Bearer,
// no refresh e no socket. Cache antigo (Redis acct:v1 gravado antes do campo existir) conta como "sem corte".

const ID = '0a000000-0000-4000-8000-00000000000a';

const row = {
  accountStatus: 'active',
  suspendedUntil: null as Date | null,
  moderationReason: null as string | null,
  role: 'user',
  deletedAt: null as Date | null,
  sessionsValidAfter: null as Date | null,
};
const prisma = {
  user: { findUnique: jest.fn(async () => ({ ...row })) },
} as unknown as PrismaService;
const kv = new Map<string, string>();
const redis = {
  client: {
    get: jest.fn(async (k: string) => kv.get(k) ?? null),
    mget: jest.fn(async (...ks: string[]) => ks.map((k) => kv.get(k) ?? null)),
    set: jest.fn(async (k: string, v: string) => void kv.set(k, v)),
    del: jest.fn(async (k: string) => Number(kv.delete(k))),
    publish: jest.fn(async () => 0),
    // SET_IF_GEN: grava KEYS[1] só se a versão (KEYS[2]) ainda é a lida (ARGV[2])
    eval: jest.fn(
      async (_lua: string, _n: number, key: string, genKey: string, value: string, gen: string) => {
        if ((kv.get(genKey) ?? '') !== gen) return 0;
        kv.set(key, value);
        return 1;
      },
    ),
  },
} as unknown as RedisService;
const flush = () => new Promise((r) => setImmediate(r));

const nowS = () => Math.floor(Date.now() / 1000);

let svc: AccountStateService;
beforeEach(() => {
  jest.clearAllMocks();
  kv.clear();
  row.sessionsValidAfter = null;
  row.accountStatus = 'active';
  svc = new AccountStateService(prisma, redis);
});

describe('sessão revogada', () => {
  it('sem corte: qualquer token vale; com corte: iat anterior cai (401 session_revoked), posterior passa', async () => {
    await expect(svc.assertActive(ID, nowS() - 3600)).resolves.toMatchObject({ status: 'active' });

    row.sessionsValidAfter = new Date(Date.now() - 60_000);
    await svc.invalidate(ID);
    await expect(svc.assertActive(ID, nowS() - 3600)).rejects.toMatchObject({
      status: 401,
      response: { error: 'session_revoked' },
    });
    await expect(svc.assertActive(ID, nowS())).resolves.toMatchObject({ status: 'active' });
    // sem iat (chamadas internas) não olha o corte
    await expect(svc.assertActive(ID)).resolves.toMatchObject({ status: 'active' });
  });

  it('blockedReason devolve o corpo session_revoked (o socket manda no connect_error)', async () => {
    row.sessionsValidAfter = new Date();
    expect(await svc.blockedReason(ID, nowS() - 60)).toMatchObject({ error: 'session_revoked' });
    expect(await svc.blockedReason(ID, nowS() + 1)).toBeNull();
  });

  it('conta banida com sessão revogada: 401 (deslogar) vem antes do 403', async () => {
    row.accountStatus = 'banned';
    row.sessionsValidAfter = new Date();
    await expect(svc.assertActive(ID, nowS() - 60)).rejects.toMatchObject({ status: 401 });
    await expect(svc.assertActive(ID, nowS() + 1)).rejects.toMatchObject({ status: 403 });
  });

  it('corrida: leitura do banco que começou antes da liberação não regrava o estado velho (Redis nem local)', async () => {
    const findUnique = prisma.user.findUnique as jest.Mock;
    // a leitura pega o banco ANTES do commit da liberação; o invalidate roda enquanto ela ainda não voltou
    findUnique.mockImplementationOnce(async () => {
      const old = { ...row };
      row.sessionsValidAfter = new Date(Date.now() + 60_000);
      await svc.invalidate(ID);
      return old;
    });
    // o pedido que atravessou a liberação ainda passa (é concorrente a ela)...
    await expect(svc.assertActive(ID, nowS())).resolves.toMatchObject({ status: 'active' });
    await flush();
    // ...mas o estado velho não ficou em cache nenhum
    expect(kv.has(`acct:v1:${ID}`)).toBe(false);
    await expect(svc.assertActive(ID, nowS())).rejects.toMatchObject({
      status: 401,
      response: { error: 'session_revoked' },
    });
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('sem invalidação no meio: grava no Redis e no cache local (a próxima não vai ao banco)', async () => {
    await svc.get(ID);
    await flush();
    expect(JSON.parse(kv.get(`acct:v1:${ID}`)!)).toMatchObject({
      status: 'active',
      validAfter: null,
    });
    await svc.get(ID);
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it('invalidate troca a versão antes de apagar (valor que nunca repete) e avisa os outros processos', async () => {
    await svc.invalidate(ID);
    const g1 = kv.get(`acct:gen:${ID}`);
    await svc.invalidate(ID);
    const g2 = kv.get(`acct:gen:${ID}`);
    expect(g1).toEqual(expect.any(String));
    expect(g2).not.toBe(g1);
    expect(redis.client.publish).toHaveBeenCalledWith('metch:acct', ID);
  });

  it('Redis fora: lê do banco e não grava cache no Redis', async () => {
    (redis.client.mget as jest.Mock).mockRejectedValueOnce(new Error('down'));
    await expect(svc.get(ID)).resolves.toMatchObject({ status: 'active' });
    await flush();
    expect(redis.client.eval).not.toHaveBeenCalled();
  });

  it('cache antigo no Redis (sem validAfter) conta como sem corte', async () => {
    kv.set(
      `acct:v1:${ID}`,
      JSON.stringify({ status: 'active', until: null, reason: null, role: 'user' }),
    );
    await expect(svc.assertActive(ID, 1)).resolves.toMatchObject({ status: 'active' });
    expect(prisma.user.findUnique).not.toHaveBeenCalledWith(expect.anything());
  });
});
