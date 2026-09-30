// Geometria do slider de faixa de idade (dois polegares): posição 0..1 ⇄ idade AGE_MIN..AGE_SLIDER_MAX, qual polegar
// o dedo pegou e o vão mínimo de AGE_RANGE_MIN_GAP anos entre eles. Tudo 'worklet' (roda na UI thread durante o
// arrasto) e puro (testável no jest).
import { AGE_MIN, AGE_RANGE_MIN_GAP, AGE_SLIDER_MAX } from '@cruzei/shared-types';

const SPAN = AGE_SLIDER_MAX - AGE_MIN;
/** o vão mínimo em posição (0..1) */
const GAP_P = AGE_RANGE_MIN_GAP / SPAN;

/** até onde o "de" pode ir com o "até" em `pMax`: vão de 4 anos; com o "até" no topo ("80+", sem limite), até o topo */
export function minThumbLimit(pMax: number): number {
  'worklet';
  return pMax >= 1 ? 1 : Math.max(0, pMax - GAP_P);
}

/** até onde o "até" pode descer com o "de" em `pMin` (encostando no topo, fica no "80+") */
export function maxThumbLimit(pMin: number): number {
  'worklet';
  return Math.min(1, pMin + GAP_P);
}

/**
 * Faixa do slider (idades 18..80; 80 = "80+", sem limite) dentro do vão: o polegar que mexeu para onde dá, o outro
 * fica. "até" no topo aceita qualquer "de" (80+ sempre tem vão). Garante a regra depois do arredondamento pro ano.
 */
export function withAgeGap(minAge: number, maxAge: number, moved: 'min' | 'max'): [number, number] {
  'worklet';
  if (maxAge >= AGE_SLIDER_MAX || maxAge - minAge >= AGE_RANGE_MIN_GAP) return [minAge, maxAge];
  if (moved === 'max') return [minAge, Math.min(AGE_SLIDER_MAX, minAge + AGE_RANGE_MIN_GAP)];
  const a = maxAge - AGE_RANGE_MIN_GAP;
  // faixa antiga estreita demais lá embaixo: abre a partir dos 18
  return a >= AGE_MIN ? [a, maxAge] : [AGE_MIN, AGE_MIN + AGE_RANGE_MIN_GAP];
}

/** posição 0..1 → idade inteira do slider (18..80) */
export function progressToAge(p: number): number {
  'worklet';
  const clamped = Math.min(1, Math.max(0, p));
  return Math.round(AGE_MIN + clamped * SPAN);
}

/** idade → posição 0..1 (acima de 80 fica no topo) */
export function ageToProgress(age: number): number {
  'worklet';
  return Math.min(1, Math.max(0, (Math.min(AGE_SLIDER_MAX, age) - AGE_MIN) / SPAN));
}

/**
 * Qual polegar o toque pegou: o mais perto. Empate (os dois no mesmo lugar: só no topo, "80+ anos") → 'tie' e o
 * primeiro movimento decide (pra esquerda = "de", pra direita = "até"); encostados no topo, só o "de" consegue sair.
 */
export function pickThumb(x: number, minX: number, maxX: number): 'min' | 'max' | 'tie' {
  'worklet';
  const dMin = Math.abs(x - minX);
  const dMax = Math.abs(x - maxX);
  if (dMin < dMax) return 'min';
  if (dMax < dMin) return 'max';
  return 'tie';
}

/** texto da faixa no slider (idades do slider: 80 = "80+") — mesmo texto do ageRangeLabel do shared-utils */
export function sliderLabel(minAge: number, maxAge: number): string {
  'worklet';
  if (minAge <= AGE_MIN && maxAge >= AGE_SLIDER_MAX) return 'Qualquer idade';
  if (maxAge >= AGE_SLIDER_MAX) return `${minAge}+ anos`;
  if (minAge <= AGE_MIN) return `até ${maxAge} anos`;
  return minAge === maxAge ? `${minAge} anos` : `${minAge} a ${maxAge} anos`;
}
