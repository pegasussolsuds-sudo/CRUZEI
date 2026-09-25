import { create } from 'zustand';

interface BootState {
  /** true quando a WebView do mapa terminou de carregar o HTML (Chromium já inicializado) */
  webViewReady: boolean;
  setWebViewReady: (ready: boolean) => void;
}

/**
 * Fase do boot. A WebView do mapa (Chromium) nasce por baixo da splash — criá-la DEPOIS da splash sair
 * derrubou o driver GL / HWUI do aparelho de teste duas vezes (GL do Chromium iniciando junto com a
 * destruição dos canvases Skia e com as views arredondadas do mapa já na tela). A splash só sai quando
 * a WebView já carregou (ou depois de um teto de tempo), então a saída revela um mapa já vivo.
 */
export const useBootStore = create<BootState>((set) => ({
  webViewReady: false,
  setWebViewReady: (webViewReady) => set({ webViewReady }),
}));
