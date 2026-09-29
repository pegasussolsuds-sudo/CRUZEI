import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

import { InboxService } from './inbox.service';

// Aba Mensagens: Principal (/inbox) e Solicitações recebidas (/inbox/requests), por cursor (última mensagem desc).
// Some da lista: conversa arquivada por mim, par com Block (qualquer sentido) e conta do outro apagada/fora de 'active'.
@UseGuards(JwtAuthGuard)
@Controller('inbox')
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  @Get()
  principal(
    @CurrentUser() user: AuthenticatedUser,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.inbox.list(user.id, 'inbox', cursor || undefined, Number(limit) || undefined);
  }

  @Get('requests')
  requests(
    @CurrentUser() user: AuthenticatedUser,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.inbox.list(user.id, 'requests', cursor || undefined, Number(limit) || undefined);
  }

  /** badges da aba (contagem de conversas): unreadInbox, requests, unreadRequests */
  @Get('counts')
  counts(@CurrentUser() user: AuthenticatedUser) {
    return this.inbox.counts(user.id);
  }

  /** "Mover para principal": só quem recebeu; idempotente (200 mesmo já promovida) */
  @Post('requests/:id/promote')
  @HttpCode(200)
  promote(@CurrentUser() user: AuthenticatedUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.inbox.promoteManual(user.id, id);
  }
}
