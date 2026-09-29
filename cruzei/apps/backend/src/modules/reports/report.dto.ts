import {
  REPORT_REASONS,
  REPORT_SOURCES,
  type ReportReason,
  type ReportSource,
} from '@cruzei/shared-types';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

// DTOs da denúncia: POST /reports (alvo no corpo) e POST /users/:id/report (alvo na rota) validam igual.

export class ReportContextDto {
  @IsIn(REPORT_SOURCES as unknown as string[]) source!: ReportSource;
  /** conversa denunciada (a moderação lê as últimas mensagens dela) */
  @IsOptional() @IsUUID() conversationId?: string;
  @IsOptional() @IsUUID() messageId?: string;
  @IsOptional() @IsUUID() photoId?: string;
}

/** corpo do POST /users/:id/report */
export class UserReportDto {
  @IsIn(REPORT_REASONS as unknown as string[]) reason!: ReportReason;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  /** bloqueia junto (o app manda true por padrão) */
  @IsOptional() @IsBoolean() block?: boolean;
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ReportContextDto)
  context?: ReportContextDto;
}

/** corpo do POST /reports */
export class ReportDto extends UserReportDto {
  @IsUUID() userId!: string;
}
