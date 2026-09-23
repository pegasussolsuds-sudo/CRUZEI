import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { v4 as uuid } from 'uuid';

const ALLOWED_REASONS = ['harassment', 'fake', 'spam', 'inappropriate', 'other'] as const;

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(reporterId: string, targetId: string, payload: { reason: string; description?: string; evidenceUrls?: string[] }) {
    if (reporterId === targetId) throw new BadRequestException('Não pode denunciar você mesmo');
    if (!ALLOWED_REASONS.includes(payload.reason as never)) {
      throw new BadRequestException('Motivo inválido');
    }
    return this.prisma.report.create({
      data: {
        id: uuid(),
        reporterId,
        reportedId: targetId,
        reason: payload.reason,
        description: payload.description,
        evidenceUrls: payload.evidenceUrls as never,
      },
    });
  }
}
