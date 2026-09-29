import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../database/prisma.service';
import { PRIVACY } from '../modules/location/discovery-privacy';
import { ANON_FREE_KEY } from '../modules/users/users.service';
import { RedisService } from '../redis/redis.service';

// Limpezas periódicas: anônimo grátis vencido, pausa vencida e retenção de posições.
// A expiração de 48 h do chat ACABOU (inbox): nada expira, conversa é só principal ou solicitação.
@Injectable()
export class CleanupTask {
  private readonly logger = new Logger(CleanupTask.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // modo anônimo do plano grátis venceu (24 h): volta a visível e o perfil em cache cai
  @Cron(CronExpression.EVERY_5_MINUTES)
  async expireFreeAnonymous() {
    const ids = await this.redis.client.zrangebyscore(ANON_FREE_KEY, '-inf', Date.now());
    if (!ids.length) return;
    await this.prisma.user.updateMany({
      where: { id: { in: ids }, visibilityMode: 'anonymous', premiumTier: 'free' },
      data: { visibilityMode: 'visible' } as never,
    });
    await this.redis.client.zrem(ANON_FREE_KEY, ...ids);
    await Promise.all(ids.map((id) => this.redis.invalidateProfile(id)));
    this.logger.log(`Anônimo grátis vencido: ${ids.length} de volta ao visível`);
  }

  // A cada 5 min — pausa de perfil vencida (pausedUntil no passado) volta a ficar visível
  @Cron(CronExpression.EVERY_5_MINUTES)
  async unpauseExpired() {
    const now = new Date();
    const rows = await this.prisma.user.findMany({
      where: { isPaused: true, pausedUntil: { lte: now } },
      select: { id: true },
    });
    if (!rows.length) return;
    await this.prisma.user.updateMany({
      where: { id: { in: rows.map((r) => r.id) }, isPaused: true, pausedUntil: { lte: now } }, // não desfaz uma pausa nova
      data: { isPaused: false, pausedUntil: null } as never,
    });
    await Promise.all(rows.map((r) => this.redis.invalidateProfile(r.id)));
    this.logger.log(`Unpaused ${rows.length} users`);
  }

  // Diário às 3h — apaga locations com expiresAt passado (retenção já rolou)
  @Cron('0 3 * * *')
  async purgeOldLocations() {
    // histórico de posição (já grosseiro, ~110 m) vive só o suficiente pros lugares em comum
    const cutoff = new Date(Date.now() - PRIVACY.HISTORY_RETENTION_DAYS * 86_400_000);
    const result = await this.prisma.location.deleteMany({
      where: { expiresAt: { lt: cutoff } },
    });
    if (result.count > 0) {
      this.logger.log(`Purged ${result.count} old locations`);
    }
  }
}
