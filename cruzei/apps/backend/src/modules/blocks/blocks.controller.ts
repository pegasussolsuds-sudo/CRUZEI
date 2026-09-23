import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, IsUUID } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { BlocksService } from './blocks.service';

class BlockDto {
  @IsUUID() userId!: string;
  @IsOptional() @IsString() reason?: string;
}

@UseGuards(JwtAuthGuard)
@Controller('blocks')
export class BlocksController {
  constructor(private readonly svc: BlocksService) {}

  @Post()
  @HttpCode(201)
  block(@CurrentUser() user: AuthenticatedUser, @Body() dto: BlockDto) {
    return this.svc.block(user.id, dto.userId, dto.reason);
  }

  @Delete(':userId')
  unblock(@CurrentUser() user: AuthenticatedUser, @Param('userId') targetId: string) {
    return this.svc.unblock(user.id, targetId);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.svc.list(user.id);
  }
}
