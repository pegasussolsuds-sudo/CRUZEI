// Pulso esquerdo da tela (grupo foreL): relógio, pulseira de corrente, smartwatch, pulseiras finas, miçangas, xuxinha,
// pulseira fitness, relógio de luxo e bracelete dourado. Dono: guarda-roupa (parte de baixo).
//
// Cada peça abraça o antebraço logo acima do pulso: as bordas seguem o cilindro do braço (curvam pro lado da mão, que é
// o lado de perto da câmera), luz na esquerda, sombra de contato na pele embaixo. Tudo sai das juntas da anatomia
// (cotovelo → pulso e largura do antebraço), então acompanha qualquer repouso, a mão no colo e as animações.
// A clutch na mão esquerda também é desenhada aqui (depois da mão): ver lower-bags.ts.

import { limbWidthAt, smoothPath, taperPath, type SP } from '../anatomy';
import type { LayerCtx } from '../ctx';
import { ellipse } from '../geometry';
import { blob, isLite, lodCtx, mix } from '../shading';
import type { AvatarGradient, Pt } from '../types';

import { drawClutchInHand } from './lower-bags';
import { NONE } from './lower-common';

/** referencial do pulso: centro da faixa, eixo do antebraço (u, pro lado da mão) e normal (n, pra esquerda da tela) */
interface WF {
  c: Pt;
  u: Pt;
  n: Pt;
  /** meias-larguras do antebraço (esquerda/direita da tela) */
  wl: number;
  wr: number;
  /** ponto: a = ao longo (pra mão), b = de lado (+ = esquerda da tela) */
  P: (a: number, b: number) => Pt;
}

/** referencial em `t` do antebraço (0 = cotovelo, 1 = pulso) */
export function wristFrame(ctx: LayerCtx, t = 0.86): WF {
  const q = limbWidthAt(ctx.an, 'forearm', 'L', t);
  const u: Pt = [q.dir[0], q.dir[1]];
  let n: Pt = [-u[1], u[0]];
  // a normal aponta pra esquerda da tela; com o antebraço apontando pra cima ela vira, e as larguras também
  let wl = q.l;
  let wr = q.r;
  if (n[0] > 0) {
    n = [-n[0], -n[1]];
  }
  if (u[1] < 0) {
    wl = q.r;
    wr = q.l;
  }
  const c = q.at;
  return { c, u, n, wl, wr, P: (a, b) => [c[0] + u[0] * a + n[0] * b, c[1] + u[1] * a + n[1] * b] };
}

/** faixa que abraça o antebraço: largura `h` ao longo do braço, folga `e`, curvatura `k` (pro lado da mão) */
function bandPath(f: WF, h: number, e: number, k = 0.32, a0 = 0): string {
  const L = f.wl + e;
  const R = f.wr + e;
  const top = -h / 2 + a0;
  const bot = h / 2 + a0;
  const bow = (L + R) * k * 0.5;
  return smoothPath(
    [
      [...f.P(top, L), 0.4] as SP,
      f.P(top + bow, (L - R) / 2),
      [...f.P(top, -R), 0.4] as SP,
      [...f.P(bot, -R), 0.4] as SP,
      f.P(bot + bow, (L - R) / 2),
      [...f.P(bot, L), 0.4] as SP,
    ],
    true,
  );
}

/** curva do meio da faixa (pra brilhos e elos) */
function bandLine(f: WF, a: number, e: number, k = 0.32): SP[] {
  const L = f.wl + e;
  const R = f.wr + e;
  const bow = (L + R) * k * 0.5;
  return [f.P(a, L), f.P(a + bow, (L - R) / 2), f.P(a, -R)];
}

/** gradiente atravessando o antebraço (cilindro: borda, luz, base, sombra) */
function acrossGrad(f: WF, e: number, s: AvatarGradient['s']): AvatarGradient {
  const a = f.P(0, f.wl + e);
  const b = f.P(0, -(f.wr + e));
  return { t: 'l', x1: a[0], y1: a[1], x2: b[0], y2: b[1], s };
}

const GOLD: AvatarGradient['s'] = [
  [0, '#8A6420'],
  [0.2, '#FFF1C0'],
  [0.45, '#E8C25A'],
  [0.8, '#A87A26'],
  [1, '#6E4C16'],
];
const SILVER: AvatarGradient['s'] = [
  [0, '#6E7686'],
  [0.2, '#FFFFFF'],
  [0.45, '#CDD3DD'],
  [0.8, '#8A92A2'],
  [1, '#545B6A'],
];

function tonesAcross(c: string): AvatarGradient['s'] {
  return [
    [0, mix(c, '#000000', 0.25)],
    [0.22, mix(c, '#FFFFFF', 0.3)],
    [0.5, c],
    [0.85, mix(c, '#000000', 0.32)],
    [1, mix(c, '#000000', 0.45)],
  ];
}

/** sombra de contato da peça na pele (logo abaixo, pro lado da mão) */
function contact(ctx: LayerCtx, f: WF, h: number, e: number): void {
  if (isLite(ctx)) return;
  ctx.push(bandPath(f, h * 0.7, e - 0.15, 0.32, h * 0.45), '#1A0A10', { o: 0.28, b: 0.35 });
}

/** mostrador redondo (vidro com reflexo, índices e ponteiros) */
function dial(ctx: LayerCtx, f: WF, r: number, o: { face: string; bezel: AvatarGradient['s']; hands: string; index?: string }): void {
  const lite = isLite(ctx);
  const c = f.P(0.15, (f.wl - f.wr) / 2);
  const rot = Math.atan2(f.n[1], f.n[0]) + Math.PI;
  ctx.push(blob(c[0] + 0.15, c[1] + 0.35, r * 1.05, r * 0.95, rot), '#0A0610', { o: 0.35, b: lite ? 0 : 0.35 });
  ctx.push(blob(c[0], c[1], r, r * 0.92, rot), '#C9A04A', { gf: { t: 'l', x1: c[0] - r, y1: c[1] - r, x2: c[0] + r, y2: c[1] + r, s: o.bezel } });
  const fr = r * 0.74;
  ctx.push(blob(c[0], c[1], fr, fr * 0.92, rot), o.face, { gf: { t: 'r', cx: c[0] - fr * 0.3, cy: c[1] - fr * 0.3, r: fr * 1.3, s: [[0, mix(o.face, '#FFFFFF', 0.35)], [0.7, o.face], [1, mix(o.face, '#000000', 0.25)]] } });
  if (!lite) {
    if (o.index) {
      let idx = '';
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2;
        idx += ellipse(c[0] + Math.cos(a) * fr * 0.72, c[1] + Math.sin(a) * fr * 0.72 * 0.92, 0.12, 0.12);
      }
      ctx.push(idx, o.index, { o: 0.9 });
    }
    ctx.stroke(`M${c[0].toFixed(2)},${c[1].toFixed(2)}L${(c[0] + fr * 0.15).toFixed(2)},${(c[1] - fr * 0.6).toFixed(2)}M${c[0].toFixed(2)},${c[1].toFixed(2)}L${(c[0] + fr * 0.5).toFixed(2)},${(c[1] + fr * 0.2).toFixed(2)}`, o.hands, 0.14, { o: 0.95 });
    // reflexo do vidro
    ctx.push(blob(c[0] - fr * 0.35, c[1] - fr * 0.4, fr * 0.45, fr * 0.2, -0.6), '#FFFFFF', { o: 0.6 });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// entrada
// ---------------------------------------------------------------------------------------------------------------

/** 15. pulso (antebraço esquerdo da tela) + clutch na mão esquerda */
export function drawWrist(ctx: LayerCtx): void {
  ctx = lodCtx(ctx);
  const id = ctx.cfg.wrist;
  if (id && id !== NONE) {
    const fn = WRIST[id];
    if (fn) ctx.withGroup('foreL', () => fn(ctx, wristFrame(ctx)));
  }
  drawClutchInHand(ctx);
}

type WristFn = (ctx: LayerCtx, f: WF) => void;

/** relógio clássico: pulseira de couro marrom com pesponto, caixa dourada, mostrador marfim */
const watch: WristFn = (ctx, f) => {
  const strapC = '#6B3E22';
  contact(ctx, f, 1.6, 0.35);
  const d = bandPath(f, 1.5, 0.35);
  ctx.push(d, strapC, { gf: acrossGrad(f, 0.35, tonesAcross(strapC)) });
  if (!isLite(ctx)) ctx.stroke(smoothPath(bandLine(f, -0.45, 0.2), false) + smoothPath(bandLine(f, 0.45, 0.2), false), '#D9B48A', 0.1, { o: 0.6, da: [0.3, 0.25], c: 'butt', cp: d });
  dial(ctx, f, 1.35, { face: '#F4EEDF', bezel: GOLD, hands: '#2A2018', index: '#8A6A30' });
};

/** pulseira de corrente dourada fina com plaquinha */
const bracelet: WristFn = (ctx, f) => {
  const lite = isLite(ctx);
  const line = bandLine(f, 0.2, 0.25);
  if (!lite) ctx.stroke(smoothPath(bandLine(f, 0.55, 0.15), false), '#1A0A10', 0.55, { o: 0.25, b: 0.3 });
  ctx.stroke(smoothPath(line, false), '#E2BE5E', lite ? 0.6 : 0.5);
  if (!lite) {
    ctx.stroke(smoothPath(line, false), '#8A6420', 0.3, { o: 0.75, da: [0.32, 0.3], c: 'butt' });
    ctx.stroke(smoothPath(line, false), '#FFF3C4', 0.14, { o: 0.8, da: [0.15, 0.47], c: 'butt' });
  }
  const p = line[1] as Pt;
  ctx.push(blob(p[0], p[1] + 0.3, 0.55, 0.38, Math.atan2(f.n[1], f.n[0])), '#E8C25A', { gf: { t: 'l', x1: p[0] - 0.6, y1: p[1], x2: p[0] + 0.6, y2: p[1] + 0.6, s: GOLD } });
};

/** smartwatch: caixa preta arredondada, tela com anéis de atividade lima/magenta, pulseira esportiva */
const smartwatch: WristFn = (ctx, f) => {
  const lite = isLite(ctx);
  contact(ctx, f, 1.9, 0.4);
  const d = bandPath(f, 1.7, 0.4);
  ctx.push(d, '#1C1E26', { gf: acrossGrad(f, 0.4, tonesAcross('#2A2D38')) });
  const c = f.P(0.15, (f.wl - f.wr) / 2);
  const hw = 1.25;
  const hh = 1.45;
  const Q = (a: number, b: number): SP => [...f.P(0.15 + a, (f.wl - f.wr) / 2 + b), 0.6] as SP;
  const caseD = smoothPath([Q(-hh, hw), Q(-hh, -hw), Q(hh, -hw), Q(hh, hw)], true, 0.75);
  ctx.push(caseD, '#0E0F14', { gf: acrossGrad(f, 0.6, [[0, '#4A4E5C'], [0.3, '#24262E'], [1, '#08090C']]) });
  const scr = smoothPath([Q(-hh + 0.35, hw - 0.3), Q(-hh + 0.35, -hw + 0.3), Q(hh - 0.35, -hw + 0.3), Q(hh - 0.35, hw - 0.3)], true, 0.7);
  ctx.push(scr, '#05060A');
  ctx.stroke(ellipse(c[0], c[1], 0.62, 0.62), '#7FFF00', lite ? 0.3 : 0.22, { o: 0.95, cp: scr });
  if (!lite) {
    ctx.stroke(ellipse(c[0], c[1], 0.36, 0.36), '#FF1493', 0.18, { o: 0.95 });
    ctx.push(ellipse(c[0], c[1], 0.9, 0.9), '#7FFF00', { o: 0.3, b: 0.4, cp: scr });
    ctx.push(blob(c[0] - 0.5, c[1] - 0.6, 0.6, 0.22, -0.5), '#FFFFFF', { o: 0.35, cp: scr });
  }
};

/** pulseiras finas: quatro aros de metal soltos (ouro e prata), mais largos que o pulso, cada um num ângulo */
const bangles: WristFn = (ctx, f) => {
  const lite = isLite(ctx);
  const set: [number, number, AvatarGradient['s']][] = [
    [-0.7, 0.18, GOLD],
    [-0.05, -0.12, SILVER],
    [0.6, 0.22, GOLD],
    [1.2, -0.06, GOLD],
  ];
  const L = f.wl + 0.75;
  const R = f.wr + 0.75;
  for (const [a, tilt, g] of lite ? set.slice(0, 3) : set) {
    // arco da frente do aro: desce no meio (lado de perto) e inclina um pouco
    const sp: SP[] = [f.P(a + tilt * L, L), f.P(a + 0.55 + tilt * L * 0.5, L * 0.55), f.P(a + 0.95, (L - R) / 2), f.P(a + 0.55 - tilt * R * 0.5, -R * 0.55), f.P(a - tilt * R, -R)];
    if (!lite) ctx.stroke(smoothPath(sp.map((p) => [p[0] + 0.12, p[1] + 0.4] as SP), false), '#1A0A10', 0.5, { o: 0.25, b: 0.25 });
    const d = taperPath(sp, [0.4, 0.52, 0.55, 0.52, 0.4], { round: true });
    const p0 = sp[0] as Pt;
    const p1 = sp[4] as Pt;
    ctx.push(d, '#E8C25A', { gf: { t: 'l', x1: p0[0], y1: p0[1], x2: p1[0], y2: p1[1], s: g } });
  }
};

/** miçangas: contas redondas coloridas (madeira, turquesa, coral) num fio */
const beads: WristFn = (ctx, f) => {
  const lite = isLite(ctx);
  const cols = ['#C8875A', '#2EB5A8', '#F27A5E', '#F2D27A', '#8A5A3A', '#2EB5A8', '#F27A5E'];
  const L = f.wl + 0.3;
  const R = f.wr + 0.3;
  const n = lite ? 5 : 7;
  let shadow = '';
  const byCol: Record<string, string> = {};
  let hi = '';
  for (let i = 0; i < n; i++) {
    const k = i / (n - 1);
    const b = L - (L + R) * k;
    const a = 0.25 + Math.sin(k * Math.PI) * (L + R) * 0.16;
    const p = f.P(a, b);
    const r = 0.5 + Math.sin(k * Math.PI) * 0.08;
    shadow += ellipse(p[0] + 0.15, p[1] + 0.3, r, r);
    const c = cols[i % cols.length];
    byCol[c] = (byCol[c] ?? '') + ellipse(p[0], p[1], r, r);
    hi += ellipse(p[0] - r * 0.35, p[1] - r * 0.35, r * 0.3, r * 0.3);
  }
  if (!lite) ctx.push(shadow, '#1A0A10', { o: 0.28, b: 0.25 });
  for (const [c, d] of Object.entries(byCol)) ctx.push(d, c, { gf: { t: 'r', cx: f.c[0] - 1, cy: f.c[1] - 1, r: 5, s: [[0, mix(c, '#FFFFFF', 0.3)], [1, mix(c, '#000000', 0.2)]] } });
  if (!lite) ctx.push(hi, '#FFFFFF', { o: 0.6 });
};

/** xuxinha: anel de tecido franzido (cetim rosé), volumoso */
const scrunchie: WristFn = (ctx, f) => {
  const lite = isLite(ctx);
  const C = '#E89AB0';
  contact(ctx, f, 2.2, 0.8);
  const d = bandPath(f, 2.0, 0.85, 0.36);
  ctx.push(d, C, { gf: acrossGrad(f, 0.85, tonesAcross(C)) });
  // franzidos: vincos curtos atravessando a faixa
  const n = lite ? 3 : 6;
  let dk = '';
  let lt = '';
  for (let i = 1; i < n; i++) {
    const k = i / n;
    const b = f.wl + 0.85 - (f.wl + f.wr + 1.7) * k;
    const bow = Math.sin(k * Math.PI) * (f.wl + f.wr) * 0.18;
    const p0 = f.P(-0.9 + bow, b);
    const p1 = f.P(0.95 + bow, b + 0.25);
    dk += taperPath([p0, [(p0[0] + p1[0]) / 2 + 0.15, (p0[1] + p1[1]) / 2], p1], [0, 0.45, 0]);
    lt += taperPath([[p0[0] - 0.35, p0[1]], [(p0[0] + p1[0]) / 2 - 0.25, (p0[1] + p1[1]) / 2], [p1[0] - 0.35, p1[1]]], [0, 0.35, 0]);
  }
  ctx.push(dk, mix(C, '#5A1A30', 0.45), { o: 0.5, cp: d });
  if (!lite) ctx.push(lt, '#FFFFFF', { o: 0.35, b: 0.15, cp: d });
};

/** pulseira fitness: silicone turquesa com uma telinha preta e um ponto de luz */
const fitness: WristFn = (ctx, f) => {
  const lite = isLite(ctx);
  const C = '#1FB5A0';
  contact(ctx, f, 1.3, 0.3);
  const d = bandPath(f, 1.2, 0.3);
  ctx.push(d, C, { gf: acrossGrad(f, 0.3, tonesAcross(C)) });
  const Q = (a: number, b: number): SP => [...f.P(0.15 + a, (f.wl - f.wr) / 2 + b), 0.6] as SP;
  const scr = smoothPath([Q(-0.55, 0.95), Q(-0.55, -0.95), Q(0.75, -0.95), Q(0.75, 0.95)], true, 0.7);
  ctx.push(scr, '#0B0D12');
  const p = f.P(0.25, (f.wl - f.wr) / 2 + 0.3);
  ctx.push(ellipse(p[0], p[1], 0.22, 0.22), '#7FFF00');
  if (!lite) ctx.push(taperPath([f.P(0.25, (f.wl - f.wr) / 2 - 0.15), f.P(0.25, (f.wl - f.wr) / 2 - 0.7)], [0.16, 0.16]), '#9FE8FF', { o: 0.85 });
};

/** relógio de luxo: pulseira de elos dourada, caixa grande, mostrador azul-noite com índices dourados */
const luxury: WristFn = (ctx, f) => {
  const lite = isLite(ctx);
  contact(ctx, f, 1.9, 0.4);
  const d = bandPath(f, 1.7, 0.4);
  ctx.push(d, '#E8C25A', { gf: acrossGrad(f, 0.4, GOLD) });
  if (!lite) {
    // elos: divisões ao longo da faixa + elo central polido
    let links = '';
    const L = f.wl + 0.4;
    const R = f.wr + 0.4;
    for (let i = 1; i < 6; i++) {
      const b = L - ((L + R) * i) / 6;
      const bow = Math.sin((i / 6) * Math.PI) * (L + R) * 0.16;
      const p0 = f.P(-0.85 + bow, b);
      const p1 = f.P(0.85 + bow, b);
      links += `M${p0[0].toFixed(2)},${p0[1].toFixed(2)}L${p1[0].toFixed(2)},${p1[1].toFixed(2)}`;
    }
    ctx.stroke(links, '#7A5418', 0.12, { o: 0.7, cp: d });
    ctx.stroke(smoothPath(bandLine(f, 0, 0.4), false), '#FFF6D0', 0.3, { o: 0.45, cp: d });
  }
  dial(ctx, f, 1.55, { face: '#16244A', bezel: GOLD, hands: '#F6E2A0', index: '#E8C25A' });
};

/** bracelete dourado: aro largo martelado com friso gravado e brilho forte */
const cuff: WristFn = (ctx, f) => {
  const lite = isLite(ctx);
  contact(ctx, f, 2.4, 0.4);
  const d = bandPath(f, 2.3, 0.42, 0.34);
  ctx.push(d, '#E8C25A', { gf: acrossGrad(f, 0.42, GOLD) });
  if (!lite) {
    ctx.stroke(smoothPath(bandLine(f, -0.55, 0.42), false) + smoothPath(bandLine(f, 0.55, 0.42), false), '#8A6420', 0.14, { o: 0.75, cp: d });
    ctx.push(taperPath(bandLine(f, -0.2, 0.42).map((p, i) => (i === 1 ? ([p[0] - 0.2, p[1]] as SP) : p)), [0.1, 0.5, 0.1]), '#FFFFFF', { o: 0.5, b: 0.15, cp: d });
  }
};

const WRIST: Record<string, WristFn> = { watch, bracelet, smartwatch, bangles, beads, scrunchie, fitness, luxury, cuff };

/** (testes) ids com desenho próprio */
export const WRIST_KINDS = Object.keys(WRIST);
