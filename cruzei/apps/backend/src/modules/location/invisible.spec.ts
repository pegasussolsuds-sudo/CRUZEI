import type { ProximityBand } from '@cruzei/shared-types';

import { cellCenter, cellOf } from './discovery-privacy';
import { groupInvisible, type InvisibleItem } from './invisible';

// Premium vê que existe gente invisível, nunca quem é: um marcador por lugar/quadra, só onde há gente suficiente.

const BAR = { id: 7, name: 'Bar do Léo', lat: -18.9231, lng: -48.2701 };
const vcell = cellOf(-18.9242, -48.2709, 7);
const area = cellOf(-18.9242, -48.2709, 6);
const near = (): ProximityBand => 'near';
const counts = (byArea: [string, number][] = [], byPlace: [number, number][] = []) => ({
  visibleByArea: new Map(byArea),
  visibleByPlace: new Map(byPlace),
});
const inv = (poi: InvisibleItem['poi'] = null, cell = vcell): InvisibleItem => ({
  area,
  vcell: cell,
  poi,
});

describe('groupInvisible (invisíveis pra Premium, sem identidade)', () => {
  it('nada por perto: total 0 e nenhum marcador', () => {
    expect(groupInvisible([], counts(), near)).toEqual({ total: 0, groups: [] });
  });

  it('um invisível sozinho numa área vazia: só no total, sem ponto no mapa', () => {
    expect(groupInvisible([inv()], counts(), near, 3)).toEqual({ total: 1, groups: [] });
  });

  it('com gente suficiente na área (visíveis + invisíveis ≥ K): marcador no CENTRO da quadra com a contagem', () => {
    const out = groupInvisible([inv(), inv()], counts([[area, 1]]), near, 3);
    expect(out.total).toBe(2);
    expect(out.groups).toEqual([
      { key: `cell:${vcell}`, ...cellCenter(vcell), count: 2, band: 'near', poi: null },
    ]);
  });

  it('num lugar com gente suficiente: marcador no PONTO do lugar, com o nome do lugar', () => {
    const out = groupInvisible([inv(BAR), inv(BAR)], counts([], [[BAR.id, 1]]), near, 3);
    expect(out.groups).toEqual([
      {
        key: `poi:${BAR.id}`,
        lat: BAR.lat,
        lng: BAR.lng,
        count: 2,
        band: 'near',
        poi: { id: BAR.id, name: BAR.name },
      },
    ]);
  });

  it('lugar com pouca gente cai pra quadra (se a área tiver gente) ou só pro total', () => {
    const soAoTotal = groupInvisible([inv(BAR)], counts(), near, 3);
    expect(soAoTotal).toEqual({ total: 1, groups: [] });
    const naQuadra = groupInvisible([inv(BAR)], counts([[area, 5]]), near, 3);
    expect(naQuadra.groups.map((g) => g.key)).toEqual([`cell:${vcell}`]);
  });

  it('nada que identifique a pessoa sai: só chave do lugar/quadra, posição do lugar/centro, contagem, faixa e lugar', () => {
    const out = groupInvisible(
      [inv(), inv(), inv(BAR)],
      counts([[area, 3]], [[BAR.id, 3]]),
      near,
      3,
    );
    for (const g of out.groups) {
      expect(Object.keys(g).sort()).toEqual(['band', 'count', 'key', 'lat', 'lng', 'poi']);
      expect(g.key).toMatch(/^(poi|cell):/);
    }
  });

  it('maiores grupos primeiro, com teto de marcadores (o resto fica no total)', () => {
    const other = cellOf(-18.93, -48.28, 7);
    const items = [inv(), inv(), inv(null, other)];
    const out = groupInvisible(items, counts([[area, 5]]), near, 3, 1);
    expect(out.total).toBe(3);
    expect(out.groups).toHaveLength(1);
    expect(out.groups[0]).toMatchObject({ key: `cell:${vcell}`, count: 2 });
  });
});
