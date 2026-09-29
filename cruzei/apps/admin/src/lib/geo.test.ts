import { describe, expect, it } from 'vitest';
import { boundsOf, circleRing, formatLatLng, formatRadius, isValidLatLng, parseLatLng } from './geo';

function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_008.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

describe('círculo do raio', () => {
  const center = { lat: -18.9186, lng: -48.2772 };

  it('anel fechado com todos os pontos na distância do raio', () => {
    const ring = circleRing(center, 5000, 32);
    expect(ring).toHaveLength(33);
    expect(ring[0]).toEqual(ring[32]);
    for (const [lng, lat] of ring) {
      expect(Math.abs(haversine(center, { lat, lng }) - 5000)).toBeLessThan(5);
    }
  });
});

describe('enquadramento', () => {
  it('ignora pontos inválidos', () => {
    expect(boundsOf([])).toBeNull();
    expect(
      boundsOf([
        { lat: -18, lng: -48 },
        { lat: -19, lng: -47 },
        { lat: Number.NaN, lng: 0 },
      ]),
    ).toEqual([
      [-48, -19],
      [-47, -18],
    ]);
  });
});

describe('coordenadas coladas', () => {
  it('formatos comuns', () => {
    expect(parseLatLng('-18.9186, -48.2772')).toEqual({ lat: -18.9186, lng: -48.2772 });
    expect(parseLatLng('-18.9186 -48.2772')).toEqual({ lat: -18.9186, lng: -48.2772 });
    expect(parseLatLng('-18,9186 -48,2772')).toEqual({ lat: -18.9186, lng: -48.2772 });
    expect(parseLatLng('https://www.openstreetmap.org/#map=17/@-18.91,-48.27')).toEqual({ lat: -18.91, lng: -48.27 });
  });

  it('recusa lixo e fora do globo', () => {
    expect(parseLatLng('')).toBeNull();
    expect(parseLatLng('rua tal')).toBeNull();
    expect(parseLatLng('95, 10')).toBeNull();
  });

  it('valida e formata', () => {
    expect(isValidLatLng(-18, -48)).toBe(true);
    expect(isValidLatLng(null, -48)).toBe(false);
    expect(formatLatLng({ lat: -18.918612, lng: -48.27721 })).toBe('-18.91861, -48.27721');
    expect(formatLatLng(null)).toBe('—');
  });
});

it('raio em texto', () => {
  expect(formatRadius(800)).toBe('800 m');
  expect(formatRadius(2500)).toBe('2,5 km');
  expect(formatRadius(10_000)).toBe('10 km');
  expect(formatRadius(42_400)).toBe('42 km');
});
