import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminController } from './admin.controller';
import { ModerationService } from './moderation.service';
import { PhotoModerationService } from './photo-moderation.service';
import { ModerationTask } from './moderation.task';

@Module({
  imports: [NotificationsModule],
  controllers: [AdminController],
  providers: [ModerationService, PhotoModerationService, ModerationTask],
  exports: [ModerationService, PhotoModerationService],
})
export class ModerationModule {}
