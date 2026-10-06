// Corpo: sombra no chão, pele das pernas, braços, mãos, pescoço e cabeça base (com orelhas).
// Dono: diretor de arte. Forma semi-realista: contornos orgânicos da anatomia (anatomy.ts), volume de cilindro nos
// membros com o MESMO gradiente nas duas metades (perna e braço contínuos na junta), mão em três-quartos com dedos em
// grupos e polegar articulado, pescoço com trapézio e sombra do queixo, cabeça com formas de sombra recortadas (maçã,
// mandíbula, têmpora) por cima do degradê — é isso que dá estrutura óssea em vez de "máscara de aerógrafo".
//
// Etapas do orquestrador (layers.ts) que chamam este arquivo:
//    1 groundShadow   · 6 legsSkin   · 12 upperArms   · 15 forearms + hands   · 16 neckAndHead
//
// Helper pro guarda-roupa: torsoSkin(ctx, opts) desenha a pele do tronco (decote, ombros, barriga) — chame no começo
// do top() quando a peça deixa pele à mostra (regata, cropped, vestido tomara-que-caia).

import type { AvatarConfig } from '@cruzei/shared-types';

import {
  armAxis,
  bodyY,
  earShapes,
  faceDims,
  footBox,
  forearmPath,
  handShapes,
  headAnchors,
  headPath,
  headPts,
  legAxis,
  limbWidthAt,
  mirrorPts,
  shinPath,
  smoothPath,
  taperPath,
  thighPath,
  torsoPath,
  upperArmPath,
  type Side,
  type SP,
  type TorsoOpts,
} from '../anatomy';
import type { LayerCtx } from '../ctx';
import { ellipse } from '../geometry';
import { blob, cylGradient, isLite, lodCtx, lum, mix, rimLit, skinTones, type SkinTones } from '../shading';
import type { AvatarGroup } from '../types';

import * as clothesMod from './clothes';
import { legsVisible } from './lower-common';

const SIDES: readonly Side[] = ['L', 'R'];

const grp = (base: 'arm' | 'fore' | 'leg' | 'shin', s: Side): AvatarGroup => `${base}${s}` as AvatarGroup;

/** tons de pele da config (memo leve por cor) */
const toneCache = new Map<string, SkinTones>();
export function tonesOf(ctx: LayerCtx): SkinTones {
  const k = ctx.col.skin;
  let t = toneCache.get(k);
  if (!t) {
    t = skinTones(k);
    if (toneCache.size > 64) toneCache.clear();
    toneCache.set(k, t);
  }
  return t;
}

/** função opcional do guarda-roupa (o arquivo dele pode ainda não ter): devolve null se não existir */
function clothesFn<T>(name: string): T | null {
  const fn = (clothesMod as unknown as Record<string, unknown>)[name];
  return typeof fn === 'function' ? (fn as T) : null;
}

type SleeveKind = 'none' | 'short' | 'long';

function sleeveOf(cfg: AvatarConfig): SleeveKind {
  const fn = clothesFn<(c: AvatarConfig) => SleeveKind>('sleeveKind');
  return fn ? fn(cfg) : 'short';
}


/**
 * até onde a gola cobre o pescoço (y): o guarda-roupa pode exportar neckCoverY(cfg, an) — gola alta, armadura… Sem
 * isso, o pescoço vai até a gola redonda (anatomy.collarY).
 */
function neckCover(ctx: LayerCtx): number | null {
  const fn = clothesFn<(c: AvatarConfig, an: LayerCtx['an']) => number | null>('neckCoverY');
  return fn ? fn(ctx.cfg, ctx.an) : null;
}

// ---------------------------------------------------------------------------------------------------------------
// 1. sombra no chão
// ---------------------------------------------------------------------------------------------------------------

/** 1. sombra macia no chão + sombra de contato embaixo de cada pé (só com opts.groundShadow) */
export function groundShadow(ctx: LayerCtx): void {
  ctx = lodCtx(ctx);
  if (!ctx.opts.groundShadow) return;
  const { an } = ctx;
  ctx.group('shadow');
  ctx.push(ellipse(an.cx, an.foot.groundY - 0.2, an.w.hip + 10, 3.2), '#05030A', { o: 0.34, b: 1.6 });
  if (!ctx.scene.mount) {
    let d = '';
    for (const s of SIDES) {
      const fb = footBox(an, s);
      d += ellipse(fb.cx, an.foot.soleY + 0.3, fb.w * 0.55, 1.15);
    }
    ctx.push(d, '#05030A', { o: 0.45, b: 0.6 });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// membros de pele
// ---------------------------------------------------------------------------------------------------------------

function limbTone(t: SkinTones) {
  return { light: t.light, base: t.base, shade: t.shade, bounce: mix(t.shade, t.bounce, 0.45), edge: mix(t.base, t.shade, 0.2) };
}

/** pele de um membro com o gradiente do membro INTEIRO (perna: quadril→tornozelo; braço: ombro→pulso) */
/** no 'lite' (mapa, lista de 48 px) braço e perna engrossam ~6%: a silhueta não some no anel */
export function liteEase(ctx: LayerCtx): number {
  return isLite(ctx) ? 0.2 : 0;
}

function skinLimb(ctx: LayerCtx, kind: 'arm' | 'leg', s: Side, d: string, widen = 0): void {
  const t = tonesOf(ctx);
  const ax = kind === 'leg' ? legAxis(ctx.an, s) : armAxis(ctx.an, s);
  ctx.push(d, t.base, { gf: cylGradient(ax.a, ax.b, ax.wl + widen, ax.wr + widen, limbTone(t)) });
}

/** 6a. pele das pernas onde a roupa deixa aparecer (shorts, saia, vestido…), com joelho, panturrilha e canela */
export function legsSkin(ctx: LayerCtx): void {
  ctx = lodCtx(ctx);
  if (!legsVisible(ctx.cfg)) return;
  const t = tonesOf(ctx);
  const { an } = ctx;
  const lite = isLite(ctx);
  for (const s of SIDES) {
    const sg = s === 'L' ? 1 : -1; // pro lado de dentro
    const thigh = () =>
      ctx.withGroup(grp('leg', s), () => {
        const d = thighPath(an, s, { ease: liteEase(ctx) });
        skinLimb(ctx, 'leg', s, d, an.seated ? 1.5 : 0);
        // sombra interna da coxa (perto do gancho) e luz na frente
        const ins = limbWidthAt(an, 'thigh', s, 0.3);
        ctx.push(blob(ins.at[0] + sg * ins.r * 0.75, ins.at[1] + 2, 1.6, 6, 0), t.deep, { o: 0.25, b: 1.2, cp: d });
        if (an.seated) {
          // colo visto de cima: o plano de cima da coxa pega luz (largo, do quadril ao joelho); a FACE da frente do joelho
          // fica na sombra (faixa larga e baixa, nada de cúpula brilhante); sombra de contato da barra no alto da coxa
          const kn = s === 'L' ? an.joints.kneeL : an.joints.kneeR;
          const hp = s === 'L' ? an.joints.hipL : an.joints.hipR;
          ctx.push(blob((kn[0] + hp[0]) / 2 - 0.4, (kn[1] + hp[1]) / 2, an.spec.thigh * 0.85, (kn[1] - hp[1]) * 0.45), t.lighter, { o: 0.3, b: 0.8, cp: d });
          ctx.push(blob(kn[0] + 0.2, kn[1] + 1.6, an.spec.knee * 1.25, 1.1), t.deep, { o: 0.32, b: 0.6, cp: d });
          ctx.push(blob(hp[0], hp[1] - 0.2, an.spec.thigh * 1.1, 1.0), t.deep, { o: 0.28, b: 0.6, cp: d });
        } else if (!lite) {
          const m = limbWidthAt(an, 'thigh', s, 0.5);
          ctx.push(blob(m.at[0] - 0.8, m.at[1], m.l * 0.4, 5.5, 0.05), t.lighter, { o: 0.22, b: 1.2, cp: d });
        }
      });
    const shin = () =>
      ctx.withGroup(grp('shin', s), () => {
        const d = shinPath(an, s, { ease: liteEase(ctx) });
        skinLimb(ctx, 'leg', s, d);
        const kn = s === 'L' ? an.joints.kneeL : an.joints.kneeR;
        // joelho: rótula com luz em cima e sombra embaixo (quebra leve, não "joelheira"); sentado, metade do contraste e
        // mais larga (de frente o joelho dobrado é largo e baixo, não uma bola)
        const st = an.seated;
        ctx.push(blob(kn[0] - 0.3, kn[1] - 0.1, an.spec.knee * (st ? 0.75 : 0.5), an.spec.knee * (st ? 0.3 : 0.38)), t.lighter, { o: st ? 0.16 : 0.32, b: 0.6, cp: d });
        ctx.push(taperPath([[kn[0] - an.spec.knee * 0.6, kn[1] + 1.9], [kn[0], kn[1] + 2.4], [kn[0] + an.spec.knee * 0.6, kn[1] + 1.8]], [0, 0.6, 0]), t.deep, { o: 0.28, b: 0.4, cp: d });
        // panturrilha (volume do lado de fora, sombra embaixo) e canela (luz fininha na frente da tíbia)
        const c = limbWidthAt(an, 'shin', s, 0.32);
        const out = s === 'L' ? -1 : 1;
        ctx.push(blob(c.at[0] + out * (s === 'L' ? c.l : c.r) * 0.55, c.at[1] + 3.5, 1.3, 3.8), t.deep, { o: s === 'R' ? 0.3 : 0.14, b: 0.9, cp: d });
        const f = limbWidthAt(an, 'shin', s, 0.5);
        ctx.push(taperPath([[f.at[0] - 0.5, f.at[1] - 7], [f.at[0] - 0.7, f.at[1]], [f.at[0] - 0.35, f.at[1] + 7.5]], [0, 0.9, 0]), t.lighter, { o: 0.3, b: 0.5, cp: d });
        // tornozelo (maléolo) sutil
        if (!lite) {
          const a = s === 'L' ? an.joints.ankleL : an.joints.ankleR;
          ctx.push(blob(a[0] + out * an.spec.ankle * 0.55, a[1] - 0.3, 0.5, 0.6), t.lighter, { o: 0.3, b: 0.25, cp: d });
        }
      });
    // sentado: a coxa vem pra frente e cobre o alto da canela (o joelho fica na frente)
    if (an.seated) {
      shin();
      thigh();
    } else {
      thigh();
      shin();
    }
  }
}

/** 12a. pele do braço (ombro → cotovelo). Manga longa: nada (a manga cobre) */
export function upperArms(ctx: LayerCtx): void {
  ctx = lodCtx(ctx);
  const sk = sleeveOf(ctx.cfg);
  if (sk === 'long') return;
  const t = tonesOf(ctx);
  const { an } = ctx;
  // a oclusão do braço só existe ONDE o braço encosta no tronco: recortada no tronco (com a folga mínima de roupa), assim
  // o desfoque nunca cai no fundo entre o braço dobrado e o corpo
  const torsoClip = torsoPath(an, { ease: 0.35, drape: 0.5 });
  for (const s of SIDES) {
    // oclusão do braço no tronco (fica no tronco: não gira com o braço)
    const m = limbWidthAt(an, 'upperArm', s, 0.4);
    const sg = s === 'L' ? 1 : -1;
    ctx.withGroup('body', () => ctx.push(blob(m.at[0] + sg * (m.r + 0.5), m.at[1] + 1, 1.2, 6, 0), '#1A0A10', { o: 0.16, b: 1.1, cp: torsoClip }));
    ctx.withGroup(grp('arm', s), () => {
      // com manga curta a copa do ombro fica embaixo do tecido: a pele começa um pouco abaixo (não aparece por cima)
      const d = upperArmPath(an, s, sk === 'short' ? { from: 0.16, ease: liteEase(ctx) } : { ease: liteEase(ctx) });
      skinLimb(ctx, 'arm', s, d);
      // deltoide: luz arredondada no ombro; bíceps/tríceps: sombra suave do lado da sombra
      const sh = s === 'L' ? an.joints.shoulderL : an.joints.shoulderR;
      const mu = an.spec.muscle;
      ctx.push(blob(sh[0] - 0.6, sh[1] - 0.4, an.spec.upperArm * 0.8, an.spec.upperArm * 0.95), t.lighter, { o: 0.3 + mu * 0.12, b: 0.9, cp: d });
      const q = limbWidthAt(an, 'upperArm', s, 0.62);
      ctx.push(blob(q.at[0] + 0.3, q.at[1] + 2, an.spec.upperArm * 0.5, 3.4), t.deep, { o: 0.16 + mu * 0.1, b: 0.9, cp: d });
      // corpo atlético: separação macia entre deltoide e bíceps (relevo muscular por sombra de forma, sem contorno)
      if (mu > 0.5 && !isLite(ctx)) {
        const dl = limbWidthAt(an, 'upperArm', s, 0.36);
        const g = s === 'L' ? -1 : 1;
        ctx.push(taperPath([[dl.at[0] + g * (s === 'L' ? dl.l : dl.r) * 0.9, dl.at[1] - 1.2], [dl.at[0] + g * 0.4, dl.at[1] + 0.6], [dl.at[0] - g * (s === 'L' ? dl.r : dl.l) * 0.5, dl.at[1] + 0.2]], [0, 0.9, 0]), t.form, { o: 0.28 * mu, b: 0.45, cp: d });
      }
    });
  }
}

/** 15a. pele do antebraço (cotovelo → pulso) */
export function forearms(ctx: LayerCtx): void {
  ctx = lodCtx(ctx);
  const sk = sleeveOf(ctx.cfg);
  if (sk === 'long') return;
  const t = tonesOf(ctx);
  const { an } = ctx;
  for (const s of SIDES) {
    ctx.withGroup(grp('fore', s), () => {
      const d = forearmPath(an, s, { ease: liteEase(ctx) });
      skinLimb(ctx, 'arm', s, d);
      // dobra do cotovelo (vinco curto do lado de dentro) e o osso do cotovelo do lado de fora
      const el = s === 'L' ? an.joints.elbowL : an.joints.elbowR;
      const sg = s === 'L' ? 1 : -1;
      if (!isLite(ctx)) ctx.push(blob(el[0] - sg * an.spec.elbow * 0.55, el[1] + 0.6, an.spec.elbow * 0.45, 1.1), t.lighter, { o: 0.26, b: 0.5, cp: d });
      ctx.push(taperPath([[el[0] + sg * 0.3, el[1] - 0.2], [el[0] + sg * 1.2, el[1] + 0.5], [el[0] + sg * 1.9, el[1] + 0.3]], [0, 0.32, 0]), t.deep, { o: 0.28 });
      // massa do antebraço perto do cotovelo (braquiorradial) com luz
      const q = limbWidthAt(an, 'forearm', s, 0.22);
      ctx.push(blob(q.at[0] - 0.5, q.at[1], an.spec.forearm * 0.5, 2.6), t.lighter, { o: 0.18, b: 0.8, cp: d });
    });
  }
}

/** 15c. mãos (grupo do antebraço): dorso no mesmo gradiente do braço (sem emenda no pulso), dedos em grupos, nós,
 * unhas, pontas curvando pra dentro e polegar articulado com sombra de contato */
export function hands(ctx: LayerCtx): void {
  ctx = lodCtx(ctx);
  const t = tonesOf(ctx);
  const { an } = ctx;
  const lite = isLite(ctx);
  const want = (ctx.opts as { hands?: Partial<Record<Side, 'open' | 'relaxed'>> }).hands;
  for (const s of SIDES) {
    if (want && want[s] === 'open') {
      ctx.withGroup(grp('fore', s), () => openHand(ctx, s, t));
      continue;
    }
    ctx.withGroup(grp('fore', s), () => {
      const h = handShapes(an, s);
      const ra = s === 'L' ? an.rest.armL : an.rest.armR;
      // polegar no bolso / no passante / atrás do quadril (mão na cintura): fica atrás da mão
      const tucked = ra === 'pocket' || ra === 'soft' || ra === 'hip';
      const hs = an.spec.hand;
      const ax = armAxis(an, s);
      const thumbFill = { gf: { t: 'r' as const, cx: h.palm[0] - 1.0, cy: h.palm[1] - 0.6, r: 5.5 * hs, s: [[0, t.lighter], [0.5, t.light], [1, t.base]] as const } };
      if (tucked) ctx.push(h.thumb, t.base, { ...thumbFill, o: 0.85 });
      ctx.push(h.hand, t.base, { gf: cylGradient(ax.a, ax.b, ax.wl, ax.wr, limbTone(t)) });
      // volume: dorso pega luz no meio; pontas dos dedos dobram pra dentro (mais escuras e quentes)
      ctx.push(blob(h.palm[0] - 0.4, h.palm[1] - 0.6, 2.1 * hs, 2.6 * hs), t.lighter, { o: 0.22, b: 0.7, cp: h.hand });
      // pele escura: a sombra das pontas fica mais leve (senão dedos e sombra viram um borrão) e os dedos se separam pela
      // LUZ — nós e unhas mais claros — além dos sulcos
      const deep = lum(t.base) < 0.15;
      ctx.push(blob(h.tip[0], h.tip[1], 2.8 * hs, 1.5 * hs), mix(t.shade, t.blush, 0.25), { o: deep ? 0.22 : 0.4, b: 0.6, cp: h.hand });
      ctx.push(h.grooves.join(''), deep ? mix(t.deep, '#000000', 0.25) : t.deep, { o: lite ? 0.45 : deep ? 0.75 : 0.6 });
      if (!lite) {
        ctx.push(h.knuckle, t.lighter, { o: deep ? 0.55 : 0.38, b: 0.2 });
        ctx.push(h.nails, mix(t.lighter, '#FFE8E0', 0.4), { o: deep ? 0.75 : 0.6 });
      }
      if (!tucked) {
        // sombra entre polegar e indicador, sombra de contato e o polegar por cima (com a dobra da articulação)
        ctx.push(h.web, t.deep, { o: 0.4, b: 0.35, cp: h.hand });
        ctx.push(h.thumb, '#140A0C', { o: 0.22, b: 0.4 });
        ctx.push(h.thumb, t.base, thumbFill);
      }
    });
  }
}

/**
 * mão aberta com a palma pra câmera (aceno, oi, comemoração): palma mais clara e quente no meio, base do polegar com
 * volume, linhas da palma, dobras das falanges, almofadas das pontas e polegar separado com sombra de contato.
 * Ligada por opts.hands = { L|R: 'open' } (pedido ao dono do ctx.ts: BuildOptions.hands; o palco pré-monta a variação
 * nas animações de braço erguido, como faz com a expressão).
 */
function openHand(ctx: LayerCtx, s: Side, t: SkinTones): void {
  const { an } = ctx;
  const lite = isLite(ctx);
  const h = handShapes(an, s, { open: true });
  const ax = armAxis(an, s);
  const hs = an.spec.hand;
  ctx.push(h.hand, t.base, { gf: cylGradient(ax.a, ax.b, ax.wl, ax.wr, limbTone(t)) });
  // palma: centro claro e quente (a palma é mais clara que o dorso), sombra na concha da mão
  ctx.push(blob(h.palm[0], h.palm[1], 2.0 * hs, 2.3 * hs), mix(t.lighter, t.blush, 0.18), { o: 0.4, b: 0.7, cp: h.hand });
  ctx.push(h.web, t.deep, { o: 0.22, b: 0.45, cp: h.hand });
  ctx.push(h.nails, t.line, { o: lite ? 0.35 : 0.45 });
  if (!lite) {
    ctx.push(h.grooves.join(''), t.line, { o: 0.32 });
    ctx.push(h.knuckle, t.lighter, { o: 0.3, b: 0.2, cp: h.hand });
  }
  ctx.push(h.thumb, '#140A0C', { o: 0.2, b: 0.4 });
  ctx.push(h.thumb, t.base, { gf: { t: 'r', cx: h.palm[0], cy: h.palm[1], r: 5 * hs, s: [[0, t.lighter], [0.5, t.light], [1, t.base]] } });
}

// ---------------------------------------------------------------------------------------------------------------
// 16. pescoço e cabeça base
// ---------------------------------------------------------------------------------------------------------------

function neckPts(ctx: LayerCtx, bottomY: number | null): SP[] {
  const { an } = ctx;
  const { cx } = an;
  const nw = an.w.neck;
  const top = an.head.cy + 4.2 * an.head.s;
  const cw = an.collarW;
  const cyS = an.collarY - 2.6;
  if (bottomY != null) {
    // gola alta: só o pedaço de pescoço acima dela
    return [
      [cx - nw + 0.15, top, 0],
      [cx - nw, bottomY - 0.5],
      [cx - nw * 0.5, bottomY + 0.3],
      [cx + nw * 0.5, bottomY + 0.3],
      [cx + nw, bottomY - 0.5],
      [cx + nw - 0.15, top, 0],
    ];
  }
  // pescoço de adulto: nasce atrás do ângulo da mandíbula, AFINA um pouco no meio (cintura do esternocleidomastoideo) e
  // o trapézio abre CEDO, em curva, até a borda da gola — coluna visível curta, nada de cilindro/"polegar". O contorno
  // fica logo abaixo da linha do trapézio do tronco (torsoProfile), sem vazar acima do ombro da roupa
  const tr = an.spec.trap;
  const yJ = headAnchors(an).jawL[1] + 0.5;
  const yW = bodyY(an, 36.3);
  const half: SP[] = [
    [cx - nw * 0.99, Math.min(yJ, yW - 1.2)],
    [cx - nw * 0.95, yW],
    [cx - nw - 0.35 - tr * 0.3, bodyY(an, 37.4)],
    [cx - nw - 1.45 - tr * 0.5, bodyY(an, 38.5)],
    [cx - cw, cyS + 0.15, 0.5],
    [cx - cw * 0.62, cyS + (an.collarY - cyS) * 0.72],
  ];
  return [[cx - nw + 0.2, top, 0], ...half, [cx, an.collarY], ...mirrorPts(half, cx), [cx + nw - 0.2, top, 0]];
}

/** 16. pescoço (corpo) + orelhas e cabeça base (cabeça) */
export function neckAndHead(ctx: LayerCtx): void {
  ctx = lodCtx(ctx);
  const t = tonesOf(ctx);
  const { an } = ctx;
  const { cx } = an;
  const lite = isLite(ctx);
  const cover = neckCover(ctx);
  // ---- pescoço (grupo body: fica parado quando a cabeça inclina; o queixo cobre o topo)
  ctx.group('body');
  const neck = smoothPath(neckPts(ctx, cover), true);
  const nw = an.w.neck;
  ctx.push(neck, t.base, {
    gf: { t: 'l', x1: cx - nw - 2, y1: 0, x2: cx + nw + 2, y2: 0, s: [[0, t.light], [0.32, t.base], [0.72, t.shade], [1, t.shade]] },
  });
  const ha = headAnchors(an);
  const f = faceDims(an);
  // sombra que a cabeça projeta no pescoço: o próprio contorno da cabeça deslocado pra baixo e recortado no pescoço (a
  // cabeça, desenhada por cima, esconde o resto) — faixa FORTE colada na mandíbula e no queixo, sumindo em ~2,5 unidades,
  // mais longa do lado da sombra. É o que separa a cabeça do pescoço (nada de "polegar")
  {
    const hp = headPts(an);
    const sh = (dx: number, dy: number) => smoothPath(hp.map((p) => [p[0] + dx, p[1] + dy] as SP), true);
    ctx.push(sh(0.3, 1.0), '#2A0E0A', { o: t.dark ? 0.55 : 0.5, b: 0.3, cp: neck });
    ctx.push(sh(0.7, 2.7), '#2A0E0A', { o: t.dark ? 0.3 : 0.24, b: 0.9, cp: neck });
  }
  // idade: papada como sombra MACIA logo abaixo da linha da mandíbula (o rosto não alarga)
  if (an.feat.age > 0) {
    ctx.push(blob(cx + 0.3, ha.chin[1] + 1.5, f.jaw * 0.62, 1.3), t.deep, { o: 0.1 + an.feat.age * 0.08, b: 0.7, cp: neck });
  }
  if (cover == null) {
    // esternocleidomastoideo: dois músculos que descem de trás das orelhas até a fúrcula em V — luz no da esquerda, sombra
    // no vão entre eles embaixo e no lado de fora do da direita; clavículas com luz em cima
    const top = ha.jawL[1] + 0.4;
    const nb = an.collarY - 0.8;
    // (sombras na mesma camada e luzes na mesma camada: o orçamento de camadas do corpo inteiro é < 260)
    const vShade =
      taperPath([[cx - nw * 0.5, top + 2.4], [cx - nw * 0.3, (top + nb) / 2 + 1.2], [cx - 0.55, nb]], [0, 0.85, 0.3]) +
      taperPath([[cx + nw * 0.5, top + 2.4], [cx + nw * 0.3, (top + nb) / 2 + 1.2], [cx + 0.55, nb]], [0, 0.95, 0.3]);
    const outerShade = lite ? '' : taperPath([[cx + nw * 1.0, top + 0.8], [cx + nw * 0.88, (top + nb) / 2 + 0.6], [cx + nw * 0.55 + 0.6, nb - 0.4]], [0, 1.0, 0]);
    ctx.push(vShade + outerShade, t.deep, { o: lite ? 0.2 : 0.24, b: 0.5, cp: neck });
    if (!lite) {
      ctx.push(
        taperPath([[cx - nw * 0.92, top + 0.6], [cx - nw * 0.62, (top + nb) / 2 + 0.4], [cx - 1.5, nb - 0.6]], [0, 0.9, 0]) +
          taperPath([[cx - an.collarW + 0.5, an.collarY - 2.3], [cx - 2.6, an.collarY - 1.1], [cx - 0.9, an.collarY - 0.5]], [0, 0.55, 0]) +
          taperPath([[cx + an.collarW - 0.5, an.collarY - 2.3], [cx + 2.6, an.collarY - 1.1], [cx + 0.9, an.collarY - 0.5]], [0, 0.55, 0]),
        t.lighter,
        { o: 0.26, b: 0.35, cp: neck },
      );
    }
    ctx.push(blob(cx, an.collarY - 0.9, 0.9, 0.55), t.deep, { o: 0.26, b: 0.3, cp: neck });
    // pele madura: uma ou duas dobras suaves e horizontais no pescoço (sombra estreita com luz embaixo)
    if (an.feat.age > 0 && !lite) {
      const y0 = ha.chin[1] + 2.2;
      let sh = '';
      let li = '';
      const n = an.feat.age >= 1 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const y = y0 + i * 1.6;
        sh += taperPath([[cx - nw * 0.7, y + 0.2], [cx, y + 0.5], [cx + nw * 0.7, y + 0.15]], [0, 0.32, 0]);
        li += taperPath([[cx - nw * 0.6, y + 0.65], [cx, y + 0.95], [cx + nw * 0.6, y + 0.6]], [0, 0.3, 0]);
      }
      ctx.push(sh, mix(t.base, '#1A1210', 0.32), { o: 0.32 * an.feat.age + 0.1, b: 0.2, cp: neck });
      ctx.push(li, t.lighter, { o: 0.22, b: 0.2, cp: neck });
    }
  }

  // ---- cabeça
  ctx.group('head');
  // orelhas: as duas no mesmo path por camada (gradiente vertical vale pras duas)
  {
    const eL = earShapes(an, 'L');
    const eR = earShapes(an, 'R');
    const ears = eL.ear + eR.ear;
    const ey = ha.earL[1];
    ctx.push(ears, t.base, { gf: { t: 'l', x1: cx, y1: ey - 3.2, x2: cx, y2: ey + 3.6, s: [[0, t.light], [0.55, t.base], [1, t.shade]] } });
    // calor sob a pele (orelha é fina: a luz passa avermelhada) e sombra da cabeça na raiz (fica atrás da bochecha)
    ctx.push(ears, t.blush, { o: t.dark ? 0.16 : 0.22, b: 0.5, cp: ears });
    ctx.push(eL.inner + eR.inner + blob(ha.earL[0] + 1.0, ey + 0.2, 0.8, 2.8) + blob(ha.earR[0] - 1.0, ey + 0.2, 0.8, 2.8), t.deep, { o: 0.45, b: 0.25, cp: ears });
    if (!lite) ctx.push(eL.rim + eR.rim, t.lighter, { o: 0.42 });
  }
  const head = headPath(an);
  const { cy } = an.head;
  ctx.push(head, t.base, {
    gf: { t: 'r', cx: cx - 2.8, cy: cy - 3.5, r: 17.5, fx: cx - 4.0, fy: cy - 5.5, s: [[0, mix(t.light, t.lighter, 0.35)], [0.38, t.light], [0.66, t.base], [1, t.shade]] },
  });
  // formas de sombra que acompanham o contorno (crescentes): o lado direito vira pra longe da luz, a borda esquerda cai
  // de leve e o plano de baixo da mandíbula fica no escuro. O contorno deslocado com evenodd dá uma faixa que segue a
  // curva do crânio, da maçã e do queixo — sombra RECORTADA de borda macia, não aerógrafo.
  const shifted = (dx: number, dy: number) => smoothPath(headPts(an).map((p) => [p[0] + dx, p[1] + dy] as SP), true);
  // pele retinta (s8, s14): a sombra já é quase preta — crescente mais leve e o volume vem dos ESPECULARES (testa, ponte,
  // maçã, queixo: ver face.ts), senão nariz, boca e contorno se fundem numa massa só
  const vdark = lum(t.base) < 0.045;
  ctx.push(head + shifted(-2.4, -0.35), t.form, { r: 'evenodd', o: vdark ? 0.5 : t.dark ? 0.7 : 0.62, b: 0.36, cp: head });
  // borda do lado da LUZ: quase nada na pele clara (senão vira contorno de adesivo); um pouco mais na escura (volume)
  ctx.push(head + shifted(1.0, -0.2), t.form, { r: 'evenodd', o: vdark ? 0.12 : t.dark ? 0.2 : 0.06, b: 0.55, cp: head });
  // plano de baixo da mandíbula: faixa curta; no rosto de mandíbula macia (redondo) fica bem mais leve na quina
  const js = f.jawSharp;
  ctx.push(head + shifted(0.3, -1.3 - js * 0.5), t.deep, { r: 'evenodd', o: (t.dark ? 0.34 : 0.26) * (0.75 + js * 0.3), b: 0.45, cp: head });
  const Y = (d: number) => cy + d;
  // sombra da maçã do lado da sombra: entra embaixo do osso (bochecha encovada sutil); mais leve na mandíbula macia
  ctx.push(
    smoothPath([
      [cx + f.cheek - 1.0, Y(f.cheekY + 0.6)],
      [cx + f.cheek - 2.9, Y(f.cheekY + 2.4)],
      [cx + f.jaw - 1.4, Y(f.jawY - 1.2)],
      [cx + f.jaw + 1.5, Y(f.jawY - 0.4)],
      [cx + f.cheek + 1.5, Y(f.cheekY + 1)],
    ]),
    t.form,
    { o: 0.2 + js * 0.16 + an.feat.age * 0.06, b: 0.45, cp: head },
  );
  // luz de recorte no lado da luz (testa, têmpora e maçã esquerdas)
  rimLit(ctx, headPts(an), { color: t.fantasy ?? t.lighter, o: t.dark ? 0.42 : 0.32, w: 1.0, shift: 0.65 });
  // preenchimento frio: luz rebatida azulada na borda do lado da sombra (luz principal quente, ambiente frio)
  // (só do crânio à quina da mandíbula: nunca chega ao queixo; na pele clara ≤ 0,1 pra não virar contorno)
  if (!lite) {
    const right = headPts(an).slice(3, 8).map((p) => [p[0] + 0.15, p[1]] as SP);
    const deepSkin = lum(t.base) < 0.25;
    ctx.stroke(smoothPath(right, false), deepSkin ? mix(t.base, '#C07A62', 0.55) : '#A8BCFF', 1.1, { o: deepSkin ? 0.16 : 0.08, b: 0.55, cp: head });
  }
  // brilho do crânio/testa (careca e testa aparecem bonitas)
  ctx.push(blob(cx - 2.6, cy - 8.4, 4.4, 2.4, -0.25), t.fantasy ?? '#FFFFFF', { o: vdark ? 0.2 : t.dark ? 0.15 : 0.11, b: 1.3, cp: head });
}

// ---------------------------------------------------------------------------------------------------------------
// helper do guarda-roupa: pele do tronco
// ---------------------------------------------------------------------------------------------------------------

/**
 * Pele do tronco (grupo 'body') com volume (peito, costelas, umbigo sutil). Chame no começo do top() quando a peça
 * deixa pele à mostra; a roupa vem por cima. `opts` recorta (top/bottom) como torsoPath.
 */
export function torsoSkin(ctx: LayerCtx, opts: TorsoOpts = {}): void {
  ctx = lodCtx(ctx);
  const t = tonesOf(ctx);
  const { an } = ctx;
  const { cx } = an;
  const d = torsoPath(an, opts);
  ctx.withGroup('body', () => {
    ctx.push(d, t.base, { gf: { t: 'l', x1: cx - an.w.chest, y1: 0, x2: cx + an.w.chest, y2: 0, s: [[0, t.light], [0.38, t.base], [0.85, t.shade], [1, t.shade]] } });
    // linha do peito e sombra das costelas, umbigo
    const cv = 0.6 + an.spec.chestVol * 0.6;
    ctx.push(
      taperPath([[cx - an.w.chest + 2, an.armpitY + 4.6], [cx - 3, an.armpitY + 6.2], [cx - 0.5, an.armpitY + 5.6]], [0, 0.8 * cv, 0]) + taperPath([[cx + an.w.chest - 2, an.armpitY + 4.6], [cx + 3, an.armpitY + 6.2], [cx + 0.5, an.armpitY + 5.6]], [0, 0.8 * cv, 0]),
      t.deep,
      { o: 0.2, b: 0.6, cp: d },
    );
    ctx.push(blob(cx, an.waistY + 2.4, 0.45, 0.65), t.deep, { o: 0.45, cp: d });
  });
}

/**
 * Etapa sugerida "8a" (pedido ao dono do layers.ts): pele do tronco inteira, por baixo da parte de cima, chamada
 * sempre (inclusive no busto e no carro). Enquanto a etapa não existe, o guarda-roupa chama torsoSkin() no top().
 */
export function torsoBase(ctx: LayerCtx): void {
  torsoSkin(ctx);
}
