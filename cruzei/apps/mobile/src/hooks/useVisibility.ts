import { useCallback } from 'react';
import { Alert } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';
import { useLocationStore } from '../stores/location';
import { useAuthStore } from '../stores/auth';
import { inboxKeys } from './useInbox';

/** resposta do PATCH /me/settings com visibilityMode */
interface VisibilityResult {
  anonymousUntil?: string | null;
}

// Alterna visível/anônimo: atualiza o servidor, o store local e o cache do perfil.
// Invisível grátis: 24 h por vez (o servidor grava o prazo e volta ao visível sozinho); dá pra religar quando quiser.
export function useVisibility() {
  const qc = useQueryClient();
  const isAnonymous = useLocationStore((s) => s.isAnonymous);
  const setAnonymous = useLocationStore((s) => s.setAnonymous);
  const refreshMe = useAuthStore((s) => s.refreshMe);
  const isFree = useAuthStore((s) => (s.user?.premiumTier ?? 'free') === 'free');
  /** fim da janela do invisível grátis (null: visível ou Premium, sem prazo) */
  const anonymousUntil = useAuthStore((s) => s.user?.settings?.anonymousUntil ?? null);

  const mutation = useMutation({
    mutationFn: async (next: boolean) => {
      const res = await api.patch<VisibilityResult>('/me/settings', { visibilityMode: next ? 'anonymous' : 'visible' });
      return { next, anonymousUntil: res.data?.anonymousUntil ?? null };
    },
    onMutate: (next) => setAnonymous(next),
    onError: (_e, next) => setAnonymous(!next),
    onSuccess: async ({ next, anonymousUntil: until }) => {
      // o prazo aparece no banner na hora, sem esperar o /me novo
      const { user, setUser } = useAuthStore.getState();
      if (user?.settings) {
        setUser({
          ...user,
          settings: { ...user.settings, visibilityMode: next ? 'anonymous' : 'visible', anonymousUntil: next ? until : null },
        });
      }
      await qc.invalidateQueries({ queryKey: ['me'] });
      await qc.invalidateQueries({ queryKey: ['nearby'] });
      // invisível sem Premium não recebe mensagens (ficam guardadas no servidor): ao voltar, listas e chats buscam de novo
      await qc.invalidateQueries({ queryKey: inboxKeys.all });
      await qc.invalidateQueries({ queryKey: ['conversation'] });
      await qc.invalidateQueries({ queryKey: ['messages'] });
      refreshMe().catch(() => {});
    },
  });

  const toggle = useCallback(() => mutation.mutate(!isAnonymous), [mutation, isAnonymous]);

  /** desligar é direto; ligar explica antes o que muda (prazo e mensagens no plano grátis) */
  const askToggle = useCallback(() => {
    if (isAnonymous) {
      toggle();
      return;
    }
    Alert.alert(
      'Quer ver sem aparecer?',
      isFree
        ? 'No modo invisível você vê todo mundo, mas ninguém sabe que é você: seu perfil some do mapa e ninguém te curte (quem é Premium só vê que tem alguém invisível por perto, nunca quem). No plano grátis vale por 24 h: depois você volta pro mapa sozinho (a gente avisa) e pode ligar de novo quando quiser. Enquanto estiver invisível, ficam pausados curtir e as mensagens: você não curte, não manda nem recebe mensagem até voltar a ficar visível (nada se perde). No Premium é sem limite e dá pra curtir e conversar invisível.'
        : 'No modo invisível você vê todo mundo, mas ninguém sabe que é você: seu perfil some do mapa e ninguém te curte (quem é Premium só vê que tem alguém invisível por perto, nunca quem). No Premium não tem prazo e suas conversas continuam normais.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Ficar invisível', onPress: toggle },
      ],
    );
  }, [isAnonymous, isFree, toggle]);

  return {
    isAnonymous,
    /** fim da janela do invisível grátis (ISO) ou null */
    anonymousUntil: isAnonymous ? anonymousUntil : null,
    toggle,
    askToggle,
    isPending: mutation.isPending,
  };
}
