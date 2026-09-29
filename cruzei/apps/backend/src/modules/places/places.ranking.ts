import type { CatalogPlace, PlaceCategoryKey, PlaceKind } from '@cruzei/shared-types';

/**
 * Regras puras da busca de lugares (sem banco): tipos de cada chip, intenção, variação de grafia e ranking.
 * Ficam separadas do service pra serem testadas sem Postgres. O tipo de cada lugar já vem pronto do catálogo
 * (scripts/geo/taxonomy.ts classifica a categoria do Overture/OSM na importação).
 */

/** chip do overlay → tipos do catálogo que entram na navegação por categoria */
export const CHIP_KINDS: Record<PlaceCategoryKey, PlaceKind[]> = {
  bar: ['nightclub', 'pub', 'bar', 'cocktail', 'brewery', 'lounge', 'nightlife'],
  restaurant: ['restaurant', 'fastfood'],
  cafe: ['cafe'],
  park: ['park'],
  shopping: ['mall'],
  show: ['music', 'theatre', 'nightclub', 'events'],
  beach: ['beach'],
  museum: ['museum', 'gallery'],
};

// ---------- intenção e filtro ----------

/**
 * Palavra genérica de rolê ("balada", "bar", "comer"…) não é nome de lugar: vira navegação pelos tipos
 * (os mais perto primeiro), junto com o que tiver esse nome e for de um tipo aceito.
 */
const INTENTS: [RegExp, browse: PlaceKind[], accept: PlaceKind[]][] = [
  // casa de show só pelo nome: no Overture muita página de músico vem como music_venue
  [/^(baladas?|boates?|night|noitada|festas?|roles?|dancar|danca)$/, ['nightclub'], ['nightclub', 'music', 'nightlife', 'pub']],
  [/^(bar|bares|botecos?|butecos?|pubs?|choperias?|cervejarias?|drinks?)$/, ['bar', 'pub', 'brewery', 'cocktail'], ['bar', 'pub', 'cocktail', 'brewery', 'lounge', 'nightclub', 'nightlife']],
  [/^(restaurantes?|comer|comida|jantar|almoco|almocar)$/, ['restaurant'], ['restaurant', 'fastfood']],
  [/^(cafes?|cafeterias?)$/, ['cafe'], ['cafe']],
  [/^(parques?|pracas?)$/, ['park'], ['park']],
  [/^(shoppings?)$/, ['mall'], ['mall']],
  [/^(shows?|ao vivo|musica ao vivo|teatros?)$/, ['music', 'theatre'], ['music', 'theatre', 'events']],
];

/** palavra de rolê → tipos pra navegar (browse) + tipos aceitos entre os que têm a palavra no nome (kinds) */
export function intentOf(q: string): { browse: PlaceKind[]; kinds: PlaceKind[] } | null {
  const n = normalize(q);
  for (const [re, browse, kinds] of INTENTS) if (re.test(n)) return { browse, kinds };
  return null;
}

/** anúncio de acompanhante, massagem, motel e afins não entra na busca de um app de encontros */
const BLOCKED = /\b(acompanhantes?|garotas? de programa|programa vip|massagens?|massagistas?|motel|moteis|prive|swing|sex ?shop|sexshop|strip|stripper|eroti[ck][oa]s?)\b/;

export function isBlocked(name: string): boolean {
  return BLOCKED.test(normalize(name));
}

/** tipos que contam como "noite" (a UI destaca e o ranking favorece) */
const NIGHTLIFE_KINDS: ReadonlySet<PlaceKind> = new Set<PlaceKind>(['nightclub', 'pub', 'bar', 'cocktail', 'brewery', 'lounge', 'music', 'nightlife']);
const OUTING_KINDS: ReadonlySet<PlaceKind> = new Set<PlaceKind>(['events', 'theatre', 'cinema', 'entertainment', 'restaurant', 'cafe', 'fastfood']);

export function isNightlife(kind: PlaceKind): boolean {
  return NIGHTLIFE_KINDS.has(kind);
}

// ---------- texto ----------

/** minúsculas, sem acento, espaços simples (a mesma regra do f_norm() do banco) */
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

/** letra repetida vira uma: "olli" → "oli", "zenaidde" → "zenaide" */
function collapseDoubles(w: string): string {
  return w.replace(/([a-z])\1+/g, '$1');
}

/**
 * Até `max` grafias alternativas, na ordem: última palavra sem a letra final ("live" → "liv") e, pra cada palavra com
 * letra dobrada, a busca com só aquela palavra simplificada ("olli pizza" → "oli pizza"; a outra palavra fica como está,
 * senão "pizza" viraria "piza"). Cada grafia vira mais um termo da mesma consulta no banco, por isso o teto.
 */
export function spellingVariants(q: string, max = 3): string[] {
  const base = words(normalize(q));
  const out: string[] = [];
  const push = (v: string | null) => {
    if (v && v !== base.join(' ') && !out.includes(v)) out.push(v);
  };
  push(spellingVariant(q));
  base.forEach((w, i) => {
    if (w.length < 4 || /\d/.test(w)) return;
    const c = collapseDoubles(w);
    if (c !== w) push(base.map((x, j) => (j === i ? c : x)).join(' '));
  });
  return out.slice(0, max);
}

/** quão bem o nome casa com o que foi digitado (0-100); `variants` = grafias alternativas (ver spellingVariants) */
export function nameScore(name: string, q: string, variants: string | string[] | null): number {
  const list = variants == null ? [] : Array.isArray(variants) ? variants : [variants];
  const n = normalize(name);
  const qn = normalize(q);
  if (!qn) return 30;
  if (n === qn) return 100;
  if (n.startsWith(qn + ' ') || n.startsWith(qn)) return 85;
  const nw = words(n);
  const qw = words(qn);
  if (qw.every((w) => nw.includes(w))) return 75;
  if (qw.every((w) => nw.some((x) => x.startsWith(w)))) return 65;
  if (list.some((v) => words(v).every((w) => nw.includes(w)))) return 62;
  if (n.includes(qn)) return 55;
  if (list.some((v) => words(v).every((w) => nw.some((x) => x.startsWith(w))))) return 40;
  return 25;
}

/** buffet infantil e salão de festa casam com "festa", mas não é o rolê de quem procura balada */
const OFF_VIBE = /\b(buffet|infantil|kids|salao de festas?|festas e eventos|consultorio|clinica)\b/;

/** fora do clima do app (buffet infantil, clínica…): nunca vira lugar descoberto pela galera */
export function isOffVibe(name: string): boolean {
  return OFF_VIBE.test(normalize(name));
}

export function haversineMeters(la1: number, lo1: number, la2: number, lo2: number): number {
  const R = 6_371_000;
  const dLat = ((la2 - la1) * Math.PI) / 180;
  const dLon = ((lo2 - lo1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((la1 * Math.PI) / 180) * Math.cos((la2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// ---------- linha do catálogo → lugar ----------

/** linha do place_catalog como a busca lê (só os campos que usamos) */
export interface CatalogRow {
  id: string;
  name: string;
  kind: string;
  chip: string | null;
  /** Overture 0..1; só OSM = 0.6 */
  confidence: number | null;
  /** o OSM também tem o lugar (fonte OSM ou id osm: entre os duplicados) */
  osm_confirmed: boolean;
  lat: number;
  lng: number;
  address: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  alt_names: string[] | null;
}

/** lugar + o que só o ranking usa (não vai pro app) */
export interface Hit {
  place: CatalogPlace;
  /** 0..1: confiança da fonte, com piso quando o OSM confirma o lugar */
  trust: number;
  /** nomes do mesmo lugar em outras fontes ("Bar do Rubinho" pro "Rubinho's Bar") */
  altNames: string[];
}

/** confiança usada no ranking: sem sinal = 0.5; confirmado pelo OSM = pelo menos 0.7 ("Nash Pub" tem 0.10 no Overture) */
export function trustOf(confidence: number | null, osmConfirmed: boolean): number {
  const c = confidence == null || !Number.isFinite(confidence) ? 0.5 : Math.min(1, Math.max(0, confidence));
  return osmConfirmed ? Math.max(c, 0.7) : c;
}

export function toHit(r: CatalogRow, center: { lat: number; lng: number } | null): Hit | null {
  const name = r.name?.trim();
  if (!name || isBlocked(name)) return null;
  if (!Number.isFinite(r.lat) || !Number.isFinite(r.lng)) return null;
  const kind = r.kind as PlaceKind;
  const category = r.chip && Object.prototype.hasOwnProperty.call(CHIP_KINDS, r.chip) ? (r.chip as PlaceCategoryKey) : null;
  const street = r.address?.trim() || null;
  return {
    place: {
      id: r.id,
      name,
      category,
      kind,
      nightlife: isNightlife(kind),
      address: street ? [street, r.neighborhood, r.city].filter(Boolean).join(', ') : null,
      neighborhood: r.neighborhood,
      city: r.city,
      state: r.state,
      latitude: r.lat,
      longitude: r.lng,
      distanceM: center ? haversineMeters(center.lat, center.lng, r.lat, r.lng) : 0,
      source: 'catalog',
    },
    trust: trustOf(r.confidence, r.osm_confirmed),
    altNames: (r.alt_names ?? []).filter((n) => n && n !== name),
  };
}

// ---------- ranking ----------

/** melhor casamento entre o nome e os nomes alternativos do mesmo lugar */
function bestNameScore(h: Hit, q: string, variants: string | string[] | null): number {
  let s = nameScore(h.place.name, q, variants);
  for (const n of h.altNames) s = Math.max(s, nameScore(n, q, variants));
  return s;
}

/**
 * Busca por texto: lugar de tipo "outro" (loja, serviço, clínica) só entra com cada palavra digitada inteira no nome
 * ("drogasil" acha a farmácia; "liv" não traz "Live Odontologia"). Mesmo assim ele fica atrás dos lugares de rolê.
 */
export function keepForText(h: Hit, q: string): boolean {
  if (h.place.kind !== 'other') return true;
  const qw = words(normalize(q));
  return qw.length > 0 && [h.place.name, ...h.altNames].some((n) => {
    const nw = words(normalize(n));
    return qw.every((w) => nw.includes(w));
  });
}

/**
 * Nota final = casamento do nome + tipo (noite pesa mais) + confiança − distância − "fora da vibe".
 * `order` é a posição que a consulta deu (desempate estável; só as 10 primeiras posições pesam).
 */
export function scorePlace(h: Hit, q: string, variants: string | string[] | null, order: number): number {
  const place = h.place;
  let s = q ? bestNameScore(h, q, variants) : 50;
  if (place.nightlife) s += 15;
  else if (OUTING_KINDS.has(place.kind)) s += 8;
  else if (place.kind !== 'other') s += 5;
  else s -= 25; // fora do rolê (loja, serviço, clínica — o grosso do catálogo): só aparece se não houver coisa melhor
  if (OFF_VIBE.test(normalize(place.name))) s -= 12;
  s += (h.trust - 0.5) * 16; // página abandonada/lugar fechado (confiança baixa) cai; lugar confirmado sobe
  s -= Math.min(25, (place.distanceM / 1000) * 0.6);
  s -= Math.min(order, 10) * 0.3;
  return s;
}

/** junta listas (primeira ocorrência vence), pontua e ordena */
export function rankPlaces(lists: Hit[][], q: string, variants: string | string[] | null, limit: number): CatalogPlace[] {
  const seen = new Map<string, { h: Hit; score: number }>();
  lists.forEach((list) =>
    list.forEach((h, i) => {
      if (seen.has(h.place.id)) return;
      seen.set(h.place.id, { h, score: scorePlace(h, q, variants, i) });
    }),
  );
  return [...seen.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.h.place);
}

/** distância "efetiva" da navegação por tipo: noite empata a favor; confiança baixa pesa como até 800 m a mais */
export function browseDistance(h: Hit): number {
  return h.place.distanceM - (h.place.nightlife ? 150 : 0) + (1 - h.trust) * 800;
}

/** sem texto (só o chip ou palavra de rolê): o mais perto primeiro, noite e confiança desempatam */
export function rankByDistance(lists: Hit[][], limit: number): CatalogPlace[] {
  const seen = new Map<string, Hit>();
  for (const list of lists) for (const h of list) if (!seen.has(h.place.id)) seen.set(h.place.id, h);
  return [...seen.values()]
    .sort((a, b) => browseDistance(a) - browseDistance(b))
    .slice(0, limit)
    .map((h) => h.place);
}
