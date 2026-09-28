import { Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../database/prisma.service';

export type AccessEvent = 'login' | 'register' | 'refresh';

/**
 * Registros de acesso exigidos pelo Marco Civil da Internet (art. 15): data, hora, IP e porta de origem, guardados
 * por 6 meses (o cron diário apaga os mais velhos). Sem FK: continuam valendo se a conta for excluída.
 * Atrás de proxy o IP certo depende de `trust proxy` no Express.
 */
@Injectable()
export class AccessLogService {
  private readonly log = new Logger(AccessLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  record(userId: string, event: AccessEvent, req?: Request): void {
    const ip = req?.ip ?? req?.socket?.remoteAddress ?? null;
    const port = req?.socket?.remotePort ?? null;
    const userAgent = req?.get?.('user-agent')?.slice(0, 255) ?? null;
    // não segura o login: grava em segundo plano e só avisa se falhar
    this.prisma.accessLog
      .create({ data: { userId, event, ip: ip?.slice(0, 45) ?? null, port, userAgent } })
      .catch((e: Error) => this.log.warn(`registro de acesso não gravado (${event}): ${e.message}`));
  }

  /** apaga o que passou de 6 meses (cron diário) */
  async purgeOld(now = new Date()): Promise<number> {
    const cutoff = new Date(now);
    cutoff.setMonth(cutoff.getMonth() - 6);
    const r = await this.prisma.accessLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
    return r.count;
  }
}
