// Location + Presence + Descoberta por proximidade
//
// Regra (brief PRIVACIDADE): o cliente NUNCA recebe latitude/longitude real, distância numérica, horário preciso,
// direção, velocidade ou histórico de OUTRA pessoa. Sobre os outros só chegam: faixa de proximidade, tipo de
// presença, lugar (quando é seguro) e uma posição VISUAL anonimizada gerada pelo servidor.

export interface LocationPoint {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  /** posição simulada informada pelo sistema (Android: LocationObject.mocked); ausente = desconhecido (iOS, app antigo) */
  mocked?: boolean;
}

export interface LocationUpdatePayload extends LocationPoint {
  poiId?: number;
  city?: string;
  state?: string;
}

/**
 * por que EU não estou aparecendo pros outros agora (o servidor decide; o app só informa).
 * GPS falso (GPS_GUARD): 'location_mocked' = o celular disse que a posição é simulada; 'location_unverified' = salto
 * impossível desde a última posição aceita (o servidor espera confirmar; o app manda um fix novo em ~50 s).
 * Nos dois, a posição pública não é atualizada e a pessoa some do mapa (e não vê ninguém) até normalizar.
 */
export type HiddenReason =
  | 'anonymous'
  | 'private_area'
  | 'home'
  | 'nobody'
  | 'no_presence'
  | 'paused'
  | 'location_mocked'
  | 'location_unverified';

export interface LocationUpdateResponse {
  geohash: string;
  nearbyUsers: number;
  nearbyPois: number;
  expiresAt: string; // ISO
  discoverable: boolean;
  hiddenReason: HiddenReason | null;
}

import type { AvatarConfig } from './avatar';
import type { ConversationRef, LikeStatus } from './conversation';
import type { Orientation } from './user';

/** relação social com quem consulta, no cartão público (GET /users/:id) e no /nearby */
export interface PeerSocial {
  /** RECEIVED ("já te curtiu") só pra Premium+ com assinatura vigente; pros outros vem NONE */
  likeStatus: LikeStatus;
  conversation: ConversationRef | null;
}

/**
 * 🟢 muito perto (≤100 m) · 🟢 perto (≤250 m) · 🟡 na região (≤350 m) · ⭐ em destaque na região ('boost': quem tem
 * Boost ativo e está além dos 350 m, até BOOST_RADIUS_M; posição sempre anonimizada, nunca a real)
 */
export type ProximityBand = 'very_near' | 'near' | 'region' | 'boost';

/** alcance de quem tem Boost ativo (m): aparece pra quem está até aqui, em destaque e primeiro na ordem */
export const BOOST_RADIUS_M = 5000;
/** 'place' = está num lugar (pin no lugar); 'nearby' = por perto (pin no centro da célula anonimizada) */
export type PresenceType = 'place' | 'nearby';
export type LastSeen = 'online' | 'recent' | 'earlier';

/** posição VISUAL anonimizada (centro de célula ~150 m ou ponto do lugar) — nunca a coordenada real */
export interface MapPosition {
  lat: number;
  lng: number;
}

export interface NearbyUser {
  id: string;
  name: string;
  age: number | null; // null quando showAge=false
  mainPhotoUrl: string | null;
  /** foto (thumbnail) pra bolha de identidade NO MAPA — null quando a pessoa desligou "mostrar minha foto no mapa" */
  mapPhotoUrl: string | null;
  /** conta criada há menos de 7 dias (selo "novo por aqui") */
  isNew: boolean;
  proximityBand: ProximityBand;
  presenceType: PresenceType;
  /** null = a pessoa existe por perto mas não ganha marcador (o servidor decidiu); a lista ainda mostra a faixa */
  mapPosition: MapPosition | null;
  lastSeen: LastSeen;
  isOnline: boolean;
  isAnonymous: boolean;
  premiumTier: 'free' | 'premium' | 'premium_plus';
  isVerified: boolean;
  /** boost ativo → sempre dentro do corte, primeiro na ordem do servidor (mapa, lista e deck) e destaque no mapa */
  isBoosted: boolean;
  /** só quando a pessoa EXIBE a orientação no perfil (showOrientation); senão ausente/null */
  orientation?: Orientation | null;
  poi?: { id: number; name: string } | null;
  /** avatar Cruzei (null → o app gera um determinístico a partir do id) */
  avatar?: AvatarConfig | null;
  /** eu já curti essa pessoa (pra sheet mostrar 'Curtido') */
  likedByMe?: boolean;
  /** status da curtida do MEU ponto de vista; RECEIVED só chega pra Premium+ (senão vem NONE) */
  likeStatus?: LikeStatus;
  /** conversa do par, se existe e não está arquivada por mim (o botão vira "Abrir conversa") */
  conversation?: ConversationRef | null;
  /**
   * essa pessoa me deu uma SUPER curtida que eu ainda não respondi (nem curti nem passei): no deck vem primeiro, com o
   * selo "⭐ Te deu uma super curtida". A super curtida revela quem mandou (likeStatus RECEIVED mesmo sem Premium+);
   * curtida normal continua escondida. Ausente = false.
   */
  superLikedMe?: boolean;
}

/**
 * Filtros do "quem ver" que o servidor aplica no /nearby (mapa, lista e deck):
 * - "Mostrar" (showMe) recíproco;
 * - faixa de idade (settings.ageMin/ageMax) só pelo meu lado — quem esconde a idade entra pelo bloco de 5 anos
 *   (AGE_BUCKET_YEARS: passa se o bloco encosta na faixa); a idade exata nunca sai do servidor.
 */
export interface DiscoveryResponse {
  users: NearbyUser[];
  /** pessoas por perto que existem mas não aparecem (região esparsa) — só o número */
  hiddenCount: number;
  radiusM: number;
  me: { discoverable: boolean; hiddenReason: HiddenReason | null; placePrompt?: PlacePrompt | null };
  /**
   * Gente invisível (modo anônimo) por perto — SÓ pra quem tem Premium vigente; pra quem é grátis vem null e nenhum
   * número (nem o total). Nunca identidade: sem id, nome, foto nem avatar, e agrupada por lugar ou quadra.
   */
  invisible?: InvisiblePresence | null;
}

/**
 * Pessoa no DECK de curtidas. Igual à NearbyUser, mas quem me deu super curtida pendente entra MESMO fora do raio: aí
 * vem com proximityBand null, mapPosition null, lastSeen 'earlier' e isOnline false (a super curtida revela quem é,
 * nunca onde está).
 */
export type DeckUser = Omit<NearbyUser, 'proximityBand'> & { proximityBand: ProximityBand | null };

/**
 * GET /v1/location/nearby?radius_meters=350&deck=1 — o deck ("Passar"/"Curtir"). Mesmos filtros do mapa (bloqueio,
 * "Mostrar" recíproco, faixa de idade, descoberta) e mais:
 * - fora: quem eu passei há menos de DISCOVERY_PASS_DAYS, quem eu já curti, invisíveis (anônimos);
 * - primeiro: super curtidas RECEBIDAS e ainda não respondidas (superLikedMe true, a mais recente primeiro), de
 *   qualquer distância — sem quem mandou estando invisível, pausado, em análise, suspenso/banido/apagado ou bloqueado
 *   (qualquer lado); respeitam o MEU "Mostrar" e a MINHA faixa de idade;
 * - depois: o resto na ordem de sempre (Boost primeiro).
 * Sem deck=1 (mapa e lista) nada muda: passar não esconde ninguém do mapa.
 */
export interface DeckResponse extends Omit<DiscoveryResponse, 'users'> {
  users: DeckUser[];
  /** quantas super curtidas pendentes estão no topo de `users` */
  superLikesPending: number;
}

/** grupo de invisíveis num lugar ou numa quadra: um marcador com a contagem, nunca uma pessoa */
export interface InvisibleGroup {
  /** chave do grupo pro mapa ('poi:<id>' ou 'cell:<geohash>'), nunca de uma pessoa */
  key: string;
  /** ponto do lugar ou centro da quadra — nunca a posição de alguém */
  lat: number;
  lng: number;
  count: number;
  band: ProximityBand;
  poi: { id: number; name: string } | null;
}

export interface InvisiblePresence {
  /** invisíveis no raio, inclusive os que não viram marcador (região com pouca gente: só entram aqui) */
  total: number;
  groups: InvisibleGroup[];
}

/**
 * '✨ Tá rolando algo aqui?': quem está parado há alguns minutos perto de um lugar que a galera pediu (ou onde a
 * multidão divide dois lugares) pode confirmar qual é. Sem coordenadas e sem contagens — só nome e tipo públicos.
 * Vem no máximo 1 vez a cada 6 h; o app guarda até a pessoa responder ou dispensar.
 */
export interface PlacePrompt {
  options: { candidateId: string; name: string; kind: PlaceKind }[];
}

/** resposta do POST /pois/suggest */
export interface PlaceSuggestResponse {
  status: 'pending' | 'active';
  poi?: { id: number; name: string; category: string; latitude: number; longitude: number; source: string };
}

export interface Hotspot {
  poi: {
    id: number;
    name: string;
    category: string;
    rating: number | null;
  };
  userCount: number;
  latitude: number;
  longitude: number;
  lastUserAt: string;
}

export interface POI {
  id: number;
  name: string;
  category: string;
  subcategory: string | null;
  latitude: number;
  longitude: number;
  address: string | null;
  city?: string | null;
  state?: string | null;
  neighborhood?: string | null;
  rating: number | null;
  totalRatings: number;
  isPartner: boolean;
  partnerOffer: string | null;
  /** origem: "osm"/"seed"/"partner"… ou "catalog" = descoberto pela galera (multidão, pedidos, confirmações; antes "mapbox") */
  source?: string;
  userCount?: number;
  distanceM?: number;
}

/** área privada do PRÓPRIO usuário (a coordenada fica no servidor; o app só vê rótulo e raio) */
export interface PrivateArea {
  id: string;
  label: string;
  radiusM: number;
  createdAt: string;
}

// ---------- "Onde tá a vibe" (busca de lugares por energia ao vivo) ----------

/** quanta gente do app está no lugar agora: quiet 0 · warming ≥ 2 · hot ≥ 5 · peak ≥ 12 */
export type VibeLevel = 'quiet' | 'warming' | 'hot' | 'peak';

/** filtros rápidos do overlay de busca */
export type VibeFilter = 'all' | 'hot' | 'events' | 'people' | 'near';

/**
 * Lugar com os sinais de "vibe". Contagens são públicas e já vêm com o piso de anonimato do servidor
 * (< 2 pessoas vira 0); nunca há posição, nome ou horário de uma pessoa específica aqui.
 */
export interface VibePlace extends POI {
  neighborhood: string | null;
  /** pessoas do app no lugar agora (com piso de anonimato) */
  peopleNow: number;
  /** variação vs. a janela de 30–60 min atrás (só quando há gente agora) */
  trend: number;
  /** 0–100: gente agora + tendência + evento + atividade recente */
  vibeScore: number;
  vibeLevel: VibeLevel;
  isEvent: boolean;
  /** "Hoje", "20h–2h"… só pra eventos */
  eventLabel: string | null;
  /** última presença em faixa (online / há pouco / mais cedo); null quando não há gente o bastante — nunca minutos */
  lastActive: LastSeen | null;
  /** distância do lugar ao centro pedido (centro do mapa ou eu) */
  distanceM: number;
}

export interface VibeResponse {
  places: VibePlace[];
  /** lugares com gente ≥ hot */
  hotCount: number;
  /** soma de pessoas em todos os lugares do raio (antes do filtro) */
  peopleAtPlaces: number;
  generatedAt: string;
  radiusM: number;
}

// ---------- "Busca por lugar" (catálogo próprio) ----------
// Bares, baladas, restaurantes e outros lugares reais da cidade, buscados no servidor (GET /places/search) no catálogo
// próprio (Overture Places + OpenStreetMap, no nosso Postgres). Não trazem dados do app (gente agora, tendência): a lista
// unificada sabe que um item com `source` é um lugar da cidade e renderiza sem medidor de vibe.

/** chips de categoria do overlay (🍻 Bares, 🍔 Comer…); o servidor traduz cada um em tipos de lugar do catálogo */
export const PLACE_CATEGORY_KEYS = ['bar', 'restaurant', 'cafe', 'park', 'shopping', 'show', 'beach', 'museum'] as const;
export type PlaceCategoryKey = (typeof PLACE_CATEGORY_KEYS)[number];

/** tipo fino do lugar, pra rótulo e ícone ("balada", "pub", "casa de show"…) */
export const PLACE_KINDS = [
  'nightclub',
  'pub',
  'bar',
  'cocktail',
  'brewery',
  'lounge',
  'music',
  'theatre',
  'events',
  'nightlife',
  'cafe',
  'fastfood',
  'restaurant',
  'park',
  'mall',
  'museum',
  'gallery',
  'beach',
  'cinema',
  'stadium',
  'campus',
  'landmark',
  'entertainment',
  'other',
] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

/** lugar da cidade vindo da busca (catálogo próprio) */
export interface CatalogPlace {
  /** id estável com a fonte: `ovt:<gers>` (Overture) ou `osm:n123` / `osm:w123` / `osm:r123` (OpenStreetMap) */
  id: string;
  /** nome público (ex.: "Zenaide Bar") */
  name: string;
  /** chip do app em que o lugar cai; null quando não cai em nenhum */
  category: PlaceCategoryKey | null;
  /** tipo fino pra rótulo e ícone */
  kind: PlaceKind;
  /** noite (balada, bar, pub, casa de show): a UI destaca */
  nightlife: boolean;
  address: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  latitude: number;
  longitude: number;
  /** distância (m) ao centro pedido (centro do mapa ou posição do usuário) */
  distanceM: number;
  /** discriminador na lista unificada (lugar do app x lugar da cidade) */
  source: 'catalog';
}

export interface PlaceSearchResponse {
  places: CatalogPlace[];
  /** texto buscado (eco) */
  q: string;
  generatedAt: string;
}

// ---------- Cidade · Bairro e "ir até lá" (GET /geo/label, GET /geo/search) ----------

/** bairro e cidade de um ponto (polígonos do OSM no nosso banco); null quando o ponto está fora das áreas importadas */
export interface GeoLabelResponse {
  city: string | null;
  /** bairro; fora dos bairros, o setor/distrito */
  neighborhood: string | null;
  /** UF (2 letras) */
  state: string | null;
}

/** city = cidade · locality = distrito/vila · neighborhood = bairro · street = rua · address = endereço com número (Photon) */
export type GeoResultType = 'city' | 'locality' | 'neighborhood' | 'street' | 'address';

export interface GeoSearchResult {
  id: string;
  name: string;
  /** "Centro, Uberlândia - MG" */
  context: string;
  type: GeoResultType;
  /** ponto representativo (em cima da rua / dentro da área) */
  lat: number;
  lng: number;
  /** [oeste, sul, leste, norte] pra enquadrar; null quando não tem */
  bbox: [number, number, number, number] | null;
}

export interface GeoSearchResponse {
  results: GeoSearchResult[];
  /** texto buscado (eco) */
  q: string;
}
