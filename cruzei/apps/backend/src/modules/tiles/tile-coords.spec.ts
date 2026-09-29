import { acceptsGzip, boxesIntersect, etagMatches, mercatorUnit, parseTileCoords, tileBounds } from './tile-coords';

describe('parseTileCoords', () => {
  it('aceita inteiros dentro da faixa do zoom', () => {
    expect(parseTileCoords('14', '5994', '9069')).toEqual({ z: 14, x: 5994, y: 9069 });
    expect(parseTileCoords('0', '0', '0')).toEqual({ z: 0, x: 0, y: 0 });
    expect(parseTileCoords('16', '65535', '65535')).toEqual({ z: 16, x: 65535, y: 65535 });
    expect(parseTileCoords('24', '16777215', '0')).toEqual({ z: 24, x: 16777215, y: 0 });
  });

  it.each([
    ['abc', '1', '1'],
    ['14', '-1', '1'],
    ['14', '16384', '1'], // x = 2^14
    ['14', '1', '16384'],
    ['14', '01', '1'], // zero à esquerda
    ['014', '1', '1'],
    ['25', '0', '0'], // zoom alto demais
    ['1.5', '0', '0'],
    ['14', '1e3', '1'],
    ['14', '0x10', '1'],
    ['14', ' 1', '1'],
    ['14', '+1', '1'],
    ['14', '', '1'],
    ['14', '5994', '9069.mvt'],
    ['99999999999', '1', '1'],
    ['16', '123456789', '1'],
  ])('recusa z=%p x=%p y=%p', (z, x, y) => {
    expect(parseTileCoords(z, x, y)).toBeNull();
  });

  it('recusa o que não é string (query repetida vira array)', () => {
    expect(parseTileCoords(['14'], '1', '1')).toBeNull();
    expect(parseTileCoords(14, 1, 1)).toBeNull();
    expect(parseTileCoords(undefined, '1', '1')).toBeNull();
  });
});

describe('tileBounds / boxesIntersect', () => {
  it('z0 cobre o mundo (até ~85°)', () => {
    const [w, s, e, n] = tileBounds({ z: 0, x: 0, y: 0 });
    expect(w).toBe(-180);
    expect(e).toBe(180);
    expect(s).toBeCloseTo(-85.0511, 3);
    expect(n).toBeCloseTo(85.0511, 3);
  });

  it('o tile z14 do centro de Uberlândia contém a praça Tubal Vilela', () => {
    const [w, s, e, n] = tileBounds({ z: 14, x: 5994, y: 9069 });
    expect(w).toBeLessThan(-48.2772);
    expect(e).toBeGreaterThan(-48.2772);
    expect(s).toBeLessThan(-18.9186);
    expect(n).toBeGreaterThan(-18.9186);
  });

  it('margem aumenta a caixa pros quatro lados', () => {
    const a = tileBounds({ z: 16, x: 23979, y: 36276 });
    const b = tileBounds({ z: 16, x: 23979, y: 36276 }, 64 / 4096);
    expect(b[0]).toBeLessThan(a[0]);
    expect(b[1]).toBeLessThan(a[1]);
    expect(b[2]).toBeGreaterThan(a[2]);
    expect(b[3]).toBeGreaterThan(a[3]);
  });

  it('interseção de caixas (encostar conta)', () => {
    expect(boxesIntersect([0, 0, 1, 1], [1, 1, 2, 2])).toBe(true);
    expect(boxesIntersect([0, 0, 1, 1], [0.5, -1, 0.6, 3])).toBe(true);
    expect(boxesIntersect([0, 0, 1, 1], [1.01, 0, 2, 1])).toBe(false);
    expect(boxesIntersect([0, 0, 1, 1], [0, 1.01, 1, 2])).toBe(false);
  });

  it('unidade do tile em metros de Mercator', () => {
    expect(mercatorUnit(13, 4096)).toBeCloseTo(1.1943, 3);
    expect(mercatorUnit(16, 4096)).toBeCloseTo(0.1493, 3);
  });
});

describe('acceptsGzip', () => {
  it.each([
    ['gzip', true],
    ['gzip, deflate, br', true],
    ['br;q=1.0, gzip;q=0.8', true],
    ['GZIP', true],
    ['x-gzip', true],
    ['*', true],
    ['identity', false],
    ['gzip;q=0', false],
    ['*;q=0', false],
    ['deflate, *;q=0.1', true],
    ['', false],
  ])('%p → %p', (h, ok) => {
    expect(acceptsGzip(h)).toBe(ok);
  });

  it('sem cabeçalho não aceita', () => {
    expect(acceptsGzip(undefined)).toBe(false);
  });
});

describe('etagMatches', () => {
  const etag = 'W/"abc123"';
  it.each([
    ['W/"abc123"', true],
    ['"abc123"', true], // comparação fraca
    ['W/"x", W/"abc123"', true],
    ['*', true],
    ['W/"abc124"', false],
    ['', false],
  ])('%p → %p', (h, ok) => {
    expect(etagMatches(h, etag)).toBe(ok);
  });

  it('sem cabeçalho não bate', () => {
    expect(etagMatches(undefined, etag)).toBe(false);
  });
});
