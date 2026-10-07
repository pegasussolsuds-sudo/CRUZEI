// Parte de baixo: calças (jeans, calça reta, alfaiataria, cargo, jogger, legging, metalizada, pantalona, jeans
// rasgado), shorts e bermuda, saias (curta, plissada, midi, kilt, tutu). Dono: guarda-roupa (parte de baixo).
//
// Método (STYLE.md §4): a perna da calça usa o gradiente da perna INTEIRA (legAxis) na coxa (grupo legX) e na canela
// (grupo shinX) — perna contínua, sem "joelheira" — e o quadril vai no grupo do tronco, começando logo acima da barra
// da parte de cima. Sentado: a coxa é vista de cima (trapézio curto com o plano do colo claro), a canela vem antes.
// Saias ficam no grupo do tronco (balançam com o quadril) e acompanham a largura do quadril de cada corpo.
// A barra das calças compridas é redesenhada por cima do calçado (pantHemOverShoe, chamada pelos calçados).

import type { AvatarConfig } from '@cruzei/shared-types';

import { footBox, hashUnit, legAxis, limbWidthAt, shinPath, smoothPath, taperPath, thighPath, torsoPath, torsoXAt, type Side, type SP } from '../anatomy';
import type { LayerCtx } from '../ctx';
import { ellipse } from '../geometry';
import { blob, creases, cylGradient, isLite, lodCtx, lum, mix, speckle, starPath, weave } from '../shading';
import type { AvatarGradient, AvatarStop, Pt } from '../types';

import { tonesOf } from './body';
import { outerDef } from './clothes-kit';
import { SIDES, fabric, legG, lowerKind, outSign, pantsTopY, rng, shinG, threadOf, waistShown, type Tones } from './lower-common';

// ---------------------------------------------------------------------------------------------------------------
// estilos das calças
// ---------------------------------------------------------------------------------------------------------------

type Mat = 'denim' | 'twill' | 'wool' | 'crepe' | 'knit' | 'lycra' | 'metal';

interface PantStyle {
  /** folga da coxa e alargamento até o joelho */
  ease: number;
  flareT: number;
  /** alargamento da canela até a barra (negativo afina: jogger) */
  flareS: number;
  /** quanto a canela passa do tornozelo (0 = barra no tornozelo; pantalona cobre o pé) */
  endExt: number;
  mat: Mat;
}

export const PANT_STYLES: Record<string, PantStyle> = {
  jeans: { ease: 0.95, flareT: 0.3, flareS: 0.45, endExt: 0, mat: 'denim' },
  ripped: { ease: 0.8, flareT: 0.2, flareS: 0.25, endExt: 0, mat: 'denim' },
  pants: { ease: 1.05, flareT: 0.35, flareS: 0.55, endExt: 0, mat: 'twill' },
  tailored: { ease: 0.8, flareT: 0.3, flareS: 0.3, endExt: 0, mat: 'wool' },
  cargo: { ease: 1.5, flareT: 0.45, flareS: 0.45, endExt: 0, mat: 'twill' },
  joggers: { ease: 1.4, flareT: 0.2, flareS: -1.0, endExt: 0, mat: 'knit' },
  leggings: { ease: 0.18, flareT: 0, flareS: 0, endExt: 0.5, mat: 'lycra' },
  metallic: { ease: 0.62, flareT: 0.25, flareS: 0.35, endExt: 0, mat: 'metal' },
  wide: { ease: 1.8, flareT: 1.7, flareS: 4.6, endExt: 4.4, mat: 'crepe' },
};

/** shorts e bermuda: até onde vão na coxa (t do quadril ao joelho), folga e alargamento */
const SHORT_STYLES: Record<string, { to: number; ease: number; flare: number }> = {
  shorts: { to: 0.5, ease: 1.15, flare: 1.5 },
  bermuda: { to: 0.9, ease: 1.35, flare: 1.4 },
};

/** a calça vai pra dentro do cano (bota alta) em vez de quebrar a barra por cima do calçado: t da boca do cano na canela */
export const TALL_BOOTS: Readonly<Record<string, number>> = { combat: 0.6, texan: 0.56, hover: 0.6, skates: 0.78 };
/**
 * cano médio (cano alto, bota): a calça reta/justa franze por cima do cano e o colarinho aparece embaixo da barra (senão
 * o cano some e o item fica igual ao tênis/sapato); a pantalona continua cobrindo o calçado
 */
export const MID_BOOTS: Readonly<Record<string, number>> = { hightops: 0.79, boots: 0.8 };

/** t da boca do cano em que a calça entra (franzida por cima), ou undefined (a barra quebra por cima do calçado) */
export function shaftT(ctx: LayerCtx): number | undefined {
  const k = lowerKind(ctx.cfg);
  if (k === 'leggings' || !PANT_STYLES[k]) return undefined;
  return TALL_BOOTS[ctx.cfg.shoes] ?? (k !== 'wide' ? MID_BOOTS[ctx.cfg.shoes] : undefined);
}

// ---------------------------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------------------------

type Which = 'l' | 'r';
const outW = (s: Side): Which => (s === 'L' ? 'l' : 'r');

/** ponto da borda do membro (lado esquerdo/direito da tela) em t, com folga e alargamento (como o contorno da calça) */
function edgePt(ctx: LayerCtx, limb: 'thigh' | 'shin', s: Side, t: number, which: Which, ease = 0, flare = 0): Pt {
  const q = limbWidthAt(ctx.an, limb, s, t);
  let lx = -q.dir[1];
  let ly = q.dir[0];
  if (lx > 0) {
    lx = -lx;
    ly = -ly;
  }
  const w = (which === 'l' ? q.l : q.r) + ease + flare * t;
  const k = which === 'l' ? 1 : -1;
  return [q.at[0] + lx * w * k, q.at[1] + ly * w * k];
}

/** gradiente de cilindro da perna inteira com paradas próprias (mesma geometria do cylGradient) */
function legGrad(ctx: LayerCtx, s: Side, widen: number, stops: readonly AvatarStop[]): AvatarGradient {
  const ax = legAxis(ctx.an, s);
  const g = cylGradient(ax.a, ax.b, ax.wl + widen, ax.wr + widen, { light: '#FFFFFF', base: '#FFFFFF', shade: '#FFFFFF' });
  return { ...g, s: stops } as AvatarGradient;
}

/** tons por material (lycra e metal ganham brilho; malha fica fosca) */
function matTones(c: string, mat: Mat): Tones {
  const t = fabric(c);
  const L = lum(c);
  if (mat === 'knit') return { ...t, light: mix(c, '#FFFFFF', L > 0.7 ? 0.35 : 0.11), shade: mix(c, '#0B0816', L > 0.7 ? 0.12 : 0.22) };
  if (mat === 'lycra') return { ...t, light: mix(c, '#FFFFFF', L > 0.7 ? 0.6 : 0.3), shade: mix(c, '#05030C', L > 0.7 ? 0.2 : 0.38) };
  if (mat === 'metal') return { light: mix(c, '#FFFFFF', 0.62), base: c, shade: mix(c, '#05030C', 0.45), deep: mix(c, '#000000', 0.68), bounce: mix(c, '#FFFFFF', 0.25) };
  if (mat === 'wool') return { ...t, light: mix(c, '#F2F4FF', L > 0.7 ? 0.42 : 0.15) };
  return t;
}

function legStops(t: Tones, mat: Mat): readonly AvatarStop[] {
  if (mat === 'metal') {
    // cilindro metálico macio (o reflexo forte vem nos gomos do metalStreaks, não em faixas do gradiente)
    return [
      [0, t.shade],
      [0.16, t.light],
      [0.34, t.base],
      [0.6, t.shade],
      [0.84, t.bounce],
      [1, t.deep],
    ];
  }
  if (mat === 'lycra') {
    return [
      [0, t.shade],
      [0.14, t.base],
      [0.28, t.light],
      [0.42, t.base],
      [0.78, t.shade],
      [0.94, t.deep],
      [1, t.bounce],
    ];
  }
  return [
    [0, t.base],
    [0.18, t.light],
    [0.46, t.base],
    [0.84, t.shade],
    [1, t.bounce],
  ];
}

/** cor das paradas em p (0..1) */
function stopAt(stops: readonly AvatarStop[], p: number): string {
  if (p <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (p <= stops[i][0]) {
      const a = stops[i - 1];
      const b = stops[i];
      return mix(a[1], b[1], (p - a[0]) / (b[0] - a[0] || 1));
    }
  }
  return stops[stops.length - 1][1];
}

/**
 * gradiente horizontal do quadril que CONTINUA o das duas coxas: na altura da emenda (gancho), cada metade do quadril
 * tem exatamente as cores da coxa embaixo dela, então a emenda quadril/coxa some (nada de "short por cima da calça").
 * No meio, a sombra da coxa esquerda encontra a luz da direita: lê como a costura da frente.
 */
function hipGradFromLegs(ctx: LayerCtx, widen: number, stops: readonly AvatarStop[]): AvatarGradient {
  const { an } = ctx;
  const y = an.torsoBottom - 1.2;
  const span = (s: Side): [number, number] => {
    const g = legGrad(ctx, s, widen, stops) as { x1: number; y1: number; x2: number; y2: number };
    const dx = g.x2 - g.x1;
    const dy = g.y2 - g.y1;
    const L2 = dx * dx + dy * dy || 1;
    const xAt = (p: number) => g.x1 + (p * L2 - (y - g.y1) * dy) / (dx || 1e-6);
    return [xAt(0), xAt(1)];
  };
  const [l0, l1] = span('L');
  const [r0, r1] = span('R');
  const m = l1 > r0 ? (l1 + r0) / 2 : (l1 + r0) / 2;
  const X0 = Math.min(l0, an.cx - an.w.hip - 4);
  const X1 = Math.max(r1, an.cx + an.w.hip + 4);
  const W = X1 - X0;
  const off = (x: number) => Math.max(0, Math.min(1, (x - X0) / W));
  const out: [number, string][] = [[0, stops[0][1]]];
  const pushStop = (x: number, c: string) => {
    const o = off(x);
    const last = out[out.length - 1];
    out.push([Math.max(o, last[0] + 0.0005), c]);
  };
  // coxa esquerda até o meio
  pushStop(l0, stops[0][1]);
  for (const st of stops) {
    const x = l0 + (l1 - l0) * st[0];
    if (x < m) pushStop(x, st[1]);
  }
  pushStop(m, stopAt(stops, (m - l0) / (l1 - l0 || 1)));
  // coxa direita a partir do meio
  pushStop(m + 0.05, stopAt(stops, (m + 0.05 - r0) / (r1 - r0 || 1)));
  for (const st of stops) {
    const x = r0 + (r1 - r0) * st[0];
    if (x > m + 0.05) pushStop(x, st[1]);
  }
  pushStop(X1, stops[stops.length - 1][1]);
  return { t: 'l', x1: X0, y1: y, x2: X1, y2: y, s: out.map(([o, c]) => [Math.min(1, o), c] as AvatarStop) };
}

/** gradiente horizontal do quadril (mesmas cores da perna) */
function hipGrad(ctx: LayerCtx, t: Tones, mat: Mat): AvatarGradient {
  const { an } = ctx;
  const sw = an.w.hip + 1.5;
  if (mat === 'metal') return { t: 'l', x1: an.cx - sw, y1: 0, x2: an.cx + sw, y2: 0, s: [[0, t.shade], [0.15, t.light], [0.3, t.base], [0.55, t.deep], [0.75, t.base], [0.9, t.bounce], [1, t.shade]] };
  return { t: 'l', x1: an.cx - sw, y1: 0, x2: an.cx + sw, y2: 0, s: [[0, t.base], [0.2, t.light], [0.5, t.base], [0.86, t.shade], [1, t.bounce]] };
}

// ---------------------------------------------------------------------------------------------------------------
// entrada
// ---------------------------------------------------------------------------------------------------------------

/** 6b. parte de baixo (o orquestrador chama com o grupo legL; cada pedaço troca pro grupo dele) */
export function drawBottom(ctx: LayerCtx): void {
  ctx = lodCtx(ctx);
  const kind = lowerKind(ctx.cfg);
  if (kind === 'dress') return;
  if (PANT_STYLES[kind]) return trousers(ctx, kind);
  if (SHORT_STYLES[kind]) return shorts(ctx, kind);
  switch (kind) {
    case 'skirt':
      return skirtA(ctx);
    case 'pleated':
      return skirtPleated(ctx);
    case 'midi':
      return skirtMidi(ctx);
    case 'kilt':
      return kilt(ctx);
    case 'tutu':
      return tutu(ctx);
    default:
      return trousers(ctx, 'jeans');
  }
}

// ---------------------------------------------------------------------------------------------------------------
// calças compridas
// ---------------------------------------------------------------------------------------------------------------

function trousers(ctx: LayerCtx, kind: string): void {
  const { an } = ctx;
  const lite = isLite(ctx);
  const st = PANT_STYLES[kind] ?? PANT_STYLES.jeans;
  const c = ctx.col.bottom;
  const t = matTones(c, st.mat);
  if (wideOn(ctx, kind)) return wideTrousers(ctx, st, t);
  const E = st.ease + (lite ? 0.2 : 0);
  const Es = E + st.flareT * 0.7;
  for (const s of SIDES) {
    const grad = legGrad(ctx, s, E + 0.4, legStops(t, st.mat));
    const thigh = () => ctx.withGroup(legG(s), () => pantThigh(ctx, s, kind, st, t, E, grad));
    const shin = () => ctx.withGroup(shinG(s), () => pantShin(ctx, s, kind, st, t, Es, grad));
    if (an.seated) {
      shin();
      thigh();
    } else {
      thigh();
      shin();
    }
  }
  ctx.withGroup('body', () => pantHip(ctx, kind, st, t, E));
}

// ---------------------------------------------------------------------------------------------------------------
// pantalona em pé: UM contorno por perna (quadril → barra) e UM gradiente; o joelho só divide o contorno em dois grupos
// (legX/shinX) com sobreposição e um disco na junta (some em repouso, cobre a fresta ao dobrar). Folga reta da coxa ao
// joelho e alargamento só abaixo dele; o lado de fora cai em linha reta do quadril à barra (nada de degrau no quadril
// largo). Os detalhes são os MESMOS traços nas duas metades e na barra por cima do calçado (cada um recortado no seu
// pedaço), então nenhuma emenda aparece. Sentado ou com bota alta: o desenho antigo (pantThigh/pantShin).
// ---------------------------------------------------------------------------------------------------------------

/** a pantalona usa o contorno contínuo? */
const wideOn = (ctx: LayerCtx, kind: string): boolean => kind === 'wide' && !ctx.an.seated && !(ctx.cfg.shoes in TALL_BOOTS);

interface WideGeo {
  s: Side;
  E: number;
  /** ponto da borda ('l'/'r' da tela) em u: 0..1 coxa, 1..2 canela; f = fração da largura (0 = borda esquerda) */
  at: (u: number, f: number) => Pt;
  /**
   * contorno fechado do trecho u0..u1 (u0 = 0 inclui o topo no quadril; u1 = 2 inclui a barra curva); `clampIn` limita
   * o lado de dentro a esse x (a barra redesenhada por cima do calçado não invade a outra perna)
   */
  outline: (u0: number, u1: number, clampIn?: number) => string;
  /** borda de fora (com a queda reta do quadril) em y */
  outerX: (y: number) => number;
  grad: AvatarGradient;
  knee: Pt;
  kneeR: number;
  /** barra: centro, meia-largura de cada lado, altura no meio e queda nas laterais */
  hem: { c: Pt; wl: number; wr: number; yC: number; drop: number };
  yHip: number;
}

function wideGeo(ctx: LayerCtx, s: Side, t: Tones): WideGeo {
  const { an } = ctx;
  const E = 1.4 + (isLite(ctx) ? 0.2 : 0);
  const out: Which = outW(s);
  const sg = outSign(s);
  const q0 = limbWidthAt(an, 'thigh', s, 0);
  const qK = limbWidthAt(an, 'thigh', s, 1);
  const W0 = { l: q0.l + E, r: q0.r + E };
  const WK = { l: qK.l + E + 0.6 * (q0.l - qK.l), r: qK.r + E + 0.6 * (q0.r - qK.r) };
  const WH = { l: WK.l + (out === 'l' ? 3.0 : 1.8), r: WK.r + (out === 'r' ? 3.0 : 1.8) };
  const half = (u: number, w: Which) => (u <= 1 ? W0[w] + (WK[w] - W0[w]) * u : WK[w] + (WH[w] - WK[w]) * Math.pow(u - 1, 1.5));
  const axis = (u: number) => (u <= 1 ? limbWidthAt(an, 'thigh', s, u) : limbWidthAt(an, 'shin', s, u - 1));
  const raw = (u: number, w: Which): Pt => {
    const q = axis(u);
    let lx = -q.dir[1];
    let ly = q.dir[0];
    if (lx > 0) {
      lx = -lx;
      ly = -ly;
    }
    const h = half(u, w);
    const k = w === 'l' ? 1 : -1;
    return [q.at[0] + lx * h * k, q.at[1] + ly * h * k];
  };
  // barra: desce até perto da sola (cobre o pé, só o bico aparece), sobe um pouco no meio (quebra em cima do peito do pé)
  const ank = limbWidthAt(an, 'shin', s, 1);
  const yC = an.foot.soleY - 2.2;
  const drop = 1.6;
  const kx = (yC + drop - ank.at[1]) / (ank.dir[1] || 1);
  const hemC: Pt = [ank.at[0] + ank.dir[0] * kx, yC + drop];
  // o canto de dentro da barra cai menos (as duas pernas se encostam: a ponta de trás não espia embaixo da outra)
  const dropOf = (w: Which) => (w === out ? drop : drop * 0.4);
  const cornerOf = (w: Which): Pt => {
    const p = raw(2, w);
    const k = (yC + dropOf(w) - ank.at[1]) / (ank.dir[1] || 1);
    return [p[0] + ank.dir[0] * k, yC + dropOf(w)];
  };
  // queda reta do lado de fora: do quadril (largura do tronco com folga) até a quina da barra
  const yHip = an.hipY - 0.5;
  const H: Pt = [torsoXAt(an, s, yHip, E), yHip];
  const C = cornerOf(out);
  const lineX = (y: number) => H[0] + ((C[0] - H[0]) * (y - H[1])) / (C[1] - H[1] || 1);
  const edge = (u: number, w: Which): Pt => {
    const p = raw(u, w);
    if (w !== out || p[1] <= yHip) return p;
    const lx = lineX(p[1]);
    return [sg > 0 ? Math.max(p[0], lx) : Math.min(p[0], lx), p[1]];
  };
  const at = (u: number, f: number): Pt => {
    const a = edge(u, 'l');
    const b = edge(u, 'r');
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  };
  const STEP = 0.125;
  const us = (u0: number, u1: number): number[] => {
    const r = [u0];
    for (let u = Math.ceil(u0 / STEP + 1e-6) * STEP; u < u1 - 1e-6; u += STEP) r.push(u);
    r.push(u1);
    return r;
  };
  const sideL = (u0: number, u1: number, w: Which): SP[] => {
    const pts = us(u0, u1).map((u) => edge(u, w) as SP);
    // topo: o lado de fora sai da lateral do quadril (um pouco por dentro do quadril da calça, que fica por cima)
    if (u0 === 0 && w === out) return [[torsoXAt(an, s, yHip - 2.5, underHemEase(ctx, yHip - 2.5, E - 0.4)), yHip - 2.5, 0], [torsoXAt(an, s, yHip, underHemEase(ctx, yHip, E - 0.3)), yHip], ...pts.filter((p) => p[1] > yHip + 0.6)];
    return pts;
  };
  const hw = { l: WH.l, r: WH.r };
  const corner = (p: SP): SP => [p[0], p[1], 0];
  const outline = (u0: number, u1: number, clampIn?: number): string => {
    const L = sideL(u0, u1, 'l');
    const R = sideL(u0, u1, 'r').reverse();
    const inn = out === 'l' ? R : L;
    if (clampIn != null) for (let i = 0; i < inn.length; i++) inn[i] = [sg < 0 ? Math.min(inn[i][0], clampIn) : Math.max(inn[i][0], clampIn), inn[i][1]];
    if (u0 > 0) {
      L[0] = corner(L[0]);
      R[R.length - 1] = corner(R[R.length - 1]);
    } else if (out === 'l') {
      // topo do lado de dentro: sobe até o gancho (fica por baixo do quadril da calça)
      const p = R[R.length - 1];
      R.push([p[0], Math.min(p[1], yHip) - 2.5, 0]);
    } else {
      const p = L[0];
      L.unshift([p[0], Math.min(p[1], yHip) - 2.5, 0]);
    }
    const mid: SP[] = [];
    if (u1 >= 2) {
      const cl = cornerOf('l');
      const cr = cornerOf('r');
      mid.push([cl[0], cl[1], 0.5], [hemC[0] - hw.l * 0.7, yC + dropOf('l') * 0.52], [hemC[0] - hw.l * 0.25, yC + 0.12], [hemC[0] + hw.r * 0.25, yC + 0.12], [hemC[0] + hw.r * 0.7, yC + dropOf('r') * 0.52], [cr[0], cr[1], 0.5]);
      if (clampIn != null) {
        // corta a barra no x do limite, na altura que a curva tem ali (sem aba pendurada)
        const yAt = (x: number): number => {
          for (let i = 1; i < mid.length; i++) {
            const a = mid[i - 1];
            const b = mid[i];
            if ((x - a[0]) * (x - b[0]) <= 0) return a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0] || 1);
          }
          return yC + 0.12;
        };
        const yc = yAt(clampIn);
        const keep = mid.filter((p) => (p[0] - clampIn) * sg >= 0);
        if (sg < 0) mid.splice(0, mid.length, ...keep, [clampIn, yc, 0]);
        else mid.splice(0, mid.length, [clampIn, yc, 0], ...keep);
      }
    } else {
      L[L.length - 1] = corner(L[L.length - 1]);
      R[0] = corner(R[0]);
    }
    return smoothPath([...L, ...mid, ...R], true);
  };
  const outerX = (y: number): number => {
    const pts = sideL(0, 1.2, out);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (y <= b[1]) return a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1] || 1);
    }
    return pts[pts.length - 1][0];
  };
  return {
    s,
    E,
    at,
    outline,
    outerX,
    grad: legGrad(ctx, s, E + 2.0, legStops(t, 'crepe')),
    knee: limbWidthAt(an, 'thigh', s, 1).at,
    kneeR: Math.min(WK.l, WK.r) - 0.2,
    hem: { c: hemC, wl: hw.l, wr: hw.r, yC, drop },
    yHip,
  };
}

/** detalhes da pantalona (mesmos traços em todo pedaço; cada pedaço recorta no seu contorno `d`) */
function wideDetails(ctx: LayerCtx, g: WideGeo, t: Tones, d: string, part: 'up' | 'lo'): void {
  const lite = isLite(ctx);
  const c = ctx.col.bottom;
  const path = (u0: number, u1: number, f: (u: number) => number, n: number): SP[] => {
    const r: SP[] = [];
    for (let i = 0; i <= n; i++) {
      const u = u0 + ((u1 - u0) * i) / n;
      r.push(g.at(u, f(u)));
    }
    return r;
  };
  if (part === 'up') {
    // luz larga na frente da coxa (do lado da luz) e a dobra macia que nasce do gancho
    const m = g.at(0.55, 0.3);
    const w = Math.abs(g.at(0.55, 1)[0] - g.at(0.55, 0)[0]);
    ctx.push(blob(m[0], m[1], w * 0.16, 7, 0.04), t.light, { o: 0.3, ...(lite ? {} : { b: 1.4 }), cp: d });
    if (!lite) {
      const inner = g.s === 'L' ? 0.82 : 0.18;
      creases(ctx, [{ spine: path(0.22, 0.6, (u) => inner + (g.s === 'L' ? -1 : 1) * (u - 0.22) * 0.25, 2), w: 0.6 }], c, { o: 0.3, cp: d });
    }
  } else {
    // pregas longas que caem do joelho até a barra (abrem com o alargamento)
    const fs = lite ? [0.32, 0.7] : [0.26, 0.52, 0.78];
    creases(ctx, fs.map((f, i) => ({ spine: path(1.18 + i * 0.04, 2, (u) => f + (f - 0.5) * (u - 1.18) * 0.18, 3), w: 0.85 })), c, { o: 0.32, cp: d });
    // barra: dobra logo acima e a sombra fina da bainha
    const { c: hc, wl, wr, yC, drop } = g.hem;
    creases(ctx, [{ spine: [[hc[0] - wl * 0.8, yC - 1.4], [hc[0] + 0.3, yC - 2.0], [hc[0] + wr * 0.85, yC - 1.3]], w: 0.6 }], c, { o: 0.3, cp: d });
    ctx.push(taperPath([[hc[0] - wl, yC + drop * 0.76], [hc[0] - wl * 0.5, yC + 0.15], [hc[0], yC - 0.1], [hc[0] + wr * 0.5, yC + 0.15], [hc[0] + wr, yC + drop * 0.76]], [0.5, 0.7, 0.75, 0.7, 0.5]), t.deep, { o: 0.35, cp: d });
  }
  // vinco passado (frente da perna, quadril → barra) e costura lateral: um traço só pra perna inteira
  const crease = path(0.12, 1.97, () => 0.47, 10);
  ctx.stroke(smoothPath(crease, false), t.light, lite ? 0.32 : 0.28, { o: 0.7, cp: d });
  if (!lite) ctx.stroke(smoothPath(crease.map((p) => [p[0] + 0.34, p[1]] as SP), false), t.shade, 0.3, { o: 0.45, b: 0.15, cp: d });
  const seamF = g.s === 'L' ? 0.06 : 0.94;
  ctx.stroke(smoothPath(path(0.1, 1.97, () => seamF, 10), false), t.deep, 0.22, { o: 0.4, cp: d });
}

function wideTrousers(ctx: LayerCtx, st: PantStyle, t: Tones): void {
  const c = ctx.col.bottom;
  for (const s of SIDES) {
    const g = wideGeo(ctx, s, t);
    ctx.withGroup(legG(s), () => {
      ctx.push(ellipse(g.knee[0], g.knee[1], g.kneeR, g.kneeR), c, { gf: g.grad });
      const up = g.outline(0, 1.1);
      ctx.push(up, c, { gf: g.grad });
      wideDetails(ctx, g, t, up, 'up');
    });
    ctx.withGroup(shinG(s), () => {
      const lo = g.outline(0.9, 2);
      ctx.push(lo, c, { gf: g.grad });
      wideDetails(ctx, g, t, lo, 'lo');
    });
  }
  ctx.withGroup('body', () => pantHip(ctx, 'wide', st, t, wideGeo(ctx, 'L', t).E));
}

/** coxa da calça (grupo legX) */
function pantThigh(ctx: LayerCtx, s: Side, kind: string, st: PantStyle, t: Tones, E: number, grad: AvatarGradient): void {
  const { an } = ctx;
  const lite = isLite(ctx);
  const c = ctx.col.bottom;
  const sg = outSign(s);
  const d = thighPath(an, s, { ease: E, flare: st.flareT });
  const kn = s === 'L' ? an.joints.kneeL : an.joints.kneeR;
  const hp = s === 'L' ? an.joints.hipL : an.joints.hipR;
  // sentado: a coxa é vista de cima (plano do colo claro, frente do joelho mais escura embaixo)
  const lap: AvatarGradient = { t: 'l', x1: kn[0], y1: kn[1] - 6, x2: kn[0], y2: kn[1] + 5, s: [[0, t.light], [0.45, t.base], [0.8, t.shade], [1, t.deep]] };
  ctx.push(d, c, { gf: an.seated && st.mat !== 'metal' ? lap : grad });
  hipBridge(ctx, s, E, st.flareT, c, grad);
  // lado de dentro (encosta na outra coxa) mais escuro
  const ins = limbWidthAt(an, 'thigh', s, 0.25);
  if (!lite) ctx.push(blob(ins.at[0] - sg * (s === 'L' ? ins.r : ins.l) * 0.7, ins.at[1] + 2, 1.5, an.seated ? 3 : 6.5), t.deep, { o: st.mat === 'lycra' ? 0.36 : 0.3, b: 1.2, cp: d });

  if (!an.seated) {
    const m = limbWidthAt(an, 'thigh', s, 0.46);
    const mw = (s === 'L' ? m.l : m.r) * 0.6;
    // a luz da coxa termina (com o desfoque) ANTES da tampa redonda da canela, que passa por cima perto do joelho —
    // senão a canela corta a luz num arco ("joelheira")
    const capTop = kn[1] - (an.spec.knee + E) - 2.2;
    const ry = (want: number, y: number) => Math.max(3, Math.min(want, capTop - y));
    const my = m.at[1] - 1.2;
    // jeans: desbotado claro e largo na frente da coxa (o sinal de denim que se lê na grade de 150 px; a calça é lisa)
    if (st.mat === 'denim') ctx.push(blob(m.at[0] - 0.4, my, mw * 1.15, ry(7.2, my), 0.04), mix(c, '#E8F0FF', kind === 'ripped' ? 0.46 : 0.38), { o: kind === 'ripped' ? 0.62 : 0.55, b: 1.6, cp: d });
    else if (st.mat === 'lycra') sheen(ctx, 'thigh', s, d, t, 0.1, 0.92, 0.42);
    else if (st.mat === 'metal') metalStreaks(ctx, 'thigh', s, d, t);
    else if (st.mat === 'knit') ctx.push(blob(m.at[0] - 0.6, my, mw * 0.9, ry(6.5, my), 0.04), t.light, { o: 0.32, b: 1.6, cp: d });
    else ctx.push(blob(m.at[0] - 0.7, my, mw * 0.7, ry(7, my), 0.04), t.light, { o: st.mat === 'crepe' ? 0.34 : 0.26, b: 1.4, cp: d });
  }

  // trama (sarja no jeans; sarja leve na calça e na cargo), só no completo
  if (!lite && (st.mat === 'denim' || st.mat === 'twill')) {
    const tb0 = limbWidthAt(an, 'thigh', s, 0);
    const tb1 = limbWidthAt(an, 'thigh', s, 1);
    const bx = Math.min(tb0.at[0], tb1.at[0]) - 10;
    const by = Math.min(tb0.at[1], tb1.at[1]) - 9;
    weave(ctx, d, { x: bx, y: by, w: 20, h: Math.abs(tb1.at[1] - tb0.at[1]) + 14 }, c, { gap: st.mat === 'denim' ? 0.8 : 0.62, o: st.mat === 'denim' ? 0.05 : 0.035, light: true });
  }
  // bigodes do jeans perto do gancho
  if (!lite && !an.seated && st.mat === 'denim') {
    const g = limbWidthAt(an, 'thigh', s, 0.12);
    const inn = -sg;
    let wh = '';
    for (let i = 0; i < 3; i++) {
      const y = g.at[1] + i * 1.35;
      wh += taperPath([[g.at[0] + inn * (s === 'L' ? g.r : g.l) * 0.95, y + 0.9 + i * 0.2], [g.at[0] + inn * 0.6, y], [g.at[0] - inn * 1.4, y - 0.7]], [0.1, 0.45, 0]);
    }
    ctx.push(wh, mix(c, '#E8F0FF', 0.3), { o: 0.4, b: 0.25, cp: d });
  }
  // vinco da alfaiataria (frente da perna, do quadril ao joelho): crista de luz + sombra fina do lado direito
  if (kind === 'tailored' || kind === 'wide' || kind === 'pants') pressCrease(ctx, 'thigh', s, d, t, an.seated ? 0.35 : 0.0, 1.0);
  // costura lateral (lado de fora): linha fina e lisa + pesponto cor de linha bem leve
  if (st.mat !== 'lycra' || !lite) {
    const pts: SP[] = [0.06, 0.4, 0.8, 1.0].map((tt) => edgePt(ctx, 'thigh', s, tt, outW(s), E + 0.3 * tt - 0.8));
    // lite: no jeans só o pesponto caramelo (a linha escura da costura não se lê nesse tamanho)
    if (!lite || st.mat !== 'denim') ctx.stroke(smoothPath(pts, false), t.deep, 0.22, { o: st.mat === 'metal' ? 0.25 : 0.4, cp: d });
    if (st.mat === 'denim') ctx.stroke(smoothPath(pts.map((p) => [p[0] - sg * 0.36, p[1]] as SP), false), threadOf(c), lite ? 0.38 : 0.28, { o: lite ? 0.5 : 0.62, cp: d });
    else if (!lite && st.mat === 'twill') ctx.stroke(smoothPath(pts.map((p) => [p[0] - sg * 0.32, p[1]] as SP), false), threadOf(c), 0.14, { o: 0.35, cp: d });
  }
  if (kind === 'cargo') cargoPocket(ctx, s, d, t, E);
  if (kind === 'joggers' && !lite) ctx.stroke(smoothPath([0.04, 0.5, 1].map((tt) => edgePt(ctx, 'thigh', s, tt, outW(s), E - 0.55)), false), t.light, 0.42, { o: 0.4, cp: d });
  if (kind === 'ripped' && !an.seated && s === (an.rest.weight === 'L' ? 'R' : 'L')) rip(ctx, 'thigh', s, d, 0.5, 0.55, 3.2);
  if (kind === 'ripped' && an.seated) rip(ctx, 'thigh', s, d, 0.82, 0.62, 1.6);

  // dobras macias que nascem do gancho e da virilha (calça larga e pantalona caem com mais tecido)
  if (!an.seated && (st.mat === 'twill' || st.mat === 'crepe' || st.mat === 'knit')) {
    const g = limbWidthAt(an, 'thigh', s, 0.2);
    const k2 = limbWidthAt(an, 'thigh', s, 0.85);
    creases(
      ctx,
      [
        { spine: [[g.at[0] - sg * 1.5, g.at[1] - 1.2], [g.at[0] + sg * 0.4, g.at[1] + 2.2], [g.at[0] + sg * 1.2, g.at[1] + 5.0]], w: 0.6 },
        { spine: [[k2.at[0] - 2.2, k2.at[1] - 1.0], [k2.at[0] - 0.2, k2.at[1] - 0.2], [k2.at[0] + 1.9, k2.at[1] - 1.3]], w: 0.55 },
      ],
      c,
      { o: 0.32, cp: d },
    );
  }
  if (an.seated) seatedLap(ctx, s, d, t, c, hp, kn);
}

/** canela da calça (grupo shinX) */
function pantShin(ctx: LayerCtx, s: Side, kind: string, st: PantStyle, t: Tones, Es: number, grad: AvatarGradient): void {
  const { an } = ctx;
  const lite = isLite(ctx);
  const c = ctx.col.bottom;
  const sg = outSign(s);
  const endExt = an.seated ? Math.min(st.endExt, 0.6) - 0.8 : st.endExt;
  // bota alta: a perna da calça termina logo abaixo da boca do cano (senão a calça larga espia do lado do cano)
  const shaft = shaftT(ctx);
  const d = shinPath(an, s, { ease: Es, flare: st.flareS, endExt, to: shaft != null ? shaft + 0.08 : undefined });
  ctx.push(d, c, { gf: grad });
  const a = limbWidthAt(an, 'shin', s, 0);
  const b = limbWidthAt(an, 'shin', s, 1);
  if (an.seated) ctx.push(blob(a.at[0] + 0.3, a.at[1] + 3.0, (s === 'L' ? a.l : a.r) * 1.2, 2.2), t.deep, { o: 0.42, b: 0.9, cp: d });
  else if (st.mat === 'denim') {
    const wash = mix(c, '#E8F0FF', 0.36);
    ctx.push(blob(a.at[0] - 0.5, a.at[1] + 2.4, (s === 'L' ? a.l : a.r) * 0.72, 3.4), wash, { o: 0.42, b: 1.2, cp: d });
    if (!lite) {
      const kw = (s === 'L' ? a.l : a.r) * 0.7;
      ctx.push(taperPath([[a.at[0] - kw, a.at[1] - 0.6], [a.at[0] - 0.2, a.at[1] - 0.9], [a.at[0] + kw * 0.8, a.at[1] - 0.5]], [0, 0.4, 0]) + taperPath([[a.at[0] - kw * 0.7, a.at[1] + 0.7], [a.at[0] + 0.1, a.at[1] + 0.45], [a.at[0] + kw * 0.9, a.at[1] + 0.8]], [0, 0.34, 0]), wash, { o: 0.35, b: 0.2, cp: d });
    }
  } else if (st.mat === 'lycra') sheen(ctx, 'shin', s, d, t, 0.0, 0.95, 0.36);
  else if (st.mat === 'metal') metalStreaks(ctx, 'shin', s, d, t);
  if (!lite && (st.mat === 'denim' || st.mat === 'twill')) {
    weave(ctx, d, { x: Math.min(a.at[0], b.at[0]) - 9, y: a.at[1] - 6, w: 18, h: b.at[1] - a.at[1] + 10 }, c, { gap: st.mat === 'denim' ? 0.8 : 0.62, o: st.mat === 'denim' ? 0.05 : 0.035, light: true });
  }
  if (kind === 'tailored' || kind === 'wide' || kind === 'pants') pressCrease(ctx, 'shin', s, d, t, 0, kind === 'wide' ? 0.97 : 0.9);
  // dobras: joelho (perna livre) e a quebra perto da barra; pantalona: pregas longas que caem do joelho
  const free = an.rest.weight != null && an.rest.weight !== s && !an.seated;
  const list: { spine: SP[]; w: number }[] = [];
  if (kind === 'wide') {
    const n = lite ? 2 : 3;
    for (let i = 0; i < n; i++) {
      const k = (i + 0.5) / n - 0.5;
      const top = edgePt(ctx, 'shin', s, 0.15, k < 0 ? 'l' : 'r', Es * Math.abs(k) * 1.4 - 2.2);
      const bot = edgePt(ctx, 'shin', s, 1, k < 0 ? 'l' : 'r', Es + st.flareS * Math.abs(k) * 1.6 - 3.6, 0);
      list.push({ spine: [[top[0] + k * 2, top[1]], [(top[0] + bot[0]) / 2 + k * 2.5, (top[1] + bot[1]) / 2], [bot[0] + k * 2.5, bot[1] + 2]], w: 0.9 });
    }
  } else if (kind === 'joggers') {
    // tecido franzindo acima do punho
    for (let i = 0; i < (lite ? 1 : 3); i++) {
      const y = b.at[1] - 3.2 - i * 1.5;
      const w0 = (s === 'L' ? b.l : b.r) + Es - 0.6 + i * 0.3;
      list.push({ spine: [[b.at[0] - w0, y + 0.5 - i * 0.1], [b.at[0] - 0.3 + i * 0.4, y - 0.3], [b.at[0] + w0 * 0.9, y + 0.6]], w: 0.75 });
    }
  } else if (kind !== 'leggings' && kind !== 'metallic' && !lite) {
    list.push({ spine: [[b.at[0] - 2.6, b.at[1] - 2.6], [b.at[0] - 0.4, b.at[1] - 1.9], [b.at[0] + 2.4, b.at[1] - 2.7]], w: 0.7 });
    list.push({ spine: [[b.at[0] - 2.2, b.at[1] - 0.6], [b.at[0] + 0.5, b.at[1] - 0.1], [b.at[0] + 2.8, b.at[1] - 0.8]], w: 0.65 });
  }
  if (free && kind !== 'leggings') list.push({ spine: [[a.at[0] - 2.0, a.at[1] + 1.6], [a.at[0] + 0.2, a.at[1] + 2.4], [a.at[0] + 2.0, a.at[1] + 1.8]], w: 0.55 });
  if (list.length) creases(ctx, list, c, { o: kind === 'wide' ? 0.34 : 0.4, cp: d });
  // costura lateral
  const pts: SP[] = [0.0, 0.5, 1.0].map((tt) => {
    const p = edgePt(ctx, 'shin', s, tt, outW(s), Es + st.flareS * tt - 0.8);
    return [p[0], p[1] + tt * 1.6];
  });
  if (!lite || st.mat !== 'denim') ctx.stroke(smoothPath(pts, false), t.deep, 0.22, { o: st.mat === 'metal' ? 0.25 : 0.4, cp: d });
  if (st.mat === 'denim') ctx.stroke(smoothPath(pts.map((p) => [p[0] - sg * 0.36, p[1]] as SP), false), threadOf(c), lite ? 0.38 : 0.28, { o: lite ? 0.5 : 0.62, cp: d });
  else if (!lite && st.mat === 'twill') ctx.stroke(smoothPath(pts.map((p) => [p[0] - sg * 0.32, p[1]] as SP), false), threadOf(c), 0.14, { o: 0.35, cp: d });
  if (kind === 'joggers' && !lite) ctx.stroke(smoothPath([0, 0.5, 0.86].map((tt) => edgePt(ctx, 'shin', s, tt, outW(s), Es - 0.55, -1.0)), false), t.light, 0.42, { o: 0.4, cp: d });
  if (kind === 'ripped' && !an.seated) rip(ctx, 'shin', s, d, 0.1, 0.7, 2.0);
}

/**
 * contorno do quadril da calça: o tronco com folga, mas abaixo do quadril a lateral vira pra dentro e encontra a borda
 * de fora da coxa (senão o quadril largo do Curvilíneo/Plus forma um "degrau" de fralda em cima da coxa).
 */
function hipOutline(ctx: LayerCtx, top: number, E: number, flareT: number, wideOuter?: [(y: number) => number, (y: number) => number]): string {
  const { an } = ctx;
  if (an.seated) return torsoPath(an, { top, ease: E });
  // por baixo da barra da parte de cima o quadril fica na largura do corpo (a barra arredondada da camiseta não deixa
  // lasca do cós aparecer do lado, entre a barra e o braço); só abaixo dela ganha a folga da calça
  // cós à mostra (cropped): o topo do quadril também segue o corpo (o cós por cima dele já abre até a folga)
  const eAt = (y: number) => (waistShown(ctx.cfg) && y < top + 2.0 ? Math.min(E, 0.25) : underHemEase(ctx, y, E));
  if (wideOuter) {
    // pantalona: o quadril termina na altura em que o gradiente dele casa com o das pernas (hipGradFromLegs), e a
    // lateral encontra a queda reta da perna exatamente ali — a emenda quadril/perna some
    const yB = an.torsoBottom - 1.2;
    const yH = an.hipY - 0.5;
    const tilt = (y: number) => an.tilt.hip * 0.5 * Math.max(0, Math.min(1, (y - an.waistY + 2) / (an.hipY - an.waistY || 1)));
    const side = (s: Side, ox: (y: number) => number): SP[] => {
      const y0 = top + (s === 'L' ? -1 : 1) * tilt(top);
      const pts: SP[] = [[torsoXAt(an, s, y0, eAt(y0)), y0, 0]];
      for (const k of [0.4, 0.75, 1]) {
        const y = y0 + (yH - y0) * k;
        pts.push([torsoXAt(an, s, y, eAt(y)), y]);
      }
      pts.push([ox(yB), yB, 0.5]);
      return pts;
    };
    const pc = an.cx + an.pelvis;
    return smoothPath([...side('L', wideOuter[0]), [pc - 3, yB + 0.4], [pc, yB + 1.4], [pc + 3, yB + 0.4], ...side('R', wideOuter[1]).reverse()], true);
  }
  // mesma inclinação do quadril que o torsoPts usa nos cortes (cós acompanha a barra da parte de cima)
  const tiltAt = (y: number) => an.tilt.hip * 0.5 * Math.max(0, Math.min(1, (y - an.waistY + 2) / (an.hipY - an.waistY || 1)));
  const yHip = an.hipY - 0.5;
  const side = (s: Side): SP[] => {
    const sg = s === 'L' ? -1 : 1;
    const y0 = top + sg * tiltAt(top);
    const pts: SP[] = [[torsoXAt(an, s, y0, eAt(y0)), y0, 0]];
    for (const k of [0.4, 0.75, 1]) {
      const y = y0 + (yHip - y0) * k;
      pts.push([torsoXAt(an, s, y, eAt(y)), y]);
    }
    // abaixo do quadril: a lateral desce pela borda de fora da coxa (com folga), nada de degrau
    for (const tt of [0.16, 0.3]) {
      const p = edgePt(ctx, 'thigh', s, tt, outW(s), E, flareT);
      pts.push([p[0], Math.max(p[1], yHip + 1)]);
    }
    return pts;
  };
  const L = side('L');
  const R = side('R');
  const pc = an.cx + an.pelvis;
  const mid = (L[L.length - 1][1] + R[R.length - 1][1]) / 2;
  const crotch: SP[] = [[pc - 2.6, Math.min(mid, an.torsoBottom + 0.3)], [pc, an.torsoBottom + 0.9], [pc + 2.6, Math.min(mid, an.torsoBottom + 0.3)]];
  return smoothPath([...L, ...crotch, ...R.reverse()], true);
}

/**
 * folga da lateral da calça em y: por baixo da barra da parte de cima fica na largura do corpo (a barra arredondada da
 * camiseta não deixa lasca do cós/quadril aparecer do lado, entre a barra e o braço); abaixo dela, a folga da calça
 */
function underHemEase(ctx: LayerCtx, y: number, E: number): number {
  if (waistShown(ctx.cfg)) return E;
  return y < pantsTopY(ctx) + 3.0 ? Math.min(E, 0.1) : E;
}

/**
 * ponte quadril → coxa (grupo legX, mesmo gradiente da coxa): no corpo de quadril largo a lateral do quadril passa da
 * borda da coxa; esta cunha desce da lateral do quadril e afina até a borda da coxa no meio dela, então a silhueta da
 * calça segue a curva do quadril sem "degrau". Some sozinha quando a coxa já é mais larga que o quadril.
 */
function hipBridge(ctx: LayerCtx, s: Side, E: number, flare: number, fill: string, grad: AvatarGradient, to = 0.55): string | null {
  const { an } = ctx;
  if (an.seated) return null;
  const sg = outSign(s);
  const yHip = an.hipY - 0.5;
  const hx = torsoXAt(an, s, yHip, E);
  const hj = s === 'L' ? an.joints.hipL : an.joints.hipR;
  const kn = s === 'L' ? an.joints.kneeL : an.joints.kneeR;
  const tHip = Math.max(0, (yHip - hj[1]) / (kn[1] - hj[1] || 1));
  const e0 = edgePt(ctx, 'thigh', s, tHip, outW(s), E, flare);
  if ((hx - e0[0]) * sg < 0.25) return null;
  const outer: SP[] = [[torsoXAt(an, s, yHip - 2.5, underHemEase(ctx, yHip - 2.5, E)), yHip - 2.5], [torsoXAt(an, s, yHip, underHemEase(ctx, yHip, E)), yHip]];
  const n = 4;
  for (let i = 1; i <= n; i++) {
    const tt = tHip + ((to - tHip) * i) / n;
    const e = edgePt(ctx, 'thigh', s, tt, outW(s), E, flare);
    const k = i / n;
    const w = 1 - k * k * (3 - 2 * k);
    // largura do quadril que se dissolve na coxa (quadril cheio: curva macia, sem quina)
    outer.push([e[0] + (hx - e[0]) * w * (1 - 0.15 * k), e[1]]);
  }
  const axTo = limbWidthAt(an, 'thigh', s, to).at;
  const axTop = limbWidthAt(an, 'thigh', s, 0).at;
  const d = smoothPath([...outer, [axTo[0], axTo[1], 0], [axTop[0], yHip - 2.5, 0]], true);
  ctx.push(d, fill, { gf: grad });
  return d;
}

/** quadril da calça (grupo do tronco): cobre o topo das coxas; bolsos, braguilha e gancho por material */
function pantHip(ctx: LayerCtx, kind: string, st: PantStyle, t: Tones, E: number): void {
  const { an } = ctx;
  const { cx } = an;
  const lite = isLite(ctx);
  const c = ctx.col.bottom;
  const top = pantsTopY(ctx);
  const wide = wideOn(ctx, kind);
  const d = wide ? hipOutline(ctx, top, E, 0, [wideGeo(ctx, 'L', t).outerX, wideGeo(ctx, 'R', t).outerX]) : hipOutline(ctx, top, E, st.flareT);
  ctx.push(d, c, { gf: an.seated ? hipGrad(ctx, t, st.mat) : hipGradFromLegs(ctx, E + (wide ? 2.0 : 0.4), legStops(t, st.mat)) });
  const hipY = an.hipY;
  // pantalona: o quadril termina acima do gancho (as pernas contínuas cobrem o resto)
  const crotch = an.seated ? an.hj + 1.4 : wide ? an.torsoBottom - 1.2 : an.torsoBottom;
  if (st.mat === 'denim' || kind === 'pants' || kind === 'cargo') {
    // bolsos da frente: curva no jeans, diagonal na calça de sarja
    const curve = st.mat === 'denim';
    const pocket = (g: number) =>
      smoothPath(
        curve
          ? [
              [cx + g * (an.w.waist - 2.6), top + 0.6],
              [cx + g * (an.w.waist - 1.2), top + 3.6],
              [torsoXAt(an, g < 0 ? 'L' : 'R', hipY - 3.5, E) - g * 0.5, hipY - 3.5],
            ]
          : [
              [cx + g * (an.w.waist - 2.2), top + 0.4],
              [torsoXAt(an, g < 0 ? 'L' : 'R', hipY - 2.2, E) - g * 0.4, hipY - 2.2],
            ],
        false,
      );
    ctx.stroke(pocket(-1) + pocket(1), t.deep, 0.3, { o: 0.5, cp: d });
    if (!lite) ctx.stroke(pocket(-1) + pocket(1), curve ? mix(c, '#E8F0FF', 0.3) : t.light, 0.16, { o: 0.4, cp: d });
    if (!lite) ctx.stroke(smoothPath([[cx + 1.7, top + 1], [cx + 1.8, crotch - 3.0], [cx + 0.3, crotch - 0.9]], false), threadOf(c), 0.16, { o: curve ? 0.45 : 0.3, cp: d });
  } else if (st.mat === 'wool' || st.mat === 'crepe') {
    // bolso faca discreto junto da costura lateral e pregas que viram o vinco
    let pk = '';
    for (const g of [-1, 1]) {
      const x0 = torsoXAt(an, g < 0 ? 'L' : 'R', top + 1.2, E) - g * 1.4;
      const x1 = torsoXAt(an, g < 0 ? 'L' : 'R', hipY - 1.2, E) - g * 0.6;
      pk += smoothPath([[x0, top + 1.2], [x1, hipY - 1.2]], false);
    }
    ctx.stroke(pk, t.deep, 0.28, { o: 0.45, cp: d });
    if (!lite) {
      for (const s of SIDES) {
        const hj = s === 'L' ? an.joints.hipL : an.joints.hipR;
        creases(ctx, [{ spine: [[hj[0] - 0.6, top + 1.2], [hj[0] - 0.3, (top + crotch) / 2], [hj[0], crotch + 1]], w: 0.45 }], c, { o: 0.3, cp: d });
      }
    }
  } else if (st.mat === 'lycra') {
    // costura central curva (legging de cintura alta), sem bolsos
    if (!lite) ctx.stroke(smoothPath([[cx - 4.5, top + 0.4], [cx - 1.2, crotch - 3.2], [cx, crotch - 0.6]], false) + smoothPath([[cx + 4.5, top + 0.4], [cx + 1.2, crotch - 3.2], [cx, crotch - 0.6]], false), t.deep, 0.22, { o: 0.4, cp: d });
  } else if (st.mat === 'metal') {
    metalHip(ctx, d, t, top, crotch);
  }
  // braguilha (calças de botão) e sombra do gancho
  if (!lite && st.mat !== 'lycra' && st.mat !== 'knit' && st.mat !== 'metal') ctx.stroke(smoothPath([[cx + 0.1, top + 0.8], [cx + 0.1, crotch - 1.2]], false), t.deep, 0.26, { o: 0.5, cp: d });
  ctx.push(blob(cx, crotch - 0.4, 2.8, 1.7), t.deep, { o: 0.4, b: 0.8, cp: d });
  if (st.mat === 'knit' && !lite && !an.seated) creases(ctx, [{ spine: [[cx - 3.2, crotch - 3.6], [cx - 0.6, crotch - 1.2], [cx + 0.4, crotch - 0.4]], w: 0.6 }, { spine: [[cx + 3.4, crotch - 3.8], [cx + 0.8, crotch - 1.4], [cx - 0.2, crotch - 0.4]], w: 0.55 }], c, { o: 0.34, cp: d });
  if (waistShown(ctx.cfg)) waistband(ctx, top, st.mat, t, E);
}

/** cós aparente (parte de cima curta): faixa com passantes e botão, ou elástico com cordão (malha/legging) */
function waistband(ctx: LayerCtx, y: number, mat: Mat, t: Tones, E: number): void {
  const { an } = ctx;
  const { cx } = an;
  const c = ctx.col.bottom;
  const lite = isLite(ctx);
  const elastic = mat === 'knit' || mat === 'lycra';
  const h = elastic ? 3.0 : 2.3;
  // a borda de cima do cós segue a largura do CORPO nessa altura (sai de baixo da barriga à mostra sem "orelhas" nos
  // cantos no corpo de cintura fina) e só embaixo ganha a folga da calça
  const tl0 = an.tilt.hip * 0.3;
  const band = smoothPath([[torsoXAt(an, 'L', y, 0.25), y - tl0, 0.3], [cx, y + 0.1], [torsoXAt(an, 'R', y, 0.25), y + tl0, 0.3], [torsoXAt(an, 'R', y + h, E + 0.1), y + h + tl0, 0.3], [cx, y + h + 0.3], [torsoXAt(an, 'L', y + h, E + 0.1), y + h - tl0, 0.3]], true);
  ctx.push(band, c, { gf: hipGrad(ctx, { ...t, light: mix(t.light, '#FFFFFF', elastic ? 0.1 : 0) }, mat) });
  const tl = an.tilt.hip * 0.3;
  ctx.push(taperPath([[torsoXAt(an, 'L', y + h, 1), y + h + 0.1 - tl], [cx, y + h + 0.3], [torsoXAt(an, 'R', y + h, 1), y + h + 0.1 + tl]], [0.5, 0.6, 0.5]), t.deep, { o: 0.4, b: lite ? 0 : 0.25 });
  if (elastic) {
    if (!lite) {
      let rib = '';
      for (let x = cx - an.w.waist; x <= cx + an.w.waist; x += 0.9) rib += `M${x.toFixed(2)},${(y + 0.3).toFixed(2)}V${(y + h - 0.3).toFixed(2)}`;
      ctx.stroke(rib, t.shade, 0.16, { o: 0.35, cp: band });
    }
    if (mat === 'knit') {
      // cordão com ponteiras
      ctx.stroke(smoothPath([[cx - 0.8, y + 1.4], [cx - 1.4, y + 4.2], [cx - 1.0, y + 7.0]], false) + smoothPath([[cx + 0.8, y + 1.4], [cx + 1.2, y + 4.0], [cx + 1.6, y + 6.4]], false), '#F2F0EA', 0.45);
      ctx.push(ellipse(cx - 1.0, y + 7.2, 0.32, 0.55) + ellipse(cx + 1.6, y + 6.6, 0.32, 0.55), '#C8C4BA');
    }
    return;
  }
  let loops = '';
  for (const k of [-0.82, -0.42, 0.42, 0.82]) {
    const yy = y + an.tilt.hip * 0.5 * k;
    // passantes dentro da faixa: fração da largura real do tronco nessa altura (não do quadril, que é mais largo)
    const edge = torsoXAt(an, k < 0 ? 'L' : 'R', yy + 1, E);
    const x = cx + (edge - cx) * Math.abs(k) * 0.98;
    loops += smoothPath([[x - 0.45, yy - 0.3, 0], [x + 0.45, yy - 0.3, 0], [x + 0.45, yy + 2.6, 0], [x - 0.45, yy + 2.6, 0]], true, 0);
  }
  ctx.push(loops, t.shade, { o: 0.9 });
  const metalBtn = mat === 'denim';
  ctx.push(ellipse(cx + 0.2, y + 1.15, 0.65, 0.62), metalBtn ? '#C8B48A' : t.deep, metalBtn ? { gf: { t: 'r', cx, cy: y + 0.9, r: 0.9, s: [[0, '#FFF4D0'], [0.5, '#C8B48A'], [1, '#7A6A48']] } } : {});
}

/** brilho da lycra: faixa clara estreita ao longo da frente do membro */
function sheen(ctx: LayerCtx, limb: 'thigh' | 'shin', s: Side, d: string, t: Tones, t0: number, t1: number, o: number): void {
  const pts: SP[] = [];
  for (const tt of [t0, (t0 + t1) / 2, t1]) {
    const q = limbWidthAt(ctx.an, limb, s, tt);
    const w = s === 'L' ? q.l : q.r;
    pts.push([q.at[0] - w * 0.32, q.at[1]]);
  }
  ctx.push(taperPath(pts, [0.3, 1.25, 0.4]), mix(t.light, '#FFFFFF', 0.4), { o, b: 0.45, cp: d });
}

/**
 * laminado metálico na perna: o reflexo corre AO LONGO da perna (faixa longa e macia do lado da luz, luz rebatida do
 * lado da sombra), nunca em barras horizontais que leem como listra; só uma dobra no joelho e duas no tornozelo
 */
function metalStreaks(ctx: LayerCtx, limb: 'thigh' | 'shin', s: Side, d: string, t: Tones): void {
  const lite = isLite(ctx);
  const an = ctx.an;
  // ponto a uma fração k da meia-largura, pro lado da luz (k > 0, esquerda) ou da sombra (k < 0, direita)
  const P = (tt: number, k: number): SP => {
    const q = limbWidthAt(an, limb, s, tt);
    return k > 0 ? [q.at[0] - (s === 'L' ? q.l : q.r) * k, q.at[1]] : [q.at[0] - (s === 'L' ? q.r : q.l) * k, q.at[1]];
  };
  const t0 = limb === 'thigh' ? 0.02 : 0.0;
  const t1 = limb === 'thigh' ? 1.0 : 0.94;
  const ts = [0, 0.25, 0.5, 0.75, 1].map((k) => t0 + (t1 - t0) * k);
  // o reflexo serpenteia de leve com o volume (mais pra fora na coxa e na panturrilha)
  const hl = taperPath(ts.map((tt, i) => P(tt, 0.44 + (i % 2 ? 0.06 : 0))), [0.25, 0.7, 0.6, 0.7, 0.3]);
  ctx.push(hl, '#FFFFFF', { o: lite ? 0.5 : 0.62, ...(lite ? {} : { b: 0.35 }), cp: d });
  if (lite) return;
  ctx.push(taperPath(ts.map((tt) => P(tt, 0.5)), [0.6, 1.4, 1.3, 1.4, 0.6]), '#FFFFFF', { o: 0.18, b: 0.9, cp: d });
  ctx.push(taperPath(ts.map((tt) => P(tt, -0.64)), [0.1, 0.45, 0.4, 0.45, 0.1]), t.bounce, { o: 0.5, b: 0.3, cp: d });
  let dk = '';
  let lt = '';
  const fold = (sp: SP[], wd: number) => {
    dk += taperPath(sp, [0, wd, 0]);
    lt += taperPath(sp.map((p) => [p[0] - 0.15, p[1] - 0.42] as SP), [0, wd * 0.7, 0]);
  };
  if (limb === 'shin') {
    // joelho: uma dobra diagonal só
    const q = limbWidthAt(an, 'shin', s, 0.05);
    const w = (q.l + q.r) * 0.4;
    fold([[q.at[0] - w, q.at[1] + 0.5], [q.at[0] - w * 0.1, q.at[1] - 0.1], [q.at[0] + w * 0.8, q.at[1] - 0.7]], 0.45);
    // tornozelo: duas dobras curvas que acompanham a boca da calça
    const b = limbWidthAt(an, 'shin', s, 1);
    for (let i = 0; i < 2; i++) {
      const y = b.at[1] - 1.2 - i * 1.6;
      const wl = b.l + 0.6 - i * 0.15;
      const wr = b.r + 0.6 - i * 0.15;
      fold([[b.at[0] - wl, y + 0.5], [b.at[0] - wl * 0.2, y - 0.35 + i * 0.3], [b.at[0] + wr, y + 0.6]], 0.4);
    }
  }
  if (dk) {
    ctx.push(dk, t.deep, { o: 0.38, b: 0.2, cp: d });
    ctx.push(lt, '#FFFFFF', { o: 0.4, b: 0.15, cp: d });
  }
}

function metalHip(ctx: LayerCtx, d: string, t: Tones, top: number, crotch: number): void {
  const { an } = ctx;
  const { cx } = an;
  ctx.push(taperPath([[cx - an.w.hip * 0.62, top + 0.6], [cx - an.w.hip * 0.55, (top + crotch) / 2], [cx - an.w.hip * 0.3, crotch]], [0.3, 1.0, 0.2]), '#FFFFFF', { o: 0.6, b: isLite(ctx) ? 0 : 0.3, cp: d });
  ctx.stroke(smoothPath([[cx - 3.6, top + 0.5], [cx - 1, crotch - 3], [cx, crotch - 0.6]], false) + smoothPath([[cx + 3.6, top + 0.5], [cx + 1, crotch - 3], [cx, crotch - 0.6]], false), t.deep, 0.24, { o: 0.4, cp: d });
}

/** vinco passado (alfaiataria/pantalona): crista de luz no meio da frente da perna + sombra fina ao lado */
function pressCrease(ctx: LayerCtx, limb: 'thigh' | 'shin', s: Side, d: string, t: Tones, t0: number, t1: number): void {
  const pts: SP[] = [];
  for (let i = 0; i <= 3; i++) {
    const tt = t0 + ((t1 - t0) * i) / 3;
    const q = limbWidthAt(ctx.an, limb, s, tt);
    pts.push([q.at[0] + (q.r - q.l) * 0.35 - 0.2, q.at[1]]);
  }
  ctx.stroke(smoothPath(pts, false), t.light, isLite(ctx) ? 0.32 : 0.28, { o: 0.75, cp: d });
  if (!isLite(ctx)) ctx.stroke(smoothPath(pts.map((p) => [p[0] + 0.34, p[1]] as SP), false), t.shade, 0.3, { o: 0.5, b: 0.15, cp: d });
}

/** bolso cargo no lado de fora da coxa: painel com fole, lapela com dois botões e pesponto */
function cargoPocket(ctx: LayerCtx, s: Side, d: string, t: Tones, E: number): void {
  const { an } = ctx;
  const lite = isLite(ctx);
  const c = ctx.col.bottom;
  const o = outW(s);
  const t0 = an.seated ? 0.3 : 0.36;
  const t1 = an.seated ? 0.85 : 0.7;
  const pocketW = (tt: number) => {
    const q = limbWidthAt(an, 'thigh', s, tt);
    return (q.l + q.r) * 0.48;
  };
  const oa = edgePt(ctx, 'thigh', s, t0, o, E - 0.5);
  const ob = edgePt(ctx, 'thigh', s, t1, o, E - 0.45);
  const sg = outSign(s);
  const ia: Pt = [oa[0] - sg * pocketW(t0), oa[1] + 0.3];
  const ib: Pt = [ob[0] - sg * pocketW(t1), ob[1] + 0.2];
  const panel: SP[] = [
    [oa[0], oa[1], 0.4],
    [ob[0], ob[1] - 0.6],
    [ob[0] - sg * 0.6, ob[1] + 0.4],
    [ib[0] + sg * 0.6, ib[1] + 0.4],
    [ib[0], ib[1] - 0.6],
    [ia[0], ia[1], 0.4],
  ];
  const pd = smoothPath(panel, true, 0.6);
  ctx.push(pd, '#140A10', { o: 0.28, b: lite ? 0 : 0.5, cp: d });
  ctx.push(pd, c, { gf: legGrad(ctx, s, E + 0.4, legStops(matTones(mix(c, '#FFFFFF', 0.05), 'twill'), 'twill')) });
  // fole (prega no meio) e pesponto
  const mt = lerpMid(oa, ia);
  const mb = lerpMid(ob, ib);
  ctx.stroke(smoothPath([[mt[0], mt[1] + 2.6], [mb[0], mb[1] - 0.2]], false), t.deep, 0.24, { o: 0.4, cp: pd });
  if (!lite) ctx.stroke(smoothPath(panel.slice(1, 5).map((p) => [p[0] + sg * -0.35, p[1] - 0.3] as SP), false), threadOf(c), 0.14, { o: 0.4, cp: pd });
  // lapela por cima (mais escura embaixo, sombra no painel)
  const fa: Pt = [oa[0] + sg * 0.3, oa[1] - 0.4];
  const fb: Pt = [ia[0] - sg * 0.3, ia[1] - 0.2];
  const flapH = 2.6;
  const flap: SP[] = [
    [fa[0], fa[1], 0.3],
    [fb[0], fb[1], 0.3],
    [fb[0] - sg * 0.1, fb[1] + flapH, 0.6],
    [(fa[0] + fb[0]) / 2, (fa[1] + fb[1]) / 2 + flapH + 0.5],
    [fa[0] + sg * 0.1, fa[1] + flapH, 0.6],
  ];
  const fd = smoothPath(flap, true, 0.6);
  ctx.push(taperPath([[fa[0], fa[1] + flapH + 0.5], [(fa[0] + fb[0]) / 2, (fa[1] + fb[1]) / 2 + flapH + 0.9], [fb[0], fb[1] + flapH + 0.4]], [0.8, 1.2, 0.8]), '#140A10', { o: 0.3, b: lite ? 0 : 0.4, cp: pd });
  ctx.push(fd, c, { gf: { t: 'l', x1: 0, y1: Math.min(fa[1], fb[1]), x2: 0, y2: Math.max(fa[1], fb[1]) + flapH, s: [[0, t.light], [0.6, t.base], [1, t.shade]] } });
  const bc = (fa[0] + fb[0]) / 2;
  const by = (fa[1] + fb[1]) / 2 + flapH - 0.6;
  ctx.push(ellipse(bc, by, 0.42, 0.38), t.deep, { o: 0.85 });
  if (!lite) ctx.push(ellipse(bc - 0.12, by - 0.12, 0.14, 0.12), t.light, { o: 0.7 });
}

const lerpMid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/** sentado: o PLANO DE CIMA da coxa é um trapézio curto e claro; joelho só com luz macia; linhas de tensão */
function seatedLap(ctx: LayerCtx, s: Side, d: string, t: Tones, c: string, hp: Pt, kn: Pt): void {
  const { an } = ctx;
  const lite = isLite(ctx);
  const sg = outSign(s);
  const th = an.spec.thigh;
  const kw = an.spec.knee;
  const top: SP[] = [
    [hp[0] - th * 0.82, hp[1] + 0.2],
    [hp[0] + th * 0.78, hp[1] + 0.2],
    [kn[0] + kw * 0.72, kn[1] - 0.6],
    [kn[0] - kw * 0.78, kn[1] - 0.6],
  ];
  ctx.push(smoothPath(top, true, 0.5), t.light, { o: 0.62, b: 0.6, cp: d });
  ctx.push(taperPath([[hp[0] + sg * th * 1.0, hp[1] - 0.5], [kn[0] + sg * kw * 1.05, kn[1] + 0.4]], [1.6, 1.0]), t.shade, { o: 0.45, b: 0.6, cp: d });
  const cap = blob(kn[0] - sg * 0.15, kn[1] + 0.2, kw * 0.7, kw * 0.48);
  ctx.push(cap, t.light, { o: 0.32, b: 0.6, cp: d });
  ctx.push(taperPath([[kn[0] - kw * 0.7, kn[1] + 1.1], [kn[0], kn[1] + kw * 0.6 + 0.4], [kn[0] + kw * 0.7, kn[1] + 1.1]], [0, 0.8, 0]), t.deep, { o: 0.3, b: 0.4, cp: d });
  if (!lite) {
    creases(
      ctx,
      [
        { spine: [[hp[0] + sg * th * 0.7, hp[1] + 0.8], [(hp[0] + kn[0]) / 2 + sg * th * 0.25, (hp[1] + kn[1]) / 2 + 0.2], [kn[0] + sg * kw * 0.2, kn[1] - 0.9]], w: 0.55 },
        { spine: [[hp[0] - sg * th * 0.2, hp[1] + 0.5], [hp[0] - sg * th * 0.05, hp[1] + 2.1], [kn[0] - sg * kw * 0.35, kn[1] - 1.1]], w: 0.45 },
        { spine: [[hp[0] - th * 0.7, hp[1] + 0.3], [hp[0], hp[1] + 0.8], [hp[0] + th * 0.65, hp[1] + 0.2]], w: 0.6 },
      ],
      c,
      { o: 0.32, cp: d },
    );
  }
}

/**
 * rasgo do jeans: buraco de borda irregular (largura e altura variam de um rasgo pro outro), pele à mostra com sombra
 * da borda de cima, fios brancos finos atravessando em curva e fiapos curtos saindo da borda pra dentro — nada de
 * retângulo de curativo. `t` = centro no membro, `wk` = largura relativa, `h` = altura do rasgo.
 */
function rip(ctx: LayerCtx, limb: 'thigh' | 'shin', s: Side, d: string, tc: number, wk: number, h0: number): void {
  const { an } = ctx;
  const lite = isLite(ctx);
  const sk = tonesOf(ctx);
  const q = limbWidthAt(an, limb, s, tc);
  const r = rng(Math.floor(hashUnit(`${limb}${s}${an.bodyId}${tc}`) * 1e6));
  const w = ((q.l + q.r) / 2) * wk * (0.95 + r() * 0.3);
  const h = h0 * (0.75 + r() * 0.4);
  const cx = q.at[0] + (q.r - q.l) * 0.2 - 0.3;
  const cy = q.at[1];
  const pts: SP[] = [];
  const n = 14;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    // borda rasgada: raio quebrado e quinas vivas alternadas
    const j = 0.72 + r() * 0.45;
    pts.push([cx + Math.cos(a) * w * j, cy + Math.sin(a) * (h / 2) * (0.55 + r() * 0.6), i % 3 === 0 ? 0 : 0.6]);
  }
  const hole = smoothPath(pts, true, 0.6);
  const ax = legAxis(an, s);
  ctx.push(hole, sk.base, { gf: cylGradient(ax.a, ax.b, ax.wl, ax.wr, { light: sk.light, base: sk.base, shade: sk.shade }), cp: d });
  // sombra da borda de cima na pele (segue a borda, não uma faixa reta)
  const topEdge = pts.filter((p) => p[1] < cy).sort((p, q2) => p[0] - q2[0]);
  if (topEdge.length > 2) ctx.push(taperPath(topEdge.map((p) => [p[0], p[1] + h * 0.16] as SP), topEdge.map((_, i) => (i === 0 || i === topEdge.length - 1 ? 0.2 : 0.7))), '#1A0A10', { o: 0.4, ...(lite ? {} : { b: 0.3 }), cp: hole });
  // fios atravessando (brancos, finos, curvos, espessura variável)
  let th = '';
  const rows = lite ? 2 : 4;
  for (let i = 0; i < rows; i++) {
    const y = cy - h * 0.28 + (h * 0.6 * (i + 0.5)) / rows + (r() - 0.5) * 0.35;
    th += taperPath([[cx - w * 1.1, y + (r() - 0.5) * 0.4], [cx + (r() - 0.5) * w * 0.4, y + 0.2 + r() * 0.3], [cx + w * 1.1, y + (r() - 0.5) * 0.4]], [0.1, 0.12 + r() * 0.1, 0.1]);
  }
  ctx.push(th, '#F4F1EA', { o: 0.92, cp: smoothPath(pts.map((p) => [cx + (p[0] - cx) * 1.12, cy + (p[1] - cy) * 1.1] as SP), true, 0.6) });
  // fiapos: tracinhos claros curtos saindo da borda pra dentro do buraco (borda desfiada)
  let fr = '';
  for (let i = 0; i < n; i++) {
    if (lite && i % 2) continue;
    const p = pts[i];
    const k = 0.18 + r() * 0.22;
    const tip: SP = [p[0] + (cx - p[0]) * k + (r() - 0.5) * 0.5, p[1] + (cy - p[1]) * k];
    fr += taperPath([p, tip], [0.16, 0.04]);
  }
  ctx.push(fr, '#EEF2F8', { o: 0.85, cp: d });
  // borda clara do tecido cortado em volta (fina e quebrada)
  if (!lite) ctx.stroke(hole, mix('#EEF2F8', ctx.col.bottom, 0.25), 0.2, { o: 0.6, cp: d });
}

// ---------------------------------------------------------------------------------------------------------------
// barra das calças por cima do calçado (chamada pelos calçados, grupo shinX)
// ---------------------------------------------------------------------------------------------------------------

/**
 * barra da calça comprida por cima do calçado: quebra em cima da lingueta (borda curva, mais alta no meio e mais baixa
 * nos lados), dobra macia acima e sombra da barra no calçado. Jogger: punho canelado. Pantalona: barra larga que cobre
 * o pé e deixa só o bico. Legging e bota alta: nada (o calçado cobre).
 * `shoeClip` = contorno do calçado (a sombra da barra fica só nele).
 */
export function pantHemOverShoe(ctx: LayerCtx, s: Side, shoeClip: string): void {
  const kind = lowerKind(ctx.cfg);
  const st = PANT_STYLES[kind];
  if (!st || kind === 'leggings' || shaftT(ctx) != null) return;
  const { an } = ctx;
  const lite = isLite(ctx);
  const a = s === 'L' ? an.joints.ankleL : an.joints.ankleR;
  const cb = ctx.col.bottom;
  const tb = matTones(cb, st.mat);
  if (wideOn(ctx, kind)) {
    // pantalona: o MESMO pedaço de baixo da perna (contorno, gradiente e traços), só do meio da canela pra baixo
    const g = wideGeo(ctx, s, tb);
    const { c: hc, wl, wr, yC, drop } = g.hem;
    ctx.push(taperPath([[hc[0] - wl - 0.6, yC + drop + 0.35], [hc[0], yC + 0.9], [hc[0] + wr + 0.6, yC + drop + 0.35]], [1.0, 1.4, 1.0]), '#0A0610', { o: 0.34, ...(lite ? {} : { b: 0.5 }), cp: shoeClip });
    const fb = footBox(an, s);
    const d = g.outline(1.55, 2, s === 'L' ? fb.x + fb.w + 1.0 : fb.x - 1.0);
    ctx.push(d, cb, { gf: g.grad });
    wideDetails(ctx, g, tb, d, 'lo');
    return;
  }
  const E2 = st.ease + (lite ? 0.2 : 0) + st.flareT * 0.7;
  const grad = legGrad(ctx, s, st.ease + (lite ? 0.2 : 0) + 0.4, legStops(tb, st.mat));
  if (kind === 'joggers') {
    // punho canelado: faixa mais justa no tornozelo, por cima da gola do calçado
    const t0 = 0.86;
    const p0l = edgePt(ctx, 'shin', s, t0, 'l', E2 - 0.15, st.flareS);
    const p0r = edgePt(ctx, 'shin', s, t0, 'r', E2 - 0.15, st.flareS);
    const p1l = edgePt(ctx, 'shin', s, 1, 'l', E2 - 0.35, st.flareS);
    const p1r = edgePt(ctx, 'shin', s, 1, 'r', E2 - 0.35, st.flareS);
    const yb = a[1] + (an.seated ? -0.4 : 0.4);
    const cuff = smoothPath([[p0l[0], p0l[1], 0.4], [p0r[0], p0r[1], 0.4], [p1r[0] + 0.1, yb, 0.5], [(p1l[0] + p1r[0]) / 2, yb + 0.45], [p1l[0] - 0.1, yb, 0.5]], true);
    ctx.push(taperPath([[p1l[0] - 0.3, yb + 0.5], [(p1l[0] + p1r[0]) / 2, yb + 1.0], [p1r[0] + 0.3, yb + 0.5]], [0.9, 1.3, 0.9]), '#0A0610', { o: 0.32, b: lite ? 0 : 0.45, cp: shoeClip });
    ctx.push(cuff, cb, { gf: grad });
    if (!lite) {
      let rib = '';
      for (let i = 1; i < 9; i++) {
        const k = i / 9;
        const top: Pt = [p0l[0] + (p0r[0] - p0l[0]) * k, p0l[1] + (p0r[1] - p0l[1]) * k + 0.2];
        const bot: Pt = [p1l[0] + (p1r[0] - p1l[0]) * k, yb + Math.sin(k * Math.PI) * 0.4 - 0.1];
        rib += `M${top[0].toFixed(2)},${top[1].toFixed(2)}L${bot[0].toFixed(2)},${bot[1].toFixed(2)}`;
      }
      ctx.stroke(rib, tb.shade, 0.18, { o: 0.45, cp: cuff });
    }
    ctx.push(taperPath([[p0l[0], p0l[1] + 0.1], [(p0l[0] + p0r[0]) / 2, (p0l[1] + p0r[1]) / 2 + 0.4], [p0r[0], p0r[1] + 0.1]], [0.5, 0.8, 0.5]), tb.deep, { o: 0.35, cp: cuff });
    return;
  }
  const flareK = st.flareS;
  const wide = kind === 'wide';
  const top = limbWidthAt(an, 'shin', s, wide ? 0.72 : 0.84);
  const q = limbWidthAt(an, 'shin', s, 0.98);
  const wl = q.l + E2 + flareK * 0.98;
  const wr = q.r + E2 + flareK * 0.98;
  const tl = top.l + E2 + flareK * (wide ? 0.72 : 0.84);
  const trr = top.r + E2 + flareK * (wide ? 0.72 : 0.84);
  // pantalona: a barra desce até perto da sola (cobre o pé, só o bico aparece)
  const yC = wide ? an.foot.soleY - (an.seated ? 2.4 : 2.2) : a[1] + (an.seated ? -0.9 : -0.35);
  const drop = wide ? 1.6 : 1.05;
  const hemD = smoothPath(
    [
      [top.at[0] - tl, top.at[1], 0],
      [top.at[0] + trr, top.at[1], 0],
      [q.at[0] + wr + 0.15, yC + drop],
      [q.at[0] + wr * 0.7, yC + drop * 0.52],
      [q.at[0] + wr * 0.25, yC + 0.12],
      [q.at[0] - wl * 0.25, yC + 0.12],
      [q.at[0] - wl * 0.7, yC + drop * 0.52],
      [q.at[0] - wl - 0.15, yC + drop],
    ],
    true,
  );
  ctx.push(taperPath([[q.at[0] - wl - 0.6, yC + drop + 0.35], [q.at[0], yC + 0.9], [q.at[0] + wr + 0.6, yC + drop + 0.35]], [1.0, 1.4, 1.0]), '#0A0610', { o: 0.34, b: lite ? 0 : 0.5, cp: shoeClip });
  ctx.push(hemD, cb, { gf: grad });
  if (st.mat === 'metal') ctx.push(taperPath([[q.at[0] - wl * 0.5, top.at[1] + 0.5], [q.at[0] - wl * 0.45, yC]], [0.8, 0.3]), '#FFFFFF', { o: 0.6, b: lite ? 0 : 0.2, cp: hemD });
  if (kind === 'tailored' || wide) {
    const p0: SP = [top.at[0] + (top.r - top.l) * 0.35 - 0.2, top.at[1]];
    const p1: SP = [q.at[0] + (q.r - q.l) * 0.35 - 0.2, yC];
    ctx.stroke(smoothPath([p0, p1], false), tb.light, 0.28, { o: 0.7, cp: hemD });
  }
  if (!lite) creases(ctx, [{ spine: [[q.at[0] - wl * 0.8, yC - 1.4], [q.at[0] + 0.3, yC - 2.0], [q.at[0] + wr * 0.85, yC - 1.3]], w: wide ? 0.6 : 0.8 }], cb, { o: wide ? 0.3 : 0.4, cp: hemD });
  ctx.push(taperPath([[q.at[0] - wl, yC + drop * 0.76], [q.at[0] - wl * 0.5, yC + 0.15], [q.at[0], yC - 0.1], [q.at[0] + wr * 0.5, yC + 0.15], [q.at[0] + wr, yC + drop * 0.76]], [0.5, 0.7, 0.75, 0.7, 0.5]), tb.deep, { o: 0.35, cp: hemD });
  if (!lite && (st.mat === 'denim' || st.mat === 'twill')) {
    ctx.stroke(smoothPath([[q.at[0] - wl + 0.3, yC + 0.3], [q.at[0] - wl * 0.5, yC - 0.35], [q.at[0], yC - 0.6], [q.at[0] + wr * 0.5, yC - 0.35], [q.at[0] + wr - 0.3, yC + 0.3]], false), threadOf(cb), 0.14, { o: 0.45, cp: hemD });
  }
}

/**
 * calça por dentro do cano alto (coturno, texana, botas antigravidade, patins): o tecido franze por cima da boca do
 * cano (um pouco mais largo que a perna) e faz sombra nela. `y` = altura da boca do cano no centro da canela.
 */
export function pantBlouseOverShaft(ctx: LayerCtx, s: Side, tShaft: number): void {
  const kind = lowerKind(ctx.cfg);
  const st = PANT_STYLES[kind];
  if (!st || kind === 'leggings') return;
  const lite = isLite(ctx);
  const cb = ctx.col.bottom;
  const tb = matTones(cb, st.mat);
  const E2 = st.ease + (lite ? 0.2 : 0) + st.flareT * 0.7;
  const grad = legGrad(ctx, s, st.ease + 0.4, legStops(tb, st.mat));
  const ta = Math.max(0, tShaft - 0.12);
  const l0 = edgePt(ctx, 'shin', s, ta, 'l', E2, st.flareS);
  const r0 = edgePt(ctx, 'shin', s, ta, 'r', E2, st.flareS);
  const l1 = edgePt(ctx, 'shin', s, tShaft, 'l', E2 + 0.5, st.flareS);
  const r1 = edgePt(ctx, 'shin', s, tShaft, 'r', E2 + 0.5, st.flareS);
  const mid = limbWidthAt(ctx.an, 'shin', s, tShaft);
  const d = smoothPath([[l0[0], l0[1], 0.3], [r0[0], r0[1], 0.3], [r1[0] + 0.2, r1[1] + 0.6], [mid.at[0], mid.at[1] + 1.4], [l1[0] - 0.2, l1[1] + 0.6]], true);
  ctx.push(d, cb, { gf: grad });
  creases(ctx, [{ spine: [[l1[0], l1[1] - 0.4], [mid.at[0], mid.at[1] + 0.2], [r1[0], r1[1] - 0.4]], w: 0.8 }], cb, { o: 0.42, cp: d });
}

// ---------------------------------------------------------------------------------------------------------------
// shorts e bermuda
// ---------------------------------------------------------------------------------------------------------------

function shorts(ctx: LayerCtx, kind: string): void {
  const { an } = ctx;
  const lite = isLite(ctx);
  const sp = SHORT_STYLES[kind];
  const c = ctx.col.bottom;
  const t = fabric(c);
  const E = sp.ease + (lite ? 0.2 : 0);
  const to = an.seated ? Math.min(0.92, sp.to + 0.12) : sp.to;
  const sk = tonesOf(ctx);
  for (const s of SIDES) {
    ctx.withGroup(legG(s), () => {
      const sg = outSign(s);
      const grad = legGrad(ctx, s, E + 0.6, legStops(t, 'twill'));
      // sombra da barra na pele da coxa (o tecido não encosta: fica uma fresta escura)
      const skin = thighPath(an, s, {});
      const hb = limbWidthAt(an, 'thigh', s, to);
      ctx.push(taperPath([[hb.at[0] - hb.l - 1, hb.at[1] + 0.6], [hb.at[0], hb.at[1] + 1.4], [hb.at[0] + hb.r + 1, hb.at[1] + 0.6]], [1.6, 2.2, 1.6]), sk.deep, { o: 0.4, b: lite ? 0 : 0.7, cp: skin });
      const d = thighPath(an, s, { ease: E, flare: sp.flare, to, slant: kind === 'shorts' ? 0.7 : 0.4 });
      const kn = s === 'L' ? an.joints.kneeL : an.joints.kneeR;
      const lap: AvatarGradient = { t: 'l', x1: kn[0], y1: kn[1] - 6, x2: kn[0], y2: kn[1] + 3, s: [[0, t.light], [0.55, t.base], [1, t.shade]] };
      ctx.push(d, c, { gf: an.seated ? lap : grad });
      hipBridge(ctx, s, E, sp.flare, c, grad, Math.min(0.55, to - 0.08));
      // abertura da perna: o lado de dentro do short no escuro (vê-se o forro)
      const ins = limbWidthAt(an, 'thigh', s, 0.25);
      ctx.push(blob(ins.at[0] - sg * (s === 'L' ? ins.r : ins.l) * 0.7, ins.at[1] + 2, 1.4, an.seated ? 2.5 : 4.5), t.deep, { o: 0.3, b: lite ? 0 : 1.1, cp: d });
      if (!an.seated) {
        const m = limbWidthAt(an, 'thigh', s, to * 0.55);
        ctx.push(blob(m.at[0] - 0.6, m.at[1], (s === 'L' ? m.l : m.r) * 0.6, 3.6, 0.04), t.light, { o: 0.28, b: lite ? 0 : 1.2, cp: d });
      }
      if (!lite) weave(ctx, d, { x: hb.at[0] - 12, y: an.joints.hipL[1] - 6, w: 24, h: hb.at[1] - an.joints.hipL[1] + 10 }, c, { gap: 0.62, o: 0.035, light: true });
      // barra: shorts com barra dobrada (faixa com a dobra em cima); bermuda com barra pespontada e prega
      const bl = edgePt(ctx, 'thigh', s, to, 'l', E, sp.flare);
      const br = edgePt(ctx, 'thigh', s, to, 'r', E, sp.flare);
      const slant = kind === 'shorts' ? 0.7 : 0.4;
      const oL = s === 'L' ? slant * 0.6 : -slant * 0.4;
      const oR = s === 'L' ? -slant * 0.4 : slant * 0.6;
      if (kind === 'shorts') {
        const cuffH = 2.1;
        const cl = edgePt(ctx, 'thigh', s, to - 0.08, 'l', E + 0.35, sp.flare);
        const cr = edgePt(ctx, 'thigh', s, to - 0.08, 'r', E + 0.35, sp.flare);
        const cuff = smoothPath([[cl[0], cl[1] + oL * 0.6, 0.3], [cr[0], cr[1] + oR * 0.6, 0.3], [br[0] + 0.35, br[1] + oR + 0.1, 0.3], [bl[0] - 0.35, bl[1] + oL + 0.1, 0.3]], true);
        void cuffH;
        ctx.push(cuff, c, { gf: grad });
        ctx.push(cuff, t.light, { o: 0.16 });
        ctx.push(taperPath([[cl[0], cl[1] + oL * 0.6 + 0.15], [(cl[0] + cr[0]) / 2, (cl[1] + cr[1]) / 2 + 0.35], [cr[0], cr[1] + oR * 0.6 + 0.15]], [0.5, 0.75, 0.5]), t.deep, { o: 0.45, cp: cuff });
        if (!lite) ctx.stroke(smoothPath([[cl[0] + 0.2, cl[1] + oL * 0.6 - 0.35], [(cl[0] + cr[0]) / 2, (cl[1] + cr[1]) / 2 - 0.15], [cr[0] - 0.2, cr[1] + oR * 0.6 - 0.35]], false), t.light, 0.3, { o: 0.4, b: 0.15, cp: d });
      } else {
        if (!lite) ctx.stroke(smoothPath([[bl[0] + 0.3, bl[1] + oL - 0.9], [(bl[0] + br[0]) / 2, (bl[1] + br[1]) / 2 - 0.7], [br[0] - 0.3, br[1] + oR - 0.9]], false), threadOf(c), 0.15, { o: 0.45, cp: d });
        ctx.push(taperPath([[bl[0], bl[1] + oL - 0.15], [(bl[0] + br[0]) / 2, (bl[1] + br[1]) / 2 + 0.1], [br[0], br[1] + oR - 0.15]], [0.5, 0.7, 0.5]), t.deep, { o: 0.35, cp: d });
        if (!an.seated) pressCrease(ctx, 'thigh', s, d, t, 0.15, to - 0.02);
        // bolso lateral com lapela (bermuda)
        if (!lite) {
          const pa = edgePt(ctx, 'thigh', s, 0.32, outW(s), E - 0.6, sp.flare);
          const pb = edgePt(ctx, 'thigh', s, 0.5, outW(s), E - 0.55, sp.flare);
          const flap = smoothPath([[pa[0], pa[1], 0], [pa[0] - sg * 4.2, pa[1] + 0.3, 0], [pa[0] - sg * 4.1, pa[1] + 2.0, 0.6], [pa[0] - sg * 0.1, pa[1] + 2.1, 0.6]], true, 0.4);
          ctx.push(taperPath([[pa[0], pa[1] + 2.3], [pa[0] - sg * 2, pa[1] + 2.6], [pa[0] - sg * 4.1, pa[1] + 2.3]], [0.6, 0.9, 0.6]), '#140A10', { o: 0.25, b: 0.3, cp: d });
          ctx.push(flap, c, { gf: grad });
          ctx.stroke(smoothPath([[pa[0] - sg * 0.2, pb[1] + 0.4], [pa[0] - sg * 4.0, pb[1] + 0.6]], false), t.deep, 0.22, { o: 0.4, cp: d });
        }
      }
      // costura lateral
      const pts: SP[] = [0.06, to * 0.6, to - 0.04].map((tt) => edgePt(ctx, 'thigh', s, tt, outW(s), E + sp.flare * tt - 0.8));
      ctx.stroke(smoothPath(pts, false), t.deep, 0.22, { o: 0.4, cp: d });
      if (an.seated) seatedLap(ctx, s, d, t, c, s === 'L' ? an.joints.hipL : an.joints.hipR, kn);
    });
  }
  ctx.withGroup('body', () => {
    const top = pantsTopY(ctx);
    const d = hipOutline(ctx, top, E, sp.flare);
    ctx.push(d, c, { gf: an.seated ? hipGrad(ctx, t, 'twill') : hipGradFromLegs(ctx, E + 0.6, legStops(t, 'twill')) });
    const { cx } = an;
    const pocket = (g: number) => smoothPath([[cx + g * (an.w.waist - 2.2), top + 0.4], [torsoXAt(an, g < 0 ? 'L' : 'R', an.hipY - 2.2, E) - g * 0.4, an.hipY - 2.2]], false);
    ctx.stroke(pocket(-1) + pocket(1), t.deep, 0.3, { o: 0.5, cp: d });
    const crotch = an.seated ? an.hj + 1.4 : an.torsoBottom;
    ctx.stroke(smoothPath([[cx + 0.1, top + 0.8], [cx + 0.1, crotch - 1.2]], false), t.deep, 0.26, { o: 0.5, cp: d });
    ctx.push(blob(cx, crotch - 0.4, 2.8, 1.7), t.deep, { o: 0.4, b: lite ? 0 : 0.8, cp: d });
    if (waistShown(ctx.cfg)) waistband(ctx, top, 'twill', t, E);
  });
}

// ---------------------------------------------------------------------------------------------------------------
// saias (grupo do tronco)
// ---------------------------------------------------------------------------------------------------------------

interface SkirtGeo {
  /** contorno da saia */
  pts: SP[];
  d: string;
  /** cantos de cima e da barra (esquerda/direita), y da barra no meio */
  topL: Pt;
  topR: Pt;
  hemL: Pt;
  hemR: Pt;
  hemY: number;
  /** gradiente horizontal do tecido */
  grad: AvatarGradient;
  seated: boolean;
}

/**
 * contorno de uma saia evasê: cós logo acima da barra da parte de cima, quadril de cada corpo (torsoXAt) e abertura até
 * a barra. `len` = 0..1 do quadril (junta) ao tornozelo; `flare` = quanto abre de cada lado na barra; `wave` = ondas
 * na barra (caimento). Sentado: a saia cobre o colo (coxas vistas de cima) e cai na frente dos joelhos.
 */
function skirtGeo(ctx: LayerCtx, o: { len: number; flare: number; ease?: number; wave?: number; waves?: number; zig?: number; hemCurve?: number }): SkirtGeo {
  const { an } = ctx;
  const { cx } = an;
  const t = fabric(ctx.col.bottom);
  const ease = (o.ease ?? 0.8) + (isLite(ctx) ? 0.2 : 0);
  const top = pantsTopY(ctx);
  const j = an.joints;
  const ankY = (j.ankleL[1] + j.ankleR[1]) / 2;
  const hipJ = (j.hipL[1] + j.hipR[1]) / 2;
  const sw = an.w.hip + o.flare + 2;
  const grad: AvatarGradient = { t: 'l', x1: cx - sw, y1: 0, x2: cx + sw, y2: 0, s: [[0, t.base], [0.18, t.light], [0.48, t.base], [0.84, t.shade], [1, t.bounce]] };
  const tilt = an.tilt.hip;
  const waves = o.waves ?? 3;
  const wave = o.wave ?? 0.5;
  const zig = o.zig ?? 0;
  if (!an.seated) {
    const hemY = an.hj + (ankY - an.hj) * o.len;
    const xL = (y: number, e = ease) => torsoXAt(an, 'L', y, e);
    const xR = (y: number, e = ease) => torsoXAt(an, 'R', y, e);
    const hipY = Math.max(top + 2, an.hipY);
    const topL: Pt = [xL(top), top + tilt * 0.3];
    const topR: Pt = [xR(top), top - tilt * 0.3];
    const hemL: Pt = [xL(hipY, ease + 0.4) - o.flare, hemY - tilt * 0.45];
    const hemR: Pt = [xR(hipY, ease + 0.4) + o.flare, hemY + tilt * 0.45];
    const pts: SP[] = [];
    pts.push([topL[0], topL[1], 0.5]);
    pts.push([xL((top + hipY) / 2, ease + 0.2), (top + hipY) / 2]);
    pts.push([xL(hipY, ease + 0.4), hipY]);
    pts.push([(xL(hipY, ease + 0.4) * 0.45 + hemL[0] * 0.55) - 0.15, hipY + (hemY - hipY) * 0.55]);
    pts.push([hemL[0], hemL[1] - 0.6, 0.6]);
    // barra: curva (desce no meio) com ondas do caimento ou zigue-zague das pregas
    const N = Math.max(6, waves * 2 + 2);
    for (let i = 0; i <= N; i++) {
      const k = i / N;
      const x = hemL[0] + (hemR[0] - hemL[0]) * k;
      const base = hemL[1] + (hemR[1] - hemL[1]) * k + Math.sin(Math.PI * k) * (o.hemCurve ?? 1.0);
      const wv = Math.sin(k * Math.PI * waves * 2) * wave * (0.6 + 0.4 * Math.sin(Math.PI * k));
      const zz = zig ? (i % 2 ? zig : -zig * 0.4) : 0;
      pts.push([x, base + wv + zz, zig ? 0.2 : 1]);
    }
    pts.push([hemR[0], hemR[1] - 0.6, 0.6]);
    pts.push([(xR(hipY, ease + 0.4) * 0.45 + hemR[0] * 0.55) + 0.15, hipY + (hemY - hipY) * 0.55]);
    pts.push([xR(hipY, ease + 0.4), hipY]);
    pts.push([xR((top + hipY) / 2, ease + 0.2), (top + hipY) / 2]);
    pts.push([topR[0], topR[1], 0.5]);
    coatClamp(ctx, pts);
    return { pts, d: smoothPath(pts, true), topL, topR, hemL, hemR, hemY, grad, seated: false };
  }
  // sentado (no espaço do tronco: o colo das pernas está seatDrop mais baixo)
  const sd = an.seatDrop;
  const kL: Pt = [j.kneeL[0], j.kneeL[1] - sd];
  const kR: Pt = [j.kneeR[0], j.kneeR[1] - sd];
  const hL: Pt = [j.hipL[0], j.hipL[1] - sd];
  const th = an.spec.thigh;
  const kw = an.spec.knee;
  const fallLen = Math.max(0, (ankY - hipJ) * o.len - (kL[1] - hL[1]) - 4);
  const hemY = kL[1] + 1.5 + fallLen;
  const outL = Math.min(torsoXAt(an, 'L', an.hj, ease + 0.6), hL[0] - th * 1.15 - ease);
  const outR = Math.max(torsoXAt(an, 'R', an.hj, ease + 0.6), j.hipR[0] + th * 1.15 + ease);
  const topL: Pt = [torsoXAt(an, 'L', top, ease), top];
  const topR: Pt = [torsoXAt(an, 'R', top, ease), top];
  const hemL: Pt = [Math.min(outL + 0.6, kL[0] - kw - ease - 0.6) - o.flare * Math.min(1, fallLen / 12) * 0.6, hemY];
  const hemR: Pt = [Math.max(outR - 0.6, kR[0] + kw + ease + 0.6) + o.flare * Math.min(1, fallLen / 12) * 0.6, hemY];
  const pts: SP[] = [
    [topL[0], topL[1], 0.5],
    [torsoXAt(an, 'L', (top + an.hj) / 2, ease + 0.3), (top + an.hj) / 2],
    [outL, an.hj + 0.5],
    [outL + 0.3, kL[1] - 1.2],
    [hemL[0], hemL[1] - 0.8, 0.6],
  ];
  const N = 6;
  for (let i = 0; i <= N; i++) {
    const k = i / N;
    const x = hemL[0] + (hemR[0] - hemL[0]) * k;
    const zz = zig ? (i % 2 ? zig : -zig * 0.4) : 0;
    pts.push([x, hemY + Math.sin(Math.PI * k) * 0.7 + Math.sin(k * Math.PI * 4) * wave * 0.5 + zz, zig ? 0.2 : 1]);
  }
  pts.push([hemR[0], hemR[1] - 0.8, 0.6], [outR - 0.3, kR[1] - 1.2], [outR, an.hj + 0.5], [torsoXAt(an, 'R', (top + an.hj) / 2, ease + 0.3), (top + an.hj) / 2], [topR[0], topR[1], 0.5]);
  return { pts, d: smoothPath(pts, true), topL, topR, hemL, hemR, hemY, grad, seated: true };
}

/**
 * casaco longo (sobretudo, kimono) por cima da saia: acima da barra do casaco a saia fica dentro das laterais dele (só
 * aparece no vão da frente) e abaixo dela escapa por igual dos dois lados — nada de saia escapando de um lado só nem de
 * pontas de tutu saindo como barbatana. Mexe nos pontos do contorno (em pé).
 */
function coatClamp(ctx: LayerCtx, pts: SP[]): void {
  const o = outerDef(ctx.cfg);
  if (!o || o.hem < 10) return;
  const { an } = ctx;
  const e = o.ease * (an.bodyId === 'broad' ? 0.8 : 1);
  const y0 = an.torsoBottom - 1;
  const coatHem = Math.max(an.hipY + o.hem, an.waistY + 4);
  // lateral do casaco: o tronco com a folga dele até o gancho, depois abre em A (~0,1 por unidade, como o extendLong)
  const side = (s: Side, y: number) => torsoXAt(an, s, Math.min(y, y0), e) + (s === 'L' ? -1 : 1) * Math.max(0, y - y0) * 0.1;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p[1] > coatHem - 0.4) continue;
    const xl = side('L', p[1]) + 0.7;
    const xr = side('R', p[1]) - 0.7;
    const x = Math.max(xl, Math.min(xr, p[0]));
    if (x !== p[0]) pts[i] = p.length > 2 ? [x, p[1], p[2] as number] : [x, p[1]];
  }
}

/** volume comum das saias: sombra do lado de baixo/direita, luz no quadril, sombra entre as pernas e barra */
function skirtVolume(ctx: LayerCtx, g: SkirtGeo, t: Tones, o: { folds?: number; foldO?: number } = {}): void {
  const { an } = ctx;
  const lite = isLite(ctx);
  const c = ctx.col.bottom;
  const { cx } = an;
  const hipY = an.hipY;
  // luz no quadril (lado da luz) e sombra própria embaixo à direita
  ctx.push(blob(cx - an.w.hip * 0.45, hipY - 1, an.w.hip * 0.42, 3.4, -0.1), t.light, { o: 0.32, b: lite ? 0 : 1.6, cp: g.d });
  // sentado: o colo é um plano claro (visto de cima) e a frente que cai dos joelhos fica mais escura
  if (g.seated) {
    const sd = an.seatDrop;
    const kY = (an.joints.kneeL[1] + an.joints.kneeR[1]) / 2 - sd;
    ctx.push(smoothPath([[g.topL[0] + 1, an.hj - 0.2], [g.topR[0] - 1, an.hj - 0.2], [an.joints.kneeR[0] + 2, kY - 0.8], [an.joints.kneeL[0] - 2, kY - 0.8]], true, 0.6), t.light, { o: 0.45, b: lite ? 0 : 0.9, cp: g.d });
    if (g.hemY > kY + 2) ctx.push(smoothPath([[g.hemL[0], kY + 1], [g.hemR[0], kY + 1], [g.hemR[0], g.hemY + 1], [g.hemL[0], g.hemY + 1]], true, 0.3), t.shade, { o: 0.35, b: lite ? 0 : 0.8, cp: g.d });
    ctx.push(taperPath([[an.joints.kneeL[0] - 1.5, kY + 0.8], [cx, kY + 1.4], [an.joints.kneeR[0] + 1.5, kY + 0.8]], [0.8, 1.2, 0.8]), t.deep, { o: 0.3, b: lite ? 0 : 0.5, cp: g.d });
  }
  // dobras que nascem do quadril e abrem até a barra (assimétricas, nunca em grade)
  const n = o.folds ?? 4;
  if (n > 0) {
    const list: { spine: SP[]; w: number }[] = [];
    const r = rng(Math.floor(hashUnit(`saia${ctx.cfg.bottom}${an.bodyId}`) * 1e6));
    for (let i = 0; i < n; i++) {
      const k = (i + 0.5) / n + (r() - 0.5) * 0.08;
      const yTop = (g.seated ? an.hj : hipY) + 1 + r() * 2.5;
      const xTop = g.topL[0] + (g.topR[0] - g.topL[0]) * (0.18 + k * 0.64);
      const xBot = g.hemL[0] + (g.hemR[0] - g.hemL[0]) * (0.08 + k * 0.84);
      const yBot = g.hemY + 0.4;
      list.push({ spine: [[xTop, yTop], [(xTop * 0.6 + xBot * 0.4) + (r() - 0.5) * 0.6, yTop + (yBot - yTop) * 0.45], [xBot, yBot]], w: 0.9 + r() * 0.5 });
    }
    creases(ctx, list, c, { o: o.foldO ?? 0.38, cp: g.d });
  }
  // sombra embaixo da barra da parte de cima (a camiseta pousa no cós da saia)
  ctx.push(taperPath([[g.topL[0], g.topL[1] + 1.4], [cx, g.topL[1] + 2.0], [g.topR[0], g.topR[1] + 1.4]], [1.2, 1.6, 1.2]), t.deep, { o: 0.3, b: lite ? 0 : 0.6, cp: g.d });
}

/** saia curta evasê (leve e soltinha): ondas macias na barra, dobras do quadril, barra com pesponto */
function skirtA(ctx: LayerCtx): void {
  const c = ctx.col.bottom;
  const t = fabric(c);
  ctx.withGroup('body', () => {
    const g = skirtGeo(ctx, { len: 0.36, flare: 3.6, wave: 0.55, waves: 3 });
    ctx.push(g.d, c, { gf: g.grad });
    skirtVolume(ctx, g, t, { folds: 4 });
    hemLine(ctx, g, t, c, 0.75);
    if (waistShown(ctx.cfg)) skirtBand(ctx, g, t);
  });
}

/** linha da barra: sombra fina por dentro e pesponto */
function hemLine(ctx: LayerCtx, g: SkirtGeo, t: Tones, c: string, off: number): void {
  const n = g.pts.length;
  const hem = g.pts.filter((p, i) => i >= 4 && i <= n - 6 && p[1] > g.hemY - 3.5);
  if (hem.length < 3) return;
  const inner = hem.map((p) => [p[0], p[1] - off] as SP);
  ctx.stroke(smoothPath(inner, false), t.deep, 0.25, { o: 0.35, cp: g.d });
  if (!isLite(ctx)) ctx.stroke(smoothPath(inner.map((p) => [p[0], p[1] - 0.3] as SP), false), threadOf(c), 0.13, { o: 0.35, cp: g.d });
}

/** cós da saia quando aparece (parte de cima curta) */
function skirtBand(ctx: LayerCtx, g: SkirtGeo, t: Tones): void {
  const { an } = ctx;
  const y = g.topL[1];
  const band = torsoPath(an, { top: y, bottom: y + 2.4, ease: 0.9, hem: 0.2 });
  ctx.push(band, t.base, { gf: g.grad });
  ctx.push(taperPath([[torsoXAt(an, 'L', y + 2.4, 1), y + 2.5], [an.cx, y + 2.7], [torsoXAt(an, 'R', y + 2.4, 1), y + 2.5]], [0.5, 0.6, 0.5]), t.deep, { o: 0.4 });
}

/** saia plissada (até o joelho): pregas faca abrindo do quadril até a barra em zigue-zague, luz e sombra alternadas */
function skirtPleated(ctx: LayerCtx): void {
  const lite = isLite(ctx);
  const c = ctx.col.bottom;
  const t = fabric(c);
  ctx.withGroup('body', () => {
    const g = skirtGeo(ctx, { len: 0.5, flare: 4.6, wave: 0, waves: 7, zig: 0.55, hemCurve: 0.8 });
    ctx.push(g.d, c, { gf: g.grad });
    const N = lite ? 8 : 12;
    let dark = '';
    let light = '';
    const yTop = g.topL[1] + 1.2;
    for (let i = 1; i < N; i++) {
      const k = i / N;
      const xt = g.topL[0] + (g.topR[0] - g.topL[0]) * k;
      const xb = g.hemL[0] + (g.hemR[0] - g.hemL[0]) * k;
      const yb = g.hemY + 2;
      // cada prega: faixa de sombra à direita da dobra (afina em cima) e fio de luz à esquerda
      dark += smoothPath([[xt, yTop, 0], [xt + 0.35, yTop, 0], [xb + 1.2, yb, 0], [xb, yb, 0]], true, 0);
      light += taperPath([[xt - 0.15, yTop + 1], [xb - 0.35, yb]], [0.15, 0.55]);
    }
    ctx.push(dark, t.shade, { o: 0.55, cp: g.d });
    ctx.push(light, t.light, { o: 0.55, b: lite ? 0 : 0.2, cp: g.d });
    skirtVolume(ctx, g, t, { folds: 0 });
    if (waistShown(ctx.cfg)) skirtBand(ctx, g, t);
  });
}

/** saia midi (meio da canela): caimento fluido em A, dobras longas, brilho acetinado e fenda no lado da perna livre */
function skirtMidi(ctx: LayerCtx): void {
  const { an } = ctx;
  const lite = isLite(ctx);
  const c = ctx.col.bottom;
  const t = fabric(c);
  ctx.withGroup('body', () => {
    const g = skirtGeo(ctx, { len: 0.74, flare: 4.8, wave: 0.7, waves: 3, ease: 0.7 });
    // fenda: um entalhe na barra do lado da perna livre (a pele aparece por baixo)
    let d = g.d;
    if (!g.seated) {
      const free: Side = an.rest.weight === 'R' ? 'L' : 'R';
      const k = free === 'L' ? 0.3 : 0.7;
      const x = g.hemL[0] + (g.hemR[0] - g.hemL[0]) * k;
      const pts = g.pts.slice();
      // insere a fenda entre os pontos da barra mais próximos de x
      let best = 5;
      for (let i = 5; i < pts.length - 6; i++) if (Math.abs(pts[i][0] - x) < Math.abs(pts[best][0] - x)) best = i;
      const yb = pts[best][1];
      pts.splice(best, 1, [x - 0.9, yb, 0.5], [x - 0.15, yb - 7.5, 0.3], [x + 0.25, yb - 7.6, 0.3], [x + 1.0, yb + 0.1, 0.5]);
      d = smoothPath(pts, true);
    }
    ctx.push(d, c, { gf: g.grad });
    // brilho acetinado: faixas largas e macias que seguem as dobras
    ctx.push(taperPath([[an.cx - an.w.hip * 0.5, an.hipY + 1], [g.hemL[0] + (g.hemR[0] - g.hemL[0]) * 0.28, (an.hipY + g.hemY) / 2], [g.hemL[0] + (g.hemR[0] - g.hemL[0]) * 0.22, g.hemY]], [0.8, 2.6, 2.0]), t.light, { o: 0.45, b: lite ? 0 : 1.2, cp: d });
    skirtVolume(ctx, { ...g, d }, t, { folds: 5, foldO: 0.42 });
    hemLine(ctx, { ...g, d }, t, c, 0.7);
    if (waistShown(ctx.cfg)) skirtBand(ctx, g, t);
  });
}

/** kilt: xadrez (tartã) na cor da peça, avental da frente sobreposto com franja e alfinete, pregas nas laterais */
function kilt(ctx: LayerCtx): void {
  const { an } = ctx;
  const lite = isLite(ctx);
  const c = ctx.col.bottom;
  const t = fabric(c);
  // cores do tartã: base da peça, faixa escura (marinho/verde) e fio de destaque claro/quente
  const band = mix(c, lum(c) > 0.4 ? '#1A2A44' : '#0E1A12', 0.55);
  const accent = lum(c) > 0.55 ? '#B0222E' : '#F2D27A';
  ctx.withGroup('body', () => {
    const g = skirtGeo(ctx, { len: 0.46, flare: 2.2, wave: 0, waves: 6, zig: 0.35, hemCurve: 0.5, ease: 0.9 });
    ctx.push(g.d, c, { gf: g.grad });
    tartan(ctx, g, c, band, accent, 0.5);
    // pregas nas laterais (o avental da frente é liso)
    const N = lite ? 3 : 5;
    let pl = '';
    for (const side of [-1, 1]) {
      for (let i = 0; i < N; i++) {
        const k = 0.04 + (i / N) * 0.24;
        const kk = side < 0 ? k : 1 - k;
        const xt = g.topL[0] + (g.topR[0] - g.topL[0]) * kk;
        const xb = g.hemL[0] + (g.hemR[0] - g.hemL[0]) * kk;
        pl += smoothPath([[xt, an.hipY - 1, 0], [xt + 0.3, an.hipY - 1, 0], [xb + 0.7, g.hemY + 1.5, 0], [xb, g.hemY + 1.5, 0]], true, 0);
      }
    }
    ctx.push(pl, band, { o: 0.45, cp: g.d });
    // avental: borda vertical do lado direito da frente com franja, sombra em cima do resto
    const ax = an.cx + an.w.hip * 0.42;
    ctx.push(taperPath([[ax - 0.2, g.topR[1] + 1], [ax + 0.1, g.hemY + 1]], [1.6, 1.8]), '#0A0610', { o: 0.32, b: lite ? 0 : 0.5, cp: g.d });
    if (!lite) {
      let fr = '';
      for (let y = an.hipY + 2; y < g.hemY; y += 0.8) fr += `M${(ax - 0.1).toFixed(2)},${y.toFixed(2)}l-0.7,0.5`;
      ctx.stroke(fr, mix(c, '#FFFFFF', 0.25), 0.22, { o: 0.75, cp: g.d });
    }
    ctx.stroke(smoothPath([[ax, g.topR[1] + 0.4], [ax + 0.4, g.hemY + 1.2]], false), mix(t.light, '#FFFFFF', 0.2), 0.3, { o: 0.6, cp: g.d });
    // alfinete do kilt (metal prateado com um pingente)
    const pinY = g.hemY - 5.5;
    ctx.stroke(smoothPath([[ax + 1.4, pinY - 1.6], [ax + 1.9, pinY + 1.8]], false), '#D8DCE6', lite ? 0.55 : 0.4);
    ctx.push(ellipse(ax + 2.0, pinY + 2.2, 0.55, 0.55), '#C9CED9', { gf: { t: 'r', cx: ax + 1.8, cy: pinY + 2, r: 0.8, s: [[0, '#FFFFFF'], [0.5, '#C9CED9'], [1, '#6E7484']] } });
    skirtVolume(ctx, g, t, { folds: 0 });
    if (waistShown(ctx.cfg)) skirtBand(ctx, g, t);
  });
}

/**
 * tartã do kilt NO TECIDO: a grade é deformada pela saia — as horizontais acompanham a curva da barra e as verticais
 * abrem em leque do cós até a barra (a saia é um cone, não um papel quadriculado). Faixas escuras nas duas direções e
 * fio de destaque (mais apagado em tecido escuro, onde o amarelo vira grade de adesivo).
 */
function tartan(ctx: LayerCtx, g: SkirtGeo, c: string, band: string, accent: string, hemCurve: number): void {
  const lite = isLite(ctx);
  // ponto da saia: a = 0..1 de um lado ao outro, b = 0..1 do cós à barra (a barra desce no meio como a do contorno)
  const P = (a: number, b: number): Pt => {
    const tx = g.topL[0] + (g.topR[0] - g.topL[0]) * a;
    const ty = g.topL[1] + (g.topR[1] - g.topL[1]) * a;
    const hx = g.hemL[0] + (g.hemR[0] - g.hemL[0]) * a;
    const hy = g.hemL[1] + (g.hemR[1] - g.hemL[1]) * a + Math.sin(Math.PI * Math.max(0, Math.min(1, a))) * hemCurve;
    return [tx + (hx - tx) * b, ty + (hy - ty) * b];
  };
  const f = (p: Pt) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
  const strip = (pts0: Pt[], pts1: Pt[]) => `M${pts0.map(f).join('L')}L${pts1.reverse().map(f).join('L')}Z`;
  const A0 = -0.1;
  const A1 = 1.1;
  const nA = Math.max(5, Math.round((g.hemR[0] - g.hemL[0]) / (lite ? 5.4 : 4.6)));
  const nB = Math.max(3, Math.round((g.hemY - g.topL[1]) / (lite ? 5.4 : 4.6)));
  const as = (n: number) => Array.from({ length: n + 1 }, (_, i) => A0 + ((A1 - A0) * i) / n);
  const hRow = (b: number) => as(8).map((a) => P(a, b));
  const vCol = (a: number) => [P(a, -0.08), P(a, 0.5), P(a, 1.12)];
  let h = '';
  let v = '';
  let fine = '';
  for (let k = -1; k <= nB; k++) {
    const b = (k + 0.15) / nB;
    h += strip(hRow(b), hRow(b + 0.42 / nB));
    fine += strip(hRow(b + 0.7 / nB), hRow(b + 0.7 / nB + 0.06 / nB));
  }
  for (let k = -1; k <= nA + 1; k++) {
    const a = (k + 0.15) / nA;
    v += strip(vCol(a), vCol(a + 0.42 / nA));
    if (!lite) fine += strip(vCol(a + 0.72 / nA), vCol(a + 0.72 / nA + 0.05 / nA));
  }
  const dark = lum(c) < 0.18;
  ctx.push(h, mix(band, '#000000', 0.25), { o: lite ? 0.5 : 0.45, cp: g.d });
  ctx.push(v, mix(band, '#000000', 0.25), { o: lite ? 0.4 : 0.36, cp: g.d });
  ctx.push(fine, accent, { o: dark ? 0.32 : 0.55, cp: g.d });
}

/**
 * saia tutu: 3 camadas de tule recortado e translúcido que CAEM (sino, não disco), cada uma com a barra em pontas
 * irregulares e um comprimento; franzido saindo do cós, base lisa por baixo, cós acetinado e brilhinhos
 */
function tutu(ctx: LayerCtx): void {
  const { an } = ctx;
  const { cx } = an;
  const lite = isLite(ctx);
  const c = ctx.col.bottom;
  const t = fabric(c);
  ctx.withGroup('body', () => {
    // base (calcinha/collant da mesma cor) cobrindo o quadril e o gancho
    const top = pantsTopY(ctx);
    const base = torsoPath(an, { top, ease: 0.5 });
    ctx.push(base, c, { gf: hipGrad(ctx, t, 'lycra') });
    const len0 = an.seated ? 0.33 : 0.31;
    const g = skirtGeo(ctx, { len: len0, flare: 5.6, wave: 0.45, waves: 9, zig: 0.8, ease: 1.0, hemCurve: 1.3 });
    // camadas: de trás (mais escura, mais longa e mais aberta) pra frente (mais clara e curta); barra em pontas de tule
    // recortado; o tule é transparente embaixo (a camada de trás e as pernas aparecem) e mais denso no franzido do cós
    const layers = lite ? 2 : 3;
    const INK = '#0B0816';
    for (let i = 0; i < layers; i++) {
      const k = i / Math.max(1, layers - 1);
      const gi = i === 0 ? g : skirtGeo(ctx, { len: len0 - k * 0.045, flare: 5.6 - k * 1.8, wave: 0.4 + k * 0.15, waves: 9 + i * 2, zig: 0.8 - k * 0.2, ease: 1.0 - k * 0.25, hemCurve: 1.3 - k * 0.3 });
      const col = mix(c, i === 0 ? t.shade : '#FFFFFF', i === 0 ? 0.3 : 0.1 + k * 0.16);
      const yTop = gi.topL[1];
      ctx.push(gi.d, col, { gf: { t: 'l', x1: 0, y1: yTop, x2: 0, y2: gi.hemY + 1, s: [[0, col, 0.95], [0.45, mix(col, '#FFFFFF', 0.12), 0.72], [1, col, 0.42]] } });
      // volume do sino: laterais escurecem (cilindro), luz entra pela esquerda
      ctx.push(gi.d, INK, { gf: { ...gi.grad, s: [[0, INK, 0.28], [0.22, INK, 0], [0.7, INK, 0.04], [1, INK, 0.34]] } });
      // borda de tule: traço claro e fino na barra de cada camada (as pontas brilham)
      if (!lite) {
        const hem = gi.pts.filter((p) => p[1] > gi.hemY - 3);
        ctx.stroke(smoothPath(hem, false), mix(col, '#FFFFFF', 0.5), 0.22, { o: 0.6, cp: g.d });
      }
    }
    // franzido do tule: pregas finas que nascem juntas no cós e abrem caindo até as pontas (luz e sombra alternadas)
    if (!lite) {
      let rays = '';
      let lit = '';
      for (let i = 0; i < 11; i++) {
        const k = (i + 0.5) / 11;
        const xt = g.topL[0] + (g.topR[0] - g.topL[0]) * (0.12 + k * 0.76);
        const xb = g.hemL[0] + (g.hemR[0] - g.hemL[0]) * (0.03 + k * 0.94);
        const seg = taperPath([[xt, top + 2.2], [(xt * 0.6 + xb * 0.4), top + (g.hemY - top) * 0.45], [xb, g.hemY - 0.3]], [0.12, 0.45, 0.7]);
        if (i % 2) lit += seg;
        else rays += seg;
      }
      ctx.push(rays, t.deep, { o: 0.2, b: 0.3, cp: g.d });
      ctx.push(lit, '#FFFFFF', { o: 0.14, b: 0.3, cp: g.d });
      speckle(ctx, { x: g.hemL[0] + 2, y: top + 3, w: g.hemR[0] - g.hemL[0] - 4, h: g.hemY - top - 4 }, '#FFFFFF', { n: 16, r: [0.12, 0.26], seed: 11, o: 0.85, cp: g.d });
      const st = starPath(cx - an.w.hip * 0.7, top + 5, 0.75, 4, 0.3);
      ctx.push(st + starPath(cx + an.w.hip * 0.9, g.hemY - 2.2, 0.6, 4, 0.3), '#FFFFFF', { o: 0.9 });
    }
    // cós acetinado (faixa com brilho)
    const band = torsoPath(an, { top, bottom: top + 2.2, ease: 1.0, hem: 0.2 });
    ctx.push(band, c, { gf: { t: 'l', x1: cx - an.w.hip, y1: 0, x2: cx + an.w.hip, y2: 0, s: [[0, t.shade], [0.25, mix(t.light, '#FFFFFF', 0.3)], [0.5, t.base], [0.85, t.shade], [1, t.base]] } });
    ctx.push(taperPath([[torsoXAt(an, 'L', top + 2.2, 1.1), top + 2.3], [cx, top + 2.5], [torsoXAt(an, 'R', top + 2.2, 1.1), top + 2.3]], [0.5, 0.6, 0.5]), t.deep, { o: 0.35 });
  });
}

/** (testes) estilos conhecidos */
export const BOTTOM_KINDS = [...Object.keys(PANT_STYLES), ...Object.keys(SHORT_STYLES), 'skirt', 'pleated', 'midi', 'kilt', 'tutu'];

/** id da parte de baixo desenhado por esta parte (o resto cai no jeans) */
export function knownBottom(cfg: AvatarConfig): boolean {
  return BOTTOM_KINDS.includes(cfg.bottom);
}

