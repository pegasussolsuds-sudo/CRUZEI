import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { AccountPurgeService } from './account-purge.service';

/** contas limpas por rodada (uma transação por conta) */
const PURGE_BATCH = 20;

// Só roda no processo dos crons (ScheduleModule condicionado em app.module.ts): uma limpeza por cluster; mesmo assim
// o FOR UPDATE SKIP LOCKED impede duas rodadas de pegarem a mesma conta.
@Injectable()
export class PrivacyTask {
  private readonly log = new Logger(PrivacyTask.name);
  private running = false;

  constructor(private readonly purge: AccountPurgeService) {}

  /** fim do prazo de arrependimento → limpeza definitiva */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async purgeDue(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.purge.purgeDue(PURGE_BATCH);
    } catch (e) {
      this.log.warn(`limpeza de contas falhou: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** prova de conta limpa, marca do número (6 meses) e registros de pagamento (5 anos) */
  @Cron('40 3 * * *', { timeZone: 'America/Sao_Paulo' })
  async retention(): Promise<void> {
    try {
      await this.purge.retention();
    } catch (e) {
      this.log.warn(`retenção de contas limpas falhou: ${(e as Error).message}`);
    }
  }
}
