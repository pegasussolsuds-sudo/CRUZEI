import type { MapboxPlace, PlaceCategoryKey, PlaceKind } from '@cruzei/shared-types';

/**
 * Regras puras da busca de lugares (sem rede): categorias do Mapbox, tipo do lugar, variação de grafia e ranking.
 * Ficam separadas do service pra serem testadas sem chamar a API.
 */

/** categorias do Mapbox que importam num app de encontro: noite, comer e beber, eventos */
export const VIBE_CATEGORIES = [
  'bar',
  'nightlife',
  'nightclub',
  'pub',
  'lounge',
  'brewery',
  'music_venue',
  'concert_hall',
  'event_space',
  'entertainment',
  'restaurant',
  'fast_food',
  'cafe',
  'coffee_shop',
  'food_and_drink',
] as const;

/** lugares de encontro fora da noite (parque, shopping, teatro, faculdade…) */
export const SOCIAL_CATEGORIES = [
  'park',
  'garden',
  'shopping_mall',
  'theatre',
  'cinema',
  'museum',
  'art_gallery',
  'stadium',
  'university',
  'college',
  'tourist_attraction',
  'beach',
  'zoo',
  'plaza',
] as const;

/** chip do overlay → categorias do Mapbox usadas na navegação por categoria */
export const CHIP_TO_MAPBOX: Record<PlaceCategoryKey, string[]> = {
  bar: ['nightclub', 'bar', 'pub', 'lounge'],
  restaurant: ['restaurant', 'fast_food'],
  cafe: ['cafe', 'coffee_shop'],
  park: ['park'],
  shopping: ['shopping_mall'],
  show: ['music_venue', 'concert_hall', 'theatre', 'nightclub'],
  beach: ['beach'],
  museum: ['museum', 'art_gallery'],
};

/** feature do Search Box (/forward e /category) — só os campos que usamos */
export interface SearchBoxFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    name?: string;
    mapbox_id?: string;
    feature_type?: string;
    address?: string;
    full_address?: string;
    place_formatted?: string;
    poi_category_ids?: string[];
    coordinates?: { latitude?: number; longitude?: number };
    context?: {
      neighborhood?: { name?: string };
      locality?: { name?: string };
      place?: { name?: string };
      region?: { name?: string; region_code?: string };
    };
  };
}

// ---------- intenção e filtro ----------

/**
 * Palavra genérica de rolê ("balada", "bar", "comer"…) não é nome de lugar: vira navegação pela categoria
 * (os mais perto primeiro), junto com o que tiver esse nome.
 */
const INTENTS: [RegExp, string[]][] = [
  [/^(baladas?|boates?|night|noitada|festas?|roles?|dancar|danca)$/, ['nightclub', 'music_venue']],
  [/^(bar|bares|botecos?|butecos?|pubs?|choperias?|cervejarias?|drinks?)$/, ['bar', 'pub', 'brewery']],
  [/^(restaurantes?|comer|comida|jantar|almoco|almocar)$/, ['restaurant']],
  [/^(cafes?|cafeterias?)$/, ['cafe', 'coffee_shop']],
  [/^(parques?|pracas?)$/, ['park']],
  [/^(shoppings?)$/, ['shopping_mall']],
  [/^(shows?|ao vivo|musica ao vivo|teatros?)$/, ['music_venue', 'concert_hall', 'theatre']],
];

export function intentCategories(q: string): string[] | null {
  const n = normalize(q);
  for (const [re, cats] of INTENTS) if (re.test(n)) return cats;
  return null;
}

/** anúncio de acompanhante, massagem, motel e afins não entra na busca de um app de encontros */
const BLOCKED = /\b(acompanhantes?|garotas? de programa|programa vip|massagens?|massagistas?|motel|moteis|prive|swing|sex ?shop|sexshop|strip|stripper|eroti[ck][oa]s?)\b/;

export function isBlocked(name: string): boolean {
  return BLOCKED.test(normalize(name));
}

// ---------- tipo do lugar ----------

/** ordem importa: a primeira categoria que casar define o tipo (balada antes de bar, bar antes de "comes e bebes") */
const KIND_RULES: [mapboxId: string, kind: PlaceKind, chip: PlaceCategoryKey | null][] = [
  ['nightclub', 'nightclub', 'bar'],
  ['pub', 'pub', 'bar'],
  ['bar', 'bar', 'bar'],
  ['brewery', 'brewery', 'bar'],
  ['cocktail_bar', 'cocktail', 'bar'],
  ['lounge', 'lounge', 'bar'],
  ['music_venue', 'music', 'show'],
  ['concert_hall', 'music', 'show'],
  ['theatre', 'theatre', 'show'],
  ['cinema', 'cinema', 'show'],
  ['event_space', 'events', 'show'],
  ['nightlife', 'nightlife', 'bar'],
  ['cafe', 'cafe', 'cafe'],
  ['coffee_shop', 'cafe', 'cafe'],
  ['coffee', 'cafe', 'cafe'],
  ['fast_food', 'fastfood', 'restaurant'],
  ['restaurant', 'restaurant', 'restaurant'],
  ['food_and_drink', 'restaurant', 'restaurant'],
  ['food', 'restaurant', 'restaurant'],
  ['park', 'park', 'park'],
  ['garden', 'park', 'park'],
  ['shopping_mall', 'mall', 'shopping'],
  ['museum', 'museum', 'museum'],
  ['art_gallery', 'gallery', 'museum'],
  ['beach', 'beach', 'beach'],
  ['stadium', 'stadium', null],
  ['university', 'campus', null],
  ['college', 'campus', null],
  ['tourist_attraction', 'landmark', null],
  ['entertainment', 'entertainment', 'show'],
];

/** tipos que contam como "noite" (a UI destaca e o ranking favorece) */
const NIGHTLIFE_KINDS: ReadonlySet<PlaceKind> = new Set<PlaceKind>(['nightclub', 'pub', 'bar', 'cocktail', 'brewery', 'lounge', 'music', 'nightlife']);
const OUTING_KINDS: ReadonlySet<PlaceKind> = new Set<PlaceKind>(['events', 'theatre', 'cinema', 'entertainment', 'restaurant', 'cafe', 'fastfood']);

/**
 * O Mapbox às vezes classifica casa noturna como "espaço de eventos" (ex.: "Liv Pub"). Quando a categoria é genérica,
 * o nome decide: "pub", "bar", "club", "balada"…
 */
const NAME_HINTS: [RegExp, PlaceKind][] = [
  [/\b(balada|boate|club|clube|night)\b/, 'nightclub'],
  [/\bpub\b/, 'pub'],
  [/\b(bar|boteco|buteco|choperia|chopp|botequim)\b/, 'bar'],
  [/\b(drinks?|cocktails?)\b/, 'cocktail'],
  [/\b(cervejaria|beer|brewery)\b/, 'brewery'],
];
const GENERIC_KINDS: ReadonlySet<PlaceKind> = new Set<PlaceKind>(['events', 'entertainment', 'nightlife', 'other']);

export function kindOf(categoryIds: readonly string[] | undefined, name: string): { kind: PlaceKind; category: PlaceCategoryKey | null } {
  const ids = new Set(categoryIds ?? []);
  let kind: PlaceKind = 'other';
  let category: PlaceCategoryKey | null = null;
  for (const [id, k, chip] of KIND_RULES) {
    if (ids.has(id)) {
      kind = k;
      category = chip;
      break;
    }
  }
  if (GENERIC_KINDS.has(kind)) {
    const n = normalize(name);
    for (const [re, k] of NAME_HINTS) {
      if (re.test(n)) {
        kind = k;
        category = 'bar';
        break;
      }
    }
  }
  return { kind, category };
}

export function isNightlife(kind: PlaceKind): boolean {
  return NIGHTLIFE_KINDS.has(kind);
}

// ---------- texto ----------

/** minúsculas, sem acento, espaços simples */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function words(s: string): string[] {
  return s.split(' ').filter(Boolean);
}

/**
 * Grafia alternativa pra quem digita como fala: "live" acha o "Liv Pub", "texass" acha o "Texas".
 * Só a última palavra, com 4+ letras, perde a letra final. Sem variação útil devolve null.
 */
export function spellingVariant(q: string): string | null {
  const w = words(normalize(q));
  if (w.length === 0) return null;
  const last = w[w.length - 1];
  if (last.length < 4 || /\d/.test(last)) return null;
  w[w.length - 1] = last.slice(0, -1);
  return w.join(' ');
}

/** quão bem o nome casa com o que foi digitado (0-100) */
export function nameScore(name: string, q: string, variant: string | null): number {
  const n = normalize(name);
  const qn = normalize(q);
  if (!qn) return 30;
  if (n === qn) return 100;
  if (n.startsWith(qn + ' ') || n.startsWith(qn)) return 85;
  const nw = words(n);
  const qw = words(qn);
  if (qw.every((w) => nw.includes(w))) return 75;
  if (qw.every((w) => nw.some((x) => x.startsWith(w)))) return 65;
  if (variant) {
    const vw = words(variant);
    if (vw.every((w) => nw.includes(w))) return 62;
  }
  if (n.includes(qn)) return 55;
  if (variant) {
    const vw = words(variant);
    if (vw.every((w) => nw.some((x) => x.startsWith(w)))) return 40;
  }
  return 25;
}

/** buffet infantil e salão de festa casam com "festa", mas não é o rolê de quem procura balada */
const OFF_VIBE = /\b(buffet|infantil|kids|salao de festas?|festas e eventos|consultorio|clinica)\b/;

export function haversineMeters(la1: number, lo1: number, la2: number, lo2: number): number {
  const R = 6_371_000;
  const dLat = ((la2 - la1) * Math.PI) / 180;
  const dLon = ((lo2 - lo1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((la1 * Math.PI) / 180) * Math.cos((la2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// ---------- feature → lugar ----------

export function toPlace(f: SearchBoxFeature, center: { lat: number; lng: number } | null): MapboxPlace | null {
  const p = f.properties;
  const name = p?.name?.trim();
  const id = p?.mapbox_id;
  const lat = p?.coordinates?.latitude ?? f.geometry?.coordinates?.[1];
  const lng = p?.coordinates?.longitude ?? f.geometry?.coordinates?.[0];
  if (!name || isBlocked(name)) return null;
  if (!id || typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const { kind, category } = kindOf(p?.poi_category_ids, name);
  const ctx = p?.context;
  const city = ctx?.place?.name ?? ctx?.locality?.name ?? null;
  const state = ctx?.region?.region_code ?? ctx?.region?.name ?? null;
  const neighborhood = ctx?.neighborhood?.name ?? (ctx?.locality?.name && ctx.locality.name !== city ? ctx.locality.name : null);
  const street = p?.address?.trim() || null;
  const address = street ? [street, neighborhood, city].filter(Boolean).join(', ') : (p?.full_address ?? p?.place_formatted ?? null);
  return {
    id: `mbx:${id}`,
    name,
    category,
    kind,
    nightlife: isNightlife(kind),
    address,
    neighborhood,
    city,
    state,
    latitude: lat,
    longitude: lng,
    distanceM: center ? haversineMeters(center.lat, center.lng, lat, lng) : 0,
    source: 'mapbox',
  };
}

// ---------- ranking ----------

export interface Ranked {
  place: MapboxPlace;
  score: number;
}

/**
 * Nota final = casamento do nome + tipo (noite pesa mais) − distância − "fora da vibe".
 * `order` é a posição que o Mapbox deu (desempate estável).
 */
export function scorePlace(place: MapboxPlace, q: string, variant: string | null, order: number): number {
  let s = q ? nameScore(place.name, q, variant) : 50;
  if (place.nightlife) s += 15;
  else if (OUTING_KINDS.has(place.kind)) s += 8;
  else if (place.kind !== 'other') s += 5;
  else s -= 10; // categoria fora do rolê (loja, serviço): só aparece se não houver coisa melhor
  if (OFF_VIBE.test(normalize(place.name))) s -= 12;
  s -= Math.min(25, (place.distanceM / 1000) * 0.6);
  s -= order * 0.3;
  return s;
}

/** junta listas (primeira ocorrência vence), pontua e ordena */
export function rankPlaces(lists: MapboxPlace[][], q: string, variant: string | null, limit: number): MapboxPlace[] {
  const seen = new Map<string, Ranked>();
  lists.forEach((list) =>
    list.forEach((place, i) => {
      if (seen.has(place.id)) return;
      seen.set(place.id, { place, score: scorePlace(place, q, variant, i) });
    }),
  );
  return [...seen.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.place);
}

/** sem texto (só o chip): o mais perto primeiro, noite empata a favor */
export function rankByDistance(lists: MapboxPlace[][], limit: number): MapboxPlace[] {
  const seen = new Map<string, MapboxPlace>();
  for (const list of lists) for (const p of list) if (!seen.has(p.id)) seen.set(p.id, p);
  return [...seen.values()]
    .sort((a, b) => a.distanceM - (a.nightlife ? 150 : 0) - (b.distanceM - (b.nightlife ? 150 : 0)))
    .slice(0, limit);
}
