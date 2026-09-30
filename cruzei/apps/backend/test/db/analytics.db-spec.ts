import { PrismaClient } from '@prisma/client';

import type { PrismaService } from '../../src/database/prisma.service';
import { addDays } from '../../src/modules/admin/metrics';
import { MetricsService } from '../../src/modules/admin/metrics.service';
import { NEW_INSTALLS_PER_IP_DAY } from '../../src/modules/analytics/analytics-sanitize';
import { AnalyticsService } from '../../src/modules/analytics/analytics.service';

import { asRedis, fakeRedis, newUser } from './admin-fakes';
import { assertTestDatabase } from './env';

// Métricas próprias contra o banco de TESTE: ingestão (lista fechada, app_open 1x/dia, conta que não existe, limite
// por instalação, sem conta só funil + app_open, instalação sem o 1º passo ignorada, instalações novas por IP),
// ligação com a conta (só recente, nunca instalação de outra conta) + signup_done, limpeza de 13 meses, e as contas do
// painel (funil sem os logins, retenção D1/D7/D30 por semana, ativos). Recriar o banco: bash test/db/setup-test-db.sh

const prisma = new PrismaClient();
const db = prisma as unknown as PrismaService;
const redis = fakeRedis();
const analytics = new AnalyticsService(db, asRedis(redis));
const metrics = new MetricsService(db, asRedis(redis));

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
/** quem manda: anônimo ou com conta, sempre de um IP */
const IP = 'ip:200.1.2.3';
const anon = { userId: null, ip: IP };
const logged = (userId: string) => ({ userId, ip: IP });
const welcome = { name: 'onboarding_step_view', step: 'welcome' };
const phone = { name: 'onboarding_step_view', step: 'phone' };

/** dia de São Paulo de agora (UTC-3; o Brasil não tem horário de verão) */
const spToday = () => new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
/** meio-dia de São Paulo do dia AAAA-MM-DD */
const noonSp = (day: string) => new Date(`${day}T15:00:00.000Z`);
/** segunda-feira da semana do dia */
const mondayOf = (day: string) =>
  addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
const ago = (ms: number) => new Date(Date.now() - ms);

let seq = 0;
const newInstall = () => `inst-${Date.now().toString(36)}-${(++seq).toString().padStart(4, '0')}`;

async function event(
  name: string,
  o: { installId?: string | null; userId?: string | null; step?: string | null; at?: Date } = {},
) {
  await prisma.analyticsEvent.create({
    data: {
      name,
      installId: o.installId ?? null,
      userId: o.userId ?? null,
      step: o.step ?? null,
      createdAt: o.at ?? new Date(),
    },
  });
}

/** etapa vista (e concluída, se `done`) */
async function step(
  installId: string,
  s: string,
  at: Date,
  done = true,
  userId: string | null = null,
) {
  await event('onboarding_step_view', { installId, step: s, at, userId });
  if (done)
    await event('onboarding_step_done', {
      installId,
      step: s,
      at: new Date(at.getTime() + 1_000),
      userId,
    });
}

const accessLog = (userId: string, at: Date) =>
  prisma.accessLog.create({ data: { userId, event: 'refresh', createdAt: at } });

const rowsOf = (installId: string) =>
  prisma.analyticsEvent.findMany({ where: { installId }, orderBy: { id: 'asc' } });

beforeAll(async () => {
  await assertTestDatabase(prisma);
});

beforeEach(async () => {
  // analytics_events cai junto com users (FK); access_logs não tem FK
  await prisma.$executeRawUnsafe(
    'TRUNCATE users, analytics_events, access_logs RESTART IDENTITY CASCADE',
  );
  redis.kv.clear();
  redis.resetRates();
});

afterAll(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE users, analytics_events, access_logs RESTART IDENTITY CASCADE',
  );
  await prisma.$disconnect();
});

describe('POST /analytics/events (ingestão)', () => {
  it('grava só o que é da lista, sem posição e sem vazio virando texto', async () => {
    const inst = newInstall();
    const r = await analytics.ingest(
      inst,
      [
        {
          name: 'onboarding_step_view',
          step: 'welcome',
          props: { platform: 'android', lat: -18.9, lng: -48.2 },
        },
        { name: 'onboarding_step_done', step: 'welcome', props: { durationMs: 900 } },
        phone,
        { name: 'map_tour_skipped' }, // sem conta: tour não entra
        { name: 'signup_done' },
        { name: 'onboarding_step_view', step: 'nao_existe' },
        { name: 'qualquer_coisa' },
      ],
      anon,
    );
    expect(r).toEqual({ accepted: 3 });
    const rows = await rowsOf(inst);
    expect(rows.map((e) => [e.name, e.step, e.userId])).toEqual([
      ['onboarding_step_view', 'welcome', null],
      ['onboarding_step_done', 'welcome', null],
      ['onboarding_step_view', 'phone', null],
    ]);
    expect(rows[0].props).toEqual({ platform: 'android' });
    expect(rows[1].props).toEqual({ durationMs: 900 });
    expect(rows[2].props).toBeNull();
  });

  it('app_open: um por instalação por dia de São Paulo, mesmo em lotes diferentes', async () => {
    const inst = newInstall();
    expect(await analytics.ingest(inst, [welcome, { name: 'app_open' }], anon)).toEqual({
      accepted: 2,
    });
    expect(
      await analytics.ingest(inst, [{ name: 'app_open' }, { name: 'app_open' }], anon),
    ).toEqual({ accepted: 0 });
    // outra instalação no mesmo dia conta
    expect(await analytics.ingest(newInstall(), [welcome, { name: 'app_open' }], anon)).toEqual({
      accepted: 2,
    });
  });

  it('com conta: grava o user_id; conta que não existe vira anônimo (sem estourar a FK)', async () => {
    const u = await newUser(prisma, 'Aline');
    const inst = newInstall();
    await step(inst, 'welcome', ago(5 * MIN));
    await analytics.ingest(inst, [{ name: 'onboarding_step_view', step: 'avatar' }], logged(u.id));
    await analytics.ingest(
      inst,
      [{ name: 'onboarding_step_view', step: 'photo' }],
      logged('00000000-0000-4000-8000-000000000000'),
    );
    const rows = await rowsOf(inst);
    expect(rows.filter((e) => e.step !== 'welcome').map((e) => [e.step, e.userId])).toEqual([
      ['avatar', u.id],
      ['photo', null],
    ]);
  });

  it('limite por instalação: 30 envios por minuto, o 31º leva 429', async () => {
    const inst = newInstall();
    for (let i = 0; i < 30; i++) await analytics.ingest(inst, [], anon);
    await expect(analytics.ingest(inst, [], anon)).rejects.toMatchObject({
      response: { error: 'too_many_requests' },
    });
    // outra instalação não é afetada
    await expect(analytics.ingest(newInstall(), [], anon)).resolves.toEqual({ accepted: 0 });
  });

  it('instalação que nunca mandou o 1º passo: lote ignorado; com conta só o app_open entra', async () => {
    const inst = newInstall();
    expect(await analytics.ingest(inst, [phone, { name: 'app_open' }], anon)).toEqual({
      accepted: 0,
    });
    // conta antiga que atualizou o app: nunca passou pelas boas-vindas
    const u = await newUser(prisma, 'Gabi', { createdAt: ago(90 * DAY) });
    const r = await analytics.ingest(
      inst,
      [
        { name: 'app_open' },
        { name: 'map_tour_done' },
        { name: 'onboarding_step_view', step: 'avatar' },
      ],
      logged(u.id),
    );
    expect(r).toEqual({ accepted: 1 });
    expect((await rowsOf(inst)).map((e) => [e.name, e.userId])).toEqual([['app_open', u.id]]);
    // mandou o 1º passo (daí em diante conferido no banco): o resto entra
    await analytics.ingest(inst, [welcome], anon);
    expect(await analytics.ingest(inst, [phone], anon)).toEqual({ accepted: 1 });
    expect(await analytics.ingest(inst, [{ name: 'map_tour_done' }], logged(u.id))).toEqual({
      accepted: 1,
    });
  });

  it(`instalações novas: ${NEW_INSTALLS_PER_IP_DAY} por IP por dia, a seguinte leva 429`, async () => {
    const insts = Array.from({ length: NEW_INSTALLS_PER_IP_DAY }, () => newInstall());
    for (const i of insts) await analytics.ingest(i, [welcome], anon);
    expect(await prisma.analyticsEvent.count()).toBe(NEW_INSTALLS_PER_IP_DAY);
    const extra = newInstall();
    await expect(analytics.ingest(extra, [welcome], anon)).rejects.toMatchObject({
      response: { error: 'too_many_requests' },
    });
    expect(await rowsOf(extra)).toHaveLength(0);
    // quem já abriu segue mandando (não conta de novo); outro IP abre normal
    await expect(analytics.ingest(insts[0], [welcome, phone], anon)).resolves.toEqual({
      accepted: 2,
    });
    await expect(
      analytics.ingest(extra, [welcome], { userId: null, ip: 'ip:10.9.8.7' }),
    ).resolves.toEqual({ accepted: 1 });
  });
});

describe('ligação com a conta e signup_done', () => {
  it('link: eventos anônimos da instalação viram da conta; conta nova ganha signup_done uma vez', async () => {
    const inst = newInstall();
    await step(inst, 'welcome', ago(10 * MIN));
    await step(inst, 'phone', ago(9 * MIN));
    const u = await newUser(prisma, 'Bia');
    await analytics.link(u.id, inst);
    await analytics.link(u.id, inst);
    const rows = await rowsOf(inst);
    expect(
      rows.filter((e) => e.name.startsWith('onboarding')).every((e) => e.userId === u.id),
    ).toBe(true);
    const signups = await prisma.analyticsEvent.findMany({ where: { name: 'signup_done' } });
    expect(signups).toHaveLength(1);
    expect(signups[0]).toMatchObject({ userId: u.id, installId: inst });
  });

  it('link: só eventos das últimas 24 h e nunca de instalação que já é de outra conta', async () => {
    const inst = newInstall();
    await step(inst, 'welcome', ago(30 * HOUR));
    await step(inst, 'phone', ago(2 * HOUR));
    const dona = await newUser(prisma, 'Hana', { createdAt: ago(40 * DAY) });
    await analytics.link(dona.id, inst);
    expect((await rowsOf(inst)).map((e) => [e.step, e.userId === dona.id])).toEqual([
      ['welcome', false],
      ['welcome', false],
      ['phone', true],
      ['phone', true],
    ]);
    // outra conta com o mesmo installId (aparelho de outra pessoa / id copiado): não puxa nada
    await step(inst, 'code', ago(MIN));
    const outra = await newUser(prisma, 'Iris');
    await analytics.link(outra.id, inst);
    expect(
      await prisma.analyticsEvent.count({ where: { installId: inst, userId: outra.id } }),
    ).toBe(0);
    // conta nova: o signup_done sai, mas sem a instalação alheia
    const signups = await prisma.analyticsEvent.findMany({ where: { name: 'signup_done' } });
    expect(signups).toHaveLength(1);
    expect(signups[0]).toMatchObject({ userId: outra.id, installId: null });
    // a dona continua ligando o que é recente
    await analytics.link(dona.id, inst);
    const code = (await rowsOf(inst)).filter((e) => e.step === 'code');
    expect(code.every((e) => e.userId === dona.id)).toBe(true);
  });

  it('link de conta antiga (login em aparelho novo): liga os eventos, mas não é cadastro', async () => {
    const inst = newInstall();
    await step(inst, 'welcome', ago(5 * MIN));
    const old = await newUser(prisma, 'Carla', { createdAt: ago(40 * DAY) });
    await analytics.link(old.id, inst);
    expect((await rowsOf(inst)).every((e) => e.userId === old.id)).toBe(true);
    expect(await prisma.analyticsEvent.count({ where: { name: 'signup_done' } })).toBe(0);
  });

  it('recordSignup (cadastro): liga a instalação e grava signup_done na hora da conta, sem repetir', async () => {
    const inst = newInstall();
    await step(inst, 'prefs', ago(2 * MIN));
    const created = ago(MIN);
    const u = await newUser(prisma, 'Dani', { createdAt: created });
    await analytics.recordSignup(u.id, inst);
    await analytics.recordSignup(u.id, inst);
    await analytics.link(u.id, inst);
    const signups = await prisma.analyticsEvent.findMany({ where: { name: 'signup_done' } });
    expect(signups).toHaveLength(1);
    expect(Math.abs(signups[0].createdAt.getTime() - created.getTime())).toBeLessThan(1_000);
    expect((await rowsOf(inst)).every((e) => e.userId === u.id)).toBe(true);
    // sem installId (app antigo) também grava; conta inexistente não derruba nada
    const v = await newUser(prisma, 'Edu');
    await analytics.recordSignup(v.id, null);
    await expect(
      analytics.recordSignup('00000000-0000-4000-8000-000000000000', inst),
    ).resolves.toBeUndefined();
    expect(await prisma.analyticsEvent.count({ where: { name: 'signup_done' } })).toBe(2);
  });

  it('limpeza: apaga só o que passou de 13 meses', async () => {
    const inst = newInstall();
    await event('app_open', { installId: inst, at: ago(420 * DAY) });
    await event('app_open', { installId: inst, at: ago(360 * DAY) });
    await event('app_open', { installId: inst, at: ago(DAY) });
    expect(await analytics.purgeOld()).toBe(1);
    expect(await prisma.analyticsEvent.count()).toBe(2);
  });
});

describe('painel: funil do cadastro', () => {
  it('conta instalações por etapa, acha a queda e deixa de fora login e o que é velho', async () => {
    // A: cadastro completo até o nome, conta criada depois
    const a = newInstall();
    await step(a, 'welcome', ago(20 * MIN));
    await step(a, 'phone', ago(19 * MIN));
    await step(a, 'code', ago(18 * MIN));
    await step(a, 'name', ago(17 * MIN));
    const ua = await newUser(prisma, 'Ana', { createdAt: ago(10 * MIN) });
    await analytics.recordSignup(ua.id, a);
    // B: desistiu no código
    const b = newInstall();
    await step(b, 'welcome', ago(20 * MIN));
    await step(b, 'phone', ago(19 * MIN));
    await step(b, 'code', ago(18 * MIN), false);
    // C: só viu as boas-vindas
    const c = newInstall();
    await step(c, 'welcome', ago(15 * MIN), false);
    // D: login de conta antiga (passa pelas mesmas telas): fora do funil
    const d = newInstall();
    await step(d, 'welcome', ago(12 * MIN));
    await step(d, 'phone', ago(11 * MIN));
    await step(d, 'code', ago(10 * MIN));
    const ud = await newUser(prisma, 'Duda', { createdAt: ago(30 * DAY) });
    await analytics.link(ud.id, d);
    // E: fora do período
    await step(newInstall(), 'welcome', ago(45 * DAY), false);

    const f = await metrics.computeFunnel(30);
    const by = Object.fromEntries(f.steps.map((s) => [s.step, s]));
    expect(f.installs).toBe(3);
    expect(f.signups).toBe(1);
    expect(by.welcome).toEqual({ step: 'welcome', viewed: 3, done: 2, dropOffPct: 33.3 });
    expect(by.phone).toEqual({ step: 'phone', viewed: 2, done: 2, dropOffPct: 0 });
    expect(by.code).toEqual({ step: 'code', viewed: 2, done: 1, dropOffPct: 50 });
    expect(by.name).toEqual({ step: 'name', viewed: 1, done: 1, dropOffPct: 0 });
    expect(by.bio).toEqual({ step: 'bio', viewed: 0, done: 0, dropOffPct: null });
    expect(f.steps).toHaveLength(16);
    expect(new Date(f.from).getTime()).toBeLessThan(Date.now() - 29 * DAY);
  });
});

describe('painel: retenção por semana de cadastro', () => {
  it('D1/D7/D30 exatos (access_logs ou app_open), sem equipe, null enquanto o prazo não chegou', async () => {
    const today = spToday();
    const week = addDays(mondayOf(today), -49); // 7 semanas atrás
    const d0 = addDays(week, 2); // quarta-feira
    const u1 = await newUser(prisma, 'Um', { createdAt: noonSp(d0) });
    const u2 = await newUser(prisma, 'Dois', { createdAt: noonSp(d0) });
    const u4 = await newUser(prisma, 'Quatro', { createdAt: noonSp(addDays(d0, 1)) });
    await newUser(prisma, 'Admin', { createdAt: noonSp(d0), role: 'admin' });
    await accessLog(u1.id, noonSp(addDays(d0, 1))); // D1
    await event('app_open', { userId: u1.id, installId: newInstall(), at: noonSp(addDays(d0, 7)) }); // D7
    await accessLog(u1.id, noonSp(addDays(d0, 31))); // D31 não é D30
    await accessLog(u2.id, noonSp(d0)); // mesmo dia do cadastro não conta
    await accessLog(u4.id, noonSp(addDays(d0, 1 + 30))); // D30 do Quatro
    // semana atual: conta de hoje, prazo nenhum chegou
    await newUser(prisma, 'Hoje', { createdAt: new Date() });

    const r = await metrics.computeRetention(12);
    expect(r.cohorts).toHaveLength(12);
    expect(r.cohorts[0]).toMatchObject({
      week: mondayOf(today),
      signups: 1,
      d1: null,
      d7: null,
      d30: null,
    });
    const w = r.cohorts.find((c) => c.week === week);
    expect(w).toEqual({
      week,
      signups: 3,
      d1: { returned: 1, pct: 33.3 },
      d7: { returned: 1, pct: 33.3 },
      d30: { returned: 1, pct: 33.3 },
    });
    // as outras semanas vêm zeradas (semana sem cadastro também aparece)
    const others = r.cohorts.filter((c) => c.week !== week && c.week !== mondayOf(today));
    expect(others.every((c) => c.signups === 0)).toBe(true);
  });
});

describe('painel: ativos', () => {
  it('contas distintas por dia/semana e hoje / 7 / 30 dias (anônimo não conta)', async () => {
    const today = spToday();
    const [u1, u2, u3, u4] = await Promise.all(
      ['A1', 'A2', 'A3', 'A4'].map((n) => newUser(prisma, n, { createdAt: ago(60 * DAY) })),
    );
    await accessLog(u1.id, new Date());
    await accessLog(u2.id, new Date());
    await event('app_open', { userId: u2.id, installId: newInstall() });
    await accessLog(u3.id, noonSp(addDays(today, -3)));
    await accessLog(u4.id, noonSp(addDays(today, -20)));
    await event('app_open', { installId: newInstall() });

    const a = await metrics.computeActive(30);
    expect({ dau: a.dau, wau: a.wau, mau: a.mau }).toEqual({ dau: 2, wau: 3, mau: 4 });
    expect(a.daily).toHaveLength(30);
    expect(a.daily.at(-1)).toEqual({ day: today, n: 2 });
    expect(a.daily.find((p) => p.day === addDays(today, -3))?.n).toBe(1);
    expect(a.weekly).toHaveLength(12);
    expect(a.weekly.at(-1)?.week).toBe(mondayOf(today));
    expect((await metrics.computeActive(7)).daily).toHaveLength(7);
  });

  it('cache de 2 min: a mesma consulta não recalcula', async () => {
    const first = await metrics.active(30);
    await accessLog((await newUser(prisma, 'Nova')).id, new Date());
    expect(await metrics.active(30)).toEqual(first);
  });
});
