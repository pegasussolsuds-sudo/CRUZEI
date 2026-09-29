// Socket.IO events — payload tipado cross-stack

import type {
  ConversationNewPayload,
  ConversationPromotedPayload,
  ConversationRemovedPayload,
  MessageNewPayload,
  MessageReadPayload,
} from '../conversation';
import type { NearbyUser, Hotspot } from '../location';
import type { AvatarConfig } from '../avatar';
import type { AccountBlockedError, PhotoStatus } from '../moderation';

export interface ServerToClientEvents {
  // Presença
  presence_updated: (data: { user: NearbyUser }) => void;
  presence_left: (data: { userId: string }) => void;
  hotspot_updated: (data: { poiId: number; userCount: number }) => void;
  hotspot_alert: (data: { poi: Hotspot['poi']; userCount: number }) => void;

  // Curtidas
  /**
   * isMutual: essa curtida fechou o par (os dois se curtiram). fromUserId só vem pra Premium+ vigente ou na curtida
   * mútua; pros demais o evento é só o sinal, sem quem curtiu
   */
  like_received: (data: { fromUserId?: string; isSuper: boolean; isMutual?: boolean }) => void;
  wave_received: (data: { fromUserId: string; name: string; avatar: AvatarConfig | null; at: string }) => void;

  // Conversas (salas user:<id>, só o par; emitidos depois do commit)
  /** conversa criada agora (um emit por lado) */
  'conversation:new': (data: ConversationNewPayload) => void;
  /** a conversa foi para a principal agora */
  'conversation:promoted': (data: ConversationPromotedPayload) => void;
  /** mensagem nova (inclui a de sistema); unreadCount é o de quem recebe o evento */
  'message:new': (data: MessageNewPayload) => void;
  /** alguém leu até upToMessageId */
  'message:read': (data: MessageReadPayload) => void;
  /** bloqueio/banimento/arquivamento: some da lista e o chat aberto fecha */
  'conversation:removed': (data: ConversationRemovedPayload) => void;
  /** "digitando" (sala conv:<id>) */
  typing_indicator: (data: { conversationId: string; userId: string; isTyping: boolean }) => void;

  // Moderação
  /** a conta foi suspensa/banida agora (o socket cai logo depois) */
  account_blocked: (data: AccountBlockedError) => void;
  /** advertência da moderação */
  account_notice: (data: { kind: 'warning'; message: string }) => void;
  /** uma foto minha foi aprovada/recusada */
  photo_moderated: (data: { photoId: string; status: PhotoStatus; reason: string | null }) => void;

  // Online status
  user_online: (data: { userId: string }) => void;
  user_offline: (data: { userId: string }) => void;

  // Erro
  error: (data: { code: number; message: string }) => void;
}

export interface ClientToServerEvents {
  // Presença
  join_presence: (data: { city: string; geohash: string; radiusM: number }) => void;
  leave_presence: () => void;

  // Conversa (sala conv:<id>, só para o "digitando"; exige membro não arquivado e sem Block)
  join_conversation: (data: { conversationId: string }) => void;
  leave_conversation: (data: { conversationId: string }) => void;
  typing: (data: { conversationId: string; isTyping: boolean }) => void;

  // Heartbeat
  heartbeat: () => void;
}

export interface SocketErrorCode {
  INVALID_TOKEN: 4001;
  NO_PERMISSION: 4003;
  RATE_LIMIT: 4029;
  GENERIC: 4000;
}
