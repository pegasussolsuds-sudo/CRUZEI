// Helpers de volume e material: gradientes de forma (cilindro, esfera), sombra de contato, brilho de borda, dobra, vinco,
// costura e texturas (listras, xadrez, trama, couro, metal, vidro) recortadas no contorno. Tons de pele quentes.
// Dono: diretor de arte. Regras de uso, luz e espessuras mínimas: STYLE.md (mesma pasta).
//
// Luz: suave, vinda de CIMA e da ESQUERDA da tela. Sombra própria do lado direito/baixo; luz rebatida fraca na borda da
// sombra. Gradientes discretos (nada de degradê de PowerPoint): a diferença claro→escuro de uma forma fica em ~20–30%.
//
// Todos devolvem dados do contrato da camada (AvatarGradient) ou empurram camadas no ctx (grupo/etiqueta atuais).
// Detalhe com menos de 0,6 unidade some no mapa (~48 px de altura): use pra volume, não pra informação.

import { smoothPath, taperPath, type SP } from './anatomy';
import type { LayerCtx } from './ctx';
import { fmt, shade } from './geometry';
import type { AvatarGradient, AvatarLayer, AvatarStop, Pt } from './types';

export { smoothPath, taperPath, type SP };

/**
 * nível de detalhe: 'lite' = miniatura/mapa (lista com muitos avatares). As partes pulam o detalhe fino (trama,
 * costura, fio de cabelo, brilhos miúdos) que não aparece abaixo de ~100 px. Vem de ctx.opts.lod (pedido ao dono do
 * ctx.ts: BuildOptions.lod); sem o campo, desenha tudo.
 */
export function isLite(ctx: LayerCtx): boolean {
  return (ctx.opts as { lod?: string }).lod === 'lite';
}

/**
 * contexto de nível de detalhe: no 'lite' (≤ ~100 px) o desfoque some (desfoque < 1 unidade nem aparece nesse tamanho e
 * custa caro: MaskFilter no Skia, halo extra no SVG das listas) e a camada perde ~20% de opacidade pra não endurecer.
 * Use no começo de cada função de parte: `ctx = lodCtx(ctx)`. Fora do 'lite' devolve o próprio ctx.
 */
export function lodCtx(ctx: LayerCtx): LayerCtx {
  if (!isLite(ctx)) return ctx;
  const strip = (e?: Partial<AvatarLayer>): Partial<AvatarLayer> | undefined => {
    if (!e || e.b == null || e.b >= 1.2) return e;
    const { b: _b, ...rest } = e;
    void _b;
    return { ...rest, o: (rest.o ?? 1) * 0.8 };
  };
  const w = Object.create(ctx) as LayerCtx;
  return Object.assign(w, {
    push: (d: string, f?: string, extra?: Partial<AvatarLayer>) => ctx.push(d, f, strip(extra)),
    stroke: (d: string, st: string, sw: number, extra?: Partial<AvatarLayer>) => ctx.stroke(d, st, sw, strip(extra)),
  });
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ---------------------------------------------------------------------------------------------------------------
// Cor
// ---------------------------------------------------------------------------------------------------------------

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const n = parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hex(r: number, g: number, b: number): string {
  const c = (x: number) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0');
  return ('#' + c(r) + c(g) + c(b)).toUpperCase();
}

/** mistura a→b (t 0..1) */
export function mix(a: string, b: string, t: number): string {
  const A = rgb(a);
  const B = rgb(b);
  return hex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}

/** luminância relativa 0..1 (sRGB linearizado) */
export function lum(c: string): number {
  const [r, g, b] = rgb(c).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** satura/dessatura (k > 0 satura) mantendo o brilho aproximado */
export function saturate(c: string, k: number): string {
  const [r, g, b] = rgb(c);
  const m = (r + g + b) / 3;
  return hex(m + (r - m) * (1 + k), m + (g - m) * (1 + k), m + (b - m) * (1 + k));
}

/** tons de pele prontos (sombra quente, luz quente, rubor, lábio, vinco). Fantasia ganha brilho próprio. */
export interface SkinTones {
  base: string;
  light: string;
  lighter: string;
  shade: string;
  deep: string;
  /** luz rebatida na borda da sombra */
  bounce: string;
  blush: string;
  lip: string;
  lipDark: string;
  /** vinco/linha fina (pálpebra, marcas do tempo) */
  line: string;
  /** cor das formas de sombra recortadas (rosto, mandíbula): ~25% mais escura, quente e saturada */
  form: string;
  /** pele bem escura: brilhos mais frios e marcados */
  dark: boolean;
  /** tom de fantasia: brilho iridescente discreto */
  fantasy: string | null;
}

const FANTASY: Record<string, string> = { '#C9D4F2': '#FFFFFF', '#5B4BB7': '#B79CFF', '#5FB89A': '#C8FFE8' };

export function skinTones(base: string): SkinTones {
  const L = lum(base);
  const dark = L < 0.09;
  const fantasy = FANTASY[base.toUpperCase()] ?? null;
  const warmDark = fantasy ? shade(base, -0.55) : '#3A140C';
  const warmLight = fantasy ? fantasy : '#FFF1E2';
  // pele muito clara (s9, s1): a sombra de mesma força some contra o branco e o rosto fica chapado na miniatura de 56 px
  // e no mapa de 48 px — a sombra, o fundo e a forma escurecem mais quanto mais clara a pele (0 até L 0,62, cheio em 0,8)
  const pale = fantasy ? 0 : Math.max(0, Math.min(1, (L - 0.62) / 0.18));
  return {
    base,
    light: mix(base, warmLight, dark ? 0.14 : 0.2),
    lighter: mix(base, warmLight, dark ? 0.26 : 0.42),
    shade: saturate(mix(base, warmDark, dark ? 0.2 : 0.17 + 0.1 * pale), 0.08 + 0.08 * pale),
    deep: saturate(mix(base, warmDark, dark ? 0.38 : 0.34 + 0.12 * pale), 0.1 + 0.08 * pale),
    bounce: mix(base, fantasy ?? '#FFB48A', dark ? 0.1 : 0.08),
    blush: fantasy ? mix(base, '#FF7AB6', 0.5) : mix(base, dark ? '#C2405A' : '#F0607A', dark ? 0.35 : 0.42),
    lip: fantasy ? mix(base, '#7A2E5E', 0.45) : mix(saturate(base, 0.2), dark ? '#A0525E' : '#B8495A', dark ? 0.34 : 0.45),
    lipDark: fantasy ? mix(base, '#3A0E2E', 0.6) : mix(base, dark ? '#1A0508' : '#6A1A26', dark ? 0.62 : 0.55),
    line: mix(base, warmDark, dark ? 0.45 : 0.36 + 0.06 * pale),
    form: saturate(mix(base, fantasy ? warmDark : dark ? '#1A0604' : '#4A160C', dark ? 0.32 : 0.36 + 0.12 * pale), 0.12 + 0.08 * pale),
    dark,
    fantasy,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Gradientes de forma
// ---------------------------------------------------------------------------------------------------------------

/** gradiente linear da forma: claro em cima/esquerda, escuro embaixo/direita (luz de cima-esquerda) */
export function shapeGradient(box: Box, base: string, opts: { light?: number; dark?: number; dir?: 'diag' | 'down' | 'right' } = {}): AvatarGradient {
  const light = opts.light ?? 0.1;
  const dark = opts.dark ?? -0.12;
  const dir = opts.dir ?? 'diag';
  const x2 = dir === 'down' ? box.x : box.x + box.w;
  const y2 = dir === 'right' ? box.y : box.y + box.h;
  return {
    t: 'l',
    x1: box.x,
    y1: box.y,
    x2,
    y2,
    s: [
      [0, shade(base, light)],
      [0.55, base],
      [1, shade(base, dark)],
    ],
  };
}

/** gradiente radial com o foco puxado pra cima-esquerda (cabeça, mãos, formas redondas) */
export function roundGradient(cx: number, cy: number, r: number, base: string, opts: { light?: number; dark?: number; lightC?: string; darkC?: string } = {}): AvatarGradient {
  return {
    t: 'r',
    cx,
    cy,
    r,
    fx: cx - r * 0.3,
    fy: cy - r * 0.35,
    s: [
      [0, opts.lightC ?? shade(base, opts.light ?? 0.1)],
      [0.62, base],
      [1, opts.darkC ?? shade(base, opts.dark ?? -0.12)],
    ],
  };
}

/**
 * gradiente de cilindro atravessando um membro de eixo a→b (luz na borda esquerda da tela): borda iluminada, faixa de
 * luz, tom base, sombra própria e luz rebatida fraca na borda da sombra. `wl`/`wr` = meias-larguras de cada lado.
 */
export function cylGradient(a: Pt, b: Pt, wl: number, wr: number, c: { light: string; base: string; shade: string; bounce?: string; edge?: string }): AvatarGradient {
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  let ux = b[0] - a[0];
  let uy = b[1] - a[1];
  const L = Math.hypot(ux, uy) || 1;
  ux /= L;
  uy /= L;
  // normal pra esquerda da tela
  let nx = -uy;
  let ny = ux;
  if (nx > 0) {
    nx = -nx;
    ny = -ny;
  }
  return {
    t: 'l',
    x1: mx + nx * wl,
    y1: my + ny * wl,
    x2: mx - nx * wr,
    y2: my - ny * wr,
    s: [
      [0, c.edge ?? c.base],
      [0.18, c.light],
      [0.46, c.base],
      [0.84, c.shade],
      [1, c.bounce ?? c.shade],
    ],
  };
}

/** gradiente vertical com paradas livres (cabelo raiz→ponta, tecido em queda) */
export function vGradient(y1: number, y2: number, stops: readonly AvatarStop[], x = 50): AvatarGradient {
  return { t: 'l', x1: x, y1, x2: x, y2, s: stops };
}

// ---------------------------------------------------------------------------------------------------------------
// Camadas de volume
// ---------------------------------------------------------------------------------------------------------------

/** sombra de contato macia (pescoço sob o queixo, cabelo na testa, braço no tronco) */
export function contactShadow(ctx: LayerCtx, d: string, opts: { color?: string; o?: number; b?: number; cp?: string } = {}): AvatarLayer {
  return ctx.push(d, opts.color ?? '#000000', { o: opts.o ?? 0.18, b: opts.b ?? 1.4, cp: opts.cp });
}

/**
 * luz de recorte (rim light) só do lado da luz: o contorno deslocado pra baixo-direita e recortado na forma vira uma
 * faixa clara rente às bordas de cima e da esquerda. Passe os PONTOS do contorno (SP[]), não o path.
 */
export function rimLit(ctx: LayerCtx, pts: readonly SP[], opts: { color?: string; o?: number; w?: number; shift?: number; b?: number } = {}): AvatarLayer | null {
  if (isLite(ctx)) return null;
  const k = opts.shift ?? 0.7;
  const clip = smoothPath(pts, true);
  const moved = smoothPath(pts.map((p) => (p.length > 2 ? ([p[0] + k, p[1] + k * 0.8, p[2] as number] as SP) : ([p[0] + k, p[1] + k * 0.8] as SP))), true);
  return ctx.stroke(moved, opts.color ?? '#FFFFFF', opts.w ?? 1.1, { o: opts.o ?? 0.28, b: opts.b ?? 0.45, cp: clip });
}

/** brilho de borda sutil: traço claro dentro da forma (recortado nela), levemente desfocado */
export function rimLight(ctx: LayerCtx, d: string, opts: { color?: string; o?: number; w?: number; b?: number; clip?: string } = {}): AvatarLayer {
  return ctx.stroke(d, opts.color ?? '#FFFFFF', opts.w ?? 1.2, { o: opts.o ?? 0.22, b: opts.b ?? 0.6, cp: opts.clip ?? d });
}

/** brilho suave (reflexo no cabelo, na testa, no tecido acetinado) */
export function highlight(ctx: LayerCtx, d: string, opts: { color?: string; o?: number; b?: number; cp?: string } = {}): AvatarLayer {
  return ctx.push(d, opts.color ?? '#FFFFFF', { o: opts.o ?? 0.25, b: opts.b ?? 1.2, cp: opts.cp });
}

/**
 * Forma com volume em até 3 camadas: base (gradiente `g` ou cor), sombra própria (`core`, recortada e desfocada) e
 * luz (`hl`, recortada e desfocada). Use pra qualquer peça "pintada": nada de forma chapada sozinha.
 */
export function volume(
  ctx: LayerCtx,
  d: string,
  base: string,
  o: { g?: AvatarGradient; core?: string; coreColor?: string; coreO?: number; coreB?: number; hl?: string; hlColor?: string; hlO?: number; hlB?: number; extra?: Partial<AvatarLayer> } = {},
): void {
  ctx.push(d, base, { ...(o.g ? { gf: o.g } : {}), ...o.extra });
  if (o.core) ctx.push(o.core, o.coreColor ?? shade(base, -0.35), { o: o.coreO ?? 0.35, b: o.coreB ?? 1.2, cp: d });
  if (o.hl) ctx.push(o.hl, o.hlColor ?? shade(base, 0.45), { o: o.hlO ?? 0.3, b: o.hlB ?? 1.0, cp: d });
}

/** dobra do tecido: traço mais escuro, fino e translúcido */
export function fold(ctx: LayerCtx, d: string, base: string, opts: { w?: number; o?: number; cp?: string } = {}): AvatarLayer {
  return ctx.stroke(d, shade(base, -0.28), opts.w ?? 0.8, { o: opts.o ?? 0.5, cp: opts.cp });
}

/**
 * vinco/dobra como forma afilada (mais escura no miolo) com uma borda de luz logo acima — tecido de verdade.
 * `spine` = eixo da dobra; `w` = largura máxima.
 */
export function crease(ctx: LayerCtx, spine: readonly SP[], base: string, opts: { w?: number; o?: number; light?: boolean; cp?: string; b?: number } = {}): void {
  creases(ctx, [spine], base, opts);
}

/**
 * várias dobras do mesmo tecido numa camada só de sombra (+ uma de luz): use esta quando a peça tem mais de uma
 * dobra — menos camadas, mesmo visual. `w` vale pra todas (ou passe { spine, w } por dobra).
 */
export function creases(ctx: LayerCtx, list: readonly (readonly SP[] | { spine: readonly SP[]; w: number })[], base: string, opts: { w?: number; o?: number; light?: boolean; cp?: string; b?: number } = {}): void {
  // dobra de tecido = vale de sombra macio + crista de luz larga e difusa logo acima (nunca risco duro)
  let dark = '';
  let lite = '';
  let wmax = 0;
  for (const it of list) {
    const spine = 'spine' in it ? it.spine : (it as readonly SP[]);
    const w = ('spine' in it ? it.w : (opts.w ?? 0.9)) * 1.25;
    wmax = Math.max(wmax, w);
    dark += taperPath(spine, [0, w, w * 0.75, 0]);
    if (opts.light !== false) lite += taperPath(spine.map((p) => [p[0] - 0.45, p[1] - 0.6] as SP), [0, w * 0.9, w * 0.6, 0]);
  }
  const L = isLite(ctx);
  const blur = L ? 0 : (opts.b ?? Math.max(0.3, wmax * 0.32));
  ctx.push(dark, shade(base, -0.3), { o: (opts.o ?? 0.5) * 0.85, cp: opts.cp, ...(blur ? { b: blur } : {}) });
  if (lite && !L) ctx.push(lite, shade(base, 0.32), { o: (opts.o ?? 0.5) * 0.5, cp: opts.cp, b: blur * 1.2 });
}

/** costura: tracejado claro (ou escuro em tecido claro) */
export function seam(ctx: LayerCtx, d: string, base: string, opts: { w?: number; o?: number; dash?: number[]; cp?: string; color?: string } = {}): AvatarLayer | null {
  if (isLite(ctx)) return null;
  const c = opts.color ?? (lum(base) > 0.5 ? shade(base, -0.35) : shade(base, 0.32));
  return ctx.stroke(d, c, opts.w ?? 0.45, { o: opts.o ?? 0.75, da: opts.dash ?? [1.1, 0.8], c: 'butt', cp: opts.cp });
}

/** sombra de oclusão numa junção (manga no braço, barra na perna): faixa escura desfocada recortada */
export function occlusion(ctx: LayerCtx, d: string, cp: string, opts: { o?: number; b?: number; color?: string } = {}): AvatarLayer {
  return ctx.push(d, opts.color ?? '#140A10', { o: opts.o ?? 0.28, b: opts.b ?? 0.8, cp });
}

// ---------------------------------------------------------------------------------------------------------------
// Texturas recortadas no contorno (uma ou poucas camadas cada)
// ---------------------------------------------------------------------------------------------------------------

/** listras horizontais (ou verticais) dentro de `clip`: uma camada por cor alternada */
export function stripes(ctx: LayerCtx, clip: string, box: Box, color: string, opts: { gap?: number; w?: number; vertical?: boolean; o?: number; tilt?: number } = {}): AvatarLayer {
  const gap = opts.gap ?? 2.4;
  const w = opts.w ?? 1.1;
  const tilt = opts.tilt ?? 0;
  let d = '';
  if (opts.vertical) {
    for (let x = box.x; x < box.x + box.w; x += gap) d += `M${fmt(x)},${fmt(box.y)}h${fmt(w)}l${fmt(tilt)},${fmt(box.h)}h${fmt(-w)}Z`;
  } else {
    for (let y = box.y; y < box.y + box.h; y += gap) d += `M${fmt(box.x)},${fmt(y)}h${fmt(box.w)}v${fmt(w)}h${fmt(-box.w)}Z`;
  }
  return ctx.push(d, color, { cp: clip, o: opts.o ?? 1 });
}

/** xadrez (flanela): faixas largas nas duas direções + linha fina clara; 3 camadas */
export function plaid(ctx: LayerCtx, clip: string, box: Box, base: string, opts: { cell?: number; accent?: string } = {}): void {
  const cell = opts.cell ?? 4.2;
  const band = cell * 0.42;
  let h = '';
  let v = '';
  let thin = '';
  for (let y = box.y; y < box.y + box.h; y += cell) h += `M${fmt(box.x)},${fmt(y)}h${fmt(box.w)}v${fmt(band)}h${fmt(-box.w)}Z`;
  for (let x = box.x; x < box.x + box.w; x += cell) v += `M${fmt(x)},${fmt(box.y)}h${fmt(band)}v${fmt(box.h)}h${fmt(-band)}Z`;
  for (let y = box.y + cell * 0.72; y < box.y + box.h; y += cell) thin += `M${fmt(box.x)},${fmt(y)}h${fmt(box.w)}v0.3h${fmt(-box.w)}Z`;
  ctx.push(h, shade(base, -0.3), { cp: clip, o: 0.55 });
  ctx.push(v, shade(base, -0.3), { cp: clip, o: 0.45 });
  ctx.push(thin, opts.accent ?? shade(base, 0.55), { cp: clip, o: 0.6 });
}

/** trama diagonal fininha (sarja do jeans, tricô): 1 camada translúcida */
export function weave(ctx: LayerCtx, clip: string, box: Box, base: string, opts: { gap?: number; o?: number; light?: boolean } = {}): AvatarLayer | null {
  if (isLite(ctx)) return null;
  const gap = opts.gap ?? 1.05;
  let d = '';
  for (let x = box.x - box.h; x < box.x + box.w; x += gap) d += `M${fmt(x)},${fmt(box.y + box.h)}l${fmt(box.h)},${fmt(-box.h)}h0.32l${fmt(-box.h)},${fmt(box.h)}Z`;
  return ctx.push(d, opts.light ? shade(base, 0.4) : shade(base, -0.4), { cp: clip, o: opts.o ?? 0.14 });
}

/** couro: reflexo especular duro (faixa clara estreita) + brilho de borda; 2 camadas */
export function leather(ctx: LayerCtx, d: string, box: Box, base: string): void {
  const x = box.x + box.w * 0.22;
  // o reflexo do couro escuro é mais frio; no claro, quase branco
  const spec = lum(base) < 0.1 ? '#DDE6FF' : '#FFFFFF';
  ctx.push(taperPath([[x, box.y + box.h * 0.12], [x - box.w * 0.04, box.y + box.h * 0.5], [x + box.w * 0.02, box.y + box.h * 0.88]], [0, box.w * 0.07, 0]), spec, { cp: d, o: 0.42 });
  rimLight(ctx, d, { o: 0.16, w: 0.8, b: 0.3 });
}

/** metal: faixas de reflexo (claro/escuro alternado na diagonal); 2 camadas */
export function metal(ctx: LayerCtx, d: string, box: Box, base: string): void {
  const { x, y, w, h } = box;
  ctx.push(`M${fmt(x)},${fmt(y + h * 0.35)}L${fmt(x + w)},${fmt(y + h * 0.1)}L${fmt(x + w)},${fmt(y + h * 0.3)}L${fmt(x)},${fmt(y + h * 0.55)}Z`, '#FFFFFF', { cp: d, o: 0.55 });
  ctx.push(`M${fmt(x)},${fmt(y + h * 0.7)}L${fmt(x + w)},${fmt(y + h * 0.48)}L${fmt(x + w)},${fmt(y + h * 0.62)}L${fmt(x)},${fmt(y + h * 0.84)}Z`, shade(base, -0.45), { cp: d, o: 0.4 });
}

/** vidro/lente: tinta translúcida + reflexo diagonal; 2 camadas (a forma já desenhada por baixo aparece) */
export function glass(ctx: LayerCtx, d: string, box: Box, tint: string, opts: { o?: number } = {}): void {
  ctx.push(d, tint, { o: opts.o ?? 0.32 });
  const { x, y, w, h } = box;
  ctx.push(`M${fmt(x + w * 0.15)},${fmt(y + h)}L${fmt(x + w * 0.55)},${fmt(y)}L${fmt(x + w * 0.75)},${fmt(y)}L${fmt(x + w * 0.35)},${fmt(y + h)}Z`, '#FFFFFF', { cp: d, o: 0.35 });
}

/** pontinhos espalhados determinísticos (sardas, glitter, paetê) dentro de uma caixa; 1 camada */
export function speckle(ctx: LayerCtx, box: Box, color: string, opts: { n?: number; r?: [number, number]; seed?: number; o?: number; cp?: string; b?: number } = {}): AvatarLayer {
  const n = opts.n ?? 14;
  const [r0, r1] = opts.r ?? [0.18, 0.32];
  let s = (opts.seed ?? 7) >>> 0;
  const rnd = () => {
    s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0;
    return (s >>> 8) / 16777216;
  };
  let d = '';
  for (let i = 0; i < n; i++) {
    const cx = box.x + rnd() * box.w;
    const cy = box.y + rnd() * box.h;
    const r = r0 + (r1 - r0) * rnd();
    d += `M${fmt(cx - r)},${fmt(cy)}a${fmt(r)},${fmt(r)} 0 1,0 ${fmt(2 * r)},0a${fmt(r)},${fmt(r)} 0 1,0 ${fmt(-2 * r)},0Z`;
  }
  return ctx.push(d, color, { o: opts.o ?? 0.8, cp: opts.cp, b: opts.b });
}

/** estrela de 4 ou 5 pontas (brilho, glitter, estrelinha na bochecha) */
export function starPath(cx: number, cy: number, r: number, points = 5, inner = 0.45, rot = -Math.PI / 2): string {
  const pts: SP[] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = rot + (i * Math.PI) / points;
    const rr = i % 2 === 0 ? r : r * inner;
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 0]);
  }
  return smoothPath(pts, true, 0);
}

/** coração (olhos apaixonados, pin, efeito) */
export function heartPath(cx: number, cy: number, r: number): string {
  const s = r;
  return (
    `M${fmt(cx)},${fmt(cy + s * 0.9)}` +
    `C${fmt(cx - s * 0.2)},${fmt(cy + s * 0.65)} ${fmt(cx - s * 1.05)},${fmt(cy + s * 0.1)} ${fmt(cx - s * 1.0)},${fmt(cy - s * 0.35)}` +
    `C${fmt(cx - s * 0.95)},${fmt(cy - s * 0.95)} ${fmt(cx - s * 0.2)},${fmt(cy - s * 1.0)} ${fmt(cx)},${fmt(cy - s * 0.45)}` +
    `C${fmt(cx + s * 0.2)},${fmt(cy - s * 1.0)} ${fmt(cx + s * 0.95)},${fmt(cy - s * 0.95)} ${fmt(cx + s * 1.0)},${fmt(cy - s * 0.35)}` +
    `C${fmt(cx + s * 1.05)},${fmt(cy + s * 0.1)} ${fmt(cx + s * 0.2)},${fmt(cy + s * 0.65)} ${fmt(cx)},${fmt(cy + s * 0.9)}Z`
  );
}

/** elipse girada (blush, reflexo, sombra) como path */
export function blob(cx: number, cy: number, rx: number, ry: number, rot = 0): string {
  const pts: SP[] = [];
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const x = Math.cos(a) * rx;
    const y = Math.sin(a) * ry;
    pts.push([cx + x * c - y * s, cy + x * s + y * c]);
  }
  return smoothPath(pts, true);
}
