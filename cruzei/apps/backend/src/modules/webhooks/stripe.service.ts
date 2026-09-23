import { Injectable } from '@nestjs/common';

// Wrapper pra webhook do Stripe. Stub seguro — não chama API real em dev.
@Injectable()
export class StripeService {
  verify(_payload: string, signature: string, secret: string): boolean {
    // TODO: implementar crypto.createHmac('sha256', secret).update(payload).digest('hex') === signature
    return Boolean(signature && secret);
  }
}
