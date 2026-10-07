// Cache de imagens do mapa: as chaves prontas em memória têm teto (cada quadro de animação é uma chave nova) e a que
// sai do teto volta do disco sem redesenhar.

jest.mock('expo-file-system', () => {
  const mockFiles = new Set<string>();
  class Directory {
    uri = 'file:///cache/mapimg-v1/';
    exists = true;
    size = 0;
    create() {}
    listAsRecords() {
      return [];
    }
  }
  class File {
    private mockName: string;
    constructor(_d: unknown, n: string) {
      this.mockName = n;
    }
    get exists() {
      return mockFiles.has(this.mockName);
    }
    write() {
      mockFiles.add(this.mockName);
    }
    rename(n: string) {
      mockFiles.delete(this.mockName);
      mockFiles.add(n);
      this.mockName = n;
    }
    delete() {
      mockFiles.delete(this.mockName);
    }
  }
  return { Directory, File, Paths: { cache: {} } };
});

// eslint-disable-next-line import/first
import { ImageStore } from '../store';

describe('ImageStore', () => {
  it('chaves em memória com teto; a que saiu volta do disco sem desenhar de novo', async () => {
    const store = new ImageStore();
    const render = jest.fn(() => new Uint8Array([1, 2, 3]));
    const keys = Array.from({ length: 3200 }, (_, i) => `fr|k|${i}`);
    const refs = await Promise.all(keys.map((k) => store.request(k, 0, render)));
    expect(refs.every(Boolean)).toBe(true);
    expect(render).toHaveBeenCalledTimes(3200);
    expect(store.stats().ready).toBeLessThanOrEqual(2500);
    // a primeira saiu do LRU, mas o arquivo está no disco: volta sem render
    const again = store.get(keys[0]);
    expect(again?.path).toBe(refs[0]?.path);
    await store.request(keys[1], 0, render);
    expect(render).toHaveBeenCalledTimes(3200);
  });

  it('a limpeza do meio da sessão não apaga o que o motor ainda usa (keep), só o que ninguém segura', async () => {
    const run = async (keep: boolean): Promise<string | null> => {
      const store = new ImageStore();
      const render = () => new Uint8Array([1, 2, 3]);
      // a figura parada: o motor guarda o ref e reusa sem get (sai do LRU de 2500 chaves)
      const stat = await store.request('fig|parada', 0, render);
      const off = keep ? store.keep(() => [stat!.path]) : () => {};
      // 5000 quadros de quem anda: na 5000ª escrita a pasta passa de 4000 arquivos e a limpeza apaga os mais antigos
      await Promise.all(Array.from({ length: 5000 }, (_, i) => store.request(`fr|k|${i}`, 0, render)));
      await new Promise<void>((r) => setTimeout(r, 800));
      off();
      return store.get('fig|parada')?.path ?? null;
    };
    expect(await run(false)).toBeNull(); // ninguém segura: a estática (a mais antiga) some — era o defeito
    expect(await run(true)).toMatch(/\.png$/);
  });

  it('pedido cancelado não roda e resolve null', async () => {
    const store = new ImageStore();
    const render = jest.fn(() => new Uint8Array([1]));
    const p = store.request('fr|x|1', 5, render);
    store.cancel('fr|x|1');
    await expect(p).resolves.toBeNull();
    await new Promise<void>((r) => setTimeout(r, 10));
    expect(render).not.toHaveBeenCalled();
  });
});
