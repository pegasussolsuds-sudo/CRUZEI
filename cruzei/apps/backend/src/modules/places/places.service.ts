import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CatalogPlace, PlaceCategoryKey, PlaceKind, PlaceSearchResponse } from '@cruzei/shared-types';
import { decodeGeohash, decodeGeohashBounds } from '@cruzei/shared-utils';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import {
  CHIP_KINDS,
  haversineMeters,
  intentOf,
  keepForText,
  nameScore,
  rankByDistance,
  rankPlaces,
  spellingVariants,
  toHit,
  type CatalogRow,
  type Hit,
} from './places.ranking';

/** o catálogo muda 1x por mês (Overture) / semana (OSM): 1 h de cache por texto + região segura a rajada de digitação */
const CACHE_TTL_SECONDS = 3600;
/** busca sem resultado fica menos tempo (o catálogo pode ter acabado de ser reimportado) */
const EMPTY_TTL_SECONDS = 10 * 60;
/** cidade + região metropolitana */
const LOCAL_RADIUS_M = 40_000;
const CACHE_VERSION = 'cat1';
/** quantos lugares a busca por texto traz do banco antes do ranking fino */
const TEXT_POOL = 60;
/** folga em volta da célula geohash-7 na procura de lugares (lugar na borda da célula) */
const CELL_MARGIN_M = 60;

export interface PlacesSearchArgs {
  q: string;
  category: PlaceCategoryKey | null;
  /** centro do mapa (proximity=map) ou minha posição (proximity=me) */
  center: { lat: number; lng: number } | null;
  proximityMode: 'map' | 'me';
  limit: number;
}

type LatLng = { lat: number; lng: number };

/** filtro de uma consulta ao catálogo (sempre só os canônicos que estão na busca) */
interface Find {
  /** texto (e grafias alternativas): casa por trigrama com o nome normalizado */
  terms?: string[];
  kinds?: PlaceKind[] | null;
  /** fora os lugares "outro" (loja, serviço, clínica) */
  noOther?: boolean;
  center: LatLng | null;
  /** null = catálogo inteiro */
  radiusM: number | null;
  order: 'similarity' | 'nearest';
  limit: number;
}

/** colunas que a busca lê do place_catalog (ver CatalogRow) */
const COLS = Prisma.sql`
  c.id, c.name, c.kind, c.chip, c.confidence, ST_Y(c.geog::geometry) AS lat, ST_X(c.geog::geometry) AS lng,
  c.address, c.neighborhood, c.city, c.state, c.alt_names,
  (c.source = 'osm' OR EXISTS (SELECT 1 FROM unnest(c.alt_ids) a WHERE a LIKE 'osm:%')) AS osm_confirmed`;

/** ~1 km: a mesma célula reaproveita o cache (a distância final é recalculada do ponto exato) */
function toCell(c: LatLng): LatLng {
  return { lat: Math.round(c.lat * 100) / 100, lng: Math.round(c.lng * 100) / 100 };
}

/**
 * Busca de lugares da cidade no catálogo próprio (place_catalog: Overture Places + OSM, importado por scripts/geo).
 * Nada sai do servidor: sem API externa, sem cota, sem teto diário. Texto casa por trigrama (f_norm + pg_trgm, com
 * índice GIN) e o ranking fino (nome, tipo, confiança, distância) fica em places.ranking.ts.
 */
@Injectable()
export class PlacesService {
  private readonly log = new Logger(PlacesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async search(args: PlacesSearchArgs): Promise<PlaceSearchResponse> {
    const q = args.q.trim();
    const cell = args.center ? toCell(args.center) : null;
    const key = `places:${CACHE_VERSION}:${q.toLowerCase()}|${cell ? `${cell.lat},${cell.lng}` : 'br'}|${args.category ?? ''}|${args.limit}`;

    let places = await this.cached(key);
    if (!places) {
      places = await this.findPlaces(q, args.category, cell, args.limit);
      await this.store(key, places);
    }
    // distância recalculada do ponto exato (o cache guarda a da célula)
    const center = args.center;
    const out = places.map((p) => (center ? { ...p, distanceM: haversineMeters(center.lat, center.lng, p.latitude, p.longitude) } : p));
    return { places: out, q, generatedAt: new Date().toISOString() };
  }

  /**
   * Lugar do catálogo pelo id (`ovt:…` / `osm:…`), resolvendo duplicado pro canônico; null se não existe ou saiu
   * da busca (buffet, sumiu da fonte). Nome e ponto vêm sempre daqui, nunca do cliente.
   */
  async lookup(id: string): Promise<CatalogPlace | null> {
    const rows = await this.prisma.$queryRaw<CatalogRow[]>`
      SELECT ${COLS} FROM place_catalog c
       WHERE c.dup_of IS NULL AND c.searchable
         AND (c.id = ${id} OR c.alt_ids @> ARRAY[${id}]::text[] OR c.id = (SELECT d.dup_of FROM place_catalog d WHERE d.id = ${id}))
       LIMIT 1`;
    return rows[0] ? (toHit(rows[0], null)?.place ?? null) : null;
  }

  /**
   * Lugares públicos do catálogo dentro de uma célula geohash-7 (+ folga), pro detector da multidão. Consulta local
   * (ST_DWithin), sem cota. Só tipos conhecidos (nada de "outro"); quem decide o que pode ir pro mapa é o crowd-rules.
   * null = falhou (o detector tenta de novo na próxima rodada).
   */
  async venuesInCell(cell: string): Promise<CatalogPlace[] | null> {
    const b = decodeGeohashBounds(cell);
    const dLat = CELL_MARGIN_M / 111_195;
    const dLng = dLat / Math.cos((((b.latMin + b.latMax) / 2) * Math.PI) / 180);
    const box = { latMin: b.latMin - dLat, latMax: b.latMax + dLat, lngMin: b.lngMin - dLng, lngMax: b.lngMax + dLng };
    const inside = (p: CatalogPlace) => p.latitude >= box.latMin && p.latitude <= box.latMax && p.longitude >= box.lngMin && p.longitude <= box.lngMax;
    const c = decodeGeohash(cell);
    const center = { lat: c.latitude, lng: c.longitude };
    // raio que cobre a caixa inteira (meia diagonal); o que fica fora da caixa sai no filtro
    const radiusM = Math.max(
      haversineMeters(center.lat, center.lng, box.latMax, box.lngMax),
      haversineMeters(center.lat, center.lng, box.latMin, box.lngMin),
    ) + 1;
    try {
      const hits = await this.find({ center, radiusM, noOther: true, order: 'nearest', limit: 200 });
      return hits.map((h) => h.place).filter(inside);
    } catch (err) {
      this.log.warn(`catálogo falhou na célula: ${(err as Error).message}`);
      return null;
    }
  }

  private async findPlaces(q: string, category: PlaceCategoryKey | null, cell: LatLng | null, limit: number): Promise<CatalogPlace[]> {
    const local = { center: cell, radiusM: cell ? LOCAL_RADIUS_M : null };

    // 1) só o chip, sem texto: os lugares daquela categoria mais perto
    if (!q && category) {
      const hits = await this.find({ ...local, kinds: CHIP_KINDS[category], order: 'nearest', limit: limit * 3 });
      return rankByDistance([hits], limit);
    }

    // 2) palavra de rolê ("balada", "bar", "shopping"…): os daquele tipo mais perto, mais os que têm a palavra no nome
    //    e são de um tipo aceito
    const intent = category ? null : intentOf(q);
    if (intent) {
      const [browse, text] = await Promise.all([
        this.find({ ...local, kinds: intent.browse, order: 'nearest', limit: limit * 3 }),
        this.find({ ...local, kinds: intent.kinds, terms: [q], order: 'similarity', limit: 20 }),
      ]);
      const named = text.filter((h) => nameScore(h.place.name, q, null) >= 65);
      return rankByDistance([browse, named], limit);
    }

    // 3) texto: o nome e as grafias alternativas ("live" → "Liv Pub") numa consulta só, na região
    const variants = spellingVariants(q);
    const kinds = category ? CHIP_KINDS[category] : null;
    const hits = await this.find({ ...local, kinds, terms: [q, ...variants], order: 'similarity', limit: TEXT_POOL });
    let merged = rankPlaces([hits.filter((h) => keepForText(h, q))], q, variants, limit);

    // 4) nada na região: o catálogo inteiro (ex.: "Zenaide Bar Campinas" vendo o mapa de Uberlândia).
    //    Só entra o que tem todas as palavras digitadas no nome: no meio da digitação ("aideu") vinha lugar a 600 km.
    if (merged.length === 0 && q.length >= 4 && cell) {
      const wide = await this.find({ center: cell, radiusM: null, kinds, terms: [q], order: 'similarity', limit: limit * 2 });
      merged = rankPlaces([wide.filter((h) => nameScore(h.place.name, q, null) >= 75)], q, variants, limit);
    }
    return merged;
  }

  /** uma consulta parametrizada ao catálogo (nenhum texto do usuário é concatenado no SQL) */
  private async find(f: Find): Promise<Hit[]> {
    const pt = f.center ? Prisma.sql`ST_SetSRID(ST_MakePoint(${f.center.lng}::float8, ${f.center.lat}::float8), 4326)::geography` : null;
    const terms = (f.terms ?? []).filter((t) => t.trim().length > 0);
    const conds: Prisma.Sql[] = [Prisma.sql`c.dup_of IS NULL`, Prisma.sql`c.searchable`];
    // f_norm(texto) <% name_norm = word_similarity >= 0,6, com o índice GIN trigram
    if (terms.length > 0) conds.push(Prisma.sql`(${Prisma.join(terms.map((t) => Prisma.sql`f_norm(${t}) <% c.name_norm`), ' OR ')})`);
    if (f.kinds && f.kinds.length > 0) conds.push(Prisma.sql`c.kind = ANY(${f.kinds}::text[])`);
    if (f.noOther) conds.push(Prisma.sql`c.kind <> 'other'`);
    if (pt && f.radiusM != null) conds.push(Prisma.sql`ST_DWithin(c.geog, ${pt}, ${f.radiusM}::float8)`);
    const sim =
      terms.length > 0 ? Prisma.sql`GREATEST(${Prisma.join(terms.map((t) => Prisma.sql`word_similarity(f_norm(${t}), c.name_norm)`))})` : Prisma.sql`0`;
    const near = pt ? Prisma.sql`c.geog <-> ${pt}` : Prisma.sql`c.id`;
    const order = f.order === 'nearest' ? near : Prisma.sql`(c.kind <> 'other') DESC, ${sim} DESC, ${near}`;
    const rows = await this.prisma.$queryRaw<CatalogRow[]>`
      SELECT ${COLS} FROM place_catalog c
       WHERE ${Prisma.join(conds, ' AND ')}
       ORDER BY ${order}
       LIMIT ${f.limit}`;
    const out: Hit[] = [];
    for (const r of rows) {
      const h = toHit(r, f.center);
      if (h) out.push(h);
    }
    return out;
  }

  private async cached(key: string): Promise<CatalogPlace[] | null> {
    try {
      const raw = await this.redis.client.get(key);
      return raw ? (JSON.parse(raw) as CatalogPlace[]) : null;
    } catch (err) {
      this.log.warn(`cache get falhou: ${(err as Error).message}`);
      return null;
    }
  }

  private async store(key: string, places: CatalogPlace[]): Promise<void> {
    try {
      await this.redis.client.set(key, JSON.stringify(places), 'EX', places.length > 0 ? CACHE_TTL_SECONDS : EMPTY_TTL_SECONDS);
    } catch (err) {
      this.log.warn(`cache set falhou: ${(err as Error).message}`);
    }
  }
}
