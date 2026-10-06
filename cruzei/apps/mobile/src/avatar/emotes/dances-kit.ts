// Kit das danças: convenção de ângulos "de gente", ritmo (batidas, pulsos) e quadros-chave com ataque/trava.
// Dono: danças. Tudo aqui é 'worklet' e puro (sem Math.random, sem estado): roda na thread de UI do palco, no JS e em node.
//
// CONVENÇÃO (o que as danças escrevem): direções absolutas "pra fora a partir do braço/perna pra baixo", em graus,
// espelhadas entre os lados. Assim a mesma linha vale pros dois braços e ninguém precisa pensar em horário/anti-horário.
//   braço:  u = direção do braço (ombro → cotovelo), f = direção do antebraço (cotovelo → pulso)
//           0 = pra baixo · 90 = na horizontal pra fora · 180 = pra cima · >180 = por cima da cabeça, pro outro lado ·
//           <0 (ou 270..360) = cruzando na frente do corpo, pro outro lado. Cotovelo reto quando f = u.
//   perna:  a = coxa pra fora a partir do repouso; s = canela pra fora a partir do repouso (joelho reto quando s = a).
//           Joelho pra fora: a > 0 e s < a. Joelho pra dentro: a < 0 e s > a.
// A pose resultante é RELATIVA AO BRAÇO SOLTO (o palco/folha somam restArmDelta(anatomia) quando a animação usa os
// braços), então vale pra qualquer repouso (mão na cintura, no passante, na coxa) e qualquer tipo de corpo; as direções
// são exatas pro braço solto médio (HANG_U/HANG_BEND) e cada corpo desvia um pouco, do jeito que o braço dele cai.
//
// ATENÇÃO (plugin de worklets): helper tem de vir ANTES de quem usa (cada worklet captura o que chama ao ser definido).

import { TAU, clamp, easeInOut, zero, type Pose } from '../pose';

/**
 * braço solto médio (média dos 6 corpos, os dois lados, em anatomy.hangArms): braço 14° pra fora, antebraço 3° pra dentro
 * (folga do cotovelo de 17°). Cada pessoa desvia disto (esguio ~10° mais fechado, plus ~12° mais aberto) e a dança
 * acompanha esse jeito; __tests__/dances.test.ts avisa se a anatomia mudar e estes números ficarem velhos.
 */
export const HANG_U = 14;
export const HANG_BEND = 17;

/** parte fracionária (sempre 0..1, também pra x negativo) */
export function frac(x: number): number {
  'worklet';
  return x - Math.floor(x);
}

/** seno de período 1 */
export function osc(x: number): number {
  'worklet';
  return Math.sin(TAU * x);
}

/** pulso periódico (período 1) centrado em x inteiro, largura total w (0..1), forma de cosseno, pico 1 */
export function bump(x: number, w: number): number {
  'worklet';
  const f = frac(x);
  const d = Math.min(f, 1 - f) / Math.max(1e-6, w * 0.5);
  return d >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * d);
}

/** ataque rápido logo depois de cada x inteiro e queda até o próximo (o "tum" da batida), 0..1 */
export function hit(x: number, attack: number, decay: number): number {
  'worklet';
  const f = frac(x);
  if (f < attack) return Math.sin((Math.PI / 2) * (f / attack));
  return Math.pow(1 - (f - attack) / (1 - attack), decay);
}

/** quadrada suavizada (período 1): +1 na primeira metade, -1 na segunda; `soft` 0..1 arredonda a virada */
export function square(x: number, soft: number): number {
  'worklet';
  const s = Math.sin(TAU * x);
  return s / Math.sqrt(s * s + soft * soft);
}

/** saída com passada e volta (trava do robô / batida do k-pop); o = quanto passa (0 = sem passar) */
export function snap(k: number, o: number): number {
  'worklet';
  const c = clamp(k, 0, 1) - 1;
  return 1 + (o + 1) * c * c * c + o * c * c;
}

/** comprimentos nominais do braço e do antebraço (corpo médio) — só pra limitar o alcance */
export const ARM_L1 = 18.2;
export const ARM_L2 = 15.6;
/** alcance máximo pra fora (ombro → pulso, nominal): mão dentro do viewBox até no corpo largo e no atlético, com a folga
 * do braço solto de cada corpo (até ~10° de diferença) e do tronco gingando */
export const MAX_OUT = 18.5;
/** alcance máximo pra cima (ombro → pulso, nominal): mão em y ≥ 1 até no corpo mais alto */
export const MAX_UP = 30;

const DEG = Math.PI / 180;

/** diferença angular em (-180, 180] */
function wrap180(d: number): number {
  'worklet';
  return ((((d + 180) % 360) + 360) % 360) - 180;
}

/** quanto excede o alcance: > 0 = mão passaria do limite pra fora (side 0) ou pra cima (side 1) */
function excess(u: number, g: number, side: number): number {
  'worklet';
  if (side === 0) return ARM_L1 * Math.sin(u * DEG) + ARM_L2 * Math.sin(g * DEG) - MAX_OUT;
  return -(ARM_L1 * Math.cos(u * DEG) + ARM_L2 * Math.cos(g * DEG)) - MAX_UP;
}

/** mexer o braço custa REACH_U_COST vezes mexer o antebraço: o empurrão prefere dobrar o cotovelo */
export const REACH_U_COST = 2.5;
/** raio (graus, no espaço com custo) em volta do braço esticado em que o empurrão some aos poucos */
export const REACH_QUIET = 8;

/**
 * empurra (u, g) pra fora da região proibida de um lado (side 0 = pra fora, centro no braço esticado na horizontal
 * (90, 90); side 1 = pra cima, centro no braço esticado pro alto (180, 180)) ao longo do raio que sai do centro, até a
 * borda. A região é estrelada a partir do centro (o alcance cai sempre que u e g se afastam dele), então a borda é
 * única e o empurrão é contínuo em toda parte, menos no próprio centro: perto dele (REACH_QUIET) o empurrão some aos
 * poucos e o braço reto que varre a horizontal estica um instante em vez de virar o antebraço de uma vez num quadro.
 */
function pushOut(u: number, g: number, side: number): number[] {
  'worklet';
  if (excess(u, g, side) <= 0) return [u, g];
  const c = side === 0 ? 90 : 180;
  const du = wrap180(u - c);
  const dg = wrap180(g - c);
  const r = Math.hypot(du / REACH_U_COST, dg);
  if (r < 1e-6) return [u, g];
  // na distância 90 do centro em qualquer eixo o alcance já cabe (sen/cos = 0): a borda fica entre t = 1 e tMax
  let lo = 1;
  let hi = 90 / Math.max(Math.abs(du), Math.abs(dg));
  for (let i = 0; i < 16; i++) {
    const t = 0.5 * (lo + hi);
    if (excess(c + du * t, c + dg * t, side) > 0) lo = t;
    else hi = t;
  }
  const w = Math.min(1, r / REACH_QUIET);
  const t = 1 + (hi - 1) * w;
  return [u + du * (t - 1), g + dg * (t - 1)];
}

/**
 * braço com o alcance limitado: se o braço passaria do limite pra fora (MAX_OUT) ou pra cima (MAX_UP), o cotovelo dobra
 * (e o braço ajusta um pouco) o mínimo necessário, sem saltos (ver pushOut). Isso também faz as trocas de quadro
 * (braço reto passando pela horizontal) dobrarem o cotovelo no caminho, como gente faz. Devolve [u, g].
 */
export function reachArm(u: number, f: number): number[] {
  'worklet';
  const a = pushOut(u, f, 0);
  const b = pushOut(a[0], a[1], 1);
  // o empurrão pra baixo (alcance pra cima) pode abrir o braço de novo: mais uma passada pra fora
  return pushOut(b[0], b[1], 0);
}

/**
 * braço esquerdo da tela na convenção da dança (u, f: ver topo); o alcance é limitado por reachArm. As rotações saem
 * em (-180, 180]: a tabela pode dar voltas inteiras (o antebraço que sobe por dentro e desce por fora), e o palco, que
 * mistura a pose com o neutro na entrada, sempre gira pelo caminho curto.
 */
export function armL(p: Pose, u: number, f: number): void {
  'worklet';
  const a = reachArm(u, f);
  p.armL.r = wrap180(a[0] - HANG_U);
  p.foreL = { r: wrap180(a[1] - a[0] + HANG_BEND) };
}

/** braço direito da tela (espelho do esquerdo) */
export function armR(p: Pose, u: number, f: number): void {
  'worklet';
  const a = reachArm(u, f);
  p.armR.r = -wrap180(a[0] - HANG_U);
  p.foreR = { r: -wrap180(a[1] - a[0] + HANG_BEND) };
}

/** perna esquerda da tela: a = coxa pra fora, s = canela pra fora (absoluta) */
export function legL(p: Pose, a: number, s: number): void {
  'worklet';
  p.legL.r = a;
  p.shinL = { r: s - a };
}

/** perna direita da tela (espelho) */
export function legR(p: Pose, a: number, s: number): void {
  'worklet';
  p.legR.r = -a;
  p.shinR = { r: -(s - a) };
}

/**
 * canais de um quadro-chave, nesta ordem:
 * 0 uL · 1 fL · 2 uR · 3 fR (braços) · 4 aL · 5 sL · 6 aR · 7 sR (pernas) · 8 giro do tronco · 9 dx do tronco ·
 * 10 dy do tronco · 11 giro da cabeça
 */
export const CH = 12;

/** pose a partir dos 12 canais */
export function poseOf(c: readonly number[]): Pose {
  'worklet';
  const p = zero();
  armL(p, c[0], c[1]);
  armR(p, c[2], c[3]);
  legL(p, c[4], c[5]);
  legR(p, c[6], c[7]);
  p.body.r = c[8];
  p.body.dx = c[9];
  p.body.dy = c[10];
  p.head.r = c[11];
  return p;
}

/** progresso atrasado: sai depois de `lag` (0..1) e chega junto com o resto, com a mesma curva */
function lagged(m: number, lag: number, o: number): number {
  'worklet';
  const ml = lag > 0 ? clamp((m - lag) / (1 - lag), 0, 1) : m;
  return o > 0 ? snap(ml, o) : easeInOut(ml);
}

/**
 * quadros-chave cíclicos: o ciclo x (0..1) tem n casas; na casa i a pose sai do quadro i-1 e chega no quadro i durante
 * a fração `move` da casa (com passada `o`: 0 = suave, ~1 = trava seca) e segura o quadro i no resto da casa.
 * Atraso entre as juntas (o braço puxa e o antebraço vem atrás, como gente, e o braço reto não varre a horizontal
 * esticado): `lag` atrasa as canelas (canais 5 e 7) e, em tabela de 12 canais, os antebraços (1 e 3). Tabela de 14
 * canais traz o atraso de cada braço na troca pra aquele quadro (12 = esquerdo, 13 = direito): positivo = antebraço
 * atrasado, negativo = antebraço na frente (o braço é que espera). Devolve os canais (nunca muta a tabela).
 */
export function keyMix(keys: readonly (readonly number[])[], x: number, move: number, o: number, lag = 0): number[] {
  'worklet';
  const n = keys.length;
  const u = frac(x) * n;
  const i = Math.min(n - 1, Math.floor(u));
  const f = u - i;
  const a = keys[(i + n - 1) % n];
  const b = keys[i];
  const m = clamp(f / Math.max(1e-6, move), 0, 1);
  const e = lagged(m, 0, o);
  const out: number[] = [];
  if (a.length < 8) {
    for (let j = 0; j < a.length; j++) out.push(a[j] + (b[j] - a[j]) * e);
    return out;
  }
  const lL = b.length >= 14 ? b[12] : lag;
  const lR = b.length >= 14 ? b[13] : lag;
  const eShin = lagged(m, lag, o);
  for (let j = 0; j < 12; j++) {
    let w = e;
    if (j === 5 || j === 7) w = eShin;
    else if (j === 0 || j === 1) w = (j === 1) === (lL >= 0) ? lagged(m, Math.abs(lL), o) : e;
    else if (j === 2 || j === 3) w = (j === 3) === (lR >= 0) ? lagged(m, Math.abs(lR), o) : e;
    out.push(a[j] + (b[j] - a[j]) * w);
  }
  return out;
}

/** progresso k do meio da casa i (quadro i já parado), pra keyK */
export function keyHoldK(i: number, n: number, move: number): number {
  'worklet';
  return (i + move + (1 - move) * 0.5) / n;
}
