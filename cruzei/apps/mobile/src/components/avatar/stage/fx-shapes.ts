// Formas prontas dos efeitos (coração, faísca, estrela, pétala, notas, floco, folha, pinheiro…). Dono: efeitos.
// Todas unitárias e centradas na origem (cabem em ~[-1,1]), em comandos da caneta (fx-core: 0 M · 1 L · 2 Q · 3 C · 4 Z),
// sempre no sentido horário (subpaths sobrepostos somam no preenchimento nonzero). Montadas UMA vez no carregamento
// (JS); o worklet recebe a tabela pronta e o Skia guarda o SkPath em cache por chave.

import { ovalCmds } from './fx-core';

/** 'd' simples (só M L Q C Z absolutos, separados por espaço/vírgula) → comandos (bandeiras de flags.ts usam M C Z) */
export function svgCmds(d: string): number[] {
  return cmds(d);
}

function cmds(d: string): number[] {
  const out: number[] = [];
  const re = /([MLQCZ])([^MLQCZ]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) {
    const op = m[1];
    const nums = m[2]
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (op === 'M') out.push(0, nums[0], nums[1]);
    else if (op === 'L') for (let i = 0; i + 1 < nums.length; i += 2) out.push(1, nums[i], nums[i + 1]);
    else if (op === 'Q') out.push(2, nums[0], nums[1], nums[2], nums[3]);
    else if (op === 'C') out.push(3, nums[0], nums[1], nums[2], nums[3], nums[4], nums[5]);
    else out.push(4);
  }
  return out;
}

/** gira/escala/desloca comandos (JS, na montagem) */
function xf(c: number[], tx: number, ty: number, deg: number, sx = 1, sy = 1): number[] {
  const a = (deg * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const out: number[] = [];
  let i = 0;
  const pt = (x: number, y: number) => {
    const X = x * sx;
    const Y = y * sy;
    out.push(X * ca - Y * sa + tx, X * sa + Y * ca + ty);
  };
  while (i < c.length) {
    const op = c[i];
    out.push(op);
    const n = op === 0 || op === 1 ? 1 : op === 2 ? 2 : op === 3 ? 3 : 0;
    for (let k = 0; k < n; k++) pt(c[i + 1 + k * 2], c[i + 2 + k * 2]);
    i += 1 + n * 2;
  }
  return out;
}

function starCmds(points: number, inner: number, rot = -90): number[] {
  const out: number[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : 1;
    const a = ((rot + (i * 180) / points) * Math.PI) / 180;
    out.push(i ? 1 : 0, Math.cos(a) * r, Math.sin(a) * r);
  }
  out.push(4);
  return out;
}

/** estrela de 5 pontas com pontas levemente arredondadas */
function roundStar(): number[] {
  const out: number[] = [];
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.47 : 1;
    const a = ((-90 + i * 36) * Math.PI) / 180;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  for (let i = 0; i < 10; i++) {
    const p = pts[i];
    if (i % 2 === 0) {
      // ponta: entra um pouco antes e sai um pouco depois, com quadrática no vértice
      const prev = pts[(i + 9) % 10];
      const next = pts[(i + 1) % 10];
      const k = 0.16;
      const a: [number, number] = [p[0] + (prev[0] - p[0]) * k, p[1] + (prev[1] - p[1]) * k];
      const b: [number, number] = [p[0] + (next[0] - p[0]) * k, p[1] + (next[1] - p[1]) * k];
      out.push(i ? 1 : 0, a[0], a[1], 2, p[0], p[1], b[0], b[1]);
    } else {
      out.push(1, p[0], p[1]);
    }
  }
  out.push(4);
  return out;
}

function flakeCmds(): number[] {
  // floco de 6 braços com ramos (pra traço)
  const out: number[] = [];
  for (let i = 0; i < 6; i++) {
    const a = ((i * 60 - 90) * Math.PI) / 180;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    out.push(0, 0, 0, 1, ca, sa);
    for (const [d, l] of [
      [0.42, 0.3],
      [0.7, 0.22],
    ]) {
      const bx = ca * d;
      const by = sa * d;
      for (const s of [-1, 1]) {
        const b = a + (s * 50 * Math.PI) / 180;
        out.push(0, bx, by, 1, bx + Math.cos(b) * l, by + Math.sin(b) * l);
      }
    }
  }
  return out;
}

const HEART = cmds('M0,0.92 C-0.18,0.76 -1,0.3 -1,-0.28 C-1,-0.74 -0.64,-1 -0.31,-1 C-0.13,-1 -0.02,-0.9 0,-0.72 C0.02,-0.9 0.13,-1 0.31,-1 C0.64,-1 1,-0.74 1,-0.28 C1,0.3 0.18,0.76 0,0.92 Z');

/** nota de colcheia: cabeça oval inclinada + haste + bandeirola */
function noteCmds(): number[] {
  const head = xf(ovalCmds(0, 0, 0.36, 0.25), -0.28, 0.66, -22);
  const stem = cmds('M0.02,0.64 L0.02,-0.98 L0.13,-0.98 L0.13,0.64 Z');
  const flag = cmds('M0.13,-0.98 C0.2,-0.66 0.62,-0.58 0.56,-0.12 C0.52,-0.36 0.34,-0.5 0.13,-0.52 Z');
  return [...head, ...stem, ...flag];
}

/** duas colcheias ligadas */
function notes2Cmds(): number[] {
  const h1 = xf(ovalCmds(0, 0, 0.3, 0.21), -0.62, 0.72, -22);
  const h2 = xf(ovalCmds(0, 0, 0.3, 0.21), 0.42, 0.52, -22);
  const s1 = cmds('M-0.38,0.7 L-0.38,-0.62 L-0.29,-0.62 L-0.29,0.7 Z');
  const s2 = cmds('M0.66,0.5 L0.66,-0.86 L0.75,-0.86 L0.75,0.5 Z');
  const beam = cmds('M-0.38,-0.62 L0.75,-0.86 L0.75,-0.66 L-0.38,-0.42 Z');
  return [...h1, ...h2, ...s1, ...s2, ...beam];
}

function flowerCmds(): number[] {
  const out: number[] = [];
  for (let i = 0; i < 5; i++) out.push(...xf(ovalCmds(0, -0.52, 0.34, 0.5), 0, 0, i * 72));
  return out;
}

export const SHAPES: Record<string, number[]> = {
  heart: HEART,
  sparkle: cmds('M0,-1 Q0.1,-0.1 1,0 Q0.1,0.1 0,1 Q-0.1,0.1 -1,0 Q-0.1,-0.1 0,-1 Z'),
  /** faísca de 4 pontas mais fina (brilho de estrela) */
  glint: cmds('M0,-1 Q0.05,-0.05 1,0 Q0.05,0.05 0,1 Q-0.05,0.05 -1,0 Q-0.05,-0.05 0,-1 Z'),
  star5: roundStar(),
  star5sharp: starCmds(5, 0.42),
  petal: cmds('M0,-0.8 L0.15,-1 C0.5,-0.93 0.68,-0.32 0.46,0.24 C0.31,0.66 0.13,0.95 0,1 C-0.13,0.95 -0.31,0.66 -0.46,0.24 C-0.68,-0.32 -0.5,-0.93 -0.15,-1 Z'),
  leaf: cmds('M0,-1 C0.56,-0.62 0.58,0.46 0,1 C-0.58,0.46 -0.56,-0.62 0,-1 Z'),
  note: noteCmds(),
  notes2: notes2Cmds(),
  flake: flakeCmds(),
  diamond: cmds('M0,-1 L0.62,0 L0,1 L-0.62,0 Z'),
  pine: cmds('M0,-1 L0.36,-0.46 L0.2,-0.46 L0.56,0.12 L0.34,0.12 L0.78,0.8 L0.1,0.8 L0.1,1 L-0.1,1 L-0.1,0.8 L-0.78,0.8 L-0.34,0.12 L-0.56,0.12 L-0.2,-0.46 L-0.36,-0.46 Z'),
  flower: flowerCmds(),
  /** fatia de pizza fina (raio de sol), da origem pra cima */
  ray: cmds('M-0.05,0 L-0.5,-1 Q0,-1.06 0.5,-1 L0.05,0 Z'),
  /** gota (chama, brilho caindo), ponta pra cima */
  drop: cmds('M0,-1 C0.3,-0.5 0.62,-0.05 0.62,0.36 C0.62,0.76 0.32,1 0,1 C-0.32,1 -0.62,0.76 -0.62,0.36 C-0.62,-0.05 -0.3,-0.5 0,-1 Z'),
};

/** chaves das formas (pros testes) */
export const SHAPE_KEYS = Object.keys(SHAPES);
