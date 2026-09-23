import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { StripeService } from './stripe.service';

// Endpoint público (sem JWT) — recebe eventos do Stripe/Apple/Google.
// Assinatura validada por header.
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly stripe: StripeService) {}

  @Post('stripe')
  @HttpCode(200)
  stripeWebhook(
    @Body() payload: unknown,
    @Headers('stripe-signature') signature: string,
  ) {
    const secret = process.env.STRIPE_WEBHOOK_SECRET ?? '';
    const isValid = this.stripe.verify(
      typeof payload === 'string' ? payload : JSON.stringify(payload),
      signature,
      secret,
    );
    if (!isValid) return { received: false };
    // TODO: processar eventos (invoice.paid, customer.subscription.deleted etc.)
    return { received: true };
  }

  @Post('apple')
  @HttpCode(200)
  appleWebhook(@Body() _payload: unknown) {
    // TODO: validar App Store Server Notifications
    return { received: true };
  }

  @Post('google')
  @HttpCode(200)
  googleWebhook(@Body() _payload: unknown) {
    // TODO: validar Real-Time Developer Notifications
    return { received: true };
  }
}
