import { describe, expect, it, vi } from 'vitest';
import {
  asImageBlob,
  isProtectedPhotoPath,
  loadProtectedPhoto,
  needsAuthFetch,
  PROTECTED_PHOTO_ERROR,
  type ProtectedPhotoDeps,
  type ProtectedPhotoState,
} from './protected-photo';

// Foto retida por denúncia na ficha: caminho autenticado → fetch com Bearer → URL blob: local, revogada ao desmontar.

const PATH = '/v1/admin/photos/0b000000-0000-4000-8000-00000000000b/file';

/** pedido controlado na mão: resolve/rejeita quando o teste manda e grava o signal */
function deps() {
  let resolve!: (b: Blob) => void;
  let reject!: (e: unknown) => void;
  const signals: AbortSignal[] = [];
  const d = {
    fetchBlob: vi.fn((_p: string, signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<Blob>((res, rej) => {
        resolve = res;
        reject = rej;
      });
    }),
    createObjectURL: vi.fn((_b: Blob) => 'blob:http://painel/abc'),
    revokeObjectURL: vi.fn((_u: string) => undefined),
  } satisfies ProtectedPhotoDeps;
  return { d, signals, resolve: (b: Blob) => resolve(b), reject: (e: unknown) => reject(e) };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('qual foto precisa do Bearer', () => {
  it('só a retida com caminho relativo da API', () => {
    expect(needsAuthFetch({ url: PATH, retained: true })).toBe(true);
    // retida de fakes/ ou URL externa vem pública (não tem arquivo nosso pra proteger)
    expect(needsAuthFetch({ url: 'https://fotos.metch.app/p/x.jpg', retained: true })).toBe(false);
    // não retida: sempre a URL pública
    expect(needsAuthFetch({ url: PATH })).toBe(false);
    expect(needsAuthFetch({ url: PATH, retained: false })).toBe(false);
  });

  it('caminho relativo é o que começa com uma barra só (// é URL de outro host)', () => {
    expect(isProtectedPhotoPath(PATH)).toBe(true);
    expect(isProtectedPhotoPath('//cdn.externo/x.jpg')).toBe(false);
    expect(isProtectedPhotoPath('http://127.0.0.1:3000/uploads/p/x.jpg')).toBe(false);
    expect(isProtectedPhotoPath('')).toBe(false);
    expect(isProtectedPhotoPath(null)).toBe(false);
  });
});

describe('loadProtectedPhoto', () => {
  it('busca pelo caminho, mostra a URL blob e revoga ao desmontar', async () => {
    const t = deps();
    const states: ProtectedPhotoState[] = [];
    const stop = loadProtectedPhoto(PATH, t.d, (s) => states.push(s));
    expect(t.d.fetchBlob).toHaveBeenCalledWith(PATH, expect.any(AbortSignal));
    expect(states).toEqual([{ status: 'loading' }]);

    t.resolve(new Blob(['jpeg'], { type: 'image/jpeg' }));
    await flush();
    expect(states.at(-1)).toEqual({ status: 'ready', url: 'blob:http://painel/abc' });
    expect(t.d.revokeObjectURL).not.toHaveBeenCalled();

    stop();
    expect(t.d.revokeObjectURL).toHaveBeenCalledWith('blob:http://painel/abc');
    expect(t.signals[0]!.aborted).toBe(true);
    // desmontar de novo não revoga duas vezes
    stop();
    expect(t.d.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  it('desmontou antes da resposta: cancela o pedido e não cria URL nenhuma', async () => {
    const t = deps();
    const onChange = vi.fn();
    const stop = loadProtectedPhoto(PATH, t.d, onChange);
    stop();
    expect(t.signals[0]!.aborted).toBe(true);
    t.resolve(new Blob(['jpeg'], { type: 'image/jpeg' }));
    await flush();
    expect(t.d.createObjectURL).not.toHaveBeenCalled();
    expect(t.d.revokeObjectURL).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledTimes(1); // só o 'loading'
  });

  it('erro (403, 404, sem rede) vira estado de erro com a mensagem do cliente http; abortado não avisa', async () => {
    const t = deps();
    const states: ProtectedPhotoState[] = [];
    loadProtectedPhoto(PATH, t.d, (s) => states.push(s));
    t.reject(new Error('Você não tem permissão pra isso.'));
    await flush();
    expect(states.at(-1)).toEqual({ status: 'error', message: 'Você não tem permissão pra isso.' });

    const u = deps();
    const s2: ProtectedPhotoState[] = [];
    loadProtectedPhoto(PATH, u.d, (s) => s2.push(s));
    u.reject('???');
    await flush();
    expect(s2.at(-1)).toEqual({ status: 'error', message: PROTECTED_PHOTO_ERROR });

    const a = deps();
    const s3: ProtectedPhotoState[] = [];
    const stop = loadProtectedPhoto(PATH, a.d, (s) => s3.push(s));
    stop();
    a.reject(new DOMException('aborted', 'AbortError'));
    await flush();
    expect(s3).toEqual([{ status: 'loading' }]);
  });

  it('o que não é imagem vai como octet-stream (aberto numa aba, não renderiza)', async () => {
    const t = deps();
    loadProtectedPhoto(PATH, t.d, () => undefined);
    t.resolve(new Blob(['<html>'], { type: 'text/html' }));
    await flush();
    const blob = t.d.createObjectURL.mock.calls[0]![0];
    expect(blob.type).toBe('application/octet-stream');
    expect(await blob.text()).toBe('<html>');
  });
});

describe('asImageBlob', () => {
  it('image/* passa igual; o resto vira octet-stream', () => {
    const img = new Blob(['x'], { type: 'image/png' });
    expect(asImageBlob(img)).toBe(img);
    expect(asImageBlob(new Blob(['x'])).type).toBe('application/octet-stream');
  });
});
