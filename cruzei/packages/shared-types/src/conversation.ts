import type { AvatarConfig } from './avatar';
// Conversas: Principal + Solicitações (substitui Match/Message)
// O chat nunca é bloqueado; muda só ONDE a conversa aparece.

/** pasta que o app mostra (ponto de vista de quem consulta) */
export type InboxFolder = 'inbox' | 'requests';

/** rota da conversa (fato do par, igual para os dois): principal se promovida, senão solicitação */
export type RouteFolder = 'principal' | 'request';

/** por que a conversa foi para a principal */
export type PromoteReason = 'mutual' | 'bounce' | 'manual';

/** REQUESTER = quem mandou a 1ª mensagem; RECIPIENT = quem recebeu */
export type MemberRole = 'REQUESTER' | 'RECIPIENT';

/** derivado das duas linhas de Like (eu→outro, outro→eu); não é gravado */
export type LikeStatus = 'NONE' | 'SENT' | 'RECEIVED' | 'MUTUAL';

/** tipo da mensagem (enum message_type do banco) */
export type MessageType = 'text' | 'photo_temp' | 'audio' | 'location' | 'gif' | 'system';

/** mensagens de sistema conhecidas (única por conversa: UNIQUE(conversation_id, system_kind)) */
export type SystemMessageKind = 'mutual_like';

export interface ChatMessage {
  id: string;
  conversationId: string;
  /** na mensagem de sistema, é quem disparou o evento (ex.: a curtida que fechou o par) */
  senderId: string;
  body: string | null;
  mediaUrl: string | null;
  createdAt: string;
  readAt: string | null;
  /** preenchido só quando messageType = 'system' */
  systemKind: SystemMessageKind | null;
  messageType: MessageType;
}

/** mensagem ecoada para quem enviou: clientId faz a reconciliação otimista no app */
export type ChatMessageWithClientId = ChatMessage & { clientId?: string };

export interface ConversationPeer {
  id: string;
  name: string;
  age?: number;
  /** avatar Metch (null → o app gera um determinístico a partir do id) */
  avatar: AvatarConfig | null;
  /** foto principal aprovada; null quando não há (ou quando o par está bloqueado) */
  mainPhotoUrl: string | null;
  isOnline?: boolean;
}

export interface ConversationSummary {
  id: string;
  peer: ConversationPeer;
  /** pasta de quem consulta: folderFor(myRole, route) */
  folder: InboxFolder;
  /** rota do par (principal/solicitação), independente de quem consulta */
  route: RouteFolder;
  myRole: MemberRole;
  /** eu mandei a 1ª mensagem e a conversa ainda não foi promovida (selo "aguardando resposta") */
  awaitingReply: boolean;
  lastMessage: ChatMessage | null;
  lastMessageAt: string | null;
  /** vem de ConversationMember.unread_count (nunca calculado no app) */
  unreadCount: number;
  isMuted: boolean;
  promotedAt: string | null;
  promotedReason: PromoteReason | null;
  likeStatus: LikeStatus;
}

export interface ConversationDetail extends ConversationSummary {
  createdAt: string;
  /** arquivada por mim (ou por bloqueio); some das listas */
  archivedAt: string | null;
  /** só para o REQUESTER aguardando resposta: quantas mensagens ainda pode mandar; null = sem limite */
  requestMessagesLeft?: number | null;
}

/** badges da aba Mensagens (contagem de conversas, não de mensagens) */
export interface InboxCounts {
  /** conversas da Principal com unreadCount > 0 */
  unreadInbox: number;
  /** solicitações recebidas ativas (pasta requests, não arquivadas) */
  requests: number;
  /** solicitações com unreadCount > 0 */
  unreadRequests: number;
}

/** página por cursor (last_message_at desc) */
export interface InboxPage<T> {
  items: T[];
  /** null = acabou */
  nextCursor: string | null;
}

/** GET /inbox e GET /inbox/requests */
export interface InboxListResponse extends InboxPage<ConversationSummary> {
  counts: InboxCounts;
}

/** conversa do par vista por quem consulta: id + pasta em que ela aparece pra MIM (cartão, mapa e GET /conversations/with/:userId) */
export interface ConversationRef {
  id: string;
  folder: InboxFolder;
}

// REST

/** POST /conversations */
export interface CreateConversationRequest {
  toUserId: string;
  body: string;
  clientId?: string;
}

export interface CreateConversationResponse {
  conversation: ConversationSummary;
  message: ChatMessageWithClientId;
}

/** POST /conversations/:id/messages → ChatMessageWithClientId */
export interface SendChatMessageRequest {
  body: string;
  clientId?: string;
}

/** POST /conversations/:id/read */
export interface MarkConversationReadRequest {
  /** sem ele, marca até a última mensagem do outro */
  upToMessageId?: string;
}

/** PATCH /conversations/:id */
export interface UpdateConversationRequest {
  isMuted?: boolean;
  archived?: boolean;
}

/** GET /conversations/with/:userId */
export type ConversationLookupResponse = ConversationRef | null;

// Limites (backend aplica; o app só usa para texto/UX)
export const INBOX_LIMITS = {
  /** tamanho máximo do corpo da mensagem */
  messageBodyMax: 500,
  /** mensagens do REQUESTER até a primeira resposta */
  requesterMessagesBeforeReply: 3,
  /** conversas novas por dia por remetente */
  newConversationsPerDay: 30,
  /** mensagens por minuto no mesmo par */
  perPairPerMinute: 15,
  /** mensagens por minuto por remetente */
  perSenderPerMinute: 30,
  /** página máxima do histórico */
  historyPageMax: 100,
} as const;

// Socket (salas user:<id>, só para os dois membros; emitidos depois do commit)

export const INBOX_EVENTS = {
  conversationNew: 'conversation:new',
  conversationPromoted: 'conversation:promoted',
  messageNew: 'message:new',
  messageRead: 'message:read',
  conversationRemoved: 'conversation:removed',
} as const;

export type InboxEventName = (typeof INBOX_EVENTS)[keyof typeof INBOX_EVENTS];

/** 'conversation:new' (um emit por lado: pasta/peer/unread mudam por lado) */
export interface ConversationNewPayload {
  conversation: ConversationSummary;
}

/** 'conversation:promoted' (só quando a promoção aconteceu agora) */
export interface ConversationPromotedPayload {
  conversationId: string;
  reason: PromoteReason;
  promotedAt: string;
}

/** 'message:new' (um emit por lado; unreadCount é o de quem recebe o evento) */
export interface MessageNewPayload {
  conversationId: string;
  message: ChatMessageWithClientId;
  unreadCount: number;
}

/** 'message:read' (para os dois: zera o badge nos outros aparelhos de quem leu) */
export interface MessageReadPayload {
  conversationId: string;
  readerId: string;
  upToMessageId: string | null;
  readAt: string;
}

/** 'conversation:removed' (bloqueio, arquivamento pela moderação, banimento): some da lista e o chat aberto fecha */
export interface ConversationRemovedPayload {
  conversationId: string;
}
