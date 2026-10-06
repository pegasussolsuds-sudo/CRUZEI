// Bandeiras de orgulho: listras oficiais com peso (prideFlagDef do catálogo) + desenhos extras fiéis (chevron Progress
// Pride, anel intersexo, triângulo demissexual, lambda arco-íris da aliada) num ESPAÇO DE BANDEIRA que pode ser
// mapeado em qualquer superfície: caixa reta ou girada, faixa que segue uma curva (faixa transversal, pulseira,
// pintura no rosto), pano ondulando (bandeirinha) ou superfície entre curvas (capa). Dono: orgulho.
//
// Espaço de bandeira: u = 0 na tralha (lado do mastro/do chevron) … 1 na ponta; v = 0 em cima … 1 embaixo.
// Os desenhos extras são definidos em "unidades de altura" (altura = 1, comprimento = aspecto), então o chevron não
// deforma numa faixa comprida e o anel continua redondo.
//
// API estável (outros donos podem usar):
//   flagOf(id)                                   bandeira do catálogo (reserva: arco-íris)
//   flagBands(flag) · flagSequence(flag)         listras normalizadas (0..1) · sequência linear de cores (contas, faixas)
//   drawFlag(ctx, flag, box, opts)               listras + desenho extra numa caixa (compat: recorte, opacidade, onda)
//   drawFlagOn(ctx, flag, surf, opts) → contorno a bandeira inteira numa superfície qualquer
//   boxSurface · bandSurface · curvesSurface · waveSurface    superfícies prontas (FlagSurface)
//   surfacePath(surf, u0, u1, v0, v1)            contorno de um pedaço da superfície (recorte de sombra/brilho)
//   surfaceLine(surf, pts)                       linha aberta em (u,v) mapeada (costura, filete entre listras)
//   flagFolds(ctx, surf, folds, opts)            volume de tecido: vales escuros + cristas claras em u (2 camadas)
//   waveFolds(o)                                 as dobras de um waveSurface (pra passar ao flagFolds)
//   flagStripeEdges(flag, surf)                  filetes nas divisas das listras (esmalte cloisonné, costura)
//   flagPieces(flag, surf, o) · flagShapes(flag, box)   listras + extras como { d, f, r?, ov? } sem ctx (Skia do palco)
//   PROGRESS_CHEVRON · INTERSEX_RING             cores dos desenhos extras
//
// Listras recortadas num path qualquer: drawFlagOn(ctx, flag, boxSurface(caixaQueCobreOPath), { clip: path }).
// Volume de tecido opcional: flagFolds(...) e/ou um gradiente por cima com o mesmo contorno (ver parts/pride.ts).
// `opts.o` < 1 desenha cada listra só no seu trecho (a opacidade não acumula); `seams` põe filetes entre as cores e em
// volta do desenho extra inteiro (pin esmaltado).
//
// Uso típico:  const flag = flagOf(ctx.cfg.prideFlag);
//              const outline = drawFlagOn(ctx, flag, bandSurface(espinha, 6), { clip: tronco });
//              flagFolds(ctx, surf, [{ u: 0.3, w: 0.06, k: -1 }, { u: 0.36, w: 0.05, k: 1 }], { clip: outline });

import { prideFlagDef } from '@cruzei/shared-utils';

import { sampleSpline, smoothPath, type SP } from '../anatomy';
import type { LayerCtx } from '../ctx';
import type { AvatarLayer, Pt } from '../types';

/** mesma forma do AvatarFlagDef do catálogo (shared-utils) */
export interface FlagDef {
  id: string;
  label: string;
  stripes: { hex: string; w?: number }[];
  overlay?: 'progress' | 'intersex' | 'demi' | 'ally';
}

const RAINBOW_HEX = ['#E40303', '#FF8C00', '#FFED00', '#008026', '#004DFF', '#750787'];

const RAINBOW: FlagDef = {
  id: 'rainbow',
  label: 'Arco-íris',
  stripes: RAINBOW_HEX.map((hex) => ({ hex })),
};

/** bandeira do catálogo (reserva: arco-íris, também quando o catálogo publicado ainda não tem prideFlagDef) */
export function flagOf(id: string | null | undefined): FlagDef {
  const fn = prideFlagDef as unknown;
  if (typeof fn === 'function') {
    try {
      const def = (fn as (x: string | null | undefined) => FlagDef | undefined)(id);
      if (def && Array.isArray(def.stripes) && def.stripes.length) return def;
    } catch {
      // catálogo antigo: cai na reserva
    }
  }
  return RAINBOW;
}

// ---------------------------------------------------------------------------------------------------------------
// listras
// ---------------------------------------------------------------------------------------------------------------

export interface FlagBand {
  hex: string;
  /** começo e fim da listra em v (0..1, de cima pra baixo) */
  a: number;
  b: number;
}

/** listras com o peso oficial, normalizadas em v 0..1 */
export function flagBands(flag: FlagDef): FlagBand[] {
  const total = flag.stripes.reduce((s, st) => s + (st.w ?? 1), 0) || 1;
  let acc = 0;
  return flag.stripes.map((st) => {
    const a = acc / total;
    acc += st.w ?? 1;
    return { hex: st.hex, a, b: acc / total };
  });
}

/** cores do chevron Progress Pride, da tralha pra fora (triângulo branco, rosa, azul, marrom, preto) */
export const PROGRESS_CHEVRON = ['#FFFFFF', '#F5A9B8', '#5BCEFA', '#784F17', '#000000'] as const;
/** anel roxo da bandeira intersexo */
export const INTERSEX_RING = '#7902AA';

/**
 * Sequência linear de cores que representa a bandeira em itens finos (pulseira de contas, borda, cordão): listras
 * com peso + o desenho extra entrando onde ele fica na bandeira (chevron antes do arco-íris, triângulo antes das
 * listras demi, anel no meio da intersexo, arco-íris no meio da aliada).
 */
export function flagSequence(flag: FlagDef): { hex: string; w: number }[] {
  const base = flag.stripes.map((s) => ({ hex: s.hex, w: s.w ?? 1 }));
  switch (flag.overlay) {
    case 'progress':
      return [...PROGRESS_CHEVRON.map((hex) => ({ hex, w: 0.7 })), ...base];
    case 'demi':
      return [{ hex: '#000000', w: 2.2 }, ...base];
    case 'intersex':
      return [
        { hex: base[0]?.hex ?? '#FFD800', w: 2 },
        { hex: INTERSEX_RING, w: 1.1 },
        { hex: base[0]?.hex ?? '#FFD800', w: 0.6 },
        { hex: INTERSEX_RING, w: 1.1 },
        { hex: base[0]?.hex ?? '#FFD800', w: 2 },
      ];
    case 'ally': {
      const half = Math.floor(base.length / 2);
      return [...base.slice(0, half), ...RAINBOW_HEX.map((hex) => ({ hex, w: 0.42 })), ...base.slice(half)];
    }
    default:
      return base;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// superfícies (espaço de bandeira → viewBox)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Superfície onde a bandeira é estampada: `at(u, v)` leva o espaço de bandeira (u 0..1 da tralha à ponta, v 0..1 de
 * cima pra baixo) pro grupo atual. Qualquer objeto com esse formato serve (faça a sua pra um caso especial).
 */
export interface FlagSurface {
  at(u: number, v: number): Pt;
  /** comprimento ÷ altura físicos (os desenhos extras usam pra não deformar) */
  aspect: number;
  /** altura física aproximada, em unidades (sobreposição das listras, desfoque) */
  height: number;
  /** mapa afim (caixa reta/girada): bordas retas, sem subdivisão */
  affine?: boolean;
  /** amostras ao longo de u numa borda inteira (padrão 14; superfície comprida/curva: mais) */
  n?: number;
}

export interface FlagBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** caixa reta, girada `angle` graus em volta do centro (horário na tela) e com a tralha à esquerda (ou à direita: mirror) */
export function boxSurface(box: FlagBox, o: { angle?: number; mirror?: boolean; bow?: number } = {}): FlagSurface {
  const a = ((o.angle ?? 0) * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const bow = o.bow ?? 0;
  return {
    at(u, v) {
      const uu = o.mirror ? 1 - u : u;
      const lx = (uu - 0.5) * box.w;
      const ly = (v - 0.5) * box.h + (bow ? bow * 4 * uu * (1 - uu) : 0);
      return [cx + lx * c - ly * s, cy + lx * s + ly * c];
    },
    aspect: box.w / (box.h || 1),
    height: box.h,
    affine: !bow,
    n: bow ? 10 : undefined,
  };
}

/** amostras de uma curva aberta com comprimento de arco acumulado (pra andar nela por fração do comprimento) */
interface Track {
  pts: Pt[];
  acc: number[];
  len: number;
}

function track(spine: readonly SP[], n: number): Track {
  const pts = spine.length > 2 ? sampleSpline(spine, n) : sampleSpline([spine[0], spine[1] ?? spine[0]], n);
  const acc = [0];
  for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, acc, len: acc[acc.length - 1] || 1e-6 };
}

/** ponto e tangente unitária na fração t (0..1) do comprimento */
function trackAt(tr: Track, t: number): { p: Pt; d: Pt } {
  const L = Math.max(0, Math.min(1, t)) * tr.len;
  let i = 1;
  while (i < tr.acc.length - 1 && tr.acc[i] < L) i++;
  const a = tr.pts[i - 1];
  const b = tr.pts[i];
  const seg = tr.acc[i] - tr.acc[i - 1] || 1e-6;
  const k = (L - tr.acc[i - 1]) / seg;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dl = Math.hypot(dx, dy) || 1;
  // fora das pontas (t < 0 ou > 1) estende em linha reta pela tangente da ponta
  const over = t < 0 ? t * tr.len : t > 1 ? (t - 1) * tr.len : 0;
  const p: Pt = [a[0] + dx * k + (dx / dl) * over, a[1] + dy * k + (dy / dl) * over];
  return { p, d: [dx / dl, dy / dl] };
}

/**
 * faixa que segue uma curva: u anda pela espinha (0 = primeiro ponto), v atravessa (0 = lado de "cima" do sentido:
 * à esquerda de quem anda, que é cima numa espinha da esquerda pra direita). `width` = largura ou função de u.
 * `mirror` põe a tralha (u = 0) no fim da espinha.
 */
export function bandSurface(spine: readonly SP[], width: number | ((u: number) => number), o: { mirror?: boolean; n?: number } = {}): FlagSurface {
  const tr = track(spine, o.n ?? Math.max(8, Math.min(28, spine.length * 6)));
  const wf = typeof width === 'function' ? width : () => width;
  const wMid = wf(0.5) || 1;
  return {
    at(u, v) {
      const uu = o.mirror ? 1 - u : u;
      const { p, d } = trackAt(tr, uu);
      // normal do lado de "cima" do sentido de quem anda (y pra baixo): (dy, −dx)
      const half = wf(Math.max(0, Math.min(1, uu))) / 2;
      const k = (0.5 - v) * 2 * half;
      return [p[0] + d[1] * k, p[1] - d[0] * k];
    },
    aspect: tr.len / wMid,
    height: wMid,
    n: Math.max(10, Math.min(36, Math.round(tr.len / 1.6))),
  };
}

/**
 * superfície entre curvas abertas (capa, saia, faixa larga): `curves` de cima pra baixo, cada uma da tralha (u = 0)
 * à ponta; v interpola de uma curva à outra (Catmull-Rom com 3+ curvas: lateral curva, sem quina).
 */
export function curvesSurface(curves: readonly (readonly SP[])[], o: { n?: number } = {}): FlagSurface {
  const trs = curves.map((c) => track(c, o.n ?? 24));
  const m = trs.length;
  const height = (() => {
    let h = 0;
    for (let i = 1; i < m; i++) {
      const a = trackAt(trs[i - 1], 0.5).p;
      const b = trackAt(trs[i], 0.5).p;
      h += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    return h || 1;
  })();
  const len = trs.reduce((s, t) => s + t.len, 0) / (m || 1);
  return {
    at(u, v) {
      const col = trs.map((t) => trackAt(t, u).p);
      if (m === 1) return col[0];
      const x = Math.max(0, Math.min(1, v)) * (m - 1);
      const i = Math.min(m - 2, Math.floor(x));
      const t = x - i;
      const P = (j: number) => col[Math.max(0, Math.min(m - 1, j))];
      return catmull(P(i - 1), P(i), P(i + 1), P(i + 2), t);
    },
    aspect: len / height,
    height,
    n: o.n ?? 24,
  };
}

function catmull(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const t2 = t * t;
  const t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return [f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])];
}

export interface WaveOpts {
  /** topo da tralha (onde o pano prende no mastro) */
  hoist: Pt;
  /** direção do mastro pra BAIXO (unitária ou não) — a tralha desce por ela */
  down: Pt;
  /** direção em que o pano voa (pra fora do mastro) */
  fly: Pt;
  /** comprimento e altura do pano */
  len: number;
  height: number;
  /** amplitude da onda (unidades), número de ondas no comprimento e fase (rad) */
  amp?: number;
  waves?: number;
  phase?: number;
  /** a ponta cai (unidades no fim do comprimento) */
  droop?: number;
}

/**
 * pano ondulando preso num mastro (bandeirinha): a onda cresce da tralha pra ponta, a ponta encurta um pouco nas
 * dobras (perspectiva) e cai com o peso. As dobras (pra sombrear com flagFolds) ficam em waveFolds(o).
 */
export function waveSurface(o: WaveOpts): FlagSurface {
  const nd = Math.hypot(o.down[0], o.down[1]) || 1;
  const dn: Pt = [o.down[0] / nd, o.down[1] / nd];
  const nf = Math.hypot(o.fly[0], o.fly[1]) || 1;
  const fl: Pt = [o.fly[0] / nf, o.fly[1] / nf];
  const amp = o.amp ?? o.height * 0.12;
  const waves = o.waves ?? 1.3;
  const ph = o.phase ?? 0;
  const droop = o.droop ?? o.height * 0.12;
  return {
    at(u, v) {
      const ang = Math.PI * 2 * waves * u + ph;
      const grow = 0.25 + 0.75 * u;
      // o pano encurta onde vira (cos da onda) e balança na vertical (sen)
      const along = u * o.len - Math.abs(Math.sin(ang)) * amp * 0.35 * grow;
      const off = Math.sin(ang) * amp * grow + droop * u * u;
      const vv = v * o.height * (1 - 0.1 * u);
      return [o.hoist[0] + fl[0] * along + dn[0] * (vv + off), o.hoist[1] + fl[1] * along + dn[1] * (vv + off)];
    },
    aspect: o.len / (o.height || 1),
    height: o.height,
    n: 18,
  };
}

/** dobras de uma superfície de waveSurface: vales (k < 0) e cristas (k > 0) em u */
export function waveFolds(o: Pick<WaveOpts, 'waves' | 'phase'>): FlagFold[] {
  const waves = o.waves ?? 1.3;
  const ph = o.phase ?? 0;
  const out: FlagFold[] = [];
  // derivada da onda: sombra onde o pano desce se afastando da luz (cos < 0), luz onde sobe
  for (let i = -1; i < waves * 2 + 2; i++) {
    const uDark = (Math.PI * (i + 0.5) - ph) / (Math.PI * 2 * waves);
    if (uDark > 0.04 && uDark < 0.98) out.push({ u: uDark, w: 0.1, k: i % 2 === 0 ? -1 : 0.85 });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// contornos mapeados
// ---------------------------------------------------------------------------------------------------------------

function sharpPt(p: Pt): SP {
  return [p[0], p[1], 0];
}

/** pontos do contorno do retângulo [u0,u1]×[v0,v1] mapeado (quinas vivas) */
function regionPts(s: FlagSurface, u0: number, u1: number, v0: number, v1: number): SP[] {
  if (s.affine) return [sharpPt(s.at(u0, v0)), sharpPt(s.at(u1, v0)), sharpPt(s.at(u1, v1)), sharpPt(s.at(u0, v1))];
  const n = s.n ?? 14;
  const nu = Math.max(2, Math.ceil(n * Math.abs(u1 - u0)));
  const nv = Math.max(1, Math.ceil(Math.max(2, (n * Math.abs(v1 - v0)) / Math.max(1, s.aspect))));
  const pts: SP[] = [];
  for (let i = 0; i <= nu; i++) {
    const p = s.at(u0 + ((u1 - u0) * i) / nu, v0);
    pts.push(i === 0 || i === nu ? sharpPt(p) : p);
  }
  for (let j = 1; j < nv; j++) pts.push(s.at(u1, v0 + ((v1 - v0) * j) / nv));
  for (let i = nu; i >= 0; i--) {
    const p = s.at(u0 + ((u1 - u0) * i) / nu, v1);
    pts.push(i === 0 || i === nu ? sharpPt(p) : p);
  }
  for (let j = nv - 1; j >= 1; j--) pts.push(s.at(u0, v0 + ((v1 - v0) * j) / nv));
  return pts;
}

/** contorno do pedaço [u0,u1]×[v0,v1] da superfície (padrão: a superfície inteira) */
export function surfacePath(s: FlagSurface, u0 = 0, u1 = 1, v0 = 0, v1 = 1): string {
  return smoothPath(regionPts(s, u0, u1, v0, v1), true);
}

/** linha aberta passando pelos pontos (u, v) da superfície (cada trecho subdividido pra seguir a curva) */
export function surfaceLine(s: FlagSurface, uv: readonly Pt[]): string {
  if (uv.length < 2) return '';
  const out: SP[] = [];
  const n = s.affine ? 1 : (s.n ?? 14);
  for (let i = 0; i < uv.length - 1; i++) {
    const [ua, va] = uv[i];
    const [ub, vb] = uv[i + 1];
    const k = Math.max(1, Math.ceil(n * Math.max(Math.abs(ub - ua), Math.abs(vb - va) / Math.max(1, s.aspect))));
    for (let j = i === 0 ? 0 : 1; j <= k; j++) out.push(s.at(ua + ((ub - ua) * j) / k, va + ((vb - va) * j) / k));
  }
  return smoothPath(out, false, s.affine ? 0 : 1);
}

/** polígono em unidades de altura (x 0..aspecto, y 0..1) mapeado na superfície, quinas vivas nos vértices */
function polyOn(s: FlagSurface, pts: readonly Pt[], mirror: boolean): string {
  const A = Math.max(0.01, s.aspect);
  const U = (x: number) => (mirror ? 1 - x / A : x / A);
  const out: SP[] = [];
  const step = s.affine ? Infinity : 0.18;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    out.push(sharpPt(s.at(U(a[0]), a[1])));
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const k = Number.isFinite(step) ? Math.floor(L / step) : 0;
    for (let j = 1; j < k; j++) out.push(s.at(U(a[0] + ((b[0] - a[0]) * j) / k), a[1] + ((b[1] - a[1]) * j) / k));
  }
  return smoothPath(out, true);
}

/** círculo em unidades de altura mapeado (o anel intersexo) */
function circleOn(s: FlagSurface, cx: number, cy: number, r: number, mirror: boolean, n = 24): string {
  const A = Math.max(0.01, s.aspect);
  const out: SP[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = cx + Math.cos(a) * r;
    out.push(s.at(mirror ? 1 - x / A : x / A, cy + Math.sin(a) * r));
  }
  return smoothPath(out, true);
}

// ---------------------------------------------------------------------------------------------------------------
// desenhos extras (unidades de altura: y 0..1, x 0..aspecto; tralha em x = 0)
// ---------------------------------------------------------------------------------------------------------------

export interface FlagPiece {
  d: string;
  f: string;
  /** regra evenodd (anel) */
  r?: 'evenodd';
  /** peça do desenho extra (chevron, anel, lambda), não listra */
  ov?: boolean;
}

/**
 * Chevron Progress Pride: triângulo branco com a base na tralha inteira e ponta em 0,375 da altura, depois rosa,
 * azul, marrom e preto com 0,09 de largura (na horizontal) cada — a ponta do preto chega a ~49% de uma bandeira 3:2 e
 * o vermelho começa a ~24% no alto, como no desenho de Daniel Quasar. Pintados de fora pra dentro.
 */
const PROG_TIP = 0.375;
const PROG_BAND = 0.09;
/** triângulo demissexual (ponta a ~41% de uma bandeira 3:2) */
const DEMI_TIP = 0.62;
/** anel intersexo: raios externo e interno (unidades de altura), centrado */
const RING_OUT = 0.29;
const RING_IN = 0.195;
/** lambda da aliada: meia-abertura na base, largura (horizontal) de cada faixa do arco-íris */
const ALLY_HALF = 0.42;
const ALLY_BAND = 0.036;

function overlayPieces(flag: FlagDef, s: FlagSurface, mirror: boolean): FlagPiece[] {
  const A = s.aspect;
  const out: FlagPiece[] = [];
  switch (flag.overlay) {
    case 'progress': {
      for (let i = PROGRESS_CHEVRON.length - 1; i >= 0; i--) {
        const x0 = PROG_BAND * i;
        const tip = PROG_TIP + PROG_BAND * i;
        out.push({
          d: polyOn(
            s,
            [
              [0, 0],
              [x0, 0],
              [tip, 0.5],
              [x0, 1],
              [0, 1],
            ],
            mirror,
          ),
          f: PROGRESS_CHEVRON[i],
        });
      }
      break;
    }
    case 'demi':
      out.push({
        d: polyOn(
          s,
          [
            [0, 0],
            [DEMI_TIP, 0.5],
            [0, 1],
          ],
          mirror,
        ),
        f: '#000000',
      });
      break;
    case 'intersex':
      out.push({ d: circleOn(s, A / 2, 0.5, RING_OUT, mirror, 28) + circleOn(s, A / 2, 0.5, RING_IN, mirror, 22), f: INTERSEX_RING, r: 'evenodd' });
      break;
    case 'ally': {
      const cx = A / 2;
      const edge = (k: number): Pt[] => {
        const dx = ALLY_BAND * k;
        return [
          [cx - ALLY_HALF + dx, 1],
          [cx, dx / ALLY_HALF],
          [cx + ALLY_HALF - dx, 1],
        ];
      };
      RAINBOW_HEX.forEach((hex, k) => {
        const o = edge(k);
        const i = edge(k + 1);
        out.push({ d: polyOn(s, [...o, i[2], i[1], i[0]], mirror), f: hex });
      });
      break;
    }
    default:
      break;
  }
  return out;
}

/**
 * contorno de fora do desenho extra inteiro (filete do esmalte): as faixas do chevron e do lambda são finas demais pra
 * ganhar filete cada uma — no pin o dourado engoliria o arco-íris da aliada
 */
function overlayOutline(flag: FlagDef, s: FlagSurface, mirror: boolean): string {
  switch (flag.overlay) {
    case 'progress':
    case 'demi':
    case 'intersex':
      // a primeira peça (chevron preto de fora, triângulo, anel) já é o contorno inteiro
      return overlayPieces(flag, s, mirror)[0]?.d ?? '';
    case 'ally': {
      const cx = s.aspect / 2;
      const k = RAINBOW_HEX.length * ALLY_BAND;
      return polyOn(
        s,
        [
          [cx - ALLY_HALF, 1],
          [cx, 0],
          [cx + ALLY_HALF, 1],
          [cx + ALLY_HALF - k, 1],
          [cx, k / ALLY_HALF],
          [cx - ALLY_HALF + k, 1],
        ],
        mirror,
      );
    }
    default:
      return '';
  }
}

/** listras + extras como paths (sem ctx): o fundo/aura do palco desenha com Skia.Path.MakeFromSVGString */
export function flagPieces(flag: FlagDef, s: FlagSurface, o: { overlay?: boolean; mirror?: boolean; exact?: boolean } = {}): FlagPiece[] {
  const bands = flagBands(flag);
  const mirror = !!o.mirror;
  const out: FlagPiece[] = [];
  // pintor: cada listra vai do começo dela até o fim da bandeira (nenhuma fresta de antisserrilhado entre listras);
  // exact = cada listra só no seu trecho (opacidade < 1 não acumula), com sobreposição mínima
  const eps = Math.min(0.02, 0.18 / Math.max(0.5, s.height));
  bands.forEach((b, i) => {
    const u0 = 0;
    const u1 = 1;
    const v0 = i === 0 ? 0 : b.a;
    const v1 = o.exact ? Math.min(1, b.b + (i < bands.length - 1 ? eps : 0)) : 1;
    out.push({ d: surfacePath(s, u0, u1, v0, v1), f: b.hex });
  });
  if (o.overlay !== false) for (const p of overlayPieces(flag, s, mirror)) out.push({ ...p, ov: true });
  return out;
}

/** bandeira inteira numa caixa (sem ctx), pra quem desenha fora das camadas (Skia do palco) */
export function flagShapes(flag: FlagDef, box: FlagBox, o: { angle?: number; mirror?: boolean } = {}): FlagPiece[] {
  return flagPieces(flag, boxSurface(box, { angle: o.angle }), { mirror: o.mirror });
}

// ---------------------------------------------------------------------------------------------------------------
// desenho nas camadas
// ---------------------------------------------------------------------------------------------------------------

export interface FlagOpts {
  /** recorte (a bandeira só aparece dentro dessa forma): pin, coração, capa… */
  clip?: string;
  /** etiqueta das camadas (padrão 'pride') */
  k?: AvatarLayer['k'];
  /** opacidade (abaixo de 1 as listras não se sobrepõem) */
  o?: number;
  /** ondulação vertical das listras (0 = retas), em unidades: a capa "voando" (drawFlag) */
  wave?: number;
  /** desenha o desenho extra (chevron, anel, lambda) — padrão true */
  overlay?: boolean;
  /** tralha na outra ponta (u = 1): bandeira vista de trás, faixa com o chevron no fim */
  mirror?: boolean;
  /** desfoque leve das listras (borda de tinta macia); some no 'lite' */
  b?: number;
  /**
   * filetes entre as cores (esmalte cloisonné, costura): entre as listras por baixo do desenho extra e em volta de
   * cada peça dele — cor, espessura e opacidade
   */
  seams?: { s: string; w: number; o?: number };
}

/** bandeira inteira (listras + extras) na superfície; devolve o contorno da superfície (pra recortes de volume) */
export function drawFlagOn(ctx: LayerCtx, flag: FlagDef, s: FlagSurface, opts: FlagOpts = {}): string {
  const k = opts.k ?? 'pride';
  const exact = opts.o != null && opts.o < 1;
  const outline = surfacePath(s);
  const pieces = flagPieces(flag, s, { overlay: opts.overlay, mirror: opts.mirror, exact });
  const sm = opts.seams;
  const seamClip = opts.clip ?? outline;
  let stripesDone = false;
  for (const p of pieces) {
    if (p.ov && !stripesDone) {
      stripesDone = true;
      if (sm) ctx.stroke(flagStripeEdges(flag, s), sm.s, sm.w, { o: sm.o ?? 1, cp: seamClip, k });
    }
    const extra: Partial<AvatarLayer> = { k };
    if (opts.clip) extra.cp = opts.clip;
    if (opts.o != null) extra.o = opts.o;
    if (opts.b) extra.b = opts.b;
    if (p.r) extra.r = p.r;
    ctx.push(p.d, p.f, extra);
  }
  if (sm && !stripesDone) ctx.stroke(flagStripeEdges(flag, s), sm.s, sm.w, { o: sm.o ?? 1, cp: seamClip, k });
  const ovEdge = sm && opts.overlay !== false ? overlayOutline(flag, s, !!opts.mirror) : '';
  if (sm && ovEdge) ctx.stroke(ovEdge, sm.s, sm.w, { o: sm.o ?? 1, cp: seamClip, k });
  return outline;
}

/** listras da bandeira dentro da caixa (no grupo atual do ctx), com o desenho extra oficial */
export function drawFlag(ctx: LayerCtx, flag: FlagDef, box: FlagBox, opts: FlagOpts = {}): void {
  drawFlagOn(ctx, flag, boxSurface(box, { bow: opts.wave, mirror: opts.mirror }), opts);
}

/** dobra do pano: posição u, meia-largura em u e intensidade (k < 0 vale escuro, k > 0 crista clara) */
export interface FlagFold {
  u: number;
  w: number;
  k: number;
  /** trecho em v (padrão 0..1) e inclinação: a dobra anda `slant` em u de cima pra baixo */
  v0?: number;
  v1?: number;
  slant?: number;
}

/**
 * volume de tecido por cima da bandeira: todos os vales numa camada escura e todas as cristas numa clara, recortadas
 * no contorno e desfocadas (no 'lite' o lodCtx tira o desfoque). Cada dobra é uma faixa em forma de fuso.
 */
export function flagFolds(ctx: LayerCtx, s: FlagSurface, folds: readonly FlagFold[], opts: { clip?: string; o?: number; b?: number; dark?: string; light?: string; k?: AvatarLayer['k'] } = {}): void {
  let dark = '';
  let light = '';
  for (const f of folds) {
    const v0 = f.v0 ?? 0;
    const v1 = f.v1 ?? 1;
    const sl = f.slant ?? 0;
    const n = 7;
    const L: SP[] = [];
    const R: SP[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const v = v0 + (v1 - v0) * t;
      // fuso: mais fino nas pontas da dobra
      const w = f.w * (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, 0.15 + t * 0.85)));
      const u = f.u + sl * (t - 0.5);
      L.push(s.at(u - w, v));
      R.push(s.at(u + w, v));
    }
    const d = smoothPath([...L, ...R.reverse()], true);
    if (f.k < 0) dark += d;
    else light += d;
  }
  const clip = opts.clip ?? surfacePath(s);
  const blur = opts.b ?? Math.max(0.25, s.height * 0.07);
  // k ausente = 'pride' (bandeira); `k: undefined` de propósito = tecido comum sem etiqueta (capa, manto)
  const k = 'k' in opts ? opts.k : 'pride';
  const strength = (sign: number) => {
    const ks = folds.filter((f) => Math.sign(f.k) === sign).map((f) => Math.abs(f.k));
    return ks.length ? ks.reduce((a, b) => a + b, 0) / ks.length : 0;
  };
  if (dark) ctx.push(dark, opts.dark ?? '#14081A', { o: (opts.o ?? 0.32) * strength(-1), b: blur, cp: clip, k });
  if (light) ctx.push(light, opts.light ?? '#FFFFFF', { o: (opts.o ?? 0.32) * 0.75 * strength(1), b: blur * 1.15, cp: clip, k });
}

/** filetes nas divisas das listras (esmalte cloisonné do pin, costura entre listras de tecido) */
export function flagStripeEdges(flag: FlagDef, s: FlagSurface): string {
  let d = '';
  for (const b of flagBands(flag).slice(1)) d += surfaceLine(s, [
    [0, b.a],
    [1, b.a],
  ]);
  return d;
}
