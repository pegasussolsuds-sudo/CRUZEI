import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { GeoLabelResponse, GeoSearchResponse, GeoSearchResult } from '@cruzei/shared-types';
import { decodeGeohash, encodeGeohash } from '@cruzei/shared-utils';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { normalize } from '../places/places.ranking';
import { expandAbbrev, labelFromAreas, labelFromPhoton, parsePhoton, rankGeoNames, type AreaRow, type GeoNameRow, type PhotonFeature } from './geo.ranking';

/** bairro/cidade mudam pouco: 7 dias por célula; ponto fora das áreas importadas, 1 h */
const LABEL_TTL_SECONDS = 7 * 86_400;
const LABEL_EMPTY_TTL_SECONDS = 3600;
const SEARCH_TTL_SECONDS = 3600;
const SEARCH_EMPTY_TTL_SECONDS = 10 * 60;
/** Photon é opcional e fica ao lado: se demorar, a busca local responde */
const PHOTON_TIMEOUT_MS = 1_500;
/** nomes trazidos do banco antes do ranking fino */
const NAME_POOL = 40;

type LatLng = { lat: number; lng: number };

/**
 * "Cidade · Bairro" (polígonos do OSM em geo_areas) e "ir até lá" (ruas, bairros e cidades em geo_names; Photon
 * auto-hospedado primeiro quando PHOTON_URL existe). Tudo no nosso servidor: nada vai pro Mapbox nem pro Google.
 */
@Injectable()
export class GeoService {
  private readonly log = new Logger(GeoService.name);
  private readonly photonUrl = (process.env.PHOTON_URL ?? '').trim().replace(/\/+$/, '');

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Bairro e cidade de um ponto. Calcula no centro da célula geohash-6 (~1,2 × 0,6 km), a mesma do cache: o
   * resultado é de bairro, não precisa de mais, e a posição fina não entra na chave nem no cálculo. Fora das áreas
   * importadas, pergunta ao Photon (se houver).
   */
  async label(lat: number, lng: number): Promise<GeoLabelResponse> {
    const cell = encodeGeohash(lat, lng, 6);
    const key = `geo:label:v1:${cell}`;
    const hit = await this.getJson<GeoLabelResponse>(key);
    if (hit) return hit;
    const c = decodeGeohash(cell);
    const rows = await this.prisma.$queryRaw<AreaRow[]>`
      SELECT kind, name, city, state FROM geo_areas
       WHERE ST_Covers(geom, ST_SetSRID(ST_MakePoint(${c.longitude}::float8, ${c.latitude}::float8), 4326))
       ORDER BY admin_level DESC NULLS LAST`;
    let out = labelFromAreas(rows);
    if (!out.city && !out.neighborhood) out = (await this.photonLabel(c.latitude, c.longitude)) ?? out;
    await this.setJson(key, out, out.city || out.neighborhood ? LABEL_TTL_SECONDS : LABEL_EMPTY_TTL_SECONDS);
    return out;
  }

  /** ruas, bairros, distritos e cidades pelo nome, os de perto primeiro */
  async search(q: string, center: LatLng | null, limit: number): Promise<GeoSearchResponse> {
    const text = q.trim();
    // ~1 km: a mesma região reaproveita o cache
    const cell = center ? `${center.lat.toFixed(2)},${center.lng.toFixed(2)}` : 'br';
    const key = `geo:s:v1:${normalize(text)}|${cell}|${limit}`;
    let results = await this.getJson<GeoSearchResult[]>(key);
    if (!results) {
      results = (await this.photon(text, center, limit)) ?? [];
      if (results.length === 0) results = await this.local(text, center, limit);
      await this.setJson(key, results, results.length > 0 ? SEARCH_TTL_SECONDS : SEARCH_EMPTY_TTL_SECONDS);
    }
    return { results, q: text };
  }

  /** geo_names por trigrama (texto como digitado e com as abreviações por extenso), ranqueado em geo.ranking */
  private async local(q: string, center: LatLng | null, limit: number): Promise<GeoSearchResult[]> {
    const terms = [...new Set([normalize(q), expandAbbrev(q)])].filter(Boolean);
    if (terms.length === 0) return [];
    const match = Prisma.join(terms.map((t) => Prisma.sql`f_norm(${t}) <% name_norm`), ' OR ');
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
  private async photon(q: string, center: LatLng | null, limit: number): Promise<GeoSearchResult[] | null> {
    const params = new URLSearchParams({ q, limit: String(limit) });
    params.append('countrycode', 'BR');
    for (const layer of ['house', 'street', 'locality', 'district', 'city']) params.append('layer', layer);
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
    const features = await this.photonGet('reverse', new URLSearchParams({ lat: lat.toFixed(4), lon: lng.toFixed(4), limit: '1' }));
    return features ? labelFromPhoton(features) : null;
  }

  private async photonGet(path: 'api' | 'reverse', params: URLSearchParams): Promise<PhotonFeature[] | null> {
    if (!this.photonUrl) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PHOTON_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.photonUrl}/${path}?${params.toString()}`, { signal: ctrl.signal, headers: { accept: 'application/json' } });
      if (!res.ok) {
        this.log.warn(`Photon respondeu ${res.status}`);
        return null;
      }
      return ((await res.json()) as { features?: PhotonFeature[] }).features ?? [];
    } catch (err) {
      this.log.warn(`Photon falhou: ${(err as Error).name === 'AbortError' ? 'timeout' : (err as Error).message}`);
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
