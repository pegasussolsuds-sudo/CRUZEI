// Quadrúpede sentado (cães, gatos, raposa espiritual) visto de três-quartos, virado pra esquerda da tela.
// Dono: pets. Um único desenho paramétrico com acabamento cuidado (volume em cada massa, pelo nas bordas, olhos com
// reflexo, focinho por planos) e variação por raça: tamanho, cabeça, focinho, orelha, cauda, pelagem e marcas.
//
// Espaço local: origem no chão entre as patas da frente, y pra baixo; o bicho "canônico" (k = 1) mede ~22 de altura
// (um gato adulto na escala do avatar). Ordem: cauda de trás → pé de trás de longe → tronco → pata da frente de longe →
// peito → pé de trás de perto → coxa → pata da frente de perto → cauda da frente → cabeça (orelhas, focinho, rosto).

import { shade } from '../geometry';

import {
  ballGrad,
  dogMouth,
  dogNose,
  furEdge,
  glow,
  luma,
  mix,
  petEye,
  petMouth,
  rim,
  solid,
  tones,
  tufts,
  whiskers,
  type Pen,
  type SP,
  type Tones,
} from './pets-kit';

export type EarKind = 'prick' | 'semi' | 'flop' | 'button' | 'tall';
export type TailKind = 'curl' | 'wrap' | 'pom' | 'brush' | 'spirit';
export type FurKind = 'short' | 'fluffy' | 'curly' | 'sleek';
export type Marking = 'tabby' | 'tux' | 'points' | 'mask' | 'husky' | 'blaze' | 'spirit';

export interface SitterSpec {
  /** escala geral (gato = 1) */
  k: number;
  /** cabeça relativa ao corpo (cão grande tem cabeça proporcionalmente menor) */
  head: number;
  /** comprimento do focinho: 0 (gato) .. 1 (cão); pug ~0.2 */
  muzzle: number;
  /** largura do tronco (1 = padrão) */
  bulk: number;
  /** altura das pernas da frente (1 = padrão) */
  legs: number;
  ear: EarKind;
  earSize: number;
  tail: TailKind;
  fur: FurKind;
  coat: string;
  /** peito, focinho, patas */
  belly: string;
  nose: string;
  iris: string;
  pupil: 'round' | 'slit';
  marks: Marking[];
  /** cor das marcas (listras, máscara, pontas) */
  markColor?: string;
  tongue?: boolean;
  /** olhos um pouco maiores */
  eyeK?: number;
  /** brilho próprio (fantasia) */
  aura?: string;
  /** coleira */
  collar?: string;
}

export type SitPose = 'side' | 'arms' | 'shoulder' | 'float';

/** altura total (topo da orelha) na escala 1 */
export function sitterHeight(sp: SitterSpec): number {
  const hk = sp.head;
  const ear = sp.ear === 'tall' ? 5.6 : sp.ear === 'prick' ? 4.2 : sp.ear === 'semi' ? 3.6 : 0.6;
  return (15.0 * sp.legs + 3.4 * hk + 4.6 * hk * 0.85 + ear * sp.earSize * hk * 0.8) * sp.k;
}

/** desenha o bicho sentado. No colo/ombro a cauda pende e os pés de trás somem */
export function drawSitter(pen: Pen, sp: SitterSpec, pose: SitPose = 'side'): void {
  const L = pen.lite;
  const q = pen.sub(0, 0, sp.k);
  const T: Tones = tones(sp.coat);
  const B: Tones = tones(sp.belly);
  const M: Tones = tones(sp.markColor ?? shade(sp.coat, -0.45));
  const fluffy = sp.fur === 'fluffy' || sp.fur === 'curly';
  const bulk = sp.bulk;
  const lg = sp.legs;
  const hk = sp.head;
  const cat = sp.pupil === 'slit';
  const sockTone = sp.marks.includes('tux') || sp.marks.includes('husky') ? B : sp.marks.includes('points') ? M : null;
  // ------------------------------------------------------------------ medidas canônicas
  const legTop = -10.2 * lg;
  const nb = legTop - 3.4 * lg; // base do pescoço (frente)
  const hcx = -1.2;
  const hcy = -15.0 * lg - 3.4 * hk; // centro da cabeça
  const hr = 4.6 * hk; // meia-largura da cabeça
  const showFeet = pose === 'side' || pose === 'float';

  if (sp.aura && !L) glow(q, 0.5, -11, 13, 12, sp.aura, 0.3);

  // ------------------------------------------------------------------ cauda de trás
  const tailBack = sp.tail === 'curl' || sp.tail === 'pom' || sp.tail === 'brush' || sp.tail === 'spirit';
  if (tailBack) drawTail(q, sp, T, M, 'back', pose);

  // ------------------------------------------------------------------ pé de trás de longe (espia à esquerda)
  if (showFeet) {
    const fp = q.path([[-7.0 * bulk, -0.25], [-7.3 * bulk, -1.3], [-6.0 * bulk, -2.2], [-3.6, -1.9], [-3.0, -0.3]]);
    q.fill(fp, T.shade, { gf: q.lg(-7, -2, -3, 0, [[0, T.base], [1, T.deep]]) });
  }

  // ------------------------------------------------------------------ tronco (peito projetado, costas descendo até a anca)
  const torsoPts: SP[] = [
    [-3.4 * bulk, nb],
    [-5.4 * bulk, nb + 3.4],
    [-5.9 * bulk, legTop + 3.4],
    [-5.0 * bulk, -3.4],
    [-3.4 * bulk, -0.5],
    [3.4 * bulk, -0.25],
    [7.6 * bulk, -1.6],
    [8.7 * bulk, -5.6],
    [7.5 * bulk, legTop + 1.6],
    [5.2 * bulk, legTop - 1.6],
    [2.6 * bulk, nb + 0.4],
  ];
  const torsoD = q.path(fluffy ? furEdge(torsoPts, 6, 9, 0.55, 3) : torsoPts);
  solid(q, torsoD, T, { cx: 1.6, cy: legTop * 0.5, r: 8.5 * bulk }, { core: 0.3, hl: 0.16 });

  // ------------------------------------------------------------------ pata da frente de longe
  const legW = 2.7 * Math.sqrt(bulk) * (cat ? 0.86 : 1);
  const legShape = (x: number, w: number, bottom: number): SP[] => [
    [x - w * 0.55, legTop - 0.8],
    [x + w * 0.2, legTop - 1.6],
    [x + w * 0.68, legTop + 0.4],
    [x + w * 0.5, legTop * 0.5],
    [x + w * 0.36, bottom - 3.0],
    [x + w * 0.62, bottom - 1.3],
    [x + w * 0.6, bottom, 0.5],
    [x - w * 0.66, bottom, 0.5],
    [x - w * 0.62, bottom - 1.4],
    [x - w * 0.4, bottom - 3.1],
    [x - w * 0.52, legTop * 0.45],
  ];
  const farLegD = q.path(legShape(-2.9, legW * 0.94, -0.35));
  q.fill(farLegD, T.shade, { gf: q.lg(-4.6, 0, -1.4, 0, [[0, T.base], [0.6, T.shade], [1, T.deep]]) });
  if (sockTone) q.fill(q.ell(-2.9, -1.4, 2.4, 2.8), sockTone.shade, { cp: farLegD });

  // ------------------------------------------------------------------ peito (babador claro)
  const bibPts: SP[] = [
    [-3.4 * bulk, nb + 0.6],
    [-0.4, nb - 0.8],
    [2.4 * bulk, nb + 1.0],
    [1.8, legTop + 2.6],
    [0.0, legTop + 5.8],
    [-2.4, legTop + 3.0],
  ];
  const bibD = q.path(furEdge(bibPts, 2, 5, fluffy ? 0.55 : 0.4, 3));
  if (sp.belly !== sp.coat) q.fill(bibD, B.base, { gf: q.lg(-2, nb - 1, 1, legTop + 5, [[0, B.lighter], [0.6, B.base], [1, B.shade]]), cp: torsoD });

  // ------------------------------------------------------------------ pé de trás de perto + coxa
  const hx = 5.0 * bulk;
  if (showFeet) {
    const footD = q.path([[hx + 3.7, -0.15], [hx + 3.4, -2.3], [hx + 0.8, -2.2], [hx - 1.6, -2.0], [hx - 2.6, -1.3], [hx - 2.6, -0.1]]);
    q.fill(footD, (sockTone ?? T).base, { gf: q.lg(hx - 2.6, -2.3, hx + 3, 0, [[0, (sockTone ?? T).light], [1, (sockTone ?? T).shade]]) });
    if (!L) q.line(q.path([[hx - 1.6, -1.6], [hx - 1.7, -0.2]], false), (sockTone ?? T).deep, 0.2, { o: 0.5 });
  }
  const thighPts: SP[] = [
    [hx - 3.4, -7.6],
    [hx - 0.6, -9.8],
    [hx + 2.6, -9.0],
    [hx + 4.1, -5.8],
    [hx + 3.7, -2.0],
    [hx + 1.6, -0.7],
    [hx - 2.2, -1.3],
    [hx - 4.4, -3.6],
  ];
  const thighD = q.path(fluffy ? furEdge(thighPts, 2, 5, 0.5, 2) : thighPts);
  // sombra que a coxa projeta no tronco
  if (!L) q.fill(q.ell(hx - 4.0, -4.6, 1.6, 4.0, 15), T.deep, { o: 0.3, b: 0.9, cp: torsoD });
  solid(q, thighD, T, { cx: hx - 0.2, cy: -5.4, r: 4.6 }, { core: 0.3, hl: 0.2 });
  // dobra da virilha (onde a coxa encontra a barriga) e o jarrete
  if (!L) {
    q.fill(q.taper([[hx - 3.6, -7.2], [hx - 4.4, -4.4], [hx - 3.0, -1.6]], [0.2, 0.55, 0.15]), T.deep, { o: 0.32, b: 0.25 });
    q.fill(q.ell(hx - 0.8, -7.2, 2.4, 1.1, -25), T.lighter, { o: 0.25, b: 0.6, cp: thighD });
  }

  // fios de pelo seguindo a forma (só no completo): coxa, costas e peito
  if (!L && sp.fur !== 'sleek') {
    const st: (readonly [number, number, number, number, number?])[] = [
      [hx + 2.6, -7.6, 125, 1.6, 0.32],
      [hx + 3.4, -5.2, 110, 1.6, 0.32],
      [hx + 1.0, -8.4, 140, 1.4, 0.3],
      [6.6 * bulk, legTop + 2.6, 115, 1.5, 0.3],
      [4.4 * bulk, legTop - 0.4, 130, 1.4, 0.3],
    ];
    tufts(q, st, T.deep, 0.32, torsoD + thighD);
    tufts(q, st.map(([x, y, a, l, w]) => [x - 0.5, y - 0.35, a, l * 0.8, w] as const), T.lighter, 0.3, torsoD + thighD);
  }

  // ------------------------------------------------------------------ pata da frente de perto
  const nearLegD = q.path(legShape(1.3, legW, 0));
  q.fill(nearLegD, T.base, { gf: q.lg(1.3 - legW * 0.6, 0, 1.3 + legW * 0.7, 0, [[0, T.light], [0.45, T.base], [1, T.shade]]) });
  if (sockTone) q.fill(q.ell(1.3, -1.2, 2.6, 2.9), sockTone.base, { cp: nearLegD, gf: q.lg(0, -3, 2.6, 0, [[0, sockTone.lighter], [1, sockTone.base]]) });
  if (!L) {
    // ombro com luz, sombra atrás do cotovelo, dedos da pata
    q.fill(q.ell(1.0, legTop + 0.4, legW * 0.45, 1.6), (sockTone && false) || T.lighter, { o: 0.22, b: 0.6, cp: nearLegD });
    const t = sockTone ?? T;
    q.line(q.path([[0.6, -1.4], [0.55, -0.1]], false) + q.path([[1.75, -1.4], [1.8, -0.1]], false), t.deep, 0.2, { o: 0.55 });
    q.line(q.path([[-1.95, -1.6], [-1.95, -0.45]], false), (sockTone ?? T).deep, 0.18, { o: 0.4 });
  }
  // sombra de contato entre as patas
  if (!L) q.fill(q.ell(-0.8, -0.5, 1.2, 0.6), '#000000', { o: 0.35, b: 0.4 });

  // ------------------------------------------------------------------ cauda da frente (gato: contornando as patas)
  if (!tailBack) drawTail(q, sp, T, M, 'front', pose);

  // ------------------------------------------------------------------ marcas no corpo
  if (sp.marks.includes('tabby') && !L) {
    let d = '';
    for (const [x, y, a, l] of [
      [8.3, -6.4, 196, 3.4],
      [7.7, -9.0, 204, 3.0],
      [8.2, -3.5, 188, 2.8],
      [5.6, -11.2, 230, 2.4],
      [2.6, -12.4, 250, 2.0],
    ] as const) {
      const r = (a * Math.PI) / 180;
      d += q.taper([[x, y], [x + Math.cos(r) * l * 0.5, y + Math.sin(r) * l * 0.5 + 0.25], [x + Math.cos(r) * l, y + Math.sin(r) * l]], [0.85, 0.7, 0]);
    }
    q.fill(d, M.base, { o: 0.5, cp: torsoD + thighD });
    q.fill(q.taper([[0.2, -6.6], [1.4, -6.1], [2.7, -6.7]], [0.45, 0.55, 0.3]) + q.taper([[0.3, -4.4], [1.4, -3.9], [2.6, -4.4]], [0.4, 0.5, 0.25]), M.base, { o: 0.45, cp: nearLegD });
  }
  if (sp.collar) {
    const cy = nb + 1.2;
    const cd = q.taper([[-4.4 * bulk, cy - 0.4], [-0.6, cy + 1.3], [2.8 * bulk, cy - 0.6]], [1.0, 1.15, 1.0], { round: true });
    q.fill(cd, sp.collar, { gf: q.lg(0, cy - 0.6, 0, cy + 1.8, [[0, shade(sp.collar, 0.3)], [1, shade(sp.collar, -0.25)]]) });
    q.fill(q.ell(-0.7, cy + 2.4, 0.85, 0.95), '#E8B23A', { gf: q.rg(-0.95, cy + 2.0, 1.2, [[0, '#FFF0B0'], [0.5, '#E8B23A'], [1, '#9A6A10']]) });
  }

  // ------------------------------------------------------------------ cabeça
  drawSitterHead(q, sp, T, B, M, hcx, hcy, hr);
}

function drawTail(q: Pen, sp: SitterSpec, T: Tones, M: Tones, layer: 'back' | 'front', pose: SitPose): void {
  const L = q.lite;
  const tipTone = sp.marks.includes('points') ? M : sp.marks.includes('husky') || sp.marks.includes('spirit') || sp.marks.includes('tux') ? tones(sp.belly) : T;
  if (layer === 'back') {
    if (sp.tail === 'curl') {
      // rabo enrolado por cima da anca
      const d = q.taper([[7.0, -7.0], [10.2, -8.6], [11.4, -12.0], [10.0, -14.6], [7.8, -13.8]], [2.3, 2.5, 2.2, 1.7, 0.7], { round: true });
      q.fill(d, T.base, { gf: q.lg(8, -15, 12, -8, [[0, T.light], [0.5, T.base], [1, T.shade]]) });
      if (!L) {
        q.fill(q.ell(9.6, -12.0, 1.0, 2.0, 20), T.deep, { o: 0.25, b: 0.6, cp: d });
      }
    } else if (sp.tail === 'pom') {
      const d = q.taper([[7.0, -6.6], [9.4, -9.2], [10.2, -12.0]], [1.3, 1.0, 0.8], { round: true });
      q.fill(d, T.base, { gf: q.lg(7, -12, 10, -6, [[0, T.light], [1, T.shade]]) });
      curlyBall(q, 10.4, -13.4, 2.6, T);
    } else {
      // cauda farta subindo pela direita (husky, raposa)
      const pts: SP[] = [
        [6.6, -2.8],
        [10.0, -3.8],
        [12.6, -8.0],
        [13.0, -13.0],
        [11.4, -17.2, 0.4],
        [10.2, -13.4],
        [9.4, -9.2],
        [6.4, -6.8],
      ];
      const d = q.path(furEdge(pts, 1, 4, 0.6, 3));
      if (sp.tail === 'spirit' && sp.aura) {
        // caudas extras translúcidas, abertas em leque atrás da principal
        for (const [a, o] of [
          [-22, 0.5],
          [18, 0.38],
        ] as const) {
          const t2 = q.sub(6.6, -3.0, 0.95, a);
          const d2 = t2.path(furEdge(pts.map((p) => [p[0] - 6.6, p[1] + 3.0] as SP), 1, 4, 0.6, 3));
          t2.fill(d2, T.light, { o, gf: t2.lg(6, -14, 0, 0, [[0, sp.aura], [0.5, T.lighter], [1, T.light]]) });
        }
      }
      q.fill(d, T.base, { gf: q.lg(13, -15, 7, -4, [[0, T.light], [0.6, T.base], [1, T.shade]]) });
      q.fill(q.ell(12.0, -15.2, 2.6, 3.4, 20), tipTone.base, { cp: d, o: 0.95, b: L ? 0 : 0.4 });
      if (sp.tail === 'spirit' && sp.aura && !L) q.fill(q.ell(12.0, -15.2, 3.4, 4.2, 20), sp.aura, { o: 0.5, b: 1.4 });
      if (!L) tufts(q, [[12.7, -10.8, -10, 1.2], [12.8, -7.6, 20, 1.1], [11.0, -4.8, 50, 1.0]], T.light, 0.6, d);
    }
    return;
  }
  // gato: no colo/ombro a cauda pende; no chão ela contorna as patas pela frente
  if (pose === 'arms' || pose === 'shoulder') {
    const d = q.taper([[6.4, -1.8], [8.0, 1.4], [7.4, 5.2], [8.4, 8.0]], [2.0, 1.85, 1.6, 1.1], { round: true });
    q.fill(d, T.base, { gf: q.lg(6, 0, 9, 8, [[0, T.base], [1, T.shade]]) });
    if (tipTone !== T) q.fill(q.ell(8.3, 7.6, 1.4, 1.6), tipTone.base, { cp: d });
    return;
  }
  const spine: SP[] = [[8.0, -1.6], [7.0, -0.1], [2.6, 0.35], [-2.4, 0.1], [-5.4, -0.9], [-6.4, -2.0]];
  const d = q.taper(spine, (t) => 2.1 - t * 0.7, { round: true, n: 12 });
  q.fill(d, T.base, { gf: q.lg(0, -1.8, 0, 1.0, [[0, T.light], [0.55, T.base], [1, T.shade]]) });
  if (!L) q.fill(q.taper(spine.slice(1, 5).map((p) => [p[0], p[1] - 0.5] as SP), [0, 0.5, 0.4, 0]), T.lighter, { o: 0.35, b: 0.2, cp: d });
  if (tipTone !== T) q.fill(q.ell(-5.8, -1.4, 1.5, 1.4), tipTone.base, { cp: d });
  if (sp.marks.includes('tabby') && !L) q.fill(q.taper([[3.6, -1.2], [3.4, 0.9]], [0.7, 0.4]) + q.taper([[0.4, -1.1], [0.2, 0.9]], [0.7, 0.4]) + q.taper([[-2.6, -1.1], [-2.8, 0.7]], [0.6, 0.35]), M.base, { o: 0.55, cp: d });
}

function curlyBall(q: Pen, cx: number, cy: number, r: number, T: Tones): void {
  const pts: SP[] = [];
  const n = 11;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (i % 2 ? 0.88 : 1.04);
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  const d = q.path(pts);
  q.fill(d, T.base, { gf: ballGrad(q, cx, cy, r, T) });
  curls(q, cx, cy, r, T, d);
}

/** textura de cachinhos (C) dentro de uma forma */
function curls(q: Pen, cx: number, cy: number, r: number, T: Tones, clip: string): void {
  if (q.lite) return;
  let dk = '';
  let lt = '';
  const pts: [number, number][] = [
    [-0.45, -0.45],
    [0.35, -0.25],
    [-0.15, 0.25],
    [0.5, 0.45],
    [-0.6, 0.55],
    [0.05, -0.75],
  ];
  for (const [dx, dy] of pts) {
    const x = cx + dx * r;
    const y = cy + dy * r;
    const c = Math.max(0.35, r * 0.18);
    dk += q.path([[x - c, y + c * 0.2], [x - c * 0.3, y + c * 0.9], [x + c * 0.8, y + c * 0.4]], false);
    lt += q.path([[x - c * 0.7, y - c * 0.4], [x, y - c * 0.9], [x + c * 0.8, y - c * 0.3]], false);
  }
  q.line(dk, T.deep, 0.28, { o: 0.4, cp: clip });
  q.line(lt, T.lighter, 0.26, { o: 0.55, cp: clip });
}

function drawEar(q: Pen, sp: SitterSpec, T: Tones, B: Tones, M: Tones, x: number, y: number, side: -1 | 1, hk: number): void {
  const s = sp.earSize * hk;
  const dark = sp.marks.includes('points') || sp.marks.includes('mask') ? M : T;
  const inner = tones(mix(sp.belly === sp.coat && luma(sp.coat) < 0.3 ? '#C98A90' : '#F2B3AE', sp.coat, 0.25));
  const L = q.lite;
  if (sp.ear === 'prick' || sp.ear === 'tall') {
    const hgt = (sp.ear === 'tall' ? 5.6 : 4.2) * s;
    const w = 2.35 * s;
    const pts: SP[] = [
      [x - w * 0.95 * side, y + 0.8],
      [x - w * 0.45 * side, y - hgt * 0.62],
      [x + w * 0.1 * side, y - hgt, 0.35],
      [x + w * 0.75 * side, y - hgt * 0.4],
      [x + w * 1.0 * side, y + 1.0],
    ];
    const d = q.path(pts);
    q.fill(d, dark.base, { gf: q.lg(x - w, y - hgt, x + w, y, [[0, dark.light], [1, dark.shade]]) });
    const ip: SP[] = [
      [x - w * 0.5 * side, y + 0.5],
      [x - w * 0.15 * side, y - hgt * 0.6],
      [x + w * 0.1 * side, y - hgt * 0.82, 0.35],
      [x + w * 0.48 * side, y - hgt * 0.32],
      [x + w * 0.58 * side, y + 0.6],
    ];
    q.fill(q.path(ip), inner.base, { gf: q.lg(x, y - hgt, x, y, [[0, inner.shade], [1, inner.base]]), o: 0.92 });
    if (!L) tufts(q, [[x - w * 0.15 * side, y + 0.2, -90 + 14 * side, hgt * 0.5, 0.42], [x + w * 0.25 * side, y + 0.3, -90 - 6 * side, hgt * 0.42, 0.36]], B.lighter, 0.7);
  } else if (sp.ear === 'semi') {
    // vira-lata: orelha em pé, arredondada, com a ponta tombando pra frente
    const hgt = 3.6 * s;
    const w = 2.3 * s;
    const base: SP[] = [
      [x - w * 0.9 * side, y + 1.0],
      [x - w * 0.62 * side, y - hgt * 0.62],
      [x - w * 0.05 * side, y - hgt * 0.98, 0.7],
      [x + w * 0.62 * side, y - hgt * 0.62],
      [x + w * 0.95 * side, y + 1.1],
    ];
    const d = q.path(base);
    q.fill(d, T.base, { gf: q.lg(x - w, y - hgt, x + w, y, [[0, T.light], [1, T.shade]]) });
    q.fill(q.path([[x - w * 0.45 * side, y + 0.6], [x - w * 0.3 * side, y - hgt * 0.45], [x + w * 0.35 * side, y - hgt * 0.42], [x + w * 0.5 * side, y + 0.6]]), inner.shade, { o: 0.7 });
    // ponta tombada (aba que cai pra frente cobrindo a parte de cima)
    const fold = q.path([[x - w * 0.66 * side, y - hgt * 0.55], [x - w * 0.05 * side, y - hgt * 1.0, 0.7], [x + w * 0.66 * side, y - hgt * 0.56], [x + w * 0.35 * side, y - hgt * 0.12], [x - w * 0.1 * side, y - hgt * 0.02, 0.5], [x - w * 0.42 * side, y - hgt * 0.22]]);
    if (!L) q.fill(q.ell(x, y - hgt * 0.05, w * 0.7, 0.7), '#000000', { o: 0.35, b: 0.35, cp: d });
    q.fill(fold, T.base, { gf: q.lg(x - w * 0.3, y - hgt, x + w * 0.3, y - hgt * 0.1, [[0, T.lighter], [0.5, T.light], [1, T.base]]) });
  } else if (sp.ear === 'flop') {
    // orelha caída ao lado do rosto (poodle, cão pretinho)
    const hgt = 5.2 * s;
    const w = 2.0 * s;
    const pts: SP[] = [
      [x - w * 0.3 * side, y - 0.7],
      [x + w * 0.85 * side, y - 0.4],
      [x + w * 1.25 * side, y + hgt * 0.55],
      [x + w * 0.85 * side, y + hgt],
      [x + w * 0.0 * side, y + hgt * 0.86],
      [x - w * 0.45 * side, y + hgt * 0.3],
    ];
    const d = q.path(sp.fur === 'curly' ? furEdge(pts, 1, 5, 0.55, 2) : pts);
    q.fill(d, dark.base, { gf: q.lg(x, y, x + w * side, y + hgt, [[0, dark.light], [0.5, dark.base], [1, dark.shade]]) });
    if (!L) q.fill(q.ell(x + w * 0.2 * side, y + 0.3, w * 0.9, 0.9), dark.deep, { o: 0.4, b: 0.5, cp: d });
    if (sp.fur === 'curly') curls(q, x + w * 0.5 * side, y + hgt * 0.5, hgt * 0.4, dark, d);
    else rim(q, d, [[x + w * 0.9 * side, y], [x + w * 1.2 * side, y + hgt * 0.5]], '#FFFFFF', 0.25, 0.5);
  } else {
    // botão (pug): dobradinha pra frente
    const w = 2.0 * s;
    const d = q.path([
      [x - w * 0.8 * side, y + 0.5],
      [x - w * 0.2 * side, y - 1.5 * s],
      [x + w * 0.95 * side, y - 1.0 * s],
      [x + w * 1.25 * side, y + 1.0 * s],
      [x + w * 0.4 * side, y + 1.5 * s],
    ]);
    q.fill(d, dark.base, { gf: q.lg(x, y - 1.5, x, y + 1.4, [[0, dark.light], [1, dark.shade]]) });
    if (!L) q.line(q.path([[x - w * 0.4 * side, y + 0.2], [x + w * 0.4 * side, y - 0.55], [x + w * 1.0 * side, y + 0.5]], false), dark.deep, 0.3, { o: 0.6 });
  }
}

function drawSitterHead(q: Pen, sp: SitterSpec, T: Tones, B: Tones, M: Tones, hcx: number, hcy: number, hr: number): void {
  const L = q.lite;
  const hk = sp.head;
  const mz = sp.muzzle;
  const fluffy = sp.fur === 'fluffy' || sp.fur === 'curly';
  const cat = sp.pupil === 'slit';
  // orelhas de pé ficam atrás do crânio; as caídas, na frente
  const earY = hcy - hr * (cat ? 0.6 : 0.66);
  const flop = sp.ear === 'flop';
  const earL: [number, number] = [hcx - hr * (flop ? 0.78 : cat ? 0.6 : 0.5), earY + (flop ? hr * 0.18 : 0)];
  const earR: [number, number] = [hcx + hr * (flop ? 0.8 : cat ? 0.66 : 0.56), earY - 0.15 + (flop ? hr * 0.18 : 0)];
  if (!flop) {
    drawEar(q, sp, T, B, M, earL[0], earL[1], -1, hk);
    drawEar(q, sp, T, B, M, earR[0], earR[1], 1, hk);
  }
  // crânio + bochechas (gato: bochechas largas embaixo; cão: crânio redondo)
  const cw = hr * (cat ? 1.08 : 0.98);
  const ch = hr * (cat ? 0.9 : 0.98);
  const headPts: SP[] = cat
    ? [
        [hcx - cw * 1.0, hcy + ch * 0.2],
        [hcx - cw * 0.86, hcy - ch * 0.55],
        [hcx - cw * 0.25, hcy - ch * 0.95],
        [hcx + cw * 0.45, hcy - ch * 0.92],
        [hcx + cw * 0.95, hcy - ch * 0.45],
        [hcx + cw * 1.06, hcy + ch * 0.32],
        [hcx + cw * 0.7, hcy + ch * 0.86],
        [hcx - cw * 0.15, hcy + ch * 1.02],
        [hcx - cw * 0.82, hcy + ch * 0.78],
      ]
    : [
        [hcx - cw * 0.96, hcy + ch * 0.12],
        [hcx - cw * 0.82, hcy - ch * 0.62],
        [hcx - cw * 0.2, hcy - ch * 1.0],
        [hcx + cw * 0.52, hcy - ch * 0.9],
        [hcx + cw * 0.98, hcy - ch * 0.35],
        [hcx + cw * 1.0, hcy + ch * 0.38],
        [hcx + cw * 0.62, hcy + ch * 0.88],
        [hcx - cw * 0.12, hcy + ch * 1.0],
        [hcx - cw * 0.74, hcy + ch * 0.78],
      ];
  const headD = q.path(fluffy ? furEdge(headPts, 5, 9, 0.5, 2) : cat && sp.fur !== 'sleek' ? furEdge(headPts, 5, 6, 0.38, 1) : headPts);
  solid(q, headD, T, { cx: hcx, cy: hcy, r: hr }, { core: 0.24, hl: 0.22 });
  // marcas da cabeça (antes do focinho)
  if (sp.marks.includes('tabby') && !L) {
    const mY = hcy - ch * 0.62;
    const d =
      q.taper([[hcx - 1.0, mY + 0.1], [hcx - 0.75, mY + 1.6]], [0.45, 0.18]) +
      q.taper([[hcx + 0.1, mY - 0.25], [hcx + 0.05, mY + 1.75]], [0.5, 0.18]) +
      q.taper([[hcx + 1.2, mY + 0.05], [hcx + 0.95, mY + 1.5]], [0.45, 0.18]) +
      q.taper([[hcx + cw * 1.0, hcy + 0.3], [hcx + cw * 0.55, hcy + 0.55]], [0.5, 0.12]) +
      q.taper([[hcx + cw * 0.98, hcy + 1.3], [hcx + cw * 0.58, hcy + 1.3]], [0.42, 0.1]) +
      q.taper([[hcx - cw * 0.98, hcy + 0.5], [hcx - cw * 0.62, hcy + 0.7]], [0.42, 0.1]);
    q.fill(d, M.base, { o: 0.6, cp: headD });
  }
  if (sp.marks.includes('husky') || sp.marks.includes('spirit')) {
    // máscara clara: bochechas, focinho e pinta na sobrancelha
    const d = q.path([[hcx - cw * 1.0, hcy + ch * 0.15], [hcx - cw * 0.55, hcy - ch * 0.05], [hcx - 0.2, hcy - ch * 0.62, 0.3], [hcx + 0.4, hcy - ch * 0.05], [hcx + cw * 1.0, hcy + ch * 0.22], [hcx + cw * 0.5, hcy + ch * 1.1], [hcx - cw * 0.6, hcy + ch * 1.0]]);
    q.fill(d, B.base, { cp: headD, gf: q.lg(hcx, hcy - hr, hcx, hcy + hr, [[0, B.lighter], [1, B.base]]), o: sp.marks.includes('spirit') ? 0.7 : 1 });
    if (sp.marks.includes('husky')) q.fill(q.ell(hcx - cw * 0.52, hcy - ch * 0.46, 0.75, 0.5) + q.ell(hcx + cw * 0.24, hcy - ch * 0.48, 0.65, 0.45), B.lighter, { o: 0.95 });
    if (sp.marks.includes('spirit') && sp.markColor && !L) {
      // marcas de espírito: traços curvos na testa e nas bochechas
      q.fill(q.taper([[hcx - 0.4, hcy - ch * 0.9], [hcx - 0.2, hcy - ch * 0.6], [hcx - 0.5, hcy - ch * 0.35]], [0.2, 0.55, 0.1]) + q.taper([[hcx + cw * 0.95, hcy + 0.1], [hcx + cw * 0.6, hcy + 0.45]], [0.4, 0.1]) + q.taper([[hcx - cw * 0.95, hcy + 0.2], [hcx - cw * 0.65, hcy + 0.5]], [0.4, 0.1]), sp.markColor, { o: 0.85 });
    }
  }
  if (sp.marks.includes('tux') || sp.marks.includes('blaze')) {
    // focinho e peito claros, risca no meio da testa
    const narrow = sp.marks.includes('blaze');
    const d = narrow
      ? q.path([[hcx - 0.6, hcy - ch * 0.75, 0.3], [hcx - 0.05, hcy - ch * 0.1], [hcx + cw * 0.15, hcy + ch * 0.4], [hcx - cw * 0.55, hcy + ch * 0.45], [hcx - 1.0, hcy - ch * 0.1]])
      : q.path([[hcx - 0.6, hcy - ch * 0.6, 0.3], [hcx + 0.3, hcy - ch * 0.1], [hcx + cw * 0.78, hcy + ch * 0.45], [hcx + 0.2, hcy + ch * 1.05], [hcx - cw * 0.88, hcy + ch * 0.55], [hcx - 1.25, hcy - ch * 0.05]]);
    q.fill(d, B.base, { cp: headD, o: narrow ? 0.55 : 1, gf: q.lg(hcx, hcy - hr, hcx, hcy + hr, [[0, B.light], [1, B.base]]) });
  }
  // sombra do "stop" (entre os olhos, acima do focinho) e luz no arco das sobrancelhas
  if (!L && !cat) {
    q.fill(q.ell(hcx - hr * 0.3, hcy - ch * 0.02, hr * 0.28, hr * 0.42, -10), T.deep, { o: 0.22, b: hr * 0.12, cp: headD });
  }
  // focinho (cão): projetado pra frente-esquerda, com plano de cima iluminado
  const mzx = hcx - hr * (0.3 + mz * 0.14);
  const mzy = hcy + hr * (0.36 + mz * 0.1);
  const mzrx = hr * (0.42 + mz * 0.2);
  const mzry = hr * (0.33 + mz * 0.1);
  const muzzleTone = sp.marks.includes('mask') || sp.marks.includes('points') ? M : sp.belly !== sp.coat && !sp.marks.includes('blaze') ? B : T;
  let muzzleD = '';
  if (mz > 0.05) {
    muzzleD = q.path([
      [mzx - mzrx * 1.0, mzy - mzry * 0.15],
      [mzx - mzrx * 0.6, mzy - mzry * 0.95],
      [mzx + mzrx * 0.55, mzy - mzry * 1.0],
      [mzx + mzrx * 1.08, mzy - mzry * 0.1],
      [mzx + mzrx * 0.72, mzy + mzry * 0.92],
      [mzx - mzrx * 0.55, mzy + mzry * 0.95],
    ]);
    // o focinho nasce do rosto: base na cor da pelagem e a máscara clara por cima, com borda macia
    q.fill(muzzleD, T.base, { gf: ballGrad(q, mzx, mzy, mzrx, T, { hot: 0.45 }) });
    if (muzzleTone !== T) q.fill(q.ell(mzx - mzrx * 0.05, mzy + mzry * 0.1, mzrx * 0.98, mzry * 0.95), muzzleTone.base, { cp: muzzleD, b: L ? 0 : mzrx * 0.18, gf: ballGrad(q, mzx, mzy, mzrx, muzzleTone, { hot: 0.4 }) });
    if (!L) {
      q.fill(q.ell(mzx - mzrx * 0.2, mzy - mzry * 0.55, mzrx * 0.7, mzry * 0.32, -5), muzzleTone.lighter, { o: 0.4, b: mzry * 0.2, cp: muzzleD });
      q.fill(q.ell(mzx + mzrx * 0.45, mzy + mzry * 0.8, mzrx * 0.8, mzry * 0.5), muzzleTone.deep, { o: 0.32, b: 0.5, cp: muzzleD });
    }
    if (sp.marks.includes('mask') && !L) q.fill(q.ell(mzx + 0.1, mzy - mzry * 0.6, mzrx * 1.5, mzry * 1.4), M.base, { o: 0.4, b: 0.9, cp: headD });
    // rugas do pug
    if (mz < 0.4 && !L) q.line(q.path([[mzx - mzrx * 0.9, mzy - mzry * 0.95], [mzx, mzy - mzry * 1.3], [mzx + mzrx * 0.9, mzy - mzry * 1.0]], false), M.deep, 0.35, { o: 0.55 });
  } else {
    // gato: almofadinhas do bigode
    const wd = q.ell(hcx - hr * 0.42, hcy + hr * 0.44, hr * 0.33, hr * 0.25) + q.ell(hcx + hr * 0.06, hcy + hr * 0.44, hr * 0.35, hr * 0.26);
    q.fill(wd, muzzleTone === T ? T.light : muzzleTone.base, { o: 0.9, b: L ? 0 : 0.2 });
  }
  if (sp.marks.includes('points')) {
    // máscara escura do siamês no centro do rosto
    q.fill(q.ell(hcx - hr * 0.18, hcy + hr * 0.3, hr * 0.72, hr * 0.62), M.base, { o: 0.88, b: L ? 0 : hr * 0.2, cp: headD });
  }
  // olhos
  const eyeK = sp.eyeK ?? 1;
  const er = hr * (cat ? 0.2 : 0.155) * eyeK;
  const ey = hcy - hr * (cat ? 0.1 : 0.17);
  const exL = hcx - hr * (cat ? 0.58 : 0.6);
  const exR = hcx + hr * (cat ? 0.14 : 0.12);
  const eo = cat ? { iris: sp.iris, pupil: 'slit' as const, open: 0.84, pupilR: 0.6 } : { iris: sp.iris, pupil: 'round' as const, open: 0.94, pupilR: 0.54 };
  // órbita: sombra macia em volta do olho (dá profundidade)
  if (!L) q.fill(q.ell(exL, ey + er * 0.1, er * 1.6, er * 1.35) + q.ell(exR, ey + er * 0.1, er * 1.7, er * 1.4), T.deep, { o: 0.16, b: er * 0.5, cp: headD });
  petEye(q, exL, ey, er * 0.92, { ...eo, tilt: cat ? 12 : 6, look: [-0.14, 0.06], glow: sp.aura });
  petEye(q, exR, ey - 0.05, er, { ...eo, tilt: cat ? -12 : -6, look: [-0.14, 0.06], glow: sp.aura });
  if (!L && !cat) q.fill(q.ell(exL + 0.1, ey - er * 1.8, er * 0.95, er * 0.38, -12) + q.ell(exR - 0.1, ey - er * 1.85, er * 1.0, er * 0.4, 12), sp.marks.includes('husky') ? B.lighter : T.lighter, { o: 0.35, b: 0.25 });
  // nariz e boca
  if (mz > 0.05) {
    const nx = mzx - mzrx * 0.28;
    const ny = mzy - mzry * 0.42;
    dogNose(q, nx, ny, mzrx * 0.44, sp.nose);
    const mouthY = ny + mzrx * 0.62;
    dogMouth(q, nx + 0.05, mouthY, mzrx * 0.5, shade(muzzleTone.base, -0.62), !!sp.tongue);
  } else {
    const nx = hcx - hr * 0.18;
    const ny = hcy + hr * 0.25;
    q.fill(q.path([[nx - 0.6, ny - 0.32], [nx + 0.6, ny - 0.32], [nx, ny + 0.4, 0.4]]), sp.nose, { gf: q.lg(nx, ny - 0.3, nx, ny + 0.4, [[0, shade(sp.nose, 0.25)], [1, shade(sp.nose, -0.2)]]) });
    petMouth(q, nx, ny + 1.0, 0.75, shade(muzzleTone === T ? T.base : muzzleTone.base, -0.55), { smile: 0.6, philtrum: 0.6, width: 0.2 });
    whiskers(q, nx, ny + 0.65, hr * 1.05, luma(sp.coat) < 0.3 || sp.marks.includes('points') ? '#D8D8E4' : '#FFFFFF', 0.5);
  }
  // pelo do rosto
  if (fluffy && !L) {
    const fc = sp.marks.includes('husky') || sp.marks.includes('spirit') ? B.base : T.base;
    tufts(q, [[hcx - cw * 0.92, hcy + ch * 0.55, 125, 1.0, 0.6], [hcx + cw * 0.95, hcy + ch * 0.6, 55, 1.0, 0.6], [hcx - cw * 0.55, hcy + ch * 0.95, 105, 0.9, 0.55], [hcx + cw * 0.5, hcy + ch * 1.0, 75, 0.9, 0.55]], fc, 0.95);
  }
  rim(q, headD, [[hcx - cw * 0.9, hcy + ch * 0.25], [hcx - cw * 0.72, hcy - ch * 0.6], [hcx, hcy - ch * 0.98]], luma(sp.coat) < 0.16 ? '#B8C2DC' : '#FFFFFF', 0.24, 0.6);
  // orelhas caídas por cima
  if (flop) {
    drawEar(q, sp, T, B, M, earL[0], earL[1], -1, hk);
    drawEar(q, sp, T, B, M, earR[0], earR[1], 1, hk);
  }
  if (sp.fur === 'curly') curlyBall(q, hcx - 0.1, hcy - ch * 1.0, hr * 0.55, T);
  void muzzleD;
}
