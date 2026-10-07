// Itens de orgulho (slot `pride`) estampados com a bandeira escolhida (slot `prideFlag`, via flags.ts). Dono: orgulho.
// Itens voluntários e grátis; nada presume identidade. Só um item por vez (o slot é único).
//
//   pin        pin esmaltado em forma de bandeirinha, banho de ouro, filetes entre as listras e brilho do esmalte
//   heart_pin  coração esmaltado com aro dourado
//   band       pulseira de tecido trançado no pulso DIREITO da tela (gomos da bandeira, nó e pontas)
//   face_paint pintura na maçã do rosto, listras que seguem o osso da bochecha (respeita o formato do rosto)
//   sash       faixa transversal de cetim (ombro esquerdo da tela → quadril direito) com filete dourado, nó e pontas
//   cape       capa da bandeira (atrás, com dobras em leque e barra ondulada) + frente amarrada com broche esmaltado
//   flag       bandeirinha na mão ESQUERDA da tela: haste de madeira com ponteira dourada e pano ondulando. Com
//              BuildOptions.hands.L === 'open' (o palco monta assim as animações de braço erguido) a haste segue o
//              antebraço e fica de pé quando o braço sobe; com o braço solto ela sobe por fora do braço
//
// Etapas do orquestrador (layers.ts), todas com etiqueta k:'pride':
//    3 prideBack (body: capa)  ·  10 prideChest (body: pin, coração, faixa, frente da capa)
//   15 prideWrist (foreR: pulseira)  ·  15 prideHandFlag (foreL: bandeirinha, só se scene.showLeftHandFlag)
//   20 pridePaint (head: pintura no rosto)
// Tudo sai das âncoras da anatomia (bodyAnchors, headAnchors, juntas, contornos): acompanha corpo, rosto e repouso.

import type { AvatarConfig } from '@cruzei/shared-types';

import {
  armAxis,
  bodyAnchors,
  handShapes,
  headAnchors,
  limbWidthAt,
  smoothPath,
  taperPath,
  torsoPath,
  torsoPts,
  torsoXAt,
  forearmPath,
  type Anatomy,
  type SP,
} from '../anatomy';
import type { LayerCtx } from '../ctx';
import { fmt } from '../geometry';
import { blob, cylGradient, isLite, lodCtx, lum, mix, skinTones } from '../shading';
import type { AvatarGradient, AvatarStop, Pt } from '../types';

import {
  bandSurface,
  curvesSurface,
  drawFlagOn,
  flagFolds,
  flagOf,
  flagSequence,
  surfaceLine,
  surfacePath,
  waveFolds,
  waveSurface,
  boxSurface,
  type FlagDef,
  type FlagFold,
  type FlagSurface,
} from './flags';

const NONE = 'none';

/** borda de dentro do antebraço direito da tela em y (o nó da faixa termina antes dela), ou null */
function armInnerR(an: Anatomy, y: number): number | null {
  for (const limb of ['upperArm', 'forearm'] as const) {
    const a = limbWidthAt(an, limb, 'R', 0);
    const b = limbWidthAt(an, limb, 'R', 1);
    if ((y - a.at[1]) * (y - b.at[1]) > 0) continue;
    const q = limbWidthAt(an, limb, 'R', (y - a.at[1]) / (b.at[1] - a.at[1] || 1));
    return q.at[0] - q.l;
  }
  return null;
}

/** ids do slot `pride` que este arquivo desenha */
export const PRIDE_ITEMS = ['pin', 'heart_pin', 'band', 'face_paint', 'sash', 'cape', 'flag'] as const;

// ---------------------------------------------------------------------------------------------------------------
// materiais
// ---------------------------------------------------------------------------------------------------------------

/** banho de ouro: faixas de reflexo na diagonal (luz de cima-esquerda) */
function goldGrad(x0: number, y0: number, x1: number, y1: number): AvatarGradient {
  return {
    t: 'l',
    x1: x0,
    y1: y0,
    x2: x1,
    y2: y1,
    s: [
      [0, '#FFF5CC'],
      [0.28, '#F2C84F'],
      [0.52, '#A8771F'],
      [0.76, '#F4D57E'],
      [1, '#6B470C'],
    ],
  };
}

/** esfera dourada (ponteira, botão) */
function goldBall(cx: number, cy: number, r: number): AvatarGradient {
  return {
    t: 'r',
    cx,
    cy,
    r: r * 1.15,
    fx: cx - r * 0.4,
    fy: cy - r * 0.45,
    s: [
      [0, '#FFFBE6'],
      [0.35, '#F2C84F'],
      [0.8, '#9A6A18'],
      [1, '#5E3E0A'],
    ],
  };
}

const GOLD_LINE = '#E3BC5C';
const GOLD_DEEP = '#6B470C';
const INK = '#120812';

/** gradiente linear entre dois pontos com paradas livres */
function lin(a: Pt, b: Pt, s: readonly AvatarStop[]): AvatarGradient {
  return { t: 'l', x1: a[0], y1: a[1], x2: b[0], y2: b[1], s };
}

/** listras da bandeira num gradiente linear de paradas duras (uma camada; pra peças minúsculas no 'lite') */
function stripeGrad(flag: FlagDef, a: Pt, b: Pt): AvatarGradient {
  const total = flag.stripes.reduce((acc, x) => acc + (x.w ?? 1), 0) || 1;
  const s: AvatarStop[] = [];
  let acc = 0;
  for (const st of flag.stripes) {
    s.push([acc / total, st.hex]);
    acc += st.w ?? 1;
    s.push([Math.min(1, acc / total), st.hex]);
  }
  return lin(a, b, s);
}

/** superfície deslocada (sombra projetada) */
function shifted(s: FlagSurface, dx: number, dy: number): FlagSurface {
  return {
    ...s,
    at: (u, v) => {
      const p = s.at(u, v);
      return [p[0] + dx, p[1] + dy];
    },
  };
}

/** superfície crescida `e` unidades pra todo lado (aro de metal em volta do esmalte) */
function grown(s: FlagSurface, e: number): FlagSurface {
  const du = e / Math.max(0.1, s.aspect * s.height);
  const dv = e / Math.max(0.1, s.height);
  return { ...s, at: (u, v) => s.at(-du + u * (1 + 2 * du), -dv + v * (1 + 2 * dv)) };
}

/** coração girado (mesmas curvas do heartPath do shading, com rotação em radianos) */
function heartRot(cx: number, cy: number, r: number, rot: number): string {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const P = (x: number, y: number) => `${fmt(cx + x * r * c - y * r * s)},${fmt(cy + x * r * s + y * r * c)}`;
  return (
    `M${P(0, 0.92)}` +
    `C${P(-0.22, 0.66)} ${P(-1.08, 0.12)} ${P(-1.02, -0.36)}` +
    `C${P(-0.97, -0.98)} ${P(-0.2, -1.04)} ${P(0, -0.44)}` +
    `C${P(0.2, -1.04)} ${P(0.97, -0.98)} ${P(1.02, -0.36)}` +
    `C${P(1.08, 0.12)} ${P(0.22, 0.66)} ${P(0, 0.92)}Z`
  );
}

/** ponto girado em volta de (cx, cy) */
function rotP(cx: number, cy: number, x: number, y: number, rot: number): Pt {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return [cx + x * c - y * s, cy + x * s + y * c];
}

function norm(x: number, y: number): Pt {
  const L = Math.hypot(x, y) || 1;
  return [x / L, y / L];
}

/**
 * tronco com folga: recorte das sombras de contato no peito (nunca caem no fundo). No 'lite' usa metade dos pontos do
 * contorno: o recorte se repete em cada listra (faixa e capa), e no mapa a diferença não chega a meio pixel
 */
function torsoClip(an: Anatomy, ease = 0.8, lite = false): string {
  if (!lite) return torsoPath(an, { ease });
  return smoothPath(torsoPts(an, { ease }).filter((p, i) => i % 2 === 0 || p[2] === 0), true);
}

/** no 'lite' a superfície da bandeira é amostrada com metade dos pontos (contornos das listras mais leves) */
function lean(s: FlagSurface, lite: boolean): FlagSurface {
  return lite ? { ...s, n: Math.max(6, Math.round((s.n ?? 14) / 2)) } : s;
}

/**
 * lugar do pin no peito (lado esquerdo de quem veste = direita da tela), logo abaixo da clavícula: perto da gola, longe
 * da costura da manga (no corpo cheio a manga começa cedo) e no vão entre as mechas da frente do cabelo longo
 */
export function prideChestSpot(an: Anatomy, cfg?: Pick<AvatarConfig, 'hair'>): Pt {
  // cabelo longo caindo na frente: a mecha da direita cobria metade do broche — vai pro vão do decote, um pouco abaixo
  if (cfg && FRONT_FALL_HAIR.has(cfg.hair)) return [an.cx + an.collarW * 0.35 - 1.0, an.collarY + 6.4 + an.tilt.shoulder * 0.5];
  return [an.cx + an.collarW * 0.6 + 1.0, an.collarY + 5.2 + an.tilt.shoulder * 0.5];
}

/** penteados cujas mechas da frente caem por cima do peito */
const FRONT_FALL_HAIR = new Set(['long', 'wavy', 'curtain', 'long_curly', 'braids', 'twists', 'dreads']);

// ---------------------------------------------------------------------------------------------------------------
// 3. costas: capa
// ---------------------------------------------------------------------------------------------------------------

/** geometria da capa (atrás): curvas de cima (ombros), do meio (cintura) e da barra (ondulada nas dobras) */
function capeSurface(an: Anatomy, skirtHalf = 0): { surf: FlagSurface; folds: FlagFold[] } {
  const { cx } = an;
  const wS = an.w.shoulder;
  const sY = an.shoulderY;
  const tl = an.tilt.shoulder * 0.5;
  const hemY = an.seated ? an.hj + 9 : Math.min(124, an.joints.kneeL[1] + 13.5);
  const midY = an.seated ? an.waistY + 2 : an.waistY + 3;
  // saia longa e larga na frente (vestido de gala, túnica): a capa abre mais que ela e emoldura dos dois lados (senão
  // sobravam uma tira de listras colada no vestido de um lado e um triângulo do outro)
  const flare = Math.max(11.5 + (an.w.hip - 13) * 0.25, an.seated ? 0 : skirtHalf + 3.5 - wS);
  // dobras em leque: vales (u, escuro) e cristas; a barra sobe nos vales e desce nas cristas
  const folds: FlagFold[] = [
    { u: 0.045, w: 0.022, k: 0.9, v0: 0.12 },
    { u: 0.1, w: 0.026, k: -1, v0: 0.16 },
    { u: 0.165, w: 0.026, k: 0.8, v0: 0.2 },
    { u: 0.235, w: 0.03, k: -0.9, v0: 0.24 },
    { u: 0.765, w: 0.03, k: -0.9, v0: 0.24 },
    { u: 0.835, w: 0.026, k: 0.8, v0: 0.2 },
    { u: 0.9, w: 0.026, k: -1, v0: 0.16 },
    { u: 0.955, w: 0.022, k: 0.9, v0: 0.12 },
  ];
  const top: SP[] = [
    [cx - wS - 0.6, sY + 3.6 - tl],
    [cx - wS * 0.66, sY - 0.1 - tl],
    [cx, an.collarY - 3.6],
    [cx + wS * 0.66, sY - 0.1 + tl],
    [cx + wS + 0.6, sY + 3.6 + tl],
  ];
  const mid: SP[] = [
    [cx - wS - 5.2, midY],
    [cx - wS * 0.6, midY - 1.5],
    [cx, midY - 2],
    [cx + wS * 0.6, midY - 1.5],
    [cx + wS + 5.2, midY],
  ];
  // barra: amostrada em u igual ao das dobras (curvesSurface anda por comprimento: barra quase reta = u ≈ x)
  const x0 = cx - wS - flare;
  const x1 = cx + wS + flare;
  const hem: SP[] = [];
  const N = 25;
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    let dy = 0;
    for (const f of folds) dy += -Math.sign(f.k) * 1.25 * Math.exp(-Math.pow((u - f.u) / 0.035, 2));
    // a barra desce um pouco nas laterais (o pano cai mais longe do corpo)
    dy += Math.pow(Math.abs(u - 0.5) * 2, 2) * 1.2;
    hem.push([x0 + (x1 - x0) * u, hemY + dy]);
  }
  return { surf: curvesSurface([top, mid, hem], { n: 32 }), folds };
}

/** 3. costas: capa da bandeira (cfg.pride === 'cape'); grupo 'body', atrás do cabelo de trás */
export function prideBack(ctx: LayerCtx): void {
  ctx = lodCtx(ctx);
  if (ctx.cfg.pride !== 'cape') return;
  const { an } = ctx;
  const lite = isLite(ctx);
  const flag = flagOf(ctx.cfg.prideFlag);
  const top = ctx.cfg.top;
  const skirtHalf = top === 'gown' ? an.w.hip * 1.55 + 5 : top === 'wizard' ? an.w.hip * 1.45 + 4 : 0;
  const cape = capeSurface(an, skirtHalf);
  const surf = lean(cape.surf, lite);
  const { folds } = cape;
  const outline = drawFlagOn(ctx, flag, surf);
  // por dentro da capa: sombra que vem do corpo (em cima, sob os ombros) e clareia na barra, onde o pano abre
  const sY = an.shoulderY;
  const hemY = surf.at(0.5, 1)[1];
  ctx.push(outline, INK, {
    gf: lin([50, sY], [50, hemY], [
      [0, INK, 0.62],
      [0.35, INK, 0.34],
      [0.8, INK, 0.1],
      [1, INK, 0.04],
    ]),
  });
  flagFolds(ctx, surf, folds, { clip: outline, o: lite ? 0.3 : 0.42, b: lite ? 0 : 0.9 });
  if (!lite) {
    // borda do lado da luz (esquerda) pega um filete claro; barra com bainha
    ctx.stroke(
      surfaceLine(surf, [
        [0.004, 0.14],
        [0.004, 0.99],
      ]),
      '#FFFFFF',
      0.55,
      { o: 0.22, b: 0.3, cp: outline },
    );
    ctx.stroke(
      surfaceLine(surf, [
        [0.01, 0.985],
        [0.99, 0.985],
      ]),
      INK,
      0.3,
      { o: 0.35, cp: outline },
    );
  }
}

// ---------------------------------------------------------------------------------------------------------------
// 10. peito: pin, coração, faixa, frente da capa
// ---------------------------------------------------------------------------------------------------------------

/** pin esmaltado em forma de bandeirinha (com haste dourada na tralha) */
function flagPin(ctx: LayerCtx, flag: FlagDef): void {
  const { an } = ctx;
  const lite = isLite(ctx);
  const [px, py] = prideChestSpot(an, ctx.cfg);
  // no 'lite' (mapa 72×112, miniaturas) o pin cresce ~45%: com 1–3 px ele sumia
  const k = lite ? 1.45 : 1;
  const len = 6.4 * k;
  const h = 4.3 * k;
  const rot = (-9 * Math.PI) / 180;
  const fly: Pt = [Math.cos(rot), Math.sin(rot)];
  const down: Pt = [-Math.sin(rot), Math.cos(rot)];
  const hoist: Pt = [px - fly[0] * len * 0.5 - down[0] * h * 0.5, py - fly[1] * len * 0.5 - down[1] * h * 0.5];
  const surf = lean(waveSurface({ hoist, down, fly, len, height: h, amp: 0.42, waves: 0.85, phase: 0.2, droop: 0.15 }), lite);
  const plate = grown(surf, 0.45);
  const plateD = surfacePath(plate);
  // sombra do pin no tecido (recortada no tronco)
  ctx.push(surfacePath(shifted(plate, 0.35, 0.6)), INK, { o: 0.42, b: 0.45, cp: torsoClip(an, 0.8, lite) });
  // haste curtinha na tralha, com bolinha em cima
  const hs0 = surf.at(0, -0.22);
  const hs1 = surf.at(0, 1.38);
  const off: Pt = [-fly[0] * 0.55, -fly[1] * 0.55];
  ctx.stroke(`M${fmt(hs0[0] + off[0])},${fmt(hs0[1] + off[1])}L${fmt(hs1[0] + off[0])},${fmt(hs1[1] + off[1])}`, GOLD_LINE, 0.62, {
    gs: goldGrad(hs0[0] - 0.4, hs0[1], hs0[0] + 0.4, hs0[1] + 0.2),
  });
  const top: Pt = [hs0[0] + off[0], hs0[1] + off[1] - 0.25];
  ctx.push(blob(top[0], top[1], 0.55, 0.55), GOLD_LINE, { gf: goldBall(top[0], top[1], 0.55) });
  // placa (aro dourado) e esmalte
  const b = { x0: px - len / 2, y0: py - h / 2, x1: px + len / 2, y1: py + h / 2 };
  ctx.push(plateD, GOLD_LINE, { gf: goldGrad(b.x0, b.y0, b.x1, b.y1) });
  const enamel = drawFlagOn(ctx, flag, surf, lite ? {} : { seams: { s: GOLD_LINE, w: 0.14, o: 0.9 } });
  // volume do esmalte nas dobras da bandeirinha
  flagFolds(ctx, surf, waveFolds({ waves: 0.85, phase: 0.2 }), { clip: enamel, o: 0.3, b: lite ? 0 : 0.35 });
  // bisel: linha escura dentro do aro e brilho do esmalte (faixa macia + reflexo nítido)
  ctx.stroke(enamel, GOLD_DEEP, 0.18, { o: 0.55 });
  ctx.push(taperPath([surf.at(0.04, 0.62), surf.at(0.24, 0.3), surf.at(0.5, 0.02)], [0.6, 1.5, 0.4]), '#FFFFFF', { o: 0.2, b: lite ? 0 : 0.45, cp: enamel });
  if (!lite) {
    const a = surf.at(0.14, 0.2);
    const c = surf.at(0.32, 0.12);
    const e = surf.at(0.5, 0.16);
    ctx.push(taperPath([a, c, e], [0, 0.42, 0]), '#FFFFFF', { o: 0.75, cp: enamel });
    // filete de luz no aro (lado de cima-esquerda)
    ctx.stroke(plateD, '#FFFFFF', 0.22, { gs: lin([b.x0, b.y0], [b.x1, b.y1], [[0, '#FFFFFF', 0.7], [0.45, '#FFFFFF', 0], [1, '#FFFFFF', 0]]), cp: plateD });
  }
}

/** coração esmaltado com aro dourado */
function heartPin(ctx: LayerCtx, flag: FlagDef): void {
  const { an } = ctx;
  const lite = isLite(ctx);
  const [px, py] = prideChestSpot(an, ctx.cfg);
  const r = 2.75 * (lite ? 1.45 : 1);
  const rot = (-12 * Math.PI) / 180;
  const cy = py + 0.2;
  const heart = heartRot(px, cy, r, rot);
  const rim = heartRot(px, cy, r + 0.5, rot);
  ctx.push(heartRot(px + 0.35, cy + 0.6, r + 0.5, rot), INK, { o: 0.42, b: 0.45, cp: torsoClip(an, 0.8, lite) });
  ctx.push(rim, GOLD_LINE, { gf: goldGrad(px - r, cy - r, px + r, cy + r) });
  const surf = boxSurface({ x: px - r * 1.12, y: cy - r * 1.05, w: r * 2.24, h: r * 1.98 }, { angle: -12 });
  drawFlagOn(ctx, flag, surf, { clip: heart, ...(lite ? {} : { seams: { s: GOLD_LINE, w: 0.14, o: 0.9 } }) });
  // volume: os lóbulos estufam (luz em cima-esquerda, sombra embaixo-direita)
  ctx.push(heart, INK, {
    gf: { t: 'r', cx: px - r * 0.35, cy: cy - r * 0.4, r: r * 1.6, s: [[0, '#FFFFFF', 0.22], [0.45, '#FFFFFF', 0], [0.8, INK, 0.12], [1, INK, 0.32]] },
  });
  ctx.stroke(heart, GOLD_DEEP, 0.18, { o: 0.55 });
  const g1 = rotP(px, cy, -r * 0.48, -r * 0.5, rot);
  ctx.push(blob(g1[0], g1[1], r * 0.36, r * 0.22, rot - 0.7), '#FFFFFF', { o: 0.5, b: lite ? 0 : 0.25, cp: heart });
  if (!lite) {
    const g2 = rotP(px, cy, -r * 0.55, -r * 0.55, rot);
    ctx.push(blob(g2[0], g2[1], 0.32, 0.2, rot - 0.7), '#FFFFFF', { o: 0.9 });
    const g3 = rotP(px, cy, r * 0.5, -r * 0.62, rot);
    ctx.push(blob(g3[0], g3[1], 0.22, 0.14, rot + 0.5), '#FFFFFF', { o: 0.55 });
    ctx.stroke(rim, '#FFFFFF', 0.22, { gs: lin([px - r, cy - r], [px + r, cy + r], [[0, '#FFFFFF', 0.75], [0.45, '#FFFFFF', 0], [1, '#FFFFFF', 0]]), cp: rim });
  }
}

/** faixa transversal de cetim: ombro esquerdo da tela → quadril direito, nó no quadril e duas pontas */
function sash(ctx: LayerCtx, flag: FlagDef): void {
  const { an } = ctx;
  const lite = isLite(ctx);
  const ba = bodyAnchors(an);
  const S: Pt = [ba.shoulderL[0] + 1.7, ba.shoulderL[1] - 2.0];
  const xr = torsoXAt(an, 'R', an.hipY - 1.5);
  // o nó (e as pontas, que abrem ~3 pra direita) termina antes do braço: no corpo largo o braço encosta no quadril e
  // escondia a roseta
  const arm = armInnerR(an, an.hipY - 1.6);
  const E: Pt = [Math.min(xr - 4.6, arm != null ? arm - 4.2 : Infinity), an.hipY - 1.6 - an.tilt.hip * 0.25];
  const d = norm(E[0] - S[0], E[1] - S[1]);
  // a faixa cai um pouco (barriga de tecido) pra baixo-esquerda no meio
  const sag = 1.5 + an.w.belly * 0.3;
  const M: Pt = [(S[0] + E[0]) / 2 - d[1] * sag, (S[1] + E[1]) / 2 + d[0] * sag];
  const W = 6.0 * Math.sqrt(an.w.shoulder / 18.6);
  const torso = torsoClip(an, 0.6, lite);
  // tralha (chevron/triângulo) no quadril, perto do nó; listras ao comprido (vermelho do lado do pescoço)
  const surf = lean(bandSurface([S, M, E], W, { mirror: true }), lite);
  const outline = surfacePath(surf);
  // sombra da faixa na roupa (embaixo-esquerda); em roupa clara ou metálica (armadura) mais forte e com contorno fino
  // escuro — a faixa em tons pastel sumia em cima do prateado
  const onLight = ctx.cfg.top === 'armor' || lum(ctx.col.top) > 0.62;
  ctx.push(surfacePath(shifted(surf, -0.5, 0.95)), INK, { o: onLight ? 0.5 : 0.32, b: lite ? 0 : 0.8, cp: torso });
  drawFlagOn(ctx, flag, surf, { clip: torso });
  if (onLight) ctx.stroke(outline, INK, lite ? 0.32 : 0.22, { o: 0.55, cp: torso });
  // cetim: luz no peito, escurece descendo pra barriga; dobras diagonais curtas no meio
  ctx.push(outline, INK, {
    cp: torso,
    gf: lin(S, E, [
      [0, '#FFFFFF', 0.2],
      [0.35, '#FFFFFF', 0.04],
      [0.7, INK, 0.08],
      [1, INK, 0.24],
    ]),
  });
  flagFolds(
    ctx,
    surf,
    [
      { u: 0.24, w: 0.035, k: -0.9, slant: 0.05 },
      { u: 0.29, w: 0.03, k: 0.9, slant: 0.05 },
      { u: 0.5, w: 0.035, k: -0.7, slant: -0.04, v0: 0.1, v1: 0.85 },
      { u: 0.55, w: 0.028, k: 0.8, slant: -0.04, v0: 0.1, v1: 0.85 },
      { u: 0.72, w: 0.03, k: -0.6, slant: 0.06, v0: 0.2 },
    ],
    { clip: outline, o: 0.4, b: lite ? 0 : 0.5 },
  );
  // a ponta de cima vira pra trás no ombro: sombra macia rente ao contorno do ombro
  ctx.push(surfacePath(surf, 0.9, 1.0, 0, 1), INK, { o: 0.3, b: lite ? 0 : 0.6, cp: torso });
  if (!lite) {
    // filete dourado nas duas bordas + brilho do cetim
    const edgeA = surfaceLine(surf, [
      [0.02, 0.05],
      [1, 0.05],
    ]);
    const edgeB = surfaceLine(surf, [
      [0.02, 0.95],
      [1, 0.95],
    ]);
    ctx.stroke(edgeA + edgeB, GOLD_LINE, 0.36, { cp: torso, o: 0.95 });
    ctx.stroke(edgeA + edgeB, GOLD_DEEP, 0.12, { cp: torso, o: 0.5, da: [0.5, 0.45], c: 'butt' });
    ctx.stroke(
      surfaceLine(surf, [
        [0.3, 0.3],
        [0.62, 0.26],
      ]),
      '#FFFFFF',
      0.5,
      { o: 0.22, b: 0.35, cp: outline },
    );
  }
  sashKnot(ctx, flag, E, d, W, lite);
}

/** nó da faixa no quadril + duas pontas com corte em V */
function sashKnot(ctx: LayerCtx, flag: FlagDef, E: Pt, d: Pt, W: number, lite: boolean): void {
  const K: Pt = [E[0] + d[0] * 0.5, E[1] + d[1] * 0.5];
  const sc = W / 6;
  const P = (x: number, y: number): Pt => [K[0] + x * sc, K[1] + y * sc];
  // pontas (a de trás primeiro)
  const tails: { spine: SP[]; w: (u: number) => number }[] = [
    { spine: [P(0.9, 0.4), P(1.9, 4.4), P(2.9, 8.6)], w: (u) => (2.5 + 0.5 * u) * sc },
    { spine: [P(-0.6, 0.5), P(-1.5, 5.0), P(-2.0, 10.2)], w: (u) => (2.7 + 0.6 * u) * sc },
  ];
  let tailsD = '';
  for (const t of tails) {
    const s = lean(bandSurface(t.spine, t.w), lite);
    const pts: SP[] = [];
    const n = 7;
    for (let i = 0; i <= n; i++) pts.push(s.at(i / n, 0));
    const a = s.at(1, 0);
    const notch = s.at(0.86, 0.5);
    const b = s.at(1, 1);
    pts[pts.length - 1] = [a[0], a[1], 0];
    pts.push([notch[0], notch[1], 0], [b[0], b[1], 0]);
    for (let i = n - 1; i >= 0; i--) pts.push(s.at(i / n, 1));
    const out = smoothPath(pts, true);
    tailsD += out;
    // sombra da ponta no que está embaixo (roupa/perna): leve, deslocada
    if (!lite) ctx.push(out, INK, { o: 0.2, b: 0.6 });
    drawFlagOn(ctx, flag, s, { clip: out, overlay: false });
    // no 'lite' a torção da fita (2 gradientes por ponta) não se lê
    if (lite) continue;
    // a fita torce: clara de um lado, escura do outro; mais escura logo abaixo do nó
    const m0 = s.at(0.5, 0);
    const m1 = s.at(0.5, 1);
    ctx.push(out, INK, { gf: lin(m0, m1, [[0, '#FFFFFF', 0.22], [0.45, '#FFFFFF', 0], [1, INK, 0.3]]) });
    const t0 = s.at(0, 0.5);
    const t1 = s.at(1, 0.5);
    ctx.push(out, INK, { gf: lin(t0, t1, [[0, INK, 0.38], [0.35, INK, 0], [1, INK, 0]]) });
  }
  // nó: rolo de tecido franzido por cima das pontas
  const knot = lean(bandSurface([P(-1.9, -0.6), P(0, 0.05), P(1.8, 0.5)], (u) => (2.5 + 1.1 * Math.sin(Math.PI * u)) * sc), lite);
  const kD = surfacePath(knot);
  if (!lite) ctx.push(blob(K[0] + 0.4, K[1] + 1.1, 2.4 * sc, 1.4 * sc), INK, { o: 0.35, b: 0.6, cp: tailsD });
  drawFlagOn(ctx, flag, knot, { overlay: false });
  ctx.push(kD, INK, {
    gf: { t: 'r', cx: K[0] - 0.5 * sc, cy: K[1] - 0.6 * sc, r: 3.0 * sc, s: [[0, '#FFFFFF', 0.28], [0.45, '#FFFFFF', 0], [0.8, INK, 0.25], [1, INK, 0.5]] },
  });
  if (!lite) {
    const c = P(0, 0.1);
    ctx.push(taperPath([c, P(-1.3, 1.0)], [0.45, 0]) + taperPath([c, P(1.2, -0.9)], [0.4, 0]) + taperPath([P(-0.2, -0.3), P(-1.0, -1.1)], [0.32, 0]), INK, { o: 0.32, b: 0.15, cp: kD });
  }
}

/** frente da capa: as duas pontas vêm pelos ombros e se prendem num broche esmaltado logo abaixo do pescoço */
function capeFront(ctx: LayerCtx, flag: FlagDef): void {
  const { an } = ctx;
  const lite = isLite(ctx);
  const ba = bodyAnchors(an);
  const torso = torsoClip(an, 0.6, lite);
  const clasp: Pt = [an.cx, an.collarY + 4.2];
  for (const side of ['L', 'R'] as const) {
    const sh = side === 'L' ? ba.shoulderL : ba.shoulderR;
    const sg = side === 'L' ? -1 : 1;
    // a ponta vem de trás do ombro (o recorte no tronco faz a curva do ombro) e desce em V até o broche
    const start: Pt = [sh[0] + sg * 1.2, sh[1] - 2.4];
    const mid: Pt = [an.cx + sg * (an.collarW + 1.0), an.collarY + 0.9];
    const end: Pt = [clasp[0] + sg * 0.7, clasp[1] + 0.1];
    const spine: SP[] = side === 'L' ? [start, mid, end] : [end, mid, start];
    const w = (u: number) => (side === 'L' ? 4.4 - 2.1 * u : 2.3 + 2.1 * u);
    const s = lean(bandSurface(spine, w), lite);
    const out = surfacePath(s);
    ctx.push(surfacePath(shifted(s, sg * 0.25, 0.85)), INK, { o: 0.34, b: lite ? 0 : 0.6, cp: torso });
    drawFlagOn(ctx, flag, s, { overlay: false, clip: torso });
    // franzido em direção ao broche e luz no alto do ombro
    const nearClasp = side === 'L' ? 1 : 0;
    ctx.push(out, INK, {
      cp: torso,
      gf: lin(s.at(1 - nearClasp, 0.5), s.at(nearClasp, 0.5), [
        [0, '#FFFFFF', 0.2],
        [0.5, '#FFFFFF', 0],
        [1, INK, 0.3],
      ]),
    });
    if (!lite) {
      flagFolds(
        ctx,
        s,
        [
          { u: side === 'L' ? 0.62 : 0.38, w: 0.06, k: -0.8, slant: sg * 0.06 },
          { u: side === 'L' ? 0.72 : 0.28, w: 0.05, k: 0.7, slant: sg * 0.06 },
        ],
        { clip: torso, o: 0.45, b: 0.35 },
      );
    }
    if (!lite) ctx.stroke(surfaceLine(s, [[0, side === 'L' ? 0.06 : 0.94], [1, side === 'L' ? 0.06 : 0.94]]), '#FFFFFF', 0.3, { o: 0.3, cp: torso });
  }
  // broche: aro dourado + a bandeira inteira (com chevron/anel) em esmalte
  const r = 2.05;
  ctx.push(blob(clasp[0] + 0.3, clasp[1] + 0.6, r + 0.5, r + 0.5), INK, { o: 0.42, b: lite ? 0 : 0.45, cp: torso });
  ctx.push(blob(clasp[0], clasp[1], r + 0.5, r + 0.5), GOLD_LINE, { gf: goldGrad(clasp[0] - r, clasp[1] - r, clasp[0] + r, clasp[1] + r) });
  const disc = blob(clasp[0], clasp[1], r, r);
  if (lite) {
    // broche de ~1,5 px: as listras viram UM gradiente de paradas duras (6–9 camadas recortadas → 1)
    ctx.push(disc, flag.stripes[0]?.hex ?? '#FFFFFF', { gf: stripeGrad(flag, [clasp[0], clasp[1] - r], [clasp[0], clasp[1] + r]) });
    return;
  }
  const surf = boxSurface({ x: clasp[0] - r * 1.45, y: clasp[1] - r, w: r * 2.9, h: r * 2 });
  drawFlagOn(ctx, flag, surf, { clip: disc, ...(lite ? {} : { seams: { s: GOLD_LINE, w: 0.12, o: 0.85 } }) });
  ctx.push(disc, INK, { gf: { t: 'r', cx: clasp[0] - r * 0.3, cy: clasp[1] - r * 0.35, r: r * 1.5, s: [[0, '#FFFFFF', 0.25], [0.5, '#FFFFFF', 0], [1, INK, 0.3]] } });
  ctx.stroke(disc, GOLD_DEEP, 0.18, { o: 0.55 });
  if (!lite) ctx.push(blob(clasp[0] - r * 0.4, clasp[1] - r * 0.45, 0.42, 0.26, -0.6), '#FFFFFF', { o: 0.85 });
}

/** 10. peito: pin, coração, faixa atravessada, frente da capa; grupo 'body', por cima do top/outer */
export function prideChest(ctx: LayerCtx): void {
  ctx = lodCtx(ctx);
  const item = ctx.cfg.pride;
  if (!item || item === NONE) return;
  const flag = flagOf(ctx.cfg.prideFlag);
  if (item === 'pin') flagPin(ctx, flag);
  else if (item === 'heart_pin') heartPin(ctx, flag);
  else if (item === 'sash') sash(ctx, flag);
  else if (item === 'cape') capeFront(ctx, flag);
}

// ---------------------------------------------------------------------------------------------------------------
// 15. pulseira (pulso direito da tela)
// ---------------------------------------------------------------------------------------------------------------

/** 15e. pulseira da bandeira (band) no pulso DIREITO da tela; grupo 'foreR' */
export function prideWrist(ctx: LayerCtx): void {
  ctx = lodCtx(ctx);
  if (ctx.cfg.pride !== 'band') return;
  const { an } = ctx;
  const lite = isLite(ctx);
  const flag = flagOf(ctx.cfg.prideFlag);
  ctx.group('foreR');
  const lw = limbWidthAt(an, 'forearm', 'R', 0.86);
  const d = lw.dir;
  // normal pra esquerda da tela
  let nL: Pt = [-d[1], d[0]];
  if (nL[0] > 0) nL = [-nL[0], -nL[1]];
  const c = lw.at;
  // no 'lite' mais larga e alta (no mapa ela praticamente sumia)
  const pad = lite ? 0.62 : 0.38;
  const Lp: Pt = [c[0] + nL[0] * (lw.l + pad), c[1] + nL[1] * (lw.l + pad)];
  const Rp: Pt = [c[0] - nL[0] * (lw.r + pad), c[1] - nL[1] * (lw.r + pad)];
  const H = lite ? 3.6 : 2.5;
  const sag = 0.5;
  // ponto da pulseira: s atravessa o pulso (0 = esquerda), t vai do lado do cotovelo (0) ao da mão (1)
  const at = (s: number, t: number): Pt => {
    const off = (t - 0.5) * H + sag * 4 * s * (1 - s);
    return [Lp[0] + (Rp[0] - Lp[0]) * s + d[0] * off, Lp[1] + (Rp[1] - Lp[1]) * s + d[1] * off];
  };
  const shape: FlagSurface = { at: (u, v) => at(v, u), aspect: H / 5, height: 5, n: 10 };
  const outline = surfacePath(shape);
  // sombra no pulso/mão logo abaixo da pulseira
  const skinClip = forearmPath(an, 'R') + handShapes(an, 'R').hand;
  ctx.push(surfacePath(shifted(shape, d[0] * 0.9, d[1] * 0.9)), INK, { o: 0.32, b: lite ? 0 : 0.45, cp: skinClip });
  // gomos trançados na diagonal com a sequência da bandeira (o desenho extra entra na ordem: chevron, anel…)
  const seq: FlagDef = { id: flag.id, label: flag.label, stripes: flagSequence(flag).map((x) => ({ hex: x.hex, w: x.w })) };
  const slant = 0.34;
  const woven: FlagSurface = { at: (u, v) => at(v + slant * (u - 0.5), u), aspect: H / 5, height: 5, n: 10 };
  drawFlagOn(ctx, seq, woven, { clip: outline, overlay: false });
  // cilindro: luz à esquerda, sombra à direita; borda de cima clara, de baixo escura
  ctx.push(outline, INK, {
    gf: lin(Lp, Rp, [
      [0, '#FFFFFF', 0.08],
      [0.22, '#FFFFFF', 0.3],
      [0.5, '#FFFFFF', 0],
      [0.8, INK, 0.26],
      [1, INK, 0.45],
    ]),
  });
  if (!lite) {
    // trama: pontos de laçada na diagonal oposta aos gomos (bem sutis)
    let hatch = '';
    for (let i = 0; i <= 18; i++) {
      for (const t0 of [0.14, 0.5]) {
        const s = i / 18;
        const a = at(s + 0.035, t0);
        const b = at(s - 0.035, t0 + 0.32);
        hatch += `M${fmt(a[0])},${fmt(a[1])}L${fmt(b[0])},${fmt(b[1])}`;
      }
    }
    ctx.stroke(hatch, INK, 0.11, { o: 0.14, cp: outline });
    ctx.stroke(surfaceLine(shape, [[0.1, 0.02], [0.1, 0.98]]), '#FFFFFF', 0.24, { o: 0.4, cp: outline });
    ctx.stroke(surfaceLine(shape, [[0.94, 0.02], [0.94, 0.98]]), INK, 0.28, { o: 0.35, cp: outline });
    // nó e pontinhas do lado de fora (direita da tela)
    const k0 = at(0.92, 0.6);
    const cols = seq.stripes;
    const tipA = cols[0]?.hex ?? '#FFFFFF';
    const tipB = cols[cols.length - 1]?.hex ?? tipA;
    const P = (a: number, b: number): Pt => [k0[0] + d[0] * a - nL[0] * b, k0[1] + d[1] * a - nL[1] * b];
    const cord = (pts: Pt[], c: string) => {
      ctx.push(taperPath(pts, [0.42, 0.36, 0.26], { round: true }), mix(c, INK, 0.12));
      ctx.push(taperPath(pts.map((p) => [p[0] - 0.08, p[1] - 0.08] as Pt), [0.16, 0.12, 0.06], { round: true }), mix(c, '#FFFFFF', 0.45), { o: 0.6 });
    };
    cord([k0, P(1.5, 0.35), P(2.5, 0.2)], tipB);
    cord([k0, P(1.2, 0.95), P(2.0, 1.25)], tipA);
    const kc = mix(tipA, tipB, 0.5);
    ctx.push(blob(k0[0], k0[1], 0.55, 0.48), kc, { gf: { t: 'r', cx: k0[0] - 0.2, cy: k0[1] - 0.2, r: 0.75, s: [[0, mix(kc, '#FFFFFF', 0.4)], [0.6, kc], [1, mix(kc, INK, 0.45)]] } });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// 15. bandeirinha na mão esquerda da tela
// ---------------------------------------------------------------------------------------------------------------

/** 15f. bandeirinha na mão ESQUERDA da tela (flag); grupo 'foreL'; só se ctx.scene.showLeftHandFlag */
export function prideHandFlag(ctx: LayerCtx): void {
  ctx = lodCtx(ctx);
  if (ctx.cfg.pride !== 'flag' || !ctx.scene.showLeftHandFlag) return;
  const { an } = ctx;
  const lite = isLite(ctx);
  const flag = flagOf(ctx.cfg.prideFlag);
  ctx.group('foreL');
  const want = (ctx.opts as { hands?: Partial<Record<'L' | 'R', 'open' | 'relaxed'>> }).hands;
  const open = want?.L === 'open';
  const h = handShapes(an, 'L', { open });
  const palm = h.palm;
  let up: Pt;
  let fly: Pt;
  let len: number;
  let L: number;
  if (open) {
    // braço erguido (o palco monta a mão aberta nas animações de braço pra cima): a haste segue o antebraço e sai pela
    // ponta dos dedos, o polegar prende. Desenhado no espaço do braço solto, onde aponta pra baixo; girado ~150°–220°
    // pela pose fica de pé, com o pano voando pra fora e as listras na ordem certa (rotação não espelha)
    const e = an.joints.elbowL;
    const w = an.joints.wristL;
    up = norm(w[0] - e[0], w[1] - e[1]);
    fly = norm(up[1] - up[0] * 0.16, -up[0] - up[1] * 0.16);
    len = 11;
    L = 8.5;
  } else {
    // haste: sobe pra fora, inclinada o bastante pra não cruzar o cotovelo e pouco o bastante pro pano caber no quadro
    len = 26;
    const flyLen = 12.5;
    const sinT = Math.max(0.3, Math.min(0.58, (palm[0] - flyLen - 1.5) / len));
    up = [-sinT, -Math.sqrt(1 - sinT * sinT)];
    fly = [-1, 0.16];
    L = 0;
  }
  // a ponta de baixo da haste sai embaixo do mindinho (antes terminava dentro da mão e a haste parecia encostada)
  const bot: Pt = [palm[0] - up[0] * (open ? 3.2 : 6.2), palm[1] - up[1] * (open ? 3.2 : 6.2)];
  const top: Pt = [palm[0] + up[0] * len, palm[1] + up[1] * len];
  // pano preso logo abaixo da ponteira, voando pra fora e caindo de leve
  const hoist: Pt = [top[0] - up[0] * 0.7, top[1] - up[1] * 0.7];
  if (!open) L = Math.max(7, Math.min(12.5, hoist[0] - 1.2));
  const H = L * 0.66;
  const wave = { waves: 1.2, phase: 0.55 };
  const surf = lean(waveSurface({ hoist, down: [-up[0], -up[1]], fly, len: L, height: H, amp: H * 0.13, droop: H * 0.1, ...wave }), lite);
  const cloth = drawFlagOn(ctx, flag, surf);
  flagFolds(ctx, surf, waveFolds(wave), { clip: cloth, o: lite ? 0.36 : 0.5, b: lite ? 0 : Math.max(0.35, H * 0.06) });
  // bainha da tralha (o pano dobra em volta da haste) e sombra suave embaixo da ponta que cai
  ctx.push(surfacePath(surf, 0, 0.07, 0, 1), INK, { o: 0.22, cp: cloth });
  if (!lite) {
    ctx.stroke(surfaceLine(surf, [[0.05, 0.02], [0.98, 0.02]]), '#FFFFFF', 0.3, { o: 0.28, cp: cloth });
    ctx.stroke(surfaceLine(surf, [[0.02, 0.985], [0.98, 0.985]]), INK, 0.3, { o: 0.28, cp: cloth });
  }
  // haste de madeira (cilindro) e ponteira dourada
  const n: Pt = [-up[1], up[0]];
  const mid: Pt = [(bot[0] + top[0]) / 2, (bot[1] + top[1]) / 2];
  ctx.stroke(`M${fmt(bot[0])},${fmt(bot[1])}L${fmt(top[0])},${fmt(top[1])}`, '#B98A4E', 0.8, {
    gs: lin([mid[0] - n[0] * 0.45, mid[1] - n[1] * 0.45], [mid[0] + n[0] * 0.45, mid[1] + n[1] * 0.45], [
      [0, '#F1D29C'],
      [0.4, '#C9995A'],
      [1, '#7A4F24'],
    ]),
  });
  const tip: Pt = [top[0] + up[0] * 0.45, top[1] + up[1] * 0.45];
  ctx.push(blob(tip[0], tip[1], 0.7, 0.7), GOLD_LINE, { gf: goldBall(tip[0], tip[1], 0.7) });
  // a mão por cima da haste (dedos fechando nela): redesenha a mão com o mesmo volume do corpo
  handOver(ctx, h, open, up);
}

/** mão esquerda redesenhada por cima da haste (mesmas formas e gradiente de parts/body.ts) */
function handOver(ctx: LayerCtx, h: ReturnType<typeof handShapes>, open: boolean, up: Pt = [0, -1]): void {
  const { an } = ctx;
  const t = skinTones(ctx.col.skin);
  const lite = isLite(ctx);
  const hs = an.spec.hand;
  const ax = armAxis(an, 'L');
  const tone = { light: t.light, base: t.base, shade: t.shade, bounce: mix(t.shade, t.bounce, 0.45), edge: mix(t.base, t.shade, 0.2) };
  const thumbFill: AvatarGradient = { t: 'r', cx: h.palm[0] - 1.0, cy: h.palm[1] - 0.6, r: 5.5 * hs, s: [[0, t.lighter], [0.5, t.light], [1, t.base]] };
  if (open) {
    ctx.push(h.thumb, INK, { o: 0.2, b: lite ? 0 : 0.4 });
    ctx.push(h.thumb, t.base, { gf: thumbFill });
    return;
  }
  ctx.push(h.hand, INK, { o: 0.25, b: lite ? 0 : 0.5 });
  ctx.push(h.hand, t.base, { gf: cylGradient(ax.a, ax.b, ax.wl, ax.wr, tone) });
  ctx.push(blob(h.palm[0] - 0.4, h.palm[1] - 0.6, 2.1 * hs, 2.6 * hs), t.lighter, { o: 0.22, b: lite ? 0 : 0.7, cp: h.hand });
  ctx.push(blob(h.tip[0], h.tip[1], 2.8 * hs, 1.5 * hs), mix(t.shade, t.blush, 0.25), { o: 0.4, b: lite ? 0 : 0.6, cp: h.hand });
  ctx.push(h.grooves.join(''), t.deep, { o: lite ? 0.45 : 0.6 });
  if (!lite) {
    ctx.push(h.knuckle, t.lighter, { o: 0.38, b: 0.2 });
    ctx.push(h.nails, mix(t.lighter, '#FFE8E0', 0.4), { o: 0.6 });
  }
  ctx.push(h.web, t.deep, { o: 0.4, b: lite ? 0 : 0.35, cp: h.hand });
  // pegada: os dedos dobram em volta da haste — vincos atravessando a mão perpendiculares à haste (cada dedo é uma
  // faixa enrolada nela), sombra da haste saindo de dentro do punho e o polegar fechando por cima
  const n: Pt = [-up[1], up[0]];
  let wrap = '';
  for (const k of [0.25, 0.5, 0.75]) {
    const c: Pt = [h.palm[0] + (h.tip[0] - h.palm[0]) * k, h.palm[1] + (h.tip[1] - h.palm[1]) * k];
    const w = 1.9 * hs;
    wrap += taperPath([[c[0] - n[0] * w, c[1] - n[1] * w], [c[0] - up[0] * 0.25, c[1] - up[1] * 0.25], [c[0] + n[0] * w, c[1] + n[1] * w]], [0, 0.28, 0]);
  }
  ctx.push(wrap, t.deep, { o: lite ? 0.4 : 0.5, cp: h.hand });
  ctx.push(h.thumb, INK, { o: 0.22, b: lite ? 0 : 0.4 });
  ctx.push(h.thumb, t.base, { gf: thumbFill });
}

// ---------------------------------------------------------------------------------------------------------------
// 20. pintura no rosto
// ---------------------------------------------------------------------------------------------------------------

/** 20. pintura no rosto (face_paint): listras na maçã do rosto (direita da tela), seguindo o osso da bochecha */
export function pridePaint(ctx: LayerCtx): void {
  ctx = lodCtx(ctx);
  if (ctx.cfg.pride !== 'face_paint') return;
  const { an } = ctx;
  const lite = isLite(ctx);
  const flag = flagOf(ctx.cfg.prideFlag);
  ctx.group('head');
  const ha = headAnchors(an);
  const s = ha.s;
  const [ex, ey] = ha.eyeR;
  const ew = ha.eyeW;
  // do canto de baixo do olho (lado do nariz) até perto da borda do rosto, subindo pela maçã
  const edgeX = an.head.cx + ha.cheekW;
  // começa embaixo do olho (lado do nariz) e sobe pela maçã até antes da borda do rosto (a ponta redonda não vaza)
  const p0: Pt = [ex - ew * 0.7, ey + ew * 1.9];
  const p2: Pt = [edgeX - 1.75 * s, ey + ew * 0.55];
  const p1: Pt = [(p0[0] + p2[0]) / 2 + 0.15 * s, (p0[1] + p2[1]) / 2 + 0.5 * s];
  const W = 2.4 * s;
  // pincelada de esponja listrada: começa cheia e redonda, vai afinando; as listras de fora somem nas pontas
  const brush = taperPath([p0, p1, p2], (t) => W * (0.78 + 0.22 * Math.sin(Math.PI * t)) * (1 - 0.4 * t * t * t), { round: true, n: 14 });
  const surf = bandSurface([p0, p1, p2], W * 1.04, { n: 16 });
  // as listras passam das pontas da espinha pra encher as pontas redondas da pincelada
  const e = W / 2 / (surf.aspect * surf.height);
  drawFlagOn(ctx, flag, { ...surf, at: (u, v) => surf.at(-e + u * (1 + 2 * e), v) }, { clip: brush, o: 0.9 });
  // a tinta acompanha o volume da bochecha: escurece onde o rosto vira (fora) e embaixo do osso
  ctx.push(brush, INK, {
    gf: lin(surf.at(0.35, 0.5), surf.at(1.1, 0.5), [
      [0, INK, 0],
      [1, INK, 0.3],
    ]),
  });
  ctx.push(brush, INK, {
    gf: lin(surf.at(0.5, 0), surf.at(0.5, 1), [
      [0, '#FFFFFF', 0.16],
      [0.45, '#FFFFFF', 0],
      [1, INK, 0.16],
    ]),
  });
  if (!lite) {
    // esponja seca no fim da pincelada: fiapos de pele aparecendo, e o brilho da maçã passando por cima da tinta
    let dry = '';
    for (const [v, u0] of [
      [0.22, 0.8],
      [0.47, 0.88],
      [0.7, 0.83],
    ] as const) {
      dry += taperPath([surf.at(u0, v), surf.at((u0 + 1) / 2, v + 0.02), surf.at(1.02, v + 0.03)], [0, 0.22 * s, 0.32 * s]);
    }
    ctx.push(dry, ctx.col.skin, { o: 0.6, cp: brush });
    ctx.push(taperPath([surf.at(0.16, 0.3), surf.at(0.4, 0.2), surf.at(0.6, 0.24)], [0, 0.5 * s, 0]), '#FFFFFF', { o: 0.3, b: 0.25, cp: brush });
  }
}
