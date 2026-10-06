// Tipos do contrato de render do avatar (camadas, gradientes, grupos do esqueleto e pivôs).
// Sem dependência de RN, Skia ou DOM: o mesmo arquivo roda no app, no mapa (JS) e em node (folha de contato).
//
// Sistema de coordenadas: viewBox 0 0 100 140 (corpo inteiro, pés em y≈134, sombra no chão em y≈135).
// Ângulos em graus; positivo é horário na tela (y pra baixo).

import type { AvatarMountKind, AvatarPetPose } from '@cruzei/shared-types';

/**
 * Grupo do esqueleto a que a camada pertence (a pose gira/move o grupo em volta do pivô do rig).
 * Hierarquia: shadow (raiz) · mount (raiz) · legX → shinX (joelho) · body → head · body → armX → foreX (cotovelo) ·
 * pet (raiz ou filho do body, conforme rig.petAttach). Com veículo, body/legX/pet herdam a transformação do mount.
 */
export type AvatarGroup =
  | 'shadow'
  | 'body'
  | 'head'
  | 'armL'
  | 'armR'
  | 'foreL'
  | 'foreR'
  | 'legL'
  | 'legR'
  | 'shinL'
  | 'shinR'
  | 'mount'
  | 'pet';

/** todos os grupos, numa ordem fixa (o palco usa um hook por grupo, sempre nesta ordem) */
export const AVATAR_GROUPS: readonly AvatarGroup[] = [
  'shadow',
  'body',
  'head',
  'armL',
  'armR',
  'foreL',
  'foreR',
  'legL',
  'legR',
  'shinL',
  'shinR',
  'mount',
  'pet',
] as const;

/** parada de gradiente: [offset 0..1, cor hex ou rgba, opacidade extra 0..1?] */
export type AvatarStop = readonly [number, string] | readonly [number, string, number];

/**
 * Gradiente em unidades do viewBox (userSpaceOnUse), no espaço do grupo da camada.
 * 'l' = linear de (x1,y1) a (x2,y2); 'r' = radial de centro (cx,cy) e raio r, com foco opcional (fx,fy).
 */
export type AvatarGradient =
  | { t: 'l'; x1: number; y1: number; x2: number; y2: number; s: readonly AvatarStop[] }
  | { t: 'r'; cx: number; cy: number; r: number; fx?: number; fy?: number; s: readonly AvatarStop[] };

/**
 * Etiqueta da camada:
 * 'face' = expressão (olhos, boca, sobrancelhas, bochechas) — o palco troca durante a animação;
 * 'held' = objeto na mão; 'prop' = objeto que só aparece durante uma animação; 'pet'; 'mount' (veículo); 'pride';
 * 'hand' = as mãos (o palco troca pela mão aberta durante a animação que pede, ver emotes GESTURE_HANDS/DANCE_HANDS).
 */
export type AvatarLayerTag = 'face' | 'held' | 'pet' | 'mount' | 'pride' | 'prop' | 'hand';

/** Camada desenhável (chaves curtas: herança da época em que ia serializada pro WebView do mapa). */
export interface AvatarLayer {
  /** path SVG */
  d: string;
  /** grupo do esqueleto (padrão 'body') */
  g?: AvatarGroup;
  /** preenchimento (hex/rgba); com `gf` vira a cor média de reserva */
  f?: string;
  /** traço */
  s?: string;
  /** espessura do traço */
  w?: number;
  /** opacidade 0..1 */
  o?: number;
  /** regra de preenchimento evenodd */
  r?: 'evenodd';
  /** ponta do traço */
  c?: 'round' | 'butt';
  /** preenchimento em gradiente (substitui `f`) */
  gf?: AvatarGradient;
  /** gradiente no traço (substitui `s`) */
  gs?: AvatarGradient;
  /** desfoque gaussiano: sigma em unidades do viewBox (sem suporte: desenha sem desfoque, com metade da opacidade) */
  b?: number;
  /** path de recorte: a camada só aparece dentro dele (mesmo espaço do grupo) */
  cp?: string;
  /** tracejado do traço (unidades do viewBox), pra costuras */
  da?: number[];
  /** etiqueta */
  k?: AvatarLayerTag;
}

export type Pt = [number, number];

/** Pivôs do rig no viewBox 0 0 100 140: [x, y] de cada articulação. */
export interface AvatarRig {
  /** quadril: o tronco (e tudo acima) gira/escala a partir daqui */
  body: Pt;
  /** base do pescoço */
  head: Pt;
  /** ombros */
  armL: Pt;
  armR: Pt;
  /** cotovelos */
  foreL: Pt;
  foreR: Pt;
  /** quadris (topo das coxas) */
  legL: Pt;
  legR: Pt;
  /** joelhos */
  shinL: Pt;
  shinR: Pt;
  /** pivô do veículo */
  mount: Pt;
  /** pivô do pet */
  pet: Pt;
  /** 'body' = o pet acompanha o tronco (colo/ombro); 'root' = fica no chão/no ar */
  petAttach: 'root' | 'body';
  /**
   * (opcional) cena resolvida da config (veículo, pet, mãos…). O mapa e o SVG estático usam pra somar a pose-base
   * da cena (sentado, pernas na moto, mãos no volante) mesmo sem animação. Ausente = sem cena (pé no chão).
   */
  scene?: AvatarSceneInfo;
}

/** Como as mãos ficam por causa da cena. */
export type AvatarHands = 'free' | 'wheel' | 'bars' | 'cradle' | 'rest';

/** Cena resolvida (scene.ts resolveScene): o que a config pede de veículo/pet e como o corpo se ajeita. */
export interface AvatarSceneInfo {
  mount: AvatarMountKind | null;
  /** pose efetiva do pet (já ajustada ao veículo) ou null sem pet */
  petPose: AvatarPetPose | null;
  petAttach: 'root' | 'body';
  /** objeto na mão aparece? */
  showHeld: boolean;
  /** bandeirinha na mão esquerda aparece? */
  showLeftHandFlag: boolean;
  hands: AvatarHands;
  /** pernas escondidas (carro) */
  hideLegs: boolean;
  /** sentado (cadeira de rodas) */
  seated: boolean;
  /** deslocamento vertical fixo do corpo inteiro (sobe na prancha/no tapete); negativo = pra cima */
  lift: number;
}
