// Contratos compartilhados do mapa nativo (@maplibre/maplibre-react-native). Porta fiel das constantes de geometria do antigo
// mapbox-html.ts (WebView) — o visual das figuras, bolhas e ícones tem de bater pixel a pixel com o de antes.
//
// Quem usa:
//   images/draw.ts    desenha as imagens (Skia raster, CPU) a partir destes tamanhos
//   engine/*          calcula offsets de ícone (icon-offset) com as mesmas funções
//   layers.tsx        registra as imagens no <Images> com scale IMG_SCALE

import { PixelRatio } from 'react-native';

import type { AvatarLayer, AvatarRig } from '../../../avatar';

/** camadas + pivôs de um visual de avatar (o que o antigo defineAvatars mandava pro WebView) */
export interface AvatarDef {
  l: AvatarLayer[];
  p: AvatarRig;
}

export type AnimState = 'idle' | 'walk' | 'run' | 'wave' | 'like' | 'celebrate' | 'match' | 'arrive';
export type EmoteState = 'wave' | 'like' | 'celebrate' | 'match' | 'arrive';

/** pose do rig (graus e px do viewBox 100x140), igual ao CZ_ANIM do WebView */
export interface Pose {
  body: { r: number; dy: number; sx: number; sy: number };
  head: { r: number; dy: number };
  armL: { r: number };
  armR: { r: number };
  legL: { r: number };
  legR: { r: number };
  shadow: { s: number };
}

/** variação individual (hash do id): fase, velocidade da respiração, energia */
export interface PoseVariation {
  ph: number;
  sp: number;
  en: number;
}

/** chave da aura do config do avatar (catalog) */
export type AuraKey = 'lime' | 'magenta' | 'gold' | 'fest';

/** o que muda a aparência da figura além do visual do avatar (antiga avatarSignature) */
export interface FigureLook {
  /** presença recente (≤ 15 min): anel lima; senão dourado */
  recent: boolean;
  boosted: boolean;
  premiumTier: 'free' | 'premium' | 'premium_plus';
  verified: boolean;
  /** aura escolhida no avatar ('' = nenhuma) */
  aura: string;
  /** modo invisível (só eu me vejo): véu escuro por cima */
  anonymous: boolean;
}

/** tamanho lógico (px CSS / dp) de uma imagem; o bitmap é desenhado a 2x */
export interface Dim {
  w: number;
  h: number;
}

/**
 * fator de densidade dos bitmaps (o <Images> recebe scale: IMG_SCALE). O mapa nativo desenha na densidade real da tela
 * (a WebView limitava o DPR a 2): bitmap a 2x num aparelho de ~2,6 sairia ampliado e borrado. Arredonda pra 2 / 2,5 / 3
 * (todos os tamanhos lógicos viram pixels inteiros) e limita a 3 pela memória de textura.
 */
export const IMG_SCALE = Math.min(3, Math.max(2, Math.round(PixelRatio.get() * 2) / 2));

// tamanhos lógicos (mapbox-html.ts:324)
export const IMG = {
  fig: { w: 72, h: 112 } as Dim,
  figBoost: { w: 96, h: 150 } as Dim,
  bubble: { w: 56, h: 62 } as Dim,
  poi: 44,
  sonar: 120,
  ring: 72,
  aura: 110,
} as const;

/** margem em cima (pulos/braços levantados) e embaixo (poça de luz da aura) */
export const FIG_TOP = 14;
export const FIG_PAD = 18;

/** bolha de identidade: círculo de 42 px dentro de 56x62 (margem pra sombra/brilho + rabicho até y=53) */
export const BUB = { d: 42, cx: 28, cy: 27, tip: 53 } as const;

export function figScale(dim: Dim): number {
  return (dim.h - FIG_TOP - FIG_PAD) / 140;
}
/** distância (px da imagem) entre o pé (y=134 do viewBox) e a base da imagem: icon-offset y com âncora bottom */
export function figOffset(dim: Dim): number {
  return dim.h - (FIG_TOP + 134 * figScale(dim));
}
/** y do topo da cabeça relativo ao pé (negativo, px da imagem da figura); 4 unidades de folga pra chapéu/cabelo */
export function headTop(dim: Dim): number {
  return figOffset(dim) - dim.h + FIG_TOP + 4 * figScale(dim);
}
/** icon-offset y da bolha (âncora bottom): a ponta do rabicho fica 2 px acima da cabeça */
export function bubbleOffset(dim: Dim): number {
  return headTop(dim) - 2 + (IMG.bubble.h - BUB.tip);
}

/** estilo da bolha por estado (mapbox-html.ts:528-536) */
export interface BubbleStyle {
  /** diâmetro px CSS */
  d: number;
  ring: string;
  ringW: number;
  glow: string | null;
  dot: string | null;
  badge: 'new' | 'match' | null;
  tail: boolean;
}

/** cores rgb das auras (mapbox-html.ts:345) */
export const AURA_RGB: Record<AuraKey, string> = { lime: '127,255,0', magenta: '255,20,147', gold: '255,215,0', fest: '255,111,177' };

/** emoji por categoria de POI (mapbox-html.ts:341) */
export const CAT_EMOJI: Record<string, string> = {
  bar: '🍺',
  restaurant: '🍽️',
  cafe: '☕',
  park: '🌳',
  shopping: '🏬',
  gym: '🏋️',
  show: '🎸',
  event: '⚡',
  beach: '🏖️',
  museum: '🏛️',
  other: '📍',
};

/** imagem pronta pro <Images>: caminho absoluto no disco (sem file://) + densidade */
export interface MapImageRef {
  path: string;
  scale: number;
}

/**
 * entrada do <Images> do MLRN pra arquivo local: `source` passa direto pelo Image.resolveAssetSource (objeto volta como
 * está) e chega no nativo como {uri, scale}; o DownloadMapImageTask transforma '/...' em file:// (Fresco) e marca a
 * densidade do bitmap com o scale
 */
export interface MapImageEntry {
  source: { uri: string; scale: number };
}

/**
 * API de desenho (images/draw.ts). Tudo em Skia RASTER (Skia.Surface.Make, CPU): nada de MakeOffscreen/GPU —
 * o Moto g54 tem histórico de queda no driver GL. Cada função devolve o PNG (bitmap a IMG_SCALE) ou null se falhar.
 */
export interface MapDraw {
  /** figura em pé (mapbox-html.ts:391 drawFigure): aura no chão, avatar (pose ou neutro), anel, selo, véu anônimo; def null = silhueta */
  figure(def: AvatarDef | null, look: FigureLook, dim: Dim, pose: Pose | null, mirror: boolean): Uint8Array | null;
  /** bolha de identidade (identity-bubble.ts drawBubble) em IMG.bubble; photo = thumb já recortado (null = placeholder) */
  bubble(photo: unknown | null, style: BubbleStyle): Uint8Array | null;
  /** ícone de POI 44x44 (mapbox-html.ts:629) */
  poi(p: { category: string; hot: boolean; isEvent: boolean; isPartner: boolean }): Uint8Array | null;
  /** pino do lugar da busca 60x80 (mapbox-html.ts:1317) */
  pin(p: { emoji: string; nightlife: boolean }): Uint8Array | null;
  /** ícone 'pessoas' do cluster 32x32 (mapbox-html.ts:861) */
  peopleIcon(): Uint8Array | null;
  /** cone de direção 72x72 (mapbox-html.ts:866) */
  meCone(): Uint8Array | null;
  /**
   * brilho radial estático (a parte parada dos antigos sonar/anel/pino/aura; os anéis que pulsam viram CircleLayer):
   * círculo de raio `radius` (px CSS) centrado numa imagem size x size, cor rgb 'r,g,b', alfa do centro `alpha0`
   * caindo a 0 na borda; `inner` = raio (px) onde o gradiente começa (aura começa em 35% do raio).
   */
  glow(size: number, rgb: string, alpha0: number, radius: number, inner?: number): Uint8Array | null;
}
