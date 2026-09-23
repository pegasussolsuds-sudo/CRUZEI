import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bull';

import { configuration, validateEnv } from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { RealtimeModule } from './realtime/realtime.module';

import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { LocationModule } from './modules/location/location.module';
import { PoisModule } from './modules/pois/pois.module';
import { MatchesModule } from './modules/matches/matches.module';
import { MessagesModule } from './modules/messages/messages.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AnonymousModule } from './modules/anonymous/anonymous.module';
import { SafetyModule } from './modules/safety/safety.module';
import { BlocksModule } from './modules/blocks/blocks.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { BoostsModule } from './modules/boosts/boosts.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { UploadsModule } from './modules/uploads/uploads.module';

import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
      load: [configuration],
      validate: validateEnv,
    }),

    // Rate limiting padrão — endpoints sensíveis sobrescrevem com @Throttle
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 100 },
      { name: 'strict', ttl: 60_000, limit: 5 },
    ]),

    // Cron jobs (cleanup, expiração de matches etc.)
    ScheduleModule.forRoot(),

    // Bull (fila de notificações)
    BullModule.forRootAsync({
      useFactory: () => ({
        redis: { host: 'localhost', port: 6379 },
      }),
    }),

    DatabaseModule,
    RedisModule,
    RealtimeModule,

    AuthModule,
    UsersModule,
    LocationModule,
    PoisModule,
    MatchesModule,
    MessagesModule,
    NotificationsModule,
    AnonymousModule,
    SafetyModule,
    BlocksModule,
    ReportsModule,
    SubscriptionsModule,
    BoostsModule,
    WebhooksModule,
    UploadsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
