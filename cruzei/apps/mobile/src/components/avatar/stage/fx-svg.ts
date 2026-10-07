// Caneta SVG dos efeitos (JS puro): a MESMA descrição dos efeitos (fx-auras / fx-backdrops) vira um modelo SVG estático
// pro <CruzeiAvatar/> das listas e miniaturas, e pra folha de prova. Dono: efeitos.
//
// O modelo é achatado: cada nó é um path com os pontos já transformados (a matriz atual da caneta é aplicada nos
// pontos), gradientes em userSpaceOnUse com gradientTransform = matriz do momento, e o brilho suave usa um gradiente
// radial por cor em objectBoundingBox (um só <RadialGradient> serve pra todas as partículas daquela cor).
// Mistura aditiva/tela não existe no react-native-svg: vira mistura normal com um pouco menos de alfa.
// Ids são locais ('g0', 'c1'…): quem renderiza prefixa com o id da instância.

import { arcCmds, clamp01, ovalCmds, rgbHex, rrectCmds, sampleCycle, type FxGrad, type FxPaint, type Pen, type Rgb } from './fx-core';

export interface FxSvgStop {
  o: number;
  c: string;
  a: number;
}

export interface FxSvgGrad {
  id: string;
  kind: 'l' | 'r';
  /** objectBoundingBox (brilho por cor) em vez de userSpaceOnUse */
  bbox?: boolean;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  cx?: number;
  cy?: number;
  r?: number;
  /** gradientTransform 'matrix(...)' */
  tf?: string;
  stops: FxSvgStop[];
}

export interface FxSvgNode {
  d: string;
  /** cor '#rrggbb' ou id de gradiente local (prefixo 'url:') */
  fill?: string;
  stroke?: string;
  sw?: number;
  o?: number;
  cap?: 'round' | 'butt';
  /** recortes de fora pra dentro (recorte dentro de recorte = interseção) */
  clip?: string[];
  /** fill-rule evenodd */
  eo?: boolean;
}

export interface FxSvgModel {
  nodes: FxSvgNode[];
  grads: FxSvgGrad[];
  clips: { id: string; d: string }[];
}

type M = [number, number, number, number, number, number];

const GLOW_STOPS: [number, number][] = [
  [0, 1],
  [0.18, 0.72],
  [0.4, 0.34],
  [0.65, 0.11],
  [1, 0],
];

function f2(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

/** caneta que acumula um modelo SVG; `shapes` = fx-shapes.SHAPES */
export function svgPen(shapes: Record<string, number[]>, lite = true): Pen & { model(): FxSvgModel } {
  let m: M = [1, 0, 0, 1, 0, 0];
  const stack: { m: M; clip: string[] | undefined }[] = [];
  let clip: string[] | undefined;
  const nodes: FxSvgNode[] = [];
  const grads: FxSvgGrad[] = [];
  const clips: { id: string; d: string }[] = [];
  const glowIds = new Map<string, string>();

  const mul = (b: M) => {
    const a = m;
    m = [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
  };
  const scaleOf = () => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  const tfStr = () => `matrix(${m.map(f2).join(' ')})`;
  const d = (c: number[]): string => {
    let s = '';
    let i = 0;
    const pt = (x: number, y: number) => `${f2(m[0] * x + m[2] * y + m[4])},${f2(m[1] * x + m[3] * y + m[5])}`;
    while (i < c.length) {
      const op = c[i];
      if (op === 0) {
        s += 'M' + pt(c[i + 1], c[i + 2]);
        i += 3;
      } else if (op === 1) {
        s += 'L' + pt(c[i + 1], c[i + 2]);
        i += 3;
      } else if (op === 2) {
        s += 'Q' + pt(c[i + 1], c[i + 2]) + ' ' + pt(c[i + 3], c[i + 4]);
        i += 5;
      } else if (op === 3) {
        s += 'C' + pt(c[i + 1], c[i + 2]) + ' ' + pt(c[i + 3], c[i + 4]) + ' ' + pt(c[i + 5], c[i + 6]);
        i += 7;
      } else {
        s += 'Z';
        i += 1;
      }
    }
    return s;
  };
  const gradOf = (g: FxGrad): string => {
    const id = 'g' + grads.length;
    const stops = g.s.map((s) => ({ o: clamp01(s[0]), c: rgbHex(s[1]), a: clamp01(s[2]) }));
    const tf = m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0 ? undefined : tfStr();
    if (g.t === 'l') grads.push({ id, kind: 'l', x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2, tf, stops });
    else grads.push({ id, kind: 'r', cx: g.cx, cy: g.cy, r: g.r, tf, stops });
    return id;
  };
  const glowId = (c: Rgb): string => {
    const key = rgbHex(c);
    let id = glowIds.get(key);
    if (!id) {
      id = 'g' + grads.length;
      grads.push({ id, kind: 'r', bbox: true, cx: 0.5, cy: 0.5, r: 0.5, stops: GLOW_STOPS.map(([o, a]) => ({ o, c: key, a })) });
      glowIds.set(key, id);
    }
    return id;
  };
  const alphaOf = (p: FxPaint) => clamp01((p.a == null ? 1 : p.a) * (p.b ? 0.85 : 1));
  const emit = (c: number[], p: FxPaint) => {
    const o = alphaOf(p);
    if (o <= 0.003) return;
    const paint = p.g ? 'url:' + gradOf(p.g) : rgbHex(p.c == null ? 0xffffff : p.c);
    const n: FxSvgNode = { d: d(c), o: o < 1 ? Math.round(o * 1000) / 1000 : undefined, clip };
    if (p.eo) n.eo = true;
    if (p.w != null) {
      n.stroke = paint;
      n.sw = Math.round(p.w * scaleOf() * 100) / 100;
      n.cap = p.cap === 1 ? 'butt' : 'round';
    } else {
      n.fill = paint;
    }
    nodes.push(n);
  };
  const glowAt = (cx: number, cy: number, rx: number, ry: number, c: Rgb, a: number, b?: number) => {
    const o = clamp01(a * (b ? 0.85 : 1));
    if (o <= 0.003 || rx <= 0 || ry <= 0) return;
    nodes.push({ d: d(ovalCmds(cx, cy, rx, ry)), fill: 'url:' + glowId(c), o: o < 1 ? Math.round(o * 1000) / 1000 : undefined, clip });
  };

  return {
    lite,
    save: () => {
      stack.push({ m: [...m] as M, clip });
    },
    restore: () => {
      const s = stack.pop();
      if (s) {
        m = s.m;
        clip = s.clip;
      }
    },
    translate: (x, y) => mul([1, 0, 0, 1, x, y]),
    rotate: (deg) => {
      const a = (deg * Math.PI) / 180;
      mul([Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]);
    },
    scale: (sx, sy) => mul([sx, 0, 0, sy, 0, 0]),
    circle: (cx, cy, r, p) => {
      if (r > 0) emit(ovalCmds(cx, cy, r, r), p);
    },
    oval: (cx, cy, rx, ry, p) => {
      if (rx > 0 && ry > 0) emit(ovalCmds(cx, cy, rx, ry), p);
    },
    rect: (x, y, w, h, p) => emit(rrectCmds(x, y, w, h, 0), p),
    rrect: (x, y, w, h, r, p) => emit(rrectCmds(x, y, w, h, r), p),
    path: (c, p) => emit(c, p),
    shape: (key, x, y, size, rot, p, sx, sy) => {
      const c = shapes[key];
      if (!c || size <= 0) return;
      const save = [...m] as M;
      mul([1, 0, 0, 1, x, y]);
      if (rot) {
        const a = (rot * Math.PI) / 180;
        mul([Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]);
      }
      mul([size * (sx == null ? 1 : sx), 0, 0, size * (sy == null ? 1 : sy), 0, 0]);
      // traço na unidade de fora da forma (igual ao Skia: largura / tamanho dentro da escala)
      emit(c, p.w != null ? { ...p, w: p.w / size } : p);
      m = save;
    },
    glow: (cx, cy, r, c, a, b) => glowAt(cx, cy, r, r, c, a, b),
    glowOval: (cx, cy, rx, ry, c, a, b) => glowAt(cx, cy, rx, ry, c, a, b),
    ring: (cx, cy, rx, ry, w, colors, rot, a, a0, sweep, b) => {
      // sem gradiente de varredura no SVG: arcos curtos, cada um com a cor do meio
      const sw = sweep == null ? 360 : sweep;
      const start = a0 == null ? 0 : a0;
      const n = Math.max(3, Math.round((Math.abs(sw) / 360) * (lite ? 18 : 36)));
      const step = sw / n;
      for (let i = 0; i < n; i++) {
        const mid = start + step * (i + 0.5);
        const col = sampleCycle(colors, (mid - rot) / 360);
        // opaco: passo um pouco maior que o arco (sem fresta entre os pedaços). Translúcido: emenda exata — sobrepor dobra
        // a alfa e cada emenda virava um risco transversal (efeito escada na faixa larga do arco-íris)
        const ov = alphaOf({ a, b }) < 0.98 ? 0 : 0.6;
        emit(arcCmds(cx, cy, rx, ry, start + step * i - ov, step + ov * 2), { c: col, a, w, cap: 1, b });
      }
    },
    clipRRect: (x, y, w, h, r) => {
      const id = 'c' + clips.length;
      clips.push({ id, d: d(rrectCmds(x, y, w, h, r)) });
      clip = clip ? [...clip, id] : [id];
    },
    clipOval: (cx, cy, rx, ry) => {
      const id = 'c' + clips.length;
      clips.push({ id, d: d(ovalCmds(cx, cy, rx, ry)) });
      clip = clip ? [...clip, id] : [id];
    },
    model: () => ({ nodes, grads, clips }),
  };
}

/** modelo → string SVG (sem o <svg> externo); `idp` prefixa os ids (folha de prova e testes) */
export function fxSvgToString(model: FxSvgModel, idp: string): string {
  const out: string[] = [];
  if (model.grads.length || model.clips.length) {
    out.push('<defs>');
    for (const g of model.grads) {
      const stops = g.stops.map((s) => `<stop offset="${f2(s.o)}" stop-color="${s.c}" stop-opacity="${f2(s.a)}"/>`).join('');
      const tf = g.tf ? ` gradientTransform="${g.tf}"` : '';
      const units = g.bbox ? '' : ' gradientUnits="userSpaceOnUse"';
      if (g.kind === 'l') out.push(`<linearGradient id="${idp}${g.id}"${units}${tf} x1="${f2(g.x1 ?? 0)}" y1="${f2(g.y1 ?? 0)}" x2="${f2(g.x2 ?? 0)}" y2="${f2(g.y2 ?? 0)}">${stops}</linearGradient>`);
      else out.push(`<radialGradient id="${idp}${g.id}"${units}${tf} cx="${f2(g.cx ?? 0)}" cy="${f2(g.cy ?? 0)}" r="${f2(g.r ?? 0)}">${stops}</radialGradient>`);
    }
    for (const c of model.clips) out.push(`<clipPath id="${idp}${c.id}"><path d="${c.d}"/></clipPath>`);
    out.push('</defs>');
  }
  const paint = (p: string | undefined) => (!p ? 'none' : p.startsWith('url:') ? `url(#${idp}${p.slice(4)})` : p);
  for (const n of model.nodes) {
    const attrs = [`d="${n.d}"`, `fill="${paint(n.fill)}"`];
    if (n.eo) attrs.push('fill-rule="evenodd"');
    if (n.stroke) attrs.push(`stroke="${paint(n.stroke)}"`, `stroke-width="${n.sw}"`, `stroke-linecap="${n.cap}"`, 'stroke-linejoin="round"');
    if (n.o != null) attrs.push(`opacity="${n.o}"`);
    let el = `<path ${attrs.join(' ')}/>`;
    if (n.clip) for (let i = n.clip.length - 1; i >= 0; i--) el = `<g clip-path="url(#${idp}${n.clip[i]})">${el}</g>`;
    out.push(el);
  }
  return out.join('');
}
