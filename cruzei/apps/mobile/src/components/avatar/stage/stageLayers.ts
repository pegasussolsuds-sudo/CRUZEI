// Monta a lista de camadas do palco com os PAPÉIS de troca (sem Skia: testável em node).
//
// O palco não remonta o avatar durante a animação: monta tudo uma vez e troca só o que muda —
//   - expressão: camadas k:'face' da config (papel 'face') + as de cada expressão da linha do tempo da animação
//     (papel 'faceN', montadas com a mesma config e `face` trocado);
//   - objeto: camadas k:'held' da config (papel 'held') + as do prop da animação (papel 'prop', montadas com `held`
//     trocado pelo prop);
//   - mãos: camadas k:'hand' da config (papel 'hand') + a mão aberta que a animação pede (papel 'handOpen', montada com
//     BuildOptions.hands).
// As camadas alternativas entram no MESMO lugar da ordem de desenho. Depois a lista vira "corridas" (camadas seguidas
// com o mesmo grupo e o mesmo papel), cada uma gravada numa SkPicture.

import type { AvatarGroup, AvatarLayer } from '../../../avatar/types';

/** 'n' = sempre visível; 'face' = expressão da config; 'face0'.. = expressões da animação; 'held' / 'prop'; 'hand' / 'handOpen' */
export type StageRole = 'n' | 'face' | 'held' | 'prop' | 'hand' | 'handOpen' | `face${number}`;

export interface StageLayer {
  l: AvatarLayer;
  role: StageRole;
}

export interface StageRunSpec {
  g: AvatarGroup;
  role: StageRole;
  layers: AvatarLayer[];
}

export interface MergeInput {
  /** camadas da config */
  base: AvatarLayer[];
  /** camadas k:'face' de cada expressão alternativa (na ordem de altFaces) */
  altFaces: AvatarLayer[][];
  /** camadas do prop (k:'held' da config com held trocado), ou [] */
  prop: AvatarLayer[];
  /**
   * índice em `base` onde o prop entra quando a config não tem objeto na mão (posição do primeiro k:'held' na montagem
   * com o prop); -1 = fim
   */
  propAt: number;
  /** camadas k:'hand' da montagem com a mão aberta da animação (ausente/[] = a animação não troca a mão) */
  hands?: AvatarLayer[];
}

/** lista final com papéis (a ordem de desenho é a da lista) */
export function mergeStageLayers(inp: MergeInput): StageLayer[] {
  const out: StageLayer[] = [];
  const baseFaces = inp.base.filter((l) => l.k === 'face');
  const baseHeld = inp.base.filter((l) => l.k === 'held');
  let facesDone = false;
  let heldDone = false;
  let handsDone = false;
  const emitFaces = () => {
    for (const l of baseFaces) out.push({ l, role: 'face' });
    inp.altFaces.forEach((set, i) => {
      for (const l of set) out.push({ l, role: `face${i}` });
    });
    facesDone = true;
  };
  const emitHeld = () => {
    for (const l of baseHeld) out.push({ l, role: 'held' });
    for (const l of inp.prop) out.push({ l, role: 'prop' });
    heldDone = true;
  };
  for (let i = 0; i < inp.base.length; i++) {
    const l = inp.base[i];
    if (!heldDone && !baseHeld.length && inp.prop.length && inp.propAt === i) emitHeld();
    if (l.k === 'face') {
      if (!facesDone) emitFaces();
      continue;
    }
    if (l.k === 'held') {
      if (!heldDone) emitHeld();
      continue;
    }
    if (l.k === 'hand') {
      if (!handsDone) {
        for (const h of inp.base) if (h.k === 'hand') out.push({ l: h, role: 'hand' });
        for (const h of inp.hands ?? []) out.push({ l: h, role: 'handOpen' });
        handsDone = true;
      }
      continue;
    }
    out.push({ l, role: 'n' });
  }
  if (!facesDone && inp.altFaces.some((s) => s.length)) emitFaces();
  if (!heldDone && inp.prop.length) emitHeld();
  return out;
}

/** corridas: camadas seguidas com o mesmo grupo e o mesmo papel */
export function stageRuns(list: StageLayer[]): StageRunSpec[] {
  const runs: StageRunSpec[] = [];
  let cur: StageRunSpec | null = null;
  for (const it of list) {
    const g: AvatarGroup = it.l.g ?? 'body';
    if (!cur || cur.g !== g || cur.role !== it.role) {
      cur = { g, role: it.role, layers: [] };
      runs.push(cur);
    }
    cur.layers.push(it.l);
  }
  return runs;
}

/**
 * a corrida aparece? (activeFace = índice da expressão alternativa ativa, -1 = a da config; propOn = prop visível;
 * handsOn = mão aberta da animação no lugar da mão da config)
 */
export function roleVisible(role: StageRole, activeFace: number, propOn: boolean, handsOn = false): boolean {
  'worklet';
  if (role === 'n') return true;
  if (role === 'hand') return !handsOn;
  if (role === 'handOpen') return handsOn;
  if (role === 'face') return activeFace < 0;
  if (role === 'held') return !propOn;
  if (role === 'prop') return propOn;
  return role === 'face' + activeFace;
}
