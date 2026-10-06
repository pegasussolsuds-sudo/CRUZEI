// Caneta Skia dos efeitos (auras e fundos). Dono: efeitos.
//
// Separada de fx-core.ts pra que o desenho dos efeitos (fx-auras, fx-backdrops) e a versão SVG estática das listas
// (<CruzeiAvatar/>) não importem o Skia: só o palco (AuraFx/BackdropFx) e a folha de prova usam esta caneta.
// Worklet: roda na thread de UI (palco) e no CanvasKit em node (folha de prova).

import { BlendMode, ClipOp, FillType, PaintStyle, Skia, StrokeCap, StrokeJoin, TileMode, type SkCanvas, type SkPaint, type SkPath, type SkShader } from '@shopify/react-native-skia';

import type { FxGrad, FxPaint, Pen, Rgb } from './fx-core';

interface FxCache {
  sh: Record<string, SkShader>;
  n: number;
  paths: Record<string, SkPath>;
}

/** perfil do brilho suave (posição, alfa): queda gaussiana */
const GLOW_STOPS: number[] = [0, 1, 0.18, 0.72, 0.4, 0.34, 0.65, 0.11, 1, 0];

function skColor(c: Rgb, a: number): Float32Array {
  'worklet';
  return Float32Array.of(((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255, a < 0 ? 0 : a > 1 ? 1 : a);
}

function buildSkPath(cmds: number[], eo?: boolean): SkPath {
  'worklet';
  const p = Skia.PathBuilder.Make();
  let i = 0;
  const n = cmds.length;
  while (i < n) {
    const op = cmds[i];
    if (op === 0) {
      p.moveTo(cmds[i + 1], cmds[i + 2]);
      i += 3;
    } else if (op === 1) {
      p.lineTo(cmds[i + 1], cmds[i + 2]);
      i += 3;
    } else if (op === 2) {
      p.quadTo(cmds[i + 1], cmds[i + 2], cmds[i + 3], cmds[i + 4]);
      i += 5;
    } else if (op === 3) {
      p.cubicTo(cmds[i + 1], cmds[i + 2], cmds[i + 3], cmds[i + 4], cmds[i + 5], cmds[i + 6]);
      i += 7;
    } else {
      p.close();
      i += 1;
    }
  }
  if (eo) p.setFillType(FillType.EvenOdd);
  return p.detach();
}

/**
 * Caneta que desenha num SkCanvas. `shapes` = tabela de formas (fx-shapes.SHAPES), passada por quem chama pra ficar
 * capturada no worklet. Shaders de brilho e formas prontas ficam em cache no runtime (global), então o quadro só aloca
 * a SkPicture, um SkPaint e os gradientes que mudam.
 */
export function skiaPen(canvas: SkCanvas, shapes: Record<string, number[]>, lite: boolean): Pen {
  'worklet';
  const G = globalThis as unknown as { __metchFx?: FxCache };
  if (!G.__metchFx || G.__metchFx.n > 400) G.__metchFx = { sh: {}, n: 0, paths: {} };
  const cache = G.__metchFx;
  const paint: SkPaint = Skia.Paint();
  paint.setAntiAlias(true);
  paint.setStrokeJoin(StrokeJoin.Round);

  const gradShader = (g: FxGrad): SkShader => {
    const cols: Float32Array[] = [];
    const pos: number[] = [];
    for (let i = 0; i < g.s.length; i++) {
      cols.push(skColor(g.s[i][1], g.s[i][2]));
      pos.push(g.s[i][0]);
    }
    if (cols.length === 1) {
      cols.push(cols[0]);
      pos.push(1);
    }
    if (g.t === 'l') return Skia.Shader.MakeLinearGradient({ x: g.x1, y: g.y1 }, { x: g.x2, y: g.y2 }, cols, pos, TileMode.Clamp);
    return Skia.Shader.MakeRadialGradient({ x: g.cx, y: g.cy }, Math.max(1e-3, g.r), cols, pos, TileMode.Clamp);
  };
  const setup = (p: FxPaint) => {
    const a = p.a == null ? 1 : p.a;
    if (p.w != null) {
      paint.setStyle(PaintStyle.Stroke);
      paint.setStrokeWidth(p.w);
      paint.setStrokeCap(p.cap === 1 ? StrokeCap.Butt : StrokeCap.Round);
    } else {
      paint.setStyle(PaintStyle.Fill);
    }
    paint.setBlendMode(p.b === 1 ? BlendMode.Plus : p.b === 2 ? BlendMode.Screen : BlendMode.SrcOver);
    if (p.g) {
      paint.setShader(gradShader(p.g));
      paint.setColor(skColor(0, a));
    } else {
      paint.setShader(null);
      paint.setColor(skColor(p.c == null ? 0xffffff : p.c, a));
    }
  };
  const glowShader = (c: Rgb): SkShader => {
    const key = 'g' + c;
    let s = cache.sh[key];
    if (!s) {
      const cols: Float32Array[] = [];
      const pos: number[] = [];
      for (let i = 0; i < GLOW_STOPS.length; i += 2) {
        pos.push(GLOW_STOPS[i]);
        cols.push(skColor(c, GLOW_STOPS[i + 1]));
      }
      s = Skia.Shader.MakeRadialGradient({ x: 0, y: 0 }, 1, cols, pos, TileMode.Clamp);
      cache.sh[key] = s;
      cache.n++;
    }
    return s;
  };
  const glowAt = (cx: number, cy: number, rx: number, ry: number, c: Rgb, a: number, b: number) => {
    if (a <= 0.003 || rx <= 0 || ry <= 0) return;
    paint.setStyle(PaintStyle.Fill);
    paint.setBlendMode(b === 1 ? BlendMode.Plus : b === 2 ? BlendMode.Screen : BlendMode.SrcOver);
    paint.setShader(glowShader(c));
    paint.setColor(skColor(0, a));
    canvas.save();
    canvas.translate(cx, cy);
    canvas.scale(rx, ry);
    canvas.drawCircle(0, 0, 1, paint);
    canvas.restore();
  };
  const shapePath = (key: string): SkPath | null => {
    let p = cache.paths[key];
    if (!p) {
      const cmds = shapes[key];
      if (!cmds) return null;
      p = buildSkPath(cmds);
      cache.paths[key] = p;
    }
    return p;
  };

  return {
    lite,
    save: () => {
      canvas.save();
    },
    restore: () => {
      canvas.restore();
    },
    translate: (x, y) => canvas.translate(x, y),
    rotate: (deg) => canvas.rotate(deg, 0, 0),
    scale: (sx, sy) => canvas.scale(sx, sy),
    circle: (cx, cy, r, p) => {
      if (r <= 0) return;
      setup(p);
      canvas.drawCircle(cx, cy, r, paint);
    },
    oval: (cx, cy, rx, ry, p) => {
      if (rx <= 0 || ry <= 0) return;
      setup(p);
      canvas.drawOval(Skia.XYWHRect(cx - rx, cy - ry, rx * 2, ry * 2), paint);
    },
    rect: (x, y, w, h, p) => {
      setup(p);
      canvas.drawRect(Skia.XYWHRect(x, y, w, h), paint);
    },
    rrect: (x, y, w, h, r, p) => {
      setup(p);
      canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(x, y, w, h), r, r), paint);
    },
    path: (cmds, p) => {
      setup(p);
      canvas.drawPath(buildSkPath(cmds, p.eo), paint);
    },
    shape: (key, x, y, size, rot, p, sx, sy) => {
      const sp = shapePath(key);
      if (!sp || size <= 0) return;
      setup(p);
      canvas.save();
      canvas.translate(x, y);
      if (rot) canvas.rotate(rot, 0, 0);
      canvas.scale(size * (sx == null ? 1 : sx), size * (sy == null ? 1 : sy));
      if (p.w != null) paint.setStrokeWidth(p.w / size);
      canvas.drawPath(sp, paint);
      canvas.restore();
    },
    glow: (cx, cy, r, c, a, b) => glowAt(cx, cy, r, r, c, a, b || 0),
    glowOval: (cx, cy, rx, ry, c, a, b) => glowAt(cx, cy, rx, ry, c, a, b || 0),
    ring: (cx, cy, rx, ry, w, colors, rot, a, a0, sweep, b) => {
      if (rx <= 0 || ry <= 0 || a <= 0.003 || colors.length === 0) return;
      const cols: Float32Array[] = [];
      for (let i = 0; i < colors.length; i++) cols.push(skColor(colors[i], 1));
      cols.push(cols[0]);
      paint.setStyle(PaintStyle.Stroke);
      paint.setStrokeWidth(w);
      paint.setStrokeCap(StrokeCap.Butt);
      paint.setBlendMode(b === 1 ? BlendMode.Plus : b === 2 ? BlendMode.Screen : BlendMode.SrcOver);
      paint.setShader(Skia.Shader.MakeSweepGradient(0, 0, cols, null, TileMode.Clamp));
      paint.setColor(skColor(0, a));
      canvas.save();
      canvas.translate(cx, cy);
      canvas.scale(1, ry / rx);
      canvas.rotate(rot, 0, 0);
      const s0 = (a0 == null ? 0 : a0) - rot;
      const sw = sweep == null ? 360 : sweep;
      if (sw >= 360) canvas.drawCircle(0, 0, rx, paint);
      else canvas.drawArc(Skia.XYWHRect(-rx, -rx, rx * 2, rx * 2), s0, sw, false, paint);
      canvas.restore();
    },
    clipRRect: (x, y, w, h, r) => {
      canvas.clipRRect(Skia.RRectXY(Skia.XYWHRect(x, y, w, h), r, r), ClipOp.Intersect, true);
    },
    clipOval: (cx, cy, rx, ry) => {
      canvas.clipRRect(Skia.RRectXY(Skia.XYWHRect(cx - rx, cy - ry, rx * 2, ry * 2), rx, ry), ClipOp.Intersect, true);
    },
  };
}
