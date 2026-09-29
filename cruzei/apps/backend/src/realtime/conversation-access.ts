import type { PrismaService } from '../database/prisma.service';
import { marksReadAllowed, type MemberRole } from '../modules/inbox/routing';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** id em formato uuid: lixo vindo do cliente nem chega no Postgres (o cast ::uuid daria erro) */
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

/** papel de quem entra e a promoção da conversa (o "digitando" de quem recebeu a solicitação depende disso) */
export interface ConversationAccess {
  role: MemberRole;
  promotedAt: Date | null;
}

/**
 * Pode entrar na sala conv:<id> (só o "digitando"): é membro, a conversa não está arquivada PRA ELE
 * (bloqueio e banimento arquivam os dois lados) e não há Block entre os dois em nenhum sentido
 * (segunda proteção: desbloquear não desarquiva, mas o Block vale mesmo com a conversa ativa).
 * Devolve o papel e a promoção de quem entra, ou null sem acesso. Uma consulta só, parametrizada.
 */
export async function conversationAccess(
  prisma: Pick<PrismaService, '$queryRaw'>,
  conversationId: unknown,
  userId: unknown,
): Promise<ConversationAccess | null> {
  if (!isUuid(conversationId) || !isUuid(userId)) return null;
  const rows = await prisma.$queryRaw<{ role: MemberRole; promoted_at: Date | null }[]>`
    SELECT m.role::text AS role, c.promoted_at
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
  const row = rows[0];
  return row ? { role: row.role, promotedAt: row.promoted_at ?? null } : null;
}

/** só o sim/não de conversationAccess */
export async function canJoinConversation(
  prisma: Pick<PrismaService, '$queryRaw'>,
  conversationId: unknown,
  userId: unknown,
): Promise<boolean> {
  return (await conversationAccess(prisma, conversationId, userId)) !== null;
}

/**
 * O "digitando" dessa pessoa fica mudo? Quem RECEBEU a solicitação não revela que abriu a conversa enquanto ela não
 * é promovida: a mesma regra do recibo de leitura (marksReadAllowed), que o banner do chat promete.
 */
export function typingMuted(a: ConversationAccess): boolean {
  return !marksReadAllowed(a.role, a.promotedAt ? 'principal' : 'request');
}
