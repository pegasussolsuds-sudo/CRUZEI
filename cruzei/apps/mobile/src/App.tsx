import React, { useEffect, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Sentry from '@sentry/react-native';
import { Button, colors, spacing, typography } from '@cruzei/ui-mobile';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ReanimatedLogLevel, configureReanimatedLogger } from 'react-native-reanimated';
import { QueryClient, QueryClientProvider, notifyManager } from '@tanstack/react-query';

import { RootNavigator } from './navigation/RootNavigator';
import { useAuthStore } from './stores/auth';
import { useBootStore } from './stores/boot';
import { useMapPerfStore } from './stores/mapPerf';
import { useLocationStore } from './stores/location';
import { connectSocket, disconnectSocket, ensureSocketAlive, getSocket } from './services/socket';
import { bindRealtime, onNotificationNew as notificationArrived } from './services/realtime';
import { nextFrame } from './services/frameBatch';
import { clearMemCaches } from './services/memCache';
import { clearDrawCaches } from './screens/map/native/images/draw';
import { setAccountBlockedHandler } from './services/api';
import { asAccountBlocked, useAccountBlockStore } from './stores/accountBlock';
import { useAppFonts } from './theme/fonts';
import { SplashScreen } from './screens/auth/SplashScreen';
import { sentryEnabled, setSentryTag, setSentryUser } from './services/sentry';
import { cleanupLegacyMapbox } from './services/legacyMapboxCleanup';
import { linkInstallToUser, trackAppOpen, trackOnboardingPhase, trackOnboardingRoute } from './services/analytics';
import { navigationRef } from './navigation/navigationRef';
import { usePushRouteStore } from './stores/pushRoute';
import { useMatchCelebrationStore } from './stores/matchCelebration';
import {
  listenNotificationTaps,
  listenPushTokenChanges,
  registerPushDevice,
  setForegroundPushHandler,
  setSocialForegroundHandler,
  type SocialForegroundHandler,
} from './services/notifications';
import { parseTarget } from './services/notificationTarget';
import type { AppNotification } from '@cruzei/shared-types';

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

// avisos do React Query às telas: tudo o que muda dentro de um quadro (buscas terminando, eventos do socket) chega às
// telas numa tarefa só, no próximo quadro — uma passada de render por quadro em vez de uma por mudança (frameBatch.ts)
notifyManager.setScheduler((cb) => nextFrame(cb));

export const queryClient = new QueryClient({
  defaultOptions: {
    // sem o socket o que importa já tem polling próprio; montar uma tela de novo dentro de 1 min não busca outra vez
    queries: { staleTime: 60_000, retry: 1 },
  },
});
// pessoas e lugares em volta: cada célula (andar, arrastar o mapa, o deck a cada ~110 m) guarda uma resposta grande
// (até 300 pessoas com o avatar inteiro). Fora da tela não vale 5 min de memória: 1 min e sai
queryClient.setQueryDefaults(['nearby'], { gcTime: 60_000 });
// Mensagens, avisos e suporte chegam pelo socket (services/realtime.ts acerta o cache) e a reconexão invalida tudo:
// com o socket de pé, abrir de novo o chat ou a central dentro de 5 min não busca outra vez; sem socket, 30 s
const socketFedStaleTime = () => (getSocket()?.connected ? 5 * 60_000 : 30_000);
for (const key of [['inbox'], ['conversation'], ['messages'], ['notifications'], ['support']]) {
  queryClient.setQueryDefaults(key, { staleTime: socketFedStaleTime });
}

/** notificação nova com o app aberto (socket ou push em primeiro plano): central atualizada + aviso rápido */
function onNotificationNew(n: AppNotification): void {
  notificationArrived(queryClient, n);
}

/**
 * Push social (mensagem, curtida, match) com o app aberto: nada de banner — o socket já atualizou as listas. Match
 * sempre vira a comemoração (se o socket não trouxe, busca os pendentes). Com o socket caído, mensagem e curtida
 * aparecem no sistema (senão a pessoa não saberia) e o socket tenta voltar.
 */
const onSocialPushForeground: SocialForegroundHandler = (data) => {
  if (data.type === 'match') {
    const t = parseTarget(data.target);
    if (t?.kind === 'match') useMatchCelebrationStore.getState().fromPush(t.userId);
    return true;
  }
  if (getSocket()?.connected) return true;
  ensureSocketAlive();
  return false;
};

// toque em push (app quente e o toque que abriu o app frio): guardado até o login e a navegação ficarem prontos
listenNotificationTaps((route, notificationId) => usePushRouteStore.getState().set(route, notificationId));

export function App() {
  const hydrate = useAuthStore((s) => s.hydrate);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  // só o que o App usa do perfil (seletores finos): /me novo com outro contador/foto não re-renderiza o app inteiro
  const userId = useAuthStore((s) => s.user?.id);
  const hasUser = useAuthStore((s) => s.user != null);
  /** modo do servidor (null = /me sem settings ou ainda sem /me) */
  const serverAnonymous = useAuthStore((s) => (s.user?.settings ? s.user.settings.visibilityMode === 'anonymous' : null));
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
    setSentryUser(userId ?? null);
  }, [userId]);

  // métricas próprias: app_open 1x por dia (depois de hidratar a sessão, pra ir com a conta) e a cada volta pro app
  // (virou o dia com o app aberto); logou/cadastrou → os eventos anônimos desta instalação passam a ser da conta
  useEffect(() => {
    if (isLoading) return;
    void trackAppOpen();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void trackAppOpen();
    });
    return () => sub.remove();
  }, [isLoading]);
  useEffect(() => {
    if (userId) void linkInstallToUser(userId);
  }, [userId]);
  // funil do cadastro: boas-vindas/telefone/código pela rota; avatar/fotos/primeiro mapa pela fase do cadastro
  useEffect(() => {
    const onRoute = () => {
      if (navigationRef.isReady()) trackOnboardingRoute(navigationRef.getCurrentRoute()?.name);
    };
    const offReady = navigationRef.addListener('ready', onRoute);
    const offState = navigationRef.addListener('state', onRoute);
    onRoute();
    return () => {
      offReady();
      offState();
    };
  }, []);
  const onboardingPhase = useAuthStore((s) => s.onboardingStep);
  useEffect(() => {
    trackOnboardingPhase(onboardingPhase, mapReady);
  }, [onboardingPhase, mapReady]);

  // Espelha o modo anônimo do servidor no store local
  useEffect(() => {
    if (serverAnonymous != null) setAnonymous(serverAnonymous);
  }, [serverAnonymous, setAnonymous]);

  // logado sem o /me (servidor fora no boot): o padrão local "anônimo" não pode travar Mensagens/curtidas nem dizer
  // "oculto do mapa" — o erro seguro é mostrar visível até o /me chegar (o efeito acima corrige na hora)
  useEffect(() => {
    if (isAuthenticated && !hasUser) setAnonymous(false);
  }, [isAuthenticated, hasUser, setAnonymous]);

  // Socket global: mantém listas sincronizadas mesmo fora da tela de chat
  useEffect(() => {
    if (!isAuthenticated) {
      disconnectSocket();
      queryClient.clear();
      useMatchCelebrationStore.getState().reset();
      return;
    }
    let active = true;
    (async () => {
      const socket = await connectSocket();
      if (!socket || !active) return;
      bindRealtime(socket, queryClient);
    })();
    return () => {
      active = false;
    };
  }, [isAuthenticated]);

  // push (FCM): registra o aparelho a cada abertura logada (se a permissão já foi dada), acompanha a troca de token e
  // transforma o push que chega com o app aberto no aviso do app. Quem pede a permissão é o RootNavigator (uma vez)
  useEffect(() => {
    if (!isAuthenticated) return;
    void registerPushDevice();
    const offToken = listenPushTokenChanges();
    setForegroundPushHandler(onNotificationNew);
    setSocialForegroundHandler(onSocialPushForeground);
    return () => {
      offToken();
      setForegroundPushHandler(null);
      setSocialForegroundHandler(null);
    };
  }, [isAuthenticated]);

  // volta pro app: se o servidor derrubou o socket (token venceu em background), reconecta
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') ensureSocketAlive();
      // e se o /me nunca veio (abriu sem rede), tenta de novo — o retry do store pausa em segundo plano
      if (s === 'active') void useAuthStore.getState().ensureMe();
      // no fundo os caches de desenho (camadas, efeitos, palco) saem: quem está montado guarda o que já desenhou
      if (s === 'background') clearMemCaches();
    });
    // aviso de memória baixa (só o iOS emite; no Android o RN entrega ao Hermes e o app indo pro fundo faz o resto)
    const low = AppState.addEventListener('memoryWarning', () => {
      clearMemCaches();
      clearDrawCaches();
      queryClient.removeQueries({ type: 'inactive' });
    });
    return () => {
      sub.remove();
      low.remove();
    };
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
