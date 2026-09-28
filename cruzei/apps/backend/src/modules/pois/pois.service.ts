import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { bboxAround, distanceMeters } from '@cruzei/shared-utils';
import { avatarOrFallback } from '../../common/avatar';
import { LocationService } from '../location/location.service';
import { PRIVACY, lastSeenBand, type LastSeen } from '../location/discovery-privacy';

export const VIBE_FILTERS = ['all', 'hot', 'events', 'people', 'near'] as const;
export type VibeFilter = (typeof VIBE_FILTERS)[number];
export type VibeLevel = 'quiet' | 'warming' | 'hot' | 'peak';

/** a partir de quantas pessoas um lugar é "em alta" (o app usa o mesmo número pro pulso no mapa) */
export const VIBE_HOT_MIN = 5;
const VIBE_PEAK_MIN = 12;
/** tendência: onde cada pessoa estava há 45 min (última linha até lá, olhando até 75 min pra trás) */
const TREND_FROM_MIN = 75;
const TREND_TO_MIN = 45;
/** presença vale 2 h (TTL das linhas) — janela extra ao olhar "onde estava há 45 min" */
const PRESENCE_WINDOW_MIN = 120 - TREND_FROM_MIN;
const VIBE_MAX_RADIUS_M = 15_000;
const VIBE_MIN_RADIUS_M = 500;

export interface VibeQuery {
  /** quem pergunta — fica FORA de todas as contagens (senão ele mesmo levanta um lugar acima do piso) */
  me: string;
  lat: number;
  lng: number;
  radiusM: number;
  q?: string;
  filter: VibeFilter;
  categories?: string[];
  limit: number;
}

const CATEGORY_WORDS: Record<string, string> = {
  bar: 'bar bares balada boteco',
  restaurant: 'restaurante comer comida',
  cafe: 'cafe cafeteria',
  park: 'parque praca',
  shopping: 'shopping compras',
  gym: 'academia',
  show: 'show musica',
  event: 'evento festa',
  beach: 'praia',
  museum: 'museu cultura teatro',
  other: 'lugar',
};

/** sem acento e sem caixa — busca tolerante ("cafe" acha "Café") */
function fold(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function vibeLevel(peopleNow: number): VibeLevel {
  if (peopleNow >= VIBE_PEAK_MIN) return 'peak';
  if (peopleNow >= VIBE_HOT_MIN) return 'hot';
  if (peopleNow >= 2) return 'warming';
  return 'quiet';
}

/** 0–100: gente agora (log), tendência, evento, atividade recente, parceiro */
function vibeScore(peopleNow: number, trend: number, isEvent: boolean, lastActive: LastSeen | null, isPartner: boolean): number {
  let s = 0;
  if (peopleNow > 0) s += 35 + Math.min(25, (Math.log2(peopleNow) / Math.log2(24)) * 25);
  if (trend > 0) s += Math.min(20, trend * 4);
  if (isEvent) s += peopleNow > 0 ? 15 : 8;
  if (lastActive === 'online') s += 5;
  if (isPartner) s += 3;
  return Math.round(Math.min(100, s));
}

/**
 * Quem conta como "gente no lugar": a ÚLTIMA linha viva de cada usuário (quem andou pra outro lugar ou
 * pra casa some daqui na hora — o histórico é só-anexar com TTL de 2 h), sem anônimos e sem quem está
 * pausado, excluído ou com descoberta "ninguém" (a linha pode ter sido gravada antes de ele mudar).
 */
const USER_OK = Prisma.sql`u.visibility_mode = 'visible' AND u.is_paused = false AND u.deleted_at IS NULL AND u.discovery_mode <> 'nobody'`;

/**
 * Instantâneo de presença por lugar: a última linha viva de cada usuário (agora) e a de 45 min atrás (tendência).
 * Uma consulta a cada PLACE_SNAPSHOT_MS serve TODAS as requisições — antes cada /pois/vibe varria o histórico
 * inteiro e o /pois/nearby fazia uma varredura por lugar (N+1), o que esgotava o pool do banco com ~300 usuários.
 * As contagens continuam agregadas e com piso; o solicitante é descontado na hora de ler (ver vibe()).
 */
interface PlaceSnapshot {
  at: number;
  /** poiId → quem está lá agora, do mais recente pro mais antigo */
  now: Map<string, { userId: string; at: number }[]>;
  /** poiId → quem estava lá há 45 min */
  prev: Map<string, Set<string>>;
}
const PLACE_SNAPSHOT_MS = 15_000;
/** o instantâneo é calculado UMA vez por janela no cluster inteiro e compartilhado pelo Redis (antes: cada processo
 *  rodava a mesma varredura de ~700 ms no histórico a cada 15 s) */
const SNAP_KEY = 'poi:snap:v1';
const SNAP_LOCK = 'poi:snap:lock';

function encodeSnapshot(s: PlaceSnapshot): string {
  return JSON.stringify({
    at: s.at,
    now: [...s.now].map(([k, list]) => [k, list.map((x) => [x.userId, x.at])]),
    prev: [...s.prev].map(([k, set]) => [k, [...set]]),
  });
}

function decodeSnapshot(raw: string): PlaceSnapshot | null {
  try {
    const o = JSON.parse(raw) as { at: number; now: [string, [string, number][]][]; prev: [string, string[]][] };
    return {
      at: o.at,
      now: new Map(o.now.map(([k, list]) => [k, list.map(([userId, at]) => ({ userId, at }))])),
      prev: new Map(o.prev.map(([k, ids]) => [k, new Set(ids)])),
    };
  } catch {
    return null;
  }
}

/** rótulo do evento a partir do JSON de horários (formato livre do seed/OSM); "Hoje" quando não dá pra saber */
function eventLabel(hours: unknown): string {
  if (hours && typeof hours === 'object') {
    const h = hours as Record<string, unknown>;
    const start = typeof h.start === 'string' ? h.start : typeof h.open === 'string' ? h.open : null;
    const end = typeof h.end === 'string' ? h.end : typeof h.close === 'string' ? h.close : null;
    if (start && end) return `${start}–${end}`;
    if (start) return `a partir das ${start}`;
  }
  return 'Hoje';
}

@Injectable()
export class PoisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly location: LocationService,
    private readonly redis: RedisService,
  ) {}

  private snapshot: PlaceSnapshot | null = null;
  private snapshotInflight: Promise<PlaceSnapshot> | null = null;

  /** instantâneo compartilhado (single-flight): no máximo uma recomputação por janela, sem fila de consultas iguais */
  private async placeSnapshot(): Promise<PlaceSnapshot> {
    if (this.snapshot && Date.now() - this.snapshot.at < PLACE_SNAPSHOT_MS) return this.snapshot;
    if (!this.snapshotInflight) {
      this.snapshotInflight = this.sharedSnapshot()
        .then((snap) => (this.snapshot = snap))
        .finally(() => (this.snapshotInflight = null));
    }
    return this.snapshotInflight;
  }

  /** fresco no Redis → usa; senão quem pega a trava calcula e publica; os outros esperam um pouco e leem */
  private async sharedSnapshot(): Promise<PlaceSnapshot> {
    const r = this.redis.client;
    let stale: PlaceSnapshot | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await r.get(SNAP_KEY).catch(() => null);
      const got = raw ? decodeSnapshot(raw) : null;
      if (got && Date.now() - got.at < PLACE_SNAPSHOT_MS) return got;
      if (got) stale = got;
      if ((await r.set(SNAP_LOCK, '1', 'PX', 10_000, 'NX').catch(() => null)) === 'OK') {
        try {
          const snap = await this.computeSnapshot();
          await r.set(SNAP_KEY, encodeSnapshot(snap), 'EX', 60).catch(() => undefined);
          return snap;
        } finally {
          await r.del(SNAP_LOCK).catch(() => undefined);
        }
      }
      if (attempt === 0) await new Promise((res) => setTimeout(res, 1_200)); // outro processo está calculando
    }
    return stale ?? this.snapshot ?? this.computeSnapshot();
  }

  private async computeSnapshot(): Promise<PlaceSnapshot> {
    // "agora": onde cada usuário ativo está NESTE momento (última linha viva); "antes": onde estava há 45 min
    // (última linha até lá, dentro de uma janela de presença de 2 h). O DISTINCT ON roda sobre TODAS as linhas
    // do usuário — quem foi pra casa ou pra outro lugar some daqui na hora.
    const [nowRows, prevRows] = await Promise.all([
      this.prisma.$queryRaw<{ user_id: string; poi_id: bigint; recorded_at: Date }[]>`
        SELECT t.user_id, t.poi_id, t.recorded_at FROM (
          SELECT DISTINCT ON (l.user_id) l.user_id, l.poi_id, l.recorded_at
          FROM locations l JOIN users u ON u.id = l.user_id
          WHERE l.expires_at > NOW() AND l.is_anonymous = false AND ${USER_OK}
          ORDER BY l.user_id, l.recorded_at DESC
        ) t WHERE t.poi_id IS NOT NULL`,
      this.prisma.$queryRaw<{ user_id: string; poi_id: bigint }[]>`
        SELECT t.user_id, t.poi_id FROM (
          SELECT DISTINCT ON (l.user_id) l.user_id, l.poi_id
          FROM locations l JOIN users u ON u.id = l.user_id
          WHERE l.recorded_at BETWEEN NOW() - (${TREND_FROM_MIN + PRESENCE_WINDOW_MIN} * INTERVAL '1 minute') AND NOW() - (${TREND_TO_MIN} * INTERVAL '1 minute')
            AND l.is_anonymous = false AND ${USER_OK}
          ORDER BY l.user_id, l.recorded_at DESC
        ) t WHERE t.poi_id IS NOT NULL`,
    ]);
    const now = new Map<string, { userId: string; at: number }[]>();
    for (const r of nowRows) {
      const k = String(r.poi_id);
      const list = now.get(k) ?? [];
      list.push({ userId: r.user_id, at: new Date(r.recorded_at).getTime() });
      now.set(k, list);
    }
    for (const list of now.values()) list.sort((a, b) => b.at - a.at);
    const prev = new Map<string, Set<string>>();
    for (const r of prevRows) {
      const k = String(r.poi_id);
      const set = prev.get(k) ?? new Set<string>();
      set.add(r.user_id);
      prev.set(k, set);
    }
    return { at: Date.now(), now, prev };
  }

  /** contagem pública de um lugar (com piso), lida do instantâneo */
  private countFrom(snap: PlaceSnapshot, poiId: number | bigint): number {
    const n = snap.now.get(String(poiId))?.length ?? 0;
    return n >= PRIVACY.MIN_PLACE_K ? n : 0;
  }

  async nearby(lat: number, lng: number, radiusM: number, categories?: string[]) {
    const bbox = bboxAround(lat, lng, radiusM);
    const pois = await this.prisma.pOI.findMany({
      where: {
        latitude: { gte: bbox.south, lte: bbox.north },
        longitude: { gte: bbox.west, lte: bbox.east },
        ...(categories && categories.length > 0 ? { category: { in: categories as never } } : {}),
      },
      take: 100,
    });

    const snap = await this.placeSnapshot();
    const enriched = await Promise.all(
      pois.map(async (poi) => {
        const dist = distanceMeters(lat, lng, Number(poi.latitude), Number(poi.longitude));
        if (dist > radiusM) return null;
        const userCount = this.countFrom(snap, poi.id);
        return {
          id: Number(poi.id),
          name: poi.name,
          category: poi.category,
          subcategory: poi.subcategory,
          latitude: Number(poi.latitude),
          longitude: Number(poi.longitude),
          address: poi.address,
          rating: poi.rating ? Number(poi.rating) : null,
          totalRatings: poi.totalRatings,
          isPartner: poi.isPartner,
          partnerOffer: poi.partnerOffer,
          source: poi.source,
          distanceM: Math.round(dist),
          userCount,
        };
      }),
    );

    return enriched.filter((p): p is NonNullable<typeof p> => p !== null);
  }

  async get(id: number) {
    const poi = await this.prisma.pOI.findUnique({ where: { id: BigInt(id) } });
    if (!poi) throw new NotFoundException('POI não encontrado');
    const userCount = this.countFrom(await this.placeSnapshot(), id);
    return {
      id: Number(poi.id),
      name: poi.name,
      category: poi.category,
      subcategory: poi.subcategory,
      latitude: Number(poi.latitude),
      longitude: Number(poi.longitude),
      address: poi.address,
      neighborhood: poi.neighborhood,
      city: poi.city,
      state: poi.state,
      rating: poi.rating ? Number(poi.rating) : null,
      totalRatings: poi.totalRatings,
      phone: poi.phone,
      website: poi.website,
      hours: poi.hours,
      photos: poi.photos,
      isPartner: poi.isPartner,
      partnerOffer: poi.partnerOffer,
      source: poi.source,
      userCount,
    };
  }

  /**
   * "Quem está aqui?" — nomes/fotos só de quem pode ser descoberto por quem pergunta (reciprocidade, bloqueio,
   * área privada) e só se quem pergunta está PERTO do lugar (≤ raio de descoberta) e o lugar tem gente o bastante
   * (piso de anonimato). Fora disso o lugar mostra só a contagem (também com piso).
   */
  async getPeople(requesterId: string, id: number) {
    const here = ((await this.placeSnapshot()).now.get(String(id)) ?? []).slice(0, 100);
    const rows = await this.prisma.user.findMany({
      where: { id: { in: here.map((r) => r.userId) } },
      select: {
        id: true, name: true, birthDate: true, showAge: true, gender: true, avatarConfig: true,
        // só foto aprovada pela moderação
        photos: { where: { status: 'approved' }, orderBy: [{ isMain: 'desc' }, { orderIndex: 'asc' }], take: 1, select: { url: true, thumbnailUrl: true } },
      },
      take: 100,
    });
    const count = rows.length >= PRIVACY.MIN_PLACE_K ? rows.length : 0;
    const allowed = new Set(await this.location.discoverableAtPlace(requesterId, id, rows.map((r) => r.id)));
    const users = rows
      .filter((u) => allowed.has(u.id))
      .slice(0, 50)
      .map((u) => ({
        id: u.id,
        name: u.name,
        age: u.showAge ? this.age(u.birthDate) : null,
        mainPhotoUrl: u.photos[0]?.url ?? null,
        mapPhotoUrl: u.photos[0]?.thumbnailUrl && u.photos[0].thumbnailUrl !== u.photos[0].url ? u.photos[0].thumbnailUrl : null,
        avatar: avatarOrFallback(u),
        isVisible: true,
        isAnonymous: false,
      }));
    return { users, count };
  }

  async checkin(userId: string, poiId: number) {
    const c = await this.prisma.poisCheckin.create({
      data: { userId, poiId: BigInt(poiId) },
    });
    return { checkinId: Number(c.id), expiresAt: new Date(Date.now() + 4 * 3_600_000).toISOString() };
  }

  /**
   * "Onde tá a vibe" — lugares em volta de um centro com sinais AO VIVO: pessoas agora, tendência (vs. 30–60 min
   * atrás), evento e atividade recente, combinados num score. Privacidade: só contagens agregadas por lugar,
   * com o mesmo piso de anonimato do resto (< MIN_PLACE_K = 0), sem anônimos; nunca nome/horário de alguém.
   * O centro é público (centro do mapa) ou o próprio usuário — nunca a posição de terceiros.
   */
  async vibe(q: VibeQuery) {
    const radiusM = Math.min(VIBE_MAX_RADIUS_M, Math.max(VIBE_MIN_RADIUS_M, q.radiusM));
    const bbox = bboxAround(q.lat, q.lng, radiusM);
    const rows = await this.prisma.pOI.findMany({
      where: {
        latitude: { gte: bbox.south, lte: bbox.north },
        longitude: { gte: bbox.west, lte: bbox.east },
        ...(q.categories && q.categories.length > 0 ? { category: { in: q.categories as never } } : {}),
      },
      take: 300,
    });

    // o resumo ("N pessoas em lugares · M em alta") é do raio inteiro; o texto digitado só filtra a lista
    const needle = q.q ? fold(q.q) : '';
    const inRange = rows
      .map((poi) => ({ poi, dist: distanceMeters(q.lat, q.lng, Number(poi.latitude), Number(poi.longitude)) }))
      .filter((c) => c.dist <= radiusM);
    const matches = (poi: (typeof rows)[number]) => {
      if (!needle) return true;
      const hay = fold(`${poi.name} ${poi.neighborhood ?? ''} ${poi.subcategory ?? ''} ${CATEGORY_WORDS[poi.category] ?? ''}`);
      return hay.includes(needle);
    };

    const K = PRIVACY.MIN_PLACE_K;
    const nowMap = new Map<string, number>();
    const prevMap = new Map<string, number>();
    const lastMap = new Map<string, Date>();
    if (inRange.length > 0) {
      const snap = await this.placeSnapshot();
      for (const { poi } of inRange) {
        const key = String(poi.id);
        // o solicitante fica FORA da conta (senão ele mesmo levanta um lugar acima do piso e lê o horário de quem está lá)
        const others = (snap.now.get(key) ?? []).filter((x) => x.userId !== q.me);
        if (others.length) {
          nowMap.set(key, others.length);
          lastMap.set(key, new Date(others[0].at));
        }
        const before = snap.prev.get(key);
        if (before) prevMap.set(key, before.size - (before.has(q.me) ? 1 : 0));
      }
    }
    const now = Date.now();
    let peopleAtPlaces = 0;
    let hotCount = 0;
    const all = inRange.map(({ poi, dist }) => {
      const key = String(poi.id);
      const rawNow = nowMap.get(key) ?? 0;
      const peopleNow = rawNow >= K ? rawNow : 0;
      const rawPrev = prevMap.get(key) ?? 0;
      const prev = rawPrev >= K ? rawPrev : 0;
      const trend = peopleNow > 0 ? peopleNow - prev : 0;
      const lastAt = lastMap.get(key);
      // faixa (online / há pouco / mais cedo), nunca minutos: minuto a minuto num lugar pequeno vira o relógio de alguém
      const lastActive: LastSeen | null = peopleNow > 0 && lastAt ? lastSeenBand(lastAt.getTime()) : null;
      const isEvent = poi.category === 'event' || poi.category === 'show';
      const level = vibeLevel(peopleNow);
      peopleAtPlaces += peopleNow;
      if (peopleNow >= VIBE_HOT_MIN) hotCount += 1;
      return {
        _match: matches(poi),
        id: Number(poi.id),
        name: poi.name,
        category: poi.category,
        subcategory: poi.subcategory,
        latitude: Number(poi.latitude),
        longitude: Number(poi.longitude),
        address: poi.address,
        city: poi.city,
        state: poi.state,
        neighborhood: poi.neighborhood,
        rating: poi.rating ? Number(poi.rating) : null,
        totalRatings: poi.totalRatings,
        isPartner: poi.isPartner,
        partnerOffer: poi.partnerOffer,
        userCount: peopleNow,
        distanceM: Math.round(dist),
        peopleNow,
        trend,
        vibeScore: vibeScore(peopleNow, trend, isEvent, lastActive, poi.isPartner),
        vibeLevel: level,
        isEvent,
        eventLabel: isEvent ? eventLabel(poi.hours) : null,
        lastActive,
      };
    });

    const byScore = (a: (typeof all)[number], b: (typeof all)[number]) => b.vibeScore - a.vibeScore || a.distanceM - b.distanceM;
    const listed = all.filter((p) => p._match);
    let places = listed;
    switch (q.filter) {
      case 'hot':
        places = listed.filter((p) => p.peopleNow > 0).sort(byScore);
        break;
      case 'events':
        places = listed.filter((p) => p.isEvent).sort(byScore);
        break;
      case 'people':
        places = listed.filter((p) => p.peopleNow > 0).sort((a, b) => b.peopleNow - a.peopleNow || byScore(a, b));
        break;
      case 'near':
        places = [...listed].sort((a, b) => a.distanceM - b.distanceM);
        break;
      default:
        places = [...listed].sort(byScore);
    }

    return {
      places: places.slice(0, q.limit).map(({ _match, ...p }) => p),
      hotCount,
      peopleAtPlaces,
      generatedAt: new Date(now).toISOString(),
      radiusM,
    };
  }

  async hotspotsInCity(city: string) {
    // POIs com >= 3 usuários ativos via Redis ZSET
    const candidates = await this.prisma.pOI.findMany({
      where: { city },
      take: 200,
    });
    const snap = await this.placeSnapshot();
    const enriched = candidates.map((poi) => ({ poi, userCount: this.countFrom(snap, poi.id) }));
    return enriched
      .filter((e) => e.userCount >= 3)
      .map((e) => ({
        poi: {
          id: Number(e.poi.id),
          name: e.poi.name,
          category: e.poi.category,
          rating: e.poi.rating ? Number(e.poi.rating) : null,
        },
        userCount: e.userCount,
        latitude: Number(e.poi.latitude),
        longitude: Number(e.poi.longitude),
        lastUserAt: new Date().toISOString(),
      }))
      .sort((a, b) => b.userCount - a.userCount);
  }

  private age(birth: Date): number {
    const t = new Date();
    let a = t.getFullYear() - birth.getFullYear();
    const m = t.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && t.getDate() < birth.getDate())) a -= 1;
    return a;
  }
}
