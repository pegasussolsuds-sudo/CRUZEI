import type {
  AccountDeletionPreview,
  AccountDeletionResponse,
  LocationHistoryForgetResponse,
  LoginResponse,
} from '@cruzei/shared-types';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import type { Request, Response } from 'express';

import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AccessLogService } from '../account/access-log.service';
import { DeletionStateService } from '../account/deletion-state.service';
import { AuthService } from '../auth/auth.service';

import { AccountDeletionService } from './account-deletion.service';
import { DataExportService } from './data-export.service';
import { LocationHistoryService } from './location-history.service';
import { parseFlag } from './privacy-config';

/** o serviço compara `confirm` exatamente (400 confirm_required) e ignora motivo fora da lista */
export class AccountDeletionDto {
  @IsOptional() @IsString() @MaxLength(20) confirm?: string;
  @IsOptional() @IsString() @MaxLength(20) reason?: string;
}

export class DeletionCancelDto {
  @IsUUID() challengeId!: string;
}

const STRICT = { strict: { ttl: 60_000, limit: 5 } } as const;

@UseGuards(JwtAuthGuard)
@Controller('me')
export class AccountPrivacyController {
  constructor(
    private readonly deletion: AccountDeletionService,
    private readonly exporter: DataExportService,
    private readonly locations: LocationHistoryService,
    private readonly access: AccessLogService,
  ) {}

  /** o que a tela mostra antes de confirmar (prazo, assinatura ativa na loja, conta da equipe) */
  @Get('deletion')
  preview(@CurrentUser() user: AuthenticatedUser): Promise<AccountDeletionPreview> {
    return this.deletion.preview(user.id);
  }

  /** pede a exclusão: 202; o app faz logout local. 400 confirm_required, 409 staff_account */
  @Throttle(STRICT)
  @Post('deletion')
  @HttpCode(202)
  async request(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AccountDeletionDto,
    @Req() req: Request,
  ): Promise<AccountDeletionResponse> {
    const { created, ...out } = await this.deletion.request(user.id, dto);
    if (created) this.access.record(user.id, 'delete_request', req);
    return out;
  }

  /** cópia dos dados em JSON (anexo, sem cache); DATA_EXPORT_DAILY_LIMIT por dia → 429 export_limit */
  @Throttle(STRICT)
  @Get('export')
  async export(
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    await this.exporter.takeQuota(user.id);
    const now = new Date();
    let data: Awaited<ReturnType<DataExportService['build']>>;
    try {
      data = await this.exporter.build(user.id, now);
    } catch (e) {
      await this.exporter.refundQuota(user.id);
      throw e;
    }
    this.access.record(user.id, 'data_export', req);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${this.exporter.fileName(now)}"`);
    res.setHeader('Cache-Control', 'no-store');
    return JSON.stringify(data, null, 2);
  }

  /** apagar histórico de localização (e, com learnedHome=true, a residência aprendida) */
  @Throttle(STRICT)
  @Delete('location-history')
  forgetLocation(
    @CurrentUser() user: AuthenticatedUser,
    @Query('learnedHome') learnedHome?: string,
  ): Promise<LocationHistoryForgetResponse> {
    return this.locations.forget(user.id, { learnedHome: parseFlag(learnedHome) });
  }
}

/**
 * Cancelar a exclusão (sem sessão: o login respondeu 409 account_deletion_pending com o desafio). Devolve o
 * LoginResponse com tokens e `restored`. 401 deletion_challenge_expired; banida/suspensa: 403 de sempre.
 */
@Controller('auth/deletion')
export class DeletionCancelController {
  constructor(
    private readonly deletions: DeletionStateService,
    private readonly auth: AuthService,
    private readonly access: AccessLogService,
  ) {}

  @Throttle(STRICT)
  @Post('cancel')
  @HttpCode(200)
  async cancel(@Body() dto: DeletionCancelDto, @Req() req: Request): Promise<LoginResponse> {
    const { userId, restored } = await this.deletions.cancelByChallenge(dto.challengeId);
    this.access.record(userId, 'delete_cancel', req);
    const session = await this.auth.openSession(userId);
    this.access.record(userId, 'login', req);
    return { ...session, restored } as unknown as LoginResponse;
  }
}
