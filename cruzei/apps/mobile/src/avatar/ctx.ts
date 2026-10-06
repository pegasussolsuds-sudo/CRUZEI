// Contexto de montagem das camadas: cada arquivo de parte (parts/*) recebe um LayerCtx com a config, a cena, as cores
// resolvidas, a anatomia e os helpers pra empurrar camadas no grupo/etiqueta certos.
//
// Uso típico numa parte:
//   export function hairBack(ctx: LayerCtx): void {
//     ctx.group('head');
//     ctx.push(path, ctx.col.hair, { gf: shapeGradient(...) });
//   }
// Regras:
//   - `group(g)` e `tag(k)` valem pras próximas camadas (o orquestrador põe o grupo de cada etapa antes de chamar a parte,
//     mas a parte pode trocar); `withGroup`/`withTag` trocam só durante a função e voltam ao anterior;
//   - `extra` sobrescreve qualquer campo da camada (inclusive g e k);
//   - nada de Math.random: tudo determinístico pela config.

import type { AvatarConfig } from '@cruzei/shared-types';
import { DEFAULT_AVATAR, avatarColor, avatarColorHex } from '@cruzei/shared-utils';

import type { Anatomy } from './anatomy';
import { buildAnatomy } from './anatomy';
import { circle, rrect4, shade } from './geometry';
import type { AvatarScene } from './scene';
import type { AvatarGroup, AvatarLayer, AvatarLayerTag } from './types';

export interface BuildOptions {
  /** desenha a sombra elíptica no chão (mapa, corpo inteiro) */
  groundShadow?: boolean;
  /** 'bust' ignora o veículo e o pet no chão (o recorte do busto não muda de lugar) */
  mode?: 'full' | 'bust';
  /**
   * nível de detalhe: 'lite' pra mapa e miniaturas (≤ ~100 px) — as partes chamam lodCtx(ctx) e pulam detalhe fino
   * (trama, pesponto, vinco, fio solto, brilho miúdo); o desfoque < 1,2 some. Padrão 'full'.
   */
  lod?: 'full' | 'lite';
  /** mão por lado: 'open' = palma pra câmera (aceno, comemoração); padrão = relaxada do repouso */
  hands?: Partial<Record<'L' | 'R', 'open' | 'relaxed'>>;
}

/** cores resolvidas da config (hex) + variações prontas pra volume */
export interface LayerColors {
  skin: string;
  /** pele na sombra (−14%) */
  skinShade: string;
  /** pele na luz (+12%) */
  skinLight: string;
  hair: string;
  /** cabelo na sombra (−18%) */
  hairShade: string;
  /** cabelo no brilho (+22%) */
  hairLight: string;
  eye: string;
  top: string;
  outer: string;
  bottom: string;
  shoes: string;
  hat: string;
  /** tinta da aura (hex) ou null = cor original do efeito */
  aura: string | null;
  vehicle: string;
}

/** especificação de um membro dividido numa junta (cotovelo/joelho) */
export interface LimbSpec {
  /** retângulo do membro inteiro em repouso */
  x: number;
  y: number;
  w: number;
  h: number;
  /** raios [sup-esq, sup-dir, inf-dir, inf-esq] do membro inteiro */
  radii: [number, number, number, number];
  /** y da junta (pivô do grupo de baixo) */
  jointY: number;
  /** grupo da parte de cima e da de baixo */
  gUp: AvatarGroup;
  gLo: AvatarGroup;
  fill: string;
  /** disco da junta (no grupo de cima, por baixo): true = mesma cor; string = outra cor; false = sem */
  joint?: boolean | string;
  /** sobreposição das duas metades na junta (evita emenda no antisserrilhado), padrão 0.6 */
  overlap?: number;
  /**
   * 'both' (padrão) empurra as duas metades agora; 'upper' só o disco + a metade de cima; 'lower' só a de baixo.
   * Braços usam 'upper' na etapa 12 e 'lower' na 15 (o antebraço passa por cima do volante e do pet no colo).
   */
  part?: 'both' | 'upper' | 'lower';
  extra?: Partial<AvatarLayer>;
}

export interface LayerCtx {
  /** config completa (slots novos ausentes já vêm com o padrão) */
  readonly cfg: AvatarConfig;
  readonly opts: BuildOptions;
  readonly scene: AvatarScene;
  readonly an: Anatomy;
  readonly col: LayerColors;
  /** camadas montadas até aqui (na ordem de desenho) */
  readonly layers: AvatarLayer[];
  /** grupo atual */
  readonly g: AvatarGroup;
  /** etiqueta atual (null = sem) */
  readonly k: AvatarLayerTag | null;
  /** muda o grupo das próximas camadas */
  group(g: AvatarGroup): LayerCtx;
  /** muda a etiqueta das próximas camadas (null tira) */
  tag(k: AvatarLayerTag | null): LayerCtx;
  /** grupo só durante `fn` */
  withGroup(g: AvatarGroup, fn: () => void): void;
  /** etiqueta só durante `fn` */
  withTag(k: AvatarLayerTag | null, fn: () => void): void;
  /** camada de preenchimento */
  push(d: string, f?: string, extra?: Partial<AvatarLayer>): AvatarLayer;
  /** camada de traço (ponta redonda por padrão) */
  stroke(d: string, s: string, w: number, extra?: Partial<AvatarLayer>): AvatarLayer;
  /** membro dividido na junta: metade de cima em gUp, de baixo em gLo, disco na junta por baixo */
  limb(spec: LimbSpec): void;
}

const NONE = 'none';

/** config com todos os slots (o que vier faltando — catálogo antigo, config antiga — recebe o padrão ou 'none') */
export function fillConfig(cfg: AvatarConfig): AvatarConfig {
  const base = DEFAULT_AVATAR as Partial<AvatarConfig>;
  const out = { ...base, ...cfg } as AvatarConfig & Record<string, string>;
  const fallback: Partial<Record<keyof AvatarConfig, string>> = {
    faceShape: 'oval',
    eyes: 'almond',
    eyeColor: 'e_dark',
    brows: 'soft',
    nose: 'soft',
    lines: NONE,
    faceDetail: NONE,
    outer: NONE,
    outerColor: 'c_navy',
    neck: NONE,
    pride: NONE,
    prideFlag: 'rainbow',
    pronouns: NONE,
    auraColor: 'a_auto',
    auraLevel: 'medium',
    backdrop: NONE,
    emote: NONE,
    pet: NONE,
    petPose: 'side',
    vehicle: NONE,
    vehicleColor: 'c_red',
    held: NONE,
  };
  for (const [k, v] of Object.entries(fallback)) if (out[k] == null) out[k] = v as string;
  return out;
}

/** hex da cor (id desconhecido = primeira cor do slot, como o avatarColorHex sempre fez) */
function colorHex(slot: Parameters<typeof avatarColor>[0], id: string, fallback: string): string {
  try {
    return avatarColor(slot, id)?.hex ?? avatarColorHex(slot, id) ?? fallback;
  } catch {
    return fallback;
  }
}

/** tinta da aura (hex) ou null = cor original do efeito ('a_auto' ou id desconhecido) */
function auraTint(id: string): string | null {
  if (!id || id === 'a_auto') return null;
  try {
    return avatarColor('auraColor', id)?.hex ?? null;
  } catch {
    return null;
  }
}

export function resolveColors(cfg: AvatarConfig): LayerColors {
  const skin = colorHex('skin', cfg.skin, '#E8B590');
  const hair = colorHex('hairColor', cfg.hairColor, '#3B2A20');
  const top = colorHex('topColor', cfg.topColor, '#16161E');
  return {
    skin,
    skinShade: shade(skin, -0.14),
    skinLight: shade(skin, 0.12),
    hair,
    hairShade: shade(hair, -0.18),
    hairLight: shade(hair, 0.22),
    eye: colorHex('eyeColor', cfg.eyeColor, '#4A2E1E'),
    top,
    outer: colorHex('outerColor', cfg.outerColor, top),
    bottom: colorHex('bottomColor', cfg.bottomColor, '#4A6FA5'),
    shoes: colorHex('shoesColor', cfg.shoesColor, '#F5F5F7'),
    hat: colorHex('hatColor', cfg.hatColor, '#16161E'),
    aura: auraTint(cfg.auraColor),
    vehicle: colorHex('vehicleColor', cfg.vehicleColor, '#D93A3A'),
  };
}

/** cria o contexto (o orquestrador chama; as partes só recebem) */
export function createCtx(cfgIn: AvatarConfig, scene: AvatarScene, opts: BuildOptions): LayerCtx {
  const cfg = fillConfig(cfgIn);
  const an = buildAnatomy(cfg, scene);
  const layers: AvatarLayer[] = [];
  const state: { g: AvatarGroup; k: AvatarLayerTag | null } = { g: 'body', k: null };
  const ctx: LayerCtx = {
    cfg,
    opts,
    scene,
    an,
    col: resolveColors(cfg),
    layers,
    get g() {
      return state.g;
    },
    get k() {
      return state.k;
    },
    group(g) {
      state.g = g;
      return ctx;
    },
    tag(k) {
      state.k = k;
      return ctx;
    },
    withGroup(g, fn) {
      const prev = state.g;
      state.g = g;
      try {
        fn();
      } finally {
        state.g = prev;
      }
    },
    withTag(k, fn) {
      const prev = state.k;
      state.k = k;
      try {
        fn();
      } finally {
        state.k = prev;
      }
    },
    push(d, f, extra) {
      const l: AvatarLayer = { d, f, g: state.g };
      if (state.k) l.k = state.k;
      if (extra) Object.assign(l, extra);
      layers.push(l);
      return l;
    },
    stroke(d, s, w, extra) {
      const l: AvatarLayer = { d, s, w, c: 'round', g: state.g };
      if (state.k) l.k = state.k;
      if (extra) Object.assign(l, extra);
      layers.push(l);
      return l;
    },
    limb(sp) {
      const ov = sp.overlap ?? 0.6;
      const part = sp.part ?? 'both';
      const [tl, tr, br, bl] = sp.radii;
      const prev = state.g;
      const yBot = sp.y + sp.h;
      const cut = sp.jointY;
      if (cut <= sp.y + 0.01 || cut >= yBot - 0.01) {
        // junta fora do membro: inteiro num grupo só (o de cima se a junta está embaixo, o de baixo se está em cima)
        const whole = cut >= yBot - 0.01 ? 'upper' : 'lower';
        if (part === 'both' || part === whole) {
          state.g = whole === 'upper' ? sp.gUp : sp.gLo;
          ctx.push(rrect4(sp.x, sp.y, sp.w, sp.h, sp.radii), sp.fill, sp.extra);
          state.g = prev;
        }
        return;
      }
      if (part !== 'lower') {
        state.g = sp.gUp;
        if (sp.joint !== false) {
          const jc = typeof sp.joint === 'string' ? sp.joint : sp.fill;
          ctx.push(circle(sp.x + sp.w / 2, cut, sp.w / 2), jc, sp.extra);
        }
        ctx.push(rrect4(sp.x, sp.y, sp.w, Math.min(yBot, cut + ov) - sp.y, [tl, tr, 0, 0]), sp.fill, sp.extra);
      }
      if (part !== 'upper') {
        state.g = sp.gLo;
        const y2 = Math.max(sp.y, cut - ov);
        ctx.push(rrect4(sp.x, y2, sp.w, yBot - y2, [0, 0, br, bl]), sp.fill, sp.extra);
      }
      state.g = prev;
    },
  };
  return ctx;
}
