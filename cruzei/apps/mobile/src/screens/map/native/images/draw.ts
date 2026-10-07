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

import type { AvatarConfig } from '@cruzei/shared-types';
import { DEFAULT_AVATAR } from '@cruzei/shared-utils';
import {
  BlendMode,
  BlurStyle,
  ClipOp,
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
import { MAP_HEAD_SCALE, buildAnatomy, groundShadowPath, rigFromAnatomy, silhouettePaths } from '../../../../avatar/anatomy';
import { fillConfig } from '../../../../avatar/ctx';
import { blend, zero } from '../../../../avatar/pose';
import { groupMatrix, mIsIdentity, mMul, mToSkia, type Mat } from '../../../../avatar/rig';
import { EMPTY_SCENE, applyScene } from '../../../../avatar/scene';
import { makeLayerPaints, paintLayer, parseLayerPath, type PaintEnv } from '../../../../avatar/skia/paintLayer';
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
  type FigureOpts,
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
/**
 * teto do cache de paths em BYTES estimados: a string 'd' fica no heap do JS (a chave) e o SkPath na memória nativa (~9 B
 * por ponto). Era por contagem (6000): com avatares pesados, ~4 MB de strings + ~3,6 MB nativos (node, 300 pessoas). O
 * conjunto que trabalha de verdade é o das figuras animando (até 9 visuais × ~250 camadas ≈ 3 MB)
 */
const PATH_CACHE_BYTES = 4 * 1024 * 1024;
const PATH_OVERHEAD = 96;
const pathCache = new Map<string, { p: SkPath | null; b: number }>(); // p null = 'd' inválido (não tenta de novo)
let pathBytes = 0;

function layerPath(d: string, evenOdd: boolean): SkPath | null {
  const key = (evenOdd ? 'e|' : 'n|') + d;
  const hit = pathCache.get(key);
  if (hit !== undefined) {
    pathCache.delete(key); // renova a posição (LRU)
    pathCache.set(key, hit);
    return hit.p;
  }
  // entrada própria no cache com a regra evenodd (a de nonzero fica intacta)
  const path = parseLayerPath(d, evenOdd);
  const b = PATH_OVERHEAD + key.length + (path ? path.countPoints() * 9 : 0);
  pathCache.set(key, { p: path, b });
  pathBytes += b;
  // solta os mais antigos até caber (o Map guarda a ordem de uso); o que acabou de entrar fica
  for (const [k, e] of pathCache) {
    if (pathBytes <= PATH_CACHE_BYTES || k === key) break;
    pathCache.delete(k);
    pathBytes -= e.b;
    if (e.p) disposeAll([e.p]);
  }
  return path;
}

/** entradas e bytes estimados do cache de paths (testes e diagnóstico) */
export function drawCacheStats(): { paths: number; bytes: number; colors: number } {
  return { paths: pathCache.size, bytes: pathBytes, colors: colorCache.size };
}

/** escala MAP_HEAD_SCALE em volta do pivô da cabeça (base do pescoço): M ∘ T(p) S(k) T(-p) */
function headScale(rig: AvatarRig): Mat {
  const k = MAP_HEAD_SCALE;
  const [px, py] = rig.head;
  return [k, 0, 0, k, px - k * px, py - k * py];
}

/**
 * transformação do grupo sobre a base: a matriz vem de avatar/rig.ts (a mesma do SVG estático e do palco Skia).
 * Hierarquia do avatar-anim.ts (pernas e sombra na raiz, cabeça e braços filhos do corpo) + antebraço no cotovelo,
 * canela no joelho, veículo na raiz (o piloto vai junto) e pet na raiz ou no corpo. Só no mapa, a cabeça inteira
 * (rosto, cabelo, chapéu) cresce MAP_HEAD_SCALE em volta da base do pescoço: numa figura de ~48 px o rosto continua
 * lendo (proporção acertada com o diretor de arte).
 */
/** cabeça maior (MAP_HEAD_SCALE): ligada no mapa; o avatarPng liga só no corpo inteiro pequeno */
let headScaleOn = true;
function applyGroup(c: SkCanvas, g: AvatarGroup, rig: AvatarRig, pose: Pose): void {
  let M = groupMatrix(g, rig, pose);
  if (g === 'head' && headScaleOn) M = mMul(M, headScale(rig));
  if (!mIsIdentity(M)) c.concat(mToSkia(M));
}

/** ambiente de pintura das camadas: objetos temporários no saco do desenho, paths e cores com cache */
const layerEnv: PaintEnv = {
  track: (o) => track(o),
  path: (d, evenOdd) => layerPath(d, evenOdd),
  color: (css) => colorOf(css),
};

/** braço levantado além disso = a animação usa os braços (com veículo, senão as mãos voltam pro volante/guidão) */
const ARMS_UP_DEG = 45;

/**
 * drawLayers (pose neutra, mapbox-html.ts:361) e drawPosed (avatar-anim.ts:127) numa função só: com rig cada camada
 * usa a transformação do seu grupo (l.g, padrão 'body'); a ordem do array é o z-order. A cena da config (rig.scene:
 * sentado, pernas na moto, mãos no volante) entra por cima da pose — inclusive na figura parada. `usesArms` diz se a
 * animação mexe nos braços (a cena então não segura as mãos); ausente = deduz pelo braço erguido.
 */
function drawAvatar(c: SkCanvas, layers: AvatarLayer[], rig: AvatarRig | null, pose: Pose | null, x: number, y: number, scale: number, mirror: boolean, usesArmsIn?: boolean | number): void {
  c.save();
  c.translate(x, y);
  c.scale(scale, scale);
  if (mirror) {
    c.translate(100, 0);
    c.scale(-1, 1);
  }
  const paints = makeLayerPaints(layerEnv);
  let posed: Pose | null = null;
  if (rig) {
    const base = pose ?? zero();
    const w = usesArmsIn === undefined ? (Math.abs(base.armL.r) > ARMS_UP_DEG || Math.abs(base.armR.r) > ARMS_UP_DEG ? 1 : 0) : Math.min(1, Math.max(0, Number(usesArmsIn) || 0));
    const held = w < 1 ? applyScene(base, rig.scene, 0, { usesArms: false }) : null;
    const free = w > 0 ? applyScene(base, rig.scene, 0, { usesArms: true }) : null;
    // mão no volante/guidão/colo ↔ animação de braço: mistura pelo peso (sem salto na entrada e na saída)
    posed = held && free ? blend(held, free, w) : (free ?? held);
  }
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
        applyGroup(c, g, rig as AvatarRig, posed);
        lastG = g;
      }
    }
    paintLayer(c, l, layerEnv, paints);
  }
  if (pushed) c.restore();
  c.restore();
}

/** manequim neutro (paths da anatomia do avatar padrão, cabeça já na escala do mapa) — montado uma vez */
let silhouette: { body: string[]; head: string; shadow: string; head0: [number, number] } | null = null;
function silhouetteShape(): NonNullable<typeof silhouette> {
  if (silhouette) return silhouette;
  const an = buildAnatomy(fillConfig(DEFAULT_AVATAR as AvatarConfig), EMPTY_SCENE);
  const paths = silhouettePaths(an);
  const head0 = rigFromAnatomy(an, EMPTY_SCENE).head;
  silhouette = { body: paths.slice(0, -1), head: paths[paths.length - 1], shadow: groundShadowPath(an), head0: [head0[0], head0[1]] };
  return silhouette;
}

/** '#rrggbb' clareado (k > 0) ou escurecido (k < 0) */
function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1, 7), 16);
  const ch = (v: number) => Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k));
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

/**
 * silhueta enquanto a definição do avatar não chegou ou fora do teto de figuras (mapbox-html.ts:375). Com `tint`: o corpo
 * na cor da roupa da pessoa e a cabeça no tom de pele (lê como "alguém de casaco vermelho", não como boneco quebrado)
 */
function drawSilhouette(c: SkCanvas, x: number, y: number, scale: number, tint?: { body: string; skin: string }): void {
  const sh = silhouetteShape();
  c.save();
  c.translate(x, y);
  c.scale(scale, scale);
  const shadow = layerPath(sh.shadow, false);
  if (shadow) c.drawPath(shadow, fillPaint('rgba(0,0,0,0.25)'));
  // luz de cima: degradê discreto (lê como gente, não como bloco); sem cor, manequim cinza-lavanda
  const body = fillPaint();
  body.setShader(tint ? linear(0, 10, 0, 134, shade(tint.body, 0.18), shade(tint.body, -0.28)) : linear(0, 10, 0, 134, '#A3A3B2', '#73737F'));
  for (const d of sh.body) {
    const p = layerPath(d, false);
    if (p) c.drawPath(p, body);
  }
  const head = layerPath(sh.head, false);
  if (head) {
    const k = MAP_HEAD_SCALE;
    const [px, py] = sh.head0;
    let headPaint = body;
    if (tint) {
      headPaint = fillPaint();
      headPaint.setShader(linear(0, 4, 0, 40, shade(tint.skin, 0.12), shade(tint.skin, -0.18)));
    }
    c.save();
    c.concat([k, 0, px - k * px, 0, k, py - k * py, 0, 0, 1]);
    c.drawPath(head, headPaint);
    c.restore();
  }
  c.restore();
}

function isAuraKey(k: string): k is AuraKey {
  return Object.prototype.hasOwnProperty.call(AURA_RGB, k);
}
const RGB_RE = /^\d{1,3},\d{1,3},\d{1,3}$/;
/** cor rgb da poça de luz: boost → dourado; aura do avatar (cor 'r,g,b' ou chave antiga); premium+ → magenta (mapbox-html.ts:384) */
function figureAura(look: FigureLook): string | null {
  if (look.boosted) return AURA_RGB.gold;
  if (look.aura && RGB_RE.test(look.aura)) return look.aura;
  if (look.aura && isAuraKey(look.aura)) return AURA_RGB[look.aura];
  if (look.premiumTier === 'premium_plus') return AURA_RGB.magenta;
  return null;
}

/** figura em pé (mapbox-html.ts:391 drawFigure) */
function drawFigure(c: SkCanvas, def: AvatarDef | null, look: FigureLook, dim: Dim, pose: Pose | null, mirror: boolean, opts?: FigureOpts): void {
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
  // anel de presença no CHÃO, antes do avatar: lima se recente (≤ 15 min), senão dourado. Por cima, cortava canelas,
  // rodas, pranchas e o pet no chão.
  c.drawOval(oval(cx, footY - 3, w * 0.36, w * 0.13), strokePaint(look.recent ? '#7FFF00' : '#FFD700', 2));
  if (look.premiumTier === 'premium' || look.premiumTier === 'premium_plus') {
    c.drawOval(oval(cx, footY - 3, w * 0.43, w * 0.16), strokePaint('#FF1493', 1.5));
  }
  if (def && def.l) drawAvatar(c, def.l, def.p ?? null, pose, x, y, scale, mirror, opts?.usesArms);
  else drawSilhouette(c, x, y, scale, opts?.tint);
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
  figure(def, look, dim, pose, mirror, opts) {
    return render(dim.w, dim.h, (c) => drawFigure(c, def, look, dim, pose, mirror, opts));
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

/**
 * só o avatar em PNG (miniaturas e listas do <CruzeiAvatar/>), com desfoque, recorte e gradiente de verdade — o SVG das
 * listas só aproxima o desfoque e deixava faixas duras no rosto. vb = recorte em unidades do avatar; w×h lógicos.
 */
export function avatarPng(layers: AvatarLayer[], rig: AvatarRig, pose: Pose | null, vb: { x: number; y: number; w: number; h: number }, w: number, h: number, bigHead = false): Uint8Array | null {
  return render(w, h, (c) => {
    const prev = headScaleOn;
    headScaleOn = bigHead;
    try {
      const s = w / vb.w;
      drawAvatar(c, layers, rig, pose, -vb.x * s, -vb.y * s, s, false);
    } finally {
      headScaleOn = prev;
    }
  });
}

/** solta o cache de paths das camadas e o de cores (fila de imagens ociosa, fora do mapa, memória baixa do sistema) */
export function clearDrawCaches(): void {
  for (const e of pathCache.values()) if (e.p) disposeAll([e.p]);
  pathCache.clear();
  pathBytes = 0;
  colorCache.clear();
}
