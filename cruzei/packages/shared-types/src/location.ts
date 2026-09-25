// Location + Presence

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

export interface LocationUpdateResponse {
  geohash: string;
  nearbyUsers: number;
  nearbyPois: number;
  expiresAt: string; // ISO
}

import type { AvatarConfig } from './avatar';

export interface NearbyUser {
  id: string;
  name: string; // "anônimo" quando isAnonymous
  age: number | null; // null quando anônimo ou showAge=false
  mainPhotoUrl: string | null;
  /**
   * foto (thumbnail) pra bolha de identidade NO MAPA — null quando a pessoa desligou "mostrar minha foto no mapa"
   * ou não tem foto. O perfil/sheet usa mainPhotoUrl; o mapa usa SÓ este campo.
   */
  mapPhotoUrl: string | null;
  /** conta criada há menos de 7 dias (selo "novo por aqui") */
  isNew: boolean;
  latitude: number;
  longitude: number;
  /** aproximada (degraus 50/100/250/500 m, 1 km…); null quando a pessoa desligou "mostrar distância" */
  distanceM: number | null;
  recordedAt: string | null;
  isAnonymous: boolean;
  isOnline: boolean;
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
