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

import { LEGACY_REPORT_SOURCES, type LegacyReportSource } from './report-context';

// DTOs da denúncia: POST /reports (alvo no corpo) e POST /users/:id/report (alvo na rota) validam igual.

export class ReportContextDto {
  /** 'matches' é de build antigo (antes da inbox): o serviço grava como 'inbox' */
  @IsIn([...REPORT_SOURCES, ...LEGACY_REPORT_SOURCES]) source!: ReportSource | LegacyReportSource;
  /** conversa denunciada (a moderação lê as últimas mensagens dela) */
  @IsOptional() @IsUUID() conversationId?: string;
  /** build antigo: id do match = id da conversa (a migração reaproveitou o uuid); gravado como conversationId */
  @IsOptional() @IsUUID() matchId?: string;
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
