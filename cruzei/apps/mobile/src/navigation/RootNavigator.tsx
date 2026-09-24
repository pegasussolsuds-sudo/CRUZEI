import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, View } from 'react-native';

import { useAuthStore } from '../stores/auth';
import { WelcomeScreen } from '../screens/auth/WelcomeScreen';
import { PhoneScreen } from '../screens/auth/PhoneScreen';
import { CodeScreen } from '../screens/auth/CodeScreen';
import { ProfileSetupScreen } from '../screens/auth/ProfileSetupScreen';
import { PhotoUploadScreen } from '../screens/auth/PhotoUploadScreen';
import { UserCardScreen } from '../screens/users/UserCardScreen';
import { BoostScreen } from '../screens/boost/BoostScreen';
import { MainTabs } from './MainTabs';
import { colors } from '@cruzei/ui-mobile';

export type RootStackParamList = {
  Onboarding: undefined; // WelcomeScreen
  Login: undefined; // PhoneScreen
  Code: { phone: string; devCode?: string | null; expiresIn?: number }; // CodeScreen (OTP)
  Register: { phone: string }; // ProfileSetupScreen
  Main: undefined;
  PhotoUpload: { fromOnboarding?: boolean }; // pós-cadastro ou vindo do perfil
  UserCard: { userId: string; distanceM?: number | null }; // perfil de outra pessoa
  Boost: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const dark = { headerShown: false, contentStyle: { backgroundColor: colors.black } } as const;
const light = { headerShown: false, contentStyle: { backgroundColor: colors.background } } as const;

export function RootNavigator() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const pendingPhotoOnboarding = useAuthStore((s) => s.pendingPhotoOnboarding);

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
        // logo após o cadastro entra pela tela de fotos; nas demais aberturas, direto no mapa
        initialRouteName={isAuthenticated && pendingPhotoOnboarding ? 'PhotoUpload' : isAuthenticated ? 'Main' : 'Onboarding'}
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
            {/* logo após o cadastro a 1ª rota da lista precisa ser a de fotos: quando a pilha de auth some,
                o router cai na primeira rota disponível (initialRouteName só vale na montagem) */}
            {pendingPhotoOnboarding ? (
              <Stack.Screen name="PhotoUpload" component={PhotoUploadScreen} options={{ ...dark, animation: 'fade' }} />
            ) : null}
            <Stack.Screen name="Main" component={MainTabs} options={{ ...light, animation: 'fade' }} />
            {!pendingPhotoOnboarding ? (
              <Stack.Screen name="PhotoUpload" component={PhotoUploadScreen} options={{ ...dark, animation: 'slide_from_bottom' }} />
            ) : null}
            <Stack.Screen name="UserCard" component={UserCardScreen} options={{ ...dark, animation: 'slide_from_bottom' }} />
            <Stack.Screen name="Boost" component={BoostScreen} options={{ ...dark, animation: 'slide_from_bottom' }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
