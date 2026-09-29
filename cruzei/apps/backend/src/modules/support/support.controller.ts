import type { SupportSendPayload } from '@cruzei/shared-types';
import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

import { SupportService } from './support.service';

class SendDto implements SupportSendPayload {
  @IsString() @MinLength(1) @MaxLength(2000) body!: string;
  @IsOptional() @IsString() @MaxLength(64) clientId?: string;
}

class RateDto {
  @IsInt() @Min(1) @Max(5) rating!: number;
}

// Suporte ao vivo, lado do app: um atendimento aberto por pessoa; o resto chega pelo socket ('support:message')
@UseGuards(JwtAuthGuard)
@Controller('support')
export class SupportController {
  constructor(private readonly svc: SupportService) {}

  /** SupportThreadResponse: atendimento atual (ou o último encerrado) sem as notas internas */
  @Get('thread')
  thread(@CurrentUser() me: AuthenticatedUser) {
    return this.svc.threadForApp(me.id);
  }

  /** SupportSendResult; abre atendimento se não houver; mesmo clientId = a mesma mensagem; 10/min */
  @Post('messages')
  send(@CurrentUser() me: AuthenticatedUser, @Body() dto: SendDto) {
    return this.svc.sendFromUser(me.id, dto.body, dto.clientId);
  }

  @Post('read')
  @HttpCode(204)
  read(@CurrentUser() me: AuthenticatedUser) {
    return this.svc.readByUser(me.id);
  }

  @Post('thread/rate')
  @HttpCode(200)
  rate(@CurrentUser() me: AuthenticatedUser, @Body() dto: RateDto) {
    return this.svc.rate(me.id, dto.rating);
  }
}
