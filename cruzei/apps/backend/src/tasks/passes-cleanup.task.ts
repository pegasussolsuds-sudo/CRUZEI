import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '../database/prisma.service';
import { DISCOVERY_PASS_DAYS, passCutoff } from '../modules/likes/passes';
import { superLikeDay } from '../modules/likes/super-like-quota';

/** apaga em lotes (sem travar a tabela inteira numa limpeza grande) */
const BATCH = 5_000;
/** teto de lotes por rodada (1 milhão de linhas); o que sobrar sai na próxima noite */
const MAX_BATCHES = 200;
/** contador de super curtida: dias guardados além de hoje (só o dia atual vale pra cota) */
const SUPER_LIKE_KEEP_DAYS = 7;

// Limpeza do deck de curtidas: "Passar" vencido (DISCOVERY_PASS_DAYS; a pessoa já voltou pro deck) e contadores de
// super curtida de dias passados. Roda de madrugada, num processo só (ScheduleModule só no worker de cron).
@Injectable()
export class PassesCleanupTask {
  private readonly logger = new Logger(PassesCleanupTask.name);

  constructor(private readonly prisma: PrismaService) {}

  // Diário às 3h20
  @Cron('20 3 * * *')
  async run(): Promise<void> {
    const passes = await this.purgeExpiredPasses();
    const uses = await this.purgeOldSuperLikeUses();
    if (passes || uses)
      this.logger.log(
        `Limpeza do deck: ${passes} passes vencidos, ${uses} contadores de super curtida`,
      );
  }

  /** passes com mais de DISCOVERY_PASS_DAYS; devolve quantos saíram */
  async purgeExpiredPasses(
    now: Date = new Date(),
    days: number = DISCOVERY_PASS_DAYS,
  ): Promise<number> {
    // ISO com Z + cast explícito: a coluna é TIMESTAMPTZ (não depende do fuso da sessão)
    const cutoff = passCutoff(now, days).toISOString();
    let total = 0;
    for (let i = 0; i < MAX_BATCHES; i++) {
      const n = await this.prisma.$executeRaw`
        DELETE FROM passes WHERE ctid = ANY(ARRAY(
          SELECT ctid FROM passes WHERE created_at < ${cutoff}::timestamptz LIMIT ${BATCH}
        ))`;
      total += n;
      if (n < BATCH) break;
    }
    return total;
  }

  /** contadores de super curtida de mais de SUPER_LIKE_KEEP_DAYS dias atrás (dia de São Paulo) */
  async purgeOldSuperLikeUses(now: Date = new Date()): Promise<number> {
    const oldest = superLikeDay(new Date(now.getTime() - SUPER_LIKE_KEEP_DAYS * 86_400_000));
    return this.prisma.$executeRaw`DELETE FROM super_like_uses WHERE day < ${oldest}::date`;
  }
}
