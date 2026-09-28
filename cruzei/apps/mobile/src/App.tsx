import React, { useEffect, useState } from 'react';
import { AppState, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ReanimatedLogLevel, configureReanimatedLogger } from 'react-native-reanimated';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { RootNavigator } from './navigation/RootNavigator';
import { useAuthStore } from './stores/auth';
import { useBootStore } from './stores/boot';
import { useLocationStore } from './stores/location';
import { connectSocket, disconnectSocket, ensureSocketAlive } from './services/socket';
import { useAppFonts } from './theme/fonts';
import { SplashScreen } from './screens/auth/SplashScreen';

// Reanimated 3.16 avisa toda leitura de .value durante o render em modo estrito; o react-native-skia lê shared values
// ao montar os nós (processProps) e enche o log no boot. Nosso código lê só em worklets/efeitos.
configureReanimatedLogger({ level: ReanimatedLogLevel.warn, strict: false });

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
  const webViewReady = useBootStore((s) => s.webViewReady);
  // O navegador só monta quando a coreografia da splash termina (montar junto engasga a animação ~1 s).
  // A WebView do mapa nasce por baixo da splash e a splash só sai quando ela carregou (teto de 4 s) — ver stores/boot.ts.
  const [shellReady, setShellReady] = useState(false);
  const [mapWaitOver, setMapWaitOver] = useState(false);
  useEffect(() => {
    if (!shellReady) return;
    const id = setTimeout(() => setMapWaitOver(true), 4000);
    return () => clearTimeout(id);
  }, [shellReady]);
  const splashReady = shellReady && !isLoading && (!isAuthenticated || webViewReady || mapWaitOver);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

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
        </SafeAreaProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

export default App;
