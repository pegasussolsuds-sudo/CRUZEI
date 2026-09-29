import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as ngeohash from 'ngeohash';
import { PrismaService } from '../../database/prisma.service';
import { ChatGateway } from '../../realtime/chat.gateway';
import type { Redis } from 'ioredis';
import { CANDIDATE_INVALIDATION_CHANNEL, RedisService } from '../../redis/redis.service';
import { avatarOrFallback } from '../../common/avatar';
import { distanceMeters, encodeGeohash } from '@cruzei/shared-utils';
import type { ConversationRef, InvisiblePresence, PlaceKind, PlacePrompt } from '@cruzei/shared-types';
import { effectiveTier } from '../../common/premium';
import { groupInvisible, type InvisibleItem } from './invisible';
import type { LikeStatus } from '../inbox/routing';
import { loadPeerSocial, type PeerSocialRow } from './peer-social';
import { ExpiringCache, SaturatedError, Semaphore, TtlMemo, chunk, historySignature, matchesHomeCells, planCellReload, selectTop, triageForDiscovery } from './hot-path';
import { PoiIndex } from './poi-index';
import { HISTORY_QUEUE, HISTORY_QUEUE_MAX, LAST_ACTIVE_PENDING, accuracyForDb, type QueuedHistory } from './location-writes';
import {
  CROWD,
  CROWD_CELL_PRECISION,
  PRIVACY,
  anonymizedCellPosition,
  anonymizedPlacePosition,
  cellOf,
  cellWithNeighbors,
  coarse,
  crowdMember,
  dwellBand,
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

// células de presença: geohash-6 ≈ 1,2 km × 0,6 km; a célula + 8 vizinhas (≈ 3,7 km × 1,8 km) cobre o raio de 350 m.
// (Até 28/09 era 5 com um encoder quebrado que punha o Brasil inteiro numa célula só.)
export const PRESENCE_PRECISION = 6;
const GEOHASH_PRECISION = PRESENCE_PRECISION;
// selo "novo por aqui" na bolha de identidade do mapa
const NEW_USER_MS = 7 * 24 * 3_600_000;
// Quem reporta posição a até 40 m de um POI é considerado "nele" (bbox de 60 m pra busca)
const POI_SNAP_M = 40;
/** poiId informado pelo app: aceito só se a posição reportada está a <= 150 m do lugar (tolerância de GPS) */
const POI_CLAIM_M = 150;
const POI_SEARCH_M = 60;
// Salt de fallback quando LOCATION_SALT não está configurado (validateEnv avisa no boot)
const DEV_SALT = 'cruzei-dev-salt';
/** convite "Tá rolando algo aqui?": o lugar candidato precisa estar a até isto de quem recebe */
const PROMPT_M = 150;
// --- carga (teste de 40 mil pessoas em Uberlândia) ---
/** quem está parado reaproveita a linha de histórico por até X s (cada linha vale 2 h) em vez de gravar uma a cada 20 s */
const HISTORY_REUSE_S = 300;
/** "último acesso" gravado no banco no máximo a cada X s por pessoa (a coluna é indexada: cada UPDATE reescreve índices) */
const LAST_ACTIVE_EVERY_S = 60;
/** lugares públicos mudam raramente: índice em memória recarregado a cada minuto (e na hora quando um lugar é criado) */
const POI_INDEX_TTL_MS = 60_000;
/** consultas com IN: no máximo N ids por vez (o Postgres aceita até 32.767 parâmetros) */
const ID_CHUNK = 5_000;
/**
 * presenças de uma célula (lidas do Redis) reaproveitadas por X ms entre descobertas do mesmo processo.
 * Numa multidão (show, balada: milhares de pessoas nas 9 células), cada /nearby lia milhares de HGETALL — o teste de
 * 40 mil chegou a 217 mil operações/s no Redis com só 550 req/s. As posições só mudam a cada ≥ 20 s por pessoa.
 */
const CELL_PRESENCE_TTL_MS = 2_000;
/** células guardadas pra recarga incremental antes de podar as esquecidas */
const CELL_STATE_MAX = 4_000;

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
  /** células calculadas uma vez por presença lida (área de anonimato geohash-6 e célula visual geohash-7) — só uso interno */
  area?: string;
  vcell?: string;
  /** posição visual já calculada pra esta presença (chave = tipo + célula/lugar + dia) — só uso interno */
  vposKey?: string;
  vpos?: { lat: number; lng: number };
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
  /** status da curtida do meu ponto de vista (RECEIVED só pra Premium+) */
  likeStatus: LikeStatus;
  /** conversa do par não arquivada por mim */
  conversation: ConversationRef | null;
}

export interface DiscoveryResult {
  users: DiscoveryUserDto[];
  /** pessoas por perto que existem mas não ganham marcador/identidade (área esparsa) */
  hiddenCount: number;
  /** invisíveis agrupados, só pra Premium vigente (grátis: null) — sem identidade (location/invisible.ts) */
  invisible: InvisiblePresence | null;
  radiusM: number;
  me: { discoverable: boolean; hiddenReason: HiddenReason | null; placePrompt?: PlacePrompt | null };
}

/** candidato que pode aparecer no convite "Tá rolando algo aqui?" (posição só pra filtrar aqui dentro; nunca sai) */
interface PromptOption {
  id: string;
  name: string;
  kind: PlaceKind;
  lat: number;
  lng: number;
}

type DiscoveryMode = 'everyone' | 'compatible' | 'nobody';

interface Party {
  id: string;
  discoveryMode: DiscoveryMode;
  interests: Set<number>;
  visibilityMode: string;
  isPaused: boolean;
  deletedAt: Date | null;
  /** só no consultante (loadParty): Premium vigente — decide se vê os invisíveis agrupados */
  premium?: boolean;
}

/** flags de privacidade do candidato: recarregadas a cada DISCOVERY_CANDIDATE_TTL_MS (consulta leve, só colunas) */
interface CandidateFlags {
  id: string;
  visibilityMode: string;
  isPaused: boolean;
  deletedAt: Date | null;
  discoveryMode: DiscoveryMode;
  showAge: boolean;
  showPhotoOnMap: boolean;
}

/** parte pesada do perfil: recarregada a cada DISCOVERY_PROFILE_TTL_MS */
interface CandidateProfile {
  id: string;
  name: string;
  gender: string | null;
  birthDate: Date;
  createdAt: Date;
  premiumTier: string;
  isVerified: boolean;
  avatarConfig: unknown;
  photos: { url: string; thumbnailUrl: string | null }[];
  userInterests: { interestId: number }[];
}

type CandidateRow = CandidateFlags & CandidateProfile;

@Injectable()
export class LocationService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(LocationService.name);
  // --- carga: no máximo N descobertas ao mesmo tempo por processo; a fila tem teto e prazo (lotou → 503, o app tenta de novo)
  private readonly discoverSlots = new Semaphore(PRIVACY.DISCOVERY_MAX_CONCURRENCY, {
    maxQueue: PRIVACY.DISCOVERY_MAX_QUEUE,
    maxWaitMs: PRIVACY.DISCOVERY_MAX_WAIT_MS,
  });
  /**
   * linhas de candidato montadas (null = não elegível: pausado, anônimo, excluído) — valem o prazo das FLAGS de
   * privacidade (5 s). Poda incremental, teto de 60 mil.
   */
  private readonly candidateCache = new ExpiringCache<string, CandidateRow | null>(PRIVACY.DISCOVERY_CANDIDATE_TTL_MS, 60_000);
  /**
   * parte pesada do perfil (nome, fotos, avatar, interesses), reaproveitada por DISCOVERY_PROFILE_TTL_MS: numa multidão
   * cada processo recarregava milhares de perfis COMPLETOS a cada 5 s — a maior parte da CPU do /nearby ia pro Prisma
   */
  private readonly profileCache = new ExpiringCache<string, CandidateProfile | null>(PRIVACY.DISCOVERY_PROFILE_TTL_MS, 60_000);
  private readonly poiIndexMemo = new TtlMemo<'all', PoiIndex>(POI_INDEX_TTL_MS, 1);
  /** presenças por célula de presença (geohash-6), com carga única por célula ("single-flight") */
  private readonly cellPresence = new TtlMemo<string, Map<string, Presence>>(CELL_PRESENCE_TTL_MS, 20_000);
  /** quem acabou de se ocultar (aviso "hide" de qualquer processo): fora da descoberta até as presenças em cache vencerem */
  private readonly hiddenNow = new ExpiringCache<string, number>(15_000, 100_000);
  /** última carga de cada célula (ids + horário) pra recarga incremental */
  private readonly cellState = new Map<string, { at: number; scores: Map<string, number>; pres: Map<string, Presence> }>();
  /** "Party" (regras de descoberta + interesses) de cada linha de perfil — a linha vive no candidateCache */
  private readonly partyCache = new WeakMap<CandidateRow, Party>();
  /** quem está com boost ativo agora (poucas linhas; vale pra todas as consultas por 10 s) */
  private readonly boostMemo = new TtlMemo<'all', Set<string>>(10_000, 1);
  /** as 9 células em volta de uma célula central já juntas num mapa só (todo mundo da mesma região reaproveita por 2 s) */
  private readonly regionPresence = new TtlMemo<string, Map<string, Presence>>(CELL_PRESENCE_TTL_MS, 5_000);
  /** candidatos a lugar abertos pra confirmação no local, por célula geohash-7 do lugar (recarrega a cada 60 s) */
  private readonly promptMemo = new TtlMemo<'all', Map<string, PromptOption[]>>(60_000, 1);
  private readonly salt: string;
  private invalidations: Redis | null = null;
  /** junta várias mudanças de lugar seguidas (ex.: a rodada da galera) num aviso só pros apps */
  private poisChangedTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    config: ConfigService,
    @Optional() private readonly chat?: ChatGateway,
  ) {
    this.salt = config.get<string>('locationSalt') || DEV_SALT;
  }

  /** cada processo escuta as invalidações (perfil/privacidade mudou) e esquece a pessoa na hora */
  async onModuleInit(): Promise<void> {
    try {
      this.invalidations = this.redis.client.duplicate();
      this.invalidations.on('message', (_channel: string, id: string) => {
        if (id.startsWith('hide:')) {
          // hide:<id>:<quando> — presença em cache mais VELHA que isso é tratada como oculta; mais nova (a pessoa já
          // atualizou depois, por exemplo saindo da área) vale o que ela diz
          const [uid, at] = id.slice(5).split(':');
          this.hiddenNow.set(uid, Number(at) || Date.now());
          return;
        }
        if (id === '*') {
          this.candidateCache.clear();
          this.profileCache.clear();
          return;
        }
        this.candidateCache.delete(id);
        this.profileCache.delete(id);
      });
      this.invalidations.on('error', (e: Error) => this.log.warn(`canal de invalidação: ${e.message}`));
      await this.invalidations.subscribe(CANDIDATE_INVALIDATION_CHANNEL);
    } catch (e) {
      this.log.warn(`sem canal de invalidação (fica o prazo de segurança): ${(e as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.invalidations?.quit().catch(() => undefined);
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
        createdAt: true,
        isVerified: true,
        privateAreas: { select: { latitude: true, longitude: true, radiusM: true } },
      },
    });
    const isAnonymous = user?.visibilityMode === 'anonymous';

    // lugar atual: o que o app mandou (se existir) ou o POI mais próximo a <= 40 m da posição reportada
    // um poiId inventado (posição a km do lugar) não pode "colocar" alguém num lugar — ver PoisService.vibe
    // (índice em memória: antes eram 1–2 consultas por atualização varrendo a tabela sem índice espacial)
    const idx = await this.poiIndex();
    const poi = (payload.poiId != null ? this.poiWithin(idx, payload.poiId, latitude, longitude) : null) ?? this.nearestPoi(idx, latitude, longitude);

    // residência / área privada (servidor decide; o app só recebe "você está oculto aqui")
    const cell = cellOf(latitude, longitude);
    const manual = insidePrivateArea(
      latitude,
      longitude,
      (user?.privateAreas ?? []).map((a) => ({ latitude: Number(a.latitude), longitude: Number(a.longitude), radiusM: a.radiusM })),
    );
    const home = !manual && (await this.learnHome(userId, cell));
    const hidden = manual || home;
    const visible = !user?.isPaused && !user?.deletedAt;

    // sinal de multidão (descoberta de lugares): só quem está visível, fora de área privada/casa e FORA de um lugar já
    // conhecido, com GPS razoável e conta com idade mínima (ou selfie verificada) — contas novas em massa não fabricam
    // um 'lugar'. Grava só agregados (HyperLogLog de hashes com chave) e só depois de CROWD.DWELL_MS parado ali.
    const crowdOk =
      CROWD.RECORD_ENABLED &&
      CROWD.MODE !== 'off' &&
      visible &&
      !poi &&
      !hidden &&
      !isAnonymous &&
      user?.discoveryMode !== 'nobody' &&
      (accuracyMeters == null || accuracyMeters <= 100) &&
      !!user &&
      (user.isVerified || now - user.createdAt.getTime() >= CROWD.MIN_ACCOUNT_AGE_D * 86_400_000);
    const crowd = crowdOk
      ? {
          member: crowdMember(this.salt, userId),
          day: localDateBrazil(),
          sub: cellOf(latitude, longitude, CROWD_CELL_PRECISION + 1).slice(-1),
          band: dwellBand(localHourBrazil()),
          dwellMs: CROWD.DWELL_MS,
          ttlS: CROWD.KEY_TTL_S,
        }
      : null;

    // histórico GROSSEIRO (3 casas ≈ 110 m): serve pro contexto do match/lugares em comum, nunca pra rastrear.
    // Parado no mesmo ponto (mesma grade, lugar e anonimato), reaproveita a linha anterior por até HISTORY_REUSE_S.
    const row = {
      latitude: coarse(latitude),
      longitude: coarse(longitude),
      geohash,
      poiId: poi ? poi.id : null,
      city: city ?? null,
      state: state ?? null,
      isAnonymous: isAnonymous || hidden,
    };
    const signature = historySignature(row);
    const [prevSignature, touchActive] = await Promise.all([
      this.redis.client.get(`loc:hist:${userId}`),
      // "último acesso" no máximo a cada LAST_ACTIVE_EVERY_S
      this.redis.client.set(`la:gate:${userId}`, '1', 'EX', LAST_ACTIVE_EVERY_S, 'NX'),
    ]);

    // histórico e "último acesso" vão pra fila no Redis; o LocationWritesFlusher grava em lote (ver location-writes.ts)
    const writes: Promise<unknown>[] = [];
    if (prevSignature !== signature) {
      const hist: QueuedHistory = {
        u: userId,
        la: row.latitude,
        lo: row.longitude,
        g: geohash,
        a: accuracyForDb(accuracyMeters),
        p: poi ? poi.id : null,
        c: city ?? null,
        s: state ?? null,
        x: expiresAt.getTime(),
        an: row.isAnonymous,
        t: now,
      };
      writes.push(
        this.redis.client
          .multi()
          .rpush(HISTORY_QUEUE, JSON.stringify(hist))
          .ltrim(HISTORY_QUEUE, -HISTORY_QUEUE_MAX, -1)
          .set(`loc:hist:${userId}`, signature, 'EX', HISTORY_REUSE_S)
          .exec(),
      );
    }
    if (touchActive === 'OK') writes.push(this.redis.client.hset(LAST_ACTIVE_PENDING, userId, String(now)));
    let presenceWrite: Promise<{ wasHidden: boolean }> | null = null;
    if (visible) {
      writes.push(
        (presenceWrite = this.redis.setUserPresence(
          userId,
          geohash,
          latitude,
          longitude,
          PRIVACY.PRESENCE_TTL_S,
          poi ? { id: String(poi.id), name: poi.name } : null,
          hidden,
          cell,
          ngeohash.neighbors(cell),
          crowd,
        )),
      );
    }
    await Promise.all(writes);
    // acabou de entrar numa área privada/casa: todo processo esquece a posição dela NA HORA (as presenças ficam alguns
    // segundos em cache na descoberta); só na transição, não a cada atualização de quem já está em casa
    if (hidden && presenceWrite && !(await presenceWrite).wasHidden) await this.redis.publishCandidateInvalidation(`hide:${userId}:${now}`);

    // só CONTA (ZCOUNT por célula): antes trazia os ids das 9 células inteiras a cada atualização
    const nearbyUsers = await this.redis.countNearbyPresence([geohash, ...ngeohash.neighbors(geohash)], userId, now - PRIVACY.PRESENCE_TTL_S * 1000);
    const nearbyPois = idx.countByCity(city);

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
        // quantas casas aprendidas caem nesta célula (só a contagem, sem ids): o detector de lugares usa pra descartar
        // células residenciais — uma rua cheia de casas não vira "lugar"
        if ((await this.redis.client.sadd(`home:cells:${userId}`, cell)) === 1) {
          await this.redis.client.incr(`home:cnt:${cell}`);
          await this.redis.client.expire(`home:cnt:${cell}`, 45 * 86_400);
        }
        await this.redis.client.expire(`home:cells:${userId}`, PRIVACY.HOME_LEARN_DAYS * 86_400);
      }
    }
    const homeCells = await this.redis.client.smembers(`home:cells:${userId}`);
    return matchesHomeCells(homeCells, cellWithNeighbors(cell));
  }

  /** índice em memória dos lugares públicos (nome, coordenada, cidade) — recarrega a cada POI_INDEX_TTL_MS */
  private poiIndex(): Promise<PoiIndex> {
    return this.poiIndexMemo.get('all', async () => {
      // lugar oculto pela equipe não prende ninguém: some da presença, do "quem está aqui" e das contagens
      const rows = await this.prisma.pOI.findMany({ where: { hiddenAt: null }, select: { id: true, name: true, latitude: true, longitude: true, city: true } });
      return new PoiIndex(rows.map((p) => ({ id: Number(p.id), name: p.name, lat: Number(p.latitude), lng: Number(p.longitude), city: p.city ?? null })));
    });
  }

  /** um lugar novo (ex.: descoberto pelos usuários) passa a valer na próxima atualização, sem esperar o minuto */
  invalidatePoiIndex(): void {
    this.poiIndexMemo.invalidate('all');
    // lugar entrou/saiu do mapa (evento publicado/cancelado, lugar aprovado/oculto): os apps abertos buscam de novo
    // na hora, sem esperar o refetch de 45 s. Coalescido em 2 s; o app espalha a busca com um atraso aleatório
    if (!this.chat || this.poisChangedTimer) return;
    this.poisChangedTimer = setTimeout(() => {
      this.poisChangedTimer = null;
      this.chat?.broadcast('pois:changed', { at: Date.now() });
    }, 2_000);
  }

  /**
   * Presenças vivas de uma célula de presença. A célula guarda quem ATUALIZOU nela; a posição de cada um vem do hash
   * user:loc (pode já ter saído da célula — não importa: a triagem usa a distância real). Carga única por célula.
   */
  private presencesInCell(cell: string): Promise<Map<string, Presence>> {
    return this.cellPresence.get(cell, async () => {
      // incremental: 1 ZRANGE com os horários; só quem mudou desde a última carga volta a ser lido (antes: um HGETALL
      // por pessoa da célula a cada 2 s em cada processo — numa multidão, dezenas de milhares de comandos por segundo)
      const raw = await this.redis.client.zrange(`presence:${cell}`, 0, -1, 'WITHSCORES');
      const prev = this.cellState.get(cell);
      const plan = planCellReload(raw, prev, Date.now() - PRIVACY.PRESENCE_TTL_S * 1000);
      const out = plan.keep;
      // em lotes: pipelines gigantes seguram o Redis (single-thread) pra todo mundo
      for (const part of chunk(plan.fetch, 2_000)) {
        const m = await this.getPresences(part);
        for (const [id, p] of m) out.set(id, p);
      }
      this.cellState.set(cell, { at: Date.now(), scores: plan.scores, pres: out });
      if (this.cellState.size > CELL_STATE_MAX) this.pruneCellState();
      return out;
    });
  }

  /** esquece células que ninguém consultou no último minuto (a próxima carga delas é completa) */
  private pruneCellState(): void {
    const cutoff = Date.now() - 60_000;
    for (const [cell, st] of this.cellState) if (st.at < cutoff) this.cellState.delete(cell);
  }

  /** Lê as presenças (hash user:loc:<id>) de vários usuários; os lugares vêm do índice em memória. */
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

    const idx = raw.size > 0 ? await this.poiIndex() : null;
    raw.forEach((m, id) => {
      const p = idx && m.poi_id && /^\d+$/.test(m.poi_id) ? idx.byId(Number(m.poi_id)) : undefined;
      out.set(id, {
        lat: Number(m.lat),
        lng: Number(m.lng),
        updatedAt: m.updated_at ? Number(m.updated_at) : null,
        poi: p ? { id: p.id, name: p.name, lat: p.lat, lng: p.lng } : null,
        hidden: m.hidden === '1',
      });
    });
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // Descoberta por proximidade — centro = MINHA posição no servidor (o cliente não escolhe o centro)
  // ---------------------------------------------------------------------------------------------
  async discover(requesterId: string, requestedRadiusM?: number): Promise<DiscoveryResult> {
    try {
      return await this.discoverSlots.run(() => this.discoverNow(requesterId, requestedRadiusM));
    } catch (e) {
      if (e instanceof SaturatedError) {
        this.log.warn(`descoberta saturada (${e.reason}): ${this.discoverSlots.inUse} rodando, ${this.discoverSlots.waiting} na fila`);
        throw new ServiceUnavailableException({ error: 'busy', message: 'Muita gente procurando agora. Tenta de novo em instantes.' });
      }
      throw e;
    }
  }

  private async discoverNow(requesterId: string, requestedRadiusM?: number): Promise<DiscoveryResult> {
    const radiusM = Math.min(PRIVACY.DISCOVERY_RADIUS_M, Math.max(50, requestedRadiusM ?? PRIVACY.DISCOVERY_RADIUS_M));
    let placePrompt: PlacePrompt | null = null;
    let invisible: InvisiblePresence | null = null;
    const empty = (reason: HiddenReason | null): DiscoveryResult => ({
      users: [],
      hiddenCount: 0,
      radiusM,
      me: { discoverable: reason === null, hiddenReason: reason, placePrompt },
      invisible,
    });

    const me = await this.loadParty(requesterId);
    if (!me) return empty('paused');
    if (me.premium) invisible = { total: 0, groups: [] };
    const presences = await this.getPresences([requesterId]);
    const mine = presences.get(requesterId);
    if (!mine) return empty('no_presence');
    const myReason = this.selfHiddenReason(me, mine);
    // "Ninguém": não aparece e não vê (reciprocidade)
    if (me.discoveryMode === 'nobody') return empty('nobody');
    // convite pra confirmar um lugar: só quem está visível (não oculto/anônimo/pausado) e parado perto do candidato
    if (myReason === null) placePrompt = await this.placePromptFor(requesterId, mine).catch(() => null);

    // candidatos: células geohash-6 em volta da MINHA posição real — presenças por célula, reaproveitadas por 2 s
    // entre as descobertas deste processo (numa multidão, cada /nearby relia milhares de posições do Redis)
    const centerHash = encodeGeohash(mine.lat, mine.lng, GEOHASH_PRECISION);
    const region = await this.regionPresence.get(centerHash, async () => {
      const cells = await Promise.all([centerHash, ...ngeohash.neighbors(centerHash)].map((c) => this.presencesInCell(c)));
      const all = new Map<string, Presence>();
      for (const cell of cells) for (const [id, p] of cell) all.set(id, p);
      return all;
    });
    // o mapa da região é compartilhado: em vez de copiar sem mim, só pulo meu id nos laços abaixo
    const pres = region;
    if (pres.size === 0 || (pres.size === 1 && pres.has(requesterId))) return empty(myReason);

    // triagem ANTES de carregar perfis: só quem está no raio e quem entra nas contagens de anonimato que o raio vai
    // ler (mesmo resultado de contar a região inteira, sem carregar milhares)
    this.hiddenNow.prune();
    const hiddenNow =
      this.hiddenNow.size > 0
        ? (id: string, p: Presence) => {
            const at = this.hiddenNow.get(id);
            return at !== undefined && (p.updatedAt ?? 0) <= at;
          }
        : undefined;
    const triage = triageForDiscovery({ lat: mine.lat, lng: mine.lng }, radiusM, pres, (p) => this.areaOf(p as Presence), requesterId, hiddenNow as ((id: string, p: unknown) => boolean) | undefined);
    if (triage.inRadius.size === 0) return empty(myReason);

    const blocked = await this.blockedWith(requesterId);
    const rows = await this.loadCandidates(triage.needed.filter((id) => !blocked.has(id)));

    // 0) invisíveis (só Premium): agrupados por lugar/quadra, sem identidade — ver location/invisible.ts
    if (me.premium) invisible = await this.invisibleNearby(me, mine, triage, pres, rows, blocked);

    // 1) elegibilidade (visível, com presença, não oculto, regras de descoberta dos DOIS lados) + raio REAL
    const eligible: { u: CandidateRow; p: Presence; dist: number }[] = [];
    for (const u of rows) {
      const dist = triage.inRadius.get(u.id);
      const p = pres.get(u.id);
      if (dist == null || !p || !this.mutuallyDiscoverable(me, this.partyOfCached(u), p)) continue;
      eligible.push({ u, p, dist });
    }
    if (eligible.length === 0) return empty(myReason);

    // 2) anonimato: contagem de pessoas visíveis por área (geohash-6) e por lugar — sobre TODO mundo visível da região,
    //    não só quem eu posso ver (quanto mais gente na conta, mais conservador é o "esconder")
    const areaCount = new Map<string, number>();
    const placeCount = new Map<number, number>();
    for (const u of rows) {
      const p = pres.get(u.id);
      if (!p || p.hidden || u.visibilityMode !== 'visible' || u.isPaused || u.deletedAt || u.discoveryMode === 'nobody') continue;
      const area = triage.areaOf.get(u.id) ?? this.areaOf(p);
      areaCount.set(area, (areaCount.get(area) ?? 0) + 1);
      if (p.poi) placeCount.set(p.poi.id, (placeCount.get(p.poi.id) ?? 0) + 1);
    }

    const day = new Date().toISOString().slice(0, 10);
    const shown: { u: CandidateRow; p: Presence; pos: { lat: number; lng: number }; type: PresenceType; band: ProximityBand; poi: PresencePoi | null }[] = [];
    let hiddenCount = 0;
    for (const { u, p } of eligible) {
      const atPlace = p.poi && (placeCount.get(p.poi.id) ?? 0) >= PRIVACY.MIN_PLACE_K ? p.poi : null;
      if (atPlace) {
        const pos = this.visualPosition(p, u.id, day, 'place', atPlace);
        shown.push({ u, p, pos, type: 'place', band: proximityBand(distanceMeters(mine.lat, mine.lng, pos.lat, pos.lng)), poi: atPlace });
        continue;
      }
      const area = triage.areaOf.get(u.id) ?? this.areaOf(p);
      if ((areaCount.get(area) ?? 0) < PRIVACY.MIN_AREA_K) {
        hiddenCount += 1; // região esparsa: existe alguém por perto, mas sem identidade nem marcador
        continue;
      }
      const pos = this.visualPosition(p, u.id, day, 'cell', this.vcellOf(p));
      // a faixa é calculada da posição VISUAL (não da real): consultar de vários pontos só reconstrói a célula
      shown.push({ u, p, pos, type: 'nearby', band: proximityBand(distanceMeters(mine.lat, mine.lng, pos.lat, pos.lng)), poi: null });
    }

    // 3) teto de pessoas por resposta: as N mais perto (faixa) e depois por nome — seleção parcial, sem ordenar milhares
    //    (antes: dois sorts com localeCompare sobre a multidão inteira); quem sobra entra no "+N por perto"
    const bandRank: Record<ProximityBand, number> = { very_near: 0, near: 1, region: 2 };
    const keyed = shown.map((s) => ({ s, r: bandRank[s.band], n: s.u.name.toLowerCase() }));
    const { top, rest } = selectTop(keyed, PRIVACY.DISCOVERY_MAX_USERS, (a, b) => a.r - b.r || (a.n < b.n ? -1 : a.n > b.n ? 1 : 0));
    hiddenCount += rest;
    const chosen = top.map((k) => k.s);

    // 4) enriquecimento social (boost, curtida nos dois sentidos, conversa do par) — uma consulta com os mostrados num
    //    parâmetro de array só (antes: IN do Prisma com os 300 mostrados, a maior parte da CPU ia pro motor montando listas)
    const now = new Date();
    const [boosted, social] = chosen.length
      ? await Promise.all([this.activeBoosts(), loadPeerSocial(this.prisma, requesterId, chosen.map((c) => c.u.id))])
      : [new Set<string>(), new Map<string, PeerSocialRow>()];
    const newSince = now.getTime() - NEW_USER_MS;

    const users: DiscoveryUserDto[] = chosen
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
        likedByMe: social.get(u.id)?.likedByMe ?? false,
        likeStatus: social.get(u.id)?.likeStatus ?? 'NONE',
        conversation: social.get(u.id)?.conversation ?? null,
      }));

    return { users, hiddenCount, radiusM, me: { discoverable: myReason === null, hiddenReason: myReason, placePrompt }, invisible };
  }

  /**
   * A pessoa `targetId` pode ser descoberta por `requesterId` AGORA (mesmas regras do /nearby)?
   * Usado pelo cartão público, acenos e "quem está no lugar". Devolve faixa e lugar — nunca distância/posição.
   */
  async discoverability(requesterId: string, targetId: string): Promise<{ ok: boolean; band: ProximityBand | null; poi: { id: number; name: string } | null }> {
    const none = { ok: false, band: null, poi: null };
    if (requesterId === targetId) return none;
    const [me, blocked] = await Promise.all([this.loadParty(requesterId), this.blockedWith(requesterId)]);
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
    const poi = (await this.poiIndex()).byId(poiId);
    const pres = await this.getPresences([requesterId, ...candidateIds]);
    const mine = pres.get(requesterId);
    if (!poi || !mine || distanceMeters(mine.lat, mine.lng, poi.lat, poi.lng) > PRIVACY.DISCOVERY_RADIUS_M) return [];
    const blocked = await this.blockedWith(requesterId);
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

  /**
   * "✨ Tá rolando algo aqui?": até 3 lugares candidatos a <= 150 m de quem está parado há CROWD.DWELL_MS na mesma
   * célula, com conta antiga (ou verificada), que ainda não votou neles — no máximo 1 vez a cada 6 h por pessoa.
   * O caminho comum (nenhum candidato perto) não toca no Redis nem no banco.
   */
  private async placePromptFor(userId: string, mine: Presence): Promise<PlacePrompt | null> {
    if (CROWD.MODE === 'off') return null;
    const byCell = await this.promptMemo.get('all', () => this.loadPromptOptions());
    if (byCell.size === 0) return null;
    const myCell = cellOf(mine.lat, mine.lng, CROWD_CELL_PRECISION);
    const near: PromptOption[] = [];
    for (const c of [myCell, ...ngeohash.neighbors(myCell)]) {
      for (const o of byCell.get(c) ?? []) if (distanceMeters(mine.lat, mine.lng, o.lat, o.lng) <= PROMPT_M) near.push(o);
    }
    if (near.length === 0) return null;
    const since = Number(await this.redis.client.hget(`user:loc:${userId}`, 'cell_since'));
    if (!since || Date.now() - since < CROWD.DWELL_MS) return null;
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true, isVerified: true } });
    if (!u || (!u.isVerified && Date.now() - u.createdAt.getTime() < CROWD.MIN_ACCOUNT_AGE_D * 86_400_000)) return null;
    const voted = await this.prisma.$queryRaw<{ id: bigint }[]>`
      SELECT candidate_id AS id FROM place_votes WHERE user_id = ${userId}::uuid AND candidate_id = ANY(${near.map((o) => BigInt(o.id))}::bigint[])`;
    const seen = new Set(voted.map((v) => String(v.id)));
    const options = near.filter((o) => !seen.has(o.id)).sort((a, b) => (a.name < b.name ? -1 : 1)).slice(0, 3);
    if (options.length === 0) return null;
    if ((await this.redis.client.set(`prompt:cool:${userId}`, '1', 'EX', 6 * 3600, 'NX')) !== 'OK') return null;
    return { options: options.map((o) => ({ candidateId: o.id, name: o.name, kind: o.kind })) };
  }

  /** candidatos pendentes que valem convite: multidão dividida entre dois lugares, ou pedidos da galera em 14 dias */
  private async loadPromptOptions(): Promise<Map<string, PromptOption[]>> {
    const rows = await this.prisma.$queryRaw<{ id: bigint; cell: string; name: string; kind: string; latitude: unknown; longitude: unknown }[]>`
      SELECT c.id, c.cell, c.name, c.kind, c.latitude, c.longitude FROM place_candidates c
       WHERE c.status = 'pending' AND (c.ambiguous OR EXISTS (
         SELECT 1 FROM place_votes v WHERE v.candidate_id = c.id AND v.kind = 'request' AND v.voted_on >= current_date - 13))`;
    const out = new Map<string, PromptOption[]>();
    for (const r of rows) {
      const list = out.get(r.cell) ?? [];
      list.push({ id: String(r.id), name: r.name, kind: r.kind as PlaceKind, lat: Number(r.latitude), lng: Number(r.longitude) });
      out.set(r.cell, list);
    }
    return out;
  }

  /** A e B se descobrem só se as regras dos DOIS permitirem (reciprocidade). */
  private mutuallyDiscoverable(a: Party, b: Party, bPresence: Presence): boolean {
    if (b.visibilityMode !== 'visible' || b.isPaused || b.deletedAt) return false;
    if (bPresence.hidden) return false;
    return this.discoveryRulesAllow(a, b);
  }

  /** só as regras de descoberta dos DOIS ("Ninguém", "Interesses compatíveis"), sem olhar visibilidade */
  private discoveryRulesAllow(a: Pick<Party, 'discoveryMode' | 'interests'>, b: Pick<Party, 'discoveryMode' | 'interests'>): boolean {
    if (a.discoveryMode === 'nobody' || b.discoveryMode === 'nobody') return false;
    if (a.discoveryMode !== 'compatible' && b.discoveryMode !== 'compatible') return true;
    // interesse em comum (sem criar array por candidato: numa multidão isso roda milhares de vezes por consulta)
    const small = a.interests.size <= b.interests.size ? a.interests : b.interests;
    const big = small === a.interests ? b.interests : a.interests;
    for (const i of small) if (big.has(i)) return true;
    return false;
  }

  /**
   * Invisíveis no raio pra quem é Premium: consulta leve (modo de descoberta e interesses — a mesma reciprocidade dos
   * visíveis; nada de perfil, nome ou foto) e agrupamento por lugar/quadra. Área privada/residência, pausa, conta fora
   * do ar, análise e Block (qualquer sentido) ficam de fora.
   */
  private async invisibleNearby(
    me: Party,
    mine: Presence,
    triage: { inRadius: Map<string, number>; areaOf: Map<string, string> },
    pres: Map<string, Presence>,
    rows: CandidateRow[],
    blocked: Set<string>,
  ): Promise<InvisiblePresence> {
    const loaded = new Set(rows.map((r) => r.id));
    const ids = [...triage.inRadius.keys()].filter((id) => !loaded.has(id) && !blocked.has(id));
    const visibleByArea = new Map<string, number>();
    const visibleByPlace = new Map<number, number>();
    for (const u of rows) {
      const p = pres.get(u.id);
      if (!p || p.hidden || u.discoveryMode === 'nobody') continue;
      const area = triage.areaOf.get(u.id) ?? this.areaOf(p);
      visibleByArea.set(area, (visibleByArea.get(area) ?? 0) + 1);
      if (p.poi) visibleByPlace.set(p.poi.id, (visibleByPlace.get(p.poi.id) ?? 0) + 1);
    }
    const band = (pos: { lat: number; lng: number }) => proximityBand(distanceMeters(mine.lat, mine.lng, pos.lat, pos.lng));
    if (ids.length === 0) return groupInvisible([], { visibleByArea, visibleByPlace }, band);

    const found: { id: string; discoveryMode: DiscoveryMode; interests: number[] | null }[] = [];
    for (const part of chunk(ids, ID_CHUNK)) {
      found.push(
        ...(await this.prisma.$queryRaw<{ id: string; discoveryMode: DiscoveryMode; interests: number[] | null }[]>`
          SELECT u.id::text AS id, u.discovery_mode::text AS "discoveryMode",
                 (SELECT array_agg(ui.interest_id) FROM user_interests ui WHERE ui.user_id = u.id) AS interests
            FROM users u
           WHERE u.id = ANY(${part}::uuid[]) AND u.visibility_mode = 'anonymous' AND u.deleted_at IS NULL
             AND u.is_paused = false AND u.account_status = 'active' AND u.review_hold_at IS NULL`),
      );
    }
    const items: InvisibleItem[] = [];
    for (const r of found) {
      const p = pres.get(r.id);
      if (!p || p.hidden) continue;
      if (!this.discoveryRulesAllow(me, { discoveryMode: r.discoveryMode, interests: new Set(r.interests ?? []) })) continue;
      items.push({ area: triage.areaOf.get(r.id) ?? this.areaOf(p), vcell: this.vcellOf(p), poi: p.poi });
    }
    return groupInvisible(items, { visibleByArea, visibleByPlace }, band);
  }

  private activeBoosts(): Promise<Set<string>> {
    return this.boostMemo.get('all', async () => {
      const rows = await this.prisma.boost.findMany({ where: { expiresAt: { gt: new Date() } }, select: { userId: true } });
      return new Set(rows.map((r) => r.userId));
    });
  }

  private partyOfCached(u: CandidateRow): Party {
    let p = this.partyCache.get(u);
    if (!p) {
      p = this.partyOf(u);
      this.partyCache.set(u, p);
    }
    return p;
  }

  private areaOf(p: Presence): string {
    return (p.area ??= cellOf(p.lat, p.lng, PRIVACY.AREA_PRECISION));
  }

  private vcellOf(p: Presence): string {
    return (p.vcell ??= cellOf(p.lat, p.lng));
  }

  /**
   * Posição VISUAL de alguém (centro da célula ou ponto do lugar + deslocamento do dia). É determinística por
   * pessoa + célula/lugar + dia, então fica guardada até a virada do dia (ou até o cache passar de 200 mil).
   */
  private visualPosition(p: Presence, userId: string, day: string, kind: 'cell', where: string): { lat: number; lng: number };
  private visualPosition(p: Presence, userId: string, day: string, kind: 'place', where: PresencePoi): { lat: number; lng: number };
  private visualPosition(p: Presence, userId: string, day: string, kind: 'cell' | 'place', where: string | PresencePoi): { lat: number; lng: number } {
    // guardada na própria presença (que vive 2 s no cache da célula e é compartilhada por todas as consultas da região)
    const key = kind === 'cell' ? `c${where as string}|${day}` : `p${(where as PresencePoi).id}|${day}`;
    if (p.vposKey === key && p.vpos) return p.vpos;
    const seed = `${this.salt}:${day}:${userId}`;
    const pos = kind === 'cell' ? anonymizedCellPosition(seed, where as string) : anonymizedPlacePosition(seed, where as PresencePoi);
    p.vposKey = key;
    p.vpos = pos;
    return pos;
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
      select: { id: true, discoveryMode: true, visibilityMode: true, isPaused: true, deletedAt: true, premiumTier: true, premiumExpiresAt: true, userInterests: { select: { interestId: true } } },
    });
    if (!u || u.deletedAt) return null;
    return {
      id: u.id,
      discoveryMode: u.discoveryMode as DiscoveryMode,
      interests: new Set(u.userInterests.map((i) => i.interestId)),
      visibilityMode: u.visibilityMode,
      isPaused: u.isPaused,
      deletedAt: u.deletedAt,
      premium: effectiveTier(u.premiumTier, u.premiumExpiresAt) !== 'free',
    };
  }

  private async loadCandidates(ids: string[]): Promise<CandidateRow[]> {
    if (ids.length === 0) return [];
    // dados de perfil mudam pouco: reaproveita por alguns segundos (mudanças de visibilidade aparecem em até DISCOVERY_CANDIDATE_TTL_MS)
    const now = Date.now();
    this.candidateCache.prune(now, 2_000); // poda incremental: nunca varre o cache inteiro numa requisição
    const fresh: CandidateRow[] = [];
    const missing: string[] = [];
    for (const id of ids) {
      const c = this.candidateCache.get(id, now);
      if (c === undefined) missing.push(id);
      else if (c) fresh.push(c);
    }
    if (missing.length === 0) return fresh;
    // 1) flags de privacidade de quem faltou (consulta leve, só colunas) — em lotes: IN com dezenas de milhares de ids
    //    estoura o limite de parâmetros do Postgres
    const flags: CandidateFlags[] = [];
    for (const part of chunk(missing, ID_CHUNK)) flags.push(...(await this.loadFlagsFromDb(part)));
    // 2) perfil pesado só de quem está elegível e não tem perfil em cache
    this.profileCache.prune(now, 2_000);
    const needProfile = flags.filter((f) => this.profileCache.get(f.id, now) === undefined).map((f) => f.id);
    for (const part of chunk(needProfile, ID_CHUNK)) {
      const rows = await this.loadProfilesFromDb(part);
      const got = new Set<string>();
      for (const r of rows) {
        this.profileCache.set(r.id, r, now);
        got.add(r.id);
      }
      for (const id of part) if (!got.has(id)) this.profileCache.set(id, null, now);
    }
    const loaded: CandidateRow[] = [];
    for (const f of flags) {
      const p = this.profileCache.get(f.id, now);
      if (p) loaded.push({ ...p, ...f });
    }
    const found = new Set(loaded.map((r) => r.id));
    for (const r of loaded) this.candidateCache.set(r.id, r, now);
    // quem não voltou (pausado, anônimo, excluído) também fica em cache como "ausente"
    for (const id of missing) if (!found.has(id)) this.candidateCache.set(id, null, now);
    return fresh.concat(loaded);
  }

  /**
   * só quem pode aparecer: visível, não pausado, não excluído, não suspenso/banido nem fora da descoberta pela
   * moderação (review_hold_at). Um parâmetro só (= ANY(array)): o IN do Prisma mandava
   * milhares de parâmetros por consulta e o Postgres gastava mais planejando do que lendo.
   */
  private async loadFlagsFromDb(ids: string[]): Promise<CandidateFlags[]> {
    return this.prisma.$queryRaw<CandidateFlags[]>`
      SELECT id::text AS id, visibility_mode::text AS "visibilityMode", is_paused AS "isPaused", deleted_at AS "deletedAt",
             discovery_mode::text AS "discoveryMode", show_age AS "showAge", show_photo_on_map AS "showPhotoOnMap"
        FROM users
       WHERE id = ANY(${ids}::uuid[]) AND deleted_at IS NULL AND is_paused = false AND visibility_mode = 'visible'
         AND account_status = 'active' AND review_hold_at IS NULL`;
  }

  private async loadProfilesFromDb(ids: string[]): Promise<CandidateProfile[]> {
    const rows = await this.prisma.$queryRaw<
      { id: string; name: string; gender: string | null; birthDate: Date; createdAt: Date; premiumTier: string; isVerified: boolean; avatarConfig: unknown; photo: { url: string; thumbnailUrl: string | null } | null; interests: number[] | null }[]
    >`
      SELECT u.id::text AS id, u.name, u.gender::text AS gender, u.birth_date AS "birthDate", u.created_at AS "createdAt",
             u.premium_tier::text AS "premiumTier", u.is_verified AS "isVerified", u.avatar_config AS "avatarConfig",
             (SELECT json_build_object('url', p.url, 'thumbnailUrl', p.thumbnail_url) FROM photos p
               WHERE p.user_id = u.id AND p.status = 'approved' ORDER BY p.is_main DESC, p.order_index LIMIT 1) AS photo,
             (SELECT array_agg(ui.interest_id::int) FROM user_interests ui WHERE ui.user_id = u.id) AS interests
        FROM users u
       WHERE u.id = ANY(${ids}::uuid[]) AND u.deleted_at IS NULL`;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      gender: r.gender,
      birthDate: r.birthDate,
      createdAt: r.createdAt,
      premiumTier: r.premiumTier,
      isVerified: r.isVerified,
      avatarConfig: r.avatarConfig,
      photos: r.photo ? [r.photo] : [],
      userInterests: (r.interests ?? []).map((interestId) => ({ interestId })),
    }));
  }

  /**
   * Todo mundo com quem `me` tem bloqueio, em qualquer direção. Consulta só pelos MEUS bloqueios (poucos, indexados)
   * e filtra em memória — antes mandava a lista de candidatos inteira num IN (quebrava acima de ~16 mil ids).
   */
  private async blockedWith(me: string): Promise<Set<string>> {
    const blocks = await this.prisma.block.findMany({
      where: { OR: [{ blockerId: me }, { blockedId: me }] },
      select: { blockedId: true, blockerId: true },
    });
    const out = new Set<string>();
    for (const b of blocks) out.add(b.blockerId === me ? b.blockedId : b.blockerId);
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
  private poiWithin(idx: PoiIndex, poiId: number, lat: number, lng: number): { id: number; name: string } | null {
    const p = idx.byId(poiId);
    if (!p) return null;
    return distanceMeters(lat, lng, p.lat, p.lng) <= POI_CLAIM_M ? { id: p.id, name: p.name } : null;
  }

  // POI mais próximo a <= 40 m (quadrado de 60 m no índice, distância exata)
  private nearestPoi(idx: PoiIndex, lat: number, lng: number): { id: number; name: string } | null {
    const p = idx.nearest(lat, lng, POI_SEARCH_M, POI_SNAP_M);
    return p ? { id: p.id, name: p.name } : null;
  }

  private age(birth: Date): number {
    const today = new Date();
    let a = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) a -= 1;
    return a;
  }
}
