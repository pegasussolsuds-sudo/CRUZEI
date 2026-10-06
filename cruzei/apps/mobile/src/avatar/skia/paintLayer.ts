// Pintura de UMA camada do avatar num SkCanvas (imperativo, sem componentes): o raster do mapa (images/draw.ts, Skia
// de CPU) e o palco animado (AvatarStage, que grava SkPictures) usam esta mesma função — o desenho é igual nos dois.
//
// Contrato da camada (types.ts): f/s/w/o/r/c + gf/gs (shader de gradiente), b (MaskFilter de desfoque, sigma em
// unidades do viewBox: respeita a matriz), cp (clipPath com antisserrilhado), da (DashPathEffect), k (ignorada aqui).
// Opacidade `o` multiplica a alfa da cor (preenchimento e traço separados, como o canvas 2D antigo).

import { BlurStyle, ClipOp, FillType, PaintStyle, Skia, StrokeCap, StrokeJoin, TileMode, type SkCanvas, type SkColor, type SkPaint, type SkPath, type SkShader } from '@shopify/react-native-skia';

import type { AvatarGradient, AvatarLayer } from '../types';

/** objeto nativo que pode ser liberado */
export interface Disposable {
  dispose(): void;
}

export interface PaintEnv {
  /** registra objetos nativos temporários (o chamador libera no fim); identidade = não registra */
  track<T extends Disposable>(o: T): T;
  /** path do 'd' (com cache do chamador); null = inválido */
  path(d: string, evenOdd: boolean): SkPath | null;
  /** cor CSS → SkColor (com cache do chamador) */
  color(css: string): SkColor;
}

export interface LayerPaints {
  fill: SkPaint;
  stroke: SkPaint;
}

/** pincéis reaproveitáveis (um par por desenho) */
export function makeLayerPaints(env: PaintEnv): LayerPaints {
  const fill = env.track(Skia.Paint());
  fill.setAntiAlias(true);
  fill.setStyle(PaintStyle.Fill);
  const stroke = env.track(Skia.Paint());
  stroke.setAntiAlias(true);
  stroke.setStyle(PaintStyle.Stroke);
  stroke.setStrokeJoin(StrokeJoin.Round);
  stroke.setStrokeMiter(10);
  return { fill, stroke };
}

function setColor(p: SkPaint, c: SkColor, alpha: number): void {
  p.setColor(c);
  if (alpha !== 1) p.setAlphaf(c[3] * alpha);
}

/** shader do gradiente (coordenadas no espaço do grupo: o shader acompanha a matriz do canvas) */
export function gradientShader(g: AvatarGradient, env: PaintEnv): SkShader {
  const colors: SkColor[] = [];
  const pos: number[] = [];
  for (const st of g.s) {
    const base = env.color(st[1]);
    const op = st.length > 2 ? (st[2] as number) : 1;
    let c = base;
    if (op !== 1) {
      c = Float32Array.from(base) as unknown as SkColor;
      c[3] = base[3] * op;
    }
    colors.push(c);
    pos.push(Math.max(0, Math.min(1, st[0])));
  }
  if (colors.length === 1) {
    colors.push(colors[0]);
    pos.push(1);
  }
  if (g.t === 'l') return env.track(Skia.Shader.MakeLinearGradient({ x: g.x1, y: g.y1 }, { x: g.x2, y: g.y2 }, colors, pos, TileMode.Clamp));
  const r = Math.max(g.r, 1e-4);
  const fx = g.fx ?? g.cx;
  const fy = g.fy ?? g.cy;
  if (fx !== g.cx || fy !== g.cy) {
    // foco do SVG = cônico de dois pontos: círculo de raio 0 no foco até o círculo (cx, cy, r)
    return env.track(Skia.Shader.MakeTwoPointConicalGradient({ x: fx, y: fy }, 0, { x: g.cx, y: g.cy }, r, colors, pos, TileMode.Clamp));
  }
  return env.track(Skia.Shader.MakeRadialGradient({ x: g.cx, y: g.cy }, r, colors, pos, TileMode.Clamp));
}

const BLACK = Float32Array.of(0, 0, 0, 1) as unknown as SkColor;

/** pinta uma camada (o chamador já aplicou a matriz do grupo no canvas) */
export function paintLayer(c: SkCanvas, l: AvatarLayer, env: PaintEnv, paints: LayerPaints): void {
  // 'none' vale como "sem tinta" (igual ao SVG); o parser de cor do Skia não entende 'none'
  const hasFill = !!(l.gf || (l.f && l.f !== 'none'));
  const hasStroke = !!(l.gs || (l.s && l.s !== 'none'));
  if (!hasFill && !hasStroke) return;
  const path = env.path(l.d, l.r === 'evenodd');
  if (!path) return;
  const a = l.o == null ? 1 : l.o;
  let clipped = false;
  if (l.cp) {
    const cp = env.path(l.cp, false);
    if (cp) {
      c.save();
      c.clipPath(cp, ClipOp.Intersect, true);
      clipped = true;
    }
  }
  const blur = l.b && l.b > 0 ? env.track(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, l.b, true)) : null;
  if (hasFill) {
    const p = paints.fill;
    if (l.gf) {
      p.setShader(gradientShader(l.gf, env));
      setColor(p, BLACK, a);
    } else {
      p.setShader(null);
      setColor(p, env.color(l.f as string), a);
    }
    p.setMaskFilter(blur);
    c.drawPath(path, p);
  }
  if (hasStroke) {
    const p = paints.stroke;
    p.setStrokeWidth(l.w || 1);
    p.setStrokeCap((l.c || 'round') === 'butt' ? StrokeCap.Butt : StrokeCap.Round);
    if (l.gs) {
      p.setShader(gradientShader(l.gs, env));
      setColor(p, BLACK, a);
    } else {
      p.setShader(null);
      setColor(p, env.color(l.s as string), a);
    }
    p.setPathEffect(l.da && l.da.length >= 2 ? env.track(Skia.PathEffect.MakeDash(l.da.length % 2 ? [...l.da, ...l.da] : l.da, 0)) : null);
    p.setMaskFilter(blur);
    c.drawPath(path, p);
  }
  if (clipped) c.restore();
}

/** SVG 'd' → SkPath (regra evenodd opcional); null se inválido. O chamador guarda em cache e libera. */
export function parseLayerPath(d: string, evenOdd: boolean): SkPath | null {
  try {
    const parsed = Skia.Path.MakeFromSVGString(d);
    if (!parsed || !evenOdd) return parsed;
    const b = Skia.PathBuilder.MakeFromPath(parsed);
    const out = b.setFillType(FillType.EvenOdd).detach();
    for (const o of [b, parsed] as unknown as Disposable[]) {
      try {
        if (typeof o.dispose === 'function') o.dispose();
      } catch {
        // já liberado
      }
    }
    return out;
  } catch {
    return null;
  }
}
