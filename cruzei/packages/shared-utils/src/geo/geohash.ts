// Geohash padrão (precisão 1-12 caracteres, 5 bits por caractere, longitude primeiro).
// Implementação pura sem dependências — compatível com ngeohash (o backend usa os dois).
//
// Histórico: até 28/09/2026 o encoder escrevia UM caractere por bit (em vez de um a cada 5 bits). Resultado: o Brasil
// inteiro caía na mesma "célula" ("02578" em precisão 5) — a presença do backend virava uma lista única do país, e as
// chaves de cache do app (nome do bairro, lugares perto) nunca mudavam ao mover o mapa.

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export function encodeGeohash(lat: number, lng: number, precision: number = 6): string {
  if (!Number.isInteger(precision) || precision < 1 || precision > 12) throw new Error('precision must be 1..12');
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('lat/lng must be finite');
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let evenBit = true; // bits pares = longitude
  let bitCount = 0;
  let idx = 0;
  let hash = '';

  while (hash.length < precision) {
    if (evenBit) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) {
        idx = idx * 2 + 1;
        lngMin = mid;
      } else {
        idx = idx * 2;
        lngMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        idx = idx * 2 + 1;
        latMin = mid;
      } else {
        idx = idx * 2;
        latMax = mid;
      }
    }
    evenBit = !evenBit;
    bitCount += 1;
    if (bitCount === 5) {
      hash += BASE32[idx];
      bitCount = 0;
      idx = 0;
    }
  }
  return hash;
}

export interface GeohashBounds {
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
}

export function decodeGeohashBounds(hash: string): GeohashBounds {
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let evenBit = true;

  for (const ch of hash.toLowerCase()) {
    const idx = BASE32.indexOf(ch);
    if (idx === -1) throw new Error(`invalid geohash char: ${ch}`);
    for (let n = 4; n >= 0; n--) {
      const bitN = (idx >> n) & 1;
      if (evenBit) {
        const mid = (lngMin + lngMax) / 2;
        if (bitN === 1) lngMin = mid;
        else lngMax = mid;
      } else {
        const mid = (latMin + latMax) / 2;
        if (bitN === 1) latMin = mid;
        else latMax = mid;
      }
      evenBit = !evenBit;
    }
  }
  return { latMin, latMax, lngMin, lngMax };
}

export function decodeGeohash(hash: string): { latitude: number; longitude: number } {
  const b = decodeGeohashBounds(hash);
  return {
    latitude: (b.latMin + b.latMax) / 2,
    longitude: (b.lngMin + b.lngMax) / 2,
  };
}

// Largura aproximada da célula em metros por nível (no equador)
const PRECISION_M = {
  1: 5_000_000,
  2: 1_250_000,
  3: 156_000,
  4: 39_100,
  5: 4_890,
  6: 1_220,
  7: 153,
  8: 38,
} as const;

export function geohashPrecisionMeters(precision: number): number {
  return PRECISION_M[precision as keyof typeof PRECISION_M] ?? 0;
}

/** a própria célula + as 8 vizinhas (sem repetir; perto dos polos/antimeridiano algumas podem coincidir) */
export function geohashNeighbors(hash: string): string[] {
  const b = decodeGeohashBounds(hash);
  const dLat = b.latMax - b.latMin;
  const dLng = b.lngMax - b.lngMin;
  const cLat = (b.latMin + b.latMax) / 2;
  const cLng = (b.lngMin + b.lngMax) / 2;
  const out: string[] = [];
  for (const dy of [0, 1, -1]) {
    for (const dx of [0, 1, -1]) {
      const lat = Math.max(-89.999999, Math.min(89.999999, cLat + dy * dLat));
      let lng = cLng + dx * dLng;
      if (lng > 180) lng -= 360;
      if (lng < -180) lng += 360;
      const h = encodeGeohash(lat, lng, hash.length);
      if (!out.includes(h)) out.push(h);
    }
  }
  return out;
}
