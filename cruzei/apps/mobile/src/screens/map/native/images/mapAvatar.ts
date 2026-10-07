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
import { MemCache } from '../../../../services/memCache';
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

/**
 * quantas montagens de camadas ficam na memória. Só servem pra rasterizar: a figura parada vira PNG uma vez e os quadros
 * de animação saem das que animam ao mesmo tempo (eu, selecionado, match + ANIM_CAP 6/4/2 = até 9). Eram 40: no node, 40
 * visuais pesados seguravam ~54 MB de heap; cada uma tem ~200–350 KB de strings de path
 */
export const MAP_LAYERS_LRU = 12;
/** bytes por camada além das strings de path (objeto, cores, gradiente): mesma conta do CruzeiAvatar.layersBytes */
const LAYER_OVERHEAD = 512;
const built = new MemCache<AvatarLayer[]>('map.layers', 6 * 1024 * 1024, MAP_LAYERS_LRU);
/** id curto por objeto (config ou definição): o LRU guarda string e o objeto some junto com quem o usa */
const cfgIds = new WeakMap<object, string>();
let cfgSeq = 0;
function idOf(o: object): string {
  let id = cfgIds.get(o);
  if (!id) cfgIds.set(o, (id = 'c' + cfgSeq++));
  return id;
}
function layersBytes(layers: AvatarLayer[]): number {
  let b = 0;
  for (const l of layers) b += LAYER_OVERHEAD + l.d.length + (l.cp ? l.cp.length : 0);
  return b;
}

/** camadas do mapa de uma config, com LRU (a montagem custa ~4–10 ms no Hermes) */
function mapLayersOf(cfg: AvatarConfig): AvatarLayer[] {
  const id = idOf(cfg);
  const hit = built.get(id);
  if (hit) return hit;
  const l = buildAvatarLayers(cfg, MAP_BUILD);
  return built.set(id, l, layersBytes(l));
}

/** solta as camadas montadas e as da assinatura (o motor chama quando a fila de imagens fica ociosa) */
export function clearMapAvatarCaches(): void {
  built.clear();
  sigCache.clear();
}

/**
 * definição de um visual pro motor do mapa. Camadas (`l`), rig (`p`) e animação assinatura (`e`) saem sob demanda, na
 * primeira leitura: o motor só lê quando a pessoa tem figura própria e precisa rasterizar (o PNG não está no cache em
 * disco) ou animar. Definir as 300 pessoas do /nearby de uma vez não monta nada (antes: o rig de todas, ~10 ms no V8 e
 * várias vezes isso no Hermes, num bloco só na thread JS da primeira abertura); só as ~60 com figura pagam.
 */
export function mapAvatarDef(cfg: AvatarConfig): AvatarDef {
  let rig: AvatarDef['p'] | undefined;
  let sig: string | null | undefined;
  return {
    get l() {
      return mapLayersOf(cfg);
    },
    get p() {
      if (rig === undefined) rig = buildAvatarRig(cfg);
      return rig;
    },
    get e() {
      if (sig === undefined) sig = signatureEmote(cfg);
      return sig;
    },
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

/**
 * montagens da animação assinatura (expressões e objeto trocados): toca uma de cada vez (toque, avatar salvo), então
 * bastam poucas. Era um WeakMap por definição: ficava viva enquanto a pessoa estivesse no mapa (até 300)
 */
const sigCache = new MemCache<{ s: SigAssets | null }>('map.sig', Infinity, 4);

/** animação assinatura de um visual (null = nenhuma registrada) */
export function sigAssets(d: AvatarDef): SigAssets | null {
  const sigId = idOf(d);
  const cached = sigCache.get(sigId);
  if (cached) return cached.s;
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
  sigCache.set(sigId, { s: out }, 1);
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
