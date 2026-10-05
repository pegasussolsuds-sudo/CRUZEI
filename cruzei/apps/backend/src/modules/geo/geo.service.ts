import type { GeoLabelResponse, GeoSearchResponse, GeoSearchResult } from '@cruzei/shared-types';
import { decodeGeohash, encodeGeohash } from '@cruzei/shared-utils';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { isProduction } from '../../config/security';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { normalize } from '../places/places.ranking';

import {
  expandAbbrev,
  labelFromAreas,
  labelFromPhoton,
  parsePhoton,
  rankGeoNames,
  type AreaRow,
  type GeoNameRow,
  type PhotonFeature,
} from './geo.ranking';

/** bairro/cidade mudam pouco: 7 dias por célula; ponto fora das áreas importadas, 1 h */
const LABEL_TTL_SECONDS = 7 * 86_400;
const LABEL_EMPTY_TTL_SECONDS = 3600;
const SEARCH_TTL_SECONDS = 3600;
const SEARCH_EMPTY_TTL_SECONDS = 10 * 60;
/** Photon é opcional e fica ao lado: se demorar, a busca local responde */
const PHOTON_TIMEOUT_MS = 1_500;
/** nomes trazidos do banco antes do ranking fino */
const NAME_POOL = 40;
/** centro da célula no mar ou numa fresta entre municípios (fora de todo polígono): vale o município a até ~1 km */
const NEAR_CITY_DEG = 0.01;
/** "tem catálogo aqui?": lugar ou rua importados a até 15 km do centro da célula (~11 km) */
const COVERAGE_RADIUS_M = 15_000;
const COVERAGE_TTL_SECONDS = 6 * 3600;

type LatLng = { lat: number; lng: number };

/** GET /geo/coverage: false = fora da região com lugares/ruas importados (o app mostra "ainda não temos essa região") */
export interface GeoCoverageResponse {
  covered: boolean;
}

/**
 * "Cidade · Bairro" (geo_areas: bairros do OSM no bbox importado, municípios do IBGE no Brasil inteiro) e "ir até lá"
 * (ruas, bairros e cidades em geo_names; Photon auto-hospedado primeiro quando PHOTON_URL existe). Tudo no nosso
 * servidor: nada vai pro Mapbox nem pro Google.
 */
@Injectable()
export class GeoService implements OnModuleInit {
  private readonly log = new Logger(GeoService.name);
  private readonly photonUrl = (process.env.PHOTON_URL ?? '').trim().replace(/\/+$/, '');

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  onModuleInit(): void {
    if (isProduction() && !this.photonUrl) {
      this.log.warn(
        'PHOTON_URL vazio em produção: rua e bairro só aparecem no bbox importado (fora dele, "ir até lá" e o cabeçalho ficam só com a cidade do IBGE)',
      );
    }
  }

  /**
   * Bairro e cidade de um ponto. Calcula no centro da célula geohash-6 (~1,2 × 0,6 km), a mesma do cache: o
   * resultado é de bairro, não precisa de mais, e a posição fina não entra na chave nem no cálculo. Sem bairro
   * importado (fora do bbox só há o município do IBGE), pergunta o bairro ao Photon (se houver).
   */
  async label(lat: number, lng: number): Promise<GeoLabelResponse> {
    const cell = encodeGeohash(lat, lng, 6);
    // v2: com os municípios do IBGE (a v1 guardou "fora da área" pra quase todo o Brasil)
    const key = `geo:label:v2:${cell}`;
    const hit = await this.getJson<GeoLabelResponse>(key);
    if (hit) return hit;
    const c = decodeGeohash(cell);
    const pt = Prisma.sql`ST_SetSRID(ST_MakePoint(${c.longitude}::float8, ${c.latitude}::float8), 4326)`;
    // mesmo nível: o polígono do OSM (o que tem os bairros) antes do município do IBGE
    let rows = await this.prisma.$queryRaw<AreaRow[]>`
      SELECT kind, name, city, state FROM geo_areas
       WHERE ST_Covers(geom, ${pt})
       ORDER BY admin_level DESC NULLS LAST, (id LIKE 'ibge:%')`;
    if (rows.length === 0) {
      // a malha do IBGE para na costa: centro da célula na praia/no mar fica com o município mais perto
      rows = await this.prisma.$queryRaw<AreaRow[]>`
        SELECT kind, name, city, state FROM geo_areas
         WHERE kind = 'city' AND ST_DWithin(geom, ${pt}, ${NEAR_CITY_DEG}::float8)
         ORDER BY ST_Distance(geom, ${pt}), (id LIKE 'ibge:%')
         LIMIT 1`;
    }
    let out = labelFromAreas(rows);
    let ttl = out.city || out.neighborhood ? LABEL_TTL_SECONDS : LABEL_EMPTY_TTL_SECONDS;
    if (!out.neighborhood && this.photonUrl) {
      const ph = await this.photonLabel(c.latitude, c.longitude);
      // bairro do Photon só se for da mesma cidade (o /reverse pega o mais perto, que pode ser do vizinho)
      if (ph && (!out.city || !ph.city || normalize(ph.city) === normalize(out.city))) {
        out = {
          city: out.city ?? ph.city,
          neighborhood: ph.neighborhood,
          state: out.state ?? ph.state,
        };
      } else if (!ph) {
        ttl = LABEL_EMPTY_TTL_SECONDS; // Photon fora do ar ou sem nada: tenta de novo em 1 h
      }
    }
    await this.setJson(key, out, ttl);
    return out;
  }

  /**
   * Se a região em volta do ponto tem lugares/ruas importados (place_catalog, geo_names). Fora dela a busca de
   * lugares e ruas volta vazia por falta de dado, não por nome errado, e o app avisa. Célula de 0,1° (~11 km) no cache.
   */
  async coverage(lat: number, lng: number): Promise<GeoCoverageResponse> {
    const la = Math.round(lat * 10) / 10;
    const ln = Math.round(lng * 10) / 10;
    const key = `geo:cov:v1:${la.toFixed(1)},${ln.toFixed(1)}`;
    const hit = await this.getJson<GeoCoverageResponse>(key);
    if (hit) return hit;
    const pt = Prisma.sql`ST_SetSRID(ST_MakePoint(${ln}::float8, ${la}::float8), 4326)::geography`;
    const [row] = await this.prisma.$queryRaw<{ covered: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM place_catalog WHERE dup_of IS NULL AND searchable AND ST_DWithin(geog, ${pt}, ${COVERAGE_RADIUS_M}::float8))
          OR EXISTS (SELECT 1 FROM geo_names WHERE kind = 'street' AND ST_DWithin(geog, ${pt}, ${COVERAGE_RADIUS_M}::float8)) AS covered`;
    const out = { covered: row?.covered === true };
    await this.setJson(key, out, COVERAGE_TTL_SECONDS);
    return out;
  }

  /** ruas, bairros, distritos e cidades pelo nome, os de perto primeiro */
  async search(q: string, center: LatLng | null, limit: number): Promise<GeoSearchResponse> {
    const text = q.trim();
    // ~1 km: a mesma região reaproveita o cache
    const cell = center ? `${center.lat.toFixed(2)},${center.lng.toFixed(2)}` : 'br';
    // v2: com as cidades do IBGE
    const key = `geo:s:v2:${normalize(text)}|${cell}|${limit}`;
    let results = await this.getJson<GeoSearchResult[]>(key);
    if (!results) {
      results = (await this.photon(text, center, limit)) ?? [];
      if (results.length === 0) results = await this.local(text, center, limit);
      await this.setJson(
        key,
        results,
        results.length > 0 ? SEARCH_TTL_SECONDS : SEARCH_EMPTY_TTL_SECONDS,
      );
    }
    return { results, q: text };
  }

  /** geo_names por trigrama (texto como digitado e com as abreviações por extenso), ranqueado em geo.ranking */
  private async local(q: string, center: LatLng | null, limit: number): Promise<GeoSearchResult[]> {
    const terms = [...new Set([normalize(q), expandAbbrev(q)])].filter(Boolean);
    if (terms.length === 0) return [];
    const match = Prisma.join(
      terms.map((t) => Prisma.sql`f_norm(${t}) <% name_norm`),
      ' OR ',
    );
    const sim = Prisma.sql`GREATEST(${Prisma.join(terms.map((t) => Prisma.sql`word_similarity(f_norm(${t}), name_norm)`))})`;
    const rows = await this.prisma.$queryRaw<GeoNameRow[]>`
      SELECT id, kind, name, neighborhood, city, state, ST_Y(geog::geometry) AS lat, ST_X(geog::geometry) AS lng,
             bbox, size_m, ${sim}::float8 AS sim
        FROM geo_names
       WHERE ${match}
       ORDER BY ${sim} DESC, size_m DESC NULLS LAST
       LIMIT ${NAME_POOL}`;
    return rankGeoNames(rows, q, center, limit);
  }

  /** Photon auto-hospedado (PHOTON_URL): null = desligado, falhou ou demorou (a busca local assume) */
  private async photon(
    q: string,
    center: LatLng | null,
    limit: number,
  ): Promise<GeoSearchResult[] | null> {
    const params = new URLSearchParams({ q, limit: String(limit) });
    params.append('countrycode', 'BR');
    for (const layer of ['house', 'street', 'locality', 'district', 'city'])
      params.append('layer', layer);
    // viés de proximidade pelo centro do mapa arredondado (~1 km)
    if (center) {
      params.set('lat', center.lat.toFixed(2));
      params.set('lon', center.lng.toFixed(2));
    }
    const features = await this.photonGet('api', params);
    return features ? parsePhoton(features).slice(0, limit) : null;
  }

  /** bairro/cidade pelo /reverse do Photon (ponto já no centro da célula geohash-6) */
  private async photonLabel(lat: number, lng: number): Promise<GeoLabelResponse | null> {
    const features = await this.photonGet(
      'reverse',
      new URLSearchParams({ lat: lat.toFixed(4), lon: lng.toFixed(4), limit: '1' }),
    );
    return features ? labelFromPhoton(features) : null;
  }

  private async photonGet(
    path: 'api' | 'reverse',
    params: URLSearchParams,
  ): Promise<PhotonFeature[] | null> {
    if (!this.photonUrl) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PHOTON_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.photonUrl}/${path}?${params.toString()}`, {
        signal: ctrl.signal,
        headers: { accept: 'application/json' },
      });
      if (!res.ok) {
        this.log.warn(`Photon respondeu ${res.status}`);
        return null;
      }
      return ((await res.json()) as { features?: PhotonFeature[] }).features ?? [];
    } catch (err) {
      this.log.warn(
        `Photon falhou: ${(err as Error).name === 'AbortError' ? 'timeout' : (err as Error).message}`,
      );
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private async getJson<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.client.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (err) {
      this.log.warn(`cache get falhou: ${(err as Error).message}`);
      return null;
    }
  }

  private async setJson(key: string, value: unknown, ttl: number): Promise<void> {
    try {
      await this.redis.client.set(key, JSON.stringify(value), 'EX', ttl);
    } catch (err) {
      this.log.warn(`cache set falhou: ${(err as Error).message}`);
    }
  }
}
