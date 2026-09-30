import type { StaffSupportSendPayload, SupportThreadStatus } from '@cruzei/shared-types';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RequirePermission, StaffGuard } from '../admin/staff.guard';

import { SupportService } from './support.service';

class StaffSendDto implements StaffSupportSendPayload {
  @IsString() @MinLength(1) @MaxLength(2000) body!: string;
  @IsOptional() @IsBoolean() internal?: boolean;
  @IsOptional() @IsString() @MaxLength(64) clientId?: string;
}

class AssignDto {
  /** null = sem responsável */
  @ValidateIf((o: AssignDto) => o.userId !== null)
  @IsUUID()
  userId!: string | null;
}

class StatusDto {
  @IsIn(['open', 'pending', 'resolved']) status!: SupportThreadStatus;
}

// Suporte ao vivo, lado da equipe (admin e moderador)
@UseGuards(JwtAuthGuard, StaffGuard)
@RequirePermission('support')
@Controller('admin/support/threads')
export class AdminSupportController {
  constructor(private readonly svc: SupportService) {}

  /**
   * SupportThreadList: ?status=open|pending|resolved|all (padrão: não resolvidos) &mine=1 &cursor=
   * &order=oldest (quem espera há mais tempo primeiro; padrão: última mensagem mais recente) &urgent=1 (só urgentes).
   * URGENTES não resolvidos (botão de emergência) vêm sempre no topo da 1ª página.
   */
  @Get()
  list(
    @CurrentUser() me: AuthenticatedUser,
    @Query('status') status?: string,
    @Query('mine') mine?: string,
    @Query('order') order?: string,
    @Query('urgent') urgent?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.svc.listThreads(me, { status, mine, order, urgent, cursor, limit });
  }

  @Get(':id')
  detail(@CurrentUser() me: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.threadDetail(me, id);
  }

  @Post(':id/messages')
  send(
    @CurrentUser() me: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StaffSendDto,
  ) {
    return this.svc.sendFromStaff(me, id, dto);
  }

  @Post(':id/assign')
  @HttpCode(200)
  assign(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignDto) {
    return this.svc.assign(id, dto.userId ?? null);
  }

  @Post(':id/status')
  @HttpCode(200)
  status(@Param('id', ParseUUIDPipe) id: string, @Body() dto: StatusDto) {
    return this.svc.setStatus(id, dto.status);
  }

  @Post(':id/read')
  @HttpCode(200)
  read(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.readByStaff(id);
  }
}
