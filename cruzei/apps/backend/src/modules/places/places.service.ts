import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'node:fs';
import type { MapboxPlace, PlaceCategoryKey, PlaceSearchResponse } from '@cruzei/shared-types';
import { decodeGeohash, decodeGeohashBounds } from '@cruzei/shared-utils';
import { CROWD, localDateBrazil } from '../location/discovery-privacy';
import { RedisService } from '../../redis/redis.service';
import {
  CHIP_TO_MAPBOX,
  SOCIAL_CATEGORIES,
  VIBE_CATEGORIES,
  haversineMeters,
  intentOf,
  nameScore,
  rankByDistance,
  rankPlaces,
  spellingVariants,
  toPlace,
  type SearchBoxFeature,
} from './places.ranking';

const SEARCHBOX_URL = 'https://api.mapbox.com/search/searchbox/v1';
const TIMEOUT_MS = 4_500;
/** lugares mudam pouco: 6 h de cache por texto + região (economiza cota do Mapbox e responde na hora) */
const CACHE_TTL_SECONDS = 6 * 3600;
/** busca sem resultado fica menos tempo (o lugar pode ter acabado de ser cadastrado no Mapbox) */
const EMPTY_TTL_SECONDS = 10 * 60;
/** ~39 km pra cada lado do centro: cidade + região metropolitana */
const BBOX_DEG = 0.35;
/** o que passar disso só entra quando a região não tem nada com esse nome */
const LOCAL_MAX_M = 60_000;
const CACHE_VERSION = 'v6';
/** lugar devolvido pela NOSSA busca: só esses podem ser sugeridos pro mapa (nada de nome/ponto vindo do cliente) */
const REMEMBER_TTL_SECONDS = 6 * 3600;
/** lugares do Mapbox em volta de uma célula movimentada (inclusive 'nenhum'): 7 dias */
const CELL_TTL_SECONDS = 7 * 86_400;
/** categorias consultadas pelo detector numa célula (as mesmas famílias da busca, que já sabemos que o Mapbox aceita) */
const CELL_CATEGORIES = ['bar', 'nightlife', 'restaurant', 'cafe', 'park', 'shopping_mall'];
/** folga em volta da célula geohash-7 na consulta ao Mapbox (lugar na borda da célula) */
const CELL_MARGIN_M = 60;

export interface PlacesSearchArgs {
  q: string;
  category: PlaceCategoryKey | null;
  /** centro do mapa (proximity=map) ou minha posição (proximity=me) */
  center: { lat: number; lng: number } | null;
  proximityMode: 'map' | 'me';
  limit: number;
}

/** ~1 km: a posição que sai pro Mapbox é a da célula (privacidade), e a mesma célula reaproveita o cache */
function toCell(c: { lat: number; lng: number }): { lat: number; lng: number } {
  return { lat: Math.round(c.lat * 100) / 100, lng: Math.round(c.lng * 100) / 100 };
}

@Injectable()
export class PlacesService {
  private readonly log = new Logger(PlacesService.name);
  private readonly token = (process.env.MAPBOX_TOKEN ?? '').trim();
  private warnedNoToken = false;

  constructor(private readonly redis: RedisService) {}

  async search(args: PlacesSearchArgs): Promise<PlaceSearchResponse> {
    const q = args.q.trim();
    const cell = args.center ? toCell(args.center) : null;
    const key = `places:${CACHE_VERSION}:${q.toLowerCase()}|${cell ? `${cell.lat},${cell.lng}` : 'br'}|${args.category ?? ''}|${args.limit}`;

    let places = await this.cached(key);
    if (!places) {
      places = await this.fetchPlaces(q, args.category, cell, args.limit);
      if (places) await this.store(key, places);
    }
    // distância recalculada do ponto exato (o cache guarda a da célula)
    const center = args.center;
    const out = (places ?? []).map((p) => (center ? { ...p, distanceM: haversineMeters(center.lat, center.lng, p.latitude, p.longitude) } : p));
    await this.remember(out);
    return { places: out, q, generatedAt: new Date().toISOString() };
  }

  /** um lugar que a nossa busca devolveu nas últimas 6 h (id 'mbx:…'), ou null */
  async lookup(id: string): Promise<MapboxPlace | null> {
    try {
      const raw = await this.redis.client.get(`mbx:p:${id}`);
      return raw ? (JSON.parse(raw) as MapboxPlace) : null;
    } catch {
      return null;
    }
  }

  private async remember(places: MapboxPlace[]): Promise<void> {
    if (places.length === 0) return;
    try {
      const pipe = this.redis.client.pipeline();
      for (const p of places) pipe.set(`mbx:p:${p.id}`, JSON.stringify(p), 'EX', REMEMBER_TTL_SECONDS);
      await pipe.exec();
    } catch (err) {
      this.log.warn(`cache de lugares falhou: ${(err as Error).message}`);
    }
  }

  /**
   * Lugares públicos do Mapbox dentro de uma célula geohash-7 (+ folga). Só a CAIXA da célula vai pro Mapbox (dado
   * agregado), nunca a posição de alguém. Cache de 7 dias (inclusive vazio) e teto diário de chamadas do detector.
   * null = pulou (sem token, teto do dia, falha) — o detector tenta de novo na próxima rodada.
   * MAPBOX_STUB=<arquivo.json> (fora de produção): lê uma lista fixa de lugares em vez de chamar o Mapbox (testes/carga).
   */
  async venuesInCell(cell: string): Promise<MapboxPlace[] | null> {
    const key = `mbx:cell:v1:${cell}`;
    const hit = await this.cached(key);
    if (hit) return hit;
    const b = decodeGeohashBounds(cell);
    const dLat = CELL_MARGIN_M / 111_195;
    const dLng = dLat / Math.cos((((b.latMin + b.latMax) / 2) * Math.PI) / 180);
    const box = { latMin: b.latMin - dLat, latMax: b.latMax + dLat, lngMin: b.lngMin - dLng, lngMax: b.lngMax + dLng };
    const inside = (p: MapboxPlace) => p.latitude >= box.latMin && p.latitude <= box.latMax && p.longitude >= box.lngMin && p.longitude <= box.lngMax;
    const c = decodeGeohash(cell);
    const center = { lat: c.latitude, lng: c.longitude };

    let venues: MapboxPlace[] | null;
    let complete = true;
    const stub = process.env.NODE_ENV !== 'production' ? (process.env.MAPBOX_STUB ?? '').trim() : '';
    if (stub) {
      try {
        venues = (JSON.parse(fs.readFileSync(stub, 'utf8')) as MapboxPlace[]).filter(inside);
      } catch (err) {
        this.log.warn(`MAPBOX_STUB ilegível: ${(err as Error).message}`);
        return null;
      }
    } else {
      if (!this.token) return null;
      const budgetKey = `mbx:budget:${localDateBrazil()}`;
      const used = await this.redis.client.incrby(budgetKey, CELL_CATEGORIES.length);
      if (used === CELL_CATEGORIES.length) await this.redis.client.expire(budgetKey, 2 * 86_400);
      if (used > CROWD.MAPBOX_DAILY_CAP) return null;
      const bbox = [box.lngMin, box.latMin, box.lngMax, box.latMax].map((n) => n.toFixed(5)).join(',');
      // uma categoria por vez: em rajada o Search Box responde 429 (o detector não tem pressa)
      const lists: (MapboxPlace[] | null)[] = [];
      for (const cat of CELL_CATEGORIES) lists.push(await this.categoryBrowse(cat, center, bbox));
      if (lists.every((l) => l === null)) return null;
      complete = lists.every((l) => l !== null);
      const byId = new Map<string, MapboxPlace>();
      for (const l of lists) for (const p of l ?? []) if (inside(p)) byId.set(p.id, p);
      venues = [...byId.values()];
    }
    // resultado incompleto (alguma categoria falhou) vale pouco: a próxima rodada tenta de novo
    await this.redis.client.set(key, JSON.stringify(venues), 'EX', complete ? CELL_TTL_SECONDS : EMPTY_TTL_SECONDS);
    // cada lugar achado também pode ser sugerido/confirmado depois (mesmo cache da busca)
    await this.remember(venues);
    return venues;
  }

  /** null = falha (não cacheia); [] = o Mapbox respondeu e não tem nada */
  private async fetchPlaces(q: string, category: PlaceCategoryKey | null, cell: { lat: number; lng: number } | null, limit: number): Promise<MapboxPlace[] | null> {
    if (!this.token) {
      if (!this.warnedNoToken) {
        this.warnedNoToken = true;
        this.log.error('MAPBOX_TOKEN ausente no backend: a busca de lugares fica vazia. Coloque o token no .env do backend.');
      }
      return null;
    }

    // 1) só o chip, sem texto: os lugares daquela categoria mais perto
    if (!q && category) {
      const lists = await Promise.all(CHIP_TO_MAPBOX[category].map((c) => this.categoryBrowse(c, cell)));
      if (lists.every((l) => l === null)) return null;
      return rankByDistance(lists.map((l) => l ?? []), limit);
    }

    // 2) palavra de rolê ("balada", "bar", "shopping"…): os daquele tipo mais perto, mais os que têm a palavra no nome
    //    e são do mesmo tipo (antes a busca por texto misturava bar e restaurante em "shopping")
    const intent = category ? null : intentOf(q);
    if (intent) {
      const [browse, text] = await Promise.all([
        Promise.all(intent.categories.map((c) => this.categoryBrowse(c, cell))),
        this.forward(q, intent.categories, cell, true, 10),
      ]);
      if (browse.every((l) => l === null) && text === null) return null;
      const accept = (p: MapboxPlace) => intent.kinds.includes(p.kind);
      const named = (text ?? []).filter((p) => accept(p) && nameScore(p.name, q, null) >= 65);
      return rankByDistance([...browse.map((l) => (l ?? []).filter(accept)), named], limit);
    }

    // 3) texto: noite/comer (+ lugares de encontro) na região, mais as grafias alternativas ("live" → "Liv Pub")
    const vibeCats = category ? CHIP_TO_MAPBOX[category] : [...VIBE_CATEGORIES];
    const variants = spellingVariants(q);
    const calls: Promise<MapboxPlace[] | null>[] = [this.forward(q, vibeCats, cell, true, 10)];
    if (!category) calls.push(this.forward(q, [...SOCIAL_CATEGORIES], cell, true, 5));
    for (const v of variants) calls.push(this.forward(v, vibeCats, cell, true, 6));
    const lists = await Promise.all(calls);
    if (lists.every((l) => l === null)) return null;

    let merged = rankPlaces(
      lists.map((l) => (l ?? []).filter((p) => p.distanceM <= LOCAL_MAX_M)),
      q,
      variants,
      limit,
    );

    // 4) nada na região: procura no Brasil todo (ex.: "Zenaide Bar Campinas" vendo o mapa de Uberlândia)
    //    Só entra o que tem todas as palavras digitadas no nome: no meio da digitação ("aideu") o Brasil todo devolvia
    //    "Aide e Buga" a 600 km.
    if (merged.length === 0 && q.length >= 4) {
      const wide = await this.forward(q, vibeCats, cell, false, limit);
      if (wide) merged = rankPlaces([wide.filter((p) => nameScore(p.name, q, null) >= 75)], q, variants, limit);
    }
    return merged;
  }

  private forward(q: string, categories: string[], cell: { lat: number; lng: number } | null, local: boolean, limit: number): Promise<MapboxPlace[] | null> {
    const params = new URLSearchParams({
      q,
      language: 'pt',
      country: 'br',
      types: 'poi',
      limit: String(Math.min(10, limit)),
      poi_category: categories.join(','),
      access_token: this.token,
    });
    if (cell) {
      params.set('proximity', `${cell.lng},${cell.lat}`);
      if (local) params.set('bbox', bboxAround(cell));
    }
    return this.request(`${SEARCHBOX_URL}/forward?${params.toString()}`, cell);
  }

  private categoryBrowse(category: string, cell: { lat: number; lng: number } | null, bbox?: string): Promise<MapboxPlace[] | null> {
    const params = new URLSearchParams({ language: 'pt', limit: '25', access_token: this.token });
    if (cell) {
      params.set('proximity', `${cell.lng},${cell.lat}`);
      params.set('bbox', bbox ?? bboxAround(cell));
    } else {
      params.set('country', 'br');
    }
    return this.request(`${SEARCHBOX_URL}/category/${encodeURIComponent(category)}?${params.toString()}`, cell);
  }

  private async request(url: string, cell: { lat: number; lng: number } | null): Promise<MapboxPlace[] | null> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
      if (!res.ok) {
        // 401/403 = token errado ou sem escopo; 429 = cota. Nunca loga a URL (tem o token).
        this.log.warn(`Mapbox Search Box respondeu ${res.status}`);
        return null;
      }
      const data = (await res.json()) as { features?: SearchBoxFeature[] };
      const out: MapboxPlace[] = [];
      for (const f of data.features ?? []) {
        const p = toPlace(f, cell);
        if (p) out.push(p);
      }
      return out;
    } catch (err) {
      this.log.warn(`Mapbox Search Box falhou: ${(err as Error).name === 'AbortError' ? 'timeout' : (err as Error).message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private async cached(key: string): Promise<MapboxPlace[] | null> {
    try {
      const raw = await this.redis.client.get(key);
      return raw ? (JSON.parse(raw) as MapboxPlace[]) : null;
    } catch (err) {
      this.log.warn(`cache get falhou: ${(err as Error).message}`);
      return null;
    }
  }

  private async store(key: string, places: MapboxPlace[]): Promise<void> {
    try {
      await this.redis.client.set(key, JSON.stringify(places), 'EX', places.length > 0 ? CACHE_TTL_SECONDS : EMPTY_TTL_SECONDS);
    } catch (err) {
      this.log.warn(`cache set falhou: ${(err as Error).message}`);
    }
  }
}

function bboxAround(c: { lat: number; lng: number }): string {
  const r = (n: number) => Math.round(n * 1e4) / 1e4;
  return [r(c.lng - BBOX_DEG), r(c.lat - BBOX_DEG), r(c.lng + BBOX_DEG), r(c.lat + BBOX_DEG)].join(',');
}
