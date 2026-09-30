import { AGE_BUCKET_YEARS, AGE_MAX, AGE_MIN, AGE_RANGE_MIN_GAP, AGE_SLIDER_MAX } from '@cruzei/shared-types';

import {
  ageBucket,
  ageBucketInRange,
  ageInRange,
  ageRangeLabel,
  ageToSlider,
  isAgeRangeOpen,
  isValidAgeRange,
  sliderToAgeMax,
} from './age-range';

describe('faixa de idade do "quem ver"', () => {
  it('regra: 18 <= min, min + 4 <= max <= 99, inteiros', () => {
    expect(AGE_RANGE_MIN_GAP).toBe(4);
    expect(isValidAgeRange(AGE_MIN, AGE_MAX)).toBe(true);
    expect(isValidAgeRange(25, 29)).toBe(true);
    expect(isValidAgeRange(17, 30)).toBe(false);
    expect(isValidAgeRange(30, 25)).toBe(false);
    expect(isValidAgeRange(18, 100)).toBe(false);
    expect(isValidAgeRange(18.5, 30)).toBe(false);
    expect(isValidAgeRange('18', 30)).toBe(false);
  });

  it('vão mínimo de 4 anos: faixa estreita demais é recusada (inclusive "de" no topo com "80+")', () => {
    expect(isValidAgeRange(25, 25)).toBe(false);
    expect(isValidAgeRange(25, 28)).toBe(false);
    expect(isValidAgeRange(80, AGE_MAX)).toBe(true); // "80+ anos"
    expect(isValidAgeRange(95, AGE_MAX)).toBe(true);
    expect(isValidAgeRange(96, AGE_MAX)).toBe(false);
  });

  it('slider: o topo ("80+") grava 99 e volta pro topo', () => {
    expect(sliderToAgeMax(AGE_SLIDER_MAX)).toBe(AGE_MAX);
    expect(sliderToAgeMax(79.6)).toBe(AGE_MAX);
    expect(sliderToAgeMax(40)).toBe(40);
    expect(ageToSlider(AGE_MAX)).toBe(AGE_SLIDER_MAX);
    expect(ageToSlider(10)).toBe(AGE_MIN);
  });

  it('texto', () => {
    expect(isAgeRangeOpen(AGE_MIN, AGE_MAX)).toBe(true);
    expect(ageRangeLabel(AGE_MIN, AGE_MAX)).toBe('Qualquer idade');
    expect(ageRangeLabel(30, AGE_MAX)).toBe('30+ anos');
    expect(ageRangeLabel(AGE_MIN, 40)).toBe('até 40 anos');
    expect(ageRangeLabel(25, 35)).toBe('25 a 35 anos');
    expect(ageRangeLabel(30, 30)).toBe('30 anos');
  });

  it('idade exata dentro da faixa (topo 99 = sem limite)', () => {
    expect(ageInRange(25, 25, 35)).toBe(true);
    expect(ageInRange(36, 25, 35)).toBe(false);
    expect(ageInRange(24, 25, 35)).toBe(false);
    expect(ageInRange(120, 30, AGE_MAX)).toBe(true);
  });
});

describe('bloco de 5 anos de quem esconde a idade', () => {
  it('blocos a partir de 18: 18–22, 23–27, 28–32…', () => {
    expect(AGE_BUCKET_YEARS).toBe(5);
    expect(ageBucket(18)).toEqual({ lo: 18, hi: 22 });
    expect(ageBucket(22)).toEqual({ lo: 18, hi: 22 });
    expect(ageBucket(23)).toEqual({ lo: 23, hi: 27 });
    expect(ageBucket(31)).toEqual({ lo: 28, hi: 32 });
    expect(ageBucket(99)).toEqual({ lo: 98, hi: 102 });
  });

  it('passa se o bloco encosta na faixa (mesmo com a idade exata fora)', () => {
    // 23 anos, bloco 23–27: faixa 25–30 encosta
    expect(ageBucketInRange(23, 25, 30)).toBe(true);
    // 32 anos, bloco 28–32: encosta em 25–30
    expect(ageBucketInRange(32, 25, 30)).toBe(true);
    // 33 anos, bloco 33–37: não encosta
    expect(ageBucketInRange(33, 25, 30)).toBe(false);
    // 22 anos, bloco 18–22: não encosta em 23–40
    expect(ageBucketInRange(22, 23, 40)).toBe(false);
    // topo 99 = sem limite em cima
    expect(ageBucketInRange(105, 60, AGE_MAX)).toBe(true);
    expect(ageBucketInRange(57, 60, AGE_MAX)).toBe(false); // bloco 53–57
  });

  it('o resultado depende só do bloco: nenhuma faixa separa duas idades do mesmo bloco', () => {
    const leaks: string[] = [];
    for (let min = AGE_MIN; min <= AGE_MAX; min++) {
      for (let max = min + AGE_RANGE_MIN_GAP; max <= AGE_MAX; max++) {
        for (let age = AGE_MIN; age <= 104; age++) {
          const lo = ageBucket(age).lo;
          if (ageBucketInRange(age, min, max) !== ageBucketInRange(lo, min, max))
            leaks.push(`${age} em ${min}-${max}`);
        }
      }
    }
    expect(leaks).toEqual([]);
  });

  it('quem está na faixa pela idade exata também passa pelo bloco (o bloco só alarga)', () => {
    for (let age = AGE_MIN; age <= 104; age++) {
      for (const [min, max] of [
        [25, 30],
        [18, 22],
        [40, AGE_MAX],
        [60, 80],
      ]) {
        if (ageInRange(age, min, max)) expect(ageBucketInRange(age, min, max)).toBe(true);
      }
    }
  });
});
