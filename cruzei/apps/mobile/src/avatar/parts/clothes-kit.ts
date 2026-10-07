// Motor das roupas de cima (dono: guarda-roupa, parte de cima): tabela das peças, tons por material, corte do tronco
// (decote, cava, barra), volume e dobras, gola, botões, bolsos e mangas que giram com o braço. As peças em si ficam em
// clothes-tops.ts (31 partes de cima), clothes-outer.ts (sobreposições) e clothes-neck.ts (pescoço); clothes.ts orquestra.
//
// Regras (STYLE.md): tudo sai dos contornos da anatomia (torsoPts/torsoXAt/upperArmPath/forearmPath/limbWidthAt), nunca
// de números do boneco antigo. Dobras nascem nos pontos de tensão (axila, cintura, cotovelo), poucas, curtas e na
// diagonal — nada de grade ("tanquinho"); no 'lite' (mapa e miniaturas) somem vinco, costura, trama e brilho miúdo.

import type { AvatarConfig } from '@cruzei/shared-types';

import { armAxis, forearmPath, hashUnit, limbWidthAt, smoothPath, taperPath, torsoPath, torsoProfile, torsoPts, torsoXAt, upperArmPath, type Anatomy, type Side, type SP } from '../anatomy';
import type { LayerCtx } from '../ctx';
import { circle, fmt, luminance, shade } from '../geometry';
import { blob, creases, cylGradient, isLite, lum, mix, rimLit, saturate, skinTones, type SkinTones } from '../shading';
import type { AvatarGradient, AvatarGroup, AvatarStop, Pt } from '../types';

export const SIDES: readonly Side[] = ['L', 'R'];
export const NONE = 'none';
/** sinal do lado de FORA do corpo na tela (L = esquerda = −1) */
export const og = (s: Side): number => (s === 'L' ? -1 : 1);
export const armG = (s: Side): AvatarGroup => (s === 'L' ? 'armL' : 'armR');
export const foreG = (s: Side): AvatarGroup => (s === 'L' ? 'foreL' : 'foreR');

// ===============================================================================================================
// Tabela das peças
// ===============================================================================================================

export type Mat = 'cotton' | 'knit' | 'rib' | 'pique' | 'linen' | 'satin' | 'sequin' | 'denim' | 'leather' | 'nylon' | 'metal' | 'holo' | 'tech' | 'velvet' | 'mesh' | 'wool' | 'chiffon';
/** comprimento da manga: none · short (meio do braço) · elbow · three4 (meio do antebraço) · rolled (dobrada abaixo do cotovelo) · long · bell (sino até o pulso) · wide (kimono) */
export type SleeveLen = 'none' | 'short' | 'elbow' | 'three4' | 'rolled' | 'long' | 'bell' | 'wide';
export type NeckKind = 'crew' | 'v' | 'scoop' | 'boat' | 'square' | 'collar' | 'open' | 'turtle' | 'mock' | 'hood' | 'jacket';
export type Cuff = 'hem' | 'rib' | 'button' | 'roll' | 'bell' | 'band' | 'puff' | 'none';
export type Folds = 'tee' | 'soft' | 'crisp' | 'flow' | 'stiff' | 'none';

export interface TopDef {
  sl: SleeveLen;
  mat: Mat;
  /** folga do tronco ('tee' = caimento da pessoa) */
  ease: number | 'tee';
  /** caimento: 0 = segue a cintura … 1 = cai reto do peito ao quadril */
  drape: number;
  /** barra: número = quadril + n; 'tee' = barra da camiseta; 'crop' = acima do umbigo; 'bodice' = cintura (vestido) */
  hem: number | 'tee' | 'crop' | 'bodice';
  neck: NeckKind;
  /** profundidade do decote no meio e largura extra (unidades) */
  depth?: number;
  nw?: number;
  cuff?: Cuff;
  /** folga e alargamento da manga */
  sEase?: number;
  flare?: number;
  /** a pele do tronco aparece (decote fundo, sem manga, cropped) */
  skin?: boolean;
  /** sem manga: largura da alça no ombro (unidades) e quanto a cava desce abaixo da axila */
  strap?: number;
  armhole?: number;
  folds: Folds;
  hemBand?: 'hem' | 'rib' | 'tail' | 'band' | 'none';
}

export const TOPS: Record<string, TopDef> = {
  tee: { sl: 'short', mat: 'cotton', ease: 'tee', drape: 0.8, hem: 'tee', neck: 'crew', cuff: 'hem', folds: 'tee', hemBand: 'hem' },
  tank: { sl: 'none', mat: 'rib', ease: 0.3, drape: 0.35, hem: 1.4, neck: 'scoop', depth: 3.8, nw: 1.0, strap: 2.6, armhole: 2.2, skin: true, folds: 'soft', hemBand: 'hem' },
  polo: { sl: 'short', mat: 'pique', ease: 0.7, drape: 0.7, hem: 1.8, neck: 'collar', cuff: 'rib', sEase: 0.4, folds: 'soft', hemBand: 'hem' },
  shirt: { sl: 'long', mat: 'cotton', ease: 0.85, drape: 0.75, hem: 2.6, neck: 'collar', cuff: 'button', sEase: 0.55, folds: 'crisp', hemBand: 'tail' },
  hoodie: { sl: 'long', mat: 'knit', ease: 1.3, drape: 0.95, hem: 2.4, neck: 'hood', cuff: 'rib', sEase: 0.85, folds: 'soft', hemBand: 'rib' },
  sweater: { sl: 'long', mat: 'knit', ease: 1.0, drape: 0.85, hem: 1.6, neck: 'crew', depth: 0.3, cuff: 'rib', sEase: 0.75, folds: 'soft', hemBand: 'rib' },
  jacket: { sl: 'long', mat: 'cotton', ease: 1.2, drape: 0.9, hem: 1.5, neck: 'jacket', cuff: 'band', sEase: 0.85, folds: 'crisp', hemBand: 'band' },
  crop: { sl: 'short', mat: 'cotton', ease: 0.45, drape: 0.25, hem: 'crop', neck: 'crew', depth: 0.3, cuff: 'hem', sEase: 0.35, skin: true, folds: 'soft', hemBand: 'hem' },
  dress: { sl: 'none', mat: 'chiffon', ease: 0.35, drape: 0, hem: 'bodice', neck: 'v', depth: 5.2, nw: 0.4, strap: 2.6, armhole: 1.6, skin: true, folds: 'flow' },
  neon_jacket: { sl: 'long', mat: 'nylon', ease: 1.15, drape: 0.9, hem: 1.4, neck: 'mock', cuff: 'band', sEase: 0.85, folds: 'crisp', hemBand: 'band' },
  jersey: { sl: 'short', mat: 'mesh', ease: 0.95, drape: 0.85, hem: 2.4, neck: 'v', depth: 3.6, cuff: 'band', sEase: 0.6, flare: 0.15, folds: 'soft', hemBand: 'hem' },
  striped: { sl: 'three4', mat: 'cotton', ease: 0.75, drape: 0.8, hem: 1.8, neck: 'boat', nw: 2.6, depth: 0.5, cuff: 'hem', sEase: 0.45, skin: true, folds: 'soft', hemBand: 'hem' },
  graphic: { sl: 'short', mat: 'cotton', ease: 0.85, drape: 0.85, hem: 2.0, neck: 'crew', cuff: 'hem', sEase: 0.5, folds: 'soft', hemBand: 'hem' },
  flannel: { sl: 'rolled', mat: 'cotton', ease: 1.05, drape: 0.85, hem: 2.8, neck: 'collar', cuff: 'roll', sEase: 0.7, folds: 'crisp', hemBand: 'tail' },
  turtleneck: { sl: 'long', mat: 'rib', ease: 0.45, drape: 0.4, hem: 1.2, neck: 'turtle', cuff: 'rib', sEase: 0.4, folds: 'soft', hemBand: 'rib' },
  linen: { sl: 'rolled', mat: 'linen', ease: 1.15, drape: 0.9, hem: 2.8, neck: 'open', depth: 4.6, cuff: 'roll', sEase: 0.8, skin: true, folds: 'flow', hemBand: 'tail' },
  blouse: { sl: 'three4', mat: 'chiffon', ease: 0.95, drape: 0.8, hem: 2.0, neck: 'v', depth: 4.2, cuff: 'puff', sEase: 0.8, flare: 0.45, skin: true, folds: 'flow', hemBand: 'hem' },
  tunic: { sl: 'three4', mat: 'linen', ease: 1.3, drape: 1.0, hem: 8.5, neck: 'v', depth: 4.0, nw: 0.6, cuff: 'bell', sEase: 0.85, flare: 1.4, skin: true, folds: 'flow', hemBand: 'hem' },
  oversized: { sl: 'elbow', mat: 'cotton', ease: 2.0, drape: 1.0, hem: 4.4, neck: 'crew', depth: 0.3, cuff: 'hem', sEase: 1.3, flare: 0.4, folds: 'flow', hemBand: 'hem' },
  basket: { sl: 'none', mat: 'mesh', ease: 1.0, drape: 1.0, hem: 4.4, neck: 'scoop', depth: 3.0, nw: 0.5, strap: 3.0, armhole: 4.2, skin: true, folds: 'soft', hemBand: 'band' },
  hawaiian: { sl: 'short', mat: 'linen', ease: 1.15, drape: 0.95, hem: 2.6, neck: 'open', depth: 4.2, cuff: 'hem', sEase: 0.75, flare: 0.25, skin: true, folds: 'flow', hemBand: 'hem' },
  pride_tee: { sl: 'short', mat: 'cotton', ease: 'tee', drape: 0.8, hem: 'tee', neck: 'crew', cuff: 'hem', folds: 'soft', hemBand: 'hem' },
  tux: { sl: 'long', mat: 'wool', ease: 0.95, drape: 0.6, hem: 3.4, neck: 'jacket', cuff: 'button', sEase: 0.7, folds: 'stiff', hemBand: 'none' },
  gown: { sl: 'none', mat: 'satin', ease: 0.3, drape: 0, hem: 'bodice', neck: 'v', depth: 4.6, skin: true, strap: 2.2, armhole: 1.6, folds: 'flow' },
  satin: { sl: 'long', mat: 'satin', ease: 1.0, drape: 0.85, hem: 2.8, neck: 'open', depth: 3.6, cuff: 'button', sEase: 0.75, skin: true, folds: 'flow', hemBand: 'tail' },
  sequin: { sl: 'none', mat: 'sequin', ease: 0.3, drape: 0.2, hem: 1.2, neck: 'square', depth: 3.4, nw: 0.8, strap: 1.5, armhole: 2.6, skin: true, folds: 'none', hemBand: 'none' },
  cyber: { sl: 'none', mat: 'tech', ease: 0.35, drape: 0.3, hem: 1.0, neck: 'mock', strap: 5.0, armhole: 1.4, skin: true, folds: 'none', hemBand: 'band' },
  armor: { sl: 'long', mat: 'metal', ease: 1.3, drape: 0.5, hem: 3.4, neck: 'mock', cuff: 'band', sEase: 0.95, folds: 'none', hemBand: 'none' },
  wizard: { sl: 'bell', mat: 'wool', ease: 1.35, drape: 1.0, hem: 'bodice', neck: 'v', depth: 4.2, cuff: 'bell', sEase: 0.95, flare: 3.0, skin: true, folds: 'flow', hemBand: 'none' },
  royal: { sl: 'long', mat: 'velvet', ease: 0.95, drape: 0.6, hem: 3.6, neck: 'mock', cuff: 'band', sEase: 0.75, folds: 'stiff', hemBand: 'band' },
  holo: { sl: 'long', mat: 'holo', ease: 1.1, drape: 0.9, hem: 1.4, neck: 'mock', cuff: 'band', sEase: 0.85, folds: 'crisp', hemBand: 'band' },
};

export function topDef(cfg: AvatarConfig): TopDef {
  return TOPS[cfg.top] ?? TOPS.tee;
}

export interface OuterDef {
  sl: SleeveLen;
  mat: Mat;
  ease: number;
  /** barra: quadril + n */
  hem: number;
  cuff: Cuff;
  sEase: number;
}

export const OUTERS: Record<string, OuterDef> = {
  blazer: { sl: 'long', mat: 'wool', ease: 1.3, hem: 3.8, cuff: 'button', sEase: 1.0 },
  cardigan: { sl: 'long', mat: 'knit', ease: 1.4, hem: 3.0, cuff: 'rib', sEase: 0.85 },
  vest: { sl: 'none', mat: 'wool', ease: 0.95, hem: 1.4, cuff: 'none', sEase: 0 },
  denim: { sl: 'long', mat: 'denim', ease: 1.55, hem: 0.4, cuff: 'button', sEase: 1.2 },
  leather: { sl: 'long', mat: 'leather', ease: 1.45, hem: 0.6, cuff: 'band', sEase: 1.1 },
  bomber: { sl: 'long', mat: 'nylon', ease: 1.9, hem: 0.4, cuff: 'rib', sEase: 1.5 },
  varsity: { sl: 'long', mat: 'wool', ease: 1.65, hem: 0.8, cuff: 'rib', sEase: 1.3 },
  trench: { sl: 'long', mat: 'cotton', ease: 1.55, hem: 22, cuff: 'band', sEase: 1.2 },
  puffer: { sl: 'long', mat: 'nylon', ease: 2.6, hem: 1.6, cuff: 'band', sEase: 2.0 },
  kimono: { sl: 'wide', mat: 'satin', ease: 1.5, hem: 11, cuff: 'band', sEase: 1.3 },
  cape: { sl: 'none', mat: 'satin', ease: 1.0, hem: 0, cuff: 'none', sEase: 0 },
  mecha: { sl: 'none', mat: 'metal', ease: 0.8, hem: 0, cuff: 'none', sEase: 0 },
  mantle: { sl: 'none', mat: 'velvet', ease: 1.0, hem: 0, cuff: 'none', sEase: 0 },
};

export function outerDef(cfg: AvatarConfig): OuterDef | null {
  const id = cfg.outer;
  return id && id !== NONE ? (OUTERS[id] ?? null) : null;
}

/** sobreposições que têm frente (painéis abertos por cima da parte de cima) */
export const FRONT_OUTERS = new Set(['blazer', 'cardigan', 'vest', 'denim', 'leather', 'bomber', 'varsity', 'trench', 'puffer', 'kimono']);

// ===============================================================================================================
// Tons e materiais
// ===============================================================================================================

export interface Tone {
  light: string;
  base: string;
  shade: string;
  deep: string;
  bounce: string;
}

/** tons de tecido: luz, base, sombra, fundo (sombra fria e um pouco saturada; preto ganha brilho visível) */
export function fabric(c: string): Tone {
  const L = lum(c);
  return {
    light: mix(c, '#FFFFFF', L < 0.03 ? 0.14 : L > 0.7 ? 0.5 : 0.17),
    base: c,
    shade: mix(c, '#0B0816', L > 0.7 ? 0.16 : L < 0.03 ? 0.35 : 0.27),
    deep: mix(c, '#05030C', L > 0.7 ? 0.32 : 0.5),
    bounce: mix(c, '#2A2A48', L > 0.7 ? 0.1 : 0.16),
  };
}

/** tons por material (cetim/couro mais contrastados, malha mais macia, veludo com miolo fundo, metal neutro) */
export function toneOf(c: string, mat: Mat): Tone {
  const L = lum(c);
  switch (mat) {
    case 'satin':
    case 'holo':
      return { light: mix(c, '#FFFFFF', L > 0.7 ? 0.7 : L < 0.05 ? 0.3 : 0.45), base: c, shade: mix(c, '#0B0816', L > 0.7 ? 0.24 : 0.38), deep: mix(c, '#05030C', 0.6), bounce: mix(c, '#4A4A78', 0.22) };
    case 'leather':
      return { light: mix(c, '#FFF6EC', L < 0.03 ? 0.2 : L > 0.7 ? 0.55 : 0.26), base: c, shade: mix(c, '#0A0508', L > 0.7 ? 0.2 : L < 0.03 ? 0.4 : 0.34), deep: mix(c, '#030103', L > 0.7 ? 0.38 : 0.58), bounce: mix(c, '#3A2A30', 0.18) };
    case 'velvet':
      // miolo fundo do veludo, mas proporcional à luminância: em cor clara as sombras fixas viravam um colete cinza
      // chumbo sobre manga branca (o tom do corpo e da manga saem daqui, então os dois casam)
      return L > 0.7
        ? { light: '#FFFFFF', base: mix(c, '#000000', 0.03), shade: mix(c, '#2A2438', 0.2), deep: mix(c, '#1A1626', 0.38), bounce: mix(c, '#FFFFFF', 0.3) }
        : { light: mix(saturate(c, 0.15), '#FFFFFF', 0.26), base: mix(c, '#000000', 0.1), shade: mix(c, '#05030C', 0.46), deep: mix(c, '#000000', 0.66), bounce: mix(c, '#FFFFFF', 0.14) };
    case 'knit':
    case 'rib':
      return { light: mix(c, '#FFFFFF', L > 0.7 ? 0.4 : 0.15), base: c, shade: mix(c, '#0B0816', L > 0.7 ? 0.14 : 0.24), deep: mix(c, '#05030C', L > 0.7 ? 0.3 : 0.46), bounce: mix(c, '#2A2A48', 0.14) };
    case 'nylon':
      return { light: mix(c, '#FFFFFF', L > 0.7 ? 0.6 : 0.32), base: c, shade: mix(c, '#0B0816', L > 0.7 ? 0.2 : 0.34), deep: mix(c, '#05030C', 0.56), bounce: mix(c, '#3A3A60', 0.2) };
    case 'metal':
      return { light: '#F4F6FA', base: mix('#AEB4C0', c, 0.14), shade: '#5E6472', deep: '#2E323C', bounce: '#8A90A0' };
    default:
      return fabric(c);
  }
}

/** gradiente horizontal do tronco (cilindro): borda iluminada à esquerda, sombra própria à direita, luz rebatida */
export function torsoGrad(an: Anatomy, t: Tone, mat: Mat = 'cotton', ease = 0): AvatarGradient {
  const sw = an.w.shoulder + ease;
  const x1 = an.cx - sw;
  const x2 = an.cx + sw;
  let s: AvatarStop[];
  if (mat === 'satin') s = [[0, t.shade], [0.1, t.light], [0.2, mix(t.light, '#FFFFFF', 0.35)], [0.33, t.base], [0.55, t.shade], [0.68, t.base], [0.86, t.deep], [1, t.bounce]];
  else if (mat === 'velvet') s = [[0, t.light], [0.12, t.base], [0.4, t.shade], [0.75, t.deep], [0.92, t.base], [1, t.light]];
  else if (mat === 'leather') s = [[0, t.base], [0.14, t.light], [0.3, t.base], [0.7, t.shade], [0.92, t.deep], [1, t.bounce]];
  else if (mat === 'metal') s = [[0, t.bounce], [0.14, t.light], [0.3, t.base], [0.52, t.shade], [0.62, t.base], [0.84, t.deep], [1, t.bounce]];
  else s = [[0, t.base], [0.16, t.light], [0.42, t.base], [0.82, t.shade], [1, t.bounce]];
  return { t: 'l', x1, y1: 0, x2, y2: 0, s };
}

/** tons de pele (cache leve; o corpo tem o dele, mas importar o corpo criaria ciclo) */
const skinCache = new Map<string, SkinTones>();
export function skinOf(ctx: LayerCtx): SkinTones {
  const k = ctx.col.skin;
  let t = skinCache.get(k);
  if (!t) {
    t = skinTones(k);
    if (skinCache.size > 64) skinCache.clear();
    skinCache.set(k, t);
  }
  return t;
}

/** cor de linha de costura que aparece sobre o tecido */
export function threadOf(c: string): string {
  return lum(c) < 0.05 ? mix(c, '#8A7A60', 0.5) : lum(c) > 0.6 ? mix(c, '#6A5A40', 0.45) : mix(c, '#E8C27A', 0.55);
}

/** cor de contraste pra detalhes (gola de outra cor, estampa) a partir da cor da peça */
export function contrastOf(c: string, a = '#F2EEE6', b = '#1E1E2A'): string {
  return lum(c) > 0.45 ? b : a;
}

/** gerador determinístico 0..1 (semente fixa: nada de Math.random) */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
    return (s >>> 8) / 16777216;
  };
}

export const lerp2 = (a: Pt | SP, b: Pt | SP, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

// ===============================================================================================================
// Caimento e barra
// ===============================================================================================================

/**
 * caimento da camiseta por pessoa (determinístico pelos traços de identidade): justa, normal ou solta. Sempre POR FORA
 * da calça, com a barra 1,5–3 abaixo do cós. 'tucked' fica no tipo só por compatibilidade (nenhuma pessoa recebe).
 */
export type TeeFit = 'fitted' | 'regular' | 'relaxed' | 'tucked';
export function teeFit(cfg: AvatarConfig): TeeFit {
  const u = hashUnit(`${cfg.body}|${cfg.faceShape}|${cfg.eyes}|${cfg.nose}|fit`);
  if (u < 0.42) return 'regular';
  if (u < 0.7) return 'relaxed';
  return 'fitted';
}

export const FIT = {
  fitted: { ease: 0.45, drape: 0.3, hem: 0.6, sleeve: 0.46, sEase: 0.36 },
  regular: { ease: 0.75, drape: 0.8, hem: 1.6, sleeve: 0.5, sEase: 0.45 },
  relaxed: { ease: 1.15, drape: 1.0, hem: 3.0, sleeve: 0.55, sEase: 0.58 },
  tucked: { ease: 0.75, drape: 0.55, hem: 0, sleeve: 0.5, sEase: 0.45 },
} as const;

/** folga da calça no quadril (a peça de cima tem de cobrir o cós e o quadril da calça em todo corpo) */
export const PANTS_EASE = 0.95;

/** altura da barra da camiseta (a calça usa pra começar o quadril logo acima dela: o cós fica escondido) */
export function teeHemY(ctx: LayerCtx): number {
  const { an } = ctx;
  const F = FIT[teeFit(ctx.cfg)];
  let hemY0 = Math.max(an.hipY + F.hem, an.waistY + 1.5 + 2.5);
  // cintura marcada (quadril bem mais largo): a barra pousa no alto do quadril (senão abre em saia/babado)
  if (an.w.hip - an.w.waist > 5) hemY0 = Math.min(hemY0, an.waistY + 5.2 + F.hem * 0.5);
  return an.seated ? Math.min(hemY0, an.hj + 0.9) : hemY0;
}

/** folga do tronco da peça (a camiseta segue o caimento da pessoa; o corpo largo tem menos folga no ombro) */
export function easeOf(ctx: LayerCtx, d: TopDef): number {
  const e = d.ease === 'tee' ? FIT[teeFit(ctx.cfg)].ease : d.ease;
  return e * (ctx.an.bodyId === 'broad' ? 0.7 : 1);
}

/** barra da parte de cima (y) — sentado, nunca passa do colo */
export function hemOf(ctx: LayerCtx, d: TopDef): number {
  const { an } = ctx;
  if (d.hem === 'tee') return teeHemY(ctx);
  if (d.hem === 'crop') return an.waistY - 2.4;
  if (d.hem === 'bodice') return an.waistY + 0.9;
  let y = Math.max(an.hipY + d.hem, an.waistY + 4);
  // cintura marcada: a barra pousa no alto do quadril (senão abre em saia) — menos a ribana, que abraça o quadril
  if (an.w.hip - an.w.waist > 5 && d.hem < 6 && d.hemBand !== 'rib') y = Math.min(y, an.waistY + 5.5 + d.hem * 0.5);
  return an.seated ? Math.min(y, an.hj + 0.9) : y;
}

// ===============================================================================================================
// Corte (tronco da peça, decote, cava)
// ===============================================================================================================

export interface NeckCut {
  w: number;
  depth: number;
  shape: 'round' | 'v' | 'square';
}

export function neckCutOf(an: Anatomy, d: Pick<TopDef, 'neck' | 'depth' | 'nw'>): NeckCut {
  const cw = an.collarW;
  switch (d.neck) {
    case 'v':
      return { w: cw + (d.nw ?? 0), depth: d.depth ?? 5, shape: 'v' };
    case 'open':
      return { w: cw + 0.2, depth: d.depth ?? 4.5, shape: 'v' };
    case 'scoop':
      return { w: cw + (d.nw ?? 1.2), depth: d.depth ?? 3.8, shape: 'round' };
    case 'boat':
      return { w: cw + (d.nw ?? 3), depth: d.depth ?? 0.5, shape: 'round' };
    case 'square':
      return { w: cw + (d.nw ?? 1), depth: d.depth ?? 3.6, shape: 'square' };
    default:
      return { w: cw, depth: d.depth ?? 0, shape: 'round' };
  }
}

export interface Cut {
  /** contorno fechado (pontos) e path */
  pts: SP[];
  d: string;
  /** curva do decote (aberta, do canto esquerdo ao direito) */
  neck: string;
  neckPts: SP[];
  hemY: number;
  ease: number;
  grad: AvatarGradient;
  tone: Tone;
  color: string;
  mat: Mat;
}

/** o lado da peça abaixo da cintura nunca fica pra dentro do quadril da calça (a barra cobre o cós em todo corpo) */
export function coverHip(an: Anatomy, raw: SP[]): SP[] {
  const half = an.w.chest * 0.7;
  return raw.map((p) => {
    if (p[1] < an.waistY + 1 || Math.abs(p[0] - an.cx) < half) return p;
    const side: Side = p[0] < an.cx ? 'L' : 'R';
    const min = torsoXAt(an, side, p[1], PANTS_EASE + 0.2);
    const out = Math.abs(min - an.cx) > Math.abs(p[0] - an.cx) ? min : p[0];
    return (p.length > 2 ? [out, p[1], p[2] as number] : [out, p[1]]) as SP;
  });
}

/** ponto do contorno onde |x − cx| atinge `w`, entre a e b (interpolado) */
function atHalfWidth(cx: number, a: SP, b: SP, w: number): SP {
  const da = Math.abs(a[0] - cx);
  const db = Math.abs(b[0] - cx);
  const t = Math.max(0, Math.min(1, (w - da) / (db - da || 1)));
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * troca o decote da peça (torsoPts com gola careca) por outro: alarga os cantos ao longo da linha do ombro e refaz a
 * curva (redonda, V ou quadrada). `sleeveless`: corta a cava a partir da alça de largura `strap`.
 */
export function reshape(an: Anatomy, raw: SP[], nk: NeckCut, sleeveless: { strap: number; drop: number; ease: number } | null): { pts: SP[]; neckPts: SP[] } {
  const cx = an.cx;
  const body = raw.slice(0, -3);
  const n = body.length;
  let iHem = 0;
  for (let i = 0; i < n; i++) if (body[i][1] > body[iHem][1]) iHem = i;
  const left = body.slice(0, iHem + 1);
  const right = body.slice(iHem).reverse();
  const fix = (chain: SP[], side: Side): SP[] => {
    const g = og(side);
    const out: SP[] = [];
    let i = 0;
    if (Math.abs(chain[0][0] - cx) >= nk.w) out.push([cx + g * nk.w, chain[0][1] + 0.1, 0.4]);
    else {
      while (i < chain.length - 1 && Math.abs(chain[i + 1][0] - cx) < nk.w && chain[i + 1][1] < an.armpitY) i++;
      const c = atHalfWidth(cx, chain[i], chain[Math.min(i + 1, chain.length - 1)], nk.w);
      out.push([c[0], c[1], 0.4]);
      i++;
    }
    if (sleeveless) {
      // alça: do canto do decote até `strap` pra fora, pela linha do ombro; depois a cava desce em curva até o flanco
      const so = nk.w + sleeveless.strap;
      while (i < chain.length - 1 && Math.abs(chain[i][0] - cx) < so && chain[i][1] < an.armpitY) {
        out.push(chain[i]);
        i++;
      }
      const sp0 = out[out.length - 1];
      const nxt = chain[Math.min(i, chain.length - 1)];
      const s = Math.abs(nxt[0] - cx) >= so && nxt[1] < an.armpitY ? atHalfWidth(cx, sp0, nxt, so) : ([cx + g * so, sp0[1] + 0.3] as SP);
      out.push([s[0], s[1], 0.35]);
      const yA = an.armpitY + sleeveless.drop;
      const xA = torsoXAt(an, side, yA, sleeveless.ease);
      out.push([cx + g * (so - 0.3), s[1] + (yA - s[1]) * 0.42]);
      out.push([cx + g * (so + (Math.abs(xA - cx) - so) * 0.45), s[1] + (yA - s[1]) * 0.84]);
      out.push([xA, yA, 0.6]);
      while (i < chain.length && chain[i][1] <= yA + 0.3) i++;
    }
    for (; i < chain.length; i++) out.push(chain[i]);
    return out;
  };
  const L = fix(left, 'L');
  const R = fix(right, 'R');
  const cl = L[0];
  const cr = R[0];
  const yS = (cl[1] + cr[1]) / 2;
  const yC = an.collarY + nk.depth;
  const w = nk.w;
  let mid: SP[];
  if (nk.shape === 'v') mid = [[cx + w * 0.5, yS + (yC - yS) * 0.46], [cx, yC, 0], [cx - w * 0.5, yS + (yC - yS) * 0.46]];
  else if (nk.shape === 'square') mid = [[cx + w * 0.86, yC - 0.5, 0.35], [cx, yC], [cx - w * 0.86, yC - 0.5, 0.35]];
  else mid = [[cx + w * 0.62, yS + (yC - yS) * 0.72], [cx, yC], [cx - w * 0.62, yS + (yC - yS) * 0.72]];
  const pts: SP[] = [...L, ...R.slice(0, -1).reverse(), ...mid];
  const neckPts: SP[] = [[cl[0], cl[1]], ...mid.slice().reverse(), [cr[0], cr[1]]];
  return { pts, neckPts };
}

/**
 * barra viva: a barra acompanha a barriga e o quadril e ondula de leve (nada de filete reto duro). Mexe só nos pontos
 * da barra (abaixo da cintura, longe das laterais).
 */
function liveHem(an: Anatomy, pts: SP[], hemY: number, seed: number): SP[] {
  const r = rng(seed);
  const half = an.w.waist * 0.85;
  return pts.map((p) => {
    if (p[1] < hemY - 1.2 || Math.abs(p[0] - an.cx) > half) return p;
    const dy = (r() - 0.5) * 0.45;
    return (p.length > 2 ? [p[0], p[1] + dy, p[2] as number] : [p[0], p[1] + dy]) as SP;
  });
}

/** corte da parte de cima (contorno, decote, barra, gradiente) */
export function topCut(ctx: LayerCtx): Cut {
  const { an, cfg } = ctx;
  const d = topDef(cfg);
  const ease = easeOf(ctx, d);
  const hemY = hemOf(ctx, d);
  const color = ctx.col.top;
  const tone = toneOf(color, d.mat);
  // barriga cheia: a barra SOBE ~0,8 no meio da frente (a barriga projeta e puxa o tecido)
  const belly = Math.min(1, an.spec.belly / 3);
  const hem = d.hem === 'bodice' ? 0.6 : an.seated ? 1.1 : (d.hemBand === 'tail' ? 1.4 : 0.85) - belly * 1.65;
  // corpo cheio: a peça acompanha peito e barriga (cair reto do peito ao quadril vira caixa); cintura marcada: sugere a
  // cintura em vez de cair como tenda
  const curvy = an.w.hip - an.w.waist > 5;
  // cintura marcada: a peça justa sugere a cintura; a SOLTA (camiseta, malha, veludo, drape alto) cai quase reta do busto
  // ao quadril — seguir a cintura fina e abrir na barra virava espartilho/peplum com quinas no quadril
  const loose = d.ease === 'tee' || d.drape >= 0.6;
  const drape = d.drape * (an.spec.belly > 1.5 ? 0.35 : curvy ? (loose ? 0.68 : 0.35) : 1);
  const raw = torsoPts(an, { bottom: hemY, ease, hem, collar: true, drape, round: d.hem === 'bodice' ? 0.4 : 1.0 });
  const covered = d.hem === 'crop' || d.hem === 'bodice' ? raw : coverHip(an, raw);
  const nk = neckCutOf(an, d);
  const sleeveless = d.sl === 'none' ? { strap: d.strap ?? 3, drop: d.armhole ?? 2, ease } : null;
  const shaped = reshape(an, covered, nk, sleeveless);
  const pts = d.hem === 'bodice' ? shaped.pts : liveHem(an, shaped.pts, hemY, 11 + cfg.top.length);
  return { pts, d: smoothPath(pts), neck: smoothPath(shaped.neckPts, false), neckPts: shaped.neckPts, hemY, ease, grad: torsoGrad(an, tone, d.mat, ease), tone, color, mat: d.mat };
}

/** pele do tronco por baixo da peça (decote fundo, sem manga, cropped): volume do peito e das clavículas */
export function skinUnder(ctx: LayerCtx, bottom?: number): string {
  const t = skinOf(ctx);
  const { an } = ctx;
  const { cx } = an;
  const d = torsoPath(an, bottom != null ? { bottom, hem: 0.3 } : {});
  ctx.withGroup('body', () => {
    ctx.push(d, t.base, { gf: { t: 'l', x1: cx - an.w.chest, y1: 0, x2: cx + an.w.chest, y2: 0, s: [[0, t.light], [0.38, t.base], [0.85, t.shade], [1, t.shade]] } });
    const cv = 0.6 + an.spec.chestVol * 0.6;
    ctx.push(
      taperPath([[cx - an.w.chest + 2, an.armpitY + 4.6], [cx - 3, an.armpitY + 6.2], [cx - 0.5, an.armpitY + 5.6]], [0, 0.8 * cv, 0]) + taperPath([[cx + an.w.chest - 2, an.armpitY + 4.6], [cx + 3, an.armpitY + 6.2], [cx + 0.5, an.armpitY + 5.6]], [0, 0.8 * cv, 0]),
      t.deep,
      { o: 0.2, b: 0.6, cp: d },
    );
    // clavículas (luz fina) e o esterno
    ctx.push(
      taperPath([[cx - an.collarW - 1.5, an.collarY - 2.0], [cx - 3.2, an.collarY - 0.6], [cx - 1.0, an.collarY + 0.2]], [0, 0.6, 0]) + taperPath([[cx + an.collarW + 1.5, an.collarY - 2.0], [cx + 3.2, an.collarY - 0.6], [cx + 1.0, an.collarY + 0.2]], [0, 0.6, 0]),
      t.lighter,
      { o: 0.3, b: 0.3, cp: d },
    );
    ctx.push(blob(cx + 0.3, an.collarY + 3.2, 0.5, 2.2), t.deep, { o: 0.14, b: 0.6, cp: d });
    if (bottom == null || bottom > an.waistY + 2) ctx.push(blob(cx, an.waistY + 2.4, 0.45, 0.65), t.deep, { o: 0.45, cp: d });
  });
  return d;
}

/** sombra da peça sobre a pele logo abaixo de uma borda (decote, cava, barra do cropped): recortada na pele */
export function edgeShadow(ctx: LayerCtx, edge: readonly SP[], clip: string, w = 1.2, o = 0.3): void {
  const ws = edge.map((_, i) => (i === 0 || i === edge.length - 1 ? w * 0.5 : w));
  ctx.push(taperPath(edge.map((p) => [p[0], p[1] + w * 0.35] as SP), ws), '#1A0A10', { o, b: 0.5, cp: clip });
}

// ===============================================================================================================
// Volume do tronco, dobras, barra e gola
// ===============================================================================================================

/** linha da barra (do flanco esquerdo ao direito), seguindo a curva da barra: 5 pontos, com ondulação leve */
export function hemLine(ctx: LayerCtx, cut: Pick<Cut, 'hemY' | 'ease'>, inset = 0.4): SP[] {
  const { an } = ctx;
  const { hemY, ease } = cut;
  const yl = hemY - an.tilt.hip * 0.5;
  const yr = hemY + an.tilt.hip * 0.5;
  const belly = Math.min(1, an.spec.belly / 3);
  const sag = an.seated ? 0.7 : 0.35 - belly * 1.0;
  const xl = torsoXAt(an, 'L', yl, ease) + inset;
  const xr = torsoXAt(an, 'R', yr, ease) - inset;
  return [
    [xl, yl - 0.75],
    [an.cx - (an.cx - xl) * 0.5, (yl + yr) / 2 + sag * 0.7 + 0.12],
    [an.cx, (yl + yr) / 2 + sag],
    [an.cx + (xr - an.cx) * 0.5, (yl + yr) / 2 + sag * 0.7 - 0.08],
    [xr, yr - 0.75],
  ];
}

export interface ShadeOpts {
  folds: Folds;
  sleeveless?: boolean;
  /** força do brilho de borda (0 = sem) */
  rim?: number;
  /** sem a sombra embaixo do peito (peças estruturadas: armadura, colete) */
  noChest?: boolean;
  /** 'relaxed' acrescenta a dobra longa na diagonal (camiseta solta) */
  relaxed?: boolean;
}

/**
 * volume do tronco: luz no peito, sombra no flanco direito (o tronco é um cilindro), peito com volume (sombra macia
 * embaixo, só quando há volume), barriga cheia (projeção com luz e UMA dobra de puxão curva), oclusão das axilas e as
 * dobras do caimento — poucas, curtas, na diagonal e assimétricas (nada de grade); somem no 'lite'.
 */
export function shadeTorso(ctx: LayerCtx, cut: Cut, o: ShadeOpts): void {
  const { an } = ctx;
  const { cx } = an;
  const lite = isLite(ctx);
  const { d: body, tone: t, color: c, hemY } = cut;
  const L = luminance(c);
  if (o.rim !== 0) rimLit(ctx, cut.pts, { color: t.light, o: (o.rim ?? 1) * (L > 0.7 ? 0.42 : 0.28), w: 1.2, shift: 0.8 });
  const ch = an.w.chest;
  const ay = an.armpitY;
  const wy = an.waistY;
  const cv = an.spec.chestVol;
  const mu = an.spec.muscle;
  // um passe de luz no peito (esquerda) e um de sombra no flanco direito: os valores grandes que leem no mapa
  ctx.push(blob(cx - ch * 0.42, ay + 0.8, ch * 0.44, 3.6, -0.15), t.light, { o: 0.24 + mu * 0.08, b: 1.5, cp: body });
  ctx.push(blob(cx + ch - 0.4, ay + 9, 2.4, 10, 0.05), t.deep, { o: 0.22, b: 1.5, cp: body });
  // peito com volume: UMA sombra macia larga embaixo (sem dois crescentes que viram "linhas" no mapa)
  if (!o.noChest && (cv > 0.5 || mu > 0.6)) {
    const k = Math.max(cv, mu * 0.8);
    const yc = ay + 6 + k * 1.4;
    ctx.push(blob(cx + 0.6, yc, ch * 0.78, 1.5), t.deep, { o: 0.08 + (k - 0.5) * 0.2, b: 1.3, cp: body });
  }
  // barriga cheia: projeção frontal com luz macia, sombra embaixo dela e UMA dobra de puxão curva saindo do ápice da
  // barriga pros flancos (nunca reta de lado a lado)
  if (an.spec.belly > 1.2 && !an.seated && hemY > wy + 2) {
    const bw = an.w.waist;
    ctx.push(blob(cx - 1.4, wy + 1.8, bw * 0.55, 4.6, -0.05), t.light, { o: 0.2, b: 1.8, cp: body });
    ctx.push(blob(cx + 0.8, hemY - 1.4, bw * 0.72, 1.6), t.deep, { o: 0.14, b: 1.1, cp: body });
    if (!lite && o.folds !== 'none' && o.folds !== 'stiff') {
      creases(
        ctx,
        [
          { spine: [[cx - bw * 0.15, wy - 2.6], [cx - bw * 0.45, wy - 3.4], [cx - bw * 0.78, wy - 4.6]], w: 0.7 },
          { spine: [[cx + bw * 0.12, wy - 2.4], [cx + bw * 0.5, wy - 3.0], [cx + bw * 0.82, wy - 4.0]], w: 0.62 },
        ],
        c,
        { o: 0.22, cp: body },
      );
    }
  }
  // oclusão embaixo dos braços (axilas)
  if (!o.sleeveless) ctx.push(blob(cx - ch - 0.2, ay + 1.5, 1.6, 3.2) + blob(cx + ch + 0.2, ay + 1.5, 1.6, 3.2), t.deep, { o: 0.3, b: 0.8, cp: body });
  if (lite || o.folds === 'none') return;
  const press = an.tilt.hip; // >0: lado esquerdo comprimido
  const xL = (y: number) => torsoXAt(an, 'L', y, cut.ease);
  const xR = (y: number) => torsoXAt(an, 'R', y, cut.ease);
  const list: { spine: SP[]; w: number }[] = [];
  // dobras que nascem nas axilas e descem na diagonal pro meio (a da direita mais longa: o tecido puxa pro lado da sombra)
  if (!o.sleeveless) {
    list.push({ spine: [[cx - ch + 0.4, ay + 1.0], [cx - ch + 2.0, ay + 3.2], [cx - ch * 0.66, ay + 5.4]], w: 0.62 });
    list.push({ spine: [[cx + ch - 0.4, ay + 0.9], [cx + ch - 2.4, ay + 3.8], [cx + ch * 0.5, ay + 7.4]], w: 0.78 });
  }
  if (an.seated) {
    list.push({ spine: [[cx - ch * 0.72, hemY - 3.0], [cx - ch * 0.32, hemY - 2.1], [cx - 0.5, hemY - 2.5]], w: 0.68 }, { spine: [[cx + ch * 0.25, hemY - 2.3], [cx + ch * 0.58, hemY - 1.5], [cx + ch * 0.86, hemY - 2.4]], w: 0.6 });
  } else if (hemY > wy + 2) {
    const yA = wy + 0.6;
    // cintura: UMA dobra no lado comprimido (contrapposto), descendo íngreme do flanco pro meio; do outro lado só um
    // puxão curto mais embaixo
    if (o.folds === 'tee' || o.folds === 'soft' || o.folds === 'crisp') {
      if (press >= 0) list.push({ spine: [[xL(yA) + 0.35, yA], [cx - ch * 0.62, yA + 2.0], [cx - ch * 0.4, yA + 4.2]], w: 0.8 }, { spine: [[xR(yA + 3.0) - 0.35, yA + 3.0], [cx + ch * 0.66, yA + 4.6]], w: 0.42 });
      else list.push({ spine: [[xR(yA) - 0.35, yA], [cx + ch * 0.6, yA + 2.0], [cx + ch * 0.36, yA + 4.4]], w: 0.84 }, { spine: [[xL(yA + 3.0) + 0.35, yA + 3.0], [cx - ch * 0.64, yA + 4.4]], w: 0.4 });
    }
    if (o.relaxed) list.push({ spine: [[cx + ch - 1.4, ay + 3.6], [cx + 1.2, wy - 0.4], [cx - ch * 0.46, hemY - 2.2]], w: 0.8 });
    if (o.folds === 'flow') {
      // tecido fluido: dobras longas e verticais que descem do peito à barra, de comprimentos diferentes
      list.push({ spine: [[cx - ch * 0.5, ay + 6.5], [cx - ch * 0.56, wy + 1], [cx - ch * 0.5, hemY - 0.8]], w: 0.85 }, { spine: [[cx + ch * 0.2, ay + 8.5], [cx + ch * 0.27, wy + 2], [cx + ch * 0.22, hemY - 0.6]], w: 0.7 }, { spine: [[cx + ch * 0.68, ay + 10], [cx + ch * 0.74, hemY - 1.5]], w: 0.55 });
    }
    if (o.folds === 'crisp') list.push({ spine: [[cx - ch * 0.22, ay + 7.5], [cx - ch * 0.28, wy + 1.5], [cx - ch * 0.2, hemY - 1.2]], w: 0.55 });
    if (o.folds === 'stiff') list.push({ spine: [[xR(wy) - 0.4, wy - 0.5], [cx + ch * 0.55, wy + 1.0]], w: 0.5 });
  }
  if (list.length) creases(ctx, list, c, { o: L > 0.7 ? 0.22 : 0.26, cp: body });
}

/** barra: dobra da bainha (faixa sutil que segue a barra) e pesponto fino; 'rib' = ribana; 'band' = faixa; 'tail' = fralda */
export function hemFinish(ctx: LayerCtx, cut: Cut, kind: TopDef['hemBand'], tint?: string): void {
  if (!kind || kind === 'none') return;
  const lite = isLite(ctx);
  const { tone: t, d: body } = cut;
  const hem = hemLine(ctx, cut);
  const up = (k: number) => hem.map((p) => [p[0], p[1] - k] as SP);
  if (kind === 'rib' || kind === 'band') {
    const h = kind === 'rib' ? 2.3 : 1.7;
    const band = smoothPath([...hem.map((p) => [p[0], p[1] + 1.4] as SP), ...up(h - 0.3).reverse()]);
    ctx.push(band, tint ?? t.shade, { o: tint ? 1 : kind === 'rib' ? 0.45 : 0.4, cp: body });
    ctx.stroke(smoothPath(up(h - 0.3), false), t.deep, 0.28, { o: 0.42, cp: body });
    if (!lite && kind === 'rib') {
      let rib = '';
      for (let i = 0; i <= 30; i++) {
        const u = i / 30;
        const a = sampleOn(hem, u);
        rib += `M${fmt(a[0])},${fmt(a[1] - h + 0.4)}v${fmt(h + 0.6)}`;
      }
      // recortada no CORPO da peça (não na faixa): numa peça aberta a ribana não atravessa o vão pra camiseta de baixo
      ctx.stroke(rib, t.deep, 0.13, { o: 0.3, cp: body });
    }
    return;
  }
  if (kind === 'tail') {
    // fralda de camisa: barra mais funda no meio e subindo nas laterais, bainha estreita com pesponto
    ctx.push(taperPath(hem, [0.6, 1.1, 1.2, 1.1, 0.6], { round: true }), t.shade, { o: 0.22, cp: body });
    if (!lite) ctx.stroke(smoothPath(up(0.55), false), t.deep, 0.15, { o: 0.38, cp: body });
    return;
  }
  ctx.push(taperPath(hem, [0.7, 1.35, 1.45, 1.35, 0.7], { round: true }), t.shade, { o: 0.24, cp: body });
  if (!lite) ctx.stroke(smoothPath(up(0.6), false), t.deep, 0.16, { o: 0.34, cp: body });
}

/** ponto em u (0..1) de uma polilinha (por índice, suficiente pra amostrar barras) */
export function sampleOn(pts: readonly SP[], u: number): Pt {
  const x = Math.max(0, Math.min(1, u)) * (pts.length - 1);
  const i = Math.min(pts.length - 2, Math.floor(x));
  return lerp2(pts[i], pts[i + 1], x - i);
}

/** gola de ribana (careca, V, canoa, cava funda): faixa com espessura, sombra embaixo e a linha de costura */
export function neckRib(ctx: LayerCtx, cut: Cut, w = 2.0, tint?: string): void {
  const { tone: t, color: c, d: body, neck } = cut;
  const lite = isLite(ctx);
  const band = tint ?? shade(c, luminance(c) > 0.6 ? -0.08 : 0.06);
  const inner = smoothPath(cut.neckPts.map((p) => [p[0], p[1] + w * 0.55] as SP), false);
  ctx.stroke(inner, t.deep, 0.9, { o: 0.22, b: 0.4, cp: body });
  ctx.stroke(neck, band, w, { c: 'butt', cp: body });
  if (!lite) ctx.stroke(neck, t.light, 0.32, { o: 0.36, cp: body });
  ctx.stroke(smoothPath(cut.neckPts.map((p) => [p[0], p[1] + w * 0.48] as SP), false), t.deep, 0.2, { o: 0.38, cp: body });
}

/** botões (com furinhos e brilho) numa coluna/lista */
export function buttons(ctx: LayerCtx, pts: readonly Pt[], r: number, color: string, o: { cp?: string; holes?: boolean } = {}): void {
  if (!pts.length) return;
  const lite = isLite(ctx);
  let d = '';
  let sh = '';
  for (const [x, y] of pts) {
    d += circle(x, y, r);
    sh += circle(x + r * 0.25, y + r * 0.35, r);
  }
  ctx.push(sh, '#0A0610', { o: 0.3, cp: o.cp, ...(lite ? {} : { b: 0.2 }) });
  ctx.push(d, color, { gf: { t: 'r', cx: pts[0][0] - r * 0.3, cy: pts[0][1], r: r * 1.6, s: [[0, mix(color, '#FFFFFF', 0.55)], [0.6, color], [1, mix(color, '#000000', 0.35)]] }, cp: o.cp });
  if (!lite && o.holes !== false && r >= 0.42) {
    let h = '';
    for (const [x, y] of pts) h += circle(x - r * 0.28, y, r * 0.16) + circle(x + r * 0.28, y, r * 0.16);
    ctx.push(h, mix(color, '#000000', 0.5), { o: 0.6 });
  }
}

/** carcela (vista dos botões) no meio da frente, com botões */
export function placket(ctx: LayerCtx, cut: Cut, y0: number, y1: number, o: { buttons?: number; color?: string; w?: number; firstOpen?: boolean } = {}): void {
  const { an } = ctx;
  const { tone: t, d: body } = cut;
  const lite = isLite(ctx);
  const cx = an.cx + 0.15;
  const w = o.w ?? 1.2;
  ctx.push(smoothPath([[cx - w, y0, 0], [cx + w, y0, 0], [cx + w * 0.92, y1, 0], [cx - w * 1.04, y1, 0]]), t.base, { gf: { t: 'l', x1: cx - w, y1: 0, x2: cx + w, y2: 0, s: [[0, t.light], [0.5, t.base], [1, t.shade]] }, cp: body });
  ctx.stroke(`M${fmt(cx + w)},${fmt(y0)}L${fmt(cx + w * 0.92)},${fmt(y1)}`, t.deep, 0.26, { o: 0.45, cp: body });
  if (!lite) ctx.stroke(`M${fmt(cx - w + 0.3)},${fmt(y0)}L${fmt(cx - w * 1.04 + 0.3)},${fmt(y1)}`, threadOf(cut.color), 0.12, { o: 0.4, cp: body });
  const n = o.buttons ?? 0;
  if (n > 0) {
    const ps: Pt[] = [];
    for (let i = o.firstOpen ? 1 : 0; i < n; i++) ps.push([cx, y0 + 1.0 + ((y1 - y0 - 2) * i) / Math.max(1, n - 1)]);
    buttons(ctx, ps, 0.4, o.color ?? mix(cut.color, '#F4F0E6', 0.6), { cp: body });
  }
}

/** bolso de peito aplicado, com sombra de borda e pesponto; aba opcional com botão */
export function chestPocket(ctx: LayerCtx, cut: Pick<Cut, 'tone' | 'd' | 'color'>, x: number, y: number, w: number, h: number, flap = false): void {
  const { tone: t, d: body, color: c } = cut;
  const lite = isLite(ctx);
  const pk = smoothPath([[x - w / 2, y, 0.3], [x + w / 2, y, 0.3], [x + w / 2 - 0.1, y + h - 0.6], [x, y + h, 0.6], [x - w / 2 + 0.1, y + h - 0.6]]);
  ctx.push(pk, '#0A0610', { o: 0.18, ...(lite ? {} : { b: 0.35 }), cp: body });
  ctx.push(pk, c, { gf: { t: 'l', x1: x - w / 2, y1: y, x2: x + w / 2, y2: y + h, s: [[0, t.light], [0.55, t.base], [1, t.shade]] } });
  if (!lite) ctx.stroke(pk, threadOf(c), 0.12, { o: 0.45, da: [0.5, 0.35] });
  if (flap) {
    const fl = smoothPath([[x - w / 2 - 0.15, y - 0.3, 0.3], [x + w / 2 + 0.15, y - 0.3, 0.3], [x + w / 2, y + 1.6], [x, y + 2.3, 0], [x - w / 2, y + 1.6]]);
    ctx.push(fl, '#0A0610', { o: 0.25, ...(lite ? {} : { b: 0.3 }) });
    ctx.push(fl, c, { gf: { t: 'l', x1: x, y1: y - 0.3, x2: x, y2: y + 2.3, s: [[0, t.light], [1, t.base]] } });
    buttons(ctx, [[x, y + 1.4]], 0.3, mix(c, '#F4F0E6', 0.5), { holes: false });
  }
}

// ===============================================================================================================
// Mangas
// ===============================================================================================================

export interface SleeveSpec {
  len: SleeveLen;
  ease: number;
  flare: number;
  cuff: Cuff;
  color: string;
  tone: Tone;
  mat: Mat;
  /** corte da manga curta no braço (0..1) */
  to: number;
  /** contorno da peça no ombro (shoulderChain): a manga começa nessa linha */
  chain?: readonly SP[];
  /** estampa na manga (listras, xadrez, flores…), no espaço do grupo do braço */
  pattern?: (ctx: LayerCtx, clip: string, a: Pt, b: Pt, w: number) => void;
  /** tom do punho/barra quando é de outra cor */
  cuffColor?: string;
  /** brilho extra (cetim, náilon, holográfico) 0..1 */
  sheen?: number;
}

/** fim da manga no antebraço por comprimento */
export const FORE_TO: Partial<Record<SleeveLen, number>> = { long: 0.97, bell: 0.99, three4: 0.52, rolled: 0.38, wide: 0.62 };

/** gradiente de cilindro do braço inteiro (mesma cor nas duas metades: a manga é contínua no cotovelo) */
export function sleeveGrad(an: Anatomy, s: Side, e: number, t: Tone): AvatarGradient {
  const ax = armAxis(an, s);
  return cylGradient(ax.a, ax.b, ax.wl + e + 0.5, ax.wr + e + 0.5, { light: t.light, base: t.base, shade: t.shade, bounce: t.bounce });
}

/** ponta de dentro e de fora da boca da manga num corte t (pontos no espaço do grupo) */
export function sleeveMouth(an: Anatomy, limb: 'upperArm' | 'forearm', s: Side, t: number, e: number): { o: Pt; i: Pt; m: Pt; dir: Pt } {
  const q = limbWidthAt(an, limb, s, t);
  const out = og(s);
  let nx = -q.dir[1];
  let ny = q.dir[0];
  if (Math.sign(nx || out) !== out) {
    nx = -nx;
    ny = -ny;
  }
  const wo = (s === 'L' ? q.l : q.r) + e;
  const wi = (s === 'L' ? q.r : q.l) + e;
  const o: Pt = [q.at[0] + nx * wo, q.at[1] + ny * wo];
  const i: Pt = [q.at[0] - nx * wi, q.at[1] - ny * wi];
  return { o, i, m: [(o[0] + i[0]) / 2, (o[1] + i[1]) / 2], dir: q.dir };
}

/** sobe um ponto ao longo do eixo (k > 0 = pro ombro) */
export const upAx = (p: Pt, dir: Pt, k: number): Pt => [p[0] - dir[0] * k, p[1] - dir[1] * k];

/** linha do ombro da peça (y do acrômio) de um lado, com a folga */
export function garmentShoulderY(an: Anatomy, s: Side, ease: number): number {
  const sh = s === 'L' ? an.joints.shoulderL : an.joints.shoulderR;
  const p = torsoProfile(an, s);
  const d = Math.abs(sh[0] - an.cx);
  let y = p[p.length - 1][1];
  for (let i = 1; i < p.length; i++) {
    const a = Math.abs(p[i - 1][0] - an.cx);
    const b = Math.abs(p[i][0] - an.cx);
    if (b >= d) {
      const k = Math.max(0, Math.min(1, (d - a) / (b - a || 1)));
      y = p[i - 1][1] + (p[i][1] - p[i - 1][1]) * k;
      break;
    }
  }
  return Math.min(y, sh[1] - 1) - ease * 0.8;
}

/**
 * pedaço do contorno da peça no ombro de um lado: do acrômio (onde fica a costura da cava) até o ponto mais largo do
 * deltoide. A manga começa EXATAMENTE nessa linha — a silhueta do trapézio continua na manga sem degrau nem ombreira.
 * `drop` (ombro caído, oversized) empurra a costura pra fora.
 */
export function shoulderChain(an: Anatomy, pts: readonly SP[], s: Side, ease: number, drop = 0): SP[] {
  const g = og(s);
  const sh = s === 'L' ? an.joints.shoulderL : an.joints.shoulderR;
  const acr = an.spec.shoulder - an.spec.upperArm * 0.82 + ease * 0.4 + drop;
  const side = pts.filter((p) => Math.sign(p[0] - an.cx) === g && p[1] <= sh[1] + 0.6 && p[1] > an.collarY - 9);
  side.sort((p, q) => Math.abs(p[0] - an.cx) - Math.abs(q[0] - an.cx));
  const out: SP[] = [];
  for (const p of side) if (Math.abs(p[0] - an.cx) >= acr - 0.5) out.push([p[0], p[1]]);
  return out;
}

/**
 * contorno da manga de cima (no espaço do braço em repouso): topo = linha do ombro da peça (`chain`), lado de fora
 * descendo pelo deltoide até a boca, boca quase reta e lado de dentro subindo até a costura da cava (curva do acrômio
 * pra axila). Manga até o cotovelo (`to` = 1) fecha em meio círculo em volta do cotovelo (gira sem fresta).
 */
export function sleeveOutline(an: Anatomy, s: Side, o: { to: number; e: number; flare: number; chain: readonly SP[] }): { d: string; mouth: { o: Pt; i: Pt; m: Pt; dir: Pt } | null } {
  const sh = s === 'L' ? an.joints.shoulderL : an.joints.shoulderR;
  const el = s === 'L' ? an.joints.elbowL : an.joints.elbowR;
  const L = Math.hypot(el[0] - sh[0], el[1] - sh[1]) || 1;
  const u: Pt = [(el[0] - sh[0]) / L, (el[1] - sh[1]) / L];
  const out = og(s);
  let nx = -u[1];
  let ny = u[0];
  if (Math.sign(nx || out) !== out) {
    nx = -nx;
    ny = -ny;
  }
  // o tecido não entra no vale entre o deltoide e o tríceps: do pico do deltoide ele cai quase reto (manga curta) ou em
  // linha até o cotovelo (manga longa). Seguir o braço à risca dá manga "bufante" (estufa no ombro e aperta na boca)
  const T_DELT = 0.15;
  const wOut = (t: number) => {
    const q = limbWidthAt(an, 'upperArm', s, t);
    return s === 'L' ? q.l : q.r;
  };
  const peak = wOut(T_DELT);
  const wEl = wOut(1);
  const W = (t: number) => {
    const q = limbWidthAt(an, 'upperArm', s, t);
    const k = o.to < 1 ? Math.min(1, t / o.to) : 0;
    const raw = s === 'L' ? q.l : q.r;
    const u = Math.max(0, (t - T_DELT) / (1 - T_DELT));
    const hang = t <= T_DELT ? raw : o.to < 1 ? peak - 1.6 * u : peak + (wEl - peak) * Math.pow(u, 0.75);
    // a copa assenta no deltoide (folga pequena no alto, cheia da metade do braço pra baixo): nada de cúpula estufada
    const e = o.e * (0.4 + 0.6 * Math.min(1, t / 0.4));
    return { wo: Math.max(raw, hang) + e + o.flare * k, wi: (s === 'L' ? q.r : q.l) + e + o.flare * k * 0.6 };
  };
  const P = (t: number, w: number): SP => [sh[0] + u[0] * t * L + nx * w, sh[1] + u[1] * t * L + ny * w];
  const end = Math.min(1, o.to);
  const ts: number[] = [];
  for (let t = 0.2; t < end - 0.04; t += 0.16) ts.push(t);
  ts.push(end);
  const outer: SP[] = ts.map((t) => P(t, W(t).wo));
  const inner: SP[] = ts.map((t) => P(t, -W(t).wi)).reverse();
  // a costura da cava sobe pelo lado de dentro até o acrômio (curva, não reta)
  const i0 = P(0.06, -W(0.06).wi * 0.92);
  const chain = o.chain.length ? o.chain : [P(-0.05, 0)];
  const A = chain[0];
  const seamMid: SP = [(A[0] + i0[0]) / 2 - nx * 0.4, (A[1] + i0[1]) / 2 + 0.3];
  const pts: SP[] = [[A[0], A[1], 0.6], ...chain.slice(1)];
  if (end >= 1) {
    // meio círculo em volta do cotovelo
    const w1 = W(1);
    const r = (w1.wo + w1.wi) / 2;
    const c: Pt = [el[0] + nx * (w1.wo - r), el[1] + ny * (w1.wo - r)];
    pts.push(...outer.slice(0, -1));
    for (const a of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const th = Math.PI * a;
      pts.push([c[0] + (nx * Math.cos(th) + u[0] * Math.sin(th)) * r, c[1] + (ny * Math.cos(th) + u[1] * Math.sin(th)) * r]);
    }
    pts.push(...inner.slice(1));
  } else {
    const mo = outer[outer.length - 1];
    const mi = inner[0];
    pts.push(...outer.slice(0, -1), [mo[0], mo[1], 0.35], [(mo[0] + mi[0]) / 2 + u[0] * 0.25, (mo[1] + mi[1]) / 2 + u[1] * 0.25], [mi[0], mi[1], 0.35], ...inner.slice(1));
  }
  pts.push(i0, seamMid);
  const d = smoothPath(pts);
  if (end >= 1) return { d, mouth: null };
  const mo: Pt = [outer[outer.length - 1][0], outer[outer.length - 1][1]];
  const mi: Pt = [inner[0][0], inner[0][1]];
  return { d, mouth: { o: mo, i: mi, m: [(mo[0] + mi[0]) / 2, (mo[1] + mi[1]) / 2], dir: u } };
}

/**
 * metade de cima da manga (grupo armX): topo na linha do ombro da peça, folga, deltoide com luz, costura da cava, dobra
 * puxada da axila, boca quase PERPENDICULAR ao braço (gira junto com o úmero: nada de barbatana pontuda) com bainha e
 * sombra no braço.
 */
export function sleeveUpper(ctx: LayerCtx, s: Side, sp: SleeveSpec): void {
  const { an } = ctx;
  const lite = isLite(ctx);
  const t = sp.tone;
  const c = sp.color;
  const e = sp.ease + (lite ? 0.2 : 0);
  const short = sp.len === 'short';
  const to = short ? sp.to : sp.len === 'elbow' ? 0.93 : 1;
  const so = sleeveOutline(an, s, { to, e, flare: short || sp.len === 'elbow' ? sp.flare : 0, chain: sp.chain ?? [] });
  const d = so.d;
  const grad = sleeveGrad(an, s, e, t);
  const out = og(s);
  ctx.withGroup(armG(s), () => {
    ctx.push(d, c, { gf: grad });
    const j = an.joints;
    const sh = s === 'L' ? j.shoulderL : j.shoulderR;
    const el = s === 'L' ? j.elbowL : j.elbowR;
    if (sp.pattern) sp.pattern(ctx, d, sh, el, an.spec.upperArm + e);
    const ua = an.spec.upperArm;
    // deltoide: luz arredondada no alto do lado de fora; sombra do lado de dentro (bíceps contra o tronco)
    ctx.push(blob(sh[0] + out * ua * 0.4 - 0.3, sh[1] + ua * 0.45, ua * 0.5, ua * 1.25), t.light, { o: (sp.sheen ?? 0) * 0.3 + 0.15, b: 1.0, cp: d });
    // no 'lite' (≤ ~100 px) a sombra do bíceps e a costura da cava não se leem: saem (2 camadas recortadas por manga)
    const q = limbWidthAt(an, 'upperArm', s, 0.55);
    if (!lite) ctx.push(blob(q.at[0] - out * (s === 'L' ? q.r : q.l) * 0.7, q.at[1], 1.2, 4.2), t.deep, { o: 0.2, b: 0.9, cp: d });
    // costura da cava: sombra fina ao longo do lado de dentro do topo (onde a manga encontra o corpo da peça)
    if (!lite && sp.chain && sp.chain.length) {
      const A = sp.chain[0];
      const q0 = limbWidthAt(an, 'upperArm', s, 0.08);
      const q1 = limbWidthAt(an, 'upperArm', s, 0.32);
      const wi0 = (s === 'L' ? q0.r : q0.l) + e;
      const wi1 = (s === 'L' ? q1.r : q1.l) + e;
      const seamLine = smoothPath([[A[0] - out * 0.15, A[1] + 0.25], [q0.at[0] - out * (wi0 - 0.5), q0.at[1]], [q1.at[0] - out * (wi1 - 0.45), q1.at[1]]], false);
      ctx.stroke(seamLine, t.deep, lite ? 0.4 : 0.55, { o: lite ? 0.22 : 0.3, ...(lite ? {} : { b: 0.25 }), cp: d });
      if (!lite) ctx.stroke(seamLine, t.light, 0.18, { o: 0.25, cp: d });
    }
    if (!lite && sp.mat !== 'metal') {
      // dobra que nasce na axila (tensão) e, na manga longa, as que se juntam no cotovelo por dentro
      const list: { spine: SP[]; w: number }[] = [{ spine: [[sh[0] - out * ua * 0.75, sh[1] + ua * 1.25], [sh[0] - out * ua * 0.1, sh[1] + ua * 2.0], [sh[0] + out * ua * 0.35, sh[1] + ua * 2.35]], w: 0.46 }];
      if (to >= 0.93) {
        const k = limbWidthAt(an, 'upperArm', s, 0.86);
        const wi = s === 'L' ? k.r : k.l;
        list.push({ spine: [[k.at[0] - out * wi * 0.9, k.at[1] - 0.6], [k.at[0] - out * wi * 0.2, k.at[1] + 0.3], [k.at[0] + out * wi * 0.4, k.at[1] + 0.2]], w: 0.5 });
      }
      creases(ctx, list, c, { o: 0.26, cp: d });
    }
    if (so.mouth) {
      const m = so.mouth;
      const skin = upperArmPath(an, s);
      // sombra da manga no braço (oclusão logo abaixo da boca) e a bainha
      ctx.push(taperPath([m.i, [m.m[0] + m.dir[0] * 0.9, m.m[1] + m.dir[1] * 0.9], m.o], [1.0, 1.5, 1.0]), '#1A0A10', { o: 0.3, b: 0.55, cp: skin });
      cuffAt(ctx, sp, d, m, short ? sp.cuff : 'hem');
    }
  });
}

/** acabamento da boca da manga (curta ou no antebraço) */
export function cuffAt(ctx: LayerCtx, sp: SleeveSpec, clip: string, m: { o: Pt; i: Pt; m: Pt; dir: Pt }, kind: Cuff): void {
  const lite = isLite(ctx);
  const t = sp.tone;
  const cc = sp.cuffColor ?? null;
  // boca levemente curva (mais baixa no meio): nada de corte reto de régua
  const mid = (k: number): Pt => upAx(m.m, m.dir, k - 0.25);
  switch (kind) {
    case 'rib':
    case 'band':
    case 'button': {
      const h = kind === 'rib' ? 1.8 : kind === 'button' ? 2.1 : 1.5;
      const band = smoothPath([m.o, mid(0), m.i, upAx(m.i, m.dir, h), mid(h + 0.05), upAx(m.o, m.dir, h)]);
      ctx.push(band, cc ?? t.shade, { o: cc ? 1 : kind === 'rib' ? 0.45 : 0.38, cp: clip });
      ctx.stroke(smoothPath([upAx(m.o, m.dir, h), mid(h + 0.05), upAx(m.i, m.dir, h)], false), t.deep, 0.24, { o: 0.42, cp: clip });
      if (!lite && kind === 'rib') {
        let rib = '';
        for (let k = 0.12; k < 0.95; k += 0.17) {
          const a: Pt = lerp2(m.o, m.i, k);
          const b = upAx(a, m.dir, h);
          rib += `M${fmt(a[0])},${fmt(a[1])}L${fmt(b[0])},${fmt(b[1])}`;
        }
        ctx.stroke(rib, t.deep, 0.12, { o: 0.32, cp: clip });
      }
      if (kind === 'button') {
        const b = upAx(lerp2(m.o, m.i, 0.28), m.dir, h * 0.5);
        buttons(ctx, [b], 0.28, mix(sp.color, '#F4F0E6', 0.6), { holes: false });
      }
      break;
    }
    case 'roll': {
      // manga dobrada: rolo grosso (o avesso aparece), mais claro em cima, com sombra embaixo
      const h = 2.5;
      const sh = (p: Pt): Pt => [p[0] + m.dir[0] * 0.3, p[1] + m.dir[1] * 0.3];
      const band = smoothPath([sh(m.o), sh(mid(0)), sh(m.i), upAx(m.i, m.dir, h), mid(h + 0.3), upAx(m.o, m.dir, h)]);
      ctx.push(band, sp.color, { gf: { t: 'l', x1: m.m[0] - m.dir[0] * h, y1: m.m[1] - m.dir[1] * h, x2: m.m[0], y2: m.m[1], s: [[0, t.light], [0.45, t.base], [1, t.shade]] } });
      ctx.stroke(smoothPath([upAx(m.o, m.dir, h * 0.5), mid(h * 0.5 + 0.2), upAx(m.i, m.dir, h * 0.5)], false), t.deep, 0.28, { o: 0.34 });
      ctx.stroke(smoothPath([upAx(m.o, m.dir, h), mid(h + 0.3), upAx(m.i, m.dir, h)], false), t.deep, 0.34, { o: 0.4, ...(lite ? {} : { b: 0.2 }) });
      break;
    }
    case 'bell':
    case 'puff':
    case 'hem':
    default: {
      ctx.push(taperPath([upAx(m.o, m.dir, 0.6), mid(0.6), upAx(m.i, m.dir, 0.6)], [1.1, 1.2, 1.1]), t.shade, { o: 0.22, cp: clip });
      if (!lite) ctx.stroke(smoothPath([upAx(m.o, m.dir, 1.2), mid(1.2), upAx(m.i, m.dir, 1.2)], false), t.deep, 0.15, { o: 0.3, cp: clip });
      if (kind === 'puff' && !lite) {
        // franzido no elástico: pregas curtas convergindo pra boca
        let f = '';
        for (const k of [0.2, 0.42, 0.64, 0.84]) {
          const a: Pt = lerp2(m.o, m.i, k);
          f += taperPath([upAx(a, m.dir, 3.2), upAx(a, m.dir, 1.6), upAx(a, m.dir, 0.4)], [0, 0.5, 0.1]);
        }
        ctx.push(f, t.deep, { o: 0.24, b: 0.25, cp: clip });
      }
      break;
    }
  }
}

/** metade de baixo da manga (grupo foreX): do cotovelo ao fim (meio do antebraço, pulso ou boca de sino) e o punho */
export function sleeveLower(ctx: LayerCtx, s: Side, sp: SleeveSpec): void {
  const fto = FORE_TO[sp.len];
  if (!fto) return;
  const { an } = ctx;
  const lite = isLite(ctx);
  const t = sp.tone;
  const c = sp.color;
  const e = sp.ease + (lite ? 0.2 : 0);
  const bell = sp.len === 'bell' || sp.len === 'wide' ? sp.flare : sp.cuff === 'puff' ? sp.flare * 0.6 : 0;
  const d = forearmPath(an, s, { to: fto, ease: e, flare: bell });
  const out = og(s);
  ctx.withGroup(foreG(s), () => {
    ctx.push(d, c, { gf: sleeveGrad(an, s, e, t) });
    const j = an.joints;
    const el = s === 'L' ? j.elbowL : j.elbowR;
    const wr = s === 'L' ? j.wristL : j.wristR;
    if (sp.pattern) sp.pattern(ctx, d, el, wr, an.spec.forearm + e + bell * 0.5);
    // dobra do cotovelo (por dentro) e o tecido que empilha perto do punho
    if (!lite && sp.mat !== 'metal') {
      const k = limbWidthAt(an, 'forearm', s, 0.1);
      const wi = s === 'L' ? k.r : k.l;
      const list: { spine: SP[]; w: number }[] = [
        { spine: [[k.at[0] - out * wi * 1.0, k.at[1] - 0.2], [k.at[0] - out * wi * 0.25, k.at[1] + 0.8], [k.at[0] + out * wi * 0.5, k.at[1] + 0.5]], w: 0.52 },
        { spine: [[k.at[0] - out * wi * 0.9, k.at[1] + 1.6], [k.at[0] - out * wi * 0.1, k.at[1] + 2.3]], w: 0.38 },
      ];
      if (fto > 0.9 && sp.len !== 'bell') {
        const b = limbWidthAt(an, 'forearm', s, 0.8);
        list.push({ spine: [[b.at[0] - 1.6, b.at[1] - 0.1], [b.at[0], b.at[1] + 0.45], [b.at[0] + 1.5, b.at[1] - 0.05]], w: 0.46 });
      }
      creases(ctx, list, c, { o: 0.26, cp: d });
    }
    const q = limbWidthAt(an, 'forearm', s, 0.45);
    if (!lite) ctx.push(blob(q.at[0] - out * (s === 'L' ? q.r : q.l) * 0.6, q.at[1], 1.0, 3.6), t.deep, { o: 0.18, b: 0.8, cp: d });
    if (sp.sheen) ctx.push(blob(q.at[0] + out * 0.4 - 0.5, q.at[1] - 1, 0.7, 3.4), t.light, { o: sp.sheen * 0.4, b: 0.6, cp: d });
    const m = sleeveMouth(an, 'forearm', s, fto, e + bell * fto);
    if (sp.len === 'bell' || sp.len === 'wide') {
      // boca de sino: o forro (avesso escuro) aparece na abertura
      ctx.push(smoothPath([m.o, upAx(m.m, m.dir, -0.9), m.i, upAx(m.m, m.dir, 0.6)]), t.deep, { o: 0.85 });
      ctx.stroke(smoothPath([m.o, upAx(m.m, m.dir, -0.9), m.i], false), sp.cuffColor ?? t.light, 0.7, { o: sp.cuffColor ? 1 : 0.5 });
    } else {
      if (fto < 0.9) {
        const skin = forearmPath(an, s);
        ctx.push(taperPath([m.i, [m.m[0] + m.dir[0] * 0.9, m.m[1] + m.dir[1] * 0.9], m.o], [1.0, 1.4, 1.0]), '#1A0A10', { o: 0.28, b: 0.5, cp: skin });
      }
      cuffAt(ctx, sp, d, m, sp.cuff);
    }
  });
}

/** braço com manga até o cotovelo ou mais: pedaço do antebraço (só quando a manga longa precisa) */
export function sleeveLenRank(l: SleeveLen): number {
  return l === 'none' ? 0 : l === 'long' || l === 'bell' ? 2 : 1;
}

/** recorte que cobre todo o viewBox (pra camadas sem recorte próprio que precisam de um) */
export const FULL_BOX = 'M-10,-10H110V150H-10Z';

/** caixa de pontos */
export function boxOf(pts: readonly (Pt | SP)[]): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[1] > y1) y1 = p[1];
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
