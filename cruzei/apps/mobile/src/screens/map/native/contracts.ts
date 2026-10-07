// Contratos compartilhados do mapa nativo (@maplibre/maplibre-react-native). Porta fiel das constantes de geometria do antigo
// mapbox-html.ts (WebView) — o visual das figuras, bolhas e ícones tem de bater pixel a pixel com o de antes.
//
// Quem usa:
//   images/draw.ts    desenha as imagens (Skia raster, CPU) a partir destes tamanhos
//   engine/*          calcula offsets de ícone (icon-offset) com as mesmas funções
//   layers.tsx        registra as imagens no <Images> com scale IMG_SCALE

import type { AvatarConfig } from '@cruzei/shared-types';
import { PixelRatio } from 'react-native';

import type { AvatarLayer, AvatarRig } from '../../../avatar';
import type { Pose, PoseVariation } from '../../../avatar/pose';

/** pose do rig e variação individual: a fonte é src/avatar/pose.ts (mesma do palco Skia e da folha de contato) */
export type { Pose, PoseVariation };

/**
 * camadas + pivôs de um visual de avatar (images/mapAvatar.ts mapAvatarDef): l = camadas no nível 'lite', p = rig
 * (p.scene = cena resolvida: a montaria vem daqui), e = animação assinatura (id do registro de emotes, null = nenhuma),
 * c = a config (o motor monta sob demanda as expressões/objeto da animação e o braço solto)
 */
export interface AvatarDef {
  l: AvatarLayer[];
  p: AvatarRig;
  e?: string | null;
  c?: AvatarConfig;
}

/**
 * estados da figura: os do CZ_ANIM + 'ride' (com veículo, andar vira deslizar com balanço leve; flutuante sobe e desce)
 * + 'sig' (a animação assinatura do avatar, uma vez: toque na figura, avatar salvo)
 */
export type AnimState = 'idle' | 'walk' | 'run' | 'wave' | 'like' | 'celebrate' | 'match' | 'arrive' | 'ride' | 'sig';
export type EmoteState = 'wave' | 'like' | 'celebrate' | 'match' | 'arrive' | 'sig';

/** chave da aura do config do avatar (catalog) */
export type AuraKey = 'lime' | 'magenta' | 'gold' | 'fest';

/** o que muda a aparência da figura além do visual do avatar (antiga avatarSignature) */
export interface FigureLook {
  /** presença recente (≤ 15 min): anel lima; senão dourado */
  recent: boolean;
  boosted: boolean;
  premiumTier: 'free' | 'premium' | 'premium_plus';
  verified: boolean;
  /**
   * cor da poça de luz da aura do avatar, rgb 'r,g,b' (images/mapAvatar.ts mapAuraRgb: a cor escolhida em auraColor ou
   * a cor própria do efeito); '' = sem aura. Aceita também as chaves antigas (lime/magenta/gold/fest).
   */
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
 * (a WebView limitava o DPR a 2): bitmap a 2x num aparelho de ~2,6 sairia ampliado e borrado. Arredonda pra 2 / 2,5
 * (todos os tamanhos lógicos viram pixels inteiros) e limita a 2,5 pela memória de textura e pelo raster: a figura fica a
 * ~0,8x do tamanho lógico no z16, então 2,5 já sobra num painel de 3x+ (e é 31% menos pixel por imagem que 3x). O S23
 * (2,625) segue em 2,5.
 */
export const IMG_SCALE = Math.min(2.5, Math.max(2, Math.round(PixelRatio.get() * 2) / 2));

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

/** cores rgb das auras antigas (mapbox-html.ts:345) */
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
/** opções de um quadro da figura */
export interface FigureOpts {
  /**
   * a animação usa os braços (com volante/guidão/pet no colo, a cena só segura as mãos quando ela não usa). Número 0..1 =
   * peso (a mão sai do guidão e volta aos poucos na entrada/saída da animação). Ausente = deduz pela pose (braço erguido
   * além de 45°).
   */
  usesArms?: boolean | number;
  /** silhueta colorida (def null): cor da roupa no corpo e tom de pele na cabeça, em vez do manequim cinza */
  tint?: { body: string; skin: string };
}

export interface MapDraw {
  /**
   * figura em pé (mapbox-html.ts:391 drawFigure): aura no chão, avatar (pose ou neutro; cabeça MAP_HEAD_SCALE), anel,
   * selo, véu anônimo; def null = silhueta
   */
  figure(def: AvatarDef | null, look: FigureLook, dim: Dim, pose: Pose | null, mirror: boolean, opts?: FigureOpts): Uint8Array | null;
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
