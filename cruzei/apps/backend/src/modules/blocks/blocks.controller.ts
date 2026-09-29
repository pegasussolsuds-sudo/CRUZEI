import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { BlocksService } from './blocks.service';

class BlockDto {
  @IsUUID() userId!: string;
  @IsOptional() @IsString() @MaxLength(255) reason?: string;
}

// POST /blocks é alias de POST /users/:id/block (mesmo serviço, mesmo limite); a lista e o desbloqueio ficam aqui
@UseGuards(JwtAuthGuard)
@Controller('blocks')
export class BlocksController {
  constructor(private readonly svc: BlocksService) {}

  @Post()
  @HttpCode(201)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  block(@CurrentUser() user: AuthenticatedUser, @Body() dto: BlockDto) {
    return this.svc.block(user.id, dto.userId, dto.reason);
  }

  @Delete(':userId')
  unblock(@CurrentUser() user: AuthenticatedUser, @Param('userId', ParseUUIDPipe) targetId: string) {
    return this.svc.unblock(user.id, targetId);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.list(user.id);
  }
}
