import { Module } from '@nestjs/common';

import { CleanupTask } from '../../tasks/cleanup.task';
import { InboxModule } from '../inbox/inbox.module';
import { NotificationsModule } from '../notifications/notifications.module';

import { LikesController } from './likes.controller';
import { LikesService } from './likes.service';

// Curtidas (o Match deixou de existir como estado: a conversa do par vive no InboxModule).
// CleanupTask continua aqui só por onde já era registrado (pausa, retenção de posições).
@Module({
  // NotificationsModule: push de curtida e match (SocialPushService)
  imports: [InboxModule, NotificationsModule],
  controllers: [LikesController],
  providers: [LikesService, CleanupTask],
  exports: [LikesService],
})
export class LikesModule {}
