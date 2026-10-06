// Flores na mão (dono: pets): rosa vermelha, buquê e girassol. Espaço do objeto: origem na pegada, −y rumo ao cotovelo.
// Pétala com volume (base funda, borda enrolada com luz), haste com folhas de nervura, papel kraft com dobras e laço de
// cetim. Devolvem a parte que fica atrás dos dedos (a haste/o cone de papel).

import type { HeldDef } from './held';
import { mix, sparkles, tones, type Pen, type SP } from './pets-kit';

/** folha pontuda com nervura (base em x,y, ângulo em graus, comprimento e meia-largura) */
export function leaf(q: Pen, x: number, y: number, ang: number, len: number, w: number, color = '#3E8A3A'): void {
  const a = (ang * Math.PI) / 180;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  const nx = -uy;
  const ny = ux;
  const P = (t: number, o: number): SP => [x + ux * len * t + nx * o, y + uy * len * t + ny * o];
  const d = q.path([P(0, 0), P(0.3, w * 0.95), P(0.7, w * 0.7), [...P(1, 0), 0.2] as SP, P(0.7, -w * 0.7), P(0.3, -w * 0.95)]);
  const t = tones(color);
  q.fill(d, color, { gf: q.lg(P(0.5, w)[0], P(0.5, w)[1], P(0.5, -w)[0], P(0.5, -w)[1], [[0, t.light], [0.5, t.base], [1, t.shade]]) });
  if (!q.lite) q.line(q.path([P(0.02, 0), P(0.5, 0.05), P(0.92, 0)], false), t.lighter, 0.12, { o: 0.6, cp: d });
}

/** botão de rosa visto de cima-três-quartos (cx, cy, raio): pétalas em espiral com borda clara */
export function roseHead(q: Pen, cx: number, cy: number, r: number, color: string): void {
  const t = tones(color);
  const L = q.lite;
  const d = q.ell(cx, cy, r, r * 0.92);
  q.fill(d, color, { gf: q.rg(cx - r * 0.3, cy - r * 0.35, r * 1.3, [[0, t.light], [0.55, t.base], [1, t.deep]]) });
  if (L) {
    q.line(q.ell(cx + r * 0.05, cy - r * 0.05, r * 0.45, r * 0.4), t.deep, Math.max(0.15, r * 0.14), { o: 0.6 });
    return;
  }
  // espiral de pétalas: arcos claros por cima de arcos escuros
  let dk = '';
  let lt = '';
  for (let i = 0; i < 3; i++) {
    const rr = r * (0.3 + i * 0.22);
    const a0 = i * 1.9;
    const pts = (off: number): SP[] => {
      const out: SP[] = [];
      for (let k = 0; k <= 5; k++) {
        const a = a0 + (k / 5) * Math.PI * 1.15;
        out.push([cx + Math.cos(a) * rr + off, cy + Math.sin(a) * rr * 0.9 + off]);
      }
      return out;
    };
    dk += q.path(pts(0.08 * r), false);
    lt += q.path(pts(-0.06 * r), false);
  }
  q.line(dk, t.deep, r * 0.13, { o: 0.65, cp: d });
  q.line(lt, mix(t.lighter, '#FFFFFF', 0.25), r * 0.09, { o: 0.6, cp: d });
}

// ---------------------------------------------------------------------------------------------------------------

function rose(q: Pen): string {
  const L = q.lite;
  const G = tones('#3E7D3A');
  const R = tones('#D21A30');
  const stem = q.taper([[0.3, 5.6], [0.0, 1.0], [-0.3, -4.0], [-0.2, -9.0], [-0.5, -13.4]], [0.46, 0.44, 0.42, 0.4, 0.36], { n: 12 });
  q.fill(stem, G.base, { gf: q.lg(-0.6, 0, 0.6, 0, [[0, G.light], [0.5, G.base], [1, G.deep]]) });
  if (!L) q.fill(q.path([[-0.05, -6.6], [0.75, -7.2, 0], [0.1, -6.1]]) + q.path([[-0.55, -10.6], [-1.25, -11.2, 0], [-0.5, -10.1]]), G.shade);
  leaf(q, -0.25, -7.4, -150, 3.0, 1.0, '#3E8A3A');
  leaf(q, -0.3, -10.2, -32, 2.6, 0.9, '#46943F');
  // sépalas
  q.fill(q.path([[-0.5, -13.2], [-2.2, -13.0, 0], [-1.0, -13.9], [-0.4, -14.6, 0], [0.2, -13.9], [1.3, -13.1, 0]]), G.base);
  // flor: pétalas de trás, taça, abertura em espiral e pétala da frente enrolada
  const cx = -0.6;
  const cy = -15.9;
  q.fill(q.ell(cx - 1.45, cy - 0.4, 1.5, 1.85, -24) + q.ell(cx + 1.45, cy - 0.4, 1.5, 1.85, 24), R.deep, { gf: q.lg(cx, cy - 2, cx, cy + 1.5, [[0, R.shade], [1, R.deep]]) });
  const cup = q.path([[cx - 1.9, cy - 0.8], [cx - 1.2, cy + 1.9], [cx, cy + 2.5, 0.6], [cx + 1.2, cy + 1.9], [cx + 1.9, cy - 0.8], [cx + 0.6, cy - 1.6], [cx - 0.6, cy - 1.6]]);
  q.fill(cup, R.base, { gf: q.lg(cx - 1.6, cy - 1.6, cx + 1.2, cy + 2.4, [[0, R.light], [0.5, R.base], [1, R.deep]]) });
  const top = q.ell(cx, cy - 1.3, 1.65, 0.72);
  q.fill(top, R.shade, { gf: q.rg(cx + 0.2, cy - 1.2, 1.7, [[0, R.deep], [0.7, R.shade], [1, R.base]]) });
  if (!L) {
    q.line(q.path([[cx - 0.9, cy - 1.2], [cx - 0.2, cy - 1.75], [cx + 0.7, cy - 1.35], [cx + 0.3, cy - 0.9], [cx - 0.3, cy - 1.2]], false), R.lighter, 0.18, { o: 0.7, cp: top });
  }
  const front = q.path([[cx - 1.95, cy - 0.5], [cx - 0.5, cy + 0.3], [cx + 1.15, cy - 0.6], [cx + 0.8, cy + 1.5], [cx - 0.5, cy + 2.35, 0.6], [cx - 1.5, cy + 1.4]]);
  q.fill(front, R.base, { gf: q.lg(cx, cy - 0.6, cx, cy + 2.4, [[0, R.lighter], [0.25, R.light], [1, R.shade]]) });
  if (!L) {
    q.line(q.path([[cx - 1.85, cy - 0.45], [cx - 0.5, cy + 0.32], [cx + 1.1, cy - 0.55]], false), mix(R.lighter, '#FFFFFF', 0.4), 0.16, { o: 0.75 });
    q.fill(q.ell(cx + 0.9, cy + 0.9, 0.9, 1.4, 20), '#2A0008', { o: 0.25, b: 0.4, cp: cup });
  }
  return stem;
}

function bouquet(q: Pen): string {
  const L = q.lite;
  const K = tones('#C99A68');
  // folhas de eucalipto (atrás)
  for (const [x, y] of [
    [-4.2, -8.4],
    [4.0, -9.0],
    [-3.0, -11.6],
    [2.8, -12.2],
  ] as const) {
    q.fill(q.ell(x, y, 1.0, 0.8, 30), '#8DB59A', { gf: q.lg(x - 1, y - 1, x + 1, y + 1, [[0, '#B6D6BE'], [1, '#6E9A7E']]) });
  }
  // papel de dentro (mais escuro, aparece na boca)
  q.fill(q.path([[-4.6, -5.6], [-2.0, -7.6], [0.2, -6.8], [2.4, -7.8], [4.6, -5.4], [0, -3.6]]), K.shade);
  // flores
  roseHead(q, -0.6, -11.0, 1.35, '#F47FA6');
  roseHead(q, 2.0, -10.2, 1.4, '#F6C7D8');
  roseHead(q, -2.6, -8.6, 1.6, '#F2789F');
  roseHead(q, 2.8, -7.6, 1.5, '#FFB088');
  roseHead(q, 0.3, -8.4, 1.75, '#FFF3EE');
  if (!L) {
    // mosquitinho (pontinhos brancos) e brotos
    let d = '';
    for (const [x, y] of [
      [-3.9, -10.6],
      [-1.6, -12.6],
      [1.0, -12.6],
      [3.8, -9.6],
      [-4.4, -7.4],
      [1.4, -6.8],
      [4.6, -6.6],
    ] as const)
      d += q.ell(x, y, 0.32, 0.32) + q.ell(x + 0.5, y + 0.3, 0.25, 0.25);
    q.fill(d, '#FFFFFF', { o: 0.95 });
  }
  // cone de papel kraft com dobras
  const paper = q.path([[-0.9, 4.4], [0.9, 4.4], [4.8, -5.6], [2.4, -6.4, 0.4], [0.2, -5.4], [-2.2, -6.6, 0.4], [-4.8, -5.8]]);
  q.fill(paper, K.base, { gf: q.lg(-4, -6, 4, 4, [[0, K.lighter], [0.45, K.base], [1, K.shade]]) });
  if (!L) {
    q.line(q.path([[-0.4, 4.0], [-2.4, -5.8]], false) + q.path([[0.4, 4.0], [1.6, -5.4]], false), K.deep, 0.16, { o: 0.45, cp: paper });
    q.line(q.path([[-4.6, -5.7], [-2.2, -6.4], [0.2, -5.3], [2.4, -6.2], [4.6, -5.5]], false), K.lighter, 0.22, { o: 0.75 });
  }
  // laço de cetim magenta na pegada
  const rb = tones('#FF1493');
  const band = q.taper([[-1.9, -0.8], [0, -0.5], [1.9, -0.9]], [0.6, 0.7, 0.6], { round: true });
  q.fill(band, rb.base, { gf: q.lg(0, -1.3, 0, 0.2, [[0, rb.lighter], [1, rb.shade]]) });
  const bow = q.path([[0, -0.7], [-2.4, -2.2, 0.6], [-2.6, -0.4, 0.6]]) + q.path([[0, -0.7], [2.4, -2.0, 0.6], [2.5, -0.1, 0.6]]);
  q.fill(bow, rb.base, { gf: q.lg(-2.5, -2.2, 2.5, 0, [[0, rb.lighter], [0.5, rb.base], [1, rb.shade]]) });
  q.fill(q.taper([[-0.2, -0.4], [-1.0, 1.8], [-1.6, 3.4]], [0.5, 0.45, 0.3]) + q.taper([[0.2, -0.4], [1.0, 1.6], [1.5, 3.2]], [0.5, 0.45, 0.3]), rb.shade);
  q.fill(q.ell(0, -0.7, 0.55, 0.5), rb.light);
  return paper;
}

function sunflower(q: Pen): string {
  const L = q.lite;
  const G = tones('#4A8A34');
  const stem = q.taper([[0.2, 5.6], [0, 0], [0.1, -6], [-0.2, -11.6]], [0.58, 0.55, 0.5, 0.45], { n: 10 });
  q.fill(stem, G.base, { gf: q.lg(-0.6, 0, 0.6, 0, [[0, G.light], [0.5, G.base], [1, G.deep]]) });
  leaf(q, 0, -5.4, -160, 3.8, 1.5, '#4E9A3A');
  leaf(q, 0.1, -8.6, -20, 3.4, 1.3, '#56A240');
  // cabeça: duas coroas de pétalas e miolo com sementes em espiral
  const cx = -0.2;
  const cy = -15.0;
  const petals = (n: number, r0: number, r1: number, off: number, c0: string, c1: string) => {
    let d = '';
    for (let i = 0; i < n; i++) {
      const a = ((i + off) / n) * Math.PI * 2;
      const ux = Math.cos(a);
      const uy = Math.sin(a) * 0.9;
      const nx = -uy * 0.32;
      const ny = ux * 0.32;
      d += q.path([[cx + ux * r0, cy + uy * r0], [cx + ux * (r0 + r1) * 0.55 + nx, cy + uy * (r0 + r1) * 0.55 + ny], [cx + ux * r1, cy + uy * r1, 0.2], [cx + ux * (r0 + r1) * 0.55 - nx, cy + uy * (r0 + r1) * 0.55 - ny]]);
    }
    q.fill(d, c0, { gf: q.rg(cx, cy, r1, [[0, c1], [0.5, c1], [1, c0]]) });
  };
  petals(14, 1.6, 4.0, 0.5, '#E89A10', '#C9700A');
  petals(14, 1.6, 4.3, 0, '#FFD12E', '#F29A12');
  const disk = q.ell(cx, cy, 1.95, 1.8);
  q.fill(disk, '#4A2A12', { gf: q.rg(cx - 0.5, cy - 0.5, 2.2, [[0, '#7A4A1E'], [0.6, '#4A2A12'], [1, '#2A160A']]) });
  if (!L) {
    let d = '';
    for (let i = 0; i < 22; i++) {
      const a = i * 2.399;
      const rr = 0.32 * Math.sqrt(i + 0.5);
      d += q.ell(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.92, 0.16, 0.16);
    }
    q.fill(d, '#C08A3A', { o: 0.55, cp: disk });
    q.line(q.ell(cx, cy, 1.95, 1.8), '#2A160A', 0.25, { o: 0.6 });
    sparkles(q, [[cx - 2.6, cy - 2.6, 0.5]], '#FFFFFF', 0.6);
  }
  return stem;
}

export const HELD_FLORA: Record<string, HeldDef> = {
  rose: { draw: rose, rot: -18 },
  bouquet: { draw: bouquet, rot: -10, dy: 0.2 },
  sunflower: { draw: sunflower, rot: 6 },
};

