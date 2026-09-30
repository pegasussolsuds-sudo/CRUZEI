// Rascunho da faixa de idade: soltar o polegar não grava na hora — espera AGE_RANGE_SAVE_DELAY_MS sem mexer. Ajustar
// o "de" e o "até" em seguida vira UMA mudança (o servidor deixa mudar a faixa AGE_RANGE_DAILY_CHANGES vezes por dia).
// Voltou pro que já estava gravado: não grava nada. Saiu da tela: grava o que ficou.
import { useEffect, useMemo, useRef, useState } from 'react';

export const AGE_RANGE_SAVE_DELAY_MS = 1500;

export type AgeRange = readonly [number, number];

const same = (a: AgeRange, b: AgeRange) => a[0] === b[0] && a[1] === b[1];

export interface AgeRangeDraft {
  /** soltou o polegar: vira rascunho e grava depois do prazo sem mexer */
  change(min: number, max: number): void;
  /** grava agora o que estiver pendente */
  flush(): void;
  /** o valor gravado mudou (otimista, servidor ou volta do erro) */
  savedChanged(): void;
  /** rascunho em tela (null = mostra o gravado) */
  draft(): AgeRange | null;
}

export function createAgeRangeDraft(opts: {
  saved: () => AgeRange;
  save: (min: number, max: number) => void;
  onDraft: (d: AgeRange | null) => void;
  delayMs?: number;
}): AgeRangeDraft {
  let draft: AgeRange | null = null;
  // entregue pro save, esperando o valor gravado mudar (segura o rascunho: o slider não pisca o valor antigo)
  let sent: AgeRange | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const set = (d: AgeRange | null) => {
    draft = d;
    opts.onDraft(d);
  };
  const stop = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const flush = () => {
    stop();
    if (!draft || draft === sent) return;
    if (same(draft, opts.saved())) {
      sent = null;
      set(null);
      return;
    }
    sent = draft;
    opts.save(draft[0], draft[1]);
  };
  return {
    change(min, max) {
      set([min, max]);
      stop();
      timer = setTimeout(flush, opts.delayMs ?? AGE_RANGE_SAVE_DELAY_MS);
    },
    flush,
    savedChanged() {
      // o que foi entregue chegou (ou voltou no erro): sai o rascunho. Mexeu de novo nesse meio tempo: fica
      if (sent && draft === sent) set(null);
      sent = null;
    },
    draft: () => draft,
  };
}

/** o slider mostra `value` e chama `change`; `save` só roda depois do prazo (ou ao sair da tela) */
export function useAgeRangeDraft(
  saved: AgeRange,
  save: (min: number, max: number) => void,
): { value: AgeRange; change: (min: number, max: number) => void } {
  const [draft, setDraft] = useState<AgeRange | null>(null);
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const saveRef = useRef(save);
  saveRef.current = save;
  const ctl = useMemo(
    () =>
      createAgeRangeDraft({
        saved: () => savedRef.current,
        save: (a, b) => saveRef.current(a, b),
        onDraft: setDraft,
      }),
    [],
  );
  const [sMin, sMax] = saved;
  useEffect(() => ctl.savedChanged(), [ctl, sMin, sMax]);
  useEffect(() => () => ctl.flush(), [ctl]);
  return { value: draft ?? saved, change: ctl.change };
}
