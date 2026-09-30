import { AppState } from 'react-native';
import { create } from 'zustand';
import type { User } from '@cruzei/shared-types';
import { api, clearSession, getToken, setRefreshToken, setToken, setUnauthorizedHandler } from '../services/api';
import { unregisterPushDevice } from '../services/notifications';

function statusOf(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status;
}

/** mensagem do backend quando a conta do token não existe mais (users.service: NotFoundException) */
const USER_GONE_MESSAGE = 'Usuário não encontrado';

/**
 * sessão realmente inválida: 401 (refresh recusado) ou 404 do próprio /me dizendo que a conta sumiu. Um 404 qualquer
 * (proxy/túnel sem backend, deploy, rota antiga) não prova nada e não pode derrubar a sessão
 */
function isSessionGone(err: unknown): boolean {
  const res = (err as { response?: { status?: number; data?: { message?: unknown } } })?.response;
  if (res?.status === 401) return true;
  return res?.status === 404 && res.data?.message === USER_GONE_MESSAGE;
}

/** sem resposta (rede/timeout), 5xx, 408 ou 429: vale tentar de novo daqui a pouco */
function isTransient(status: number | undefined): boolean {
  return status === undefined || status >= 500 || status === 408 || status === 429;
}

// ---- /me que não veio (boot ou login sem rede / servidor fora) ----
// Sessão aberta com user=null é "perfil desconhecido": tenta o /me de novo sozinho (3 s, 8 s, 20 s, 45 s e depois a
// cada 90 s) até vir ou deslogar. A reconexão do socket e a volta pro app (App.tsx) chamam ensureMe() na hora.
const ME_RETRY_MS = [3_000, 8_000, 20_000, 45_000, 90_000];
let meRetryTimer: ReturnType<typeof setTimeout> | null = null;
let meRetryAttempt = 0;
let meInFlight: Promise<void> | null = null;
/** muda a cada fim de sessão: /me que chega depois do logout não ressuscita o usuário */
let sessionGen = 0;

function needsMe(s: { isAuthenticated: boolean; user: User | null }): boolean {
  return s.isAuthenticated && !s.user;
}

function scheduleMeRetry(): void {
  if (meRetryTimer) return;
  const delay = ME_RETRY_MS[Math.min(meRetryAttempt, ME_RETRY_MS.length - 1)];
  meRetryAttempt += 1;
  meRetryTimer = setTimeout(() => {
    meRetryTimer = null;
    // em segundo plano não gasta bateria: a volta pro app retoma (App.tsx)
    if (AppState.currentState === 'background') return;
    void useAuthStore.getState().ensureMe();
  }, delay);
}

function stopMeRetry(): void {
  if (meRetryTimer) clearTimeout(meRetryTimer);
  meRetryTimer = null;
  meRetryAttempt = 0;
}

interface RegisterInput {
  phone: string;
  name: string;
  birthDate: string; // YYYY-MM-DD
  gender: string;
  orientation?: string;
  lookingFor?: string;
  /** versão dos Termos/Política aceita na última etapa do cadastro */
  termsVersion: string;
}

/** etapa pendente do pós-cadastro: avatar → foto → null (mapa) */
export type OnboardingStep = 'avatar' | 'photo' | null;

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  /** logo após o cadastro: o RootNavigator abre a etapa pendente (avatar, depois fotos) antes do mapa */
  onboardingStep: OnboardingStep;
  setOnboardingStep: (step: OnboardingStep) => void;
  hydrate: () => Promise<void>;
  requestCode: (phone: string) => Promise<{ sent: boolean; expiresIn: number; devCode?: string }>;
  /** `deferAuth`: guarda token+user mas NÃO vira `isAuthenticated` — a tela chama `commitAuth()` quando terminar a animação */
  verifyCode: (phone: string, code: string, opts?: { deferAuth?: boolean }) => Promise<{ isNew: boolean }>;
  commitAuth: () => void;
  register: (input: RegisterInput) => Promise<void>;
  refreshMe: () => Promise<void>;
  /** sessão aberta sem o /me (veio sem rede): busca de novo. Não lança; sem efeito se o perfil já está aqui */
  ensureMe: () => Promise<void>;
  setUser: (user: User) => void;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => {
  // Se o refresh token também expirou, volta pro onboarding.
  setUnauthorizedHandler(() => {
    if (!get().isAuthenticated) return;
    sessionGen += 1;
    set({ user: null, isAuthenticated: false });
  });

  return {
    user: null,
    isAuthenticated: false,
    isLoading: true,
    onboardingStep: null,

    setOnboardingStep(step) {
      set({ onboardingStep: step });
    },

    async hydrate() {
      const token = await getToken();
      if (!token) {
        set({ user: null, isAuthenticated: false, isLoading: false });
        return;
      }
      try {
        const res = await api.get('/me');
        set({ user: res.data, isAuthenticated: true, isLoading: false });
      } catch (err) {
        if (isSessionGone(err)) {
          // sessão realmente inválida (refresh falhou / conta apagada)
          await clearSession();
          set({ user: null, isAuthenticated: false, isLoading: false });
        } else {
          // sem rede / backend fora: mantém logado sem perfil; o retry do /me (ensureMe) busca de novo sozinho
          set({ isAuthenticated: true, isLoading: false });
        }
      }
    },

    async requestCode(phone) {
      const res = await api.post('/auth/request-code', { phone });
      return res.data;
    },

    async verifyCode(phone, code, opts) {
      const res = await api.post('/auth/login', { phone, code });
      if (res.data.user?.isNew) return { isNew: true };
      await setToken(res.data.token);
      await setRefreshToken(res.data.refreshToken);
      // o código já foi consumido e a sessão já está salva: só sessão inválida no /me (401/conta sumiu) desfaz o login
      let me: User | null = null;
      try {
        me = (await api.get('/me')).data;
      } catch (err) {
        if (isSessionGone(err)) {
          await clearSession();
          throw err;
        }
        // sem rede / backend fora: segue logado como no hydrate(), as telas tentam /me de novo
      }
      set({ user: me, isAuthenticated: !opts?.deferAuth });
      return { isNew: false };
    },

    commitAuth() {
      // não depende de `user`: o /me pode ter falhado por rede com a sessão já salva
      if (!get().isAuthenticated) set({ isAuthenticated: true });
    },

    async register(input) {
      const res = await api.post('/auth/register', input);
      await setToken(res.data.token);
      await setRefreshToken(res.data.refreshToken);
      const me = await api.get('/me');
      set({ user: me.data, isAuthenticated: true, onboardingStep: 'avatar' });
    },

    async refreshMe() {
      const gen = sessionGen;
      const me = await api.get('/me');
      // deslogou enquanto o /me voava: descarta
      if (gen !== sessionGen) return;
      set({ user: me.data });
    },

    ensureMe() {
      if (!needsMe(get())) return Promise.resolve();
      // reconexão do socket + volta pro app + timer no mesmo instante: um /me só
      if (meInFlight) return meInFlight;
      const gen = sessionGen;
      meInFlight = (async () => {
        try {
          await get().refreshMe();
        } catch (err) {
          if (gen !== sessionGen) return; // deslogou no meio
          if (isSessionGone(err)) {
            // mesma regra do hydrate(): sessão realmente inválida (refresh recusado / conta apagada)
            await clearSession();
            sessionGen += 1;
            set({ user: null, isAuthenticated: false });
            return;
          }
          // 403 (conta bloqueada: a tela de aviso assume) e outros 4xx não adiantam repetir
          // 404 que não é "conta sumiu" (proxy/deploy) também é passageiro
          const status = statusOf(err);
          if ((isTransient(status) || status === 404) && needsMe(get())) scheduleMeRetry();
        } finally {
          meInFlight = null;
        }
      })();
      return meInFlight;
    },

    setUser(user) {
      set({ user });
    },

    async logout() {
      // o token de push sai da conta antes (a rota precisa da sessão); falha não segura o logout
      await unregisterPushDevice().catch(() => undefined);
      try {
        await api.post('/auth/logout');
      } catch {
        /* offline ou token já inválido — segue o logout local */
      }
      await clearSession();
      sessionGen += 1;
      set({ user: null, isAuthenticated: false });
    },
  };
});

// entrou em "logado sem perfil" → começa o retry do /me; perfil chegou (por qualquer caminho) ou deslogou → para
useAuthStore.subscribe((s, prev) => {
  const need = needsMe(s);
  if (need === needsMe(prev)) return;
  if (need) scheduleMeRetry();
  else stopMeRetry();
});
