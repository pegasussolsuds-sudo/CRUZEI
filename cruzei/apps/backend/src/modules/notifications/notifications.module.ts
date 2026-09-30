import { BullModule } from '@nestjs/bull';
import { Module } from '@nestjs/common';

import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotifyService } from './notify.service';
import { PushService } from './push.service';
import { SocialPushProcessor } from './social-push.processor';
import { SOCIAL_PUSH_QUEUE } from './social-push.queue';
import { SocialPushService } from './social-push.service';

// NotifyService é o caminho único de aviso DA CENTRAL (central + socket + push) pra campanha, suporte, Premium e
// lugares. Push social (mensagem, curtida, match) é só push e vai pelo SocialPushService (inbox e curtidas usam).
// Só importa a fila do Bull (envio das curtidas no fim da espera): InboxModule e LikesModule importam este sem ciclo.
@Module({
  imports: [BullModule.registerQueue({ name: SOCIAL_PUSH_QUEUE })],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    PushService,
    NotifyService,
    SocialPushService,
    SocialPushProcessor,
  ],
  exports: [NotificationsService, NotifyService, PushService, SocialPushService],
})
export class NotificationsModule {}
