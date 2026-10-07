// Presos: rabo de cavalo, coque alto, coque elegante, coque baixo e coquinhos. Dono: cabelo.
//
// Receita: calota PUXADA (rente ao crânio, sem volume solto), com sulcos de pente que correm da linha do cabelo até o
// ponto onde o cabelo é preso, brilho em faixa que acompanha o crânio e a borda translúcida nas têmporas. O coque é
// cabelo ENROLADO: fitas em arco que giram em volta do centro, com fresta escura entre elas e luz no lado de cima-esquerda,
// sombra de contato na cabeça e o elástico na base. Sob boné/aba (k.flat) o coque some e a calota achata.

import { smoothPath, taperPath, type SP } from '../anatomy';
import { mix } from '../shading';

import { capOutline, partLine, softHairline, type CapOpts } from './hair-cap';
import { castOnBody, fallGrad, flyaways, massGrad, paintLocks, qAt, rnd, ringSheen, saltPepper, shift, shoulderTop, spineSlice, type HairKit, type Lock } from './hair-kit';

type Style = { back?: (k: HairKit) => void; front?: (k: HairKit) => void };

// ---------------------------------------------------------------------------------------------------------------
// calota puxada
// ---------------------------------------------------------------------------------------------------------------

export interface SleekOpts extends CapOpts {
  /** pra onde o cabelo é puxado (cabeça unitária) */
  to: [number, number];
  /** risca no meio (coque baixo, coquinhos) */
  part?: number | null;
  /** quantos sulcos por lado */
  lines?: number;
}

/** calota puxada com sulcos de pente; devolve o path da calota */
export function sleekCap(k: HairKit, o: SleekOpts): string {
  const { ctx, t, lite, H, s, CR } = k;
  // puxado: as têmporas aparecem mais (entrada leve) e a costeleta fica curta e fina
  const cap = capOutline(k, { recede: 0.5, sideburn: k.earTop + 0.9, sbThin: 0.6, ...o });
  // sombra na testa (o cabelo puxado faz pouca sombra)
  const c = H(-2.6, CR + 2.6);
  ctx.push(cap.d, t.base, { gf: massGrad(k, [c[0], c[1]], 13.5 * s, t.base, { hi: 0.5, lo: 0.85 }) });
  const [gx, gy] = o.to;
  // sulcos: da borda do rosto até o ponto de prender, passando rente ao crânio
  const edge = cap.edge;
  const n = edge.length;
  const lines: { spine: SP[]; w: number }[] = [];
  const per = o.lines ?? 7;
  for (let i = 0; i < per * 2; i++) {
    const u = (i + 0.5) / (per * 2);
    const f = u * (n - 1);
    const a = Math.floor(f);
    const b = Math.min(n - 1, a + 1);
    const E: SP = [edge[a][0] + (edge[b][0] - edge[a][0]) * (f - a), edge[a][1] + (edge[b][1] - edge[a][1]) * (f - a)];
    const ue = k.U(E);
    // com risca: cada lado vai pro seu lado da risca antes de subir
    const side = o.part != null ? Math.sign(ue[0] - o.part) || 1 : 0;
    const G = H(gx + ue[0] * 0.18 + side * 1.2, gy + Math.abs(ue[0]) * 0.05);
    const C = H(ue[0] * 1.12 + side * 0.8, (ue[1] + gy) / 2 - 1.2);
    lines.push({ spine: [E, qAt(E, C, G, 0.33), qAt(E, C, G, 0.66), G], w: (1.4 + (i % 3) * 0.35) * s });
  }
  if (!lite) {
    let lt = '';
    let dk = '';
    for (const l of lines) {
      lt += taperPath(l.spine, [l.w * 0.25, l.w * 0.6, l.w * 0.4, 0], { n: 8 });
      dk += taperPath(shift(l.spine, 0.45 * s, 0.1), [0, l.w * 0.22, l.w * 0.14, 0], { n: 8 });
    }
    ctx.push(lt, t.lock, { o: t.pale ? 0.3 : 0.4, b: 0.2, cp: cap.d });
    ctx.push(dk, t.deep, { o: t.pale ? 0.4 : 0.45, b: 0.15, cp: cap.d });
  }
  // brilho anelar no alto do crânio (cabelo esticado brilha mais)
  // no 'lite' (traço sem desfoque) a faixa sobe pro alto do crânio: colada na linha do cabelo, os traços de brilho
  // viravam dois riscos cinza na testa (coque baixo)
  const ringY = lite ? CR + 1.9 : CR + 3.2;
  const ring = (x: number) => {
    const u = (x - k.cx) / ((k.Wc + 1) * s);
    return H(0, ringY)[1] + (u * u * 3 + u * 0.5) * s;
  };
  ringSheen(k, lines, ring, { len: 0.16, wk: 0.38, o: t.pale ? 0.6 : 0.75, seed: 21, pair: true });
  if (o.part != null) partLine(k, cap.d, o.part, -7.6, o.part * 0.9, CR + 0.4);
  saltPepper(k, lines.map((l) => l.spine), cap.d, 29);
  softHairline(k, cap.edge.slice(2, cap.edge.length - 2), cap.d, { temple: 0.9, mid: 0.2 });
  return cap.d;
}

// ---------------------------------------------------------------------------------------------------------------
// coque (cabelo enrolado)
// ---------------------------------------------------------------------------------------------------------------

/** coque: centro (avatar), raios, semente; `band` desenha o elástico na base (ângulo da base em rad, 0 = embaixo) */
export function bunMass(k: HairKit, c: SP, rx: number, ry: number, seed: number, o: { band?: boolean; tilt?: number } = {}): string {
  const { ctx, t, lite, s } = k;
  const tilt = o.tilt ?? 0;
  const ell = (sx: number, sy: number, dx = 0, dy = 0): SP[] => {
    const pts: SP[] = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const bump = 1 + 0.05 * Math.sin(a * 3 + seed);
      const x = Math.cos(a) * rx * sx * bump;
      const y = Math.sin(a) * ry * sy * bump;
      pts.push([c[0] + dx + x * Math.cos(tilt) - y * Math.sin(tilt), c[1] + dy + x * Math.sin(tilt) + y * Math.cos(tilt)]);
    }
    return pts;
  };
  const d = smoothPath(ell(1, 1));
  // sombra de contato na cabeça
  ctx.push(smoothPath(ell(0.95, 0.9, 0.3, 0.9)), '#07030A', { o: 0.35, ...(lite ? {} : { b: 0.6 }), cp: k.ha.headPath });
  ctx.push(d, t.base, { gf: massGrad(k, [c[0], c[1]], Math.max(rx, ry) * 1.25, t.base, { hi: 0.55 }) });
  // fitas enroladas: arcos que giram em volta do centro, de fora pra dentro
  const r = rnd(seed);
  const arcs: { spine: SP[]; w: number }[] = [];
  const turns = lite ? 3 : 5;
  for (let i = 0; i < turns; i++) {
    const rr = 0.92 - i * 0.15;
    const a0 = -0.4 + i * 1.7 + r() * 0.5;
    const span = 2.6 + r() * 0.8;
    const sp: SP[] = [];
    for (let j = 0; j <= 6; j++) {
      const a = a0 + (span * j) / 6;
      const q = rr - (0.12 * j) / 6;
      const x = Math.cos(a) * rx * q;
      const y = Math.sin(a) * ry * q;
      sp.push([c[0] + x * Math.cos(tilt) - y * Math.sin(tilt), c[1] + x * Math.sin(tilt) + y * Math.cos(tilt)]);
    }
    arcs.push({ spine: sp, w: Math.min(rx, ry) * (0.42 - i * 0.04) });
  }
  if (!lite) {
    let gap = '';
    let lit = '';
    for (const a of arcs) {
      gap += taperPath(a.spine, [0, a.w * 0.3, a.w * 0.34, a.w * 0.22, 0], { n: 9 });
      lit += taperPath(shift(a.spine, -0.25 * s, -0.35 * s), [0, a.w * 0.5, a.w * 0.3, 0], { n: 9 });
    }
    ctx.push(gap, t.deep, { o: t.pale ? 0.42 : 0.55, b: 0.25, cp: d });
    ctx.push(lit, t.lock, { o: t.pale ? 0.32 : 0.42, b: 0.25, cp: d });
  } else {
    ctx.push(arcs.slice(0, 2).map((a) => taperPath(a.spine, [0, a.w * 0.3, 0], { n: 6 })).join(''), t.deep, { o: 0.45, cp: d });
  }
  // brilho anelar: faixa no alto-esquerda
  ringSheen(k, arcs, (x) => c[1] - ry * 0.45 + (x - c[0]) * 0.25, { len: 0.12, wk: 0.4, o: t.pale ? 0.5 : 0.62, seed: seed + 1 });
  // sombra própria embaixo
  ctx.push(smoothPath(ell(1.02, 1.02, 0.5, 0.9)) + smoothPath(ell(1, 1)), t.root, { r: 'evenodd', o: 0.5, ...(lite ? {} : { b: 0.5 }), cp: d });
  if (o.band) {
    const bw = rx * 0.75;
    const by = c[1] + ry * 0.92;
    ctx.push(taperPath([[c[0] - bw, by - 0.3], [c[0], by + 0.25], [c[0] + bw, by - 0.3]], [0.7 * s, 0.9 * s, 0.7 * s]), mix(t.deep, '#000000', 0.3), { o: 0.9 });
  }
  return d;
}

// ---------------------------------------------------------------------------------------------------------------
// estilos
// ---------------------------------------------------------------------------------------------------------------

/** rabo de cavalo alto: preso atrás do topo; o rabo cai atrás da cabeça e aparece de um lado, até o ombro */
function ponytailBack(k: HairKit): void {
  const { H, s, cx, an, nk, t } = k;
  const g = 1;
  const x0 = cx + g * (nk + 4.6);
  const end: SP = [x0 + 0.8, shoulderTop(an, g, x0) + 5.5];
  const top: SP = H(2.2, k.flat ? -8.5 : k.CR + 0.6);
  const locks: Lock[] = [];
  const offs = [
    [-0.9, 0, 3.6, 0.15],
    [0.6, 1.2, 3.2, 0],
    [1.8, -0.6, 2.6, -0.1],
  ] as const;
  offs.forEach(([dx, dy, w, dk], i) => {
    const sp: SP[] = [top, H(k.Wc + 1.4 + dx * 0.3, -6 + dy), H(k.Wc + 2.6 + dx * 0.5, 2 + dy), [end[0] + dx, k.H(0, k.jawY + 2)[1] + dy], [end[0] + dx * 0.6 + 0.5, end[1] + dy * 0.8]];
    const sm = spineSlice(sp, 0, 1, 12);
    locks.push({ spine: sm, w: sm.map((_, j) => w * s * (j < 2 ? 0.6 + j * 0.2 : 1 - Math.pow(Math.max(0, j - 7) / 4, 1.3) * 0.85)), z: i, g: i === 1 ? -1 : 1, dark: dk, round: true });
  });
  castOnBody(k, locks.map((l) => taperPath(shift(l.spine, 0.6, 0.9), l.w, { n: 8 })).join(''), 0.3);
  const p = paintLocks(k, locks, { y0: top[1], y1: end[1], creviceRange: [0.25, 0.9] });
  ringSheen(k, locks.map((l) => ({ spine: l.spine, w: Math.max(...l.w) })), () => H(0, -2.5)[1], { len: 0.08, wk: 0.32, o: t.pale ? 0.5 : 0.6, seed: 31, pair: true });
  saltPepper(k, locks.map((l) => l.spine), p.all, 33);
  // a base presa aparece acima do crânio (o volume do rabo)
  if (!k.flat) {
    const base = smoothPath([H(-0.6, k.CR + 1.0), H(0.6, k.CR - 1.1), H(3.6, k.CR - 0.7), H(4.6, k.CR + 1.4)]);
    k.ctx.push(base, t.base, { gf: massGrad(k, [H(1.6, k.CR - 0.6)[0], H(1.6, k.CR - 0.6)[1]], 3.6 * s, t.base) });
  }
}

const ponytailFront = (k: HairKit) => void sleekCap(k, { lift: 0.55, side: 0.35, hl: -7.5, to: [1.4, k.CR + 0.4], lines: 7 });

/** coque alto no topo */
function bunFront(k: HairKit): void {
  if (!k.flat) bunMass(k, k.H(0, k.CR - 3.3), 4.4 * k.s, 3.6 * k.s, 7, { band: true });
  sleekCap(k, { lift: 0.65, side: 0.35, hl: -7.5, to: [0, k.CR - 0.2] });
}

/** coque elegante: volume varrido pro lado, coque torcido atrás do topo e duas mechinhas soltas nas têmporas */
function updoFront(k: HairKit): void {
  const { ctx, t, H, s, lite } = k;
  if (!k.flat) {
    // coque torcido (duas massas que se cruzam) aparecendo acima e atrás do crânio, deslocado pro lado
    bunMass(k, H(2.6, k.CR - 1.2), 4.6 * s, 2.9 * s, 13, { tilt: -0.35 });
    bunMass(k, H(-0.6, k.CR - 0.9), 3.6 * s, 2.5 * s, 17, { tilt: 0.25 });
  }
  sleekCap(k, { lift: 1.5, side: 0.6, lean: 0.8, hl: -7.4, to: [1.8, k.CR - 0.4], lines: 6 });
  // mechinhas soltas emoldurando o rosto (onduladas, pontas somem)
  if (!lite && k.fringe) {
    const wl: SP[][] = [];
    for (const g of [-1, 1]) wl.push([H(g * (k.Tm - 1.3), -5.4), H(g * (k.Tm - 0.5), -2.4), H(g * (k.Tm - 1.0), 0.8), H(g * (k.Tm - 0.4), 4.0), H(g * (k.Tm - 0.9), 6.4)]);
    ctx.push(wl.map((w) => taperPath(w, [0.5 * s, 0.6 * s, 0.45 * s, 0.3 * s, 0], { n: 12 })).join(''), t.base, { gf: fallGrad(k, H(0, -5.4)[1], H(0, 6.4)[1], t.base) });
    flyaways(k, wl.map((w) => shift(w.slice(1), -0.25, 0.2)), 0.4, 0.16);
  }
}

/** coque baixo: risca no meio, cabelo descendo por trás das orelhas até a nuca, coque aparecendo dos lados do pescoço */
function lowBunBack(k: HairKit): void {
  const { ctx, t, H, s, cx, nk } = k;
  const y = H(0, k.jawY + 3.0)[1];
  // massa que desce atrás das orelhas até a nuca, DENTRO da silhueta da mandíbula na vista de frente (antes passava da
  // mandíbula e descia até o queixo dos dois lados, como jugular de capacete)
  const side = smoothPath([H(-(k.Wc - 0.6), -3), H(k.Wc - 0.6, -3), H(k.Jw - 0.6, k.jawY - 1), [cx + nk - 0.2, y], [cx - nk + 0.2, y], H(-(k.Jw - 0.6), k.jawY - 1)]);
  ctx.push(side, t.root, { gf: fallGrad(k, H(0, -3)[1], y, mix(t.base, t.root, 0.4)) });
  // o coque, atrás do pescoço, na nuca: só um pedaço aparece dos dois lados do pescoço (largo demais virava gola)
  bunMass(k, [cx, y - 0.4], nk + 1.5, 2.3 * s, 23);
}

const lowBunFront = (k: HairKit) => void sleekCap(k, { lift: 0.7, side: 0.45, hl: -7.5, to: [0, 6], part: 0, lines: 6 });

/** coquinhos: risca no meio e dois coques no alto da cabeça */
function spaceBunsFront(k: HairKit): void {
  if (!k.flat) {
    for (const g of [-1, 1] as const) {
      const c = k.H(g * 5.4, k.CR + 0.4);
      bunMass(k, c, 3.4 * k.s, 3.2 * k.s, g > 0 ? 41 : 43, { tilt: g * 0.3 });
    }
  }
  sleekCap(k, { lift: 0.6, side: 0.4, hl: -7.5, to: [0, k.CR + 1], part: 0, lines: 6 });
}

export const UPDO_STYLES: Record<string, Style> = {
  ponytail: { back: ponytailBack, front: ponytailFront },
  bun: { front: bunFront },
  updo: { front: updoFront },
  low_bun: { back: lowBunBack, front: lowBunFront },
  space_buns: { front: spaceBunsFront },
};
