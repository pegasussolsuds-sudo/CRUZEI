// Comemoração do match pra QUEM RECEBE (quem curtiu primeiro): uma linha em match_celebrations por par e direção
// (user_id = quem recebe, peer_id = quem completou). Chega ao vivo pelo socket 'match:new' e fica pendente até o app
// mostrar (POST /likes/matches/:userId/seen). Consultas em SQL (parametrizado) + o mapeamento puro pro contrato.
import type { MatchCelebration } from '@cruzei/shared-types';
import { Prisma } from '@prisma/client';

import { avatarOrFallback } from '../../common/avatar';
import { photoUrl } from '../../common/photo-url';

/** o que as consultas precisam do client (PrismaService ou o tx da curtida) */
type RawDb = Pick<Prisma.TransactionClient, '$queryRaw' | '$executeRaw'>;

export const MATCH_CELEBRATION = {
  /** pendente mais velho que isso não aparece mais */
  pendingDays: 14,
  /** no máximo tantas por vez (o app mostra uma de cada vez) */
  pendingMax: 5,
  /** descurtir e curtir de novo: só comemora outra vez depois desse prazo da última vista */
  reopenDays: 7,
} as const;

export interface CelebrationRow {
  peer_id: string;
  peer_name: string;
  peer_gender: string | null;
  peer_avatar_config: unknown;
  peer_photo_url: string | null;
  conversation_id: string | null;
  matched_at: Date;
}

/** quem completou o match (p) e a conversa do par vista por quem recebe (mc.user_id); arquivada = sem conversa */
const PEER_FIELDS = Prisma.sql`
  p.id::text AS peer_id,
  p.name AS peer_name,
  p.gender::text AS peer_gender,
  p.avatar_config AS peer_avatar_config,
  (SELECT ph.url FROM photos ph
    WHERE ph.user_id = p.id AND ph.status = 'approved'
    ORDER BY ph.is_main DESC, ph.order_index ASC
    LIMIT 1) AS peer_photo_url,
  (SELECT c.id::text FROM conversations c
     JOIN conversation_members m
       ON m.conversation_id = c.id AND m.user_id = mc.user_id AND m.archived_at IS NULL
    WHERE c.user_low_id = LEAST(mc.user_id, p.id) AND c.user_high_id = GREATEST(mc.user_id, p.id)) AS conversation_id,
  mc.created_at AS matched_at`;

export function toMatchCelebration(r: CelebrationRow): MatchCelebration {
  return {
    peer: {
      id: r.peer_id,
      name: r.peer_name,
      avatar: avatarOrFallback({
        id: r.peer_id,
        gender: r.peer_gender,
        avatarConfig: r.peer_avatar_config,
      }),
      mainPhotoUrl: photoUrl(r.peer_photo_url),
    },
    conversationId: r.conversation_id,
    matchedAt: r.matched_at.toISOString(),
  };
}

/**
 * Match fechado agora (DENTRO da transação da curtida, com a trava do par): grava a comemoração pendente pra
 * `userId` (quem curtiu primeiro). Já pendente = renova; vista há menos de 7 dias (descurtiu e curtiu de novo) = nada.
 * Devolve a linha quando a comemoração está valendo (null = já foi comemorado há pouco).
 */
export async function upsertCelebration(
  db: RawDb,
  userId: string,
  peerId: string,
): Promise<CelebrationRow | null> {
  const rows = await db.$queryRaw<CelebrationRow[]>`
    WITH mc AS (
      INSERT INTO match_celebrations (user_id, peer_id)
      VALUES (${userId}::uuid, ${peerId}::uuid)
      ON CONFLICT (user_id, peer_id) DO UPDATE SET created_at = now(), seen_at = NULL
        WHERE match_celebrations.seen_at IS NULL
           OR match_celebrations.seen_at < now() - make_interval(days => ${MATCH_CELEBRATION.reopenDays}::int)
      RETURNING user_id, peer_id, created_at
    )
    SELECT ${PEER_FIELDS}
      FROM mc JOIN users p ON p.id = mc.peer_id`;
  return rows[0] ?? null;
}

/**
 * Pendentes de `me`, mais novas primeiro: só as dos últimos 14 dias, com as DUAS curtidas ainda de pé, sem Block em
 * nenhum sentido e com a outra ponta ativa, não apagada e fora de análise (review hold).
 */
export async function pendingCelebrations(db: RawDb, me: string): Promise<CelebrationRow[]> {
  return db.$queryRaw<CelebrationRow[]>`
    SELECT ${PEER_FIELDS}
      FROM match_celebrations mc
      JOIN users p ON p.id = mc.peer_id
     WHERE mc.user_id = ${me}::uuid
       AND mc.seen_at IS NULL
       AND mc.created_at > now() - make_interval(days => ${MATCH_CELEBRATION.pendingDays}::int)
       AND p.deleted_at IS NULL
       AND p.account_status = 'active'
       AND p.review_hold_at IS NULL
       AND EXISTS (SELECT 1 FROM likes l WHERE l.liker_id = mc.user_id AND l.liked_id = p.id)
       AND EXISTS (SELECT 1 FROM likes l WHERE l.liker_id = p.id AND l.liked_id = mc.user_id)
       AND NOT EXISTS (
         SELECT 1 FROM blocks b
          WHERE (b.blocker_id = mc.user_id AND b.blocked_id = p.id)
             OR (b.blocker_id = p.id AND b.blocked_id = mc.user_id))
     ORDER BY mc.created_at DESC
     LIMIT ${MATCH_CELEBRATION.pendingMax}::int`;
}

/** mostrada no app (idempotente: a segunda vez não muda nada) */
export async function markCelebrationSeen(db: RawDb, me: string, peerId: string): Promise<void> {
  await db.$executeRaw`
    UPDATE match_celebrations SET seen_at = now()
     WHERE user_id = ${me}::uuid AND peer_id = ${peerId}::uuid AND seen_at IS NULL`;
}
