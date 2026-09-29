// Estado de login do painel. Entra com o mesmo telefone + código do app; só fica quem o /admin/me aceita.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AdminMe } from '@cruzei/shared-types';
import { adminApi, authApi } from '@/api/admin';
import { HttpError, isHttpError, renewSession } from '@/api/http';
import { session } from '@/api/session';

export const NO_ACCESS_MESSAGE = 'Essa conta não tem acesso ao painel.';

/** offline: tenta retomar a sessão sozinho nesse intervalo (servidor reiniciando num deploy) */
const OFFLINE_RETRY_MS = 8_000;

/** offline: há sessão salva, mas o servidor não respondeu (sem rede, 5xx…) — a sessão fica e dá pra tentar de novo */
type Status = 'loading' | 'anonymous' | 'authenticated' | 'offline';

interface AuthState {
  status: Status;
  me: AdminMe | null;
  /** aviso pra tela de login (sessão expirou, conta sem acesso…) ou motivo do offline */
  notice: string | null;
}

interface AuthContextValue extends AuthState {
  login: (phone: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  clearNotice: () => void;
  /** offline: tenta retomar a sessão salva */
  retry: () => void;
}

/** erro que não é da sessão (rede, servidor fora): não apaga o refresh token */
function isOutage(e: unknown): e is HttpError {
  return isHttpError(e) && (e.status === 0 || e.status === 429 || e.status >= 500);
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>(() => ({
    status: session.getRefreshToken() ? 'loading' : 'anonymous',
    me: null,
    notice: null,
  }));

  // aba recarregada: o access token sumiu da memória, o refresh da aba traz a sessão de volta.
  // Só 401/403 encerram; sem rede ou servidor fora, a sessão fica (tela "sem conexão" com "tentar de novo")
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!session.getRefreshToken()) return;
    let alive = true;
    (async () => {
      try {
        const r = await renewSession();
        if (r.kind === 'unavailable') throw r.error;
        if (r.kind === 'denied') throw new HttpError(401, 'Sua sessão expirou. Entre de novo.');
        const me = await adminApi.me();
        if (alive) setState({ status: 'authenticated', me, notice: null });
      } catch (e) {
        if (!alive) return;
        if (isOutage(e)) {
          setState({ status: 'offline', me: null, notice: e.message });
          return;
        }
        session.clear();
        setState((s) => ({
          status: 'anonymous',
          me: null,
          // refresh recusado: o session.end já deixou o motivo (conta suspensa…)
          notice: isHttpError(e, 403) ? NO_ACCESS_MESSAGE : s.notice,
        }));
      }
    })();
    return () => {
      alive = false;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setState((s) => (s.status === 'offline' ? { ...s, status: 'loading' } : s));
    setAttempt((n) => n + 1);
  }, []);

  // offline: volta sozinho quando a rede volta — e também tenta a cada OFFLINE_RETRY_MS, porque o comum é o SERVIDOR
  // reiniciar (deploy) com a rede do navegador intacta, e aí o evento 'online' nunca dispara
  useEffect(() => {
    if (state.status !== 'offline') return;
    window.addEventListener('online', retry);
    const t = window.setInterval(retry, OFFLINE_RETRY_MS);
    return () => {
      window.removeEventListener('online', retry);
      window.clearInterval(t);
    };
  }, [state.status, retry]);

  // refresh recusado em qualquer pedido: volta pro login com o motivo
  useEffect(
    () =>
      session.onEnd((reason) => {
        queryClient.clear();
        setState({ status: 'anonymous', me: null, notice: reason });
      }),
    [queryClient],
  );

  const login = useCallback(async (phone: string, code: string) => {
    const res = await authApi.login(phone, code);
    if (!res.token || !res.refreshToken || !res.user.id) {
      throw new HttpError(404, 'Esse número não tem conta no Metch. Crie a conta pelo app primeiro.');
    }
    session.setTokens(res.token, res.refreshToken);
    try {
      const me = await adminApi.me();
      setState({ status: 'authenticated', me, notice: null });
    } catch (e) {
      // conta comum: descarta os tokens aqui (sem /logout, que mexeria na sessão do app da pessoa)
      session.clear();
      if (isHttpError(e, 403)) throw new HttpError(403, NO_ACCESS_MESSAGE);
      throw e;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // sair tem que funcionar mesmo com a API fora
    }
    session.clear();
    queryClient.clear();
    setState({ status: 'anonymous', me: null, notice: null });
  }, [queryClient]);

  const clearNotice = useCallback(() => setState((s) => ({ ...s, notice: null })), []);

  const value = useMemo<AuthContextValue>(() => ({ ...state, login, logout, clearNotice, retry }), [state, login, logout, clearNotice, retry]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth fora do AuthProvider');
  return ctx;
}

/** só nas telas de dentro (depois do login): a pessoa da equipe logada */
export function useMe(): AdminMe {
  const { me } = useAuth();
  if (!me) throw new Error('useMe sem sessão');
  return me;
}
