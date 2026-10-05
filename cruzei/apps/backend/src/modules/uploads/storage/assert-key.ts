import { isValidKey } from '../../../common/photo-url';

/** chave válida ou erro (nunca deixa caminho arbitrário chegar no disco/bucket) */
export function assertKey(key: string): void {
  if (!isValidKey(key))
    throw new Error(`chave de storage inválida: ${JSON.stringify(String(key).slice(0, 80))}`);
}
