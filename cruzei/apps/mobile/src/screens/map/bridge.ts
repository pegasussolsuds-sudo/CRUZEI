// Contrato entre a MapScreen e o mapa nativo (native/NativeMap.tsx + native/engine/MapEngine.ts).
// Nasceu como a ponte RN <-> WebView (mapbox-gl JS); os nomes dos comandos e dos eventos continuam os mesmos, mas agora
// os comandos são objetos tipados entregues direto ao motor (sem JSON nem injectJavaScript) e os eventos chegam por callback.

import type { InvisibleGroup, MapPosition, NearbyUser, POI } from '@cruzei/shared-types';

import type { AvatarDef } from './native/contracts';

export type MapTheme = 'day' | 'dusk' | 'night';
export type PerfTier = 'low' | 'mid' | 'high';
export type InitTier = 'auto' | PerfTier;
export type BurstKind = 'like' | 'super' | 'match';
export type MePremiumTier = 'free' | 'premium' | 'premium_plus';

export interface MeState {
  lat: number;
  lng: number;
  heading: number | null;
  tier: MePremiumTier;
  isBoosted: boolean;
  isAnonymous: boolean;
  photoUrl: string | null;
  name: string;
  /** chave do visual do avatar (defineAvatars) */
  avatarKey: string;
  /** cor 'r,g,b' da poça de luz da aura (mapAuraRgb); '' = sem aura */
  aura: string;
}

/**
 * pessoa como vai pro mapa: NearbyUser + chave do avatar (o motor busca as camadas em avatarDefs[avatarKey]), cor da
 * aura ('r,g,b' de mapAuraRgb, '' = sem),
 * nome curto do rótulo ("Leonardo S."), a foto (thumbnail) da bolha de identidade — null = só avatar — e se os dois
 * se curtiram (anel magenta + selo ♥; calculado no app a partir do likeStatus do /nearby).
 */
export type MapUser = NearbyUser & { avatarKey: string; aura: string; label: string; photo: string | null; mapPosition: MapPosition; mutual: boolean };

/** { avatarKey: mapAvatarDef(cfg) } — só as chaves que o mapa ainda não conhece */
export type AvatarDefs = Record<string, AvatarDef>;

/** reações curtas do avatar no mapa; 'sig' = a animação assinatura do avatar (sem uma escolhida, acena) */
export type EmoteKind = 'wave' | 'like' | 'celebrate' | 'match' | 'arrive' | 'sig';

export interface MapDataPayload {
  users: MapUser[];
  pois: POI[];
  /** mínimo de userCount pra um POI virar hotspot (default 5) */
  hotMin?: number;
}

export interface CameraOpts {
  pitch?: number;
  bearing?: number;
  duration?: number;
}

export interface MapPadding {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

/** pino de lugar da cidade escolhido na busca (bar, balada…): fica no mapa até sair */
export interface PinPayload {
  id: string;
  lat: number;
  lng: number;
  name: string;
  emoji: string;
  /** noite ganha pino rosa; o resto, verde */
  nightlife: boolean;
}

export interface BurstPayload {
  lat: number;
  lng: number;
  kind: BurstKind;
}

// ---------- mapa -> tela ----------

export type MapEvent =
  | { type: 'ready'; tier: PerfTier; fps: number }
  | { type: 'styleLoaded' }
  | { type: 'error'; message: string; fatal: boolean }
  | { type: 'moveend'; lat: number; lng: number; zoom: number; userMoved: boolean }
  | { type: 'userTap'; id: string }
  | { type: 'poiTap'; id: number }
  | { type: 'mapTap' }
  | { type: 'hotspotBorn'; poiId: number; name: string; userCount: number }
  | { type: 'clusterTap'; ids: string[]; lat: number; lng: number }
  | { type: 'matchMomentDone'; userId: string | null; shown: boolean }
  | { type: 'perf'; fps: number }
  | { type: 'pinTap'; id: string }
  /** toque num marcador de gente invisível (só Premium): quantos e o lugar público, nunca quem */
  | { type: 'invisibleTap'; count: number; place: string | null };

// ---------- tela -> mapa ----------

/** Nome do comando — também usado como chave de "último estado" pra reaplicar depois de um 'ready'. */
export type CommandName =
  | 'setTheme'
  | 'setTier'
  | 'setActive'
  | 'setMe'
  | 'setCenter'
  | 'reveal'
  | 'setData'
  | 'select'
  | 'focusPoi'
  | 'setPadding'
  | 'burst'
  | 'defineAvatars'
  | 'matchMoment'
  | 'emote'
  | 'setPin'
  | 'setInvisible';

export type MapCommand =
  | { fn: 'setTheme'; args: [MapTheme, boolean] }
  | { fn: 'setTier'; args: [PerfTier] }
  | { fn: 'setActive'; args: [boolean] }
  | { fn: 'setMe'; args: [MeState] }
  | { fn: 'setCenter'; args: [number, number, number | undefined, CameraOpts | undefined] }
  | { fn: 'reveal'; args: [number, number] }
  | { fn: 'setData'; args: [MapDataPayload] }
  | { fn: 'select'; args: [string | null] }
  | { fn: 'focusPoi'; args: [number] }
  | { fn: 'setPadding'; args: [MapPadding] }
  | { fn: 'burst'; args: [BurstPayload] }
  | { fn: 'defineAvatars'; args: [AvatarDefs] }
  | { fn: 'matchMoment'; args: [{ userId: string }] }
  | { fn: 'emote'; args: [string, EmoteKind] }
  | { fn: 'setPin'; args: [PinPayload | null, boolean] }
  | { fn: 'setInvisible'; args: [InvisibleGroup[] | null] };

/** Builders tipados dos comandos (mesmas assinaturas da época da WebView). */
export const cmd = {
  setTheme: (theme: MapTheme, animate = true): MapCommand => ({ fn: 'setTheme', args: [theme, animate] }),
  setTier: (tier: PerfTier): MapCommand => ({ fn: 'setTier', args: [tier] }),
  setActive: (active: boolean): MapCommand => ({ fn: 'setActive', args: [active] }),
  setMe: (me: MeState): MapCommand => ({ fn: 'setMe', args: [me] }),
  setCenter: (lat: number, lng: number, zoom?: number, opts?: CameraOpts): MapCommand => ({ fn: 'setCenter', args: [lat, lng, zoom, opts] }),
  reveal: (lat: number, lng: number): MapCommand => ({ fn: 'reveal', args: [lat, lng] }),
  setData: (payload: MapDataPayload): MapCommand => ({ fn: 'setData', args: [payload] }),
  select: (id: string | null): MapCommand => ({ fn: 'select', args: [id] }),
  focusPoi: (id: number): MapCommand => ({ fn: 'focusPoi', args: [id] }),
  setPadding: (padding: MapPadding): MapCommand => ({ fn: 'setPadding', args: [padding] }),
  burst: (payload: BurstPayload): MapCommand => ({ fn: 'burst', args: [payload] }),
  defineAvatars: (defs: AvatarDefs): MapCommand => ({ fn: 'defineAvatars', args: [defs] }),
  matchMoment: (userId: string): MapCommand => ({ fn: 'matchMoment', args: [{ userId }] }),
  /** id da pessoa ou 'me' */
  emote: (id: string, kind: EmoteKind): MapCommand => ({ fn: 'emote', args: [id, kind] }),
  /** crava (ou tira, com null) o pino do lugar escolhido; fly = câmera voa até lá com o pino caindo */
  setPin: (pin: PinPayload | null, fly = false): MapCommand => ({ fn: 'setPin', args: [pin, fly] }),
  /** gente invisível por perto (só Premium; null/[] = nada): um marcador por lugar ou quadra, nunca uma pessoa */
  setInvisible: (groups: InvisibleGroup[] | null): MapCommand => ({ fn: 'setInvisible', args: [groups] }),
} as const;
