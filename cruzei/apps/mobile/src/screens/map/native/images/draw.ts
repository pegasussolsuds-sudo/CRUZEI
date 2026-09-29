// Desenho das imagens do mapa nativo (figuras, bolhas, POIs, pino, ícones, brilhos) em PNG pro <Images> do MLRN.
// Porta pixel a pixel do canvas 2D do antigo WebView (mapbox-html.ts, avatar-anim.ts, identity-bubble.ts).
//
// Por que RASTER DE CPU (Skia.Surface.Make) e nada de GPU: o Moto g54 derrubava o app no driver GL/HWUI
// (SIGSEGV no RenderThread). Superfície offscreen de GPU (MakeOffscreen), drawAsImage ou qualquer coisa com
// contexto GL aqui reabriria o mesmo buraco. Bitmap em memória + PNG custa CPU (não é pra redesenhar por frame à
// toa), mas não encosta no driver.
//
// Regras do canvas 2D reproduzidas de propósito:
//   - sombras (shadowBlur/shadowOffsetY) IGNORAM a transformação: valem em px do bitmap (2x), com sigma = blur/2;
//     a alfa da sombra = alfa da cor da sombra × alfa da forma;
//   - createRadialGradient concêntrico com r0 > 0 = cor 0 até r0, rampa até r1, cor 1 depois;
//   - translateSelf/rotateSelf/scaleSelf do DOMMatrix pós-multiplicam, igual a canvas.translate/rotate/scale do Skia;
//   - lineCap padrão butt, lineJoin padrão miter (limite 10), exceto onde o original muda.

import {
  BlendMode,
  BlurStyle,
  ClipOp,
  FillType,
  FilterMode,
  FontWeight,
  ImageFormat,
  MipmapMode,
  PaintStyle,
  Skia,
  StrokeCap,
  StrokeJoin,
  TextAlign,
  TileMode,
  type SkCanvas,
  type SkColor,
  type SkImage,
  type SkPaint,
  type SkPath,
  type SkPathBuilder,
  type SkRect,
  type SkShader,
  type SkSurface,
} from '@shopify/react-native-skia';
import type { AvatarGroup, AvatarLayer, AvatarRig } from '../../../../avatar';
import {
  AURA_RGB,
  BUB,
  CAT_EMOJI,
  FIG_TOP,
  IMG,
  IMG_SCALE,
  figScale,
  type AuraKey,
  type AvatarDef,
  type BubbleStyle,
  type Dim,
  type FigureLook,
  type MapDraw,
  type Pose,
} from '../contracts';

// ---------------------------------------------------------------------------------------------------------------
// Objetos nativos temporários: tudo que um desenho cria entra no "saco" e é liberado no fim (não espera o GC)
// ---------------------------------------------------------------------------------------------------------------
interface Releasable {
  dispose(): void;
}
let bag: Releasable[] | null = null;
function track<T extends Releasable>(o: T): T {
  if (bag) bag.push(o);
  return o;
}
function disposeAll(list: Releasable[]): void {
  for (let i = list.length - 1; i >= 0; i--) {
    const o = list[i];
    // o tipo promete dispose, mas nem todo host object nativo exporta (ex.: ParagraphBuilder)
    if (typeof o.dispose !== 'function') continue;
    try {
      o.dispose();
    } catch {
      // já liberado: ignora
    }
  }
}

/** superfície raster (CPU) de w x h lógicos a IMG_SCALE → PNG; null se qualquer coisa falhar (nunca lança) */
function render(w: number, h: number, draw: (c: SkCanvas) => void): Uint8Array | null {
  const own: Releasable[] = [];
  const prev = bag;
  bag = own;
  let surface: SkSurface | null = null;
  let image: SkImage | null = null;
  try {
    surface = Skia.Surface.Make(Math.round(w * IMG_SCALE), Math.round(h * IMG_SCALE));
    if (!surface) return null;
    const canvas = surface.getCanvas();
    canvas.clear(colorOf('rgba(0,0,0,0)'));
    canvas.save();
    canvas.scale(IMG_SCALE, IMG_SCALE);
    draw(canvas);
    canvas.restore();
    surface.flush();
    image = surface.makeImageSnapshot();
    // o tipo diz Uint8Array, mas o nativo devolve null quando o encoder falha
    const bytes = image.encodeToBytes(ImageFormat.PNG, 100) as Uint8Array | null;
    return bytes && bytes.length > 0 ? bytes : null;
  } catch {
    return null;
  } finally {
    bag = prev;
    disposeAll(own);
    if (image) disposeAll([image]);
    if (surface) disposeAll([surface]);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Cores, pincéis, formas
// ---------------------------------------------------------------------------------------------------------------
const colorCache = new Map<string, SkColor>();
/** cor CSS (hex ou rgba(...)) → SkColor; o parser nativo do Skia entende as duas */
function colorOf(css: string): SkColor {
  let c = colorCache.get(css);
  if (!c) {
    c = Skia.Color(css);
    if (colorCache.size >= 512) colorCache.clear();
    colorCache.set(css, c);
  }
  return c;
}
function rgba(rgb: string, a: number): string {
  return 'rgba(' + rgb + ',' + a + ')';
}
/** cor + globalAlpha do canvas (multiplica a alfa da própria cor) */
function setColor(p: SkPaint, css: string, alpha = 1): void {
  const c = colorOf(css);
  p.setColor(c);
  if (alpha !== 1) p.setAlphaf(c[3] * alpha);
}
function fillPaint(css?: string, alpha = 1): SkPaint {
  const p = track(Skia.Paint());
  p.setAntiAlias(true);
  p.setStyle(PaintStyle.Fill);
  if (css) setColor(p, css, alpha);
  return p;
}
function strokePaint(css: string, width: number, cap: StrokeCap = StrokeCap.Butt, join: StrokeJoin = StrokeJoin.Miter): SkPaint {
  const p = track(Skia.Paint());
  p.setAntiAlias(true);
  p.setStyle(PaintStyle.Stroke);
  p.setStrokeWidth(width);
  p.setStrokeCap(cap);
  p.setStrokeJoin(join);
  p.setStrokeMiter(10); // miterLimit padrão do canvas
  setColor(p, css);
  return p;
}
/** createRadialGradient(cx,cy,r0, cx,cy,r1) concêntrico: cor c0 até r0, rampa até r1, c1 depois */
function radial(cx: number, cy: number, r0: number, r1: number, c0: string, c1: string): SkShader {
  const rr = Math.max(r1, 1e-4);
  const start = Math.min(Math.max(r0 / rr, 0), 0.9999);
  return track(Skia.Shader.MakeRadialGradient({ x: cx, y: cy }, rr, [colorOf(c0), colorOf(c1)], [start, 1], TileMode.Clamp));
}
function linear(x0: number, y0: number, x1: number, y1: number, c0: string, c1: string): SkShader {
  return track(Skia.Shader.MakeLinearGradient({ x: x0, y: y0 }, { x: x1, y: y1 }, [colorOf(c0), colorOf(c1)], null, TileMode.Clamp));
}
/** retângulo que contém a elipse de centro (cx,cy) e raios (rx,ry) */
function oval(cx: number, cy: number, rx: number, ry: number): SkRect {
  return { x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2 };
}
function rect(x: number, y: number, w: number, h: number): SkRect {
  return { x, y, width: w, height: h };
}
function builder(): SkPathBuilder {
  return track(Skia.PathBuilder.Make());
}
function done(b: SkPathBuilder): SkPath {
  return track(b.detach());
}
/** ctx.ellipse(cx,cy,rx,ry,0,π,2π) + fill: meia elipse de cima, fechada pela corda */
function upperHalfEllipse(cx: number, cy: number, rx: number, ry: number): SkPath {
  return done(builder().addArc(oval(cx, cy, rx, ry), 180, 180).close());
}

interface Shadow {
  color: string;
  /** shadowBlur (px do bitmap) */
  blur: number;
  /** shadowOffsetY (px do bitmap) */
  offY: number;
}
/**
 * Sombra do canvas: desenha a forma borrada e deslocada na cor da sombra, depois a forma. O canvas ignora a
 * transformação nas sombras (blur e offset em px do bitmap): sigma sem respeitar a CTM e offset / IMG_SCALE
 * (só é chamada com a CTM base, scale(IMG_SCALE)).
 */
function withShadow(canvas: SkCanvas, paint: SkPaint, sh: Shadow, draw: (p: SkPaint) => void): void {
  const sp = track(paint.copy());
  sp.setShader(null);
  const sc = colorOf(sh.color);
  sp.setColor(sc);
  sp.setAlphaf(sc[3] * paint.getAlphaf());
  if (sh.blur > 0) sp.setMaskFilter(track(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, sh.blur / 2, false)));
  canvas.save();
  canvas.translate(0, sh.offY / IMG_SCALE);
  draw(sp);
  canvas.restore();
  draw(paint);
}

// ---------------------------------------------------------------------------------------------------------------
// Emoji: Paragraph com o gerenciador de fontes do sistema (fallback liga a fonte de emoji colorida do Android)
// ---------------------------------------------------------------------------------------------------------------
/**
 * fillText com textAlign 'center' e textBaseline 'middle': no Chrome o 'middle' fica (ascent - descent)/2 da fonte
 * principal (typo normalizado) acima da linha de base — pra Roboto/sans-serif, 0.25 em.
 */
function drawEmoji(canvas: SkCanvas, text: string, cx: number, cy: number, size: number, bold: boolean, css: string): void {
  const pb = track(Skia.ParagraphBuilder.Make({ textAlign: TextAlign.Left }));
  pb.pushStyle({
    color: colorOf(css),
    fontSize: size,
    fontFamilies: ['sans-serif'],
    fontStyle: { weight: bold ? FontWeight.Bold : FontWeight.Normal },
  });
  pb.addText(text);
  const para = track(pb.build());
  para.layout(1000);
  const width = para.getLongestLine() || para.getMaxIntrinsicWidth();
  const lines = para.getLineMetrics();
  const baseline = lines.length > 0 ? lines[0].baseline : para.getHeight() * 0.8;
  para.paint(canvas, cx - width / 2, cy + size * 0.25 - baseline);
}

// ---------------------------------------------------------------------------------------------------------------
// Camadas vetoriais do avatar (Path2D(l.d) → SkPath com cache)
// ---------------------------------------------------------------------------------------------------------------
const PATH_CACHE_MAX = 6000;
const pathCache = new Map<string, SkPath | null>(); // null = 'd' inválido (não tenta de novo)

function evictPaths(): void {
  // evicção simples: solta o quarto mais antigo (o Map guarda a ordem de uso, ver layerPath)
  let n = Math.ceil(PATH_CACHE_MAX / 4);
  for (const [key, path] of pathCache) {
    if (n-- <= 0) break;
    pathCache.delete(key);
    if (path) disposeAll([path]);
  }
}
function layerPath(d: string, evenOdd: boolean): SkPath | null {
  const key = (evenOdd ? 'e|' : 'n|') + d;
  const hit = pathCache.get(key);
  if (hit !== undefined) {
    pathCache.delete(key); // renova a posição (LRU)
    pathCache.set(key, hit);
    return hit;
  }
  let path: SkPath | null = null;
  try {
    const parsed = Skia.Path.MakeFromSVGString(d);
    if (parsed && evenOdd) {
      // entrada própria no cache com a regra evenodd (a de nonzero fica intacta)
      const b = Skia.PathBuilder.MakeFromPath(parsed);
      path = b.setFillType(FillType.EvenOdd).detach();
      disposeAll([b, parsed]);
    } else path = parsed;
  } catch {
    path = null;
  }
  if (pathCache.size >= PATH_CACHE_MAX) evictPaths();
  pathCache.set(key, path);
  return path;
}

/** gira em volta de um pivô: translateSelf(p) rotateSelf(deg) translateSelf(-p) */
function pivotRotate(c: SkCanvas, pivot: [number, number], deg: number): void {
  c.translate(pivot[0], pivot[1]);
  c.rotate(deg, 0, 0);
  c.translate(-pivot[0], -pivot[1]);
}
/** corpo: desloca, gira e escala a partir do quadril */
function applyBody(c: SkCanvas, rig: AvatarRig, pose: Pose): void {
  c.translate(rig.body[0], rig.body[1] + pose.body.dy);
  c.rotate(pose.body.r, 0, 0);
  c.scale(pose.body.sx, pose.body.sy);
  c.translate(-rig.body[0], -rig.body[1]);
}
/** transformação do grupo sobre a base (hierarquia do avatar-anim.ts:127-156): pernas e sombra na raiz, cabeça e braços filhos do corpo */
function applyGroup(c: SkCanvas, g: AvatarGroup, rig: AvatarRig, pose: Pose): void {
  switch (g) {
    case 'legL':
      pivotRotate(c, rig.legL, pose.legL.r);
      break;
    case 'legR':
      pivotRotate(c, rig.legR, pose.legR.r);
      break;
    case 'shadow':
      c.translate(50, 135);
      c.scale(pose.shadow.s, 1);
      c.translate(-50, -135);
      break;
    case 'body':
      applyBody(c, rig, pose);
      break;
    case 'head':
      applyBody(c, rig, pose);
      c.translate(rig.head[0], rig.head[1] + pose.head.dy);
      c.rotate(pose.head.r, 0, 0);
      c.translate(-rig.head[0], -rig.head[1]);
      break;
    case 'armL':
      applyBody(c, rig, pose);
      pivotRotate(c, rig.armL, pose.armL.r);
      break;
    case 'armR':
      applyBody(c, rig, pose);
      pivotRotate(c, rig.armR, pose.armR.r);
      break;
    default:
      break; // grupo desconhecido: fica na base (T[g] || base)
  }
}

/**
 * drawLayers (pose neutra, mapbox-html.ts:361) e drawPosed (avatar-anim.ts:127) numa função só: com rig+pose cada
 * camada usa a transformação do seu grupo (l.g, padrão 'body'); a ordem do array é o z-order.
 */
function drawAvatar(c: SkCanvas, layers: AvatarLayer[], rig: AvatarRig | null, pose: Pose | null, x: number, y: number, scale: number, mirror: boolean): void {
  c.save();
  c.translate(x, y);
  c.scale(scale, scale);
  if (mirror) {
    c.translate(100, 0);
    c.scale(-1, 1);
  }
  const fill = fillPaint();
  const stroke = strokePaint('#000000', 1, StrokeCap.Round, StrokeJoin.Round);
  const posed = !!(rig && pose);
  let lastG: AvatarGroup | null = null;
  let pushed = false;
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    if (posed) {
      const g: AvatarGroup = l.g || 'body';
      if (g !== lastG) {
        if (pushed) c.restore();
        c.save();
        pushed = true;
        applyGroup(c, g, rig as AvatarRig, pose as Pose);
        lastG = g;
      }
    }
    const path = layerPath(l.d, l.r === 'evenodd');
    if (!path) continue;
    const a = l.o == null ? 1 : l.o;
    if (l.f) {
      setColor(fill, l.f, a);
      c.drawPath(path, fill);
    }
    if (l.s) {
      stroke.setStrokeWidth(l.w || 1);
      stroke.setStrokeCap((l.c || 'round') === 'butt' ? StrokeCap.Butt : StrokeCap.Round);
      setColor(stroke, l.s, a);
      c.drawPath(path, stroke);
    }
  }
  if (pushed) c.restore();
  c.restore();
}

/** silhueta neutra enquanto a definição do avatar não chegou (mapbox-html.ts:375) */
function drawSilhouette(c: SkCanvas, x: number, y: number, scale: number): void {
  c.save();
  c.translate(x, y);
  c.scale(scale, scale);
  c.drawOval(oval(50, 135, 26, 5), fillPaint('rgba(0,0,0,0.25)'));
  const body = fillPaint('#8A8A96');
  c.drawCircle(50, 33, 21, body);
  c.drawRect(rect(31, 60, 38, 36), body);
  c.drawRect(rect(34, 94, 13, 34), body);
  c.drawRect(rect(53, 94, 13, 34), body);
  c.drawRect(rect(20, 62, 10, 36), body);
  c.drawRect(rect(70, 62, 10, 36), body);
  c.restore();
}

function isAuraKey(k: string): k is AuraKey {
  return Object.prototype.hasOwnProperty.call(AURA_RGB, k);
}
/** cor rgb da poça de luz: boost → dourado; aura do avatar; premium+ → magenta (mapbox-html.ts:384) */
function figureAura(look: FigureLook): string | null {
  if (look.boosted) return AURA_RGB.gold;
  if (look.aura && isAuraKey(look.aura)) return AURA_RGB[look.aura];
  if (look.premiumTier === 'premium_plus') return AURA_RGB.magenta;
  return null;
}

/** figura em pé (mapbox-html.ts:391 drawFigure) */
function drawFigure(c: SkCanvas, def: AvatarDef | null, look: FigureLook, dim: Dim, pose: Pose | null, mirror: boolean): void {
  const w = dim.w;
  const h = dim.h;
  const scale = figScale(dim);
  const x = (w - 100 * scale) / 2;
  const y = FIG_TOP;
  const footY = y + 134 * scale;
  const cx = w / 2;
  const aura = figureAura(look);
  if (aura) {
    const g = fillPaint();
    g.setShader(radial(cx, footY - 2, 3, w * 0.5, rgba(aura, 0.65), rgba(aura, 0)));
    c.drawOval(oval(cx, footY - 2, w * 0.5, w * 0.24), g);
  }
  if (def && def.l) drawAvatar(c, def.l, pose && def.p ? def.p : null, pose, x, y, scale, mirror);
  else drawSilhouette(c, x, y, scale);
  // anel de presença: lima se recente (≤ 15 min), senão dourado
  c.drawOval(oval(cx, footY - 3, w * 0.36, w * 0.13), strokePaint(look.recent ? '#7FFF00' : '#FFD700', 2));
  if (look.premiumTier === 'premium' || look.premiumTier === 'premium_plus') {
    c.drawOval(oval(cx, footY - 3, w * 0.43, w * 0.16), strokePaint('#FF1493', 1.5));
  }
  if (look.verified) {
    const bx = x + 76 * scale;
    const by = y + 18 * scale;
    const br = 5 * scale + 2;
    c.drawCircle(bx, by, br + 1.5, fillPaint('#FFFFFF'));
    c.drawCircle(bx, by, br, fillPaint('#008B8B'));
    const check = done(builder().moveTo(bx - br * 0.45, by).lineTo(bx - br * 0.1, by + br * 0.38).lineTo(bx + br * 0.5, by - br * 0.4));
    c.drawPath(check, strokePaint('#FFFFFF', 1.8, StrokeCap.Round));
  }
  if (look.anonymous) {
    // modo invisível: só EU me vejo, e meio apagado (source-atop: escurece só onde já tem desenho)
    const veil = fillPaint('rgba(10,10,26,0.5)');
    veil.setBlendMode(BlendMode.SrcATop);
    c.drawRect(rect(0, 0, w, h), veil);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Bolha de identidade (identity-bubble.ts:110 drawBubble), alpha 1
// ---------------------------------------------------------------------------------------------------------------
/** a foto tem de ser SkImage RASTER (ex.: Skia.Image.MakeImageFromEncoded); imagem de textura não desenha em surface de CPU */
function asImage(v: unknown): SkImage | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as { width?: unknown; height?: unknown };
  return typeof o.width === 'function' && typeof o.height === 'function' ? (v as SkImage) : null;
}
function heart(x: number, y: number, s: number): SkPath {
  return done(
    builder()
      .moveTo(x, y + s)
      .cubicTo(x - s * 1.6, y - s * 0.2, x - s * 0.7, y - s * 1.3, x, y - s * 0.4)
      .cubicTo(x + s * 0.7, y - s * 1.3, x + s * 1.6, y - s * 0.2, x, y + s)
      .close(),
  );
}
/** estrela de 4 pontas (8 vértices alternando raio cheio e 42%) */
function star(x: number, y: number, s: number): SkPath {
  const b = builder();
  for (let i = 0; i < 8; i++) {
    const rr = i % 2 === 0 ? s : s * 0.42;
    const a = -Math.PI / 2 + (i * Math.PI) / 4;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) b.moveTo(px, py);
    else b.lineTo(px, py);
  }
  return done(b.close());
}
function drawBubble(c: SkCanvas, photo: SkImage | null, cx: number, cy: number, o: BubbleStyle): void {
  const r = o.d / 2;
  const rw = o.ringW || 2;
  // sombra suave por baixo (legibilidade sobre o mapa, dia ou noite)
  withShadow(c, fillPaint('#12122A'), { color: 'rgba(0,0,0,0.45)', blur: 6, offY: 2 }, (p) => c.drawCircle(cx, cy, r, p));
  // brilho discreto (selecionado / match / em alta)
  if (o.glow) {
    const glow = o.glow;
    withShadow(c, strokePaint(glow, 1.5), { color: glow, blur: 9, offY: 0 }, (p) => c.drawCircle(cx, cy, r + 0.5, p));
  }
  // rabicho: a bolha "pertence" ao personagem embaixo
  if (o.tail !== false) {
    const tail = done(builder().moveTo(cx - 4.5, cy + r - 2.5).lineTo(cx + 4.5, cy + r - 2.5).lineTo(cx, cy + r + 5).close());
    c.drawPath(tail, fillPaint(o.ring));
  }
  // foto (ou placeholder neutro) recortada no círculo
  c.save();
  c.clipPath(track(Skia.Path.Circle(cx, cy, r - rw * 0.5)), ClipOp.Intersect, true);
  let drawn = false;
  if (photo) {
    try {
      c.drawImageRectOptions(photo, rect(0, 0, photo.width(), photo.height()), rect(cx - r, cy - r, o.d, o.d), FilterMode.Linear, MipmapMode.None);
      drawn = true;
    } catch {
      drawn = false; // imagem inválida/liberada: cai no placeholder
    }
  }
  if (!drawn) {
    c.drawRect(rect(cx - r, cy - r, o.d, o.d), fillPaint('#1E1E3A'));
    const ghost = fillPaint('rgba(255,255,255,0.18)');
    c.drawCircle(cx, cy - r * 0.15, r * 0.34, ghost);
    c.drawPath(upperHalfEllipse(cx, cy + r * 0.75, r * 0.6, r * 0.42), ghost);
  }
  c.restore();
  // borda
  c.drawCircle(cx, cy, r - rw * 0.5, strokePaint(o.ring, rw));
  // ponto de presença (online) — canto inferior direito, com "furo" pra destacar
  if (o.dot) {
    const dx = cx + r * 0.68;
    const dy = cy + r * 0.68;
    c.drawCircle(dx, dy, 5, fillPaint('#12122A'));
    c.drawCircle(dx, dy, 3.4, fillPaint(o.dot));
  }
  // selo (novo por aqui ✦ / match ♥) — canto superior esquerdo
  if (o.badge) {
    const bx = cx - r * 0.72;
    const by = cy - r * 0.72;
    const isMatch = o.badge === 'match';
    c.drawCircle(bx, by, 7, fillPaint('#12122A'));
    c.drawCircle(bx, by, 5.6, fillPaint(isMatch ? '#FF1493' : '#FFD700'));
    c.drawPath(isMatch ? heart(bx, by + 0.4, 3.2) : star(bx, by, 3.6), fillPaint('#0A0A1A'));
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Ícones estáticos
// ---------------------------------------------------------------------------------------------------------------
/** POI 44x44 (mapbox-html.ts:629 ensurePoiImage) */
function drawPoi(c: SkCanvas, p: { category: string; hot: boolean; isEvent: boolean; isPartner: boolean }): void {
  const cc = IMG.poi / 2;
  const disc = fillPaint(p.hot || p.isEvent ? '#FF1493' : '#FFD700');
  withShadow(c, disc, { color: 'rgba(0,0,0,0.4)', blur: 5, offY: 2 }, (q) => c.drawCircle(cc, cc, cc - 5, q));
  c.drawCircle(cc, cc, cc - 5, strokePaint(p.isPartner && !p.hot ? '#FF1493' : '#FFFFFF', 2.5));
  if (p.hot) drawEmoji(c, '🔥', cc, cc + 1, 16, true, '#FFFFFF');
  else if (p.isEvent) drawEmoji(c, '⚡', cc, cc + 1, 17, true, '#FFFFFF');
  else drawEmoji(c, CAT_EMOJI[p.category] || CAT_EMOJI.other, cc, cc + 1, 19, false, '#000000');
}

/** pino do lugar da busca 60x80 (mapbox-html.ts:1317 drawPinImage) */
function drawPin(c: SkCanvas, pin: { emoji: string; nightlife: boolean }): void {
  const w = 60;
  const h = 80;
  const cx = w / 2;
  const r = 24;
  const cy = r + 4;
  const night = !!pin.nightlife;
  const c1 = night ? '#FF1493' : '#5FD400';
  const c2 = night ? '#FF7AC3' : '#B8FF6A';
  c.drawOval(oval(cx, h - 4, 9, 3.2), fillPaint('rgba(0,0,0,0.28)'));
  // gota: ponta embaixo, arco de 180° por cima
  const drop = done(
    builder()
      .moveTo(cx, h - 6)
      .cubicTo(cx - 6, h - 20, cx - r, cy + r * 0.55, cx - r, cy)
      .arcToOval(oval(cx, cy, r, r), 180, 180, false)
      .cubicTo(cx + r, cy + r * 0.55, cx + 6, h - 20, cx, h - 6)
      .close(),
  );
  const g = fillPaint();
  g.setShader(linear(0, 4, 0, h - 6, c2, c1));
  withShadow(c, g, { color: 'rgba(0,0,0,0.35)', blur: 6, offY: 3 }, (q) => c.drawPath(drop, q));
  c.drawPath(drop, strokePaint('#FFFFFF', 2.5));
  c.drawCircle(cx, cy, r - 6, fillPaint('#FFFFFF'));
  drawEmoji(c, pin.emoji || '📍', cx, cy + 1, 21, false, '#FFFFFF');
}

/** ícone 'pessoas' do cluster: duas cabeças lima (mapbox-html.ts:861) */
function drawPeople(c: SkCanvas): void {
  const p = fillPaint('#7FFF00');
  c.drawCircle(11, 11, 5, p);
  c.drawCircle(22, 12, 4.2, p);
  c.drawPath(upperHalfEllipse(11, 25, 9, 7), p);
  c.drawPath(upperHalfEllipse(22, 25.5, 7, 6), p);
}

/** cone de direção 72x72 (mapbox-html.ts:866) */
function drawCone(c: SkCanvas): void {
  const cc = 72 / 2;
  const g = fillPaint();
  g.setShader(linear(cc, cc, cc, 2, 'rgba(127,255,0,0.55)', 'rgba(127,255,0,0)'));
  c.drawPath(done(builder().moveTo(cc, cc).lineTo(cc - 22, 2).lineTo(cc + 22, 2).close()), g);
}

/** brilho radial estático (parte parada de sonar/anel do eu/pino/aura) */
function drawGlow(c: SkCanvas, size: number, rgb: string, alpha0: number, radius: number, inner: number): void {
  const cc = size / 2;
  const g = fillPaint();
  g.setShader(radial(cc, cc, inner, radius, rgba(rgb, alpha0), rgba(rgb, 0)));
  c.drawCircle(cc, cc, radius, g);
}

// ---------------------------------------------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------------------------------------------
export const mapDraw: MapDraw = {
  figure(def, look, dim, pose, mirror) {
    return render(dim.w, dim.h, (c) => drawFigure(c, def, look, dim, pose, mirror));
  },
  bubble(photo, style) {
    const img = asImage(photo);
    return render(IMG.bubble.w, IMG.bubble.h, (c) => drawBubble(c, img, BUB.cx, BUB.cy, style));
  },
  poi(p) {
    return render(IMG.poi, IMG.poi, (c) => drawPoi(c, p));
  },
  pin(p) {
    return render(60, 80, (c) => drawPin(c, p));
  },
  peopleIcon() {
    return render(32, 32, drawPeople);
  },
  meCone() {
    return render(72, 72, drawCone);
  },
  glow(size, rgb, alpha0, radius, inner = 0) {
    return render(size, size, (c) => drawGlow(c, size, rgb, alpha0, radius, inner));
  },
};

/** solta o cache de paths das camadas (ex.: aviso de memória baixa do sistema) */
export function clearDrawCaches(): void {
  for (const path of pathCache.values()) if (path) disposeAll([path]);
  pathCache.clear();
  colorCache.clear();
}
