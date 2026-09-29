import { create } from 'zustand';

interface BootState {
  /** true quando o estilo do mapa nativo terminou de carregar (contexto GL do Mapbox já criado) */
  mapReady: boolean;
  setMapReady: (ready: boolean) => void;
}

/**
 * Fase do boot. O mapa nasce por baixo da splash: na época da WebView, criar o Chromium DEPOIS da splash sair
 * derrubou o driver GL / HWUI do aparelho de teste (GL iniciando junto com a destruição dos canvases Skia). O mapa
 * nativo também cria um contexto GL próprio, então a regra continua: a splash só sai quando o estilo carregou (ou
 * depois de um teto de tempo), e a saída revela um mapa já vivo.
 */
export const useBootStore = create<BootState>((set) => ({
  mapReady: false,
  setMapReady: (mapReady) => set({ mapReady }),
}));
