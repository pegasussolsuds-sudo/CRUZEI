import { LogSmsProvider } from './log.provider';
import type { SmsConfig } from './sms-config';
import type { FetchLike, SmsProvider } from './sms-provider';
import { TwilioSmsProvider } from './twilio.provider';
import { ZenviaSmsProvider } from './zenvia.provider';

/** driver da config; o fetch é injetável pros testes */
export function createSmsProvider(cfg: SmsConfig, fetchImpl: FetchLike = fetch): SmsProvider {
  if (cfg.driver === 'twilio' && cfg.twilio)
    return new TwilioSmsProvider(cfg.twilio, fetchImpl, cfg.timeoutMs);
  if (cfg.driver === 'zenvia' && cfg.zenvia)
    return new ZenviaSmsProvider(cfg.zenvia, fetchImpl, cfg.timeoutMs);
  return new LogSmsProvider({ showCode: cfg.devCode, showPhone: cfg.logPhone });
}
