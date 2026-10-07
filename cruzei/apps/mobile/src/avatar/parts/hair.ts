// Cabelo (parte de trás e da frente) e barba. Dono: cabelo.
//
// Etapas do orquestrador (layers.ts):  4 hairBack (atrás de tudo do corpo)  ·  18 facialHair  ·  21 hairFront
// Grupo: 'head' em tudo (o cabelo gira com a cabeça).
//
// Arquivos:
//   hair-kit.ts      tons, referencial da cabeça unitária, mechas, brilho anelar, raspado, tranças/twists/locs, cachos
//   hair-long.ts     liso e ondulado (longo, ondulado, franja cortina, chanel; registro em hair-long-styles.ts) — mechas com dobra no ombro
//   hair-short.ts    curtos e penteados (curto, raspado, risca, topete, clássico, entradas, ralo, pixie, undercut,
//                    pompadour, moicano, mullet, raspado lateral)
//   hair-textured.ts cacheado, cacheado longo, black power, puff, twists, nagô, tranças, dreads, trança coroa
//   hair-updo.ts     rabo de cavalo, coque, coque elegante, coque baixo, coquinhos
//   hair-beard.ts    barbas e bigodes (11 do catálogo, sobre o contorno do rosto de cada formato)
//
// Chapéus (contrato com a chapelaria em hat-modes.ts): o cabelo lê hatModeOf(cfg.hat)
//   none/band/crown  cabelo inteiro
//   cap / brim       o topo ACHATA (sem volume acima do crânio: o chapéu cobre a calota com folga ≥ 0,6); laterais, nuca e
//                    cabelo longo aparecem; franja só no 'cap' (menos gorro e durag); coque, crista, puff e trança coroa
//                    somem; o black power vira volume pras laterais, embaixo do chapéu
//   wrap (turbante, durag) nada na frente; atrás, só o cabelo solto e longo (liso, ondulado, cortina, cacheado longo) sai de
//                    baixo do pano atrás das orelhas e cai por trás da cabeça e dos ombros numa massa só; mecha separada
//                    (tranças, twists, dreads, nagô), raspado lateral, mullet e presos (rabo, coque) ficam dentro do pano
//   full (hijab)     nenhum cabelo (a barba continua)

import { smoothPath, type SP } from '../anatomy';
import type { LayerCtx } from '../ctx';

import { BEARDS } from './hair-beard';
import { makeKit, type HairKit } from './hair-kit';
import { LONG_STYLES } from './hair-long-styles';
import { SHORT_STYLES } from './hair-short';
import { TEXTURED_STYLES } from './hair-textured';
import { UPDO_STYLES } from './hair-updo';
import { earAccessory } from './headwear';

export { hairTones, type HairTones } from './hair-kit';

/** um penteado: o que vai atrás do corpo (etapa 4) e o que vai por cima do rosto (etapa 21) */
export interface HairStyle {
  back?: (k: HairKit) => void;
  front?: (k: HairKit) => void;
  /** com turbante/durag: o cabelo solto e longo sai de baixo do pano, atrás (só os lisos/ondulados/cacheados longos) */
  belowWrap?: boolean;
}

export const HAIR_STYLES: Record<string, HairStyle> = {
  bald: {},
  ...SHORT_STYLES,
  ...LONG_STYLES,
  ...TEXTURED_STYLES,
  ...UPDO_STYLES,
};

/**
 * turbante/durag com cabelo solto e longo: o cabelo SAI de baixo do pano atrás das orelhas e cai por trás da cabeça,
 * do pescoço e dos ombros numa massa só, com o desenho e o tom do próprio penteado. (Começando só na mandíbula, estreito
 * no pescoço, ele lia duas tiras soltas dos lados do pescoço — alças, não cabelo.)
 */
function belowWrap(k: HairKit, fn: (k: HairKit) => void): void {
  const { an, H } = k;
  const cx = k.cx;
  const nk = an.w.neck;
  const sY = an.shoulderY;
  const wide = nk + (k.ctx.cfg.hair === 'long_curly' ? 6.4 : 5.0);
  const side = (g: number): SP[] => [
    H(g * (k.Wc + 2.4), -1.4),
    H(g * (k.Jw + 3.0), k.jawY + 0.6),
    [cx + g * (wide + 0.2), sY - 0.6],
    // pontas: três mechas que afinam, a de fora mais curta
    [cx + g * (wide + 0.8), sY + 2.4, 0],
    [cx + g * (wide - 1.0), sY + 2.8],
    [cx + g * (wide - 0.6), sY + 5.0, 0],
    [cx + g * (wide - 2.4), sY + 4.8],
    [cx + g * (wide - 2.2), sY + 7.4, 0],
    [cx + g * (nk + 0.4), sY + 6.4],
  ];
  const cut = smoothPath([H(0, -3.2), ...side(1), [cx, sY + 9], ...side(-1).reverse()]);
  const base = k.ctx;
  const proxy = Object.create(base) as LayerCtx;
  Object.assign(proxy, {
    push: (d: string, f?: string, extra?: Record<string, unknown>) => (extra && extra.cp ? base.layers[base.layers.length - 1] : base.push(d, f, { ...extra, cp: cut })),
    stroke: (d: string, st: string, w: number, extra?: Record<string, unknown>) => (extra && extra.cp ? base.layers[base.layers.length - 1] : base.stroke(d, st, w, { ...extra, cp: cut })),
  });
  fn({ ...k, ctx: proxy });
}

/** 4. cabelo de trás (atrás do capuz, das pernas e do tronco) */
export function hairBack(ctx: LayerCtx): void {
  ctx.group('head');
  const st = HAIR_STYLES[ctx.cfg.hair];
  if (!st?.back) return;
  const k = makeKit(ctx);
  if (k.mode === 'full') return;
  if (k.mode === 'wrap') {
    if (st.belowWrap) belowWrap(k, st.back);
    return;
  }
  st.back(k);
}

/** 21. cabelo da frente (calota, franja, mechas da frente, costeletas), por cima do rosto */
export function hairFront(ctx: LayerCtx): void {
  ctx.group('head');
  // 21a. acessório de orelha por baixo do cabelo da frente (cabelo longo cobre a orelha: o brinco não boia por cima)
  earAccessory(ctx);
  const st = HAIR_STYLES[ctx.cfg.hair];
  if (!st?.front) return;
  const k = makeKit(ctx);
  if (k.mode === 'full' || k.mode === 'wrap') return;
  st.front(k);
}

/** 18. barba e bigode (cor do cabelo), antes da expressão (olhos e boca ficam por cima) */
export function facialHair(ctx: LayerCtx): void {
  ctx.group('head');
  const fn = BEARDS[ctx.cfg.facialHair];
  if (!fn) return;
  // busto leve: a borda da barba fica macia (desfoque nas camadas de borda); sem isso viravam blocos chapados
  fn(makeKit(ctx, undefined, { bustBlur: true }));
}
