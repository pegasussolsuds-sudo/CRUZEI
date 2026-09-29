// Gente invisível (modo anônimo) por perto, pra quem tem Premium — decisão do dono (29/09/2026): Premium vê que existe
// alguém invisível, mas NUNCA quem é; grátis não vê nada (nem o número). Regras puras aqui; o LocationService lê as
// presenças e decide quem entra. Nada que identifique a pessoa sai daqui: sem id, sem posição de ninguém.
// - agrupado por LUGAR (ponto do lugar) ou por QUADRA (centro da célula visual, geohash-7): um marcador com a contagem
// - só vira marcador onde há gente suficiente (visíveis + invisíveis) pra ninguém ser apontado: lugar/área com menos
//   de INVISIBLE_MIN_K pessoas entra só no total ("N invisíveis por perto"), sem ponto no mapa
import type { InvisibleGroup, InvisiblePresence, ProximityBand } from '@cruzei/shared-types';

import { cellCenter, PRIVACY } from './discovery-privacy';

export interface InvisibleItem {
  /** área de anonimato (geohash de PRIVACY.AREA_PRECISION) da presença */
  area: string;
  /** célula visual (geohash-7) da presença */
  vcell: string;
  /** lugar onde a presença está (se estiver num) */
  poi: { id: number; name: string; lat: number; lng: number } | null;
}

export interface InvisibleCounts {
  /** pessoas VISÍVEIS por área de anonimato (a mesma contagem que o /nearby usa pros visíveis) */
  visibleByArea: ReadonlyMap<string, number>;
  /** pessoas VISÍVEIS por lugar */
  visibleByPlace: ReadonlyMap<number, number>;
}

/** marcadores no máximo (o resto entra só no total) */
export const INVISIBLE_MAX_GROUPS = 60;

/**
 * Agrupa os invisíveis. `band` diz a faixa de distância do ponto do grupo até quem consulta (calculada fora: precisa
 * da posição real de quem consulta, que não entra aqui).
 */
export function groupInvisible(
  items: readonly InvisibleItem[],
  counts: InvisibleCounts,
  band: (p: { lat: number; lng: number }) => ProximityBand,
  minK = PRIVACY.INVISIBLE_MIN_K,
  maxGroups = INVISIBLE_MAX_GROUPS,
): InvisiblePresence {
  // invisíveis por lugar e por área (entram na conta de "gente suficiente" junto com os visíveis)
  const invByPlace = new Map<number, number>();
  const invByArea = new Map<string, number>();
  for (const it of items) {
    if (it.poi) invByPlace.set(it.poi.id, (invByPlace.get(it.poi.id) ?? 0) + 1);
    invByArea.set(it.area, (invByArea.get(it.area) ?? 0) + 1);
  }

  const groups = new Map<string, Omit<InvisibleGroup, 'band'>>();
  for (const it of items) {
    let key: string;
    let pos: { lat: number; lng: number };
    let poi: { id: number; name: string } | null = null;
    const placeTotal = it.poi
      ? (counts.visibleByPlace.get(it.poi.id) ?? 0) + (invByPlace.get(it.poi.id) ?? 0)
      : 0;
    if (it.poi && placeTotal >= minK) {
      key = `poi:${it.poi.id}`;
      pos = { lat: it.poi.lat, lng: it.poi.lng };
      poi = { id: it.poi.id, name: it.poi.name };
    } else {
      const areaTotal = (counts.visibleByArea.get(it.area) ?? 0) + (invByArea.get(it.area) ?? 0);
      if (areaTotal < minK) continue; // pouca gente em volta: só no total
      key = `cell:${it.vcell}`;
      pos = cellCenter(it.vcell);
    }
    const g = groups.get(key);
    if (g) g.count += 1;
    else groups.set(key, { key, lat: pos.lat, lng: pos.lng, count: 1, poi });
  }

  // os maiores grupos primeiro; empate pela chave (resposta estável entre consultas)
  const list = [...groups.values()]
    .sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .slice(0, maxGroups)
    .map((g) => ({ ...g, band: band(g) }));
  return { total: items.length, groups: list };
}
