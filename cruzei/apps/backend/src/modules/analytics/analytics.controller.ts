import { ANALYTICS_LIMITS, type AnalyticsBatchResult } from '@cruzei/shared-types';
import { Body, Controller, ExecutionContext, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ArrayMaxSize, IsArray, IsString, Matches } from 'class-validator';

import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { bearerOf, ipTracker } from '../../common/guards/user-throttler.guard';

import { ANON_EVENTS_PER_MINUTE } from './analytics-sanitize';
import { AnalyticsService } from './analytics.service';
import { OptionalJwtAuthGuard } from './optional-jwt.guard';

const INSTALL_ID = new RegExp(`^[A-Za-z0-9_-]{8,${ANALYTICS_LIMITS.installIdMax}}$`);

export class AnalyticsBatchDto {
  /** id aleatório da instalação (gerado no app; não é id do aparelho) */
  @IsString() @Matches(INSTALL_ID) installId!: string;
  /** cada evento é saneado no serviço: o ruim sai sozinho, sem derrubar o lote */
  @IsArray() @ArrayMaxSize(ANALYTICS_LIMITS.batchMax) events!: unknown[];
}

export class AnalyticsLinkDto {
  @IsString() @Matches(INSTALL_ID) installId!: string;
}

/**
 * Teto por minuto do POST /analytics/events. Com Bearer a chave é a conta (token inválido/vencido leva 401 no guard e
 * não grava nada); SEM conta a chave é o IP e o teto é bem menor — o installId é livre, então é o IP que segura.
 */
export function eventsRouteLimit(ctx: ExecutionContext): number {
  const req = ctx.switchToHttp().getRequest<Record<string, unknown>>();
  return bearerOf(req) ? ANALYTICS_LIMITS.perMinute * 4 : ANON_EVENTS_PER_MINUTE;
}

// Métricas próprias do app (funil do cadastro, retenção). Sem posição; lista fechada de eventos.
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  /**
   * Lote de eventos (login opcional). Limite por conta ou IP aqui (eventsRouteLimit), por instalação e de instalações
   * novas por IP no serviço.
   */
  @Throttle({ default: { ttl: 60_000, limit: eventsRouteLimit } })
  @UseGuards(OptionalJwtAuthGuard)
  @HttpCode(200)
  @Post('events')
  events(
    @Body() dto: AnalyticsBatchDto,
    @Req() req: Record<string, unknown> & { user?: AuthenticatedUser },
  ): Promise<AnalyticsBatchResult> {
    return this.analytics.ingest(dto.installId, dto.events, {
      userId: req.user?.id ?? null,
      ip: ipTracker(req),
    });
  }

  /** depois do login: os eventos anônimos recentes desta instalação passam a ser da minha conta (se não é de outra) */
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  @Post('link')
  async link(@CurrentUser() user: AuthenticatedUser, @Body() dto: AnalyticsLinkDto): Promise<void> {
    await this.analytics.link(user.id, dto.installId);
  }
}
