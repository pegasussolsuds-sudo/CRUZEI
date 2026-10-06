// Kit dos gestos (animações que tocam uma vez): linha do tempo de quadros-chave com tempo explícito e os canais da pose.
// Dono: gestos. Tudo 'worklet' e puro (sem Math.random, sem estado): roda na thread de UI do palco, no JS e em node.
//
// Convenção dos braços e pernas = a das danças (./dances-kit.ts): direções absolutas "pra fora a partir de pra baixo",
// espelhadas entre os lados, RELATIVAS AO BRAÇO SOLTO (o palco soma restArmDelta da anatomia quando a animação usa os
// braços). Resumo: braço u = ombro → cotovelo, antebraço f = cotovelo → pulso; 0 pra baixo, 90 na horizontal pra fora,
// 180 pra cima, negativo = cruzando pra dentro (−90 = horizontal pra dentro). Perna a = coxa pra fora, s = canela pra fora.
//
// ATENÇÃO (plugin de worklets): helper tem de vir ANTES de quem usa (cada worklet captura o que chama ao ser definido).

import { clamp, easeInOut, type Pose } from '../pose';

import { HANG_BEND, HANG_U, poseOf } from './dances-kit';

/**
 * canais de um quadro, nesta ordem (os 12 primeiros = CH das danças):
 * 0 uL · 1 fL · 2 uR · 3 fR · 4 aL · 5 sL · 6 aR · 7 sR · 8 giro do tronco · 9 dx do tronco · 10 dy do tronco ·
 * 11 giro da cabeça · 12 alonga/encolhe o tronco (% de sy: −8 = sy 0,92) · 13 dy da cabeça
 */
export const GCH = 14;

/** braço solto e corpo parado (a pose neutra nos canais) */
export const REST: readonly number[] = [HANG_U, HANG_U - HANG_BEND, HANG_U, HANG_U - HANG_BEND, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

/** pose a partir dos 14 canais */
export function gPose(c: readonly number[]): Pose {
  'worklet';
  const p = poseOf(c);
  p.body.sy = 1 + (c[12] ?? 0) / 100;
  p.head.dy = c[13] ?? 0;
  return p;
}

/** arco do cotovelo nos giros grandes do antebraço (graus a partir de quanto o antebraço gira, e quanto o braço abre) */
export const ARC_FROM = 40;
export const ARC_U = 14;

/**
 * linha do tempo: keys = [[k, ...14 canais], …] em ordem de k (0..1). Entre dois quadros a pose vai com easeInOut; antes do
 * primeiro vale o primeiro e depois do último vale o último. `lag` (0..0,6) defasa as juntas dentro de cada trecho, como
 * gente: quando o braço SOBE o antebraço lidera (o cotovelo dobra primeiro e o braço vem atrás — nada de espantalho com o
 * antebraço pendurado na horizontal); quando DESCE o braço lidera e o antebraço vem atrás; a canela sempre vem atrás da
 * coxa. Um 16º valor no quadro de chegada força quem lidera naquele trecho (+1 antebraço, −1 braço, 0 automático).
 * Devolve os 14 canais.
 */
export function timeline(keys: readonly (readonly number[])[], k: number, lag = 0): number[] {
  'worklet';
  const n = keys.length;
  const out: number[] = [];
  if (k <= keys[0][0] || n === 1) {
    for (let j = 1; j < keys[0].length; j++) out.push(keys[0][j]);
    return out;
  }
  let i = 1;
  while (i < n - 1 && k > keys[i][0]) i++;
  const a = keys[i - 1];
  const b = keys[i];
  const m = clamp((k - a[0]) / Math.max(1e-6, b[0] - a[0]), 0, 1);
  const e = easeInOut(m);
  const el = lag > 0 ? easeInOut(clamp((m - lag) / (1 - lag), 0, 1)) : e;
  // braço subindo (|u| cresce): o braço espera; descendo: o antebraço espera
  const lead = b.length > 15 ? b[15] : 0;
  const upL = lead !== 0 ? lead > 0 : Math.abs(b[1]) > Math.abs(a[1]) + 1;
  const upR = lead !== 0 ? lead > 0 : Math.abs(b[3]) > Math.abs(a[3]) + 1;
  const nc = Math.min(a.length, 15);
  for (let j = 1; j < nc; j++) {
    let w = e;
    if (j === 1) w = upL ? el : e;
    else if (j === 2) w = upL ? e : el;
    else if (j === 3) w = upR ? el : e;
    else if (j === 4) w = upR ? e : el;
    else if (j === 6 || j === 8) w = el;
    out.push(a[j] + (b[j] - a[j]) * w);
  }
  // arco do cotovelo: quando o antebraço gira muito num trecho, o cotovelo abre um pouco no meio do caminho (a mão faz
  // um arco por fora e não passa na frente do quadril/do gancho)
  // (só com o braço baixo: com o braço erguido, abrir mais o braço só levantaria a mão)
  const arc = Math.sin(Math.PI * m);
  for (let s = 0; s < 2; s++) {
    const df = Math.abs(b[2 + s * 2] - a[2 + s * 2]);
    const low = 1 - clamp((Math.max(Math.abs(a[1 + s * 2]), Math.abs(b[1 + s * 2])) - 50) / 40, 0, 1);
    if (df > ARC_FROM) out[s * 2] += ARC_U * arc * low * Math.min(1, (df - ARC_FROM) / 60);
  }
  return out;
}

/** sobe de 0 a 1 entre a e b (suave) */
export function rise(k: number, a: number, b: number): number {
  'worklet';
  return easeInOut(clamp((k - a) / Math.max(1e-6, b - a), 0, 1));
}

/** janela suave 0→1→0: sobe em [a, a+w], desce em [b−w, b] */
export function gate(k: number, a: number, b: number, w: number): number {
  'worklet';
  return rise(k, a, a + w) * (1 - rise(k, b - w, b));
}

/** n balanços (seno) entre a e b, com entrada e saída suaves; amplitude 1 */
export function swing(k: number, a: number, b: number, n: number): number {
  'worklet';
  if (k <= a || k >= b) return 0;
  const u = (k - a) / (b - a);
  const env = Math.sin(Math.PI * u);
  return Math.sin(2 * Math.PI * n * u) * Math.min(1, env * 2.2);
}
