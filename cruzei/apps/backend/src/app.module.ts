import { ExecutionContext, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { UserThrottlerGuard } from './common/guards/user-throttler.guard';
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
import { WavesModule } from './modules/waves/waves.module';
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

// Chave de metadata interna do @nestjs/throttler (THROTTLER_LIMIT + nome do throttler) — não é exportada
const STRICT_LIMIT_KEY = 'THROTTLER:LIMITstrict';
// 'strict' só vale nas rotas que o declaram com @Throttle({ strict }); sem isso o guard global
// aplicaria TODOS os throttlers do forRoot em TODAS as rotas (5/min em tudo).
const hasStrictOverride = (ctx: ExecutionContext) =>
  Boolean(Reflect.getMetadata(STRICT_LIMIT_KEY, ctx.getHandler()) || Reflect.getMetadata(STRICT_LIMIT_KEY, ctx.getClass()));

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env', '.env'],
      load: [configuration],
      validate: validateEnv,
    }),

    // Rate limiting global (ThrottlerGuard em APP_GUARD, abaixo) — endpoints sensíveis apertam com @Throttle.
    // default 600/min por IP: vários usuários atrás do mesmo NAT (bar, faculdade, CGNAT do 4G) e o app
    // chama nearby a cada 45 s + pois + boosts + matches; 100/min derrubava gente legítima.
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 600 },
      { name: 'strict', ttl: 60_000, limit: 5, skipIf: (ctx) => !hasStrictOverride(ctx) },
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
    WavesModule,
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
  // Sem o guard registrado, @Throttle era só decoração — nenhum limite valia.
  // rate limit por usuário (hash do token), não por IP: um atacante não zera a cota de quem divide o NAT
  providers: [{ provide: APP_GUARD, useClass: UserThrottlerGuard }],
})
export class AppModule {}
