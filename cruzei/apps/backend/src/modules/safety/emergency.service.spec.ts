import type { PrismaService } from '../../database/prisma.service';
import type { RedisService } from '../../redis/redis.service';
import type { BlocksService } from '../blocks/blocks.service';
import type { ModerationService } from '../moderation/moderation.service';
import { REPORT_THROTTLE } from '../reports/reports.controller';
import type { SupportService } from '../support/support.service';

import {
  EMERGENCY_REPORT_TARGETS_PER_DAY,
  EMERGENCY_THROTTLE,
  emergencyReportSkip,
} from './emergency-limits';
import { EmergencyService } from './emergency.service';

// Botão de emergência (unitário, banco falso): só bloqueia/denuncia quem tem RELAÇÃO registrada (conversa, curtida,
// passe ou aceno); sem relação vira emergência sem pessoa (pausa + suporte). A denúncia entra no orçamento das
// denúncias do app (REPORT_THROTTLE) e tem limite de pessoas diferentes por dia.

const ME = '0a000000-0000-4000-8000-00000000000a';
const HIM = '0b000000-0000-4000-8000-00000000000b';
const CONV = '0c000000-0000-4000-8000-00000000000c';

interface Opts {
  conversation?: { userLowId: string; userHighId: string } | null;
  pairConversation?: boolean;
  like?: boolean;
  pass?: boolean;
  waves?: number | 'error';
  pendingReport?: { id: string; context: unknown } | null;
  reportsLastHour?: number;
  otherTargetsToday?: number;
  targetExists?: boolean;
}

function setup(o: Opts = {}) {
  const prisma = {
    conversation: {
      findUnique: jest.fn(async (a: { where: { id?: string } }) =>
        a.where.id ? (o.conversation ?? null) : o.pairConversation ? { id: CONV } : null,
      ),
    },
    user: {
      findUnique: jest.fn(async (a: { where: { id: string }; select: Record<string, boolean> }) => {
        if (a.select.isPaused) return { isPaused: false, pausedUntil: null };
        return a.where.id === HIM && o.targetExists !== false ? { id: HIM, name: 'Fulano' } : null;
      }),
      update: jest.fn(async () => ({})),
    },
    like: { findFirst: jest.fn(async () => (o.like ? { id: 1n } : null)) },
    pass: { findFirst: jest.fn(async () => (o.pass ? { userId: ME } : null)) },
    report: {
      findFirst: jest.fn(async () => o.pendingReport ?? null),
      update: jest.fn(async () => ({})),
      create: jest.fn(async () => ({ id: 'rep-novo' })),
      count: jest.fn(async () => o.reportsLastHour ?? 0),
      findMany: jest.fn(async (a: { where: { reason?: string } }) =>
        a.where.reason === 'emergency'
          ? Array.from({ length: o.otherTargetsToday ?? 0 }, (_, i) => ({ reportedId: `x${i}` }))
          : [],
      ),
    },
  };
  const redis = {
    markPresenceHidden: jest.fn(async () => undefined),
    invalidateProfile: jest.fn(async () => undefined),
    client: {
      exists: jest.fn(async () => {
        if (o.waves === 'error') throw new Error('redis fora');
        return o.waves ?? 0;
      }),
    },
  };
  const blocks = { block: jest.fn(async () => undefined) };
  const support = { openUrgent: jest.fn(async () => ({ id: 'thread-1' })) };
  const moderation = { holdForReview: jest.fn(async () => undefined) };
  const svc = new EmergencyService(
    prisma as unknown as PrismaService,
    redis as unknown as RedisService,
    blocks as unknown as BlocksService,
    support as unknown as SupportService,
    moderation as unknown as ModerationService,
  );
  const note = () =>
    (support.openUrgent.mock.calls[0] as unknown as [string, { note: string; reply: string }])[1];
  return { svc, prisma, redis, blocks, support, note };
}

describe('EmergencyService — só com relação registrada', () => {
  it('sem relação: pausa + suporte, sem bloquear nem denunciar; a equipe vê a pessoa citada', async () => {
    const t = setup();
    const r = await t.svc.trigger(ME, { targetUserId: HIM });
    expect(r).toMatchObject({ blocked: false, reportId: null, supportThreadId: 'thread-1' });
    expect(t.blocks.block).not.toHaveBeenCalled();
    expect(t.prisma.report.create).not.toHaveBeenCalled();
    expect(t.prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isPaused: true }) }),
    );
    const { note, reply } = t.note();
    expect(note).toContain('SEM relação registrada');
    expect(note).toContain(HIM);
    expect(note).not.toContain('Denúncia de segurança');
    expect(reply).not.toContain('bloqueada');
  });

  it.each([
    ['curtida (qualquer sentido)', { like: true }],
    ['passe no deck', { pass: true }],
    ['conversa do par', { pairConversation: true }],
    ['aceno nas últimas 24 h', { waves: 1 }],
  ] as const)('com %s: bloqueia e denuncia', async (_n, o) => {
    const t = setup(o);
    const r = await t.svc.trigger(ME, { targetUserId: HIM.toUpperCase() });
    expect(r).toMatchObject({ blocked: true, reportId: 'rep-novo' });
    expect(t.blocks.block).toHaveBeenCalledWith(ME, HIM, 'emergência');
    expect(t.prisma.report.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reporterId: ME,
          reportedId: HIM,
          reason: 'emergency',
          priority: 4,
        }),
      }),
    );
  });

  it('a relação vale nos dois sentidos (curtida e passe)', async () => {
    const t = setup({ like: true });
    await t.svc.hasRelation(ME, HIM);
    expect(t.prisma.like.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { likerId: ME, likedId: HIM },
            { likerId: HIM, likedId: ME },
          ],
        },
      }),
    );
    const p = t.prisma.pass.findFirst.mock.calls[0] as unknown as [
      { where: { OR: unknown[]; createdAt: { gte: Date } } },
    ];
    expect(p[0].where.OR).toEqual([
      { userId: ME, targetId: HIM },
      { userId: HIM, targetId: ME },
    ]);
    // passe vencido não conta
    expect(p[0].where.createdAt.gte.getTime()).toBeGreaterThan(Date.now() - 366 * 86_400_000);
  });

  it('Redis fora do ar no aceno: sem relação (não derruba a emergência)', async () => {
    const t = setup({ waves: 'error' });
    const r = await t.svc.trigger(ME, { targetUserId: HIM });
    expect(r).toMatchObject({ blocked: false, reportId: null });
    expect(t.support.openUrgent).toHaveBeenCalledTimes(1);
  });

  it('conversa MINHA com a pessoa já é a relação (não consulta o resto)', async () => {
    const [low, high] = ME < HIM ? [ME, HIM] : [HIM, ME];
    const t = setup({ conversation: { userLowId: low, userHighId: high } });
    const r = await t.svc.trigger(ME, { conversationId: CONV });
    expect(r).toMatchObject({ blocked: true, reportId: 'rep-novo' });
    expect(t.prisma.like.findFirst).not.toHaveBeenCalled();
    expect(t.prisma.report.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ context: { source: 'emergency', conversationId: CONV } }),
      }),
    );
  });

  it('alvo que não existe: emergência sem pessoa, sem consultar relação', async () => {
    const t = setup({ targetExists: false, like: true });
    const r = await t.svc.trigger(ME, { targetUserId: HIM });
    expect(r).toMatchObject({ blocked: false, reportId: null });
    expect(t.prisma.like.findFirst).not.toHaveBeenCalled();
    expect(t.note().note).toContain('Sem pessoa envolvida');
  });
});

describe('EmergencyService — orçamento da denúncia', () => {
  it(`${REPORT_THROTTLE.default.limit} denúncias na última hora (app + botão): bloqueia, mas não denuncia`, async () => {
    const t = setup({ like: true, reportsLastHour: REPORT_THROTTLE.default.limit });
    const r = await t.svc.trigger(ME, { targetUserId: HIM });
    expect(r).toMatchObject({ blocked: true, reportId: null });
    expect(t.prisma.report.create).not.toHaveBeenCalled();
    expect(t.note().note).toContain('Denúncia NÃO criada: limite de denúncias da última hora');
    // conta TODAS as minhas da janela do REPORT_THROTTLE, de qualquer motivo
    const c = t.prisma.report.count.mock.calls[0] as unknown as [
      { where: { reporterId: string; createdAt: { gt: Date }; reason?: string } },
    ];
    expect(c[0].where.reporterId).toBe(ME);
    expect(c[0].where.reason).toBeUndefined();
    expect(Date.now() - c[0].where.createdAt.gt.getTime()).toBeLessThanOrEqual(
      REPORT_THROTTLE.default.ttl + 1000,
    );
  });

  it(`já denunciou ${EMERGENCY_REPORT_TARGETS_PER_DAY} pessoas diferentes pelo botão hoje: não denuncia a 4ª`, async () => {
    const t = setup({ like: true, otherTargetsToday: EMERGENCY_REPORT_TARGETS_PER_DAY });
    const r = await t.svc.trigger(ME, { targetUserId: HIM });
    expect(r).toMatchObject({ blocked: true, reportId: null });
    expect(t.note().note).toContain('pessoas diferentes pelo botão hoje');
    const f = t.prisma.report.findMany.mock.calls[0] as unknown as [
      { where: Record<string, unknown>; distinct: string[] },
    ];
    expect(f[0].where).toMatchObject({
      reporterId: ME,
      reason: 'emergency',
      reportedId: { not: HIM },
    });
    expect(f[0].distinct).toEqual(['reportedId']);
  });

  it('denúncia pendente contra a mesma pessoa é reaproveitada sem gastar orçamento', async () => {
    const t = setup({
      like: true,
      pendingReport: { id: 'rep-velho', context: { source: 'emergency' } },
      reportsLastHour: 999,
    });
    const r = await t.svc.trigger(ME, { targetUserId: HIM });
    expect(r.reportId).toBe('rep-velho');
    expect(t.prisma.report.count).not.toHaveBeenCalled();
    expect(t.prisma.report.create).not.toHaveBeenCalled();
  });
});

describe('limites do botão', () => {
  it('rota: 3 por hora e 10 por dia', () => {
    expect(EMERGENCY_THROTTLE).toEqual({
      default: { ttl: 3_600_000, limit: 3 },
      strict: { ttl: 86_400_000, limit: 10 },
    });
  });

  it('orçamento: hora (mesmo limite das denúncias do app) antes dos alvos do dia', () => {
    const L = REPORT_THROTTLE.default.limit;
    expect(emergencyReportSkip({ reportsLastHour: L - 1, otherTargetsToday: 0 })).toBeNull();
    expect(emergencyReportSkip({ reportsLastHour: L, otherTargetsToday: 0 })).toBe('hour');
    expect(
      emergencyReportSkip({
        reportsLastHour: 0,
        otherTargetsToday: EMERGENCY_REPORT_TARGETS_PER_DAY - 1,
      }),
    ).toBeNull();
    expect(
      emergencyReportSkip({
        reportsLastHour: 0,
        otherTargetsToday: EMERGENCY_REPORT_TARGETS_PER_DAY,
      }),
    ).toBe('targets');
    expect(
      emergencyReportSkip({
        reportsLastHour: L,
        otherTargetsToday: EMERGENCY_REPORT_TARGETS_PER_DAY,
      }),
    ).toBe('hour');
  });
});
