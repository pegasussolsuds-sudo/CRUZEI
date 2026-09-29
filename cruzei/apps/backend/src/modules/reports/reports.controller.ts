import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { ReportDto } from './report.dto';
import { ReportsService } from './reports.service';

/** denunciar é raro: 20 por hora é folga pra quem usa e trava quem tenta inundar a fila (POST /reports e /users/:id/report) */
export const REPORT_THROTTLE = { default: { ttl: 3_600_000, limit: 20 } };

@UseGuards(JwtAuthGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly svc: ReportsService) {}

  @Throttle(REPORT_THROTTLE)
  @Post()
  @HttpCode(201)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: ReportDto) {
    return this.svc.create(user.id, {
      targetId: dto.userId,
      reason: dto.reason,
      description: dto.description,
      block: dto.block,
      context: dto.context,
    });
  }
}
