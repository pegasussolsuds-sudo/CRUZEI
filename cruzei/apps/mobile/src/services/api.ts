import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import * as SecureStore from 'expo-secure-store';
import { config } from '../config';

const TOKEN_KEY = 'cruzei.token';
const REFRESH_KEY = 'cruzei.refresh';

let inMemoryToken: string | null | undefined; // undefined = ainda não lido do SecureStore
let refreshing: Promise<string | null> | null = null;
let onUnauthorized: (() => void) | null = null;
let onAccountBlocked: ((data: unknown) => boolean) | null = null;

/** 403 de conta suspensa/banida (qualquer rota, inclusive login/refresh): o store decide se é bloqueio de conta */
export function setAccountBlockedHandler(fn: ((data: unknown) => boolean) | null) {
  onAccountBlocked = fn;
}

/** o socket também recebe o bloqueio (connect_error / account_blocked): mesmo destino */
export function reportAccountBlocked(data: unknown): boolean {
  return onAccountBlocked?.(data) ?? false;
}

// Chamado pelo auth store: quando o refresh falha, derruba a sessão na UI.
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

export async function setToken(token: string | null) {
  inMemoryToken = token;
  try {
    if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    /* SecureStore indisponível (ex.: emulador sem keystore) — fica só em memória */
  }
}

export async function getToken(): Promise<string | null> {
  if (inMemoryToken !== undefined) return inMemoryToken;
  try {
    inMemoryToken = await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    inMemoryToken = null;
  }
  return inMemoryToken;
}

export async function getRefreshToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(REFRESH_KEY);
  } catch {
    return null;
  }
}

export async function setRefreshToken(token: string | null) {
  try {
    if (token) await SecureStore.setItemAsync(REFRESH_KEY, token);
    else await SecureStore.deleteItemAsync(REFRESH_KEY);
  } catch {
    /* idem */
  }
}

export async function clearSession() {
  await setToken(null);
  await setRefreshToken(null);
}

export const api: AxiosInstance = axios.create({
  baseURL: config.apiBaseUrl,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use(async (cfg) => {
  const token = await getToken();
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

type RetryConfig = InternalAxiosRequestConfig & { _retry?: boolean };

api.interceptors.response.use(
  (r) => r,
  async (err: AxiosError) => {
    const original = err.config as RetryConfig | undefined;
    const isAuthRoute = original?.url?.includes('/auth/') ?? false;

    // conta suspensa/banida: a tela de aviso assume (não adianta renovar token)
    if (err.response?.status === 403 && onAccountBlocked?.(err.response.data)) return Promise.reject(err);

    if (err.response?.status === 401 && original && !original._retry && !isAuthRoute) {
      original._retry = true;
      let newToken: string | null;
      try {
        newToken = await refreshAccessToken();
      } catch (refreshErr) {
        // refresh falhou por rede/timeout/5xx: falha só esta requisição, a sessão continua.
        // rejeita com o erro do refresh (não o 401 original): hydrate()/verifyCode() tratam 401 como sessão inválida
        return Promise.reject(refreshErr);
      }
      if (newToken) {
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      }
      await clearSession();
      onUnauthorized?.();
    }
    return Promise.reject(err);
  },
);

// Refresh único mesmo com várias requisições 401 simultâneas.
// null = sessão inválida (sem refresh token ou servidor recusou); lança em erro transitório (rede/timeout/5xx).
export async function refreshAccessToken(): Promise<string | null> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        // dentro do try: o finally precisa zerar `refreshing` também quando não há refresh token
        const rt = await getRefreshToken();
        if (!rt) return null;
        const res = await axios.post(`${config.apiBaseUrl}/auth/refresh`, { refreshToken: rt }, { timeout: 10_000 });
        await setToken(res.data.token);
        await setRefreshToken(res.data.refreshToken);
        return res.data.token as string;
      } catch (e) {
        const status = axios.isAxiosError(e) ? e.response?.status : undefined;
        if (status === 403 && axios.isAxiosError(e)) onAccountBlocked?.(e.response?.data);
        // 400/401/403 = servidor recusou o refresh token de fato
        if (status === 400 || status === 401 || status === 403) return null;
        throw e;
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

export interface ApiError {
  error: string;
  message: string;
  status?: number;
}

export function toApiError(err: unknown): ApiError {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as Partial<ApiError & { message: string | string[] }> | undefined;
    const msg = Array.isArray(data?.message) ? data?.message.join(', ') : data?.message;
    return {
      error: data?.error ?? 'http_error',
      message: msg ?? err.message,
      status: err.response?.status,
    };
  }
  return { error: 'unknown', message: String(err) };
}
