// Montagem do palco no JS (uma vez por visual): camadas da config + expressões/objeto alternativos da animação,
// corridas por grupo e papel, cada corrida gravada numa SkPicture (gravação de comandos: CPU, sem superfície de GPU).
// Paths via Skia.Path.MakeFromSVGString com cache por montagem; o resultado fica num cache pequeno por chave
// (avatarKey + modo + sombra + animação), então remontar o palco com o mesmo visual não refaz nada.

import type { AvatarConfig } from '@cruzei/shared-types';
import { Skia, type SkColor, type SkPath, type SkPicture } from '@shopify/react-native-skia';

import { buildAvatarLayers, buildAvatarRig, keyOf, layersWithTag } from '../../../avatar';
import { emoteHands } from '../../../avatar/emotes';
import type { EmoteDef } from '../../../avatar/emotes/types';
import { propConfig, propFreesHands } from '../../../avatar/scene';
import { makeLayerPaints, paintLayer, parseLayerPath, type PaintEnv } from '../../../avatar/skia/paintLayer';
import type { AvatarGroup, AvatarLayer, AvatarRig } from '../../../avatar/types';

import { mergeStageLayers, stageRuns, type StageRole } from './stageLayers';

export interface StageRun {
  g: AvatarGroup;
  role: StageRole;
  picture: SkPicture;
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
}

const BOUNDS = { x: -60, y: -60, width: 220, height: 280 };
const CACHE_MAX = 6;
const cache = new Map<string, StageAssets>();

function record(layers: AvatarLayer[], env: PaintEnv): SkPicture {
  const rec = Skia.PictureRecorder();
  const canvas = rec.beginRecording(BOUNDS);
  const paints = makeLayerPaints(env);
  for (const l of layers) paintLayer(canvas, l, env, paints);
  return rec.finishRecordingAsPicture();
}

/** monta (ou devolve do cache) o palco de uma config pra um modo e uma animação */
export function stageAssets(cfg: AvatarConfig, mode: 'full' | 'bust', groundShadow: boolean, def: EmoteDef | null): StageAssets {
  const key = `${keyOf(cfg)}|${mode}|${groundShadow ? 1 : 0}|${def ? def.id : '-'}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
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
  const runs: StageRun[] = stageRuns(merged).map((r) => ({ g: r.g, role: r.role, picture: record(r.layers, env) }));
  const assets: StageAssets = { key, rig, runs, altFaces, hasProp: prop.length > 0, hasHands: hands.length > 0 };
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, assets);
  return assets;
}

/** solta o cache (aviso de memória baixa) */
export function clearStageCache(): void {
  cache.clear();
}
