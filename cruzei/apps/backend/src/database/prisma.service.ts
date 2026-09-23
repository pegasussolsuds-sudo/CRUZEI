import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(config: ConfigService) {
    const url = config.get<string>('databaseUrl');
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
