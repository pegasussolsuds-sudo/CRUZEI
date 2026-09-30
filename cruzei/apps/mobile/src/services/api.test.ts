import { AxiosError, AxiosHeaders, CanceledError, type AxiosResponse } from 'axios';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('../config', () => ({ config: { apiBaseUrl: 'http://teste.local/v1' } }));

import { NETWORK_ERROR_MESSAGE, TIMEOUT_ERROR_MESSAGE, toApiError } from './api';

function withResponse(status: number, data: unknown): AxiosError {
  const res = { status, statusText: '', data, headers: {}, config: { headers: new AxiosHeaders() } } as AxiosResponse;
  return new AxiosError(`Request failed with status code ${status}`, AxiosError.ERR_BAD_REQUEST, undefined, {}, res);
}

describe('toApiError: sem resposta do servidor', () => {
  it('falha de rede vira texto em português, sem status', () => {
    const e = toApiError(new AxiosError('Network Error', AxiosError.ERR_NETWORK, undefined, {}));
    expect(e).toEqual({ error: 'network_error', message: NETWORK_ERROR_MESSAGE });
    expect(e.message).toBe('Sem conexão com o servidor. Tenta de novo.');
    // as telas usam !status pra reconhecer falta de rede
    expect(e.status).toBeUndefined();
  });

  it('timeout do axios (ECONNABORTED) tem texto próprio', () => {
    const e = toApiError(new AxiosError('timeout of 15000ms exceeded', AxiosError.ECONNABORTED, undefined, {}));
    expect(e).toEqual({ error: 'timeout', message: TIMEOUT_ERROR_MESSAGE });
  });

  it('ETIMEDOUT (clarifyTimeoutError) também é timeout', () => {
    expect(toApiError(new AxiosError('timeout exceeded', AxiosError.ETIMEDOUT)).error).toBe('timeout');
  });

  it('ECONNABORTED sem "timeout" (requisição abortada) cai no texto de rede', () => {
    expect(toApiError(new AxiosError('Request aborted', AxiosError.ECONNABORTED, undefined, {})).message).toBe(NETWORK_ERROR_MESSAGE);
  });

  it('cancelada não finge falta de rede', () => {
    const e = toApiError(new CanceledError());
    expect(e.error).toBe('canceled');
    expect(e.message).not.toBe(NETWORK_ERROR_MESSAGE);
  });

  it('nunca devolve o inglês cru do axios', () => {
    for (const err of [
      new AxiosError('Network Error', AxiosError.ERR_NETWORK),
      new AxiosError('timeout of 15000ms exceeded', AxiosError.ECONNABORTED),
    ]) {
      expect(toApiError(err).message).not.toMatch(/network error|timeout of/i);
    }
  });
});

describe('toApiError: com resposta (sem mudança)', () => {
  it('usa error/message do corpo e o status', () => {
    expect(toApiError(withResponse(403, { error: 'anonymous_requires_premium', message: 'Só no Premium' }))).toEqual({
      error: 'anonymous_requires_premium',
      message: 'Só no Premium',
      status: 403,
    });
  });

  it('junta a lista de mensagens da validação', () => {
    expect(toApiError(withResponse(400, { message: ['nome curto', 'idade inválida'] })).message).toBe('nome curto, idade inválida');
  });

  it('corpo sem message mantém o texto do axios (o rateLimitText do chat reconhece "status code 429")', () => {
    const e = toApiError(withResponse(429, {}));
    expect(e).toEqual({ error: 'http_error', message: 'Request failed with status code 429', status: 429 });
  });
});

describe('toApiError: erro que não é do axios', () => {
  it('vira unknown com o texto do erro', () => {
    expect(toApiError(new Error('quebrou'))).toEqual({ error: 'unknown', message: 'Error: quebrou' });
  });
});
