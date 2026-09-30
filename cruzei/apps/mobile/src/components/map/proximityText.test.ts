import type { ProximityBand } from '@cruzei/shared-types';

import { countByBand, matchDistanceText, nearbyCountTitle, previewDistanceText } from './proximityText';

describe('faixa "boost" não quebra frase', () => {
  it('folha da pessoa: boost vira só o rótulo; as outras dizem "de você"', () => {
    expect(previewDistanceText('boost')).toBe('em destaque na região');
    expect(previewDistanceText('very_near')).toBe('bem perto de você');
    expect(previewDistanceText('near')).toBe('perto de você');
    expect(previewDistanceText('region')).toBe('na sua região');
    expect(previewDistanceText(null)).toBe('por perto');
    expect(previewDistanceText('boost')).not.toMatch(/de você/);
  });

  it('match: boost tem frase própria; sem faixa não mostra nada', () => {
    expect(matchDistanceText('boost')).toBe('Vocês estão na mesma região — o Boost juntou vocês ⭐');
    expect(matchDistanceText('boost')).not.toMatch(/um do outro/);
    expect(matchDistanceText('near')).toBe('Vocês estão perto um do outro.');
    expect(matchDistanceText(undefined)).toBeNull();
  });

  it('contagem: Boost de longe (até 5 km) vai à parte do raio de 350 m', () => {
    const bands: (ProximityBand | null)[] = ['very_near', 'boost', 'near', 'boost', 'region', null];
    const c = countByBand(bands, (b) => b);
    expect(c).toEqual({ inRadius: 4, boosted: 2 });
    expect(nearbyCountTitle(c.inRadius - 1, c.boosted, 'em 350m')).toBe('3 pessoas em 350m · 2 em destaque');
    expect(nearbyCountTitle(1, 0, 'em 350m')).toBe('1 pessoa em 350m');
    expect(nearbyCountTitle(0, 1, 'num raio de 350 m')).toBe('0 pessoas num raio de 350 m · 1 em destaque');
  });
});
