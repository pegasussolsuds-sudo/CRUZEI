import { create } from 'zustand';

/**
 * Lugar pedido de fora do mapa (toque num aviso de evento/lugar). O MapScreen consome quando o mapa estiver pronto:
 * foca o lugar se ele já está no recorte ou busca o lugar (GET /pois/:id) e voa até lá, abrindo a folha dele.
 */
interface MapFocusState {
  pending: { poiId: number; at: number } | null;
  focus: (poiId: number) => void;
  clear: () => void;
}

export const useMapFocusStore = create<MapFocusState>((set) => ({
  pending: null,
  // `at` deixa o mesmo lugar pedido duas vezes seguidas disparar de novo
  focus: (poiId) => set({ pending: { poiId, at: Date.now() } }),
  clear: () => set({ pending: null }),
}));
