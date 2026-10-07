// Aura e fundo ESTÁTICOS das listas e miniaturas (<CruzeiAvatar/>): o mesmo desenho do palco (fx-auras / fx-backdrops)
// num quadro parado escolhido a dedo, pela caneta SVG em modo leve (menos partículas e detalhe). Dono: efeitos.

import type { AvatarConfig } from '@cruzei/shared-types';
import { avatarKey } from '@cruzei/shared-utils';

import { fillConfig, resolveColors } from '../../../avatar/ctx';
import { flagOf } from '../../../avatar/parts/flags';
import { MemCache } from '../../../services/memCache';

import { AURA_BASE, auraFigure, auraSpec, drawAuraUnits, svgAuraFrame } from './fx-auras';
import { backdropSpec, drawBackdropSvg } from './fx-backdrops';
import { SHAPES } from './fx-shapes';
import { svgPen, type FxSvgModel } from './fx-svg';

export interface StaticAura {
  back: FxSvgModel;
  front: FxSvgModel;
  /** cor do brilho de base (a tinta escolhida ou a cor original da aura) */
  color: string;
}

type Box = { x: number; y: number; w: number; h: number };

/**
 * cache por visual: a grade do editor e as listas desmontam e remontam ao rolar, e o desenho não muda (quem está montado
 * guarda o seu). Uma aura parada pesa ~15–20 KB de paths (eram 160 itens: ~3 MB achatado, ~9 MB medidos no V8): teto
 * em bytes estimados, ~60 visuais — mais que uma lista rolada pra trás.
 */
export const FX_STATIC_CACHE_BYTES = 1024 * 1024;
const cache = new MemCache<StaticAura | FxSvgModel | null>('avatar.fxStatic', FX_STATIC_CACHE_BYTES, 80);
/** bytes estimados de um modelo (paths + nós + gradientes), medido no node */
function modelBytes(m: FxSvgModel): number {
  let b = 64;
  for (const n of m.nodes) b += 96 + n.d.length;
  for (const g of m.grads) b += 96 + g.stops.length * 48;
  for (const c of m.clips) b += 48 + c.d.length;
  return b;
}
export function fxStaticBytes(v: StaticAura | FxSvgModel | null): number {
  if (!v) return 16;
  return 'nodes' in v ? modelBytes(v) : modelBytes(v.back) + modelBytes(v.front);
}
function cached<T extends StaticAura | FxSvgModel | null>(k: string, make: () => T): T {
  if (cache.has(k)) return cache.get(k) as T;
  const v = make();
  cache.set(k, v, fxStaticBytes(v));
  return v;
}
const boxKey = (vb: Box) => `${vb.x},${vb.y},${vb.w},${vb.h}`;

/** aura parada no viewBox `vb` (null = sem aura) */
export function staticAura(cfg: AvatarConfig, mode: 'full' | 'bust', vb: Box): StaticAura | null {
  if (!cfg.aura || cfg.aura === 'none') return null;
  return cached(`a|${avatarKey(cfg)}|${mode}|${boxKey(vb)}`, () => makeStaticAura(cfg, mode, vb));
}

function makeStaticAura(cfg: AvatarConfig, mode: 'full' | 'bust', vb: Box): StaticAura | null {
  const full = fillConfig(cfg);
  if (!full.aura || full.aura === 'none') return null;
  const tint = resolveColors(full).aura;
  const spec = auraSpec(full.aura, tint, full.auraLevel, flagOf(full.prideFlag), true);
  if (!spec) return null;
  const F = svgAuraFrame(vb, mode === 'bust', auraFigure(full, mode));
  const back = svgPen(SHAPES, true);
  drawAuraUnits(back, spec, F, spec.still, false);
  const front = svgPen(SHAPES, true);
  drawAuraUnits(front, spec, F, spec.still, true);
  return { back: back.model(), front: front.model(), color: tint ?? AURA_BASE[spec.id] ?? '#7FFF00' };
}

/** fundo parado no viewBox `vb` (null = sem fundo) */
export function staticBackdrop(cfg: AvatarConfig, mode: 'full' | 'bust', vb: Box): FxSvgModel | null {
  if (!cfg.backdrop || cfg.backdrop === 'none') return null;
  return cached(`b|${avatarKey(cfg)}|${mode}|${boxKey(vb)}`, () => makeStaticBackdrop(cfg, mode, vb));
}

function makeStaticBackdrop(cfg: AvatarConfig, mode: 'full' | 'bust', vb: Box): FxSvgModel | null {
  const full = fillConfig(cfg);
  const spec = backdropSpec(full.backdrop, flagOf(full.prideFlag), { w: vb.w, h: vb.h });
  if (!spec) return null;
  const P = svgPen(SHAPES, true);
  drawBackdropSvg(P, spec, vb, mode === 'bust');
  return P.model();
}
