import type { GeoLabelResponse, GeoResultType, GeoSearchResult } from '@cruzei/shared-types';
import { haversineMeters, normalize } from '../places/places.ranking';

/**
 * Regras puras do "Cidade · Bairro" e do "ir até lá" (sem banco/rede): abreviação de logradouro, rótulo a partir das
 * áreas, ranking dos nomes do geo_names e leitura da resposta do Photon. Testadas em geo.ranking.spec.ts.
 */

// ---------- Cidade · Bairro ----------

/** área que cobre o ponto (geo_areas), do nível mais fino pro mais largo */
export interface AreaRow {
  kind: string;
  name: string;
  city: string | null;
  state: string | null;
}

/** bairro (nível 10); fora dos bairros, o setor/distrito (nível 9); cidade = o município que cobre o ponto */
export function labelFromAreas(rows: readonly AreaRow[]): GeoLabelResponse {
  const hood = rows.find((r) => r.kind === 'neighborhood') ?? rows.find((r) => r.kind === 'district');
  const city = rows.find((r) => r.kind === 'city')?.name ?? rows.find((r) => r.city)?.city ?? null;
  return { city, neighborhood: hood?.name ?? null, state: rows.find((r) => r.state)?.state ?? null };
}

// ---------- ir até lá ----------

/** abreviação comum de logradouro/título → palavra do nome no OSM ("av joao naves" → "avenida joao naves") */
const ABBREV: Record<string, string> = {
  av: 'avenida',
  avn: 'avenida',
  al: 'alameda',
  pc: 'praca',
  pca: 'praca',
  trav: 'travessa',
  tv: 'travessa',
  rod: 'rodovia',
  est: 'estrada',
  estr: 'estrada',
  lgo: 'largo',
  jd: 'jardim',
  jdm: 'jardim',
  pq: 'parque',
  vl: 'vila',
  res: 'residencial',
  conj: 'conjunto',
  sta: 'santa',
  sto: 'santo',
  ns: 'nossa senhora',
  dr: 'doutor',
  dra: 'doutora',
  prof: 'professor',
  profa: 'professora',
  eng: 'engenheiro',
  cel: 'coronel',
  gov: 'governador',
  pres: 'presidente',
  mal: 'marechal',
  gen: 'general',
  cap: 'capitao',
  ten: 'tenente',
  des: 'desembargador',
  sen: 'senador',
  dep: 'deputado',
};

/** texto normalizado com as abreviações por extenso; "r" só vira "rua" na primeira palavra ("r 10" → "rua 10") */
export function expandAbbrev(q: string): string {
  return normalize(q)
    .split(' ')
    .filter(Boolean)
    .map((w, i) => (i === 0 && w === 'r' ? 'rua' : (ABBREV[w] ?? w)))
    .join(' ');
}

/** nome do geo_names como a busca lê */
export interface GeoNameRow {
  id: string;
  /** 'street' | 'neighborhood' | 'city' | 'place' (distrito, setor, vila) */
  kind: string;
  name: string;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  lat: number;
  lng: number;
  /** [oeste, sul, leste, norte]; {} = sem */
  bbox: number[] | null;
  size_m: number | null;
  /** word_similarity com o texto digitado (0..1) */
  sim: number;
}

const TYPE_OF: Record<string, GeoResultType> = { street: 'street', neighborhood: 'neighborhood', city: 'city', place: 'locality' };
/** com a mesma nota de texto: cidade > bairro > distrito > rua (rua longa ganha até 15) */
const TYPE_BONUS: Record<GeoResultType, number> = { city: 16, neighborhood: 14, locality: 12, street: 0, address: 0 };

function cityState(city: string | null, state: string | null): string {
  if (city && state) return `${city} - ${state}`;
  return city ?? state ?? '';
}

function bboxOf(b: readonly number[] | null | undefined): [number, number, number, number] | null {
  if (!b || b.length !== 4 || !b.every((n) => Number.isFinite(n))) return null;
  return [Math.min(b[0], b[2]), Math.min(b[1], b[3]), Math.max(b[0], b[2]), Math.max(b[1], b[3])];
}

export function toGeoResult(r: GeoNameRow): GeoSearchResult | null {
  const type = TYPE_OF[r.kind];
  if (!type || !r.name?.trim() || !Number.isFinite(r.lat) || !Number.isFinite(r.lng)) return null;
  const context =
    type === 'street' ? [r.neighborhood, cityState(r.city, r.state)].filter(Boolean).join(', ') : type === 'city' ? (r.state ?? '') : cityState(r.city, r.state);
  return { id: r.id, name: r.name.trim(), context, type, lat: r.lat, lng: r.lng, bbox: bboxOf(r.bbox) };
}

/** todas as palavras digitadas (a última pode estar pela metade) estão no nome */
function hasAllWords(name: string, want: string): boolean {
  const nw = name.split(' ');
  const qw = want.split(' ').filter(Boolean);
  return qw.length > 0 && qw.every((w, i) => nw.includes(w) || (i === qw.length - 1 && nw.some((x) => x.startsWith(w))));
}

/**
 * Nota = texto (0-100) + tipo + nome exato + tamanho da rua − distância. O trigrama pune palavra a mais no meio
 * ("Av. Rondon Pacheco" dá 0,83 com a "Avenida Governador Rondon Pacheco"): com todas as palavras no nome o texto vale
 * cheio, e a avenida de 14 km passa na frente do trecho de 200 m chamado "Avenida Rondon Pacheco". Cidade e distrito
 * valem de qualquer lugar (sem desconto de distância).
 */
export function scoreGeoName(r: GeoNameRow, q: string, center: { lat: number; lng: number } | null): number {
  const type = TYPE_OF[r.kind] ?? 'street';
  const want = expandAbbrev(q);
  const n = normalize(r.name);
  let s = (hasAllWords(n, want) ? 1 : r.sim) * 100 + TYPE_BONUS[type];
  if (n === want) s += 6;
  else if (n.startsWith(want)) s += 2;
  if (type === 'street' && r.size_m && r.size_m > 10) s += Math.min(15, 5 * Math.log10(r.size_m / 10));
  if (center && (type === 'street' || type === 'neighborhood')) s -= Math.min(20, (haversineMeters(center.lat, center.lng, r.lat, r.lng) / 1000) * 0.3);
  return s;
}

export function rankGeoNames(rows: readonly GeoNameRow[], q: string, center: { lat: number; lng: number } | null, limit: number): GeoSearchResult[] {
  return rows
    .map((r) => ({ r, s: scoreGeoName(r, q, center) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => toGeoResult(x.r))
    .filter((x): x is GeoSearchResult => x !== null)
    .slice(0, limit);
}

// ---------- Photon (opcional) ----------

export interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    osm_type?: string;
    osm_id?: number;
    type?: string;
    name?: string;
    street?: string;
    housenumber?: string;
    district?: string;
    locality?: string;
    city?: string;
    state?: string;
    countrycode?: string;
    extent?: number[];
  };
}

/** camada do Photon → tipo; condado, estado, país e "other" ficam de fora */
const PHOTON_TYPE: Record<string, GeoResultType> = { house: 'address', street: 'street', district: 'neighborhood', locality: 'neighborhood', city: 'city' };

/** GeoJSON do Photon → resultados (só Brasil); a ordem do Photon (texto + proximidade) é mantida */
export function parsePhoton(features: readonly PhotonFeature[]): GeoSearchResult[] {
  const out: GeoSearchResult[] = [];
  for (const f of features) {
    const p = f.properties;
    const [lng, lat] = f.geometry?.coordinates ?? [];
    const type = p?.type ? PHOTON_TYPE[p.type] : undefined;
    if (!p || !type || typeof lat !== 'number' || typeof lng !== 'number') continue;
    if (p.countrycode && p.countrycode.toUpperCase() !== 'BR') continue;
    const name = type === 'address' ? [p.street ?? p.name, p.housenumber].filter(Boolean).join(', ') : p.name;
    if (!name?.trim()) continue;
    const hood = p.district ?? p.locality ?? null;
    const context =
      type === 'address' || type === 'street'
        ? [hood, p.city, p.state].filter(Boolean).join(', ')
        : type === 'city'
          ? (p.state ?? '')
          : [p.city, p.state].filter(Boolean).join(', ');
    out.push({ id: `osm:${(p.osm_type ?? '').toLowerCase()}${p.osm_id ?? `${lat},${lng}`}`, name: name.trim(), context, type, lat, lng, bbox: bboxOf(p.extent) });
  }
  return out;
}

/** fora das áreas importadas: bairro/cidade do ponto mais perto no Photon (/reverse); a UF fica null (o Photon dá o nome) */
export function labelFromPhoton(features: readonly PhotonFeature[]): GeoLabelResponse | null {
  const p = features.find((f) => !f.properties?.countrycode || f.properties.countrycode.toUpperCase() === 'BR')?.properties;
  if (!p) return null;
  const city = p.city ?? (p.type === 'city' ? (p.name ?? null) : null);
  const neighborhood = p.district ?? p.locality ?? (p.type === 'district' || p.type === 'locality' ? (p.name ?? null) : null);
  return city || neighborhood ? { city, neighborhood, state: null } : null;
}
