// Coreografia das danças do avatar: uma função de pose por dança, todas 'worklet' e puras.
// Dono: danças. Convenção de ângulos e ritmo em ./dances-kit.ts (braços/pernas "pra fora a partir de pra baixo").
//
// Passos autorais (nada copiado de coreografia protegida):
//   samba     samba no pé: pés trocando 2x por batida, rebolado no peso, braços alternando por batida e um "uh!" no alto
//   passinho  funk: tesourinha de joelhos (os dois pro mesmo lado) e cruzadinha, ombrinho e mãos soltas
//   hiphop    bounce no tempo (joelho e cabeça); cruza, tira o pó dos ombros, abre, levanta o teto e ginga de lado
//   disco     aponta pro alto e pro chão, rebolando, um lado e depois o outro
//   robot     8 posições travadas (com a tremidinha da trava) e a cabeça em degraus no contratempo
//   kpop      batidas secas: X no peito, abre, aponta, onda de braços e pose fofa com a mão em cima da cabeça
//   vogue     moldura do rosto, linhas diagonais, V pro alto e agachadinha emoldurando, cruzando as pernas
//   shuffle   running man (joelhos alternando) e T-step (perna de lado batendo, pé de apoio girando)
//
// Quadros-chave: 12 canais (ver CH em dances-kit): [uL, fL, uR, fR, aL, sL, aR, sR, giro do tronco, dx, dy, cabeça].

import { lerp, windowed, zero, type Pose, type PoseVariation } from '../pose';

import { armL, armR, bump, hit, keyMix, legL, legR, osc, poseOf, square } from './dances-kit';

/** batidas por minuto e batidas por ciclo de cada dança (dur = batidas · 60 / bpm) */
export const DANCE_TEMPO: Record<string, { bpm: number; beats: number }> = {
  dance_samba: { bpm: 104, beats: 4 },
  dance_passinho: { bpm: 132, beats: 4 },
  dance_hiphop: { bpm: 94, beats: 8 },
  dance_disco: { bpm: 120, beats: 8 },
  dance_robot: { bpm: 110, beats: 8 },
  dance_kpop: { bpm: 124, beats: 8 },
  dance_vogue: { bpm: 118, beats: 8 },
  dance_shuffle: { bpm: 128, beats: 4 },
};

// ---------------------------------------------------------------------------------------------------------------
// samba no pé
// ---------------------------------------------------------------------------------------------------------------

export function sambaPose(k: number, t: number, v: PoseVariation): Pose {
  'worklet';
  const e = v.en;
  const b = 4 * k; // batida 0..4
  const sw = Math.sin(Math.PI * 8 * k); // + = pé esquerdo livre (peso na direita); troca 2x por batida
  const fL = Math.max(0, sw);
  const fR = Math.max(0, -sw);
  const p = zero();
  // pés rápidos: o joelho livre entra e o calcanhar sobe; a perna de apoio fica embaixo do corpo
  legL(p, (-8 * fL + 1.2 * fR) * e, (10 * fL + 1.2 * fR) * e);
  legR(p, (-8 * fR + 1.2 * fL) * e, (10 * fR + 1.2 * fL) * e);
  // rebolado: o quadril do apoio sobe e o tronco vai pra cima dele
  p.body.r = -3.4 * sw * e;
  p.body.dx = 0.9 * sw * e;
  p.body.dy = 0.8 * Math.abs(sw) * e - 0.2;
  p.shadow.s = 1 - 0.02 * Math.abs(sw);
  // braços alternando por batida: um sobe aberto (mão na altura do ombro), o outro passa na frente da barriga
  const ua = 0.5 + 0.5 * Math.sin(Math.PI * b);
  const fl = windowed(b, 1.9, 3.55, 0.4, 0.55); // "uh!": braço direito vai pro alto na 3ª batida
  armL(p, lerp(lerp(28, 50, ua), 28, fl), lerp(lerp(-100, 150, ua), -100, fl));
  armR(p, lerp(lerp(50, 28, ua), 142, fl), lerp(lerp(150, -100, ua), 166, fl));
  // cabeça quase reta (compensa o tronco), balança na batida e acompanha o "uh!"
  p.head.r = -0.7 * p.body.r + 2.2 * osc(b * 0.5) + 4 * fl;
  p.head.dy = 0.25 * Math.abs(sw);
  void t;
  return p;
}

// ---------------------------------------------------------------------------------------------------------------
// passinho
// ---------------------------------------------------------------------------------------------------------------

/**
 * 1 quadro por colcheia: tesourinha (4) + cruzadinha (4). Canais em CH (dances-kit) + atraso do braço esquerdo/direito
 * na troca pra este quadro (12, 13: + antebraço atrás, - antebraço na frente), escolhido pra o braço não esticar demais.
 */
export const PASS_KEYS: readonly (readonly number[])[] = [
  [16, -10, 20, 128, 15, -7, -12, 7, 4, -1.1, 0.6, -4, 0.45, 0.45], // joelhos pra esquerda, braços soltos pro outro lado
  [20, 128, 16, -10, -12, 7, 15, -7, -4, 1.1, 0.6, 4, -0.45, 0.45], // joelhos pra direita
  [16, -10, 20, 128, 15, -7, -12, 7, 4, -1.1, 0.6, -4, 0.45, -0.45], // joelhos pra esquerda
  [20, 128, 16, -10, -12, 7, 15, -7, -4, 1.1, 0.6, 4, -0.45, 0.45], // joelhos pra direita
  [28, -15, 20, 128, -18, -6, 3, 3, 3, 0.7, 0.8, 4, -0.45, -0.45], // cruza a esquerda na frente, mão direita pra cima
  [20, 128, 20, 128, 9, 3, 9, 3, 0, 0, 1.2, 0, 0.45, 0.45], // abre (base larga, as duas mãos pra cima)
  [20, 128, 28, -15, 3, 3, -18, -6, -3, -0.7, 0.8, -4, 0.45, -0.45], // cruza a direita
  [20, 128, 20, 128, 9, 3, 9, 3, 0, 0, 1.2, 0, 0.45, 0.45], // abre
];

export function passinhoPose(k: number, t: number, v: PoseVariation): Pose {
  'worklet';
  const c = keyMix(PASS_KEYS, k, 0.55, 0.3, 0.45);
  const p = poseOf(c);
  const e8 = 8 * k;
  // ombrinho: o tronco quica em cada colcheia e os ombros sobem um de cada vez
  const h = hit(e8, 0.18, 1.6);
  p.body.dy += 1.0 * h * v.en;
  p.shadow.s = 1 - 0.03 * h;
  const sh = osc(e8 / 2);
  p.armL.r += 5 * sh * v.en;
  p.armR.r += 5 * sh * v.en;
  p.head.dy = 0.5 * h;
  void t;
  return p;
}

// ---------------------------------------------------------------------------------------------------------------
// hip-hop
// ---------------------------------------------------------------------------------------------------------------

/** 1 quadro por batida (o bounce de joelho e cabeça vem por cima) */
export const HIPHOP_KEYS: readonly (readonly number[])[] = [
  [-16, -100, -16, -100, 1, 0, 1, 0, 0, 0, 0.4, 0, -0.45, -0.45], // cruza na frente da barriga (antebraço vem na frente)
  [-22, -130, 30, -10, 0, 2, 2, 0, -2, 0.6, 0, 6, 0.45, 0.45], // tira o pó do ombro direito
  [30, -10, -22, -130, 2, 0, 0, 2, 2, -0.6, 0, -6, 0.45, -0.45], // e do esquerdo
  [42, 18, 42, 18, 1, 0, 1, 0, 2, -0.8, 0, 2, 0.45, 0.45], // abre, palmas pra baixo
  [120, 178, 120, 178, 6, 1, 6, 1, 0, 0, -0.4, 0, -0.45, -0.45], // levanta o teto (antebraço vira pra cima antes), base aberta
  [126, 170, 126, 170, 6, 1, 6, 1, 0, 0, 0.6, 0, 0.45, 0.45], // empurra de novo
  [30, 70, 40, 160, 1, 0, 9, 3, 3, -0.8, 0, 4, 0.45, 0.45], // ginga pra direita: pisa de lado (o outro braço solto, cotovelo dobrado)
  [40, 160, 30, 70, 9, 3, 1, 0, -3, 0.8, 0, -4, 0.45, 0.45], // ginga pra esquerda
];

export function hiphopPose(k: number, t: number, v: PoseVariation): Pose {
  'worklet';
  const e = v.en;
  const c = keyMix(HIPHOP_KEYS, k, 0.5, 0.15, 0.45);
  const p = poseOf(c);
  const b = 8 * k;
  const dn = 0.5 + 0.5 * Math.cos(2 * Math.PI * b); // embaixo na batida
  const nod = 0.5 + 0.5 * Math.cos(2 * Math.PI * (b - 0.12)); // a cabeça chega um tiquinho depois
  // bounce: joelhos pra fora e tronco desce na batida
  p.legL.r += 3.5 * dn * e;
  p.legR.r -= 3.5 * dn * e;
  p.shinL = { r: (p.shinL ? p.shinL.r : 0) - 6 * dn * e };
  p.shinR = { r: (p.shinR ? p.shinR.r : 0) + 6 * dn * e };
  p.body.dy += (1.5 * dn - 0.3) * e;
  p.shadow.s = 1 + 0.02 * dn;
  p.head.dy = 0.9 * nod;
  p.head.r += 1.5 * osc(b * 0.5 + 0.25);
  void t;
  return p;
}

// ---------------------------------------------------------------------------------------------------------------
// disco
// ---------------------------------------------------------------------------------------------------------------

const DISCO_UP_R = [53, -60, 148, 158, -4, 4, 1, 1, 3, -0.7, -0.3, 7]; // aponta pro alto, mão na cintura
const DISCO_DN_R = [53, -60, 33, 33, 3, -2, 3, -2, 2, 0.5, 1.3, 3]; // aponta pro chão, joelhos dobram
const DISCO_UP_L = [148, 158, 53, -60, 1, 1, -4, 4, -3, 0.7, -0.3, -7];
const DISCO_DN_L = [33, 33, 53, -60, 3, -2, 3, -2, -2, -0.5, 1.3, -3];
export const DISCO_KEYS: readonly (readonly number[])[] = [DISCO_UP_R, DISCO_DN_R, DISCO_UP_R, DISCO_DN_R, DISCO_UP_L, DISCO_DN_L, DISCO_UP_L, DISCO_DN_L];

export function discoPose(k: number, t: number, v: PoseVariation): Pose {
  'worklet';
  const c = keyMix(DISCO_KEYS, k, 0.38, 0.35, 0.45);
  const p = poseOf(c);
  // quadril gingando no meio-tempo por cima dos quadros
  const b = 8 * k;
  p.body.dx = (p.body.dx ?? 0) + 0.5 * osc(b * 0.5) * v.en;
  p.body.dy += 0.3 * bump(b, 0.4);
  p.head.dy = 0.3 * bump(b, 0.4);
  void t;
  return p;
}

// ---------------------------------------------------------------------------------------------------------------
// robô
// ---------------------------------------------------------------------------------------------------------------

export const ROBOT_KEYS: readonly (readonly number[])[] = [
  [90, 0, 90, 0, 0, 0, 0, 0, 0, 0, 0, 0], // braços em L pra baixo
  [90, -180, 90, 0, 14, -5, 0, 0, -2, 0, 0.4, -6], // antebraço esquerdo sobe (por dentro: -180 = pra cima), joelho esquerdo
  [90, 0, 90, -180, 0, 0, 14, -5, 2, 0, 0.4, 6], // troca
  [90, -180, 90, -180, 0, 0, 0, 0, 0, 0, -0.4, 0], // trave
  [18, -88, 18, -88, 3, 3, 3, 3, 0, 0, 1.0, -4], // bandeja
  [154, 148, 18, -88, 0, 0, 0, 0, 4, 0, 0, -6], // braço esquerdo em diagonal
  [24, 135, 140, 20, 10, -4, 0, 0, -3, 0, 0.3, 5], // zigue-zague
  [12, 12, 12, 12, 0, 0, 0, 0, 0, 0, 0, 0], // em pé, duro
];
/** cabeça em degraus no contratempo (16 casas) */
const ROBOT_HEAD: readonly (readonly number[])[] = [[0], [5], [0], [-5], [0], [-6], [0], [6], [0], [5], [-4], [-4], [0], [6], [0], [0]];

export function robotPose(k: number, t: number, v: PoseVariation): Pose {
  'worklet';
  const c = keyMix(ROBOT_KEYS, k, 0.22, 1.0);
  const p = poseOf(c);
  p.head.r += keyMix(ROBOT_HEAD, k, 0.25, 1.2)[0];
  // tremidinha da trava logo depois de cada passo (sem ruído: senoide amortecida)
  const f = 8 * k - Math.floor(8 * k);
  const z = f > 0.16 ? Math.exp(-(f - 0.16) * 14) * Math.sin((f - 0.16) * 60) : 0;
  p.body.dy += 0.35 * z * v.en;
  p.head.dy = -0.25 * z;
  void t;
  return p;
}

// ---------------------------------------------------------------------------------------------------------------
// k-pop
// ---------------------------------------------------------------------------------------------------------------

export const KPOP_KEYS: readonly (readonly number[])[] = [
  [-20, -128, -20, 232, 1, 0, 1, 0, 0, 0, 0.6, 0, -0.45, 0.45], // X no peito (o direito desce com a mão pra cima: 232 = -128)
  [33, 33, 33, 33, 4, 4, 4, 4, 0, 0, 0, 5, 0.45, -0.45], // abre seco (o direito abre por cima)
  [53, -60, 150, 150, 2, 2, -5, 6, -3, 0.5, 0, 6, 0, 0.45], // aponta com a direita, mão na cintura
  [150, 150, 53, -60, -5, 6, 2, 2, 3, -0.5, 0, -6, 0.45, -0.45], // troca
  [35, 150, 35, 20, 3, 3, -2, 2, 4, -0.8, 0, 4, 0.45, 0.45], // onda de braços (cotovelo baixo, antebraço sobe e desce)
  [35, 20, 35, 150, -2, 2, 3, 3, -4, 0.8, 0, -4, 0.45, 0.45], // volta a onda
  [53, -60, 124, 205, 2, 2, -6, 7, -2, 0.4, 0.2, 9, 0.45, 0.45], // pose fofa: mão aberta do lado do rosto, cabeça inclinada
  [53, -60, 127, 208, 2, 2, -6, 7, -2, 0.4, 0.6, 7, 0.45, 0.45], // segura a pose quicando
];

/**
 * o ciclo do k-pop começa no meio da pose fofa (quadro 7 parado): a troca pro X no peito gira o antebraço direito
 * passando de 180° e, se caísse no começo do ciclo, o fade de entrada do palco (blend linear) daria um tranco
 */
export const KPOP_PHASE = 0.07;

export function kpopPose(k: number, t: number, v: PoseVariation): Pose {
  'worklet';
  const x = k - KPOP_PHASE;
  const c = keyMix(KPOP_KEYS, x, 0.34, 0.6, 0.45);
  const p = poseOf(c);
  p.body.dy += 0.4 * hit(8 * x, 0.12, 2) * v.en;
  void t;
  return p;
}

// ---------------------------------------------------------------------------------------------------------------
// vogue
// ---------------------------------------------------------------------------------------------------------------

export const VOGUE_KEYS: readonly (readonly number[])[] = [
  [126, 210, 126, 210, -5, -1, 1, 1, 3, 0.8, 0, -4, 0.45, 0.45], // moldura: mãos do lado do rosto, cotovelos pro alto
  [150, 152, 53, -60, 1, 1, -5, -1, -3, -0.8, 0, 6, 0, -0.45], // diagonal pro alto, mão na cintura
  [148, 150, 42, 20, -5, -1, 1, 1, 3, 0.6, 0, -6, 0.45, 0.45], // linha diagonal: um braço esticado pro alto, o outro pro chão
  [33, 33, 126, 210, 1, 1, -5, -1, -3, -0.6, 0, 7, 0.45, -0.45], // moldura de um lado, o outro pro chão
  [148, 155, 148, 155, 0, 0, 0, 0, 0, 0, -0.3, 0, 0.45, 0.45], // V pro alto
  [126, 210, 30, 36, -5, -1, 1, 1, 4, 0.8, 0, -7, 0.45, 0.45], // moldura do outro lado
  [53, 300, 150, 152, 1, 1, -5, -1, -3, -0.8, 0, 6, 0.45, 0.45], // diagonal do outro lado (a mão desce por dentro até a cintura)
  [126, 210, 126, 210, 5, -2, 5, -2, 0, 0, 1.6, 0, 0.45, 0.45], // agacha emoldurando
];

export function voguePose(k: number, t: number, v: PoseVariation): Pose {
  'worklet';
  const c = keyMix(VOGUE_KEYS, k, 0.3, 0.35, 0.45);
  const p = poseOf(c);
  p.body.dx = (p.body.dx ?? 0) + 0.4 * osc(4 * k) * v.en;
  void t;
  return p;
}

// ---------------------------------------------------------------------------------------------------------------
// shuffle
// ---------------------------------------------------------------------------------------------------------------

export function shufflePose(k: number, t: number, v: PoseVariation): Pose {
  'worklet';
  const e = v.en;
  const b = 4 * k;
  const q = b - Math.floor(b);
  const lift = Math.pow(Math.sin(Math.PI * q), 1.4); // joelho sobe no meio da batida
  const left = Math.floor(b) % 2 === 0; // running man: esquerda, direita, ...
  const wA = 0.5 + 0.5 * square(k, 0.2); // 1ª metade running man, 2ª T-step
  const p = zero();
  // running man (A)
  const lL = left ? lift : 0;
  const lR = left ? 0 : lift;
  // T-step (B): perna direita de lado batendo em colcheia, pé esquerdo girando calcanhar/ponta
  const kick = 0.5 + 0.5 * square(2 * b, 0.4);
  const tw = square(2 * b + 0.25, 0.4);
  legL(p, lerp(3 * tw, 34 * lL, wA) * e, lerp(2 * tw, -16 * lL, wA) * e);
  legR(p, lerp(14 + 12 * kick, 34 * lR, wA) * e, lerp(2 + 10 * kick, -16 * lR, wA) * e);
  // braços: running man bombeia em oposição (o que vem pra frente cruza na altura da cintura, cotovelo aberto, longe do
  // quadril; o outro vai pra trás e pra fora); T-step abre pra equilibrar
  const pumpL = lR - lL;
  const outL = Math.max(0, pumpL);
  const inL = Math.max(0, -pumpL);
  armL(p, lerp(70 + 4 * tw, 30 + 14 * outL + 6 * inL, wA), lerp(96, -10 + 55 * outL - 90 * inL, wA));
  armR(p, lerp(62 + 6 * kick, 30 + 14 * inL + 6 * outL, wA), lerp(84, -10 + 55 * inL - 90 * outL, wA));
  // quica: embaixo com os dois pés no chão, sobe com o joelho
  const bob = lerp(0.5 + 0.5 * Math.cos(2 * Math.PI * 2 * b), 1 - lift, wA);
  p.body.dy = (1.1 * bob - 0.5) * e;
  p.body.r = lerp(-3 + tw, 3 * (lL - lR), wA) * e;
  p.body.dx = lerp(-0.6, -0.8 * (lL - lR), wA);
  p.shadow.s = 1 - 0.04 * (1 - bob);
  p.head.r = -0.6 * p.body.r + 2 * osc(b * 0.5);
  p.head.dy = 0.4 * bob;
  void t;
  return p;
}
