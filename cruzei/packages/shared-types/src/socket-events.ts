// Tipos de eventos socket compartilhados cliente/server.
// Fica em shared-types pra evitar drift entre apps.

export interface ClientToServerEvents {
  join_match: (payload: { matchId: string }) => void;
  leave_match: (payload: { matchId: string }) => void;
  typing_start: (payload: { matchId: string }) => void;
  typing_stop: (payload: { matchId: string }) => void;
}

export interface ServerToClientEvents {
  message_received: (payload: { matchId: string; message: ServerMessage }) => void;
  user_typing: (payload: { matchId: string; userId: string; isTyping: boolean }) => void;
  presence_update: (payload: { userId: string; latitude: number; longitude: number }) => void;
  match_created: (payload: { matchId: string }) => void;
  like_received: (payload: { fromUserId: string }) => void;
}

export interface ServerMessage {
  id: string;
  matchId: string;
  senderId: string;
  type: 'text' | 'photo_temp' | 'audio' | 'location' | 'gif' | 'system';
  content: string | null;
  mediaUrl: string | null;
  mediaExpiresAt: string | null;
  lat: number | null;
  lng: number | null;
  readAt: string | null;
  createdAt: string;
}
