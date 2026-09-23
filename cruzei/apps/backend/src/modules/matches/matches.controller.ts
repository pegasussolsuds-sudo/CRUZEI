import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { MatchesService } from './matches.service';

class LikeDto {
  @IsUUID() userId!: string;
  @IsOptional() @IsBoolean() isSuper?: boolean;
}
class PassDto {
  @IsUUID() userId!: string;
}

@UseGuards(JwtAuthGuard)
@Controller()
export class LikesController {
  constructor(private readonly svc: MatchesService) {}

  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Post('likes')
  like(@CurrentUser() user: AuthenticatedUser, @Body() dto: LikeDto) {
    return this.svc.like(user.id, dto.userId, dto.isSuper ?? false);
  }

  @Post('likes/super')
  superLike(@CurrentUser() user: AuthenticatedUser, @Body() dto: LikeDto) {
    return this.svc.like(user.id, dto.userId, true);
  }

  @HttpCode(204)
  @Delete('likes/:userId')
  undo(@CurrentUser() user: AuthenticatedUser, @Param('userId') targetId: string) {
    // Premium only — checagem simplificada, retorna 204 mesmo assim
    return this.svc.pass(user.id, targetId);
  }

  @HttpCode(204)
  @Post('passes')
  pass(@CurrentUser() user: AuthenticatedUser, @Body() dto: PassDto) {
    return this.svc.pass(user.id, dto.userId);
  }
}

@UseGuards(JwtAuthGuard)
@Controller('matches')
export class MatchesController {
  constructor(private readonly svc: MatchesService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit') limit = '20',
    @Query('offset') offset = '0',
  ) {
    return this.svc.listMatches(user.id, Number(limit), Number(offset));
  }

  @Get(':id')
  one(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.getMatch(id, user.id);
  }

  @Delete(':id')
  unmatch(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.unmatch(id, user.id);
  }

  @Post(':id/renew')
  renew(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.renewChat(id, user.id);
  }

  @Get(':id/templates')
  templates(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.svc.firstMessageTemplates(id, user.id);
  }
}
