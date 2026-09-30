import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

import { LikesService } from './likes.service';

class LikeDto {
  @IsUUID() userId!: string;
  @IsOptional() @IsBoolean() isSuper?: boolean;
}
class PassDto {
  @IsUUID() userId!: string;
}

// Curtidas. A conversa do par vive em /conversations e /inbox.
@UseGuards(JwtAuthGuard)
@Controller()
export class LikesController {
  constructor(private readonly svc: LikesService) {}

  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post('likes')
  like(@CurrentUser() user: AuthenticatedUser, @Body() dto: LikeDto) {
    return this.svc.like(user.id, dto.userId, dto.isSuper ?? false);
  }

  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post('likes/super')
  superLike(@CurrentUser() user: AuthenticatedUser, @Body() dto: LikeDto) {
    return this.svc.like(user.id, dto.userId, true);
  }

  /** desfaz a MINHA curtida (antes só gravava um "pass"); a conversa continua onde está */
  @HttpCode(204)
  @Delete('likes/:userId')
  async undo(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId', new ParseUUIDPipe()) targetId: string,
  ) {
    await this.svc.unlike(user.id, targetId);
  }

  /** SuperLikeQuota: super curtidas que restam hoje (grátis 1, Premium/Premium+ 7; vira à meia-noite de São Paulo) */
  @Get('likes/super/quota')
  superQuota(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.superQuota(user.id);
  }

  /** "Passar": some do MEU deck por DISCOVERY_PASS_DAYS (o mapa continua mostrando). Idempotente: renova o prazo */
  @Throttle({ default: { ttl: 60_000, limit: 120 } })
  @HttpCode(204)
  @Post('passes')
  async pass(@CurrentUser() user: AuthenticatedUser, @Body() dto: PassDto) {
    await this.svc.pass(user.id, dto.userId);
  }

  /** "Voltar": desfaz o passar dessa pessoa se for o meu último e de até 10 min (senão 409 pass_undo_unavailable) */
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @HttpCode(204)
  @Delete('passes/:userId')
  async unpass(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId', new ParseUUIDPipe()) targetId: string,
  ) {
    await this.svc.unpass(user.id, targetId);
  }

  /** MatchCelebration[]: comemorações de match que ainda não apareceram pra mim (quem curtiu primeiro) */
  @Get('likes/matches/pending')
  pendingMatches(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.pendingMatches(user.id);
  }

  /** o app mostrou a comemoração com essa pessoa (idempotente) */
  @HttpCode(204)
  @Post('likes/matches/:userId/seen')
  async matchSeen(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId', new ParseUUIDPipe()) peerId: string,
  ) {
    await this.svc.markMatchSeen(user.id, peerId);
  }
}
