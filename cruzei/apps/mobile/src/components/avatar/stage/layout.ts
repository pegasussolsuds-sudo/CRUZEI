// Enquadramento do palco animado (AvatarStage): o canvas tem margem pros efeitos e o avatar ocupa a caixa interna.
//
// Números (documentados no contrato):
//   STAGE_INNER = 0.86   o avatar ocupa 86% da altura do canvas (full) ou 86% do lado (bust)
//   STAGE_TOP   = 0.09   margem de cima no full (pulo, braços pra cima, chapéu alto); sobra 5% embaixo pra sombra
//   STAGE_ASPECT = 0.8   largura/altura do canvas no full (o avatar 100x140 tem 0.714: sobra ~4,3% de cada lado pra aura)
//   bust: canvas quadrado size×size, recorte da pessoa (bustBoxFor; reserva AVATAR_BUST_VIEWBOX) centrado com 7% de margem
// A aura e o fundo podem desenhar no canvas inteiro (transbordam a caixa do avatar).

import { AVATAR_BUST_VIEWBOX, AVATAR_VIEWBOX } from '../../../avatar/layers';
import type { Mat } from '../../../avatar/rig';

export const STAGE_INNER = 0.86;
export const STAGE_TOP = 0.09;
export const STAGE_ASPECT = 0.8;

export interface StageBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StageLayout {
  /** tamanho do canvas em px */
  w: number;
  h: number;
  /** escala viewBox → px */
  s: number;
  /** origem do viewBox (0,0) no canvas */
  ox: number;
  oy: number;
  /** caixa do avatar no canvas (full: viewBox inteiro 100x140; bust: o recorte quadrado) */
  body: StageBox;
  /** matriz base do Skia (viewBox → canvas), linha a linha 3x3 */
  base: number[];
}

/** enquadramento pra um modo e tamanho (size = altura do canvas no full; lado no bust; `bustVb` = recorte da pessoa) */
export function stageLayout(mode: 'full' | 'bust', size: number, bustVb: StageBox = AVATAR_BUST_VIEWBOX): StageLayout {
  if (mode === 'bust') {
    const vb = bustVb;
    const inner = size * STAGE_INNER;
    const s = inner / vb.w;
    const m = (size - inner) / 2;
    const ox = m - vb.x * s;
    const oy = m - vb.y * s;
    return { w: size, h: size, s, ox, oy, body: { x: m, y: m, w: inner, h: inner }, base: [s, 0, ox, 0, s, oy, 0, 0, 1] };
  }
  const vb = AVATAR_VIEWBOX;
  const h = size;
  const w = Math.round(size * STAGE_ASPECT);
  const s = (h * STAGE_INNER) / vb.h;
  const ox = (w - vb.w * s) / 2;
  const oy = h * STAGE_TOP;
  return { w, h, s, ox, oy, body: { x: ox, y: oy, w: vb.w * s, h: vb.h * s }, base: [s, 0, ox, 0, s, oy, 0, 0, 1] };
}

/**
 * matriz 2x3 do grupo (avatar/rig.ts) com a translação no grid de pixels quando ela é só translação. `grid` = px da tela
 * por unidade do viewBox. Parado (ou sentado na cena) o sprite cai num pixel inteiro e sai nítido; girando, não mexe.
 */
export function snapToGrid(m: Mat, grid: number): Mat {
  'worklet';
  if (m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && grid > 0) return [1, 0, 0, 1, Math.round(m[4] * grid) / grid, Math.round(m[5] * grid) / grid];
  return m;
}
