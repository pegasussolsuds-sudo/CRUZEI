import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PhotoModerationService } from './photo-moderation.service';
import { AccessLogService } from '../account/access-log.service';

@Injectable()
export class ModerationTask {
  private readonly logger = new Logger(ModerationTask.name);

  constructor(
    private readonly photos: PhotoModerationService,
    private readonly access: AccessLogService,
  ) {}

  // fotos que a análise automática ainda não viu (processo reiniciou, AWS fora do ar)
  @Cron(CronExpression.EVERY_5_MINUTES)
  async sweepPhotos() {
    const n = await this.photos.sweep();
    if (n) this.logger.log(`${n} fotos pendentes reenviadas pra análise`);
  }

  // registros de acesso: 6 meses (Marco Civil, art. 15) e depois fora
  @Cron('30 3 * * *')
  async purgeAccessLogs() {
    const n = await this.access.purgeOld();
    if (n) this.logger.log(`${n} registros de acesso com mais de 6 meses apagados`);
  }
}
