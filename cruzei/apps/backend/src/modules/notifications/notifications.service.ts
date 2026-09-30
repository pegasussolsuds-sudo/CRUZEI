import type { AppNotification, NotificationSettings } from '@cruzei/shared-types';
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service';

import { isUuid, toAppNotification } from './notification-target';

/** tokens por pessoa: celular novo entra, o mais antigo sai (um token velho só gera push perdido) */
const MAX_DEVICES_PER_USER = 10;

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** central de avisos: AppNotification (o destino do toque sai de data.target) */
  async list(
    userId: string,
    limit = 20,
    offset = 0,
    unreadOnly = false,
  ): Promise<AppNotification[]> {
    const rows = await this.prisma.notification.findMany({
      where: {
        userId,
        ...(unreadOnly ? { readAt: null } : {}),
      },
      orderBy: { sentAt: 'desc' },
      take: Math.min(100, Math.max(1, Number.isFinite(limit) ? limit : 20)),
      skip: Math.max(0, Number.isFinite(offset) ? offset : 0),
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        data: true,
        readAt: true,
        sentAt: true,
      },
    });
    return rows.map(toAppNotification);
  }

  /**
   * Lida E aberta: marcar UM aviso é a pessoa tocando nele (no push ou na central) — entra no "abriu" da campanha,
   * uma vez só. O "ler tudo" não conta como aberta.
   */
  async markRead(userId: string, id: string): Promise<void> {
    if (!isUuid(id)) return; // id quebrado (ou '' de push sem central): nada a marcar, sem 500 do Prisma
    const opened = await this.prisma.$queryRaw<{ campaign_id: string | null }[]>`
      UPDATE notifications SET opened_at = now(), read_at = COALESCE(read_at, now())
       WHERE id = ${id}::uuid AND user_id = ${userId}::uuid AND opened_at IS NULL
      RETURNING campaign_id`;
    const campaignId = opened[0]?.campaign_id;
    if (campaignId) {
      await this.prisma
        .$executeRaw`UPDATE push_campaigns SET opened = opened + 1 WHERE id = ${campaignId}::uuid`;
    }
  }

  /** badge da central: quantos avisos ainda não lidos */
  async unreadCount(userId: string): Promise<{ count: number }> {
    return { count: await this.prisma.notification.count({ where: { userId, readAt: null } }) };
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  async settings(userId: string): Promise<NotificationSettings> {
    const p = await this.prisma.notificationPref.findUnique({ where: { userId } });
    return {
      campaigns: p?.campaigns ?? true,
      events: p?.events ?? true,
      messages: p?.messages ?? true,
      likes: p?.likes ?? true,
      matches: p?.matches ?? true,
      messagePreview: p?.messagePreview ?? true,
    };
  }

  async updateSettings(
    userId: string,
    patch: Partial<NotificationSettings>,
  ): Promise<NotificationSettings> {
    const data: Partial<NotificationSettings> = {};
    const keys = [
      'campaigns',
      'events',
      'messages',
      'likes',
      'matches',
      'messagePreview',
    ] as const satisfies readonly (keyof NotificationSettings)[];
    for (const k of keys) if (typeof patch[k] === 'boolean') data[k] = patch[k];
    if (Object.keys(data).length) {
      await this.prisma.notificationPref.upsert({
        where: { userId },
        create: { userId, ...data },
        update: data,
      });
    }
    return this.settings(userId);
  }

  /**
   * Token de push deste aparelho. Upsert por (platform, token): o mesmo celular trocando de conta leva o token pra
   * quem logou por último (a conta anterior para de receber ali).
   */
  async registerDevice(
    userId: string,
    d: { token: string; platform: 'android' | 'ios'; appVersion?: string },
  ): Promise<{ ok: true }> {
    await this.prisma.$executeRaw`
      INSERT INTO device_tokens (id, user_id, token, platform, app_version, created_at, last_used_at)
      VALUES (gen_random_uuid(), ${userId}::uuid, ${d.token}, ${d.platform}, ${d.appVersion ?? null}, now(), now())
      ON CONFLICT (platform, token) DO UPDATE
        SET user_id = EXCLUDED.user_id, app_version = EXCLUDED.app_version, last_used_at = now()`;
    await this.prisma.$executeRaw`
      DELETE FROM device_tokens WHERE user_id = ${userId}::uuid AND id NOT IN (
        SELECT id FROM device_tokens WHERE user_id = ${userId}::uuid ORDER BY last_used_at DESC LIMIT ${MAX_DEVICES_PER_USER})`;
    return { ok: true };
  }

  /** logout / push desligado no aparelho: só apaga o token se for desta conta */
  async removeDevice(userId: string, token: string): Promise<void> {
    await this.prisma.deviceToken.deleteMany({ where: { userId, token } });
  }
}
