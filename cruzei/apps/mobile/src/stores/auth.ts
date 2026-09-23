import { create } from 'zustand';
import type { User } from '@cruzei/shared-types';
import { api, clearSession, getToken, setRefreshToken, setToken, setUnauthorizedHandler } from '../services/api';

interface RegisterInput {
  phone: string;
  name: string;
  birthDate: string; // YYYY-MM-DD
  gender: string;
  orientation?: string;
  lookingFor?: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  /** true logo após o cadastro: o RootNavigator abre a tela de fotos antes do mapa */
  pendingPhotoOnboarding: boolean;
  clearPhotoOnboarding: () => void;
  hydrate: () => Promise<void>;
  requestCode: (phone: string) => Promise<{ sent: boolean; expiresIn: number; devCode?: string }>;
  verifyCode: (phone: string, code: string) => Promise<{ isNew: boolean }>;
  register: (input: RegisterInput) => Promise<void>;
  refreshMe: () => Promise<void>;
  setUser: (user: User) => void;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => {
  // Se o refresh token também expirou, volta pro onboarding.
  setUnauthorizedHandler(() => {
    if (get().isAuthenticated) set({ user: null, isAuthenticated: false });
  });

  return {
    user: null,
    isAuthenticated: false,
    isLoading: true,
    pendingPhotoOnboarding: false,

    clearPhotoOnboarding() {
      set({ pendingPhotoOnboarding: false });
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
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 401 || status === 404) {
          // sessão realmente inválida (refresh falhou / conta apagada)
          await clearSession();
          set({ user: null, isAuthenticated: false, isLoading: false });
        } else {
          // sem rede / backend fora: mantém logado, as telas tentam de novo
          set({ isAuthenticated: true, isLoading: false });
        }
      }
    },

    async requestCode(phone) {
      const res = await api.post('/auth/request-code', { phone });
      return res.data;
    },

    async verifyCode(phone, code) {
      const res = await api.post('/auth/login', { phone, code });
      if (res.data.user?.isNew) return { isNew: true };
      await setToken(res.data.token);
      await setRefreshToken(res.data.refreshToken);
      const me = await api.get('/me');
      set({ user: me.data, isAuthenticated: true });
      return { isNew: false };
    },

    async register(input) {
      const res = await api.post('/auth/register', input);
      await setToken(res.data.token);
      await setRefreshToken(res.data.refreshToken);
      const me = await api.get('/me');
      set({ user: me.data, isAuthenticated: true, pendingPhotoOnboarding: true });
    },

    async refreshMe() {
      const me = await api.get('/me');
      set({ user: me.data });
    },

    setUser(user) {
      set({ user });
    },

    async logout() {
      try {
        await api.post('/auth/logout');
      } catch {
        /* offline ou token já inválido — segue o logout local */
      }
      await clearSession();
      set({ user: null, isAuthenticated: false });
    },
  };
});
