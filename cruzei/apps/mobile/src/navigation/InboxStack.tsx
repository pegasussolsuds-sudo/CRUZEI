import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { InboxFolder } from '@cruzei/shared-types';

import { InboxScreen } from '../screens/inbox/InboxScreen';
import { ChatScreen } from '../screens/inbox/ChatScreen';
import type { ChatParams } from './openChat';
import { colors } from '@cruzei/ui-mobile';

export type InboxStackParamList = {
  /** folder: abre direto numa aba do segmentado (ex.: 'requests') */
  InboxList: { folder?: InboxFolder } | undefined;
  Chat: ChatParams;
};

const Stack = createNativeStackNavigator<InboxStackParamList>();

export function InboxStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.black },
        headerTintColor: colors.white,
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="InboxList" component={InboxScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="Chat"
        component={ChatScreen}
        // uma conversa por par: abrir o chat da mesma pessoa de outro lugar volta pra tela que já existe
        getId={({ params }) => params?.peer?.id}
        options={({ route }) => ({ title: route.params.peer.name })}
      />
    </Stack.Navigator>
  );
}
