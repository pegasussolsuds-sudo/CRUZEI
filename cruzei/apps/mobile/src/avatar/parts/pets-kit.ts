// Kit de desenho dos pets e objetos na mão (dono: pets): uma "caneta" com transformação própria (posição, escala,
// giro e espelho) por cima do LayerCtx, olhos/nariz/boca de bicho, pelo, pena e escama, sombra de chão e brilho.
//
// Cada bicho é desenhado UMA vez num espaço local (unidades do avatar na escala 1; origem no ponto de apoio — o chão
// entre as patas da frente, o poleiro do pássaro — e y pra baixo, como no SVG). A caneta leva o espaço local pro
// viewBox do avatar; posição, escala e espelho por pose ficam em pets.ts.
//
// Regras (STYLE.md): luz de cima-esquerda, gradiente discreto, sombra própria recortada (cp) e desfocada, brilho de
// borda fino, contorno raro. No 'lite' (mapa/miniatura) o detalhe fino some: use `pen.lite`.

import { smoothPath, taperPath, type SP } from '../anatomy';
import type { LayerCtx } from '../ctx';
import { fmt, shade } from '../geometry';
import { isLite, mix } from '../shading';
import type { AvatarGradient, AvatarLayer, AvatarStop, Pt } from '../types';

export { mix, shade, smoothPath, taperPath, type SP };

/** caneta: desenha no espaço local de um bicho/objeto */
export interface Pen {
  readonly ctx: LayerCtx;
  readonly lite: boolean;
  /** escala local → avatar */
  readonly s: number;
  /** espelhado (x local invertido) */
  readonly flip: boolean;
  /** giro total (graus, horário) do espaço local em relação à tela */
  readonly rot: number;
  /** ponto local → avatar */
  p(x: number, y: number): Pt;
  /** path suave pelos pontos locais (3º valor = suavidade do ponto, 0 = quina) */
  path(pts: readonly SP[], closed?: boolean, sm?: number): string;
  /** polígono reto */
  poly(pts: readonly SP[]): string;
  /** elipse (rot em graus, no espaço local) */
  ell(cx: number, cy: number, rx: number, ry: number, rot?: number): string;
  /** traço afilado como forma (larguras locais) */
  taper(spine: readonly SP[], w: readonly number[] | ((t: number) => number), opts?: { n?: number; round?: boolean }): string;
  /** gradiente linear local */
  lg(x1: number, y1: number, x2: number, y2: number, s: readonly AvatarStop[]): AvatarGradient;
  /** gradiente radial local (foco opcional) */
  rg(cx: number, cy: number, r: number, s: readonly AvatarStop[], fx?: number, fy?: number): AvatarGradient;
  /** preenchimento (b, da e w do `extra` em unidades locais) */
  fill(d: string, f: string, extra?: Partial<AvatarLayer>): AvatarLayer;
  /** traço (largura local) */
  line(d: string, s: string, w: number, extra?: Partial<AvatarLayer>): AvatarLayer;
  /** sub-caneta: mais uma transformação local (posição, escala, giro em graus) */
  sub(x: number, y: number, s?: number, rot?: number): Pen;
}

/** caneta em (ox, oy) com escala `s`, giro `rot` (graus, horário) e espelho horizontal */
export function makePen(ctx: LayerCtx, ox: number, oy: number, s = 1, rot = 0, flip = false): Pen {
  const c = Math.cos((rot * Math.PI) / 180);
  const sn = Math.sin((rot * Math.PI) / 180);
  const fx = flip ? -1 : 1;
  const P = (x: number, y: number): Pt => {
    const lx = x * fx;
    return [ox + s * (lx * c - y * sn), oy + s * (lx * sn + y * c)];
  };
  const SPm = (q: SP): SP => {
    const [x, y] = P(q[0], q[1]);
    return q.length > 2 ? [x, y, q[2] as number] : [x, y];
  };
  const scaleExtra = (e?: Partial<AvatarLayer>): Partial<AvatarLayer> | undefined => {
    if (!e) return e;
    const o: Partial<AvatarLayer> = { ...e };
    if (o.b != null) o.b = o.b * s;
    if (o.da) o.da = o.da.map((v) => v * s);
    if (o.w != null) o.w = o.w * s;
    return o;
  };
  const pen: Pen = {
    ctx,
    lite: isLite(ctx),
    s,
    flip,
    rot,
    p: P,
    path: (pts, closed = true, sm = 1) => smoothPath(pts.map(SPm), closed, sm),
    poly: (pts) => pts.map((q, i) => `${i ? 'L' : 'M'}${fmt(P(q[0], q[1])[0])},${fmt(P(q[0], q[1])[1])}`).join('') + 'Z',
    ell: (cx, cy, rx, ry, r = 0) => {
      const a = (r * Math.PI) / 180;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const pts: SP[] = [];
      for (let i = 0; i < 8; i++) {
        const t = (i / 8) * Math.PI * 2;
        const x = Math.cos(t) * rx;
        const y = Math.sin(t) * ry;
        pts.push(SPm([cx + x * ca - y * sa, cy + x * sa + y * ca]));
      }
      return smoothPath(pts, true);
    },
    taper: (spine, w, opts) => taperPath(spine.map(SPm), typeof w === 'function' ? (t: number) => w(t) * s : w.map((v) => v * s), opts),
    lg: (x1, y1, x2, y2, st) => {
      const a = P(x1, y1);
      const b = P(x2, y2);
      return { t: 'l', x1: a[0], y1: a[1], x2: b[0], y2: b[1], s: st };
    },
    rg: (cx, cy, r, st, gfx, gfy) => {
      const a = P(cx, cy);
      const g: AvatarGradient = { t: 'r', cx: a[0], cy: a[1], r: r * s, s: st };
      if (gfx != null && gfy != null) {
        const f = P(gfx, gfy);
        g.fx = f[0];
        g.fy = f[1];
      }
      return g;
    },
    fill: (d, f, extra) => ctx.push(d, f, scaleExtra(extra)),
    line: (d, st, w, extra) => ctx.stroke(d, st, w * s, scaleExtra(extra)),
    sub: (x, y, s2 = 1, r2 = 0) => {
      const [nx, ny] = P(x, y);
      return makePen(ctx, nx, ny, s * s2, rot + (flip ? -r2 : r2), flip);
    },
  };
  return pen;
}

/**
 * direção local que aponta pra (dx, dy) na TELA, desfazendo o giro e o espelho da caneta: pra luz de cima-esquerda
 * continuar vindo de cima-esquerda num objeto girado (ex.: microfone de cabeça pra baixo)
 */
export function screenDir(q: Pen, dx: number, dy: number): [number, number] {
  const a = (-q.rot * Math.PI) / 180;
  const x = dx * Math.cos(a) - dy * Math.sin(a);
  const y = dx * Math.sin(a) + dy * Math.cos(a);
  return [q.flip ? -x : x, y];
}

// ---------------------------------------------------------------------------------------------------------------
// Cor
// ---------------------------------------------------------------------------------------------------------------

/** tons de um material a partir da cor base */
export interface Tones {
  base: string;
  light: string;
  lighter: string;
  shade: string;
  deep: string;
}

export function tones(base: string, k = 1): Tones {
  // pelagem escura: a luz vira um brilho frio acetinado (somar % de preto não clareia nada)
  if (luma(base) < 0.16) {
    return {
      base,
      light: mix(base, '#6E7690', 0.22 * k),
      lighter: mix(base, '#A9B2CC', 0.38 * k),
      shade: mix(base, '#000000', 0.25 * k),
      deep: mix(base, '#000000', 0.5 * k),
    };
  }
  return {
    base,
    light: shade(base, 0.16 * k),
    lighter: shade(base, 0.36 * k),
    shade: shade(base, -0.2 * k),
    deep: shade(base, -0.42 * k),
  };
}

/** brilho percebido 0..1 */
export function luma(hex: string): number {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const n = parseInt(v, 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

/** gradiente de volume de uma forma redonda (luz de cima-esquerda) */
export function ballGrad(pen: Pen, cx: number, cy: number, r: number, t: Tones, o: { hot?: number } = {}): AvatarGradient {
  const hot = o.hot ?? 0.55;
  return pen.rg(cx - r * 0.3, cy - r * 0.38, r * 1.25, [
    [0, mix(t.light, t.lighter, hot)],
    [0.45, t.base],
    [0.85, t.shade],
    [1, mix(t.shade, t.deep, 0.4)],
  ]);
}

/** gradiente vertical (luz em cima) */
export function downGrad(pen: Pen, x: number, y1: number, y2: number, t: Tones): AvatarGradient {
  return pen.lg(x - (y2 - y1) * 0.25, y1, x + (y2 - y1) * 0.25, y2, [
    [0, t.light],
    [0.5, t.base],
    [1, t.shade],
  ]);
}

// ---------------------------------------------------------------------------------------------------------------
// Volume
// ---------------------------------------------------------------------------------------------------------------

/**
 * forma com volume: base em gradiente, sombra própria embaixo-direita (recortada e desfocada), luz de cima-esquerda
 * (recortada). `r` = tamanho típico da forma (pra desfoque e deslocamento).
 */
export function solid(pen: Pen, d: string, t: Tones, box: { cx: number; cy: number; r: number }, o: { grad?: AvatarGradient; core?: number; hl?: number; extra?: Partial<AvatarLayer> } = {}): void {
  const { cx, cy, r } = box;
  pen.fill(d, t.base, { gf: o.grad ?? ballGrad(pen, cx, cy, r, t), ...o.extra });
  if (pen.lite) return;
  const core = o.core ?? 0.32;
  if (core > 0) pen.fill(pen.ell(cx + r * 0.55, cy + r * 0.6, r * 0.95, r * 0.75, -20), t.deep, { o: core, b: r * 0.28, cp: d });
  const hl = o.hl ?? 0.22;
  if (hl > 0) pen.fill(pen.ell(cx - r * 0.42, cy - r * 0.5, r * 0.5, r * 0.32, -25), t.lighter, { o: hl, b: r * 0.22, cp: d });
}

/** sombra de chão macia (elipse desfocada) */
export function groundShadow(pen: Pen, cx: number, cy: number, rx: number, ry: number, o = 0.35): void {
  pen.fill(pen.ell(cx, cy, rx, ry), '#05030A', { o, b: Math.max(0.5, ry * 0.7) });
}

/** brilho de borda fino do lado da luz (traço recortado na forma) */
export function rim(pen: Pen, d: string, spine: readonly SP[], color = '#FFFFFF', o = 0.28, w = 0.7): void {
  if (pen.lite) return;
  pen.line(pen.path(spine, false), color, w, { o, b: w * 0.5, cp: d });
}

/** tufos de pelo: traços afilados curtos (uma camada por cor). itens = [x, y, ângulo°, comprimento, largura?] */
export function tufts(pen: Pen, items: readonly (readonly [number, number, number, number, number?])[], color: string, o = 0.5, cp?: string): void {
  if (pen.lite || !items.length) return;
  let d = '';
  for (const [x, y, ang, len, w] of items) {
    const a = (ang * Math.PI) / 180;
    const ex = x + Math.cos(a) * len;
    const ey = y + Math.sin(a) * len;
    const mx = x + Math.cos(a) * len * 0.5 + Math.cos(a + Math.PI / 2) * len * 0.12;
    const my = y + Math.sin(a) * len * 0.5 + Math.sin(a + Math.PI / 2) * len * 0.12;
    d += pen.taper([[x, y], [mx, my], [ex, ey]], [w ?? 0.5, (w ?? 0.5) * 0.7, 0], { n: 5 });
  }
  pen.fill(d, color, { o, cp });
}

/** contorno com franja de pelo: insere bicos (tufos) ao longo de um trecho do contorno */
export function furEdge(pts: readonly SP[], from: number, to: number, amp: number, n: number): SP[] {
  const out: SP[] = [];
  for (let i = 0; i < pts.length; i++) {
    out.push(pts[i]);
    if (i >= from && i < to) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const L = Math.hypot(dx, dy) || 1;
      // normal pra fora (contorno horário na tela: (dy, -dx) aponta pra fora)
      const nx = dy / L;
      const ny = -dx / L;
      for (let k = 1; k <= n; k++) {
        const t = k / (n + 1);
        const bump = k % 2 === 1 ? amp : amp * 0.25;
        out.push([a[0] + dx * t + nx * bump, a[1] + dy * t + ny * bump, k % 2 === 1 ? 0.35 : 1]);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Rosto de bicho
// ---------------------------------------------------------------------------------------------------------------

export interface EyeOpts {
  /** cor da íris */
  iris: string;
  /** 'round' (cão, pássaro), 'slit' (gato, dragão), 'none' (olho todo escuro) */
  pupil?: 'round' | 'slit' | 'none';
  /** quanto da pupila (0..1 do raio da íris) */
  pupilR?: number;
  /** abertura vertical (1 = redondo) */
  open?: number;
  /** inclinação do olho (graus) */
  tilt?: number;
  /** olhar: deslocamento da íris (fração do raio) */
  look?: readonly [number, number];
  /** cor do aro (pálpebra escura) */
  rim?: string;
  /** brilho próprio (fantasia) */
  glow?: string;
  /** esclera visível (gente/robô); padrão: a íris ocupa o olho todo */
  sclera?: string;
}

/** olho de bicho: aro escuro, íris com luz entrando por baixo, pupila, sombra da pálpebra e dois reflexos */
export function petEye(pen: Pen, cx: number, cy: number, r: number, o: EyeOpts): void {
  const open = o.open ?? 1;
  const tilt = o.tilt ?? 0;
  const lx = (o.look?.[0] ?? 0) * r;
  const ly = (o.look?.[1] ?? 0) * r;
  const rimC = o.rim ?? '#1A0F0A';
  const eye = pen.ell(cx, cy, r, r * open, tilt);
  if (o.glow && !pen.lite) pen.fill(pen.ell(cx, cy, r * 2.1, r * 1.9 * open, tilt), o.glow, { o: 0.35, b: r * 0.8 });
  // aro (pálpebra) um pouco maior que o olho
  pen.fill(pen.ell(cx, cy, r * 1.16, r * open * 1.16 + r * 0.04, tilt), rimC, { o: 0.92 });
  if (o.sclera) pen.fill(eye, o.sclera);
  const ir = o.sclera ? r * 0.72 : r;
  const irisD = o.sclera ? pen.ell(cx + lx, cy + ly, ir, ir * Math.min(1, open * 1.1), tilt) : eye;
  const t = tones(o.iris);
  pen.fill(irisD, o.iris, {
    gf: pen.rg(cx + lx, cy + ly + ir * 0.35, ir * 1.15, [
      [0, mix(t.lighter, '#FFFFFF', 0.15)],
      [0.45, t.base],
      [0.85, t.shade],
      [1, mix(t.deep, rimC, 0.4)],
    ]),
    cp: o.sclera ? eye : undefined,
  });
  const pup = o.pupil ?? 'round';
  const pr = (o.pupilR ?? 0.5) * ir;
  if (pup === 'round') pen.fill(pen.ell(cx + lx * 1.1, cy + ly * 1.1, pr, pr * Math.min(1, open * 1.05), tilt), '#0B0706', { cp: eye });
  else if (pup === 'slit') pen.fill(pen.ell(cx + lx * 1.1, cy + ly * 1.1, pr * 0.32, ir * 0.82 * open, tilt), '#0B0706', { cp: eye });
  else pen.fill(pen.ell(cx + lx, cy + ly, ir * 0.85, ir * 0.85 * open, tilt), '#0B0706', { o: 0.85, cp: eye });
  // sombra da pálpebra de cima no olho
  if (!pen.lite) pen.fill(pen.ell(cx, cy - r * open * 0.95, r * 1.2, r * 0.55, tilt), '#000000', { o: 0.35, b: r * 0.25, cp: eye });
  // reflexos: grande em cima-esquerda, pequeno embaixo-direita
  pen.fill(pen.ell(cx - r * 0.32 + lx * 0.3, cy - r * 0.34 * open, r * 0.3, r * 0.26, -20), '#FFFFFF', { o: 0.95 });
  if (!pen.lite) pen.fill(pen.ell(cx + r * 0.38, cy + r * 0.36 * open, r * 0.13, r * 0.1), '#FFFFFF', { o: 0.75 });
}

/** olho fechado/sorrindo (arco) */
export function happyEye(pen: Pen, cx: number, cy: number, r: number, color = '#1A0F0A'): void {
  pen.fill(pen.taper([[cx - r, cy + r * 0.2], [cx, cy - r * 0.45], [cx + r, cy + r * 0.2]], [0.2 * r, 0.45 * r, 0.2 * r], { round: true }), color);
}

/** focinho de cão: nariz em trapézio arredondado com narinas e brilho */
export function dogNose(pen: Pen, cx: number, cy: number, w: number, color = '#1C1412'): void {
  const h = w * 0.7;
  const d = pen.path([
    [cx - w, cy - h * 0.45],
    [cx, cy - h * 0.62],
    [cx + w, cy - h * 0.45],
    [cx + w * 0.55, cy + h * 0.25],
    [cx, cy + h * 0.5],
    [cx - w * 0.55, cy + h * 0.25],
  ]);
  const t = tones(color);
  pen.fill(d, color, { gf: pen.rg(cx - w * 0.3, cy - h * 0.4, w * 1.5, [[0, t.lighter], [0.5, color], [1, t.deep]]) });
  if (pen.lite) return;
  pen.fill(pen.ell(cx - w * 0.45, cy + h * 0.02, w * 0.22, w * 0.13, 25) + pen.ell(cx + w * 0.45, cy + h * 0.02, w * 0.22, w * 0.13, -25), '#000000', { o: 0.7 });
  pen.fill(pen.ell(cx - w * 0.25, cy - h * 0.38, w * 0.38, w * 0.14, -8), '#FFFFFF', { o: 0.55, b: w * 0.05 });
}

/** boca em "w" com filtro (linha do nariz pra boca) */
export function petMouth(pen: Pen, cx: number, cy: number, w: number, color: string, o: { smile?: number; philtrum?: number; width?: number } = {}): void {
  const sm = o.smile ?? 0.35;
  const ph = o.philtrum ?? w * 0.6;
  const lw = o.width ?? Math.max(0.22, w * 0.14);
  const d =
    pen.path([[cx, cy - ph], [cx, cy]], false) +
    pen.path([[cx - w, cy - w * sm * 0.4], [cx - w * 0.5, cy + w * sm * 0.6], [cx, cy]], false) +
    pen.path([[cx, cy], [cx + w * 0.5, cy + w * sm * 0.6], [cx + w, cy - w * sm * 0.4]], false);
  pen.line(d, color, lw, { o: 0.85 });
}

/**
 * boca de cão sorrindo: filtro curto, lábio de cima em dois arcos subindo nos cantos e, aberta, a boca escura com a
 * língua pendendo (cão feliz)
 */
export function dogMouth(pen: Pen, cx: number, cy: number, w: number, lip: string, open: boolean): void {
  const ph = w * 0.42;
  if (open) {
    const md = pen.path([[cx - w * 0.92, cy - w * 0.1], [cx - w * 0.45, cy + w * 0.12], [cx, cy + w * 0.05], [cx + w * 0.45, cy + w * 0.12], [cx + w * 0.92, cy - w * 0.1], [cx + w * 0.5, cy + w * 0.62], [cx, cy + w * 0.8], [cx - w * 0.5, cy + w * 0.62]]);
    pen.fill(md, '#4A1A20', { gf: pen.lg(cx, cy, cx, cy + w * 0.8, [[0, '#2A0C10'], [1, '#6A2630']]) });
    const tw = w * 0.5;
    const tg = pen.path([[cx - tw, cy + w * 0.3], [cx - tw * 0.95, cy + w * 0.95], [cx, cy + w * 1.25], [cx + tw * 0.95, cy + w * 0.95], [cx + tw, cy + w * 0.3], [cx, cy + w * 0.18]]);
    pen.fill(tg, '#E46A7A', { gf: pen.lg(cx, cy + w * 0.2, cx, cy + w * 1.25, [[0, '#B8434F'], [0.4, '#E46A7A'], [1, '#F293A0']]) });
    if (!pen.lite) {
      pen.line(pen.path([[cx, cy + w * 0.4], [cx, cy + w * 0.95]], false), '#B03848', w * 0.08, { o: 0.55 });
      pen.fill(pen.ell(cx - tw * 0.35, cy + w * 0.75, tw * 0.25, w * 0.12, -20), '#FFFFFF', { o: 0.35, b: w * 0.04 });
    }
  }
  const lw = Math.max(0.2, w * 0.13);
  const d =
    pen.path([[cx, cy - ph], [cx, cy + w * 0.04]], false) +
    pen.path([[cx - w * 1.0, cy - w * 0.22], [cx - w * 0.55, cy + w * 0.18], [cx, cy + w * 0.04]], false) +
    pen.path([[cx, cy + w * 0.04], [cx + w * 0.55, cy + w * 0.18], [cx + w * 1.0, cy - w * 0.22]], false);
  pen.line(d, lip, lw, { o: 0.9 });
}

/** língua pra fora (cão feliz) */
export function tongue(pen: Pen, cx: number, cy: number, w: number, h: number): void {
  const d = pen.path([[cx - w, cy], [cx - w * 0.9, cy + h * 0.7], [cx, cy + h], [cx + w * 0.9, cy + h * 0.7], [cx + w, cy]]);
  pen.fill(d, '#E46A7A', { gf: pen.lg(cx, cy, cx, cy + h, [[0, '#B8434F'], [0.35, '#E46A7A'], [1, '#F08C98']]) });
  if (!pen.lite) pen.line(pen.path([[cx, cy + h * 0.15], [cx, cy + h * 0.7]], false), '#B03848', w * 0.16, { o: 0.6 });
}

/** bigodes finos (gato, coelho) — um traço por lado com 3 fios */
export function whiskers(pen: Pen, cx: number, cy: number, len: number, color = '#FFFFFF', o = 0.55): void {
  if (pen.lite) return;
  let d = '';
  for (const sg of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const y0 = cy + (i - 1) * len * 0.12;
      d += pen.path([[cx + sg * len * 0.18, y0], [cx + sg * len * 0.6, y0 - len * 0.04 + i * len * 0.05], [cx + sg * len, y0 + (i - 1) * len * 0.16]], false);
    }
  }
  pen.line(d, color, 0.14, { o });
}

// ---------------------------------------------------------------------------------------------------------------
// Efeitos
// ---------------------------------------------------------------------------------------------------------------

/** brilho mágico (halo desfocado) */
export function glow(pen: Pen, cx: number, cy: number, rx: number, ry: number, color: string, o = 0.4): void {
  pen.fill(pen.ell(cx, cy, rx, ry), color, { o: pen.lite ? o * 0.7 : o, b: Math.max(rx, ry) * 0.45 });
}

/** cintilas de 4 pontas (uma camada) */
export function sparkles(pen: Pen, items: readonly (readonly [number, number, number])[], color = '#FFFFFF', o = 0.9): void {
  if (!items.length) return;
  let d = '';
  for (const [x, y, r] of items) {
    const q = r * 0.22;
    d += pen.path([[x, y - r, 0], [x + q, y - q], [x + r, y, 0], [x + q, y + q], [x, y + r, 0], [x - q, y + q], [x - r, y, 0], [x - q, y - q]]);
  }
  pen.fill(d, color, { o });
}

/** arco simples (escama, pena, platinela): path aberto */
export function arc(pen: Pen, cx: number, cy: number, r: number, a0: number, a1: number, n = 6): string {
  const pts: SP[] = [];
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pen.path(pts, false);
}

// ---------------------------------------------------------------------------------------------------------------
// Materiais (objetos na mão)
// ---------------------------------------------------------------------------------------------------------------

/** cilindro em pé (luz da esquerda): borda escura, faixa clara a ~30%, miolo na cor, borda direita funda */
export function cylX(pen: Pen, x0: number, x1: number, y: number, t: Tones, spec = false): AvatarGradient {
  return pen.lg(x0, y, x1, y, [
    [0, t.shade],
    [0.2, t.light],
    [0.32, spec ? t.lighter : t.light],
    [0.6, t.base],
    [1, t.deep],
  ]);
}

/** metal polido: faixas de reflexo do ambiente alternando claro e escuro */
export function metalX(pen: Pen, x0: number, x1: number, y: number, base: string): AvatarGradient {
  const t = tones(base);
  return pen.lg(x0, y, x1, y, [
    [0, t.shade],
    [0.16, t.lighter],
    [0.28, t.light],
    [0.5, t.deep],
    [0.68, t.light],
    [0.84, t.base],
    [1, t.deep],
  ]);
}

/** vidro: corpo quase transparente com tinta, faixa de reflexo vertical e borda clara (d = forma, caixa x0..x1, y0..y1) */
export function glassy(pen: Pen, d: string, x0: number, x1: number, y0: number, y1: number, tint = '#CFEFFF', o = 0.22): void {
  pen.fill(d, tint, { o, gf: pen.lg(x0, y0, x1, y0, [[0, '#FFFFFF'], [0.3, tint], [0.75, tint], [1, '#FFFFFF']]) });
  if (pen.lite) return;
  const w = x1 - x0;
  pen.fill(pen.path([[x0 + w * 0.16, y0 + 0.4], [x0 + w * 0.3, y0 + 0.4], [x0 + w * 0.26, y1 - 0.6], [x0 + w * 0.14, y1 - 0.8]]), '#FFFFFF', { o: 0.55, cp: d });
  pen.fill(pen.path([[x1 - w * 0.16, y0 + 1.0], [x1 - w * 0.1, y0 + 1.0], [x1 - w * 0.1, y1 - 1.6], [x1 - w * 0.15, y1 - 1.8]]), '#FFFFFF', { o: 0.3, cp: d });
}
