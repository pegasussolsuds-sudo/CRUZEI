// Contrato do provedor de SMS (SMS_DRIVER): log (dev), twilio e zenvia — os dois reais via fetch, sem SDK.
// A escolha do driver fica em create-sms-provider.ts (sem import circular com os drivers).

import type { SmsDriver } from './sms-config';

/** token de injeção do provedor (AuthModule) */
export const SMS_PROVIDER = 'SMS_PROVIDER';

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface SmsMessage {
  /** E.164 (+55…) */
  to: string;
  /** texto final (ASCII, 1 segmento) */
  text: string;
  /** o código puro: só o driver 'log' usa, e só com os atalhos de dev ligados */
  code: string;
}

export interface SmsProvider {
  readonly name: SmsDriver;
  /** resolve quando o provedor aceitou; lança SmsSendError */
  send(msg: SmsMessage): Promise<void>;
}

export type SmsSendErrorKind = 'invalid_number' | 'provider';

/**
 * Falha no envio. Guarda só status HTTP e código do provedor, NUNCA o corpo da resposta: as mensagens de erro da
 * Twilio repetem o telefone (e o nosso texto tem o código). Quem mexer aqui precisa manter essa regra.
 */
export class SmsSendError extends Error {
  constructor(
    readonly kind: SmsSendErrorKind,
    readonly provider: SmsDriver,
    readonly status: number | null = null,
    readonly providerCode: string | null = null,
    readonly reason: 'http' | 'timeout' | 'network' = 'http',
  ) {
    super(
      `SMS ${provider}: ${kind === 'invalid_number' ? 'número recusado' : 'falha no provedor'} (${reason}` +
        `${status ? `, status ${status}` : ''}${providerCode ? `, código ${providerCode}` : ''})`,
    );
    this.name = 'SmsSendError';
  }
}

/**
 * O provedor recusou com certeza (número recusado ou 4xx)? Só aí dá pra devolver a cota e apagar o código.
 * Timeout, rede, 5xx e erro inesperado = incerto: o SMS pode ter saído (e sido cobrado).
 */
export function isExplicitRefusal(err: unknown): boolean {
  if (!(err instanceof SmsSendError)) return false;
  if (err.kind === 'invalid_number') return true;
  return err.reason === 'http' && err.status !== null && err.status >= 400 && err.status < 500;
}

/** erro de rede/timeout do fetch → SmsSendError (sem mensagem crua, que pode ter a URL) */
export function fetchFailure(provider: SmsDriver, err: unknown): SmsSendError {
  const name = (err as { name?: string } | null)?.name;
  return new SmsSendError(
    'provider',
    provider,
    null,
    null,
    name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network',
  );
}

/** lê o corpo como JSON sem estourar (corpo vazio/HTML = null) */
export async function readJson(res: Response): Promise<unknown> {
  try {
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}
