// Consultas da inbox em SQL (parametrizado pelo Prisma.sql). Uma consulta monta o resumo de N conversas vistas por UM
// membro: par, foto aprovada, curtidas nos dois sentidos, última mensagem (LATERAL) e contadores da linha do membro.
// Servem à lista (GET /inbox, /inbox/requests), ao detalhe e aos eventos montados dentro das transações.
import type { InboxCounts, InboxFolder } from '@cruzei/shared-types';
import { Prisma } from '@prisma/client';

import type { ListCursor, MessageRow, SummaryRow } from './inbox.mapper';

/** o que as consultas precisam do client (PrismaService ou o tx de uma transação) */
export type RawDb = Pick<Prisma.TransactionClient, '$queryRaw'>;

export interface SummaryFilter {
  viewerId: string;
  /** uma conversa só (detalhe, eventos) */
  conversationId?: string;
  /** pasta de quem consulta; ausente = as duas */
  folder?: InboxFolder;
  /** inclui a conversa arquivada por quem consulta (detalhe) */
  includeArchived?: boolean;
  cursor?: ListCursor | null;
  limit?: number;
}

/** a outra ponta do par (p) a partir da linha do membro (me) */
const PEER_JOIN = Prisma.sql`
  JOIN users p ON p.id = (CASE WHEN c.user_low_id = me.user_id THEN c.user_high_id ELSE c.user_low_id END)`;

/**
 * Filtros de segurança de toda leitura: conta da outra ponta apagada ou fora de 'active' some, e Block em qualquer
 * sentido some dos dois lados (segunda proteção: o bloqueio já arquiva as duas linhas de membro).
 * Solicitação (ainda não promovida) aberta por quem está EM ANÁLISE (reviewHoldAt) some de quem a RECEBEU: nome e
 * foto de quem está em análise não aparecem pra ninguém novo. Volta sozinha se a análise terminar sem punição.
 */
const PEER_VISIBLE = Prisma.sql`
  AND p.deleted_at IS NULL
  AND p.account_status = 'active'
  AND NOT (c.promoted_at IS NULL AND me.role = 'RECIPIENT' AND p.review_hold_at IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM blocks b
    WHERE (b.blocker_id = me.user_id AND b.blocked_id = p.id)
       OR (b.blocker_id = p.id AND b.blocked_id = me.user_id)
  )`;

/** pasta do ponto de vista de quem consulta (= folderFor em routing.ts, em SQL) */
function folderSql(folder: InboxFolder | undefined): Prisma.Sql {
  if (folder === 'inbox')
    return Prisma.sql`AND (c.promoted_at IS NOT NULL OR me.role = 'REQUESTER')`;
  if (folder === 'requests') return Prisma.sql`AND c.promoted_at IS NULL AND me.role = 'RECIPIENT'`;
  return Prisma.empty;
}

export async function summaryRows(db: RawDb, f: SummaryFilter): Promise<SummaryRow[]> {
  const conv = f.conversationId ? Prisma.sql`AND c.id = ${f.conversationId}::uuid` : Prisma.empty;
  const archived = f.includeArchived ? Prisma.empty : Prisma.sql`AND me.archived_at IS NULL`;
  // chave de ordenação com microssegundos (texto): o cursor não perde precisão no caminho JS
  const cursor = f.cursor
    ? Prisma.sql`AND (COALESCE(c.last_message_at, c.created_at), c.id) < (${f.cursor.at}::timestamp, ${f.cursor.id}::uuid)`
    : Prisma.empty;
  const limit = f.limit ? Prisma.sql`LIMIT ${f.limit}::int` : Prisma.empty;
  return db.$queryRaw<SummaryRow[]>`
    SELECT c.id::text AS id,
           c.created_at,
           c.promoted_at,
           c.promoted_reason,
           c.last_message_at,
           to_char(COALESCE(c.last_message_at, c.created_at), 'YYYY-MM-DD"T"HH24:MI:SS.US') AS sort_key,
           me.role::text AS my_role,
           me.unread_count,
           me.is_muted,
           me.archived_at,
           v.premium_tier::text AS viewer_premium_tier,
           v.premium_expires_at AS viewer_premium_expires_at,
           p.id::text AS peer_id,
           p.name AS peer_name,
           p.birth_date AS peer_birth_date,
           p.show_age AS peer_show_age,
           p.gender::text AS peer_gender,
           p.avatar_config AS peer_avatar_config,
           (SELECT ph.url FROM photos ph
             WHERE ph.user_id = p.id AND ph.status = 'approved'
             ORDER BY ph.is_main DESC, ph.order_index ASC
             LIMIT 1) AS peer_photo_url,
           EXISTS (SELECT 1 FROM likes l WHERE l.liker_id = me.user_id AND l.liked_id = p.id) AS like_me_peer,
           EXISTS (SELECT 1 FROM likes l WHERE l.liker_id = p.id AND l.liked_id = me.user_id) AS like_peer_me,
           CASE WHEN c.promoted_at IS NULL THEN
             (SELECT count(*) FROM messages x
               WHERE x.conversation_id = c.id AND x.sender_id = me.user_id AND x.system_kind IS NULL)::int
           ELSE 0 END AS msgs_from_me,
           CASE WHEN c.promoted_at IS NULL THEN
             (SELECT count(*) FROM messages x
               WHERE x.conversation_id = c.id AND x.sender_id = p.id AND x.system_kind IS NULL)::int
           ELSE 0 END AS msgs_from_peer,
           lm.id::text AS lm_id,
           lm.sender_id::text AS lm_sender_id,
           lm.content AS lm_body,
           lm.media_url AS lm_media_url,
           lm.message_type::text AS lm_message_type,
           lm.system_kind AS lm_system_kind,
           lm.read_at AS lm_read_at,
           lm.created_at AS lm_created_at,
           lm.client_id AS lm_client_id
      FROM conversation_members me
      JOIN conversations c ON c.id = me.conversation_id
      JOIN users v ON v.id = me.user_id
      ${PEER_JOIN}
      LEFT JOIN LATERAL (
        SELECT x.id, x.sender_id, x.content, x.media_url, x.message_type, x.system_kind, x.read_at, x.created_at,
               x.client_id
          FROM messages x
         WHERE x.conversation_id = c.id
         ORDER BY x.created_at DESC, x.id DESC
         LIMIT 1
      ) lm ON true
     WHERE me.user_id = ${f.viewerId}::uuid
       ${conv}
       ${archived}
       ${PEER_VISIBLE}
       ${folderSql(f.folder)}
       ${cursor}
     ORDER BY COALESCE(c.last_message_at, c.created_at) DESC, c.id DESC
     ${limit}`;
}

/** badges da aba Mensagens: contam CONVERSAS (não mensagens), com os mesmos filtros da lista */
export async function inboxCounts(db: RawDb, viewerId: string): Promise<InboxCounts> {
  const [row] = await db.$queryRaw<
    { unread_inbox: number; requests: number; unread_requests: number }[]
  >`
    SELECT
      count(*) FILTER (WHERE (c.promoted_at IS NOT NULL OR me.role = 'REQUESTER') AND me.unread_count > 0)::int AS unread_inbox,
      count(*) FILTER (WHERE c.promoted_at IS NULL AND me.role = 'RECIPIENT')::int AS requests,
      count(*) FILTER (WHERE c.promoted_at IS NULL AND me.role = 'RECIPIENT' AND me.unread_count > 0)::int AS unread_requests
      FROM conversation_members me
      JOIN conversations c ON c.id = me.conversation_id
      ${PEER_JOIN}
     WHERE me.user_id = ${viewerId}::uuid
       AND me.archived_at IS NULL
       ${PEER_VISIBLE}`;
  return {
    unreadInbox: row?.unread_inbox ?? 0,
    requests: row?.requests ?? 0,
    unreadRequests: row?.unread_requests ?? 0,
  };
}

/** trava do par (transação): serializa curtida, abertura, envio e promoção do MESMO par entre processos */
export async function lockPair(
  db: Pick<Prisma.TransactionClient, '$executeRaw'>,
  a: string,
  b: string,
): Promise<void> {
  const [low, high] = pairOf(a, b);
  // pg_advisory_xact_lock devolve void: $executeRaw não tenta ler a coluna. Solta sozinho no fim da transação
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`conv:${low}:${high}`}, 0))`;
}

/** par canônico: a mesma ordem do CHECK conv_pair_order (uuid do Postgres = string minúscula no JS) */
export function pairOf(a: string, b: string): [string, string] {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? [x, y] : [y, x];
}

// ---- mensagens ----

/** colunas de uma mensagem já no formato de MessageRow (body = coluna content) */
const MESSAGE_COLUMNS = Prisma.sql`
  x.id::text AS "id", x.conversation_id::text AS "conversationId", x.sender_id::text AS "senderId",
  x.content AS "body", x.media_url AS "mediaUrl", x.message_type::text AS "messageType",
  x.system_kind AS "systemKind", x.read_at AS "readAt", x.created_at AS "createdAt", x.client_id AS "clientId"`;

export interface NewMessageRow {
  conversationId: string;
  senderId: string;
  body: string | null;
  messageType: string;
  mediaUrl: string | null;
  mediaExpiresAt: Date | null;
  createdAt: Date;
  clientId: string | null;
}

/**
 * Grava uma mensagem de gente. A UNIQUE(sender_id, client_id) segura o reenvio: se esse remetente já gravou esse
 * clientId (em QUALQUER conversa, inclusive numa transação que ainda estava em voo), não grava nada e devolve null.
 * Sem clientId (NULL) nunca colide.
 */
export async function insertMessage(db: RawDb, m: NewMessageRow): Promise<MessageRow | null> {
  const [row] = await db.$queryRaw<MessageRow[]>`
    INSERT INTO messages AS x
           (id, conversation_id, sender_id, content, message_type, media_url, media_expires_at, created_at, client_id)
    VALUES (gen_random_uuid(), ${m.conversationId}::uuid, ${m.senderId}::uuid, ${m.body}::text,
            ${m.messageType}::"MessageType", ${m.mediaUrl}::varchar, ${m.mediaExpiresAt}::timestamp,
            ${m.createdAt}::timestamp, ${m.clientId}::varchar)
    ON CONFLICT (sender_id, client_id) DO NOTHING
    RETURNING ${MESSAGE_COLUMNS}`;
  return row ?? null;
}

export interface MessagePageOpts {
  limit: number;
  /** antes desta mensagem (ordem exata created_at, id) */
  beforeId?: string;
  /** antes deste instante (compatível com o app antigo) */
  beforeAt?: Date;
}

/** as `limit` mensagens mais novas antes do marcador, em ordem crescente (antiga → nova) */
export async function messagesPage(
  db: RawDb,
  conversationId: string,
  o: MessagePageOpts,
): Promise<MessageRow[]> {
  const before = o.beforeId
    ? Prisma.sql`AND (x.created_at, x.id) < (SELECT u.created_at, u.id FROM messages u WHERE u.id = ${o.beforeId}::uuid AND u.conversation_id = ${conversationId}::uuid)`
    : o.beforeAt
      ? Prisma.sql`AND x.created_at < ${o.beforeAt}`
      : Prisma.empty;
  const rows = await db.$queryRaw<MessageRow[]>`
    SELECT ${MESSAGE_COLUMNS}
      FROM messages x
     WHERE x.conversation_id = ${conversationId}::uuid
       ${before}
     ORDER BY x.created_at DESC, x.id DESC
     LIMIT ${o.limit}::int`;
  return rows.reverse();
}

/**
 * Marca como lidas as mensagens do outro lado (nunca as de sistema) até `upToId` (inclusive; ausente = todas).
 * Devolve quantas linhas mudaram.
 */
export async function markMessagesRead(
  db: Pick<Prisma.TransactionClient, '$executeRaw'>,
  conversationId: string,
  peerId: string,
  readAt: Date,
  upToId: string | null,
): Promise<number> {
  const upTo = upToId
    ? Prisma.sql`AND (x.created_at, x.id) <= (SELECT u.created_at, u.id FROM messages u WHERE u.id = ${upToId}::uuid AND u.conversation_id = ${conversationId}::uuid)`
    : Prisma.empty;
  return db.$executeRaw`
    UPDATE messages x SET read_at = ${readAt}
     WHERE x.conversation_id = ${conversationId}::uuid
       AND x.sender_id = ${peerId}::uuid
       AND x.read_at IS NULL
       AND x.system_kind IS NULL
       ${upTo}`;
}

/** mensagens do outro lado DEPOIS de `upToId` (o que continua não lido); sem marcador = 0 */
export async function unreadAfter(
  db: RawDb,
  conversationId: string,
  peerId: string,
  upToId: string | null,
): Promise<number> {
  if (!upToId) return 0;
  const [row] = await db.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n
      FROM messages x
     WHERE x.conversation_id = ${conversationId}::uuid
       AND x.sender_id = ${peerId}::uuid
       AND x.system_kind IS NULL
       AND (x.created_at, x.id) > (SELECT u.created_at, u.id FROM messages u WHERE u.id = ${upToId}::uuid AND u.conversation_id = ${conversationId}::uuid)`;
  return row?.n ?? 0;
}
