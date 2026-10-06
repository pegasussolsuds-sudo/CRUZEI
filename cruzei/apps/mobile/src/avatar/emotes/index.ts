// Registro das animações do avatar: junta danças (dances.ts) e gestos (gestures.ts).
// emoteDef(id) devolve a definição (null = 'none' ou id desconhecido); listEmotes() lista na ordem de registro.

import { DANCES, DANCE_HANDS } from './dances';
import { GESTURES, GESTURE_HANDS } from './gestures';
import type { EmoteDef, EmoteRegistry } from './types';

export type { EmoteAnchor, EmoteDef, EmoteFace, EmoteFx, EmoteFxKind, EmoteRegistry } from './types';

const REGISTRY: EmoteRegistry = { ...GESTURES, ...DANCES };

/** definição da animação (null pra 'none' ou id desconhecido) */
export function emoteDef(id: string | null | undefined): EmoteDef | null {
  if (!id || id === 'none') return null;
  return Object.prototype.hasOwnProperty.call(REGISTRY, id) ? REGISTRY[id] : null;
}

/** mão aberta (palma pra câmera) que a animação pede (BuildOptions.hands); null = mão da config */
export function emoteHands(id: string | null | undefined): { L?: 'open'; R?: 'open' } | null {
  if (!id) return null;
  return GESTURE_HANDS[id] ?? DANCE_HANDS[id] ?? null;
}

/** todas as animações registradas */
export function listEmotes(): EmoteDef[] {
  return Object.values(REGISTRY);
}

/** expressão ativa no progresso k (null = a da config) */
export function emoteFaceAt(def: EmoteDef | null, k: number): string | null {
  'worklet';
  if (!def || !def.face) return null;
  for (let i = 0; i < def.face.length; i++) {
    const f = def.face[i];
    if (k >= f.from && k < f.to) return f.face;
  }
  return null;
}
