import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { NavigatorScreenParams } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';

import { MapScreen } from '../screens/map/MapScreen';
import { LikesScreen } from '../screens/likes/LikesScreen';
import { PaywallScreen } from '../screens/paywall/PaywallScreen';
import { MatchesStack, type MatchesStackParamList } from './MatchesStack';
import { ProfileStack, type ProfileStackParamList } from './ProfileStack';
import { api } from '../services/api';
import { colors } from '@cruzei/ui-mobile';
import type { Match } from '@cruzei/shared-types';

export type MainTabParamList = {
  Map: undefined;
  Likes: undefined;
  Matches: NavigatorScreenParams<MatchesStackParamList>;
  Paywall: undefined;
  Profile: NavigatorScreenParams<ProfileStackParamList>;
};

const Tab = createBottomTabNavigator<MainTabParamList>();

export function MainTabs() {
  // badge de não lidas na aba Matches (mesma query da lista → sem request extra)
  const matches = useQuery({
    queryKey: ['matches'],
    queryFn: async () => (await api.get<Match[]>('/matches')).data,
    refetchInterval: 30_000,
  });
  const unread = (matches.data ?? []).reduce((n, m) => n + (m.unreadCount ?? 0), 0);

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.gray[400],
        tabBarStyle: {
          backgroundColor: colors.black,
          borderTopColor: colors.gray[800],
          height: 64,
          paddingBottom: 8,
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
      <Tab.Screen name="Likes" component={LikesScreen} options={{ tabBarLabel: 'Curtidas' }} />
      <Tab.Screen
        name="Matches"
        component={MatchesStack}
        options={{
          tabBarLabel: 'Matches',
          tabBarBadge: unread > 0 ? unread : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.primary, color: colors.black, fontWeight: '800' },
        }}
      />
      <Tab.Screen name="Paywall" component={PaywallScreen} options={{ tabBarLabel: 'Premium' }} />
      <Tab.Screen name="Profile" component={ProfileStack} options={{ tabBarLabel: 'Perfil' }} />
    </Tab.Navigator>
  );
}

const ICONS: Record<string, string> = {
  Map: 'map',
  Likes: 'heart',
  Matches: 'chatbubble',
  Paywall: 'diamond',
  Profile: 'person',
};
