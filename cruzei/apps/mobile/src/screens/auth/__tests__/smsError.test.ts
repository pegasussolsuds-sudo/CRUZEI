import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('../../../config', () => ({ config: { apiBaseUrl: 'http://teste.local/v1' } }));

import { NETWORK_ERROR_MESSAGE } from '../../../services/api';
import { clock, PHONE_INVALID_TEXT, readSmsError, secondsLeft } from '../smsError';

// Erros do SMS (request-code e login) → texto e espera da tela, com o servidor novo e o antigo.

function http(status: number, data: unknown, headers: Record<string, string> = {}): AxiosError {
  const res = { status, statusText: '', data, headers, config: { headers: new AxiosHeaders() } } as AxiosResponse;
  return new AxiosError(`Request failed with status code ${status}`, AxiosError.ERR_BAD_REQUEST, undefined, {}, res);
}

describe('readSmsError: servidor novo', () => {
  it('cooldown, teto e trava trazem retryAfter (e scope) com o texto do servidor', () => {
    expect(readSmsError(http(429, { error: 'sms_cooldown', message: 'Aguarde 23s antes de pedir outro código', retryAfter: 23 }), 'request')).toMatchObject({
      code: 'sms_cooldown',
      status: 429,
      retryAfter: 23,
    });
    const limit = readSmsError(
      http(429, { error: 'sms_rate_limited', message: 'Esse número já pediu códigos demais. Tenta de novo em 42 min.', retryAfter: 2520, scope: 'phone' }),
      'request',
    );
    expect(limit).toMatchObject({ code: 'sms_rate_limited', retryAfter: 2520, scope: 'phone' });
    expect(limit.message).toBe('Esse número já pediu códigos demais. Tenta de novo em 42 min.');
    const locked = readSmsError(http(429, { error: 'sms_locked', message: 'Muitas tentativas erradas.', retryAfter: 900 }), 'verify');
    expect(locked).toMatchObject({ code: 'sms_locked', retryAfter: 900, attemptsLeft: null, scope: null });
  });

  it('code_invalid com attemptsLeft; code_expired; texto de reserva quando o corpo não tem message', () => {
    expect(readSmsError(http(401, { error: 'code_invalid', message: 'Código errado. Restam 3 tentativas.', attemptsLeft: 3 }), 'verify')).toMatchObject({
      code: 'code_invalid',
      attemptsLeft: 3,
      message: 'Código errado. Restam 3 tentativas.',
    });
    expect(readSmsError(http(401, { error: 'code_expired' }), 'verify').message).toBe('Esse código venceu ou já foi usado. Pede outro.');
    expect(readSmsError(http(400, { error: 'phone_not_mobile' }), 'request').message).toMatch(/fixo/);
  });

  it('retryAfter também sai do header Retry-After', () => {
    expect(readSmsError(http(503, { error: 'sms_unavailable', message: 'x' }, { 'retry-after': '120' }), 'request').retryAfter).toBe(120);
    expect(readSmsError(http(503, { error: 'sms_unavailable', message: 'x' }), 'request').retryAfter).toBeNull();
  });
});

describe('readSmsError: servidor antigo e erros genéricos', () => {
  it("429 'Aguarde Ns' do servidor antigo vira sms_cooldown com a espera", () => {
    const e = readSmsError(http(429, { error: 'too_many_requests', message: 'Aguarde 17s antes de pedir outro código' }), 'request');
    expect(e).toMatchObject({ code: 'sms_cooldown', retryAfter: 17 });
  });

  it('429 do limite por IP da rota mostra o texto do servidor, sem virar cooldown', () => {
    const e = readSmsError(http(429, { error: 'too_many_requests', message: 'Muitas tentativas. Espera um minuto e tenta de novo.' }), 'request');
    expect(e).toMatchObject({ code: 'too_many_requests', message: 'Muitas tentativas. Espera um minuto e tenta de novo.' });
  });

  it('401 genérico no login é código inválido; 400 da validação no request-code é número inválido', () => {
    expect(readSmsError(http(401, { statusCode: 401, message: 'Código inválido ou expirado', error: 'Unauthorized' }), 'verify')).toMatchObject({
      code: 'code_invalid',
      message: 'Código inválido. Tenta de novo?',
    });
    const e = readSmsError(http(400, { statusCode: 400, message: ['phone must be shorter than or equal to 32 characters'], error: 'Bad Request' }), 'request');
    expect(e.message).toBe(PHONE_INVALID_TEXT);
  });

  it('sem rede: texto pt-BR do toApiError e sem status', () => {
    const e = readSmsError(new AxiosError('Network Error', AxiosError.ERR_NETWORK, undefined, {}), 'request');
    expect(e).toMatchObject({ code: 'network_error', message: NETWORK_ERROR_MESSAGE });
    expect(e.status).toBeUndefined();
  });

  it('409 da exclusão pendente passa o texto do servidor', () => {
    const e = readSmsError(http(409, { error: 'account_deletion_pending', message: 'Tua conta tá marcada pra exclusão.' }), 'verify');
    expect(e).toMatchObject({ code: 'account_deletion_pending', status: 409, message: 'Tua conta tá marcada pra exclusão.' });
  });
});

describe('clock e secondsLeft', () => {
  it('segundos, mm:ss e h:mm:ss', () => {
    expect(clock(45)).toBe('45s');
    expect(clock(0)).toBe('0s');
    // 59,2 s arredonda pra 60 → já é minuto
    expect(clock(59.2)).toBe('1:00');
    expect(clock(899)).toBe('14:59');
    expect(clock(3723)).toBe('1:02:03');
  });

  it('secondsLeft arredonda pra cima e nunca fica negativo', () => {
    expect(secondsLeft(null)).toBe(0);
    expect(secondsLeft(10_500, 10_000)).toBe(1);
    expect(secondsLeft(5_000, 10_000)).toBe(0);
  });
});
