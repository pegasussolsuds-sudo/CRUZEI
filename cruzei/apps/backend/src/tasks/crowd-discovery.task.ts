import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { RedisService } from '../redis/redis.service';
import { CROWD } from '../modules/location/discovery-privacy';
import { PlaceDiscoveryService } from '../modules/pois/place-discovery.service';

const LOCK = 'lock:crowd-discovery';

/**
 * Detector de lugares pela galera: a cada 3 h (publicação em lote — o horário em que um lugar aparece não revela
 * quando alguém confirmou). Uma instância por vez (trava no Redis: os crons rodam em cada réplica).
 */
@Injectable()
export class CrowdDiscoveryTask {
  private readonly logger = new Logger(CrowdDiscoveryTask.name);

  constructor(
    private readonly redis: RedisService,
    private readonly discovery: PlaceDiscoveryService,
  ) {}

  @Cron('17 */3 * * *', { timeZone: 'America/Sao_Paulo' })
  async run(): Promise<void> {
    if (CROWD.MODE === 'off') return;
    const token = randomUUID();
    if ((await this.redis.client.set(LOCK, token, 'EX', 900, 'NX')) !== 'OK') return;
    try {
      await this.discovery.runOnce(new Date(), { promote: CROWD.MODE === 'on' });
    } catch (e) {
      this.logger.warn(`rodada da descoberta falhou: ${(e as Error).message}`);
    } finally {
      await this.redis.client.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0", 1, LOCK, token);
    }
  }
}
