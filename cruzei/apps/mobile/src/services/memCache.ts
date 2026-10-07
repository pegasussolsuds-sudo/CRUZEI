// Caches de JS com teto em BYTES estimados (e em itens), LRU. O que pesa no heap do Hermes são as strings de path dos
// avatares (0,3–0,7 MB por visual, 1 byte por caractere ASCII) e os modelos de efeito: contar itens não segura memória
// quando cada item tem um tamanho. Todo cache criado aqui entra no registro: clearMemCaches() solta todos de uma vez
// (aviso de memória baixa do sistema, app indo pro fundo — App.tsx).

const registry = new Set<MemCache<unknown>>();

export class MemCache<V> {
  private readonly map = new Map<string, { v: V; b: number }>();
  private total = 0;

  constructor(
    readonly name: string,
    readonly maxBytes: number,
    readonly maxItems = Infinity,
  ) {
    registry.add(this as MemCache<unknown>);
  }

  get size(): number {
    return this.map.size;
  }

  /** bytes estimados retidos */
  get bytes(): number {
    return this.total;
  }

  has(k: string): boolean {
    return this.map.has(k);
  }

  /** valor guardado (renova a posição no LRU); undefined = não tem */
  get(k: string): V | undefined {
    const e = this.map.get(k);
    if (!e) return undefined;
    this.map.delete(k);
    this.map.set(k, e);
    return e.v;
  }

  /** guarda `v` com o tamanho estimado `bytes` e solta os mais antigos até caber. O que acabou de entrar fica sempre. */
  set(k: string, v: V, bytes: number): V {
    const old = this.map.get(k);
    if (old) {
      this.total -= old.b;
      this.map.delete(k);
    }
    this.map.set(k, { v, b: bytes });
    this.total += bytes;
    for (const [key, e] of this.map) {
      if (key === k || (this.total <= this.maxBytes && this.map.size <= this.maxItems)) break;
      this.map.delete(key);
      this.total -= e.b;
    }
    return v;
  }

  /** valores guardados, do mais antigo pro mais novo (não renova o LRU) */
  values(): V[] {
    return Array.from(this.map.values(), (e) => e.v);
  }

  clear(): void {
    this.map.clear();
    this.total = 0;
  }
}

/** solta todos os caches registrados */
export function clearMemCaches(): void {
  for (const c of registry) c.clear();
}

/** itens e bytes estimados por cache (testes e diagnóstico) */
export function memCacheStats(): Record<string, { items: number; bytes: number }> {
  const out: Record<string, { items: number; bytes: number }> = {};
  for (const c of registry) out[c.name] = { items: c.size, bytes: c.bytes };
  return out;
}
