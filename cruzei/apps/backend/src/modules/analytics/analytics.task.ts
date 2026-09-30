import { ANALYTICS_RETENTION_MONTHS } from '@cruzei/shared-types';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { AnalyticsService } from './analytics.service';

// Retenção das métricas: 13 meses e depois fora (roda só no worker de cron).
@Injectable()
export class AnalyticsTask {
  private readonly log = new Logger(AnalyticsTask.name);

  constructor(private readonly analytics: AnalyticsService) {}

  @Cron('50 3 * * *', { timeZone: 'America/Sao_Paulo' })
  async purge(): Promise<void> {
    try {
      const n = await this.analytics.purgeOld();
      if (n)
        this.log.log(
          `${n} eventos de métricas com mais de ${ANALYTICS_RETENTION_MONTHS} meses apagados`,
        );
    } catch (e) {
      this.log.warn(`limpeza das métricas falhou: ${(e as Error).message}`);
    }
  }
}
