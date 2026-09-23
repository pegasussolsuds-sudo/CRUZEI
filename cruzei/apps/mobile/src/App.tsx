import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { RootNavigator } from './navigation/RootNavigator';
import { useAuthStore } from './stores/auth';
import { useLocationStore } from './stores/location';
import { connectSocket, disconnectSocket } from './services/socket';

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

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <SafeAreaProvider>
          <StatusBar style={isAuthenticated ? 'dark' : 'light'} />
          <RootNavigator />
        </SafeAreaProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}

export default App;
