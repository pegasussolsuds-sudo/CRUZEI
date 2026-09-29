import { useCallback, useRef, useSyncExternalStore } from 'react';

/**
 * Canais observáveis do motor do mapa: cada fonte GeoJSON, o conjunto de imagens e os valores animados vivem num canal
 * próprio, e cada componente do mapa assina só o seu. Assim um tick de animação (anéis, quem anda) re-renderiza só a
 * camada que mudou — o resto da árvore do <Map> fica parado e o MLRN não reenvia estilo nenhum.
 */
export class Channels<T extends Record<string, unknown>> {
  private values: T;
  private readonly subs = new Map<keyof T, Set<() => void>>();

  constructor(initial: T) {
    this.values = { ...initial };
  }

  get<K extends keyof T>(key: K): T[K] {
    return this.values[key];
  }

  set<K extends keyof T>(key: K, value: T[K]): void {
    if (Object.is(this.values[key], value)) return;
    this.values[key] = value;
    const listeners = this.subs.get(key);
    if (listeners) for (const fn of Array.from(listeners)) fn();
  }

  subscribe<K extends keyof T>(key: K, fn: () => void): () => void {
    let set = this.subs.get(key);
    if (!set) {
      set = new Set();
      this.subs.set(key, set);
    }
    set.add(fn);
    return () => {
      set?.delete(fn);
    };
  }
}

export function useChannel<T extends Record<string, unknown>, K extends keyof T>(channels: Channels<T>, key: K): T[K] {
  // subscribe estável: um novo a cada render faria o useSyncExternalStore re-assinar em todo tick
  const subscribe = useCallback((fn: () => void) => channels.subscribe(key, fn), [channels, key]);
  return useSyncExternalStore(subscribe, () => channels.get(key));
}

/** assina só um pedaço do canal: re-renderiza quando o valor selecionado (primitivo) muda, não a cada mudança do canal */
export function useChannelSelector<T extends Record<string, unknown>, K extends keyof T, R>(channels: Channels<T>, key: K, select: (v: T[K]) => R): R {
  const selectRef = useRef(select);
  selectRef.current = select;
  const subscribe = useCallback((fn: () => void) => channels.subscribe(key, fn), [channels, key]);
  return useSyncExternalStore(subscribe, () => selectRef.current(channels.get(key)));
}

/**
 * Valor de um canal que só é acompanhado enquanto `active`: parado, o componente nem assina (não re-renderiza a cada
 * tick) e fica com o último valor visto.
 */
export function useChannelWhen<T extends Record<string, unknown>, K extends keyof T>(channels: Channels<T>, key: K, active: boolean): T[K] {
  const frozen = useRef(channels.get(key));
  const subscribe = useCallback((fn: () => void) => (active ? channels.subscribe(key, fn) : () => {}), [channels, key, active]);
  const value = useSyncExternalStore(subscribe, () => (active ? channels.get(key) : frozen.current));
  if (active) frozen.current = value;
  return value;
}
