// Calota do cabelo: contorno do crânio com volume, linha do cabelo (redonda, com entradas, bico, reta), costeleta, a
// passagem por cima da orelha, borda translúcida na têmpora e as mechas curtas (tufos) que giram do redemoinho.
// Dono: cabelo. Usado pelos curtos, presos e texturizados (hair-short.ts, hair-updo.ts, hair-textured.ts).
//
// Tudo na cabeça unitária (k.H): o crânio é quase uma elipse de centro (0, −4,4), rx = largura do crânio (k.Wc) e
// ry = 6,7 (topo em CROWN_DY = −11,1); linha do cabelo em −7,6; topo da orelha em k.earTop (≈ 0); a costeleta desce
// na frente da orelha.

import { smoothPath, taperPath, type SP } from '../anatomy';
import { mix } from '../shading';

import { foreheadShadow, lockSide, massGrad, paintLocks, ringSheen, rnd, saltPepper, shaved, spineSlice, type HairKit, type Lock } from './hair-kit';

export const SKULL_Y = -4.4;
export const SKULL_RY = 6.7;

/** ponto do crânio com volume: ângulo `a` em graus a partir do topo (positivo = direita da tela), `lift` pra fora */
export function skullPt(k: HairKit, a: number, lift: number, sideK = 1): SP {
  const r = (a * Math.PI) / 180;
  const rx = k.Wc + lift * sideK;
  const ry = SKULL_RY + lift;
  return k.H(Math.sin(r) * rx, SKULL_Y - Math.cos(r) * ry);
}

export interface HairlineOpts {
  /** y da linha do cabelo no meio (padrão −7,6) */
  hl?: number;
  /** entradas: 0 nenhuma … 1,6 bem fundas (as têmporas sobem e recuam) */
  recede?: number;
  /** bico de viúva (o meio desce em ponta) */
  peak?: number;
  /** base da costeleta (cabeça unitária; padrão: topo da orelha + 1,8) */
  sideburn?: number;
  /** costeleta mais fina (0..1, 1 = traço) */
  sbThin?: number;
}

/**
 * meia linha do cabelo do lado g (1 direita, −1 esquerda), do meio da testa até a base da costeleta e de volta pro
 * topo da orelha (de fora): pontos com quina onde a forma pede (base da costeleta, encaixe da orelha).
 */
export function hairlineHalf(k: HairKit, g: 1 | -1, o: HairlineOpts = {}): { front: SP[]; ear: SP[] } {
  const { H, Tm } = k;
  const hl = o.hl ?? -7.6;
  const rec = o.recede ?? 0;
  const peak = o.peak ?? 0;
  const sb = o.sideburn ?? k.earTop + 1.8;
  const thin = o.sbThin ?? 0;
  const X = (x: number) => g * x;
  const front: SP[] = [
    H(0, hl + peak),
    H(X(1.3 + peak * 0.3), hl + 0.05 - rec * 0.35 + peak * 0.25),
    H(X(3.2 - rec * 0.3), hl + 0.35 - rec * 1.25),
    // entrada: a têmpora sobe e recua em curva convexa (sem quina de "janela")
    H(X(4.9 - rec * 0.55), hl + 0.95 - rec * 1.55),
    H(X(Tm - 1.35 - rec * 0.2), -5.35 - rec * 0.75),
    H(X(Tm - 0.85), -3.6 - rec * 0.3),
    H(X(Tm - 0.75 + thin * 0.25), -1.4),
    H(X(Tm - 0.65 + thin * 0.35), sb - 0.35),
    // base da costeleta (corte reto, de leve inclinado)
    H(X(Tm - 0.2 + thin * 0.05), sb, 0),
  ];
  const ear: SP[] = [H(X(Tm + 0.1), k.earTop + 0.75), H(X(k.earX - 0.35), k.earTop - 0.3, 0), H(X(k.earX + 0.95), k.earTop - 0.05)];
  return { front, ear };
}

export interface CapOpts extends HairlineOpts {
  /** volume acima do crânio */
  lift: number;
  /** volume nas laterais (padrão 0,55 do lift) */
  side?: number;
  /** o lado de cima pende pra um lado (topete varrido): + direita */
  lean?: number;
  /** a calota cobre a orelha (chanel, longo): sem costeleta, desce até `coverY` */
  cover?: number;
}

/** contorno da calota (horário a partir do topo) e a borda do rosto (esquerda → direita) */
export function capOutline(k: HairKit, o: CapOpts): { pts: SP[]; d: string; edge: SP[] } {
  const lift = k.flat ? Math.min(o.lift, 0.2) : o.lift;
  const side = k.flat ? Math.min(o.side ?? lift * 0.55, 0.35) : (o.side ?? lift * 0.55);
  const lean = k.flat ? 0 : (o.lean ?? 0);
  const top = (g: 1 | -1): SP[] => {
    const L = (a: number) => lift + lean * g * Math.max(0, Math.cos((a * Math.PI) / 180)) * 0.5;
    return [skullPt(k, g * 22, L(22), 0.9), skullPt(k, g * 48, L(48) * 0.85 + side * 0.15), skullPt(k, g * 72, side * 0.9 + lift * 0.1), skullPt(k, g * 92, side)];
  };
  const R = hairlineHalf(k, 1, o);
  const Lh = hairlineHalf(k, -1, o);
  const sideDown = (g: 1 | -1): SP[] => [k.H(g * (k.Wc + side * 0.6 + 0.15), -1.4), k.H(g * (k.Wc + side * 0.35 + 0.35), k.earTop - 0.35)];
  const crown = skullPt(k, 0, lift + lean * 0.2);
  let pts: SP[];
  if (o.cover != null) {
    const cy = o.cover;
    const hlR = R.front.slice(0, 6);
    const hlL = Lh.front.slice(0, 6);
    const down = (g: 1 | -1): SP[] => [k.H(g * (k.Wc + side * 0.6 + 0.2), 0.5), k.H(g * (k.Ck + side * 0.4 + 0.5), cy - 1.2), k.H(g * (k.Ck + side * 0.2 - 0.6), cy, 0.6), k.H(g * (k.Tm - 0.9), cy - 2.0)];
    pts = [crown, ...top(1), ...down(1), ...hlR.slice().reverse(), ...hlL.slice(1), ...down(-1).reverse(), ...top(-1).reverse()];
    return { pts, d: smoothPath(pts), edge: [...hlL.slice().reverse(), ...hlR.slice(1)] };
  }
  pts = [crown, ...top(1), ...sideDown(1), ...R.ear.slice().reverse(), ...R.front.slice().reverse(), ...Lh.front.slice(1), ...Lh.ear, ...sideDown(-1).reverse(), ...top(-1).reverse()];
  return { pts, d: smoothPath(pts), edge: [...Lh.front.slice().reverse(), ...R.front.slice(1)] };
}

/**
 * borda translúcida da linha do cabelo: a pele aparece embaixo dos fios na têmpora (mais) e no meio da testa (menos),
 * fios finos atravessando a borda no sentido do crescimento. `edge` = borda do rosto (esquerda → direita).
 */
export function softHairline(k: HairKit, edge: readonly SP[], clip: string, o: { temple?: number; mid?: number; hairs?: boolean } = {}): void {
  const { ctx, t, lite } = k;
  // no 'lite' (sem desfoque) a faixa virava um tracejado claro serrilhado na testa (loiro), um "anel de boina" no black
  // power e riscos cinza nas têmporas (coque baixo): sai, junto com uma camada
  if (lite || edge.length < 3) return;
  const n = edge.length;
  const tmp = o.temple ?? 1;
  const mid = o.mid ?? 0.12;
  const ws = edge.map((_, i) => {
    const u = Math.abs(i / (n - 1) - 0.5) * 2;
    return (mid + (tmp - mid) * Math.pow(u, 1.4)) * 1.15 * k.s;
  });
  // pele com a cor da RAIZ (não da base/luz): no loiro a base clara dava uma borda branca
  ctx.push(taperPath(edge, ws, { n: Math.min(14, n * 2) }), mix(ctx.col.skin, t.root, 0.25), { o: 0.55, b: 0.35, cp: clip });
  if (o.hairs === false) return;
  // fios curtos saindo da borda pra dentro da pele (crescimento pra baixo e pra fora)
  const r = rnd(23);
  let d = '';
  for (let i = 1; i < n - 1; i++) {
    const p = edge[i];
    const q = edge[i + 1];
    for (let j = 0; j < 2; j++) {
      const u = r();
      const x = p[0] + (q[0] - p[0]) * u;
      const y = p[1] + (q[1] - p[1]) * u;
      const dir = Math.sign(x - k.cx) || 1;
      const L = (0.5 + r() * 0.5) * k.s;
      d += taperPath([[x - dir * 0.15, y - 0.35], [x + dir * L * 0.25, y + L * 0.45], [x + dir * L * 0.4, y + L * 0.95]], [0.16, 0.12, 0], { n: 5 });
    }
  }
  ctx.push(d, mix(t.base, t.root, 0.3), { o: 0.5 });
}

/** calota base: preenchimento com gradiente de volume e a sombra na testa */
export function paintCap(k: HairKit, cap: { d: string; edge: SP[] }, o: { tone?: string; shadow?: number; soft?: boolean } = {}): void {
  const { ctx, t, H, s, CR } = k;
  const tone = o.tone ?? t.base;
  if (o.shadow !== 0) foreheadShadow(k, cap.edge.slice(1, -1), o.shadow ?? 0.24, 1.4, 0.65);
  const c = H(-2.4, CR + 3);
  ctx.push(cap.d, tone, { gf: massGrad(k, [c[0], c[1]], 13.5 * s, tone, { hi: 0.4, lo: 0.9 }) });
}

// ---------------------------------------------------------------------------------------------------------------
// tufos (curtos): massas grandes com a ponta rendada
// ---------------------------------------------------------------------------------------------------------------

/** tufo: raiz, meio e ponta (cabeça unitária), largura, profundidade e quantas pontinhas no fim */
export interface Tuft {
  a: [number, number];
  m: [number, number];
  b: [number, number];
  w: number;
  z: number;
  /** pontinhas na ponta (1 = ponta única arredondada, 2–3 = rendada) */
  tips?: number;
  /** tom (positivo escurece) */
  dark?: number;
  /** ponta arredondada (franja) em vez de afinar */
  round?: boolean;
}

/** espelha tufos (x → −x) */
export function mirrorTufts(list: readonly Tuft[]): Tuft[] {
  return list.map((t) => ({ ...t, a: [-t.a[0], t.a[1]], m: [-t.m[0], t.m[1]], b: [-t.b[0], t.b[1]] }));
}

/** tufos → mechas do kit (a ponta rendada vira 2–3 mechinhas curtas abrindo em leque no fim) */
export function tuftLocks(k: HairKit, list: readonly Tuft[], scale = 1): Lock[] {
  const out: Lock[] = [];
  const r = rnd(61);
  for (const tf of list) {
    const A = k.H(tf.a[0], tf.a[1]);
    const M = k.H(tf.m[0], tf.m[1]);
    const B = k.H(tf.b[0], tf.b[1]);
    const q = (u: number): SP => {
      const v = 1 - u;
      return [v * v * A[0] + 2 * v * u * M[0] + u * u * B[0], v * v * A[1] + 2 * v * u * M[1] + u * u * B[1]];
    };
    const w = tf.w * k.s * scale;
    const spine = [q(0), q(0.3), q(0.62), q(0.86), B];
    const tips = tf.tips ?? 1;
    const g = Math.sign(B[0] - A[0]) || 1;
    if (tips <= 1) {
      // ponta arredondada = ogiva macia (nunca gota/bolinha); ponta comum afina até sumir
      out.push({ spine, w: tf.round ? [w * 0.5, w, w * 0.85, w * 0.45, w * 0.1] : [w * 0.5, w, w * 0.9, w * 0.5, 0], z: tf.z, g, dark: tf.dark });
      continue;
    }
    // corpo até ~80% e as pontinhas a partir de ~62%, abrindo pros lados do eixo
    out.push({ spine: spine.slice(0, 4), w: [w * 0.5, w, w * 0.95, w * 0.7], z: tf.z, g, dark: tf.dark });
    const tx = B[0] - q(0.7)[0];
    const ty = B[1] - q(0.7)[1];
    const L = Math.hypot(tx, ty) || 1;
    const nx = -ty / L;
    const ny = tx / L;
    for (let i = 0; i < tips; i++) {
      const f = tips === 2 ? (i ? 0.5 : -0.5) : i - 1;
      const len = 1 + (r() - 0.5) * 0.35 - Math.abs(f) * 0.12;
      const sp: SP[] = [q(0.6), [q(0.78)[0] + nx * f * w * 0.18, q(0.78)[1] + ny * f * w * 0.18], [B[0] + nx * f * w * 0.42 + tx * (len - 1), B[1] + ny * f * w * 0.42 + ty * (len - 1)]];
      const wt = (w / tips) * 1.25;
      out.push({ spine: sp, w: [wt, wt * 0.8, tf.round ? wt * 0.14 : 0], z: tf.z, g, dark: tf.dark });
    }
  }
  return out;
}

/**
 * pinta tufos por profundidade (sombra na de baixo, gradiente de volume, fresta e luz de borda do kit), depois a faixa
 * de brilho que acompanha o crânio cruzando os tufos e o sal e pimenta. Devolve o path de tudo.
 */
export function paintTufts(k: HairKit, list: readonly Tuft[], o: { under?: string; sheenY?: number; sheenO?: number; seed?: number; scale?: number } = {}): string {
  const { t, H, s, CR, Wc } = k;
  const locks = tuftLocks(k, list, o.scale);
  const c = H(-2.4, CR + 3);
  const p = paintLocks(k, locks, {
    under: o.under,
    grad: (tone) => massGrad(k, [c[0], c[1]], 13 * s, tone, { hi: 0.45, lo: 0.85 }),
    rim: 'all',
    creviceRange: [0.18, 0.8],
    shadowO: 0.38,
    depthDark: 0.12,
    rimO: t.pale ? 0.18 : 0.4,
    creviceO: t.pale ? 0.55 : 0.46,
  });
  // faixa de brilho: anel em volta do crânio (mais alto no lado da luz)
  const sy = o.sheenY ?? 2.6;
  const ring = (x: number) => {
    const u = (x - k.cx) / ((Wc + 1) * s);
    return H(0, CR + sy)[1] + (u * u * 3.2 + u * 0.6) * s;
  };
  if (!k.lite) {
    // pontas pegam luz (o fio afina e clareia no fim)
    const tipL = locks.map((l) => taperPath(spineSlice(l.spine, 0.55, 0.97, 5), [0, Math.max(...l.w) * 0.32, Math.max(...l.w) * 0.22, 0], { n: 6 })).join('');
    k.ctx.push(tipL, t.lock, { o: t.pale ? 0.3 : 0.38, b: 0.25, cp: p.all });
  }
  ringSheen(k, locks.map((l) => ({ spine: l.spine, w: Math.max(...l.w) })), ring, { len: 0.2, wk: 0.32, o: (o.sheenO ?? 1) * (t.pale ? 0.55 : 0.66), seed: o.seed ?? 5, pair: true });
  // grisalho: 2 fios por tufo (um escuro e um claro na média), pra o cinza ter variação de valor
  saltPepper(k, [...locks.map((l) => l.spine), ...locks.map((l) => lockSide(l.spine, Math.max(...l.w) * 0.22))], p.all, (o.seed ?? 5) + 7);
  return p.all;
}

// ---------------------------------------------------------------------------------------------------------------
// texturas de apoio: cabelo bem curto, risca, raspado com caixa
// ---------------------------------------------------------------------------------------------------------------

/** caixa (avatar) da calota, pra texturas */
export function capBox(k: HairKit, lift = 1): { x: number; y: number; w: number; h: number } {
  const a = k.H(-(k.Wc + lift + 0.5), k.CR - lift - 0.5);
  const b = k.H(k.Wc + lift + 0.5, k.earTop + 2.2);
  return { x: a[0], y: a[1], w: b[0] - a[0], h: b[1] - a[1] };
}

/**
 * cabelo bem curto (máquina alta, entradas, topo ralo): traços curtos que saem do redemoinho (fluxo radial), escuros
 * no lado da sombra e claros no da luz, num path de cada cor; `keep` filtra a região (avatar)
 */
export function cropTexture(k: HairKit, clip: string, o: { whorl?: [number, number]; gap?: number; len?: number; o?: number; seed?: number; keep?: (x: number, y: number) => boolean } = {}): void {
  const { ctx, t, lite, H, s } = k;
  if (lite) return;
  const W = H(...(o.whorl ?? [1.2, -10.6]));
  const box = capBox(k, 0.6);
  const gap = (o.gap ?? 0.85) * s;
  const r = rnd(o.seed ?? 71);
  let dk = '';
  let lt = '';
  let row = 0;
  for (let y = box.y; y < box.y + box.h; y += gap * 0.8, row++) {
    for (let x = box.x + (row % 2 ? gap * 0.5 : 0); x < box.x + box.w; x += gap) {
      const px = x + (r() - 0.5) * gap * 0.7;
      const py = y + (r() - 0.5) * gap * 0.7;
      if (o.keep && !o.keep(px, py)) continue;
      let dx = px - W[0];
      let dy = py - W[1];
      const L = Math.hypot(dx, dy) || 1;
      dx /= L;
      dy /= L;
      // perto do rosto o fio vira pra frente/baixo
      dy = dy * 0.8 + 0.3;
      const len = (o.len ?? 0.9) * s * (0.7 + r() * 0.6);
      const seg = `M${(px - dx * len * 0.5).toFixed(2)},${(py - dy * len * 0.5).toFixed(2)}l${(dx * len).toFixed(2)},${(dy * len).toFixed(2)}`;
      // lado da luz (cima/esquerda) ganha mais fios claros
      const lit = (px - k.cx) / (k.Wc * s) + (py - H(0, -8)[1]) / (6 * s) < 0.1 ? 0.55 : 0.2;
      if (r() < lit) lt += seg;
      else dk += seg;
    }
  }
  const a = o.o ?? 1;
  if (dk) ctx.stroke(dk, t.pale ? t.deep : t.root, 0.2 * s, { o: (t.pale ? 0.42 : 0.5) * a, cp: clip });
  if (lt) ctx.stroke(lt, t.pale ? mix(t.base, '#FFFFFF', 0.4) : t.lock, 0.18 * s, { o: (t.pale ? 0.5 : 0.45) * a, cp: clip });
}

/** risca: fresta fina de pele com sombra de raiz dos dois lados, de (x, y0) até (x2, y1) na cabeça unitária */
export function partLine(k: HairKit, clip: string, x: number, y0: number, x2: number, y1: number): void {
  const { ctx, t, lite, H, s } = k;
  const a = H(x, y0);
  const b = H(x2, y1);
  const m: SP = [(a[0] + b[0]) / 2 + 0.1 * s, (a[1] + b[1]) / 2];
  ctx.push(taperPath([a, m, b], [0.4 * s, 1.3 * s, 0.3 * s]), t.root, { o: 0.55, ...(lite ? {} : { b: 0.3 }), cp: clip });
  if (!k.flat) ctx.push(taperPath([a, m, b], [0.24 * s, 0.18 * s, 0.04]), mix(ctx.col.skin, t.root, 0.3), { o: 0.8 });
}

/** raspado na calota (ou num pedaço dela, recortado em `only`) com a caixa de textura */
export function shavedArea(k: HairKit, d: string, o: { density?: number; fadeY0?: number; fadeY1?: number; seed?: number; fromX?: number } = {}): void {
  const box = capBox(k, 0.4);
  if (o.fromX == null) {
    shaved(k, d, { ...o, box });
    return;
  }
  // sÃ³ do x `fromX` (avatar) pra direita: o preenchimento Ã© o retÃ¢ngulo recortado na calota
  const x0 = o.fromX;
  const rect = `M${x0.toFixed(2)},0H100V140H${x0.toFixed(2)}Z`;
  shaved(k, rect, { ...o, clip: d, box: { x: x0, y: box.y, w: box.x + box.w - x0, h: box.h } });
}
