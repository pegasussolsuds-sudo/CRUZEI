import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { INBOX_EVENTS } from '@cruzei/shared-types';
import type {
  ConversationRemovedPayload,
  ModerationActionPayload,
  ModerationQueue,
  ModerationReport,
  ModerationReportGroup,
  ModerationUserDetail,
  ModerationUserSummary,
  ReportPayload,
  ReportReason,
  UserRole,
} from '@cruzei/shared-types';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { ChatGateway } from '../../realtime/chat.gateway';
import { AccountStateService, blockedBody } from '../account/account-state.service';
import { PhotoModerationService } from './photo-moderation.service';
import { lockPair } from '../inbox/inbox.queries';

const SUMMARY_SELECT = {
  id: true,
  name: true,
  birthDate: true,
  accountStatus: true,
  suspendedUntil: true,
  reviewHoldAt: true,
  createdAt: true,
  photos: { orderBy: [{ isMain: 'desc' as const }, { orderIndex: 'asc' as const }], take: 1, select: { url: true } },
};

type SummaryRow = {
  id: string;
  name: string;
  birthDate: Date;
  accountStatus: 'active' | 'suspended' | 'banned';
  suspendedUntil: Date | null;
  reviewHoldAt: Date | null;
  createdAt: Date;
  photos: { url: string }[];
};

/**
 * Moderação: o que acontece sozinho (tirar da descoberta até a revisão) e o que o moderador decide (dispensar,
 * advertir, suspender, banir, reabilitar; aprovar/recusar foto). Toda decisão vai pra trilha `moderation_actions`.
 */
@Injectable()
export class ModerationService {
  private readonly log = new Logger(ModerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly accounts: AccountStateService,
    private readonly gateway: ChatGateway,
    private readonly photos: PhotoModerationService,
  ) {}

  // ---------------------------------------------------------------------------------------------
  // automático
  // ---------------------------------------------------------------------------------------------

  /** tira a pessoa da descoberta (mapa, cartão, lugares) até um moderador revisar; ela continua usando o app */
  async holdForReview(userId: string, why: string): Promise<void> {
    const r = await this.prisma.user.updateMany({ where: { id: userId, reviewHoldAt: null }, data: { reviewHoldAt: new Date() } });
    if (r.count) {
      await this.prisma.moderationAction.create({ data: { moderatorId: null, targetUserId: userId, action: 'auto_hold', note: why } });
      this.log.warn(`perfil ${userId} fora da descoberta até revisão: ${why}`);
    }
    await this.hideNow(userId);
  }

  private async hideNow(userId: string): Promise<void> {
    await this.redis.markPresenceHidden(userId).catch(() => undefined);
    await this.redis.invalidateProfile(userId);
  }

  // ---------------------------------------------------------------------------------------------
  // fila
  // ---------------------------------------------------------------------------------------------

  async queue(): Promise<ModerationQueue> {
    const reports = await this.prisma.report.findMany({
      where: { status: 'pending' },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      take: 500,
      include: { reported: { select: SUMMARY_SELECT } },
    });
    const groups = new Map<string, ModerationReportGroup & { reporters: Set<string> }>();
    for (const r of reports) {
      let g = groups.get(r.reportedId);
      if (!g) {
        g = { user: this.summary(r.reported as SummaryRow), reports: [], priority: 0, distinctReporters: 0, firstAt: r.createdAt.toISOString(), reporters: new Set() };
        groups.set(r.reportedId, g);
      }
      g.reports.push(this.report(r));
      g.priority = Math.max(g.priority, r.priority);
      if (r.reporterId) g.reporters.add(r.reporterId);
      if (r.createdAt.toISOString() < g.firstAt) g.firstAt = r.createdAt.toISOString();
    }
    const out = [...groups.values()]
      .map(({ reporters, ...g }) => ({ ...g, distinctReporters: reporters.size }))
      .sort((a, b) => b.priority - a.priority || b.distinctReporters - a.distinctReporters || (a.firstAt < b.firstAt ? -1 : 1));

    const pending = await this.prisma.photo.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
      take: 200,
      select: { id: true, url: true, userId: true, createdAt: true, moderationLabels: true, user: { select: { name: true } } },
    });
    const photos = pending
      .map((p) => {
        const m = (p.moderationLabels ?? {}) as { labels?: string[]; urgent?: boolean };
        return { id: p.id, url: p.url, userId: p.userId, userName: p.user.name, labels: m.labels ?? [], createdAt: p.createdAt.toISOString(), urgent: Boolean(m.urgent) };
      })
      .sort((a, b) => Number(b.urgent) - Number(a.urgent) || (a.createdAt < b.createdAt ? -1 : 1))
      .map(({ urgent: _u, ...p }) => p);
    return { reports: out, photos };
  }

  async userDetail(userId: string): Promise<ModerationUserDetail> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        ...SUMMARY_SELECT,
        bio: true,
        phone: true,
        role: true,
        photos: { orderBy: { orderIndex: 'asc' }, select: { id: true, url: true, status: true, isMain: true, rejectReason: true } },
      },
    });
    if (!u) throw new NotFoundException('Usuário não encontrado');
    const [reports, actions] = await Promise.all([
      this.prisma.report.findMany({ where: { reportedId: userId }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.moderationAction.findMany({ where: { targetUserId: userId }, orderBy: { createdAt: 'desc' }, take: 50 }),
    ]);
    // só as conversas citadas nas denúncias (a política de privacidade avisa que a moderação pode lê-las).
    const conversationIds = [
      ...new Set(
        reports
          .map((r) => {
            const c = r.context as { conversationId?: string } | null;
            return c?.conversationId;
          })
          .filter((id): id is string => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id))
          .map((id) => id.toLowerCase()),
      ),
    ].slice(0, 5);
    const conversations: ModerationUserDetail['conversations'] = [];
    for (const conversationId of conversationIds) {
      const c = await this.prisma.conversation.findUnique({ where: { id: conversationId }, select: { userLowId: true, userHighId: true } });
      // só conversa da pessoa denunciada (o contexto vem do app de quem denunciou)
      if (!c || (c.userLowId !== userId && c.userHighId !== userId)) continue;
      const msgs = await this.prisma.message.findMany({ where: { conversationId }, orderBy: { createdAt: 'desc' }, take: 40 });
      conversations.push({
        conversationId,
        otherUserId: c.userLowId === userId ? c.userHighId : c.userLowId,
        messages: msgs.reverse().map((x) => ({ id: x.id, senderId: x.senderId, content: x.body, messageType: x.messageType, createdAt: x.createdAt.toISOString() })),
      });
    }
    const summaryRow = { ...u, photos: u.photos.filter((p) => p.isMain).concat(u.photos).slice(0, 1) } as SummaryRow;
    return {
      user: { ...this.summary(summaryRow), bio: u.bio, phoneMasked: maskPhone(u.phone), role: u.role as UserRole },
      photos: u.photos.map((p) => ({ id: p.id, url: p.url, status: p.status, isMain: p.isMain, rejectReason: p.rejectReason })),
      reports: reports.map((r) => this.report(r)),
      actions: actions.map((a) => ({ action: a.action, note: a.note, moderatorId: a.moderatorId, createdAt: a.createdAt.toISOString() })),
      conversations,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // decisões
  // ---------------------------------------------------------------------------------------------

  async act(moderator: { id: string; role?: UserRole }, targetId: string, p: ModerationActionPayload): Promise<{ ok: true }> {
    if (targetId === moderator.id) throw new BadRequestException('Você não pode moderar a própria conta');
    const target = await this.prisma.user.findUnique({ where: { id: targetId }, select: { id: true, role: true } });
    if (!target) throw new NotFoundException('Usuário não encontrado');
    if (target.role !== 'user' && moderator.role !== 'admin') throw new ForbiddenException('Só um admin modera outro moderador');
    const reason = p.reason?.trim().slice(0, 255) || null;
    const note = p.note?.trim().slice(0, 2000) || null;

    switch (p.action) {
      case 'dismiss':
        await this.resolveReports(targetId, moderator.id, 'dismissed', 'dismiss');
        await this.prisma.user.update({ where: { id: targetId }, data: { reviewHoldAt: null } });
        break;
      case 'warn':
        await this.resolveReports(targetId, moderator.id, 'resolved', 'warn');
        await this.prisma.user.update({ where: { id: targetId }, data: { reviewHoldAt: null } });
        await this.prisma.notification.create({
          data: { userId: targetId, type: 'moderation_warning', title: 'Aviso da moderação', body: reason ?? 'Seu comportamento foi denunciado e viola os Termos de Uso.' },
        });
        this.gateway.emitToUser(targetId, 'account_notice', { kind: 'warning', message: reason ?? 'Seu comportamento foi denunciado e viola os Termos de Uso.' });
        break;
      case 'suspend': {
        const days = p.days ? Math.min(365, Math.max(1, Math.round(p.days))) : null;
        const until = days ? new Date(Date.now() + days * 86_400_000) : null;
        await this.prisma.user.update({
          where: { id: targetId },
          data: { accountStatus: 'suspended', suspendedUntil: until, moderationReason: reason, reviewHoldAt: null },
        });
        await this.resolveReports(targetId, moderator.id, 'resolved', days ? `suspend:${days}d` : 'suspend:review');
        await this.cutAccess(targetId, blockedBody({ status: 'suspended', until: until?.getTime() ?? null, reason }));
        break;
      }
      case 'ban':
        await this.prisma.user.update({
          where: { id: targetId },
          data: { accountStatus: 'banned', suspendedUntil: null, moderationReason: reason, reviewHoldAt: null },
        });
        await this.resolveReports(targetId, moderator.id, 'resolved', 'ban');
        await this.archiveConversations(targetId);
        // o número fica preso à conta banida (users.phone é único): não dá pra se cadastrar de novo com ele.
        // Quando existir exclusão de conta, ela precisa manter o banimento (hash do telefone).
        await this.cutAccess(targetId, blockedBody({ status: 'banned', until: null, reason }));
        break;
      case 'reinstate':
        await this.prisma.user.update({
          where: { id: targetId },
          data: { accountStatus: 'active', suspendedUntil: null, moderationReason: null, reviewHoldAt: null },
        });
        await this.accounts.invalidate(targetId);
        await this.redis.invalidateProfile(targetId);
        break;
      default:
        throw new BadRequestException('Ação desconhecida');
    }
    await this.prisma.moderationAction.create({
      data: { moderatorId: moderator.id, targetUserId: targetId, action: p.action + (p.action === 'suspend' ? `:${p.days ?? 'revisao'}` : ''), note: [reason, note].filter(Boolean).join(' · ') || null },
    });
    if (p.action === 'dismiss' || p.action === 'warn') await this.redis.invalidateProfile(targetId);
    return { ok: true };
  }

  async photoDecision(moderatorId: string, photoId: string, decision: 'approve' | 'reject', reason?: string): Promise<{ ok: true }> {
    const p = await this.prisma.photo.findUnique({ where: { id: photoId }, select: { id: true } });
    if (!p) throw new NotFoundException('Foto não encontrada');
    await this.photos.decide(photoId, decision === 'approve' ? 'approved' : 'rejected', {
      moderatorId,
      reason: decision === 'reject' ? reason?.trim().slice(0, 100) || 'Não segue as regras de fotos do Metch' : null,
    });
    return { ok: true };
  }

  // ---------------------------------------------------------------------------------------------

  private async resolveReports(userId: string, moderatorId: string, status: 'resolved' | 'dismissed', actionTaken: string) {
    await this.prisma.report.updateMany({
      where: { reportedId: userId, status: { in: ['pending', 'reviewing'] } },
      data: { status, reviewedBy: moderatorId, reviewedAt: new Date(), actionTaken },
    });
  }

  /** suspensão/banimento: some do mapa, perde o token e o socket na hora (todos os processos) */
  private async cutAccess(userId: string, reason: unknown) {
    await this.accounts.invalidate(userId);
    await this.hideNow(userId);
    this.gateway.disconnectUser(userId, reason);
  }

  /**
   * banimento: todas as conversas da pessoa são arquivadas PROS DOIS lados e as não lidas zeram (somem do inbox e das
   * solicitações de quem conversava com ela). Like e Message ficam (a moderação ainda lê). Eventos depois do commit.
   */
  private async archiveConversations(userId: string) {
    const convs = await this.prisma.$transaction(async (tx) => {
      // só as que ainda aparecem pra alguém (repetir o banimento não gera evento de novo)
      const open = await tx.conversation.findMany({
        where: { OR: [{ userLowId: userId }, { userHighId: userId }], members: { some: { archivedAt: null } } },
        select: { id: true, userLowId: true, userHighId: true },
      });
      if (!open.length) return open;
      // a trava de cada par (a mesma do InboxService, em ordem de id): um envio em andamento termina antes e o
      // próximo já vê a conta banida (404) — ninguém desarquiva depois daqui
      for (const c of [...open].sort((a, b) => (a.id < b.id ? -1 : 1))) await lockPair(tx, c.userLowId, c.userHighId);
      const ids = open.map((c) => c.id);
      await tx.conversationMember.updateMany({ where: { conversationId: { in: ids } }, data: { unreadCount: 0 } });
      await tx.conversationMember.updateMany({ where: { conversationId: { in: ids }, archivedAt: null }, data: { archivedAt: new Date() } });
      return open;
    }, { timeout: 30_000 }); // quem tem centenas de conversas: uma trava por par cabe no prazo
    for (const c of convs) {
      const pair = [c.userLowId, c.userHighId];
      const payload: ConversationRemovedPayload = { conversationId: c.id };
      this.gateway.emitToUsers(pair, INBOX_EVENTS.conversationRemoved, payload);
      this.gateway.removeFromConversation(c.id, pair);
      await this.redis.invalidateProfile(c.userLowId === userId ? c.userHighId : c.userLowId);
    }
  }

  private summary(u: SummaryRow): ModerationUserSummary {
    return {
      id: u.id,
      name: u.name,
      age: ageOf(u.birthDate),
      mainPhotoUrl: u.photos[0]?.url ?? null,
      accountStatus: u.accountStatus,
      suspendedUntil: u.suspendedUntil?.toISOString() ?? null,
      reviewHoldAt: u.reviewHoldAt?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
    };
  }

  private report(r: { id: string; reason: string; description: string | null; reporterId: string | null; context: unknown; priority: number; createdAt: Date }): ModerationReport {
    return {
      id: r.id,
      reason: r.reason as ReportReason,
      description: r.description,
      reporterId: r.reporterId,
      context: (r.context as ReportPayload['context']) ?? null,
      priority: r.priority,
      createdAt: r.createdAt.toISOString(),
    };
  }
}

function ageOf(birth: Date): number {
  const t = new Date();
  let a = t.getFullYear() - birth.getFullYear();
  const m = t.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && t.getDate() < birth.getDate())) a -= 1;
  return a;
}

/** +55 34 9••••-1234: o moderador confere o número sem ver ele inteiro */
function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  const d = phone.replace(/\D/g, '');
  return d.length < 8 ? '••••' : `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 5)}••••-${d.slice(-4)}`;
}
