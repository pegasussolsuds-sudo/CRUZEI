// Linhas do banco → contratos da API (ConversationSummary, ChatMessage). PURO: sem Prisma e sem Nest.
// A pasta sai da promoção GRAVADA (promotedAt) e do papel de quem consulta (folderFor); nada é calculado no app.
import type {
  ChatMessage,
  ConversationSummary,
  MessageType,
  PromoteReason,
  SystemMessageKind,
} from '@cruzei/shared-types';

import { avatarOrFallback } from '../../common/avatar';
import { photoUrl } from '../../common/photo-url';
import { seesLikesReceived, visibleLikeStatus } from '../location/peer-social';

import {
  awaitingReply,
  folderFor,
  type ConversationFacts,
  type MemberRole,
  type RouteFolder,
} from './routing';

/** texto da mensagem de sistema da curtida mútua (única por conversa: UNIQUE(conversation_id, system_kind)) */
export const MUTUAL_LIKE_TEXT = 'Vocês se curtiram. A conversa foi movida para a principal.';

/** linha de mensagem como o Prisma devolve (body = coluna content) */
export interface MessageRow {
  id: string;
  conversationId: string;
  senderId: string;
  body: string | null;
  mediaUrl: string | null;
  messageType: string;
  systemKind: string | null;
  readAt: Date | null;
  createdAt: Date;
  /** id que o app gerou no envio (ausente nas consultas que não precisam dele) */
  clientId?: string | null;
}

/**
 * Linha → ChatMessage. `viewerId` = quem vai receber o objeto: o clientId só vai pra quem ENVIOU a mensagem
 * (reconciliação do balão otimista no app); pro outro lado ele nem aparece.
 */
export function toChatMessage(m: MessageRow, viewerId?: string): ChatMessage {
  const out: ChatMessage = {
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    body: m.body,
    mediaUrl: m.mediaUrl,
    createdAt: m.createdAt.toISOString(),
    readAt: m.readAt?.toISOString() ?? null,
    systemKind: (m.systemKind as SystemMessageKind | null) ?? null,
    messageType: m.messageType as MessageType,
  };
  if (m.clientId && viewerId && m.senderId === viewerId) out.clientId = m.clientId;
  return out;
}

/** linha da consulta de resumo (inbox.queries.ts): a conversa vista por UM membro */
export interface SummaryRow {
  id: string;
  created_at: Date;
  promoted_at: Date | null;
  promoted_reason: string | null;
  last_message_at: Date | null;
  /** chave de ordenação exata (texto com microssegundos) — vai no cursor */
  sort_key: string;
  my_role: MemberRole;
  unread_count: number;
  is_muted: boolean;
  archived_at: Date | null;
  viewer_premium_tier: string;
  viewer_premium_expires_at: Date | null;
  peer_id: string;
  peer_name: string;
  peer_birth_date: Date;
  peer_show_age: boolean;
  peer_gender: string | null;
  peer_avatar_config: unknown;
  peer_photo_url: string | null;
  like_me_peer: boolean;
  like_peer_me: boolean;
  /** só contados enquanto a conversa não foi promovida (depois não decidem nada) */
  msgs_from_me: number;
  msgs_from_peer: number;
  lm_id: string | null;
  lm_sender_id: string | null;
  lm_body: string | null;
  lm_media_url: string | null;
  lm_message_type: string | null;
  lm_system_kind: string | null;
  lm_read_at: Date | null;
  lm_created_at: Date | null;
  /** clientId da última mensagem (só vai pro resumo quando ela é de quem consulta) */
  lm_client_id?: string | null;
}

/** idade em anos completos (data de nascimento é DATE: meia-noite UTC) */
export function ageOn(birth: Date, now: Date = new Date()): number {
  let a = now.getUTCFullYear() - birth.getUTCFullYear();
  const m = now.getUTCMonth() - birth.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < birth.getUTCDate())) a -= 1;
  return a;
}

export const routeOf = (promotedAt: Date | null): RouteFolder =>
  promotedAt ? 'principal' : 'request';

/** fatos do par a partir da linha de UM membro (A = REQUESTER, B = RECIPIENT, como em routing.ts) */
export function factsFromRow(
  r: Pick<
    SummaryRow,
    'my_role' | 'like_me_peer' | 'like_peer_me' | 'msgs_from_me' | 'msgs_from_peer' | 'promoted_at'
  >,
): ConversationFacts {
  const iAmA = r.my_role === 'REQUESTER';
  const fromA = iAmA ? r.msgs_from_me : r.msgs_from_peer;
  const fromB = iAmA ? r.msgs_from_peer : r.msgs_from_me;
  return {
    likeAB: iAmA ? r.like_me_peer : r.like_peer_me,
    likeBA: iAmA ? r.like_peer_me : r.like_me_peer,
    messageCount: fromA + fromB,
    messagesFromA: fromA,
    messagesFromB: fromB,
    promotedAt: r.promoted_at,
  };
}

export function toSummary(r: SummaryRow, now: Date = new Date()): ConversationSummary {
  const route = routeOf(r.promoted_at);
  // a última mensagem é de quem consulta quando não é do peer: só aí o clientId volta
  const lmViewer = r.lm_sender_id && r.lm_sender_id !== r.peer_id ? r.lm_sender_id : undefined;
  const lastMessage: ChatMessage | null = r.lm_id
    ? toChatMessage(
        {
          id: r.lm_id,
          conversationId: r.id,
          senderId: r.lm_sender_id as string,
          body: r.lm_body,
          mediaUrl: r.lm_media_url,
          messageType: r.lm_message_type ?? 'text',
          systemKind: r.lm_system_kind,
          readAt: r.lm_read_at,
          createdAt: r.lm_created_at as Date,
          clientId: r.lm_client_id ?? null,
        },
        lmViewer,
      )
    : null;
  const sees = seesLikesReceived(
    { premiumTier: r.viewer_premium_tier, premiumExpiresAt: r.viewer_premium_expires_at },
    now,
  );
  return {
    id: r.id,
    peer: {
      id: r.peer_id,
      name: r.peer_name,
      // mesma regra do cartão: quem escondeu a idade não tem idade exposta
      ...(r.peer_show_age ? { age: ageOn(r.peer_birth_date, now) } : {}),
      avatar: avatarOrFallback({
        id: r.peer_id,
        gender: r.peer_gender,
        avatarConfig: r.peer_avatar_config,
      }),
      mainPhotoUrl: photoUrl(r.peer_photo_url),
    },
    folder: folderFor(r.my_role, route),
    route,
    myRole: r.my_role,
    awaitingReply: awaitingReply(r.my_role, factsFromRow(r)),
    lastMessage,
    lastMessageAt: (r.last_message_at ?? r.lm_created_at)?.toISOString() ?? null,
    unreadCount: r.unread_count,
    isMuted: r.is_muted,
    promotedAt: r.promoted_at?.toISOString() ?? null,
    promotedReason: (r.promoted_reason as PromoteReason | null) ?? null,
    // "já te curtiu" (RECEIVED) só pra Premium+: a mesma regra do cartão e do mapa
    likeStatus: visibleLikeStatus(r.like_me_peer, r.like_peer_me, sees),
  };
}

// ---- cursor da lista (last_message_at desc, id desc) ----

const CURSOR_RE =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?)\|([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export interface ListCursor {
  /** timestamp exato (texto, sem fuso) da conversa da última linha */
  at: string;
  id: string;
}

export function encodeCursor(c: ListCursor): string {
  return Buffer.from(`${c.at}|${c.id}`, 'utf8').toString('base64url');
}

/** null = cursor inválido (o controller responde 400) */
export function decodeCursor(raw: string): ListCursor | null {
  let text: string;
  try {
    text = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const m = CURSOR_RE.exec(text);
  return m ? { at: m[1], id: m[2] } : null;
}
