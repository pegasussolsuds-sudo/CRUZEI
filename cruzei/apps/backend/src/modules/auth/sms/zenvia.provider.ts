import type { ZenviaConfig } from './sms-config';
import {
  fetchFailure,
  readJson,
  SmsSendError,
  type FetchLike,
  type SmsMessage,
  type SmsProvider,
} from './sms-provider';

export const ZENVIA_URL = 'https://api.zenvia.com/v2/channels/sms/messages';

interface ZenviaErrorBody {
  code?: unknown;
  details?: Array<{ path?: unknown; code?: unknown }>;
}

/**
 * Zenvia API v2 (canal SMS): POST JSON com X-API-TOKEN. 2xx = aceito. 4xx apontando o campo 'to' = número
 * recusado; o resto é falha do provedor. Do corpo de erro só o código (string curta), nunca a mensagem.
 */
export class ZenviaSmsProvider implements SmsProvider {
  readonly name = 'zenvia' as const;

  constructor(
    private readonly cfg: ZenviaConfig,
    private readonly fetchImpl: FetchLike,
    private readonly timeoutMs: number,
  ) {}

  async send(msg: SmsMessage): Promise<void> {
    let res: Response;
    try {
      res = await this.fetchImpl(ZENVIA_URL, {
        method: 'POST',
        headers: {
          'X-API-TOKEN': this.cfg.apiToken,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          from: this.cfg.from,
          // a Zenvia quer só dígitos, com o 55 e sem o '+'
          to: msg.to.replace(/\D/g, ''),
          contents: [{ type: 'text', text: msg.text }],
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw fetchFailure('zenvia', err);
    }
    if (res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return;
    }
    const data = (await readJson(res)) as ZenviaErrorBody | null;
    const rawCode = typeof data?.code === 'string' ? data.code : null;
    const code = rawCode && /^[A-Z0-9_]{1,40}$/i.test(rawCode) ? rawCode : null;
    const badTo =
      res.status >= 400 &&
      res.status < 500 &&
      Array.isArray(data?.details) &&
      data.details.some((d) => typeof d?.path === 'string' && /(^|\.)to$/.test(d.path));
    throw new SmsSendError(badTo ? 'invalid_number' : 'provider', 'zenvia', res.status, code);
  }
}
