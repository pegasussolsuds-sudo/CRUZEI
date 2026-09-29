import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import type { InitTier } from '../screens/map/bridge';

// v2: o tier da época da WebView não vale pro mapa nativo (bem mais leve); a 1ª abertura mede de novo
const STORAGE_KEY = 'metch.mapTier.v2';

/**
 * Tier de performance do mapa, lembrado entre aberturas do app (SecureStore — string curta, sem dado pessoal).
 * O tier decide os efeitos caros do mapa (prédios com flood light/AO, partículas, giro automático da câmera, ritmo dos
 * anéis, teto de figuras próprias). Rebaixar no meio da sessão só desliga efeitos (setTier); a próxima abertura já
 * nasce no tier salvo, sem precisar medir de novo.
 */
interface MapPerfState {
  tier: InitTier;
  hydrated: boolean;
  setTier: (tier: InitTier) => void;
  /** promoção (o aparelho mostrou fps alto por um tempo): sobe um degrau */
  raiseTier: (tier: InitTier) => void;
  hydrate: () => Promise<void>;
}

const RANK: Record<InitTier, number> = { auto: 3, high: 2, mid: 1, low: 0 };
const VALID = new Set<InitTier>(['auto', 'high', 'mid', 'low']);

function persist(tier: InitTier) {
  SecureStore.setItemAsync(STORAGE_KEY, tier).catch(() => undefined);
}

export const useMapPerfStore = create<MapPerfState>((set, get) => ({
  tier: 'auto',
  hydrated: false,
  setTier(tier) {
    if (RANK[tier] < RANK[get().tier]) {
      set({ tier });
      persist(tier);
    }
  },
  raiseTier(tier) {
    if (RANK[tier] > RANK[get().tier]) {
      set({ tier });
      persist(tier);
    }
  },
  async hydrate() {
    try {
      const saved = (await SecureStore.getItemAsync(STORAGE_KEY)) as InitTier | null;
      // só vale se ninguém mexeu no tier antes da leitura terminar
      if (saved && VALID.has(saved) && get().tier === 'auto') set({ tier: saved });
    } catch {
      /* sem storage: mede de novo nesta abertura */
    }
    set({ hydrated: true });
  },
}));
