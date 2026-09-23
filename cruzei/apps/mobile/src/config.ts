// Configuração central — lê de expo constants (app.json extra) com fallback pra EXPO_PUBLIC_*.
import Constants from 'expo-constants';

// Metro substitui process.env.EXPO_PUBLIC_* em build time; só declaramos o tipo aqui.
declare const process: { env: Record<string, string | undefined> };

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string | undefined>;

export const config = {
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? extra.apiBaseUrl ?? 'http://localhost:3000/v1',
  wsUrl: process.env.EXPO_PUBLIC_SOCKET_URL ?? extra.wsUrl ?? 'ws://localhost:3000',
  // Token público do Mapbox (pk.) — restringir por app/URL no painel antes do launch
  mapboxToken: process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? extra.mapboxToken ?? '',
} as const;
