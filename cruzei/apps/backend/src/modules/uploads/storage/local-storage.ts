// Driver local: grava em UPLOAD_DIR/<chave> (servido em /uploads pelo main.ts). Escrita atômica (.tmp + rename) e
// caminho sempre conferido dentro da raiz.
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import { assertKey } from './assert-key';
import type { ObjectStorage } from './object-storage';

export class LocalObjectStorage implements ObjectStorage {
  readonly driver = 'local' as const;
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  /** caminho no disco de uma chave (lança se a chave for inválida ou escapar da raiz) */
  pathFor(key: string): string {
    assertKey(key);
    const p = path.resolve(this.root, ...key.split('/'));
    if (!p.startsWith(this.root + path.sep))
      throw new Error('chave de storage fora da pasta de uploads');
    return p;
  }

  async put(key: string, body: Buffer, _contentType: string): Promise<void> {
    const p = this.pathFor(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    const tmp = `${p}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmp, body);
      await fs.rename(tmp, p);
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      throw err;
    }
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(this.pathFor(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      return (await fs.stat(this.pathFor(key))).isFile();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.pathFor(key), { force: true });
  }
}
