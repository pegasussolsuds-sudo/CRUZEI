import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { StripeService } from './stripe.service';

@Module({
  controllers: [WebhooksController],
  providers: [StripeService],
})
export class WebhooksModule {}
