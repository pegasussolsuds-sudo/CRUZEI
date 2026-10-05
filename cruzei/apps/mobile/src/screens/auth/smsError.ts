// Erros do login por SMS (POST /auth/request-code e /auth/login) → o que a tela mostra.
// Contrato: SmsErrorCode em shared-types (api/auth.types.ts). Servidor novo manda texto pt-BR pronto + retryAfter /
// attemptsLeft; servidor antigo só manda 429 "Aguarde Ns…" e 401 genérico — os dois caminhos funcionam.
import axios from 'axios';
import { SMS_ERROR_CODES, type SmsErrorCode, type SmsRateLimitScope } from '@cruzei/shared-types';

import { toApiError } from '../../services/api';

export type SmsStep = 'request' | 'verify';

export interface SmsUiError {
  /** `error` do corpo (SmsErrorCode, account_deletion_pending, network_error…) */
  code: string;
  status?: number;
  /** texto pronto pra tela */
  message: string;
  /** segundos até liberar (429/503); null = sem espera */
  retryAfter: number | null;
  /** só no code_invalid */
  attemptsLeft: number | null;
  /** só no sms_rate_limited */
  scope: SmsRateLimitScope | null;
}

export const PHONE_INVALID_TEXT = 'Esse número não tá certo. É DDD + celular, tipo (34) 99999-9999.';
export const PHONE_NOT_MOBILE_TEXT = 'Esse número parece fixo. O código vai por SMS, então precisa ser celular.';
const REQUEST_FALLBACK = 'Deu ruim pra enviar o código. Tenta de novo?';
const VERIFY_FALLBACK = 'Não deu pra confirmar agora. Tenta de novo em instantes?';

/** texto de reserva por código (o servidor novo sempre manda o dele) */
const FALLBACK: Record<SmsErrorCode, string> = {
  phone_invalid: PHONE_INVALID_TEXT,
  phone_not_mobile: PHONE_NOT_MOBILE_TEXT,
  phone_unreachable: 'Não consegui mandar SMS pra esse número. Confere se é um celular ativo.',
  sms_cooldown: 'Calma, o último código ainda vale. Dá pra pedir outro já já.',
  sms_rate_limited: 'Muitos códigos pedidos. Espera um pouco e tenta de novo.',
  sms_locked: 'Muitas tentativas erradas. Por segurança, espera um pouco e pede um código novo.',
  sms_unavailable: 'Não consegui mandar o SMS agora. Tenta de novo em alguns minutos.',
  code_invalid: 'Código errado. Confere o SMS e tenta de novo.',
  code_expired: 'Esse código venceu ou já foi usado. Pede outro.',
};

const isSmsCode = (c: string): c is SmsErrorCode => (SMS_ERROR_CODES as readonly string[]).includes(c);

const posInt = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v.trim()) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : null;
};

export function readSmsError(err: unknown, step: SmsStep): SmsUiError {
  const api = toApiError(err);
  const res = axios.isAxiosError(err) ? err.response : undefined;
  const data = (res?.data ?? {}) as Record<string, unknown>;
  const status = api.status;
  const serverMsg = typeof data.message === 'string' && data.message.trim() ? data.message.trim() : null;

  // espera: corpo → header Retry-After → "Aguarde Ns" do servidor antigo
  let retryAfter = posInt(data.retryAfter) ?? posInt(res?.headers?.['retry-after']);
  if (retryAfter === null && status === 429 && serverMsg) retryAfter = posInt(/(\d+)\s*s\b/.exec(serverMsg)?.[1]);
  const left = Number(data.attemptsLeft);
  const attemptsLeft = Number.isInteger(left) && left >= 0 ? left : null;
  const scope: SmsRateLimitScope | null = data.scope === 'phone' || data.scope === 'ip' ? data.scope : null;

  let code = api.error;
  // servidor antigo: 429 do cooldown vinha como too_many_requests com "Aguarde Ns antes de pedir outro código"
  if (step === 'request' && status === 429 && !isSmsCode(code) && serverMsg && /^Aguarde \d+\s*s\b/.test(serverMsg)) {
    code = 'sms_cooldown';
  }
  const base = { code, status, retryAfter, attemptsLeft, scope };

  if (isSmsCode(code)) return { ...base, message: serverMsg ?? FALLBACK[code] };
  // sem resposta (rede/timeout): o toApiError já traz o texto pt-BR
  if (!status) return { ...base, message: api.message || (step === 'request' ? REQUEST_FALLBACK : VERIFY_FALLBACK) };
  // 429 do limite por IP da rota (too_many_requests) e o 409 da exclusão pendente já vêm em pt-BR
  if (status === 429 || status === 409) return { ...base, message: serverMsg ?? REQUEST_FALLBACK };
  if (step === 'request') {
    // 400 da validação (class-validator vem em inglês): número fora do formato
    return { ...base, message: status === 400 ? PHONE_INVALID_TEXT : REQUEST_FALLBACK };
  }
  // servidor antigo: 401 genérico "Código inválido ou expirado"
  if (status === 401) return { ...base, code: 'code_invalid', message: 'Código inválido. Tenta de novo?' };
  if (status === 400) return { ...base, message: 'O código tem 6 dígitos. Confere aí?' };
  return { ...base, message: VERIFY_FALLBACK };
}

/** contagem curta pro timer: '45s', '14:59', '1:02:03' */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

/** segundos que faltam até `until` (ms), arredondado pra cima; 0 = liberado */
export function secondsLeft(until: number | null, now = Date.now()): number {
  return until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
}
