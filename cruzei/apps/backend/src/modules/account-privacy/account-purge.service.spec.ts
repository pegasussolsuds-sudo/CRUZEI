import { Prisma } from '@prisma/client';

import { phoneHash } from '../../common/phone-hash';
import type { PrismaService } from '../../database/prisma.service';
import type { RedisService } from '../../redis/redis.service';
import type { AccountStateService } from '../account/account-state.service';

import { AccountPurgeService } from './account-purge.service';
import { RETENTION_PAGE } from './purge-plan';

// Limpeza com a transação simulada: número reciclado de conta não banida some (hash + IP do pedido dela), revisão sem
// denúncia segura só até o teto, e a retenção anda por páginas até acabar.

jest.mock('./user-redis', () => ({ purgeUserKeys: jest.fn(async () => undefined) }));

const DAY = 86_400_000;
const NOW = new Date('2026-10-05T12:00:00Z');
const U = '0a000000-0000-4000-8000-00000000000a';
const REQ = '0d000000-0000-4000-8000-00000000000d';
const PHONE = '+5534999990000';
const OLD_PHONE = '+5534988880000';

interface Call {
  text: string;
  values: unknown[];
}

/** SQL cru do jeito que chegou: template marcado ou Prisma.Sql pronto */
function sqlOf(a0: unknown, rest: unknown[]): Call {
  if (!Array.isArray(a0)) {
    const s = a0 as Prisma.Sql;
    return { text: s.text, values: s.values };
  }
  return { text: (a0 as unknown as TemplateStringsArray).join('?'), values: rest };
}

let user: {
  id: string;
  phone: string | null;
  deleted_at: Date | null;
  purged_at: Date | null;
  account_status: string;
  review_hold_at: Date | null;
  trial_used_at: Date | null;
  verification_selfie_url: string | null;
};
let request: { id: string; user_id: string; requested_at: Date } | null;
/** denúncias em análise contra a pessoa (reporterId nulo = automática do sistema) */
let openReports: { reporterId: string | null; reason: string }[];
let releases: { id: bigint; phone: string }[];
const queries: Call[] = [];
const exec: Call[] = [];
const ddrUpdates: Record<string, unknown>[] = [];
const releaseCreates: Record<string, unknown>[] = [];
const modCreates: Record<string, unknown>[] = [];
const userUpdates: Record<string, unknown>[] = [];

/** model genérico: qualquer método devolve { count: 0 } (deleteMany/updateMany da limpeza) */
function model(over: Record<string, unknown> = {}) {
  return new Proxy(over, {
    get: (t, k: string) => t[k] ?? (async () => ({ count: 0 })),
  });
}

const txBase: Record<string, unknown> = {
  $queryRaw: jest.fn(async (a0: unknown, ...rest: unknown[]) => {
    const c = sqlOf(a0, rest);
    queries.push(c);
    if (c.text.includes('FROM data_deletion_requests')) return request ? [request] : [];
    if (c.text.includes('FROM users WHERE id')) return [user];
    if (c.text.includes('FROM phone_releases')) return releases;
    return [];
  }),
  $executeRaw: jest.fn(async (a0: unknown, ...rest: unknown[]) => {
    exec.push(sqlOf(a0, rest));
    return 1;
  }),
  report: model({
    // em análise contra a pessoa (regra do bloqueio) × denúncias citadas como prova
    findMany: async (a: { where: { status?: unknown } }) => (a.where.status ? openReports : []),
  }),
  conversation: model({ findMany: async () => [] }),
  dataDeletionRequest: model({
    update: async ({ data }: { data: Record<string, unknown> }) => (ddrUpdates.push(data), {}),
  }),
  phoneRelease: model({
    create: async ({ data }: { data: Record<string, unknown> }) => (releaseCreates.push(data), {}),
  }),
  moderationAction: model({
    create: async ({ data }: { data: Record<string, unknown> }) => (modCreates.push(data), {}),
  }),
  user: model({
    update: async ({ data }: { data: Record<string, unknown> }) => (userUpdates.push(data), {}),
  }),
};
const tx = new Proxy(txBase, { get: (t, k: string) => t[k] ?? model() });

/** páginas devolvidas pela retenção (por tabela) e os cursores pedidos */
let convPages: { id: string; user_low_id: string; user_high_id: string }[][];
let supportPages: { id: string; user_id: string; last_message_at: Date }[][];
const cursors: { table: string; after: unknown }[] = [];

const prisma = {
  $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
  $queryRaw: jest.fn(async (a0: unknown, ...rest: unknown[]) => {
    const c = sqlOf(a0, rest);
    if (c.text.includes('FROM conversations c')) {
      cursors.push({ table: 'conversations', after: c.values[0] });
      return convPages.shift() ?? [];
    }
    if (c.text.includes('FROM support_threads t')) {
      cursors.push({ table: 'support', after: c.values[0] });
      return supportPages.shift() ?? [];
    }
    return [];
  }),
  $executeRaw: jest.fn(async (a0: unknown, ...rest: unknown[]) => {
    exec.push(sqlOf(a0, rest));
    return 0;
  }),
  report: { findMany: jest.fn(async () => []) },
  conversation: {
    deleteMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) => ({
      count: where.id.in.length,
    })),
  },
  supportThread: {
    deleteMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) => ({
      count: where.id.in.length,
    })),
  },
  dataDeletionRequest: { update: jest.fn(async () => ({ attempts: 1 })) },
} as unknown as PrismaService;

const redis = {
  client: {},
  invalidateProfile: jest.fn(async () => undefined),
} as unknown as RedisService;
const accounts = { invalidate: jest.fn(async () => undefined) } as unknown as AccountStateService;
const service = new AccountPurgeService(prisma, redis, accounts);

const env = { ...process.env };
beforeAll(() => {
  process.env.ACCOUNT_DELETION_GRACE_DAYS = '30';
  process.env.PHONE_HASH_SECRET = 'segredo-do-spec-da-limpeza';
});
afterAll(() => {
  process.env = env;
});

beforeEach(() => {
  jest.clearAllMocks();
  for (const a of [queries, exec, ddrUpdates, releaseCreates, modCreates, userUpdates, cursors])
    a.length = 0;
  user = {
    id: U,
    phone: PHONE,
    deleted_at: new Date(NOW.getTime() - 31 * DAY),
    purged_at: null,
    account_status: 'active',
    review_hold_at: null,
    trial_used_at: null,
    verification_selfie_url: null,
  };
  request = { id: REQ, user_id: U, requested_at: new Date(NOW.getTime() - 31 * DAY) };
  openReports = [];
  releases = [];
  convPages = [];
  supportPages = [];
});

const releaseUpdates = () =>
  exec.filter((c) => /UPDATE phone_releases SET phone = NULL/.test(c.text));
const metaUpdates = () =>
  exec.filter((c) => /SET ip = NULL, port = NULL, user_agent = NULL/.test(c.text));

describe('limpeza × número reciclado (phone_releases)', () => {
  it('conta não banida: número antigo vira hash e o IP do pedido dela sai (passado dos 6 meses)', async () => {
    releases = [{ id: BigInt(7), phone: OLD_PHONE }];
    const r = await service.purgeNext(NOW);
    expect(r).toMatchObject({ outcome: 'completed', userId: U });

    const upd = releaseUpdates();
    expect(upd).toHaveLength(1);
    expect(upd[0].values).toEqual([phoneHash(OLD_PHONE), BigInt(7)]);

    const meta = metaUpdates();
    expect(meta).toHaveLength(1);
    expect(meta[0].text).toMatch(/new_user_id = \$1::uuid/);
    const cut = new Date(NOW);
    cut.setMonth(cut.getMonth() - 6);
    expect(meta[0].values).toEqual([U, cut.toISOString()]);

    // nada de guardar o número inteiro de quem não foi banido
    expect(releaseCreates).toHaveLength(0);
    expect(userUpdates[0]).toMatchObject({ phone: null, name: 'Conta excluída' });
  });

  it('banida: guarda o número em phone_releases e não mexe no histórico de liberação', async () => {
    user.account_status = 'banned';
    releases = [{ id: BigInt(7), phone: OLD_PHONE }];
    await expect(service.purgeNext(NOW)).resolves.toMatchObject({ outcome: 'completed' });
    expect(releaseCreates).toEqual([
      expect.objectContaining({ userId: U, phone: PHONE, accountStatus: 'banned' }),
    ]);
    expect(String(modCreates[0].note)).toMatch(/banida\/suspensa/);
    expect(releaseUpdates()).toHaveLength(0);
    expect(metaUpdates()).toHaveLength(0);
    expect(queries.some((q) => q.text.includes('FROM phone_releases'))).toBe(false);
  });
});

describe('limpeza × revisão (review_hold_at)', () => {
  it('revisão sem denúncia dentro do teto: adia (review_hold) e tenta amanhã', async () => {
    user.review_hold_at = new Date(NOW.getTime() - 50 * DAY);
    // pedido há 40 dias: teto = 40 - 30 - 30 → ainda faltam 20 dias
    request!.requested_at = new Date(NOW.getTime() - 40 * DAY);
    await expect(service.purgeNext(NOW)).resolves.toMatchObject({ outcome: 'held' });
    expect(ddrUpdates[0]).toEqual({
      holdReason: 'review_hold',
      scheduledFor: new Date(NOW.getTime() + DAY),
    });
    expect(userUpdates).toHaveLength(0);
  });

  it('revisão sem denúncia passou do teto: limpa guardando o mínimo, sem segurar o próximo dono', async () => {
    user.review_hold_at = new Date(NOW.getTime() - 90 * DAY);
    request!.requested_at = new Date(NOW.getTime() - 61 * DAY);
    releases = [{ id: BigInt(7), phone: OLD_PHONE }];
    await expect(service.purgeNext(NOW)).resolves.toMatchObject({ outcome: 'completed' });
    // número guardado com a situação real (ativa): o cadastro novo com ele NÃO nasce em revisão
    expect(releaseCreates).toEqual([
      expect.objectContaining({ phone: PHONE, accountStatus: 'active' }),
    ]);
    expect(String(modCreates[0].note)).toMatch(/revisão/);
    expect(releaseUpdates()).toHaveLength(0);
    expect(userUpdates[0]).toMatchObject({ purgedAt: NOW });
  });

  it('denúncia em análise segura mesmo depois do teto', async () => {
    openReports = [{ reporterId: '0b000000-0000-4000-8000-00000000000b', reason: 'spam' }];
    user.review_hold_at = new Date(NOW.getTime() - 200 * DAY);
    request!.requested_at = new Date(NOW.getTime() - 150 * DAY);
    await expect(service.purgeNext(NOW)).resolves.toMatchObject({ outcome: 'held' });
    expect(ddrUpdates[0]).toMatchObject({ holdReason: 'open_reports' });
  });
});

describe('limpeza × denúncia automática (número reciclado de conta banida)', () => {
  // o cadastro com o número cria a denúncia 'other' pending sem quem denunciou (auth.service) e liga a revisão
  const recycled = { reporterId: null, reason: 'other' };

  it('dentro do teto: segura como revisão (review_hold), não como denúncia aberta', async () => {
    openReports = [recycled];
    user.review_hold_at = new Date(NOW.getTime() - 40 * DAY);
    request!.requested_at = new Date(NOW.getTime() - 40 * DAY);
    await expect(service.purgeNext(NOW)).resolves.toMatchObject({ outcome: 'held' });
    expect(ddrUpdates[0]).toMatchObject({ holdReason: 'review_hold' });
  });

  it('passou do teto: limpa mesmo com a automática ainda pending (antes segurava pra sempre)', async () => {
    openReports = [recycled];
    user.review_hold_at = new Date(NOW.getTime() - 90 * DAY);
    request!.requested_at = new Date(NOW.getTime() - 61 * DAY);
    await expect(service.purgeNext(NOW)).resolves.toMatchObject({ outcome: 'completed' });
    // revisão que passou do teto guarda o número (como sempre)
    expect(releaseCreates).toEqual([expect.objectContaining({ phone: PHONE })]);
  });

  it('automática sem revisão (GPS falso, filtro de golpe) também segura só até o teto', async () => {
    openReports = [{ reporterId: null, reason: 'fake' }];
    request!.requested_at = new Date(NOW.getTime() - 40 * DAY);
    await expect(service.purgeNext(NOW)).resolves.toMatchObject({ outcome: 'held' });
    expect(ddrUpdates[0]).toMatchObject({ holdReason: 'review_hold' });

    ddrUpdates.length = 0;
    request!.requested_at = new Date(NOW.getTime() - 61 * DAY);
    await expect(service.purgeNext(NOW)).resolves.toMatchObject({ outcome: 'completed' });
  });

  it('automática de menor/abuso infantil segura sem prazo (LEGAL_KEEP_REASONS)', async () => {
    openReports = [recycled, { reporterId: null, reason: 'underage' }];
    request!.requested_at = new Date(NOW.getTime() - 400 * DAY);
    await expect(service.purgeNext(NOW)).resolves.toMatchObject({ outcome: 'held' });
    expect(ddrUpdates[0]).toMatchObject({ holdReason: 'open_reports' });
  });
});

describe('retenção diária', () => {
  const id = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;

  it('conversas de prova: páginas por cursor até acabar (o que fica não trava as seguintes)', async () => {
    const page1 = Array.from({ length: RETENTION_PAGE }, (_, i) => ({
      id: id(i + 1),
      user_low_id: U,
      user_high_id: id(90_000),
    }));
    const page2 = [
      { id: id(RETENTION_PAGE + 1), user_low_id: U, user_high_id: id(90_000) },
      { id: id(RETENTION_PAGE + 2), user_low_id: U, user_high_id: id(90_000) },
    ];
    convPages = [page1, page2];
    const out = await service.retention(NOW);
    expect(out.conversations).toBe(RETENTION_PAGE + 2);
    const conv = cursors.filter((c) => c.table === 'conversations');
    expect(conv.map((c) => c.after)).toEqual([
      '00000000-0000-0000-0000-000000000000',
      id(RETENTION_PAGE),
    ]);
  });

  it('atendimentos urgentes: mesma paginação', async () => {
    const old = new Date(NOW.getTime() - 400 * DAY);
    supportPages = [
      Array.from({ length: RETENTION_PAGE }, (_, i) => ({
        id: id(i + 1),
        user_id: U,
        last_message_at: old,
      })),
      [],
    ];
    const out = await service.retention(NOW);
    expect(out.supportThreads).toBe(RETENTION_PAGE);
    expect(cursors.filter((c) => c.table === 'support')).toHaveLength(2);
  });

  it('phone_releases de conta limpa: hash velho e IP do pedido entram na retenção', async () => {
    await service.retention(NOW);
    expect(
      exec.some((c) => /SET phone_hash = NULL/.test(c.text) && /phone_releases/.test(c.text)),
    ).toBe(true);
    expect(metaUpdates().some((c) => /u\.purged_at IS NOT NULL/.test(c.text))).toBe(true);
  });

  it('número que veio PRA conta limpa não banida: o vínculo (new_user_id) sai 6 meses depois da limpeza', async () => {
    const out = await service.retention(NOW);
    expect(out).toHaveProperty('releaseLinks');
    const unlink = exec.find((c) => /SET new_user_id = NULL/.test(c.text))!;
    expect(unlink.text).toContain('new_user_unlinked_at = now()');
    expect(unlink.text).toMatch(/u\.id = pr\.new_user_id AND u\.purged_at </);
    // só conta limpa NÃO banida (banida/suspensa/revisão: o histórico fica ligado)
    expect(unlink.text).toMatch(/u\.account_status = 'active' AND u\.review_hold_at IS NULL/);
    const cut = new Date(NOW);
    cut.setMonth(cut.getMonth() - 6);
    expect(unlink.values).toEqual([cut.toISOString()]);
  });
});
