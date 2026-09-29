import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { REPORT_REASONS, type ReportPayload, type ReportReason, type ReportResult } from '@cruzei/shared-types';
import { PrismaService } from '../../database/prisma.service';
import { BlocksService } from '../blocks/blocks.service';
import { ModerationService } from '../moderation/moderation.service';

import { sanitizeContext, type ReportContextInput } from './report-context';

export { sanitizeContext } from './report-context';

/** ordem da fila: exploração infantil primeiro, depois menor de idade/ameaça, depois assédio/conteúdo impróprio */
export const REPORT_PRIORITY: Record<ReportReason, number> = {
  child_safety: 3,
  underage: 2,
  threat: 2,
  harassment: 1,
  inappropriate: 1,
  scam: 1,
  fake: 0,
  spam: 0,
  other: 0,
};

/** pessoas diferentes denunciando em 7 dias → sai da descoberta até a revisão */
export const HOLD_DISTINCT_REPORTERS = 3;

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blocks: BlocksService,
    private readonly moderation: ModerationService,
  ) {}

  /** context aceita o formato de build antigo (matchId, origem 'matches'): grava sempre no formato de hoje */
  async create(
    reporterId: string,
    p: Omit<ReportPayload, 'userId' | 'context'> & { targetId: string; context?: ReportContextInput },
  ): Promise<ReportResult> {
    const { targetId } = p;
    if (reporterId === targetId) throw new BadRequestException('Não pode denunciar você mesmo');
    if (!REPORT_REASONS.includes(p.reason)) throw new BadRequestException('Motivo inválido');
    const target = await this.prisma.user.findUnique({ where: { id: targetId }, select: { id: true } });
    if (!target) throw new NotFoundException('Usuário não encontrado');

    const priority = REPORT_PRIORITY[p.reason];
    const context = sanitizeContext(p.context);
    const description = p.description?.trim() || null;

    // mesma pessoa denunciando de novo em 24 h: soma à denúncia pendente (fila sem duplicata, prioridade maior vence)
    const recent = await this.prisma.report.findFirst({
      where: { reporterId, reportedId: targetId, status: 'pending', createdAt: { gt: new Date(Date.now() - 86_400_000) } },
      orderBy: { createdAt: 'desc' },
    });
    let id: string;
    if (recent) {
      const upgrade = priority > recent.priority;
      await this.prisma.report.update({
        where: { id: recent.id },
        data: {
          ...(upgrade ? { reason: p.reason, priority } : {}),
          description: [recent.description, description && description !== recent.description ? description : null].filter(Boolean).join('\n—\n').slice(0, 2000) || null,
          ...(context && !recent.context ? { context } : {}),
        },
      });
      id = recent.id;
    } else {
      id = uuid();
      await this.prisma.report.create({
        data: { id, reporterId, reportedId: targetId, reason: p.reason, description, priority, ...(context ? { context } : {}) },
      });
    }

    let blocked = false;
    if (p.block) {
      await this.blocks.block(reporterId, targetId, `denúncia: ${p.reason}`);
      blocked = true;
    }

    // exploração infantil: sai da descoberta NA HORA; várias pessoas diferentes em 7 dias: idem
    if (p.reason === 'child_safety') {
      await this.moderation.holdForReview(targetId, 'denúncia de exploração ou abuso infantil');
    } else {
      const reporters = await this.prisma.report.findMany({
        where: { reportedId: targetId, createdAt: { gt: new Date(Date.now() - 7 * 86_400_000) }, reporterId: { not: null } },
        distinct: ['reporterId'],
        select: { reporterId: true },
      });
      if (reporters.length >= HOLD_DISTINCT_REPORTERS) {
        await this.moderation.holdForReview(targetId, `${reporters.length} pessoas denunciaram em 7 dias`);
      }
    }
    return { id, merged: Boolean(recent), blocked };
  }
}
