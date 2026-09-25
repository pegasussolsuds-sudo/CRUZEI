// Location + Presence + Descoberta por proximidade
//
// Regra (brief PRIVACIDADE): o cliente NUNCA recebe latitude/longitude real, distância numérica, horário preciso,
// direção, velocidade ou histórico de OUTRA pessoa. Sobre os outros só chegam: faixa de proximidade, tipo de
// presença, lugar (quando é seguro) e uma posição VISUAL anonimizada gerada pelo servidor.

export interface LocationPoint {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
}

export interface LocationUpdatePayload extends LocationPoint {
  poiId?: number;
  city?: string;
  state?: string;
}

/** por que EU não estou aparecendo pros outros agora (o servidor decide; o app só informa) */
export type HiddenReason = 'anonymous' | 'private_area' | 'home' | 'nobody' | 'no_presence' | 'paused';

export interface LocationUpdateResponse {
  geohash: string;
  nearbyUsers: number;
  nearbyPois: number;
  expiresAt: string; // ISO
  discoverable: boolean;
  hiddenReason: HiddenReason | null;
}

import type { AvatarConfig } from './avatar';

/** 🟢 muito perto (≤100 m) · 🟢 perto (≤250 m) · 🟡 na região (≤350 m) */
export type ProximityBand = 'very_near' | 'near' | 'region';
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
  isBoosted: boolean; // boost ativo → destaque no mapa
  poi?: { id: number; name: string } | null;
  /** avatar Cruzei (null → o app gera um determinístico a partir do id) */
  avatar?: AvatarConfig | null;
  /** curtida/ match já existentes com quem consulta (pra sheet mostrar 'Curtido' / 'Match') */
  likedByMe?: boolean;
  matchId?: string | null;
}

export interface DiscoveryResponse {
  users: NearbyUser[];
  /** pessoas por perto que existem mas não aparecem (região esparsa) — só o número */
  hiddenCount: number;
  radiusM: number;
  me: { discoverable: boolean; hiddenReason: HiddenReason | null };
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
  rating: number | null;
  totalRatings: number;
  isPartner: boolean;
  partnerOffer: string | null;
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
