// Poses do esqueleto do avatar: tipo Pose, variação individual, pose neutra, blend, idle e easings.
// Fonte única pro mapa (images/anim.ts re-exporta), pro palco Skia (thread de UI) e pra folha de contato (node).
//
// TODAS as funções começam com a diretiva 'worklet': rodam na thread de UI pelo Reanimated, no JS do mapa e em node.
// Ângulos em graus (positivo = horário na tela, y pra baixo); deslocamentos em unidades do viewBox 100x140.

/** pose do rig. Campos opcionais ausentes valem 0 (escala ausente vale 1). */
export interface Pose {
  body: { r: number; dy: number; sx: number; sy: number; dx?: number };
  head: { r: number; dy: number };
  armL: { r: number };
  armR: { r: number };
  /** cotovelo esquerdo (relativo ao braço) */
  foreL?: { r: number };
  foreR?: { r: number };
  /** coxa: giro no quadril; sy = escorço da perna inteira no eixo dela (perna que sobe vista de frente; ausente = 1) */
  legL: { r: number; sy?: number };
  legR: { r: number; sy?: number };
  /** joelho esquerdo (relativo à coxa) */
  shinL?: { r: number };
  shinR?: { r: number };
  shadow: { s: number };
  /** veículo: sobe/desce e inclina em volta de rig.mount */
  mount?: { dy: number; r: number };
  /** pet: desloca, gira e escala em volta de rig.pet */
  pet?: { dx: number; dy: number; r: number; s: number };
}

/** variação individual (hash do id): fase 0..1, velocidade da respiração 0.85..1.15, energia 0.9..1.1 */
export interface PoseVariation {
  ph: number;
  sp: number;
  en: number;
}

export const TAU = Math.PI * 2;

/** variação neutra (sem defasagem) — prévia, editor, folha de contato */
export const NEUTRAL_VARIATION: PoseVariation = { ph: 0, sp: 1, en: 1 };

export function clamp(v: number, a: number, b: number): number {
  'worklet';
  return v < a ? a : v > b ? b : v;
}
export function lerp(a: number, b: number, k: number): number {
  'worklet';
  return a + (b - a) * k;
}
/** cúbica de saída */
export function easeOut(k: number): number {
  'worklet';
  return 1 - Math.pow(1 - clamp(k, 0, 1), 3);
}
/** cúbica de entrada */
export function easeIn(k: number): number {
  'worklet';
  const c = clamp(k, 0, 1);
  return c * c * c;
}
/** cúbica entrada/saída */
export function easeInOut(k: number): number {
  'worklet';
  k = clamp(k, 0, 1);
  return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
}
/** senoidal entrada/saída */
export function easeSine(k: number): number {
  'worklet';
  return 0.5 - 0.5 * Math.cos(Math.PI * clamp(k, 0, 1));
}
/** passa do ponto e volta (back out) */
export function easeBack(k: number): number {
  'worklet';
  const c = clamp(k, 0, 1) - 1;
  return 1 + 2.70158 * c * c * c + 1.70158 * c * c;
}
/** janela 0→1→0: sobe em [a, a+inW], fica em 1, desce em [b-outW, b] */
export function windowed(k: number, a: number, b: number, inW: number, outW: number): number {
  'worklet';
  if (k <= a || k >= b) return 0;
  const up = inW > 0 ? easeOut((k - a) / inW) : 1;
  const down = outW > 0 ? 1 - easeInOut((k - (b - outW)) / outW) : 1;
  return up * down;
}

/** pose neutra (mesmo formato do CZ_ANIM antigo; campos opcionais ficam ausentes) */
export function zero(): Pose {
  'worklet';
  return { body: { r: 0, dy: 0, sx: 1, sy: 1 }, head: { r: 0, dy: 0 }, armL: { r: 0 }, armR: { r: 0 }, legL: { r: 0 }, legR: { r: 0 }, shadow: { s: 1 } };
}

/** cópia profunda (as funções de pose mutam o objeto que recebem) */
export function clonePose(p: Pose): Pose {
  'worklet';
  const o: Pose = {
    body: { r: p.body.r, dy: p.body.dy, sx: p.body.sx, sy: p.body.sy },
    head: { r: p.head.r, dy: p.head.dy },
    armL: { r: p.armL.r },
    armR: { r: p.armR.r },
    legL: { r: p.legL.r },
    legR: { r: p.legR.r },
    shadow: { s: p.shadow.s },
  };
  if (p.body.dx !== undefined) o.body.dx = p.body.dx;
  if (p.legL.sy !== undefined) o.legL.sy = p.legL.sy;
  if (p.legR.sy !== undefined) o.legR.sy = p.legR.sy;
  if (p.foreL) o.foreL = { r: p.foreL.r };
  if (p.foreR) o.foreR = { r: p.foreR.r };
  if (p.shinL) o.shinL = { r: p.shinL.r };
  if (p.shinR) o.shinR = { r: p.shinR.r };
  if (p.mount) o.mount = { dy: p.mount.dy, r: p.mount.r };
  if (p.pet) o.pet = { dx: p.pet.dx, dy: p.pet.dy, r: p.pet.r, s: p.pet.s };
  return o;
}

// v = { ph: fase 0..1, sp: 0.85..1.15 (velocidade da respiração), en: 0.9..1.1 (energia) }
/** respiração + troca de apoio sutil (o idle do mapa, números do CZ_ANIM) */
export function idle(t: number, v: PoseVariation): Pose {
  'worklet';
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

/** só a respiração (sem troca de apoio): o "idle" do palco por cima de uma animação ou parado */
export function breathe(t: number, v: PoseVariation): Pose {
  'worklet';
  const p = zero();
  const w = t * (TAU / 2.6) * v.sp + v.ph * TAU;
  const b = Math.sin(w);
  p.body.sy = 1 + 0.012 * b;
  p.body.dy = -0.5 * b;
  p.head.dy = -0.4 * b;
  p.head.r = 1.2 * Math.sin(w * 0.5 + 0.6) * v.en;
  p.armL.r = 1.6 * b * v.en;
  p.armR.r = -1.6 * b * v.en;
  p.shadow.s = 1 + 0.02 * b;
  return p;
}

function opt(a: { r: number } | undefined, b: { r: number } | undefined, k: number): { r: number } {
  'worklet';
  return { r: lerp(a ? a.r : 0, b ? b.r : 0, k) };
}

/**
 * pose interpolada. k <= 0 devolve a própria a e k >= 1 a própria b (como no CZ_ANIM). Campo opcional ausente vale 0
 * (escala ausente vale 1) e só aparece no resultado se existir em a ou em b.
 */
export function blend(a: Pose, b: Pose, k: number): Pose {
  'worklet';
  if (k <= 0) return a;
  if (k >= 1) return b;
  const o: Pose = {
    body: { r: lerp(a.body.r, b.body.r, k), dy: lerp(a.body.dy, b.body.dy, k), sx: lerp(a.body.sx, b.body.sx, k), sy: lerp(a.body.sy, b.body.sy, k) },
    head: { r: lerp(a.head.r, b.head.r, k), dy: lerp(a.head.dy, b.head.dy, k) },
    armL: { r: lerp(a.armL.r, b.armL.r, k) },
    armR: { r: lerp(a.armR.r, b.armR.r, k) },
    legL: { r: lerp(a.legL.r, b.legL.r, k) },
    legR: { r: lerp(a.legR.r, b.legR.r, k) },
    shadow: { s: lerp(a.shadow.s, b.shadow.s, k) },
  };
  if (a.body.dx !== undefined || b.body.dx !== undefined) o.body.dx = lerp(a.body.dx ?? 0, b.body.dx ?? 0, k);
  if (a.legL.sy !== undefined || b.legL.sy !== undefined) o.legL.sy = lerp(a.legL.sy ?? 1, b.legL.sy ?? 1, k);
  if (a.legR.sy !== undefined || b.legR.sy !== undefined) o.legR.sy = lerp(a.legR.sy ?? 1, b.legR.sy ?? 1, k);
  if (a.foreL || b.foreL) o.foreL = opt(a.foreL, b.foreL, k);
  if (a.foreR || b.foreR) o.foreR = opt(a.foreR, b.foreR, k);
  if (a.shinL || b.shinL) o.shinL = opt(a.shinL, b.shinL, k);
  if (a.shinR || b.shinR) o.shinR = opt(a.shinR, b.shinR, k);
  if (a.mount || b.mount) {
    o.mount = { dy: lerp(a.mount ? a.mount.dy : 0, b.mount ? b.mount.dy : 0, k), r: lerp(a.mount ? a.mount.r : 0, b.mount ? b.mount.r : 0, k) };
  }
  if (a.pet || b.pet) {
    const pa = a.pet;
    const pb = b.pet;
    o.pet = {
      dx: lerp(pa ? pa.dx : 0, pb ? pb.dx : 0, k),
      dy: lerp(pa ? pa.dy : 0, pb ? pb.dy : 0, k),
      r: lerp(pa ? pa.r : 0, pb ? pb.r : 0, k),
      s: lerp(pa ? pa.s : 1, pb ? pb.s : 1, k),
    };
  }
  return o;
}

/**
 * soma `add` em cima de `base` (deltas: rotações e deslocamentos somam, escalas multiplicam). Devolve uma pose nova.
 * Uso típico: respiração do palco por cima do quadro da animação.
 */
export function addPose(base: Pose, add: Pose, w = 1): Pose {
  'worklet';
  const o = clonePose(base);
  o.body.r += add.body.r * w;
  o.body.dy += add.body.dy * w;
  o.body.sx *= 1 + (add.body.sx - 1) * w;
  o.body.sy *= 1 + (add.body.sy - 1) * w;
  if (add.body.dx) o.body.dx = (o.body.dx ?? 0) + add.body.dx * w;
  o.head.r += add.head.r * w;
  o.head.dy += add.head.dy * w;
  o.armL.r += add.armL.r * w;
  o.armR.r += add.armR.r * w;
  o.legL.r += add.legL.r * w;
  o.legR.r += add.legR.r * w;
  if (add.legL.sy !== undefined) o.legL.sy = (o.legL.sy ?? 1) * (1 + (add.legL.sy - 1) * w);
  if (add.legR.sy !== undefined) o.legR.sy = (o.legR.sy ?? 1) * (1 + (add.legR.sy - 1) * w);
  o.shadow.s *= 1 + (add.shadow.s - 1) * w;
  if (add.foreL) o.foreL = { r: (o.foreL ? o.foreL.r : 0) + add.foreL.r * w };
  if (add.foreR) o.foreR = { r: (o.foreR ? o.foreR.r : 0) + add.foreR.r * w };
  if (add.shinL) o.shinL = { r: (o.shinL ? o.shinL.r : 0) + add.shinL.r * w };
  if (add.shinR) o.shinR = { r: (o.shinR ? o.shinR.r : 0) + add.shinR.r * w };
  if (add.mount) o.mount = { dy: (o.mount ? o.mount.dy : 0) + add.mount.dy * w, r: (o.mount ? o.mount.r : 0) + add.mount.r * w };
  if (add.pet) {
    const p = o.pet ?? { dx: 0, dy: 0, r: 0, s: 1 };
    o.pet = { dx: p.dx + add.pet.dx * w, dy: p.dy + add.pet.dy * w, r: p.r + add.pet.r * w, s: p.s * (1 + (add.pet.s - 1) * w) };
  }
  return o;
}

/** true se todos os números da pose são finitos (testes e guarda do palco) */
export function poseIsFinite(p: Pose): boolean {
  'worklet';
  const n = [p.body.r, p.body.dy, p.body.sx, p.body.sy, p.body.dx ?? 0, p.head.r, p.head.dy, p.armL.r, p.armR.r, p.legL.r, p.legR.r, p.legL.sy ?? 1, p.legR.sy ?? 1, p.shadow.s];
  if (p.foreL) n.push(p.foreL.r);
  if (p.foreR) n.push(p.foreR.r);
  if (p.shinL) n.push(p.shinL.r);
  if (p.shinR) n.push(p.shinR.r);
  if (p.mount) n.push(p.mount.dy, p.mount.r);
  if (p.pet) n.push(p.pet.dx, p.pet.dy, p.pet.r, p.pet.s);
  for (let i = 0; i < n.length; i++) if (!Number.isFinite(n[i])) return false;
  return true;
}

/** 0..1 determinístico (FNV-1a de 32 bits sobre `str|salt`) */
export function hash01(str: string, salt?: string): number {
  'worklet';
  let h = 2166136261 >>> 0;
  const s = String(str) + '|' + (salt || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h >>> 8) / 16777216;
}

/** variação individual da pessoa (fase, respiração, energia) a partir do id */
export function variationFor(id: string): PoseVariation {
  'worklet';
  return { ph: hash01(id, 'ph'), sp: 0.85 + 0.3 * hash01(id, 'sp'), en: 0.9 + 0.2 * hash01(id, 'en') };
}
