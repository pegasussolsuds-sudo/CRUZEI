import { Logger } from '@nestjs/common';

import type { PrismaService } from '../../database/prisma.service';
import type { RedisService } from '../../redis/redis.service';

import { NEW_INSTALLS_PER_IP_DAY } from './analytics-sanitize';
import { AnalyticsService, LINK_WINDOW_HOURS } from './analytics.service';

// Regras de quem grava o quê, sem banco (o SQL de verdade roda no analytics.db-spec): sem conta só funil + app_open,
// instalação sem o 1º passo tem o lote ignorado (menos app_open com conta), limite de instalações novas por IP e o
// /link só com eventos recentes de instalação que não é de outra conta.

const NOW = new Date('2026-09-30T15:00:00.000Z');
const IP = 'ip:200.1.2.3';
const INST = '3f2b8c1e-9a7d-4e1b-8c55-0a1b2c3d4e5f';
const USER = '0b000000-0000-4000-8000-00000000000b';

/** instalações que "já mandaram" o 1º passo */
const started = new Set<string>();
/** instalações com evento de outra conta */
const foreign = new Set<string>();
const inserts: string[][] = [];
const sqls: { sql: string; values: unknown[] }[] = [];

const prisma = {
  $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join('?');
    sqls.push({ sql, values });
    if (sql.includes('UPDATE analytics_events'))
      return [{ other: foreign.has(values[0] as string) }];
    return [{ ok: started.has(values[0] as string) }];
  }),
  $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join('?');
    sqls.push({ sql, values });
    if (!sql.includes('unnest')) return 1;
    const names = values.find(Array.isArray) as string[];
    inserts.push(names);
    return names.length;
  }),
};

const counters = new Map<string, number>();
let redisDown = false;
const redis = {
  incrRate: jest.fn(async (id: string, action: string) => {
    if (redisDown) throw new Error('redis fora');
    const k = `${id}:${action}`;
    const n = (counters.get(k) ?? 0) + 1;
    counters.set(k, n);
    return n;
  }),
};

const svc = new AnalyticsService(
  prisma as unknown as PrismaService,
  redis as unknown as RedisService,
);

const anon = { userId: null, ip: IP };
const logged = { userId: USER, ip: IP };
const welcome = { name: 'onboarding_step_view', step: 'welcome' };
const phone = { name: 'onboarding_step_view', step: 'phone' };
const newInstalls = () => counters.get(`${IP}:analytics_new_install`) ?? 0;
const firstStepChecks = () => prisma.$queryRaw.mock.calls.length;

beforeEach(() => {
  started.clear();
  foreign.clear();
  inserts.length = 0;
  sqls.length = 0;
  counters.clear();
  redisDown = false;
  jest.clearAllMocks();
});

describe('POST /analytics/events: quem grava o quê', () => {
  it('sem conta e sem o 1º passo: lote ignorado, sem gravar nada', async () => {
    await expect(svc.ingest(INST, [phone, { name: 'app_open' }], anon, NOW)).resolves.toEqual({
      accepted: 0,
    });
    expect(inserts).toEqual([]);
    expect(newInstalls()).toBe(0);
  });

  it('lote com o 1º passo abre a instalação e conta no limite do IP; depois não conta de novo', async () => {
    const r = await svc.ingest(INST, [{ name: 'app_open' }, welcome, phone], anon, NOW);
    expect(r).toEqual({ accepted: 3 });
    expect(newInstalls()).toBe(1);
    started.add(INST);
    await svc.ingest(INST, [welcome, { name: 'onboarding_step_done', step: 'phone' }], anon, NOW);
    expect(newInstalls()).toBe(1);
    expect(inserts).toHaveLength(2);
  });

  it(`passou de ${NEW_INSTALLS_PER_IP_DAY} instalações novas no IP: 429 e nada gravado`, async () => {
    for (let i = 0; i < NEW_INSTALLS_PER_IP_DAY; i++) {
      await svc.ingest(`inst-nova-${i.toString().padStart(3, '0')}`, [welcome], anon, NOW);
    }
    expect(inserts).toHaveLength(NEW_INSTALLS_PER_IP_DAY);
    await expect(svc.ingest('inst-nova-999', [welcome], anon, NOW)).rejects.toMatchObject({
      status: 429,
      response: { error: 'too_many_requests' },
    });
    expect(inserts).toHaveLength(NEW_INSTALLS_PER_IP_DAY);
    // instalação que já existia continua mandando; outro IP também
    started.add(INST);
    await expect(svc.ingest(INST, [phone], anon, NOW)).resolves.toEqual({ accepted: 1 });
    await expect(
      svc.ingest('inst-outro-ip', [welcome], { userId: null, ip: 'ip:10.0.0.9' }, NOW),
    ).resolves.toEqual({ accepted: 1 });
  });

  it('sem conta o tour do mapa não entra (nem com a instalação aberta)', async () => {
    started.add(INST);
    const r = await svc.ingest(
      INST,
      [{ name: 'map_tour_done', step: 'vibe_search' }, { name: 'map_tour_skipped' }, phone],
      anon,
      NOW,
    );
    expect(r).toEqual({ accepted: 1 });
    expect(inserts).toEqual([['onboarding_step_view']]);
  });

  it('só tour do mapa sem conta: nem vai ao banco', async () => {
    await expect(svc.ingest(INST, [{ name: 'map_tour_done' }], anon, NOW)).resolves.toEqual({
      accepted: 0,
    });
    expect(firstStepChecks()).toBe(0);
  });

  it('com conta: app_open entra mesmo sem o 1º passo (e sem ir ao banco conferir)', async () => {
    await expect(svc.ingest(INST, [{ name: 'app_open' }], logged, NOW)).resolves.toEqual({
      accepted: 1,
    });
    expect(firstStepChecks()).toBe(0);
  });

  it('com conta e sem o 1º passo: do lote só fica o app_open', async () => {
    const r = await svc.ingest(
      INST,
      [
        { name: 'map_tour_done' },
        { name: 'app_open' },
        { name: 'onboarding_step_view', step: 'avatar' },
      ],
      logged,
      NOW,
    );
    expect(r).toEqual({ accepted: 1 });
    expect(inserts).toEqual([['app_open']]);
    expect(firstStepChecks()).toBe(1);
  });

  it('com conta e instalação aberta: tour e etapas pós-cadastro entram', async () => {
    started.add(INST);
    const r = await svc.ingest(
      INST,
      [{ name: 'map_tour_skipped' }, { name: 'onboarding_step_view', step: 'avatar' }],
      logged,
      NOW,
    );
    expect(r).toEqual({ accepted: 2 });
  });

  it('Redis fora: os limites deixam passar (métrica não derruba nada)', async () => {
    redisDown = true;
    await expect(svc.ingest(INST, [welcome], anon, NOW)).resolves.toEqual({ accepted: 1 });
  });
});

describe('POST /analytics/link e cadastro: ligar a instalação à conta', () => {
  const claim = () => sqls.find((s) => s.sql.includes('UPDATE analytics_events'));
  const signup = () => sqls.find((s) => s.sql.includes("'signup_done'"));

  it(`liga só eventos das últimas ${LINK_WINDOW_HOURS} h e grava o signup_done com a instalação`, async () => {
    await svc.link(USER, INST, NOW);
    const c = claim();
    expect(c?.sql).toMatch(/user_id IS NULL AND created_at >= \?::timestamptz/);
    expect(c?.sql).toMatch(/user_id <> \?::uuid/);
    const since = c?.values.find((v) => typeof v === 'string' && v.endsWith('Z'));
    expect(since).toBe(new Date(NOW.getTime() - LINK_WINDOW_HOURS * 3_600_000).toISOString());
    expect(signup()?.values).toContain(INST);
  });

  it('instalação de OUTRA conta: nada é ligado e o signup_done sai sem a instalação', async () => {
    foreign.add(INST);
    await svc.link(USER, INST, NOW);
    const s = signup();
    expect(s).toBeDefined();
    expect(s?.values).not.toContain(INST);
    expect(s?.values).toContain(null);
  });

  it('cadastro: mesmas regras; installId inválido nem tenta ligar; erro no banco não derruba', async () => {
    foreign.add(INST);
    await svc.recordSignup(USER, INST, NOW);
    expect(signup()?.values).not.toContain(INST);

    sqls.length = 0;
    await svc.recordSignup(USER, "1' OR 1=1 --", NOW);
    expect(claim()).toBeUndefined();
    expect(signup()?.values).toContain(null);

    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    prisma.$queryRaw.mockRejectedValueOnce(new Error('banco fora'));
    await expect(svc.recordSignup(USER, INST, NOW)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
