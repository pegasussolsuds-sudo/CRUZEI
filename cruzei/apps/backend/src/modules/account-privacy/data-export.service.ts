import { DATA_EXPORT_FILE_PREFIX, type DataExportV1 } from '@cruzei/shared-types';
import { HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';

import { photoUrl } from '../../common/photo-url';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { ownerVisible } from '../uploads/photo-retention';

import {
  buildDataExport,
  EXPORT_MODERATION_ACTIONS,
  exportFileName,
  type ExportRows,
} from './data-export.mapper';
import { privacyConfig } from './privacy-config';
import { OPEN_REPORT_STATUSES } from './purge-plan';
import { learnedHomeCells } from './user-redis';

/** mensagens lidas por vez (conta com muita conversa não segura uma consulta gigante) */
const MESSAGE_BATCH = 5_000;

export const EXPORT_LIMIT_MESSAGE = 'Você já baixou seus dados hoje. Dá pra pedir de novo amanhã.';

/**
 * "Baixar meus dados": lê tudo da pessoa (banco + Redis) e monta o DataExportV1. Limite diário por pessoa
 * (DATA_EXPORT_DAILY_LIMIT, contador no Redis); o controller registra o access_log 'data_export'.
 */
@Injectable()
export class DataExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** gasta uma cópia do dia; passou do limite → 429 export_limit {retryAfter} */
  async takeQuota(userId: string): Promise<void> {
    const { exportDaily } = privacyConfig();
    const n = await this.redis.incrRate(userId, 'export', 86_400);
    if (n <= exportDaily) return;
    const ttl = await this.redis.client.ttl(`rate:${userId}:export`).catch(() => -1);
    throw new HttpException(
      { error: 'export_limit', message: EXPORT_LIMIT_MESSAGE, retryAfter: ttl > 0 ? ttl : 86_400 },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /** a montagem falhou: a cópia não conta (sem passar de zero) */
  async refundQuota(userId: string): Promise<void> {
    const key = `rate:${userId}:export`;
    const n = await this.redis.client.decr(key).catch(() => null);
    if (n !== null && n < 0) await this.redis.client.del(key).catch(() => undefined);
  }

  fileName(now = new Date()): string {
    return exportFileName(DATA_EXPORT_FILE_PREFIX, now);
  }

  async build(userId: string, now = new Date()): Promise<DataExportV1> {
    const rows = await this.readRows(userId);
    return buildDataExport(rows, now, (s) => photoUrl(s) ?? s);
  }

  private async readRows(userId: string): Promise<ExportRows> {
    const p = this.prisma;
    const user = await p.user.findUnique({
      where: { id: userId },
      // nunca password_hash, sessions_valid_after, selfie de verificação nem campos internos
      select: {
        id: true,
        phone: true,
        email: true,
        createdAt: true,
        lastActiveAt: true,
        role: true,
        accountStatus: true,
        suspendedUntil: true,
        moderationReason: true,
        termsVersion: true,
        termsAcceptedAt: true,
        orientationConsentedAt: true,
        name: true,
        birthDate: true,
        gender: true,
        orientation: true,
        showOrientation: true,
        sameOrientationFirst: true,
        bio: true,
        instagramHandle: true,
        lookingFor: true,
        avatarConfig: true,
        isVerified: true,
        profileCompleteness: true,
        showMe: true,
        ageMin: true,
        ageMax: true,
        visibilityMode: true,
        anonymousUntil: true,
        showDistance: true,
        showAge: true,
        showPhotoOnMap: true,
        discoveryMode: true,
        isPaused: true,
        pausedUntil: true,
        premiumTier: true,
        premiumExpiresAt: true,
        trialUsedAt: true,
      },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    const byMe = { where: { userId } } as const;

    const [
      interests,
      seals,
      prefs,
      photos,
      privateAreas,
      history,
      checkins,
      placeVotes,
      placeReports,
      likesSent,
      likesReceivedCount,
      passes,
      visitsMade,
      visitsReceivedCount,
      blocks,
      conversations,
      reportsMade,
      moderationActions,
      notifications,
      devices,
      subscriptions,
      boosts,
      superLikeUses,
      support,
      analytics,
      accessLogs,
      deletionRequests,
    ] = await Promise.all([
      p.userInterest.findMany({ ...byMe, select: { interest: { select: { name: true } } } }),
      p.seal.findMany({
        ...byMe,
        select: { sealType: true, progress: true, target: true, isCompleted: true, earnedAt: true },
      }),
      p.notificationPref.findUnique({
        where: { userId },
        select: {
          campaigns: true,
          events: true,
          messages: true,
          likes: true,
          matches: true,
          messagePreview: true,
        },
      }),
      p.photo.findMany({
        ...byMe,
        orderBy: { orderIndex: 'asc' },
        select: {
          url: true,
          thumbnailUrl: true,
          orderIndex: true,
          isMain: true,
          status: true,
          rejectReason: true,
          createdAt: true,
          moderationLabels: true,
        },
      }),
      p.privateArea.findMany({
        ...byMe,
        orderBy: { createdAt: 'asc' },
        select: { label: true, radiusM: true, latitude: true, longitude: true, createdAt: true },
      }),
      p.location.findMany({
        ...byMe,
        orderBy: { recordedAt: 'desc' },
        select: {
          latitude: true,
          longitude: true,
          accuracyMeters: true,
          city: true,
          state: true,
          recordedAt: true,
        },
      }),
      p.poisCheckin.findMany({
        ...byMe,
        orderBy: { checkinAt: 'desc' },
        select: { poiId: true, checkinAt: true, durationMinutes: true },
      }),
      p.$queryRaw<{ candidateId: bigint; kind: string; votedOn: Date }[]>`
        SELECT candidate_id AS "candidateId", kind, voted_on AS "votedOn"
          FROM place_votes WHERE user_id = ${userId}::uuid ORDER BY voted_on DESC`,
      p.$queryRaw<{ poiId: bigint; reason: string | null; reportedOn: Date }[]>`
        SELECT poi_id AS "poiId", reason, reported_on AS "reportedOn"
          FROM poi_reports WHERE user_id = ${userId}::uuid ORDER BY reported_on DESC`,
      p.like.findMany({
        where: { likerId: userId },
        orderBy: { createdAt: 'desc' },
        select: { likedId: true, isSuper: true, createdAt: true },
      }),
      p.like.count({ where: { likedId: userId } }),
      p.pass.findMany({
        ...byMe,
        orderBy: { createdAt: 'desc' },
        select: { targetId: true, createdAt: true },
      }),
      p.visit.findMany({
        where: { visitorId: userId },
        orderBy: { visitedAt: 'desc' },
        select: { visitedId: true, visitedAt: true, wasAnonymous: true },
      }),
      p.visit.count({ where: { visitedId: userId } }),
      p.block.findMany({
        where: { blockerId: userId },
        orderBy: { createdAt: 'desc' },
        select: { blockedId: true, reason: true, createdAt: true },
      }),
      p.conversation.findMany({
        where: { OR: [{ userLowId: userId }, { userHighId: userId }] },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          createdAt: true,
          promotedAt: true,
          userLowId: true,
          userHighId: true,
          members: { where: { userId }, select: { role: true, archivedAt: true, isMuted: true } },
        },
      }),
      // só as FEITAS pela pessoa: as contra ela não saem (protege quem denunciou)
      p.report.findMany({
        where: { reporterId: userId },
        orderBy: { createdAt: 'desc' },
        select: {
          reporterId: true,
          reportedId: true,
          reason: true,
          description: true,
          status: true,
          createdAt: true,
        },
      }),
      // lista BRANCA: sem 'auto_hold' (retenção silenciosa), 'auto_flag_gps' (antifraude), 'dismiss'…
      p.moderationAction.findMany({
        where: {
          targetUserId: userId,
          OR: [
            { action: { in: [...EXPORT_MODERATION_ACTIONS] } },
            { action: { startsWith: 'suspend:' } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        select: { action: true, createdAt: true, reportId: true },
      }),
      p.notification.findMany({
        ...byMe,
        orderBy: { sentAt: 'desc' },
        select: { type: true, title: true, body: true, sentAt: true, readAt: true },
      }),
      p.deviceToken.findMany({
        ...byMe,
        select: { platform: true, appVersion: true, createdAt: true, lastUsedAt: true },
      }),
      p.subscription.findMany({
        ...byMe,
        orderBy: { startsAt: 'desc' },
        select: {
          tier: true,
          platform: true,
          productId: true,
          startsAt: true,
          expiresAt: true,
          cancelledAt: true,
          trialEndsAt: true,
        },
      }),
      p.boost.findMany({
        ...byMe,
        orderBy: { startedAt: 'desc' },
        select: { startedAt: true, expiresAt: true, amountCents: true, platform: true },
      }),
      p.superLikeUse.findMany({
        ...byMe,
        orderBy: { day: 'desc' },
        select: { day: true, used: true },
      }),
      p.supportThread.findMany({
        ...byMe,
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          status: true,
          urgent: true,
          createdAt: true,
          messages: {
            where: { internal: false },
            orderBy: { createdAt: 'asc' },
            select: { author: true, body: true, internal: true, createdAt: true },
          },
        },
      }),
      p.analyticsEvent.findMany({
        ...byMe,
        orderBy: { createdAt: 'asc' },
        select: { name: true, step: true, createdAt: true },
      }),
      p.accessLog.findMany({
        ...byMe,
        orderBy: { createdAt: 'desc' },
        select: { event: true, ip: true, port: true, userAgent: true, createdAt: true },
      }),
      p.dataDeletionRequest.findMany({
        ...byMe,
        orderBy: { requestedAt: 'desc' },
        select: { requestedAt: true, scheduledFor: true, status: true, cancelledAt: true },
      }),
    ]);

    return {
      user: user as unknown as ExportRows['user'],
      interests: interests.map((i) => i.interest.name),
      seals,
      notificationPrefs: prefs,
      // retida por denúncia: pra pessoa ela foi apagada (igual às denúncias contra ela, não sai na cópia)
      photos: ownerVisible(photos).map(({ moderationLabels: _labels, ...ph }) => ph),
      privateAreas,
      presence: await this.presence(userId),
      history,
      checkins,
      learnedHomeCells: await learnedHomeCells(this.redis.client, userId).catch(() => []),
      placeVotes,
      placeReports,
      likesSent,
      likesReceivedCount,
      passes,
      visitsMade,
      visitsReceivedCount,
      blocks,
      conversations: conversations.map(({ members, ...c }) => ({ ...c, me: members[0] ?? null })),
      myMessages: await this.myMessages(userId),
      reportsMade,
      moderationActions,
      openReportIds: await this.openReportIds(moderationActions),
      notifications,
      devices,
      subscriptions,
      boosts,
      superLikeUses,
      support,
      analytics,
      accessLogs,
      deletionRequests,
    };
  }

  /** denúncias ainda em análise ligadas às ações (essas ações não saem na cópia) */
  private async openReportIds(actions: { reportId: string | null }[]): Promise<string[]> {
    const ids = [...new Set(actions.map((a) => a.reportId).filter((id): id is string => !!id))];
    if (!ids.length) return [];
    const open = await this.prisma.report.findMany({
      where: { id: { in: ids }, status: { in: [...OPEN_REPORT_STATUSES] } },
      select: { id: true },
    });
    return open.map((r) => r.id);
  }

  /** posição atual guardada pro mapa (user:loc, até 2 h) */
  private async presence(userId: string): Promise<ExportRows['presence']> {
    try {
      const h = await this.redis.client.hgetall(`user:loc:${userId}`);
      if (!h || h.lat === undefined || h.lng === undefined) return null;
      const at = Number(h.updated_at);
      return { lat: h.lat, lng: h.lng, updatedAt: Number.isFinite(at) ? at : null };
    } catch {
      return null;
    }
  }

  /** mensagens DA PESSOA em lotes (cursor por id), sem as de sistema */
  private async myMessages(userId: string): Promise<ExportRows['myMessages']> {
    const out: ExportRows['myMessages'] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await this.prisma.message.findMany({
        where: { senderId: userId, systemKind: null },
        orderBy: { id: 'asc' },
        take: MESSAGE_BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          conversationId: true,
          senderId: true,
          messageType: true,
          systemKind: true,
          body: true,
          mediaUrl: true,
          lat: true,
          lng: true,
          createdAt: true,
          readAt: true,
        },
      });
      out.push(...page);
      if (page.length < MESSAGE_BATCH) break;
      cursor = page[page.length - 1].id;
    }
    return out;
  }
}
