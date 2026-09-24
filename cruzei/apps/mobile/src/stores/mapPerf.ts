import { create } from 'zustand';
import type { InitTier } from '../screens/map/bridge';

/**
 * Tier de performance do mapa que sobrevive à remontagem da tela (troca de aba, retry, crash do WebView).
 * Só rebaixa: uma vez que o aparelho se mostrou 'low', o próximo mount já nasce com DPR ≤ 1.5 e sem efeitos caros,
 * em vez de refazer 15 s de medição. (Em memória por sessão — persistência entre launches fica pra quando
 * o app tiver storage nativo configurado.)
 */
interface MapPerfState {
  tier: InitTier;
  setTier: (tier: InitTier) => void;
}

const RANK: Record<InitTier, number> = { auto: 3, high: 2, mid: 1, low: 0 };

export const useMapPerfStore = create<MapPerfState>((set, get) => ({
  tier: 'auto',
  setTier(tier) {
    if (RANK[tier] < RANK[get().tier]) set({ tier });
  },
}));
