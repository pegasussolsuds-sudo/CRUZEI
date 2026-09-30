import { FIX_MAX_AGE_MS, isFreshFix, locationUpdateBody, toCruzeiLocation } from './locationFix';

const NOW = Date.UTC(2026, 9, 3, 20, 0, 0);
const pos = (o: { mocked?: boolean; timestamp?: number; accuracy?: number | null } = {}) => ({
  coords: { latitude: -18.923, longitude: -48.27, accuracy: o.accuracy === undefined ? 12.4 : o.accuracy },
  timestamp: o.timestamp ?? NOW,
  mocked: o.mocked,
});

describe('toCruzeiLocation', () => {
  it('mocked só quando o sistema diz que sim', () => {
    expect(toCruzeiLocation(pos({ mocked: true })).mocked).toBe(true);
    expect(toCruzeiLocation(pos({ mocked: false })).mocked).toBeUndefined();
    expect(toCruzeiLocation(pos()).mocked).toBeUndefined();
  });

  it('precisão arredondada; sem precisão = 0', () => {
    expect(toCruzeiLocation(pos()).accuracyMeters).toBe(12);
    expect(toCruzeiLocation(pos({ accuracy: null })).accuracyMeters).toBe(0);
  });

  it('última posição do sistema com mais de 5 min vira "velha" (não vai pro servidor)', () => {
    expect(toCruzeiLocation(pos({ timestamp: NOW - 60_000 }), { lastKnown: true, now: NOW }).stale).toBeUndefined();
    expect(toCruzeiLocation(pos({ timestamp: NOW - FIX_MAX_AGE_MS - 1 }), { lastKnown: true, now: NOW }).stale).toBe(true);
    // posição atual (não é do cache) nunca é velha
    expect(toCruzeiLocation(pos({ timestamp: NOW - 3_600_000 }), { now: NOW }).stale).toBeUndefined();
  });
});

describe('isFreshFix', () => {
  it('sem horário é velha', () => {
    expect(isFreshFix(undefined, NOW)).toBe(false);
    expect(isFreshFix(NOW - 1_000, NOW)).toBe(true);
  });
});

describe('locationUpdateBody', () => {
  it('só os campos aceitos pelo servidor; mocked só quando true', () => {
    expect(locationUpdateBody({ latitude: 1, longitude: 2, accuracyMeters: 10, stale: true })).toEqual({ latitude: 1, longitude: 2, accuracyMeters: 10 });
    expect(locationUpdateBody({ latitude: 1, longitude: 2, mocked: true })).toEqual({ latitude: 1, longitude: 2, mocked: true });
    expect(locationUpdateBody({ latitude: 1, longitude: 2, accuracyMeters: 0, mocked: false })).toEqual({ latitude: 1, longitude: 2 });
  });
});
