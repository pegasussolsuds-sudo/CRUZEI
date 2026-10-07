// Objeto na mão DIREITA da tela (slot `held`) e objetos das animações (EmoteDef.prop). Dono: pets.
//
// Contrato:
//   - grupo 'foreR' (gira com o antebraço; pivô no cotovelo) e etiqueta k:'held' (o orquestrador já põe os dois). O
//     palco monta a config com `held` trocado pelo prop da animação ('guitar', 'mic', 'tambourine', 'wand', 'rose'…) e
//     usa essas camadas como k:'prop';
//   - o orquestrador só chama se ctx.scene.showHeld (volante, guidão e pet no colo escondem o objeto);
//   - cada objeto é desenhado UMA vez no espaço do objeto: origem na PEGADA (meio dos dedos da mão direita), "pra cima"
//     (−y) = rumo ao cotovelo (com o braço solto, pra cima de verdade), x+ = lado de fora da mão (mindinho). O objeto
//     acompanha a mão em qualquer pose (está no referencial da mão), então os ids de prop funcionam com o braço erguido;
//   - a parte do objeto que fica ATRÁS dos dedos (cabo, haste, copo) volta pra cá como `zone`: a mão é redesenhada por
//     cima, recortada nessa zona (dedos por cima do cabo, com sombra de contato), com o mesmo desenho do body.ts;
//   - recipientes largos (copo, coco, balde, casquinha: held-food.ts) ficam na frente da palma, cobrem os dedos da mão
//     relaxada e desenham os próprios dedos abraçando a frente; devolvem null.
//
// Referência pros autores de animação (PROP_AXIS): direção principal de cada prop no referencial da mão.

import { armAxis, handShapes, type Side } from '../anatomy';
import type { LayerCtx } from '../ctx';
import { cylGradient, isLite, lodCtx, mix } from '../shading';
import type { Pt } from '../types';

import { tonesOf } from './body';
import { HELD_FLORA } from './held-flora';
import { HELD_FOOD } from './held-food';
import { HELD_MAGIC } from './held-magic';
import { HELD_THINGS } from './held-things';
import { makePen, type Pen } from './pets-kit';

export interface HeldDef {
  /** desenha no espaço do objeto; devolve a parte que fica atrás dos dedos (path no viewBox) ou null */
  draw: (q: Pen) => string | null;
  /** giro (graus, horário) no referencial da mão: 0 = rumo ao cotovelo (pra cima com o braço solto) */
  rot?: number;
  /** deslocamento da origem a partir da pegada (referencial da mão: x pra fora, y rumo às pontas dos dedos) */
  dx?: number;
  dy?: number;
  /** escala no corpo inteiro pequeno (mapa, miniatura ≤ 100 px); padrão LITE_HELD_SCALE */
  liteK?: number;
}

/**
 * no corpo inteiro pequeno (lod 'lite' fora do busto: mapa e miniatura ≤ 100 px) o objeto cresce em volta da pegada, como
 * a cabeça cresce MAP_HEAD_SCALE no mapa: no tamanho real ele vira um pontinho de 2–4 px (estrelinha, microfone, café…)
 */
export const LITE_HELD_SCALE = 1.6;

export const HELD_DEFS: Record<string, HeldDef> = { ...HELD_FLORA, ...HELD_FOOD, ...HELD_THINGS, ...HELD_MAGIC };

/**
 * Direção principal dos props das animações, em graus no referencial da mão (0 = rumo ao cotovelo; 180 = além das pontas
 * dos dedos; positivo = pro lado de fora/mindinho). O objeto gira junto com o antebraço, então a animação escolhe o
 * ângulo do braço pra ele apontar pro lugar certo. As poses citadas foram conferidas na folha (props.png); são somadas ao
 * braço SOLTO (como ART_POSES/fromHang da folha), em graus.
 */
export const PROP_AXIS: Record<string, { axis: number; note: string }> = {
  guitar: { axis: 180, note: 'mão no braço do violão, corpo além das pontas dos dedos. Tocando: armR −55, foreR 110 (corpo na barriga, braço do violão subindo pra fora); a outra mão dedilha no corpo' },
  mic: { axis: 160, note: 'cabeça além das pontas dos dedos, um pouco pra fora (no repouso pende de cabeça pra baixo). Cantando: armR −50, foreR 160 (mão na frente do peito, cabeça na boca)' },
  tambourine: { axis: 150, note: 'mão no aro; o pandeiro fica além dos dedos, pro lado de fora. No alto: armR −160, foreR −15; acenando: armR −108, foreR −60' },
  wand: { axis: 152, note: 'estrela além das pontas dos dedos, pro lado de fora (no repouso fica baixada). No alto: armR −160, foreR −15; feitiço: armR −25, foreR −70' },
  rose: { axis: -18, note: 'haste na mão, flor rumo ao cotovelo e pro lado de dentro: funciona com o antebraço apontando pra baixo. Oferecendo: armR −10, foreR 55; braço aberto: armR −45, foreR 20' },
};

/** definição do objeto (null = nada na mão ou id desconhecido) */
export function heldDef(id: string | null | undefined): HeldDef | null {
  if (!id || id === 'none') return null;
  return Object.prototype.hasOwnProperty.call(HELD_DEFS, id) ? HELD_DEFS[id] : null;
}

/** onde a pegada fica: ao longo da mão (a partir do pulso) e pro lado (unidades da mão, como handShapes) */
const GRIP_ALONG = 5.0;
const GRIP_OUT = -0.25;

/**
 * referencial da mão direita (mesma conta do handShapes): ponto da pegada, giro (graus) que leva o y local pro sentido
 * dos dedos e escala da mão
 */
export function heldFrame(ctx: LayerCtx): { x: number; y: number; rot: number; s: number } {
  const an = ctx.an;
  const side: Side = 'R';
  const w = an.joints.wristR;
  const e = an.joints.elbowR;
  let ux = w[0] - e[0];
  let uy = w[1] - e[1];
  const L = Math.hypot(ux, uy) || 1;
  ux /= L;
  uy /= L;
  let fa = 1;
  const ra = an.rest.armR;
  if (ra === 'hip') {
    const n = Math.hypot(0.12, 1);
    ux = -0.12 / n;
    uy = 1 / n;
    fa = 0.72;
  } else if (ra === 'pocket' || ra === 'soft' || ra === 'lap') {
    const k = ra === 'pocket' ? 0.6 : ra === 'lap' ? 0.4 : 0.75;
    const nx = ux * (1 - k);
    const ny = uy * (1 - k) + k;
    const n = Math.hypot(nx, ny) || 1;
    ux = nx / n;
    uy = ny / n;
    if (ra === 'pocket') fa = 0.86;
  }
  void side;
  const s = an.spec.hand;
  // lado de fora da mão direita = (uy, −ux) (aponta pra direita da tela com o braço solto)
  const hx = uy;
  const hy = -ux;
  return {
    x: w[0] + (ux * GRIP_ALONG * fa + hx * GRIP_OUT) * s,
    y: w[1] + (uy * GRIP_ALONG * fa + hy * GRIP_OUT) * s,
    rot: (Math.atan2(-ux, uy) * 180) / Math.PI,
    s,
  };
}

/** a mão redesenhada por cima do objeto, só dentro de `zone`: dedos por cima do cabo, com sombra de contato */
function regrip(ctx: LayerCtx, zone: string): void {
  const { an } = ctx;
  const lite = isLite(ctx);
  const t = tonesOf(ctx);
  const h = handShapes(an, 'R');
  const ax = armAxis(an, 'R');
  const hs = an.spec.hand;
  if (!lite) ctx.push(h.hand, '#120808', { o: 0.32, b: 0.7, cp: zone });
  ctx.push(h.hand, t.base, { gf: cylGradient(ax.a, ax.b, ax.wl, ax.wr, { light: t.light, base: t.base, shade: t.shade, bounce: mix(t.shade, t.bounce, 0.45), edge: mix(t.base, t.shade, 0.2) }), cp: zone });
  ctx.push(h.grooves.join(''), t.deep, { o: lite ? 0.45 : 0.6, cp: zone });
  if (!lite) {
    ctx.push(h.knuckle, t.lighter, { o: 0.38, b: 0.2, cp: zone });
    ctx.push(h.nails, mix(t.lighter, '#FFE8E0', 0.4), { o: 0.6, cp: zone });
  }
  const palm: Pt = h.palm;
  // sombra do polegar: sem o desfoque (lite) o polegar logo abaixo cobre ela inteira
  if (!lite) ctx.push(h.thumb, '#140A0C', { o: 0.22, b: 0.4, cp: zone });
  ctx.push(h.thumb, t.base, { gf: { t: 'r', cx: palm[0] - 1.0, cy: palm[1] - 0.6, r: 5.5 * hs, s: [[0, t.lighter], [0.5, t.light], [1, t.base]] }, cp: zone });
}

/** 15. objeto na mão direita */
export function heldItem(ctx: LayerCtx): void {
  ctx = lodCtx(ctx);
  const def = heldDef(ctx.cfg.held);
  if (!def) return;
  const f = heldFrame(ctx);
  const k = isLite(ctx) && ctx.opts.mode !== 'bust' ? (def.liteK ?? LITE_HELD_SCALE) : 1;
  const hand = makePen(ctx, f.x, f.y, f.s * k, f.rot);
  const q = def.dx || def.dy || def.rot ? hand.sub(def.dx ?? 0, def.dy ?? 0, 1, def.rot ?? 0) : hand;
  const zone = def.draw(q);
  if (zone) regrip(ctx, zone);
}
