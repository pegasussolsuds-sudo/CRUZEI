// Texturizados: cacheado, cacheado longo, black power, puff, twists, nagô, tranças, dreads e trança coroa. Dono: cabelo.
//
// Cada textura tem linguagem própria (crítica da rodada 4):
//   - cacheado: CACHOS-MASSA (gota com bossas, alongada no caimento) em camadas de profundidade, oclusão forte dentro, luz
//     só nos cachos virados pra luz (alto-esquerda), Cs menores e frizz fino só no contorno — nada de macarrão;
//   - crespo (black power, puff): volume esférico de contorno macio e irregular, borda um passo mais escura (sem halo
//     borrado), luz de topo larga, microcachos traçados;
//   - twists, tranças e locs: CORDAS com textura própria (diagonais, gomos em V, gomos irregulares), volume de cilindro e
//     sombra de uma corda na outra; raiz saindo da divisão do couro cabeludo;
//   - nagô: fileiras de trança coladas no crânio com o couro cabeludo aparecendo entre elas.

import { smoothPath, taperPath, type SP } from '../anatomy';
import { lum, mix } from '../shading';

import { capOutline, paintCap, skullPt, softHairline } from './hair-cap';
import {
  castOnBody,
  coils,
  curlEdge,
  edgeShade,
  flyaways,
  foreheadShadow,
  massGrad,
  onShoulder,
  paintClumps,
  paintRopes,
  rnd,
  shoulderTop,
  softOutline,
  type Clump,
  type HairKit,
  type Rope,
} from './hair-kit';
import { fallPanel } from './hair-long';
import { sleekCap } from './hair-updo';

type Style = { back?: (k: HairKit) => void; front?: (k: HairKit) => void; belowWrap?: boolean };

// ---------------------------------------------------------------------------------------------------------------
// cacheado
// ---------------------------------------------------------------------------------------------------------------

interface CurlOpts {
  /** volume acima do crânio */
  lift: number;
  /** até onde descem as laterais (cabeça unitária); com `long` o painel cai no peito */
  low: number;
  long?: boolean;
  seed: number;
}

/** cacho (cabeça unitária → avatar): centro, raio, direção do caimento (dx, dy), alongamento */
function clumpAt(k: HairKit, x: number, y: number, r: number, dx: number, dy: number, e: number, seed: number): Clump {
  const p = k.H(x, y);
  return { x: p[0], y: p[1], r: r * k.s, a: Math.atan2(-dx, dy), k: seed, e };
}

/** cachos do topo: arco em volta do crânio (cabeça unitária), virados pra fora e caindo de leve */
function crownCurls(k: HairKit, lift: number, r0: number, seed: number, from = -104, to = 104, step = 21): Clump[] {
  const r = rnd(seed);
  const out: Clump[] = [];
  for (let a = from; a <= to + 0.1; a += step) {
    const aa = a + (r() - 0.5) * 6;
    const p = skullPt(k, aa, lift * (0.55 + r() * 0.2));
    const u = k.U(p);
    const rad = (aa * Math.PI) / 180;
    out.push(clumpAt(k, u[0], u[1], r0 * (0.75 + r() * 0.5), Math.sin(rad) * 0.7, 0.6 - Math.cos(rad) * 0.2, 1.1 + r() * 0.4, r()));
  }
  return out;
}

/** coluna de cachos caindo do lado g, de y0 a y1 (cabeça unitária), afastada `x` do centro */
function sideCurls(k: HairKit, g: 1 | -1, x: (y: number) => number, y0: number, y1: number, r0: number, seed: number): Clump[] {
  const r = rnd(seed);
  const out: Clump[] = [];
  let y = y0;
  while (y <= y1) {
    // tamanhos e alongamentos desencontrados (cacho em mola), sobrepostos: nada de "coluna de bolinhas"
    const rr = r0 * (0.72 + r() * 0.56);
    out.push(clumpAt(k, g * (x(y) + (r() - 0.35) * 1.1), y, rr, g * (0.15 + r() * 0.3), 1, 1.55 + r() * 0.55, r()));
    y += rr * (1.15 + r() * 0.35);
  }
  return out;
}

/** contorno de fora dos cachos (pra Cs e frizz da borda) */
function curlRim(k: HairKit, list: readonly Clump[], out = 0.9): SP[] {
  const cy = k.H(0, -2)[1];
  return list.map((c) => {
    const dx = c.x - k.cx;
    const dy = c.y - cy;
    const L = Math.hypot(dx, dy) || 1;
    return [c.x + (dx / L) * c.r * out, c.y + (dy / L) * c.r * out] as SP;
  });
}

function curlyBack(k: HairKit, o: CurlOpts): void {
  const { ctx, t, H, Wc, Jw, CR, cx, nk, an } = k;
  const lift = k.flat ? 0.2 : o.lift;
  const low = o.low;
  // massa escura de trás (só até `low`): o interior que aparece entre os cachos
  const yLow = o.long ? an.armpitY + 3 : H(0, low)[1];
  const half = (g: 1 | -1): SP[] => [
    H(g * (Wc + lift * 0.8), CR + 2.6),
    H(g * (Wc + 2.6), -3.5),
    H(g * (Wc + 3.0), 1.5),
    o.long ? [cx + g * (nk + 7.5), shoulderTop(an, g, cx + g * (nk + 7)) - 1] : H(g * (Jw + 2.6), low - 1.2),
    o.long ? [cx + g * (nk + 6), yLow] : H(g * (Jw + 0.6), low + 0.4),
  ];
  const pts: SP[] = [H(0, CR - lift + 0.4), ...half(1), [cx, yLow + 0.5], ...half(-1).reverse()];
  const d = smoothPath(pts);
  ctx.push(d, mix(t.base, t.deep, 0.45), { gf: { t: 'l', x1: 0, y1: H(0, CR)[1], x2: 0, y2: yLow, s: [[0, mix(t.base, t.deep, 0.3)], [1, mix(t.base, t.deep, 0.65)]] } });
  // cachos de trás pela silhueta (pouca luz)
  const list: Clump[] = [];
  for (const g of [-1, 1] as const) {
    list.push(...sideCurls(k, g, (y) => (y < 2 ? Wc + 2.2 : Jw + 2.4 - (y - jawRef(k)) * 0.1), -3, o.long ? low - 2 : low - 0.8, 2.2, o.seed + (g > 0 ? 1 : 2)));
  }
  if (o.long) {
    // cachos de trás caindo pelas costas, aparecendo acima e ao lado do ombro
    for (const g of [-1, 1] as const) {
      for (let i = 0; i < 3; i++) {
        const p = onShoulder(k, g, nk + 5.5 + i * 1.6, 1.2 + i * 0.4);
        list.push({ x: p[0], y: p[1] - i * 1.4, r: 2.1 * k.s, a: 0, k: (i * 0.37 + (g > 0 ? 0.2 : 0.7)) % 1, e: 1.5 });
      }
    }
  }
  paintClumps(k, list, mix(t.base, t.root, 0.3), { cp: d, light: 0.35, shadowO: 0.4 });
}

const jawRef = (k: HairKit) => k.jawY;

function curlyFront(k: HairKit, o: CurlOpts): void {
  const { t, H, Wc, Tm, Jw, CR, lite } = k;
  const lift = k.flat ? 0.2 : o.lift;
  const cap = capOutline(k, { lift: Math.min(lift, 1.6), side: 0.8, hl: -7.2, cover: undefined });
  paintCap(k, cap, { tone: mix(t.base, t.root, 0.45), shadow: 0.3 });
  const under = cap.d;
  // camada 1: cachos do topo (atrás da franja)
  if (!k.flat) {
    paintClumps(k, crownCurls(k, lift, 2.8, o.seed, -100, 100, 25), mix(t.base, t.root, 0.12), { cp: under, light: 0.8 });
  }
  // camada 2: laterais caindo (na frente da orelha até a mandíbula, ou no peito)
  const sides: Clump[] = [];
  let panels = '';
  for (const g of [-1, 1] as const) {
    const y0 = k.flat ? -4 : -5.8;
    if (o.long) {
      // painel que pousa no ombro e cai no peito: massa de base (nenhuma fresta mostra a roupa) + cachos em 2 colunas
      // amostrados pelo COMPRIMENTO da mecha (passo ≈ 0,8 do raio, sobrepostos) do rosto até a ponta, sem buraco na
      // dobra do ombro nem grupo solto no peito
      const P = fallPanel(k, g, { len: 3.5, lift, px: 0, full: 1.8 });
      const last = P.inner.findIndex((p) => p[1] > P.tipY + 1);
      const end = last < 0 ? P.inner.length : last + 1;
      panels += smoothPath([...P.inner.slice(2, end), ...P.outer.slice(2, end).reverse()]);
      const rr = rnd(o.seed + (g > 0 ? 11 : 13));
      for (const u of [0.28, 0.72]) {
        let prev: SP | null = null;
        for (let j = 2; j < end; j++) {
          const a = P.inner[j];
          const b = P.outer[j];
          const w = Math.hypot(b[0] - a[0], b[1] - a[1]);
          const r0 = Math.min(2.4 * k.s, w * 0.34);
          const m: SP = [a[0] + (b[0] - a[0]) * u, Math.min(P.tipY, a[1] + (b[1] - a[1]) * u)];
          if (prev && Math.hypot(m[0] - prev[0], m[1] - prev[1]) < r0 * 0.8 && j < end - 1) continue;
          prev = m;
          const x = a[0] + (b[0] - a[0]) * (u + (rr() - 0.5) * 0.12);
          sides.push({ x, y: m[1], r: r0 * (0.8 + rr() * 0.4), a: g * (0.05 + rr() * 0.25), k: rr(), e: 1.8 + rr() * 0.5 });
        }
      }
    } else {
      sides.push(...sideCurls(k, g, (y) => (y < 1 ? Tm + 0.9 : Jw + 1.3 + (1 - Math.min(1, (y - 1) / 6)) * 0.8), y0, o.low - 1.4, 2.0, o.seed + (g > 0 ? 3 : 4)));
    }
  }
  if (panels) {
    const ys = sides.map((c) => c.y);
    k.ctx.push(panels, mix(t.base, t.root, 0.4), { gf: { t: 'l', x1: 0, y1: Math.min(...ys), x2: 0, y2: Math.max(...ys) + 2, s: [[0, mix(t.base, t.root, 0.3)], [1, mix(t.base, t.root, 0.6)]] } });
  }
  paintClumps(k, sides, t.base, { cp: under, light: 0.6 });
  // camada 3: franja de cachos menores na testa (só sem chapéu que cubra a testa)
  if (k.fringe) {
    const r = rnd(o.seed + 5);
    const fr: Clump[] = [];
    const xs = [-6.4, -4.4, -2.3, -0.2, 2.0, 4.2, 6.2];
    for (const x of xs) {
      const y = -8.0 + Math.pow(Math.abs(x) / 6.5, 2) * 2.6 + (r() - 0.5) * 0.5;
      fr.push(clumpAt(k, x, y, 1.65 * (0.85 + r() * 0.3), x * 0.06, 1, 1.3 + r() * 0.2, r()));
    }
    // dois cachinhos caindo mais na testa (quebra a linha)
    fr.push(clumpAt(k, -3.2, -6.4, 1.3, -0.2, 1, 1.5, 0.3), clumpAt(k, 1.4, -6.7, 1.2, 0.2, 1, 1.5, 0.8));
    const fd = paintClumps(k, fr, mix(t.base, t.lock, 0.05), { cp: under + k.ha.headPath, light: 1 });
    foreheadShadow(k, fr.map((c) => [c.x, c.y + c.r * 0.9] as SP).sort((a, b) => a[0] - b[0]), 0.28, 1.4, 0.4);
    void fd;
  }
  // borda: Cs pequenos e frizz fino rompendo a silhueta
  const rim = [...(k.flat ? [] : curlRim(k, crownCurls(k, lift + 0.6, 2.4, o.seed + 9, -96, 96, 16), 0.7)), ...curlRim(k, sides, 0.85)];
  curlEdge(k, rim, { r0: 0.55 * k.s, r1: 1.0 * k.s, seed: o.seed + 7, frizz: t.pale ? 0.4 : 0.7 });
  if (!lite && !k.flat) {
    flyaways(k, [
      [H(-(Wc + 1.2), CR + 0.6), H(-(Wc + 2.6), CR - 0.6), H(-(Wc + 3.4), CR + 0.8)],
      [H(2.2, CR - lift - 1.4), H(3.6, CR - lift - 2.2), H(5.0, CR - lift - 1.7)],
    ], 0.35, 0.18);
  }
}

const CURLY: CurlOpts = { lift: 2.6, low: 8.2, seed: 101 };
const LONG_CURLY: CurlOpts = { lift: 2.9, low: 9, long: true, seed: 131 };

// ---------------------------------------------------------------------------------------------------------------
// crespo: black power e puff
// ---------------------------------------------------------------------------------------------------------------

/** esfera crespa (avatar): contorno macio irregular, borda um passo mais escura, luz de topo larga e microcachos */
function kinkyBall(k: HairKit, c: SP, rx: number, ry: number, seed: number, o: { clip?: string; amp?: number; n?: number } = {}): { d: string; pts: SP[] } {
  const { ctx, t, lite, s } = k;
  const pts = softOutline(c[0], c[1], rx, ry, o.n ?? 15, (o.amp ?? 0.55) * s, seed);
  const d = smoothPath(pts);
  ctx.push(d, t.base, { gf: massGrad(k, [c[0], c[1]], Math.max(rx, ry) * 1.15, t.base, { hi: 0.4, lo: 0.8 }), ...(o.clip ? { cp: o.clip } : {}) });
  // borda: um passo mais escura, por dentro (sem halo pra fora)
  edgeShade(k, pts, -0.9 * s, -0.4 * s, t.pale ? mix(t.base, t.deep, 0.5) : t.root, t.pale ? 0.35 : 0.5, 0.6);
  // crespo escuro na miniatura: luz de recorte fria no alto/esquerda da borda — a silhueta não some no fundo escuro
  if (lite && lum(ctx.col.hair) < 0.05) edgeShade(k, pts, 0.8 * s, 0.6 * s, t.sheen, 0.32, 0.6);
  // luz de topo larga (alto-esquerda)
  if (!lite) ctx.push(smoothPath(softOutline(c[0] - rx * 0.28, c[1] - ry * 0.42, rx * 0.5, ry * 0.32, 8, 0.3 * s, seed + 3)), t.sheen, { o: t.pale ? 0.28 : 0.3, b: 1.4, cp: d });
  // microcachos: escuros por todo lado, claros só em cima
  const box = { x: c[0] - rx - 1, y: c[1] - ry - 1, w: rx * 2 + 2, h: ry * 2 + 2 };
  if (!lite) {
    coils(k, d, box, t.pale ? mix(t.base, t.deep, 0.6) : t.deep, t.pale ? 0.4 : 0.55, 0.42 * s, 0.95 * s, seed + 5, 0.17 * s);
    coils(k, d, box, t.lock, t.pale ? 0.35 : 0.42, 0.38 * s, 1.15 * s, seed + 7, 0.15 * s, (x, y) => y < c[1] - ry * 0.1 + (x - c[0]) * 0.3);
  } else if (!k.tiny) {
    coils(k, d, box, t.deep, 0.4, 0.6 * s, 1.8 * s, seed + 5, 0.3 * s);
  }
  return { d, pts };
}

function afroGeo(k: HairKit): { c: SP; rx: number; ry: number } {
  const { H, Wc, s } = k;
  if (k.flat) return { c: H(0, -2.6), rx: (Wc + 3.6) * s, ry: 8.4 * s };
  return { c: H(0, -4.6), rx: (Wc + 5.4) * s, ry: 12.2 * s };
}

function afroBack(k: HairKit): void {
  const g = afroGeo(k);
  kinkyBall(k, g.c, g.rx, g.ry, 211);
  // oclusão em volta do rosto (a cabeça "afunda" na massa)
  k.ctx.push(k.ha.headPath, '#07030A', { o: 0.35, ...(k.lite ? {} : { b: 1.2 }) });
}

function afroFront(k: HairKit): void {
  const { ctx, t, lite } = k;
  const g = afroGeo(k);
  // a parte da massa na frente da testa e das têmporas: a mesma esfera (mesma textura), recortada na calota
  const cap = capOutline(k, { lift: 0.6, side: 0.8, hl: -7.3, sideburn: k.earTop + 1.4 });
  foreheadShadow(k, cap.edge.slice(1, -1), 0.3, 1.4, 0.6);
  const ball = softOutline(g.c[0], g.c[1], g.rx, g.ry, 15, 0.55 * k.s, 211);
  ctx.push(smoothPath(ball), t.base, { gf: massGrad(k, [g.c[0], g.c[1]], Math.max(g.rx, g.ry) * 1.15, t.base, { hi: 0.4, lo: 0.8 }), cp: cap.d });
  const box = { x: g.c[0] - g.rx - 1, y: g.c[1] - g.ry - 1, w: g.rx * 2 + 2, h: g.ry * 2 + 2 };
  if (!lite) {
    coils(k, cap.d, box, t.pale ? mix(t.base, t.deep, 0.6) : t.deep, t.pale ? 0.4 : 0.55, 0.42 * k.s, 0.95 * k.s, 216, 0.17 * k.s);
    coils(k, cap.d, box, t.lock, t.pale ? 0.35 : 0.42, 0.38 * k.s, 1.15 * k.s, 218, 0.15 * k.s, (x, y) => y < g.c[1] - g.ry * 0.1 + (x - g.c[0]) * 0.3);
  } else if (!k.tiny) {
    // a mesma textura leve da massa de trás (kinkyBall): sem ela a frente lisa lia uma boina em volta da testa
    coils(k, cap.d, box, t.deep, 0.4, 0.6 * k.s, 1.8 * k.s, 216, 0.3 * k.s);
  }
  // linha do cabelo macia (crespo cresce em penugem na borda)
  softHairline(k, cap.edge.slice(2, cap.edge.length - 2), cap.d, { temple: 1, mid: 0.35 });
}

/** puff: calota puxada e um pompom crespo no alto, preso por um elástico */
function puffFront(k: HairKit): void {
  const { ctx, t, H, s } = k;
  if (!k.flat) {
    const c = H(0.4, k.CR - 4.4);
    kinkyBall(k, c, 5.6 * s, 4.6 * s, 241, { amp: 0.45, n: 11 });
  }
  sleekCap(k, { lift: 0.35, side: 0.3, hl: -7.4, to: [0.3, k.CR - 0.4], lines: 7 });
  if (!k.flat) {
    // elástico na base do pompom
    ctx.push(taperPath([H(-2.6, k.CR - 0.3), H(0.3, k.CR + 0.25), H(3.2, k.CR - 0.3)], [0.8 * s, 1.0 * s, 0.8 * s]), mix(t.deep, '#000000', 0.35), { o: 0.9 });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// cordas: twists, tranças, locs
// ---------------------------------------------------------------------------------------------------------------

interface RopeHair {
  kind: 'braid' | 'twist' | 'loc';
  /** largura da corda (cabeça unitária) */
  w: number;
  /** comprimento: y das pontas = axila + len */
  len: number;
  lift: number;
  /** cordas por lado na frente */
  front: number;
  seed: number;
  /** cordas curtas caindo na testa */
  fringe?: number;
}

/** couro cabeludo dividido: base escura com as divisões (pele) em grade */
function partedScalp(k: HairKit, o: { lift: number; rows: number; hl?: number }): string {
  const { ctx, t, H, s, lite, CR } = k;
  const cap = capOutline(k, { lift: o.lift, side: 0.4, hl: o.hl ?? -7.4, sideburn: k.earTop + 1.0, sbThin: 0.5 });
  paintCap(k, cap, { tone: mix(t.base, t.root, 0.5), shadow: 0.25 });
  if (!lite) {
    // divisões em quadradinhos (box braids): linhas finas de pele seguindo o crânio
    let d = '';
    for (let i = 1; i < o.rows; i++) {
      const a = -100 + (200 * i) / o.rows;
      const pts: SP[] = [];
      for (let j = 0; j <= 4; j++) pts.push(skullPt(k, a * (0.35 + j * 0.16), o.lift * 0.3));
      d += taperPath(pts, [0.05, 0.22 * s, 0.22 * s, 0.05]);
    }
    for (const y of [-8.9, -10.2]) d += taperPath([H(-k.Wc + 1, y + 2.6), H(-3, y), H(3, y), H(k.Wc - 1, y + 2.6)], [0.05, 0.2 * s, 0.2 * s, 0.05]);
    ctx.push(d, mix(ctx.col.skin, t.root, 0.35), { o: 0.6, cp: cap.d });
  }
  void CR;
  return cap.d;
}

/** eixo de uma corda: raiz no crânio (ângulo a), passa por cima da cabeça e cai até a ponta, pela lateral */
function ropeSpine(k: HairKit, a: number, lift: number, end: SP, outK = 1): SP[] {
  const g = Math.sign(a) || 1;
  const root = skullPt(k, a * 0.55, lift * 0.3);
  const over = skullPt(k, Math.min(100, Math.abs(a) * 0.85 + 16) * g, lift + 0.4);
  const side = k.H(g * (k.Wc + lift * 0.6 + 0.6 * outK + Math.abs(a) / 90), -2.4 + Math.abs(a) * 0.02);
  return [root, over, side, [(side[0] + end[0]) / 2 + g * 0.3, (side[1] + end[1]) / 2], end];
}

function ropesBack(k: HairKit, o: RopeHair): void {
  const { H, cx, nk, an, s } = k;
  const lift = k.flat ? 0.2 : o.lift;
  const tipY = an.armpitY + o.len;
  const ropes: Rope[] = [];
  const r = rnd(o.seed);
  for (const g of [-1, 1] as const) {
    for (let i = 0; i < 4; i++) {
      const dx = nk + 2.2 + i * 1.7;
      const st = shoulderTop(an, g, cx + g * dx);
      const end: SP = [cx + g * (dx + 0.6), Math.max(H(0, k.jawY + 2)[1], Math.min(tipY + (r() - 0.5) * 2, st + 6))];
      const sp: SP[] = [H(g * (k.Wc * 0.4 + i * 1.6), k.CR + 1.4), H(g * (k.Wc + lift * 0.5 + 1.0 + i * 0.6), -4 + i * 0.6), H(g * (k.Jw + 2.2 + i * 0.9), k.jawY), end];
      ropes.push({ spine: sp, w: o.w * s * (0.9 + r() * 0.2), z: i % 2, taper: 0.25, dark: 0.1 });
    }
  }
  paintRopes(k, ropes, o.kind, { seed: o.seed + 1, shadowO: 0.3 });
}

function ropesFront(k: HairKit, o: RopeHair): void {
  const { H, cx, nk, an, s, t } = k;
  const lift = k.flat ? 0.2 : o.lift;
  const scalp = partedScalp(k, { lift: Math.min(lift, 1.2), rows: o.front + 2 });
  const tipY = an.armpitY + o.len;
  const r = rnd(o.seed + 3);
  const ropes: Rope[] = [];
  for (const g of [-1, 1] as const) {
    const shoulder = tipY > shoulderTop(an, g, cx + g * (nk + 4)) + 1.5;
    for (let i = 0; i < o.front; i++) {
      const u = (i + 0.5) / o.front;
      const a = g * (10 + u * 88);
      // as de dentro caem na frente do ombro (pousam e descem no peito); as de fora vão pra trás do ombro
      let end: SP;
      if (shoulder) {
        const dx = nk + 1.6 + u * 4.2;
        end = [cx + g * dx, tipY + (r() - 0.5) * 3 - u * 1.5];
      } else {
        end = H(g * (k.Jw + 1.0 + u * 1.6), Math.max(k.jawY + 0.5, k.U([0, tipY])[1]) + (r() - 0.5) * 1.2);
      }
      const sp = ropeSpine(k, a, lift, end, 0.6 + u * 0.8);
      if (shoulder) {
        // pousa no ombro: um ponto sobre o trapézio entre a lateral e a ponta
        const q = onShoulder(k, g, nk + 1.8 + u * 4.0, -0.2 - o.w * s * 0.5);
        sp.splice(3, 1, [q[0] - g * 0.4, q[1] - 2.2], q);
      }
      ropes.push({ spine: sp, w: o.w * s * (0.9 + r() * 0.2), z: Math.round((1 - u) * 2), taper: o.kind === 'loc' ? 0.15 : 0.3 });
    }
  }
  // sombra das cordas no pescoço e na roupa
  castOnBody(k, ropes.map((rp) => taperPath(rp.spine.map((p) => [p[0] + 0.5, p[1] + 0.8] as SP), [rp.w, rp.w], { n: 8 })).join(''), 0.28);
  const all = paintRopes(k, ropes, o.kind, { under: scalp, seed: o.seed + 5, shadowO: 0.32 });
  // cordas curtas caindo na testa (twists): de um lado, pontas soltas
  if (o.fringe && k.fringe) {
    const fr: Rope[] = [];
    for (let i = 0; i < o.fringe; i++) {
      const x0 = -2.6 + i * 1.7;
      fr.push({ spine: [H(x0 + 0.9, -10.2), H(x0 + 0.2, -8.6), H(x0 - 0.9, -6.6), H(x0 - 1.6 - i * 0.3, -4.9 + i * 0.5)], w: o.w * s * 0.92, z: 3, taper: 0.4 });
    }
    paintRopes(k, fr, o.kind, { under: all, seed: o.seed + 7, shadowO: 0.4 });
    foreheadShadow(k, fr.map((f) => f.spine[2]).sort((a, b) => a[0] - b[0]), 0.3, 1.5, 0.5);
  }
  // penugem da linha do cabelo (baby hair) com a borda macia
  softHairline(k, capOutline(k, { lift: 0.4, hl: -7.4 }).edge.slice(2, -2), scalp, { temple: 0.9, mid: 0.3 });
  void t;
}

const TWISTS: RopeHair = { kind: 'twist', w: 1.55, len: -6.5, lift: 1.8, front: 5, seed: 301, fringe: 2 };
const BRAIDS: RopeHair = { kind: 'braid', w: 1.15, len: 7, lift: 1.0, front: 6, seed: 331 };
const DREADS: RopeHair = { kind: 'loc', w: 1.8, len: 3, lift: 1.6, front: 5, seed: 361 };

// ---------------------------------------------------------------------------------------------------------------
// nagô e trança coroa
// ---------------------------------------------------------------------------------------------------------------

/** nagô: fileiras de trança coladas no crânio, da testa pra nuca; couro cabeludo aparecendo entre elas */
function cornrowsFront(k: HairKit): void {
  const { ctx, t, H, s } = k;
  const cap = capOutline(k, { lift: 0.35, side: 0.25, hl: -7.5, sideburn: k.earTop + 0.9, sbThin: 0.5 });
  // couro cabeludo com sombra de cabelo
  ctx.push(cap.d, mix(ctx.col.skin, t.root, 0.55), { o: 0.95 });
  const rows: Rope[] = [];
  const n = 7;
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1) - 0.5;
    const x = u * 2 * (k.Wc - 1.6);
    // do meio da testa sobe pela calota; as de fora curvam pra trás das orelhas
    const sp: SP[] = [H(x * 0.92, -7.4 + u * u * 2.6), H(x * 1.02, -9.4 + u * u * 1.8), skullPt(k, u * 2 * 62, 0.25), skullPt(k, u * 2 * 92, 0.25)];
    rows.push({ spine: sp, w: (1.55 - Math.abs(u) * 0.4) * s, taper: 0.1, z: 0 });
  }
  for (const g of [-1, 1] as const) {
    // fileira lateral: da têmpora pra trás da orelha
    rows.push({ spine: [H(g * (k.Tm - 0.9), -4.0), H(g * (k.Wc - 0.3), -6.0), H(g * (k.Wc + 0.2), -8.2)], w: 1.25 * s, taper: 0.1, z: 0 });
  }
  paintRopes(k, rows, 'braid', { seed: 401, lobe: 0.85, shadowO: 0.3, under: cap.d });
  softHairline(k, cap.edge.slice(2, cap.edge.length - 2), cap.d, { temple: 0.8, mid: 0.25 });
}

/** nagô: as tranças terminam soltas atrás, caindo pela nuca até os ombros */
function cornrowsBack(k: HairKit): void {
  const { H, cx, nk, an, s } = k;
  const ropes: Rope[] = [];
  for (const g of [-1, 1] as const) {
    for (let i = 0; i < 3; i++) {
      const dx = nk + 0.8 + i * 1.5;
      ropes.push({ spine: [H(g * (2 + i * 1.6), -4), H(g * (k.Jw + 0.4 + i * 0.4), k.jawY), [cx + g * dx, shoulderTop(an, g, cx + g * dx) + 4 + i]], w: 1.1 * s, z: i, taper: 0.4 });
    }
  }
  paintRopes(k, ropes, 'braid', { seed: 411, shadowO: 0.3 });
}

/** trança coroa: cabelo puxado e uma trança grossa contornando a cabeça do alto de uma orelha à outra */
function braidCrownFront(k: HairKit): void {
  const { H, s } = k;
  const cap = sleekCap(k, { lift: 0.7, side: 0.4, hl: -7.5, to: [0, k.CR + 1.2], lines: 7 });
  if (k.flat) return;
  const crown: SP[] = [];
  for (let a = -104; a <= 104; a += 26) crown.push(skullPt(k, a, 1.0 + Math.cos((a * Math.PI) / 180) * 0.6, 1.02));
  const sp = crown.map((p, i) => [p[0], p[1] + (i === 0 || i === crown.length - 1 ? 1.2 : 0)] as SP);
  paintRopes(k, [{ spine: sp, w: 3.0 * s, taper: 0.05, z: 0 }], 'braid', { seed: 431, lobe: 1.25, shadowO: 0.45, under: cap + k.ha.headPath });
  // fios soltos saindo da trança
  flyaways(k, [
    [H(-5.4, -10.6), H(-6.6, -12.0), H(-7.6, -11.6)],
    [H(4.4, -11.4), H(5.8, -12.4), H(6.8, -12.0)],
  ], 0.35, 0.16);
  void H;
}

function braidCrownBack(k: HairKit): void {
  // um pouco de cabelo preso atrás (nuca), só pra não ficar vazio entre as orelhas
  const { ctx, t, H } = k;
  ctx.push(smoothPath([H(-(k.Wc - 0.5), -3), H(k.Wc - 0.5, -3), H(k.Wc - 1.2, 2.4), H(0, 4.2), H(-(k.Wc - 1.2), 2.4)]), mix(t.base, t.root, 0.5));
}

export const TEXTURED_STYLES: Record<string, Style> = {
  curly: { back: (k) => curlyBack(k, CURLY), front: (k) => curlyFront(k, CURLY) },
  long_curly: { back: (k) => curlyBack(k, LONG_CURLY), front: (k) => curlyFront(k, LONG_CURLY), belowWrap: true },
  afro: { back: afroBack, front: afroFront },
  afro_puff: { front: puffFront },
  twists: { back: (k) => ropesBack(k, TWISTS), front: (k) => ropesFront(k, TWISTS) },
  braids: { back: (k) => ropesBack(k, BRAIDS), front: (k) => ropesFront(k, BRAIDS) },
  dreads: { back: (k) => ropesBack(k, DREADS), front: (k) => ropesFront(k, DREADS) },
  cornrows: { back: cornrowsBack, front: cornrowsFront },
  braid_crown: { back: braidCrownBack, front: braidCrownFront },
};
