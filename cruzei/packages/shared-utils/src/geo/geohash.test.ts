import { decodeGeohash, decodeGeohashBounds, encodeGeohash, geohashNeighbors } from './geohash';

// valores de referência (ngeohash / geohash.org)
const CASES: [string, number, number, string][] = [
  ['Uberlândia', -18.9186, -48.2772, '6utsm7v'],
  ['São Paulo', -23.55, -46.63, '6gyf4bv'],
  ['Manaus', -3.1, -60.02, '6xmq65w'],
  ['Greenwich', 51.4779, -0.0015, 'gcpuzgq'],
  ['Tóquio', 35.6762, 139.6503, 'xn76cyd'],
];

describe('encodeGeohash', () => {
  it.each(CASES)('%s', (_name, lat, lng, expected) => {
    expect(encodeGeohash(lat, lng, 7)).toBe(expected);
    expect(encodeGeohash(lat, lng, 5)).toBe(expected.slice(0, 5));
  });

  it('cidades diferentes não caem na mesma célula (bug antigo: todas viravam "02578")', () => {
    const cells = new Set(CASES.map(([, lat, lng]) => encodeGeohash(lat, lng, 5)));
    expect(cells.size).toBe(CASES.length);
  });

  it('valida a precisão e as coordenadas', () => {
    expect(() => encodeGeohash(0, 0, 0)).toThrow();
    expect(() => encodeGeohash(0, 0, 13)).toThrow();
    expect(() => encodeGeohash(Number.NaN, 0, 5)).toThrow();
  });
});

describe('decodeGeohash', () => {
  it('volta pro centro da célula', () => {
    const d = decodeGeohash('6utsm7v');
    expect(Math.abs(d.latitude - -18.9186)).toBeLessThan(0.001);
    expect(Math.abs(d.longitude - -48.2772)).toBeLessThan(0.001);
  });

  it('a célula contém o ponto', () => {
    const b = decodeGeohashBounds(encodeGeohash(-18.9186, -48.2772, 6));
    expect(-18.9186).toBeGreaterThanOrEqual(b.latMin);
    expect(-18.9186).toBeLessThanOrEqual(b.latMax);
    expect(-48.2772).toBeGreaterThanOrEqual(b.lngMin);
    expect(-48.2772).toBeLessThanOrEqual(b.lngMax);
  });
});

describe('geohashNeighbors', () => {
  it('devolve a célula + 8 vizinhas, iguais às do ngeohash', () => {
    const n = geohashNeighbors('6utsm7');
    expect(n).toHaveLength(9);
    expect(n[0]).toBe('6utsm7');
    // vizinhas de 6utsm7 pelo ngeohash.neighbors
    expect(new Set(n)).toEqual(new Set(['6utsm7', '6utsmk', '6utsms', '6utsme', '6utsmd', '6utsm6', '6utsm4', '6utsm5', '6utsmh']));
  });
});
