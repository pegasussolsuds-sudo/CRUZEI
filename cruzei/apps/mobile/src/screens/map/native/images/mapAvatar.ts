// Avatar no mapa: como cada visual vira a definição que o motor desenha e o que ele monta sob demanda.
//   - mapAvatarDef(cfg): camadas no nível 'lite' (o raster é ~48 px: trama, pesponto e fio solto nem aparecem), rig com a
//     cena (a montaria vem de p.scene), a animação assinatura e a própria config;
//   - sigAssets(def): camadas da animação assinatura quadro a quadro — troca de expressão e objeto na mão como no palco
//     (stage/stageLayers.ts); montado só quando a figura vai tocar (toque, avatar salvo), uma vez por visual;
//   - restArms(def): giros que levam os braços do repouso desta pessoa (mão na cintura, no passante…) pro braço solto,
//     de onde partem as animações que mexem os braços;
//   - mapAuraRgb(cfg): cor da poça de luz da aura no chão;
//   - drawingStamp(): impressão digital do DESENHO (não da config) pra chave do cache em disco.

import type { AvatarConfig } from '@cruzei/shared-types';
import { DEFAULT_AVATAR, avatarAuraTint, normalizeAvatarConfig } from '@cruzei/shared-utils';

import { buildAvatarLayers, buildAvatarRig, layersWithTag, type BuildOptions } from '../../../../avatar';
import { buildAnatomy, restArmDelta } from '../../../../avatar/anatomy';
import { fillConfig } from '../../../../avatar/ctx';
import { emoteDef, emoteFaceAt } from '../../../../avatar/emotes';
import type { EmoteDef } from '../../../../avatar/emotes/types';
import { propConfig, propFreesHands } from '../../../../avatar/scene';
import type { AvatarLayer } from '../../../../avatar/types';
import { signatureEmote } from '../../../../components/avatar/signature';
import { AURA_BASE } from '../../../../components/avatar/stage/fx-auras';
import { mergeStageLayers, roleVisible } from '../../../../components/avatar/stage/stageLayers';
import type { AvatarDef } from '../contracts';

/** montagem das camadas do mapa: sombra no chão + nível de detalhe leve */
export const MAP_BUILD: BuildOptions = { groundShadow: true, lod: 'lite' };

/** quantas montagens de camadas ficam na memória (cada uma tem ~200 KB; as figuras animadas são no máximo 10) */
export const MAP_LAYERS_LRU = 40;
const built = new Map<AvatarConfig, AvatarLayer[]>();

/** camadas do mapa de uma config, com LRU (a montagem custa ~4–10 ms no Hermes) */
function mapLayersOf(cfg: AvatarConfig): AvatarLayer[] {
  let l = built.get(cfg);
  if (l) {
    built.delete(cfg);
  } else {
    l = buildAvatarLayers(cfg, MAP_BUILD);
    if (built.size >= MAP_LAYERS_LRU) {
      const old = built.keys().next().value;
      if (old !== undefined) built.delete(old);
    }
  }
  built.set(cfg, l);
  return l;
}

/**
 * definição de um visual pro motor do mapa. As camadas (`l`) são montadas sob demanda, na primeira leitura: o motor só
 * lê quando precisa rasterizar (o PNG não está no cache em disco), dentro da fila de imagens, que já vai por prioridade
 * (quem está perto primeiro). Definir 300 pessoas de uma vez custa só o rig (~0,05 ms cada).
 */
export function mapAvatarDef(cfg: AvatarConfig): AvatarDef {
  return {
    get l() {
      return mapLayersOf(cfg);
    },
    p: buildAvatarRig(cfg),
    e: signatureEmote(cfg),
    c: cfg,
  };
}

/** '#RRGGBB' → 'r,g,b' ('' se não for hex) */
export function hexToRgb(hex: string): string {
  const m = /^#?([0-9a-f]{6})/i.exec(hex.trim());
  if (!m) return '';
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

/** cor 'r,g,b' da poça de luz da aura: a cor escolhida (auraColor) ou a cor própria do efeito; '' = sem aura */
export function mapAuraRgb(cfg: Partial<Pick<AvatarConfig, 'aura' | 'auraColor'>>): string {
  const id = cfg.aura;
  if (!id || id === 'none') return '';
  const hex = avatarAuraTint(cfg.auraColor ?? 'a_auto') ?? AURA_BASE[id] ?? null;
  return hex ? hexToRgb(hex) : '';
}

export interface SigAssets {
  def: EmoteDef;
  /** camadas do quadro no progresso k 0..1 (expressão e objeto da animação já trocados) */
  layersAt(k: number): AvatarLayer[];
}

const sigCache = new WeakMap<AvatarDef, SigAssets | null>();

/** animação assinatura de um visual (null = nenhuma registrada) */
export function sigAssets(d: AvatarDef): SigAssets | null {
  if (sigCache.has(d)) return sigCache.get(d) ?? null;
  const def = emoteDef(d.e ?? null);
  let out: SigAssets | null = null;
  if (def && d.c) {
    const cfg = d.c;
    const altFaces: string[] = [];
    const altLayers: AvatarLayer[][] = [];
    for (const f of def.face ?? []) {
      if (f.face === cfg.face || altFaces.includes(f.face)) continue;
      altFaces.push(f.face);
      altLayers.push(layersWithTag(buildAvatarLayers({ ...cfg, face: f.face }, MAP_BUILD), 'face'));
    }
    let prop: AvatarLayer[] = [];
    let propAt = -1;
    if (def.prop && (def.prop !== cfg.held || propFreesHands(cfg))) {
      const alt = buildAvatarLayers(propConfig(cfg, def.prop), MAP_BUILD);
      propAt = alt.findIndex((l) => l.k === 'held' || l.k === 'prop');
      prop = layersWithTag(alt, ['held', 'prop']);
    }
    const merged = mergeStageLayers({ base: d.l, altFaces: altLayers, prop, propAt });
    const propOn = prop.length > 0;
    const byFace = new Map<number, AvatarLayer[]>();
    out = {
      def,
      layersAt(k) {
        const face = emoteFaceAt(def, k);
        const fi = face == null ? -1 : altFaces.indexOf(face);
        let hit = byFace.get(fi);
        if (!hit) {
          hit = merged.filter((s) => roleVisible(s.role, fi, propOn)).map((s) => s.l);
          byFace.set(fi, hit);
        }
        return hit;
      },
    };
  } else if (def) {
    out = { def, layersAt: () => d.l };
  }
  sigCache.set(d, out);
  return out;
}

const restCache = new WeakMap<AvatarDef, number[] | null>();

/** braço solto desta pessoa: [braço L, antebraço L, braço R, antebraço R] (graus, somados à pose); null sem config */
export function restArms(d: AvatarDef): number[] | null {
  if (restCache.has(d)) return restCache.get(d) ?? null;
  let out: number[] | null = null;
  if (d.c) {
    try {
      const r = restArmDelta(buildAnatomy(fillConfig(d.c), d.p.scene ?? null));
      out = [r.armL, r.foreL, r.armR, r.foreR].map((n) => (Number.isFinite(n) ? n : 0));
    } catch {
      out = null;
    }
  }
  restCache.set(d, out);
  return out;
}

let stamp: string | null = null;

/**
 * impressão digital do desenho: hash das camadas do avatar padrão. Muda quando o desenho do corpo, rosto, cabelo ou
 * roupa padrão muda, então o cache em disco do mapa se refaz sozinho mesmo se ninguém subir AVATAR_RENDER_VERSION
 * (itens fora do avatar padrão continuam dependendo da versão). Uma montagem por sessão, na primeira figura.
 */
export function drawingStamp(): string {
  if (stamp != null) return stamp;
  let h = 0x811c9dc5;
  const mix = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  };
  try {
    const layers = buildAvatarLayers(normalizeAvatarConfig(DEFAULT_AVATAR) as AvatarConfig, MAP_BUILD);
    mix(String(layers.length));
    for (const l of layers) mix(l.d + (l.f ?? '') + (l.o ?? '') + (l.g ?? '') + (l.b ?? '') + (l.gf ? JSON.stringify(l.gf) : ''));
  } catch {
    // sem desenho: fica só a versão
  }
  stamp = (h >>> 0).toString(36);
  return stamp;
}
