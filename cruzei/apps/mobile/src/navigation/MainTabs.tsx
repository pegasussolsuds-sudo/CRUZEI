import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { NavigatorScreenParams } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MapScreen } from '../screens/map/MapScreen';
import { LikesScreen } from '../screens/likes/LikesScreen';
import { PaywallScreen } from '../screens/paywall/PaywallScreen';
import { InboxStack, type InboxStackParamList } from './InboxStack';
import { ProfileStack, type ProfileStackParamList } from './ProfileStack';
import { inboxBadge, useInboxCounts } from '../hooks/useInbox';
import { unreadNotifications, useNotificationList } from '../hooks/useNotifications';
import { colors } from '@cruzei/ui-mobile';

export type MainTabParamList = {
  Map: undefined;
  Likes: undefined;
  Inbox: NavigatorScreenParams<InboxStackParamList>;
  Paywall: undefined;
  Profile: NavigatorScreenParams<ProfileStackParamList>;
};

const Tab = createBottomTabNavigator<MainTabParamList>();

// Abas fora da tela congeladas (freezeOnBlur, react-native-screens): com o mapa aberto, mensagem chegando, /me novo,
// posição mudando ou plano atualizando não re-renderizam Curtidas, Mensagens (com o chat aberto dentro), Premium e
// Perfil escondidos — elas desenham uma vez, com o estado final, quando voltam pra frente. O congelamento espera um
// render depois de sair da frente, então quem pausa com useIsFocused (palco do avatar, polling) ainda vê o false.
// O mapa não congela: ele é a aba principal e o motor nativo conversa com a tela por eventos.

export function MainTabs() {
  // iPhone com home indicator: soma o inset (no Android sem edge-to-edge é 0 → mesmo layout de antes)
  const insets = useSafeAreaInsets();
  // badge da aba Mensagens: contagem do servidor (principal com não lidas + solicitações), nunca somada no app
  const counts = useInboxCounts();
  const badge = inboxBadge(counts.data);
  // aviso não lido: só um ponto no Perfil (a central e o sininho ficam lá; nada por cima do mapa)
  const notifications = useNotificationList();
  const unreadNotices = unreadNotifications(notifications.data);

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.gray[400],
        tabBarStyle: {
          backgroundColor: colors.black,
          borderTopColor: colors.gray[800],
          height: 64 + insets.bottom,
          paddingBottom: 8 + insets.bottom,
          paddingTop: 6,
        },
        tabBarIcon: ({ color, size, focused }) => {
          const base = ICONS[route.name] ?? 'ellipse';
          const icon = focused ? base : `${base}-outline`;
          return <Ionicons name={icon as never} size={size ?? 24} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Map" component={MapScreen} options={{ tabBarLabel: 'Mapa' }} />
      <Tab.Screen name="Likes" component={LikesScreen} options={{ tabBarLabel: 'Curtidas', freezeOnBlur: true }} />
      <Tab.Screen
        name="Inbox"
        component={InboxStack}
        options={{
          tabBarLabel: 'Mensagens',
          freezeOnBlur: true,
          tabBarBadge: badge > 0 ? (badge > 99 ? '99+' : badge) : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.primary, color: colors.black, fontWeight: '800' },
          tabBarAccessibilityLabel: badge > 0 ? `Mensagens, ${badge} novas` : 'Mensagens',
        }}
      />
      <Tab.Screen name="Paywall" component={PaywallScreen} options={{ tabBarLabel: 'Premium', freezeOnBlur: true }} />
      <Tab.Screen
        name="Profile"
        component={ProfileStack}
        options={{
          tabBarLabel: 'Perfil',
          freezeOnBlur: true,
          tabBarBadge: unreadNotices > 0 ? '' : undefined,
          tabBarBadgeStyle: styles.dot,
          tabBarAccessibilityLabel: unreadNotices > 0 ? `Perfil, ${unreadNotices} ${unreadNotices === 1 ? 'aviso novo' : 'avisos novos'}` : 'Perfil',
        }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  // ponto (badge vazio): menor que o contador das Mensagens
  dot: { minWidth: 10, width: 10, height: 10, borderRadius: 5, paddingHorizontal: 0, backgroundColor: colors.primary, top: 0, end: 0 },
});

const ICONS: Record<string, string> = {
  Map: 'map',
  Likes: 'heart',
  Inbox: 'chatbubble',
  Paywall: 'diamond',
  Profile: 'person',
};
