// Cabelos lisos e ondulados de comprimento médio a longo: longo liso, ondulado, chanel, franja cortina e o lado longo do
// raspado lateral. Dono: cabelo. Kit em hair-kit.ts; entrada e chapéus em hair.ts.
//
// Receita (crítica da rodada 4):
//   - volume acima do crânio (+1,2 a 1,8), risca levemente fora do centro, linha do cabelo em ARCO convexo da risca até a
//     orelha (sem "janela" com quina na têmpora);
//   - as mechas da frente batem no ombro e DOBRAM: parte escorrega pra trás do ombro (desenhada no cabelo de trás, some
//     atrás do trapézio) e parte cai na frente do peito, abrindo na dobra e acompanhando a clavícula;
//   - pontas em grupos de 2–3 com comprimentos desencontrados (±3) e 1–2 mechas que se afastam da silhueta;
//   - brilho em FAIXA anelar que cruza as mechas na altura da testa e do ombro.

import type { SP } from '../anatomy';
import { smoothPath, taperPath } from '../anatomy';
import { mix } from '../shading';

import {
  castOnBody,
  fallGrad,
  flyaways,
  foreheadShadow,
  massGrad,
  onShoulder,
  paintLocks,
  qAt,
  ringSheen,
  rnd,
  saltPepper,
  shift,
  spineSlice,
  shoulderTop,
  type HairKit,
  type Lock,
} from './hair-kit';

// ---------------------------------------------------------------------------------------------------------------
// geometria comum
// ---------------------------------------------------------------------------------------------------------------

export interface FallOpts {
  /** comprimento: y das pontas = axila + len (negativo = acima da axila) */
  len: number;
  /** volume acima do crânio (unidades da cabeça) */
  lift: number;
  /** x da risca (cabeça unitária; negativo = esquerda da tela) */
  px: number;
  /** ondulação (0 liso … 1 ondas marcadas) */
  wave?: number;
  /** largura extra da massa (ondulado é mais cheio) */
  full?: number;
  /** só um lado cai (raspado lateral): 1 direita da tela, −1 esquerda; sem calota (quem chama desenha) */
  side?: 1 | -1;
}

/**
 * contorno de um painel de cabelo que cai do lado g (1 direita da tela, −1 esquerda): borda de DENTRO (rosto → pescoço →
 * peito) e borda de FORA (lateral da cabeça → ombro → peito), de cima pra baixo, com o mesmo número de pontos. As mechas
 * saem interpolando as duas bordas, então todas dobram juntas no ombro (o painel pousa no trapézio, abre na curva e cai
 * na frente do peito voltando de leve pra dentro; o resto do cabelo some atrás do ombro).
 */
export function fallPanel(k: HairKit, g: 1 | -1, o: FallOpts, n = 18): { inner: SP[]; outer: SP[]; tipY: number; shoulder: boolean } {
  const { H, Tm, Ck, Jw, jawY, Wc, nk, ay, cx, an } = k;
  const lift = k.flat ? 0.2 : o.lift;
  const full = o.full ?? 0;
  const X = (x: number) => cx + g * x;
  const yJaw = H(0, jawY)[1];
  const tipY = ay + o.len;
  const st = (x: number) => shoulderTop(an, g, cx + g * x);
  // cabelo que chega no ombro pousa nele; acima disso as pontas viram pra dentro embaixo do queixo
  const shoulder = tipY > st(nk + 4) + 1.5;
  let inner: SP[];
  let outer: SP[];
  if (shoulder) {
    const below = Math.max(0, tipY - st(nk + 4));
    inner = [
      H(g * (Tm - 1.6), -5.6),
      H(g * (Tm - 0.25), -1.8),
      H(g * (Ck + 0.12), 2.6),
      H(g * (Jw + 0.75), jawY + 0.4),
      [X(nk + 0.9), yJaw + 2.6],
      [X(nk + 1.25), st(nk + 1.25) + 0.6],
      [X(nk + 1.5), st(nk + 1.5) + Math.min(5, below * 0.45)],
      [X(nk + 1.6), tipY + 2],
    ];
    outer = [
      H(g * (Wc + lift * 0.8 + full * 0.3), -5.0),
      H(g * (Wc + 1.25 + full * 0.5), 0.6),
      H(g * (Jw + 2.2 + full * 0.8), jawY + 1.4),
      [X(nk + 4.4 + full), st(nk + 4.4 + full) - 1.0],
      [X(nk + 6.9 + full * 1.1), st(nk + 6.9 + full) + 1.2],
      [X(nk + 6.6 + full), st(nk + 6.6) + Math.min(6, below * 0.5)],
      [X(nk + 6.0 + full * 0.8), tipY + 2],
    ];
  } else {
    // acima do ombro (cortina): termina perto da clavícula, pontas pra dentro
    const y = Math.max(yJaw + 2.5, tipY);
    inner = [H(g * (Tm - 1.6), -5.6), H(g * (Tm - 0.25), -1.8), H(g * (Ck + 0.12), 2.6), H(g * (Jw + 0.75), jawY + 0.4), [X(nk + 0.9), (yJaw + y) / 2 + 0.5], [X(nk + 1.3), y + 1.5]];
    outer = [H(g * (Wc + lift * 0.75 + full * 0.3), -5.2), H(g * (Wc + 1.45 + full * 0.5), 0.4), H(g * (Jw + 2.9 + full * 0.8), jawY + 1.2), [X(nk + 4.6 + full), (yJaw + y) / 2 + 0.8], [X(nk + 4.4 + full), y + 1.5]];
  }
  const I = spineSlice(inner, 0, 1, n);
  const O = spineSlice(outer, 0, 1, n);
  if (o.wave) {
    // a onda move o painel inteiro (as duas bordas juntas), crescendo pra baixo a partir da mandíbula
    const amp = o.wave * 1.15 * k.s;
    const ph = g > 0 ? 0.6 : 2.4;
    for (const P of [I, O]) {
      for (let i = 0; i < n; i++) {
        const y = P[i][1];
        const env = Math.max(0, Math.min(1, (y - yJaw + 2) / 6));
        P[i] = [P[i][0] + g * amp * env * Math.sin(((y - yJaw) / 7.4) * Math.PI * 2 + ph), y];
      }
    }
  }
  return { inner: I, outer: O, tipY, shoulder };
}

/** y → parâmetro (0..1) da primeira vez que a curva cruza y (descendo) */
function tAtY(sp: readonly SP[], y: number): number {
  for (let i = 1; i < sp.length; i++) {
    const a = sp[i - 1][1];
    const b = sp[i][1];
    if (a <= y && b >= y) return (i - 1 + (y - a) / (b - a || 1)) / (sp.length - 1);
  }
  return 1;
}

/**
 * mechas de um lado (g = 1 direita da tela, −1 esquerda). `front` = as do painel que cai NA FRENTE do ombro (mechas
 * interpoladas entre as bordas, pontas em grupos de 2–3 com comprimentos desencontrados); as de trás vão pra trás do
 * ombro (cabelo de trás, somem atrás do trapézio).
 */
export function fallLocks(k: HairKit, g: 1 | -1, o: FallOpts, front: boolean): Lock[] {
  const { H, Wc, Jw, jawY, nk, cx, s } = k;
  const full = o.full ?? 0;
  const r = rnd((g > 0 ? 17 : 29) + Math.round(k.v * 50));
  if (front) {
    const P = fallPanel(k, g, o);
    const n = P.inner.length;
    // 5 mechas de larguras diferentes: u = posição entre a borda de dentro (0) e a de fora (1); pares juntam na ponta
    const U = [0.09, 0.28, 0.5, 0.69, 0.9];
    const WK = [1.05, 0.8, 1.2, 0.85, 1.0];
    const pair = [0.18, 0.18, 0.6, 0.6, 0.9];
    const big = (o.px < 0 ? g > 0 : g < 0) ? 1 : 0;
    const tipD = [-1.4 + big * 0.6, 0.1 + big * 0.6, 1.7 + big, 0.3, 2.8];
    const z = [4, 3, 3, 2, 1];
    // cada mecha ondula de leve com fase própria (nada de faixas paralelas)
    const PH = [0.3, 2.1, 4.0, 1.2, 5.1];
    const out: Lock[] = [];
    U.forEach((u, i) => {
      const sp: SP[] = [];
      const ws: number[] = [];
      const yT = P.tipY + tipD[i] * (P.shoulder ? 1 : 0.4) + (r() - 0.5) * 0.8;
      for (let j = 0; j < n; j++) {
        const f = j / (n - 1);
        // perto da ponta a mecha encosta na vizinha do par (ponta em grupo, não pente)
        const uu = u + (pair[i] - u) * Math.max(0, (f - 0.72) / 0.28) * 0.75;
        const a = P.inner[j];
        const b = P.outer[j];
        const sw = 0.38 * k.s * Math.max(0, Math.min(1, (f - 0.25) / 0.2)) * Math.sin(f * 7.5 + PH[i]);
        sp.push([a[0] + (b[0] - a[0]) * uu + sw, a[1] + (b[1] - a[1]) * uu]);
        ws.push(Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.37 * WK[i]);
      }
      const t1 = tAtY(sp, yT);
      const N = 20;
      const spine = spineSlice(sp, 0, t1, N);
      // comprimento até a ponta (o afinamento é medido em unidades, não em fração: ponta curta e cheia, nada de agulha)
      const acc = [0];
      for (let j = 1; j < N; j++) acc.push(acc[j - 1] + Math.hypot(spine[j][0] - spine[j - 1][0], spine[j][1] - spine[j - 1][1]));
      const total = acc[N - 1];
      // pontas: as do meio afinam em ogiva longa, as das bordas terminam mais cheias (grupo com comprimentos diferentes)
      const tipW = i === 1 || i === 3 ? 0.1 : 0.2;
      const TL = (i === 1 || i === 3 ? 4.6 : 4.0) * k.s;
      const w = spine.map((_, j) => {
        const f = j / (N - 1);
        const wj = ws[Math.min(n - 1, Math.round(f * t1 * (n - 1)))];
        const root = f < 0.08 ? 0.6 + f * 5 : 1;
        const dt = total - acc[j];
        const end = dt < TL ? tipW + (1 - tipW) * Math.sqrt(dt / TL) : 1;
        return Math.max(0.5 * s, wj) * root * end;
      });
      const DK = [-0.12, 0.06, -0.04, 0.16, 0.1];
      out.push({ spine, w, z: z[i], g: i < 2 ? g : -g, dark: DK[i], round: true });
      // duas mechas se dividem perto da ponta: um fio mais fino escapa pro lado e termina em outro comprimento
      if ((i === 0 || i === 2) && P.shoulder && !k.lite) {
        const a0 = 0.62;
        const seg = spineSlice(spine, a0, 1, 8);
        const dir = i === 0 ? -g : g;
        const ext = i === 0 ? 1.6 : -1.2;
        const L = seg.length;
        const split = seg.map((p, j) => {
          const f = j / (L - 1);
          return [p[0] + dir * f * f * 1.1 * k.s, p[1] + f * ext * k.s] as SP;
        });
        const w0 = w[Math.round(a0 * (N - 1))] * 0.42;
        out.push({ spine: split, w: split.map((_, j) => w0 * (j < L - 3 ? 1 : 1 - (j - (L - 4)) * 0.27)), z: z[i], g: dir, dark: DK[i] - 0.06 });
      }
    });
    return out;
  }
  // pra trás do ombro: aparece acima da linha do ombro e some atrás do trapézio (o tronco cobre o resto)
  const len = o.len;
  const shoulder = k.ay + len > shoulderTop(k.an, g, cx + g * (nk + 4)) + 1.5;
  const yJaw = H(0, jawY)[1];
  const X = (x: number) => cx + g * x;
  const back = (top: SP[], dx: number, wMax: number): { spine: SP[]; w: number[] } => {
    const q = shoulder ? onShoulder(k, g, nk + dx, -1.0) : ([X(nk + dx * 0.5 + 0.4), Math.max(yJaw + 2.5, k.ay + len) - 0.6] as SP);
    const sp: SP[] = [...top, q, [q[0] + g * 0.5, q[1] + (shoulder ? 4.5 : 0.8)]];
    const sm = spineSlice(sp, 0, 1, 8);
    return { spine: sm, w: sm.map((_, i) => wMax * s * (1 + full * 0.1) * (i === 0 ? 0.7 : 1)) };
  };
  const D = back([H(g * (Wc + 1.15 + full * 0.3), -3.0), H(g * (Wc + 1.5 + full * 0.5), 1.4), H(g * (Jw + 2.5 + full * 0.7), jawY + 1.4)], 6.6 + full, 3.0);
  const E = back([H(g * (Wc + 1.5 + full * 0.4), -1.0), H(g * (Wc + 1.9 + full * 0.6), 3.4), H(g * (Jw + 3.2 + full * 0.9), jawY + 2.4)], 8.2 + full * 1.2, 2.4);
  return [
    { z: 0, g: -g, ...D },
    { z: 0, g: g, ...E },
  ];
}

/** borda do rosto (calota) da risca até a têmpora, de um lado: arco convexo, sem quina */
function faceEdge(k: HairKit, g: 1 | -1, px: number, fringe = 0): SP[] {
  const { H, Tm } = k;
  const big = (px < 0 ? g > 0 : g < 0) ? 1 : 0;
  // o lado maior desce mais sobre a testa (a franja varrida pro lado)
  const dip = big ? 0.25 + fringe : 0;
  return [
    H(px + g * 0.45, -7.45 + dip * 0.2),
    H(px + g * (2.6 + big * 0.4), -7.05 + dip * 0.6),
    H(g * (4.5 + big * 0.2), -6.15 + dip * 0.8),
    H(g * (Tm - 1.45), -4.75 + dip * 0.5),
    H(g * (Tm - 0.4), -2.75),
    H(g * (Tm + 0.12), -0.9),
  ];
}

/** calota do liso: da risca pros dois lados, volume em cima; devolve contorno e borda do rosto */
function fallCap(k: HairKit, o: FallOpts, lift: number, fringe = 0): { d: string; edge: SP[]; pts: SP[] } {
  const { H, Wc, CR } = k;
  const px = o.px;
  const full = o.full ?? 0;
  const eR = faceEdge(k, 1, px, fringe);
  const eL = faceEdge(k, -1, px, fringe);
  const right: SP[] = [H(px + 2.6, CR - lift - 0.05), H(Wc * 0.74, CR - lift + 1.05), H(Wc + 0.9 * lift + full * 0.3, CR + 3.0), H(Wc + lift + full * 0.4, -3.6), H(Wc + 1.25 + full * 0.4, -0.4)];
  const left: SP[] = [H(-(Wc + 1.2 + full * 0.4), -0.6), H(-(Wc + lift + full * 0.4), -3.6), H(-(Wc + 0.88 * lift + full * 0.3), CR + 3.1), H(-Wc * 0.66, CR - lift + 1.0), H(px - 2.0, CR - lift - 0.05)];
  const pts: SP[] = [H(px, CR - lift + 0.1), ...right, ...eR.slice().reverse(), ...eL, ...left];
  return { d: smoothPath(pts), edge: [...eL.slice().reverse(), ...eR], pts };
}

/** linhas de fluxo da calota (da risca pros lados) */
function capFlow(k: HairKit, o: FallOpts, lift: number): { spine: SP[]; w: number; g: number }[] {
  const { H, Wc, CR, s } = k;
  const px = o.px;
  const r = rnd(7);
  const out: { spine: SP[]; w: number; g: number }[] = [];
  for (const g of [-1, 1] as const) {
    const big = (px < 0 ? g > 0 : g < 0) ? 1 : 0;
    const n = big ? 6 : 5;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      // os de cima saem do alto da risca e descem pela lateral; os de baixo seguem a linha do cabelo até a têmpora
      const a: SP = H(px + g * 0.3, CR - lift + 0.5 + t * (6.9 - lift - 2.6 + 3.0));
      const c: SP = H(px + g * (2.6 + (1 - t) * (big ? 6.6 : 5.2)), CR - lift + 0.4 + t * 4.2);
      const b: SP = H(g * (Wc + lift * 0.7 - t * 1.9 + r() * 0.5), -4.8 + t * 4.4);
      out.push({ spine: [a, qAt(a, c, b, 0.35), qAt(a, c, b, 0.7), b], w: (1.5 + r() * 1.1) * s, g });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// longo liso / ondulado / cortina (mesma estrutura, parâmetros diferentes)
// ---------------------------------------------------------------------------------------------------------------

/** cabelo de trás: massa atrás da cabeça e do pescoço + mechas que escorregam pra trás do ombro */
export function fallBack(k: HairKit, o: FallOpts): void {
  const { ctx, H, Wc, Jw, jawY, CR, nk, shY, ay, cx, t, lite } = k;
  const lift = k.flat ? 0.2 : o.lift;
  const full = o.full ?? 0;
  const shoulder = o.len > -6;
  const bot = shoulder ? ay + 2 : Math.max(H(0, jawY)[1] + 1, ay + o.len + 1.5);
  const half = (g: 1 | -1): SP[] => {
    const X = (x: number) => cx + g * x;
    return [H(g * (Wc + lift * 0.9), CR + 3.4), H(g * (Wc + 1.4 + full * 0.5), 0.6), H(g * (Jw + 2.4 + full * 0.8), jawY + 1.6), shoulder ? [X(nk + 7.2 + full), shY + 1.4] : [X(nk + 4.6 + full), bot - 1.4], shoulder ? [X(nk + 5.0 + full * 0.5), bot] : [X(nk + 2.4), bot]];
  };
  // lado raspado: atrás só a curva do crânio (nada de cabelo saindo pela lateral)
  const bare = (g: 1 | -1): SP[] => [H(g * (Wc - 0.2), CR + 3.4), H(g * (Wc - 0.8), 0.6), H(g * (Jw - 1.2), jawY), [cx + g * (nk - 0.5), shY], [cx + g * (nk - 0.5), bot]];
  const hR = o.side === -1 ? bare(1) : half(1);
  const hL = o.side === 1 ? bare(-1) : half(-1);
  const pts: SP[] = [H(0, CR - lift + 0.3), ...hR, [cx, bot + 0.6], ...hL.reverse()];
  const d = smoothPath(pts);
  ctx.push(d, t.root, { gf: { t: 'l', x1: 0, y1: H(0, CR)[1], x2: 0, y2: bot, s: [[0, mix(t.base, t.root, 0.3)], [0.45, mix(t.base, t.root, 0.7)], [1, t.deep]] } });
  // vão escuro atrás do pescoço
  ctx.push(smoothPath([[cx - nk - 1.2, H(0, jawY - 1)[1]], [cx + nk + 1.2, H(0, jawY - 1)[1]], [cx + nk + 2.2, shY + 2], [cx - nk - 2.2, shY + 2]]), '#05030A', { o: 0.5, ...(lite ? {} : { b: 1.4 }), cp: d });
  const locks = (o.side ? [o.side] : ([1, -1] as const)).flatMap((g) => fallLocks(k, g, o, false));
  const p = paintLocks(k, locks, { under: d, rim: false, y0: H(0, -3)[1], y1: shY + 4, depthDark: 0.1 });
  void p;
  if (!lite) {
    // brilho da mecha de trás onde ela vira por cima do ombro
    ringSheen(
      k,
      locks.map((l) => ({ spine: l.spine, w: Math.max(...l.w) })),
      (x) => shoulderTop(k.an, x < cx ? -1 : 1, x) - 2.4,
      { len: 0.1, o: t.pale ? 0.38 : 0.45, seed: 13 },
    );
  }
}

/** frente do liso: calota com volume, mechas da frente com dobra no ombro, brilho anelar na testa e no ombro */
export function fallFront(k: HairKit, o: FallOpts & { fringe?: number; wisps?: boolean }): { cap: string } {
  // pet no colo: as mechas da frente terminam acima dos braços (o resto fica atrás do ombro), senão cobrem o bicho
  if (k.ctx.scene.petPose === 'arms' && k.ctx.opts.mode !== 'bust') o = { ...o, len: Math.min(o.len, CRADLE_FRONT_LEN) };
  const { ctx, H, Wc, Tm, Ck, CR, s, t, lite, an, ha } = k;
  const lift = k.flat ? 0.2 : o.lift;
  const px = o.px;
  // sombra das mechas no rosto (o rosto fica "dentro" do cabelo)
  {
    let sh = '';
    for (const g of o.side ? [o.side] : ([-1, 1] as const)) sh += taperPath([H(g * (Tm - 1.4), -5.2), H(g * (Tm + 0.05), -0.8), H(g * (Ck + 0.1), 3.6), H(g * (an.face.jaw + 0.6), an.face.jawY + 1.4)], [0.4, 1.6 * s, 1.6 * s, 0.6]);
    ctx.push(sh, t.cast, { o: t.pale ? 0.22 : 0.3, b: 0.8, cp: ha.headPath });
  }
  const cap = fallCap(k, { ...o }, lift, o.fringe ?? 0);
  const sides = o.side ? [o.side] : ([-1, 1] as const);
  if (!o.side) foreheadShadow(k, cap.edge.slice(1, -1), 0.26, 1.5, 0.75);
  const locks = sides.flatMap((g) => fallLocks(k, g, o, true));
  // massa de baixo = o painel inteiro (sem buraco entre as mechas), terminando antes das pontas
  let under = '';
  for (const g of sides) {
    const P = fallPanel(k, g, o);
    const y0 = P.inner[0][1];
    const t1 = Math.min(1, Math.max(0.2, (P.tipY - 3 - y0) / (P.inner[P.inner.length - 1][1] - y0)));
    const pts: SP[] = [...spineSlice(P.inner, 0, t1, 9), ...spineSlice(P.outer, 0, t1, 9).reverse()];
    under += smoothPath(g < 0 ? pts.reverse() : pts);
  }
  // sombra das mechas no pescoço e na camiseta (recortada no corpo)
  castOnBody(k, locks.map((l) => taperPath(shift(l.spine, 0.5, 0.9), l.w, { n: 8 })).join(''), 0.3, 0.7);
  ctx.push(under, mix(t.base, t.root, 0.4));
  const y0 = H(0, -4)[1];
  const y1 = k.ay + o.len + 3;
  const lp = paintLocks(k, locks, { under, y0, y1, shadowO: 0.26, n: lite ? 16 : 26, creviceRange: [0.35, 0.92], creviceO: t.pale ? 0.42 : 0.5 });
  if (o.side) {
    // um lado só: quem chama desenha a calota; aqui só o brilho na dobra do ombro
    const sh = (x: number) => shoulderTop(an, x < k.cx ? -1 : 1, x) - 1.1;
    if (o.len > -6) ringSheen(k, locks.map((l) => ({ spine: l.spine, w: Math.max(...l.w) })), sh, { len: 0.1, wk: 0.26, o: t.pale ? 0.5 : 0.62, seed: 9, pair: true });
    saltPepper(k, locks.map((l) => l.spine), lp.all, 41);
    return { cap: '' };
  }
  // calota por cima da raiz das mechas
  const cr: SP = H(-2.6, CR + 1.8);
  ctx.push(cap.d, t.base, { gf: massGrad(k, [cr[0], cr[1]], 14 * s, t.base) });
  const flow = capFlow(k, o, lift);
  if (!lite) {
    // grupos de fios (luz) e frestas entre eles, seguindo o fluxo da risca pros lados
    let lit = '';
    let gap = '';
    for (const f of flow) {
      lit += taperPath(f.spine, [f.w * 0.3, f.w, f.w * 0.7, 0], { n: 8 });
      gap += taperPath(shift(f.spine, f.g * 0.55 * f.w, 0.2), [0, f.w * 0.3, f.w * 0.18, 0], { n: 7 });
    }
    ctx.push(lit, t.lock, { o: 0.42, cp: cap.d, b: 0.22 });
    ctx.push(gap, t.deep, { o: t.pale ? 0.5 : 0.48, cp: cap.d, b: 0.18 });
  }
  saltPepper(k, [...flow.map((f) => f.spine), ...locks.map((l) => l.spine)], cap.d + lp.all, 41);
  // risca: fresta de pele fina com sombra de raiz dos dois lados (nada de "V" de pele)
  {
    const top = H(px + 0.12, CR - lift + 0.9);
    const bot = H(px - 0.04, -7.4);
    ctx.push(taperPath([bot, H(px + 0.04, -9.0), top], [0.3, 1.4 * s, 0.4]), t.root, { o: 0.5, ...(lite ? {} : { b: 0.35 }), cp: cap.d });
    if (!k.flat) ctx.push(taperPath([bot, H(px + 0.05, -8.6), top], [0.26 * s, 0.2 * s, 0.05]), mix(ctx.col.skin, t.root, 0.3), { o: 0.85 });
  }
  // brilho anelar: na calota (testa) e nas mechas onde dobram no ombro
  const ringY = (x: number) => {
    const u = (x - k.cx) / ((Wc + 1) * s);
    return H(0, CR + 3.3 - lift * 0.3)[1] + u * u * 3.4 * s;
  };
  ringSheen(k, flow.map((f) => ({ spine: f.spine, w: f.w })), ringY, {
    len: 0.15,
    wk: 0.34,
    o: t.pale ? 0.55 : 0.68,
    seed: 3,
    clip: cap.d,
    glow: [H(-(Wc + 0.4), CR + 6.4), H(-4.0, CR + 3.4), H(px, CR + 2.9), H(4.5, CR + 3.4), H(Wc + 0.4, CR + 6.4)],
  });
  if (o.len > -6) {
    // na dobra do ombro: a faixa segue a linha do trapézio (a mecha vira pra luz onde pousa)
    const sh = (x: number) => shoulderTop(an, x < k.cx ? -1 : 1, x) - 1.1;
    ringSheen(k, locks.map((l) => ({ spine: l.spine, w: Math.max(...l.w) })), sh, { len: 0.1, wk: 0.26, o: t.pale ? 0.5 : 0.62, seed: 9, pair: true });
    // logo abaixo da dobra a mecha vira pra baixo e escurece (quebra a "cortina" reta)
    ringSheen(k, locks.map((l) => ({ spine: l.spine, w: Math.max(...l.w) })), (x) => sh(x) + 2.6, { len: 0.06, wk: 0.7, side: 0, o: 0.3, seed: 4, color: t.deep });
  } else {
    ringSheen(k, locks.map((l) => ({ spine: l.spine, w: Math.max(...l.w) })), () => H(0, 2.2)[1], { len: 0.09, o: t.pale ? 0.42 : 0.55, seed: 9 });
  }
  // mechinhas finas escapando da risca e caindo na testa em arco (pontas somem)
  if (!lite && o.wisps !== false && k.fringe) {
    const wisps: SP[][] = [
      [H(px + 0.5, -7.6), H(px + 2.2, -7.25), H(px + 3.5, -6.2), H(px + 4.0, -4.9)],
      [H(px - 0.35, -7.55), H(px - 1.6, -7.05), H(px - 2.4, -6.1), H(px - 2.6, -5.1)],
    ];
    const ws = wisps.map((w) => taperPath(w, [0.22 * s, 0.32 * s, 0.24 * s, 0], { n: 9 })).join('');
    ctx.push(ws, t.base, { gf: { t: 'l', x1: 0, y1: H(0, -7.6)[1], x2: 0, y2: H(0, -4.8)[1], s: [[0, mix(t.base, t.root, 0.2)], [0.6, t.base, 0.9], [1, t.tip, 0.25]] } });
  }
  // fios soltos que seguem a forma (por fora da massa): um na coroa, um saindo da lateral
  if (!k.flat) {
    flyaways(k, [
      [H(Wc + 1.1, CR + 3.4), H(Wc + 2.6, -4.6), H(Wc + 3.3, -1.4), H(Wc + 3.1, 1.2)],
      [H(px + 1.2, CR - lift - 0.7), H(px + 3.6, CR - lift - 0.45), H(px + 6.0, CR - lift + 0.6)],
    ]);
  }
  // uma mecha fina que se afasta da silhueta perto da ponta (quebra a cortina)
  if (!lite && o.len > -6) {
    const g = px < 0 ? 1 : -1;
    const b = fallLocks(k, g as 1 | -1, o, true)[1].spine;
    const tail = spineSlice(b, 0.62, 1, 5).map((p, i) => [p[0] + g * i * 0.35, p[1] + i * 0.25] as SP);
    ctx.push(taperPath(tail, [0.9 * s, 0.7 * s, 0.4 * s, 0], { n: 7 }), t.base, { gf: fallGrad(k, tail[0][1], tail[tail.length - 1][1], t.base) });
  }
  return { cap: cap.d };
}

// ---------------------------------------------------------------------------------------------------------------
// estilos
// ---------------------------------------------------------------------------------------------------------------

/** comprimento máximo das mechas da frente com pet no colo (axila + len) */
const CRADLE_FRONT_LEN = -6;
export const LONG: FallOpts = { len: 6, lift: 1.5, px: -1.7 };
export const WAVY: FallOpts = { len: 5, lift: 2.0, px: 1.4, wave: 1, full: 1 };
export const CURTAIN: FallOpts = { len: -1, lift: 1.5, px: 0, wave: 0.35 };
/** chanel: na altura do queixo, cobre as orelhas, pontas viram pra dentro */
export const BOB: FallOpts = { len: -15.5, lift: 1.6, px: -2.0, full: 0.9 };

/**
 * franja cortina: aberta no meio, as duas metades descem em arco pela testa e terminam na maçã do rosto (a testa
 * aparece em arco entre elas, nunca "V" de pele)
 */
export function curtainBangs(k: HairKit): void {
  if (!k.fringe) return;
  const { ctx, H, s, t, Tm, lite } = k;
  const locks: Lock[] = [];
  for (const g of [-1, 1] as const) {
    const X = (x: number) => g * x;
    locks.push(
      { spine: [H(X(0.25), -10.6), H(X(1.3), -8.4), H(X(3.3), -6.4), H(X(Tm - 1.4), -3.8), H(X(Tm - 0.75), -0.6)], w: [1.0 * s, 2.6 * s, 2.7 * s, 1.9 * s, 0.25 * s], z: 1, g, round: true },
      { spine: [H(X(0.9), -10.8), H(X(2.4), -9.0), H(X(4.6), -7.2), H(X(Tm - 0.9), -4.6), H(X(Tm - 0.35), -1.8)], w: [1.0 * s, 2.4 * s, 2.3 * s, 1.5 * s, 0.2 * s], z: 0, g, dark: 0.1, round: true },
    );
  }
  foreheadShadow(k, [H(-(Tm - 1.2), -3.2), H(-3.2, -6.0), H(-0.6, -8.2), H(0.6, -8.2), H(3.2, -6.0), H(Tm - 1.2, -3.2)], 0.28, 1.5, 0.55);
  const p = paintLocks(k, locks, { creviceRange: [0.25, 0.85], rimO: t.pale ? 0.2 : 0.4 });
  // brilho anelar cruzando a franja na altura da testa
  ringSheen(k, locks.map((l) => ({ spine: l.spine, w: Math.max(...l.w) })), (x) => H(0, -7.6)[1] + Math.abs(x - k.cx) * 0.55, { len: 0.12, wk: 0.32, o: t.pale ? 0.5 : 0.62, seed: 15, pair: true });
  saltPepper(k, locks.map((l) => l.spine), p.all, 17);
  if (!lite) flyaways(k, [[H(-0.4, -9.6), H(-1.4, -7.6), H(-1.9, -6.2)], [H(0.5, -9.4), H(1.6, -7.8), H(2.4, -6.6)]], 0.35, 0.16);
  void ctx;
}
