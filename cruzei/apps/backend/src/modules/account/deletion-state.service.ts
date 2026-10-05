import { randomUUID } from 'node:crypto';

import type { AccountDeletionPendingError, AccountDeletionRestored } from '@cruzei/shared-types';
import { ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';

import { AccountStateService, blockedBody } from './account-state.service';

// Arrependimento da exclusão (prazo de ACCOUNT_DELETION_GRACE_DAYS): o login com SMS confirmado de conta com pedido
// pendente NÃO abre sessão nem restaura sozinho — responde 409 account_deletion_pending com um desafio de uso único
// (Redis, 10 min); o app pergunta e POST /auth/deletion/cancel troca o desafio pela conta de volta.
// Fica no AccountModule (global, só Prisma + Redis + estado da conta): o AuthService usa sem fechar o ciclo com o
// RealtimeModule.

/** o desafio vale 10 min (o mesmo prazo do "Essa conta é sua?") */
export const DELETION_CHALLENGE_TTL_S = 600;
export const deletionChallengeKey = (id: string) => `acct:delch:${id}`;

interface ChallengeData {
  /** conta com a exclusão pendente */
  u: string;
  /** número que confirmou o SMS */
  p: string;
  /** pedido que o desafio cancela (ausente = desafio de antes; vale o pendente da conta) */
  r?: string;
}

export const DELETION_CHALLENGE_EXPIRED = {
  error: 'deletion_challenge_expired',
  message: 'Essa confirmação venceu. Pede outro código pra entrar.',
} as const;

export interface RestoreResult {
  userId: string;
  restored: AccountDeletionRestored;
}

/** "03/11" em São Paulo */
export function shortDateBR(d: Date): string {
  return d.toLocaleDateString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
  });
}

export function pendingMessage(scheduledFor: Date): string {
  return `Tua conta tá marcada pra exclusão e apaga de vez em ${shortDateBR(scheduledFor)}. Quer cancelar a exclusão e voltar?`;
}

@Injectable()
export class DeletionStateService {
  private readonly log = new Logger(DeletionStateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly accounts: AccountStateService,
  ) {}

  /** pedido pendente de uma conta ainda não limpa (null = sem pedido: exclusão manual antiga ou já concluída) */
  async pendingFor(
    userId: string,
  ): Promise<{ id: string; requestedAt: Date; scheduledFor: Date } | null> {
    return this.prisma.dataDeletionRequest.findFirst({
      where: { userId, status: 'pending', user: { purgedAt: null } },
      select: { id: true, requestedAt: true, scheduledFor: true },
    });
  }

  /**
   * Login (SMS já confirmado) de conta com deleted_at: com pedido pendente devolve o corpo do 409 (e grava o desafio);
   * sem pedido devolve null e o login segue o caminho antigo. Conta banida/suspensa: 403 de sempre, sem oferecer.
   */
  async loginChallenge(userId: string, phone: string): Promise<AccountDeletionPendingError | null> {
    const p = await this.pendingFor(userId);
    if (!p) return null;
    await this.assertNotBlocked(userId);
    const challengeId = randomUUID();
    const data: ChallengeData = { u: userId, p: phone, r: p.id };
    await this.redis.client.set(
      deletionChallengeKey(challengeId),
      JSON.stringify(data),
      'EX',
      DELETION_CHALLENGE_TTL_S,
    );
    return {
      error: 'account_deletion_pending',
      message: pendingMessage(p.scheduledFor),
      challengeId,
      requestedAt: p.requestedAt.toISOString(),
      scheduledFor: p.scheduledFor.toISOString(),
      expiresIn: DELETION_CHALLENGE_TTL_S,
    };
  }

  /**
   * "Cancelar exclusão": consome o desafio (uso único, apagado só depois do commit), marca o pedido 'cancelled' e tira
   * o deleted_at. As sessões
   * antigas continuam revogadas (sessions_valid_after); quem chama emite os tokens novos e grava o access_log.
   * Desafio vencido/usado, número que saiu da conta ou limpeza que ganhou a corrida: 401 deletion_challenge_expired.
   */
  async cancelByChallenge(challengeId: string): Promise<RestoreResult> {
    const key = deletionChallengeKey(challengeId);
    const c = parseChallenge(await this.redis.client.get(key));
    if (!c) throw new UnauthorizedException({ ...DELETION_CHALLENGE_EXPIRED });
    const now = new Date();
    let out: { requestedAt: Date; scheduledFor: Date } | null;
    try {
      out = await this.restoreInTx(c, now);
    } catch (e) {
      // banida no meio do caminho: o desafio não serve mais; erro de banco: fica pra tentar de novo no prazo
      if (e instanceof ForbiddenException) await this.dropChallenge(key);
      throw e;
    }
    // uso único: sai depois do commit (o pedido já não é 'pending', então repetir dá 401 de qualquer jeito)
    await this.dropChallenge(key);
    if (!out) throw new UnauthorizedException({ ...DELETION_CHALLENGE_EXPIRED });
    // o 'gone' em cache (10 min no Redis, 15 s local) derrubaria o token novo: esquece em todos os processos
    await this.accounts.invalidate(c.u);
    await this.redis.invalidateProfile(c.u).catch(() => undefined);
    this.log.log(`exclusão cancelada pela própria pessoa (${c.u})`);
    return {
      userId: c.u,
      restored: {
        requestedAt: out.requestedAt.toISOString(),
        scheduledFor: out.scheduledFor.toISOString(),
      },
    };
  }

  private async dropChallenge(key: string): Promise<void> {
    await this.redis.client.del(key).catch(() => undefined);
  }

  /**
   * Mesma ordem de trava da limpeza (AccountPurgeService): PEDIDO primeiro (FOR UPDATE), depois users. Ordem invertida
   * dava deadlock; assim, ou a limpeza pega o pedido (SKIP LOCKED) e o cancelamento espera e vê que já não está
   * pendente, ou o cancelamento pega e a limpeza pula.
   */
  private async restoreInTx(
    c: ChallengeData,
    now: Date,
  ): Promise<{ requestedAt: Date; scheduledFor: Date } | null> {
    return this.prisma.$transaction(async (tx) => {
      const [req] = c.r
        ? await tx.$queryRaw<{ id: string; requested_at: Date; scheduled_for: Date }[]>`
            SELECT id, requested_at, scheduled_for FROM data_deletion_requests
             WHERE id = ${c.r}::uuid AND user_id = ${c.u}::uuid AND status = 'pending' FOR UPDATE`
        : await tx.$queryRaw<{ id: string; requested_at: Date; scheduled_for: Date }[]>`
            SELECT id, requested_at, scheduled_for FROM data_deletion_requests
             WHERE user_id = ${c.u}::uuid AND status = 'pending' FOR UPDATE`;
      if (!req) return null;
      const [u] = await tx.$queryRaw<
        {
          phone: string | null;
          deleted_at: Date | null;
          purged_at: Date | null;
          account_status: string;
          suspended_until: Date | null;
          moderation_reason: string | null;
        }[]
      >`SELECT phone, deleted_at, purged_at, account_status::text AS account_status, suspended_until, moderation_reason
          FROM users WHERE id = ${c.u}::uuid FOR UPDATE`;
      if (!u || u.phone !== c.p || !u.deleted_at || u.purged_at) return null;
      const blocked = blockedState(u);
      if (blocked) throw new ForbiddenException(blockedBody(blocked));
      await tx.dataDeletionRequest.update({
        where: { id: req.id },
        data: { status: 'cancelled', cancelledAt: now, holdReason: null },
      });
      // corte das sessões no segundo cheio: token antigo (antes do pedido) continua fora; o novo (iat em segundos) vale
      await tx.user.update({
        where: { id: c.u },
        data: {
          deletedAt: null,
          sessionsValidAfter: new Date(Math.floor(now.getTime() / 1000) * 1000),
        },
      });
      return { requestedAt: req.requested_at, scheduledFor: req.scheduled_for };
    });
  }

  /** banida/suspensa (com suspensão ainda valendo): 403 com o corpo de sempre */
  private async assertNotBlocked(userId: string): Promise<void> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { accountStatus: true, suspendedUntil: true, moderationReason: true },
    });
    if (!u) return;
    const blocked = blockedState({
      account_status: u.accountStatus,
      suspended_until: u.suspendedUntil,
      moderation_reason: u.moderationReason,
    });
    if (blocked) throw new ForbiddenException(blockedBody(blocked));
  }
}

/** estado de bloqueio (banida, ou suspensa sem prazo / com prazo no futuro); null = pode usar */
export function blockedState(
  u: { account_status: string; suspended_until: Date | null; moderation_reason: string | null },
  now = Date.now(),
): { status: 'banned' | 'suspended'; until: number | null; reason: string | null } | null {
  if (u.account_status === 'banned')
    return { status: 'banned', until: null, reason: u.moderation_reason };
  if (u.account_status === 'suspended') {
    const until = u.suspended_until?.getTime() ?? null;
    if (until !== null && until <= now) return null;
    return { status: 'suspended', until, reason: u.moderation_reason };
  }
  return null;
}

function parseChallenge(raw: string | null): ChallengeData | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as Partial<ChallengeData>;
    if (typeof c.u !== 'string' || typeof c.p !== 'string') return null;
    return typeof c.r === 'string' ? { u: c.u, p: c.p, r: c.r } : { u: c.u, p: c.p };
  } catch {
    return null;
  }
}
