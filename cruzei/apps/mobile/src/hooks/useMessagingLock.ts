import { useCallback } from 'react';
import { Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useLocationStore } from '../stores/location';
import { useAuthStore } from '../stores/auth';
import { toApiError } from '../services/api';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { useVisibility } from './useVisibility';

// No modo invisível, mandar/receber mensagens e curtir é do Premium. Quem garante é o servidor (403
// anonymous_requires_premium e nenhum evento de mensagem por socket); aqui o app só troca as telas de mensagem pelo
// convite e explica antes de curtir. premiumTier do /me já vem como 'free' quando a assinatura venceu.

/** invisível sem Premium: Mensagens e chat viram o convite, curtir abre a explicação (ficar visível ou assinar) */
export function useMessagingLocked(): boolean {
  const isAnonymous = useLocationStore((s) => s.isAnonymous);
  const tier = useAuthStore((s) => s.user?.premiumTier ?? 'free');
  return isAnonymous && tier === 'free';
}

/** o servidor recusou porque a pessoa está invisível sem Premium (o estado local estava velho) */
export function isMessagingLockedError(err: unknown): boolean {
  return toApiError(err).error === 'anonymous_requires_premium';
}

/**
 * Invisível sem Premium tentou curtir: explica e oferece ficar visível ou ver o Premium. Chamar também quando o servidor
 * responder anonymous_requires_premium (o /me é atualizado junto, pra tela parar de oferecer a curtida).
 */
export function useInvisibleLikePrompt(): (fromServer?: boolean) => void {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { toggle } = useVisibility();
  return useCallback(
    (fromServer = false) => {
      if (fromServer) useAuthStore.getState().refreshMe().catch(() => {});
      Alert.alert(
        'Você está invisível',
        'No modo invisível, curtir e mandar mensagem é do Premium. Fica visível pra curtir agora, ou vira Premium pra curtir sem aparecer.',
        [
          { text: 'Agora não', style: 'cancel' },
          { text: 'Ver Premium', onPress: () => nav.navigate('Main', { screen: 'Paywall' }) },
          { text: 'Ficar visível', onPress: toggle },
        ],
      );
    },
    [nav, toggle],
  );
}
