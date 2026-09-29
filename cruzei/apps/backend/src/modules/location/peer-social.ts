// Relação social de quem consulta com outra pessoa (mapa /nearby e cartão público /users/:id): status da curtida e a
// conversa do par. As regras são PURAS (testadas em peer-social.spec.ts); a consulta fica em loadPeerSocial.
import type { ConversationRef, PeerSocial } from '@cruzei/shared-types';

import type { PrismaService } from '../../database/prisma.service';
import { folderFor, likeStatus, type LikeStatus, type MemberRole } from '../inbox/routing';

/** "Já te curtiu" (RECEIVED) é do Premium+ com assinatura vigente (sem vencimento ou vencimento no futuro) */
export function seesLikesReceived(
  u: { premiumTier: string; premiumExpiresAt: Date | null } | null | undefined,
  now: Date = new Date(),
): boolean {
  return Boolean(
    u &&
      u.premiumTier === 'premium_plus' &&
      (u.premiumExpiresAt == null || u.premiumExpiresAt > now),
  );
}

/**
 * Status que quem consulta pode ver. Fora do Premium+, RECEIVED vira NONE: antes o servidor mandava likedMe pra
 * todo mundo e só o app escondia (vazava pra quem lesse a resposta). MUTUAL aparece pra todos (os dois curtiram).
 */
export function visibleLikeStatus(
  meToPeer: boolean,
  peerToMe: boolean,
  seesReceived: boolean,
): LikeStatus {
  const s = likeStatus(meToPeer, peerToMe);
  return s === 'RECEIVED' && !seesReceived ? 'NONE' : s;
}

/** conversa do par vista por mim: a pasta sai do MEU papel (solicitações é só de quem recebeu) e da promoção gravada */
export function peerConversation(c: {
  id: string;
  role: MemberRole;
  promotedAt: Date | null;
}): ConversationRef {
  return { id: c.id, folder: folderFor(c.role, c.promotedAt ? 'principal' : 'request') };
}

export type PeerSocialRow = PeerSocial & { likedByMe: boolean };

/**
 * Curtidas (nos dois sentidos) e conversa de `me` com cada id, numa consulta só: um parâmetro de array (= ANY/unnest,
 * como o loadFlagsFromDb) e buscas pelo índice único de likes e pelo par da conversa. Conversa arquivada por mim
 * (bloqueio, "arquivar") não aparece. Quem não voltar do banco fica fora do mapa (o chamador trata como NONE/null).
 */
export async function loadPeerSocial(
  prisma: Pick<PrismaService, '$queryRaw' | 'user'>,
  me: string,
  peerIds: string[],
): Promise<Map<string, PeerSocialRow>> {
  const out = new Map<string, PeerSocialRow>();
  const ids = [...new Set(peerIds.filter((id) => id !== me))];
  if (ids.length === 0) return out;
  const [viewer, rows] = await Promise.all([
    prisma.user.findUnique({
      where: { id: me },
      select: { premiumTier: true, premiumExpiresAt: true },
    }),
    prisma.$queryRaw<
      {
        peerId: string;
        meToPeer: boolean;
        peerToMe: boolean;
        conversationId: string | null;
        role: MemberRole | null;
        promotedAt: Date | null;
      }[]
    >`
      SELECT p.id::text AS "peerId",
             EXISTS (SELECT 1 FROM likes l WHERE l.liker_id = ${me}::uuid AND l.liked_id = p.id) AS "meToPeer",
             EXISTS (SELECT 1 FROM likes l WHERE l.liker_id = p.id AND l.liked_id = ${me}::uuid) AS "peerToMe",
             m.conversation_id::text AS "conversationId", m.role::text AS role, c.promoted_at AS "promotedAt"
        FROM unnest(${ids}::uuid[]) AS p(id)
        LEFT JOIN conversations c
          ON c.user_low_id = LEAST(p.id, ${me}::uuid) AND c.user_high_id = GREATEST(p.id, ${me}::uuid)
        LEFT JOIN conversation_members m
          ON m.conversation_id = c.id AND m.user_id = ${me}::uuid AND m.archived_at IS NULL`,
  ]);
  const sees = seesLikesReceived(viewer);
  for (const r of rows) {
    out.set(r.peerId, {
      likedByMe: r.meToPeer,
      likeStatus: visibleLikeStatus(r.meToPeer, r.peerToMe, sees),
      conversation:
        r.conversationId && r.role
          ? peerConversation({ id: r.conversationId, role: r.role, promotedAt: r.promotedAt })
          : null,
    });
  }
  return out;
}
