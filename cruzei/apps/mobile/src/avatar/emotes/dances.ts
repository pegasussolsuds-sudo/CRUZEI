// Danças do avatar (loop): samba no pé, passinho, hip-hop, disco, robô, k-pop, vogue e shuffle.
// Dono: danças. Contrato em ./types.ts; coreografia em ./dances-moves.ts; convenção de ângulos e ritmo em ./dances-kit.ts.
//
// Regras que valem pra todas:
//   - loop: a pose é periódica (pose(0) = pose(1)), então o ciclo emenda sem tranco;
//   - dur = batidas do ciclo · 60 / bpm (DANCE_TEMPO), e todo pulso cai na batida;
//   - braços em relação ao braço SOLTO: quem toca soma restArmDelta(anatomia) (todas usam os braços);
//   - com veículo a cena manda nas pernas (cadeira/carro: as pernas da dança não entram) e o tronco só ginga;
//   - mãos ficam no viewBox e fora do rosto (testes em __tests__/dances.test.ts com os 6 corpos, 4 repousos e cadeira).

import { DANCE_TEMPO, discoPose, hiphopPose, kpopPose, passinhoPose, robotPose, sambaPose, shufflePose, voguePose } from './dances-moves';
import type { EmoteDef, EmoteRegistry } from './types';

export { DANCE_TEMPO } from './dances-moves';

/** segundos de um ciclo pelo andamento */
function cycle(id: string): number {
  const t = DANCE_TEMPO[id];
  return Math.round(((t.beats * 60) / t.bpm) * 1000) / 1000;
}

/**
 * mão aberta (palma pra câmera) nas danças de braço erguido: o palco/folha passam isto em BuildOptions.hands ao
 * pré-montar as camadas da animação (a mão relaxada erguida vira "nadadeira").
 */
export const DANCE_HANDS: Record<string, { L?: 'open'; R?: 'open' }> = {
  dance_samba: { L: 'open', R: 'open' },
  dance_hiphop: { L: 'open', R: 'open' },
  dance_disco: { L: 'open', R: 'open' },
  dance_robot: { L: 'open', R: 'open' },
  dance_kpop: { L: 'open', R: 'open' },
  dance_vogue: { L: 'open', R: 'open' },
};

const samba: EmoteDef = {
  id: 'dance_samba',
  dur: cycle('dance_samba'),
  loop: true,
  usesArms: true,
  usesLegs: true,
  pose: sambaPose,
  face: [
    { from: 0, to: 0.46, face: 'grin' },
    { from: 0.46, to: 0.84, face: 'laugh' },
    { from: 0.84, to: 1.01, face: 'grin' },
  ],
  fx: [
    { kind: 'notes', from: 'above', start: 0, end: 1, rate: 1.6 },
    { kind: 'confetti', from: 'above', start: 0.46, end: 0.86, rate: 10 },
  ],
  keyK: 0.66,
};

const passinho: EmoteDef = {
  id: 'dance_passinho',
  dur: cycle('dance_passinho'),
  loop: true,
  usesArms: true,
  usesLegs: true,
  pose: passinhoPose,
  face: [
    { from: 0, to: 0.5, face: 'cool' },
    { from: 0.5, to: 1.01, face: 'smirk' },
  ],
  fx: [{ kind: 'notes', from: 'above', start: 0, end: 1, rate: 2.2 }],
  keyK: 0.6,
};

const hiphop: EmoteDef = {
  id: 'dance_hiphop',
  dur: cycle('dance_hiphop'),
  loop: true,
  usesArms: true,
  usesLegs: true,
  pose: hiphopPose,
  face: [
    { from: 0, to: 0.5, face: 'cool' },
    { from: 0.5, to: 1.01, face: 'smirk' },
  ],
  fx: [{ kind: 'notes', from: 'above', start: 0, end: 1, rate: 1.4 }],
  keyK: 0.62,
};

const disco: EmoteDef = {
  id: 'dance_disco',
  dur: cycle('dance_disco'),
  loop: true,
  usesArms: true,
  usesLegs: true,
  pose: discoPose,
  face: [
    { from: 0, to: 0.125, face: 'starry' },
    { from: 0.125, to: 0.25, face: 'grin' },
    { from: 0.25, to: 0.375, face: 'starry' },
    { from: 0.375, to: 0.5, face: 'grin' },
    { from: 0.5, to: 0.625, face: 'starry' },
    { from: 0.625, to: 0.75, face: 'grin' },
    { from: 0.75, to: 0.875, face: 'starry' },
    { from: 0.875, to: 1.01, face: 'grin' },
  ],
  fx: [
    { kind: 'sparkles', from: 'handR', start: 0, end: 0.5, rate: 8 },
    { kind: 'sparkles', from: 'handL', start: 0.5, end: 1, rate: 8 },
    { kind: 'stars', from: 'above', start: 0, end: 1, rate: 1.2 },
  ],
  keyK: 0.08,
};

const robot: EmoteDef = {
  id: 'dance_robot',
  dur: cycle('dance_robot'),
  loop: true,
  usesArms: true,
  usesLegs: true,
  pose: robotPose,
  face: [
    { from: 0, to: 0.375, face: 'calm' },
    { from: 0.375, to: 0.5, face: 'surprised' },
    { from: 0.5, to: 1.01, face: 'cool' },
  ],
  fx: [
    { kind: 'sparkles', from: 'head', start: 0.375, end: 0.5, rate: 12 },
    { kind: 'notes', from: 'above', start: 0, end: 1, rate: 1 },
  ],
  keyK: 0.82,
};

const kpop: EmoteDef = {
  id: 'dance_kpop',
  dur: cycle('dance_kpop'),
  loop: true,
  usesArms: true,
  usesLegs: true,
  pose: kpopPose,
  // o ciclo começa KPOP_PHASE (0,07) antes do quadro 0: a pose fofa (quadros 6 e 7) vai de 0,82 a 1,07
  face: [
    { from: 0, to: 0.07, face: 'wink' },
    { from: 0.07, to: 0.82, face: 'grin' },
    { from: 0.82, to: 1.01, face: 'wink' },
  ],
  fx: [
    { kind: 'hearts', from: 'head', start: 0, end: 0.07, rate: 5 },
    { kind: 'sparkles', from: 'above', start: 0.32, end: 0.57, rate: 6 },
    { kind: 'hearts', from: 'head', start: 0.82, end: 1, rate: 5 },
  ],
  keyK: 0.91,
};

const vogue: EmoteDef = {
  id: 'dance_vogue',
  dur: cycle('dance_vogue'),
  loop: true,
  usesArms: true,
  usesLegs: true,
  pose: voguePose,
  face: [
    { from: 0, to: 0.5, face: 'cool' },
    { from: 0.5, to: 0.875, face: 'smirk' },
    { from: 0.875, to: 1.01, face: 'kiss' },
  ],
  fx: [
    { kind: 'flash', from: 'above', start: 0, end: 1, rate: 1.5 },
    { kind: 'sparkles', from: 'head', start: 0, end: 0.125, rate: 6 },
    { kind: 'sparkles', from: 'head', start: 0.875, end: 1, rate: 6 },
  ],
  keyK: 0.09,
};

const shuffle: EmoteDef = {
  id: 'dance_shuffle',
  dur: cycle('dance_shuffle'),
  loop: true,
  usesArms: true,
  usesLegs: true,
  pose: shufflePose,
  face: [
    { from: 0, to: 0.5, face: 'grin' },
    { from: 0.5, to: 1.01, face: 'laugh' },
  ],
  fx: [
    { kind: 'sparkles', from: 'feet', start: 0, end: 1, rate: 6 },
    { kind: 'notes', from: 'above', start: 0, end: 1, rate: 1.5 },
  ],
  keyK: 0.125,
};

export const DANCES: EmoteRegistry = {
  dance_samba: samba,
  dance_passinho: passinho,
  dance_hiphop: hiphop,
  dance_disco: disco,
  dance_robot: robot,
  dance_kpop: kpop,
  dance_vogue: vogue,
  dance_shuffle: shuffle,
};
