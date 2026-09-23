import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { IsArray, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { ReportsService } from './reports.service';

class ReportDto {
  @IsUUID() userId!: string;
  @IsEnum(['harassment', 'fake', 'spam', 'inappropriate', 'other']) reason!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsArray() evidenceUrls?: string[];
}

@UseGuards(JwtAuthGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly svc: ReportsService) {}

  @Post()
  @HttpCode(201)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: ReportDto) {
    return this.svc.create(user.id, dto.userId, {
      reason: dto.reason,
      description: dto.description,
      evidenceUrls: dto.evidenceUrls,
    });
  }
}
