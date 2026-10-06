// Pescoço (slot `neck`, etapa 11, grupo do tronco): colar, corrente dourada, cachecol, pérolas, gravata, gravata-
// borboleta, lenço de seda, bandana, colar havaiano, choker, medalha e amuleto. Dono: guarda-roupa (parte de cima).
//
// O pescoço de pele (etapa 16) é desenhado DEPOIS e cobre tudo acima da curva do decote: colares nascem nos cantos da
// gola (parecem passar por trás do pescoço). Peças que abraçam o pescoço (cachecol, lenço, bandana, choker) pedem ao
// corpo, via clothes.neckCoverY, que o pescoço pare no alto delas — e desenham daí pra baixo.

import type { AvatarConfig } from '@cruzei/shared-types';

import { headAnchors, smoothPath, taperPath, type Anatomy, type SP } from '../anatomy';
import type { LayerCtx } from '../ctx';
import { circle, fmt } from '../geometry';
import { blob, isLite, lodCtx, mix, speckle, starPath } from '../shading';
import type { Pt } from '../types';

import { NONE, rng, sampleOn, skinOf, toneOf, topDef } from './clothes-kit';
import { bowTie } from './clothes-tops';

/** colares que moravam no slot `accessory` (config antiga sem normalizar) */
const LEGACY_NECK = ['necklace', 'chain', 'scarf'];

/** id do item de pescoço (slot `neck`; aceita o `accessory` antigo enquanto a config não foi normalizada) */
export function neckItem(cfg: AvatarConfig): string {
  const n = cfg.neck;
  if (n && n !== NONE) return n;
  return LEGACY_NECK.includes(cfg.accessory) ? cfg.accessory : NONE;
}

/** altura da choker no pescoço */
export function chokerY(an: Anatomy): number {
  const chin = headAnchors(an).chin[1];
  return chin + (an.collarY - 2.6 - chin) * 0.52;
}

/** ouro: gradiente pra metal dourado pequeno (pingente, medalha, fecho) */
function goldGrad(x: number, y: number, r: number) {
  return { t: 'r' as const, cx: x - r * 0.35, cy: y - r * 0.4, r: r * 1.5, s: [[0, '#FFF4C2'], [0.45, '#F2C94C'], [0.8, '#C08A1E'], [1, '#7A5410']] as const };
}

/** curva em U de um colar: dos cantos da gola até `depth` abaixo do decote */
function chainCurve(an: Anatomy, w: number, depth: number, n = 9): SP[] {
  const { cx } = an;
  const y0 = an.collarY - 2.6 + 0.2;
  const yb = an.collarY + depth;
  const pts: SP[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const x = cx - w + 2 * w * u;
    const k = 1 - Math.pow(Math.abs(2 * u - 1), 1.6);
    pts.push([x, y0 + (yb - y0) * k + (u < 0.5 ? 0.15 : 0)]);
  }
  return pts;
}

/** sombra fina de um colar na roupa/pele (dá volume e "assenta" o colar) */
function castShadow(ctx: LayerCtx, pts: readonly SP[], w: number, o = 0.3): void {
  const lite = isLite(ctx);
  ctx.stroke(smoothPath(pts.map((p) => [p[0] + 0.2, p[1] + w * 0.6] as SP), false), '#0A0610', w * 1.3, { o, ...(lite ? {} : { b: 0.3 }) });
}

/** pedaço de pescoço de pele abaixo de uma peça que abraça o pescoço (choker): até a gola da roupa */
function lowerNeck(ctx: LayerCtx, yTop: number): void {
  const { an } = ctx;
  const { cx } = an;
  const t = skinOf(ctx);
  const nw = an.w.neck;
  const cw = an.collarW;
  const d = smoothPath([[cx - nw, yTop, 0], [cx + nw, yTop, 0], [cx + nw + 0.2, yTop + 1.2], [cx + cw - 0.4, an.collarY - 2.3], [cx, an.collarY - 0.3], [cx - cw + 0.4, an.collarY - 2.3], [cx - nw - 0.2, yTop + 1.2]]);
  ctx.push(d, t.base, { gf: { t: 'l', x1: cx - nw - 2, y1: 0, x2: cx + nw + 2, y2: 0, s: [[0, t.light], [0.32, t.base], [0.72, t.shade], [1, t.shade]] } });
  ctx.push(blob(cx, an.collarY - 0.9, 0.9, 0.55), t.deep, { o: 0.26, ...(isLite(ctx) ? {} : { b: 0.3 }), cp: d });
}

/** faixa que abraça o pescoço (cachecol, lenço, bandana): do alto `yTop` até a base, mais larga embaixo */
function neckWrap(an: Anatomy, yTop: number, thick: number): string {
  const { cx } = an;
  const nw = an.w.neck + thick;
  const cw = an.collarW + thick * 0.8;
  const yb = an.collarY - 0.4;
  return smoothPath([[cx - nw, yTop + 0.3], [cx, yTop - 0.3], [cx + nw, yTop + 0.3], [cx + nw + 0.4, (yTop + yb) / 2], [cx + cw, an.collarY - 2.0], [cx + cw * 0.5, yb + 0.9], [cx, yb + 1.3], [cx - cw * 0.5, yb + 0.9], [cx - cw, an.collarY - 2.0], [cx - nw - 0.4, (yTop + yb) / 2]]);
}

export function drawNeck(ctx0: LayerCtx): void {
  const ctx = lodCtx(ctx0);
  const { an, cfg } = ctx;
  const { cx } = an;
  const lite = isLite(ctx);
  const item = neckItem(cfg);
  if (item === NONE) return;
  ctx.group('body');
  const chin = headAnchors(an).chin[1];
  switch (item) {
    case 'necklace': {
      // corrente fina dourada com pingente em gota
      const pts = chainCurve(an, an.collarW + 0.2, 4.6);
      castShadow(ctx, pts, 0.3, 0.28);
      ctx.stroke(smoothPath(pts, false), '#E0B64A', lite ? 0.5 : 0.36);
      if (!lite) ctx.stroke(smoothPath(pts, false), '#FFF1B8', 0.14, { o: 0.8, da: [0.35, 0.3] });
      const p = sampleOn(pts, 0.5);
      const drop = smoothPath([[p[0], p[1] + 0.2, 0], [p[0] + 0.75, p[1] + 1.5], [p[0], p[1] + 2.5], [p[0] - 0.75, p[1] + 1.5]]);
      ctx.push(drop, '#0A0610', { o: 0.25, ...(lite ? {} : { b: 0.3 }) });
      ctx.push(drop, '#F2C94C', { gf: goldGrad(p[0], p[1] + 1.4, 0.9) });
      break;
    }
    case 'chain': {
      // corrente grossa (elos alternados em ouro) com brilho
      const pts = chainCurve(an, an.collarW + 1.0, 6.2, 12);
      castShadow(ctx, pts, 0.9, 0.35);
      ctx.stroke(smoothPath(pts, false), '#C8962A', lite ? 1.3 : 1.1);
      if (!lite) {
        let links = '';
        for (let i = 0; i <= 26; i++) {
          const a = sampleOn(pts, i / 26);
          const b = sampleOn(pts, Math.min(1, i / 26 + 0.01));
          const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) + (i % 2 ? 0.5 : -0.5);
          links += blob(a[0], a[1], 0.55, 0.32, ang);
        }
        ctx.push(links, '#F2C94C', { gf: { t: 'l', x1: cx - 6, y1: an.collarY - 3, x2: cx + 6, y2: an.collarY + 6, s: [[0, '#FFF0B0'], [0.5, '#E8B640'], [1, '#9A6A16']] } });
        ctx.stroke(smoothPath(pts.map((q) => [q[0] - 0.2, q[1] - 0.25] as SP), false), '#FFFBE0', 0.18, { o: 0.75, da: [0.3, 0.8] });
      } else ctx.stroke(smoothPath(pts, false), '#F2C94C', 0.6);
      break;
    }
    case 'pearls': {
      const pts = chainCurve(an, an.collarW + 0.4, 3.6, 10);
      castShadow(ctx, pts, 0.5, 0.25);
      const n = lite ? 12 : 19;
      let d = '';
      let hl = '';
      for (let i = 0; i <= n; i++) {
        const p = sampleOn(pts, i / n);
        d += circle(p[0], p[1], 0.48);
        hl += circle(p[0] - 0.15, p[1] - 0.17, 0.15);
      }
      ctx.push(d, '#F4EFE6', { gf: { t: 'l', x1: cx - 5, y1: an.collarY - 3, x2: cx + 5, y2: an.collarY + 4, s: [[0, '#FFFFFF'], [0.6, '#EDE6DA'], [1, '#C9BFB2']] } });
      if (!lite) ctx.push(hl, '#FFFFFF', { o: 0.9 });
      break;
    }
    case 'scarf': {
      // cachecol de tricô vermelho: volta grossa no pescoço + uma ponta caindo no peito, com canelado e franja
      const red = '#C0392B';
      const t = toneOf(red, 'knit');
      const wrap = neckWrap(an, chin + 2.2, 2.2);
      ctx.push(wrap, '#0A0610', { o: 0.3, ...(lite ? {} : { b: 0.7 }) });
      ctx.push(wrap, red, { gf: { t: 'l', x1: cx - 8, y1: 0, x2: cx + 8, y2: 0, s: [[0, t.light], [0.35, t.base], [0.8, t.shade], [1, t.deep]] } });
      // dobra da volta (a de cima por cima da de baixo)
      ctx.push(taperPath([[cx - an.w.neck - 2, chin + 4.6], [cx, chin + 5.6], [cx + an.w.neck + 2.2, chin + 4.4]], [0.4, 1.0, 0.4]), t.deep, { o: 0.45, ...(lite ? {} : { b: 0.3 }), cp: wrap });
      // ponta caindo pela frente (lado direito da tela), um pouco torcida
      const x0 = cx + 2.2;
      const y0 = an.collarY - 0.5;
      const L = 13;
      const tail = smoothPath([[x0 - 1.6, y0, 0.5], [x0 + 2.0, y0 - 0.2, 0.5], [x0 + 2.4, y0 + L * 0.5], [x0 + 2.0, y0 + L, 0], [x0 - 1.5, y0 + L - 0.2, 0], [x0 - 1.3, y0 + L * 0.5]]);
      ctx.push(tail, '#0A0610', { o: 0.3, ...(lite ? {} : { b: 0.5 }) });
      ctx.push(tail, red, { gf: { t: 'l', x1: x0 - 1.6, y1: 0, x2: x0 + 2.4, y2: 0, s: [[0, t.light], [0.5, t.base], [1, t.shade]] } });
      if (!lite) {
        let rib = '';
        for (let x = x0 - 1.0; x < x0 + 2.2; x += 0.75) rib += `M${fmt(x)},${fmt(y0 + 0.5)}V${fmt(y0 + L - 0.4)}`;
        for (let x = cx - 7; x < cx + 7; x += 0.8) rib += `M${fmt(x)},${fmt(chin + 2)}V${fmt(an.collarY + 1)}`;
        ctx.stroke(rib, t.deep, 0.14, { o: 0.32, cp: tail + wrap });
        // franja
        let fr = '';
        for (let x = x0 - 1.2; x <= x0 + 1.9; x += 0.55) fr += `M${fmt(x)},${fmt(y0 + L - 0.2)}v1.4`;
        ctx.stroke(fr, red, 0.35);
      }
      break;
    }
    case 'tie': {
      // gravata: nó na gola e lâmina até perto da cintura, com listras diagonais discretas e sombra no peito
      const col = '#22396B';
      const t = toneOf(col, 'satin');
      const kTop = topDef(cfg).neck === 'collar' || cfg.top === 'tux' ? an.collarY - 2.2 : an.collarY - 0.9;
      const knot = smoothPath([[cx - 1.2, kTop, 0.4], [cx + 1.3, kTop, 0.4], [cx + 0.8, kTop + 2.0], [cx - 0.7, kTop + 2.0]]);
      const yEnd = an.waistY - 1.5;
      const blade = smoothPath([[cx - 0.75, kTop + 1.8], [cx + 0.85, kTop + 1.8], [cx + 1.9, yEnd - 2.4], [cx + 0.1, yEnd, 0], [cx - 1.7, yEnd - 2.4]]);
      ctx.push(blade, '#0A0610', { o: 0.3, ...(lite ? {} : { b: 0.5 }) });
      ctx.push(blade, col, { gf: { t: 'l', x1: cx - 2, y1: 0, x2: cx + 2, y2: 0, s: [[0, t.light], [0.4, t.base], [1, t.shade]] } });
      if (!lite) {
        let st = '';
        for (let y = kTop + 3; y < yEnd; y += 2.2) st += `M${fmt(cx - 2.5)},${fmt(y + 1.4)}L${fmt(cx + 2.5)},${fmt(y - 0.6)}`;
        ctx.stroke(st, '#C9A44A', 0.3, { o: 0.75, cp: blade });
      }
      ctx.push(knot, col, { gf: { t: 'l', x1: cx - 1.2, y1: kTop, x2: cx + 1.2, y2: kTop + 2, s: [[0, t.light], [1, t.shade]] } });
      ctx.push(taperPath([[cx - 0.6, kTop + 2.05], [cx + 0.7, kTop + 2.05]], [0.35, 0.35]), t.deep, { o: 0.5 });
      break;
    }
    case 'bowtie':
      bowTie(ctx, cx, topDef(cfg).neck === 'collar' || cfg.top === 'tux' ? an.collarY - 1.6 : an.collarY - 0.6, '#16161E');
      break;
    case 'silk': {
      // lenço de seda amarrado de lado: faixa no pescoço + nó e duas pontas, bolinhas douradas
      const col = '#8E2A4A';
      const t = toneOf(col, 'satin');
      const wrap = neckWrap(an, an.collarY - 4.2, 0.9);
      ctx.push(wrap, '#0A0610', { o: 0.25, ...(lite ? {} : { b: 0.5 }) });
      ctx.push(wrap, col, { gf: { t: 'l', x1: cx - 6, y1: 0, x2: cx + 6, y2: 0, s: [[0, t.light], [0.4, t.base], [1, t.shade]] } });
      // nó um pouco pro lado e duas pontas largas que caem em leque, cortadas na diagonal, com a dobra no meio
      const kx = cx - an.collarW * 0.45;
      const ky = an.collarY - 1.0;
      const tail = (dx: number, len: number, w0: number, w1: number): string => {
        const L = Math.hypot(dx, len);
        const ux = dx / L;
        const uy = len / L;
        const nx = -uy;
        const ny = ux;
        const tip: Pt = [kx + dx, ky + len];
        return smoothPath([
          [kx + nx * w0, ky + ny * w0, 0.4],
          [kx + dx * 0.5 + nx * (w0 + w1) * 0.55, ky + len * 0.5 + ny * (w0 + w1) * 0.55],
          [tip[0] + nx * w1, tip[1] + ny * w1 - 0.5, 0],
          [tip[0] - nx * w1, tip[1] - ny * w1 + 0.5, 0],
          [kx + dx * 0.5 - nx * (w0 + w1) * 0.5, ky + len * 0.5 - ny * (w0 + w1) * 0.5],
          [kx - nx * w0, ky - ny * w0, 0.4],
        ]);
      };
      const eL = tail(-2.2, 5.2, 0.7, 1.35);
      const eR = tail(1.3, 5.8, 0.7, 1.25);
      ctx.push(eL + eR, '#0A0610', { o: 0.28, ...(lite ? {} : { b: 0.45 }) });
      ctx.push(eR, col, { gf: { t: 'l', x1: kx, y1: ky, x2: kx + 2.6, y2: ky + 5.8, s: [[0, t.base], [0.6, t.shade], [1, t.deep]] } });
      ctx.push(eL, col, { gf: { t: 'l', x1: kx - 3, y1: ky, x2: kx + 0.5, y2: ky + 5.2, s: [[0, t.light], [0.5, t.base], [1, t.shade]] } });
      if (!lite) {
        ctx.stroke(smoothPath([[kx - 0.3, ky + 0.8], [kx - 1.2, ky + 3.0], [kx - 1.9, ky + 4.9]], false), t.deep, 0.3, { o: 0.45, cp: eL });
        ctx.stroke(smoothPath([[kx - 0.6, ky + 0.6], [kx - 1.6, ky + 3.0], [kx - 2.6, ky + 4.6]], false), t.light, 0.22, { o: 0.5, cp: eL });
      }
      const knot = smoothPath([[kx - 1.1, ky - 0.7], [kx + 1.0, ky - 0.9], [kx + 1.25, ky + 0.5], [kx - 0.1, ky + 1.2], [kx - 1.3, ky + 0.6]]);
      ctx.push(knot, col, { gf: { t: 'r', cx: kx - 0.5, cy: ky - 0.4, r: 1.7, s: [[0, mix(t.light, '#FFFFFF', 0.2)], [0.55, t.base], [1, t.shade]] } });
      if (!lite) ctx.stroke(smoothPath([[kx - 0.7, ky - 0.2], [kx + 0.2, ky + 0.25], [kx + 0.9, ky - 0.3]], false), t.deep, 0.22, { o: 0.5, cp: knot });
      if (!lite) speckle(ctx, { x: cx - 8, y: an.collarY - 5, w: 16, h: 12 }, '#F2C94C', { n: 30, r: [0.13, 0.18], seed: 17, o: 0.85, cp: wrap + eL + eR + knot });
      break;
    }
    case 'bandana': {
      // bandana dobrada em triângulo: volta no pescoço + ponta caindo no peito, estampa de pontinhos e "lágrimas"
      const col = '#B3262E';
      const t = toneOf(col, 'cotton');
      const wrap = neckWrap(an, an.collarY - 4.2, 1.1);
      const tri = smoothPath([[cx - an.collarW - 0.6, an.collarY - 2.0], [cx + an.collarW + 0.6, an.collarY - 2.0], [cx + 0.6, an.collarY + 5.6, 0], [cx - 0.2, an.collarY + 5.8, 0]]);
      ctx.push(tri + wrap, '#0A0610', { o: 0.28, ...(lite ? {} : { b: 0.5 }) });
      ctx.push(wrap, col, { gf: { t: 'l', x1: cx - 6, y1: 0, x2: cx + 6, y2: 0, s: [[0, t.light], [0.4, t.base], [1, t.shade]] } });
      ctx.push(tri, col, { gf: { t: 'l', x1: cx - 5, y1: an.collarY - 2, x2: cx + 3, y2: an.collarY + 6, s: [[0, t.light], [0.5, t.base], [1, t.shade]] } });
      if (!lite) {
        speckle(ctx, { x: cx - 7, y: an.collarY - 5, w: 14, h: 11 }, '#F4EFE6', { n: 30, r: [0.12, 0.2], seed: 5, o: 0.9, cp: tri + wrap });
        ctx.stroke(smoothPath([[cx - an.collarW + 0.4, an.collarY - 1.2], [cx + 0.2, an.collarY + 4.8], [cx + an.collarW - 0.4, an.collarY - 1.2]], false), '#F4EFE6', 0.2, { o: 0.7, da: [0.4, 0.3], cp: tri });
      }
      break;
    }
    case 'lei': {
      // colar havaiano: flores pequenas (rosa, amarelo, branco) em volta do pescoço até o peito
      const pts = chainCurve(an, an.collarW + 2.6, 7.2, 12);
      castShadow(ctx, pts, 1.4, 0.3);
      const cols = ['#FF5E8A', '#FFC93C', '#FFFFFF', '#FF8A3D'];
      const n = lite ? 12 : 20;
      const r = rng(11);
      const byCol: string[] = cols.map(() => '');
      let centers = '';
      for (let i = 0; i <= n; i++) {
        const p = sampleOn(pts, i / n);
        const k = i % cols.length;
        const rr = 1.05;
        let f = '';
        for (let j = 0; j < 5; j++) {
          const a = (j * Math.PI * 2) / 5 + r() * 1.2;
          f += blob(p[0] + Math.cos(a) * rr * 0.55, p[1] + Math.sin(a) * rr * 0.55, rr * 0.5, rr * 0.36, a);
        }
        byCol[k] += f;
        centers += blob(p[0], p[1], 0.25, 0.25);
      }
      byCol.forEach((d, k) => ctx.push(d, cols[k], { gf: { t: 'r', cx, cy: an.collarY, r: 12, s: [[0, mix(cols[k], '#FFFFFF', 0.25)], [1, mix(cols[k], '#802040', 0.25)]] } }));
      if (!lite) ctx.push(centers, '#FFE27A', { o: 0.95 });
      break;
    }
    case 'choker': {
      // choker de veludo preto com um pingentinho dourado; abaixo dela o pescoço de pele continua até a gola
      const y = chokerY(an);
      lowerNeck(ctx, y - 0.3);
      const nw = an.w.neck + 0.15;
      const band = smoothPath([[cx - nw, y - 0.55, 0], [cx, y - 0.25], [cx + nw, y - 0.55, 0], [cx + nw, y + 0.6, 0], [cx, y + 0.95], [cx - nw, y + 0.6, 0]]);
      ctx.push(band, '#141418', { gf: { t: 'l', x1: cx - nw, y1: 0, x2: cx + nw, y2: 0, s: [[0, '#4A4A58'], [0.3, '#1C1C24'], [1, '#08080C']] } });
      ctx.push(starPath(cx + 0.1, y + 1.7, 0.75, 4, 0.4), '#F2C94C', { gf: goldGrad(cx, y + 1.6, 0.8) });
      ctx.stroke(`M${fmt(cx + 0.1)},${fmt(y + 0.8)}V${fmt(y + 1.1)}`, '#C08A1E', 0.2);
      break;
    }
    case 'medal': {
      // medalha de ouro numa fita listrada em V
      const my = an.collarY + 8.5;
      const rib = (g: number): string => smoothPath([[cx + g * (an.collarW - 0.2), an.collarY - 2.4, 0], [cx + g * (an.collarW + 1.2), an.collarY - 2.2, 0], [cx + g * 0.9, my - 0.9, 0], [cx - g * 0.4, my - 1.5, 0]]);
      ctx.push(rib(-1) + rib(1), '#0A0610', { o: 0.28, ...(lite ? {} : { b: 0.4 }) });
      ctx.push(rib(-1), '#2F6BD8');
      ctx.push(rib(1), '#D8343F');
      if (!lite) ctx.stroke(smoothPath([[cx - an.collarW + 0.5, an.collarY - 2.2], [cx - 0.3, my - 1.2]], false) + smoothPath([[cx + an.collarW - 0.5, an.collarY - 2.2], [cx + 0.3, my - 1.2]], false), '#FFFFFF', 0.3, { o: 0.85 });
      ctx.push(circle(cx + 0.25, my + 0.4, 2.3), '#0A0610', { o: 0.3, ...(lite ? {} : { b: 0.4 }) });
      ctx.push(circle(cx, my, 2.2), '#F2C94C', { gf: goldGrad(cx, my, 2.2) });
      ctx.stroke(circle(cx, my, 1.6), '#B07C18', 0.25, { o: 0.8 });
      ctx.push(starPath(cx, my + 0.05, 1.05, 5, 0.45), '#C8962A', { o: 0.9 });
      if (!lite) ctx.push(blob(cx - 0.8, my - 0.9, 0.6, 0.35, -0.6), '#FFFFFF', { o: 0.75 });
      break;
    }
    case 'amulet': {
      // amuleto mágico: cordão fino + gema que brilha num engaste dourado, com halo
      const pts = chainCurve(an, an.collarW + 0.3, 6.2);
      castShadow(ctx, pts, 0.3, 0.25);
      ctx.stroke(smoothPath(pts, false), '#C8962A', lite ? 0.5 : 0.38);
      const p = sampleOn(pts, 0.5);
      const gy = p[1] + 2.2;
      const set = smoothPath([[p[0], gy - 2.0, 0], [p[0] + 1.6, gy, 0.5], [p[0], gy + 2.2, 0], [p[0] - 1.6, gy, 0.5]]);
      const gem = smoothPath([[p[0], gy - 1.3, 0], [p[0] + 1.0, gy, 0.5], [p[0], gy + 1.5, 0], [p[0] - 1.0, gy, 0.5]]);
      if (!lite) ctx.push(blob(p[0], gy, 3.2, 3.2), '#7CF7FF', { o: 0.35, b: 1.2 });
      ctx.push(set, '#F2C94C', { gf: goldGrad(p[0], gy, 2) });
      ctx.push(gem, '#3FD8E8', { gf: { t: 'r', cx: p[0] - 0.3, cy: gy - 0.5, r: 1.8, s: [[0, '#E8FFFF'], [0.35, '#5EF2FF'], [0.75, '#7B5CFF'], [1, '#2A1A6A']] } });
      ctx.push(starPath(p[0] - 0.35, gy - 0.5, 0.55, 4, 0.25), '#FFFFFF', { o: 0.95 });
      break;
    }
    default:
      break;
  }
}

/** pra testes: os 12 itens de pescoço desenhados aqui */
export const NECK_ITEMS = ['necklace', 'chain', 'scarf', 'pearls', 'tie', 'bowtie', 'silk', 'bandana', 'lei', 'choker', 'medal', 'amulet'] as const;

