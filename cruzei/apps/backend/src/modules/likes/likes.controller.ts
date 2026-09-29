import {
  Body,
  Controller,
  Delete,
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

  @HttpCode(204)
  @Post('passes')
  async pass(@CurrentUser() user: AuthenticatedUser, @Body() dto: PassDto) {
    await this.svc.pass(user.id, dto.userId);
  }
}
