// Cliente HTTP do painel: Bearer em memória, 1 refresh automático no 401 (compartilhado entre pedidos
// simultâneos) e erro com a mensagem pt-BR que o backend já manda.
import type { RefreshResponse } from '@cruzei/shared-types';
import { buildQuery, messageFromBody, refreshOutcome, type QueryParams } from '@/lib/query';
import { session } from './session';

/** vazio em dev (proxy do Vite); em produção pode apontar pra API em outro domínio */
const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN ?? '').replace(/\/$/, '');
export const API_BASE = `${API_ORIGIN}/v1`;
export const SOCKET_ORIGIN = API_ORIGIN || window.location.origin;

export class HttpError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly retryAfter: number | null;
  readonly body: unknown;

  constructor(status: number, message: string, code: string | null = null, retryAfter: number | null = null, body: unknown = null) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
    this.body = body;
  }
}

export function isHttpError(e: unknown, status?: number): e is HttpError {
  return e instanceof HttpError && (status === undefined || e.status === status);
}

/** texto pra mostrar na tela a partir de qualquer erro */
export function errorMessage(e: unknown, fallback = 'Algo deu errado. Tenta de novo.'): string {
  if (e instanceof HttpError) return e.message;
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface RequestOptions {
  method?: Method;
  body?: unknown;
  query?: QueryParams;
  /** false: rota pública (login/código) — sem Bearer e sem refresh no 401 */
  auth?: boolean;
  signal?: AbortSignal;
}

export const OFFLINE_MESSAGE = 'Sem conexão com o servidor. Confere se a API está no ar.';

const DEFAULT_MESSAGES: Record<number, string> = {
  400: 'Confere os dados e tenta de novo.',
  401: 'Sua sessão expirou. Entre de novo.',
  403: 'Você não tem permissão pra isso.',
  404: 'Não encontrado. Pode ter sido apagado.',
  409: 'Alguém mexeu nisso agora há pouco. Atualiza e tenta de novo.',
  413: 'Conteúdo grande demais.',
  429: 'Muitas tentativas seguidas. Espera um pouquinho.',
};

async function send(path: string, opts: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const token = session.getAccessToken();
  if (opts.auth !== false && token) headers.Authorization = `Bearer ${token}`;
  try {
    return await fetch(`${API_BASE}${path}${buildQuery(opts.query)}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new HttpError(0, OFFLINE_MESSAGE);
  }
}

async function toError(res: Response): Promise<HttpError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const b = (body ?? {}) as { error?: unknown; retryAfter?: unknown };
  const message =
    res.status >= 500 ? 'O servidor teve um problema. Tenta de novo em instantes.' : (messageFromBody(body) ?? DEFAULT_MESSAGES[res.status] ?? `Erro ${res.status}`);
  return new HttpError(
    res.status,
    message,
    typeof b.error === 'string' ? b.error : null,
    typeof b.retryAfter === 'number' ? b.retryAfter : null,
    body,
  );
}

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** renovação: 'ok'; 'denied' = sessão encerrada (401/403); 'unavailable' = sem rede/servidor fora (a sessão fica) */
export type RenewResult = { kind: 'ok' } | { kind: 'denied' } | { kind: 'unavailable'; error: HttpError };

let renewing: Promise<RenewResult> | null = null;

/** troca o refresh token por um access novo; um só pedido mesmo com várias chamadas ao mesmo tempo */
export function renewSession(): Promise<RenewResult> {
  renewing ??= doRefresh().finally(() => {
    renewing = null;
  });
  return renewing;
}

/** atalho pra quem só quer saber se deu certo (socket) */
export async function refreshAccessToken(): Promise<boolean> {
  return (await renewSession()).kind === 'ok';
}

async function doRefresh(): Promise<RenewResult> {
  const refreshToken = session.getRefreshToken();
  if (!refreshToken) return { kind: 'denied' };
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    // sem rede: não derruba a sessão, o próximo pedido tenta de novo
    return { kind: 'unavailable', error: new HttpError(0, OFFLINE_MESSAGE) };
  }
  const outcome = refreshOutcome(res.status);
  if (outcome === 'ok') {
    const data = (await res.json()) as RefreshResponse;
    session.setTokens(data.token, data.refreshToken);
    return { kind: 'ok' };
  }
  const err = await toError(res);
  if (outcome === 'unavailable') return { kind: 'unavailable', error: err }; // 5xx, 429…: a sessão continua
  // 403 aqui = conta suspensa/banida (a mensagem do servidor explica)
  session.end(res.status === 403 ? err.message : 'Sua sessão expirou. Entre de novo.');
  return { kind: 'denied' };
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const res = await send(path, opts);
  if (res.status === 401 && opts.auth !== false) {
    if (!session.getRefreshToken()) {
      session.end('Sua sessão expirou. Entre de novo.');
      return parse<T>(res);
    }
    const r = await renewSession();
    if (r.kind === 'ok') return parse<T>(await send(path, opts));
    // servidor fora na hora de renovar: o erro é "sem conexão", não "sessão expirou" (e a sessão fica)
    if (r.kind === 'unavailable') throw r.error;
  }
  return parse<T>(res);
}
