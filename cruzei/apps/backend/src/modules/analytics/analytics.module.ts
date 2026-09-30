import { Module } from '@nestjs/common';

import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AnalyticsTask } from './analytics.task';
import { OptionalJwtAuthGuard } from './optional-jwt.guard';

// Métricas próprias (POST /v1/analytics/events e /link). O painel lê pelo MetricsService (AdminModule).
// Exporta o AnalyticsService pro cadastro (AuthService.register → recordSignup). Não importa nada: sem ciclo.
@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AnalyticsTask, OptionalJwtAuthGuard],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
