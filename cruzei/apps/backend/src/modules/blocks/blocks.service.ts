import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { INBOX_EVENTS, type BlockedUser, type ConversationRemovedPayload } from '@cruzei/shared-types';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { ChatGateway } from '../../realtime/chat.gateway';
import { avatarOrFallback } from '../../common/avatar';
import { lockPair, pairOf } from '../inbox/inbox.queries';

/**
 * Bloqueio: independente de Like e de Message (nenhum dos dois é tocado). Esconde perfil e foto nos dois sentidos
 * (cartão, mapa, lugares, curtida, aceno e conversa filtram pela tabela blocks), zera as não lidas e arquiva a
 * conversa do par PROS DOIS — ela some do inbox e das solicitações de ambos. Desbloquear não desarquiva: a conversa
 * só volta com uma mensagem nova.
 */
@Injectable()
export class BlocksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly gateway: ChatGateway,
  ) {}

  async block(blockerId: string, blockedId: string, reason?: string) {
    if (blockerId === blockedId) throw new BadRequestException('Não pode bloquear você mesmo');
    const exists = await this.prisma.user.findUnique({ where: { id: blockedId }, select: { id: true } });
    if (!exists) throw new NotFoundException('Usuário não encontrado');
    const [low, high] = pairOf(blockerId, blockedId);

    // uma transação: o Block e o arquivamento entram juntos (ou nada entra)
    const { b, removed } = await this.prisma.$transaction(async (tx) => {
      // a mesma trava do par do InboxService: uma mensagem (ou conversa nova) chegando agora espera o bloqueio
      // terminar e, lá dentro, já enxerga o Block (404) — não soma não lida depois do zero nem desarquiva
      await lockPair(tx, low, high);
      const conv = await tx.conversation.findUnique({
        where: { userLowId_userHighId: { userLowId: low, userHighId: high } },
        select: { id: true },
      });
      const b = await tx.block.upsert({
        where: { blockerId_blockedId: { blockerId, blockedId } },
        update: { reason: reason?.slice(0, 255) },
        create: { blockerId, blockedId, reason: reason?.slice(0, 255) },
      });
      let removed: string | null = null;
      if (conv) {
        await tx.conversationMember.updateMany({ where: { conversationId: conv.id }, data: { unreadCount: 0 } });
        // coalesce(archived_at, now()): quem já tinha arquivado mantém a data
        const archived = await tx.conversationMember.updateMany({
          where: { conversationId: conv.id, archivedAt: null },
          data: { archivedAt: new Date() },
        });
        // bloqueio repetido (os dois já arquivados) não gera outro evento
        if (archived.count > 0) removed = conv.id;
      }
      return { b, removed };
    });

    // depois do commit: some da lista e o chat aberto fecha dos dois lados; ninguém fica na sala do "digitando"
    if (removed) {
      const payload: ConversationRemovedPayload = { conversationId: removed };
      this.gateway.emitToUsers([blockerId, blockedId], INBOX_EVENTS.conversationRemoved, payload);
      this.gateway.removeFromConversation(removed, [blockerId, blockedId]);
    }
    await Promise.all([this.redis.invalidateProfile(blockerId), this.redis.invalidateProfile(blockedId)]);
    // linhas do Prisma têm BigInt (id): nunca devolver cru — o JSON.stringify estoura em 500
    return { id: String(b.id), blockedId: b.blockedId, reason: b.reason ?? null, createdAt: b.createdAt.toISOString() };
  }

  /** tira só o MEU bloqueio; a conversa continua arquivada pros dois (volta com uma mensagem nova) */
  async unblock(blockerId: string, blockedId: string) {
    await this.prisma.block.deleteMany({ where: { blockerId, blockedId } });
    await Promise.all([this.redis.invalidateProfile(blockerId), this.redis.invalidateProfile(blockedId)]);
    return { ok: true };
  }

  /** quem EU bloqueei: nome + avatar, sem foto (o bloqueio esconde perfil e foto) */
  async list(blockerId: string): Promise<BlockedUser[]> {
    const rows = await this.prisma.block.findMany({
      where: { blockerId },
      orderBy: { createdAt: 'desc' },
      include: { blocked: { select: { id: true, name: true, gender: true, avatarConfig: true } } },
    });
    return rows.map((r) => ({
      id: String(r.id),
      reason: r.reason ?? null,
      createdAt: r.createdAt.toISOString(),
      user: { id: r.blocked.id, name: r.blocked.name, avatar: avatarOrFallback(r.blocked), mainPhotoUrl: null },
    }));
  }
}
