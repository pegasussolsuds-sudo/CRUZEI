import React, { useEffect, useRef, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import type { Rect } from './geometry';
import type { TourTargetId } from './steps';

// Registro dos alvos do tour: quem desenha o elemento registra como medir (posição na janela). Fora do estado do React:
// registrar não re-renderiza ninguém. O último registro de um id vale (Fast Refresh remonta).

type Measure = () => Promise<Rect | null>;

interface Entry {
  measure: Measure;
  /** o alvo existe agora? (ex.: "você no mapa" sem localização não) */
  available?: () => boolean;
}

const registry = new Map<TourTargetId, Entry>();

export function registerTourTarget(id: TourTargetId, measure: Measure, available?: () => boolean): () => void {
  const entry: Entry = { measure, available };
  registry.set(id, entry);
  return () => {
    if (registry.get(id) === entry) registry.delete(id);
  };
}

export function isTourTargetAvailable(id: TourTargetId): boolean {
  const e = registry.get(id);
  if (!e) return false;
  try {
    return e.available ? e.available() : true;
  } catch {
    return false;
  }
}

export async function measureTourTarget(id: TourTargetId): Promise<Rect | null> {
  const e = registry.get(id);
  if (!e) return null;
  try {
    return await e.measure();
  } catch {
    return null;
  }
}

/** mede uma View na janela; null se não tem tamanho ou não respondeu a tempo */
export function measureView(node: View | null, timeoutMs = 400): Promise<Rect | null> {
  if (!node) return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        resolve(null);
      }
    }, timeoutMs);
    try {
      node.measureInWindow((x, y, width, height) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(width > 0 && height > 0 && Number.isFinite(x) && Number.isFinite(y) ? { x, y, width, height } : null);
      });
    } catch {
      done = true;
      clearTimeout(timer);
      resolve(null);
    }
  });
}

/**
 * Embrulha um elemento que o tour destaca (sem estilo: não muda o layout). Ex.:
 * <TourTarget id="locate"><Botao /></TourTarget>
 */
export function TourTarget({ id, children, style }: { id: TourTargetId; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const ref = useRef<View>(null);
  useEffect(() => registerTourTarget(id, () => measureView(ref.current)), [id]);
  return (
    <View ref={ref} collapsable={false} style={style}>
      {children}
    </View>
  );
}
