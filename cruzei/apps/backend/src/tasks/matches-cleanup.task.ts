import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service';
import { PRIVACY } from '../modules/location/discovery-privacy';

// Roda a cada 15 min — marca matches expirados e dispara aviso.
@Injectable()
export class MatchesCleanupTask {
  private readonly logger = new Logger(MatchesCleanupTask.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async expireMatches() {
    const result = await this.prisma.match.updateMany({
      where: {
        status: 'active',
        chatExpiresAt: { lt: new Date() },
      },
      data: { status: 'expired' } as never,
    });
    if (result.count > 0) {
      this.logger.log(`Expired ${result.count} matches`);
    }
  }

  // Diário às 3h — apaga locations com expiresAt passado (retenção já rolou)
  @Cron('0 3 * * *')
  async purgeOldLocations() {
    // histórico de posição (já grosseiro, ~110 m) vive só o suficiente pro contexto do match / lugares em comum
    const cutoff = new Date(Date.now() - PRIVACY.HISTORY_RETENTION_DAYS * 86_400_000);
    const result = await this.prisma.location.deleteMany({
      where: { expiresAt: { lt: cutoff } },
    });
    if (result.count > 0) {
      this.logger.log(`Purged ${result.count} old locations`);
    }
  }
}
