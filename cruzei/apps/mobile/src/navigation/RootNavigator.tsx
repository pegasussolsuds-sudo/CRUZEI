import type { AccountClaim, AccountDeletionPendingError, LegalSlug, PhoneReleaseReason, ProximityBand } from '@cruzei/shared-types';
import React, { useCallback, useEffect, useState } from 'react';
import { NavigationContainer, type NavigatorScreenParams } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, View } from 'react-native';

import { useAuthStore } from '../stores/auth';
import { WelcomeScreen } from '../screens/auth/WelcomeScreen';
import { PhoneScreen } from '../screens/auth/PhoneScreen';
import { CodeScreen } from '../screens/auth/CodeScreen';
import { ClaimAccountScreen } from '../screens/auth/ClaimAccountScreen';
import { RestoreAccountScreen } from '../screens/auth/RestoreAccountScreen';
import { DeleteAccountScreen } from '../screens/profile/DeleteAccountScreen';
import { DataExportScreen } from '../screens/profile/DataExportScreen';
import { LocationHistoryScreen } from '../screens/profile/LocationHistoryScreen';
import { ProfileSetupScreen } from '../screens/auth/ProfileSetupScreen';
import { PhotoUploadScreen } from '../screens/auth/PhotoUploadScreen';
import { AvatarCustomizerScreen } from '../screens/avatar/AvatarCustomizerScreen';
import { UserCardScreen } from '../screens/users/UserCardScreen';
import { BoostScreen } from '../screens/boost/BoostScreen';
import { PrivateAreasScreen } from '../screens/profile/PrivateAreasScreen';
import { HelpScreen } from '../screens/profile/HelpScreen';
import { BlockedUsersScreen } from '../screens/profile/BlockedUsersScreen';
import { LegalScreen, LEGAL_TITLES } from '../screens/legal/LegalScreen';
import { ModerationScreen } from '../screens/moderation/ModerationScreen';
import { ModerationUserScreen } from '../screens/moderation/ModerationUserScreen';
import { NotificationsScreen } from '../screens/notifications/NotificationsScreen';
import { SupportChatScreen } from '../screens/support/SupportChatScreen';
import { InAppNoticeHost } from '../components/notifications/InAppNoticeHost';
import { MatchCelebrationHost } from '../components/MatchCelebrationHost';
import { AccountBlockedScreen } from '../components/safety/AccountBlockedScreen';
import { TermsGate } from '../components/legal/TermsGate';
import { useAccountBlockStore } from '../stores/accountBlock';
import { useBootStore } from '../stores/boot';
import { usePushRouteStore } from '../stores/pushRoute';
import { isTourBusy, useTourStore } from '../stores/tour';
import { useMapTheme } from '../hooks/useMapTheme';
import { markNotificationRead } from '../hooks/useNotifications';
import { askPushPermissionOnce } from '../services/notifications';
import { MainTabs, type MainTabParamList } from './MainTabs';
import { navigationRef } from './navigationRef';
import { useDevLinks } from '../screens/dev/devLinks';
import { openTargetRoute } from './openTarget';
import { navBarScreenLayout } from './NavBarBackdrop';
import { colors } from '@cruzei/ui-mobile';

export type RootStackParamList = {
  Onboarding: undefined; // WelcomeScreen
  Login: undefined; // PhoneScreen
  // CodeScreen (OTP). resendIn: segundos até poder reenviar; alreadySent: o código anterior ainda vale (429 sms_cooldown)
  Code: { phone: string; devCode?: string | null; expiresIn?: number; resendIn?: number; alreadySent?: boolean };
  // "Essa conta é sua?": conta do número parada há 90+ dias (número reciclado)
  ClaimAccount: { phone: string; claim: AccountClaim };
  // conta com exclusão pedida dentro do prazo: "Quer cancelar a exclusão e voltar?"
  RestoreAccount: { phone: string; pending: AccountDeletionPendingError };
  // ProfileSetupScreen; `released`: o número acabou de sair da conta antiga (a tela pode avisar)
  Register: { phone: string; released?: PhoneReleaseReason };
  Main: NavigatorScreenParams<MainTabParamList> | undefined; // aceita { screen: 'Paywall' } etc.
  AvatarSetup: { fromOnboarding?: boolean }; // pós-cadastro ou vindo do perfil
  PhotoUpload: { fromOnboarding?: boolean }; // pós-cadastro ou vindo do perfil
  UserCard: { userId: string; band?: ProximityBand | null }; // perfil de outra pessoa (faixa de proximidade, nunca metros)
  PrivateAreas: undefined; // áreas privadas (casa/trabalho): onde ninguém me descobre
  Boost: undefined;
  Legal: { slug: LegalSlug }; // Termos · Política · Segurança infantil (antes e depois do login)
  Help: undefined; // Ajuda e segurança
  BlockedUsers: undefined;
  Moderation: undefined; // só moderador/admin
  ModerationUser: { userId: string };
  Notifications: undefined; // central de avisos
  SupportChat: undefined; // suporte ao vivo (Ajuda e segurança ou toque no push)
  DataExport: undefined; // Baixar meus dados (LGPD)
  LocationHistory: undefined; // Apagar histórico de localização
  DeleteAccount: undefined; // Excluir conta (prazo de 30 dias pra voltar atrás)
  // só __DEV__: galeria de revisão do avatar no aparelho (metch://dev/avatar-gallery?slot=…&mode=…&page=…)
  AvatarGallery: { slot?: string; mode?: string; page?: number; p?: number; id?: string } | undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const dark = { headerShown: false, contentStyle: { backgroundColor: colors.black } } as const;
const light = { headerShown: false, contentStyle: { backgroundColor: colors.background } } as const;
/** telas de texto/lista com header claro e botão voltar */
const lightHeader = {
  headerShown: true,
  headerStyle: { backgroundColor: colors.background },
  headerTintColor: colors.black,
  contentStyle: { backgroundColor: colors.background },
} as const;

/** tempo no mapa, depois de ele carregar pela 1ª vez, antes da explicação do push (nunca no primeiro segundo do app) */
const PUSH_ASK_DELAY_MS = 8000;

// telas claras por cima das abas: faixa escura sob os 3 botões do Android (Main já tem a tab bar escura embaixo)
const screenLayout = navBarScreenLayout(['Main']);

// rotas com fundo/header escuro (inclusive aninhadas: Paywall é aba, Chat está no InboxStack) → ícones claros na status bar
const DARK_ROUTES = new Set(['UserCard', 'Boost', 'AvatarSetup', 'PhotoUpload', 'Paywall', 'Chat']);

export function RootNavigator({ splashing = false }: { splashing?: boolean }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  useDevLinks(isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const onboardingStep = useAuthStore((s) => s.onboardingStep);
  const blocked = useAccountBlockStore((s) => s.blocked);
  // ref única (navigationRef): helpers como openChat navegam de fora das telas
  const navRef = navigationRef;
  const [routeName, setRouteName] = useState<string | undefined>();
  const syncRoute = useCallback(() => setRouteName(navRef.getCurrentRoute()?.name), [navRef]);
  // a cada montagem do container (volta do carregamento/bloqueio): o toque de push guardado tenta de novo
  const [navReadyTick, setNavReadyTick] = useState(0);
  const onNavReady = useCallback(() => {
    syncRoute();
    setNavReadyTick((n) => n + 1);
  }, [syncRoute]);
  const { theme: mapTheme } = useMapTheme();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const mapLoaded = useBootStore((s) => s.mapReady);
  const termsPending = Boolean(user?.legal && user.legal.acceptedVersion !== user.legal.currentVersion);

  // toque num push (app frio ou quente): abre o destino quando o login e a navegação estiverem prontos
  const pendingPush = usePushRouteStore((s) => s.pending);
  useEffect(() => {
    if (!pendingPush || navReadyTick === 0 || !isAuthenticated || isLoading || onboardingStep || blocked) return;
    if (!openTargetRoute(pendingPush.route, qc)) return;
    if (pendingPush.notificationId) void markNotificationRead(qc, pendingPush.notificationId);
    usePushRouteStore.getState().clear();
  }, [pendingPush, navReadyTick, isAuthenticated, isLoading, onboardingStep, blocked, qc]);

  // tour do mapa: espera a splash sair; enquanto ele está na fila ou na tela, o pedido do push espera
  const tourBusy = useTourStore(isTourBusy);
  useEffect(() => {
    useTourStore.getState().setSplashing(splashing);
  }, [splashing]);

  // pedido de push: uma vez, com o mapa já carregado e a pessoa nele há uns segundos (nada de splash, termos, cadastro
  // ou tour do mapa)
  const onMap = routeName === 'Map';
  useEffect(() => {
    if (!isAuthenticated || splashing || !mapLoaded || !onMap || onboardingStep || termsPending || blocked || tourBusy) return;
    const id = setTimeout(() => void askPushPermissionOnce(), PUSH_ASK_DELAY_MS);
    return () => clearTimeout(id);
  }, [isAuthenticated, splashing, mapLoaded, onMap, onboardingStep, termsPending, blocked, tourBusy]);

  // única StatusBar do app logado: segue a rota focada (a splash escura por cima também pede ícones claros)
  // o mapa de noite e no entardecer é escuro (de dia é claro e pede ícones escuros)
  const darkMap = routeName === 'Map' && mapTheme !== 'day';
  const barStyle =
    splashing || isLoading || !isAuthenticated || darkMap || (routeName && DARK_ROUTES.has(routeName)) ? 'light' : 'dark';

  // conta suspensa/banida: nada do app, só o aviso com o motivo e como contestar
  if (blocked) return <AccountBlockedScreen blocked={blocked} />;

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.black }}>
        <StatusBar style={barStyle} />
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <NavigationContainer ref={navRef} onReady={onNavReady} onStateChange={syncRoute}>
      <StatusBar style={barStyle} />
      <Stack.Navigator
        screenLayout={screenLayout}
        // logo após o cadastro entra pela etapa pendente (avatar → fotos); nas demais aberturas, direto no mapa
        initialRouteName={
          !isAuthenticated ? 'Onboarding' : onboardingStep === 'avatar' ? 'AvatarSetup' : onboardingStep === 'photo' ? 'PhotoUpload' : 'Main'
        }
        screenOptions={{
          headerStyle: { backgroundColor: colors.black },
          headerTintColor: colors.white,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.background },
          animation: 'slide_from_right',
        }}
      >
        {!isAuthenticated ? (
          <>
            <Stack.Screen name="Onboarding" component={WelcomeScreen} options={{ ...dark, animation: 'fade' }} />
            <Stack.Screen name="Login" component={PhoneScreen} options={dark} />
            <Stack.Screen name="Code" component={CodeScreen} options={dark} />
            <Stack.Screen name="ClaimAccount" component={ClaimAccountScreen} options={{ ...dark, gestureEnabled: false }} />
            <Stack.Screen name="RestoreAccount" component={RestoreAccountScreen} options={{ ...dark, gestureEnabled: false }} />
            <Stack.Screen name="Register" component={ProfileSetupScreen} options={dark} />
            <Stack.Screen name="Legal" component={LegalScreen} options={({ route }) => ({ ...lightHeader, title: LEGAL_TITLES[route.params.slug] })} />
          </>
        ) : (
          <>
            {/* logo após o cadastro a 1ª rota da lista precisa ser a etapa pendente do onboarding (avatar, depois fotos):
                quando a pilha de auth some, o router cai na primeira rota disponível (initialRouteName só vale na montagem) */}
            {onboardingStep === 'avatar' ? (
              <Stack.Screen
                name="AvatarSetup"
                component={AvatarCustomizerScreen}
                options={{ ...dark, animation: 'fade' }}
                initialParams={{ fromOnboarding: true }}
              />
            ) : null}
            {onboardingStep === 'photo' ? (
              <Stack.Screen
                name="PhotoUpload"
                component={PhotoUploadScreen}
                options={{ ...dark, animation: 'fade' }}
                initialParams={{ fromOnboarding: true }}
              />
            ) : null}
            <Stack.Screen name="Main" component={MainTabs} options={{ ...light, animation: 'fade' }} />
            {onboardingStep !== 'avatar' ? (
              <Stack.Screen name="AvatarSetup" component={AvatarCustomizerScreen} options={{ ...dark, animation: 'slide_from_bottom' }} />
            ) : null}
            {onboardingStep !== 'photo' ? (
              <Stack.Screen name="PhotoUpload" component={PhotoUploadScreen} options={{ ...dark, animation: 'slide_from_bottom' }} />
            ) : null}
            <Stack.Screen name="UserCard" component={UserCardScreen} options={{ ...dark, animation: 'slide_from_bottom' }} />
            <Stack.Screen name="Boost" component={BoostScreen} options={{ ...dark, animation: 'slide_from_bottom' }} />
            <Stack.Screen name="PrivateAreas" component={PrivateAreasScreen} options={{ ...light, animation: 'slide_from_right' }} />
            <Stack.Screen name="Legal" component={LegalScreen} options={({ route }) => ({ ...lightHeader, title: LEGAL_TITLES[route.params.slug] })} />
            <Stack.Screen name="Help" component={HelpScreen} options={{ ...lightHeader, title: 'Ajuda e segurança' }} />
            <Stack.Screen name="BlockedUsers" component={BlockedUsersScreen} options={{ ...lightHeader, title: 'Pessoas bloqueadas' }} />
            <Stack.Screen name="Moderation" component={ModerationScreen} options={{ ...lightHeader, title: 'Moderação' }} />
            <Stack.Screen name="ModerationUser" component={ModerationUserScreen} options={{ ...lightHeader, title: 'Revisar conta' }} />
            <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ ...lightHeader, title: 'Avisos' }} />
            <Stack.Screen name="SupportChat" component={SupportChatScreen} options={{ ...lightHeader, title: 'Suporte' }} />
            <Stack.Screen name="DataExport" component={DataExportScreen} options={{ ...lightHeader, title: 'Baixar meus dados' }} />
            <Stack.Screen name="LocationHistory" component={LocationHistoryScreen} options={{ ...lightHeader, title: 'Histórico de localização' }} />
            <Stack.Screen name="DeleteAccount" component={DeleteAccountScreen} options={{ ...lightHeader, title: 'Excluir conta' }} />
            {__DEV__ ? <Stack.Screen name="AvatarGallery" getComponent={() => require('../screens/dev/AvatarGalleryScreen').AvatarGalleryScreen} options={{ ...dark, animation: 'none' }} getId={({ params }) => JSON.stringify(params ?? {})} /> : null}
          </>
        )}
      </Stack.Navigator>
      {/* aceite pendente dos Termos/Política trava o app logado até aceitar */}
      {isAuthenticated && !onboardingStep ? <TermsGate /> : null}
      {/* notificação nova com o app aberto: aviso rápido no topo (toque abre o destino) */}
      {isAuthenticated && !onboardingStep ? <InAppNoticeHost /> : null}
      {/* comemoração do match pra quem curtiu primeiro: fora da splash, do cadastro e dos Termos, depois do mapa */}
      {isAuthenticated && !onboardingStep ? (
        <MatchCelebrationHost ready={!splashing && !termsPending} mapReady={mapLoaded} />
      ) : null}
    </NavigationContainer>
  );
}
