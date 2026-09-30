import { Module } from '@nestjs/common';

import { CleanupTask } from '../../tasks/cleanup.task';
import { PassesCleanupTask } from '../../tasks/passes-cleanup.task';
import { InboxModule } from '../inbox/inbox.module';
import { NotificationsModule } from '../notifications/notifications.module';

import { LikesController } from './likes.controller';
import { LikesService } from './likes.service';

// Curtidas (o Match deixou de existir como estado: a conversa do par vive no InboxModule).
// CleanupTask continua aqui só por onde já era registrado (pausa, retenção de posições).
// PassesCleanupTask: "Passar" vencido e contadores de super curtida velhos.
@Module({
  // NotificationsModule: push de curtida e match (SocialPushService)
  imports: [InboxModule, NotificationsModule],
  controllers: [LikesController],
  providers: [LikesService, CleanupTask, PassesCleanupTask],
  exports: [LikesService],
})
export class LikesModule {}
