// Objetos mágicos e de luz na mão (dono: pets): estrelinha, poção brilhante, varinha, bola de cristal, lanterna mágica,
// sabre neon e orbe galáctico. Espaço do objeto: origem na pegada, −y rumo ao cotovelo. A luz é material: núcleo quase
// branco, cor saturada em volta e halo desfocado (no 'lite' o halo fica, o detalhe some). Nada de neon sem forma: cada
// um tem estrutura (vidro, metal, madeira) com volume.

import type { HeldDef } from './held';
import { ballGrad, cylX, glow, glassy, metalX, mix, sparkles, tones, type Pen, type SP } from './pets-kit';

const GOLD = '#E8B93A';

function sparkler(q: Pen): string {
  const L = q.lite;
  const wire = q.path([[-0.12, 4.6], [0.12, 4.6], [0.12, -8.8], [-0.12, -8.8]]);
  q.fill(wire, '#8A8E98');
  q.fill(q.taper([[0, -3.4], [0, -8.9]], [0.42, 0.36], { round: true }), '#5A5A62', { gf: q.lg(-0.4, 0, 0.4, 0, [[0, '#7A7A84'], [1, '#3A3A42']]) });
  const cx = 0;
  const cy = -9.4;
  glow(q, cx, cy, 4.6, 4.6, '#FFC24A', 0.5);
  if (!L) {
    // faíscas: raios finos com estrelinha na ponta
    let d = '';
    const tips: [number, number, number][] = [];
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + (i % 3) * 0.2;
      const len = 2.2 + ((i * 37) % 5) * 0.55;
      const x1 = cx + Math.cos(a) * len;
      const y1 = cy + Math.sin(a) * len;
      d += q.path([[cx + Math.cos(a) * 0.7, cy + Math.sin(a) * 0.7], [(cx + x1) / 2 + Math.sin(a) * 0.3, (cy + y1) / 2 - Math.cos(a) * 0.3], [x1, y1]], false);
      if (i % 2 === 0) tips.push([x1, y1, 0.45]);
    }
    q.line(d, '#FFE7A0', 0.14, { o: 0.9 });
    sparkles(q, tips, '#FFFFFF', 0.95);
  } else {
    // pequeno (mapa): os raios finos somem; uma explosão de 8 pontas numa camada só lê como estrelinha acesa
    const burst: SP[] = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const rr = i % 2 ? 1.0 : i % 4 ? 2.4 : 3.2;
      burst.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    q.fill(q.poly(burst), '#FFE7A0', { o: 0.95 });
  }
  q.fill(q.ell(cx, cy, 1.0, 1.0), '#FFFFFF', { gf: q.rg(cx, cy, 1.0, [[0, '#FFFFFF'], [0.6, '#FFF2B0'], [1, '#FFB030']]) });
  return wire;
}

function potion(q: Pen): string {
  const L = q.lite;
  const neck = q.path([[-0.55, -1.6], [0.55, -1.6], [0.6, 2.6], [-0.6, 2.6]]);
  const bulb = q.path([[-0.6, 2.4], [-2.9, 4.4], [-3.6, 6.8], [-2.6, 9.4], [0, 10.4, 0.6], [2.6, 9.4], [3.6, 6.8], [2.9, 4.4], [0.6, 2.4]]);
  glow(q, 0, 6.8, 5.0, 4.8, '#D05BFF', 0.42);
  // líquido luminoso (2/3 de baixo), menisco e bolhas
  const liq = q.path([[-3.4, 5.4], [3.4, 5.4], [3.7, 7.0], [2.6, 9.6], [0, 10.6], [-2.6, 9.6], [-3.7, 7.0]]);
  q.fill(liq, '#C04BFF', { cp: bulb, gf: q.rg(-0.6, 6.4, 5, [[0, '#FFD6FF'], [0.35, '#FF5FD8'], [1, '#7A1AD8']]) });
  if (!L) {
    q.line(q.path([[-3.3, 5.4], [0, 5.9], [3.3, 5.4]], false), '#FFE6FF', 0.2, { o: 0.8, cp: bulb });
    q.line(q.ell(-1.0, 8.0, 0.4, 0.4) + q.ell(1.0, 7.0, 0.3, 0.3) + q.ell(0.2, 9.0, 0.25, 0.25), '#FFFFFF', 0.12, { o: 0.85 });
  }
  glassy(q, bulb, -3.6, 3.6, 2.4, 10.4, '#EAF6FF', 0.2);
  q.line(bulb, '#FFFFFF', 0.16, { o: 0.6 });
  glassy(q, neck, -0.6, 0.6, -1.6, 2.6, '#EAF6FF', 0.3);
  q.line(neck, '#FFFFFF', 0.14, { o: 0.6 });
  // rolha de cortiça e lábio do gargalo
  const K = tones('#B88A5A');
  q.fill(q.path([[-0.75, -1.6, 0.3], [0.75, -1.6, 0.3], [0.68, -3.2, 0.4], [-0.68, -3.2, 0.4]]), K.base, { gf: cylX(q, -0.75, 0.75, 0, K) });
  if (!L) q.fill(q.ell(-0.2, -2.2, 0.12, 0.12) + q.ell(0.25, -2.7, 0.1, 0.1) + q.ell(0.1, -1.9, 0.09, 0.09), K.deep, { o: 0.7 });
  q.fill(q.path([[-0.85, -1.7, 0.4], [0.85, -1.7, 0.4], [0.85, -1.2, 0.4], [-0.85, -1.2, 0.4]]), '#EAF6FF', { o: 0.6 });
  if (!L) sparkles(q, [[-4.2, 3.6, 0.6], [3.8, 9.6, 0.5], [4.4, 4.8, 0.4]], '#FFFFFF', 0.9);
  return neck;
}

function star(q: Pen, cx: number, cy: number, r: number, inner = 0.45): string {
  const pts: SP[] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? r * inner : r;
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, i % 2 ? 0.6 : 0.15]);
  }
  return q.path(pts);
}

function wand(q: Pen): string {
  const L = q.lite;
  const Wd = tones('#3A2418');
  const stick = q.taper([[0, 4.4], [0, -4], [0, -11.2]], [0.55, 0.42, 0.3], { n: 8, round: true });
  q.fill(stick, Wd.base, { gf: cylX(q, -0.55, 0.55, 0, Wd, true) });
  if (!L) {
    // cabo entalhado em espiral e ponteira dourada
    let d = '';
    for (let i = 0; i < 5; i++) d += q.path([[-0.5, 3.6 - i * 1.1], [0.5, 3.0 - i * 1.1]], false);
    q.line(d, Wd.lighter, 0.12, { o: 0.6, cp: stick });
  }
  q.fill(q.ell(0, 4.5, 0.6, 0.45), GOLD, { gf: ballGrad(q, 0, 4.5, 0.6, tones(GOLD)) });
  // estrela dourada com brilho e rastro de cintilas
  const cy = -12.8;
  glow(q, 0, cy, 3.4, 3.4, '#FFE27A', 0.45);
  // a estrela fica alinhada com a tela (ponta pra cima, luz de cima-esquerda) qualquer que seja o giro da varinha
  // pequeno (mapa): a estrela é o que identifica a varinha; cresce mais que a haste
  const s = q.sub(0, cy, L ? 1.4 : 1, -q.rot);
  const st = star(s, 0, 0, 2.0);
  const G = tones(GOLD);
  s.fill(st, G.base, { gf: s.lg(-1.7, -1.7, 1.7, 1.7, [[0, '#FFF6C8'], [0.5, G.light], [1, G.shade]]) });
  if (!L) {
    s.fill(star(s, -0.25, -0.25, 0.9), '#FFFFFF', { o: 0.55, b: 0.2 });
    sparkles(s, [[2.6, -2.2, 0.75], [-2.4, 1.4, 0.55], [1.8, 3.2, 0.45], [-1.2, -3.6, 0.5]], '#FFFFFF', 0.95);
  }
  return stick;
}

function crystalBall(q: Pen): string {
  const L = q.lite;
  const G = tones(GOLD);
  const cx = 0;
  const cy = -4.6;
  const r = 3.2;
  glow(q, cx, cy, r * 1.7, r * 1.7, '#9B6BFF', 0.42);
  // suporte dourado de garras (na mão)
  const stand = q.path([[-1.7, 1.8, 0.3], [1.7, 1.8, 0.3], [1.1, -1.3], [1.9, -2.0, 0], [0.6, -1.8], [0, -1.3], [-0.6, -1.8], [-1.9, -2.0, 0], [-1.1, -1.3]]);
  q.fill(stand, G.base, { gf: metalX(q, -1.9, 1.9, 0, GOLD) });
  // esfera: névoa em espiral, estrelas, reflexo forte
  const ball = q.ell(cx, cy, r, r);
  q.fill(ball, '#3A2A8A', { gf: q.rg(cx + 0.6, cy + 0.8, r * 1.2, [[0, '#B98CFF'], [0.5, '#5A3AC8'], [1, '#1A1050']]) });
  if (!L) {
    q.fill(q.taper([[cx - 2.2, cy + 1.0], [cx - 0.6, cy - 0.6], [cx + 1.2, cy + 0.2], [cx + 2.0, cy - 1.4]], [0.2, 0.9, 0.7, 0.1], { n: 10 }), '#FF9AE8', { o: 0.55, b: 0.5, cp: ball });
    q.fill(q.taper([[cx - 1.6, cy - 1.8], [cx + 0.4, cy - 1.0], [cx + 1.8, cy + 1.4]], [0.1, 0.7, 0.1], { n: 8 }), '#9FE8FF', { o: 0.45, b: 0.5, cp: ball });
    let d = '';
    for (const [x, y, s] of [
      [-1.2, -0.6, 0.12],
      [1.0, 1.0, 0.1],
      [0.4, -1.6, 0.14],
      [-0.4, 1.6, 0.1],
      [1.6, -0.4, 0.09],
    ] as const)
      d += q.ell(cx + x, cy + y, s, s);
    q.fill(d, '#FFFFFF', { o: 0.9, cp: ball });
  }
  q.fill(q.taper([[cx - 2.2, cy - 0.6], [cx - 1.6, cy - 2.2], [cx - 0.2, cy - 2.9]], [0.25, 0.6, 0.2], { round: true }), '#FFFFFF', { o: 0.8 });
  q.line(ball, '#E8E0FF', 0.18, { o: 0.6 });
  return stand;
}

function lantern(q: Pen): string {
  const L = q.lite;
  const Br = tones('#6A4A2A');
  // argola na mão e alça até o topo da lanterna (pende embaixo)
  const ring = q.ell(0, -0.4, 1.4, 1.6);
  q.line(ring, Br.light, 0.38);
  q.line(q.path([[0, 1.2], [0, 3.6]], false), Br.base, 0.3);
  const cx = 0;
  const cy = 8.2;
  glow(q, cx, cy, 5.4, 5.6, '#FFB347', 0.5);
  // telhado em cúpula, vidros com a chama, base
  const roof = q.path([[cx - 2.6, cy - 2.6], [cx, cy - 4.8, 0.6], [cx + 2.6, cy - 2.6]]);
  q.fill(roof, Br.base, { gf: metalX(q, cx - 2.6, cx + 2.6, 0, '#8A6A3A') });
  q.fill(q.ell(cx, cy - 4.9, 0.45, 0.45), Br.light);
  const glassD = q.path([[cx - 2.2, cy - 2.6], [cx + 2.2, cy - 2.6], [cx + 2.4, cy + 2.6], [cx - 2.4, cy + 2.6]]);
  q.fill(glassD, '#FFD27A', { gf: q.rg(cx, cy + 0.4, 3.4, [[0, '#FFFBE6'], [0.4, '#FFD27A'], [1, '#E8862A']]) });
  // chama
  q.fill(q.path([[cx, cy - 1.6, 0], [cx + 0.75, cy + 0.4], [cx, cy + 1.2, 0.6], [cx - 0.75, cy + 0.4]]), '#FFFFFF', { gf: q.lg(cx, cy - 1.6, cx, cy + 1.2, [[0, '#FFB030'], [0.5, '#FFF2B0'], [1, '#FFFFFF']]) });
  // armação metálica
  q.line(q.path([[cx - 2.2, cy - 2.6], [cx - 2.4, cy + 2.6]], false) + q.path([[cx + 2.2, cy - 2.6], [cx + 2.4, cy + 2.6]], false) + q.path([[cx, cy - 2.6], [cx, cy + 2.6]], false), Br.deep, 0.32);
  if (!L) q.fill(q.path([[cx - 1.9, cy - 2.2], [cx - 1.3, cy - 2.2], [cx - 1.5, cy + 2.2], [cx - 2.0, cy + 2.2]]), '#FFFFFF', { o: 0.4 });
  q.fill(q.path([[cx - 2.9, cy + 2.5, 0.3], [cx + 2.9, cy + 2.5, 0.3], [cx + 2.4, cy + 3.6, 0.3], [cx - 2.4, cy + 3.6, 0.3]]), Br.base, { gf: metalX(q, cx - 2.9, cx + 2.9, 0, '#8A6A3A') });
  if (!L) sparkles(q, [[cx - 4.0, cy - 2.0, 0.55], [cx + 3.8, cy + 3.4, 0.45]], '#FFF2C8', 0.9);
  return ring;
}

function saber(q: Pen): string {
  const L = q.lite;
  const blade = q.path([[-0.5, -4.0], [0.5, -4.0], [0.9, -14], [0.5, -21.0], [-0.2, -24.2, 0], [-0.4, -21.0], [-0.4, -14]]);
  // halo largo, lâmina com núcleo branco
  q.fill(blade, '#FF2FB8', { o: L ? 0.45 : 0.55, b: 1.6 });
  q.fill(blade, '#FF4FD0', { gf: q.lg(-0.5, 0, 0.9, 0, [[0, '#FFB8EE'], [0.45, '#FFFFFF'], [0.7, '#FF8AE2'], [1, '#C21A9A']]) });
  if (!L) q.line(q.path([[0.05, -4.4], [0.35, -14], [0.05, -22.6]], false), '#FFFFFF', 0.22, { o: 0.9 });
  // guarda redonda e cabo trançado
  const H = tones('#2A2A34');
  q.fill(q.ell(0, -3.8, 1.9, 0.6), '#B8BCC6', { gf: metalX(q, -1.9, 1.9, 0, '#B8BCC6') });
  const hilt = q.path([[-0.65, -3.4], [0.65, -3.4], [0.62, 4.0], [-0.62, 4.0]]);
  q.fill(hilt, H.base, { gf: cylX(q, -0.65, 0.65, 0, H, true) });
  if (!L) {
    let d = '';
    for (let i = 0; i < 7; i++) d += q.path([[-0.6, -2.8 + i * 1.0], [0.6, -2.3 + i * 1.0]], false) + q.path([[0.6, -2.8 + i * 1.0], [-0.6, -2.3 + i * 1.0]], false);
    q.line(d, '#55E0FF', 0.1, { o: 0.55, cp: hilt });
  }
  q.fill(q.ell(0, 4.2, 0.7, 0.4), '#B8BCC6', { gf: metalX(q, -0.7, 0.7, 0, '#B8BCC6') });
  return hilt;
}

function orb(q: Pen): string {
  const L = q.lite;
  const cx = 0.6;
  const cy = 0.4;
  const r = 3.1;
  glow(q, cx, cy, r * 1.8, r * 1.8, '#7A5BFF', 0.5);
  const ball = q.ell(cx, cy, r, r);
  q.fill(ball, '#1A1450', { gf: q.rg(cx - 0.4, cy - 0.4, r * 1.15, [[0, '#4A3AC8'], [0.6, '#1E1660'], [1, '#08061E']]) });
  if (!L) {
    // nebulosa em espiral e estrelas
    q.fill(q.taper([[cx - 2.4, cy + 0.8], [cx - 0.8, cy - 1.2], [cx + 1.2, cy - 0.6], [cx + 1.6, cy + 1.2], [cx + 0.2, cy + 1.6]], [0.1, 1.0, 1.1, 0.7, 0.1], { n: 12 }), '#FF5FD0', { o: 0.6, b: 0.6, cp: ball });
    q.fill(q.taper([[cx - 1.2, cy + 2.2], [cx + 0.6, cy + 0.6], [cx + 2.2, cy - 1.8]], [0.1, 0.8, 0.1], { n: 8 }), '#5FE8FF', { o: 0.5, b: 0.6, cp: ball });
    let d = '';
    for (let i = 0; i < 14; i++) {
      const a = i * 2.399;
      const rr = 0.7 * Math.sqrt(i + 0.5);
      d += q.ell(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 0.09 + (i % 3) * 0.04, 0.09 + (i % 3) * 0.04);
    }
    q.fill(d, '#FFFFFF', { o: 0.95, cp: ball });
    // anel de energia em volta (órbita inclinada)
    q.line(q.ell(cx, cy, r * 1.45, r * 0.42, -18), mix('#9FE8FF', '#FFFFFF', 0.4), 0.18, { o: 0.75 });
    sparkles(q, [[cx + r * 1.35, cy - 1.6, 0.6], [cx - r * 1.3, cy + 1.4, 0.5]], '#FFFFFF', 0.95);
  }
  q.fill(q.taper([[cx - 2.2, cy - 0.4], [cx - 1.6, cy - 2.0], [cx - 0.3, cy - 2.7]], [0.2, 0.55, 0.15], { round: true }), '#FFFFFF', { o: 0.75 });
  q.line(ball, '#C8BEFF', 0.18, { o: 0.7 });
  return ball;
}

export const HELD_MAGIC: Record<string, HeldDef> = {
  sparkler: { draw: sparkler, rot: 10 },
  potion: { draw: potion },
  // estrela além das pontas dos dedos, pro lado de fora: no repouso a varinha fica baixada; com o braço erguido aponta pro alto
  // erguida (animação 'magic') a estrela não pode sair do quadro do mapa
  wand: { draw: wand, rot: 152, liteK: 1.3 },
  crystal_ball: { draw: crystalBall, dy: -0.6 },
  lantern: { draw: lantern },
  saber: { draw: saber, rot: 26, liteK: 1.25 },
  orb: { draw: orb },
};
