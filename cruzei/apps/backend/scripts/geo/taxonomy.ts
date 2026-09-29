import type { PlaceCategoryKey, PlaceKind } from '@cruzei/shared-types';
import { isBlocked, normalize } from '../../src/modules/places/places.ranking';

/**
 * Categoria da fonte (Overture Places v2 / tags do OSM) → PlaceKind + chip do app, e o que fica fora do catálogo.
 * Puro (sem banco/rede): testado em taxonomy.spec.ts.
 */

export interface Classified {
  kind: PlaceKind;
  chip: PlaceCategoryKey | null;
  /** false = entra no catálogo mas fica fora da busca padrão (buffet, chácara/espaço de festa) */
  searchable: boolean;
}

/** mesmo chip do KIND_RULES do places.ranking.ts */
const CHIP: Record<PlaceKind, PlaceCategoryKey | null> = {
  nightclub: 'bar',
  pub: 'bar',
  bar: 'bar',
  cocktail: 'bar',
  brewery: 'bar',
  lounge: 'bar',
  nightlife: 'bar',
  music: 'show',
  theatre: 'show',
  cinema: 'show',
  events: 'show',
  entertainment: 'show',
  cafe: 'cafe',
  fastfood: 'restaurant',
  restaurant: 'restaurant',
  park: 'park',
  mall: 'shopping',
  museum: 'museum',
  gallery: 'museum',
  beach: 'beach',
  stadium: null,
  campus: null,
  landmark: null,
  other: null,
};

const NIGHT_OR_FOOD: ReadonlySet<PlaceKind> = new Set<PlaceKind>([
  'nightclub', 'pub', 'bar', 'cocktail', 'brewery', 'lounge', 'nightlife', 'music', 'cafe', 'fastfood', 'restaurant',
]);
const SHOW_LIKE: ReadonlySet<PlaceKind> = new Set<PlaceKind>(['nightclub', 'music', 'events', 'entertainment', 'nightlife', 'theatre']);

// ---------- Overture ----------

/** taxonomy.primary (fino) → tipo; vale antes do basic_category */
const OVT_PRIMARY: Record<string, PlaceKind> = {
  dance_club: 'nightclub',
  night_club: 'nightclub',
  pub: 'pub',
  irish_pub: 'pub',
  gastropub: 'pub',
  cocktail_bar: 'cocktail',
  speakeasy: 'cocktail',
  lounge: 'lounge',
  hookah_bar: 'lounge',
  cigar_bar: 'lounge',
  airport_lounge: 'other',
  brewery: 'brewery',
  beer_garden: 'brewery',
  brewpub: 'brewery',
  beer_bar: 'bar',
  sports_bar: 'bar',
  dive_bar: 'bar',
  wine_bar: 'bar',
  gay_bar: 'bar',
  tapas_bar: 'bar',
  karaoke_venue: 'music',
  jazz_and_blues: 'music',
  comedy_club: 'entertainment',
  auditorium: 'events',
  convention_center: 'events',
  bakery: 'cafe',
  ice_cream_shop: 'cafe',
  gelato_shop: 'cafe',
  frozen_yogurt_shop: 'cafe',
  dessert_shop: 'cafe',
  donut_shop: 'cafe',
  cupcake_shop: 'cafe',
  tea_room: 'cafe',
  bubble_tea_shop: 'cafe',
  chocolatier: 'other',
  candy_store: 'other',
  sandwich_shop: 'fastfood',
  food_delivery_service: 'other',
  food_consultant: 'other',
  lottery_vendor: 'other',
  escape_room: 'entertainment',
  go_kart_club: 'entertainment',
  martial_arts_club: 'other',
  historic_mission: 'landmark',
};

/** basic_category (~280 categorias do schema v2) → tipo; o que não está aqui vira 'other' */
const OVT_BASIC: Record<string, PlaceKind> = {
  dance_club: 'nightclub',
  nightlife_venue: 'nightlife',
  bar: 'bar',
  alcoholic_beverage_venue: 'bar',
  lounge: 'lounge',
  brewery: 'brewery',
  distillery: 'bar',
  winery: 'bar',
  music_venue: 'music',
  theatre_venue: 'theatre',
  performing_arts_venue: 'theatre',
  comedy_club: 'entertainment',
  event_venue: 'events',
  fairgrounds: 'events',
  event_or_party_service: 'events',
  movie_theater: 'cinema',
  cafe: 'cafe',
  coffee_shop: 'cafe',
  non_alcoholic_beverage_venue: 'cafe',
  smoothie_juice_bar: 'cafe',
  fast_food_restaurant: 'fastfood',
  food_truck_stand: 'fastfood',
  food_court: 'fastfood',
  restaurant: 'restaurant',
  casual_eatery: 'restaurant',
  food_and_drink: 'restaurant',
  park: 'park',
  public_plaza: 'park',
  garden: 'park',
  playground: 'park',
  skate_park: 'park',
  nature_reserve: 'park',
  recreational_trail_or_path: 'park',
  shopping_mall: 'mall',
  museum: 'museum',
  cultural_center: 'museum',
  science_attraction: 'museum',
  art_gallery: 'gallery',
  beach: 'beach',
  stadium_arena: 'stadium',
  college_university: 'campus',
  campus_building: 'campus',
  zoo: 'landmark',
  aquarium: 'landmark',
  animal_attraction: 'landmark',
  waterfall: 'landmark',
  lake: 'landmark',
  lighthouse: 'landmark',
  amusement_park: 'entertainment',
  amusement_attraction: 'entertainment',
  arcade: 'entertainment',
  gaming_venue: 'entertainment',
  arts_and_entertainment: 'entertainment',
};

/** categorias que nunca entram (conteúdo adulto, motel) */
const OVT_DROP = new Set(['adult_entertainment_venue', 'adult_store', 'strip_club', 'love_hotel', 'motel', 'swinger_club', 'escort_service', 'massage', 'massage_therapy']);

/** categoria genérica: o nome decide ("Bar do Zé" sem categoria, "Liv Pub" como espaço de eventos) */
const OVT_GENERIC_BASIC = new Set(['food_and_drink', 'arts_and_entertainment']);
/** raiz da hierarquia: larga demais pra decidir o tipo sozinha (vidente cai em arts_and_entertainment) */
const OVT_ROOTS = new Set(['food_and_drink', 'arts_and_entertainment', 'shopping', 'sports_and_recreation', 'services_and_business', 'lifestyle_services']);

export interface OvertureRow {
  name: string | null;
  basic_category: string | null;
  category: string | null;
  hierarchy: string[] | null;
  confidence: number | null;
}

export function classifyOverture(r: OvertureRow): Classified | null {
  const name = r.name?.trim();
  if (!name || isBlocked(name)) return null;
  const basic = r.basic_category ?? null;
  const primary = r.category ?? null;
  if ((basic && OVT_DROP.has(basic)) || (primary && OVT_DROP.has(primary))) return null;

  // historic_site do Overture em BR é quase tudo condomínio/prédio (página da Meta): fica 'other', não ponto turístico
  let kind: PlaceKind | undefined = (primary ? OVT_PRIMARY[primary] : undefined) ?? (basic ? OVT_BASIC[basic] : undefined);
  // hierarquia cobre subcategorias finas que não listamos (ex.: pizza_restaurant → restaurant), sem a raiz genérica
  if (kind === undefined && r.hierarchy?.length) {
    for (const h of [...r.hierarchy].reverse()) {
      if (OVT_ROOTS.has(h)) continue;
      kind = OVT_PRIMARY[h] ?? OVT_BASIC[h];
      if (kind) break;
    }
  }
  kind ??= 'other';
  const generic = basic == null || OVT_GENERIC_BASIC.has(basic) || kind === 'events' || kind === 'entertainment' || kind === 'nightlife';
  return finish(name, kind, generic, basic === 'event_or_party_service', r.confidence ?? null);
}

// ---------- OSM ----------

/** tag do OSM → tipo (a primeira que casar vence: balada antes de bar, bar antes de restaurante) */
const OSM_RULES: [key: string, value: string, kind: PlaceKind][] = [
  ['amenity', 'nightclub', 'nightclub'],
  ['leisure', 'dance', 'nightclub'],
  ['amenity', 'pub', 'pub'],
  ['amenity', 'biergarten', 'brewery'],
  ['craft', 'brewery', 'brewery'],
  ['amenity', 'hookah_lounge', 'lounge'],
  ['amenity', 'bar', 'bar'],
  ['craft', 'distillery', 'bar'],
  ['craft', 'winery', 'bar'],
  ['amenity', 'music_venue', 'music'],
  ['amenity', 'karaoke_box', 'music'],
  ['amenity', 'theatre', 'theatre'],
  ['amenity', 'cinema', 'cinema'],
  ['amenity', 'events_venue', 'events'],
  ['amenity', 'conference_centre', 'events'],
  ['amenity', 'arts_centre', 'museum'],
  ['amenity', 'cafe', 'cafe'],
  ['amenity', 'ice_cream', 'cafe'],
  ['amenity', 'fast_food', 'fastfood'],
  ['amenity', 'food_court', 'fastfood'],
  ['amenity', 'restaurant', 'restaurant'],
  ['shop', 'mall', 'mall'],
  ['tourism', 'museum', 'museum'],
  ['tourism', 'gallery', 'gallery'],
  ['natural', 'beach', 'beach'],
  ['leisure', 'beach_resort', 'beach'],
  ['leisure', 'stadium', 'stadium'],
  ['amenity', 'university', 'campus'],
  ['amenity', 'college', 'campus'],
  ['leisure', 'water_park', 'entertainment'],
  ['leisure', 'amusement_arcade', 'entertainment'],
  ['leisure', 'bowling_alley', 'entertainment'],
  ['leisure', 'escape_game', 'entertainment'],
  ['tourism', 'theme_park', 'entertainment'],
  ['tourism', 'zoo', 'landmark'],
  ['tourism', 'aquarium', 'landmark'],
  ['tourism', 'attraction', 'landmark'],
  ['tourism', 'viewpoint', 'landmark'],
  ['leisure', 'park', 'park'],
  ['leisure', 'garden', 'park'],
  ['place', 'square', 'park'],
];

const OSM_DROP: [string, RegExp][] = [
  ['amenity', /^(stripclub|brothel|swingerclub|love_hotel)$/],
  ['leisure', /^adult_gaming_centre$/],
];

export function classifyOsm(tags: Record<string, string>): (Classified & { rawCategory: string }) | null {
  const name = tags.name?.trim();
  if (!name || isBlocked(name)) return null;
  if (OSM_DROP.some(([k, re]) => tags[k] != null && re.test(tags[k]))) return null;
  // área privada (jardim de casa, clube fechado) e lugar que acabou não entram
  if (/^(private|no)$/.test(tags.access ?? '')) return null;
  if (tags['disused:amenity'] || tags['abandoned:amenity'] || /^(yes|closed)$/.test(tags.disused ?? '')) return null;
  for (const [k, v, kind0] of OSM_RULES) {
    if (tags[k] !== v) continue;
    let kind = kind0;
    if (kind === 'bar' && (tags.cocktails === 'yes' || tags.bar === 'cocktail')) kind = 'cocktail';
    if ((kind === 'restaurant' || kind === 'bar') && tags.microbrewery === 'yes') kind = 'brewery';
    const c = finish(name, kind, kind === 'events' || kind === 'landmark', false, null);
    return c && { ...c, rawCategory: `${k}=${v}` };
  }
  return null;
}

// ---------- regras comuns (nome) ----------

/** loja de bebida / distribuidora classificada como bar: fora ("Disk Bebidas", "Distribuidora e tabacaria") */
const DISTRIBUTOR = /\b(distribuidora|distribuidor|disk|dist|deposito|atacado|atacadista|revenda|bebidas consignadas|delivery de bebidas)\b/;
const BAR_WORD = /\b(bar|pub|boteco|buteco|botequim|choperia|lounge|club|espetaria|petiscaria)\b/;
/** condomínio/prédio residencial (o Overture põe muitos como historic_site): casa de gente não é lugar do app */
const RESIDENTIAL = /\b(condominio|condominios|condomino|cond|edificio|edf|residencial|residence|conjunto habitacional|apartamentos?)\b|^(bairro|res|predio|smart tower)\b/;
/** página de gente/serviço classificada como casa de show ou bar ("Studio Fulano", "IEQ Jardim Canaã", "Publio fretes") */
const NOT_VENUE = /\b(studio|estudio|igreja|ieq|ministerio|assembleia|escola|colegio|ee|hair|representante|representacoes|fretes?|transportes?|imoveis|corretor|corretora|advocacia|advogados?|consultoria|contabilidade)\b/;
/** diversão que não é balada nem show */
const PLAY = /\b(boliche|kart|kartodromo|fliperamas?|paintball|laser tag)\b/;
/** espaço/chácara/buffet de festa particular (aluguel): existe, mas não é o rolê de quem busca balada */
const PARTY_RENTAL = /\b(chacaras?|sitios?|fazenda|rancho|buffet|festas?|eventos|locacoes?|locacao|decoracoes?|decoracao|cerimonial|cerimonialista|produtora|produtor|celebrante|aniversarios?|infantil|kids|salao de festas?)\b/;

/** o nome decide o tipo quando a categoria é genérica (mesma ideia do NAME_HINTS do places.ranking.ts) */
const NAME_HINTS: [RegExp, PlaceKind][] = [
  // "clube" em português é clube social/esportivo; "club" (inglês) é balada
  [/\b(balada|boate|club|night ?club|disco|danceteria)\b/, 'nightclub'],
  [/\bpub\b/, 'pub'],
  [/\b(drinks?|cocktails?|coquetelaria)\b/, 'cocktail'],
  [/\b(cervejaria|brewery|chopperia)\b/, 'brewery'],
  [/\b(bar|boteco|buteco|choperia|chopp|botequim)\b/, 'bar'],
];

function finish(name: string, kind0: PlaceKind, generic: boolean, partyService: boolean, confidence: number | null): Classified | null {
  const n = normalize(name);
  let kind = kind0;
  if (RESIDENTIAL.test(n) && !BAR_WORD.test(n)) return null;
  if (generic && !partyService) {
    for (const [re, k] of NAME_HINTS) {
      if (re.test(n)) {
        kind = k;
        break;
      }
    }
  }
  if (NIGHT_OR_FOOD.has(kind) && DISTRIBUTOR.test(n) && !BAR_WORD.test(n)) return null;
  if ((SHOW_LIKE.has(kind) || NIGHT_OR_FOOD.has(kind)) && NOT_VENUE.test(n) && !BAR_WORD.test(n)) kind = 'other';
  if (SHOW_LIKE.has(kind) && PLAY.test(n)) kind = 'entertainment';
  if (kind === 'entertainment' || kind === 'landmark' || kind === 'other') {
    if (/^(praca|largo)\b/.test(n)) kind = 'park';
    else if (/^(parque|bosque)\b/.test(n) && !/\b(aquatico|diversoes|industrial|empresarial|tecnologico)\b/.test(n)) kind = 'park';
  }
  // nome/Meta page sem sinal nenhum e sem categoria útil: ruído (páginas de pessoas, empresas fantasma)
  if (kind === 'other' && confidence != null && confidence < 0.25) return null;
  // chácara/sítio de aluguel também aparece como parque
  const rental = /^(chacaras?|sitios?|fazenda|rancho|recanto)\b/.test(n) && !BAR_WORD.test(n);
  const party = partyService || rental || (SHOW_LIKE.has(kind) && PARTY_RENTAL.test(n) && !BAR_WORD.test(n));
  if (party) kind = 'events';
  return { kind, chip: CHIP[kind], searchable: !party };
}

export { CHIP as KIND_CHIP };
