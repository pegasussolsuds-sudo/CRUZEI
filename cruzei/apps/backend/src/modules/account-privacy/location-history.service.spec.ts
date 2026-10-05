import { HttpException } from '@nestjs/common';

import type { PrismaService } from '../../database/prisma.service';
import type { RedisService } from '../../redis/redis.service';

import { DataExportService } from './data-export.service';
import { LocationHistoryService } from './location-history.service';

// "Apagar histórico": o corte da fila (loc:forget) é gravado ANTES do DELETE (senão o gravador em lote traria de volta
// o que estava na fila) e o limite diário barra com 429. Cópia dos dados: cota diária e devolução quando falha.

const U = '0a000000-0000-4000-8000-00000000000a';
const order: string[] = [];
let rate = 0;
const kv = new Map<string, string>();

const client = {
  set: jest.fn(async (k: string, v: string) => {
    order.push(`set ${k}`);
    kv.set(k, v);
    return 'OK';
  }),
  ttl: jest.fn(async () => 3600),
  del: jest.fn(async (...keys: string[]) => {
    order.push(`del ${keys.join(',')}`);
    keys.forEach((k) => kv.delete(k));
    return keys.length;
  }),
  hget: jest.fn(async () => null),
  exists: jest.fn(async () => 0),
  multi: jest.fn(() => {
    const m: { zrem: jest.Mock; del: jest.Mock; exec: jest.Mock } = {
      zrem: jest.fn(),
      del: jest.fn(),
      exec: jest.fn(async () => []),
    };
    m.zrem.mockReturnValue(m);
    m.del.mockReturnValue(m);
    return m;
  }),
  decr: jest.fn(async (k: string) => {
    const n = Number(kv.get(k) ?? 0) - 1;
    kv.set(k, String(n));
    return n;
  }),
};
const redis = {
  client,
  incrRate: jest.fn(async () => ++rate),
} as unknown as RedisService;

const tx = {
  location: { deleteMany: jest.fn(async () => (order.push('delete locations'), { count: 12 })) },
  poisCheckin: { deleteMany: jest.fn(async () => ({ count: 2 })) },
  $executeRaw: jest.fn(async () => 1),
  boost: { updateMany: jest.fn(async () => ({ count: 0 })) },
};
const prisma = {
  $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
} as unknown as PrismaService;

beforeEach(() => {
  jest.clearAllMocks();
  order.length = 0;
  rate = 0;
  kv.clear();
  delete process.env.LOCATION_FORGET_DAILY_LIMIT;
  delete process.env.DATA_EXPORT_DAILY_LIMIT;
});

describe('LocationHistoryService.forget', () => {
  const svc = new LocationHistoryService(prisma, redis);

  it('marca o corte antes do DELETE e devolve as contagens', async () => {
    const out = await svc.forget(U, { learnedHome: false });
    expect(out).toEqual({ positions: 12, checkins: 2, placeVotes: 1, learnedHome: false });
    expect(order.indexOf(`set loc:forget:${U}`)).toBeLessThan(order.indexOf('delete locations'));
    expect(tx.$executeRaw).toHaveBeenCalled();
    // presença e âncoras saem depois do banco
    expect(order.some((o) => o.startsWith('del') && o.includes(`loc:anchor:${U}`))).toBe(true);
  });

  it('passou do limite do dia: 429 com retryAfter, nada apagado', async () => {
    rate = 3;
    await expect(svc.forget(U, { learnedHome: true })).rejects.toMatchObject({
      status: 429,
      response: { error: 'too_many_requests', retryAfter: 3600 },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('DataExportService cota', () => {
  const svc = new DataExportService(prisma, redis);

  it('3 por dia; a 4ª dá 429 export_limit', async () => {
    for (let i = 0; i < 3; i++) await svc.takeQuota(U);
    const e = await svc.takeQuota(U).catch((x: HttpException) => x);
    expect(e).toBeInstanceOf(HttpException);
    expect((e as HttpException).getStatus()).toBe(429);
    expect((e as HttpException).getResponse()).toMatchObject({
      error: 'export_limit',
      retryAfter: 3600,
    });
  });

  it('refundQuota não deixa o contador negativo', async () => {
    kv.set(`rate:${U}:export`, '1');
    await svc.refundQuota(U);
    expect(kv.get(`rate:${U}:export`)).toBe('0');
    await svc.refundQuota(U);
    expect(kv.has(`rate:${U}:export`)).toBe(false);
  });

  it('nome do arquivo com o prefixo do contrato', () => {
    expect(svc.fileName(new Date('2026-10-05T15:00:00Z'))).toBe('metch-meus-dados-2026-10-05.json');
  });
});
