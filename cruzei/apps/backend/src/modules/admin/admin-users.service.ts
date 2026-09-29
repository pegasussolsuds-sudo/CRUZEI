import type {
  AccountStatus,
  AdminSubscriptionRow,
  AdminUserDetail,
  AdminUserList,
  AdminUserRow,
  GrantPremiumPayload,
  ModerationUserDetail,
  PremiumTier,
  UserRole,
} from '@cruzei/shared-types';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { maskPhone } from '../../common/phone-mask';
import { effectiveTier } from '../../common/premium';
import { PrismaService } from '../../database/prisma.service';
import { ChatGateway } from '../../realtime/chat.gateway';
import { RedisService } from '../../redis/redis.service';
import { AccountStateService } from '../account/account-state.service';
import { ModerationService } from '../moderation/moderation.service';
import { NotifyService } from '../notifications/notify.service';
import { UsersService } from '../users/users.service';

import { AuditService } from './audit.service';
import { cursorTs, decodeCursor, encodeCursor, pageSize } from './cursor';
import { isStaff } from './permissions';

/** subscriptions.expires_at é obrigatória: Premium manual sem vencimento grava esta data (o painel mostra "sem vencimento") */
export const NO_EXPIRY = new Date('2099-12-31T23:59:59.000Z');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface UserRowDb {
  id: string;
  name: string;
  phone: string | null;
  birth_date: Date | null;
  avatar_url: string | null;
  role: UserRole;
  account_status: AccountStatus;
  suspended_until: Date | null;
  premium_tier: PremiumTier;
  premium_expires_at: Date | null;
  visibility_mode: 'visible' | 'anonymous';
  reports_pending: number;
  created_at: Date;
  last_active_at: Date | null;
}

const ROW_SELECT = Prisma.sql`
  u.id, u.name, u.phone, u.birth_date, u.role, u.account_status, u.suspended_until, u.premium_tier, u.premium_expires_at,
  u.visibility_mode, u.created_at, u.last_active_at,
  (SELECT COALESCE(p.thumbnail_url, p.url) FROM photos p WHERE p.user_id = u.id
    ORDER BY p.is_main DESC, p.order_index ASC LIMIT 1) AS avatar_url,
  (SELECT count(*) FROM reports r WHERE r.reported_id = u.id AND r.status = 'pending')::int AS reports_pending`;

function ageOf(birth: Date | null): number | null {
  if (!birth) return null;
  const t = new Date();
  let a = t.getUTCFullYear() - birth.getUTCFullYear();
  const m = t.getUTCMonth() - birth.getUTCMonth();
  if (m < 0 || (m === 0 && t.getUTCDate() < birth.getUTCDate())) a -= 1;
  return a;
}

/** Usuários no painel: busca, ficha, Premium manual e papel. Telefone inteiro só pra admin. */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly accounts: AccountStateService,
    private readonly gateway: ChatGateway,
    private readonly moderation: ModerationService,
    private readonly users: UsersService,
    private readonly notify: NotifyService,
    private readonly audit: AuditService,
  ) {}

  toRow(u: UserRowDb, viewerRole: UserRole | undefined): AdminUserRow {
    return {
      id: u.id,
      name: u.name,
      phone: viewerRole === 'admin' ? u.phone : maskPhone(u.phone),
      age: ageOf(u.birth_date),
      avatarUrl: u.avatar_url,
      role: u.role,
      accountStatus: u.account_status,
      suspendedUntil: u.suspended_until?.toISOString() ?? null,
      premiumTier: effectiveTier(u.premium_tier, u.premium_expires_at),
      premiumExpiresAt:
        u.premium_tier === 'free' ? null : (u.premium_expires_at?.toISOString() ?? null),
      visibilityMode: u.visibility_mode,
      reportsPending: u.reports_pending,
      createdAt: u.created_at.toISOString(),
      lastActiveAt: u.last_active_at?.toISOString() ?? null,
    };
  }

  /** filtros da busca (o mesmo WHERE pra página e pro total) */
  private filters(q: { q?: string; status?: string; tier?: string; role?: string }): Prisma.Sql[] {
    const where: Prisma.Sql[] = [Prisma.sql`u.deleted_at IS NULL`];
    const text = q.q?.trim().slice(0, 100);
    if (text) {
      const digits = text.replace(/\D/g, '');
      if (UUID.test(text)) where.push(Prisma.sql`u.id = ${text.toLowerCase()}::uuid`);
      else if (/^[+\d\s().-]+$/.test(text) && digits.length >= 4) {
        where.push(
          Prisma.sql`regexp_replace(COALESCE(u.phone, ''), '\\D', '', 'g') LIKE ${'%' + digits + '%'}`,
        );
      } else {
        where.push(Prisma.sql`u.name ILIKE ${'%' + text.replace(/[%_\\]/g, '\\$&') + '%'}`);
      }
    }
    if (q.status === 'active' || q.status === 'suspended' || q.status === 'banned') {
      where.push(Prisma.sql`u.account_status = ${q.status}::"AccountStatus"`);
    }
    if (q.role === 'user' || q.role === 'moderator' || q.role === 'admin') {
      where.push(Prisma.sql`u.role = ${q.role}::"UserRole"`);
    }
    const vigente = Prisma.sql`(u.premium_expires_at IS NULL OR u.premium_expires_at > (now() AT TIME ZONE 'UTC'))`;
    if (q.tier === 'free') where.push(Prisma.sql`(u.premium_tier = 'free' OR NOT ${vigente})`);
    else if (q.tier === 'premium' || q.tier === 'premium_plus') {
      where.push(Prisma.sql`u.premium_tier = ${q.tier}::"PremiumTier" AND ${vigente}`);
    }
    return where;
  }

  async list(
    viewer: AuthenticatedUser,
    q: {
      q?: string;
      status?: string;
      tier?: string;
      role?: string;
      cursor?: string;
      limit?: unknown;
    },
  ): Promise<AdminUserList> {
    const limit = pageSize(q.limit, 30, 100);
    const where = this.filters(q);
    const cur = decodeCursor(q.cursor, 2);
    const page = cur
      ? [
          ...where,
          Prisma.sql`(u.created_at, u.id) < (${cursorTs(cur[0])}::timestamp, ${cur[1]}::uuid)`,
        ]
      : where;
    const [rows, total] = await Promise.all([
      this.prisma.$queryRaw<(UserRowDb & { cursor_at: string })[]>`
        SELECT ${ROW_SELECT}, to_char(u.created_at, 'YYYY-MM-DD"T"HH24:MI:SS.US') AS cursor_at
          FROM users u WHERE ${Prisma.join(page, ' AND ')}
         ORDER BY u.created_at DESC, u.id DESC LIMIT ${limit + 1}`,
      this.prisma.$queryRaw<
        { n: number }[]
      >`SELECT count(*)::int AS n FROM users u WHERE ${Prisma.join(where, ' AND ')}`,
    ]);
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];
    return {
      items: items.map((u) => this.toRow(u, viewer.role)),
      // created_at (TIMESTAMP em UTC) com microssegundos: o Date do JS cortaria em ms
      nextCursor: rows.length > limit && last ? encodeCursor([last.cursor_at, last.id]) : null,
      total: total[0]?.n ?? 0,
    };
  }

  async row(viewer: AuthenticatedUser, id: string): Promise<AdminUserRow> {
    const [u] = await this.prisma.$queryRaw<
      UserRowDb[]
    >`SELECT ${ROW_SELECT} FROM users u WHERE u.id = ${id}::uuid AND u.deleted_at IS NULL`;
    if (!u) throw new NotFoundException({ error: 'not_found', message: 'Usuário não encontrado' });
    return this.toRow(u, viewer.role);
  }

  /**
   * Ficha completa. Compatibilidade: os campos de ModerationUserDetail também vão no nível de cima (a tela de
   * moderação do celular lê esta mesma rota).
   */
  async detail(
    viewer: AuthenticatedUser,
    id: string,
  ): Promise<AdminUserDetail & ModerationUserDetail> {
    const row = await this.row(viewer, id);
    const [moderation, extra, subs, devices, counts, threads, city] = await Promise.all([
      this.moderation.userDetail(id),
      this.prisma.user.findUnique({ where: { id }, select: { bio: true } }),
      this.prisma.subscription.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.deviceToken.findMany({
        where: { userId: id },
        orderBy: { lastUsedAt: 'desc' },
        select: { platform: true, appVersion: true, lastUsedAt: true },
      }),
      this.prisma.$queryRaw<AdminUserDetail['counts'][]>`
        SELECT (SELECT count(*) FROM likes WHERE liker_id = ${id}::uuid)::int AS "likesSent",
               (SELECT count(*) FROM likes WHERE liked_id = ${id}::uuid)::int AS "likesReceived",
               (SELECT count(*) FROM likes a WHERE a.liker_id = ${id}::uuid
                   AND EXISTS (SELECT 1 FROM likes b WHERE b.liker_id = a.liked_id AND b.liked_id = a.liker_id))::int AS "mutualLikes",
               (SELECT count(*) FROM conversation_members WHERE user_id = ${id}::uuid)::int AS "conversations",
               (SELECT count(*) FROM messages WHERE sender_id = ${id}::uuid)::int AS "messagesSent",
               (SELECT count(*) FROM blocks WHERE blocked_id = ${id}::uuid)::int AS "blocksReceived"`,
      this.prisma.supportThread.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, status: true, createdAt: true },
      }),
      this.cityOf(id),
    ]);
    const granters = [...new Set(subs.map((s) => s.grantedBy).filter((v): v is string => !!v))];
    const names = new Map(
      (
        await this.prisma.user.findMany({
          where: { id: { in: granters } },
          select: { id: true, name: true },
        })
      ).map((u) => [u.id, u.name]),
    );
    const subscriptions: AdminSubscriptionRow[] = subs.map((s) => ({
      id: s.id,
      tier: s.tier as PremiumTier,
      platform: s.platform,
      startsAt: s.startsAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      cancelledAt: s.cancelledAt?.toISOString() ?? null,
      note: s.note,
      grantedBy: s.grantedBy ? { id: s.grantedBy, name: names.get(s.grantedBy) ?? '—' } : null,
    }));
    const admin: AdminUserDetail = {
      ...row,
      moderation,
      bio: extra?.bio ?? null,
      city,
      subscriptions,
      devices: devices.map((d) => ({
        platform: d.platform,
        appVersion: d.appVersion,
        lastUsedAt: d.lastUsedAt.toISOString(),
      })),
      counts: counts[0] ?? {
        likesSent: 0,
        likesReceived: 0,
        mutualLikes: 0,
        conversations: 0,
        messagesSent: 0,
        blocksReceived: 0,
      },
      supportThreads: threads.map((t) => ({
        id: t.id,
        status: t.status as 'open' | 'pending' | 'resolved',
        createdAt: t.createdAt.toISOString(),
      })),
    };
    return { ...moderation, ...admin };
  }

  /** cidade (município) da última posição conhecida — só o nome, nunca o ponto */
  private async cityOf(userId: string): Promise<string | null> {
    const [r] = await this.prisma.$queryRaw<{ name: string }[]>`
      WITH last AS (SELECT l.latitude, l.longitude, l.city FROM locations l WHERE l.user_id = ${userId}::uuid ORDER BY l.recorded_at DESC LIMIT 1)
      SELECT COALESCE(last.city, (SELECT a.name FROM geo_areas a
                                   WHERE a.kind = 'city' AND ST_Covers(a.geom, ST_SetSRID(ST_MakePoint(last.longitude::float8, last.latitude::float8), 4326))
                                   LIMIT 1)) AS name
        FROM last`;
    return r?.name ?? null;
  }

  /**
   * Premium manual (só admin). Dar: linha nova em subscriptions (platform 'manual', motivo, quem deu) substituindo a
   * manual vigente. Tirar ('free'): cancela a manual vigente, volta a 'free' e o avatar perde os itens pagos.
   */
  async setPremium(
    admin: AuthenticatedUser,
    userId: string,
    p: GrantPremiumPayload,
  ): Promise<AdminUserRow> {
    const reason = p.reason.trim().slice(0, 500);
    if (!reason)
      throw new BadRequestException({ error: 'reason_required', message: 'Diga o motivo' });
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, deletedAt: true },
    });
    if (!target || target.deletedAt)
      throw new NotFoundException({ error: 'not_found', message: 'Usuário não encontrado' });
    const now = new Date();
    const days = p.tier === 'free' ? null : p.days;
    if (days !== null && (!Number.isInteger(days) || days < 1 || days > 3650)) {
      throw new BadRequestException({
        error: 'invalid_days',
        message: 'Dias entre 1 e 3650 (ou sem vencimento)',
      });
    }
    const expiresAt = days === null ? null : new Date(now.getTime() + days * 86_400_000);
    await this.prisma.$transaction(async (tx) => {
      await tx.subscription.updateMany({
        where: { userId, platform: 'manual', cancelledAt: null, expiresAt: { gt: now } },
        data: { cancelledAt: now },
      });
      if (p.tier === 'free') {
        await tx.user.update({
          where: { id: userId },
          data: { premiumTier: 'free', premiumExpiresAt: null },
        });
        return;
      }
      await tx.subscription.create({
        data: {
          userId,
          tier: p.tier,
          platform: 'manual',
          productId: null,
          startsAt: now,
          expiresAt: expiresAt ?? NO_EXPIRY,
          note: reason,
          grantedBy: admin.id,
        },
      });
      await tx.user.update({
        where: { id: userId },
        data: { premiumTier: p.tier, premiumExpiresAt: expiresAt },
      });
    });
    if (p.tier === 'free') await this.users.downgradeAvatarToFree(userId);
    await this.redis.invalidateProfile(userId); // /me em cache estava com o plano antigo
    await this.audit.record(
      admin.id,
      p.tier === 'free' ? 'admin.user.premium_remove' : 'admin.user.premium_grant',
      { kind: 'user', id: userId },
      p.tier === 'free'
        ? `Premium removido: ${reason}`
        : `${p.tier} por ${days === null ? 'tempo indeterminado' : `${days} dias`}: ${reason}`,
      { tier: p.tier, days, expiresAt: expiresAt?.toISOString() ?? null },
    );
    if (p.notify) {
      const until = expiresAt
        ? expiresAt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
        : null;
      await this.notify.notify(
        userId,
        p.tier === 'free'
          ? {
              type: 'premium_granted',
              title: 'Seu Premium foi encerrado',
              body: 'Sua conta voltou pro plano grátis. Qualquer dúvida, fala com a gente no suporte.',
              target: { kind: 'premium' },
            }
          : {
              type: 'premium_granted',
              title:
                p.tier === 'premium_plus'
                  ? 'Você ganhou o Metch Premium+ ✨'
                  : 'Você ganhou o Metch Premium ✨',
              body: until
                ? `Presente da equipe Metch, liberado até ${until}.`
                : 'Presente da equipe Metch, sem data pra acabar.',
              target: { kind: 'premium' },
            },
      );
    }
    return this.row(admin, userId);
  }

  /** papel (só admin): nunca o próprio e sempre sobra pelo menos um admin */
  async setRole(admin: AuthenticatedUser, userId: string, role: UserRole): Promise<AdminUserRow> {
    if (userId === admin.id)
      throw new BadRequestException({
        error: 'own_role',
        message: 'Você não pode mudar o seu próprio papel',
      });
    const before = await this.prisma.$transaction(async (tx) => {
      // trava as linhas de admin: duas trocas ao mesmo tempo não zeram os admins
      const admins = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM users WHERE role = 'admin' AND deleted_at IS NULL FOR UPDATE`;
      const target = await tx.user.findUnique({
        where: { id: userId },
        select: { role: true, deletedAt: true },
      });
      if (!target || target.deletedAt)
        throw new NotFoundException({ error: 'not_found', message: 'Usuário não encontrado' });
      if (target.role === role) return target.role;
      if (
        target.role === 'admin' &&
        role !== 'admin' &&
        admins.filter((a) => a.id !== userId).length === 0
      ) {
        throw new ConflictException({
          error: 'last_admin',
          message: 'Precisa sobrar pelo menos um admin',
        });
      }
      await tx.user.update({ where: { id: userId }, data: { role } });
      return target.role;
    });
    if (before !== role) {
      // o guard lê o papel do estado da conta: cai o cache (todos os processos) e vale na próxima requisição
      await this.accounts.invalidate(userId);
      await this.redis.invalidateProfile(userId);
      this.gateway.setStaffMembership(userId, isStaff(role));
      await this.audit.record(
        admin.id,
        'admin.user.role',
        { kind: 'user', id: userId },
        `${before} → ${role}`,
        { from: before, to: role },
      );
    }
    return this.row(admin, userId);
  }
}
