import { AGE_MAX, AGE_RANGE_MIN_GAP } from '@cruzei/shared-types';
import { ageRangeLabel, isValidAgeRange, sliderToAgeMax } from '@cruzei/shared-utils';

import {
  ageToProgress,
  maxThumbLimit,
  minThumbLimit,
  pickThumb,
  progressToAge,
  sliderLabel,
  withAgeGap,
} from './ageSlider';

describe('slider de faixa de idade', () => {
  it('posição ⇄ idade: 0 = 18, 1 = 80 ("80+"), arredonda pro ano inteiro', () => {
    expect(progressToAge(0)).toBe(18);
    expect(progressToAge(1)).toBe(80);
    expect(progressToAge(-0.2)).toBe(18);
    expect(progressToAge(1.3)).toBe(80);
    expect(progressToAge(ageToProgress(35))).toBe(35);
    // 99 (sem limite, gravado) fica no topo
    expect(ageToProgress(AGE_MAX)).toBe(1);
  });

  it('pega o polegar mais perto; empate fica pro primeiro movimento decidir', () => {
    expect(pickThumb(10, 0, 100)).toBe('min');
    expect(pickThumb(90, 0, 100)).toBe('max');
    expect(pickThumb(50, 50, 50)).toBe('tie');
  });

  it('o texto bate com o ageRangeLabel do shared-utils pra toda faixa (o topo grava 99)', () => {
    for (let a = 18; a <= 80; a++) {
      for (let b = a; b <= 80; b++) {
        expect(sliderLabel(a, b)).toBe(ageRangeLabel(a, sliderToAgeMax(b)));
      }
    }
  });
});

describe('vão mínimo de 4 anos no slider (a mesma regra do servidor)', () => {
  it('arrastando: o "de" para 4 anos antes do "até"; com o "até" no "80+", vai até o topo', () => {
    expect(progressToAge(minThumbLimit(ageToProgress(40)))).toBe(36);
    expect(minThumbLimit(1)).toBe(1);
    expect(progressToAge(maxThumbLimit(ageToProgress(30)))).toBe(34);
    // "de" perto do topo: o "até" fica no "80+"
    expect(maxThumbLimit(ageToProgress(78))).toBe(1);
    expect(minThumbLimit(0)).toBe(0);
  });

  it('soltou: o polegar que mexeu para no limite, o outro fica', () => {
    expect(withAgeGap(38, 40, 'min')).toEqual([36, 40]);
    expect(withAgeGap(30, 31, 'max')).toEqual([30, 34]);
    expect(withAgeGap(25, 35, 'min')).toEqual([25, 35]);
    // "até" no topo ("80+"): qualquer "de" vale
    expect(withAgeGap(80, 80, 'min')).toEqual([80, 80]);
    expect(withAgeGap(78, 79, 'max')).toEqual([78, 80]);
    // faixa antiga estreita lá embaixo: abre a partir dos 18
    expect(withAgeGap(19, 20, 'min')).toEqual([18, 22]);
  });

  it('tudo que o slider grava passa na regra do servidor', () => {
    const bad: string[] = [];
    for (let a = 18; a <= 80; a++)
      for (let b = 18; b <= 80; b++)
        for (const moved of ['min', 'max'] as const) {
          const [x, y] = withAgeGap(a, b, moved);
          if (!isValidAgeRange(x, sliderToAgeMax(y))) bad.push(`${a}-${b} ${moved}`);
        }
    expect(bad).toEqual([]);
    expect(AGE_RANGE_MIN_GAP).toBe(4);
  });
});
