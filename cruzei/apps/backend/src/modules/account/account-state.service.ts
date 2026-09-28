import { ForbiddenException, Injectable, Logger, OnModuleDestroy, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import type Redis from 'ioredis';
import type { AccountBlockedError, UserRole } from '@cruzei/shared-types';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { ExpiringCache } from '../location/hot-path';

export const ACCOUNT_CHANNEL = 'metch:acct';
const REDIS_TTL_S = 600;
/** cada processo lembra o estado por pouco tempo; banir publica no canal e todos esquecem na hora */
const LOCAL_TTL_MS = 15_000;

export interface AccountState {
  status: 'active' | 'suspended' | 'banned' | 'gone';
  /** fim da suspensão (ms); null = até a revisão */
  until: number | null;
  reason: string | null;
  role: UserRole;
}

/**
 * Estado da conta conferido em TODA requisição autenticada (JwtStrategy) e no handshake do socket: um token válido
 * não basta — conta banida, suspensa ou excluída perde o acesso na hora, sem esperar o token vencer.
 */
@Injectable()
export class AccountStateService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(AccountStateService.name);
  private readonly local = new ExpiringCache<string, AccountState>(LOCAL_TTL_MS, 100_000);
  private sub: Redis | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      this.sub = this.redis.client.duplicate();
      this.sub.on('message', (_ch: string, id: string) => (id === '*' ? this.local.clear() : this.local.delete(id)));
      this.sub.on('error', () => undefined);
      await this.sub.subscribe(ACCOUNT_CHANNEL);
    } catch (e) {
      this.log.warn(`sem assinatura do canal de contas (${(e as Error).message}); o cache local vence em ${LOCAL_TTL_MS / 1000} s`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.sub?.quit().catch(() => undefined);
  }

  async get(userId: string): Promise<AccountState> {
    const now = Date.now();
    this.local.prune(now, 200);
    const hit = this.local.get(userId, now);
    if (hit) return hit;
    let st: AccountState | null = null;
    try {
      const raw = await this.redis.client.get(`acct:v1:${userId}`);
      if (raw) st = JSON.parse(raw) as AccountState;
    } catch {
      /* Redis fora: cai no banco */
    }
    if (!st) {
      const u = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { accountStatus: true, suspendedUntil: true, moderationReason: true, role: true, deletedAt: true },
      });
      st = !u || u.deletedAt
        ? { status: 'gone', until: null, reason: null, role: 'user' }
        : { status: u.accountStatus, until: u.suspendedUntil?.getTime() ?? null, reason: u.moderationReason, role: u.role };
      this.redis.client.set(`acct:v1:${userId}`, JSON.stringify(st), 'EX', REDIS_TTL_S).catch(() => undefined);
    }
    this.local.set(userId, st, now);
    return st;
  }

  /** conta pode usar o app? Senão lança 401 (sumiu) ou 403 com o corpo AccountBlockedError. */
  async assertActive(userId: string): Promise<AccountState> {
    const st = await this.get(userId);
    if (st.status === 'active') return st;
    if (st.status === 'gone') throw new UnauthorizedException({ error: 'account_gone', message: 'Conta não encontrada' });
    if (st.status === 'suspended' && st.until !== null && st.until <= Date.now()) {
      // suspensão venceu: volta sozinha (só se ninguém mudou o estado no meio do caminho)
      await this.prisma.user.updateMany({
        where: { id: userId, accountStatus: 'suspended', suspendedUntil: { lte: new Date() } },
        data: { accountStatus: 'active', suspendedUntil: null, moderationReason: null },
      });
      await this.invalidate(userId);
      return this.get(userId);
    }
    throw new ForbiddenException(blockedBody(st));
  }

  /** mesmo que assertActive, sem exceção (socket): devolve o corpo do bloqueio ou null */
  async blockedReason(userId: string): Promise<AccountBlockedError | { error: 'account_gone'; message: string } | null> {
    try {
      await this.assertActive(userId);
      return null;
    } catch (e) {
      const body = (e as ForbiddenException).getResponse?.();
      return (body as AccountBlockedError) ?? { error: 'account_gone', message: 'Conta não encontrada' };
    }
  }

  async invalidate(userId: string): Promise<void> {
    this.local.delete(userId);
    try {
      await this.redis.client.del(`acct:v1:${userId}`);
      await this.redis.client.publish(ACCOUNT_CHANNEL, userId);
    } catch {
      /* sem Redis: o cache local dos outros processos vence em 15 s */
    }
  }
}

export function blockedBody(st: Pick<AccountState, 'status' | 'until' | 'reason'>): AccountBlockedError {
  if (st.status === 'banned') {
    return {
      error: 'account_banned',
      message: 'Sua conta foi banida por violar os Termos de Uso do Metch.',
      reason: st.reason,
      until: null,
    };
  }
  const until = st.until ? new Date(st.until) : null;
  const when = until
    ? until.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : null;
  return {
    error: 'account_suspended',
    message: when ? `Sua conta está suspensa até ${when}.` : 'Sua conta está suspensa enquanto a moderação analisa uma denúncia.',
    reason: st.reason,
    until: until ? until.toISOString() : null,
  };
}
