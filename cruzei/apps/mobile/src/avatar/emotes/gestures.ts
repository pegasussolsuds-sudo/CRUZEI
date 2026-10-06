// Gestos e poses do avatar (tocam uma vez): acenar, cumprimentar, aplaudir, beijo, coração, vitória, reverência, timidez,
// gargalhada, pulo, giro, muque, instrumentos, poses, mágica, carinho no pet e as lendárias (chuva de estrelas, fogos).
// Dono: gestos. Contrato em ./types.ts; coreografia em ./gestures-moves.ts; partículas em ./gestures-fx.ts (EmoteFx).
//
// Regras que valem pra todos:
//   - loop: false; a pose sai do braço solto e volta pra ele (k = 0 e k = 1 neutros);
//   - braços em relação ao braço SOLTO: quem toca soma restArmDelta(anatomia) quando usesArms (igual às danças);
//   - mão aberta (palma pra câmera) nos gestos de mão erguida: GESTURE_HANDS, que o palco passa em BuildOptions.hands;
//   - limites (mãos no viewBox, fora do rosto, tronco no lugar) testados em __tests__/gestures.test.ts.

import {
  bowPose,
  clapPose,
  fireworksPose,
  flexPose,
  greetPose,
  guitarPose,
  heartPose,
  heroPose,
  jumpPose,
  kissPose,
  laughPose,
  magicPose,
  micPose,
  modelPose,
  pandeiroPose,
  petLovePose,
  shyPose,
  spinPose,
  starfallPose,
  victoryPose,
  wavePose,
} from './gestures-moves';
import type { EmoteDef, EmoteRegistry } from './types';

/** mão aberta com a palma pra câmera (BuildOptions.hands) nos gestos de mão erguida/apresentando */
export const GESTURE_HANDS: Record<string, { L?: 'open'; R?: 'open' }> = {
  wave: { L: 'open' },
  greet: { L: 'open' },
  kiss: { L: 'open' },
  mic: { L: 'open' },
  magic: { L: 'open' },
  starfall: { L: 'open', R: 'open' },
  fireworks: { L: 'open', R: 'open' },
};

const wave: EmoteDef = {
  id: 'wave',
  dur: 2.4,
  loop: false,
  usesArms: true,
  usesLegs: false,
  pose: wavePose,
  face: [{ from: 0.12, to: 0.88, face: 'grin' }],
  fx: [{ kind: 'sparkles', from: 'handL', start: 0.22, end: 0.78, rate: 5 }],
  keyK: 0.36,
};

const greet: EmoteDef = {
  id: 'greet',
  dur: 2.2,
  loop: false,
  usesArms: true,
  usesLegs: false,
  pose: greetPose,
  face: [
    { from: 0.14, to: 0.46, face: 'serene' },
    { from: 0.46, to: 0.9, face: 'grin' },
  ],
  fx: [{ kind: 'sparkles', from: 'handL', start: 0.56, end: 0.82, rate: 6 }],
  keyK: 0.7,
};

const clap: EmoteDef = {
  id: 'clap',
  dur: 2.4,
  loop: false,
  usesArms: true,
  usesLegs: false,
  pose: clapPose,
  face: [
    { from: 0.1, to: 0.5, face: 'grin' },
    { from: 0.5, to: 0.92, face: 'laugh' },
  ],
  fx: [{ kind: 'sparkles', from: 'handR', start: 0.16, end: 0.84, rate: 9 }],
  keyK: 0.3,
};

const kiss: EmoteDef = {
  id: 'kiss',
  dur: 2.4,
  loop: false,
  usesArms: true,
  usesLegs: false,
  pose: kissPose,
  face: [
    { from: 0.14, to: 0.5, face: 'kiss' },
    { from: 0.5, to: 0.9, face: 'wink' },
  ],
  fx: [
    { kind: 'kiss', from: 'mouth', start: 0.46, end: 0.62, rate: 6 },
    { kind: 'hearts', from: 'handL', start: 0.5, end: 0.76, rate: 5 },
  ],
  keyK: 0.6,
};

const heart: EmoteDef = {
  id: 'heart',
  dur: 2.6,
  loop: false,
  usesArms: true,
  usesLegs: false,
  pose: heartPose,
  face: [{ from: 0.16, to: 0.88, face: 'hearts' }],
  fx: [{ kind: 'hearts', from: 'chest', start: 0.24, end: 0.8, rate: 3 }],
  keyK: 0.5,
};

const victory: EmoteDef = {
  id: 'victory',
  dur: 2.4,
  loop: false,
  usesArms: true,
  usesLegs: true,
  pose: victoryPose,
  face: [
    { from: 0.12, to: 0.3, face: 'grin' },
    { from: 0.3, to: 0.86, face: 'laugh' },
  ],
  fx: [
    { kind: 'confetti', from: 'above', start: 0.34, end: 0.66, rate: 12 },
    { kind: 'stars', from: 'above', start: 0.34, end: 0.6, rate: 4 },
  ],
  keyK: 0.5,
};

const bow: EmoteDef = {
  id: 'bow',
  dur: 2.8,
  loop: false,
  usesArms: true,
  usesLegs: true,
  pose: bowPose,
  face: [
    { from: 0.2, to: 0.74, face: 'serene' },
    { from: 0.74, to: 0.95, face: 'smile' },
  ],
  fx: [{ kind: 'petals', from: 'above', start: 0.3, end: 0.72, rate: 5 }],
  keyK: 0.54,
};

const shy: EmoteDef = {
  id: 'shy',
  dur: 3.0,
  loop: false,
  usesArms: true,
  usesLegs: true,
  pose: shyPose,
  face: [{ from: 0.1, to: 0.9, face: 'blush' }],
  fx: [{ kind: 'hearts', from: 'head', start: 0.26, end: 0.78, rate: 2.5, color: '#FF8DB8' }],
  keyK: 0.45,
};

const laugh: EmoteDef = {
  id: 'laugh',
  dur: 2.8,
  loop: false,
  usesArms: true,
  usesLegs: true,
  pose: laughPose,
  face: [{ from: 0.06, to: 0.94, face: 'laugh' }],
  fx: [{ kind: 'haha', from: 'head', start: 0.12, end: 0.78, rate: 3.2 }],
  keyK: 0.28,
};

const jump: EmoteDef = {
  id: 'jump',
  dur: 1.8,
  loop: false,
  usesArms: true,
  usesLegs: true,
  pose: jumpPose,
  face: [
    { from: 0.1, to: 0.34, face: 'grin' },
    { from: 0.34, to: 0.72, face: 'laugh' },
    { from: 0.72, to: 0.92, face: 'grin' },
  ],
  fx: [
    { kind: 'stars', from: 'above', start: 0.36, end: 0.58, rate: 10 },
    { kind: 'confetti', from: 'above', start: 0.38, end: 0.6, rate: 12 },
    { kind: 'sparkles', from: 'feet', start: 0.64, end: 0.76, rate: 12 },
  ],
  keyK: 0.46,
};

const spin: EmoteDef = {
  id: 'spin',
  dur: 2.0,
  loop: false,
  usesArms: true,
  usesLegs: true,
  pose: spinPose,
  face: [
    { from: 0.1, to: 0.5, face: 'grin' },
    { from: 0.5, to: 0.9, face: 'laugh' },
  ],
  fx: [
    { kind: 'sparkles', from: 'chest', start: 0.24, end: 0.76, rate: 12 },
    { kind: 'stars', from: 'above', start: 0.3, end: 0.7, rate: 4 },
  ],
  keyK: 0.31,
};

const flex: EmoteDef = {
  id: 'flex',
  dur: 2.6,
  loop: false,
  usesArms: true,
  usesLegs: true,
  pose: flexPose,
  face: [
    { from: 0.14, to: 0.56, face: 'wink' },
    { from: 0.56, to: 0.9, face: 'cool' },
  ],
  fx: [
    { kind: 'sparkles', from: 'handR', start: 0.24, end: 0.52, rate: 6 },
    { kind: 'sparkles', from: 'handL', start: 0.66, end: 0.84, rate: 6 },
    { kind: 'sparkles', from: 'handR', start: 0.66, end: 0.84, rate: 6 },
  ],
  keyK: 0.36,
};

const guitar: EmoteDef = {
  id: 'guitar',
  dur: 3.6,
  loop: false,
  usesArms: true,
  usesLegs: true,
  pose: guitarPose,
  prop: 'guitar',
  face: [
    { from: 0.1, to: 0.5, face: 'serene' },
    { from: 0.5, to: 0.92, face: 'grin' },
  ],
  fx: [{ kind: 'notes', from: 'handL', start: 0.16, end: 0.82, rate: 3 }],
  keyK: 0.62,
};

const mic: EmoteDef = {
  id: 'mic',
  dur: 3.6,
  loop: false,
  usesArms: true,
  usesLegs: false,
  pose: micPose,
  prop: 'mic',
  face: [
    { from: 0.1, to: 0.42, face: 'serene' },
    { from: 0.42, to: 0.8, face: 'surprised' },
    { from: 0.8, to: 0.94, face: 'grin' },
  ],
  fx: [{ kind: 'notes', from: 'mouth', start: 0.16, end: 0.82, rate: 3.5 }],
  keyK: 0.64,
};

const pandeiro: EmoteDef = {
  id: 'pandeiro',
  dur: 3.2,
  loop: false,
  usesArms: true,
  usesLegs: true,
  pose: pandeiroPose,
  prop: 'tambourine',
  face: [
    { from: 0.1, to: 0.5, face: 'grin' },
    { from: 0.5, to: 0.86, face: 'laugh' },
  ],
  fx: [
    { kind: 'notes', from: 'handR', start: 0.16, end: 0.82, rate: 3 },
    { kind: 'sparkles', from: 'handR', start: 0.16, end: 0.84, rate: 5 },
  ],
  keyK: 0.4,
};

const poseHero: EmoteDef = {
  id: 'pose_hero',
  dur: 2.6,
  loop: false,
  usesArms: true,
  usesLegs: true,
  pose: heroPose,
  face: [{ from: 0.22, to: 0.9, face: 'cool' }],
  fx: [
    { kind: 'flash', from: 'head', start: 0.28, end: 0.4, rate: 6 },
    { kind: 'sparkles', from: 'chest', start: 0.3, end: 0.74, rate: 7 },
    { kind: 'stars', from: 'above', start: 0.3, end: 0.56, rate: 3 },
  ],
  keyK: 0.55,
};

const poseModel: EmoteDef = {
  id: 'pose_model',
  dur: 3.0,
  loop: false,
  usesArms: true,
  usesLegs: true,
  pose: modelPose,
  face: [
    { from: 0.18, to: 0.56, face: 'smirk' },
    { from: 0.56, to: 0.9, face: 'kiss' },
  ],
  fx: [
    { kind: 'flash', from: 'above', start: 0.24, end: 0.84, rate: 2.5 },
    { kind: 'sparkles', from: 'head', start: 0.26, end: 0.8, rate: 3 },
  ],
  keyK: 0.4,
};

const magic: EmoteDef = {
  id: 'magic',
  dur: 3.0,
  loop: false,
  usesArms: true,
  usesLegs: true,
  pose: magicPose,
  prop: 'wand',
  face: [
    { from: 0.12, to: 0.56, face: 'smirk' },
    { from: 0.56, to: 0.68, face: 'surprised' },
    { from: 0.68, to: 0.92, face: 'starry' },
  ],
  fx: [
    { kind: 'sparkles', from: 'handR', start: 0.16, end: 0.86, rate: 10 },
    { kind: 'stars', from: 'handR', start: 0.6, end: 0.78, rate: 12 },
    { kind: 'flash', from: 'handR', start: 0.6, end: 0.66, rate: 8 },
  ],
  keyK: 0.7,
};

const petLove: EmoteDef = {
  id: 'pet_love',
  dur: 3.0,
  loop: false,
  usesArms: false,
  usesLegs: false,
  pose: petLovePose,
  needsPet: true,
  face: [{ from: 0.1, to: 0.9, face: 'hearts' }],
  fx: [{ kind: 'hearts', from: 'pet', start: 0.2, end: 0.8, rate: 4 }],
  keyK: 0.5,
};

const starfall: EmoteDef = {
  id: 'starfall',
  dur: 4.0,
  loop: false,
  usesArms: true,
  usesLegs: false,
  pose: starfallPose,
  face: [{ from: 0.18, to: 0.9, face: 'starry' }],
  fx: [
    { kind: 'stars', from: 'above', start: 0.08, end: 0.8, rate: 8 },
    { kind: 'sparkles', from: 'above', start: 0.2, end: 0.8, rate: 5 },
  ],
  keyK: 0.55,
};

const fireworks: EmoteDef = {
  id: 'fireworks',
  dur: 4.0,
  loop: false,
  usesArms: true,
  usesLegs: true,
  pose: fireworksPose,
  face: [
    { from: 0.18, to: 0.42, face: 'surprised' },
    { from: 0.42, to: 0.62, face: 'starry' },
    { from: 0.62, to: 0.92, face: 'laugh' },
  ],
  fx: [
    { kind: 'fireworks', from: 'above', start: 0.18, end: 0.8, rate: 2.4 },
    { kind: 'flash', from: 'above', start: 0.24, end: 0.78, rate: 1.2 },
  ],
  keyK: 0.56,
};

export const GESTURES: EmoteRegistry = {
  wave,
  greet,
  clap,
  kiss,
  heart,
  victory,
  bow,
  shy,
  laugh,
  jump,
  spin,
  flex,
  guitar,
  mic,
  pandeiro,
  pose_hero: poseHero,
  pose_model: poseModel,
  magic,
  pet_love: petLove,
  starfall,
  fireworks,
};
