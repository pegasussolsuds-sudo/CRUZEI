// Foto retida por denúncia (menor/abuso infantil): a ficha manda um caminho RELATIVO da API
// (/v1/admin/photos/:id/file) que exige o Bearer de staff — <img src> direto não leva o token e aparece quebrada.
// Busca com o cliente http (fetch → blob), mostra uma URL blob: local e revoga ao desmontar.
// Sem React nem o cliente http aqui (testado no node): quem usa injeta as dependências.

/** caminho autenticado da API (relativo à origem) e não URL pública */
export function isProtectedPhotoPath(url: string | null | undefined): url is string {
  return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//');
}

/** precisa buscar com o Bearer? Só a retida com caminho relativo (retida de fakes/ ou URL externa vem pública) */
export function needsAuthFetch(p: { url: string; retained?: boolean }): boolean {
  return !!p.retained && isProtectedPhotoPath(p.url);
}

/** só imagem de verdade vira image/*: o resto vai como octet-stream (aberto numa aba, baixa em vez de renderizar) */
export function asImageBlob(b: Blob): Blob {
  return b.type.startsWith('image/') ? b : new Blob([b], { type: 'application/octet-stream' });
}

export type ProtectedPhotoState =
  | { status: 'loading' }
  | { status: 'ready'; url: string }
  | { status: 'error'; message: string };

export interface ProtectedPhotoDeps {
  fetchBlob: (path: string, signal: AbortSignal) => Promise<Blob>;
  createObjectURL: (b: Blob) => string;
  revokeObjectURL: (url: string) => void;
}

export const PROTECTED_PHOTO_ERROR = 'Não deu pra carregar a foto.';

/**
 * Busca a foto e avisa cada mudança; devolve o "desmontar" (pro useEffect): cancela o pedido e revoga a URL blob (a
 * imagem sai da memória da aba). Resposta que chega depois de desmontar é descartada sem criar URL.
 */
export function loadProtectedPhoto(
  path: string,
  deps: ProtectedPhotoDeps,
  onChange: (s: ProtectedPhotoState) => void,
): () => void {
  const ctrl = new AbortController();
  let objectUrl: string | null = null;
  let stopped = false;
  onChange({ status: 'loading' });
  deps.fetchBlob(path, ctrl.signal).then(
    (blob) => {
      if (stopped) return;
      objectUrl = deps.createObjectURL(asImageBlob(blob));
      onChange({ status: 'ready', url: objectUrl });
    },
    (e: unknown) => {
      if (stopped) return;
      onChange({ status: 'error', message: e instanceof Error && e.message ? e.message : PROTECTED_PHOTO_ERROR });
    },
  );
  return () => {
    stopped = true;
    ctrl.abort();
    if (objectUrl) deps.revokeObjectURL(objectUrl);
    objectUrl = null;
  };
}
