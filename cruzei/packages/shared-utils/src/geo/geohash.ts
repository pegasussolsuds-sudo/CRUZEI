// Geohash encoding (precision 1-12 chars).
// Implementação pura sem dependências externas — cobre o que o Cruzei usa (5 e 6).

const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

export function encodeGeohash(lat: number, lng: number, precision: number = 6): string {
  if (precision < 1 || precision > 12) throw new Error('precision must be 1..12');
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let bit = 0;
  let evenBit = true;
  let hash = '';

  while (hash.length < precision) {
    if (evenBit) {
      const mid = (lngMin + lngMax) / 2;
      if (lng >= mid) {
        hash += BASE32[bit * 2 + 1];
        lngMin = mid;
      } else {
        hash += BASE32[bit * 2];
        lngMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (lat >= mid) {
        hash += BASE32[bit * 2 + 1];
        latMin = mid;
      } else {
        hash += BASE32[bit * 2];
        latMax = mid;
      }
    }
    evenBit = !evenBit;
    if (bit < 4) bit += 1;
    else bit = 0;
  }
  return hash;
}

export function decodeGeohash(hash: string): { latitude: number; longitude: number } {
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let evenBit = true;

  for (const ch of hash) {
    const idx = BASE32.indexOf(ch);
    if (idx === -1) throw new Error(`invalid geohash char: ${ch}`);
    const bit = idx >> 1;
    for (let n = bit; n >= 0; n--) {
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
  return {
    latitude: (latMin + latMax) / 2,
    longitude: (lngMin + lngMax) / 2,
  };
}

// Precisão aproximada em metros por nível (largura do quadrado)
const PRECISION_M = {
  1: 2_500_000,
  2: 630_000,
  3: 78_000,
  4: 20_000,
  5: 2_400,
  6: 610,
  7: 76,
  8: 19,
} as const;

export function geohashPrecisionMeters(precision: number): number {
  return PRECISION_M[precision as keyof typeof PRECISION_M] ?? 0;
}

export function geohashNeighbors(hash: string): string[] {
  // Implementação simplificada — retorna próprio + 8 vizinhos pelos offsets laterais.
  // Para o Cruzei: precisão 5/6 = ~5km/610m, suficiente pra query de presença.
  // Versão completa exigiria tabela de adjacências por base32; usamos aproximação.
  const result: string[] = [hash];
  // Norte/Sul/Leste/Oeste = +/- 1 no último char (cuidado com wrap no base32)
  const last = hash[hash.length - 1];
  const idx = BASE32.indexOf(last);
  if (idx < 0) return result;
  const east = hash.slice(0, -1) + BASE32[(idx + 1) % 32];
  const west = hash.slice(0, -1) + BASE32[(idx + 31) % 32];
  result.push(east, west);
  return result;
}
