// Índice em memória dos lugares (POIs) pro caminho quente da localização.
//
// Cada POST /location/update precisava de 1–2 consultas só pra saber "em que lugar essa pessoa está" (bbox de 60 m
// sem índice espacial = varredura da tabela) e de um COUNT(*) da tabela inteira. Com 40 mil pessoas atualizando a
// cada ~30 s isso vira milhares de consultas por segundo pra um dado público que quase nunca muda. O índice é uma
// grade simples (células de 0,01° ≈ 1,1 km) recarregada a cada minuto; a busca continua exata (distância real).
import { bboxAround, distanceMeters } from '@cruzei/shared-utils';

export interface PoiPoint {
  id: number;
  name: string;
  lat: number;
  lng: number;
  city: string | null;
}

const STEP_DEG = 0.01;

export class PoiIndex {
  private readonly grid = new Map<string, PoiPoint[]>();
  private readonly byIdMap = new Map<number, PoiPoint>();
  private readonly perCity = new Map<string, number>();

  constructor(pois: readonly PoiPoint[]) {
    for (const p of pois) {
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
      this.byIdMap.set(p.id, p);
      const key = PoiIndex.key(Math.floor(p.lat / STEP_DEG), Math.floor(p.lng / STEP_DEG));
      const bucket = this.grid.get(key);
      if (bucket) bucket.push(p);
      else this.grid.set(key, [p]);
      if (p.city != null) this.perCity.set(p.city, (this.perCity.get(p.city) ?? 0) + 1);
    }
  }

  private static key(i: number, j: number): string {
    return `${i}:${j}`;
  }

  get size(): number {
    return this.byIdMap.size;
  }

  byId(id: number): PoiPoint | undefined {
    return this.byIdMap.get(id);
  }

  /** mesmo filtro do `WHERE city = $1` (igualdade exata); sem cidade = todos */
  countByCity(city?: string | null): number {
    return city ? (this.perCity.get(city) ?? 0) : this.byIdMap.size;
  }

  /** lugares dentro do retângulo (limites inclusivos, como o `gte/lte` da consulta antiga) */
  inBox(south: number, north: number, west: number, east: number): PoiPoint[] {
    const out: PoiPoint[] = [];
    const i0 = Math.floor(south / STEP_DEG);
    const i1 = Math.floor(north / STEP_DEG);
    const j0 = Math.floor(west / STEP_DEG);
    const j1 = Math.floor(east / STEP_DEG);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const bucket = this.grid.get(PoiIndex.key(i, j));
        if (!bucket) continue;
        for (const p of bucket) if (p.lat >= south && p.lat <= north && p.lng >= west && p.lng <= east) out.push(p);
      }
    }
    return out;
  }

  /** o lugar mais próximo a <= snapM da posição (busca num quadrado de searchM); null se nenhum */
  nearest(lat: number, lng: number, searchM: number, snapM: number): PoiPoint | null {
    const bbox = bboxAround(lat, lng, searchM);
    let best: PoiPoint | null = null;
    let bestD = snapM;
    for (const p of this.inBox(bbox.south, bbox.north, bbox.west, bbox.east)) {
      const d = distanceMeters(lat, lng, p.lat, p.lng);
      if (d <= bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }
}
