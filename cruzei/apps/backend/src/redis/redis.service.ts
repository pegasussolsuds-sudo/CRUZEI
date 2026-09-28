import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Injectable()
export class RedisService implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) public readonly client: Redis) {}

  async onModuleDestroy() {
    await this.client.quit();
  }

  // Helpers específicos do Cruzei — geohash presence + cache de perfil

  async setUserPresence(
    userId: string,
    geohash: string,
    lat: number,
    lng: number,
    ttlSeconds = 7_200, // 2h
    poi: { id: string; name: string } | null = null,
    hidden = false,
    cell = '',
  ): Promise<void> {
    const now = Date.now();
    // mudou de célula → sai da antiga (senão fica sendo escaneado lá até o TTL)
    const prev = await this.client.hget(`user:loc:${userId}`, 'geohash');
    const pipeline = this.client.pipeline();
    if (prev && prev !== geohash) pipeline.zrem(`presence:${prev}`, userId);
    // o EXPIRE da chave é renovado a cada update: sem poda por score, a célula acumula todo mundo que já passou
    pipeline.zremrangebyscore(`presence:${geohash}`, '-inf', now - ttlSeconds * 1000);
    pipeline.zadd(`presence:${geohash}`, now, userId);
    pipeline.expire(`presence:${geohash}`, ttlSeconds);
    pipeline.hset(`user:loc:${userId}`, {
      lat: String(lat),
      lng: String(lng),
      geohash,
      updated_at: String(now),
      // lugar ATUAL (string vazia = em lugar nenhum) — sempre gravado pra não sobrar POI de um update anterior
      poi_id: poi?.id ?? '',
      poi_name: poi?.name ?? '',
      // área privada / residência: presença existe (a pessoa vê os outros) mas ninguém a descobre
      hidden: hidden ? '1' : '0',
      cell,
    });
    pipeline.expire(`user:loc:${userId}`, ttlSeconds);
    await pipeline.exec();
  }

  async getNearbyUserIds(geohashes: string[]): Promise<string[]> {
    const pipeline = this.client.pipeline();
    for (const h of geohashes) pipeline.zrange(`presence:${h}`, 0, -1);
    const results = await pipeline.exec();
    const set = new Set<string>();
    results?.forEach(([_, users]) => {
      (users as string[]).forEach((u) => set.add(u));
    });
    return Array.from(set);
  }

  async incrRate(userId: string, action: string, ttlSeconds = 86_400): Promise<number> {
    const key = `rate:${userId}:${action}`;
    const n = await this.client.incr(key);
    if (n === 1) await this.client.expire(key, ttlSeconds);
    return n;
  }

  async cacheProfile(userId: string, payload: unknown, ttl = 3600): Promise<void> {
    await this.client.set(
      `profile:${userId}`,
      JSON.stringify(payload),
      'EX',
      ttl,
    );
  }

  async getCachedProfile<T>(userId: string): Promise<T | null> {
    const raw = await this.client.get(`profile:${userId}`);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async invalidateProfile(userId: string): Promise<void> {
    await this.client.del(`profile:${userId}`);
  }

  /** prova de que o número confirmou um código de SMS (login com isNew) — vale 10 min, consumida pelo /auth/register */
  async setSignupProof(phone: string): Promise<void> {
    await this.client.set(`sms:verified:${phone}`, '1', 'EX', 600);
  }

  async consumeSignupProof(phone: string): Promise<boolean> {
    const v = await this.client.getdel(`sms:verified:${phone}`);
    return v === '1';
  }
}
