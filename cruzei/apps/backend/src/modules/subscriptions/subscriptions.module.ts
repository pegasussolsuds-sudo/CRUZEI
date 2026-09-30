import { Module } from '@nestjs/common';

import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';

import { PremiumLifecycleService } from './premium-lifecycle.service';
import { PremiumTask } from './premium.task';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

// Premium: planos, assinatura, teste grátis e o ciclo de vida (rebaixa quem venceu, fim do invisível grátis).
// UsersModule: avatar volta pros itens free; NotificationsModule: avisos 'premium_expired'/'anonymous_expired'.
@Module({
  imports: [UsersModule, NotificationsModule],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService, PremiumLifecycleService, PremiumTask],
  exports: [SubscriptionsService, PremiumLifecycleService],
})
export class SubscriptionsModule {}
