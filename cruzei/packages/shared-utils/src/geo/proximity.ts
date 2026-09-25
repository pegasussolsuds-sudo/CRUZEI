// Faixas de proximidade (brief PRIVACIDADE §3): o app nunca mostra metros de outra pessoa — só a faixa.
import type { ProximityBand } from '@cruzei/shared-types';

export const PROXIMITY_BAND_RANK: Record<ProximityBand, number> = { very_near: 0, near: 1, region: 2 };

/** 'bem perto' | 'perto' | 'na região'; null/undefined → 'por perto' (sem faixa) */
export function proximityBandLabel(band: ProximityBand | null | undefined): string {
  if (band === 'very_near') return 'bem perto';
  if (band === 'near') return 'perto';
  if (band === 'region') return 'na região';
  return 'por perto';
}

/** '🟢 Bem perto' | '🟢 Perto' | '🟡 Na região' | '⚪ Por perto' */
export function proximityBandBadge(band: ProximityBand | null | undefined): string {
  if (band === 'very_near') return '🟢 Bem perto';
  if (band === 'near') return '🟢 Perto';
  if (band === 'region') return '🟡 Na região';
  return '⚪ Por perto';
}

/** ordem pra listas: mais perto primeiro; sem faixa por último */
export function proximityRank(band: ProximityBand | null | undefined): number {
  return band ? PROXIMITY_BAND_RANK[band] : 9;
}
