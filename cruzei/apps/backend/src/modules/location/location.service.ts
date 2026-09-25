import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as ngeohash from 'ngeohash';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { avatarOrFallback } from '../../common/avatar';
import { bboxAround, distanceMeters, encodeGeohash } from '@cruzei/shared-utils';
import {
  PRIVACY,
  anonymizedCellPosition,
  anonymizedPlacePosition,
  cellOf,
  cellWithNeighbors,
  coarse,
  insidePrivateArea,
  lastSeenBand,
  localDateBrazil,
  localHourBrazil,
  proximityBand,
  type HiddenReason,
  type LastSeen,
  type PresenceType,
  type ProximityBand,
} from './discovery-privacy';

const GEOHASH_PRECISION = 5; // ~4.9km x 4.9km — só pra achar candidatos no Redis
// selo "novo por aqui" na bolha de identidade do mapa
const NEW_USER_MS = 7 * 24 * 3_600_000;
// Quem reporta posição a até 40 m de um POI é considerado "nele" (bbox de 60 m pra busca)
const POI_SNAP_M = 40;
/** poiId informado pelo app: aceito só se a posição reportada está a <= 150 m do lugar (tolerância de GPS) */
const POI_CLAIM_M = 150;
const POI_SEARCH_M = 60;
// Salt de fallback quando LOCATION_SALT não está configurado (validateEnv avisa no boot)
const DEV_SALT = 'cruzei-dev-salt';

/** thumbnail pra bolha do mapa: só quando existe um thumb de verdade (diferente da foto original) */
function mapThumb(photo: { url: string; thumbnailUrl: string | null } | undefined): string | null {
  if (!photo?.thumbnailUrl || photo.thumbnailUrl === photo.url) return null;
  return photo.thumbnailUrl;
}

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
  /** dentro de área privada / residência: existe pra quem consulta os outros, mas ninguém a vê */
  hidden: boolean;
}

/** O que sai pro cliente sobre outra pessoa — sem coordenada real, sem distância, sem timestamp. */
export interface DiscoveryUserDto {
  id: string;
  name: string;
  age: number | null;
  mainPhotoUrl: string | null;
  mapPhotoUrl: string | null;
  isNew: boolean;
  proximityBand: ProximityBand;
  presenceType: PresenceType;
  poi: { id: number; name: string } | null;
  /** posição VISUAL anonimizada (centro da célula ou ponto do lugar) — nunca a real */
  mapPosition: { lat: number; lng: number } | null;
  lastSeen: LastSeen;
  isOnline: boolean;
  isAnonymous: false;
  premiumTier: string;
  isVerified: boolean;
  isBoosted: boolean;
  avatar: unknown;
  likedByMe: boolean;
  matchId: string | null;
}

export interface DiscoveryResult {
  users: DiscoveryUserDto[];
  /** pessoas por perto que existem mas não ganham marcador/identidade (área esparsa) */
  hiddenCount: number;
  radiusM: number;
  me: { discoverable: boolean; hiddenReason: HiddenReason | null };
}

type DiscoveryMode = 'everyone' | 'compatible' | 'nobody';

interface Party {
  id: string;
  discoveryMode: DiscoveryMode;
  interests: Set<number>;
  visibilityMode: string;
  isPaused: boolean;
  deletedAt: Date | null;
}

interface CandidateRow {
  id: string;
  name: string;
  gender: string | null;
  birthDate: Date;
  showAge: boolean;
  showPhotoOnMap: boolean;
  createdAt: Date;
  premiumTier: string;
  isVerified: boolean;
  avatarConfig: unknown;
  visibilityMode: string;
  isPaused: boolean;
  deletedAt: Date | null;
  discoveryMode: DiscoveryMode;
  photos: { url: string; thumbnailUrl: string | null }[];
  userInterests: { interestId: number }[];
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

  // ---------------------------------------------------------------------------------------------
  // Atualização da MINHA posição (a única coordenada precisa que o servidor recebe)
  // ---------------------------------------------------------------------------------------------
  async update(userId: string, payload: UpdatePayload) {
    const { latitude, longitude, accuracyMeters, city, state } = payload;
    const now = Date.now();

    // anti-trilha: no máximo uma atualização aceita a cada MIN_UPDATE_INTERVAL_S — o resto devolve o último resultado
    const gateKey = `loc:gate:${userId}`;
    const accepted = await this.redis.client.set(gateKey, '1', 'EX', PRIVACY.MIN_UPDATE_INTERVAL_S, 'NX');
    if (accepted !== 'OK') {
      const cached = await this.redis.client.get(`loc:last:${userId}`);
      if (cached) return JSON.parse(cached);
    }

    const geohash = encodeGeohash(latitude, longitude, GEOHASH_PRECISION);
    const expiresAt = new Date(now + PRIVACY.PRESENCE_TTL_S * 1000);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        visibilityMode: true,
        isPaused: true,
        deletedAt: true,
        discoveryMode: true,
        privateAreas: { select: { latitude: true, longitude: true, radiusM: true } },
      },
    });
    const isAnonymous = user?.visibilityMode === 'anonymous';

    // lugar atual: o que o app mandou (se existir) ou o POI mais próximo a <= 40 m da posição reportada
    // um poiId inventado (posição a km do lugar) não pode "colocar" alguém num lugar — ver PoisService.vibe
    const poi = (payload.poiId != null ? await this.poiWithin(payload.poiId, latitude, longitude) : null) ?? (await this.nearestPoi(latitude, longitude));

    // residência / área privada (servidor decide; o app só recebe "você está oculto aqui")
    const cell = cellOf(latitude, longitude);
    const manual = insidePrivateArea(
      latitude,
      longitude,
      (user?.privateAreas ?? []).map((a) => ({ latitude: Number(a.latitude), longitude: Number(a.longitude), radiusM: a.radiusM })),
    );
    const home = !manual && (await this.learnHome(userId, cell));
    const hidden = manual || home;

    // histórico GROSSEIRO (3 casas ≈ 110 m): serve pro contexto do match/lugares em comum, nunca pra rastrear
    await this.prisma.location.create({
      data: {
        userId,
        latitude: coarse(latitude),
        longitude: coarse(longitude),
        geohash,
        accuracyMeters,
        poiId: poi ? BigInt(poi.id) : undefined,
        city,
        state,
        expiresAt,
        isAnonymous: isAnonymous || hidden,
      },
    });

    await this.prisma.user.update({ where: { id: userId }, data: { lastActiveAt: new Date(now) } });

    const visible = !user?.isPaused && !user?.deletedAt;
    if (visible) {
      await this.redis.setUserPresence(
        userId,
        geohash,
        latitude,
        longitude,
        PRIVACY.PRESENCE_TTL_S,
        poi ? { id: String(poi.id), name: poi.name } : null,
        hidden,
        cell,
      );
    }

    const nearbyUsers = await this.estimateNearbyUsers(latitude, longitude);
    const nearbyPois = await this.prisma.pOI.count({ where: city ? { city } : {} });

    let hiddenReason: HiddenReason | null = null;
    if (!visible) hiddenReason = 'paused';
    else if (isAnonymous) hiddenReason = 'anonymous';
    else if (user?.discoveryMode === 'nobody') hiddenReason = 'nobody';
    else if (manual) hiddenReason = 'private_area';
    else if (home) hiddenReason = 'home';

    const result = {
      geohash,
      nearbyUsers,
      nearbyPois,
      expiresAt: expiresAt.toISOString(),
      discoverable: hiddenReason === null,
      hiddenReason,
    };
    await this.redis.client.set(`loc:last:${userId}`, JSON.stringify(result), 'EX', PRIVACY.MIN_UPDATE_INTERVAL_S * 3);
    return result;
  }

  /**
   * Aprende a residência: madrugada (00h–06h Brasília) na mesma célula em >= HOME_MIN_NIGHTS noites → célula vira
   * área privada automática. Só células grosseiras (~150 m) ficam guardadas, por HOME_LEARN_DAYS.
   */
  private async learnHome(userId: string, cell: string): Promise<boolean> {
    const hour = localHourBrazil();
    if (hour < 6) {
      const date = localDateBrazil();
      const key = `home:nights:${userId}:${cell}`;
      await this.redis.client.sadd(key, date);
      await this.redis.client.expire(key, PRIVACY.HOME_LEARN_DAYS * 86_400);
      const nights = await this.redis.client.scard(key);
      if (nights >= PRIVACY.HOME_MIN_NIGHTS) {
        await this.redis.client.sadd(`home:cells:${userId}`, cell);
        await this.redis.client.expire(`home:cells:${userId}`, PRIVACY.HOME_LEARN_DAYS * 86_400);
      }
    }
    const homeCells = await this.redis.client.smembers(`home:cells:${userId}`);
    if (homeCells.length === 0) return false;
    const around = new Set(cellWithNeighbors(cell));
    return homeCells.some((c) => around.has(c));
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
        poi: m.poi_id ? (poiById.get(m.poi_id) ?? null) : null,
        hidden: m.hidden === '1',
      });
    });
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // Descoberta por proximidade — centro = MINHA posição no servidor (o cliente não escolhe o centro)
  // ---------------------------------------------------------------------------------------------
  async discover(requesterId: string, requestedRadiusM?: number): Promise<DiscoveryResult> {
    const radiusM = Math.min(PRIVACY.DISCOVERY_RADIUS_M, Math.max(50, requestedRadiusM ?? PRIVACY.DISCOVERY_RADIUS_M));
    const empty = (reason: HiddenReason | null): DiscoveryResult => ({
      users: [],
      hiddenCount: 0,
      radiusM,
      me: { discoverable: reason === null, hiddenReason: reason },
    });

    const me = await this.loadParty(requesterId);
    if (!me) return empty('paused');
    const presences = await this.getPresences([requesterId]);
    const mine = presences.get(requesterId);
    if (!mine) return empty('no_presence');
    const myReason = this.selfHiddenReason(me, mine);
    // "Ninguém": não aparece e não vê (reciprocidade)
    if (me.discoveryMode === 'nobody') return empty('nobody');

    // candidatos: células geohash-5 em volta da MINHA posição real
    const centerHash = encodeGeohash(mine.lat, mine.lng, GEOHASH_PRECISION);
    const ids = (await this.redis.getNearbyUserIds([centerHash, ...ngeohash.neighbors(centerHash)])).filter((id) => id !== requesterId);
    if (ids.length === 0) return empty(myReason);

    const blocked = await this.blockedWith(requesterId, ids);
    const rows = await this.loadCandidates(ids.filter((id) => !blocked.has(id)));
    const pres = await this.getPresences(rows.map((r) => r.id));

    // 1) elegibilidade (visível, com presença, não oculto, regras de descoberta dos DOIS lados) + raio REAL
    const eligible: { u: CandidateRow; p: Presence; dist: number }[] = [];
    for (const u of rows) {
      const p = pres.get(u.id);
      if (!p || !this.mutuallyDiscoverable(me, this.partyOf(u), p)) continue;
      const dist = distanceMeters(mine.lat, mine.lng, p.lat, p.lng);
      if (dist <= radiusM) eligible.push({ u, p, dist });
    }
    if (eligible.length === 0) return empty(myReason);

    // 2) anonimato: contagem de pessoas visíveis por área (geohash-6) e por lugar — sobre TODO mundo visível da região,
    //    não só quem eu posso ver (quanto mais gente na conta, mais conservador é o "esconder")
    const allVisible = rows.filter((u) => {
      const p = pres.get(u.id);
      return p && !p.hidden && u.visibilityMode === 'visible' && !u.isPaused && !u.deletedAt && u.discoveryMode !== 'nobody';
    });
    const areaCount = new Map<string, number>();
    const placeCount = new Map<number, number>();
    for (const u of allVisible) {
      const p = pres.get(u.id)!;
      const area = cellOf(p.lat, p.lng, PRIVACY.AREA_PRECISION);
      areaCount.set(area, (areaCount.get(area) ?? 0) + 1);
      if (p.poi) placeCount.set(p.poi.id, (placeCount.get(p.poi.id) ?? 0) + 1);
    }

    const day = new Date().toISOString().slice(0, 10);
    const shown: { u: CandidateRow; p: Presence; pos: { lat: number; lng: number }; type: PresenceType; band: ProximityBand; poi: PresencePoi | null }[] = [];
    let hiddenCount = 0;
    for (const { u, p } of eligible) {
      const seed = `${this.salt}:${day}:${u.id}`;
      const atPlace = p.poi && (placeCount.get(p.poi.id) ?? 0) >= PRIVACY.MIN_PLACE_K ? p.poi : null;
      if (atPlace) {
        const pos = anonymizedPlacePosition(seed, atPlace);
        shown.push({ u, p, pos, type: 'place', band: proximityBand(distanceMeters(mine.lat, mine.lng, pos.lat, pos.lng)), poi: atPlace });
        continue;
      }
      const area = cellOf(p.lat, p.lng, PRIVACY.AREA_PRECISION);
      if ((areaCount.get(area) ?? 0) < PRIVACY.MIN_AREA_K) {
        hiddenCount += 1; // região esparsa: existe alguém por perto, mas sem identidade nem marcador
        continue;
      }
      const pos = anonymizedCellPosition(seed, cellOf(p.lat, p.lng));
      // a faixa é calculada da posição VISUAL (não da real): consultar de vários pontos só reconstrói a célula
      shown.push({ u, p, pos, type: 'nearby', band: proximityBand(distanceMeters(mine.lat, mine.lng, pos.lat, pos.lng)), poi: null });
    }

    // 3) enriquecimento social (boost, curtida, match) — só pra quem vai aparecer
    const shownIds = shown.map((s) => s.u.id);
    const now = new Date();
    const [boosts, likes, matches] = shownIds.length
      ? await Promise.all([
          this.prisma.boost.findMany({ where: { userId: { in: shownIds }, expiresAt: { gt: now } }, select: { userId: true } }),
          this.prisma.like.findMany({ where: { likerId: requesterId, likedId: { in: shownIds } }, select: { likedId: true } }),
          this.prisma.match.findMany({
            where: { status: 'active', OR: [{ userAId: requesterId, userBId: { in: shownIds } }, { userBId: requesterId, userAId: { in: shownIds } }] },
            select: { id: true, userAId: true, userBId: true },
          }),
        ])
      : [[], [], []];
    const boosted = new Set(boosts.map((b) => b.userId));
    const liked = new Set(likes.map((l) => l.likedId));
    const matchByUser = new Map(matches.map((m) => [m.userAId === requesterId ? m.userBId : m.userAId, m.id]));
    const newSince = now.getTime() - NEW_USER_MS;
    const bandRank: Record<ProximityBand, number> = { very_near: 0, near: 1, region: 2 };

    const users: DiscoveryUserDto[] = shown
      .sort((a, b) => bandRank[a.band] - bandRank[b.band] || a.u.name.localeCompare(b.u.name))
      .map(({ u, p, pos, type, band, poi }) => ({
        id: u.id,
        name: u.name,
        age: u.showAge ? this.age(u.birthDate) : null,
        mainPhotoUrl: u.photos[0]?.url ?? null,
        mapPhotoUrl: u.showPhotoOnMap ? mapThumb(u.photos[0]) : null,
        isNew: u.createdAt.getTime() > newSince,
        proximityBand: band,
        presenceType: type,
        poi: poi ? { id: poi.id, name: poi.name } : null,
        mapPosition: pos,
        lastSeen: lastSeenBand(p.updatedAt),
        isOnline: lastSeenBand(p.updatedAt) === 'online',
        isAnonymous: false,
        premiumTier: u.premiumTier,
        isVerified: u.isVerified,
        isBoosted: boosted.has(u.id),
        avatar: avatarOrFallback(u),
        likedByMe: liked.has(u.id),
        matchId: matchByUser.get(u.id) ?? null,
      }));

    return { users, hiddenCount, radiusM, me: { discoverable: myReason === null, hiddenReason: myReason } };
  }

  /**
   * A pessoa `targetId` pode ser descoberta por `requesterId` AGORA (mesmas regras do /nearby)?
   * Usado pelo cartão público, acenos e "quem está no lugar". Devolve faixa e lugar — nunca distância/posição.
   */
  async discoverability(requesterId: string, targetId: string): Promise<{ ok: boolean; band: ProximityBand | null; poi: { id: number; name: string } | null }> {
    const none = { ok: false, band: null, poi: null };
    if (requesterId === targetId) return none;
    const [me, blocked] = await Promise.all([this.loadParty(requesterId), this.blockedWith(requesterId, [targetId])]);
    if (!me || blocked.has(targetId) || me.discoveryMode === 'nobody') return none;
    const rows = await this.loadCandidates([targetId]);
    if (rows.length === 0) return none;
    const pres = await this.getPresences([requesterId, targetId]);
    const mine = pres.get(requesterId);
    const theirs = pres.get(targetId);
    if (!mine || !theirs || !this.mutuallyDiscoverable(me, this.partyOf(rows[0]), theirs)) return none;
    const dist = distanceMeters(mine.lat, mine.lng, theirs.lat, theirs.lng);
    if (dist > PRIVACY.DISCOVERY_RADIUS_M) return none;
    // faixa pela posição visual (célula ou lugar), como no /nearby
    const day = new Date().toISOString().slice(0, 10);
    const seed = `${this.salt}:${day}:${targetId}`;
    const pos = theirs.poi ? anonymizedPlacePosition(seed, theirs.poi) : anonymizedCellPosition(seed, cellOf(theirs.lat, theirs.lng));
    return {
      ok: true,
      band: proximityBand(distanceMeters(mine.lat, mine.lng, pos.lat, pos.lng)),
      poi: theirs.poi ? { id: theirs.poi.id, name: theirs.poi.name } : null,
    };
  }

  /** ids de quem está num lugar e pode ser descoberto por `requesterId` (requester precisa estar perto do lugar) */
  async discoverableAtPlace(requesterId: string, poiId: number, candidateIds: string[]): Promise<string[]> {
    if (candidateIds.length === 0) return [];
    const me = await this.loadParty(requesterId);
    if (!me || me.discoveryMode === 'nobody') return [];
    const poi = await this.prisma.pOI.findUnique({ where: { id: BigInt(poiId) }, select: { latitude: true, longitude: true } });
    const pres = await this.getPresences([requesterId, ...candidateIds]);
    const mine = pres.get(requesterId);
    if (!poi || !mine || distanceMeters(mine.lat, mine.lng, Number(poi.latitude), Number(poi.longitude)) > PRIVACY.DISCOVERY_RADIUS_M) return [];
    const blocked = await this.blockedWith(requesterId, candidateIds);
    const rows = await this.loadCandidates(candidateIds.filter((id) => id !== requesterId && !blocked.has(id)));
    const ok = rows.filter((u) => {
      const p = pres.get(u.id);
      return p && p.poi?.id === poiId && this.mutuallyDiscoverable(me, this.partyOf(u), p);
    });
    return ok.length >= PRIVACY.MIN_PLACE_K ? ok.map((u) => u.id) : [];
  }

  // ---------------------------------------------------------------------------------------------
  // Regras
  // ---------------------------------------------------------------------------------------------
  private selfHiddenReason(me: Party, mine: Presence): HiddenReason | null {
    if (me.isPaused || me.deletedAt) return 'paused';
    if (me.visibilityMode === 'anonymous') return 'anonymous';
    if (me.discoveryMode === 'nobody') return 'nobody';
    if (mine.hidden) return 'private_area';
    return null;
  }

  /** A e B se descobrem só se as regras dos DOIS permitirem (reciprocidade). */
  private mutuallyDiscoverable(a: Party, b: Party, bPresence: Presence): boolean {
    if (b.visibilityMode !== 'visible' || b.isPaused || b.deletedAt) return false;
    if (bPresence.hidden) return false;
    if (a.discoveryMode === 'nobody' || b.discoveryMode === 'nobody') return false;
    const shared = () => [...a.interests].some((i) => b.interests.has(i));
    if (a.discoveryMode === 'compatible' && !shared()) return false;
    if (b.discoveryMode === 'compatible' && !shared()) return false;
    return true;
  }

  private partyOf(u: CandidateRow): Party {
    return {
      id: u.id,
      discoveryMode: u.discoveryMode,
      interests: new Set(u.userInterests.map((i) => i.interestId)),
      visibilityMode: u.visibilityMode,
      isPaused: u.isPaused,
      deletedAt: u.deletedAt,
    };
  }

  private async loadParty(id: string): Promise<Party | null> {
    const u = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, discoveryMode: true, visibilityMode: true, isPaused: true, deletedAt: true, userInterests: { select: { interestId: true } } },
    });
    if (!u || u.deletedAt) return null;
    return { id: u.id, discoveryMode: u.discoveryMode as DiscoveryMode, interests: new Set(u.userInterests.map((i) => i.interestId)), visibilityMode: u.visibilityMode, isPaused: u.isPaused, deletedAt: u.deletedAt };
  }

  private async loadCandidates(ids: string[]): Promise<CandidateRow[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.user.findMany({
      where: { id: { in: ids }, deletedAt: null, isPaused: false, visibilityMode: 'visible' },
      select: {
        id: true,
        name: true,
        gender: true,
        birthDate: true,
        showAge: true,
        showPhotoOnMap: true,
        createdAt: true,
        premiumTier: true,
        isVerified: true,
        avatarConfig: true,
        visibilityMode: true,
        isPaused: true,
        deletedAt: true,
        discoveryMode: true,
        photos: { where: { isMain: true }, select: { url: true, thumbnailUrl: true } },
        userInterests: { select: { interestId: true } },
      },
    });
    return rows as unknown as CandidateRow[];
  }

  /** ids bloqueados em qualquer direção entre `me` e `ids` */
  private async blockedWith(me: string, ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const blocks = await this.prisma.block.findMany({
      where: { OR: [{ blockerId: me, blockedId: { in: ids } }, { blockedId: me, blockerId: { in: ids } }] },
      select: { blockedId: true, blockerId: true },
    });
    const out = new Set<string>();
    blocks.forEach((b) => {
      out.add(b.blockedId);
      out.add(b.blockerId);
    });
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // Minha própria posição (dado meu — nunca de terceiros)
  // ---------------------------------------------------------------------------------------------
  async getMe(userId: string) {
    const loc = await this.redis.client.hgetall(`user:loc:${userId}`);
    if (!loc.lat) return null;
    return {
      latitude: Number(loc.lat),
      longitude: Number(loc.lng),
      geohash: loc.geohash,
      recordedAt: loc.updated_at ? new Date(Number(loc.updated_at)).toISOString() : null,
      discoverable: loc.hidden !== '1',
    };
  }

  /** o lugar informado pelo app só vale se a posição reportada está a <= POI_CLAIM_M dele */
  private async poiWithin(poiId: number, lat: number, lng: number): Promise<{ id: number; name: string } | null> {
    const p = await this.prisma.pOI.findUnique({ where: { id: BigInt(poiId) }, select: { id: true, name: true, latitude: true, longitude: true } });
    if (!p) return null;
    return distanceMeters(lat, lng, Number(p.latitude), Number(p.longitude)) <= POI_CLAIM_M ? { id: Number(p.id), name: p.name } : null;
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
