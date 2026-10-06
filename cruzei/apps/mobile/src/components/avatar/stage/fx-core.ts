// Núcleo dos efeitos do avatar (auras e fundos). Dono: efeitos.
//
// A ideia: cada efeito é escrito UMA vez contra uma "caneta" (Pen) pequena — círculo, oval, path, brilho suave, anel
// colorido, recorte — e a mesma descrição vira:
//   - Skia (skiaPen, em fx-skia.ts): o palco grava uma SkPicture por quadro na thread de UI (useDerivedValue + createPicture), e a
//     folha de prova roda o MESMO código no CanvasKit em node;
//   - SVG (svgPen, em fx-svg.ts): a versão estática das listas/miniaturas (<CruzeiAvatar/>), com menos partículas.
//
// Regras (valem pra todo arquivo fx-*):
//   - toda função que roda no quadro começa com 'worklet' e é definida ANTES de quem a chama (o plugin de worklets
//     captura as funções chamadas no momento da definição);
//   - nada de Math.random: aleatoriedade = hash com semente fixa (rnd), então o mesmo t desenha o mesmo quadro;
//   - cores são números 0xRRGGBB e a opacidade vai à parte (contas de tinta sem parse de string);
//   - nada de desfoque por quadro (MaskFilter é caro na GPU): brilho = gradiente radial unitário em cache.


/** cor 0xRRGGBB */
export type Rgb = number;
/** parada de gradiente: [posição 0..1, cor, opacidade] */
export type FxStop = [number, Rgb, number];

export type FxGrad = { t: 'l'; x1: number; y1: number; x2: number; y2: number; s: FxStop[] } | { t: 'r'; cx: number; cy: number; r: number; s: FxStop[] };

/** tinta de um desenho: w presente = traço; b = mistura (0 normal, 1 aditiva, 2 tela) */
export interface FxPaint {
  c?: Rgb;
  a?: number;
  g?: FxGrad;
  w?: number;
  b?: number;
  /** ponta do traço: 0 redonda (padrão), 1 reta */
  cap?: number;
  /** preenchimento evenodd (anel com furo) */
  eo?: boolean;
}

/** caneta: o mínimo que os efeitos precisam, igual no Skia e no SVG */
export interface Pen {
  /** versão leve (SVG estático das listas): os efeitos desenham menos detalhe */
  readonly lite: boolean;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  /** graus, horário na tela */
  rotate(deg: number): void;
  scale(sx: number, sy: number): void;
  circle(cx: number, cy: number, r: number, p: FxPaint): void;
  oval(cx: number, cy: number, rx: number, ry: number, p: FxPaint): void;
  rect(x: number, y: number, w: number, h: number, p: FxPaint): void;
  rrect(x: number, y: number, w: number, h: number, r: number, p: FxPaint): void;
  /** path em comandos: 0 M x y · 1 L x y · 2 Q cx cy x y · 3 C c1x c1y c2x c2y x y · 4 Z */
  path(cmds: number[], p: FxPaint): void;
  /** forma pronta de fx-shapes (unitária, centrada na origem) em (x,y), tamanho, rotação (graus) e achatamento */
  shape(key: string, x: number, y: number, size: number, rot: number, p: FxPaint, sx?: number, sy?: number): void;
  /** brilho suave redondo (gradiente radial que some na borda) */
  glow(cx: number, cy: number, r: number, c: Rgb, a: number, b?: number): void;
  /** brilho suave oval */
  glowOval(cx: number, cy: number, rx: number, ry: number, c: Rgb, a: number, b?: number): void;
  /** anel oval com as cores girando (gradiente de varredura); a0/sweep em graus recortam um arco */
  ring(cx: number, cy: number, rx: number, ry: number, w: number, colors: Rgb[], rot: number, a: number, a0?: number, sweep?: number, b?: number): void;
  clipRRect(x: number, y: number, w: number, h: number, r: number): void;
  clipOval(cx: number, cy: number, rx: number, ry: number): void;
}

// ---------------------------------------------------------------------------------------------------------------
// matemática (worklets)
// ---------------------------------------------------------------------------------------------------------------
export const TAU = Math.PI * 2;

export function clamp01(x: number): number {
  'worklet';
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function fract(x: number): number {
  'worklet';
  return x - Math.floor(x);
}

export function smooth(e0: number, e1: number, x: number): number {
  'worklet';
  const k = clamp01((x - e0) / (e1 - e0));
  return k * k * (3 - 2 * k);
}

export function mixN(a: number, b: number, k: number): number {
  'worklet';
  return a + (b - a) * k;
}

/** hash inteiro → 0..1 (determinístico, igual em toda thread) */
export function hash(n: number): number {
  'worklet';
  let x = Math.imul((n | 0) ^ 0x2545f491, 0x9e3779b1);
  x ^= x >>> 15;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** aleatório fixo da partícula i com a semente k */
export function rnd(i: number, k: number): number {
  'worklet';
  return hash(i * 7919 + k * 104729 + 17);
}

/** ruído 1D suave (valor), 0..1 */
export function noise1(x: number, seed: number): number {
  'worklet';
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return mixN(rnd(i, seed), rnd(i + 1, seed), u);
}

/** vida de uma partícula que renasce a cada `period` s: progresso 0..1 e o ciclo (pra sortear a nova posição) */
export function life(t: number, period: number, phase: number): [number, number] {
  'worklet';
  const x = t / period + phase;
  const c = Math.floor(x);
  return [x - c, c];
}

// ---------------------------------------------------------------------------------------------------------------
// cor (worklets)
// ---------------------------------------------------------------------------------------------------------------
export function mixRgb(a: Rgb, b: Rgb, k: number): Rgb {
  'worklet';
  const kk = clamp01(k);
  const r = Math.round(((a >> 16) & 255) + ((((b >> 16) & 255) - ((a >> 16) & 255)) * kk));
  const g = Math.round(((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * kk));
  const bl = Math.round((a & 255) + (((b & 255) - (a & 255)) * kk));
  return (r << 16) | (g << 8) | bl;
}

export function lighten(c: Rgb, k: number): Rgb {
  'worklet';
  return mixRgb(c, 0xffffff, k);
}

export function darken(c: Rgb, k: number): Rgb {
  'worklet';
  return mixRgb(c, 0x000000, k);
}

/** '#RRGGBB' / '#RGB' → número (JS) */
export function hexRgb(hex: string | null | undefined, fallback: Rgb): Rgb {
  'worklet';
  if (!hex || hex[0] !== '#') return fallback;
  let h = hex.slice(1);
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length < 6) return fallback;
  const n = parseInt(h.slice(0, 6), 16);
  return Number.isFinite(n) ? n : fallback;
}

export function rgbHex(c: Rgb): string {
  'worklet';
  const s = (c & 0xffffff).toString(16);
  return '#' + '000000'.slice(s.length) + s;
}

function hsl(c: Rgb): [number, number, number] {
  const r = ((c >> 16) & 255) / 255;
  const g = ((c >> 8) & 255) / 255;
  const b = (c & 255) / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6;
  return [h, s, l];
}

function fromHsl(h: number, s: number, l: number): Rgb {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return (f(0) << 16) | (f(8) << 8) | f(4);
}

/**
 * Tinta de uma paleta inteira mantendo a estrutura (JS, roda uma vez por visual): cada cor ganha o matiz da tinta
 * (espalhando 30% da distância de matiz original em volta da principal, pra não virar monocromático), a saturação
 * proporcional e a luz original puxada pra luz da tinta nos tons médios. Branco continua branco, sombra continua sombra.
 */
export function retint(c: Rgb, main: Rgb, tint: Rgb): Rgb {
  const [h0, s0, l0] = hsl(c);
  const [hm, sm, lm] = hsl(main);
  const [ht, st, lt] = hsl(tint);
  let dh = h0 - hm;
  if (dh > 0.5) dh -= 1;
  if (dh < -0.5) dh += 1;
  const h = (((ht + dh * 0.3) % 1) + 1) % 1;
  const s = Math.max(0, Math.min(1, s0 * (sm > 0.05 ? st / sm : st)));
  const mid = 1 - Math.min(1, Math.abs(l0 - 0.5) * 2);
  const l = Math.max(0, Math.min(1, l0 + (lt - lm) * mid * 0.8));
  return fromHsl(h, s, l);
}

/** cor de uma lista cíclica no ponto f (0..1, dá a volta) */
export function sampleCycle(colors: Rgb[], f: number): Rgb {
  'worklet';
  const n = colors.length;
  if (n === 0) return 0xffffff;
  if (n === 1) return colors[0];
  const x = fract(f) * n;
  const i = Math.floor(x);
  return mixRgb(colors[i % n], colors[(i + 1) % n], x - i);
}

// ---------------------------------------------------------------------------------------------------------------
// comandos de path (worklets)
// ---------------------------------------------------------------------------------------------------------------
/** comandos de um oval (4 cúbicas) */
export function ovalCmds(cx: number, cy: number, rx: number, ry: number): number[] {
  'worklet';
  const k = 0.5522848;
  const ox = rx * k;
  const oy = ry * k;
  return [0, cx + rx, cy, 3, cx + rx, cy + oy, cx + ox, cy + ry, cx, cy + ry, 3, cx - ox, cy + ry, cx - rx, cy + oy, cx - rx, cy, 3, cx - rx, cy - oy, cx - ox, cy - ry, cx, cy - ry, 3, cx + ox, cy - ry, cx + rx, cy - oy, cx + rx, cy, 4];
}

export function rrectCmds(x: number, y: number, w: number, h: number, r: number): number[] {
  'worklet';
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  if (rr <= 0) return [0, x, y, 1, x + w, y, 1, x + w, y + h, 1, x, y + h, 4];
  const k = rr * 0.4477152;
  return [
    0, x + rr, y,
    1, x + w - rr, y,
    3, x + w - k, y, x + w, y + k, x + w, y + rr,
    1, x + w, y + h - rr,
    3, x + w, y + h - k, x + w - k, y + h, x + w - rr, y + h,
    1, x + rr, y + h,
    3, x + k, y + h, x, y + h - k, x, y + h - rr,
    1, x, y + rr,
    3, x, y + k, x + k, y, x + rr, y,
    4,
  ];
}

/** comandos de um arco de oval (de a0 a a0+sweep graus, horário), aproximado por cúbicas de ≤ 90° */
export function arcCmds(cx: number, cy: number, rx: number, ry: number, a0: number, sweep: number): number[] {
  'worklet';
  const out: number[] = [];
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / 90));
  const step = ((sweep / n) * Math.PI) / 180;
  let a = (a0 * Math.PI) / 180;
  const k = (4 / 3) * Math.tan(step / 4);
  out.push(0, cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
  for (let i = 0; i < n; i++) {
    const b = a + step;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const cb = Math.cos(b);
    const sb = Math.sin(b);
    out.push(3, cx + (ca - k * sa) * rx, cy + (sa + k * ca) * ry, cx + (cb + k * sb) * rx, cy + (sb - k * cb) * ry, cx + cb * rx, cy + sb * ry);
    a = b;
  }
  return out;
}
