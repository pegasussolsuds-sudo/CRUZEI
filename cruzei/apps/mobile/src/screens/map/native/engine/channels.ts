import { useCallback, useRef, useSyncExternalStore } from 'react';
import { monoNow } from '../../../../services/frameBatch';

/**
 * Canais observáveis do motor do mapa: cada fonte GeoJSON, o conjunto de imagens e os valores animados vivem num canal
 * próprio, e cada componente do mapa assina só o seu. Assim um tick de animação (anéis, quem anda) re-renderiza só a
 * camada que mudou — o resto da árvore do <Map> fica parado e o MLRN não reenvia estilo nenhum.
 *
 * O valor muda na hora pro motor (get já devolve o novo), mas os componentes leem o valor ENTREGUE (view) e o aviso sai em
 * LOTE: tudo o que mudou no mesmo turno do JS vira um commit só do React, e dois lotes ficam a pelo menos `minGapMs` um do
 * outro. Cada commit do mapa é uma transação de montagem na thread de UI (e um quadro do HWUI no Android); sob 1.000
 * pessoas eram dezenas por segundo. Com o dedo no mapa (hold) nenhum lote sai, só os canais `live`: soltar entrega tudo de
 * uma vez.
 */
export class Channels<T extends Record<string, unknown>> {
  private values: T;
  /** o que os componentes veem: o valor do último lote entregue (com o lote preso, o novo espera em `values`) */
  private shown: T;
  private readonly subs = new Map<keyof T, Set<() => void>>();
  private readonly dirty = new Set<keyof T>();
  private scheduled = false;
  /** o lote marcado está num timer (esperando o intervalo), não no fim do turno */
  private timed = false;
  private lastFlush = -Infinity;
  private held = false;
  /** intervalo mínimo entre dois lotes de avisos (0 = todo turno) */
  minGapMs = 0;
  /** canais que não esperam o intervalo (animações curtas de um tiro: queda do pino, explosão do curtir) */
  readonly urgent = new Set<keyof T>();
  /** canais que saem mesmo com o lote preso (névoa do horizonte: acompanha a inclinação no gesto de pinça) */
  readonly live = new Set<keyof T>();
  /** lotes entregues (= commits do React vindos do mapa) */
  flushes = 0;

  constructor(initial: T) {
    this.values = { ...initial };
    this.shown = { ...initial };
  }

  /** valor atual (o motor) */
  get<K extends keyof T>(key: K): T[K] {
    return this.values[key];
  }

  /** valor entregue aos componentes (o último lote) */
  view<K extends keyof T>(key: K): T[K] {
    return this.shown[key];
  }

  set<K extends keyof T>(key: K, value: T[K]): void {
    if (Object.is(this.values[key], value)) return;
    this.values[key] = value;
    if (!this.subs.get(key)?.size) {
      // ninguém assina: não há commit a fazer, quem assinar depois já lê o novo
      this.shown[key] = value;
      this.dirty.delete(key);
      return;
    }
    this.dirty.add(key);
    if (this.held && !this.live.has(key)) return; // sai quando o gesto acabar (hold(false))
    const urgent = this.urgent.has(key);
    if (this.scheduled && !(urgent && this.timed)) return;
    this.scheduled = true;
    const wait = urgent ? 0 : this.pendingMs();
    this.timed = wait > 0;
    // (urgente com um lote já marcado no timer: sai agora com tudo o que estiver sujo; o timer acha nada e volta)
    if (wait > 0) setTimeout(this.flush, wait);
    else void Promise.resolve().then(this.flush);
  }

  /** prende os lotes (dedo no mapa): nada sai, fora os canais `live`; soltar entrega o que ficou preso no fim do turno */
  hold(on: boolean): void {
    if (this.held === on) return;
    this.held = on;
    if (on || !this.dirty.size) return;
    this.scheduled = true;
    this.timed = false;
    void Promise.resolve().then(this.flush);
  }

  get isHeld(): boolean {
    return this.held;
  }

  /** quanto um aviso pedido agora pode esperar até sair (o motor soma isso à espera antes de apontar pra imagem nova) */
  pendingMs(): number {
    // relógio monotônico e no máx. um intervalo: um relógio que voltou não deixa o lote preso no timer (mapa congelado)
    return Math.max(0, Math.min(this.minGapMs, this.lastFlush + this.minGapMs - monoNow()));
  }

  private readonly flush = (): void => {
    if (!this.dirty.size) return; // um timer velho depois de um lote urgente: nada a fazer (o marcado segue valendo)
    this.scheduled = false;
    this.timed = false;
    const keys = this.held ? Array.from(this.dirty).filter((k) => this.live.has(k)) : Array.from(this.dirty);
    if (!keys.length) return; // timer que venceu com o lote preso: sai no hold(false)
    this.lastFlush = monoNow();
    this.flushes++;
    for (const key of keys) {
      this.dirty.delete(key);
      this.shown[key] = this.values[key];
    }
    for (const key of keys) {
      const listeners = this.subs.get(key);
      if (listeners) for (const fn of Array.from(listeners)) fn();
    }
  };

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
  return useSyncExternalStore(subscribe, () => channels.view(key));
}

/** assina só um pedaço do canal: re-renderiza quando o valor selecionado (primitivo) muda, não a cada mudança do canal */
export function useChannelSelector<T extends Record<string, unknown>, K extends keyof T, R>(channels: Channels<T>, key: K, select: (v: T[K]) => R): R {
  const selectRef = useRef(select);
  selectRef.current = select;
  const subscribe = useCallback((fn: () => void) => channels.subscribe(key, fn), [channels, key]);
  return useSyncExternalStore(subscribe, () => selectRef.current(channels.view(key)));
}

/**
 * Valor de um canal que só é acompanhado enquanto `active`: parado, o componente nem assina (não re-renderiza a cada
 * tick) e fica com o último valor visto.
 */
export function useChannelWhen<T extends Record<string, unknown>, K extends keyof T>(channels: Channels<T>, key: K, active: boolean): T[K] {
  const frozen = useRef(channels.view(key));
  const subscribe = useCallback((fn: () => void) => (active ? channels.subscribe(key, fn) : () => {}), [channels, key, active]);
  const value = useSyncExternalStore(subscribe, () => (active ? channels.view(key) : frozen.current));
  if (active) frozen.current = value;
  return value;
}
