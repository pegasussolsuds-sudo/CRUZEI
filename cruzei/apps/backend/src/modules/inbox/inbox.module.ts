import { Module } from '@nestjs/common';

import { NotificationsModule } from '../notifications/notifications.module';

import { ConversationsController } from './conversations.controller';
import { InboxController } from './inbox.controller';
import { InboxService } from './inbox.service';

// Conversas (Principal + Solicitações). Prisma, Redis e o ChatGateway vêm dos módulos globais.
// Exporta o InboxService: as curtidas compõem a própria transação com ele (lockPair + onMutualLike) e enviam os
// eventos depois do commit (flush). NotificationsModule: push de mensagem nova (SocialPushService).
@Module({
  imports: [NotificationsModule],
  controllers: [ConversationsController, InboxController],
  providers: [InboxService],
  exports: [InboxService],
})
export class InboxModule {}
