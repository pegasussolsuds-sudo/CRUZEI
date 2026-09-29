// Configuração central — lê de expo constants (app.json extra) com fallback pra EXPO_PUBLIC_*.
import Constants from 'expo-constants';

// Metro substitui process.env.EXPO_PUBLIC_* em build time; só declaramos o tipo aqui.
declare const process: { env: Record<string, string | undefined> };

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string | undefined>;

export const config = {
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? extra.apiBaseUrl ?? 'http://localhost:3000/v1',
  wsUrl: process.env.EXPO_PUBLIC_SOCKET_URL ?? extra.wsUrl ?? 'ws://localhost:3000',
  // development | staging | production — vai como environment no Sentry
  env: process.env.EXPO_PUBLIC_ENV ?? (__DEV__ ? 'development' : 'production'),
  // DSN do Sentry (não é segredo: só permite enviar eventos). Vazio = Sentry desligado, nem inicializa
  sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN ?? '',
  // override opcional de release/dist; vazio = o SDK nativo usa app.metch@versão+build, o mesmo do upload dos source maps
  sentryRelease: process.env.EXPO_PUBLIC_SENTRY_RELEASE ?? '',
  sentryDist: process.env.EXPO_PUBLIC_SENTRY_DIST ?? '',
} as const;
