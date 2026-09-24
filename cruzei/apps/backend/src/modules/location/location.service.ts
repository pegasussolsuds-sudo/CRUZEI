import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as ngeohash from 'ngeohash';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { avatarOrFallback } from '../../common/avatar';
import {
  approxDistanceM,
  bboxAround,
  distanceMeters,
  encodeGeohash,
  offsetLatLng,
  positionJitter,
  snapLatLng,
} from '@cruzei/shared-utils';

const PRESENCE_TTL_SECONDS = 18_000; // 5h
const GEOHASH_PRECISION = 5; // ~4.9km x 4.9km
// Posição pública fora de POI: real + jitter determinístico nessa faixa + grade de 4 casas (~11 m)
const POS_JITTER_MIN_M = 25;
const POS_JITTER_MAX_M = 70;
// Posição pública dentro de um POI: ponto do POI + deslocamento pequeno (só espalha os pins no bar)
const POI_JITTER_MIN_M = 8;
const POI_JITTER_MAX_M = 25;
// Quem reporta posição a até 40 m de um POI é considerado "nele" (bbox de 60 m pra busca)
const POI_SNAP_M = 40;
const POI_SEARCH_M = 60;
// Salt de fallback quando LOCATION_SALT não está configurado (validateEnv avisa no boot)
const DEV_SALT = 'cruzei-dev-salt';

export const NEARBY_RADIUS_MIN_M = 300;
export const NEARBY_RADIUS_MAX_M = 5000;

interface UpdatePayload {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  poiId?: number;
  city?: string;
  state?: string;
}

export interface PresencePoi {
  id: number;
  name: string;
  lat: number;
  lng: number;
}

/** Presença lida do hash user:loc:<id> — posição REAL, uso interno; nunca vai pro payload. */
export interface Presence {
  lat: number;
  lng: number;
  updatedAt: number | null;
  poi: PresencePoi | null;
}

export interface NearbyQuery {
  /** centro da busca (filtro de raio) */
  centerLat: number;
  centerLng: number;
  /** posição de quem consulta (base do distanceM); default = centro */
  meLat: number;
  meLng: number;
  radiusM: number;
  requesterId: string;
}

@Injectable()
export class LocationService {
  private readonly salt: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.salt = config.get<string>('locationSalt') || DEV_SALT;
  }

  // Atualiza localização: persiste no Postgres (histórico) + Redis (presença 5h)
  async update(userId: string, payload: UpdatePayload) {
    const { latitude, longitude, accuracyMeters, city, state } = payload;
    const geohash = encodeGeohash(latitude, longitude, GEOHASH_PRECISION);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + PRESENCE_TTL_SECONDS * 1000);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { visibilityMode: true, isPaused: true, deletedAt: true },
    });
    const isAnonymous = user?.visibilityMode === 'anonymous';

    // lugar atual: o que o app mandou (se existir) ou o POI mais próximo a <= 40 m da posição reportada
    const poi = payload.poiId != null ? await this.poiById(payload.poiId) : await this.nearestPoi(latitude, longitude);

    await this.prisma.location.create({
      data: {
        userId,
        latitude,
        longitude,
        geohash,
        accuracyMeters,
        poiId: poi ? BigInt(poi.id) : undefined,
        city,
        state,
        expiresAt,
        isAnonymous,
      },
    });

    await this.prisma.user.update({ where: { id: userId }, data: { lastActiveAt: now } });

    const visible = !user?.isPaused && !user?.deletedAt;
    if (visible) {
      await this.redis.setUserPresence(
        userId,
        geohash,
        latitude,
        longitude,
        PRESENCE_TTL_SECONDS,
        poi ? { id: String(poi.id), name: poi.name } : null,
      );
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

  /**
   * Posição pública ("borrada") de alguém — a real nunca sai daqui.
   * - dentro de um POI → ponto do POI + deslocamento pequeno (8–25 m): quem tá "no Bar do Léo" é desenhado no bar
   * - senão → real + jitter determinístico (25–70 m) + snap na grade de 4 casas (~11 m)
   * Seed = LOCATION_SALT + dia (UTC) + userId: repetir requests no mesmo dia dá sempre a mesma posição (não dá
   * pra triangular por média) e no dia seguinte ela muda (não dá pra acumular um histórico do deslocamento).
   */
  blurPosition(userId: string, lat: number, lng: number, poi?: { lat: number; lng: number } | null): { lat: number; lng: number } {
    const day = new Date().toISOString().slice(0, 10);
    const seed = `${this.salt}:${day}:${userId}`;
    if (poi) {
      const j = positionJitter(seed, POI_JITTER_MIN_M, POI_JITTER_MAX_M);
      return offsetLatLng(poi.lat, poi.lng, j.dNorthM, j.dEastM);
    }
    const j = positionJitter(seed, POS_JITTER_MIN_M, POS_JITTER_MAX_M);
    const off = offsetLatLng(lat, lng, j.dNorthM, j.dEastM);
    return snapLatLng(off.lat, off.lng);
  }

  /** Lê as presenças (hash user:loc:<id>) de vários usuários e resolve os POIs referenciados numa query só. */
  async getPresences(userIds: string[]): Promise<Map<string, Presence>> {
    const out = new Map<string, Presence>();
    if (userIds.length === 0) return out;

    const pipeline = this.redis.client.pipeline();
    userIds.forEach((id) => pipeline.hgetall(`user:loc:${id}`));
    const rows = await pipeline.exec();

    const raw = new Map<string, Record<string, string>>();
    userIds.forEach((id, i) => {
      const [, loc] = rows?.[i] ?? [];
      const m = loc as Record<string, string> | null;
      if (m?.lat && m?.lng) raw.set(id, m);
    });

    const poiIds = [...new Set([...raw.values()].map((m) => m.poi_id).filter((p) => p && /^\d+$/.test(p)))];
    const pois =
      poiIds.length > 0
        ? await this.prisma.pOI.findMany({
            where: { id: { in: poiIds.map((p) => BigInt(p)) } },
            select: { id: true, name: true, latitude: true, longitude: true },
          })
        : [];
    const poiById = new Map<string, PresencePoi>(
      pois.map((p) => [String(p.id), { id: Number(p.id), name: p.name, lat: Number(p.latitude), lng: Number(p.longitude) }]),
    );

    raw.forEach((m, id) => {
      out.set(id, {
        lat: Number(m.lat),
        lng: Number(m.lng),
        updatedAt: m.updated_at ? Number(m.updated_at) : null,
        poi: (m.poi_id && poiById.get(m.poi_id)) || null,
      });
    });
    return out;
  }

  async getNearby(q: NearbyQuery) {
    const centerHash = encodeGeohash(q.centerLat, q.centerLng, GEOHASH_PRECISION);
    const hashes = [centerHash, ...ngeohash.neighbors(centerHash)];
    const userIds = await this.redis.getNearbyUserIds(hashes);
    if (userIds.length === 0) return [];

    // filtra bloqueados (nos dois sentidos) e deletados
    const blocks = await this.prisma.block.findMany({
      where: {
        OR: [
          { blockerId: q.requesterId, blockedId: { in: userIds } },
          { blockedId: q.requesterId, blockerId: { in: userIds } },
        ],
      },
      select: { blockedId: true, blockerId: true },
    });
    const excluded = new Set<string>([q.requesterId]);
    blocks.forEach((b) => {
      excluded.add(b.blockedId);
      excluded.add(b.blockerId);
    });

    // anônimos não aparecem no mapa (privacidade); pausados e deletados também ficam fora
    const users = await this.prisma.user.findMany({
      where: {
        id: { in: userIds.filter((u) => !excluded.has(u)) },
        deletedAt: null,
        isPaused: false,
        visibilityMode: 'visible',
      },
      select: {
        id: true,
        name: true,
        gender: true,
        birthDate: true,
        showAge: true,
        showDistance: true,
        premiumTier: true,
        isVerified: true,
        avatarConfig: true,
        photos: { where: { isMain: true }, select: { url: true } },
      },
    });
    if (users.length === 0) return [];

    // raio e ordenação sempre pela posição BORRADA — a real (Redis) nunca influencia o que sai
    const presences = await this.getPresences(users.map((u) => u.id));
    const inRange = users
      .map((u) => {
        const p = presences.get(u.id);
        if (!p) return null;
        const pos = this.blurPosition(u.id, p.lat, p.lng, p.poi);
        if (distanceMeters(q.centerLat, q.centerLng, pos.lat, pos.lng) > q.radiusM) return null;
        const distFromMe = distanceMeters(q.meLat, q.meLng, pos.lat, pos.lng);
        return { u, pos, distFromMe, poi: p.poi, updatedAt: p.updatedAt };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => a.distFromMe - b.distFromMe);
    if (inRange.length === 0) return [];

    const ids = inRange.map((r) => r.u.id);
    const now = new Date();
    const [boosts, likes, matches] = await Promise.all([
      // boosts ativos → destaque no mapa
      this.prisma.boost.findMany({
        where: { userId: { in: ids }, expiresAt: { gt: now } },
        select: { userId: true },
      }),
      // curtida / match já existentes com quem consulta
      this.prisma.like.findMany({
        where: { likerId: q.requesterId, likedId: { in: ids } },
        select: { likedId: true },
      }),
      this.prisma.match.findMany({
        where: {
          status: 'active',
          OR: [
            { userAId: q.requesterId, userBId: { in: ids } },
            { userBId: q.requesterId, userAId: { in: ids } },
          ],
        },
        select: { id: true, userAId: true, userBId: true },
      }),
    ]);
    const boosted = new Set(boosts.map((b) => b.userId));
    const liked = new Set(likes.map((l) => l.likedId));
    const matchByUser = new Map(matches.map((m) => [m.userAId === q.requesterId ? m.userBId : m.userAId, m.id]));

    return inRange.map(({ u, pos, distFromMe, poi, updatedAt }) => ({
      id: u.id,
      name: u.name,
      age: u.showAge ? this.age(u.birthDate) : null,
      mainPhotoUrl: u.photos[0]?.url ?? null,
      latitude: pos.lat,
      longitude: pos.lng,
      // distância em degraus (50/100/250/500/1000…) entre quem consulta e a posição borrada; null se a pessoa desligou
      distanceM: u.showDistance ? approxDistanceM(distFromMe) : null,
      recordedAt: updatedAt ? new Date(updatedAt).toISOString() : null,
      isAnonymous: false, // anônimos ficam fora da lista; campo mantido por compatibilidade
      isOnline: true,
      premiumTier: u.premiumTier,
      isVerified: u.isVerified,
      isBoosted: boosted.has(u.id),
      avatar: avatarOrFallback(u),
      poi: u.showDistance && poi ? { id: poi.id, name: poi.name } : null,
      likedByMe: liked.has(u.id),
      matchId: matchByUser.get(u.id) ?? null,
    }));
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

  private async poiById(poiId: number): Promise<{ id: number; name: string } | null> {
    const p = await this.prisma.pOI.findUnique({ where: { id: BigInt(poiId) }, select: { id: true, name: true } });
    return p ? { id: Number(p.id), name: p.name } : null;
  }

  // POI mais próximo a <= 40 m (bbox de 60 m no banco, distância exata em memória)
  private async nearestPoi(lat: number, lng: number): Promise<{ id: number; name: string } | null> {
    const bbox = bboxAround(lat, lng, POI_SEARCH_M);
    const pois = await this.prisma.pOI.findMany({
      where: {
        latitude: { gte: bbox.south, lte: bbox.north },
        longitude: { gte: bbox.west, lte: bbox.east },
      },
      select: { id: true, name: true, latitude: true, longitude: true },
      take: 20,
    });
    let best: { id: number; name: string } | null = null;
    let bestD = POI_SNAP_M;
    for (const p of pois) {
      const d = distanceMeters(lat, lng, Number(p.latitude), Number(p.longitude));
      if (d <= bestD) {
        bestD = d;
        best = { id: Number(p.id), name: p.name };
      }
    }
    return best;
  }

  private async estimateNearbyUsers(lat: number, lng: number): Promise<number> {
    const hash = encodeGeohash(lat, lng, GEOHASH_PRECISION);
    const ids = await this.redis.getNearbyUserIds([hash, ...ngeohash.neighbors(hash)]);
    return ids.length;
  }

  private age(birth: Date): number {
    const today = new Date();
    let a = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) a -= 1;
    return a;
  }
}
