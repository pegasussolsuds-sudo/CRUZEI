// Veículos que flutuam (hover): tapete voador, nuvem fofinha e disco voador. Dono: veículos.
//
// O piloto sobe `lift` e o veículo fica embaixo das solas (riderSoles); o balanço vem de pose.mount (scene.ts) e a
// sombra no chão (grupo 'shadow') fica parada e encolhe quando sobe. Em 48 px: tapete = faixa colorida com borda
// dourada e franjas; nuvem = massa branca de bolotas engolindo os pés; disco = elipse metálica com luzinhas e o facho
// de luz embaixo.
//
// Etapas: magicBack (2: sombra, brilho, tapete inteiro, nuvem de trás, disco) e magicFront (13: bolotas da nuvem na
// frente dos pés).

import type { LayerCtx } from '../ctx';
import { fmt } from '../geometry';
import { isLite, lum, mix, starPath } from '../shading';
import type { Pt } from '../types';

import {
  chromeGrad,
  curve,
  ell,
  floorShadow,
  glowGrad,
  paintOf,
  riderSoles,
  shape,
  type SP,
} from './vehicles-kit';

type MagicId = 'carpet' | 'cloud' | 'ufo';

export function magicBack(ctx: LayerCtx, id: MagicId): void {
  if (id === 'cloud') cloudBack(ctx);
  else if (id === 'ufo') ufoBack(ctx);
  else carpetBack(ctx);
}

export function magicFront(ctx: LayerCtx, id: MagicId): void {
  if (id === 'cloud') cloudFront(ctx);
}

function soleY(ctx: LayerCtx): number {
  const [L, R] = riderSoles(ctx);
  return Math.max(L[1], R[1]);
}

/** cintilas (estrelinhas de 4 pontas) — só no completo */
function sparkles(ctx: LayerCtx, list: readonly [number, number, number][], color: string, o = 0.9): void {
  if (isLite(ctx)) return;
  let d = '';
  for (const [x, y, r] of list) d += starPath(x, y, r, 4, 0.28);
  ctx.push(d, color, { o });
}

// ---------------------------------------------------------------------------------------------------------------
// Tapete voador: quadrilátero em perspectiva ondulando, borda dourada com losangos, medalhão central e franjas
// ---------------------------------------------------------------------------------------------------------------

const GOLD = '#E2B13C';

function carpetBack(ctx: LayerCtx): void {
  const { an } = ctx;
  const cx = an.cx;
  const lite = isLite(ctx);
  const base = ctx.col.vehicle;
  const p = paintOf(base);
  const y = soleY(ctx);
  // sombra no chão e brilho mágico embaixo (anda junto do tapete)
  floorShadow(ctx, cx, 135, 31, 1.6, 0.3, 1.8);
  ctx.push(ell(cx, y + 4.2, 34, 3.4), '#FFD98A', { gf: glowGrad(cx, y + 4.2, 34, '#FFD98A', 0.32) });
  // superfície: far(u) e near(u) com ondas; P(u,v) interpola
  const yF = y - 4.4;
  const yN = y + 2.9;
  const wF = 30;
  const wN = 38;
  const wave = (u: number, k: number) => Math.sin(u * Math.PI * 2.2 + k) * 0.7 + (u < 0.12 ? (0.12 - u) * -9 : u > 0.88 ? (u - 0.88) * -9 : 0) * (k > 1 ? 1 : 0.35);
  const P = (u: number, v: number): Pt => {
    const xf = cx + (u - 0.5) * 2 * wF;
    const xn = cx + (u - 0.5) * 2 * wN;
    const yf = yF + wave(u, 0.4);
    const yn = yN + wave(u, 1.6);
    return [xf + (xn - xf) * v, yf + (yn - yf) * v];
  };
  const quad = (u0: number, u1: number, v0: number, v1: number, n = 8): string => {
    const pts: SP[] = [];
    for (let i = 0; i <= n; i++) pts.push(P(u0 + ((u1 - u0) * i) / n, v0));
    for (let i = 0; i <= 2; i++) pts.push(P(u1, v0 + ((v1 - v0) * i) / 2));
    for (let i = n; i >= 0; i--) pts.push(P(u0 + ((u1 - u0) * i) / n, v1));
    for (let i = 2; i >= 0; i--) pts.push(P(u0, v0 + ((v1 - v0) * i) / 2));
    return 'M' + pts.map((q) => `${fmt(q[0])},${fmt(q[1])}`).join('L') + 'Z';
  };
  // espessura (face da frente) logo abaixo da borda de perto
  const lip: SP[] = [];
  for (let i = 0; i <= 10; i++) lip.push(P(i / 10, 1));
  for (let i = 10; i >= 0; i--) {
    const q = P(i / 10, 1);
    lip.push([q[0], q[1] + 1.1]);
  }
  ctx.push(shape(lip, 0.6), mix(GOLD, '#4A2A10', 0.55));
  // campo, borda e desenho
  const all = quad(0, 1, 0, 1, 12);
  ctx.push(all, GOLD, { gf: { t: 'l', x1: cx - wN, y1: yF, x2: cx + wN * 0.6, y2: yN, s: [[0, '#F6D47A'], [0.5, GOLD], [1, '#A87A1E']] } });
  const field = quad(0.07, 0.93, 0.2, 0.8, 10);
  ctx.push(field, base, { gf: { t: 'l', x1: cx, y1: yF, x2: cx, y2: yN, s: [[0, mix(p.base, p.sky, 0.35)], [0.55, p.base], [1, p.lo]] } });
  // faixa interna escura (filete) e medalhão em losango
  const inner = quad(0.12, 0.88, 0.33, 0.67, 10);
  ctx.stroke(inner, mix(GOLD, '#FFFFFF', 0.2), 0.45, { o: 0.9 });
  const m = (u: number, v: number) => P(u, v);
  const med = [m(0.5, 0.26), m(0.6, 0.5), m(0.5, 0.74), m(0.4, 0.5)];
  const medD = 'M' + med.map((q) => `${fmt(q[0])},${fmt(q[1])}`).join('L') + 'Z';
  ctx.push(medD, mix(p.deep, '#1A0820', 0.3), { o: 0.9 });
  const med2 = [m(0.5, 0.36), m(0.555, 0.5), m(0.5, 0.64), m(0.445, 0.5)];
  ctx.push('M' + med2.map((q) => `${fmt(q[0])},${fmt(q[1])}`).join('L') + 'Z', GOLD, { o: 0.95 });
  if (!lite) {
    // losangos na borda (perto e longe) e cantoneiras
    let lz = '';
    for (let i = 0; i < 11; i++) {
      const u = 0.06 + (i * 0.88) / 10;
      for (const v of [0.1, 0.9]) {
        const c = P(u, v);
        lz += `M${fmt(c[0])},${fmt(c[1] - 0.45)}l0.7,0.45l-0.7,0.45l-0.7,-0.45Z`;
      }
    }
    ctx.push(lz, mix(p.deep, '#2A0A10', 0.4), { o: 0.85 });
    let cn = '';
    for (const [u, v, du, dv] of [
      [0.07, 0.2, 1, 1],
      [0.93, 0.2, -1, 1],
      [0.07, 0.8, 1, -1],
      [0.93, 0.8, -1, -1],
    ] as const) {
      const a = P(u, v);
      const b = P(u + du * 0.09, v);
      const c = P(u, v + dv * 0.3);
      cn += `M${fmt(a[0])},${fmt(a[1])}L${fmt(b[0])},${fmt(b[1])}L${fmt(c[0])},${fmt(c[1])}Z`;
    }
    ctx.push(cn, GOLD, { o: 0.75 });
    // brilho de tecido (veludo): faixa clara no alto à esquerda
    ctx.push(quad(0.02, 0.45, 0.02, 0.35, 6), '#FFFFFF', { o: 0.1 });
  }
  // franjas nas duas pontas
  let fr = '';
  for (const g of [0, 1]) {
    for (let i = 0; i <= 5; i++) {
      const v = 0.08 + (i * 0.84) / 5;
      const a = P(g, v);
      const dir = g ? 1 : -1;
      fr += `M${fmt(a[0])},${fmt(a[1])}q${fmt(dir * 1.2)},${fmt(0.5)} ${fmt(dir * 2.4)},${fmt(0.2 + (i % 2) * 0.4)}`;
    }
  }
  ctx.stroke(fr, '#F3D58A', 0.5);
  sparkles(ctx, [[cx - 38, y - 3, 1.1], [cx + 39, y + 1, 0.9], [cx - 22, y + 6.5, 0.8], [cx + 26, y - 6, 0.7]], '#FFF4C8');
}

// ---------------------------------------------------------------------------------------------------------------
// Nuvem fofinha: massa de bolotas com luz de cima à esquerda e sombra lilás embaixo; as da frente engolem os pés
// ---------------------------------------------------------------------------------------------------------------

/** tons da nuvem: branca (padrão) ou tingida em tom pastel da cor escolhida */
function cloudTones(hex: string): { light: string; base: string; shade: string; deep: string } {
  const L = lum(hex);
  const tint = L > 0.75 ? '#FFFFFF' : mix(hex, '#FFFFFF', 0.62);
  return {
    light: mix(tint, '#FFFFFF', 0.6),
    base: tint,
    shade: mix(tint, '#9C9CD8', 0.38),
    deep: mix(tint, '#6E6AB0', 0.55),
  };
}

function puffs(ctx: LayerCtx, list: readonly [number, number, number][], t: ReturnType<typeof cloudTones>, top: number, bottom: number, floor: number): void {
  // base achatada: as bolotas são recortadas numa linha de chão (nuvem de verdade tem fundo reto)
  const clip = `M0,${fmt(top - 2)}H100V${fmt(floor)}H0Z`;
  let d = '';
  for (const [x, y, r] of list) d += ell(x, y, r, r * 0.84);
  ctx.push(d, t.base, { cp: clip, gf: { t: 'l', x1: 50, y1: top, x2: 50, y2: bottom, s: [[0, t.light], [0.5, t.base], [1, t.shade]] } });
  if (!isLite(ctx)) {
    // sombra própria embaixo à direita de cada bolota, luz no alto à esquerda e a barriga lilás embaixo
    let sh = '';
    let hi = '';
    for (const [x, y, r] of list) {
      const sy = Math.min(y + r * 0.46, floor - 0.6);
      sh += ell(x + r * 0.3, sy, r * 0.82, Math.max(0.3, Math.min(r * 0.4, floor - sy)));
      hi += ell(x - r * 0.3, y - r * 0.4, r * 0.44, r * 0.24, -20);
    }
    ctx.push(sh, t.deep, { o: 0.2, cp: d, b: 0.8 });
    ctx.push(hi, '#FFFFFF', { o: 0.6, cp: d, b: 0.6 });
    ctx.push(`M0,${fmt(floor - 1.8)}H100V${fmt(floor)}H0Z`, t.deep, { o: 0.22, cp: d, b: 0.5 });
  } else {
    ctx.push(`M0,${fmt(floor - 1.6)}H100V${fmt(floor)}H0Z`, t.shade, { o: 0.6, cp: d });
  }
}

function cloudBack(ctx: LayerCtx): void {
  const { an } = ctx;
  const cx = an.cx;
  const y = soleY(ctx);
  const t = cloudTones(ctx.col.vehicle);
  floorShadow(ctx, cx, 135, 27, 1.7, 0.34, 1.6);
  // cúmulo de trás: bolotas de tamanhos desencontrados, o miolo mais alto e as pontas baixinhas
  puffs(
    ctx,
    [
      [cx - 29, y + 2.2, 3.4],
      [cx - 23, y + 0.2, 5.2],
      [cx - 14.5, y - 3.2, 7.4],
      [cx - 4, y - 5.4, 8.8],
      [cx + 7.5, y - 4.2, 7.6],
      [cx + 17, y - 1.4, 6.4],
      [cx + 25, y + 1.0, 4.6],
      [cx + 30.5, y + 2.8, 2.8],
    ],
    t,
    y - 14,
    y + 5,
    y + 5.2,
  );
  sparkles(ctx, [[cx - 34, y - 5, 1.0], [cx + 33, y - 7, 0.8], [cx + 8, y - 15.5, 0.7]], '#FFFFFF');
}

function cloudFront(ctx: LayerCtx): void {
  const { an } = ctx;
  const cx = an.cx;
  const y = soleY(ctx);
  const t = cloudTones(ctx.col.vehicle);
  // bolotas da frente: cobrem a sola e metade do calçado ("pisando na nuvem")
  puffs(
    ctx,
    [
      [cx - 25, y + 3.2, 3.6],
      [cx - 17.5, y + 1.8, 4.8],
      [cx - 8.5, y + 2.6, 4.6],
      [cx + 0.5, y + 1.6, 5.2],
      [cx + 10, y + 2.8, 4.4],
      [cx + 18.5, y + 1.8, 4.8],
      [cx + 25.5, y + 3.6, 3.2],
    ],
    t,
    y - 3.5,
    y + 6.4,
    y + 6.2,
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Disco voador: casco metálico na cor, anel de luzinhas, cúpula de baixo e o facho de luz até o chão
// ---------------------------------------------------------------------------------------------------------------

function ufoBack(ctx: LayerCtx): void {
  const { an } = ctx;
  const cx = an.cx;
  const lite = isLite(ctx);
  const p = paintOf(ctx.col.vehicle);
  const y = soleY(ctx);
  const beam = '#9BFFCF';
  floorShadow(ctx, cx, 135, 26, 1.8, 0.4, 1.4);
  // facho de luz (gradiente que some) da cúpula ao chão + poça de luz
  const by = y + 4.6;
  ctx.push(
    shape([
      [cx - 9, by, 0],
      [cx + 9, by, 0],
      [cx + 17, 135, 0],
      [cx - 17, 135, 0],
    ]),
    beam,
    { gf: { t: 'l', x1: cx, y1: by, x2: cx, y2: 135, s: [[0, beam, 0.5], [1, beam, 0.08]] } },
  );
  ctx.push(ell(cx, 134.8, 18, 1.6), beam, { gf: glowGrad(cx, 134.8, 18, beam, 0.45), g: 'shadow' });
  // cúpula de baixo (vidro escuro com brilho)
  ctx.push(ell(cx, y + 3.6, 12, 2.6), '#1B2430', { gf: { t: 'r', cx, cy: y + 4.2, r: 12, s: [[0, '#BFFFE6'], [0.35, '#3D7A6E'], [1, '#141B24']] } });
  // casco: face de baixo escura e borda (anel) de lado
  const hullD = ell(cx, y + 1.4, 32, 4.0);
  ctx.push(hullD, p.lo, { gf: { t: 'l', x1: cx, y1: y - 2.6, x2: cx, y2: y + 5.4, s: [[0, p.base], [0.6, p.lo], [1, p.deep]] } });
  // plano de cima (metal polido: céu, horizonte, chão) — aparece atrás e em volta dos pés
  const topD = ell(cx, y - 0.2, 30, 3.6);
  ctx.push(topD, p.base, {
    gf: {
      t: 'l',
      x1: cx - 18,
      y1: y - 3.8,
      x2: cx + 10,
      y2: y + 3.4,
      s: [
        [0, mix(p.sky, '#FFFFFF', 0.3)],
        [0.35, p.sky],
        [0.5, p.horizon],
        [0.62, p.base],
        [1, p.hi],
      ],
    },
  });
  ctx.stroke(topD, '#E9EEF8', 0.5, { gs: chromeGrad(cx - 30, y - 3, cx + 30, y + 3) });
  // anel elevado do centro (onde o piloto pisa)
  ctx.stroke(ell(cx, y - 0.4, 15, 1.9), mix(p.deep, '#000000', 0.2), 0.6, { o: 0.6 });
  if (!lite) ctx.stroke(ell(cx, y - 0.6, 15, 1.9), '#FFFFFF', 0.3, { o: 0.4 });
  // luzinhas no anel (arco da frente), cores alternadas com brilho
  const cols = ['#7FFF00', '#FF1493', '#00E5FF'];
  for (let i = 0; i < 9; i++) {
    const a = Math.PI * (0.12 + (0.76 * i) / 8);
    const lx = cx + Math.cos(a) * 31;
    const ly = y + 1.6 + Math.sin(a) * 3.2;
    const c = cols[i % 3];
    ctx.push(ell(lx, ly, 1.0, 0.7), c, { gf: { t: 'r', cx: lx - 0.2, cy: ly - 0.2, r: 1.1, s: [[0, '#FFFFFF'], [0.5, c], [1, mix(c, '#000000', 0.3)]] } });
    if (!lite) ctx.push(ell(lx, ly, 2.4, 1.8), c, { gf: glowGrad(lx, ly, 2.4, c, 0.45) });
  }
  if (!lite) ctx.push(curve([[cx - 24, y - 2.0], [cx - 10, y - 3.2], [cx + 2, y - 3.3]]) + 'L' + `${fmt(cx + 2)},${fmt(y - 2.6)}` + 'Z', '#FFFFFF', { o: 0.18 });
}
