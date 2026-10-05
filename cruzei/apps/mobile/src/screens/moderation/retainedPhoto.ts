import { imageDataUri } from './imageDataUri';

// Foto retida por denúncia (menor/abuso infantil) na ficha da moderação: o servidor manda um caminho RELATIVO à origem
// da API (/v1/admin/photos/:id/file) que exige o Bearer de staff. A URL autenticada NUNCA vai pra <Image>: no Android
// o Fresco gravaria o arquivo no cache de disco do app (ignora no-store e a chave é só a URI, então uma carga
// posterior sairia do disco sem Bearer). Busca com o axios do app (Bearer + renovação no 401) como bytes, converte pra
// data: URI (só image/*) e a <Image> mostra isso — produtor local do Fresco, nada no disco. As outras fotos seguem
// com a URL pública. Sem React nem axios aqui (testado no node): quem usa injeta a busca.

/** caminho autenticado (relativo à origem da API) e não URL pública */
export function isProtectedPhotoPath(url: string | null | undefined): url is string {
  return typeof url === 'string' && url.startsWith('/') && !url.startsWith('//');
}

/** precisa do Bearer? Só a retida com caminho relativo (retida de fakes/ ou URL externa vem pública) */
export function needsAuthPhoto(p: { url: string; retained?: boolean }): boolean {
  return !!p.retained && isProtectedPhotoPath(p.url);
}

/**
 * URL absoluta pro caminho relativo à origem da API. A base do app já termina no prefixo (http://host:3000/v1); se a
 * API mora num subcaminho (https://x.com/api/v1), o prefixo do caminho (/v1) casa com o fim da base e entra uma vez só.
 */
export function apiAbsoluteUrl(path: string, apiBaseUrl: string): string {
  const base = apiBaseUrl.replace(/\/+$/, '');
  const origin = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]+/i.exec(base)?.[0] ?? '';
  const basePath = base.slice(origin.length);
  const prefix = /^\/[^/?#]+/.exec(path)?.[0] ?? '';
  const root = prefix && basePath.endsWith(prefix) ? basePath.slice(0, -prefix.length) : '';
  return `${origin}${root}${path}`;
}

export type RetainedPhotoState =
  | { status: 'loading' }
  | { status: 'ready'; uri: string }
  /** request = rede/401/404; not_image = veio algo que não é image/* (ou vazio/grande demais) */
  | { status: 'error'; reason: 'request' | 'not_image' };

export interface RetainedPhotoDeps {
  /** GET autenticado do caminho como bytes (responseType arraybuffer) + o Content-Type da resposta */
  fetchImage: (
    path: string,
    signal: AbortSignal,
  ) => Promise<{ data: unknown; contentType: unknown }>;
}

/**
 * Busca a foto retida e avisa cada mudança; devolve o "desmontar" (pro useEffect): aborta o pedido e descarta o que
 * chegar depois (nenhum data: URI criado depois de sair da tela).
 */
export function loadRetainedPhoto(
  path: string,
  deps: RetainedPhotoDeps,
  onChange: (s: RetainedPhotoState) => void,
): () => void {
  const ctrl = new AbortController();
  let stopped = false;
  onChange({ status: 'loading' });
  let req: Promise<{ data: unknown; contentType: unknown }>;
  try {
    req = deps.fetchImage(path, ctrl.signal);
  } catch (e) {
    req = Promise.reject(e);
  }
  req.then(
    (r) => {
      if (stopped) return;
      const uri = imageDataUri(r.data, r.contentType);
      onChange(uri ? { status: 'ready', uri } : { status: 'error', reason: 'not_image' });
    },
    () => {
      if (!stopped) onChange({ status: 'error', reason: 'request' });
    },
  );
  return () => {
    stopped = true;
    ctrl.abort();
  };
}
