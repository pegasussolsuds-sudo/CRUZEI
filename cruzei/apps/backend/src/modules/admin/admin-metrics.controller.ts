import type { AdminActive, AdminFunnel, AdminRetention } from '@cruzei/shared-types';
import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

import { clampInt } from './metrics';
import { MetricsService } from './metrics.service';
import { RequirePermission, StaffGuard } from './staff.guard';

// Página "Métricas" do painel: só admin (permissão 'metrics'; moderador leva 403 admin_only). Só números agregados.
@UseGuards(JwtAuthGuard, StaffGuard)
@RequirePermission('metrics')
@Controller('admin/metrics')
export class AdminMetricsController {
  constructor(private readonly metrics: MetricsService) {}

  /** ?days= 1–90 (padrão 30): funil do cadastro */
  @Get('funnel')
  funnel(@Query('days') days?: string): Promise<AdminFunnel> {
    return this.metrics.funnel(clampInt(days, 1, 90, 30));
  }

  /** ?weeks= 1–52 (padrão 12): retenção D1/D7/D30 por semana de cadastro */
  @Get('retention')
  retention(@Query('weeks') weeks?: string): Promise<AdminRetention> {
    return this.metrics.retention(clampInt(weeks, 1, 52, 12));
  }

  /** ?days= 7–90 (padrão 30): ativos por dia/semana */
  @Get('active')
  active(@Query('days') days?: string): Promise<AdminActive> {
    return this.metrics.active(clampInt(days, 7, 90, 30));
  }
}
