import type { InvisibleGroup } from '@cruzei/shared-types';
import { drawPosition, MAX_INVISIBLE_GROUPS, NUDGE_M, invisibleFeatures, invisibleLabel, invisibleSummary, invisibleTapText } from './invisible';

function group(over: Partial<InvisibleGroup> = {}): InvisibleGroup {
  return { key: 'cell:6gyf4bf', lat: -23.55, lng: -46.63, count: 2, band: 'near', poi: null, ...over };
}

describe('invisibleLabel: rótulo do marcador (só texto, a fonte SDF não tem emoji)', () => {
  const cases: [number, string][] = [
    [1, '1 invisível'],
    [2, '2 invisíveis'],
    [15, '15 invisíveis'],
    [150, '99+ invisíveis'],
    [0, ''],
    [-3, ''],
    [Number.NaN, ''],
  ];
  it.each(cases)('%p → %p', (n, text) => {
    expect(invisibleLabel(n)).toBe(text);
  });

  it('nunca leva emoji nem caractere fora do latim', () => {
    for (const n of [1, 2, 99, 100]) expect(invisibleLabel(n)).toMatch(/^[0-9+ a-zíÍ]+$/);
  });
});

describe('invisibleSummary: resumo da folha', () => {
  it('Premium com gente invisível', () => {
    expect(invisibleSummary(3)).toBe(' · 👻 3 invisíveis por perto');
    expect(invisibleSummary(1)).toBe(' · 👻 1 invisível por perto');
  });
  it('grátis (null), ninguém ou valor estranho → nada', () => {
    expect(invisibleSummary(null)).toBe('');
    expect(invisibleSummary(undefined)).toBe('');
    expect(invisibleSummary(0)).toBe('');
    expect(invisibleSummary(Number.POSITIVE_INFINITY)).toBe('');
  });
});

describe('invisibleTapText: toque no marcador diz quantos, nunca quem', () => {
  it('quadra (sem lugar)', () => {
    expect(invisibleTapText(2)).toBe('👻 2 pessoas invisíveis aqui — o Metch não mostra quem são');
    expect(invisibleTapText(1, null)).toBe('👻 1 pessoa invisível aqui — o Metch não mostra quem é');
  });
  it('lugar público entra no texto', () => {
    expect(invisibleTapText(4, 'Bar do Zé')).toBe('👻 4 pessoas invisíveis em Bar do Zé — o Metch não mostra quem são');
  });
  it('nome em branco vira "aqui"; nome comprido corta', () => {
    expect(invisibleTapText(2, '   ')).toContain('invisíveis aqui');
    const long = invisibleTapText(2, 'L'.repeat(80));
    expect(long).toContain('…');
    expect(long.length).toBeLessThan(110);
  });
});

describe('invisibleFeatures: GeoJSON dos grupos', () => {
  it('um ponto por grupo na posição do grupo, com contagem e rótulo', () => {
    const fc = invisibleFeatures([group(), group({ key: 'poi:7', lat: -23.56, lng: -46.64, count: 1, poi: { id: 7, name: 'Bar do Zé' } })]);
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(2);
    expect(fc.features[0]).toEqual({ type: 'Feature', properties: { inv: 2, label: '2 invisíveis' }, geometry: { type: 'Point', coordinates: [-46.63, -23.55] } });
    expect(fc.features[1].properties).toEqual({ inv: 1, label: '1 invisível', place: 'Bar do Zé' });
    expect(fc.features[1].geometry.coordinates).toEqual([-46.64, -23.56]);
  });

  it('não leva chave do grupo, faixa, id do lugar nem id de feature', () => {
    const fc = invisibleFeatures([group({ key: 'poi:7', poi: { id: 7, name: 'Bar' } })]);
    const f = fc.features[0];
    expect(f.id).toBeUndefined();
    expect(Object.keys(f.properties).sort()).toEqual(['inv', 'label', 'place']);
    expect(JSON.stringify(fc)).not.toContain('poi:7');
    expect(JSON.stringify(fc)).not.toContain('near');
  });

  it('grátis (null/undefined) ou lista vazia → coleção vazia', () => {
    expect(invisibleFeatures(null).features).toEqual([]);
    expect(invisibleFeatures(undefined).features).toEqual([]);
    expect(invisibleFeatures([]).features).toEqual([]);
  });

  it('descarta contagem ≤ 0 e coordenada inválida', () => {
    const fc = invisibleFeatures([
      group({ key: 'a', count: 0 }),
      group({ key: 'b', count: -1 }),
      group({ key: 'c', lat: Number.NaN }),
      group({ key: 'd', lng: 200 }),
      group({ key: 'e', lat: 91 }),
      null as unknown as InvisibleGroup,
      group({ key: 'ok', count: 3 }),
    ]);
    expect(fc.features.map((f) => f.properties.inv)).toEqual([3]);
  });

  it('chave repetida vira um marcador só', () => {
    const fc = invisibleFeatures([group({ key: 'cell:x', count: 2 }), group({ key: 'cell:x', count: 5 })]);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].properties.inv).toBe(2);
  });

  it('contagem quebrada arredonda pra baixo', () => {
    expect(invisibleFeatures([group({ count: 2.7 })]).features[0].properties).toEqual({ inv: 2, label: '2 invisíveis' });
  });

  it('para no teto de marcadores', () => {
    const many = Array.from({ length: MAX_INVISIBLE_GROUPS + 10 }, (_, i) => group({ key: `cell:${i}`, lat: -23.5 + i * 0.001 }));
    expect(invisibleFeatures(many).features).toHaveLength(MAX_INVISIBLE_GROUPS);
  });
});

describe('drawPosition (o marcador não fica embaixo do meu avatar)', () => {
  const me = { lat: -18.9242, lng: -48.2709 };
  const meters = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
    Math.hypot((a.lat - b.lat) * 111_320, (a.lng - b.lng) * 111_320 * Math.cos((b.lat * Math.PI) / 180));

  it('longe de mim (ou sem minha posição): o ponto do servidor, sem mexer', () => {
    const far = { lat: -18.9262, lng: -48.2709 };
    expect(drawPosition(far, me)).toEqual(far);
    expect(drawPosition(far, null)).toEqual(far);
  });

  it('perto de mim: vai pro lado (leste), a NUDGE_M', () => {
    const near = { lat: me.lat + 10 / 111_320, lng: me.lng };
    const at = drawPosition(near, me);
    expect(at.lat).toBe(near.lat);
    expect(meters({ lat: me.lat, lng: at.lng }, me)).toBeCloseTo(NUDGE_M, 0);
    expect(at.lng).toBeGreaterThan(me.lng);
  });

  it('atrás do avatar (ao norte, alinhado): vai pro lado em que já estava', () => {
    const behindWest = { lat: me.lat + 60 / 111_320, lng: me.lng - 10 / (111_320 * Math.cos((me.lat * Math.PI) / 180)) };
    const at = drawPosition(behindWest, me);
    expect(at.lat).toBe(behindWest.lat);
    expect(at.lng).toBeLessThan(me.lng);
    expect(meters({ lat: me.lat, lng: at.lng }, me)).toBeCloseTo(NUDGE_M, 0);
  });

  it('ao norte mas bem ao lado, ou ao sul: fica onde está', () => {
    const side = { lat: me.lat + 60 / 111_320, lng: me.lng + 90 / (111_320 * Math.cos((me.lat * Math.PI) / 180)) };
    const south = { lat: me.lat - 80 / 111_320, lng: me.lng };
    expect(drawPosition(side, me)).toEqual(side);
    expect(drawPosition(south, me)).toEqual(south);
  });

});
