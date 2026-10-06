// Âncoras dos efeitos de animação (de onde saem corações, notas, faíscas…) em px do canvas do palco.
// Calculadas na thread de UI a partir da MESMA matriz dos grupos (avatar/rig.ts): a mão que acena leva as faíscas junto.

import type { EmoteAnchor } from '../../../avatar/emotes/types';
import type { Pose } from '../../../avatar/pose';
import { groupMatrix, mApply } from '../../../avatar/rig';
import type { AvatarRig } from '../../../avatar/types';

export type StagePoint = { x: number; y: number };
export type StageAnchors = Record<EmoteAnchor, StagePoint>;

/** pontos fixos no espaço de cada grupo (viewBox), da anatomia */
export interface AnchorSpec {
  mouth: [number, number];
  headTop: [number, number];
  handL: [number, number];
  handR: [number, number];
  chest: [number, number];
  feet: [number, number];
}

export function computeAnchors(rig: AvatarRig, pose: Pose, spec: AnchorSpec, base: number[]): StageAnchors {
  'worklet';
  const toCanvas = (p: [number, number]): StagePoint => ({ x: base[0] * p[0] + base[1] * p[1] + base[2], y: base[3] * p[0] + base[4] * p[1] + base[5] });
  const head = groupMatrix('head', rig, pose);
  const body = groupMatrix('body', rig, pose);
  const fl = groupMatrix('foreL', rig, pose);
  const fr = groupMatrix('foreR', rig, pose);
  const pet = groupMatrix('pet', rig, pose);
  const top = mApply(head, spec.headTop[0], spec.headTop[1]);
  return {
    mouth: toCanvas(mApply(head, spec.mouth[0], spec.mouth[1])),
    head: toCanvas(top),
    above: toCanvas([top[0], top[1] - 10]),
    handL: toCanvas(mApply(fl, spec.handL[0], spec.handL[1])),
    handR: toCanvas(mApply(fr, spec.handR[0], spec.handR[1])),
    chest: toCanvas(mApply(body, spec.chest[0], spec.chest[1])),
    pet: toCanvas(mApply(pet, rig.pet[0], rig.pet[1] - 6)),
    feet: toCanvas(spec.feet),
  };
}
