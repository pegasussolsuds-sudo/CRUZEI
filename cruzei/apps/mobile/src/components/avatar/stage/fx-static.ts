// Aura e fundo ESTÁTICOS das listas e miniaturas (<CruzeiAvatar/>): o mesmo desenho do palco (fx-auras / fx-backdrops)
// num quadro parado escolhido a dedo, pela caneta SVG em modo leve (menos partículas e detalhe). Dono: efeitos.

import type { AvatarConfig } from '@cruzei/shared-types';

import { fillConfig, resolveColors } from '../../../avatar/ctx';
import { flagOf } from '../../../avatar/parts/flags';

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

/** aura parada no viewBox `vb` (null = sem aura) */
export function staticAura(cfg: AvatarConfig, mode: 'full' | 'bust', vb: Box): StaticAura | null {
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
  const full = fillConfig(cfg);
  const spec = backdropSpec(full.backdrop, flagOf(full.prideFlag), { w: vb.w, h: vb.h });
  if (!spec) return null;
  const P = svgPen(SHAPES, true);
  drawBackdropSvg(P, spec, vb, mode === 'bust');
  return P.model();
}
