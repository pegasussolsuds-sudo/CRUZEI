import { useCallback, useState } from 'react';
import type { PlaceSuggestResponse } from '@cruzei/shared-types';
import { api, toApiError } from '../services/api';

// Contribuições pra descoberta de lugares (a galera ajuda a pôr lugares no mapa). O servidor responde sempre do
// mesmo jeito — nunca diz quem mais pediu, quantos, nem por que ainda não entrou.

/** lugares do Mapbox já pedidos nesta sessão (o card reaberto mostra "Pedido enviado") */
const requested = new Set<string>();

export type SuggestState = 'idle' | 'sending' | 'sent';

export function wasRequested(mapboxId: string): boolean {
  return requested.has(mapboxId);
}

/** "📌 Pôr no Metch" num lugar da busca. `onDone` recebe a resposta (ativo → focar no mapa; pendente → agradecer). */
export function usePlaceSuggest(mapboxId: string, onDone: (res: PlaceSuggestResponse) => void, onError: (message: string) => void) {
  const [state, setState] = useState<SuggestState>(() => (requested.has(mapboxId) ? 'sent' : 'idle'));
  const suggest = useCallback(async () => {
    if (state !== 'idle') return;
    setState('sending');
    try {
      const res = (await api.post<PlaceSuggestResponse>('/pois/suggest', { mapboxId })).data;
      if (res.status === 'pending') requested.add(mapboxId);
      setState(res.status === 'pending' ? 'sent' : 'idle');
      onDone(res);
    } catch (e) {
      setState('idle');
      const err = toApiError(e);
      onError(err.status === 429 ? 'Calma aí: tenta de novo mais tarde' : err.status && err.status < 500 ? err.message : 'Não deu agora. Tenta de novo já já');
    }
  }, [mapboxId, onDone, onError, state]);
  return { state, suggest };
}

/** "É o <nome>?" (confirm) / "Aqui não é lugar público" (deny) — só vale estando no lugar */
export async function votePlace(candidateId: string, vote: 'confirm' | 'deny'): Promise<boolean> {
  try {
    await api.post(`/pois/candidates/${encodeURIComponent(candidateId)}/vote`, { vote });
    return true;
  } catch {
    return false;
  }
}

export type PlaceReportReason = 'not_public' | 'residence' | 'closed' | 'wrong_place' | 'offensive';

/** "⚑ Reportar" um lugar descoberto pela galera (sempre { ok: true } quando o lugar existe) */
export async function reportPlace(poiId: number, reason: PlaceReportReason): Promise<boolean> {
  try {
    await api.post(`/pois/${poiId}/report`, { reason });
    return true;
  } catch {
    return false;
  }
}
