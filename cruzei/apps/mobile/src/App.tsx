import React, { useEffect, useState } from 'react';
import { Alert, AppState, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Sentry from '@sentry/react-native';
import { Button, colors, spacing, typography } from '@cruzei/ui-mobile';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ReanimatedLogLevel, configureReanimatedLogger } from 'react-native-reanimated';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { RootNavigator } from './navigation/RootNavigator';
import { useAuthStore } from './stores/auth';
import { useBootStore } from './stores/boot';
import { useMapPerfStore } from './stores/mapPerf';
import { useLocationStore } from './stores/location';
import { connectSocket, disconnectSocket, ensureSocketAlive } from './services/socket';
import { setAccountBlockedHandler } from './services/api';
import { asAccountBlocked, useAccountBlockStore } from './stores/accountBlock';
import { useAppFonts } from './theme/fonts';
import { SplashScreen } from './screens/auth/SplashScreen';
import { sentryEnabled, setSentryTag, setSentryUser } from './services/sentry';
import { cleanupLegacyMapbox } from './services/legacyMapboxCleanup';

// Reanimated 3.16 avisa toda leitura de .value durante o render em modo estrito; o react-native-skia lê shared values
// ao montar os nós (processProps) e enche o log no boot. Nosso código lê só em worklets/efeitos.
configureReanimatedLogger({ level: ReanimatedLogLevel.warn, strict: false });

// tier de performance do mapa lembrado da última abertura: lido já no boot, antes do mapa montar (sob a splash)
useMapPerfStore.getState().hydrate();

// 403 de conta suspensa/banida (API, refresh ou socket) → o app inteiro vira a tela de aviso
setAccountBlockedHandler((data) => {
  const b = asAccountBlocked(data);
  if (b) useAccountBlockStore.getState().setBlocked(b);
  return Boolean(b);
});

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

export function App() {
  const hydrate = useAuthStore((s) => s.hydrate);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const setAnonymous = useLocationStore((s) => s.setAnonymous);
  const fontsReady = useAppFonts();
  const isLoading = useAuthStore((s) => s.isLoading);
  const [splashDone, setSplashDone] = useState(false);
  const mapReady = useBootStore((s) => s.mapReady);
  // O navegador só monta quando a coreografia da splash termina (montar junto engasga a animação ~1 s).
  // O mapa nativo nasce por baixo da splash e a splash só sai quando o estilo dele carregou (teto de 4 s) — ver stores/boot.ts.
  const [shellReady, setShellReady] = useState(false);
  const [mapWaitOver, setMapWaitOver] = useState(false);
  useEffect(() => {
    if (!shellReady) return;
    const id = setTimeout(() => setMapWaitOver(true), 4000);
    return () => clearTimeout(id);
  }, [shellReady]);
  const splashReady = shellReady && !isLoading && (!isAuthenticated || mapReady || mapWaitOver);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // Sentry (no-op sem DSN): a sessão só pelo id do usuário e o motor do mapa em uso, pra separar os crashes
  useEffect(() => {
    setSentryTag('map.engine', 'maplibre');
  }, []);

  // restos do SDK do Mapbox da versão antiga (~7 MB): apaga uma vez, longe do boot
  useEffect(() => {
    if (!mapReady) return;
    const id = setTimeout(cleanupLegacyMapbox, 15_000);
    return () => clearTimeout(id);
  }, [mapReady]);
  useEffect(() => {
    setSentryUser(user?.id ?? null);
  }, [user?.id]);

  // Espelha o modo anônimo do servidor no store local
  useEffect(() => {
    if (user?.settings) setAnonymous(user.settings.visibilityMode === 'anonymous');
  }, [user?.settings, setAnonymous]);

  // Socket global: mantém listas sincronizadas mesmo fora da tela de chat
  useEffect(() => {
    if (!isAuthenticated) {
      disconnectSocket();
      queryClient.clear();
      return;
    }
    let active = true;
    (async () => {
      const socket = await connectSocket();
      if (!socket || !active) return;
      // (re)conectou: o que chegou enquanto o socket estava fora não virou evento — atualiza a lista uma vez
      socket.on('connect', () => {
        queryClient.invalidateQueries({ queryKey: ['matches'] });
      });
      socket.on('match_created', () => {
        queryClient.invalidateQueries({ queryKey: ['matches'] });
        queryClient.invalidateQueries({ queryKey: ['me'] });
      });
      socket.on('message_received', () => {
        queryClient.invalidateQueries({ queryKey: ['matches'] });
      });
      socket.on('like_received', () => {
        queryClient.invalidateQueries({ queryKey: ['me'] });
      });
      // bloqueio, match desfeito ou moderação: a conversa some da lista na hora (o chat aberto fecha sozinho)
      socket.on('match_closed', () => {
        queryClient.invalidateQueries({ queryKey: ['matches'] });
      });
      socket.on('account_blocked', (data) => {
        const b = asAccountBlocked(data);
        if (b) useAccountBlockStore.getState().setBlocked(b);
      });
      socket.on('account_notice', ({ message }) => {
        Alert.alert('Aviso da moderação', message);
      });
      socket.on('photo_moderated', ({ status, reason }) => {
        queryClient.invalidateQueries({ queryKey: ['me'] });
        useAuthStore.getState().refreshMe().catch(() => undefined);
        if (status === 'rejected') {
          Alert.alert('Foto recusada', `${reason ?? 'Uma foto sua não segue as regras do Metch'}. Ela não aparece pra ninguém; dá pra trocar no seu perfil.`);
        }
      });
    })();
    return () => {
      active = false;
    };
  }, [isAuthenticated]);

  // volta pro app: se o servidor derrubou o socket (token venceu em background), reconecta
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') ensureSocketAlive();
    });
    return () => sub.remove();
  }, []);

  // enquanto as fontes carregam, fundo escuro (mesma cor da splash) em vez de tela branca
  if (!fontsReady) return <View style={{ flex: 1, backgroundColor: '#0A0A1A' }} />;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <AppErrorBoundary>
            {/* ícones claros na splash escura; depois o RootNavigator decide pela rota focada */}
            {!shellReady ? <StatusBar style="light" /> : null}
            {shellReady ? <RootNavigator splashing={!splashDone} /> : null}
            {/* Splash animada por cima até a sessão hidratar e o navegador montar (mín. 2.7s) */}
            {!splashDone ? (
              <SplashScreen
                ready={splashReady}
                onSettled={() => setShellReady(true)}
                onFinish={() => setSplashDone(true)}
              />
            ) : null}
          </AppErrorBoundary>
        </SafeAreaProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

// ---- Erro de render: tela escura com "tentar de novo" em vez de o app fechar ----

function ErrorFallback({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={fallbackStyles.root}>
      <StatusBar style="light" />
      <Text style={fallbackStyles.title}>Algo deu errado aqui</Text>
      <Button title="Tentar de novo" onPress={onRetry} />
    </View>
  );
}

/** sem Sentry: boundary mínimo com o mesmo fallback, sem reportar nada */
class LocalErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) return <ErrorFallback onRetry={() => this.setState({ failed: false })} />;
    return this.props.children;
  }
}

/** com Sentry ligado, o boundary dele (reporta com o component stack); senão o local */
function AppErrorBoundary({ children }: { children: React.ReactNode }) {
  if (!sentryEnabled) return <LocalErrorBoundary>{children}</LocalErrorBoundary>;
  return (
    <Sentry.ErrorBoundary fallback={({ resetError }) => <ErrorFallback onRetry={resetError} />}>
      {children}
    </Sentry.ErrorBoundary>
  );
}

const fallbackStyles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.black, // #0A0A1A, o fundo da splash
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.xl,
  },
  title: { ...typography.h3, color: colors.white, textAlign: 'center' },
});

export default App;
