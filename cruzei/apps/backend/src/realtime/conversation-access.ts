import type { PrismaService } from '../database/prisma.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** id em formato uuid: lixo vindo do cliente nem chega no Postgres (o cast ::uuid daria erro) */
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

/**
 * Pode entrar na sala conv:<id> (só o "digitando"): é membro, a conversa não está arquivada PRA ELE
 * (bloqueio e banimento arquivam os dois lados) e não há Block entre os dois em nenhum sentido
 * (segunda proteção: desbloquear não desarquiva, mas o Block vale mesmo com a conversa ativa).
 * Uma consulta só, parametrizada.
 */
export async function canJoinConversation(
  prisma: Pick<PrismaService, '$queryRaw'>,
  conversationId: unknown,
  userId: unknown,
): Promise<boolean> {
  if (!isUuid(conversationId) || !isUuid(userId)) return false;
  const rows = await prisma.$queryRaw<{ ok: number }[]>`
    SELECT 1 AS ok
    FROM conversation_members m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.conversation_id = ${conversationId}::uuid
      AND m.user_id = ${userId}::uuid
      AND m.archived_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM blocks b
        WHERE (b.blocker_id = c.user_low_id AND b.blocked_id = c.user_high_id)
           OR (b.blocker_id = c.user_high_id AND b.blocked_id = c.user_low_id)
      )
    LIMIT 1`;
  return rows.length > 0;
}
