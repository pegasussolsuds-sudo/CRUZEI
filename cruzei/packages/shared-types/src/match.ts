// Match + Chat

export type MatchStatus = 'active' | 'expired' | 'unmatched' | 'blocked';
export type MessageType = 'text' | 'photo_temp' | 'audio' | 'location' | 'gif' | 'system';

export interface Match {
  id: string;
  user: {
    id: string;
    name: string;
    age: number;
    mainPhotoUrl: string | null;
  };
  context: string | null;
  poiName: string | null;
  chatExpiresAt: string;
  lastMessage: {
    content: string;
    senderId: string;
    createdAt: string;
  } | null;
  unreadCount: number;
  matchedAt: string;
}

export interface MatchDetail extends Match {
  status: MatchStatus;
  poi: {
    id: number;
    name: string;
    address: string | null;
  } | null;
}

export interface Message {
  id: string;
  matchId: string;
  senderId: string;
  type: MessageType;
  content: string | null;
  mediaUrl: string | null;
  mediaExpiresAt: string | null;
  readAt: string | null;
  createdAt: string;
  // client_id pra reconciliação otimista no mobile
  clientId?: string;
}

export interface SendMessagePayload {
  type: MessageType;
  content?: string;
  clientId: string;
}

export interface LikeResult {
  likeId: string;
  isMatch: boolean;
  matchId?: string;
  context?: string;
  chatExpiresAt?: string;
  remainingToday: number;
}
