// Erros do login por SMS (contrato: SmsErrorCode em shared-types/api/auth.types.ts). Textos pt-BR no tom do app,
// com a espera legível; retryAfter em segundos no corpo (e no header Retry-After, pelo withRetryAfter).

import type {
  CodeInvalidError,
  SmsErrorCode,
  SmsRateLimitScope,
  SmsRetryError,
} from '@cruzei/shared-types';
import { HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';

import { humanWait } from './sms-limits';

interface SmsErrorBody {
  error: SmsErrorCode;
  message: string;
  retryAfter?: number;
}

const httpError = (body: object, status: HttpStatus) => new HttpException(body, status);
const secs = (n: number) => Math.max(1, Math.ceil(n));

export const PHONE_INVALID_MESSAGE =
  'Esse número não tá certo. É DDD + celular, tipo (34) 99999-9999.';

export function phoneInvalid(): HttpException {
  const body: SmsErrorBody = { error: 'phone_invalid', message: PHONE_INVALID_MESSAGE };
  return httpError(body, HttpStatus.BAD_REQUEST);
}

export function phoneNotMobile(): HttpException {
  const body: SmsErrorBody = {
    error: 'phone_not_mobile',
    message: 'Esse número parece fixo. O código vai por SMS, então precisa ser celular.',
  };
  return httpError(body, HttpStatus.BAD_REQUEST);
}

export function phoneUnreachable(): HttpException {
  const body: SmsErrorBody = {
    error: 'phone_unreachable',
    message: 'Não consegui mandar SMS pra esse número. Confere se é um celular ativo.',
  };
  return httpError(body, HttpStatus.BAD_REQUEST);
}

/** 'Aguarde Ns' fica nesse formato: o painel e o app antigo tiram a espera do texto com /(\d+)\s*s/ */
export function smsCooldown(retryAfter: number): HttpException {
  const s = secs(retryAfter);
  const body: SmsRetryError = {
    error: 'sms_cooldown',
    message: `Aguarde ${s}s antes de pedir outro código`,
    retryAfter: s,
  };
  return httpError(body, HttpStatus.TOO_MANY_REQUESTS);
}

export function smsRateLimited(scope: SmsRateLimitScope, retryAfter: number): HttpException {
  const s = secs(retryAfter);
  const body: SmsRetryError = {
    error: 'sms_rate_limited',
    message:
      scope === 'phone'
        ? `Esse número já pediu códigos demais. Tenta de novo em ${humanWait(s)}.`
        : `Muitos códigos pedidos desta conexão. Tenta de novo em ${humanWait(s)}.`,
    retryAfter: s,
    scope,
  };
  return httpError(body, HttpStatus.TOO_MANY_REQUESTS);
}

export function smsLocked(retryAfter: number): HttpException {
  const s = secs(retryAfter);
  const body: SmsRetryError = {
    error: 'sms_locked',
    message: `Muitas tentativas erradas. Por segurança, espera ${humanWait(s)} e pede um código novo.`,
    retryAfter: s,
  };
  return httpError(body, HttpStatus.TOO_MANY_REQUESTS);
}

/** provedor fora do ar ou teto global da hora (timeout do provedor ainda conta na cota: o SMS pode ter saído) */
export function smsUnavailable(retryAfter?: number): HttpException {
  const body: SmsErrorBody = {
    error: 'sms_unavailable',
    message: 'Não consegui mandar o SMS agora. Tenta de novo em alguns minutos.',
    ...(retryAfter ? { retryAfter: secs(retryAfter) } : {}),
  };
  return httpError(body, HttpStatus.SERVICE_UNAVAILABLE);
}

export function codeInvalid(attemptsLeft: number, lockS: number): HttpException {
  const body: CodeInvalidError = {
    error: 'code_invalid',
    message:
      attemptsLeft <= 1
        ? `Código errado. Última tentativa antes de uma pausa de ${humanWait(lockS)}.`
        : `Código errado. Restam ${attemptsLeft} tentativas.`,
    attemptsLeft,
  };
  return httpError(body, HttpStatus.UNAUTHORIZED);
}

export function codeExpired(): HttpException {
  const body: SmsErrorBody = {
    error: 'code_expired',
    message: 'Esse código venceu ou já foi usado. Pede outro.',
  };
  return httpError(body, HttpStatus.UNAUTHORIZED);
}

/** segundos de espera de um erro com retryAfter no corpo (null = sem) */
export function retryAfterOf(err: unknown): number | null {
  if (!(err instanceof HttpException)) return null;
  const body = err.getResponse();
  const n =
    typeof body === 'object' && body ? Number((body as { retryAfter?: unknown }).retryAfter) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : null;
}

/** roda a rota e, se ela falhar com espera (429/503), manda também o header Retry-After */
export async function withRetryAfter<T>(
  res: Pick<Response, 'setHeader'> | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const s = retryAfterOf(err);
    if (s && res) res.setHeader('Retry-After', String(s));
    throw err;
  }
}
