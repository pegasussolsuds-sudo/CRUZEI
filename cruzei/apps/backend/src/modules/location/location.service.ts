import { Injectable } from '@nestjs/common';
import * as ngeohash from 'ngeohash';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { distanceMeters, encodeGeohash } from '@cruzei/shared-utils';

const PRESENCE_TTL_SECONDS = 18_000; // 5h
const GEOHASH_PRECISION = 5; // ~4.9km x 4.9km
const ANON_JITTER_M = 150; // deslocamento máximo aplicado a usuários anônimos

interface UpdatePayload {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  poiId?: number;
  city?: string;
  state?: string;
}

@Injectable()
export class LocationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // Atualiza localização: persiste no Postgres (histórico) + Redis (presença 5h)
  async update(userId: string, payload: UpdatePayload) {
    const { latitude, longitude, accuracyMeters, poiId, city, state } = payload;
    const geohash = encodeGeohash(latitude, longitude, GEOHASH_PRECISION);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + PRESENCE_TTL_SECONDS * 1000);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { visibilityMode: true, isPaused: true, deletedAt: true },
    });
    const isAnonymous = user?.visibilityMode === 'anonymous';

    await this.prisma.location.create({
      data: {
        userId,
        latitude,
        longitude,
        geohash,
        accuracyMeters,
        poiId: poiId != null ? BigInt(poiId) : undefined,
        city,
        state,
        expiresAt,
        isAnonymous,
      },
    });

    await this.prisma.user.update({ where: { id: userId }, data: { lastActiveAt: now } });

    const visible = !user?.isPaused && !user?.deletedAt;
    if (visible) {
      await this.redis.setUserPresence(userId, geohash, latitude, longitude, PRESENCE_TTL_SECONDS);
    }

    const nearbyUsers = await this.estimateNearbyUsers(latitude, longitude);
    const nearbyPois = await this.prisma.pOI.count({ where: city ? { city } : {} });

    return {
      geohash,
      nearbyUsers,
      nearbyPois,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async getNearby(centerLat: number, centerLng: number, radiusM: number, requesterId: string) {
    const centerHash = encodeGeohash(centerLat, centerLng, GEOHASH_PRECISION);
    const hashes = [centerHash, ...ngeohash.neighbors(centerHash)];
    const userIds = await this.redis.getNearbyUserIds(hashes);
    if (userIds.length === 0) return [];

    // filtra bloqueados (nos dois sentidos) e deletados
    const blocks = await this.prisma.block.findMany({
      where: {
        OR: [
          { blockerId: requesterId, blockedId: { in: userIds } },
          { blockedId: requesterId, blockerId: { in: userIds } },
        ],
      },
      select: { blockedId: true, blockerId: true },
    });
    const excluded = new Set<string>([requesterId]);
    blocks.forEach((b) => {
      excluded.add(b.blockedId);
      excluded.add(b.blockerId);
    });

    const users = await this.prisma.user.findMany({
      where: {
        id: { in: userIds.filter((u) => !excluded.has(u)) },
        deletedAt: null,
        isPaused: false,
      },
      select: {
        id: true,
        name: true,
        birthDate: true,
        visibilityMode: true,
        showAge: true,
        premiumTier: true,
        isVerified: true,
        photos: { where: { isMain: true }, select: { url: true } },
      },
    });
    if (users.length === 0) return [];

    // boosts ativos → destaque no mapa
    const boosts = await this.prisma.boost.findMany({
      where: { userId: { in: users.map((u) => u.id) }, expiresAt: { gt: new Date() } },
      select: { userId: true },
    });
    const boosted = new Set(boosts.map((b) => b.userId));

    const pipeline = this.redis.client.pipeline();
    users.forEach((u) => pipeline.hgetall(`user:loc:${u.id}`));
    const locations = await pipeline.exec();

    return users
      .map((u, i) => {
        const [, loc] = locations?.[i] ?? [];
        const locMap = loc as Record<string, string> | null;
        if (!locMap?.lat || !locMap?.lng) return null;

        const isAnonymous = u.visibilityMode === 'anonymous';
        let lat = Number(locMap.lat);
        let lng = Number(locMap.lng);
        const dist = distanceMeters(centerLat, centerLng, lat, lng);
        if (dist > radiusM) return null;

        if (isAnonymous) {
          // Anônimo aparece no mapa, mas sem identidade e com posição embaralhada
          const j = this.jitter(u.id, lat);
          lat += j.dLat;
          lng += j.dLng;
        }

        return {
          id: u.id,
          name: isAnonymous ? 'anônimo' : u.name,
          age: isAnonymous || !u.showAge ? null : this.age(u.birthDate),
          mainPhotoUrl: isAnonymous ? null : (u.photos[0]?.url ?? null),
          latitude: lat,
          longitude: lng,
          distanceM: Math.round(dist),
          recordedAt: locMap.updated_at ? new Date(Number(locMap.updated_at)).toISOString() : null,
          isAnonymous,
          isOnline: true,
          premiumTier: isAnonymous ? 'free' : u.premiumTier,
          isVerified: isAnonymous ? false : u.isVerified,
          isBoosted: !isAnonymous && boosted.has(u.id),
        };
      })
      .filter(Boolean);
  }

  async getMe(userId: string) {
    const loc = await this.redis.client.hgetall(`user:loc:${userId}`);
    if (!loc.lat) return null;
    return {
      latitude: Number(loc.lat),
      longitude: Number(loc.lng),
      geohash: loc.geohash,
      recordedAt: loc.updated_at ? new Date(Number(loc.updated_at)).toISOString() : null,
    };
  }

  private async estimateNearbyUsers(lat: number, lng: number): Promise<number> {
    const hash = encodeGeohash(lat, lng, GEOHASH_PRECISION);
    const ids = await this.redis.getNearbyUserIds([hash, ...ngeohash.neighbors(hash)]);
    return ids.length;
  }

  // Jitter determinístico por usuário (mesmo deslocamento em toda requisição → não dá pra triangular)
  private jitter(userId: string, lat: number) {
    let h = 0;
    for (const ch of userId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const angle = ((h % 360) * Math.PI) / 180;
    const dist = 50 + (h % (ANON_JITTER_M - 50));
    const dLat = (dist * Math.cos(angle)) / 111_320;
    const dLng = (dist * Math.sin(angle)) / (111_320 * Math.cos((lat * Math.PI) / 180));
    return { dLat, dLng };
  }

  private age(birth: Date): number {
    const today = new Date();
    let a = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) a -= 1;
    return a;
  }
}
