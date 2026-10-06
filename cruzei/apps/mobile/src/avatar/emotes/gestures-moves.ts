// Coreografia dos gestos do avatar (tocam uma vez): uma função de pose por gesto, todas 'worklet' e puras.
// Dono: gestos. Convenção e linha do tempo em ./gestures-kit.ts (braços/pernas "pra fora a partir de pra baixo", relativos
// ao braço solto). Quadros: [k, uL, fL, uR, fR, aL, sL, aR, sR, giro do tronco, dx, dy, giro da cabeça, sy %, dy da cabeça].
//
// Regras: a pose sai e volta pro braço solto (k = 0 e k = 1 neutros: o palco faz a entrada e a saída); a mão fica no
// viewBox e fora do rosto (a cabeça é desenhada por cima dos antebraços: mão "na boca" fica do lado do rosto); o tronco
// só desce/sobe (o rig não descola as pernas do chão: pulo = agachar e esticar na ponta dos pés).
// O acenar, o beijo e o cumprimento usam a mão ESQUERDA da tela: a direita é a que segura o objeto (slot held).

import { lerp, zero, type Pose, type PoseVariation } from '../pose';

import { bump } from './dances-kit';
import { REST, gPose, gate, rise, swing, timeline } from './gestures-kit';

type Keys = readonly (readonly number[])[];

/** quadro: k + canais (os ausentes no fim valem o do braço solto / corpo parado); lead força quem lidera (gestures-kit) */
function K(k: number, c: readonly number[], lead = 0): number[] {
  const out = [k];
  for (let i = 0; i < REST.length; i++) out.push(i < c.length ? c[i] : REST[i]);
  if (lead) out.push(lead);
  return out;
}
const R0 = REST;

// ---------------------------------------------------------------------------------------------------------------
// acenar (mão esquerda aberta ao lado da cabeça, o antebraço balança no cotovelo)
// ---------------------------------------------------------------------------------------------------------------
export const WAVE_KEYS: Keys = [
  K(0, R0),
  K(0.2, [112, 176, 12, -6, 0, 0, 2, 1, 1.5, 0.3, 0, 4, 0.8, -0.2]),
  K(0.8, [114, 178, 12, -6, 0, 0, 2, 1, 1.5, 0.3, 0, 5, 0.8, -0.2]),
  K(1, R0),
];

export function wavePose(k: number, t: number, v: PoseVariation): Pose {
  'worklet';
  const c = timeline(WAVE_KEYS, k, 0.3);
  const s = swing(k, 0.2, 0.84, 3) * v.en;
  c[1] += 20 * s;
  c[0] += 4 * s;
  c[11] += 1.2 * s;
  void t;
  return gPose(c);
}

// ---------------------------------------------------------------------------------------------------------------
// cumprimentar (mão direita no peito e um aceno de cabeça; depois a esquerda abre, palma pra cima: "seja bem-vindo")
// ---------------------------------------------------------------------------------------------------------------
export const GREET_KEYS: Keys = [
  K(0, R0),
  // a mão sobe pela frente da barriga (cotovelo um pouco aberto), nunca pela frente do quadril
  K(0.1, [15, 0, 30, -24, 0, 0, 0, 0, 0, 0, 0.2, 1, -1, 0.4]),
  K(0.24, [16, 4, 6, -134, 0, 0, 0, 0, 0, 0, 0.6, 3, -3.5, 1.4], 1),
  K(0.4, [16, 4, 6, -136, 0, 0, 0, 0, 0, 0, 0.6, 3, -3.5, 1.4]),
  K(0.6, [38, 82, 8, -132, 1, 0, 0, 0, -1, -0.3, 0, -3, 0.5, -0.2]),
  K(0.82, [40, 86, 10, -128, 1, 0, 0, 0, -1, -0.3, 0, -3, 0.5, -0.2]),
  K(0.91, [26, 40, 30, -24, 0, 0, 0, 0, 0, 0, 0, -1, 0, 0], -1),
  K(1, R0),
];

export function greetPose(k: number, t: number, v: PoseVariation): Pose {
  'worklet';
  const c = timeline(GREET_KEYS, k, 0.25);
  void t;
  void v;
  return gPose(c);
}

// ---------------------------------------------------------------------------------------------------------------
// aplaudir (as mãos se encontram na frente do peito, 5 palmas)
// ---------------------------------------------------------------------------------------------------------------
export const CLAP_OPEN: readonly number[] = [36, -66, 36, -66, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0];
export const CLAP_SHUT: readonly number[] = [17, -113, 17, -113, 1, 0, 1, 0, 0, 0, 0.4, 0, -0.5, 0.3];
const CLAP_N = 5;

export function clapPose(k: number, t: number, v: PoseVariation): Pose {
  'worklet';
  // o cotovelo abre antes do antebraço virar pra dentro (e fecha depois dele): a mão nunca passa na frente do quadril
  const on = gate(k, 0.02, 0.98, 0.12);
  const onF = gate(k, 0.07, 0.92, 0.12);
  const u = (k - 0.16) / 0.68;
  const hit = u > 0 && u < 1 ? bump(u * CLAP_N + 0.5, 0.42) : 0;
  const c: number[] = [];
  for (let i = 0; i < R0.length; i++) {
    const open = lerp(CLAP_OPEN[i], CLAP_SHUT[i], hit);
    c.push(lerp(R0[i], open, i === 1 || i === 3 ? onF : on));
  }
  c[11] = 3 * Math.sin(Math.PI * 2 * k) * v.en * on;
  void t;
  return gPose(c);
}

// ---------------------------------------------------------------------------------------------------------------
// mandar beijo (mão esquerda do lado da boca, depois joga o beijo com a palma aberta)
// ---------------------------------------------------------------------------------------------------------------
export const KISS_KEYS: Keys = [
  K(0, R0),
  K(0.24, [118, -104, 12, -6, 0, 0, 1, 0, -1, 0, 0, -4, 0, 0]),
  K(0.4, [119, -106, 12, -6, 0, 0, 1, 0, -1, 0, 0, -5, 0, 0]),
  // o antebraço gira por cima (da boca pro alto e pra fora) e volta pelo lado de fora: −210 ≡ 150 e −363 ≡ −3
  K(0.54, [100, -210, 12, -6, 2, 0, 0, 0, 2, 0.4, 0, 3, 0.8, -0.2]),
  K(0.78, [102, -206, 12, -6, 2, 0, 0, 0, 2, 0.4, 0, 3, 0.8, -0.2]),
  K(1, [R0[0], R0[1] - 360]),
];

export function kissPose(k: number, t: number, v: PoseVariation): Pose {
  'worklet';
  const c = timeline(KISS_KEYS, k, 0.2);
  void t;
  void v;
  return gPose(c);
}

// ---------------------------------------------------------------------------------------------------------------
// coração com as mãos (na frente do peito, balançando de leve)
// ---------------------------------------------------------------------------------------------------------------
export const HEART_KEYS: Keys = [
  K(0, R0),
  // o cotovelo abre antes e as mãos sobem pela frente da barriga até o peito (nunca pela frente do quadril)
  K(0.1, [34, -50, 34, -50, 0, 0, 0, 0, 0, 0, 0, 2, 0.4, 0], -1),
  K(0.24, [14, -112, 14, -112, 0, 0, 0, 0, 0, 0, 0, 5, 1, -0.2], 1),
  K(0.8, [14, -112, 14, -112, 0, 0, 0, 0, 0, 0, 0, -4, 1, -0.2]),
  K(0.9, [30, -30, 30, -30, 0, 0, 0, 0, 0, 0, 0, -1, 0.4, 0], -1),
  K(1, R0),
];

export function heartPose(k: number, t: number, v: PoseVariation): Pose {
  'worklet';
  const c = timeline(HEART_KEYS, k, 0.25);
  const sw = Math.sin(Math.PI * 2 * 1.5 * k) * gate(k, 0.22, 0.84, 0.1) * v.en;
  c[8] += 2 * sw;
  c[9] += 0.4 * sw;
  void t;
  return gPose(c);
}

// ---------------------------------------------------------------------------------------------------------------
// pose de vitória (agacha, estica na ponta dos pés com os dois punhos pro alto, sacode os punhos)
// ---------------------------------------------------------------------------------------------------------------
export const VICTORY_KEYS: Keys = [
  K(0, R0),
  K(0.17, [32, 70, 32, 70, 8, -8, 8, -8, 0, 0, 2.6, 0, -2.5, 0.3]),
  K(0.36, [142, 158, 142, 158, 3, 3, 3, 3, 0, 0, -1.6, 0, 3, -0.4]),
  K(0.76, [140, 156, 140, 156, 3, 3, 3, 3, 0, 0, -1.2, 0, 2.5, -0.4]),
  K(0.88, [40, 60, 40, 60, 2, 0, 2, 0, 0, 0, 0.6, 0, 0, 0]),
  K(1, R0),
];

export function victoryPose(k: number, t: number, v: PoseVariation): Pose {
  'worklet';
  const c = timeline(VICTORY_KEYS, k, 0.3);
  const pump = swing(k, 0.4, 0.76, 2.5) * v.en;
  c[0] += 5 * pump;
  c[2] -= 5 * pump;
  c[10] += 0.5 * Math.abs(pump);
  const p = gPose(c);
  p.shadow.s = 1 - 0.12 * rise(k, 0.2, 0.36) * (1 - rise(k, 0.76, 0.88));
  void t;
  return p;
}

// ---------------------------------------------------------------------------------------------------------------
// reverência (mão direita no coração, braço esquerdo abre de lado, o tronco desce encurtado, joelho esquerdo dobra)
// ---------------------------------------------------------------------------------------------------------------
export const BOW_KEYS: Keys = [
  K(0, R0),
  // mão direita sobe pela frente da barriga até o coração (cotovelo abre antes), o braço esquerdo abre de lado
  K(0.14, [26, 24, 30, -24, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], -1),
  K(0.27, [40, 50, 8, -132, -1, 2, 1, 0, 0, 0, 0.4, 1, -1, 0.4], 1),
  K(0.42, [48, 64, 6, -134, -4, 7, 3, -2, 0, 0, 2.6, 2, -6, 1.6]),
  K(0.64, [50, 66, 6, -134, -4, 7, 3, -2, 0, 0, 2.6, 2, -6, 1.6]),
  K(0.86, [24, 20, 30, -24, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], -1),
  K(1, R0),
];

export function bowPose(k: number, t: number, v: PoseVariation): Pose {
  'worklet';
  const c = timeline(BOW_KEYS, k, 0.3);
  void t;
  void v;
  return gPose(c);
}

// ---------------------------------------------------------------------------------------------------------------
// timidez (mãos juntas na barriga, cabeça baixa e de lado, ombros encolhidos, joelho pra dentro, balançando)
// ---------------------------------------------------------------------------------------------------------------
export const SHY_KEYS: Keys = [
  K(0, R0),
  // cotovelos abrem antes e as mãos se juntam na barriga (nunca na frente do quadril)
  K(0.09, [30, -24, 30, -24, 0, 0, -2, 2, -0.5, 0, 0.1, 3, -0.5, 0.4], -1),
  K(0.2, [10, -70, 10, -72, 1, 0, -5, 5, -1.5, 0, 0.4, 8, -1.5, 1.2], 1),
  K(0.82, [10, -70, 10, -72, 1, 0, -5, 5, -1.5, 0, 0.4, 8, -1.5, 1.2]),
  K(0.92, [40, -20, 40, -20, 0, 0, -1, 1, 0, 0, 0, 2, 0, 0.2], -1),
  K(1, R0),
];

export function shyPose(k: number, t: number, v: PoseVariation): Pose {
  'worklet';
  const c = timeline(SHY_KEYS, k, 0.25);
  const g = gate(k, 0.18, 0.86, 0.1);
  const sw = Math.sin(Math.PI * 2 * 1.5 * (k - 0.2)) * g * v.en;
  c[8] += 2.2 * sw;
  c[11] += 3 * sw;
  c[6] += 1.5 * sw;
  void t;
  return gPose(c);
}

// ---------------------------------------------------------------------------------------------------------------
// gargalhada (joga a cabeça pra trás, depois dobra rindo e bate na coxa; o corpo sacode)
// ---------------------------------------------------------------------------------------------------------------
export const LAUGH_KEYS: Keys = [
  K(0, R0),
  K(0.06, [32, -30, 36, -22, 0, 0, 0, 0, 0, 0, -0.2, -2, 0.6, -0.4], -1),
  K(0.16, [22, -118, 8, -82, 0, 0, 0, 0, 0, 0, -0.4, -4, 1.5, -1], 1),
  K(0.36, [22, -118, 8, -82, 0, 0, 0, 0, 0, 0, -0.4, -4, 1.5, -1]),
  K(0.54, [20, 0, 8, -84, 2, -2, 0, 0, 1, 0, 1.8, 4, -5, 1.6]),
  K(0.78, [20, -2, 8, -84, 2, -2, 0, 0, 1, 0, 1.8, 4, -5, 1.6]),
  K(0.9, [16, 0, 40, -20, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], -1),
  K(1, R0),
];

export function laughPose(k: number, t: number, v: PoseVariation): Pose {
  'worklet';
  const c = timeline(LAUGH_KEYS, k, 0.25);
  const g = gate(k, 0.1, 0.9, 0.08) * v.en;
  const sh = Math.sin(Math.PI * 2 * 9 * k);
  c[10] += 0.7 * Math.abs(sh) * g;
  c[11] += 2 * sh * g;
  c[12] += 0.8 * Math.abs(sh) * g;
  // tapinhas na coxa na segunda metade
  const slap = Math.abs(Math.sin(Math.PI * 2 * 3.5 * (k - 0.54))) * gate(k, 0.54, 0.8, 0.04) * v.en;
  c[0] += 7 * slap;
  c[1] += 9 * slap;
  void t;
  return gPose(c);
}

// ---------------------------------------------------------------------------------------------------------------
// pulo de alegria (agacha, estica na ponta dos pés com os braços pro alto, aterrissa agachando)
// ---------------------------------------------------------------------------------------------------------------
export const JUMP_KEYS: Keys = [
  K(0, R0),
  K(0.2, [26, 48, 26, 48, 9, -9, 9, -9, 0, 0, 3, 0, -3, 0.4]),
  K(0.38, [136, 152, 136, 152, 3, 4, 3, 4, 0, 0, -2.4, 0, 3.5, -0.6]),
  K(0.52, [138, 154, 138, 154, 2, 3, 2, 3, 0, 0, -2.2, 0, 3, -0.6]),
  K(0.68, [70, 110, 70, 110, 6, -6, 6, -6, 0, 0, 2, 0, -2, 0.3]),
  K(0.84, [24, 10, 24, 10, 1, 0, 1, 0, 0, 0, -0.2, 0, 0.5, 0]),
  K(1, R0),
];

export function jumpPose(k: number, t: number, v: PoseVariation): Pose {
  'worklet';
  const c = timeline(JUMP_KEYS, k, 0.25);
  const p = gPose(c);
  p.shadow.s = 1 - 0.14 * rise(k, 0.24, 0.4) * (1 - rise(k, 0.52, 0.66));
  void t;
  void v;
  return p;
}

// ---------------------------------------------------------------------------------------------------------------
// giro (rodopio de bailarina: prepara com os braços na frente, abre um braço no alto e o outro de lado com a perna em
// passé, troca os braços duas vezes como quem gira, e aterrissa). O rig é de frente: o giro se lê pela troca dos braços,
// pelo balanço do tronco e pelas faíscas em volta, sem espremer o rosto
// ---------------------------------------------------------------------------------------------------------------
export const SPIN_A: readonly number[] = [128, 160, 76, 104, 2, 1, 34, -26, -3, 0.6, -1, 4, 2, -0.3];
export const SPIN_B: readonly number[] = [76, 104, 128, 160, 2, 1, 34, -26, 3, -0.6, -1, -4, 2, -0.3];
export const SPIN_KEYS: Keys = [
  K(0, R0),
  K(0.13, [34, -84, 34, -84, 4, -4, 4, -4, 0, 0, 1.5, 0, -1, 0.2], -1),
  K(0.3, SPIN_A),
  K(0.72, SPIN_A),
  K(0.86, [30, 40, 30, 40, 2, 0, 2, 0, 0, 0, 0.6, 0, 0, 0]),
  K(1, R0),
];

export function spinPose(k: number, t: number, v: PoseVariation): Pose {
  'worklet';
  const c = timeline(SPIN_KEYS, k, 0.3);
  // troca A ↔ B ↔ A no meio (meia volta + meia volta)
  const sw = 0.5 - 0.5 * Math.cos(Math.PI * 2 * rise(k, 0.32, 0.7));
  const g = gate(k, 0.28, 0.74, 0.04);
  for (let i = 0; i < c.length; i++) c[i] += (SPIN_B[i] - SPIN_A[i]) * sw * g;
  c[10] += -0.6 * Math.abs(Math.sin(Math.PI * 4 * rise(k, 0.32, 0.7))) * g * v.en;
  void t;
  return gPose(c);
}

// ---------------------------------------------------------------------------------------------------------------
// muque (primeiro o braço direito da tela dobrado mostrando o bíceps e a outra mão dando tapinhas nele; depois o bíceps
// duplo, com uma contração)
// ---------------------------------------------------------------------------------------------------------------
export const FLEX_KEYS: Keys = [
  K(0, R0),
  K(0.09, [32, -12, 40, 160, 1, 0, 1, 0, 0, 0, 0.2, 1, 0.5, 0], 1),
  K(0.2, [-24, -128, 96, 214, 2, 0, 3, 1, -1, 0, 0.4, 3, 1.2, -0.2], 1),
  K(0.52, [-24, -128, 96, 214, 2, 0, 3, 1, -1, 0, 0.4, 3, 1.2, -0.2]),
  // mesmo quadro escrito com +360 (−128 ≡ 232): daqui o antebraço esquerdo só gira 14° até o bíceps duplo, e na volta
  // desce pelo lado de fora (218 → 90 → −3) em vez de passar na frente do rosto
  K(0.52, [-24, 232, 96, 214, 2, 0, 3, 1, -1, 0, 0.4, 3, 1.2, -0.2]),
  K(0.64, [98, 218, 98, 218, 5, 2, 5, 2, 0, 0, 0.6, 0, 1.5, -0.2]),
  K(0.86, [98, 218, 98, 218, 5, 2, 5, 2, 0, 0, 0.6, 0, 1.5, -0.2]),
  K(1, R0),
];

export function flexPose(k: number, t: number, v: PoseVariation): Pose {
  'worklet';
  const c = timeline(FLEX_KEYS, k, 0.3);
  // dois tapinhas no bíceps e o bíceps contrai junto
  const tap = Math.abs(Math.sin(Math.PI * 2 * (k - 0.24) / 0.13)) * gate(k, 0.24, 0.5, 0.03) * v.en;
  c[0] -= 5 * tap;
  c[1] -= 6 * tap;
  c[3] += 10 * tap;
  // contração do bíceps duplo
  const sq = bump((k - 0.74) * 6 + 0.5, 0.7) * (k > 0.66 && k < 0.82 ? 1 : 0) * v.en;
  c[1] += 14 * sq;
  c[3] += 14 * sq;
  c[0] += 4 * sq;
  c[2] += 4 * sq;
  c[12] += 1.2 * sq;
  c[10] += 0.6 * sq;
  void t;
  return gPose(c);
}

// ---------------------------------------------------------------------------------------------------------------
// tocar violão (a mão direita da tela no braço do violão, a esquerda dedilhando; cabeça e pé no ritmo)
// ---------------------------------------------------------------------------------------------------------------
export const GUITAR_KEYS: Keys = [
  K(0, R0),
  K(0.12, [10, -62, 64, -60, 0, 0, 0, 0, 0, 0, 0.3, 3, 0, 0.4], -1),
  K(0.88, [10, -62, 64, -60, 0, 0, 0, 0, 0, 0, 0.3, 3, 0, 0.4]),
  K(1, R0),
];

export function guitarPose(k: number, t: number, v: PoseVariation): Pose {
  'worklet';
  const c = timeline(GUITAR_KEYS, k, 0.25);
  const g = gate(k, 0.12, 0.9, 0.06) * v.en;
  const beat = 8 * k;
  c[1] += 10 * Math.sin(Math.PI * 2 * beat) * g;
  c[10] += 0.5 * Math.abs(Math.sin(Math.PI * beat)) * g;
  c[11] += 3 * Math.sin(Math.PI * beat * 0.5) * g;
  const tap = bump(beat * 0.5, 0.3) * g;
  c[6] -= 2 * tap;
  c[7] += 4 * tap;
  void t;
  return gPose(c);
}

// ---------------------------------------------------------------------------------------------------------------
// soltar a voz (microfone embaixo do queixo; no agudo o braço esquerdo abre e a cabeça vai pra trás)
// ---------------------------------------------------------------------------------------------------------------
export const MIC_KEYS: Keys = [
  K(0, R0),
  // o cotovelo abre antes e o microfone sobe pela frente do peito
  K(0.06, [16, 2, 34, -30, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0.1], -1),
  K(0.16, [20, 8, 16, -160, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0.3], 1),
  K(0.36, [24, 14, 16, -160, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0.3]),
  K(0.52, [100, 126, 16, -162, 2, 0, 1, 0, -1, -0.3, -0.4, -5, 1.8, -0.8]),
  K(0.76, [104, 130, 16, -162, 2, 0, 1, 0, -1, -0.3, -0.4, -5, 1.8, -0.8]),
  K(0.9, [24, 14, 16, -158, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0.3]),
  K(1, R0),
];

export function micPose(k: number, t: number, v: PoseVariation): Pose {
  'worklet';
  const c = timeline(MIC_KEYS, k, 0.25);
  const vib = Math.sin(Math.PI * 2 * 7 * k) * gate(k, 0.54, 0.76, 0.04) * v.en;
  c[0] += 3 * vib;
  c[11] += 1 * vib;
  const sway = Math.sin(Math.PI * 2 * 2 * k) * gate(k, 0.16, 0.5, 0.08);
  c[8] += 1.5 * sway;
  void t;
  return gPose(c);
}

// ---------------------------------------------------------------------------------------------------------------
// pandeiro (pandeiro erguido do lado da cabeça, chacoalhando; a outra mão na cintura e o pé no samba)
// ---------------------------------------------------------------------------------------------------------------
export const PANDEIRO_KEYS: Keys = [
  K(0, R0),
  K(0.15, [42, -40, 124, 168, 0, 0, 0, 0, -1, 0, 0, -3, 0.5, 0]),
  K(0.86, [42, -40, 124, 168, 0, 0, 0, 0, -1, 0, 0, -3, 0.5, 0]),
  K(1, R0),
];

export function pandeiroPose(k: number, t: number, v: PoseVariation): Pose {
  'worklet';
  const c = timeline(PANDEIRO_KEYS, k, 0.25);
  const g = gate(k, 0.15, 0.88, 0.06) * v.en;
  const sh = Math.sin(Math.PI * 2 * 10 * k);
  c[3] += 12 * sh * g;
  c[2] += 4 * sh * g;
  // samba no pé: o joelho livre entra e o calcanhar sobe, trocando 2x por batida
  const sw = Math.sin(Math.PI * 2 * 6 * k) * g;
  const fL = Math.max(0, sw);
  const fR = Math.max(0, -sw);
  c[4] += -6 * fL;
  c[5] += 8 * fL;
  c[6] += -6 * fR;
  c[7] += 8 * fR;
  c[8] += -2.4 * sw;
  c[9] += 0.6 * sw;
  c[10] += 0.6 * Math.abs(sw);
  void t;
  return gPose(c);
}

// ---------------------------------------------------------------------------------------------------------------
// pose de herói (punhos na cintura, base aberta, peito pra cima, queixo de lado)
// ---------------------------------------------------------------------------------------------------------------
export const HERO_KEYS: Keys = [
  K(0, R0),
  K(0.13, [26, 10, 26, 10, 3, -3, 3, -3, 0, 0, 1.6, 0, -1.5, 0.2]),
  K(0.3, [44, -44, 44, -44, 7, 4, 7, 4, 0, 0, -0.4, -3, 2.5, -0.6]),
  K(0.86, [44, -44, 44, -44, 7, 4, 7, 4, 0, 0, -0.4, -3, 2.5, -0.6]),
  K(1, R0),
];

export function heroPose(k: number, t: number, v: PoseVariation): Pose {
  'worklet';
  const c = timeline(HERO_KEYS, k, 0.25);
  void t;
  void v;
  return gPose(c);
}

// ---------------------------------------------------------------------------------------------------------------
// pose de capa de revista (mão esquerda atrás da cabeça, direita na cintura, quadril de lado, joelho pra dentro)
// ---------------------------------------------------------------------------------------------------------------
export const MODEL_KEYS: Keys = [
  K(0, R0),
  // a mão esquerda vai pra trás da cabeça POR CIMA (sai de lado, sobe e dobra: 212 ≡ −148), nunca pela frente do rosto
  K(0.24, [164, 212, 38, -46, 3, 2, -5, 4, 3.5, -1.2, 0, -6, 0, 0]),
  K(0.5, [164, 212, 38, -46, 3, 2, -5, 4, 3.5, -1.2, 0, -6, 0, 0]),
  K(0.62, [162, 214, 40, -48, 3, 2, -5, 4, 3, -1, 0, 4, 0, 0]),
  K(0.86, [162, 214, 40, -48, 3, 2, -5, 4, 3, -1, 0, 4, 0, 0]),
  // na volta o antebraço abre primeiro (a mão sai por cima e pelo lado) e só depois o cotovelo desce
  K(1, R0, 1),
];

export function modelPose(k: number, t: number, v: PoseVariation): Pose {
  'worklet';
  const c = timeline(MODEL_KEYS, k, 0.25);
  void t;
  void v;
  return gPose(c);
}

// ---------------------------------------------------------------------------------------------------------------
// truque de mágica (a varinha desenha dois círculos, a outra mão apresenta; no "tcharã" aponta pro alto)
// ---------------------------------------------------------------------------------------------------------------
export const MAGIC_KEYS: Keys = [
  K(0, R0),
  K(0.16, [40, 70, 46, 118, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0]),
  K(0.52, [40, 72, 46, 118, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0]),
  K(0.62, [62, 112, 138, 156, 2, 0, 4, 2, 1, 0.3, -0.6, -2, 2.5, -0.4]),
  K(0.86, [62, 112, 138, 156, 2, 0, 4, 2, 1, 0.3, -0.6, -2, 2.5, -0.4]),
  K(1, R0),
];

export function magicPose(k: number, t: number, v: PoseVariation): Pose {
  'worklet';
  const c = timeline(MAGIC_KEYS, k, 0.25);
  const g = gate(k, 0.16, 0.54, 0.05) * v.en;
  const ph = Math.PI * 2 * 2 * (k - 0.16) / 0.38;
  c[3] += 24 * Math.sin(ph) * g;
  c[2] += 8 * Math.cos(ph) * g;
  void t;
  return gPose(c);
}

// ---------------------------------------------------------------------------------------------------------------
// carinho no pet (não mexe nos braços: com o pet no colo a cena mantém as mãos aninhando; o corpo se inclina pro pet,
// sobe na ponta dos pés de alegria e o pet pula, abana e se espreguiça)
// ---------------------------------------------------------------------------------------------------------------
export function petLovePose(k: number, t: number, v: PoseVariation): Pose {
  'worklet';
  const p = zero();
  const g = gate(k, 0.04, 0.96, 0.16);
  p.body.r = 4 * g;
  p.body.dx = 0.6 * g;
  p.head.r = 8 * g;
  p.head.dy = 0.5 * g;
  const hop = bump(2 * (k - 0.25) / 0.5, 0.5) * (k > 0.15 && k < 0.85 ? 1 : 0) * v.en;
  p.body.dy = -0.6 * hop;
  const sq = Math.sin(Math.PI * 2 * 2 * (k - 0.25) / 0.5);
  p.pet = { dx: 0, dy: -5 * hop * g, r: 9 * Math.sin(Math.PI * 2 * 3 * k) * g, s: 1 + 0.06 * sq * g * (k > 0.15 && k < 0.85 ? 1 : 0) };
  void t;
  return p;
}

// ---------------------------------------------------------------------------------------------------------------
// chuva de estrelas (os braços sobem devagar abertos, palmas pro céu, olhando pra cima)
// ---------------------------------------------------------------------------------------------------------------
export const STARFALL_KEYS: Keys = [
  K(0, R0),
  K(0.3, [128, 118, 128, 118, 2, 0, 2, 0, 0, 0, -0.4, 0, 1.8, -0.8]),
  K(0.78, [132, 122, 132, 122, 2, 0, 2, 0, 0, 0, -0.4, 0, 1.8, -0.8]),
  K(1, R0),
];

export function starfallPose(k: number, t: number, v: PoseVariation): Pose {
  'worklet';
  const c = timeline(STARFALL_KEYS, k, 0.35);
  const sw = Math.sin(Math.PI * 2 * 1.5 * (k - 0.3)) * gate(k, 0.3, 0.8, 0.08) * v.en;
  c[0] += 4 * sw;
  c[2] -= 4 * sw;
  c[8] += 1.5 * sw;
  c[11] += 3 * sw;
  void t;
  return gPose(c);
}

// ---------------------------------------------------------------------------------------------------------------
// fogos de artifício (aponta pro céu, os fogos estouram e comemora com os dois braços, quicando)
// ---------------------------------------------------------------------------------------------------------------
export const FIREWORKS_KEYS: Keys = [
  K(0, R0),
  K(0.15, [16, -8, 150, 168, 0, 0, 1, 0, 1, 0.2, -0.4, 2, 1, -0.4]),
  K(0.32, [18, -6, 152, 170, 0, 0, 1, 0, 1, 0.2, -0.4, 2, 1, -0.4]),
  K(0.46, [150, 160, 150, 160, 3, 2, 3, 2, 0, 0, -1, 0, 2.5, -0.5]),
  K(0.86, [148, 158, 148, 158, 3, 2, 3, 2, 0, 0, -1, 0, 2.5, -0.5]),
  K(1, R0),
];

export function fireworksPose(k: number, t: number, v: PoseVariation): Pose {
  'worklet';
  const c = timeline(FIREWORKS_KEYS, k, 0.3);
  const b = Math.abs(Math.sin(Math.PI * 4 * (k - 0.46) / 0.4)) * gate(k, 0.46, 0.86, 0.04) * v.en;
  c[10] += 1.6 * b;
  c[4] += 3 * b;
  c[5] -= 5 * b;
  c[6] += 3 * b;
  c[7] -= 5 * b;
  c[0] += 6 * b;
  c[2] += 6 * b;
  void t;
  return gPose(c);
}
