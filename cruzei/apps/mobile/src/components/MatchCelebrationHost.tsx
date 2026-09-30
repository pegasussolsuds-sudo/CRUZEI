import React, { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { MatchModal } from './MatchModal';
import { inboxKeys } from '../hooks/useInbox';
import { dismissPushesTagged } from '../services/notifications';
import { useMatchCelebrationStore } from '../stores/matchCelebration';

/** depois que a tela ficou livre, um respiro antes da comemoração (o mapa acabou de aparecer / a anterior fechou) */
const SETTLE_MS = 1_200;
/** mapa que não carregou (sem rede, estilo fora): não segura a comemoração pra sempre */
const NO_MAP_SETTLE_MS = 6_000;
/** entre uma comemoração e a próxima */
const BETWEEN_MS = 600;

/**
 * Mostra a comemoração do match pra QUEM RECEBE (fila do stores/matchCelebration), uma de cada vez, com o MatchModal
 * variant="received". Só com a tela livre: logado, fora da splash, do cadastro e do aceite dos Termos (quem monta
 * decide o `ready`), e depois que o mapa carregou — Confetti (Skia) e Modal não sobem no boot (armadilhas de
 * HWUI/Skia). Espera também o modal de match de quem curtiu (localOpen).
 */
export function MatchCelebrationHost({ ready, mapReady }: { ready: boolean; mapReady: boolean }) {
  const qc = useQueryClient();
  const current = useMatchCelebrationStore((s) => s.current);
  const waiting = useMatchCelebrationStore((s) => s.queue.length);
  const localOpen = useMatchCelebrationStore((s) => s.localOpen);

  // a tela fica "assentada" um pouco depois de ficar livre (e de novo depois de cada comemoração)
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!ready) {
      setSettled(false);
      return;
    }
    const id = setTimeout(() => setSettled(true), mapReady ? SETTLE_MS : NO_MAP_SETTLE_MS);
    return () => clearTimeout(id);
  }, [ready, mapReady]);

  useEffect(() => {
    if (!ready || !settled || current || localOpen > 0 || waiting === 0) return;
    const id = setTimeout(() => useMatchCelebrationStore.getState().pump(), BETWEEN_MS);
    return () => clearTimeout(id);
  }, [ready, settled, current, localOpen, waiting]);

  // apareceu: o push desse match sai da bandeja (a pessoa já está vendo)
  const currentId = current?.userId ?? null;
  useEffect(() => {
    if (currentId) void dismissPushesTagged(`match:${currentId}`);
  }, [currentId]);

  const onClose = useCallback(() => {
    useMatchCelebrationStore.getState().close();
    // a conversa promovida, os pares mútuos do perfil e o status no mapa
    void qc.invalidateQueries({ queryKey: inboxKeys.all });
    void qc.invalidateQueries({ queryKey: ['me'] });
    void qc.invalidateQueries({ queryKey: ['nearby'] });
  }, [qc]);

  if (!ready || !current) return null;
  return <MatchModal match={current} variant="received" onClose={onClose} />;
}
