import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { MediaGcService } from './media-gc.service';

/** lotes por rodada: fila grande (limpeza de muitas contas) anda sem segurar o processo */
export const GC_BATCHES_PER_RUN = 5;
export const GC_BATCH_SIZE = 200;

/** fila media_objects a cada 10 min (só no worker de cron): fotos apagadas e uploads nunca anexados (24 h) */
@Injectable()
export class MediaGcTask {
  private readonly logger = new Logger(MediaGcTask.name);
  private running = false;

  constructor(private readonly gc: MediaGcService) {}

  @Cron('*/10 * * * *', { name: 'media-gc' })
  async run(): Promise<void> {
    // storage lento: a rodada anterior ainda não acabou — pula (o lease já impede apagar duas vezes)
    if (this.running) return;
    this.running = true;
    try {
      for (let i = 0; i < GC_BATCHES_PER_RUN; i++) {
        const r = await this.gc.drain({ limit: GC_BATCH_SIZE });
        if (r.leased < GC_BATCH_SIZE) break;
      }
    } catch (err) {
      this.logger.warn(`GC de fotos falhou: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** fotos retidas por denúncia (photo-retention.ts) cuja denúncia já fechou: saem de hora em hora */
  @Cron('7 * * * *', { name: 'media-retained-release' })
  async releaseRetained(): Promise<void> {
    try {
      await this.gc.releaseRetainedPhotos();
    } catch (err) {
      this.logger.warn(`soltar fotos retidas falhou: ${(err as Error).message}`);
    }
  }
}
