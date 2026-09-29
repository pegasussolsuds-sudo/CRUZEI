import type { LegalSlug, ProximityBand } from '@cruzei/shared-types';
import React, { useCallback, useState } from 'react';
import { NavigationContainer, useNavigationContainerRef, type NavigatorScreenParams } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, View } from 'react-native';

import { useAuthStore } from '../stores/auth';
import { WelcomeScreen } from '../screens/auth/WelcomeScreen';
import { PhoneScreen } from '../screens/auth/PhoneScreen';
import { CodeScreen } from '../screens/auth/CodeScreen';
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
import { AccountBlockedScreen } from '../components/safety/AccountBlockedScreen';
import { TermsGate } from '../components/legal/TermsGate';
import { useAccountBlockStore } from '../stores/accountBlock';
import { useMapTheme } from '../hooks/useMapTheme';
import { MainTabs, type MainTabParamList } from './MainTabs';
import { colors } from '@cruzei/ui-mobile';

export type RootStackParamList = {
  Onboarding: undefined; // WelcomeScreen
  Login: undefined; // PhoneScreen
  Code: { phone: string; devCode?: string | null; expiresIn?: number }; // CodeScreen (OTP)
  Register: { phone: string }; // ProfileSetupScreen
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

// rotas com fundo/header escuro (inclusive aninhadas: Paywall é aba, Chat está no MatchesStack) → ícones claros na status bar
const DARK_ROUTES = new Set(['UserCard', 'Boost', 'AvatarSetup', 'PhotoUpload', 'Paywall', 'Chat']);

export function RootNavigator({ splashing = false }: { splashing?: boolean }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const onboardingStep = useAuthStore((s) => s.onboardingStep);
  const blocked = useAccountBlockStore((s) => s.blocked);
  const navRef = useNavigationContainerRef<RootStackParamList>();
  const [routeName, setRouteName] = useState<string | undefined>();
  const syncRoute = useCallback(() => setRouteName(navRef.getCurrentRoute()?.name), [navRef]);
  const { theme: mapTheme } = useMapTheme();

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
    <NavigationContainer ref={navRef} onReady={syncRoute} onStateChange={syncRoute}>
      <StatusBar style={barStyle} />
      <Stack.Navigator
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
          </>
        )}
      </Stack.Navigator>
      {/* aceite pendente dos Termos/Política trava o app logado até aceitar */}
      {isAuthenticated && !onboardingStep ? <TermsGate /> : null}
    </NavigationContainer>
  );
}
