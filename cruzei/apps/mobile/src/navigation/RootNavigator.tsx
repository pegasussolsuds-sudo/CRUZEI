import type { ProximityBand } from '@cruzei/shared-types';
import React from 'react';
import { NavigationContainer, type NavigatorScreenParams } from '@react-navigation/native';
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
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const dark = { headerShown: false, contentStyle: { backgroundColor: colors.black } } as const;
const light = { headerShown: false, contentStyle: { backgroundColor: colors.background } } as const;

export function RootNavigator() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const onboardingStep = useAuthStore((s) => s.onboardingStep);

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.black }}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <NavigationContainer>
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
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
