import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsObject, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { REPORT_REASONS, type ReportReason, type ReportSource } from '@cruzei/shared-types';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { ReportsService } from './reports.service';

class ReportContextDto {
  @IsIn(['profile', 'chat', 'matches', 'map', 'likes']) source!: ReportSource;
  @IsOptional() @IsUUID() matchId?: string;
  @IsOptional() @IsUUID() messageId?: string;
  @IsOptional() @IsUUID() photoId?: string;
}

class ReportDto {
  @IsUUID() userId!: string;
  @IsIn(REPORT_REASONS as unknown as string[]) reason!: ReportReason;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  /** bloqueia junto (o app manda true por padrão) */
  @IsOptional() @IsBoolean() block?: boolean;
  @IsOptional() @IsObject() @ValidateNested() @Type(() => ReportContextDto) context?: ReportContextDto;
}

@UseGuards(JwtAuthGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly svc: ReportsService) {}

  // denunciar é raro: 20 por hora é folga pra quem usa e trava quem tenta inundar a fila
  @Throttle({ default: { ttl: 3_600_000, limit: 20 } })
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
