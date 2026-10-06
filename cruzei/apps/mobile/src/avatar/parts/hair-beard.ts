// Barbas e bigodes (etapa 18, antes da expressão: a boca e os olhos ficam por cima). Dono: cabelo.
//
// Receita:
//   - tudo na cabeça unitária (k.H) e sobre o CONTORNO do rosto de cada formato (mesmos pontos de anatomy.headPts, com
//     a idade): a barba acompanha a mandíbula do quadrado, do coração, do longo…;
//   - a barba NASCE na pele: a linha da bochecha é translúcida (faixa de pele misturada) com fios curtos atravessando;
//     a borda de baixo rompe em tufinhos que seguem o caimento (nunca contorno liso de adesivo);
//   - volume: mais clara e fina na bochecha, mais densa e escura embaixo do queixo; brilho macio no queixo (lado da
//     luz); sombra sob o lábio de baixo; fios curtos seguindo o fluxo (bigode abre pros lados, barba desce);
//   - bigode fica SOBRE o lábio de cima (a boca desenhada depois cobre só a sobra);
//   - grisalho: fios escuros e claros misturados (saltPepper do kit).

import { smoothPath, taperPath, type SP } from '../anatomy';
import { lum, mix } from '../shading';
import type { Pt } from '../types';

import { rnd, saltPepper, shaved, type HairKit } from './hair-kit';

type U = [number, number];

/** medidas do rosto pra barba (cabeça unitária) */
function faceFrame(k: HairKit) {
  const m = k.U(k.ha.mouth);
  const n = k.U(k.ha.nose);
  const js = k.an.face.jawSharp * (1 - 0.15 * k.an.feat.age);
  const flat = !!k.an.face.flatChin;
  return {
    mx: m[0],
    my: m[1],
    mw: k.ha.mouthW / k.s,
    up: k.ha.lipUp / k.s,
    lo: k.ha.lipLo / k.s,
    noseY: n[1],
    js,
    flat,
  };
}

/**
 * contorno do rosto do lado direito (x ≥ 0), da têmpora (na frente da orelha) até o meio do queixo, deslocado pra fora
 * `out(u)` (u 0 na têmpora … 1 no queixo): mesmos pontos de anatomy.headPts
 */
function jawContour(k: HairKit, out: (u: number) => number, from = 0): U[] {
  const { Tm, Ck, cheekY, Jw, jawY, chinW, chinY } = k;
  const { js, flat } = faceFrame(k);
  const mid = (a: number, b: number, t: number) => a + (b - a) * t;
  const base: U[] = [
    [mid(Tm, k.Wc, 0.25), -1.6],
    [Ck, cheekY],
    [mid(Ck, Jw, 0.42 - js * 0.12), mid(cheekY, jawY, 0.55)],
    [Jw, jawY],
    [mid(Jw, chinW, 0.55 + js * 0.1), mid(jawY, chinY, 0.6 + js * 0.06)],
    [chinW, chinY - (flat ? 0.22 : 0.5)],
    [0, chinY],
  ];
  // normal pra fora de cada ponto (pelo vizinho) e deslocamento
  const res: U[] = [];
  for (let i = 0; i < base.length; i++) {
    const a = base[Math.max(0, i - 1)];
    const b = base[Math.min(base.length - 1, i + 1)];
    let nx = b[1] - a[1];
    let ny = -(b[0] - a[0]);
    const L = Math.hypot(nx, ny) || 1;
    nx /= L;
    ny /= L;
    if (nx < 0 && i < base.length - 1) {
      nx = -nx;
      ny = -ny;
    }
    if (i === base.length - 1) {
      nx = 0;
      ny = 1;
    }
    const u = i / (base.length - 1);
    if (u < from - 1e-6) continue;
    const o = out(u);
    res.push([base[i][0] + nx * o, base[i][1] + ny * o]);
  }
  return res;
}

const mirror = (pts: readonly U[]): U[] => pts.map(([x, y]) => [-x, y] as U);

/** espelha (x → −x) mantendo a quina (3º valor) */
const mirrorSP = (pts: readonly SP[]): SP[] => pts.map((p) => (p.length > 2 ? ([-p[0], p[1], p[2] as number] as SP) : ([-p[0], p[1]] as SP)));

interface BeardDef {
  /** espessura pra fora do contorno: lateral e queixo */
  side: number;
  chin: number;
  /** alongamento abaixo do queixo (barba longa) */
  drop?: number;
  /** ponta do queixo (Van Dyke, longa): estreita embaixo */
  point?: number;
  /** linha da bochecha: 0 baixa e nítida (aparada) … 1 alta e macia (cheia) */
  cheek: number;
  /** bigode ligado à barba */
  stache: boolean;
}

/** espessura da barba pra fora do contorno (u 0 têmpora … 1 queixo): nada na costeleta (fica na frente da orelha) */
function beardOut(o: BeardDef): (u: number) => number {
  const drop = o.drop ?? 0;
  return (u) => {
    const ramp = Math.max(0, Math.min(1, (u - 0.17) / 0.3));
    return o.side * ramp * ramp + (o.chin - o.side) * Math.pow(Math.max(0, (u - 0.4) / 0.6), 1.3) + drop * Math.pow(Math.max(0, (u - 0.6) / 0.4), 2);
  };
}

/** linha da bochecha (cabeça unitária), da costeleta até o canto da boca: fica na bochecha de fora e desce na diagonal */
function cheekLinePts(k: HairKit, ch: number): SP[] {
  const f = faceFrame(k);
  const { Tm, earTop, earY } = k;
  // costeleta de ~1 de largura até a altura do lóbulo; dali a linha desce em diagonal convexa até o canto da boca
  return [
    [Tm - 0.95, earTop + 0.4, 0],
    [Tm - 1.12 - ch * 0.1, earY + 0.8 - ch * 0.5],
    [Tm - 1.55 - ch * 0.35, k.earBot - 0.2 - ch * 0.9],
    [f.mw + 2.0 + ch * 0.3, f.my - 1.0 - ch * 0.5],
    [f.mw + 0.55, f.my - f.up - 0.5],
  ];
}

/** contorno da barba cheia (com bigode) na cabeça unitária */
function fullBeardPts(k: HairKit, o: BeardDef): SP[] {
  const f = faceFrame(k);
  const { Tm, earTop } = k;
  const out = beardOut(o);
  const right = jawContour(k, out);
  if (o.point) {
    // estreita embaixo: o queixo vira ponta
    const last = right.length - 1;
    right[last - 1] = [right[last - 1][0] * (1 - o.point * 0.55), right[last - 1][1] + o.point * 0.6];
    right[last] = [0, right[last][1] + o.point * 0.9];
  }
  const cheekLine: SP[] = [...cheekLinePts(k, o.cheek), [f.mw * 0.45, f.noseY + 0.95], [0.55, f.noseY + 0.75]];
  const R: SP[] = [...cheekLine.slice().reverse(), [Tm - 0.05, earTop + 0.25, 0], ...right.slice(1)];
  // R vai do meio do bigode → bochecha → costeleta → contorno → queixo; o lado esquerdo espelhado volta
  return [[0, f.noseY + 0.85], ...R, ...mirrorSP(R).reverse().slice(1)];
}

/** bigode (cabeça unitária): `thick` altura, `wide` sobra além do canto da boca, `droop` pontas descendo, `curl` guidão */
function staches(k: HairKit, o: { thick: number; wide: number; droop: number; top?: number }): SP[] {
  const f = faceFrame(k);
  const y0 = f.my - f.up * 0.75; // borda de baixo no meio (sobre o lábio)
  const yt = Math.max(f.noseY + 0.55, y0 - o.thick) - (o.top ?? 0);
  const half: SP[] = [
    [0.35, y0 - 0.1],
    [f.mw * 0.55, y0 + 0.12],
    [f.mw + o.wide, f.my + o.droop, 0.6],
    [f.mw + o.wide * 0.6, f.my + o.droop - 0.7],
    [f.mw * 0.7, yt + 0.35],
    [0.4, yt + 0.05],
  ];
  // começa no meio de baixo, faz o lado direito, passa pelo meio de cima e volta pelo esquerdo
  return [[0, y0 + 0.05], ...half, [0, yt + 0.25], ...mirrorSP(half).reverse()];
}

/** pinta uma massa de barba: base, volume, borda translúcida, fios, tufinhos na borda de baixo e grisalho */
function paintBeard(
  k: HairKit,
  ptsU: readonly SP[],
  o: {
    /** borda de baixo que rompe em tufinhos (cabeça unitária) */
    fringe?: readonly U[];
    /** direção do fio: 'down' (barba), 'out' (bigode) */
    flow: 'down' | 'out' | 'mixed';
    density?: number;
    seed?: number;
    gloss?: number;
    /** comprimento do fio */
    len?: number;
  },
): string {
  const { ctx, t, lite, H, s } = k;
  const f = faceFrame(k);
  const pts = ptsU.map((p) => (p.length > 2 ? ([...H(p[0], p[1]), p[2] as number] as SP) : H(p[0], p[1])));
  const d = smoothPath(pts);
  const ys = pts.map((p) => p[1]);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  // sombra de contato da barba na pele (abaixo da borda e no pescoço)
  if (!lite) ctx.push(smoothPath(pts.map((p) => [p[0] + 0.15, p[1] + 0.55] as SP)), '#0A0408', { o: 0.22, b: 0.6 });
  // massa: mais clara na bochecha, densa embaixo
  ctx.push(d, t.base, {
    gf: { t: 'l', x1: 0, y1: y0, x2: 0, y2: y1, s: [[0, mix(t.base, t.lock, 0.12)], [0.45, t.base], [1, mix(t.base, t.root, 0.55)]] },
  });
  // volume: lado da sombra (direita da tela) e o queixo pegando luz do lado esquerdo
  if (!lite) {
    const c = H(-2.2, f.my + 2.2);
    ctx.push(d, t.root, { gf: { t: 'r', cx: c[0], cy: c[1], r: 11 * s, s: [[0, t.root, 0], [0.55, t.root, 0.05], [1, t.root, 0.5]] }, cp: d });
    ctx.push(smoothPath([H(-3.6, f.my + 1.6), H(-1.2, f.my + 1.1), H(0.6, f.my + 2.6), H(-1.4, f.my + 4.4), H(-3.8, f.my + 3.6)]), t.sheen, { o: 0.22 * (o.gloss ?? 1), b: 0.9, cp: d });
    // sombra embaixo do lábio de baixo (a boca fica "dentro" da barba)
    ctx.push(smoothPath([H(-f.mw * 0.7, f.my + f.lo + 0.15), H(0, f.my + f.lo + 0.45), H(f.mw * 0.7, f.my + f.lo + 0.15), H(0, f.my + f.lo + 1.6)]), t.deep, { o: 0.45, b: 0.45, cp: d });
  }
  // fios curtos seguindo o fluxo (escuros e claros), recortados na massa
  if (!lite) {
    const r = rnd(o.seed ?? 51);
    const ux0 = Math.min(...ptsU.map((p) => p[0]));
    const ux1 = Math.max(...ptsU.map((p) => p[0]));
    const uy0 = Math.min(...ptsU.map((p) => p[1]));
    const uy1 = Math.max(...ptsU.map((p) => p[1]));
    const gap = 0.62 / (o.density ?? 1);
    let dk = '';
    let lt = '';
    let row = 0;
    for (let y = uy0; y < uy1 + 0.5; y += gap * 0.75, row++) {
      for (let x = ux0 + (row % 2 ? gap * 0.5 : 0); x < ux1; x += gap) {
        const px = x + (r() - 0.5) * gap * 0.8;
        const py = y + (r() - 0.5) * gap * 0.8;
        const g = Math.sign(px) || 1;
        let dx: number;
        let dy: number;
        const inStache = py < f.my + 0.2 && Math.abs(px) < f.mw + 1.6;
        if (o.flow === 'out' || (o.flow === 'mixed' && inStache)) {
          dx = g * 0.85;
          dy = 0.55;
        } else {
          // desce; perto do queixo converge pro meio; na costeleta quase vertical
          dx = -g * 0.12 * Math.min(1, Math.abs(px) / 6) + g * (py < 2 ? 0.05 : 0);
          dy = 1;
        }
        const L = Math.hypot(dx, dy);
        const len = (o.len ?? 0.95) * (0.7 + r() * 0.6);
        const ax = px - (dx / L) * len * 0.4;
        const ay = py - (dy / L) * len * 0.4;
        const A = H(ax, ay);
        const seg = `M${A[0].toFixed(2)},${A[1].toFixed(2)}l${((dx / L) * len * s).toFixed(2)},${((dy / L) * len * s).toFixed(2)}`;
        if (r() < (px < 0 ? 0.42 : 0.22)) lt += seg;
        else dk += seg;
      }
    }
    if (dk) ctx.stroke(dk, t.pale ? t.deep : t.root, 0.17 * s, { o: t.pale ? 0.42 : 0.55, cp: d });
    if (lt) ctx.stroke(lt, t.pale ? mix(t.base, '#FFFFFF', 0.45) : t.lock, 0.15 * s, { o: t.pale ? 0.55 : 0.45, cp: d });
  }
  // tufinhos rompendo a borda de baixo (seguem o caimento, pontas finas)
  if (o.fringe && o.fringe.length > 1) {
    const r = rnd((o.seed ?? 51) + 9);
    const fr = o.fringe.map((p) => H(p[0], p[1]));
    let tf = '';
    const n = lite ? 0 : Math.round(fr.length * 2.2);
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n;
      const fpos = u * (fr.length - 1);
      const a = Math.floor(fpos);
      const b = Math.min(fr.length - 1, a + 1);
      const p: Pt = [fr[a][0] + (fr[b][0] - fr[a][0]) * (fpos - a), fr[a][1] + (fr[b][1] - fr[a][1]) * (fpos - a)];
      const g = Math.sign(p[0] - k.cx) || 1;
      const L = (0.7 + r() * 0.6) * s;
      const w = (0.55 + r() * 0.3) * s;
      tf += taperPath([[p[0], p[1] - L * 0.6], [p[0] - g * 0.12, p[1] + L * 0.1], [p[0] - g * L * 0.18, p[1] + L * 0.5]], [w, w * 0.7, 0], { n: 5 });
    }
    if (tf) ctx.push(tf, mix(t.base, t.root, 0.45));
  }
  // grisalho: fios escuros/claros misturados
  if (t.gray && !lite) {
    const r = rnd((o.seed ?? 51) + 21);
    const sp: SP[][] = [];
    for (let i = 0; i < 26; i++) {
      const x = (r() - 0.5) * 2 * (k.Jw + 0.5);
      const y = f.noseY + 1 + r() * (k.chinY - f.noseY + (o.flow === 'out' ? -3 : 1));
      sp.push([H(x, y), H(x * 0.96, y + 0.8), H(x * 0.9, y + 1.6)]);
    }
    saltPepper(k, sp, d, (o.seed ?? 51) + 5);
  }
  return d;
}

// ---------------------------------------------------------------------------------------------------------------
// estilos
// ---------------------------------------------------------------------------------------------------------------

/** borda translúcida da bochecha (cabeça unitária), do alto da costeleta até o canto da boca */
function cheekSoft(k: HairKit, ch: number): { R: U[]; L: U[] } {
  const R = cheekLinePts(k, ch).map((p) => [p[0] - 0.15, p[1] + 0.1] as U);
  return { R, L: mirror(R) };
}

function fullBeard(k: HairKit, o: BeardDef, extra: { seed: number; len?: number; gloss?: number; locks?: boolean }): string {
  const pts = fullBeardPts(k, o);
  const soft = cheekSoft(k, o.cheek);
  const bottom = jawContour(k, beardOut({ ...o, drop: 0 }), 0.45);
  const fringe = [...mirror(bottom).reverse(), ...bottom.slice(1)];
  const d = paintBeard(k, pts, { fringe: o.drop ? undefined : fringe, flow: 'mixed', seed: extra.seed, len: extra.len, gloss: extra.gloss });
  // borda macia dos dois lados (separada pra não cruzar o bigode)
  softEdge(k, soft.R, d);
  softEdge(k, soft.L, d);
  stacheShade(k, d);
  return d;
}

/** faixa translúcida + fios atravessando a borda (recortada na barba) */
function softEdge(k: HairKit, ptsU: readonly U[], clip: string): void {
  const { ctx, t, lite, H, s } = k;
  const sp = ptsU.map((p) => H(p[0], p[1]));
  ctx.push(taperPath(sp, (u) => (0.25 + Math.sin(Math.PI * u) * 0.35) * s), mix(ctx.col.skin, t.base, 0.4), { o: lite ? 0.25 : 0.45, ...(lite ? {} : { b: 0.3 }), cp: clip });
  if (lite) return;
  const r = rnd(ptsU.length * 7 + Math.round(ptsU[0][0] * 10));
  let hs = '';
  for (let i = 0; i < sp.length - 1; i++) {
    for (let j = 0; j < 3; j++) {
      const u = r();
      const x = sp[i][0] + (sp[i + 1][0] - sp[i][0]) * u;
      const y = sp[i][1] + (sp[i + 1][1] - sp[i][1]) * u;
      const L = (0.45 + r() * 0.4) * s;
      hs += `M${(x + (r() - 0.5) * 0.3).toFixed(2)},${(y - L * 0.35).toFixed(2)}l${((r() - 0.5) * 0.3).toFixed(2)},${L.toFixed(2)}`;
    }
  }
  ctx.stroke(hs, mix(t.base, t.root, 0.2), 0.15 * s, { o: 0.5 });
}

/** separação do bigode e da barba (sulco do canto da boca até o queixo) e o meio do bigode */
function stacheShade(k: HairKit, clip: string): void {
  const { ctx, t, lite, H, s } = k;
  if (lite) return;
  const f = faceFrame(k);
  let d = '';
  for (const g of [1, -1]) {
    d += taperPath([H(g * (f.mw * 0.6), f.my - f.up - 0.2), H(g * (f.mw + 0.45), f.my - 0.25), H(g * (f.mw + 0.75), f.my + 1.3)], [0, 0.55 * s, 0], { n: 6 });
  }
  // filtro do lábio: o bigode se divide no meio
  d += taperPath([H(0, f.noseY + 0.6), H(0.05, f.my - f.up - 0.6), H(0, f.my - f.up * 0.4)], [0, 0.35 * s, 0], { n: 5 });
  ctx.push(d, t.deep, { o: 0.42, b: 0.3, cp: clip });
}

function stacheOnly(k: HairKit, o: { thick: number; wide: number; droop: number; top?: number; seed: number; gloss?: number }): string {
  const pts = staches(k, o);
  const d = paintBeard(k, pts, { flow: 'out', seed: o.seed, len: 0.8, density: 1.25, gloss: o.gloss });
  stacheShade(k, d);
  // borda de baixo rendada sobre o lábio (tufinhos curtos)
  if (!k.lite) {
    const f = faceFrame(k);
    const { ctx, t, H, s } = k;
    const r = rnd(o.seed + 2);
    let tf = '';
    for (let i = 0; i < 9; i++) {
      const u = (i + 0.5) / 9;
      const x = (u * 2 - 1) * (f.mw + o.wide * 0.4);
      const y = f.my - f.up * 0.75 + Math.pow(Math.abs(x) / (f.mw + o.wide), 2) * (o.droop + f.up * 0.75) + 0.05;
      const g = Math.sign(x) || 1;
      const L = (0.5 + r() * 0.3) * s;
      tf += taperPath([H(x, y - 0.5), H(x + g * 0.1, y), H(x + g * 0.25, y + L / s * 0.45)], [0.5 * s, 0.35 * s, 0], { n: 5 });
    }
    ctx.push(tf, mix(t.base, t.root, 0.3));
  }
  return d;
}

/** barba do queixo (cavanhaque e Van Dyke): do canto da boca (ou só embaixo do lábio) até abaixo do queixo */
function chinPatch(k: HairKit, o: { wide: number; drop: number; point: number; connect: boolean; seed: number }): string {
  const f = faceFrame(k);
  const { chinW, chinY } = k;
  const top = f.my + f.lo + 0.35;
  // lados que acompanham o queixo (estreitam pra baixo) e fundo redondo; o Van Dyke termina em ponta
  const half: SP[] = o.connect
    ? [
        [f.mw + 0.3, f.my - 0.35],
        [f.mw + 0.5 + o.wide * 0.2, f.my + 1.2],
        [chinW + 0.45 + o.wide, chinY - 1.7],
        [chinW * (0.8 - o.point * 0.4) + o.wide * 0.3, chinY + o.drop * 0.5],
      ]
    : [
        [f.mw * 0.5, top + 0.3],
        [chinW + o.wide * 0.6, chinY - 1.6],
        [chinW * (0.85 - o.point * 0.55) + o.wide * 0.3, chinY + o.drop * 0.5],
      ];
  const inner: SP[] = o.connect ? [[f.mw * 0.25, top]] : [];
  const tip: SP = [0, chinY + o.drop, o.point > 0.5 ? 0.3 : 1];
  const R = [...inner, ...half];
  const pts: SP[] = [[0, top + 0.1], ...R, tip, ...mirrorSP(R).reverse()];
  const fringe: U[] = [
    [-(chinW + o.wide * 0.6), chinY - 0.8],
    [0, chinY + o.drop],
    [chinW + o.wide * 0.6, chinY - 0.8],
  ];
  return paintBeard(k, pts, { flow: 'down', seed: o.seed, fringe: o.point > 0.5 ? undefined : fringe, density: 1.15, len: 0.9 });
}

function sideburnsOnly(k: HairKit): void {
  const { Tm, earTop, earY } = k;
  const shape = (g: 1 | -1): SP[] => {
    // costeleta larga (na frente da orelha) que desce rente ao contorno até perto do ângulo da mandíbula
    const pts: SP[] = [
      [Tm - 1.05, earTop + 0.35, 0],
      [Tm - 0.05, earTop + 0.2, 0],
      [Tm + 0.05, earY + 0.6],
      [Tm - 0.2, k.earBot + 0.9],
      [Tm - 0.75, k.earBot + 1.7, 0.5],
      [Tm - 1.9, k.earBot + 1.0, 0.5],
      [Tm - 1.5, earY + 0.6],
    ];
    return g > 0 ? pts : mirrorSP(pts).reverse();
  };
  for (const g of [1, -1] as const) paintBeard(k, shape(g), { flow: 'down', seed: g > 0 ? 71 : 73, len: 0.9 });
}

function stubble(k: HairKit): void {
  const { ctx, H, s, lite } = k;
  const pts = fullBeardPts(k, { side: 0.05, chin: 0.15, cheek: 0.2, stache: true }).map((p) => (p.length > 2 ? ([...H(p[0], p[1]), p[2] as number] as SP) : H(p[0], p[1])));
  const d = smoothPath(pts);
  const f = faceFrame(k);
  // sombra de barba por fazer: tom do cabelo translúcido, mais forte embaixo e no bigode, some na bochecha
  const y0 = H(0, k.earTop)[1];
  const y1 = H(0, k.chinY)[1];
  // fio claro em pele escura (grisalho): pelÃ­cula bem leve, quem lÃª sÃ£o os pontinhos
  const lighter = lum(k.t.base) > lum(ctx.col.skin) + 0.08;
  shaved(k, d, { density: (lite ? 0.75 : 0.62) * (lighter ? 0.45 : 1), seed: 83, box: { x: H(-k.Ck, 0)[0], y: y0, w: 2 * k.Ck * s, h: y1 - y0 + 1 } });
  void f;
  void ctx;
  // a linha da bochecha some em degradê (pele por cima, recortada)
  const soft = cheekSoft(k, 0.2);
  for (const side of [soft.R, soft.L]) ctx.push(taperPath(side.map((p) => H(p[0], p[1])), (u) => (0.8 + Math.sin(Math.PI * u) * 1.2) * s), ctx.col.skin, { o: lite ? 0.35 : 0.55, ...(lite ? {} : { b: 0.5 }), cp: d });
}

export const BEARDS: Record<string, (k: HairKit) => void> = {
  stubble,
  // barba cheia média: linha da bochecha macia e alta, volume embaixo
  beard: (k) => void fullBeard(k, { side: 0.55, chin: 1.9, cheek: 0.75, stache: true }, { seed: 51 }),
  // aparada: rente, linha da bochecha baixa e nítida
  boxed: (k) => void fullBeard(k, { side: 0.3, chin: 1.0, cheek: 0.1, stache: true }, { seed: 53, len: 0.7, gloss: 1.2 }),
  // longa: desce no peito, ponta macia, bigode caindo nas laterais
  long_beard: (k) => longBeard(k),
  goatee: (k) => {
    stacheOnly(k, { thick: 1.35, wide: 0.35, droop: 0.9, seed: 61 });
    chinPatch(k, { wide: 0.35, drop: 1.0, point: 0, connect: true, seed: 63 });
  },
  van_dyke: (k) => {
    stacheOnly(k, { thick: 1.3, wide: 0.9, droop: -0.35, seed: 65, gloss: 1.2 });
    chinPatch(k, { wide: 0.1, drop: 2.6, point: 0.85, connect: false, seed: 67 });
  },
  mustache: (k) => void stacheOnly(k, { thick: 1.3, wide: 0.45, droop: 0.35, seed: 41 }),
  // bigode grosso: alto (chega no nariz), largo, cobre o lábio de cima
  chevron: (k) => void stacheOnly(k, { thick: 2.1, wide: 0.75, droop: 0.75, top: 0.2, seed: 43 }),
  handlebar: (k) => handlebar(k),
  sideburns: sideburnsOnly,
};

function longBeard(k: HairKit): void {
  const o: BeardDef = { side: 0.75, chin: 2.4, drop: 5.2, point: 0.38, cheek: 0.85, stache: true };
  const d = fullBeard(k, o, { seed: 57, len: 1.3 });
  if (k.lite) return;
  // mechas da barba (fitas que descem e convergem pra ponta, com luz do lado esquerdo)
  const { ctx, t, H, s } = k;
  const f = faceFrame(k);
  const tipY = k.chinY + 2.4 + 5.2 * 0.9 + 0.6;
  let lit = '';
  let gap = '';
  for (let i = -3; i <= 3; i++) {
    const x0 = i * 1.9;
    const sp: SP[] = [H(x0, f.my + 2.2), H(x0 * 0.85, k.chinY), H(x0 * 0.45, tipY - 2.2), H(x0 * 0.12, tipY - 0.6)];
    if (i < 1) lit += taperPath(sp, [0, 0.7 * s, 0.5 * s, 0], { n: 7 });
    gap += taperPath(sp.map((p) => [p[0] + 0.9 * s, p[1]] as SP), [0, 0.32 * s, 0.25 * s, 0], { n: 7 });
  }
  ctx.push(gap, t.deep, { o: 0.5, b: 0.2, cp: d });
  ctx.push(lit, t.lock, { o: 0.4, b: 0.25, cp: d });
  // bigode caído por cima, com as pontas descendo nas laterais da boca
  stacheOnly(k, { thick: 1.5, wide: 0.9, droop: 1.6, seed: 59 });
}

function handlebar(k: HairKit): void {
  const f = faceFrame(k);
  const { ctx, t, H, s, lite } = k;
  const d = stacheOnly(k, { thick: 1.35, wide: 0.6, droop: 0.15, seed: 45, gloss: 1.4 });
  void d;
  // pontas enceradas que sobem em espiral aberta (afinam, brilham)
  let cu = '';
  let hl = '';
  for (const g of [1, -1]) {
    const sp: SP[] = [H(g * (f.mw + 0.1), f.my - 0.35), H(g * (f.mw + 1.3), f.my - 0.2), H(g * (f.mw + 2.2), f.my - 1.0), H(g * (f.mw + 2.0), f.my - 2.0), H(g * (f.mw + 1.4), f.my - 2.1)];
    cu += taperPath(sp, [1.0 * s, 0.75 * s, 0.5 * s, 0.32 * s, 0.05], { n: 10 });
    hl += taperPath(sp.slice(0, 4).map((p) => [p[0], p[1] - 0.18] as SP), [0, 0.22 * s, 0.14 * s, 0], { n: 8 });
  }
  ctx.push(cu, t.base, { gf: { t: 'l', x1: 0, y1: H(0, f.my - 2.2)[1], x2: 0, y2: H(0, f.my)[1], s: [[0, mix(t.base, t.lock, 0.3)], [1, mix(t.base, t.root, 0.3)]] } });
  if (!lite) ctx.push(hl, t.sheen, { o: 0.55 });
}
