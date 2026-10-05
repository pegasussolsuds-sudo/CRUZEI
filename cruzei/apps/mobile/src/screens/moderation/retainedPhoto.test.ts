import {
  apiAbsoluteUrl,
  isProtectedPhotoPath,
  loadRetainedPhoto,
  needsAuthPhoto,
  type RetainedPhotoDeps,
  type RetainedPhotoState,
} from './retainedPhoto';

// Ficha da moderação no app: a foto retida por denúncia vem como rota autenticada da API. Nunca vai como URL pra
// <Image> (o Fresco gravaria no disco): busca com o axios (Bearer) como bytes e vira data: URI.

const PATH = '/v1/admin/photos/0b000000-0000-4000-8000-00000000000b/file';
const BASE = 'http://192.168.0.9:3000/v1';
/** Buffer do node (só existe no jest, o app não tem): gabarito do base64 */
const b64 = (b: Uint8Array) =>
  (
    globalThis as unknown as {
      Buffer: { from(b: Uint8Array): { toString(enc: 'base64'): string } };
    }
  ).Buffer.from(b).toString('base64');
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

describe('qual foto precisa do Bearer', () => {
  it('só a retida com caminho relativo da API', () => {
    expect(needsAuthPhoto({ url: PATH, retained: true })).toBe(true);
    expect(needsAuthPhoto({ url: 'https://fotos.metch.app/p/x.jpg', retained: true })).toBe(false);
    expect(needsAuthPhoto({ url: PATH })).toBe(false);
  });

  it('caminho relativo começa com uma barra só (// é outro host)', () => {
    expect(isProtectedPhotoPath(PATH)).toBe(true);
    expect(isProtectedPhotoPath('//cdn.externo/x.jpg')).toBe(false);
    expect(isProtectedPhotoPath('http://127.0.0.1:3000/uploads/p/x.jpg')).toBe(false);
    expect(isProtectedPhotoPath(null)).toBe(false);
  });
});

describe('apiAbsoluteUrl', () => {
  it('base com o prefixo (/v1): o prefixo entra uma vez só', () => {
    expect(apiAbsoluteUrl(PATH, BASE)).toBe(`http://192.168.0.9:3000${PATH}`);
    expect(apiAbsoluteUrl(PATH, `${BASE}/`)).toBe(`http://192.168.0.9:3000${PATH}`);
  });

  it('API num subcaminho (https://x.com/api/v1) e base sem prefixo', () => {
    expect(apiAbsoluteUrl(PATH, 'https://x.com/api/v1')).toBe(`https://x.com/api${PATH}`);
    expect(apiAbsoluteUrl(PATH, 'https://api.metch.app')).toBe(`https://api.metch.app${PATH}`);
    // host que por acaso se chama v1 não perde o host
    expect(apiAbsoluteUrl(PATH, 'http://v1')).toBe(`http://v1${PATH}`);
  });
});

/** busca controlada na mão: resolve/rejeita quando o teste mandar */
function deferredDeps() {
  let resolve!: (r: { data: unknown; contentType: unknown }) => void;
  let reject!: (e: unknown) => void;
  const fetchImage = jest.fn(
    (_path: string, _signal: AbortSignal) =>
      new Promise<{ data: unknown; contentType: unknown }>((res, rej) => {
        resolve = res;
        reject = rej;
      }),
  );
  const deps: RetainedPhotoDeps = { fetchImage };
  return {
    deps,
    fetchImage,
    resolve: (r: { data: unknown; contentType: unknown }) => resolve(r),
    reject: (e: unknown) => reject(e),
  };
}

const flush = () => new Promise<void>((r) => setTimeout(() => r(), 0));

describe('loadRetainedPhoto', () => {
  it('busca o caminho (bytes + Content-Type) e entrega um data: URI, nunca a URL', async () => {
    const d = deferredDeps();
    const states: RetainedPhotoState[] = [];
    loadRetainedPhoto(PATH, d.deps, (s) => states.push(s));
    expect(states).toEqual([{ status: 'loading' }]);
    expect(d.fetchImage).toHaveBeenCalledTimes(1);
    const [path, signal] = d.fetchImage.mock.calls[0];
    expect(path).toBe(PATH);
    expect(signal.aborted).toBe(false);

    d.resolve({ data: JPEG.buffer, contentType: 'image/jpeg' });
    await flush();
    expect(states).toEqual([
      { status: 'loading' },
      { status: 'ready', uri: `data:image/jpeg;base64,${b64(JPEG)}` },
    ]);
    const ready = states[1] as { uri: string };
    expect(ready.uri).not.toContain('http');
    expect(ready.uri).not.toContain(PATH);
  });

  it('resposta que não é image/* (HTML de erro, octet-stream, SVG): não carregou', async () => {
    for (const contentType of [
      'text/html; charset=utf-8',
      'application/octet-stream',
      'image/svg+xml',
      undefined,
    ]) {
      const d = deferredDeps();
      const states: RetainedPhotoState[] = [];
      loadRetainedPhoto(PATH, d.deps, (s) => states.push(s));
      d.resolve({ data: JPEG.buffer, contentType });
      await flush();
      expect(states.at(-1)).toEqual({ status: 'error', reason: 'not_image' });
      expect(states.some((s) => s.status === 'ready')).toBe(false);
    }
  });

  it('falha do pedido (rede, 401 depois da renovação, 404): não carregou', async () => {
    const d = deferredDeps();
    const states: RetainedPhotoState[] = [];
    loadRetainedPhoto(PATH, d.deps, (s) => states.push(s));
    d.reject(new Error('Request failed with status code 404'));
    await flush();
    expect(states).toEqual([{ status: 'loading' }, { status: 'error', reason: 'request' }]);
  });

  it('busca que lança na hora também vira "não carregou" (não derruba a tela)', async () => {
    const states: RetainedPhotoState[] = [];
    const deps: RetainedPhotoDeps = {
      fetchImage: () => {
        throw new Error('sem rede');
      },
    };
    expect(() => loadRetainedPhoto(PATH, deps, (s) => states.push(s))).not.toThrow();
    await flush();
    expect(states).toEqual([{ status: 'loading' }, { status: 'error', reason: 'request' }]);
  });

  it('desmontar aborta o pedido e descarta o que chegar depois (nenhum data: URI fora da tela)', async () => {
    const d = deferredDeps();
    const onChange = jest.fn();
    const stop = loadRetainedPhoto(PATH, d.deps, onChange);
    const signal = d.fetchImage.mock.calls[0][1];
    stop();
    expect(signal.aborted).toBe(true);
    d.resolve({ data: JPEG.buffer, contentType: 'image/jpeg' });
    await flush();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ status: 'loading' });

    // erro do cancelamento (CanceledError do axios) depois de desmontar: também calado
    const d2 = deferredDeps();
    const onChange2 = jest.fn();
    loadRetainedPhoto(PATH, d2.deps, onChange2)();
    d2.reject(new Error('canceled'));
    await flush();
    expect(onChange2).toHaveBeenCalledTimes(1);
  });
});
