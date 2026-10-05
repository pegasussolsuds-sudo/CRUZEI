import type { TwilioConfig } from './sms-config';
import {
  fetchFailure,
  readJson,
  SmsSendError,
  type FetchLike,
  type SmsMessage,
  type SmsProvider,
} from './sms-provider';

/**
 * Códigos da Twilio de número que não recebe (a pessoa precisa trocar o número, não adianta tentar de novo):
 * 21211 'To' inválido, 21217 número não parece válido, 21610 pediu pra parar (STOP), 21612 sem rota,
 * 21614 não é celular.
 */
export const TWILIO_INVALID_NUMBER_CODES: ReadonlySet<number> = new Set([
  21211, 21217, 21610, 21612, 21614,
]);

/** Twilio Programmable Messaging: POST form-urlencoded em Accounts/{SID}/Messages.json (201 = aceito) */
export class TwilioSmsProvider implements SmsProvider {
  readonly name = 'twilio' as const;

  constructor(
    private readonly cfg: TwilioConfig,
    private readonly fetchImpl: FetchLike,
    private readonly timeoutMs: number,
  ) {}

  async send(msg: SmsMessage): Promise<void> {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.cfg.accountSid)}/Messages.json`;
    const form = new URLSearchParams({ To: msg.to, Body: msg.text });
    if (this.cfg.messagingServiceSid) form.set('MessagingServiceSid', this.cfg.messagingServiceSid);
    else if (this.cfg.from) form.set('From', this.cfg.from);
    const auth = Buffer.from(`${this.cfg.accountSid}:${this.cfg.authToken}`).toString('base64');

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: form.toString(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw fetchFailure('twilio', err);
    }
    if (res.ok) {
      // não precisa do corpo (tem o telefone); só libera a conexão
      await res.body?.cancel().catch(() => undefined);
      return;
    }
    // do corpo de erro só o código numérico: a mensagem da Twilio repete o telefone
    const data = await readJson(res);
    const code = Number((data as { code?: unknown } | null)?.code);
    const known = Number.isInteger(code) && code > 0;
    throw new SmsSendError(
      known && TWILIO_INVALID_NUMBER_CODES.has(code) ? 'invalid_number' : 'provider',
      'twilio',
      res.status,
      known ? String(code) : null,
    );
  }
}
