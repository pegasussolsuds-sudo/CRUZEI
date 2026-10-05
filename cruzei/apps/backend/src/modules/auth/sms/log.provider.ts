import { Logger } from '@nestjs/common';

import { maskPhone } from '../../../common/phone-mask';

import type { SmsMessage, SmsProvider } from './sms-provider';

/**
 * Driver 'log' (dev): não manda SMS, só registra. O código só aparece no log com os atalhos de dev ligados
 * (NODE_ENV=development + DEV_SHORTCUTS=true); o telefone sai mascarado e nunca em produção.
 */
export class LogSmsProvider implements SmsProvider {
  readonly name = 'log' as const;

  constructor(
    private readonly opts: { showCode: boolean; showPhone: boolean },
    private readonly logger = new Logger('SMS'),
  ) {}

  async send(msg: SmsMessage): Promise<void> {
    const to = this.opts.showPhone ? (maskPhone(msg.to) ?? '••••') : 'número oculto';
    this.logger.log(
      this.opts.showCode
        ? `[SMS log] ${to} → código ${msg.code} (atalho de dev)`
        : `[SMS log] código gerado pra ${to} (SMS_DRIVER=log não manda SMS de verdade)`,
    );
  }
}
