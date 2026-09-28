// Socket.IO events — payload tipado cross-stack

import type { Message, Match } from '../match';
import type { NearbyUser, Hotspot } from '../location';
import type { AvatarConfig } from '../avatar';
import type { AccountBlockedError, PhotoStatus } from '../moderation';

export interface ServerToClientEvents {
  // Presença
  presence_updated: (data: { user: NearbyUser }) => void;
  presence_left: (data: { userId: string }) => void;
  hotspot_updated: (data: { poiId: number; userCount: number }) => void;
  hotspot_alert: (data: { poi: Hotspot['poi']; userCount: number }) => void;

  // Curtidas / Match
  like_received: (data: { fromUserId: string; isSuper: boolean }) => void;
  wave_received: (data: { fromUserId: string; name: string; avatar: AvatarConfig | null; at: string }) => void;
  match_created: (data: { match: Match }) => void;

  // Chat
  message_received: (data: { matchId: string; message: Message }) => void;
  message_delivered: (data: { clientId: string; messageId: string }) => void;
  message_read: (data: { matchId: string; messageIds: string[]; readAt: string }) => void;
  typing_indicator: (data: { matchId: string; userId: string; isTyping: boolean }) => void;
  chat_expiring: (data: { matchId: string; expiresAt: string; hoursRemaining: number }) => void;

  /** match acabou (bloqueio, desfeito, banimento): some da lista e o chat aberto fecha */
  match_closed: (data: { matchId: string }) => void;

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

  // Match
  join_match: (data: { matchId: string }) => void;
  leave_match: (data: { matchId: string }) => void;

  // Chat
  typing: (data: { matchId: string; isTyping: boolean }) => void;
  message_sent: (data: { matchId: string; clientId: string; content: string }) => void;

  // Heartbeat
  heartbeat: () => void;
}

export interface SocketErrorCode {
  INVALID_TOKEN: 4001;
  NO_PERMISSION: 4003;
  MATCH_EXPIRED: 4004;
  RATE_LIMIT: 4029;
  GENERIC: 4000;
}
