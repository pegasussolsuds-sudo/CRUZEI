import type { LikeResult } from '@cruzei/shared-types';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service';
import { ChatGateway } from '../../realtime/chat.gateway';
import { RedisService } from '../../redis/redis.service';
import type { InboxEvent } from '../inbox/inbox.events';
import { InboxService } from '../inbox/inbox.service';
import { likeStatus } from '../inbox/routing';
import { seesLikesReceived } from '../location/peer-social';

const DAILY_LIKE_LIMIT = 200;
const TX_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;
const BLOCKED_MESSAGE = 'Não é possível interagir com esse usuário';

/** Block entre os dois, em qualquer sentido */
const pairBlocked = (a: string, b: string) => ({
  OR: [
    { blockerId: a, blockedId: b },
    { blockerId: b, blockedId: a },
  ],
});

/** resultado da transação da curtida: bloqueado (nada gravado) ou a curtida (nova ou já existente) */
type LikeTxOut =
  | { blocked: true }
  | {
      blocked: false;
      likeId: bigint;
      fresh: boolean;
      mutual: boolean;
      promotedConversationIds: string[];
      events: InboxEvent[];
    };

// Curtidas: uma linha por direção (tabela likes). Não existe estado "match": mútuo = as duas linhas existem, e o
// likeStatus (NONE/SENT/RECEIVED/MUTUAL) é derivado. Curtida mútua promove a conversa do par (se houver) pra principal
// com a mensagem de sistema, na MESMA transação da curtida e com a mesma trava do par da inbox.
@Injectable()
export class LikesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly gateway: ChatGateway,
    private readonly inbox: InboxService,
  ) {}

  async like(likerId: string, likedId: string, isSuper = false): Promise<LikeResult> {
    if (likerId === likedId) throw new BadRequestException('Não dá pra curtir você mesmo');

    const target = await this.prisma.user.findUnique({
      where: { id: likedId },
      select: {
        id: true,
        deletedAt: true,
        visibilityMode: true,
        accountStatus: true,
        reviewHoldAt: true,
        // plano de quem recebe: decide se o like_received leva quem curtiu
        premiumTier: true,
        premiumExpiresAt: true,
      },
    });
    // suspensa, banida ou fora da descoberta pela moderação: some pra todo mundo, curtida inclusive
    if (!target || target.deletedAt || target.accountStatus !== 'active' || target.reviewHoldAt)
      throw new NotFoundException('Usuário não encontrado');
    if (target.visibilityMode === 'anonymous') {
      throw new BadRequestException(
        'Essa pessoa está em modo anônimo — só dá pra curtir quando ela se revelar',
      );
    }

    // atalho antes de gastar cota; a checagem que vale é a de dentro da transação (depois da trava do par)
    const blocked = await this.prisma.block.findFirst({
      where: pairBlocked(likerId, likedId),
      select: { id: true },
    });
    if (blocked) throw new BadRequestException(BLOCKED_MESSAGE);

    // curtida repetida (toque duplo, deck recarregado): devolve o estado atual sem gastar cota
    const existing = await this.prisma.like.findUnique({
      where: { likerId_likedId: { likerId, likedId } },
      select: { id: true },
    });
    if (existing) return this.currentState(likerId, likedId, existing.id);

    // rate limit diário (só curtida nova conta)
    const used = await this.redis.incrRate(likerId, 'like', 86_400);
    if (used > DAILY_LIKE_LIMIT) {
      throw new ForbiddenException('Limite diário de curtidas atingido');
    }

    const out = await this.prisma.$transaction(async (tx): Promise<LikeTxOut> => {
      // mesma trava da inbox e do bloqueio: curtida, conversa, mensagem e Block do MESMO par não se cruzam
      await this.inbox.lockPair(tx, likerId, likedId);
      // o Block pode ter entrado entre a checagem lá de cima e a trava: bloqueado não grava, não promove, não emite
      const blockedNow = await tx.block.findFirst({
        where: pairBlocked(likerId, likedId),
        select: { id: true },
      });
      if (blockedNow) return { blocked: true };
      const again = await tx.like.findUnique({
        where: { likerId_likedId: { likerId, likedId } },
        select: { id: true },
      });
      if (again)
        return {
          blocked: false,
          likeId: again.id,
          fresh: false,
          mutual: false,
          promotedConversationIds: [] as string[],
          events: [] as InboxEvent[],
        };

      const like = await tx.like.create({
        data: { likerId, likedId, isSuper },
        select: { id: true },
      });
      const reverse = await tx.like.findUnique({
        where: { likerId_likedId: { likerId: likedId, likedId: likerId } },
        select: { id: true },
      });
      if (!reverse)
        return {
          blocked: false,
          likeId: like.id,
          fresh: true,
          mutual: false,
          promotedConversationIds: [] as string[],
          events: [] as InboxEvent[],
        };
      // virou mútua agora: promove a conversa do par (se existir) + "Vocês se curtiram…", tudo nesta transação
      const promoted = await this.inbox.onMutualLike(tx, likerId, likedId);
      return { blocked: false, likeId: like.id, fresh: true, mutual: true, ...promoted };
    }, TX_OPTIONS);

    if (out.blocked) {
      // bloqueio venceu a corrida: nada gravado; a cota volta
      await this.refundQuota(likerId);
      throw new BadRequestException(BLOCKED_MESSAGE);
    }
    if (!out.fresh) {
      // a outra requisição (toque duplo) gravou enquanto esta esperava a trava: devolve a cota e o estado atual
      await this.refundQuota(likerId);
      return this.currentState(likerId, likedId, out.likeId);
    }

    // depois do commit: eventos da conversa promovida, depois o aviso da curtida.
    // Quem curtiu só vai no evento se o destinatário pode saber: Premium+ vigente ("já te curtiu", a mesma regra do
    // cartão e do mapa) ou curtida mútua (MUTUAL aparece pra todos). Pros demais é só o sinal, sem identidade.
    this.inbox.flush(out.events);
    const reveal = out.mutual || seesLikesReceived(target);
    this.gateway.emitToUser(
      likedId,
      'like_received',
      reveal
        ? { fromUserId: likerId, isSuper, ...(out.mutual ? { isMutual: true } : {}) }
        : { isSuper },
    );
    // stats do perfil (likesReceived; na mútua, os pares mútuos dos dois)
    await Promise.all([
      this.redis.invalidateProfile(likedId),
      ...(out.mutual ? [this.redis.invalidateProfile(likerId)] : []),
    ]);

    return {
      likeId: String(out.likeId),
      likeStatus: likeStatus(true, out.mutual),
      isMutual: out.mutual,
      promotedConversationIds: out.promotedConversationIds,
      remainingToday: Math.max(0, DAILY_LIKE_LIMIT - used),
    };
  }

  /** DELETE /likes/:userId: apaga a MINHA curtida. Não despromove a conversa (a principal é permanente) */
  async unlike(likerId: string, likedId: string): Promise<void> {
    const { count } = await this.prisma.like.deleteMany({ where: { likerId, likedId } });
    if (count > 0) await this.redis.invalidateProfile(likedId); // stats.likesReceived
  }

  async pass(userId: string, targetId: string) {
    // pass = like reverso registrado como skipped (não armazenamos, só audit)
    await this.prisma.auditLog.create({
      data: {
        userId,
        action: 'pass',
        metadata: { target_id: targetId } as never,
      },
    });
    return { ok: true };
  }

  /** devolve a curtida contada no limite diário (a curtida não foi gravada por esta requisição) */
  private async refundQuota(likerId: string): Promise<void> {
    await this.redis.client.decr(`rate:${likerId}:like`).catch(() => undefined);
  }

  private async currentState(
    likerId: string,
    likedId: string,
    likeId: bigint,
  ): Promise<LikeResult> {
    const reverse = await this.prisma.like.findUnique({
      where: { likerId_likedId: { likerId: likedId, likedId: likerId } },
      select: { id: true },
    });
    const usedSoFar = Number((await this.redis.client.get(`rate:${likerId}:like`)) ?? 0);
    return {
      likeId: String(likeId),
      likeStatus: likeStatus(true, Boolean(reverse)),
      isMutual: Boolean(reverse),
      promotedConversationIds: [],
      remainingToday: Math.max(0, DAILY_LIKE_LIMIT - usedSoFar),
    };
  }
}
