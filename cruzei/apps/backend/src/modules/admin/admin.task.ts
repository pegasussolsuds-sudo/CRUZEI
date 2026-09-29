import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { CampaignsService } from './campaigns.service';
import { EventsService } from './events.service';

/**
 * Crons do painel (rodam no worker de cron; mesmo que dois processos rodem, nada sai duplicado: campanha é pega com
 * FOR UPDATE SKIP LOCKED e esconder POI terminado é idempotente).
 */
@Injectable()
export class AdminTask {
  private readonly log = new Logger(AdminTask.name);
  private busy = false;

  constructor(
    private readonly campaigns: CampaignsService,
    private readonly events: EventsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    // uma campanha grande pode passar do minuto: o próximo tick deste processo não empilha
    if (this.busy) return;
    this.busy = true;
    try {
      await this.events.hideEnded();
      await this.campaigns.dispatchDue();
    } catch (e) {
      this.log.warn(`tarefa do painel falhou: ${(e as Error).message}`);
    } finally {
      this.busy = false;
    }
  }
}
