// Curtos e penteados. Dono: cabelo. Kit em hair-kit.ts, calota e tufos em hair-cap.ts; entrada e chapéus em hair.ts.
//
// Receita (crítica da rodada 4): nada de capacete de pétalas. 4–5 massas grandes que giram do redemoinho, com a ponta
// rendada só no fim; franja em duas profundidades com pontas arredondadas; laterais curtas mais escuras e coladas no
// crânio; costeleta de borda nítida; borda translúcida na têmpora (a pele aparece); brilho em faixa que acompanha o
// crânio cruzando os tufos; grisalho com fios escuros misturados (sal e pimenta) e brilho frio.
//
// Linguagens: texturizado (tufos com ponta rendada), penteado (mechas longas e lisas com sulcos de pente e brilho
// nítido), máquina (raspado translúcido com pontinhos), bem curto (traços curtos do redemoinho), topete (rolo que sobe
// da testa e vira pra trás).

import { smoothPath, taperPath, type SP } from '../anatomy';
import { mix } from '../shading';

import { capOutline, cropTexture, paintCap, paintTufts, partLine, shavedArea, skullPt, softHairline, type CapOpts, type Tuft } from './hair-cap';
import { fallGrad, flyaways, paintLocks, ringSheen, shoulderTop, type HairKit, type Lock } from './hair-kit';
import { fallBack, fallFront, type FallOpts } from './hair-long';
import { hatFlattensCrest } from './hat-modes';

type Style = { back?: (k: HairKit) => void; front?: (k: HairKit) => void; belowWrap?: boolean };

interface ShortDef {
  cap: (k: HairKit) => CapOpts;
  tufts: (k: HairKit) => Tuft[];
  sheenY?: number;
  /** textura de cabelo bem curto por baixo dos tufos */
  crop?: boolean;
  /** risca: [x0, y0, x1, y1] (cabeça unitária) */
  part?: [number, number, number, number];
  /** brilho mais forte e nítido (penteado com pomada) */
  gloss?: number;
  /** escala da largura dos tufos */
  scale?: number;
}

/** tufos sob boné/aba: nada sobe acima do crânio */
function flatten(k: HairKit, list: Tuft[]): Tuft[] {
  if (!k.flat) return list;
  const lim = (p: [number, number]): [number, number] => [p[0], Math.max(p[1], -10.6 + Math.abs(p[0]) * 0.1)];
  return list.map((t) => ({ ...t, a: lim(t.a), m: lim(t.m), b: lim(t.b) }));
}

function shortFront(k: HairKit, def: ShortDef): string {
  const co = def.cap(k);
  const cap = capOutline(k, co);
  paintCap(k, cap, { tone: k.t.root });
  if (def.crop) cropTexture(k, cap.d);
  let tufts = flatten(k, def.tufts(k));
  if (!k.fringe) tufts = tufts.filter((t) => t.b[1] < -7.4 || Math.abs(t.b[0]) > 5.5);
  const all = paintTufts(k, tufts, { under: cap.d, sheenY: def.sheenY, sheenO: def.gloss, scale: def.scale });
  if (def.part) partLine(k, all, ...def.part);
  if (def.gloss && def.gloss > 1 && !k.lite) {
    // pomada: um brilho nítido em faixa no alto da cabeça (do lado da luz), cruzando o penteado
    const { H, CR } = k;
    k.ctx.push(taperPath([H(-k.Wc + 0.6, -6.4), H(-4.6, CR + 2.0), H(-0.6, CR + 1.3), H(3.4, CR + 1.9)], [0, 0.9 * k.s, 0.7 * k.s, 0]), k.t.sheen, { o: 0.45 * (def.gloss - 1), b: 0.25, cp: all });
  }
  softHairline(k, cap.edge.slice(3, cap.edge.length - 3), cap.d);
  return all;
}

// ---------------------------------------------------------------------------------------------------------------
// texturizados
// ---------------------------------------------------------------------------------------------------------------

/** curto texturizado: volume em cima, franja varrida pra esquerda em duas camadas, laterais curtas */
const SHORT: ShortDef = {
  cap: () => ({ lift: 1.3, side: 0.55, hl: -7.4 }),
  sheenY: 2.4,
  tufts: (k) => {
    const W = k.Wc;
    const T = k.Tm;
    return [
      // coroa e laterais (de trás)
      { a: [1.6, -10.4], m: [6.6, -11.2], b: [W + 0.75, -5.2], w: 3.6, z: 0, tips: 2, dark: 0.08 },
      { a: [1.2, -10.6], m: [-4.6, -12.2], b: [-(W + 0.8), -5.0], w: 4.0, z: 0, tips: 2, dark: 0.08 },
      { a: [5.2, -9.0], m: [W + 0.55, -6.6], b: [T + 0.15, -1.3], w: 2.5, z: 0, dark: 0.28 },
      { a: [-5.2, -9.0], m: [-(W + 0.55), -6.6], b: [-(T + 0.15), -1.3], w: 2.5, z: 0, dark: 0.28 },
      // franja de trás (mais escura, ponta varrida pra esquerda)
      { a: [3.6, -10.8], m: [5.0, -9.6], b: [4.0, -6.6], w: 3.0, z: 1, tips: 2, round: true, dark: 0.12 },
      { a: [1.6, -11.0], m: [1.2, -9.4], b: [-1.0, -6.1], w: 3.6, z: 1, tips: 2, round: true, dark: 0.12 },
      { a: [-1.0, -10.9], m: [-4.2, -10.2], b: [-6.2, -5.6], w: 3.4, z: 1, tips: 2, round: true, dark: 0.12 },
      // franja da frente (pega luz): poucas mechas largas, comprimentos desencontrados
      { a: [2.4, -10.6], m: [2.6, -9.0], b: [0.9, -6.4], w: 2.8, z: 2, round: true },
      { a: [0.0, -10.8], m: [-1.6, -9.4], b: [-3.4, -5.7], w: 3.0, z: 2, round: true },
      { a: [-3.2, -10.2], m: [-6.0, -9.0], b: [-7.3, -4.9], w: 2.4, z: 2, round: true },
    ];
  },
};

/** pixie: repicado curto, franja longa varrida em diagonal até a sobrancelha, pontas finas na frente da orelha */
const PIXIE: ShortDef = {
  cap: () => ({ lift: 1.2, side: 0.45, hl: -7.3, sideburn: 2.6, sbThin: 0.6 }),
  sheenY: 2.3,
  tufts: (k) => {
    const W = k.Wc;
    const T = k.Tm;
    return [
      { a: [1.0, -10.6], m: [6.4, -11.0], b: [W + 0.7, -5.0], w: 3.4, z: 0, tips: 3, dark: 0.08 },
      { a: [0.6, -10.8], m: [-5.0, -11.8], b: [-(W + 0.7), -5.2], w: 3.6, z: 0, tips: 3, dark: 0.08 },
      // mechinhas finas na frente da orelha (costeleta repicada)
      { a: [W - 0.6, -6.0], m: [T + 0.3, -2.2], b: [T - 0.6, 2.4], w: 1.9, z: 1, dark: 0.12 },
      { a: [-(W - 0.6), -6.0], m: [-(T + 0.3), -2.2], b: [-(T - 0.6), 2.2], w: 1.9, z: 1, dark: 0.12 },
      // franja longa em diagonal (camada de trás e da frente)
      { a: [4.2, -10.6], m: [3.8, -8.6], b: [1.6, -5.2], w: 3.0, z: 1, tips: 2, dark: 0.1 },
      { a: [2.6, -11.0], m: [0.4, -8.8], b: [-3.6, -3.7], w: 3.8, z: 2, tips: 2 },
      { a: [0.2, -10.8], m: [-3.6, -9.4], b: [-6.6, -3.4], w: 3.2, z: 2, tips: 2 },
      { a: [-2.8, -10.2], m: [-6.4, -8.4], b: [-T, -2.0], w: 2.2, z: 3, dark: -0.08 },
      { a: [3.6, -9.8], m: [2.0, -7.8], b: [-0.8, -4.9], w: 1.8, z: 3, dark: -0.1 },
    ];
  },
};

/** entradas: cabelo bem curto (máquina alta em cima), têmporas recuadas, topete curtinho no meio da testa */
const RECEDING: ShortDef = {
  cap: () => ({ lift: 0.75, side: 0.35, recede: 1.45, hl: -7.9, peak: 0.25 }),
  crop: true,
  sheenY: 2.0,
  scale: 0.85,
  tufts: (k) => {
    const W = k.Wc;
    return [
      { a: [1.0, -10.6], m: [5.6, -11.0], b: [W + 0.4, -5.6], w: 3.0, z: 0, tips: 2, dark: 0.12 },
      { a: [0.6, -10.8], m: [-4.8, -11.2], b: [-(W + 0.4), -5.6], w: 3.2, z: 0, tips: 2, dark: 0.12 },
      { a: [1.4, -10.8], m: [1.4, -9.6], b: [0.4, -7.5], w: 2.6, z: 1, tips: 2 },
      { a: [-0.6, -10.8], m: [-1.6, -9.6], b: [-2.0, -7.7], w: 2.2, z: 1, tips: 2 },
    ];
  },
};

/** topo ralo: laterais e nuca cheias, alto translúcido (o couro cabeludo aparece entre fios finos) */
function thinningFront(k: HairKit): void {
  const { ctx, t, H, s, lite } = k;
  const cap = capOutline(k, { lift: 0.12, side: 0.45, recede: 1.05, hl: -8.2 });
  const c = H(0, -9.4);
  // o alto é translúcido: degradê radial que só fica opaco nas laterais
  ctx.push(cap.d, t.root, {
    gf: { t: 'r', cx: c[0], cy: c[1], r: 7.6 * s, s: [[0, mix(t.base, t.root, 0.3), 0.1], [0.5, mix(t.base, t.root, 0.3), 0.22], [0.78, t.base, 0.8], [1, t.root, 1]] },
  });
  // fios finos e ralos no alto (pentados pra trás e pro lado)
  if (!lite) {
    let d = '';
    for (let i = 0; i < 9; i++) {
      const x = -4 + i;
      d += taperPath([H(x * 0.9, -8.2 + Math.abs(x) * 0.15), H(x * 0.95 + 0.6, -9.9), H(x * 1.05 + 1.2, -11.0)], [0.25 * s, 0.32 * s, 0], { n: 6 });
    }
    ctx.push(d, mix(t.base, t.lock, 0.2), { o: 0.5 });
  }
  cropTexture(k, cap.d, { keep: (x, y) => Math.abs(x - k.cx) > 4.4 * s || y > H(0, -6.5)[1], o: 0.9 });
  // laterais: duas massas cheias de cada lado (em ferradura)
  const W = k.Wc;
  const T = k.Tm;
  const side: Tuft[] = [
    { a: [5.0, -9.8], m: [W + 0.6, -8.0], b: [T + 0.2, -1.4], w: 3.0, z: 0, tips: 2, dark: 0.12 },
    { a: [-5.0, -9.8], m: [-(W + 0.6), -8.0], b: [-(T + 0.2), -1.4], w: 3.0, z: 0, tips: 2, dark: 0.12 },
  ];
  paintTufts(k, side, { under: cap.d, sheenY: 4.5, sheenO: 0.6 });
  // brilho da pele no alto (o couro cabeludo pega luz)
  if (!lite) ctx.push(taperPath([H(-4.6, -9.0), H(-2.6, -10.3), H(0.4, -10.7)], [0, 1.1 * s, 0]), mix(ctx.col.skin, '#FFFFFF', 0.5), { o: 0.22, b: 0.5, cp: k.ha.headPath });
  softHairline(k, cap.edge.slice(3, cap.edge.length - 3), cap.d, { mid: 0.4 });
}

// ---------------------------------------------------------------------------------------------------------------
// penteados (mechas longas, sulcos de pente, brilho nítido)
// ---------------------------------------------------------------------------------------------------------------

/** risca lateral: risca do lado esquerdo da tela, cabelo penteado por cima pro outro lado, volume na frente */
const SIDE: ShortDef = {
  cap: () => ({ lift: 1.35, side: 0.55, lean: 0.6, hl: -7.5 }),
  part: [-3.3, -7.7, -2.4, -11.4],
  sheenY: 2.3,
  gloss: 1.1,
  tufts: (k) => {
    const W = k.Wc;
    const T = k.Tm;
    return [
      { a: [1.0, -11.3], m: [W + 0.4, -10.2], b: [T + 0.2, -1.3], w: 3.0, z: 0, dark: 0.26 },
      { a: [-3.6, -10.8], m: [-(W + 0.4), -9.2], b: [-(T + 0.15), -1.3], w: 2.5, z: 0, dark: 0.26 },
      { a: [-2.6, -11.0], m: [2.0, -13.0], b: [W + 0.75, -6.0], w: 3.8, z: 1, dark: 0.06 },
      { a: [-2.8, -10.0], m: [1.2, -11.6], b: [W + 0.3, -4.4], w: 3.2, z: 1 },
      { a: [-2.8, -9.0], m: [0.6, -10.2], b: [6.4, -6.9], w: 3.0, z: 2 },
      { a: [-2.7, -8.2], m: [0.4, -9.3], b: [4.4, -7.4], w: 2.0, z: 3, dark: -0.1, round: true },
      // lado pequeno da risca: penteado pra baixo e pra fora
      { a: [-3.8, -10.0], m: [-5.8, -9.6], b: [-7.2, -6.0], w: 2.5, z: 2, dark: 0.04 },
    ];
  },
};

/** clássico penteado (cinema): risca funda, tudo assentado com pomada, ondinha na frente, laterais bem curtas */
const CLASSIC: ShortDef = {
  cap: () => ({ lift: 1.0, side: 0.35, lean: 0.45, hl: -7.7 }),
  part: [-3.6, -7.9, -2.8, -11.2],
  sheenY: 2.0,
  gloss: 1.8,
  tufts: (k) => {
    const W = k.Wc;
    const T = k.Tm;
    return [
      { a: [0.6, -11.0], m: [W + 0.2, -9.6], b: [T + 0.1, -1.2], w: 2.8, z: 0, dark: 0.3 },
      { a: [-3.9, -10.4], m: [-(W + 0.25), -8.8], b: [-(T + 0.1), -1.2], w: 2.3, z: 0, dark: 0.3 },
      { a: [-3.0, -10.8], m: [2.4, -12.4], b: [W + 0.5, -5.4], w: 3.8, z: 1, dark: 0.04 },
      { a: [-3.2, -9.6], m: [1.6, -11.1], b: [W + 0.2, -4.0], w: 3.4, z: 1 },
      // ondinha da frente (sobe da risca e assenta pro lado)
      { a: [-3.2, -8.4], m: [0.6, -10.0], b: [5.8, -7.6], w: 2.8, z: 2, dark: -0.05 },
      { a: [-4.0, -9.4], m: [-5.6, -9.0], b: [-6.9, -6.4], w: 2.2, z: 2, dark: 0.06 },
    ];
  },
};

/**
 * topete: rolo LARGO (quase da largura do crânio) que sobe da linha do cabelo e vira pra trás; o pico fica na frente e
 * um pouco pro lado, a silhueta é um arco (nada de torre ou coque); laterais curtas e mais escuras
 */
function quiffTufts(k: HairKit, h: number, smooth: boolean): Tuft[] {
  const W = k.Wc;
  const T = k.Tm;
  const tips = smooth ? 1 : 2;
  const top = -11.6 - h; // pico do rolo
  const out: Tuft[] = [
    // laterais curtas (escuras, coladas)
    { a: [1.2, -10.4], m: [W + 0.25, -9.6], b: [T + 0.1, -1.3], w: 2.8, z: 0, dark: 0.34 },
    { a: [-1.2, -10.4], m: [-(W + 0.25), -9.6], b: [-(T + 0.1), -1.3], w: 2.8, z: 0, dark: 0.34 },
    // massa de trás do rolo: arco largo de têmpora a têmpora (dá a silhueta)
    { a: [-(W - 0.6), -6.6], m: [-(W - 1.4), top + 0.6], b: [1.4, top - 0.2], w: 4.0, z: 0, dark: 0.16 },
    { a: [W - 0.4, -6.8], m: [W - 1.0, top + 1.4], b: [0.6, top + 0.1], w: 3.8, z: 0, dark: 0.2 },
  ];
  // frente do rolo: mechas que nascem na linha do cabelo, sobem abrindo e viram pra trás e pro lado no alto
  const xs = [-5.2, -3.0, -0.9, 1.2, 3.3, 5.3];
  xs.forEach((x, i) => {
    const hh = h * (1 - Math.abs(x - 1) / 9);
    out.push({
      a: [x * 0.95, -7.7 + x * x * 0.035],
      m: [x * 1.12 - 0.2, -10.9 - hh * 0.55],
      b: [x * 0.78 + 1.3, -11.8 - hh * 0.9],
      w: 3.0,
      z: i % 2 ? 1 : 2,
      tips,
      dark: i % 2 ? 0.1 : 0,
    });
  });
  // a crista que vira por cima, pegando luz
  out.push({ a: [-4.4, top + 1.6], m: [-0.4, top - 0.1], b: [4.4, top + 1.2], w: 2.2, z: 3, tips, dark: -0.12 });
  return out;
}

const QUIFF: ShortDef = { cap: () => ({ lift: 1.3, side: 0.35, hl: -7.4 }), tufts: (k) => quiffTufts(k, 2.0, false), sheenY: 0.6 };
const POMPADOUR: ShortDef = { cap: () => ({ lift: 1.5, side: 0.25, hl: -7.5 }), tufts: (k) => quiffTufts(k, 2.9, true), sheenY: 0.1, gloss: 1.9 };

// ---------------------------------------------------------------------------------------------------------------
// máquina e laterais raspadas
// ---------------------------------------------------------------------------------------------------------------

function buzzFront(k: HairKit): void {
  const cap = capOutline(k, { lift: 0.15, side: 0.1, hl: -7.5, sideburn: k.earTop + 1.4 });
  shavedArea(k, cap.d, { density: 1.05 });
  softHairline(k, cap.edge.slice(3, cap.edge.length - 3), cap.d, { mid: 0.3, hairs: false });
  // o crânio continua pegando luz por baixo do cabelo raspado
  if (!k.lite) k.ctx.push(taperPath([k.H(-5.6, -8.0), k.H(-3.2, -10.2), k.H(0.2, -10.8)], [0, 1.3 * k.s, 0]), mix(k.ctx.col.skin, '#FFFFFF', 0.45), { o: 0.18, b: 0.6, cp: cap.d });
}

/** linha que separa o topo (cabelo) das laterais raspadas, na cabeça unitária: y em cada x */
function topPatch(k: HairKit, lift: number, yCut: number, xR = 1, xL = 1): string {
  const pts: SP[] = [];
  for (let a = -90 * xL; a <= 90 * xR; a += 15) pts.push(skullPt(k, a * 0.78, lift * Math.cos((a * Math.PI) / 360)));
  const r = k.H((k.Wc + lift * 0.3) * xR, yCut);
  const l = k.H(-(k.Wc + lift * 0.3) * xL, yCut);
  return smoothPath([...pts, r, k.H(0, -7.3), l]);
}

/** undercut: laterais raspadas e o topo comprido penteado pro lado e pra trás */
function undercutFront(k: HairKit): void {
  const side = capOutline(k, { lift: 0.12, side: 0.1, hl: -7.5, sideburn: k.earTop + 1.2 });
  shavedArea(k, side.d, { density: 0.9 });
  const top = topPatch(k, k.flat ? 0.2 : 1.6, -6.4);
  k.ctx.push(top, k.t.root);
  const W = k.Wc;
  const tufts: Tuft[] = flatten(k, [
    { a: [-3.6, -8.0], m: [-2.0, -12.6], b: [3.4, -12.0], w: 3.4, z: 0, dark: 0.1 },
    { a: [-5.4, -6.8], m: [-5.6, -11.4], b: [0.6, -12.4], w: 3.0, z: 0, dark: 0.12 },
    { a: [-1.0, -7.4], m: [1.6, -12.4], b: [W - 0.4, -8.6], w: 3.6, z: 1 },
    { a: [1.8, -7.2], m: [4.6, -11.0], b: [W + 0.6, -6.6], w: 3.2, z: 1, dark: 0.04 },
    // franja que cai pra direita por cima da linha raspada
    { a: [-2.6, -9.6], m: [2.6, -11.0], b: [W + 0.9, -5.6], w: 2.8, z: 2, tips: 2, dark: -0.08 },
  ]);
  paintTufts(k, tufts, { under: top, sheenY: 1.6 });
}

/** moicano: laterais raspadas e crista de pontas que sobe do meio da cabeça */
function mohawkFront(k: HairKit): void {
  const side = capOutline(k, { lift: 0.12, side: 0.1, hl: -7.5, sideburn: k.earTop + 1.2 });
  shavedArea(k, side.d, { density: 0.85 });
  // embaixo de boné/chapéu, coroa, tiara ou chapéu de festa a crista achata num tufo baixo (o item senta no crânio)
  const h = k.flat || hatFlattensCrest(k.ctx.cfg.hat) ? 0 : 1;
  const tufts: Tuft[] = [];
  if (h) {
    // pontas da crista: base estreita no couro cabeludo (−2,2..2,2), ponta alta; as da frente mais baixas
    const crest: [number, number, number, number][] = [
      [-1.6, -7.6, -3.0, -12.0],
      [1.4, -7.8, 2.6, -12.6],
      [-0.4, -8.6, -1.6, -15.2],
      [0.6, -9.4, 1.4, -16.6],
      [-0.2, -10.2, -0.8, -17.2],
      [0.4, -10.8, 2.6, -16.4],
    ];
    crest.forEach(([ax, ay, bx, by], i) => tufts.push({ a: [ax, ay], m: [(ax + bx) / 2 + 0.3, (ay + by) / 2 - 0.4], b: [bx, by], w: 2.6, z: i < 2 ? 0 : i < 4 ? 1 : 2, tips: 2, dark: i % 2 ? 0.08 : 0 }));
  } else {
    tufts.push({ a: [0, -7.6], m: [0.4, -10.4], b: [0.6, -10.6], w: 3.0, z: 0 });
  }
  const base = smoothPath([k.H(-2.3, -7.4), k.H(-2.4, -10.6), k.H(0, -11.2), k.H(2.4, -10.6), k.H(2.3, -7.4)]);
  k.ctx.push(base, k.t.root);
  paintTufts(k, tufts, { under: base, sheenY: -2.5 });
}

/** mullet: curto e repicado em cima, comprido atrás (cai na nuca e passa dos ombros por trás das orelhas) */
function mulletBack(k: HairKit): void {
  const { ctx, H, Wc, nk, cx, t, an, s } = k;
  const locks: Lock[] = [];
  for (const g of [-1, 1] as const) {
    const X = (x: number) => cx + g * x;
    const st = (x: number) => shoulderTop(an, g, cx + g * x);
    const L = (dx: number, w: number, z: number, flick: number): Lock => {
      const sp: SP[] = [H(g * (Wc - 0.2), -2.0), H(g * (Wc + 0.9), 3.2), [X(nk + dx * 0.6 + 1.2), H(0, 11)[1]], [X(nk + dx), st(nk + dx) - 1.2], [X(nk + dx + flick), st(nk + dx) + 0.6]];
      return { spine: sp, w: [w * 0.7 * s, w * s, w * s, w * 0.75 * s, w * 0.2 * s], z, g, round: true };
    };
    locks.push(L(5.6, 3.0, 0, 1.4), L(3.8, 3.2, 1, 0.9), L(2.0, 2.6, 2, 0.5));
  }
  const nape = smoothPath([H(-(Wc - 0.4), -3), H(Wc - 0.4, -3), [cx + nk + 3, an.collarY], [cx - nk - 3, an.collarY]]);
  ctx.push(nape, t.root);
  paintLocks(k, locks, { under: nape, y0: H(0, -2)[1], y1: an.shoulderY + 4 });
}

const MULLET: ShortDef = {
  cap: (k) => ({ lift: 1.2, side: 0.5, hl: -7.4, sideburn: k.earTop + 2.2 }),
  sheenY: 2.4,
  tufts: (k) => {
    const W = k.Wc;
    const T = k.Tm;
    return [
      { a: [1.2, -10.6], m: [6.4, -11.0], b: [W + 0.8, -4.8], w: 3.5, z: 0, tips: 3, dark: 0.08 },
      { a: [0.8, -10.8], m: [-5.0, -11.8], b: [-(W + 0.8), -4.8], w: 3.8, z: 0, tips: 3, dark: 0.08 },
      { a: [W - 0.4, -6.6], m: [T + 0.6, -3.0], b: [T + 0.4, 1.8], w: 2.4, z: 1, tips: 2, dark: 0.14 },
      { a: [-(W - 0.4), -6.6], m: [-(T + 0.6), -3.0], b: [-(T + 0.4), 1.8], w: 2.4, z: 1, tips: 2, dark: 0.14 },
      { a: [2.4, -10.8], m: [2.2, -9.0], b: [0.6, -6.2], w: 3.0, z: 2, tips: 2 },
      { a: [0.0, -10.8], m: [-2.0, -9.2], b: [-3.4, -5.9], w: 3.0, z: 2, tips: 2 },
      { a: [-2.8, -10.4], m: [-5.8, -9.2], b: [-6.8, -5.0], w: 2.4, z: 2, tips: 2, dark: 0.04 },
    ];
  },
};

/** raspado lateral: lado direito da tela raspado, risca funda à direita e o resto caindo longo do lado esquerdo */
const SIDE_SHAVE_FALL: FallOpts = { len: -1.5, lift: 1.4, px: 3.2, side: -1 };

function sideShaveBack(k: HairKit): void {
  fallBack(k, SIDE_SHAVE_FALL);
}

function sideShaveFront(k: HairKit): void {
  const { H, s, t } = k;
  // raspado só no lado direito da tela (recortado à direita da risca)
  const side = capOutline(k, { lift: 0.12, side: 0.1, hl: -7.5, sideburn: k.earTop + 1.2 });
  shavedArea(k, side.d, { density: 1.15, fromX: H(2.6, 0)[0] });
  // o lado comprido: o painel do lado esquerdo da tela e a calota que sai da risca
  fallFront(k, { ...SIDE_SHAVE_FALL, wisps: false });
  // mecha grande varrida da risca por cima da cabeça até a têmpora esquerda (cobre a calota)
  const top = k.flat ? 2.0 : 0;
  const sweep: Lock = { spine: [H(2.9, -10.6 + top * 0.3), H(0.4, -12.2 + top), H(-4.8, -10.6 + top * 0.5), H(-(k.Wc + 0.6), -5.0), H(-(k.Tm + 0.4), 0.5)], w: [1.6 * s, 4.2 * s, 4.6 * s, 3.6 * s, 2.4 * s], z: 0, g: 1 };
  paintLocks(k, [sweep], { grad: (tone) => fallGrad(k, H(0, -12)[1], H(0, 1)[1], tone), rimO: t.pale ? 0.2 : 0.45 });
  ringSheen(k, [{ spine: sweep.spine, w: 4 * s }], (x) => H(0, -10.4)[1] + Math.abs(x - k.cx) * 0.25, { len: 0.12, wk: 0.3, o: t.pale ? 0.5 : 0.62, pair: true });
  if (!k.flat) flyaways(k, [[H(1.6, -12.0), H(-1.6, -12.9), H(-4.6, -12.0)]]);
}

export const SHORT_STYLES: Record<string, Style> = {
  short: { front: (k) => void shortFront(k, SHORT) },
  pixie: { front: (k) => void shortFront(k, PIXIE) },
  receding: { front: (k) => void shortFront(k, RECEDING) },
  thinning: { front: thinningFront },
  side: { front: (k) => void shortFront(k, SIDE) },
  classic: { front: (k) => void shortFront(k, CLASSIC) },
  quiff: { front: (k) => void shortFront(k, QUIFF) },
  pompadour: { front: (k) => void shortFront(k, POMPADOUR) },
  buzz: { front: buzzFront },
  undercut: { front: undercutFront },
  mohawk: { front: mohawkFront },
  mullet: { back: mulletBack, front: (k) => void shortFront(k, MULLET) },
  side_shave: { back: sideShaveBack, front: sideShaveFront },
};
