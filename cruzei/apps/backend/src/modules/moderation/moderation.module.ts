import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { ModerationService } from './moderation.service';
import { PhotoModerationService } from './photo-moderation.service';
import { ModerationTask } from './moderation.task';

@Module({
  controllers: [AdminController],
  providers: [ModerationService, PhotoModerationService, ModerationTask],
  exports: [ModerationService, PhotoModerationService],
})
export class ModerationModule {}
