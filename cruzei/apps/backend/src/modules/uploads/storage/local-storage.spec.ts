import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { LocalObjectStorage } from './local-storage';

// Driver local num diretório temporário: ida e volta, escrita atômica, delete idempotente e chave que tenta sair da
// pasta de uploads.

const KEY = 'p/3f2b8c1e-9a4d-4e2f-8b7a-1c2d3e4f5a6b.jpg';
let root: string;
let s: LocalObjectStorage;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'metch-storage-'));
  s = new LocalObjectStorage(root);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('LocalObjectStorage', () => {
  it('put/get/exists/delete com subpasta criada sozinha e sem .tmp sobrando', async () => {
    await s.put(KEY, Buffer.from('foto'), 'image/jpeg');
    expect((await s.get(KEY))?.toString()).toBe('foto');
    expect(await s.exists(KEY)).toBe(true);
    expect(await fs.readdir(path.join(root, 'p'))).toEqual([path.basename(KEY)]);
    expect(s.pathFor(KEY)).toBe(path.join(root, 'p', path.basename(KEY)));

    await s.delete(KEY);
    expect(await s.exists(KEY)).toBe(false);
    expect(await s.get(KEY)).toBeNull();
    // apagar de novo não é erro
    await expect(s.delete(KEY)).resolves.toBeUndefined();
  });

  it('sobrescreve o mesmo objeto por inteiro (rename atômico)', async () => {
    await s.put(KEY, Buffer.from('versao-1-mais-longa'), 'image/jpeg');
    await s.put(KEY, Buffer.from('v2'), 'image/jpeg');
    expect((await s.get(KEY))?.toString()).toBe('v2');
  });

  it('chave inválida ou fora da pasta é recusada antes de tocar no disco', async () => {
    for (const bad of [
      '../fora.jpg',
      'p/../../fora.jpg',
      'p//x.jpg',
      '/etc/passwd',
      'C:/x.jpg',
      'p\\..\\x.jpg',
      '',
    ]) {
      await expect(s.put(bad, Buffer.from('x'), 'image/jpeg')).rejects.toThrow(/chave de storage/);
      await expect(s.get(bad)).rejects.toThrow(/chave de storage/);
      await expect(s.delete(bad)).rejects.toThrow(/chave de storage/);
    }
    await expect(fs.access(path.join(path.dirname(root), 'fora.jpg'))).rejects.toThrow();
  });
});
