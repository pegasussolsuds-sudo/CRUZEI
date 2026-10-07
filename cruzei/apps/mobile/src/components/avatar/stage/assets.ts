// Montagem do palco no JS (uma vez por visual): camadas da config + expressões/objeto alternativos da animação,
// corridas por grupo e papel, cada corrida gravada numa SkPicture (gravação de comandos: CPU, sem superfície de GPU).
// Paths via Skia.Path.MakeFromSVGString com cache por montagem; o resultado fica num cache pequeno por chave
// (avatarKey + modo + sombra + animação), então remontar o palco com o mesmo visual não refaz nada.
//
// Sprites (stageSprites): cada corrida vira UMA imagem (Skia de CPU, uma vez por visual e por escala), recortada na
// caixa da corrida. Por quadro o palco só desenha imagens com a matriz do grupo: tocar a SkPicture a cada quadro
// refazia centenas de paths e máscaras de desfoque na thread de UI (~40–48 ms por quadro no S23).

import type { AvatarConfig } from '@cruzei/shared-types';
import { Skia, type SkColor, type SkImage, type SkPath, type SkPicture } from '@shopify/react-native-skia';

import { buildAvatarLayers, buildAvatarRig, keyOf, layersWithTag } from '../../../avatar';
import { emoteHands } from '../../../avatar/emotes';
import type { EmoteDef } from '../../../avatar/emotes/types';
import { propConfig, propFreesHands } from '../../../avatar/scene';
import { makeLayerPaints, paintLayer, parseLayerPath, type PaintEnv } from '../../../avatar/skia/paintLayer';
import type { AvatarGroup, AvatarLayer, AvatarRig } from '../../../avatar/types';

import { MemCache } from '../../../services/memCache';

import { mergeStageLayers, stageRuns, type StageRole } from './stageLayers';

export interface StageRun {
  g: AvatarGroup;
  role: StageRole;
  picture: SkPicture;
  /** caixa do desenho da corrida no espaço do grupo (unidades do viewBox, com traço e desfoque); null = não desenha nada */
  box: Box | null;
}

type Box = { x: number; y: number; w: number; h: number };

/** uma corrida pronta em imagem: desenhar `img` no retângulo (x, y, w, h) do espaço do grupo */
export interface StageSprite {
  g: AvatarGroup;
  role: StageRole;
  img: SkImage;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StageAssets {
  key: string;
  rig: AvatarRig;
  runs: StageRun[];
  /** ids das expressões alternativas (índice = N do papel 'faceN') */
  altFaces: string[];
  /** a animação tem objeto que aparece (prop montado) */
  hasProp: boolean;
  /** a animação troca a mão pela aberta (palma pra câmera) */
  hasHands: boolean;
  /** sprites da última escala pedida (stageSprites) */
  sprites?: { scale: number; list: StageSprite[] | null };
}

const BOUNDS = { x: -60, y: -60, width: 220, height: 280 };
/** visuais no cache (cada um com os sprites de uma escala: ~2–6 MB de memória nativa no palco grande) */
const CACHE_MAX = 4;
/** teto dos sprites guardados (bytes de pixel, memória nativa do Skia) */
export const STAGE_CACHE_BYTES = 16 * 1024 * 1024;
/** SkPictures e rig de um visual sem sprites (estimativa) */
const ASSETS_BYTES = 256 * 1024;
const cache = new MemCache<StageAssets>('avatar.stage', STAGE_CACHE_BYTES, CACHE_MAX);

/** sem nenhum palco montado por este tempo, o cache solta tudo (sair do perfil/editor devolve os sprites) */
export const STAGE_IDLE_MS = 30_000;
let mounted = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

const dispose = (o: unknown) => (o as { dispose?: () => void } | null | undefined)?.dispose?.();

/**
 * Nenhum palco montado: devolve a memória nativa do Skia já (imagens dos sprites e SkPictures das corridas). Só o
 * AvatarStage usa este cache e ele segura o cache montado (holdStage), então ninguém desenha estes objetos; sem o dispose
 * eles só saíam quando o coletor do Hermes rodasse
 */
function releaseIdle(): void {
  idleTimer = null;
  if (mounted > 0) return;
  for (const a of cache.values()) {
    for (const s of a.sprites?.list ?? []) dispose(s.img);
    for (const r of a.runs) dispose(r.picture);
  }
  cache.clear();
}

function armIdle(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(releaseIdle, STAGE_IDLE_MS);
}

/** um palco montado segura o cache; devolve quem solta (desmontou) */
export function holdStage(): () => void {
  mounted++;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    if (--mounted > 0) return;
    armIdle();
  };
}

/**
 * o palco lê o cache no render e só segura (holdStage) no efeito, depois: ler sem palco montado adia a limpeza, pra ela
 * nunca descartar o que um palco que está montando acabou de pegar
 */
function touchIdle(): void {
  if (mounted === 0 && idleTimer) armIdle();
}

/** caixa de uma camada (path + meio traço + 3σ do desfoque, cortada pelo recorte); null = sem tinta ou path inválido */
function layerBox(l: AvatarLayer, env: PaintEnv): Box | null {
  const hasFill = !!(l.gf || (l.f && l.f !== 'none'));
  const hasStroke = !!(l.gs || (l.s && l.s !== 'none'));
  if (!hasFill && !hasStroke) return null;
  const p = env.path(l.d, l.r === 'evenodd');
  if (!p) return null;
  const r = p.computeTightBounds();
  const pad = (hasStroke ? (l.w || 1) / 2 + 0.5 : 0) + (l.b && l.b > 0 ? l.b * 3 : 0) + 0.5;
  let x0 = r.x - pad;
  let y0 = r.y - pad;
  let x1 = r.x + r.width + pad;
  let y1 = r.y + r.height + pad;
  if (l.cp) {
    const cp = env.path(l.cp, false);
    if (cp) {
      const c = cp.computeTightBounds();
      x0 = Math.max(x0, c.x - 0.5);
      y0 = Math.max(y0, c.y - 0.5);
      x1 = Math.min(x1, c.x + c.width + 0.5);
      y1 = Math.min(y1, c.y + c.height + 0.5);
    }
  }
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

function record(layers: AvatarLayer[], env: PaintEnv): { picture: SkPicture; box: Box | null } {
  const rec = Skia.PictureRecorder();
  const canvas = rec.beginRecording(BOUNDS);
  const paints = makeLayerPaints(env);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const l of layers) {
    paintLayer(canvas, l, env, paints);
    const b = layerBox(l, env);
    if (!b) continue;
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  // nunca maior que a área de gravação
  x0 = Math.max(x0, BOUNDS.x);
  y0 = Math.max(y0, BOUNDS.y);
  x1 = Math.min(x1, BOUNDS.x + BOUNDS.width);
  y1 = Math.min(y1, BOUNDS.y + BOUNDS.height);
  return { picture: rec.finishRecordingAsPicture(), box: x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null };
}

/** monta (ou devolve do cache) o palco de uma config pra um modo e uma animação */
export function stageAssets(cfg: AvatarConfig, mode: 'full' | 'bust', groundShadow: boolean, def: EmoteDef | null): StageAssets {
  touchIdle();
  const key = `${keyOf(cfg)}|${mode}|${groundShadow ? 1 : 0}|${def ? def.id : '-'}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const opts = { groundShadow: groundShadow && mode === 'full', mode };
  const base = buildAvatarLayers(cfg, opts);
  const rig = buildAvatarRig(cfg, { mode });
  const altFaces: string[] = [];
  const altFaceLayers: AvatarLayer[][] = [];
  if (def?.face) {
    for (const f of def.face) {
      if (f.face === cfg.face || altFaces.includes(f.face)) continue;
      altFaces.push(f.face);
      altFaceLayers.push(layersWithTag(buildAvatarLayers({ ...cfg, face: f.face }, opts), 'face'));
    }
  }
  let prop: AvatarLayer[] = [];
  let propAt = -1;
  if (def?.prop && (def.prop !== cfg.held || propFreesHands(cfg))) {
    const alt = buildAvatarLayers(propConfig(cfg, def.prop), opts);
    propAt = alt.findIndex((l) => l.k === 'held' || l.k === 'prop');
    prop = layersWithTag(alt, ['held', 'prop']);
  }
  const handsWant = def ? emoteHands(def.id) : null;
  const hands = handsWant ? layersWithTag(buildAvatarLayers(cfg, { ...opts, hands: handsWant }), 'hand') : [];
  const merged = mergeStageLayers({ base, altFaces: altFaceLayers, prop, propAt, hands });
  // ambiente de gravação: cache de paths e cores só desta montagem (a SkPicture guarda o que precisa)
  const paths = new Map<string, SkPath | null>();
  const colors = new Map<string, SkColor>();
  const env: PaintEnv = {
    track: (o) => o,
    path: (d, evenOdd) => {
      const k = (evenOdd ? 'e|' : 'n|') + d;
      let p = paths.get(k);
      if (p === undefined) {
        p = parseLayerPath(d, evenOdd);
        paths.set(k, p);
      }
      return p;
    },
    color: (css) => {
      let c = colors.get(css);
      if (!c) {
        c = Skia.Color(css);
        colors.set(css, c);
      }
      return c;
    },
  };
  const runs: StageRun[] = stageRuns(merged).map((r) => ({ g: r.g, role: r.role, ...record(r.layers, env) }));
  const assets: StageAssets = { key, rig, runs, altFaces, hasProp: prop.length > 0, hasHands: hands.length > 0 };
  return cache.set(key, assets, ASSETS_BYTES);
}

/** lado máximo de um sprite (px): uma corrida enorme num palco gigante não vira uma textura absurda */
const SPRITE_MAX_PX = 2048;

/** o Skia desta plataforma tem superfície de CPU (os mocks de teste não têm: o palco toca as SkPictures) */
function canRaster(): boolean {
  return typeof (Skia as { Surface?: { Make?: unknown } } | undefined)?.Surface?.Make === 'function';
}

/**
 * Cada corrida rasterizada numa imagem (Skia de CPU), na escala `scale` = px por unidade do viewBox (escala do palco ×
 * densidade da tela). A caixa começa num pixel inteiro: parado, o sprite cai pixel a pixel na tela (sem borrão de
 * amostragem). Fica guardado no próprio StageAssets (mesma escala = mesma lista). null = sem raster (cai nas SkPictures).
 */
const sameScale = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** sprites já prontos pra esta escala (sem rasterizar): undefined = ainda não feitos */
export function peekStageSprites(assets: StageAssets, scale: number): StageSprite[] | null | undefined {
  return assets.sprites && sameScale(assets.sprites.scale, scale) ? assets.sprites.list : undefined;
}

export function stageSprites(assets: StageAssets, scale: number): StageSprite[] | null {
  touchIdle();
  // escala exata (a do palco × densidade): o sprite parado cai 1:1 nos pixels da tela
  const q = Math.max(0.5, scale);
  if (assets.sprites && sameScale(assets.sprites.scale, q)) return assets.sprites.list;
  let list: StageSprite[] | null = null;
  let pixels = 0;
  if (canRaster()) {
    try {
      list = [];
      for (const run of assets.runs) {
        const b = run.box;
        if (!b) continue;
        const px0 = Math.floor(b.x * q);
        const py0 = Math.floor(b.y * q);
        const pw = Math.min(SPRITE_MAX_PX, Math.ceil((b.x + b.w) * q) - px0);
        const ph = Math.min(SPRITE_MAX_PX, Math.ceil((b.y + b.h) * q) - py0);
        if (pw <= 0 || ph <= 0) continue;
        const surf = Skia.Surface.Make(pw, ph);
        if (!surf) throw new Error('sem superfície');
        const c = surf.getCanvas();
        c.translate(-px0, -py0);
        c.scale(q, q);
        c.drawPicture(run.picture);
        surf.flush();
        const img = surf.makeImageSnapshot();
        (surf as unknown as { dispose?: () => void }).dispose?.();
        pixels += pw * ph;
        list.push({ g: run.g, role: run.role, img, x: px0 / q, y: py0 / q, w: pw / q, h: ph / q });
      }
    } catch {
      list = null;
    }
  }
  assets.sprites = { scale: q, list };
  // o cache passa a contar os pixels (a lista da escala anterior saiu); quem já saiu do cache não volta
  if (cache.get(assets.key) === assets) cache.set(assets.key, assets, ASSETS_BYTES + (list ? pixels * 4 : 0));
  return list;
}

/** solta o cache (aviso de memória baixa; também pelo registro do memCache) */
export function clearStageCache(): void {
  cache.clear();
}
