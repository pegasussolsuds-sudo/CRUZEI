// Faixa de idade do "quem ver" (só o que EU vejo): regra, slider e texto — mesma conta no app e no servidor.
import { AGE_BUCKET_YEARS, AGE_MAX, AGE_MIN, AGE_RANGE_MIN_GAP, AGE_SLIDER_MAX } from '@cruzei/shared-types';

/** AGE_MIN <= min, min + AGE_RANGE_MIN_GAP <= max <= AGE_MAX, inteiros (faixa estreita ajudaria a achar idade escondida) */
export function isValidAgeRange(min: unknown, max: unknown): boolean {
  return (
    Number.isInteger(min) &&
    Number.isInteger(max) &&
    (min as number) >= AGE_MIN &&
    (max as number) - (min as number) >= AGE_RANGE_MIN_GAP &&
    (max as number) <= AGE_MAX
  );
}

/** valor do slider (AGE_MIN..AGE_SLIDER_MAX) → o que grava: o topo ("80+") vira AGE_MAX (sem limite em cima) */
export function sliderToAgeMax(v: number): number {
  const n = Math.round(v);
  return n >= AGE_SLIDER_MAX ? AGE_MAX : Math.max(AGE_MIN, n);
}

/** o que está gravado → posição no slider (acima do topo fica no topo) */
export function ageToSlider(v: number): number {
  return Math.min(AGE_SLIDER_MAX, Math.max(AGE_MIN, Math.round(v)));
}

/** faixa sem limite nenhum (18 até 80+) */
export function isAgeRangeOpen(min: number, max: number): boolean {
  return min <= AGE_MIN && max >= AGE_SLIDER_MAX;
}

/** "Qualquer idade" · "25 a 35 anos" · "30+ anos" · "até 40 anos" */
export function ageRangeLabel(min: number, max: number): string {
  if (isAgeRangeOpen(min, max)) return 'Qualquer idade';
  if (max >= AGE_SLIDER_MAX) return `${min}+ anos`;
  if (min <= AGE_MIN) return `até ${max} anos`;
  return min === max ? `${min} anos` : `${min} a ${max} anos`;
}

/** a idade exata cabe na faixa? (quem MOSTRA a idade) */
export function ageInRange(age: number, min: number, max: number): boolean {
  return age >= min && (max >= AGE_MAX || age <= max);
}

/** bloco de AGE_BUCKET_YEARS anos da idade, contado a partir de AGE_MIN: 18–22, 23–27, 28–32… */
export function ageBucket(age: number): { lo: number; hi: number } {
  const lo = AGE_MIN + Math.floor((age - AGE_MIN) / AGE_BUCKET_YEARS) * AGE_BUCKET_YEARS;
  return { lo, hi: lo + AGE_BUCKET_YEARS - 1 };
}

/**
 * Quem ESCONDE a idade: passa se o bloco dela encosta na faixa. O resultado depende só do bloco (nunca da idade
 * exata), então mudar a faixa quantas vezes for revela no máximo o bloco de 5 anos.
 */
export function ageBucketInRange(age: number, min: number, max: number): boolean {
  const b = ageBucket(age);
  return b.hi >= min && (max >= AGE_MAX || b.lo <= max);
}
