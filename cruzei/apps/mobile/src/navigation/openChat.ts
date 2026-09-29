import type { AvatarConfig } from '@cruzei/shared-types';
import { navigationRef } from './navigationRef';

/** quem está do outro lado do chat (o suficiente pro header antes de a conversa carregar) */
export interface ChatPeer {
  id: string;
  name: string;
  /** avatar Metch (null/ausente → determinístico pelo id) */
  avatar?: AvatarConfig | null;
}

/**
 * Parâmetros da rota Chat. Sem conversationId o chat abre em modo rascunho: procura a conversa do par e, se não houver,
 * a 1ª mensagem cria (POST /conversations). Uma conversa por par → o peer.id identifica a tela (getId no InboxStack).
 */
export interface ChatParams {
  conversationId?: string;
  peer: ChatPeer;
}

/**
 * Abre o chat com a pessoa de qualquer lugar (mapa, cartão, modal do match, lista).
 * Vai pela raiz: `pop` volta pro Main em vez de empilhar outro (ex.: vindo do cartão), e `initial: false` deixa a lista
 * de Mensagens embaixo na pilha, então o chat ganha botão de voltar.
 */
export function openChat(peer: ChatPeer, conversationId?: string | null): void {
  if (!navigationRef.isReady()) return;
  const params: ChatParams = conversationId
    ? { conversationId, peer: { id: peer.id, name: peer.name, avatar: peer.avatar ?? null } }
    : { peer: { id: peer.id, name: peer.name, avatar: peer.avatar ?? null } };
  navigationRef.navigate('Main', { screen: 'Inbox', params: { screen: 'Chat', initial: false, params } }, { pop: true });
}
