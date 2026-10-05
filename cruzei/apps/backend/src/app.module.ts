import { BullModule } from '@nestjs/bull';
import { ExecutionContext, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';

import { UserThrottlerGuard } from './common/guards/user-throttler.guard';
import { RedisThrottlerStorage } from './common/throttler/redis-throttler.storage';
import { configuration, validateEnv } from './config/configuration';
import { ENV_FILE_PATHS } from './config/env-files';
import { isCronWorker } from './config/runtime';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { AccountModule } from './modules/account/account.module';
import { AccountPrivacyModule } from './modules/account-privacy/account-privacy.module';
import { AdminModule } from './modules/admin/admin.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AnonymousModule } from './modules/anonymous/anonymous.module';
import { AuthModule } from './modules/auth/auth.module';
import { BlocksModule } from './modules/blocks/blocks.module';
import { BoostsModule } from './modules/boosts/boosts.module';
import { GeoModule } from './modules/geo/geo.module';
import { InboxModule } from './modules/inbox/inbox.module';
import { LegalModule } from './modules/legal/legal.module';
import { LikesModule } from './modules/likes/likes.module';
import { LocationModule } from './modules/location/location.module';
import { ModerationModule } from './modules/moderation/moderation.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PlacesModule } from './modules/places/places.module';
import { PoisModule } from './modules/pois/pois.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SafetyModule } from './modules/safety/safety.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { SupportModule } from './modules/support/support.module';
import { TilesModule } from './modules/tiles/tiles.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { UsersModule } from './modules/users/users.module';
import { WavesModule } from './modules/waves/waves.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { RealtimeModule } from './realtime/realtime.module';
import { RedisModule } from './redis/redis.module';
import { RedisService } from './redis/redis.service';

// Chave de metadata interna do @nestjs/throttler (THROTTLER_LIMIT + nome do throttler) — não é exportada
const STRICT_LIMIT_KEY = 'THROTTLER:LIMITstrict';
// 'strict' só vale nas rotas que o declaram com @Throttle({ strict }); sem isso o guard global
// aplicaria TODOS os throttlers do forRoot em TODAS as rotas (5/min em tudo).
const hasStrictOverride = (ctx: ExecutionContext) =>
  Boolean(
    Reflect.getMetadata(STRICT_LIMIT_KEY, ctx.getHandler()) ||
      Reflect.getMetadata(STRICT_LIMIT_KEY, ctx.getClass()),
  );

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // apps/backend/.env primeiro, raiz do monorepo depois (independe do cwd — ver config/env-files.ts)
      envFilePath: ENV_FILE_PATHS,
      load: [configuration],
      validate: validateEnv,
    }),

    // Rate limiting global (ThrottlerGuard em APP_GUARD, abaixo) — endpoints sensíveis apertam com @Throttle.
    // default 600/min por usuário: vários usuários atrás do mesmo NAT (bar, faculdade, CGNAT do 4G) e o app
    // chama nearby a cada 45 s + pois + boosts + inbox; 100/min derrubava gente legítima.
    // Contagem no Redis (O(1), vale entre processos) — o storage em memória do pacote era O(N) por requisição.
    ThrottlerModule.forRootAsync({
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({
        throttlers: [
          { name: 'default', ttl: 60_000, limit: 600 },
          {
            name: 'strict',
            ttl: 60_000,
            limit: 5,
            skipIf: (ctx: ExecutionContext) => !hasStrictOverride(ctx),
          },
        ],
        storage: new RedisThrottlerStorage(redis.client),
      }),
    }),

    // Cron jobs (Premium vencido, fim do invisível grátis, pausa, retenção de posições) — num processo só quando o
    // backend roda em cluster
    ...(isCronWorker() ? [ScheduleModule.forRoot()] : []),

    // Bull (fila do push social: curtidas somadas no fim da espera) — o MESMO Redis do REDIS_URL
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        url: cfg.get<string>('redisUrl') ?? 'redis://localhost:6379',
      }),
    }),

    DatabaseModule,
    RedisModule,
    AccountModule,
    RealtimeModule,

    AuthModule,
    UsersModule,
    LocationModule,
    PoisModule,
    PlacesModule,
    GeoModule,
    LikesModule,
    InboxModule,
    WavesModule,
    NotificationsModule,
    AnonymousModule,
    SafetyModule,
    BlocksModule,
    ReportsModule,
    SubscriptionsModule,
    BoostsModule,
    WebhooksModule,
    UploadsModule,
    ModerationModule,
    LegalModule,
    TilesModule,
    // painel admin web (/v1/admin/*) e suporte ao vivo (/v1/support/* + /v1/admin/support/*)
    AdminModule,
    SupportModule,
    // métricas próprias (/v1/analytics/*): funil do cadastro e retenção, sem empresa de fora
    AnalyticsModule,
    // excluir conta (prazo + limpeza), baixar meus dados, apagar histórico de localização
    AccountPrivacyModule,
  ],
  controllers: [HealthController],
  // Sem o guard registrado, @Throttle era só decoração — nenhum limite valia.
  // rate limit por conta (Bearer com assinatura conferida) e por IP no resto (sem token válido e /auth/*)
  providers: [{ provide: APP_GUARD, useClass: UserThrottlerGuard }],
})
export class AppModule {}
