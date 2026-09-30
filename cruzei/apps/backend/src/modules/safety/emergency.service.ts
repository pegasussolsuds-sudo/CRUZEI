import {
  EMERGENCY_PAUSE_DAYS,
  type EmergencyRequest,
  type EmergencyResult,
  type ReportContext,
} from '@cruzei/shared-types';
import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { BlocksService } from '../blocks/blocks.service';
import { passCutoff } from '../likes/passes';
import { ModerationService } from '../moderation/moderation.service';
import { contextConversationId } from '../reports/report-context';
import { HOLD_DISTINCT_REPORTERS } from '../reports/reports.service';
import { SupportService } from '../support/support.service';

import {
  EMERGENCY_TARGETS_WINDOW_MS,
  REPORT_BUDGET_WINDOW_MS,
  emergencyReportSkip,
  type EmergencyReportSkip,
} from './emergency-limits';
import {
  EMERGENCY_REPORT_DESCRIPTION,
  EMERGENCY_REPORT_PRIORITY,
  emergencyReplyText,
  emergencyStaffNote,
  emergencyUserText,
  type EmergencyVia,
} from './emergency-texts';

const DAY_MS = 86_400_000;

type Person = { id: string; name: string };

/**
 * Botão "🆘 Emergência" (POST /v1/safety/emergency), numa tacada: pausa o perfil por EMERGENCY_PAUSE_DAYS (some do
 * mapa na hora), bloqueia a pessoa (se houver), cria denúncia de segurança contra ela ('emergency', prioridade
 * máxima) e abre o suporte URGENTE (topo da fila + alerta ao vivo). Pausa e suporte são obrigatórios (erro = 500 e o
 * app avisa); bloqueio e denúncia são "melhor esforço" — se falharem, a equipe vê na nota interna. Nunca localização.
 * Repetir não duplica: bloqueio é upsert, denúncia pendente é reaproveitada, atendimento é o mesmo.
 * Travas contra uso como arma: a pessoa só é bloqueada/denunciada com RELAÇÃO registrada (hasRelation; sem ela vira
 * emergência sem pessoa) e a denúncia entra no orçamento das denúncias do app (emergency-limits.ts). A rota tem limite
 * próprio (EMERGENCY_THROTTLE) e o alarme da equipe toca no máximo 1 vez a cada 10 min por atendimento.
 */
@Injectable()
export class EmergencyService {
  private readonly log = new Logger(EmergencyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly blocks: BlocksService,
    private readonly support: SupportService,
    private readonly moderation: ModerationService,
  ) {}

  async trigger(me: string, req: EmergencyRequest): Promise<EmergencyResult> {
    const { target, unrelated, conversationId, via } = await this.resolveTarget(me, req);
    const pausedUntil = await this.pause(me);

    let blocked = false;
    let blockFailed = false;
    let reportId: string | null = null;
    let reportSkipped: EmergencyReportSkip | null = null;
    if (target) {
      try {
        await this.blocks.block(me, target.id, 'emergência');
        blocked = true;
      } catch (e) {
        blockFailed = true;
        this.log.error(
          `emergência: bloqueio falhou (${me} → ${target.id}): ${(e as Error).message}`,
        );
      }
      try {
        const r = await this.report(me, target.id, conversationId);
        reportId = r.id;
        reportSkipped = r.skipped;
      } catch (e) {
        this.log.error(
          `emergência: denúncia falhou (${me} → ${target.id}): ${(e as Error).message}`,
        );
      }
    }

    const thread = await this.support.openUrgent(me, {
      body: emergencyUserText(via),
      reply: emergencyReplyText({ pausedUntil, blocked, reported: reportId !== null }),
      note: emergencyStaffNote({
        via,
        target,
        unrelated,
        conversationId,
        reportId,
        reportSkipped,
        blocked,
        blockFailed,
        pausedUntil,
      }),
    });
    return {
      pausedUntil: pausedUntil.toISOString(),
      blocked,
      reportId,
      supportThreadId: thread.id,
    };
  }

  /**
   * A pessoa envolvida: targetUserId e/ou a conversa. A conversa só vale se for MINHA; sem targetUserId, o alvo é a
   * outra ponta dela. Alvo = eu mesmo ou inexistente → emergência sem pessoa (nunca falha por causa do alvo). Alvo sem
   * relação registrada → emergência sem pessoa também (`unrelated` só vai pra nota interna da equipe).
   */
  private async resolveTarget(
    me: string,
    req: EmergencyRequest,
  ): Promise<{
    target: Person | null;
    unrelated: Person | null;
    conversationId: string | null;
    via: EmergencyVia;
  }> {
    let targetId =
      req.targetUserId && req.targetUserId.toLowerCase() !== me
        ? req.targetUserId.toLowerCase()
        : null;
    let conversationId: string | null = null;
    if (req.conversationId) {
      const c = await this.prisma.conversation.findUnique({
        where: { id: req.conversationId },
        select: { userLowId: true, userHighId: true },
      });
      if (c && (c.userLowId === me || c.userHighId === me)) {
        const other = c.userLowId === me ? c.userHighId : c.userLowId;
        targetId ??= other;
        if (targetId === other) conversationId = req.conversationId.toLowerCase();
      }
    }
    const person = targetId
      ? await this.prisma.user.findUnique({
          where: { id: targetId },
          select: { id: true, name: true },
        })
      : null;
    // a conversa minha com a pessoa já é a relação; sem ela, confere o resto
    if (person && !conversationId && !(await this.hasRelation(me, person.id))) {
      this.log.warn(`emergência: alvo sem relação (${me} → ${person.id}); segue sem pessoa`);
      return { target: null, unrelated: person, conversationId: null, via: 'profile' };
    }
    return {
      target: person,
      unrelated: null,
      conversationId,
      via: conversationId ? 'chat' : person ? 'profile' : 'help',
    };
  }

  /**
   * Relação registrada com a pessoa (só com ela o botão bloqueia e denuncia): conversa do par, curtida em qualquer
   * sentido, "Passar" no deck em qualquer sentido (ainda valendo: DISCOVERY_PASS_DAYS) ou aceno nas últimas 24 h
   * (Redis, melhor esforço). Sem isso, um id qualquer não vira bloqueio + denúncia de prioridade máxima.
   */
  async hasRelation(me: string, other: string): Promise<boolean> {
    const [low, high] = me < other ? [me, other] : [other, me];
    const [conv, like, pass] = await Promise.all([
      this.prisma.conversation.findUnique({
        where: { userLowId_userHighId: { userLowId: low, userHighId: high } },
        select: { id: true },
      }),
      this.prisma.like.findFirst({
        where: {
          OR: [
            { likerId: me, likedId: other },
            { likerId: other, likedId: me },
          ],
        },
        select: { id: true },
      }),
      this.prisma.pass.findFirst({
        where: {
          OR: [
            { userId: me, targetId: other },
            { userId: other, targetId: me },
          ],
          createdAt: { gte: passCutoff() },
        },
        select: { userId: true },
      }),
    ]);
    if (conv || like || pass) return true;
    const waves = await this.redis.client
      .exists(`wave:${me}:${other}`, `wave:${other}:${me}`)
      .catch(() => 0);
    return waves > 0;
  }

  /** pausa de EMERGENCY_PAUSE_DAYS (uma pausa maior que já existia fica) e some do mapa na hora */
  private async pause(me: string): Promise<Date> {
    const min = new Date(Date.now() + EMERGENCY_PAUSE_DAYS * DAY_MS);
    const cur = await this.prisma.user.findUnique({
      where: { id: me },
      select: { isPaused: true, pausedUntil: true },
    });
    const until = cur?.isPaused && cur.pausedUntil && cur.pausedUntil > min ? cur.pausedUntil : min;
    await this.prisma.user.update({
      where: { id: me },
      data: { isPaused: true, pausedUntil: until },
    });
    await this.redis.markPresenceHidden(me).catch(() => undefined);
    await this.redis.invalidateProfile(me);
    return until;
  }

  /**
   * denúncia de segurança; a pendente de emergência contra a mesma pessoa é reaproveitada (completa a conversa).
   * Nova só dentro do orçamento (reportBudget): fora dele, `skipped` e a equipe vê na nota interna.
   */
  private async report(
    me: string,
    targetId: string,
    conversationId: string | null,
  ): Promise<{ id: string | null; skipped: EmergencyReportSkip | null }> {
    const pending = await this.prisma.report.findFirst({
      where: { reporterId: me, reportedId: targetId, reason: 'emergency', status: 'pending' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, context: true },
    });
    if (pending) {
      if (conversationId && !contextConversationId(pending.context)) {
        const context: ReportContext = { source: 'emergency', conversationId };
        await this.prisma.report.update({ where: { id: pending.id }, data: { context } });
      }
      return { id: pending.id, skipped: null };
    }
    const skipped = await this.reportBudget(me, targetId);
    if (skipped) {
      this.log.warn(`emergência: denúncia não criada (${skipped}) ${me} → ${targetId}`);
      return { id: null, skipped };
    }
    const context: ReportContext = {
      source: 'emergency',
      ...(conversationId ? { conversationId } : {}),
    };
    const r = await this.prisma.report.create({
      data: {
        reporterId: me,
        reportedId: targetId,
        reason: 'emergency',
        priority: EMERGENCY_REPORT_PRIORITY,
        description: EMERGENCY_REPORT_DESCRIPTION,
        context,
      },
      select: { id: true },
    });
    // mesma regra das denúncias do app: pessoas diferentes em 7 dias → fora da descoberta até a revisão
    const reporters = await this.prisma.report.findMany({
      where: {
        reportedId: targetId,
        createdAt: { gt: new Date(Date.now() - 7 * DAY_MS) },
        reporterId: { not: null },
      },
      distinct: ['reporterId'],
      select: { reporterId: true },
    });
    if (reporters.length >= HOLD_DISTINCT_REPORTERS) {
      await this.moderation.holdForReview(
        targetId,
        `${reporters.length} pessoas denunciaram em 7 dias`,
      );
    }
    return { id: r.id, skipped: null };
  }

  /**
   * orçamento da denúncia de emergência: o MESMO das denúncias do app (REPORT_THROTTLE: conta todas as minhas da
   * última hora, do app e do botão) e no máximo EMERGENCY_REPORT_TARGETS_PER_DAY pessoas diferentes pelo botão por dia
   */
  private async reportBudget(me: string, targetId: string): Promise<EmergencyReportSkip | null> {
    const now = Date.now();
    const [reportsLastHour, others] = await Promise.all([
      this.prisma.report.count({
        where: { reporterId: me, createdAt: { gt: new Date(now - REPORT_BUDGET_WINDOW_MS) } },
      }),
      this.prisma.report.findMany({
        where: {
          reporterId: me,
          reason: 'emergency',
          reportedId: { not: targetId },
          createdAt: { gt: new Date(now - EMERGENCY_TARGETS_WINDOW_MS) },
        },
        distinct: ['reportedId'],
        select: { reportedId: true },
      }),
    ]);
    return emergencyReportSkip({ reportsLastHour, otherTargetsToday: others.length });
  }
}
