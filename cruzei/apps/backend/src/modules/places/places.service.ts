import { Injectable, Logger } from '@nestjs/common';
import type { MapboxPlace, PlaceCategoryKey, PlaceSearchResponse } from '@cruzei/shared-types';
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
    return { places: out, q, generatedAt: new Date().toISOString() };
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

  private categoryBrowse(category: string, cell: { lat: number; lng: number } | null): Promise<MapboxPlace[] | null> {
    const params = new URLSearchParams({ language: 'pt', limit: '25', access_token: this.token });
    if (cell) {
      params.set('proximity', `${cell.lng},${cell.lat}`);
      params.set('bbox', bboxAround(cell));
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
