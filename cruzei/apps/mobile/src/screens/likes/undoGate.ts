// "Voltar" do deck em andamento (DELETE /passes/:id). Enquanto ele voa, o deck não aceita swipe nem botão; e uma ação
// que já tinha saído antes (gesto começado antes do toque) só vai pro servidor DEPOIS dele — senão um DELETE atrasado
// podia apagar o passar novo do mesmo cartão.

export interface UndoGate {
  /** tem "Voltar" voando */
  readonly busy: boolean;
  /** roda o desfazer; com outro voando não roda e devolve null */
  run<T>(op: () => Promise<T>): Promise<T> | null;
  /** resolve quando o "Voltar" em andamento acabar (deu certo ou não); na hora se não tem nenhum */
  settled(): Promise<void>;
}

export function createUndoGate(): UndoGate {
  let pending: Promise<void> | null = null;
  return {
    get busy() {
      return pending != null;
    },
    run<T>(op: () => Promise<T>): Promise<T> | null {
      if (pending) return null;
      let result: Promise<T>;
      try {
        result = op();
      } catch (err) {
        result = Promise.reject(err);
      }
      const done: Promise<void> = result.then(
        () => undefined,
        () => undefined,
      );
      pending = done;
      void done.then(() => {
        if (pending === done) pending = null;
      });
      return result;
    },
    settled() {
      return pending ?? Promise.resolve();
    },
  };
}
