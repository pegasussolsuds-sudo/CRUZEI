import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { assertPhotoHost } from '../../common/photo-host';

import {
  CreateConversationDto,
  MarkConversationReadDto,
  SendChatMediaDto,
  SendChatMessageDto,
  UpdateConversationDto,
} from './dto';
import { InboxService } from './inbox.service';

// Conversas do par. O chat nunca é bloqueado: qualquer um dos dois
// escreve desde a 1ª mensagem; a pasta (principal/solicitações) só muda ONDE aparece. Não encontrado = 404 idêntico.
@UseGuards(JwtAuthGuard)
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly inbox: InboxService) {}

  /** abre (ou reusa) a conversa do par com a 1ª mensagem; teto de conversas novas/dia fica no service */
  @Post()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateConversationDto) {
    return this.inbox.createConversation(user.id, dto.toUserId, dto.body, dto.clientId);
  }

  /** a conversa do par pro cartão e pro mapa: {conversationId, folder} ou null (JSON explícito, não corpo vazio) */
  @Get('with/:userId')
  async lookup(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Res() res: Response,
  ) {
    res.json(await this.inbox.lookupWith(user.id, userId));
  }

  @Get(':id')
  one(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.inbox.getConversation(user.id, id);
  }

  /** histórico: ?limit (≤ 100) e ?before (id de mensagem ou instante ISO), em ordem crescente */
  @Get(':id/messages')
  messages(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    return this.inbox.listMessages(user.id, id, Number(limit) || undefined, before || undefined);
  }

  /** por remetente 30/min aqui (por token) + contadores no Redis (30/min por remetente, 15/min por par) */
  @Post(':id/messages')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  send(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SendChatMessageDto,
  ) {
    return this.inbox.sendMessage(user.id, id, dto.body, dto.clientId);
  }

  /** mídia: desligada sem CHAT_MEDIA_ENABLED=true (ainda não passa pela moderação de fotos) */
  @Post(':id/media')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  sendMedia(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SendChatMediaDto,
    @Req() req: Request,
  ) {
    // mídia só hospedada pelo Metch (URL de fora vira pixel de rastreio do outro lado)
    assertPhotoHost(dto.mediaUrl, req);
    return this.inbox.sendMedia(user.id, id, dto.type, dto.mediaUrl, dto.clientId);
  }

  @Post(':id/read')
  @HttpCode(200)
  read(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: MarkConversationReadDto,
  ) {
    return this.inbox.markRead(user.id, id, dto.upToMessageId);
  }

  /** silenciar / arquivar ("Arquivar conversa" substitui o "desfazer match") */
  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateConversationDto,
  ) {
    return this.inbox.updateConversation(user.id, id, dto);
  }
}
