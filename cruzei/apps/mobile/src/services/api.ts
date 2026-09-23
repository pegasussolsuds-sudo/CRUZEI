import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import * as SecureStore from 'expo-secure-store';
import { config } from '../config';

const TOKEN_KEY = 'cruzei.token';
const REFRESH_KEY = 'cruzei.refresh';

let inMemoryToken: string | null | undefined; // undefined = ainda não lido do SecureStore
let refreshing: Promise<string | null> | null = null;
let onUnauthorized: (() => void) | null = null;

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

    if (err.response?.status === 401 && original && !original._retry && !isAuthRoute) {
      original._retry = true;
      const newToken = await refreshAccessToken();
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

// Refresh único mesmo com várias requisições 401 simultâneas
async function refreshAccessToken(): Promise<string | null> {
  if (!refreshing) {
    refreshing = (async () => {
      const rt = await getRefreshToken();
      if (!rt) return null;
      try {
        const res = await axios.post(`${config.apiBaseUrl}/auth/refresh`, { refreshToken: rt }, { timeout: 10_000 });
        await setToken(res.data.token);
        await setRefreshToken(res.data.refreshToken);
        return res.data.token as string;
      } catch {
        return null;
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
