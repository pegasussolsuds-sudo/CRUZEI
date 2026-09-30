import {
  MATCH_EVENTS,
  type LikeResult,
  type MatchCelebration,
  type PremiumTier,
  type SuperLikeQuota,
} from '@cruzei/shared-types';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service';
import { ChatGateway } from '../../realtime/chat.gateway';
import { RedisService } from '../../redis/redis.service';
import type { InboxEvent } from '../inbox/inbox.events';
import { InboxService } from '../inbox/inbox.service';
import { likeStatus } from '../inbox/routing';
import { MESSAGING_GATE_SELECT, messagingLocked } from '../inbox/visibility';
import { seesLikesReceived } from '../location/peer-social';
import { SocialPushService } from '../notifications/social-push.service';

import {
  markCelebrationSeen,
  pendingCelebrations,
  toMatchCelebration,
  upsertCelebration,
} from './match-celebrations';
import { PASS_UNDO_WINDOW_MIN } from './passes';
import {
  readSuperLikeQuota,
  spendSuperLike,
  superLikeDay,
  superLikeLimit,
  superLikeLimitError,
  superLikesUsed,
  superLikeTier,
} from './super-like-quota';

const DAILY_LIKE_LIMIT = 200;
const TX_OPTIONS = { maxWait: 5_000, timeout: 10_000 } as const;
const BLOCKED_MESSAGE = 'Não é possível interagir com esse usuário';

/** invisível sem Premium não curte (a mesma regra e o mesmo erro das mensagens: o app mostra o convite) */
const likeLockedError = () =>
  new ForbiddenException({
    error: 'anonymous_requires_premium',
    message: 'No modo invisível, curtir é do Premium. Fica visível pra curtir.',
  });

/** "Voltar" fora da regra (não é o último passar ou já passou do prazo) */
const passUndoError = () =>
  new ConflictException({
    error: 'pass_undo_unavailable',
    message: `Esse não dá mais pra voltar: o Voltar desfaz só o último passar, até ${PASS_UNDO_WINDOW_MIN} minutos depois.`,
  });

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
  | { blocked: false; locked: true }
  /** super curtida sem cota no dia (nada gravado); o plano efetivo decide a mensagem */
  | { blocked: false; superLimit: PremiumTier }
  | {
      blocked: false;
      likeId: bigint;
      fresh: boolean;
      mutual: boolean;
      promotedConversationIds: string[];
      events: InboxEvent[];
      /** quem curtiu está invisível ou em análise: o aviso da curtida não diz quem foi */
      likerHidden?: boolean;
      /** quem curtiu está em análise: curtida guardada, mas sem like_received nem push */
      likerOnHold?: boolean;
      /** match fechado agora: comemoração pra quem curtiu primeiro (null = já comemorado há pouco ou em análise) */
      celebration?: MatchCelebration | null;
      /** super curtida gravada agora: quantas ainda restam hoje */
      superRemaining?: number;
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
    // push de curtida e match (opcional: os db-specs montam sem)
    @Optional() private readonly social?: SocialPushService,
  ) {}

  async like(likerId: string, likedId: string, isSuper = false): Promise<LikeResult> {
    if (likerId === likedId) throw new BadRequestException('Não dá pra curtir você mesmo');
    // um relógio só pra toda a curtida: o dia de São Paulo da cota não muda no meio do caminho
    const now = new Date();
    const day = superLikeDay(now);
    // quem curte, antes de tudo (nem o toque repetido passa, nem gasta cota)
    const likerPlan = await this.assertCanLike(this.prisma, likerId);

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
    // suspensa, banida, fora da descoberta pela moderação ou invisível (modo anônimo): some pra todo mundo, curtida
    // inclusive — o MESMO 404, pra ninguém descobrir pelo erro que a pessoa existe e está invisível
    if (
      !target ||
      target.deletedAt ||
      target.accountStatus !== 'active' ||
      target.reviewHoldAt ||
      target.visibilityMode === 'anonymous'
    )
      throw new NotFoundException('Usuário não encontrado');

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

    // super curtida sem cota hoje: recusa antes de gastar o limite anti-abuso (quem vale é o gasto atômico lá dentro)
    if (isSuper) {
      const tier = superLikeTier(likerPlan, now);
      const usedToday = await superLikesUsed(this.prisma, likerId, day);
      if (usedToday >= superLikeLimit(tier)) throw superLikeLimitError(tier, now);
    }

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
      // ficou invisível (ou o Premium venceu) enquanto esperava a trava
      const liker = await tx.user.findUnique({
        where: { id: likerId },
        select: { ...MESSAGING_GATE_SELECT, reviewHoldAt: true },
      });
      if (messagingLocked(liker)) return { blocked: false, locked: true };
      // invisível (Premium): a curtida chega sem nome (socket e push). Em análise: nem chega (fica guardada)
      const likerOnHold = Boolean(liker?.reviewHoldAt);
      const likerHidden = liker?.visibilityMode === 'anonymous' || likerOnHold;
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

      // super curtida: gasta a cota do dia AQUI, junto da curtida (se a transação não gravar, o gasto volta junto).
      // Plano pela linha fresca: o Premium pode ter vencido no meio do caminho
      let superRemaining: number | undefined;
      if (isSuper) {
        const tier = superLikeTier(liker, now);
        const limit = superLikeLimit(tier);
        const usedNow = await spendSuperLike(tx, likerId, day, limit);
        if (usedNow == null) return { blocked: false, superLimit: tier };
        superRemaining = Math.max(0, limit - usedNow);
      }

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
          likerHidden,
          likerOnHold,
          superRemaining,
        };
      // virou mútua agora: promove a conversa do par (se existir) + "Vocês se curtiram…", tudo nesta transação
      const promoted = await this.inbox.onMutualLike(tx, likerId, likedId);
      // comemoração pra quem curtiu primeiro (pendente até o app mostrar). Montada aqui dentro: sai logo depois do
      // commit, sem consulta no meio (um bloqueio logo em seguida não pega o aviso atrasado). Em análise não comemora
      // agora (a pendente só aparece se a análise terminar sem punição).
      const row = await upsertCelebration(tx, likedId, likerId);
      const celebration = row && !liker?.reviewHoldAt ? toMatchCelebration(row) : null;
      return {
        blocked: false,
        likeId: like.id,
        fresh: true,
        mutual: true,
        ...promoted,
        likerHidden,
        likerOnHold,
        celebration,
        superRemaining,
      };
    }, TX_OPTIONS);

    if (out.blocked) {
      // bloqueio venceu a corrida: nada gravado; a cota volta
      await this.refundQuota(likerId);
      throw new BadRequestException(BLOCKED_MESSAGE);
    }
    if ('locked' in out) {
      await this.refundQuota(likerId);
      throw likeLockedError();
    }
    if ('superLimit' in out) {
      // acabou a super curtida do dia (corrida com outra requisição): nada gravado; o limite anti-abuso volta
      await this.refundQuota(likerId);
      throw superLikeLimitError(out.superLimit, now);
    }
    if (!out.fresh) {
      // a outra requisição (toque duplo) gravou enquanto esta esperava a trava: devolve a cota e o estado atual
      await this.refundQuota(likerId);
      return this.currentState(likerId, likedId, out.likeId);
    }

    // depois do commit: eventos da conversa promovida, depois o aviso da curtida.
    // Quem curtiu só vai no evento se o destinatário pode saber: Premium+ vigente ("já te curtiu", a mesma regra do
    // cartão e do mapa) ou SUPER curtida (a super revela quem mandou pra todo mundo), sempre com quem curtiu visível e
    // fora de análise; ou curtida mútua (MUTUAL aparece pra todos). Pros demais é só o sinal, sem identidade.
    this.inbox.flush(out.events);
    const revealLiker = (isSuper || seesLikesReceived(target)) && !out.likerHidden;
    const reveal = out.mutual || revealLiker;
    // quem curtiu está em análise: a curtida fica guardada, sem aviso nenhum (nem ao vivo nem push). Se a análise
    // terminar sem punição, segue a vida — igual à comemoração do match (que já vem null em análise)
    if (!out.likerOnHold) {
      this.gateway.emitToUser(
        likedId,
        'like_received',
        reveal
          ? { fromUserId: likerId, isSuper, ...(out.mutual ? { isMutual: true } : {}) }
          : { isSuper },
      );
    }
    // match: a comemoração ao vivo pra quem curtiu primeiro (quem completou já vê o modal pela resposta)
    if (out.celebration) this.gateway.emitToUser(likedId, MATCH_EVENTS.new, out.celebration);
    // push (só push, fora da central): match sempre avisa; curtida com as esperas anti-spam
    if (out.mutual) {
      if (out.celebration) void this.social?.match({ to: likedId, peerId: likerId });
    } else if (!out.likerOnHold) {
      void this.social?.like({ to: likedId, likerId, isSuper, reveal: revealLiker });
    }
    // stats do perfil (likesReceived; na mútua, os pares mútuos dos dois; na super, as que me restam hoje)
    await Promise.all([
      this.redis.invalidateProfile(likedId),
      ...(out.mutual || isSuper ? [this.redis.invalidateProfile(likerId)] : []),
    ]);

    return {
      likeId: String(out.likeId),
      likeStatus: likeStatus(true, out.mutual),
      isMutual: out.mutual,
      promotedConversationIds: out.promotedConversationIds,
      remainingToday: Math.max(0, DAILY_LIKE_LIMIT - used),
      ...(out.superRemaining !== undefined ? { superLikesRemainingToday: out.superRemaining } : {}),
    };
  }

  /** GET /likes/super/quota: super curtidas de hoje pelo plano efetivo (dia de São Paulo) */
  async superQuota(userId: string): Promise<SuperLikeQuota> {
    const plan = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { premiumTier: true, premiumExpiresAt: true },
    });
    if (!plan) throw new NotFoundException('Usuário não encontrado');
    return readSuperLikeQuota(this.prisma, userId, plan);
  }

  /**
   * GET /likes/matches/pending: comemorações que ainda não apareceram pra mim (quem curtiu primeiro), até 5, dos
   * últimos 14 dias, sem bloqueados, descurtidos, contas fora do ar ou em análise. Invisível sem Premium: nada
   * (não conversa nem curte; volta a aparecer quando ficar visível).
   */
  async pendingMatches(me: string): Promise<MatchCelebration[]> {
    const u = await this.prisma.user.findUnique({
      where: { id: me },
      select: MESSAGING_GATE_SELECT,
    });
    if (!u || messagingLocked(u)) return [];
    return (await pendingCelebrations(this.prisma, me)).map(toMatchCelebration);
  }

  /** POST /likes/matches/:userId/seen: o app mostrou a comemoração (idempotente) */
  async markMatchSeen(me: string, peerId: string): Promise<void> {
    await markCelebrationSeen(this.prisma, me, peerId);
  }

  /** DELETE /likes/:userId: apaga a MINHA curtida. Não despromove a conversa (a principal é permanente) */
  async unlike(likerId: string, likedId: string): Promise<void> {
    const { count } = await this.prisma.like.deleteMany({ where: { likerId, likedId } });
    if (count > 0) await this.redis.invalidateProfile(likedId); // stats.likesReceived
  }

  /**
   * POST /passes: quem eu passei some do MEU deck por DISCOVERY_PASS_DAYS (tabela passes; o mapa continua mostrando).
   * Idempotente: passar de novo renova o prazo. Id que não existe não grava nada e responde igual (não confirma se
   * alguém existe). Não vai mais pro audit_log.
   */
  async pass(userId: string, targetId: string): Promise<void> {
    if (userId === targetId) throw new BadRequestException('Não dá pra passar você mesmo');
    await this.prisma.$executeRaw`
      INSERT INTO passes (user_id, target_id)
      SELECT ${userId}::uuid, u.id FROM users u WHERE u.id = ${targetId}::uuid
      ON CONFLICT (user_id, target_id) DO UPDATE SET created_at = now()`;
  }

  /**
   * DELETE /passes/:userId: o "Voltar" do deck desfaz ESSE passar, só se for o MEU passar mais recente e de até
   * PASS_UNDO_WINDOW_MIN minutos (uma instrução só: sem corrida com outro passar). Sem passar gravado: nada a fazer
   * (idempotente, o app pode repetir). Passar velho ou que não é o último: 409.
   */
  async unpass(userId: string, targetId: string): Promise<void> {
    const n = await this.prisma.$executeRaw`
      DELETE FROM passes p
       WHERE p.user_id = ${userId}::uuid AND p.target_id = ${targetId}::uuid
         AND p.created_at > now() - make_interval(mins => ${PASS_UNDO_WINDOW_MIN}::int)
         AND NOT EXISTS (
           SELECT 1 FROM passes q WHERE q.user_id = p.user_id AND q.created_at > p.created_at
         )`;
    if (n > 0) return;
    const still = await this.prisma.pass.findUnique({
      where: { userId_targetId: { userId, targetId } },
      select: { createdAt: true },
    });
    if (still) throw passUndoError();
  }

  /** invisível sem Premium não curte ninguém (curtida e super curtida); devolve o plano de quem curte */
  private async assertCanLike(
    db: Pick<PrismaService, 'user'>,
    likerId: string,
  ): Promise<{ premiumTier: string; premiumExpiresAt: Date | null } | null> {
    const liker = await db.user.findUnique({
      where: { id: likerId },
      select: MESSAGING_GATE_SELECT,
    });
    if (messagingLocked(liker)) throw likeLockedError();
    return liker;
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
