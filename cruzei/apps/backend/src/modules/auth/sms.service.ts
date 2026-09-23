import { HttpException, HttpStatus, Injectable, BadRequestException, Logger } from '@nestjs/common';
import * as crypto from 'node:crypto';

import { RedisService } from '../../redis/redis.service';
import { normalizePhoneBR } from '@cruzei/shared-utils';

// 6 dígitos, 5min de validade
const CODE_TTL = 300;
const RESEND_COOLDOWN = 30;

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(private readonly redis: RedisService) {}

  async sendCode(rawPhone: string): Promise<{ sent: boolean; expiresIn: number; devCode?: string }> {
    const phone = normalizePhoneBR(rawPhone);
    if (!phone) throw new BadRequestException('Telefone inválido');

    // Anti-spam: máximo 1 code a cada 30s por telefone
    const lastKey = `sms:last:${phone}`;
    const ttl = await this.redis.client.ttl(lastKey);
    if (ttl > 0) {
      throw new HttpException(
        { error: 'too_many_requests', message: `Aguarde ${ttl}s antes de pedir outro código` },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = String(Math.floor(100_000 + Math.random() * 900_000));
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');

    await this.redis.client.set(`sms:code:${phone}`, codeHash, 'EX', CODE_TTL);
    await this.redis.client.set(lastKey, '1', 'EX', RESEND_COOLDOWN);

    const isDev = (process.env.NODE_ENV ?? 'development') !== 'production';
    // Dev: loga no console e devolve o código na resposta. Prod: chamar Firebase/Twilio.
    this.logger.log(`📱 [SMS DEV] ${phone} → ${code}`);

    return { sent: true, expiresIn: CODE_TTL, ...(isDev ? { devCode: code } : {}) };
  }

  async verifyCode(phone: string, code: string): Promise<boolean> {
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');
    const stored = await this.redis.client.get(`sms:code:${phone}`);
    if (!stored || stored !== codeHash) return false;
    await this.redis.client.del(`sms:code:${phone}`);
    await this.redis.client.del(`sms:last:${phone}`);
    return true;
  }
}
