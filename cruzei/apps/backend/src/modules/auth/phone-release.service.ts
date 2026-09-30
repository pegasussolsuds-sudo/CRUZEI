import type { AccountStatus, PhoneReleaseReason } from '@cruzei/shared-types';
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Request } from 'express';

import { phoneHash } from '../../common/phone-hash';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AccountStateService } from '../account/account-state.service';

/**
 * erros de data do "Essa conta é sua?" por CONTA, SEM prazo: só zeram no acerto ou quando o número sai da conta
 * (qualquer liberação, inclusive a do painel)
 */
export const claimFailsKey = (userId: string) => `auth:claim:fails:${userId}`;

/** de onde veio o pedido que liberou o número (Marco Civil), no formato do access_logs */
export interface RequestMeta {
  ip: string | null;
  port: number | null;
  userAgent: string | null;
}

export function requestMeta(req?: Request): RequestMeta {
  const ip = req?.ip ?? req?.socket?.remoteAddress ?? null;
  return {
    ip: ip?.slice(0, 45) ?? null,
    port: req?.socket?.remotePort ?? null,
    userAgent: req?.get?.('user-agent')?.slice(0, 255) ?? null,
  };
}

export interface ReleaseInput {
  /** conta antiga, que perde o número */
  userId: string;
  /** o número que sai: só libera se a conta AINDA tem este número (desafio velho / corrida não soltam outro) */
  phone: string;
  reason: PhoneReleaseReason;
  meta?: RequestMeta;
  /** admin que liberou pelo painel (reason 'admin') */
  releasedBy?: string | null;
}

/** situação da conta antiga que faz a conta nova com o mesmo número nascer em revisão */
const HOLD_STATUSES: readonly AccountStatus[] = ['banned', 'suspended'];

/** nota do histórico de moderação da conta antiga (o painel mostra na ficha e na trilha) */
const RELEASE_NOTE: Record<PhoneReleaseReason, string> = {
  not_mine: 'Número liberado no login: quem tem o número disse que a conta não é dela',
  birthdate_mismatch: 'Número liberado no login: a data de nascimento não bateu nas tentativas',
  account_deleted: 'Número liberado no login: a conta tinha sido excluída',
  admin: 'Número liberado pelo painel',
};

type Tx = Prisma.TransactionClient;

/**
 * Número reciclado: tira o telefone de uma conta antiga pra outra pessoa poder usar. A conta antiga fica pausada sem
 * prazo (some do mapa, cartões e descoberta; o suporte recupera), perde o push e TODAS as sessões (sessions_valid_after).
 * O histórico oficial fica em phone_releases (quem, quando, por quê, de onde e qual conta nasceu depois).
 *
 * Não injeta ChatGateway nem ModerationService: o RealtimeModule importa o AuthModule (ciclo). Conta parada há 90+ dias
 * não tem socket vivo; o painel (que libera conta ativa) derruba o socket por conta própria.
 */
@Injectable()
export class PhoneReleaseService {
  private readonly log = new Logger(PhoneReleaseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly accounts: AccountStateService,
  ) {}

  /**
   * último uso da conta: o maior entre last_active_at (só anda com posição), created_at (piso), access_logs (login e
   * refresh, desde 29/09/2026) e device_tokens (registro do push ao abrir o app). Colunas TIMESTAMP em UTC.
   */
  async lastUsedAt(userId: string): Promise<Date | null> {
    const [r] = await this.prisma.$queryRaw<{ at: Date | null }[]>`
      SELECT GREATEST(
               u.last_active_at,
               u.created_at,
               (SELECT max(a.created_at) FROM access_logs a WHERE a.user_id = u.id),
               (SELECT max(d.last_used_at) FROM device_tokens d WHERE d.user_id = u.id)
             ) AS at
        FROM users u
       WHERE u.id = ${userId}::uuid`;
    return r?.at ?? null;
  }

  /** true = liberou agora; false = a conta não tinha mais este número (outro pedido chegou antes) */
  async release(input: ReleaseInput): Promise<boolean> {
    const { userId, phone, reason } = input;
    const meta = input.meta ?? { ip: null, port: null, userAgent: null };
    const lastUsedAt = await this.lastUsedAt(userId);
    const now = new Date();
    const done = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.findUnique({
        where: { id: userId },
        select: { phone: true, accountStatus: true, trialUsedAt: true },
      });
      if (!u || u.phone !== phone) return false;
      // teste grátis já usado por esta conta: o número leva a marca junto (a conta nova não ganha outro teste)
      if (u.trialUsedAt) {
        await tx.$executeRaw`
          INSERT INTO trial_claims (phone_hash, user_id) VALUES (${phoneHash(phone)}, ${userId}::uuid)
          ON CONFLICT (phone_hash) DO NOTHING`;
      }
      // o guard do phone no WHERE segura a corrida entre dois pedidos com o mesmo desafio
      const r = await tx.user.updateMany({
        where: { id: userId, phone },
        data: {
          phone: null,
          phoneReleasedAt: now,
          sessionsValidAfter: now,
          isPaused: true,
          pausedUntil: null,
        },
      });
      if (!r.count) return false;
      await tx.phoneRelease.create({
        data: {
          userId,
          phone,
          reason,
          accountStatus: u.accountStatus,
          lastUsedAt,
          ip: meta.ip,
          port: meta.port,
          userAgent: meta.userAgent,
          releasedBy: input.releasedBy ?? null,
        },
      });
      // o push da conta antiga ia pro aparelho de quem tinha o número antes: não manda mais nada
      await tx.deviceToken.deleteMany({ where: { userId } });
      // pelo painel a trilha já tem o admin.user.release_phone; pelo app fica no histórico de moderação (automático)
      if (reason !== 'admin') {
        await tx.moderationAction.create({
          data: {
            moderatorId: null,
            targetUserId: userId,
            action: 'phone_released',
            note: RELEASE_NOTE[reason],
          },
        });
      }
      return true;
    });
    if (!done) return false;
    this.log.warn(`número liberado da conta ${userId} (${reason})`);
    // estado da conta (sessões) cai em todos os processos; some do mapa e o /me em cache vai embora
    await this.accounts.invalidate(userId);
    await this.redis.client.del(claimFailsKey(userId)).catch(() => undefined);
    await this.redis.markPresenceHidden(userId).catch(() => undefined);
    await this.redis.invalidateProfile(userId).catch(() => undefined);
    return true;
  }

  /**
   * Conta nova com o número (dentro da transação do cadastro): liga as liberações ainda sem dono a ela
   * (phone_releases.new_user_id) e diz se alguma veio de conta banida/suspensa — aí a conta nova nasce em revisão.
   */
  async pendingReleases(
    tx: Tx,
    phone: string,
  ): Promise<{ id: bigint; userId: string; accountStatus: AccountStatus; createdAt: Date }[]> {
    return tx.phoneRelease.findMany({
      where: { phone, newUserId: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, userId: true, accountStatus: true, createdAt: true },
    });
  }

  async linkNewAccount(tx: Tx, releaseIds: bigint[], newUserId: string): Promise<void> {
    if (!releaseIds.length) return;
    await tx.phoneRelease.updateMany({
      where: { id: { in: releaseIds }, newUserId: null },
      data: { newUserId },
    });
  }

  /** a liberação veio de conta banida/suspensa? (evasão de banimento: a conta nova entra em revisão) */
  static needsHold(releases: { accountStatus: AccountStatus }[]): boolean {
    return releases.some((r) => HOLD_STATUSES.includes(r.accountStatus));
  }
}
