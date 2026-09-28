import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { processesSharingResources } from '../config/runtime';

/** conexões do Postgres pra aplicação (max_connections = 100; o resto fica pra psql, migrações e crons) */
const DB_CONNECTION_BUDGET = 90;

/**
 * Em cluster, cada worker tem o seu pool: N workers × connection_limit precisa caber no Postgres.
 * Mantém o valor configurado se já couber; senão divide o orçamento entre os workers.
 */
export function poolUrlFor(url: string, processes: number): string {
  if (processes <= 1) return url;
  const share = Math.max(2, Math.floor(DB_CONNECTION_BUDGET / processes));
  const m = url.match(/[?&]connection_limit=(\d+)/);
  const current = m ? Number(m[1]) : Number.POSITIVE_INFINITY;
  if (current <= share) return url;
  if (m) return url.replace(/([?&]connection_limit=)\d+/, `$1${share}`);
  return url + (url.includes('?') ? '&' : '?') + `connection_limit=${share}`;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(config: ConfigService) {
    const configured = config.get<string>('databaseUrl');
    const url = configured ? poolUrlFor(configured, processesSharingResources()) : configured;
    if (url) {
      // ensure Prisma picks it up
      process.env.DATABASE_URL = url;
      Logger.log(`Using DATABASE_URL=${url.replace(/:[^:@]+@/, ':***@')}`, PrismaService.name);
    } else {
      Logger.warn('No databaseUrl from config — falling back to env DATABASE_URL', PrismaService.name);
    }
    super();
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  async cleanDb() {
    // Helper pra testes — apaga tudo em ordem (FK safe)
    const order = [
      'auditLog', 'dataDeletionRequest', 'deviceToken', 'notification',
      'boost', 'subscription', 'report', 'block', 'seal',
      'visit', 'message', 'match', 'like', 'poisCheckin',
      'location', 'userInterest', 'photo', 'poi', 'user',
    ];
    for (const model of order) {
      // @ts-expect-error — string dinâmico só usado em testes
      await this[model].deleteMany();
    }
  }
}
