// Frases com a faixa de proximidade. A faixa 'boost' ("em destaque na região", até 5 km) não é distância entre duas
// pessoas: não cabe em "X de você" / "estão X um do outro" e não entra na conta de quem está no raio de 350 m.
import type { ProximityBand } from '@cruzei/shared-types';
import { proximityBandLabel } from '@cruzei/shared-utils';

/** "📍 ..." da folha da pessoa no mapa */
export function previewDistanceText(band: ProximityBand | null | undefined): string {
  if (!band) return 'por perto';
  if (band === 'boost') return proximityBandLabel(band); // só o rótulo: "em destaque na região"
  if (band === 'region') return 'na sua região';
  return `${proximityBandLabel(band)} de você`;
}

/** frase da comemoração do match (null = sem faixa) */
export function matchDistanceText(band: ProximityBand | null | undefined): string | null {
  if (!band) return null;
  if (band === 'boost') return 'Vocês estão na mesma região — o Boost juntou vocês ⭐';
  return `Vocês estão ${proximityBandLabel(band)} um do outro.`;
}

/** separa quem está no raio de quem só aparece pelo Boost (até 5 km) */
export function countByBand<T>(users: readonly T[], bandOf: (u: T) => ProximityBand | null | undefined): { inRadius: number; boosted: number } {
  let boosted = 0;
  for (const u of users) if (bandOf(u) === 'boost') boosted++;
  return { inRadius: users.length - boosted, boosted };
}

/** título da folha: "3 pessoas em 350m · 2 em destaque" (o Boost de longe conta à parte) */
export function nearbyCountTitle(inRadius: number, boosted: number, radiusText: string): string {
  const base = `${inRadius} ${inRadius === 1 ? 'pessoa' : 'pessoas'} ${radiusText}`;
  return boosted > 0 ? `${base} · ${boosted} em destaque` : base;
}
