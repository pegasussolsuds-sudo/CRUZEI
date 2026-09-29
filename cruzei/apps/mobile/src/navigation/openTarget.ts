import type { QueryClient } from '@tanstack/react-query';
import type { ConversationDetail } from '@cruzei/shared-types';
import { api } from '../services/api';
import type { TargetRoute } from '../services/notificationTarget';
import { findSummary, inboxKeys } from '../hooks/useInbox';
import { useMapFocusStore } from '../stores/mapFocus';
import { navigationRef } from './navigationRef';
import { openChat } from './openChat';

/**
 * Abre o destino de um aviso (push, central ou aviso rápido). Tudo pela raiz com `pop`: volta pro Main/tela que já
 * existe em vez de empilhar outra. false = a navegação ainda não está pronta (quem chama guarda e tenta depois).
 */
export function openTargetRoute(route: TargetRoute, qc: QueryClient): boolean {
  if (!navigationRef.isReady()) return false;
  switch (route.screen) {
    case 'Map':
      navigationRef.navigate('Main', { screen: 'Map' }, { pop: true });
      // o mapa foca quando estiver pronto (no app frio ele ainda está nascendo por baixo da splash)
      if (route.focusPoiId != null) useMapFocusStore.getState().focus(route.focusPoiId);
      return true;
    case 'Likes':
      navigationRef.navigate('Main', { screen: 'Likes' }, { pop: true });
      return true;
    case 'Paywall':
      navigationRef.navigate('Main', { screen: 'Paywall' }, { pop: true });
      return true;
    case 'SupportChat':
      navigationRef.navigate('SupportChat', undefined, { pop: true });
      return true;
    case 'Notifications':
      navigationRef.navigate('Notifications', undefined, { pop: true });
      return true;
    case 'Chat':
      void openConversation(route.conversationId, qc);
      return true;
    default:
      return false;
  }
}

/** o chat precisa de quem está do outro lado (header e id da tela): cache das listas/detalhe, senão o servidor */
async function openConversation(conversationId: string, qc: QueryClient): Promise<void> {
  const cached = findSummary(qc, conversationId)?.item.peer ?? qc.getQueryData<ConversationDetail>(inboxKeys.conversation(conversationId))?.peer;
  if (cached) {
    openChat(cached, conversationId);
    return;
  }
  try {
    const detail = (await api.get<ConversationDetail>(`/conversations/${conversationId}`)).data;
    qc.setQueryData(inboxKeys.conversation(conversationId), detail);
    openChat(detail.peer, conversationId);
  } catch {
    // conversa que não existe mais (bloqueio, arquivo) ou sem rede: a lista de Mensagens
    if (navigationRef.isReady()) navigationRef.navigate('Main', { screen: 'Inbox', params: { screen: 'InboxList' } }, { pop: true });
  }
}
