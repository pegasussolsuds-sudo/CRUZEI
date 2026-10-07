// Kit do cabelo: tons, referencial da cabeça unitária, mechas com profundidade, brilho anelar (anisotrópico), sombra na
// testa, raspado, tranças, twists, locs, cachos e microcachos. Dono: cabelo. Usado por parts/hair*.ts.
//
// Método (STYLE.md §4, receitas de cabelo):
//   - tudo em coordenadas da CABEÇA UNITÁRIA (H(x, y) = centro da cabeça + (x, y)·escala): o cabelo acompanha o formato do
//     rosto e a escala da cabeça; abaixo do queixo, as âncoras do corpo (pescoço, linha do ombro, axila);
//   - massa grande primeiro (silhueta e valor), depois a separação das mechas (frestas escuras recortadas), luz de
//     borda e por último o BRILHO ANELAR: traços curtos alinhados aos fios, todos no ponto em que cada mecha cruza uma
//     curva que acompanha a cabeça — juntos formam uma faixa que atravessa as mechas (nunca riscos paralelos);
//   - sombra do cabelo na testa recortada na cabeça; oclusão no pescoço e na roupa recortada no corpo;
//   - nada de Math.random: sementes fixas (rnd).

import { CROWN_DY, headAnchors, sampleSpline, smoothPath, taperPath, torsoProfile, type Anatomy, type HeadAnchors, type SP } from '../anatomy';
import type { LayerCtx } from '../ctx';
import { isLite, isTiny, lodCtx, lum, mix, saturate } from '../shading';
import type { AvatarGradient, AvatarLayer, Pt } from '../types';

import { hatModeOf, type HatMode } from './hat-modes';

// ---------------------------------------------------------------------------------------------------------------
// tons
// ---------------------------------------------------------------------------------------------------------------

export interface HairTones {
  /** raiz (perto do couro cabeludo) */
  root: string;
  base: string;
  /** pontas (um pouco mais claras) */
  tip: string;
  /** brilho anelar */
  sheen: string;
  /** frestas e oclusão */
  deep: string;
  /** mecha clara (um passo acima da base) */
  lock: string;
  /** fio escuro (sal e pimenta, grisalho) */
  pepper: string;
  /** cabelo bem claro (branco, platinado, prateado, loiro claro): textura mais suave, sem halo escuro */
  pale: boolean;
  /** grisalho/prateado/branco: brilho frio e variação de valor */
  gray: boolean;
  /** quanto o cabelo mistura fios escuros (0 nenhum · 1 sal e pimenta forte) */
  salt: number;
  /** cor da sombra que o cabelo projeta na pele */
  cast: string;
}

const toneCache = new Map<string, HairTones>();

function chroma(c: string): number {
  const h = c.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
}

export function hairTones(c: string): HairTones {
  const hit = toneCache.get(c);
  if (hit) return hit;
  const L = lum(c);
  const ch = chroma(c);
  const gray = ch < 0.09 && L > 0.05;
  const pale = L > 0.42;
  const fantasy = ch > 0.42;
  // sal e pimenta: grisalho médio mistura muito fio escuro; prateado/branco só um pouco; grafite quase nada
  const salt = gray ? (L > 0.6 ? 0.25 : L > 0.15 ? 0.8 : 0.35) : 0;
  const sheen = gray
    ? mix(c, '#F6FAFF', L > 0.5 ? 0.7 : 0.55)
    : fantasy
      ? mix(saturate(c, -0.15), '#FFFFFF', 0.55)
      : L < 0.03
        ? mix(c, '#C9D6FF', 0.3)
        : L > 0.35
          ? mix(c, '#FFFBF0', 0.55)
          : mix(c, '#FFE6C4', 0.4);
  const out: HairTones = {
    root: gray ? mix(c, '#22252E', L > 0.5 ? 0.3 : 0.38) : mix(c, '#0A0608', pale ? 0.24 : L < 0.03 ? 0.2 : 0.34),
    base: c,
    tip: mix(c, '#FFFFFF', pale ? 0.12 : 0.1),
    sheen,
    deep: gray ? mix(c, '#2A2D38', L > 0.5 ? 0.55 : 0.62) : pale ? mix(c, '#4A3A40', 0.5) : mix(c, '#05030A', L < 0.03 ? 0.45 : 0.58),
    lock: mix(c, sheen, 0.32),
    pepper: gray ? mix(c, '#24262C', L > 0.5 ? 0.5 : 0.55) : mix(c, '#05030A', 0.4),
    pale,
    gray,
    salt,
    cast: pale ? mix(c, '#3A2A28', 0.75) : '#1A0A08',
  };
  if (toneCache.size > 64) toneCache.clear();
  toneCache.set(c, out);
  return out;
}

/**
 * tons no 'lite' (miniatura, mapa): cabelo quase preto (preto, castanho-escuro) some no fundo escuro do círculo e do
 * mapa — medido no S23, o topo do black power (29,29,39) contra o círculo (26,26,46). A base clareia pra um grafite frio
 * e o brilho fica mais claro e azulado; a silhueta volta a ler sem mudar a cor percebida.
 */
const liteCache = new Map<string, HairTones>();
function liteTones(c: string): HairTones {
  const t = hairTones(c);
  if (lum(c) >= 0.03) return t;
  const hit = liteCache.get(c);
  if (hit) return hit;
  // preto neutro clareia pra grafite; castanho-escuro clareia no próprio matiz (quente) — não vira cinza. Metade do
  // clareado de antes (0,2 azulado): o afro preto ficava empoeirado/grisalho no mapa e nas listas e mais escuro no
  // Perfil; quem segura a leitura no fundo escuro é o brilho (sheen), que fica
  const neutral = chroma(c) < 0.06;
  const base = neutral ? mix(c, '#6A6E7A', 0.1) : mix(c, '#B08A6E', 0.08);
  const sheen = neutral ? mix(c, '#D4DEFF', 0.42) : mix(c, '#FFE6C4', 0.45);
  const out: HairTones = { ...t, base, tip: mix(base, '#FFFFFF', 0.08), sheen, lock: mix(base, sheen, 0.4), root: mix(base, '#0A0608', 0.3) };
  liteCache.set(c, out);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// referencial
// ---------------------------------------------------------------------------------------------------------------

export interface HairKit {
  /** contexto já com nível de detalhe (lodCtx) */
  ctx: LayerCtx;
  an: Anatomy;
  ha: HeadAnchors;
  lite: boolean;
  /** figura minúscula (mapa): sem sombra entre camadas de mecha, microcachos nem sombra no corpo (shading.isTiny) */
  tiny: boolean;
  t: HairTones;
  /** cabeça unitária → avatar */
  H: (x: number, y: number, sm?: number) => SP;
  /** avatar → cabeça unitária */
  U: (p: Pt | SP) => Pt;
  /** escala da cabeça (larguras em unidades da cabeça multiplicam por isto) */
  s: number;
  cx: number;
  cy: number;
  /** medidas do rosto (cabeça unitária, já com a idade) */
  Wc: number;
  Tm: number;
  Ck: number;
  cheekY: number;
  Jw: number;
  jawY: number;
  chinY: number;
  chinW: number;
  CR: number;
  /** orelha (cabeça unitária): x do centro, y do centro, topo e base */
  earX: number;
  earY: number;
  earTop: number;
  earBot: number;
  /** modo do chapéu (hat-modes.ts) */
  mode: HatMode;
  /** chapéu cobre o topo da cabeça (cap/brim): o cabelo achata (sem volume acima do crânio) */
  flat: boolean;
  /** franja pode aparecer na testa (sem chapéu, faixa/coroa; boné e boinas — gorro, durag e aba não) */
  fringe: boolean;
  /** corpo: meia-largura do pescoço, linha dos ombros, axila e gola */
  nk: number;
  shY: number;
  ay: number;
  collarY: number;
  /** variação fina da pessoa (0..1, pelo rosto): comprimentos e pontas mudam um pouco de uma pessoa pra outra */
  v: number;
}

const FRINGE_BLOCKERS = new Set(['beanie', 'durag']);

/** id curto e determinístico da pessoa (traços do rosto) */
function personSeed(ctx: LayerCtx): number {
  const c = ctx.cfg;
  const key = `${c.faceShape ?? ''}|${c.eyes ?? ''}|${c.nose ?? ''}|${c.brows ?? ''}|${c.body ?? ''}`;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return ((h >>> 8) & 0xffff) / 0xffff;
}

export function makeKit(ctxIn: LayerCtx, color?: string, o: { bustBlur?: boolean } = {}): HairKit {
  const ctx = lodCtx(ctxIn, o);
  const an = ctx.an;
  const { cx, cy, s } = an.head;
  const ha = headAnchors(an);
  const f = an.face;
  const age = an.feat.age;
  // a mesma correção de idade do agedFace (anatomy.ts): o cabelo acompanha a maçã e a mandíbula
  const Ck = f.cheek - 0.2 * age;
  const Tm = f.temple - 0.1 * age;
  const jawY = f.jawY + 0.2 * age;
  const H = (x: number, y: number, sm?: number): SP => (sm == null ? [cx + x * s, cy + y * s] : [cx + x * s, cy + y * s, sm]);
  const U = (p: Pt | SP): Pt => [(p[0] - cx) / s, (p[1] - cy) / s];
  const e = U(ha.earR);
  const earK = 0.9 * (1 + age * 0.07);
  const mode = hatModeOf(ctx.cfg.hat);
  const flat = mode === 'cap' || mode === 'brim';
  const lite = isLite(ctx);
  return {
    ctx,
    an,
    ha,
    lite,
    tiny: isTiny(ctx),
    t: lite ? liteTones(color ?? ctx.col.hair) : hairTones(color ?? ctx.col.hair),
    H,
    U,
    s,
    cx,
    cy,
    Wc: f.cranium,
    Tm,
    Ck,
    cheekY: f.cheekY,
    Jw: f.jaw,
    jawY,
    chinY: f.chinY,
    chinW: f.chinW,
    CR: CROWN_DY,
    earX: e[0],
    earY: e[1],
    earTop: e[1] - 3.2 * earK,
    earBot: e[1] + 3.3 * earK,
    mode,
    flat,
    fringe: mode === 'none' || mode === 'band' || mode === 'crown' || (mode === 'cap' && !FRINGE_BLOCKERS.has(ctx.cfg.hat)),
    nk: an.w.neck,
    shY: an.shoulderY,
    ay: an.armpitY,
    collarY: an.collarY,
    v: personSeed(ctx),
  };
}

/** y da linha de cima do ombro (trapézio → acrômio) num x do avatar, do lado g (1 direita da tela, −1 esquerda) */
export function shoulderTop(an: Anatomy, g: 1 | -1, x: number): number {
  const p = torsoProfile(an, g > 0 ? 'R' : 'L').slice(0, 6);
  const d = Math.abs(x - an.cx);
  const ds = p.map((q) => Math.abs(q[0] - an.cx));
  if (d <= ds[0]) return p[0][1];
  for (let i = 1; i < p.length; i++) {
    if (d <= ds[i]) {
      const t = (d - ds[i - 1]) / (ds[i] - ds[i - 1] || 1);
      return p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t;
    }
  }
  return p[p.length - 1][1] + (d - ds[ds.length - 1]) * 0.5;
}

/** ponto que pousa no ombro (centro da mecha uma fração da espessura acima da pele) */
export function onShoulder(k: HairKit, g: 1 | -1, dx: number, lift = 0.5): SP {
  const x = k.cx + g * dx;
  return [x, shoulderTop(k.an, g, x) - lift];
}

/** recorte "corpo" (tronco + pescoço em repouso) pra sombra de mecha na roupa nunca cair no fundo */
export function bodyClip(k: HairKit): string {
  const an = k.an;
  const L = torsoProfile(an, 'L').slice(0, 8);
  const R = torsoProfile(an, 'R').slice(0, 8);
  const top = k.H(0, k.jawY)[1];
  const pts: SP[] = [[an.cx - an.w.neck + 0.3, top], ...L, [L[L.length - 1][0], an.armpitY + 18], [R[R.length - 1][0], an.armpitY + 18], ...R.slice().reverse(), [an.cx + an.w.neck - 0.3, top]];
  return smoothPath(pts, true, 0.6);
}

// ---------------------------------------------------------------------------------------------------------------
// utilidades de traço
// ---------------------------------------------------------------------------------------------------------------

/** 0..1 determinístico */
export function rnd(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
    return (s >>> 8) / 16777216;
  };
}

/** ponto numa curva quadrática a→c→b (t 0..1) */
export function qAt(a: SP, c: SP, b: SP, t: number): SP {
  const m = 1 - t;
  return [m * m * a[0] + 2 * m * t * c[0] + t * t * b[0], m * m * a[1] + 2 * m * t * c[1] + t * t * b[1]];
}

/** eixo em 4 pontos por uma quadrática (mecha curta, tufo, fio) */
export function qSpine(a: SP, c: SP, b: SP, n = 4): SP[] {
  const out: SP[] = [];
  for (let i = 0; i < n; i++) out.push(qAt(a, c, b, i / (n - 1)));
  return out;
}

/** desloca o eixo `k` pro lado da LUZ (esquerda/cima da tela); negativo vai pro lado da sombra */
export function lockSide(sp: readonly SP[], k: number): SP[] {
  return sp.map((p, i) => {
    const q = sp[Math.min(sp.length - 1, i + 1)];
    const o = sp[Math.max(0, i - 1)];
    let nx = -(q[1] - o[1]);
    let ny = q[0] - o[0];
    const L = Math.hypot(nx, ny) || 1;
    nx /= L;
    ny /= L;
    if (nx + ny * 0.3 > 0) {
      nx = -nx;
      ny = -ny;
    }
    return [p[0] + nx * k, p[1] + ny * k] as SP;
  });
}

/** desloca o eixo `k` pro lado do vetor g (1 = direita da tela, −1 = esquerda), perpendicular ao fio */
export function lockToward(sp: readonly SP[], k: number, g: number): SP[] {
  return sp.map((p, i) => {
    const q = sp[Math.min(sp.length - 1, i + 1)];
    const o = sp[Math.max(0, i - 1)];
    let nx = -(q[1] - o[1]);
    let ny = q[0] - o[0];
    const L = Math.hypot(nx, ny) || 1;
    nx /= L;
    ny /= L;
    if (Math.sign(nx || 1) !== Math.sign(g)) {
      nx = -nx;
      ny = -ny;
    }
    return [p[0] + nx * k, p[1] + ny * k] as SP;
  });
}

/** trecho do eixo entre t0 e t1 (0..1), reamostrado em n pontos */
export function spineSlice(sp: readonly SP[], t0: number, t1: number, n = 4): SP[] {
  const pts = sampleSpline(sp, 24);
  const out: SP[] = [];
  const a0 = Math.max(0, Math.min(1, t0));
  const a1 = Math.max(0, Math.min(1, t1));
  for (let i = 0; i < n; i++) {
    const t = a0 + ((a1 - a0) * i) / (n - 1);
    const f = t * (pts.length - 1);
    const a = Math.floor(f);
    const b = Math.min(pts.length - 1, a + 1);
    const u = f - a;
    out.push([pts[a][0] + (pts[b][0] - pts[a][0]) * u, pts[a][1] + (pts[b][1] - pts[a][1]) * u]);
  }
  return out;
}

/** move pontos */
export function shift(sp: readonly SP[], dx: number, dy: number): SP[] {
  return sp.map((p) => [p[0] + dx, p[1] + dy] as SP);
}

/** espelha pontos do eixo do rosto (x → 2cx − x) sem inverter a ordem */
export function flipX(k: HairKit, sp: readonly SP[]): SP[] {
  return sp.map((p) => (p.length > 2 ? ([2 * k.cx - p[0], p[1], p[2] as number] as SP) : ([2 * k.cx - p[0], p[1]] as SP)));
}

/** gradiente radial do volume do cabelo: luz de cima-esquerda, base, raiz embaixo/direita */
export function massGrad(k: HairKit, c: Pt, r: number, tone: string, o: { hi?: number; lo?: number } = {}): AvatarGradient {
  const t = k.t;
  return {
    t: 'r',
    cx: c[0],
    cy: c[1],
    r,
    fx: c[0] - r * 0.28,
    fy: c[1] - r * 0.3,
    s: [
      [0, mix(tone, t.lock, o.hi ?? 0.55)],
      [0.45, tone],
      [0.82, mix(tone, t.root, 0.45 * (o.lo ?? 1))],
      [1, mix(tone, t.root, 0.75 * (o.lo ?? 1))],
    ],
  };
}

/** gradiente vertical raiz → base → ponta (mechas que caem) */
export function fallGrad(k: HairKit, y0: number, y1: number, tone: string, o: { root?: number; tip?: number } = {}): AvatarGradient {
  const t = k.t;
  return {
    t: 'l',
    x1: 0,
    y1: y0,
    x2: 0,
    y2: y1,
    s: [
      [0, mix(tone, t.root, o.root ?? 0.4)],
      [0.3, tone],
      [0.78, tone],
      [1, mix(tone, t.tip, o.tip ?? 0.55)],
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// camadas comuns
// ---------------------------------------------------------------------------------------------------------------

/** sombra que o cabelo faz na testa/rosto (recortada na cabeça): faixa macia logo abaixo da borda */
export function foreheadShadow(k: HairKit, edge: readonly SP[], o = 0.26, w = 1.5, dy = 0.7): void {
  if (edge.length < 2) return;
  const n = edge.length;
  const ws = edge.map((_, i) => (i === 0 || i === n - 1 ? w * 0.3 : w));
  const c = k.t.pale ? k.t.cast : '#1A0A08';
  k.ctx.push(taperPath(shift(edge, 0.2, dy), ws, { n: Math.min(12, 3 + n * 2) }), c, { o: k.t.pale ? o * 0.85 : o, b: 0.8, cp: k.ha.headPath });
}

/** sombra do cabelo no pescoço e na roupa (recortada no corpo) */
export function castOnBody(k: HairKit, d: string, o = 0.28, b = 0.8): void {
  if (!d || k.tiny) return;
  k.ctx.push(d, '#0A0408', { o, ...(k.lite ? {} : { b }), cp: bodyClip(k) });
}

export interface Lock {
  spine: SP[];
  /** larguras ao longo do eixo (raiz → ponta) */
  w: number[];
  /** profundidade: 0 atrás … 3 na frente */
  z: number;
  /** lado da fresta escura (pra onde a mecha passa por baixo da vizinha): 1 direita, −1 esquerda */
  g?: number;
  /** tom: 0 = base, positivo escurece (mecha de trás), negativo clareia */
  dark?: number;
  /** ponta arredondada (ogiva) em vez de afinar em ponta */
  round?: boolean;
}

export interface LockOpts {
  /** gradiente do preenchimento por camada (padrão: queda vertical do y0 ao y1) */
  grad?: (tone: string, z: number) => AvatarGradient;
  y0?: number;
  y1?: number;
  /** massa por baixo das mechas (recebe a sombra da primeira camada) */
  under?: string;
  /** opacidade da sombra de uma camada na de baixo */
  shadowO?: number;
  /** fresta escura dentro de cada mecha (padrão: sim, fora do lite) */
  crevice?: boolean;
  /** luz de borda no lado da luz (padrão: só na camada da frente) */
  rim?: boolean | 'all';
  /** amostras por mecha */
  n?: number;
  /** escurecimento por camada (z 0 escurece mais) */
  depthDark?: number;
  /** trecho do eixo com fresta escura (0..1) */
  creviceRange?: [number, number];
  /** opacidade da luz de borda (padrão 0,4; cabelo claro pede menos) */
  rimO?: number;
  /** opacidade da fresta (padrão 0,46 / 0,4 no claro) */
  creviceO?: number;
}

const lockD = (l: Lock, n: number, k = 1, dx = 0, dy = 0) => taperPath(dx || dy ? shift(l.spine, dx, dy) : l.spine, k === 1 ? l.w : l.w.map((w) => w * k), { n, round: l.round });

/**
 * mechas em camadas de profundidade: sombra de cada camada na de baixo (recortada nela), preenchimento com gradiente,
 * fresta escura no lado em que a mecha passa por baixo da vizinha e luz de borda do lado da luz. Devolve o path de cada
 * camada e o de todas (pra recortes do brilho).
 */
export function paintLocks(k: HairKit, locks: readonly Lock[], o: LockOpts = {}): { all: string; byZ: Map<number, string> } {
  const { ctx, t, lite } = k;
  const n = o.n ?? (lite ? 8 : 11);
  const zs = [...new Set(locks.map((l) => l.z))].sort((a, b) => a - b);
  const byZ = new Map<number, string>();
  let below = o.under ?? '';
  const ys = locks.flatMap((l) => l.spine.map((p) => p[1]));
  const y0 = o.y0 ?? Math.min(...ys);
  const y1 = o.y1 ?? Math.max(...ys);
  const zMax = zs[zs.length - 1];
  const dd = o.depthDark ?? 0.16;
  for (const z of zs) {
    const list = locks.filter((l) => l.z === z);
    const d = list.map((l) => lockD(l, n, lite ? 1.05 : 1)).join('');
    // (figura minúscula: a sombra deslocada de cada camada virava traço escuro duro — no topete, desenhos de letra)
    if (below && !k.tiny) {
      const sh = list.map((l) => lockD(l, Math.max(6, n - 3), 1, 0.38, 0.55)).join('');
      ctx.push(sh, t.pale ? t.deep : '#07030A', { o: (o.shadowO ?? 0.34) * (t.pale ? 0.7 : 1), ...(lite ? {} : { b: 0.45 }), cp: below });
    }
    // cada camada tem um tom (as de trás mais escuras); mechas com `dark` próprio saem em camadas separadas por tom
    const tones = new Map<number, Lock[]>();
    for (const l of list) {
      const key = Math.round((l.dark ?? 0) * 100) / 100;
      tones.set(key, [...(tones.get(key) ?? []), l]);
    }
    for (const [dk, ls] of tones) {
      const base = mix(t.base, t.root, Math.max(0, Math.min(0.9, (zMax - z) * dd + Math.max(0, dk))));
      const tone = dk < 0 ? mix(base, t.lock, -dk) : base;
      const dz = ls.map((l) => lockD(l, n, lite ? 1.05 : 1)).join('');
      ctx.push(dz, tone, { gf: o.grad ? o.grad(tone, z) : fallGrad(k, y0, y1, tone) });
    }
    if (!lite && o.crevice !== false) {
      // fresta só no trecho do meio (onde a mecha passa por baixo da vizinha): nada de listra da raiz à ponta
      const [ca, cb] = o.creviceRange ?? [0.1, 0.72];
      const cr = list
        .map((l) => {
          const mw = Math.max(...l.w);
          return taperPath(lockToward(spineSlice(l.spine, ca, cb, 6), 0.32 * mw, l.g ?? 1), [0, mw * 0.28, mw * 0.3, mw * 0.2, 0], { n: 7 });
        })
        .join('');
      ctx.push(cr, t.deep, { o: o.creviceO ?? (t.pale ? 0.4 : 0.46), b: 0.28, cp: d });
    }
    const rim = o.rim ?? true;
    if (!lite && rim && (rim === 'all' || z === zMax)) {
      const lt = list.map((l) => taperPath(lockSide(l.spine, 0.3 * Math.max(...l.w)), l.w.map((w, i) => (i === 0 ? 0 : w * 0.16)), { n: Math.max(6, n - 3) })).join('');
      ctx.push(lt, t.lock, { o: o.rimO ?? 0.4, b: 0.2, cp: d });
    }
    byZ.set(z, d);
    below += d;
  }
  return { all: below, byZ };
}

/**
 * brilho anelar (anisotrópico): em cada mecha, um traço curto ALINHADO ao fio onde ela cruza a curva `ring(x)` (y da
 * faixa num x do avatar). Os traços ficam em comprimentos e larguras diferentes, então a faixa é quebrada pelas mechas.
 * `glow` acrescenta a faixa macia contínua por baixo (recortada em `clip`).
 */
export function ringSheen(
  k: HairKit,
  spines: readonly { spine: readonly SP[]; w: number }[],
  ring: (x: number) => number,
  o: { len?: number; wk?: number; o?: number; seed?: number; clip?: string; glow?: readonly SP[]; glowW?: number; color?: string; side?: number; pair?: boolean } = {},
): void {
  const { ctx, t, lite } = k;
  const r = rnd(o.seed ?? 5);
  let d = '';
  if (o.pair && !lite) {
    // dois fios finos por mecha (um mais longo, outro deslocado pro lado da sombra): faixa quebrada, nunca mancha
    const thin = spines.flatMap((sp) => [
      { spine: lockSide(sp.spine, sp.w * 0.18), w: sp.w * 0.55 },
      { spine: lockSide(sp.spine, -sp.w * 0.16), w: sp.w * 0.4 },
    ]);
    spines = thin;
  }
  for (const sp of spines) {
    const pts = sampleSpline(sp.spine, 28);
    let tc = -1;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1][1] - ring(pts[i - 1][0]);
      const b = pts[i][1] - ring(pts[i][0]);
      if (a <= 0 && b > 0) {
        tc = (i - 1 + a / (a - b)) / (pts.length - 1);
        break;
      }
    }
    if (tc < 0) continue;
    const L = (o.len ?? 0.12) * (0.7 + r() * 0.6);
    const seg = spineSlice(sp.spine, tc - L * (0.7 + r() * 0.4), tc + L, 5);
    const w = sp.w * (o.wk ?? 0.42) * (0.75 + r() * 0.4);
    d += taperPath(lockSide(seg, sp.w * (o.side ?? 0.1)), [0, w, w * 0.85, w * 0.5, 0], { n: lite ? 5 : 7 });
  }
  const c = o.color ?? t.sheen;
  if (o.glow && !lite) ctx.push(taperPath(o.glow, (u) => Math.sin(Math.PI * Math.min(1, Math.max(0, u))) * (o.glowW ?? 2.2) * k.s), c, { o: Math.min(1, (o.o ?? 0.6) * 0.32), b: 0.7, cp: o.clip });
  if (d) ctx.push(d, c, { o: Math.min(1, (o.o ?? 0.6) * (lite ? 0.85 : 1)), ...(lite ? {} : { b: 0.12 }) });
}

/** fios soltos (por FORA da massa, sobre o fundo/pele): finos, curvos, seguem a forma — nunca antena */
export function flyaways(k: HairKit, list: readonly SP[][], o = 0.42, w = 0.22): void {
  if (k.lite || !list.length) return;
  const d = list.map((sp) => taperPath(sp, [w * 0.6, w, w * 0.85, 0], { n: 7 })).join('');
  // tom do cabelo um passo mais CLARO e quase opaco, com a raiz grossa encostada na massa: translúcido sobre o fundo
  // escuro o fio do loiro escurecia e lia arranhão/arame solto
  k.ctx.push(d, mix(k.t.base, k.t.sheen, 0.25), { o: Math.min(0.9, 0.5 + o) });
}

/** fios escuros/claros misturados (grisalho, sal e pimenta) ao longo de eixos, recortados na massa */
export function saltPepper(k: HairKit, spines: readonly SP[][], clip: string, seed = 3): void {
  const { ctx, t, lite } = k;
  if (!t.gray || lite || t.salt <= 0) return;
  const r = rnd(seed);
  let dark = '';
  let light = '';
  for (const sp of spines) {
    const a = 0.1 + r() * 0.3;
    const b = Math.min(1, a + 0.35 + r() * 0.4);
    const seg = spineSlice(sp, a, b, 5);
    const w = 0.22 + r() * 0.2;
    if (r() < 0.45 + t.salt * 0.35) dark += taperPath(lockToward(seg, (r() - 0.5) * 0.6, 1), [0, w, w, 0], { n: 6 });
    else light += taperPath(lockToward(seg, (r() - 0.5) * 0.6, 1), [0, w * 0.8, w * 0.7, 0], { n: 6 });
  }
  if (dark) ctx.push(dark, t.pepper, { o: 0.32 + t.salt * 0.38, cp: clip });
  if (light) ctx.push(light, mix(t.base, '#FFFFFF', 0.6), { o: 0.5, cp: clip });
}

// ---------------------------------------------------------------------------------------------------------------
// raspado (máquina): sombra de fios curtos na pele, com textura de pontinhos e linha do cabelo nítida
// ---------------------------------------------------------------------------------------------------------------

/**
 * área raspada: tom do cabelo bem translúcido sobre a pele (a cabeça aparece), linha do cabelo nítida que some em
 * degradê no fim (`fadeY0`→`fadeY1`, de cima pra baixo), pontinhos de fio curto e brilho frio da pele por cima.
 */
export function shaved(k: HairKit, d: string, o: { density?: number; fadeY0?: number; fadeY1?: number; seed?: number; box?: { x: number; y: number; w: number; h: number }; clip?: string } = {}): void {
  const { ctx, t, lite } = k;
  const dens = o.density ?? 1;
  // cabelo claro raspado mal aparece: mais opaco pra ler
  const a = Math.min(0.92, (t.pale ? 0.62 : lum(t.base) < 0.04 ? 0.72 : 0.66) * dens);
  const c = t.pale ? mix(t.base, t.deep, 0.35) : mix(t.base, t.root, 0.25);
  const gf: AvatarGradient | undefined =
    o.fadeY0 != null && o.fadeY1 != null ? { t: 'l', x1: 0, y1: o.fadeY0, x2: 0, y2: o.fadeY1, s: [[0, c, a], [0.6, c, a * 0.9], [1, c, a * 0.2]] } : undefined;
  ctx.push(d, c, { ...(gf ? { gf } : { o: a }), ...(o.clip ? { cp: o.clip } : {}) });
  if (!lite && o.box) {
    // pontinhos (fio curto saindo da pele): traços miúdos num path só
    const r = rnd(o.seed ?? 11);
    const { x, y, w, h } = o.box;
    let dots = '';
    const n = Math.round(w * h * 0.5 * dens);
    for (let i = 0; i < n; i++) {
      const px = x + r() * w;
      const py = y + r() * h;
      const ang = 1.2 + r() * 0.8;
      const L = 0.24 + r() * 0.16;
      dots += `M${(px).toFixed(2)},${py.toFixed(2)}l${(Math.cos(ang) * L).toFixed(2)},${(Math.sin(ang) * L).toFixed(2)}`;
    }
    ctx.stroke(dots, t.pale ? t.deep : t.root, 0.15, { o: Math.min(1, 0.45 * dens), cp: o.clip ?? d });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// tranças, twists e locs (cordas com textura)
// ---------------------------------------------------------------------------------------------------------------

export interface Rope {
  spine: SP[];
  w: number;
  /** afina no fim (0 = reta até a ponta, 1 = afina bem) */
  taper?: number;
  z?: number;
  dark?: number;
}

function ropeWidths(r: Rope): (u: number) => number {
  const tp = r.taper ?? 0.35;
  return (u) => r.w * (u < 0.06 ? 0.7 + u * 5 : 1 - tp * Math.pow(Math.max(0, u - 0.55) / 0.45, 1.4)) * (u > 0.97 ? 0.75 : 1);
}

/** textura de trança (gomos em V alternados), twist (diagonais) ou loc (gomos irregulares) dentro de cada corda */
export function paintRopes(k: HairKit, ropes: readonly Rope[], kind: 'braid' | 'twist' | 'loc', o: { y0?: number; y1?: number; under?: string; shadowO?: number; cast?: boolean; seed?: number; lobe?: number } = {}): string {
  const { ctx, t, lite } = k;
  const zs = [...new Set(ropes.map((r) => r.z ?? 0))].sort((a, b) => a - b);
  const ys = ropes.flatMap((r) => r.spine.map((p) => p[1]));
  const y0 = o.y0 ?? Math.min(...ys);
  const y1 = o.y1 ?? Math.max(...ys);
  const rr = rnd(o.seed ?? 19);
  let below = o.under ?? '';
  const zMax = zs[zs.length - 1];
  for (const z of zs) {
    const list = ropes.filter((r) => (r.z ?? 0) === z);
    const d = list.map((r) => taperPath(r.spine, ropeWidths(r), { n: lite ? 8 : 12, round: true })).join('');
    if (below && !k.tiny) ctx.push(list.map((r) => taperPath(shift(r.spine, 0.35, 0.5), ropeWidths(r), { n: 8, round: true })).join(''), '#07030A', { o: o.shadowO ?? 0.34, ...(lite ? {} : { b: 0.4 }), cp: below });
    const tone = mix(t.base, t.root, (zMax - z) * 0.18);
    ctx.push(d, tone, { gf: fallGrad(k, y0, y1, tone, { tip: 0.3 }) });
    // gomos: traços (stroke) curtos em vez de formas afiladas — a textura é densa e o path precisa ser leve
    // (trança com 20 cordas passava de 1,5 MB de path); larguras médias por camada
    const f1 = (v: number) => (Math.round(v * 10) / 10).toString();
    const P2 = (p: readonly number[]) => `${f1(p[0])},${f1(p[1])}`;
    let dk = '';
    let hl = '';
    let wSum = 0;
    for (const r of list) {
      wSum += r.w;
      const pts = sampleSpline(r.spine, 40);
      // comprimento acumulado: os gomos são espaçados pelo COMPRIMENTO (pelo índice da amostra, o trecho curto da dobra
      // no ombro recebia tantos gomos quanto um longo e virava uma faixa clara atravessando a trança)
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const len = cum[cum.length - 1];
      const step = (o.lobe ?? (kind === 'loc' ? 1.5 : kind === 'twist' ? 1.05 : 0.95)) * Math.max(0.7, r.w / 1.6) * (lite ? 1.4 : 1);
      const nSeg = Math.max(2, Math.floor(len / step));
      const at = (u: number): { p: Pt; nx: number; ny: number; tx: number; ty: number } => {
        const target = Math.max(0, Math.min(1, u)) * len;
        let i = 0;
        while (i < pts.length - 2 && cum[i + 1] < target) i++;
        const a = pts[i];
        const b = pts[i + 1];
        const fr = (target - cum[i]) / (cum[i + 1] - cum[i] || 1);
        let tx = b[0] - a[0];
        let ty = b[1] - a[1];
        const L = Math.hypot(tx, ty) || 1;
        tx /= L;
        ty /= L;
        return { p: [a[0] + (b[0] - a[0]) * fr, a[1] + (b[1] - a[1]) * fr], nx: -ty, ny: tx, tx, ty };
      };
      const W = ropeWidths(r);
      for (let i = 1; i < nSeg; i++) {
        const u = i / nSeg;
        if (u > 0.985) break;
        const { p, nx, ny, tx, ty } = at(u);
        const hw = W(u) / 2;
        if (kind === 'braid') {
          // V: das duas bordas até o meio, um pouco à frente (o gomo de cima cobre o de baixo)
          const ah = step * 0.55;
          const L = [p[0] + nx * hw * 0.88 - tx * ah * 0.1, p[1] + ny * hw * 0.88 - ty * ah * 0.1];
          const R = [p[0] - nx * hw * 0.88 - tx * ah * 0.1, p[1] - ny * hw * 0.88 - ty * ah * 0.1];
          const M = [p[0] + tx * ah, p[1] + ty * ah];
          dk += `M${P2(L)}Q${P2([(L[0] + M[0]) / 2 + tx * 0.12, (L[1] + M[1]) / 2 + ty * 0.12])} ${P2(M)}Q${P2([(R[0] + M[0]) / 2 + tx * 0.12, (R[1] + M[1]) / 2 + ty * 0.12])} ${P2(R)}`;
          if (!lite) {
            // luz no gomo (alternando os lados)
            const sd = i % 2 ? 1 : -1;
            const c = at(u - 0.5 / nSeg);
            const q = [c.p[0] + c.nx * hw * 0.42 * sd, c.p[1] + c.ny * hw * 0.42 * sd];
            hl += `M${P2([q[0] - c.tx * step * 0.25, q[1] - c.ty * step * 0.25])}L${P2([q[0] + c.tx * step * 0.2, q[1] + c.ty * step * 0.2])}`;
          }
        } else if (kind === 'twist') {
          // diagonal de borda a borda (as duas mechas torcidas)
          const A = [p[0] + nx * hw * 0.92 - tx * step * 0.35, p[1] + ny * hw * 0.92 - ty * step * 0.35];
          const B = [p[0] - nx * hw * 0.92 + tx * step * 0.35, p[1] - ny * hw * 0.92 + ty * step * 0.35];
          dk += `M${P2(A)}Q${P2([(A[0] + B[0]) / 2 + tx * 0.2, (A[1] + B[1]) / 2 + ty * 0.2])} ${P2(B)}`;
          if (!lite) {
            const c = at(u - 0.45 / nSeg);
            const q = [c.p[0] + c.nx * hw * 0.3, c.p[1] + c.ny * hw * 0.3];
            hl += `M${P2([q[0] + c.nx * hw * 0.3 - c.tx * step * 0.2, q[1] + c.ny * hw * 0.3 - c.ty * step * 0.2])}L${P2([q[0] - c.nx * hw * 0.3 + c.tx * step * 0.2, q[1] - c.ny * hw * 0.3 + c.ty * step * 0.2])}`;
          }
        } else if (rr() < 0.75) {
          // loc: anel irregular (gomo)
          const j = (rr() - 0.5) * 0.3;
          dk += `M${P2([p[0] + nx * hw * 0.85, p[1] + ny * hw * 0.85 + j])}Q${P2([p[0] + tx * 0.3, p[1] + ty * 0.3])} ${P2([p[0] - nx * hw * 0.85, p[1] - ny * hw * 0.85 - j])}`;
        }
      }
      if (kind === 'loc' && !lite) {
        // cilindro: faixa de luz do lado da luz ao longo da corda, quebrada
        hl += taperPath(lockSide(spineSlice(r.spine, 0.04, 0.9, 6), r.w * 0.22), (u) => r.w * 0.22 * Math.sin(Math.PI * u) * (0.6 + 0.4 * Math.sin(u * 17 + r.w)), { n: 8 });
      }
    }
    const wm = wSum / Math.max(1, list.length);
    if (dk) ctx.stroke(dk, t.deep, wm * (kind === 'loc' ? 0.14 : kind === 'twist' ? 0.16 : 0.15), { o: kind === 'loc' ? 0.42 : t.pale ? 0.55 : 0.66, cp: d });
    if (hl) {
      if (kind === 'loc') ctx.push(hl, t.sheen, { o: t.pale ? 0.4 : 0.5, b: 0.1, cp: d });
      else ctx.stroke(hl, t.sheen, wm * 0.14, { o: t.pale ? 0.4 : 0.5, cp: d });
    }
    if (!lite && z === zMax) {
      // lado da sombra de cada corda (volume de cilindro)
      ctx.push(list.map((r) => taperPath(lockToward(r.spine, -r.w * 0.36, 1), (u) => ropeWidths(r)(u) * 0.3, { n: 8 })).join(''), t.deep, { o: 0.35, b: 0.3, cp: d });
    }
    below += d;
  }
  return below;
}

// ---------------------------------------------------------------------------------------------------------------
// cachos
// ---------------------------------------------------------------------------------------------------------------

export interface Clump {
  x: number;
  y: number;
  r: number;
  /** direção do caimento (rad; 0 = pra baixo, positivo gira pra esquerda da tela... ver clumpPts) */
  a: number;
  /** semente da forma */
  k: number;
  /** alongamento no sentido do caimento (cacho em mola: 1,2–1,8) */
  e?: number;
}

/** contorno do cacho-massa: gota arredondada com 2 bossas (nada de círculo), alongada no caimento */
export function clumpPts(c: Clump): SP[] {
  const e = c.e ?? 1.25;
  const ca = Math.cos(c.a);
  const sa = Math.sin(c.a);
  const pts: SP[] = [];
  const n = 9;
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2;
    // y local = sentido do caimento; a ponta embaixo afina um pouco, as bossas de cima variam
    const bump = 1 + 0.12 * Math.sin(th * 2 + c.k * 9) + 0.08 * Math.sin(th * 3 + c.k * 21);
    const lx = Math.cos(th) * c.r * bump * (Math.sin(th) > 0 ? 0.86 : 1);
    const ly = Math.sin(th) * c.r * bump * (Math.sin(th) > 0 ? e : 1);
    pts.push([c.x + lx * ca - ly * sa, c.y + lx * sa + ly * ca]);
  }
  return pts;
}

/**
 * camada de cachos-massa com profundidade: sombra no que está embaixo, massa com gradiente, OCLUSÃO FORTE dentro (um
 * sulco em espiral aberta, sem "@" desenhado), luz só nos cachos virados pra luz (alto à esquerda da cabeça) e sombra
 * própria embaixo. `light` 0..1 = quanto a camada pega luz.
 */
export function paintClumps(k: HairKit, list: readonly Clump[], tone: string, o: { cp?: string; shadowO?: number; light?: number; groove?: number } = {}): string {
  const { ctx, t, lite } = k;
  let fill = '';
  let shadow = '';
  let groove = '';
  let hl = '';
  let core = '';
  const lc: Pt = [k.cx - 4 * k.s, k.H(0, k.CR + 2)[1]];
  const R = 14 * k.s;
  for (const c of list) {
    const pts = clumpPts(c);
    fill += smoothPath(pts);
    shadow += smoothPath(shift(pts, c.r * 0.22, c.r * 0.34));
    const ca = Math.cos(c.a);
    const sa = Math.sin(c.a);
    const flip = c.k > 0.5 ? 1 : -1;
    const P = (x: number, y: number): SP => [c.x + (x * flip * ca - y * sa) * c.r, c.y + (x * flip * sa + y * ca) * c.r];
    // sulco: espiral aberta (de fora pra dentro), larga no meio
    const gp: SP[] = [];
    for (let i = 0; i <= 6; i++) {
      const th = -0.6 + i * 0.62;
      const rr = 0.72 - i * 0.075;
      gp.push(P(Math.cos(th) * rr, Math.sin(th) * rr * 1.05 + 0.1));
    }
    if (!lite || c.r > 1.6) groove += taperPath(gp, [0, c.r * 0.26, c.r * 0.3, c.r * 0.22, 0], { n: lite ? 6 : 8 });
    // sombra própria (metade de baixo, lado da sombra)
    core += taperPath([P(0.62, -0.1), P(0.55, 0.55), P(0, 0.92), P(-0.5, 0.62)], [0, c.r * 0.3, c.r * 0.26, 0], { n: 6 });
    // luz: só no arco de cima-esquerda, e só se o cacho está do lado da luz
    const dx = (c.x - lc[0]) / R;
    const dy = (c.y - lc[1]) / R;
    const face = Math.max(0, 1 - Math.hypot(dx * 0.8, dy));
    if (face > 0.15) {
      const sg = flip > 0 ? 1 : -1;
      hl += taperPath([P(-0.75 * sg, -0.05), P(-0.55 * sg, -0.62), P(0.05 * sg, -0.86)], [0, c.r * 0.26 * face, c.r * 0.18 * face, 0], { n: 6 });
    }
  }
  const shadowC = t.pale ? mix(t.deep, '#2A2A3A', 0.3) : '#07040A';
  ctx.push(shadow, shadowC, { o: (o.shadowO ?? 0.45) * (t.pale ? 0.65 : 1), ...(lite ? {} : { b: 0.4 }), cp: o.cp });
  const ys = list.map((c) => c.y);
  ctx.push(fill, tone, { gf: { t: 'l', x1: 0, y1: Math.min(...ys) - 3, x2: 0, y2: Math.max(...ys) + 3, s: [[0, mix(tone, t.lock, 0.3 * (o.light ?? 1))], [0.55, tone], [1, mix(tone, t.root, 0.45)]] } });
  if (groove) ctx.push(groove, t.pale ? mix(t.base, t.deep, 0.75) : mix(t.deep, '#000000', 0.25), { o: (t.pale ? 0.5 : 0.72) * (o.groove ?? 1), ...(lite ? {} : { b: 0.22 }) });
  if (!lite) ctx.push(core, t.deep, { o: t.pale ? 0.32 : 0.45, b: 0.3 });
  if (hl && (o.light ?? 1) > 0) ctx.push(hl, t.sheen, { o: (t.pale ? 0.45 : 0.62) * (o.light ?? 1), ...(lite ? {} : { b: 0.12 }) });
  return fill;
}

/** cachinhos em C na borda (rompem a silhueta) e frizz fino; um path de fita + um de frizz */
export function curlEdge(k: HairKit, pts: readonly SP[], o: { r0?: number; r1?: number; seed?: number; frizz?: number; tone?: string } = {}): void {
  const { ctx, t, lite } = k;
  const r = rnd(o.seed ?? 31);
  let cs = '';
  let fz = '';
  const cxh = k.cx;
  const cyh = k.H(0, -1)[1];
  for (const p of pts) {
    const rad = (o.r0 ?? 0.55) + r() * ((o.r1 ?? 1.0) - (o.r0 ?? 0.55));
    // abre pra fora da cabeça
    const out = Math.atan2(p[1] - cyh, p[0] - cxh);
    const a0 = out + Math.PI * (0.35 + r() * 0.3);
    const pp: SP[] = [];
    for (let i = 0; i <= 4; i++) {
      const th = a0 - i * 0.62;
      pp.push([p[0] + Math.cos(th) * rad, p[1] + Math.sin(th) * rad]);
    }
    cs += taperPath(pp, [0, rad * 0.5, rad * 0.55, rad * 0.3, 0], { n: 6 });
    if (!lite && r() < (o.frizz ?? 0.6)) {
      // frizz: começa DENTRO da massa (meia unidade pra dentro) e sai curto — nada de cachinho boiando separado
      const L = 0.6 + r() * 0.6;
      const a = out + (r() - 0.5) * 0.9;
      const p0: SP = [p[0] - Math.cos(out) * 0.5, p[1] - Math.sin(out) * 0.5];
      fz += taperPath([p0, [p0[0] + Math.cos(a) * L * 0.5 + 0.2, p0[1] + Math.sin(a) * L * 0.5], [p0[0] + Math.cos(a + 0.4) * L, p0[1] + Math.sin(a + 0.4) * L]], [0.2, 0.14, 0]);
    }
  }
  ctx.push(cs, o.tone ?? t.base, { gf: { t: 'l', x1: 0, y1: k.H(0, k.CR)[1], x2: 0, y2: k.H(0, k.jawY + 4)[1], s: [[0, mix(o.tone ?? t.base, t.lock, 0.35)], [1, mix(o.tone ?? t.base, t.root, 0.4)]] } });
  if (fz) ctx.push(fz, o.tone ?? t.base, { o: 0.8 });
}

// ---------------------------------------------------------------------------------------------------------------
// crespo: contorno macio irregular e microcachos
// ---------------------------------------------------------------------------------------------------------------

/** contorno irregular (borda do crespo): elipse com bossas grandes e pequenas de tamanhos diferentes */
export function softOutline(cx: number, cy: number, rx: number, ry: number, n: number, amp: number, seed: number): SP[] {
  const pts: SP[] = [];
  const r = rnd(seed);
  const ph = r() * 6.28;
  let a = 0;
  while (a < Math.PI * 2 - 0.05) {
    const big = 0.55 + 0.45 * Math.sin(a * 3 + ph) * Math.sin(a * 5 + ph * 0.7);
    const rr = amp * (0.55 + r() * 0.6) * (0.75 + big * 0.5);
    const slow = amp * 0.9 * Math.sin(a * 2 + ph * 1.3);
    pts.push([cx + Math.cos(a) * (rx + rr + slow), cy + Math.sin(a) * (ry + rr + slow), 1]);
    const step = ((Math.PI * 2) / (n * 2)) * (0.75 + r() * 0.5);
    const am = a + step * 0.5;
    const slowM = amp * 0.9 * Math.sin(am * 2 + ph * 1.3);
    pts.push([cx + Math.cos(am) * (rx + amp * 0.1 + slowM), cy + Math.sin(am) * (ry + amp * 0.1 + slowM), 1]);
    a += step;
  }
  return pts;
}

/** microcachos: arcos miúdos espalhados (sementes fixas), traçados numa camada só; `keep(x, y)` filtra a região */
export function coils(k: HairKit, clip: string, box: { x: number; y: number; w: number; h: number }, color: string, o: number, r0: number, gap: number, seed: number, w: number, keep?: (x: number, y: number) => boolean): void {
  const r = rnd(seed);
  const n1 = (v: number) => (Math.round(v * 10) / 10).toString();
  let d = '';
  let row = 0;
  for (let y = box.y + gap * 0.5; y < box.y + box.h; y += gap * 0.85, row++) {
    for (let x = box.x + (row % 2 ? gap * 0.5 : 0); x < box.x + box.w; x += gap) {
      const cx = x + (r() - 0.5) * gap * 0.6;
      const cy = y + (r() - 0.5) * gap * 0.6;
      const rr = r0 * (0.75 + r() * 0.5);
      const a = r() * 6.28;
      if (keep && !keep(cx, cy)) continue;
      d += `M${n1(cx + Math.cos(a) * rr)},${n1(cy + Math.sin(a) * rr)}A${n1(rr)},${n1(rr)} 0 0 1 ${n1(cx + Math.cos(a + 2.4) * rr)},${n1(cy + Math.sin(a + 2.4) * rr)}`;
    }
  }
  if (d) k.ctx.stroke(d, color, w, { o, cp: clip });
}

/** sombra recortada de borda macia seguindo o contorno (o contorno deslocado com evenodd: faixa que acompanha a forma) */
export function edgeShade(k: HairKit, pts: readonly SP[], dx: number, dy: number, color: string, o: number, b = 0.5): void {
  const d = smoothPath(pts);
  k.ctx.push(d + smoothPath(shift(pts, dx, dy)), color, { r: 'evenodd', o, ...(k.lite ? {} : { b }), cp: d });
}

/** camada genérica (atalho com nível de detalhe) */
export function layer(k: HairKit, d: string, f: string, extra?: Partial<AvatarLayer>): void {
  if (d) k.ctx.push(d, f, extra);
}
