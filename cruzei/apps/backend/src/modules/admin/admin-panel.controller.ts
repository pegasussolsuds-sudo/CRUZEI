import type { AdminMe, AdminStaffList, StaffRole } from '@cruzei/shared-types';
import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PrismaService } from '../../database/prisma.service';

import { auditTargetId, AuditService } from './audit.service';
import { permissionsFor } from './permissions';
import { RequirePermission, StaffGuard } from './staff.guard';
import { StatsService } from './stats.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Painel web (apps/admin): quem sou eu, a equipe, números do painel e auditoria. Só equipe; permissão por rota.
@UseGuards(JwtAuthGuard, StaffGuard)
@Controller('admin')
export class AdminPanelController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stats: StatsService,
    private readonly audit: AuditService,
  ) {}

  /** 403 staff_only pra quem não é admin/moderador (o painel usa pra decidir se deixa entrar) */
  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser): Promise<AdminMe> {
    const u = await this.prisma.user.findUnique({ where: { id: user.id }, select: { name: true } });
    if (!u) throw new NotFoundException({ error: 'not_found', message: 'Conta não encontrada' });
    return {
      id: user.id,
      name: u.name,
      role: user.role as StaffRole,
      permissions: permissionsFor(user.role),
    };
  }

  /** a equipe (conta ativa) pro "Passar pra…" do suporte — o assign aceita qualquer uma dessas pessoas */
  @Get('staff')
  async staff(): Promise<AdminStaffList> {
    const rows = await this.prisma.user.findMany({
      where: { role: { in: ['admin', 'moderator'] }, deletedAt: null, accountStatus: 'active' },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: 200,
      select: { id: true, name: true, role: true },
    });
    return { items: rows.map((u) => ({ id: u.id, name: u.name, role: u.role as StaffRole })) };
  }

  @Get('stats')
  @RequirePermission('dashboard')
  getStats() {
    return this.stats.stats();
  }

  /** ?action= trecho da ação (ban, premium…) · ?targetId= uuid ou número do lugar · ?actorId= uuid */
  @Get('audit')
  @RequirePermission('audit')
  list(
    @Query('actorId') actorId?: string,
    @Query('targetId') targetId?: string,
    @Query('action') action?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const target = targetId?.trim() ? auditTargetId(targetId) : null;
    if (targetId?.trim() && !target) {
      throw new BadRequestException({
        error: 'invalid_target',
        message: 'Id do alvo inválido: cole o id completo (uuid) ou o número do lugar',
      });
    }
    return this.audit.list({
      actorId: actorId && UUID.test(actorId) ? actorId : undefined,
      targetId: target ?? undefined,
      action: action?.slice(0, 64) || undefined,
      cursor,
      limit,
    });
  }
}
