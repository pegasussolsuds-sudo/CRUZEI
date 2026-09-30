import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { RedisService } from '../../redis/redis.service';

import { PremiumLifecycleService } from './premium-lifecycle.service';

/** chave antiga do prazo do invisível grátis (só no Redis, virava invisível eterno); o prazo agora é users.anonymous_until */
const LEGACY_ANON_KEY = 'anon:free:until';

/**
 * A cada minuto (só no worker de cron): 1) rebaixa o Premium vencido (quem estava invisível ganha as 24 h grátis);
 * 2) dá a janela a invisível grátis sem prazo gravado; 3) devolve ao visível quem passou da janela. A ORDEM importa:
 * o fim do invisível filtra pelo tier gravado 'free', então o rebaixamento precisa vir antes (senão um Premium vencido
 * e invisível voltaria ao mapa sem as 24 h). Dois processos rodando juntos não duplicam nada (SKIP LOCKED).
 */
@Injectable()
export class PremiumTask {
  private readonly log = new Logger(PremiumTask.name);
  private busy = false;
  private legacyCleared = false;

  constructor(
    private readonly lifecycle: PremiumLifecycleService,
    private readonly redis: RedisService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    // um lote grande pode passar do minuto: o próximo tick deste processo não empilha
    if (this.busy) return;
    this.busy = true;
    try {
      await this.lifecycle.downgradeExpired();
      await this.lifecycle.openMissingWindows();
      await this.lifecycle.expireFreeAnonymous();
      if (!this.legacyCleared) {
        this.legacyCleared = true;
        await this.redis.client.del(LEGACY_ANON_KEY).catch(() => 0);
      }
    } catch (e) {
      this.log.warn(`tarefa do Premium falhou: ${(e as Error).message}`);
    } finally {
      this.busy = false;
    }
  }
}
