import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString, MaxLength } from 'class-validator';

import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { BlocksService } from '../blocks/blocks.service';
import { UserReportDto } from '../reports/report.dto';
import { REPORT_THROTTLE } from '../reports/reports.controller';
import { ReportsService } from '../reports/reports.service';

class UserBlockDto {
  @IsOptional() @IsString() @MaxLength(255) reason?: string;
}

// Segurança a partir do perfil/conversa: POST /users/:id/block e /users/:id/report. Controller separado do cartão
// público (PublicUsersController, 60/min) pra cada rota ter o próprio limite; só encaminha pros serviços de sempre
// (/blocks e /reports continuam como alias).
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UserSafetyController {
  constructor(
    private readonly blocks: BlocksService,
    private readonly reports: ReportsService,
  ) {}

  @Post(':id/block')
  @HttpCode(201)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  block(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UserBlockDto,
  ) {
    return this.blocks.block(me.id, id, dto.reason);
  }

  @Post(':id/report')
  @HttpCode(201)
  @Throttle(REPORT_THROTTLE)
  report(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UserReportDto,
  ) {
    return this.reports.create(me.id, {
      targetId: id,
      reason: dto.reason,
      description: dto.description,
      block: dto.block,
      context: dto.context,
    });
  }
}
