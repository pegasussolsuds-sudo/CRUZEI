// Camadas → modelo SVG (defs + grupos com transformação + paths), sem dependência de RN.
// Quem usa: <CruzeiAvatar/> (react-native-svg) e a folha de contato (string SVG → sharp). Assim os dois desenham
// exatamente a mesma coisa: gradientes (gf/gs), recorte (cp), desfoque (b), tracejado (da) e a matemática da pose.
//
// Desfoque:
//   'filter' = feGaussianBlur de verdade (folha de contato; no app só com hq, porque filtro em lista pesa);
//   'approx' = sem filtro: preenchimento a 75% + traço de 2σ a 35% em volta (borda macia barata);
//   'half'   = fallback do contrato: sem desfoque e com metade da opacidade.

import type { Pose } from './pose';
import { groupMatrix, mIsIdentity, mMul, mToSvg, type Mat } from './rig';
import type { AvatarGradient, AvatarGroup, AvatarLayer, AvatarRig } from './types';

export type SvgBlurMode = 'filter' | 'approx' | 'half';

export interface SvgStop {
  offset: number;
  color: string;
  opacity: number;
}
export interface SvgGradientDef {
  id: string;
  kind: 'linear' | 'radial';
  /** linear */
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  /** radial */
  cx?: number;
  cy?: number;
  r?: number;
  fx?: number;
  fy?: number;
  stops: SvgStop[];
}
export interface SvgClipDef {
  id: string;
  d: string;
}
export interface SvgBlurDef {
  id: string;
  sigma: number;
}
export interface SvgPathNode {
  key: string;
  d: string;
  /** 'none', cor, ou url(#id) */
  fill: string;
  fillRule: 'nonzero' | 'evenodd';
  stroke?: string;
  strokeWidth?: number;
  cap: 'round' | 'butt';
  dash?: number[];
  opacity: number;
  clipId?: string;
  filterId?: string;
}
export interface SvgRun {
  g: AvatarGroup;
  /** null = sem transformação (identidade) */
  mat: Mat | null;
  transform: string | null;
  nodes: SvgPathNode[];
}
export interface SvgModel {
  grads: SvgGradientDef[];
  clips: SvgClipDef[];
  blurs: SvgBlurDef[];
  runs: SvgRun[];
}

export interface SvgModelOptions {
  /** prefixo dos ids (único por instância/célula) */
  idp: string;
  /** com rig + pose cada grupo ganha a sua matriz; sem, desenha tudo na pose de repouso sem transformação */
  rig?: AvatarRig | null;
  pose?: Pose | null;
  blur?: SvgBlurMode;
  /** escala da cabeça inteira em volta da base do pescoço (figura pequena: MAP_HEAD_SCALE, como no mapa); exige rig */
  headScale?: number;
}

/** separa a alfa de uma cor CSS (hex #RGB/#RRGGBB/#RRGGBBAA, rgb(), rgba()) → [hex, alfa] */
export function splitAlpha(css: string): [string, number] {
  const s = css.trim();
  if (s[0] === '#') {
    const h = s.slice(1);
    if (h.length === 3) return ['#' + h.split('').map((c) => c + c).join(''), 1];
    if (h.length === 8) return ['#' + h.slice(0, 6), parseInt(h.slice(6), 16) / 255];
    return [s, 1];
  }
  const m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (m) {
    const p = m[1].split(',').map((x) => parseFloat(x));
    const hex = '#' + [p[0], p[1], p[2]].map((v) => Math.max(0, Math.min(255, Math.round(v || 0))).toString(16).padStart(2, '0')).join('');
    return [hex, p.length > 3 && Number.isFinite(p[3]) ? p[3] : 1];
  }
  return [s, 1];
}

function gradientDef(id: string, g: AvatarGradient): SvgGradientDef {
  const stops: SvgStop[] = g.s.map((st) => {
    const [hex, a] = splitAlpha(st[1]);
    const extra = st.length > 2 ? (st[2] as number) : 1;
    return { offset: Math.max(0, Math.min(1, st[0])), color: hex, opacity: a * extra };
  });
  if (g.t === 'l') return { id, kind: 'linear', x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2, stops };
  return { id, kind: 'radial', cx: g.cx, cy: g.cy, r: g.r, fx: g.fx ?? g.cx, fy: g.fy ?? g.cy, stops };
}

/**
 * miniatura de lista (≤ 56 px, ~1,2 px por unidade): tira as camadas que nem aparecem nesse tamanho mas custam nó no
 * Fabric — véus de sombra/brilho recortados bem fracos (o ≤ 0,2) e qualquer camada quase transparente (o < 0,1). O
 * rosto da expressão (k 'face') fica sempre. Corta ~20% dos paths e parte dos clipPaths do busto leve.
 * ponytail: filtro por opacidade; se a rolagem do inbox ainda engasgar no Moto g54, rasterizar a miniatura pelo Skia de
 * CPU (mesmo pipeline do mapa, PNG em cache por avatarKey) e mostrar uma <Image>.
 */
export function microLayers(layers: readonly AvatarLayer[]): AvatarLayer[] {
  return layers.filter((l) => {
    if (l.k === 'face') return true;
    const o = l.o ?? 1;
    return !(o < 0.1 || (l.cp && o <= 0.2));
  });
}

/** monta o modelo SVG das camadas */
export function buildSvgModel(layers: readonly AvatarLayer[], opts: SvgModelOptions): SvgModel {
  const { idp } = opts;
  const blurMode = opts.blur ?? 'approx';
  const hk = opts.headScale && opts.headScale !== 1 && opts.rig ? opts.headScale : 0;
  const posed = !!(opts.rig && (opts.pose || hk));
  const grads: SvgGradientDef[] = [];
  const clips: SvgClipDef[] = [];
  const blurs: SvgBlurDef[] = [];
  const clipIds = new Map<string, string>();
  // gradientes iguais (as duas metades do membro, frente e costas da peça) viram um def só: menos nós nas listas
  const gradIds = new Map<string, string>();
  const gradId = (gr: AvatarGradient): string => {
    const k = JSON.stringify(gr);
    let id = gradIds.get(k);
    if (!id) {
      id = `${idp}g${grads.length}`;
      grads.push(gradientDef(id, gr));
      gradIds.set(k, id);
    }
    return id;
  };
  const blurIds = new Map<number, string>();
  const runs: SvgRun[] = [];
  const matCache = new Map<AvatarGroup, Mat | null>();
  let cur: SvgRun | null = null;
  let n = 0;

  const matOf = (g: AvatarGroup): Mat | null => {
    if (!posed) return null;
    if (matCache.has(g)) return matCache.get(g) ?? null;
    const rig = opts.rig as AvatarRig;
    let M = opts.pose ? groupMatrix(g, rig, opts.pose) : ([1, 0, 0, 1, 0, 0] as Mat);
    if (g === 'head' && hk) M = mMul(M, [hk, 0, 0, hk, rig.head[0] * (1 - hk), rig.head[1] * (1 - hk)]);
    const v = mIsIdentity(M) ? null : M;
    matCache.set(g, v);
    return v;
  };

  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    const g: AvatarGroup = l.g ?? 'body';
    if (!cur || cur.g !== g) {
      const mat = matOf(g);
      cur = { g, mat, transform: mat ? mToSvg(mat) : null, nodes: [] };
      runs.push(cur);
    }
    const baseO = l.o == null ? 1 : l.o;
    let fill = 'none';
    if (l.gf) fill = `url(#${gradId(l.gf)})`;
    else if (l.f) fill = l.f;
    let stroke: string | undefined;
    if (l.gs) stroke = `url(#${gradId(l.gs)})`;
    else if (l.s) stroke = l.s;
    let clipId: string | undefined;
    if (l.cp) {
      clipId = clipIds.get(l.cp);
      if (!clipId) {
        clipId = `${idp}c${clips.length}`;
        clips.push({ id: clipId, d: l.cp });
        clipIds.set(l.cp, clipId);
      }
    }
    const node: SvgPathNode = {
      key: `${i}`,
      d: l.d,
      fill,
      fillRule: l.r === 'evenodd' ? 'evenodd' : 'nonzero',
      stroke,
      strokeWidth: stroke ? (l.w ?? 1) : undefined,
      cap: l.c ?? 'round',
      dash: l.da && l.da.length ? l.da : undefined,
      opacity: baseO,
      clipId,
    };
    const sigma = l.b && l.b > 0 ? l.b : 0;
    if (sigma > 0 && blurMode === 'filter') {
      const q = Math.round(sigma * 100) / 100;
      let fid = blurIds.get(q);
      if (!fid) {
        fid = `${idp}b${blurs.length}`;
        blurs.push({ id: fid, sigma: q });
        blurIds.set(q, fid);
      }
      node.filterId = fid;
      cur.nodes.push(node);
    } else if (sigma > 0 && blurMode === 'approx') {
      // borda macia: o traço largo em volta faz a "saia" do desfoque, o miolo fica um pouco mais fraco
      cur.nodes.push({ ...node, opacity: baseO * 0.75 });
      const halo = fill !== 'none' ? fill : stroke;
      if (halo) {
        cur.nodes.push({
          key: `${i}h`,
          d: l.d,
          fill: 'none',
          fillRule: node.fillRule,
          stroke: halo,
          strokeWidth: (stroke && fill === 'none' ? (l.w ?? 1) : 0) + sigma * 2,
          cap: 'round',
          opacity: baseO * 0.35,
          clipId,
        });
      }
    } else if (sigma > 0) {
      cur.nodes.push({ ...node, opacity: baseO * 0.5 });
    } else cur.nodes.push(node);
    n++;
  }
  void n;
  return { grads, clips, blurs, runs };
}

// ---------------------------------------------------------------------------------------------------------------
// Serialização em string (folha de contato / testes). O <CruzeiAvatar/> mapeia o mesmo modelo pra componentes.
// ---------------------------------------------------------------------------------------------------------------
const num = (v: number) => String(Math.round(v * 10000) / 10000);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** <defs> + grupos do modelo (sem o <svg> externo) */
export function svgModelToString(m: SvgModel): string {
  const out: string[] = [];
  if (m.grads.length || m.clips.length || m.blurs.length) {
    out.push('<defs>');
    for (const g of m.grads) {
      const stops = g.stops.map((s) => `<stop offset="${num(s.offset)}" stop-color="${esc(s.color)}" stop-opacity="${num(s.opacity)}"/>`).join('');
      if (g.kind === 'linear') {
        out.push(`<linearGradient id="${g.id}" gradientUnits="userSpaceOnUse" x1="${num(g.x1 ?? 0)}" y1="${num(g.y1 ?? 0)}" x2="${num(g.x2 ?? 0)}" y2="${num(g.y2 ?? 0)}">${stops}</linearGradient>`);
      } else {
        out.push(
          `<radialGradient id="${g.id}" gradientUnits="userSpaceOnUse" cx="${num(g.cx ?? 0)}" cy="${num(g.cy ?? 0)}" r="${num(g.r ?? 0)}" fx="${num(g.fx ?? 0)}" fy="${num(g.fy ?? 0)}">${stops}</radialGradient>`,
        );
      }
    }
    for (const c of m.clips) out.push(`<clipPath id="${c.id}" clipPathUnits="userSpaceOnUse"><path d="${esc(c.d)}"/></clipPath>`);
    for (const b of m.blurs) {
      out.push(`<filter id="${b.id}" filterUnits="userSpaceOnUse" x="-60" y="-60" width="220" height="260"><feGaussianBlur stdDeviation="${num(b.sigma)}"/></filter>`);
    }
    out.push('</defs>');
  }
  for (const r of m.runs) {
    if (r.transform) out.push(`<g transform="${r.transform}">`);
    for (const p of r.nodes) {
      const a: string[] = [`d="${esc(p.d)}"`, `fill="${esc(p.fill)}"`];
      if (p.fillRule === 'evenodd') a.push('fill-rule="evenodd"');
      if (p.stroke) {
        a.push(`stroke="${esc(p.stroke)}"`, `stroke-width="${num(p.strokeWidth ?? 1)}"`, `stroke-linecap="${p.cap}"`, 'stroke-linejoin="round"');
        if (p.dash) a.push(`stroke-dasharray="${p.dash.map(num).join(' ')}"`);
      }
      if (p.opacity !== 1) a.push(`opacity="${num(p.opacity)}"`);
      if (p.filterId) a.push(`filter="url(#${p.filterId})"`);
      const path = `<path ${a.join(' ')}/>`;
      // recorte num <g> próprio: o desfoque acontece antes e é cortado pelo recorte (igual ao clipPath + MaskFilter do Skia)
      out.push(p.clipId ? `<g clip-path="url(#${p.clipId})">${path}</g>` : path);
    }
    if (r.transform) out.push('</g>');
  }
  return out.join('');
}
