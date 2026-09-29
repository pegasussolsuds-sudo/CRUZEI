// Motor de poses dos avatares no mapa nativo: porta tipada e FIEL do CZ_ANIM (../../avatar-anim.ts, JS do WebView).
// Mesmos números e fórmulas — a figura tem de mexer exatamente como antes. Cada estado vira uma POSE (rotação/
// deslocamento por grupo do rig) calculada por tempo; quem desenha a pose é o draw.ts (drawPosed).
//
// Estados: idle | walk | run | wave | like | celebrate | match | arrive
// Transições: blend linear de BLEND_MS entre a pose anterior e a nova (sem cortes).
// Variação por pessoa: fase, velocidade da respiração, energia e tamanho vêm de um hash do id (ninguém é clone).

import type { AnimState, Pose, PoseVariation } from '../contracts';

const TAU = Math.PI * 2;

/** duração (ms) do blend entre a pose anterior e a nova (mapbox-html.ts:447) */
export const BLEND_MS = 220;

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}
function easeOut(k: number): number {
  return 1 - Math.pow(1 - clamp(k, 0, 1), 3);
}
function easeInOut(k: number): number {
  k = clamp(k, 0, 1);
  return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
}

/** 0..1 determinístico (FNV-1a de 32 bits sobre `str|salt`) */
export function hash01(str: string, salt?: string): number {
  let h = 2166136261 >>> 0;
  const s = String(str) + '|' + (salt || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 8) / 16777216;
}

/** duração (s) dos estados que acabam sozinhos; 0 = loop */
export const DUR: Record<AnimState, number> = { idle: 0, walk: 0, run: 0, wave: 1.7, like: 0.9, celebrate: 1.6, match: 3.4, arrive: 0.6 };

/** pose neutra */
export function zero(): Pose {
  return { body: { r: 0, dy: 0, sx: 1, sy: 1 }, head: { r: 0, dy: 0 }, armL: { r: 0 }, armR: { r: 0 }, legL: { r: 0 }, legR: { r: 0 }, shadow: { s: 1 } };
}

// v = { ph: fase 0..1, sp: 0.85..1.15 (velocidade da respiração), en: 0.9..1.1 (energia) }
export function idle(t: number, v: PoseVariation): Pose {
  const p = zero();
  const w = t * (TAU / 2.6) * v.sp + v.ph * TAU;
  const b = Math.sin(w);
  p.body.sy = 1 + 0.012 * b;
  p.body.dy = -0.5 * b;
  p.head.r = 1.6 * Math.sin(w * 0.5 + 0.6) * v.en;
  p.head.dy = -0.4 * b;
  p.armL.r = 2.2 * b * v.en;
  p.armR.r = -2.2 * b * v.en;
  // troca de apoio (sutil) a cada ~7 s
  const sw = Math.sin(t * (TAU / 7.3) + v.ph * 9);
  p.body.r = 1.4 * sw * sw * sw;
  p.legL.r = -1.2 * sw;
  p.legR.r = 1.2 * sw;
  p.shadow.s = 1 + 0.02 * b;
  return p;
}

export function gait(t: number, v: PoseVariation, freq: number, amp: number, lean: number): Pose {
  const p = zero();
  const w = t * TAU * freq + v.ph * TAU;
  const s = Math.sin(w);
  const c = Math.cos(w);
  p.legL.r = amp * s;
  p.legR.r = -amp * s;
  p.armL.r = -amp * 0.8 * s;
  p.armR.r = amp * 0.8 * s;
  const bob = Math.abs(c);
  p.body.dy = -2.2 * bob * (amp / 28);
  p.body.r = lean;
  p.body.sy = 1 + 0.01 * bob;
  p.head.r = -lean * 0.5 - 2 * s * (amp / 28);
  p.head.dy = -0.6 * bob;
  p.shadow.s = 1 - 0.06 * bob;
  return p;
}
export function walk(t: number, v: PoseVariation): Pose {
  return gait(t, v, 1.9 * v.sp, 28, 3);
}
export function run(t: number, v: PoseVariation): Pose {
  return gait(t, v, 2.9 * v.sp, 40, 9);
}

// one-shots: k = progresso 0..1 (tempo / DUR)
export function wave(k: number, v: PoseVariation): Pose {
  const p = idle(k * DUR.wave, v);
  const up = easeOut(k / 0.18) * (1 - easeInOut((k - 0.82) / 0.18)); // sobe rápido, desce no fim
  p.armR.r = -150 * up + 14 * Math.sin(k * DUR.wave * 11) * up;
  p.head.r += 5 * up;
  p.body.r += -2 * up;
  return p;
}
export function like(k: number, v: PoseVariation): Pose {
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
  const p = idle(k * DUR.arrive, v);
  const sq = Math.sin(Math.PI * clamp(k / 0.6, 0, 1));
  p.body.sy *= 1 - 0.08 * sq;
  p.body.sx *= 1 + 0.06 * sq;
  p.body.dy += 1.5 * sq;
  p.head.dy += 1 * sq;
  return p;
}

const ONE: Partial<Record<AnimState, (k: number, v: PoseVariation) => Pose>> = { wave, like, celebrate, match, arrive };

/** pose de um estado no tempo t (s desde o início do estado); estado desconhecido = idle */
export function pose(state: AnimState, t: number, v: PoseVariation): Pose {
  if (state === 'walk') return walk(t, v);
  if (state === 'run') return run(t, v);
  const one = ONE[state];
  if (one) return one(clamp(t / DUR[state], 0, 1), v);
  return idle(t, v);
}

function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k;
}
/** pose interpolada (k <= 0 devolve a própria a; k >= 1 a própria b, como no original) */
export function blend(a: Pose, b: Pose, k: number): Pose {
  if (k <= 0) return a;
  if (k >= 1) return b;
  return {
    body: { r: lerp(a.body.r, b.body.r, k), dy: lerp(a.body.dy, b.body.dy, k), sx: lerp(a.body.sx, b.body.sx, k), sy: lerp(a.body.sy, b.body.sy, k) },
    head: { r: lerp(a.head.r, b.head.r, k), dy: lerp(a.head.dy, b.head.dy, k) },
    armL: { r: lerp(a.armL.r, b.armL.r, k) },
    armR: { r: lerp(a.armR.r, b.armR.r, k) },
    legL: { r: lerp(a.legL.r, b.legL.r, k) },
    legR: { r: lerp(a.legR.r, b.legR.r, k) },
    shadow: { s: lerp(a.shadow.s, b.shadow.s, k) },
  };
}

/** variação individual da pessoa (mapbox-html.ts:433) */
export function variationFor(id: string): PoseVariation {
  return { ph: hash01(id, 'ph'), sp: 0.85 + 0.3 * hash01(id, 'sp'), en: 0.9 + 0.2 * hash01(id, 'en') };
}
/** fator de tamanho individual da figura, 0.96..1.04 (mapbox-html.ts:434) */
export function sizeFor(id: string): number {
  return 0.96 + 0.08 * hash01(id, 'sz');
}
