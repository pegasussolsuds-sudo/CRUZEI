import {
  ACCOUNT_DELETION_CONFIRM,
  DELETION_REASONS,
  INBOX_EVENTS,
  type AccountDeletionPreview,
  type AccountDeletionResponse,
  type ConversationRemovedPayload,
  type DeletionReason,
} from '@cruzei/shared-types';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { ChatGateway } from '../../realtime/chat.gateway';
import { RedisService } from '../../redis/redis.service';
import { AccountStateService } from '../account/account-state.service';

import { privacyConfig } from './privacy-config';
import { removePresence } from './user-redis';

const DAY_MS = 86_400_000;

export const CONFIRM_REQUIRED = {
  error: 'confirm_required',
  message: `Pra excluir, digita ${ACCOUNT_DELETION_CONFIRM} (tudo maiúsculo).`,
} as const;

export const STAFF_ACCOUNT = {
  error: 'staff_account',
  message:
    'Conta da equipe não se exclui pelo app. Tira o papel de admin/moderador no painel antes.',
} as const;

/** plataformas de loja (Premium manual do painel não tem o que cancelar) */
const STORE_PLATFORMS = ['ios', 'android'];

export function isDeletionReason(v: unknown): v is DeletionReason {
  return typeof v === 'string' && (DELETION_REASONS as readonly string[]).includes(v);
}

/**
 * Excluir conta pelo app (Apple 5.1.1(v), Google Play, LGPD art. 18 VI): na hora a conta some (mapa, deck, cartão,
 * inbox, contadores, push e campanhas já filtram deleted_at), as sessões caem e as conversas somem do outro lado SEM
 * arquivar (a restauração traz tudo de volta). A limpeza definitiva é do AccountPurgeService, no fim do prazo.
 */
@Injectable()
export class AccountDeletionService {
  private readonly log = new Logger(AccountDeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly accounts: AccountStateService,
    private readonly gateway: ChatGateway,
  ) {}

  async preview(userId: string, now = new Date()): Promise<AccountDeletionPreview> {
    const { graceDays } = privacyConfig();
    const [u, sub] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
      this.prisma.subscription.findFirst({
        where: {
          userId,
          platform: { in: STORE_PLATFORMS },
          expiresAt: { gt: now },
          cancelledAt: null,
        },
        orderBy: { expiresAt: 'desc' },
        select: { platform: true, expiresAt: true },
      }),
    ]);
    if (!u) throw new NotFoundException('Usuário não encontrado');
    return {
      graceDays,
      wouldCompleteAt: new Date(now.getTime() + graceDays * DAY_MS).toISOString(),
      activeSubscription: sub
        ? { platform: sub.platform, expiresAt: sub.expiresAt.toISOString() }
        : null,
      staff: u.role !== 'user',
    };
  }

  /**
   * Pede a exclusão. Idempotente (índice ddr_one_pending_uq): pedido pendente devolve o mesmo. Erros: 400
   * confirm_required, 409 staff_account. Os efeitos fora do banco (cache, presença, socket, conversas) vêm depois do
   * commit.
   */
  async request(
    userId: string,
    body: { confirm?: unknown; reason?: unknown },
    now = new Date(),
  ): Promise<AccountDeletionResponse & { created: boolean }> {
    if (body.confirm !== ACCOUNT_DELETION_CONFIRM)
      throw new BadRequestException({ ...CONFIRM_REQUIRED });
    const reason = isDeletionReason(body.reason) ? body.reason : null;
    const { graceDays } = privacyConfig();
    let out: { requestedAt: Date; scheduledFor: Date; created: boolean };
    try {
      out = await this.prisma.$transaction(async (tx) => {
        const [u] = await tx.$queryRaw<{ role: string; deleted_at: Date | null }[]>`
          SELECT role::text AS role, deleted_at FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
        if (!u) throw new NotFoundException('Usuário não encontrado');
        // conta da equipe: tirar o papel no painel antes (evita ficar sem admin)
        if (u.role !== 'user') throw new ConflictException({ ...STAFF_ACCOUNT });
        const pending = await tx.dataDeletionRequest.findFirst({
          where: { userId, status: 'pending' },
          select: { requestedAt: true, scheduledFor: true },
        });
        const req =
          pending ??
          (await tx.dataDeletionRequest.create({
            data: {
              userId,
              requestedAt: now,
              scheduledFor: new Date(now.getTime() + graceDays * DAY_MS),
              status: 'pending',
              source: 'app',
              reason,
            },
            select: { requestedAt: true, scheduledFor: true },
          }));
        await tx.user.update({
          where: { id: userId },
          data: { deletedAt: u.deleted_at ?? now, sessionsValidAfter: now },
        });
        // push para na hora (a linha do aparelho sai; o app faz logout local)
        await tx.deviceToken.deleteMany({ where: { userId } });
        return { ...req, created: !pending };
      });
    } catch (e) {
      // dois pedidos juntos: o índice único parcial segura; o segundo devolve o do primeiro
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const p = await this.prisma.dataDeletionRequest.findFirst({
          where: { userId, status: 'pending' },
          select: { requestedAt: true, scheduledFor: true },
        });
        if (!p) throw e;
        out = { ...p, created: false };
      } else throw e;
    }
    await this.afterRequest(userId);
    if (out.created)
      this.log.log(`exclusão pedida (${userId}), prazo até ${out.scheduledFor.toISOString()}`);
    return {
      requestedAt: out.requestedAt.toISOString(),
      scheduledFor: out.scheduledFor.toISOString(),
      graceDays,
      created: out.created,
    };
  }

  /** depois do commit: 'gone' em todos os processos, some do mapa e das conversas do outro lado, socket cai */
  private async afterRequest(userId: string): Promise<void> {
    await this.accounts.invalidate(userId);
    await this.redis.markPresenceHidden(userId).catch(() => undefined);
    await this.redis.invalidateProfile(userId).catch(() => undefined);
    await removePresence(this.redis.client, userId).catch(() => undefined);
    // conversas que a outra pessoa ainda vê: somem ao vivo (PEER_VISIBLE já esconde nas leituras). Sem arquivar
    const convs = await this.prisma.conversation.findMany({
      where: { OR: [{ userLowId: userId }, { userHighId: userId }] },
      select: {
        id: true,
        userLowId: true,
        userHighId: true,
        members: { select: { userId: true, archivedAt: true } },
      },
    });
    for (const c of convs) {
      const peer = c.userLowId === userId ? c.userHighId : c.userLowId;
      const pair = [c.userLowId, c.userHighId];
      const payload: ConversationRemovedPayload = { conversationId: c.id };
      if (c.members.some((m) => m.userId === peer && !m.archivedAt))
        this.gateway.emitToUsers([peer], INBOX_EVENTS.conversationRemoved, payload);
      this.gateway.removeFromConversation(c.id, pair);
      // contadores do /me do outro lado (não lidas) estão no cache do perfil
      await this.redis.invalidateProfile(peer).catch(() => undefined);
    }
    this.gateway.disconnectUser(userId, { error: 'account_gone', message: 'Conta excluída' });
  }
}
