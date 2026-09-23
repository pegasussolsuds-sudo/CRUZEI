import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { MatchesScreen } from '../screens/matches/MatchesScreen';
import { ChatScreen } from '../screens/matches/ChatScreen';
import { colors } from '@cruzei/ui-mobile';

export type MatchesStackParamList = {
  MatchesList: undefined;
  Chat: { matchId: string; name: string };
};

const Stack = createNativeStackNavigator<MatchesStackParamList>();

export function MatchesStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.black },
        headerTintColor: colors.white,
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="MatchesList" component={MatchesScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Chat" component={ChatScreen} options={({ route }) => ({ title: route.params.name })} />
    </Stack.Navigator>
  );
}
