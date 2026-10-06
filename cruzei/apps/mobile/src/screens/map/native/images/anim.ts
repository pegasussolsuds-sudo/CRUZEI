// Motor de poses dos avatares no mapa nativo: porta tipada e FIEL do CZ_ANIM (../../avatar-anim.ts, JS do WebView).
// Mesmos números e fórmulas — a figura tem de mexer exatamente como antes. Cada estado vira uma POSE (rotação/
// deslocamento por grupo do rig) calculada por tempo; quem desenha a pose é o draw.ts (drawPosed).
//
// A base (Pose, zero, blend, idle, easings, hash, variação) mora em src/avatar/pose.ts (mesma fonte do palco Skia e da
// folha de contato) e é re-exportada daqui. Funções com 'worklet' rodam também na thread de UI.
//
// Estados: idle | walk | run | wave | like | celebrate | match | arrive | ride | sig
// Transições: blend linear de BLEND_MS entre a pose anterior e a nova (sem cortes).
// Variação por pessoa: fase, velocidade da respiração, energia e tamanho vêm de um hash do id (ninguém é clone).
// Caminhada/corrida: passada de FRENTE (não é mais o compasso do CZ_ANIM, que abria e fechava as pernas juntas): as pernas
// alternam — a de apoio fica reta e a que avança encurta em escorço (legX.sy, o pé sobe) com o joelho levemente pra
// dentro; os braços balançam alternados e pouco, partindo do braço solto, sem trazer as mãos pro meio do corpo.
// ride: com veículo, andar vira deslizar — sem passada, balanço leve do veículo com o piloto junto; flutuante sobe e desce.
// sig: a animação assinatura do avatar (EmoteDef do registro), tocada uma vez.
// Braço solto (extras.rest = restArmDelta da pessoa): os estados que mexem os braços partem dele, como no palco; nos que
// tocam uma vez ele entra e sai em EDGE_S (a figura parada está no repouso dela: mão na cintura, no passante…). A
// assinatura inteira também entra e sai do repouso em EDGE_S (como o palco faz), sem salto no 1º e no último quadro.

import type { AvatarMountKind } from '@cruzei/shared-types';

import type { EmoteDef } from '../../../../avatar/emotes/types';
import { blend, clamp, easeInOut, easeOut, hash01, idle, TAU, zero, type Pose, type PoseVariation } from '../../../../avatar/pose';
import type { AnimState } from '../contracts';

export { blend, hash01, idle, variationFor, zero } from '../../../../avatar/pose';
export type { Pose, PoseVariation } from '../../../../avatar/pose';

/** duração (ms) do blend entre a pose anterior e a nova (mapbox-html.ts:447) */
export const BLEND_MS = 220;

/** duração (s) dos estados que acabam sozinhos; 0 = loop (sig: a duração vem do EmoteDef) */
export const DUR: Record<AnimState, number> = { idle: 0, walk: 0, run: 0, wave: 1.7, like: 0.9, celebrate: 1.6, match: 3.4, arrive: 0.6, ride: 0, sig: 0 };

/** estados em que a figura usa os braços (com veículo, os outros deixam as mãos no volante/guidão); sig: o do EmoteDef */
export const USES_ARMS: Record<AnimState, boolean> = { idle: false, walk: false, run: false, wave: true, like: true, celebrate: true, match: true, arrive: false, ride: false, sig: false };

/** entrada e saída (s) do braço solto nos estados que tocam uma vez */
export const EDGE_S = 0.25;

/** o que muda a pose além do estado e do tempo */
export interface AnimExtras {
  /** braço solto da pessoa [braço L, antebraço L, braço R, antebraço R] (mapAvatar.restArms) */
  rest?: readonly number[] | null;
  /** animação assinatura (estado 'sig') */
  sig?: EmoteDef | null;
  /** montaria (estado 'ride') e amplitude do balanço do flutuante (cena.bob) */
  mount?: AvatarMountKind | null;
  bob?: number;
}

/** parâmetros da passada de frente */
export interface GaitSpec {
  /** passos por segundo (um ciclo = dois passos) */
  freq: number;
  /** escorço máximo da perna que sobe (1 - sy no meio do passo) */
  lift: number;
  /** balanço lateral das coxas, mesmo sinal nas duas (graus) */
  sway: number;
  /** balanço alternado dos braços (graus, mesmo sinal nos dois) */
  arm: number;
  /** dobra do cotovelo (graus; + = mão pra dentro): fixa + a do braço que vai pra frente (pouca: de frente, mão no meio
   * do corpo lê "mão na virilha") */
  elbow: number;
  elbowSwing: number;
  /** inclinação do corpo pra frente do movimento (graus) e sobe-desce (unidades) */
  lean: number;
  bob: number;
}

export const WALK: GaitSpec = { freq: 0.95, lift: 0.09, sway: 2.2, arm: 3.5, elbow: 0, elbowSwing: 5, lean: 2, bob: 0.9 };
export const RUN: GaitSpec = { freq: 1.45, lift: 0.16, sway: 3, arm: 5, elbow: -4, elbowSwing: 9, lean: 5, bob: 1.6 };

export function gait(t: number, v: PoseVariation, g: GaitSpec): Pose {
  'worklet';
  const p = zero();
  const w = t * TAU * g.freq + v.ph * TAU;
  const s = Math.sin(w);
  const upL = Math.max(0, s); // perna esquerda no ar (a direita apoia)
  const upR = Math.max(0, -s);
  const up = Math.abs(s);
  // coxas: o peso passa pro pé de apoio (mesmo sinal nas duas: o quadril vai pro lado do apoio)
  p.legL.r = g.sway * s;
  p.legR.r = g.sway * s;
  // a perna que avança encurta (vista de frente, o pé sobe) e o joelho vai um pouco pra dentro; a de apoio fica reta
  p.legL.sy = 1 - g.lift * upL * upL;
  p.legR.sy = 1 - g.lift * upR * upR;
  p.shinL = { r: -5 * upL };
  p.shinR = { r: 5 * upR };
  // braços: o oposto da perna que avança vem pra frente (cotovelo dobra pra dentro, pouco); balanço pequeno
  p.armL.r = -g.arm * s;
  p.armR.r = -g.arm * s;
  p.foreL = { r: -(g.elbow + g.elbowSwing * upR) };
  p.foreR = { r: g.elbow + g.elbowSwing * upL };
  // tronco: inclina pro lado do apoio e pra frente do movimento; sobe no meio do passo (perna de apoio esticada)
  p.body.r = g.lean + 1.2 * s;
  p.body.dy = -g.bob * up;
  p.body.sy = 1 + 0.008 * up;
  p.head.r = -g.lean * 0.5 - 1.4 * s;
  p.head.dy = -0.3 * up;
  p.shadow.s = 1 - 0.05 * up;
  return p;
}
export function walk(t: number, v: PoseVariation): Pose {
  'worklet';
  return gait(t, v, { ...WALK, freq: WALK.freq * v.sp });
}
export function run(t: number, v: PoseVariation): Pose {
  'worklet';
  return gait(t, v, { ...RUN, freq: RUN.freq * v.sp });
}

// one-shots: k = progresso 0..1 (tempo / DUR)
export function wave(k: number, v: PoseVariation): Pose {
  'worklet';
  const p = idle(k * DUR.wave, v);
  const up = easeOut(k / 0.18) * (1 - easeInOut((k - 0.82) / 0.18)); // sobe rápido, desce no fim
  p.armR.r = -150 * up + 14 * Math.sin(k * DUR.wave * 11) * up;
  p.head.r += 5 * up;
  p.body.r += -2 * up;
  return p;
}
export function like(k: number, v: PoseVariation): Pose {
  'worklet';
  const p = idle(k * DUR.like, v);
  const hop = Math.sin(Math.PI * clamp(k / 0.7, 0, 1));
  p.body.dy += -7 * hop;
  p.body.sx = 1 + 0.05 * hop;
  p.body.sy = 1 - 0.04 * hop + 0.06 * Math.max(0, 1 - Math.abs(k - 0.72) / 0.12);
  p.armL.r += -35 * hop;
  p.armR.r += 35 * hop;
  p.head.dy += -1.5 * hop;
  p.shadow.s = 1 - 0.18 * hop;
  return p;
}
export function celebrate(k: number, v: PoseVariation): Pose {
  'worklet';
  const p = idle(k * DUR.celebrate, v);
  const jump = Math.abs(Math.sin(Math.PI * k * 2)) * (1 - easeInOut((k - 0.85) / 0.15));
  const arms = easeOut(k / 0.15) * (1 - easeInOut((k - 0.85) / 0.15));
  p.body.dy += -10 * jump;
  p.body.sy = 1 + 0.03 * jump;
  p.body.sx = 1 - 0.02 * jump;
  p.armL.r = 160 * arms + 8 * Math.sin(k * 30);
  p.armR.r = -160 * arms - 8 * Math.sin(k * 30);
  p.legL.r = -10 * jump;
  p.legR.r = 10 * jump;
  p.head.r = 4 * Math.sin(k * 20) * arms;
  p.shadow.s = 1 - 0.25 * jump;
  return p;
}
export function match(k: number, v: PoseVariation): Pose {
  'worklet';
  const p = idle(k * DUR.match, v);
  const inA = easeOut(k / 0.12);
  const outA = 1 - easeInOut((k - 0.88) / 0.12);
  const a = inA * outA;
  const sway = Math.sin(k * DUR.match * 5.5);
  p.armL.r = 150 * a + 10 * sway * a;
  p.armR.r = -150 * a - 10 * sway * a;
  p.body.dy += -3 * Math.abs(Math.sin(k * DUR.match * 4)) * a;
  p.body.r += 3 * sway * a;
  p.head.r += -6 * sway * a;
  p.shadow.s = 1 - 0.06 * a;
  return p;
}
export function arrive(k: number, v: PoseVariation): Pose {
  'worklet';
  const p = idle(k * DUR.arrive, v);
  const sq = Math.sin(Math.PI * clamp(k / 0.6, 0, 1));
  p.body.sy *= 1 - 0.08 * sq;
  p.body.sx *= 1 + 0.06 * sq;
  p.body.dy += 1.5 * sq;
  p.head.dy += 1 * sq;
  return p;
}

/** período (s) de um ciclo da montaria: no chão um balanço de 1,2 s; flutuando o sobe-e-desce de 2,4 s */
export function ridePeriod(kind: AvatarMountKind | null | undefined): number {
  'worklet';
  return kind === 'hover' ? 2.4 : 1.2;
}

/** montado e andando: desliza sem passada (as pernas ficam com a cena), balanço leve; flutuante sobe, desce e inclina */
export function ride(t: number, v: PoseVariation, kind: AvatarMountKind | null | undefined, bob: number): Pose {
  'worklet';
  const p = zero();
  const w = (t / ridePeriod(kind)) * TAU + v.ph * TAU;
  const s = Math.sin(w);
  const c = Math.cos(w);
  if (kind === 'hover') {
    const amp = bob > 0 ? bob : 1.6;
    p.mount = { dy: amp * s, r: amp * 0.6 * c };
    p.body.r = 1.2;
    p.head.r = -0.8 * c * v.en;
    p.shadow.s = 1 - 0.035 * amp * s;
    return p;
  }
  // o veículo (e o piloto, que herda o grupo 'mount') balança de leve; o corpo inclina pra frente, mais em pé na prancha
  p.mount = { dy: -0.35 * Math.abs(s), r: 0.7 * s };
  p.body.r = kind === 'stand' ? 3.5 : kind === 'seat' ? 1.5 : 2;
  p.body.dy = -0.3 * Math.abs(c);
  p.head.r = -1 - 0.8 * s * v.en;
  return p;
}

/** peso das bordas de um estado que toca uma vez: 0 no começo e no fim, 1 depois de EDGE_S */
export function edgeW(t: number, dur: number): number {
  'worklet';
  if (!(dur > 0)) return 1;
  return clamp(Math.min(t, dur - t) / EDGE_S, 0, 1);
}

/** a animação assinatura no tempo t (uma passada; k = t / dur) */
export function sigPose(def: EmoteDef, t: number, v: PoseVariation): Pose {
  'worklet';
  const k = clamp(t / def.dur, 0, 1);
  return def.pose(k, k * def.dur, v);
}

/** o estado mexe nos braços? (com volante/guidão/pet no colo, a cena segura as mãos dos que não mexem) */
export function usesArmsOf(state: AnimState, sig?: EmoteDef | null): boolean {
  'worklet';
  if (state === 'sig') return !!sig && sig.usesArms;
  return USES_ARMS[state];
}

/** soma o braço solto (rest) com peso w; muda p */
export function addRest(p: Pose, rest: readonly number[], w: number): Pose {
  'worklet';
  p.armL.r += rest[0] * w;
  p.foreL = { r: (p.foreL ? p.foreL.r : 0) + rest[1] * w };
  p.armR.r += rest[2] * w;
  p.foreR = { r: (p.foreR ? p.foreR.r : 0) + rest[3] * w };
  return p;
}

/**
 * pose de um estado no tempo t (s desde o início do estado); estado desconhecido = idle. Sem `x`, os estados antigos
 * dão exatamente a matemática do CZ_ANIM.
 */
export function pose(state: AnimState, t: number, v: PoseVariation, x?: AnimExtras): Pose {
  'worklet';
  let p: Pose;
  let w = 1;
  const sig = x ? x.sig : null;
  if (state === 'walk') p = walk(t, v);
  else if (state === 'run') p = run(t, v);
  else if (state === 'ride') p = ride(t, v, x ? x.mount : null, x && x.bob ? x.bob : 0);
  else if (state === 'sig') {
    if (!sig) return idle(t, v);
    w = edgeW(t, sig.dur);
    p = blend(zero(), sigPose(sig, t, v), w);
  } else {
    const d = DUR[state];
    const k = d > 0 ? clamp(t / d, 0, 1) : 0;
    if (state === 'wave') p = wave(k, v);
    else if (state === 'like') p = like(k, v);
    else if (state === 'celebrate') p = celebrate(k, v);
    else if (state === 'match') p = match(k, v);
    else if (state === 'arrive') p = arrive(k, v);
    else return idle(t, v);
    w = edgeW(t, d);
  }
  const rest = x ? x.rest : null;
  if (rest && rest.length === 4 && w > 0 && (state === 'walk' || state === 'run' || usesArmsOf(state, sig))) addRest(p, rest, w);
  return p;
}

/** fator de tamanho individual da figura, 0.96..1.04 (mapbox-html.ts:434) */
export function sizeFor(id: string): number {
  'worklet';
  return 0.96 + 0.08 * hash01(id, 'sz');
}
