// Estado de login do painel. Entra com o mesmo telefone + código do app; só fica quem o /admin/me aceita.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { AdminMe } from '@cruzei/shared-types';
import { adminApi, authApi } from '@/api/admin';
import { HttpError, isHttpError, refreshAccessToken } from '@/api/http';
import { session } from '@/api/session';

export const NO_ACCESS_MESSAGE = 'Essa conta não tem acesso ao painel.';

type Status = 'loading' | 'anonymous' | 'authenticated';

interface AuthState {
  status: Status;
  me: AdminMe | null;
  /** aviso pra tela de login (sessão expirou, conta sem acesso…) */
  notice: string | null;
}

interface AuthContextValue extends AuthState {
  login: (phone: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  clearNotice: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>(() => ({
    status: session.getRefreshToken() ? 'loading' : 'anonymous',
    me: null,
    notice: null,
  }));

  // aba recarregada: o access token sumiu da memória, o refresh da aba traz a sessão de volta
  useEffect(() => {
    if (!session.getRefreshToken()) return;
    let alive = true;
    (async () => {
      try {
        const ok = await refreshAccessToken();
        if (!ok) throw new HttpError(401, 'Sua sessão expirou. Entre de novo.');
        const me = await adminApi.me();
        if (alive) setState({ status: 'authenticated', me, notice: null });
      } catch (e) {
        session.clear();
        if (alive) {
          setState({
            status: 'anonymous',
            me: null,
            notice: isHttpError(e, 403) ? NO_ACCESS_MESSAGE : isHttpError(e, 0) ? e.message : null,
          });
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

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

  const value = useMemo<AuthContextValue>(() => ({ ...state, login, logout, clearNotice }), [state, login, logout, clearNotice]);
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
