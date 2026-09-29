import { Module } from '@nestjs/common';

import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotifyService } from './notify.service';
import { PushService } from './push.service';

// NotifyService é o caminho único de aviso (central + socket + push) pra campanha, suporte, Premium e lugares
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, PushService, NotifyService],
  exports: [NotificationsService, NotifyService, PushService],
})
export class NotificationsModule {}
