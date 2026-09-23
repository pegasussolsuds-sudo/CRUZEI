import { Controller, Get, HttpCode, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  health() {
    return { status: 'ok', service: 'cruzei-api', timestamp: new Date().toISOString() };
  }

  @Get('ready')
  @HttpCode(200)
  async ready() {
    const checks = { postgres: false, redis: false };
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.postgres = true;
    } catch {
      /* fica false */
    }
    try {
      checks.redis = (await this.redis.client.ping()) === 'PONG';
    } catch {
      /* fica false */
    }
    const ready = checks.postgres && checks.redis;
    if (!ready) throw new ServiceUnavailableException({ ready, checks });
    return { ready, checks };
  }
}
