import { Module } from '@nestjs/common';

import { ConversationsController } from './conversations.controller';
import { InboxController } from './inbox.controller';
import { InboxService } from './inbox.service';

// Conversas (Principal + Solicitações). Prisma, Redis e o ChatGateway vêm dos módulos globais.
// Exporta o InboxService: as curtidas compõem a própria transação com ele (lockPair + onMutualLike) e enviam os
// eventos depois do commit (flush).
@Module({
  controllers: [ConversationsController, InboxController],
  providers: [InboxService],
  exports: [InboxService],
})
export class InboxModule {}
