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
import type { MatchCelebration } from '../like';
import type { AccountChangedPayload } from '../user';
import type { AccountBlockedError, PhotoStatus } from '../moderation';
import type { NotificationNewPayload } from '../notifications';
import type { SupportMessageEvent, SupportThreadEvent, SupportTypingEvent, SupportUrgentEvent } from '../support';

export interface ServerToClientEvents {
  // Presença
  presence_updated: (data: { user: NearbyUser }) => void;
  presence_left: (data: { userId: string }) => void;
  hotspot_updated: (data: { poiId: number; userCount: number }) => void;
  hotspot_alert: (data: { poi: Hotspot['poi']; userCount: number }) => void;

  // Curtidas
  /**
   * isMutual: essa curtida fechou o par (os dois se curtiram). fromUserId só vem pra Premium+ vigente, na curtida
   * mútua ou na SUPER curtida (a super revela quem mandou pra todo mundo); pros demais o evento é só o sinal. Quem
   * curtiu invisível ou em análise nunca vai no fromUserId.
   */
  like_received: (data: { fromUserId?: string; isSuper: boolean; isMutual?: boolean }) => void;
  /** match fechado agora: só pra QUEM RECEBE (curtiu primeiro); também fica pendente em GET /likes/matches/pending */
  'match:new': (data: MatchCelebration) => void;
  wave_received: (data: { fromUserId: string; name: string; avatar: AvatarConfig | null; at: string }) => void;

  // Conta
  /** a própria conta mudou (Premium dado/tirado/vencido, invisível voltou ao visível): busca o /me de novo */
  'account:changed': (data: AccountChangedPayload) => void;

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

  // Central de avisos (sala user:<id>): aviso novo na hora, sem esperar o push
  'notification:new': (data: NotificationNewPayload) => void;

  // Suporte ao vivo
  /** app: só as mensagens do MEU atendimento, sem nota interna; painel (sala staff:support): todas */
  'support:message': (data: SupportMessageEvent) => void;
  /** só o painel (sala staff:support): a fila mudou */
  'support:thread': (data: SupportThreadEvent) => void;
  /** o outro lado está digitando */
  'support:typing': (data: SupportTypingEvent) => void;
  /** só o painel (sala staff:support): alguém apertou o botão de emergência — alerta ao vivo (som + selo vermelho) */
  'support:urgent': (data: SupportUrgentEvent) => void;

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

  // Suporte: o app manda só {isTyping} (vai pro atendimento aberto dele); o painel manda {threadId, isTyping}
  'support:typing': (data: { isTyping: boolean; threadId?: string }) => void;

  // Heartbeat
  heartbeat: () => void;
}

export interface SocketErrorCode {
  INVALID_TOKEN: 4001;
  NO_PERMISSION: 4003;
  RATE_LIMIT: 4029;
  GENERIC: 4000;
}
