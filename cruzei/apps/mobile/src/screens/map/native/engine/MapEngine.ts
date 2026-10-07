// Motor do mapa nativo: porta do antigo mapbox-html.ts (WebView) pra TypeScript, rodando no JS do app e desenhando pelo
// @maplibre/maplibre-react-native (MLRN). Mesmas regras de produto (quem aparece, como anda, o que pulsa, a coreografia
// do match), com quatro trocas técnicas:
//   1. imagens (figuras, bolhas, ícones) são desenhadas uma vez em Skia raster, gravadas em PNG e registradas no
//      <Images>; "animar" uma figura é trocar o arquivo da imagem dela (quadros cacheados em disco);
//   2. o que pulsa (sonar, anéis, auras) vira CircleLayer com paint constante atualizado por um relógio — sem relayout;
//   3. a câmera é o <Camera> nativo, com o controle de animação/padding de engine/camera.ts;
//   4. os grupos de pessoas são calculados aqui (supercluster), não na fonte nativa: o cluster nativo do MapLibre cai
//      ao expandir depois de a fonte ser republicada (maplibre-native#3519) e a fonte users é republicada até 5x/s.
// Cada saída (fonte GeoJSON, imagens, fase dos anéis, visual) sai num canal (engine/channels.ts) e só a camada que
// assina aquele canal re-renderiza. O relógio dorme quando nada anima.

import type { RefObject } from 'react';
import { AccessibilityInfo, AppState } from 'react-native';
import type { CameraRef, GeoJSONSourceRef, MapRef, ViewStateChangeEvent } from '@maplibre/maplibre-react-native';
import Supercluster from 'supercluster';
import type { InvisibleGroup, POI } from '@cruzei/shared-types';

import { avatarColorHex } from '@cruzei/shared-utils';

import { AVATAR_RENDER_VERSION } from '../../../../avatar';
import type { AvatarDefs, BurstPayload, CameraOpts, EmoteKind, MapCommand, MapDataPayload, MapEvent, MapPadding, MapTheme, MeState, PerfTier, PinPayload, InitTier } from '../../bridge';
import { BUB, IMG, IMG_SCALE, bubbleOffset, figOffset, type AnimState, type AvatarDef, type BubbleStyle, type Dim, type EmoteState, type FigureLook, type MapImageEntry, type MapImageRef, type PoseVariation } from '../contracts';
import { clearDrawCaches, mapDraw } from '../images/draw';
import { DUR, RUN, WALK, edgeW, pose, ridePeriod, sizeFor, usesArmsOf, variationFor, type AnimExtras } from '../images/anim';
import { clearMapAvatarCaches, drawingStamp, restArms, sigAssets, type SigAssets } from '../images/mapAvatar';
import { mapImages } from '../images/store';
import { mapPhotos } from '../images/photos';
import { invisibleFeatures } from '../../../../components/map/invisible';
import { monoNow } from '../../../../services/frameBatch';
import { Channels } from './channels';
import { CameraCtl, MAX_PITCH, type CamState } from './camera';
import { FeatureStateQueue } from './featureState';
import { distM, fitZoom, inBounds, isFiniteLngLat, metersPerPixel, midpoint, offsetCenter, offsetMeters, type LngLat } from './geo';

type FC = GeoJSON.FeatureCollection;
type Feature = GeoJSON.Feature;

/** imagens do mapa agrupadas: cada grupo vira um <Images> (desmontar o grupo tira as imagens dele do estilo) */
export type ImageGroups = Record<string, Record<string, MapImageEntry>>;

export interface MapLook {
  theme: MapTheme;
  tier: PerfTier;
}

/** o que tem motivo pra pulsar agora: só essas camadas acompanham o relógio */
export interface RingsState {
  /** níveis de sonar presentes entre os lugares em alta/eventos (sonar-1, -2, -3) */
  sonar: [boolean, boolean, boolean];
  /** alguém com aura premium+ na fonte users */
  aura: boolean;
  /** alguém com boost (fonte users-boost) */
  auraBoost: boolean;
  me: boolean;
  sel: boolean;
  /** aura do destaque: cor/tamanho constantes (sem expressão por feature no paint animado) */
  spotAura: 'boost' | 'plus' | null;
  /** onda do pino: noite (rosa) ou dia (lima) */
  pin: 'n' | 'd' | null;
}

/**
 * Fontes GeoJSON: o canal leva o JSON pronto (o <GeoJSONSource data> recebe a string, sem JSON.stringify a cada render).
 * O motor guarda a coleção só das fontes que ele relê (SRC_KEEP_FC); das outras, só a contagem.
 */
export interface MapChannels {
  users: string;
  usersBoost: string;
  movers: string;
  spot: string;
  me: string;
  sel: string;
  fx: string;
  pois: string;
  pin: string;
  moment: string;
  particles: string;
  /** gente invisível (só Premium): um ponto por lugar/quadra com a contagem, nunca uma pessoa */
  invisible: string;
  images: ImageGroups;
  /** relógio das animações de paint (s) — só muda com algo em rings, por RING_BURST_MS; parado = RING_REST */
  phase: number;
  rings: RingsState;
  look: MapLook;
  /** prédios crescendo no 1º load: 0 → 1 (a transição de 900 ms é nativa) */
  buildingScale: number;
  /** queda do pino da busca */
  pinLook: { dy: number; alpha: number };
  /** névoa do horizonte: 0 (pitch 0) → 1 (pitch 60), em degraus de 0,05 */
  horizon: number;
  [key: string]: unknown;
}

export const EMPTY_FC: FC = { type: 'FeatureCollection', features: [] };
const EMPTY_JSON = JSON.stringify(EMPTY_FC);
type SourceName = keyof typeof SRC;
/** fontes cuja coleção o motor relê depois de publicar (rebalanceOwn e o ritmo do push): as outras só guardam a contagem */
const SRC_KEEP_FC: readonly SourceName[] = ['users', 'usersBoost', 'movers'];
/** fase dos anéis parados: as camadas desenham o anel num quadro fixo (layers.tsx) e o mapa não redesenha */
export const RING_REST = -1;
const NO_RINGS: RingsState = { sonar: [false, false, false], aura: false, auraBoost: false, me: false, sel: false, spotAura: null, pin: null };

/** id da imagem compartilhada da silhueta (quem está fora do teto ou esperando o desenho) */
export const GENERIC_FIG = 'fig-generic';
/** fontes: id nativo */
export const SRC = {
  users: 'users',
  usersBoost: 'users-boost',
  movers: 'movers',
  spot: 'spot',
  me: 'me',
  sel: 'sel',
  fx: 'fx',
  pois: 'pois',
  pin: 'pin',
  moment: 'moment',
  particles: 'particles',
  invisible: 'invisible',
} as const;
const PERSON_SOURCES = [SRC.users, SRC.usersBoost, SRC.movers, SRC.spot];

/** camadas que contam como toque numa pessoa */
export const TAP_PERSON_LAYERS = ['cz-users', 'cz-users-photo', 'cz-users-boost', 'cz-users-boost-photo', 'cz-movers', 'cz-movers-photo', 'cz-spot', 'cz-spot-photo', 'cz-users-dot', 'cz-users-boost-dot', 'cz-movers-dot'];
/** marcador de gente invisível: o disco e os rótulos (o brilho em volta não conta) */
const TAP_INVISIBLE_LAYERS = ['cz-invisible', 'cz-invisible-label', 'cz-invisible-place-label'];
const TAP_LAYERS = [...TAP_PERSON_LAYERS, 'cz-poi', 'cz-cluster', 'cz-cluster-count', 'cz-pin', ...TAP_INVISIBLE_LAYERS];

const MAX_USERS = 300;
/** grupos (supercluster): mesmos raio e zoom máximo do antigo cluster nativo; acima de 21 ninguém se agrupa */
const CLUSTER_RADIUS = 70;
const CLUSTER_MAX_ZOOM = 21;
const WORLD_BBOX: GeoJSON.BBox = [-180, -85, 180, 85];
/** 'ready' de reserva: o MapLibre só avisa o fim do load com todos os tiles da tela carregados (OpenFreeMap sem SLA) */
const READY_FALLBACK_MS = 6000;
const HORIZON_THROTTLE_MS = 80;
/** fora do mapa por tanto tempo, o cache de paths do desenho (dividido com as miniaturas das listas) é solto */
const DRAW_CACHE_IDLE_MS = 30_000;
/**
 * teto de figuras próprias por tier (o resto usa a silhueta). Só quem aparece SOLTO na tela ganha figura (quem está num
 * grupo vira a bolinha do grupo): o teto segura a memória das imagens registradas no <Images> enquanto se passeia
 */
const FIG_CAP: Record<PerfTier, number> = { high: 60, mid: 45, low: 30 };
/** teto de figuras animando ao mesmo tempo (eu, selecionado e o match sempre animam); o resto desliza parado */
const ANIM_CAP: Record<PerfTier, number> = { high: 6, mid: 4, low: 2 };
/** abaixo deste zoom a figura é pequena demais pra passada ler: desliza parada (eu, selecionado e o match animam) */
const ANIM_MIN_ZOOM = 15;
/**
 * quadros de animação novos por segundo (cada um rasteriza o avatar inteiro, ~280 camadas, na thread JS): o resto da
 * passada espera o próximo segundo (a figura segura o último quadro). Eu, selecionado e o match não entram na conta
 */
const FRAME_RATE: Record<PerfTier, number> = { high: 12, mid: 8, low: 4 };
/**
 * prioridade dos quadros de animação na fila de imagens (menor roda antes): depois de toda figura parada, bolha e ícone
 * (estáticas usam 1 + distância em metros). Eu, o selecionado e o match: 0,5 (logo depois das estáticas deles)
 */
const FRAME_PRIORITY = 1e8;
/** quantas pessoas andam de verdade ao mesmo tempo (na tela); o resto chega direto no lugar novo */
const MOVE_CAP: Record<PerfTier, number> = { high: 40, mid: 25, low: 12 };
/** fps dos quadros: caminhada, corrida */
// quadros por segundo da passada (um ciclo = passo esquerdo + direito: ~1 s andando, ~0,7 s correndo)
const WALK_FPS: Record<PerfTier, number> = { high: 8, mid: 6, low: 5 };
const RUN_FPS: Record<PerfTier, number> = { high: 12, mid: 9, low: 7 };
/** fps do deslizar montado (um ciclo de balanço = ridePeriod) */
const RIDE_FPS: Record<PerfTier, number> = { high: 8, mid: 6, low: 5 };
/** animação assinatura: fps e teto de quadros por passada (dança longa cai de fps, não de duração) */
const SIG_FPS: Record<PerfTier, number> = { high: 12, mid: 10, low: 8 };
// cada quadro rasteriza o avatar inteiro na CPU (thread JS) e grava um PNG: teto baixo
const SIG_MAX_FRAMES: Record<PerfTier, number> = { high: 18, mid: 14, low: 10 };
/** toque + seleção da mesma pessoa chegam juntos: a assinatura não recomeça dentro dessa janela */
const SIG_RETAP_MS = 500;
/** fps dos anéis/sonar/auras (paint constante, sem relayout) */
const RING_FPS: Record<PerfTier, number> = { high: 20, mid: 15, low: 8 };
/**
 * Os anéis pulsam só por um tempo depois de algo novo (lugar em alta, seleção, pino, o mapa abriu ou parou de mexer) e
 * depois param num desenho fixo (RING_REST). Cada passo do pulso troca o paint e o MapLibre redesenha o mapa INTEIRO
 * (prédios 3D): com o pulso eterno o mapa parado gastava ~70% de um núcleo na thread de render dele.
 */
const RING_BURST_MS = 4000;
const PHOTO_MIN_ZOOM = 14;
/** abaixo disso as pessoas são pontos (layers.tsx FAR_ZOOM) */
const FAR_ZOOM = 13;
/** ritmos do relógio (ms) */
const FAST_MS = 33; // fades, bursts, queda do pino
/** quem anda (fonte movers): ~15/12/8 Hz — cada passo republica a fonte e o MapLibre refaz os tiles dela */
const MOVERS_MS: Record<PerfTier, number> = { high: 66, mid: 83, low: 125 };
const PARTICLES_MS = 100;
/**
 * republicar a fonte users (até 300 features, com os grupos) no máximo a cada 200 ms com pouca gente e 1 s com multidão:
 * cada envio = parse + re-tiling + relayout dos símbolos nos Workers do MapLibre, e figura/bolha pronta pode esperar
 */
const PUSH_GAP_MS = { few: 200, many: 500, crowd: 1000 } as const;
/** com muita gente andando, a fonte movers republica mais devagar (a 1,5–13 m/s o passo de 200 ms some no z16) */
const MOVERS_CROWD_MS = { some: 125, many: 200 } as const;
/** intervalo mínimo entre dois commits do React vindos do mapa (lote de canais): normal e com multidão andando */
const COMMIT_GAP_MS = { normal: 66, crowd: 125 } as const;
/**
 * Vagas de imagem: cada figura própria (e cada bolha de foto) ocupa um NOME fixo do <Images> (czf0… / czF0… / czb0…) e trocar
 * de pessoa é só trocar o arquivo daquele nome. No MapLibre, nome novo (o MLRN registra 1x1 e depois o bitmap, tamanho
 * diferente) ou removido = relayout de TODOS os tiles com símbolo, inclusive os rótulos do mapa base; mesmo nome e mesmo
 * tamanho só remenda o atlas. Com nomes por pessoa, cada figura que entrava ou saía do teto custava um relayout geral.
 */
type SlotKind = 'f' | 'F' | 'b' | 's';
/** f = figura, F = figura de boost, b = bolha de foto, s = silhueta colorida (dona = a chave da cor, não uma pessoa) */
const SLOT_KINDS = ['f', 'F', 'b', 's'] as const;
/** vagas por <Images> (uma troca reenvia só o grupo dela ao nativo) */
const SLOT_GROUP = 8;
/** vaga solta só volta a servir depois que as fontes já não apontam pra ela (republicação + parse no nativo) */
const SLOT_COOL_MS = 400;
/**
 * vaga que era de outra pessoa: espera a mais antes de apontar a feature (até o arquivo novo chegar, a vaga ainda mostra a
 * figura antiga; com nome por pessoa o pior caso era um instante transparente, aqui seria o boneco de outro)
 */
const SLOT_SETTLE_EXTRA_MS = 120;
/** vagas além do teto de figuras: quem entra na tela não espera as que acabaram de soltar esfriarem */
const SLOT_SLACK = 8;
/**
 * vaga da folga (além do teto do tier) parada há tanto tempo sai do <Images> e solta o bitmap; a limpeza roda no máximo a
 * cada SLOT_TRIM_MS (1 relayout por limpeza). Até o teto as vagas ficam: soltar e recriar a cada refetch seria relayout
 */
const SLOT_IDLE_MS = 60_000;
const SLOT_TRIM_MS = 10_000;
/** vagas de boost (imagem maior, rara) que ficam registradas paradas; acima disso as paradas saem como as da folga */
const SLOT_KEEP_BOOST = 20;
/**
 * silhueta de quem fica além do teto: roupa e tom de pele da pessoa numa paleta curta (compartilhada por muita gente; cada
 * variante é um nome no <Images>), no máximo SIL_TINT_MAX variantes coloridas (passou disso, a do visual sem cor)
 */
const SIL_BODY = ['#ECECF2', '#2B2B38', '#D8434F', '#F08A3A', '#EFCB45', '#5BB865', '#3B8DD8', '#9A68D8', '#E66BAE', '#8B6A4E'];
const SIL_SKIN = ['#F2CBA7', '#C68D60', '#76492A'];
const SIL_TINT_MAX = 24;
/** coordenadas com 6 casas (~11 cm): o JSON do double cru tinha 17 dígitos por eixo */
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
/** acima disso, quem sai some direto (cada passo do fade é uma chamada ao nativo por pessoa) */
const LEAVE_FADE_MAX = 15;
/** espera depois de registrar uma imagem nova antes de apontar a feature pra ela (o nativo decodifica assíncrono) */
const IMAGE_SETTLE_MS = 160;
/** custo estimado de cada imagem nova na fila do nativo: o patch do MLRN carrega num pool de 4 threads (o Fresco lê o
 *  disco com 2, então rende ~2x o serial de ~6 ms), mas numa rajada (boot, refetch com muita gente chegando) as últimas
 *  ainda demoram mais que IMAGE_SETTLE_MS */
const IMAGE_TASK_MS = 3;
/** teto da espera alargada: passou disso, aponta assim mesmo (no pior caso some um instante, como antes) */
const IMAGE_SETTLE_MAX_MS = 1200;
/** figura estática que falhou: novas tentativas (o store recusa a mesma chave por 5 s depois de uma falha) */
const STATIC_TRIES = 3;
const STATIC_RETRY_MS = 6000;
/** fim da animação: espera os quadros em voo chegarem antes de voltar pra estática (senão um quadro atrasado vence) */
const STATIC_GRACE_MS = 250;
/** versão do desenho: muda quando draw.ts mudar o visual (invalida o cache em disco) */
const RENDER_V = 'r1x' + IMG_SCALE;
/**
 * versão das FIGURAS: desenho do mapa (f2 = cabeça MAP_HEAD_SCALE, nível 'lite', silhueta nova) + versão do desenho do
 * avatar + impressão digital das camadas do avatar padrão (o cache se refaz quando as partes mudam). Lida na 1ª figura.
 */
let figV: string | null = null;
function figVersion(): string {
  if (figV == null) figV = `f2.${AVATAR_RENDER_VERSION}.${drawingStamp()}|${RENDER_V}`;
  return figV;
}
const DEG = Math.PI / 180;

type UsersIndex = Supercluster<GeoJSON.GeoJsonProperties, GeoJSON.GeoJsonProperties>;

/** zoom inteiro que o supercluster usa (floor, limitado a maxZoom+1 = sem grupo) */
function clusterZoomOf(zoom: number): number {
  return Math.max(0, Math.min(Math.floor(zoom), CLUSTER_MAX_ZOOM + 1));
}

interface FigUser {
  id: string;
  name: string;
  label: string;
  avatarKey: string;
  aura: string;
  isAnonymous: boolean;
  isBoosted: boolean;
  premiumTier: 'free' | 'premium' | 'premium_plus';
  isVerified: boolean;
  isOnline: boolean;
  photo: string | null;
  isNew: boolean;
  /** os dois se curtiram (anel magenta + selo ♥) */
  mutual: boolean;
  pos: LngLat;
}

interface Fig {
  id: string;
  user: FigUser | null;
  pos: LngLat | null;
  move: { from: LngLat; to: LngLat; start: number; dur: number; run: boolean } | null;
  /** animação que toca uma vez: estado, início (ms) e duração (s) */
  one: { name: EmoteState; start: number; dur: number } | null;
  mirror: boolean;
  v: PoseVariation;
  sz: number;
  /** tem figura própria (dentro do teto) */
  own: boolean;
  dim: Dim;
  staticKey: string | null;
  staticRef: MapImageRef | null;
  /** tentativas da figura estática que falharam (memória apertada, escrita): tenta de novo até STATIC_TRIES */
  staticTries: number;
  /** a imagem av-<id> já está registrada e a feature pode apontar pra ela */
  imgReady: boolean;
  /** espera antes de apontar a feature pra vaga; cancelada quando a vaga solta (a vaga seguinte tem a espera dela) */
  settling: Settle | null;
  frameKey: string | null;
  /** fim da animação: quando voltar pra estática */
  staticAt: number;
  leaving: number;
  moment: boolean;
  ph: { url: string; sig: string; ready: boolean; settling?: boolean } | null;
  /** relógio de parede (Date.now, o mesmo do mapPhotos.retryAt); o resto do motor usa o monotônico (monoNow) */
  phWait: number;
  /** fontes em que o feature-state 'a' ficou diferente de 1 (pra limpar quando a pessoa sai de vez) */
  alphaDirty: Set<string>;
  /** quadros de animação pedidos à fila e ainda não prontos (cancelados quando a animação acaba) */
  frameJobs: Set<string>;
  /** vaga do <Images> da figura e da bolha (czf0…, czF0…, czb0…; eu uso nomes fixos: av-me / ph-me) */
  slot: Slot | null;
  phSlot: Slot | null;
  /** chegou andando e ainda está na fonte movers até a próxima republicação da users (sem sumir no meio) */
  parked: boolean;
}

/** espera de assentamento de uma imagem (afterImages): o timer da vez ou o aviso do lote do <Images> que ela espera */
interface Settle {
  t: ReturnType<typeof setTimeout> | null;
  w: (() => void) | null;
}

/** vaga do <Images>: o nome fica registrado e só o arquivo troca (ver SLOT_GROUP) */
interface Slot {
  name: string;
  group: string;
  owner: string | null;
  /** solta: volta a servir a partir daqui (ms); Infinity = esperando a próxima republicação das fontes */
  freeAt: number;
}

/** números do motor pra medir (simulador, testes, log de __DEV__) */
export interface EngineStats {
  /** envios de cada fonte ao nativo (prop data do GeoJSONSource) e bytes do JSON */
  sends: Record<string, number>;
  bytes: Record<string, number>;
  /** commits do React vindos do mapa (lotes de canais) */
  commits: number;
  /** nomes registrados no <Images> agora */
  images: number;
  /** quem tem figura própria (fora eu) */
  own: string[];
  /** vagas criadas por tipo */
  slots: Record<SlotKind, number>;
  /** variantes de silhueta colorida registradas */
  tints: number;
}

interface AlphaTween {
  source: string;
  id: string;
  /** 'a' = figura/bolha/nome (entrada, saída, destaque); 'pa' = só a bolha de foto (fade quando chega) */
  key: 'a' | 'pa';
  from: number;
  to: number;
  start: number;
  dur: number;
  onDone?: () => void;
}

interface FxItem {
  id: string;
  at: LngLat;
  color: string;
  color2: string;
  start: number;
  dur: number;
}

interface Particle {
  a: number;
  r: number;
  sp: number;
  ph: number;
  k: number;
}

export interface EngineDeps {
  emit: (ev: MapEvent) => void;
  initTheme: MapTheme;
  initTier: InitTier;
}

function fc(features: Feature[]): FC {
  return { type: 'FeatureCollection', features };
}

function point(coords: LngLat, properties: Record<string, unknown>, id?: string | number): Feature {
  const f: Feature = { type: 'Feature', properties, geometry: { type: 'Point', coordinates: [r6(coords[0]), r6(coords[1])] } };
  if (id != null) f.id = id;
  return f;
}

function rgbOf(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})/i.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function nearest(hex: string, palette: string[]): number {
  const c = rgbOf(hex);
  if (!c) return 0;
  let best = 0;
  let bd = Infinity;
  palette.forEach((p, i) => {
    const q = rgbOf(p) as [number, number, number];
    const d = (c[0] - q[0]) ** 2 + (c[1] - q[1]) ** 2 + (c[2] - q[2]) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

/** cor da silhueta: casaco (se tiver) ou blusa, e o tom de pele, na paleta curta; null sem a config */
export function silTintOf(def: AvatarDef | null | undefined): { body: string; skin: string; id: string } | null {
  const c = def?.c;
  if (!c) return null;
  try {
    const outfit = c.outer && c.outer !== 'none' ? avatarColorHex('outerColor', c.outerColor) : avatarColorHex('topColor', c.topColor);
    const b = nearest(outfit, SIL_BODY);
    const s = nearest(avatarColorHex('skin', c.skin), SIL_SKIN);
    return { body: SIL_BODY[b], skin: SIL_SKIN[s], id: `${b}.${s}` };
  } catch {
    return null;
  }
}

function easeOutCubic(k: number): number {
  return 1 - Math.pow(1 - k, 3);
}

function bounceOut(t: number): number {
  const n = 7.5625;
  const d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) {
    t -= 1.5 / d;
    return n * t * t + 0.75;
  }
  if (t < 2.5 / d) {
    t -= 2.25 / d;
    return n * t * t + 0.9375;
  }
  t -= 2.625 / d;
  return n * t * t + 0.984375;
}

function sameRings(a: RingsState, b: RingsState): boolean {
  return (
    a.sonar[0] === b.sonar[0] &&
    a.sonar[1] === b.sonar[1] &&
    a.sonar[2] === b.sonar[2] &&
    a.aura === b.aura &&
    a.auraBoost === b.auraBoost &&
    a.me === b.me &&
    a.sel === b.sel &&
    a.spotAura === b.spotAura &&
    a.pin === b.pin
  );
}

export class MapEngine {
  readonly ch = new Channels<MapChannels>({
    users: EMPTY_JSON,
    usersBoost: EMPTY_JSON,
    movers: EMPTY_JSON,
    spot: EMPTY_JSON,
    me: EMPTY_JSON,
    sel: EMPTY_JSON,
    fx: EMPTY_JSON,
    pois: EMPTY_JSON,
    pin: EMPTY_JSON,
    moment: EMPTY_JSON,
    particles: EMPTY_JSON,
    invisible: EMPTY_JSON,
    images: {},
    phase: RING_REST,
    rings: NO_RINGS,
    look: { theme: 'day', tier: 'high' },
    buildingScale: 0,
    pinLook: { dy: -70, alpha: 0 },
    horizon: 0,
  });

  readonly camera: CameraCtl;
  private mapRef: RefObject<MapRef | null> | null = null;
  private camRef: RefObject<CameraRef | null> | null = null;
  /** refs das fontes GeoJSON por id (feature-state é por fonte) */
  private readonly sources = new Map<string, RefObject<GeoJSONSourceRef | null>>();
  /** feature-state em lote: uma chamada nativa por fonte a cada turno do JS */
  private readonly fstate = new FeatureStateQueue((id) => this.sources.get(id)?.current ?? null);
  /** índice dos grupos publicado agora e o anterior (um toque pode chegar com o quadro de antes da republicação) */
  private usersIndex: UsersIndex | null = null;
  private prevUsersIndex: UsersIndex | null = null;
  private clusterZoom = -1;
  /** o MLRN instalado não tem setFeatureState: o destaque esconde a figura de baixo tirando-a das fontes */
  private noFeatureState = false;
  private readyFallback: ReturnType<typeof setTimeout> | null = null;
  private horizonTimer: ReturnType<typeof setTimeout> | null = null;
  private lastHorizonAt = -Infinity;
  private width = 0;
  private height = 0;

  // ---------- estado (espelha o `state` do WebView) ----------
  private theme: MapTheme;
  private tier: PerfTier;
  private readonly initTier: InitTier;
  private active = true;
  private loaded = false;
  private styleLoaded = false;
  /** centro/zoom do último moveend: zoom por duplo toque não marca gesto no SDK, mas é movimento do usuário */
  private lastMoveEnd: { center: LngLat; zoom: number } | null = null;
  private ready = false;
  private queue: MapCommand[] = [];
  private located = false;
  private revealed = false;
  private me: MeState | null = null;
  /** últimos grupos de invisíveis recebidos (redesenha quando eu ando: o marcador perto de mim sai de baixo do avatar) */
  private invisibleGroups: InvisibleGroup[] | null = null;
  private users = new Map<string, FigUser>();
  private pois = new Map<number, POI>();
  private hotIds = new Set<number>();
  private hadData = false;
  private hotMin = 5;
  private selected: string | null = null;
  private momentUserId: string | null = null;
  private momentTimer: ReturnType<typeof setTimeout> | null = null;
  private momentSeq: ReturnType<typeof setTimeout>[] = [];
  private pin: PinPayload | null = null;
  private pinKey = '';
  private pinAnimStart = 0;
  private reduceMotion = false;

  private readonly figs = new Map<string, Fig>();
  private readonly leaving = new Map<string, FigUser>();
  private readonly defs = new Map<string, AvatarDef>();
  private readonly keyWaiters = new Map<string, Set<string>>();
  private readonly silReady = new Map<string, string>();
  private readonly silPending = new Map<string, string>();
  private readonly groups = new Map<string, Record<string, MapImageEntry>>();
  private readonly pools: Record<SlotKind, Slot[]> = { f: [], F: [], b: [], s: [] };
  private slotSeq = 0;
  private lastTrim = -Infinity;
  /** figuras/bolhas esperando vaga (todas esfriando): tentam de novo quando uma libera */
  private readonly slotWaiters = new Set<string>();
  private slotRetry: ReturnType<typeof setTimeout> | null = null;
  /** silhuetas coloridas vivas (chave -> vaga 's'); o nome da vaga entra no silReady quando o desenho fica pronto */
  private readonly tintPending = new Map<string, Slot>();
  /** cor da silhueta por visual (avatarKey) */
  private readonly tints = new Map<string, ReturnType<typeof silTintOf>>();
  /** JSON atual de cada fonte (o canal entrega ao GeoJSONSource; igual = não reenvia) */
  private readonly json = new Map<string, string>(Object.keys(SRC).map((k) => [k, EMPTY_JSON]));
  /** coleção atual das fontes que o motor relê (SRC_KEEP_FC) e a contagem de features de todas */
  private readonly fcs = new Map<SourceName, FC>();
  private readonly counts = new Map<SourceName, number>();
  private readonly sends: Record<string, number> = {};
  private readonly bytes: Record<string, number> = {};
  /** quem anda agora (contado a cada passada do relógio): define o ritmo da movers e dos commits */
  private walkers = 0;
  /** quando o lote prendeu (dedo no mapa): a caminhada para nesse instante e retoma dali ao soltar */
  private heldAt = 0;
  private imagesDirty = false;
  /** fim estimado (ms) da fila de imagens novas no nativo: alarga a espera antes de apontar a feature numa rajada */
  private imgQueueUntil = 0;
  /** geração das trocas no <Images>: a pedida (setImage), a publicada no canal e a que já saiu num lote pro nativo */
  private imgGen = 0;
  private imgSetGen = 0;
  private imgFlushedGen = 0;
  /** esperas de assentamento aguardando o lote preso do <Images> sair */
  private readonly imgWaiters = new Set<() => void>();

  private tweens: AlphaTween[] = [];
  /** último alfa aplicado por fonte|id|chave: um tween novo parte daqui e valores repetidos não vão pro nativo */
  private readonly lastAlpha = new Map<string, number>();
  private fx: FxItem[] = [];
  private fxSeq = 0;
  private particles: Particle[] = [];
  private anchors: LngLat[] = [];

  // ---------- relógio ----------
  private clockTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFast = 0;
  private lastFx = 0;
  private lastFigures = 0;
  private lastMovers = 0;
  private lastRings = 0;
  private lastParticles = 0;
  /** os anéis pulsam até aqui (ms); depois a fase vai pra RING_REST e o relógio dorme */
  private ringsUntil = 0;
  /** balde de quadros de animação novos (FRAME_RATE por segundo) */
  private frameTokens = 0;
  private frameTokensAt = -Infinity;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private pushDue = 0;
  private lastPushAt = -Infinity;
  private drawCacheTimer: ReturnType<typeof setTimeout> | null = null;
  private moveEndTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private spinning = false;

  private disposed = false;
  /** caminhos que a limpeza do disco não pode apagar: tudo o que está no <Images> e as estáticas guardadas nas figuras */
  private readonly livePaths = (): string[] => {
    const out: string[] = [];
    for (const g of this.groups.values()) for (const n in g) out.push(g[n].source.uri);
    for (const f of this.figs.values()) if (f.staticRef) out.push(f.staticRef.path);
    return out;
  };
  private unkeep: () => void;
  /** fila de imagens ociosa (nada a desenhar por IDLE_RELEASE_MS): solta paths do Skia e camadas montadas */
  private readonly releaseDrawCaches = (): void => {
    clearDrawCaches();
    clearMapAvatarCaches();
  };
  private unidle: () => void;

  constructor(private readonly deps: EngineDeps) {
    this.theme = deps.initTheme;
    this.initTier = deps.initTier;
    // já nasce no tier que o onMapLoaded vai usar ('mid' na 1ª abertura): o estilo e o fps não montam 'high' no boot
    this.tier = deps.initTier === 'auto' ? 'mid' : deps.initTier;
    this.ch.minGapMs = COMMIT_GAP_MS.normal;
    // queda do pino e explosão do curtir/match: animações curtas de um tiro, não esperam o intervalo dos commits
    this.ch.urgent.add('pinLook');
    this.ch.urgent.add('fx');
    // o anel de quem foi tocado também não espera; o spot (figura por cima) sai no mesmo lote, publicado no mesmo turno do
    // select. O spot não é urgente: com o selecionado andando ele republica a cada passo do relógio e furaria o intervalo
    this.ch.urgent.add('sel');
    // a névoa acompanha a inclinação mesmo com o dedo no mapa (só muda no gesto de pinça, nunca arrastando)
    this.ch.live.add('horizon');
    // a queda do pino (750 ms, um tiro só depois do voo) também: arrastando no meio dela o pino sumia até soltar
    this.ch.live.add('pinLook');
    // o lote que leva as trocas do <Images> ao nativo: a espera de assentamento conta a partir dele
    this.ch.subscribe('images', () => {
      this.imgFlushedGen = this.imgSetGen;
      if (!this.imgWaiters.size) return;
      const waiting = Array.from(this.imgWaiters);
      this.imgWaiters.clear();
      for (const fn of waiting) fn();
    });
    this.camera = new CameraCtl(() => this.camRef?.current ?? null);
    this.unkeep = mapImages.keep(this.livePaths);
    this.unidle = mapImages.onIdle(this.releaseDrawCaches);
    this.setLook({ theme: this.theme, tier: this.tier });
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        this.reduceMotion = v;
      })
      .catch(() => {});
  }

  // =====================================================================
  // Ligação com os componentes
  // =====================================================================
  /** refs (não valores): o <Map> do MLRN só monta a câmera e as fontes depois do 1º layout */
  attach(map: RefObject<MapRef | null> | null, camera: RefObject<CameraRef | null> | null): void {
    this.mapRef = map;
    this.camRef = camera;
    // efeito re-executado (Fast Refresh / StrictMode) depois de um dispose: o motor volta com o estado que tinha
    if (this.disposed && map) {
      this.disposed = false;
      this.unkeep = mapImages.keep(this.livePaths);
      this.unidle = mapImages.onIdle(this.releaseDrawCaches);
      if (this.pin && this.ch.get('pinLook').alpha === 0) this.ch.set('pinLook', { dy: 0, alpha: 1 });
      this.camera.flushPadding();
      if (this.ready && this.active) {
        this.startClock();
        this.scheduleIdleCam();
      }
      this.schedulePush(0);
    }
  }

  private get mapView(): MapRef | null {
    return this.mapRef?.current ?? null;
  }

  attachSource(id: string, ref: RefObject<GeoJSONSourceRef | null> | null): void {
    if (ref) this.sources.set(id, ref);
    else this.sources.delete(id);
  }

  setViewport(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  dispose(): void {
    if (this.momentUserId || this.momentTimer) this.clearMoment();
    this.disposed = true;
    this.unkeep();
    this.unidle();
    this.stopClock();
    this.stopIdleCam();
    this.camera.dispose();
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = null;
    if (this.moveEndTimer) clearTimeout(this.moveEndTimer);
    this.moveEndTimer = null;
    if (this.readyFallback) clearTimeout(this.readyFallback);
    this.readyFallback = null;
    if (this.horizonTimer) clearTimeout(this.horizonTimer);
    this.horizonTimer = null;
    for (const t of this.momentSeq) clearTimeout(t);
    this.momentSeq = [];
    if (this.slotRetry) clearTimeout(this.slotRetry);
    this.slotRetry = null;
  }

  private emit(ev: MapEvent): void {
    if (!this.disposed) this.deps.emit(ev);
  }

  /**
   * publica uma fonte GeoJSON: o JSON sai daqui uma vez (o GeoJSONSource do MLRN recebe a string e não serializa de novo)
   * e conteúdo igual ao último enviado não vai pro nativo (cada envio = parse + re-tiling + relayout nos Workers)
   */
  private publish(name: SourceName, fc: FC): void {
    const s = JSON.stringify(fc);
    if (this.json.get(name) === s) return;
    this.json.set(name, s);
    this.counts.set(name, fc.features.length);
    if (SRC_KEEP_FC.includes(name)) this.fcs.set(name, fc);
    this.sends[name] = (this.sends[name] ?? 0) + 1;
    this.bytes[name] = (this.bytes[name] ?? 0) + s.length;
    this.ch.set(name, s);
  }

  /** JSON atual da fonte (o entregue ao <GeoJSONSource> é ch.view(nome): com o dedo no mapa ele espera o fim do gesto) */
  sourceData(name: SourceName): string {
    return this.json.get(name) ?? EMPTY_JSON;
  }

  /** features atuais de uma fonte (testes e diagnóstico) */
  features(name: SourceName): Feature[] {
    return this.fcs.get(name)?.features ?? (JSON.parse(this.sourceData(name)) as FC).features;
  }

  private countOf(name: SourceName): number {
    return this.counts.get(name) ?? 0;
  }

  stats(): EngineStats {
    let images = 0;
    for (const g of this.groups.values()) images += Object.keys(g).length;
    const own: string[] = [];
    for (const [id, f] of this.figs) if (f.own && id !== 'me') own.push(id);
    let tints = 0;
    for (const k of this.silReady.keys()) if (k.startsWith('silc|')) tints++;
    return {
      sends: { ...this.sends },
      bytes: { ...this.bytes },
      commits: this.ch.flushes,
      images,
      own,
      slots: { f: this.pools.f.length, F: this.pools.F.length, b: this.pools.b.length, s: this.pools.s.length },
      tints,
    };
  }

  // ---------- vagas do <Images> ----------
  /** teto de vagas por tipo: o teto de figuras do tier + folga (as vagas nascem sob demanda; 40 de boost na tela cabem) */
  private slotMax(kind: SlotKind): number {
    return kind === 's' ? SIL_TINT_MAX : (FIG_CAP[this.tier] ?? FIG_CAP.mid) + SLOT_SLACK;
  }

  /** pega uma vaga livre (a que soltou há mais tempo) ou cria uma, até slotMax; null = todas ocupadas ou esfriando */
  private acquire(kind: SlotKind, owner: string): Slot | null {
    const now = monoNow();
    const pool = this.pools[kind];
    let best: Slot | null = null;
    for (const s of pool) if (s.owner == null && s.freeAt <= now && (!best || s.freeAt < best.freeAt)) best = s;
    // eu, selecionado e o match não esperam vaga esfriar (o toque responde na hora): passam do teto, a limpeza devolve
    if (!best && (pool.length < this.slotMax(kind) || this.isPinned(owner))) {
      const i = this.slotSeq++;
      // prefixo próprio: nome igual a um ícone do sprite do mapa base faria o MLRN pular o registro
      best = { name: kind === 's' ? `silc-${i}` : `cz${kind}${i}`, group: `img-${kind}${Math.floor(i / SLOT_GROUP)}`, owner: null, freeAt: 0 };
      pool.push(best);
    }
    if (!best) {
      this.slotWaiters.add(owner);
      this.scheduleSlotRetry();
      return null;
    }
    best.owner = owner;
    return best;
  }

  /** solta a vaga: a imagem continua registrada (nada de relayout) e a vaga esfria até as fontes pararem de apontar */
  private release(s: Slot | null): void {
    if (!s || s.owner == null) return;
    s.owner = null;
    s.freeAt = Infinity;
    // garante a republicação que tira a feature de cima da vaga (conteúdo igual não vai pro nativo)
    this.schedulePush(0);
  }

  /** depois de uma republicação das fontes: as vagas soltas começam a esfriar; as paradas há muito tempo saem */
  private coolSlots(): void {
    const now = monoNow();
    const at = now + SLOT_COOL_MS;
    // com o lote preso (dedo no mapa) a republicação sem a referência não foi ao nativo: esfria no 1º push depois de soltar
    if (!this.ch.isHeld) for (const kind of SLOT_KINDS) for (const s of this.pools[kind]) if (s.owner == null && s.freeAt === Infinity) s.freeAt = at;
    if (this.slotWaiters.size) this.scheduleSlotRetry();
    if (now - this.lastTrim < SLOT_TRIM_MS) return;
    this.lastTrim = now;
    // solta o bitmap das vagas da folga paradas (e de tudo acima do teto, se o tier caiu), todas de uma vez: um relayout só
    for (const kind of SLOT_KINDS) {
      const pool = this.pools[kind];
      let spare = pool.length - (kind === 'F' ? SLOT_KEEP_BOOST : this.slotMax(kind) - SLOT_SLACK);
      if (spare <= 0) continue;
      const idle = pool.filter((sl) => sl.owner == null && now - sl.freeAt > SLOT_IDLE_MS).sort((a, b) => a.freeAt - b.freeAt);
      const drop = new Set<Slot>();
      for (const sl of idle) {
        if (spare-- <= 0) break;
        drop.add(sl);
        this.dropImage(sl.group, sl.name);
      }
      if (drop.size) this.pools[kind] = pool.filter((sl) => !drop.has(sl));
    }
  }

  /** tira um nome do <Images> (o grupo vazio desmonta) */
  private dropImage(group: string, name: string): void {
    const cur = this.groups.get(group);
    if (!cur || !cur[name]) return;
    const next = { ...cur };
    delete next[name];
    if (Object.keys(next).length) this.groups.set(group, next);
    else this.groups.delete(group);
    this.markImagesDirty();
  }

  private scheduleSlotRetry(): void {
    if (this.slotRetry || this.disposed) return;
    let soon = Infinity;
    const now = monoNow();
    // só as que ainda esfriam (uma já livre é de outro tipo: com ela o retry rodava a cada 10 ms até a da vez esfriar)
    for (const kind of SLOT_KINDS) for (const s of this.pools[kind]) if (s.owner == null && s.freeAt > now && s.freeAt < soon) soon = s.freeAt;
    if (!Number.isFinite(soon)) return; // só vagas esperando republicação: o coolSlots chama de novo
    this.slotRetry = setTimeout(() => {
      this.slotRetry = null;
      const ids = Array.from(this.slotWaiters);
      this.slotWaiters.clear();
      let tints = false;
      for (const id of ids) {
        if (id.startsWith('silc|')) {
          tints = true; // silhueta colorida esperando vaga: o rebalance pede de novo, do centro pra fora
          continue;
        }
        const f = this.figs.get(id);
        if (!f?.own || !f.user) continue;
        if (!f.imgReady) {
          if (f.staticRef && !f.frameKey) this.showFig(f, f.staticRef);
          else this.wantStatic(f);
        }
        if (f.ph && !f.ph.ready) {
          f.ph.sig = '';
          this.renderBubble(f);
        }
      }
      if (tints && !this.camera.gestureActive) this.rebalanceOwn(); // no meio do gesto fica pro moveEnded
    }, Math.max(0, soon - monoNow()) + 10);
  }

  /** nome/grupo da imagem da figura (eu: fixo; os outros: a vaga) */
  private figTarget(f: Fig): { group: string; name: string } | null {
    if (f.id === 'me') return { group: 'p:me', name: 'av-me' };
    return f.slot;
  }

  private setLook(patch: Partial<MapLook>): void {
    const cur = this.ch.get('look');
    if ((patch.theme ?? cur.theme) === cur.theme && (patch.tier ?? cur.tier) === cur.tier) return;
    this.ch.set('look', { ...cur, ...patch });
  }

  private setRings(patch: Partial<RingsState>): void {
    const cur = this.ch.get('rings');
    const next = { ...cur, ...patch };
    if (sameRings(cur, next)) return;
    this.ch.set('rings', next);
    this.pulseRings();
  }

  /** os anéis pulsam por RING_BURST_MS e param (com movimento reduzido, nem começam: ficam no desenho fixo) */
  private pulseRings(): void {
    if (this.reduceMotion) return;
    this.ringsUntil = Math.max(this.ringsUntil, monoNow() + RING_BURST_MS);
    this.startClock();
  }

  private ringsActive(): boolean {
    const r = this.ch.get('rings');
    return r.sonar[0] || r.sonar[1] || r.sonar[2] || r.aura || r.auraBoost || r.me || r.sel || r.spotAura != null || r.pin != null;
  }

  // =====================================================================
  // Eventos do <Map>
  // =====================================================================
  onStyleLoaded(): void {
    this.styleLoaded = true;
    this.emit({ type: 'styleLoaded' });
    // o onDidFinishLoadingMap espera todos os tiles da tela: um tile que não vem (rede ruim, servidor fora) seguraria o
    // mapa sem 'ready' pra sempre; o motor não depende de tile nenhum
    if (!this.loaded && !this.readyFallback) {
      this.readyFallback = setTimeout(() => {
        this.readyFallback = null;
        this.onMapLoaded();
      }, READY_FALLBACK_MS);
    }
  }

  onMapLoaded(): void {
    if (this.loaded || this.disposed) return;
    if (this.readyFallback) clearTimeout(this.readyFallback);
    this.readyFallback = null;
    this.loaded = true;
    this.registerBaseImages();
    // prédios crescendo: o MapLibre não tem vertical-scale e altura por feature não interpola; 4 degraus de 150 ms
    // (o BaseTheme arredonda a altura em 0,25 e faz o fade de opacidade no 1º degrau)
    for (let i = 1; i <= 4; i++) setTimeout(() => this.ch.set('buildingScale', i / 4), (i - 1) * 150);
    // Sem a medição de boot do WebView (giro de +8° contando frames): no boot a thread JS está ocupada desenhando as
    // figuras, os eventos de frame chegam atrasados e o fps sai subestimado. O mapa nasce no tier salvo (ou 'mid' na
    // 1ª abertura) e a tela promove/rebaixa pelas amostras de 'perf', colhidas com a câmera em movimento.
    this.tier = this.initTier === 'auto' ? 'mid' : this.initTier;
    this.applyTierEffects();
    this.ready = true;
    this.emit({ type: 'ready', tier: this.tier, fps: 0 });
    const q = this.queue;
    this.queue = [];
    for (const c of q) this.exec(c);
    this.startClock();
    this.scheduleIdleCam();
  }

  /** onDidFailLoadingMap: só é fatal se nem o estilo carregou (erro depois disso não tira o mapa da tela) */
  onLoadError(): void {
    if (!this.styleLoaded && !this.loaded) this.emit({ type: 'error', message: 'o mapa não carregou (sem internet?)', fatal: true });
    else if (__DEV__) console.warn('[map] erro de carregamento (não fatal)'); // eslint-disable-line no-console
  }

  /**
   * onRegionWillChange / onRegionIsChanging. Gesto = userInteraction && !animated: no MLRN Android o userInteraction
   * também vem true nas animações nossas (motivo DEVELOPER_ANIMATION), que chegam com animated true; o duplo toque
   * (API_ANIMATION) vem com os dois ao contrário e cai na regra de distância do moveend.
   */
  onRegionChange(e: ViewStateChangeEvent): void {
    if (!this.updateCamera(e, Boolean(e.userInteraction) && !e.animated)) return;
    // 'moveend' = 250 ms sem a câmera mexer. O onRegionDidChange não serve sozinho: um dedo parado no meio do gesto não
    // gera idle, e o fim das animações nossas é estimado por timer
    if (this.moveEndTimer) clearTimeout(this.moveEndTimer);
    this.moveEndTimer = setTimeout(() => this.moveEnded(), 250);
  }

  /**
   * onRegionDidChange (câmera ociosa: gesto e fling acabaram): o padding pendente entra (era o onMapIdle) e sai a amostra
   * de fps. `renderFps` vem do patch do MLRN: quadros que a GL do mapa desenhou com a câmera andando, contados no nativo
   * (mediana do intervalo). Os eventos de câmera não servem: no arraste eles vêm dos toques, então davam 60 em qualquer
   * aparelho e o tier nunca rebaixava
   */
  onRegionDidChange(e: ViewStateChangeEvent & { renderFps?: number }): void {
    this.updateCamera(e, false);
    this.camera.flushPadding();
    const fps = e?.renderFps;
    if (this.active && typeof fps === 'number' && Number.isFinite(fps) && fps > 0) this.emit({ type: 'perf', fps: Math.min(60, Math.round(fps)) });
  }

  private moveEnded(): void {
    this.moveEndTimer = null;
    if (this.disposed) return;
    // 250 ms sem mexer: se o payload não trouxe o fim do gesto (dedo parado), não segura o padding pra sempre
    this.camera.gestureActive = false;
    this.updateCommitGap();
    this.camera.flushPadding();
    const s = this.camera.state;
    let userMoved = this.camera.takeGesture();
    const animated = this.camera.takeAnimated();
    const prev = this.lastMoveEnd;
    if (!userMoved && !animated && this.camera.programmatic === 0 && prev && (Math.abs(prev.zoom - s.zoom) > 0.05 || distM(prev.center, s.center) > 15)) userMoved = true;
    this.lastMoveEnd = { center: s.center, zoom: s.zoom };
    if (this.located) this.emit({ type: 'moveend', lat: s.center[1], lng: s.center[0], zoom: s.zoom, userMoved });
    // o que entrou na tela ganha figura própria (e quem ficou longe solta a dele, se passou do teto)
    this.rebalanceOwn();
    this.updateLod();
    // olhou outro pedaço do mapa: o sonar dos lugares em alta pulsa um pouco ali
    this.pulseRings();
  }

  /** atualiza o estado da câmera; false se o payload não serve. bounds do MLRN: [oeste, sul, leste, norte] */
  private updateCamera(e: ViewStateChangeEvent, gesture: boolean): boolean {
    if (!e || !isFiniteLngLat(e.center) || !Number.isFinite(e.zoom)) return false;
    const was = this.camera.gestureActive;
    const b = e.bounds;
    const bounds = Array.isArray(b) && b.length === 4 && b.every(Number.isFinite) ? { ne: [b[2], b[3]] as LngLat, sw: [b[0], b[1]] as LngLat } : this.camera.state.bounds;
    const cam: CamState = { center: e.center as LngLat, zoom: e.zoom, bearing: e.bearing, pitch: e.pitch, bounds };
    this.camera.onCameraChanged(cam, gesture);
    // como no original, um gesto desliga o giro automático até o próximo reveal/setPin/setActive
    if (gesture && !was) this.stopIdleCam();
    if (this.camera.gestureActive !== was) this.updateCommitGap();
    // grupos mudam no zoom inteiro (igual ao cluster por tile do nativo); quem se soltou de um grupo ganha figura
    if (this.usersIndex && clusterZoomOf(cam.zoom) !== this.clusterZoom) {
      this.publishClusters();
      // no meio da pinça não registra dezenas de imagens a cada zoom inteiro: o moveEnded (250 ms parado) rebalanceia
      if (!this.camera.gestureActive) this.rebalanceOwn();
    }
    this.updateHorizon(cam.pitch);
    return true;
  }

  /** névoa do horizonte proporcional ao pitch, com throttle (a última mudança sempre entra) */
  private updateHorizon(pitch: number): void {
    const q = Math.round(Math.min(1, Math.max(0, pitch / MAX_PITCH)) * 20) / 20;
    if (q === this.ch.get('horizon')) return;
    const wait = this.lastHorizonAt + HORIZON_THROTTLE_MS - monoNow();
    if (wait > 0) {
      if (!this.horizonTimer) {
        this.horizonTimer = setTimeout(() => {
          this.horizonTimer = null;
          this.updateHorizon(this.camera.state.pitch);
        }, wait);
      }
      return;
    }
    this.lastHorizonAt = monoNow();
    this.ch.set('horizon', q);
  }

  /** toque no mapa: uma consulta só, com prioridade pino > pessoa > grupo > lugar > invisíveis > mapa vazio */
  async onPress(screenX: number, screenY: number): Promise<void> {
    const mv = this.mapView;
    if (!mv || !this.ready) return;
    const r = 10;
    let hits: Feature[] = [];
    try {
      // retângulo em dp, [[esquerda, topo], [direita, baixo]] (o nativo multiplica pela densidade)
      const res = await mv.queryRenderedFeatures(
        [
          [screenX - r, screenY - r],
          [screenX + r, screenY + r],
        ],
        { layers: TAP_LAYERS },
      );
      hits = Array.isArray(res) ? res : [];
    } catch {
      hits = [];
    }
    const props = (f: Feature) => (f.properties ?? {}) as Record<string, unknown>;
    const pin = hits.find((f) => 'pulse' in props(f));
    if (pin) {
      this.emit({ type: 'pinTap', id: String(props(pin).id ?? '') });
      return;
    }
    const person = hits.find((f) => 'sz' in props(f) && typeof props(f).id === 'string');
    if (person) {
      const uid = String(props(person).id);
      this.emote(uid, 'sig');
      this.emit({ type: 'userTap', id: uid });
      return;
    }
    const cluster = hits.find((f) => props(f).cluster === true || props(f).point_count != null);
    if (cluster) {
      this.onClusterTap(cluster);
      return;
    }
    const poi = hits.find((f) => 'sonar' in props(f));
    if (poi) {
      const id = Number(props(poi).id);
      if (Number.isFinite(id)) this.emit({ type: 'poiTap', id });
      return;
    }
    // gente invisível: nunca abre cartão de pessoa; a tela só diz quantos (e o lugar, que é público)
    const ghost = hits.find((f) => 'inv' in props(f));
    if (ghost) {
      const p = props(ghost);
      const count = Number(p.inv);
      if (Number.isFinite(count) && count > 0) this.emit({ type: 'invisibleTap', count, place: typeof p.place === 'string' ? p.place : null });
      return;
    }
    this.emit({ type: 'mapTap' });
  }

  /** toque num grupo: zoom de expansão e folhas saem do supercluster (sem chamada nativa) */
  private onClusterTap(f: Feature): void {
    const p = (f.properties ?? {}) as Record<string, unknown>;
    const clusterId = Number(p.cluster_id);
    if (f.geometry.type !== 'Point' || !Number.isFinite(clusterId)) return;
    const coords = f.geometry.coordinates as LngLat;
    const index = this.indexOfCluster(clusterId, Number(p.point_count));
    if (!index) return;
    try {
      const zoom = index.getClusterExpansionZoom(clusterId);
      if (zoom > CLUSTER_MAX_ZOOM || this.camera.state.zoom >= 20.5) {
        // todo mundo no mesmo lugar (ex.: dentro do bar): abre o painel com quem está ali
        const ids = index
          .getLeaves(clusterId, 100, 0)
          .map((l) => String(l.properties?.id ?? ''))
          .filter(Boolean);
        if (ids.length) this.emit({ type: 'clusterTap', ids, lat: coords[1], lng: coords[0] });
        return;
      }
      this.camera.move({ center: coords, zoom: Math.min(zoom + 0.3, 21.5), duration: 650, mode: 'easeTo' });
    } catch {
      /* grupo de um índice que já trocou: ignora o toque */
    }
  }

  /** o índice que gerou esse grupo: o atual ou o anterior (confere pela contagem; o id do supercluster é posicional) */
  private indexOfCluster(clusterId: number, count: number): UsersIndex | null {
    for (const index of [this.usersIndex, this.prevUsersIndex]) {
      if (!index) continue;
      try {
        if (index.getLeaves(clusterId, Infinity).length === count) return index;
      } catch {
        /* id não existe nesse índice */
      }
    }
    return null;
  }

  // =====================================================================
  // Comandos (mesmos nomes do WebView)
  // =====================================================================
  run(c: MapCommand): void {
    if (!this.ready) {
      // antes do 'ready' os comandos ficam na fila e são reaplicados em ordem (igual ao HTML)
      this.queue.push(c);
      return;
    }
    this.exec(c);
  }

  private exec(c: MapCommand): void {
    try {
      switch (c.fn) {
        case 'setTheme':
          return this.setTheme(c.args[0]);
        case 'setTier':
          return this.setTier(c.args[0]);
        case 'setActive':
          return this.setActive(c.args[0]);
        case 'setMe':
          return this.setMe(c.args[0]);
        case 'setCenter':
          return this.setCenter(c.args[0], c.args[1], c.args[2], c.args[3]);
        case 'reveal':
          return this.reveal(c.args[0], c.args[1]);
        case 'setData':
          return this.setData(c.args[0]);
        case 'select':
          return this.select(c.args[0]);
        case 'focusPoi':
          return this.focusPoi(c.args[0]);
        case 'setPadding':
          return this.setPadding(c.args[0]);
        case 'burst':
          return this.burst(c.args[0]);
        case 'defineAvatars':
          return this.defineAvatars(c.args[0]);
        case 'matchMoment':
          return this.matchMoment(c.args[0]);
        case 'emote':
          return this.emote(c.args[0], c.args[1]);
        case 'setPin':
          return this.setPin(c.args[0], c.args[1]);
        case 'setInvisible':
          return this.setInvisible(c.args[0]);
        default:
          return;
      }
    } catch (e) {
      this.emit({ type: 'error', message: `${c.fn}: ${e instanceof Error ? e.message : String(e)}`, fatal: false });
    }
  }

  setTheme(theme: MapTheme): void {
    if (theme !== 'day' && theme !== 'dusk' && theme !== 'night') theme = 'day';
    this.theme = theme;
    this.setLook({ theme });
  }

  setTier(tier: PerfTier): void {
    if (tier !== 'low' && tier !== 'mid' && tier !== 'high') return;
    this.tier = tier;
    this.applyTierEffects();
  }

  private applyTierEffects(): void {
    this.setLook({ tier: this.tier });
    if (this.tier !== 'high') {
      this.stopIdleCam();
      if (this.countOf('particles')) this.publish('particles', EMPTY_FC);
    }
    this.startClock();
  }

  setActive(active: boolean): void {
    this.active = Boolean(active);
    if (this.active) {
      if (this.drawCacheTimer) clearTimeout(this.drawCacheTimer);
      this.drawCacheTimer = null;
      this.pulseRings();
      this.startClock();
      this.scheduleIdleCam();
    } else {
      this.stopClock();
      this.stopIdleCam();
      this.updateCommitGap();
      if (this.countOf('particles')) this.publish('particles', EMPTY_FC);
      // fora do mapa: solta os paths e cores do Skia de CPU (refaz sob demanda). App no fundo: na hora (os timers param
      // lá). Outra aba: depois de DRAW_CACHE_IDLE_MS — as miniaturas de Curtidas e Mensagens usam o mesmo cache
      if (AppState.currentState === 'background' || AppState.currentState === 'inactive') this.releaseDrawCaches();
      else if (!this.drawCacheTimer) {
        this.drawCacheTimer = setTimeout(() => {
          this.drawCacheTimer = null;
          this.releaseDrawCaches();
        }, DRAW_CACHE_IDLE_MS);
      }
    }
  }

  setCenter(lat: number, lng: number, zoom?: number, opts?: CameraOpts): void {
    const o = opts ?? {};
    const s = this.camera.state;
    this.camera.move({
      center: [lng, lat],
      zoom: typeof zoom === 'number' ? zoom : s.zoom,
      pitch: typeof o.pitch === 'number' ? o.pitch : s.pitch,
      bearing: typeof o.bearing === 'number' ? o.bearing : s.bearing,
      duration: typeof o.duration === 'number' ? o.duration : 900,
      mode: 'easeTo',
    });
  }

  reveal(lat: number, lng: number): void {
    this.revealed = true;
    this.stopIdleCam();
    this.camera.move({ center: [lng, lat], zoom: 13.5, pitch: 0, bearing: 0, duration: 0, mode: 'none' });
    setTimeout(() => {
      if (this.disposed) return;
      this.camera.move({ center: [lng, lat], zoom: 16, pitch: 58, bearing: -12, duration: 1800, mode: 'flyTo' }, (done) => done && this.scheduleIdleCam());
    }, 60);
  }

  focusPoi(id: number): void {
    const p = this.pois.get(id);
    if (!p) return;
    const s = this.camera.state;
    const bearing = s.bearing + 25;
    // era pitch 65; o MapLibre Android para em 60 e o deslocamento do centro sai com o mesmo pitch
    this.camera.move({ center: offsetCenter([p.longitude, p.latitude], 40, 17, bearing, MAX_PITCH), zoom: 17, pitch: MAX_PITCH, bearing, duration: 900, mode: 'easeTo' });
  }

  setPadding(pad: MapPadding): void {
    this.camera.setPadding({ ...pad });
  }

  // =====================================================================
  // Imagens
  // =====================================================================
  private setImage(group: string, name: string, ref: MapImageRef, fresh = false): void {
    const cur = this.groups.get(group);
    const uri = ref.path;
    if (cur && cur[name] && cur[name].source.uri === uri) return;
    // nome novo ou vaga que trocou de dono (troca de quadro não conta: o nativo mantém a imagem antiga até a nova chegar)
    // entra no fim da fila estimada
    if (fresh || !cur?.[name]) this.imgQueueUntil = Math.max(this.imgQueueUntil, monoNow()) + IMAGE_TASK_MS;
    this.groups.set(group, { ...(cur ?? {}), [name]: { source: { uri, scale: ref.scale } } });
    this.markImagesDirty();
  }

  /** espera antes de apontar a feature pra uma imagem recém-registrada: a base + o que a fila estimada ainda tem pela frente */
  private settleMs(): number {
    // + a espera do lote de canais: o <Images> só recebe a troca no próximo commit do mapa
    return Math.min(IMAGE_SETTLE_MAX_MS, IMAGE_SETTLE_MS + this.ch.pendingMs() + Math.max(0, this.imgQueueUntil - monoNow()));
  }

  /**
   * roda `fn` quando a troca de imagem que acabou de ser pedida já teve tempo de chegar no nativo: settleMs() depois e, se o
   * lote do <Images> ainda não saiu (dedo no mapa), IMAGE_SETTLE_MS depois de ele sair. Sem isso o lote preso soltava a
   * vaga trocada e a feature apontando pra ela no MESMO commit (o boneco da dona anterior aparecia um instante)
   */
  private afterImages(extra: number, fn: () => void): Settle {
    const gen = this.imgGen;
    const s: Settle = { t: null, w: null };
    // roda mesmo com o motor descartado: cada `fn` zera o próprio settling e confere alive/disposed (sem isso um
    // dispose() + attach() no meio da espera deixava a figura na silhueta e a bolha sumida de vez)
    const arm = (ms: number, next: () => void) => {
      s.t = setTimeout(() => {
        s.t = null;
        next();
      }, ms);
    };
    const waitFlush = () => {
      s.w = null;
      if (this.imgFlushedGen >= gen) arm(IMAGE_SETTLE_MS + extra, fn);
      else this.imgWaiters.add((s.w = waitFlush));
    };
    arm(this.settleMs() + extra, () => (this.imgFlushedGen >= gen ? fn() : waitFlush()));
    return s;
  }

  private cancelSettle(s: Settle | null): void {
    if (!s) return;
    if (s.t) clearTimeout(s.t);
    if (s.w) this.imgWaiters.delete(s.w);
    s.t = null;
    s.w = null;
  }

  private dropGroup(group: string): void {
    if (!this.groups.delete(group)) return;
    this.markImagesDirty();
  }

  private markImagesDirty(): void {
    this.imgGen++;
    if (this.imagesDirty) return;
    this.imagesDirty = true;
    // junta várias trocas do mesmo tick num commit só
    void Promise.resolve().then(() => {
      this.imagesDirty = false;
      const out: ImageGroups = {};
      for (const [k, v] of this.groups) out[k] = v;
      this.imgSetGen = this.imgGen;
      this.ch.set('images', out);
    });
  }

  /** pede uma imagem estática compartilhada (cache em disco por chave) e registra no grupo quando pronta */
  private requestShared(group: string, name: string, key: string, render: () => Uint8Array | null, priority = 0, stillWanted?: () => boolean): void {
    const hit = mapImages.get(key);
    if (hit) {
      this.setImage(group, name, hit);
      return;
    }
    mapImages
      .request(key, priority, render, IMG_SCALE)
      .then((ref) => {
        if (ref && !this.disposed && (!stillWanted || stillWanted())) this.setImage(group, name, ref);
      })
      .catch(() => {});
  }

  private registerBaseImages(): void {
    const P = (k: string) => `${k}|${RENDER_V}`;
    this.requestShared('base', GENERIC_FIG, `fig-generic|${figVersion()}`, () => mapDraw.figure(null, { recent: true, boosted: false, premiumTier: 'free', verified: false, aura: '', anonymous: false }, IMG.fig, null, false), -2);
    this.requestShared('base', 'people-icon', P('people-icon'), () => mapDraw.peopleIcon(), -1);
    this.requestShared('base', 'me-cone', P('me-cone'), () => mapDraw.meCone(), -1);
    // partes paradas do que pulsa (o anel que cresce é CircleLayer)
    this.requestShared('base', 'glow-sonar', P('glow-sonar'), () => mapDraw.glow(IMG.sonar, '255,20,147', 0.28, (IMG.sonar / 2 - 2) * 0.7));
    this.requestShared('base', 'glow-me', P('glow-me'), () => mapDraw.glow(IMG.ring, '127,255,0', 0.35, 22));
    this.requestShared('base', 'glow-pin-n', P('glow-pin-n'), () => mapDraw.glow(IMG.sonar, '255,20,147', 0.45, 26));
    this.requestShared('base', 'glow-pin-d', P('glow-pin-d'), () => mapDraw.glow(IMG.sonar, '127,255,0', 0.45, 26));
  }

  // =====================================================================
  // Figuras
  // =====================================================================
  private figOf(id: string): Fig {
    let f = this.figs.get(id);
    if (!f) {
      f = {
        id,
        user: null,
        pos: null,
        move: null,
        one: null,
        mirror: false,
        v: variationFor(id),
        sz: sizeFor(id),
        own: false,
        dim: IMG.fig,
        staticKey: null,
        staticRef: null,
        staticTries: 0,
        imgReady: false,
        settling: null,
        frameKey: null,
        staticAt: 0,
        leaving: 0,
        moment: false,
        ph: null,
        phWait: 0,
        alphaDirty: new Set(),
        frameJobs: new Set(),
        slot: null,
        phSlot: null,
        parked: false,
      };
      this.figs.set(id, f);
    }
    return f;
  }

  /** a pessoa está na tela (com 10% de margem) */
  private inView(f: Fig): boolean {
    return Boolean(f.pos && inBounds(f.pos, this.camera.state.bounds, 0.1));
  }

  /** a figura ainda é a registrada (não saiu do mapa nem virou silhueta no meio de uma tarefa assíncrona) */
  private alive(f: Fig): boolean {
    return !this.disposed && this.figs.get(f.id) === f && f.own;
  }

  private lookOf(u: FigUser): FigureLook {
    return { recent: u.isOnline, boosted: u.isBoosted, premiumTier: u.premiumTier, verified: u.isVerified, aura: u.aura || '', anonymous: u.isAnonymous };
  }

  private lookSig(l: FigureLook): string {
    return [l.recent ? 1 : 0, l.boosted ? 1 : 0, l.premiumTier, l.verified ? 1 : 0, l.aura, l.anonymous ? 1 : 0].join('.');
  }

  private imgName(f: Fig): string {
    return this.figTarget(f)?.name ?? GENERIC_FIG;
  }

  /** prioridade de desenho: eu, selecionado e o match primeiro; depois quem está mais perto do centro */
  private priorityOf(f: Fig): number {
    if (this.isPinned(f.id)) return 0;
    if (!f.pos) return 1e7;
    return 1 + distM(f.pos, this.camera.state.center);
  }

  /** garante a figura estática (pose neutra) da pessoa; enquanto não fica pronta, a feature usa a silhueta */
  private wantStatic(f: Fig): void {
    const u = f.user;
    if (!u || !f.own) return;
    const def = u.avatarKey ? this.defs.get(u.avatarKey) : undefined;
    if (u.avatarKey && !def) {
      let w = this.keyWaiters.get(u.avatarKey);
      if (!w) {
        w = new Set();
        this.keyWaiters.set(u.avatarKey, w);
      }
      w.add(f.id);
      return;
    }
    const look = this.lookOf(u);
    const key = `fig|${u.avatarKey || 'sil'}|${this.lookSig(look)}|${f.dim.w}x${f.dim.h}|n|${f.mirror ? 1 : 0}|${figVersion()}`;
    if (f.staticKey === key && f.staticRef) {
      if (!f.frameKey) this.showFig(f, f.staticRef);
      return;
    }
    if (f.staticKey !== key) f.staticTries = 0;
    f.staticKey = key;
    f.staticRef = null;
    const hit = mapImages.get(key);
    if (hit) {
      f.staticRef = hit;
      if (!f.frameKey) this.showFig(f, hit);
      return;
    }
    const dim = f.dim;
    const mirror = f.mirror;
    mapImages
      .request(key, this.priorityOf(f), () => mapDraw.figure(def ?? null, look, dim, null, mirror), IMG_SCALE)
      .then((ref) => {
        if (!this.alive(f) || f.staticKey !== key) return;
        if (!ref) {
          // falhou (superfície do Skia sem memória, escrita no disco): tenta de novo depois da trava do store (5 s),
          // em vez de esperar o próximo refetch com a silhueta na tela
          if (++f.staticTries <= STATIC_TRIES) {
            setTimeout(() => {
              if (this.alive(f) && f.staticKey === key && !f.staticRef) this.wantStatic(f);
            }, STATIC_RETRY_MS);
          }
          return;
        }
        f.staticRef = ref;
        if (!f.frameKey) this.showFig(f, ref);
      })
      .catch(() => {});
  }

  private showFig(f: Fig, ref: MapImageRef): void {
    if (!f.own) return;
    let fresh = false;
    if (f.id !== 'me') {
      const kind: SlotKind = f.dim === IMG.figBoost ? 'F' : 'f';
      if (f.slot && f.slot.name[2] !== kind) this.dropFigSlot(f);
      if (!f.slot) {
        // vaga nova (ou de outra pessoa): a feature só aponta pra ela depois que o arquivo novo chegar no nativo
        f.slot = this.acquire(kind, f.id);
        if (!f.slot) return;
        f.imgReady = false;
        fresh = true;
      }
    }
    const t = this.figTarget(f) as { group: string; name: string };
    this.setImage(t.group, t.name, ref, fresh);
    if (!f.imgReady && !f.settling) {
      // a feature só aponta pra av-<id> depois que o nativo teve tempo de decodificar (senão pisca o placeholder)
      f.settling = this.afterImages(fresh ? SLOT_SETTLE_EXTRA_MS : 0, () => {
        f.settling = null;
        if (!this.alive(f)) return;
        f.imgReady = true;
        if (f.id === 'me') this.pushMe();
        else this.schedulePush(0, this.inView(f));
      });
    }
  }

  private ensureOwn(u: FigUser): void {
    const f = this.figOf(u.id);
    f.user = u;
    const dim = u.isBoosted ? IMG.figBoost : IMG.fig;
    if (!f.own || f.dim !== dim) {
      if (f.dim !== dim && f.own) {
        f.staticKey = null;
        f.staticRef = null;
        // boost liga/desliga: outro tamanho de imagem (outra vaga); até a figura nova chegar, a silhueta
        if (f.id !== 'me') f.imgReady = false;
      }
      f.own = true;
      f.dim = dim;
    }
    this.syncBubble(f);
    this.wantStatic(f);
  }

  /** pessoa fora do teto: solta a figura própria (e a bolha) e aponta pra silhueta */
  private useGeneric(u: FigUser): void {
    const f = this.figOf(u.id);
    f.user = u;
    if (f.own) {
      f.own = false;
      f.imgReady = false;
      f.staticKey = null;
      f.staticRef = null;
      f.frameKey = null;
      f.ph = null;
      this.dropFrames(f);
      this.dropFigSlot(f);
      this.release(f.phSlot);
      f.phSlot = null;
    }
    f.dim = IMG.fig;
  }

  /** solta a vaga da figura e cancela a espera dela: um timer velho marcaria pronta a vaga seguinte antes do arquivo novo */
  private dropFigSlot(f: Fig): void {
    this.release(f.slot);
    f.slot = null;
    f.imgReady = false;
    this.cancelSettle(f.settling);
    f.settling = null;
  }

  private removeFig(id: string): void {
    const f = this.figs.get(id);
    if (!f) return;
    // invalida o objeto: toda tarefa assíncrona em voo (desenho, foto) cai fora nos guards
    f.own = false;
    f.ph = null;
    f.staticKey = null;
    this.dropFrames(f);
    if (id === 'me') this.dropGroup('p:me');
    this.dropFigSlot(f);
    this.release(f.phSlot);
    f.phSlot = null;
    this.slotWaiters.delete(id);
    // o feature-state fica guardado por id na fonte mesmo sem a feature: quem voltar não pode nascer invisível
    for (const src of f.alphaDirty) this.setAlpha(src, id, 1);
    // nem com a bolha apagada (saiu no meio do fade da foto): 'pa' volta a 1 em todas as fontes
    this.tweens = this.tweens.filter((t) => !(t.id === id && t.key === 'pa'));
    for (const s of PERSON_SOURCES) {
      const k = `${s}|${id}|pa`;
      if (!this.lastAlpha.has(k)) continue;
      this.setAlpha(s, id, 1, 'pa');
      this.lastAlpha.delete(k);
    }
    this.figs.delete(id);
  }

  /**
   * Quem ganha figura própria: selecionado e o match sempre; depois quem aparece SOLTO na tela (fora de grupo, com
   * margem), do mais perto do centro pro mais longe, até o teto do tier. Antes o teto ia pros mais perto de MIM entre
   * todos os 300, inclusive quem estava escondido dentro dos grupos: a pessoa solta na tela, um pouco mais longe, ficava
   * na silhueta cinza a sessão inteira ("Caio S." no teste de carga). Quem está num grupo ou fora da tela só solta a
   * figura quando o teto aperta (os mais longe primeiro): voltar pra tela não redesenha nada.
   */
  private rebalanceOwn(): void {
    if (this.disposed || !this.users.size) return;
    const s = this.camera.state;
    const cap = FIG_CAP[this.tier] ?? FIG_CAP.mid;
    const shown = new Map<string, number>(); // id -> ordem (distância do centro em m; boost e match na frente)
    // longe (zoom < FAR_ZOOM) as pessoas são pontos: ninguém precisa de figura
    if (s.zoom >= FAR_ZOOM) {
      const take = (feats: Feature[]) => {
        for (const ft of feats) {
          const p = ft.properties as Record<string, unknown> | null;
          if (!p || p.cluster || typeof p.id !== 'string') continue;
          const f = this.figs.get(p.id);
          if (!f?.pos || !inBounds(f.pos, s.bounds, 0.25)) continue;
          const first = f.user?.isBoosted || f.user?.mutual ? -1e6 : 0;
          shown.set(p.id, first + distM(f.pos, s.center));
        }
      };
      take(this.features('users'));
      take(this.features('usersBoost'));
      take(this.features('movers'));
    }
    const order = Array.from(shown).sort((a, b) => a[1] - b[1]);
    const want = new Set(order.slice(0, cap).map(([id]) => id));
    for (const id of [this.selected, this.momentUserId]) if (id && this.users.has(id)) want.add(id);
    let own = 0;
    for (const [id, f] of this.figs) if (f.own && id !== 'me') own++;
    for (const id of want) {
      const f = this.figs.get(id);
      const u = this.users.get(id);
      if (u && f && !f.own) {
        this.ensureOwn(u);
        own++;
      }
    }
    // além do teto mas solto na tela: silhueta com a roupa e a pele da pessoa, do centro pra fora, até SIL_TINT_MAX cores
    // vivas. A cor que ninguém solto na tela usa mais solta a vaga (esfria como as figuras) e serve pra outra cor
    const tinted = new Set<string>();
    for (const [id] of order) {
      const u = want.has(id) ? undefined : this.users.get(id);
      if (u) this.wantTint(u, tinted);
    }
    for (const [key, slot] of this.tintPending) {
      if (tinted.has(key)) continue;
      this.tintPending.delete(key);
      this.silReady.delete(key);
      this.release(slot);
    }
    if (own <= cap) return;
    // passou do teto: solta primeiro quem não aparece (num grupo ou fora da tela), do mais longe pro mais perto; se não
    // bastar, quem aparece mas ficou fora do top-N desta câmera (sobrou de uma posição anterior: sem isso, arrastar o
    // mapa somava figura até todo mundo solto na tela). Eu, selecionado e match estão em `want` e nunca soltam
    const spare: { f: Fig; d: number }[] = [];
    for (const [id, f] of this.figs) {
      if (!f.own || id === 'me' || want.has(id) || f.leaving || !f.user) continue;
      const order = shown.get(id);
      spare.push({ f, d: order === undefined ? Infinity : order });
    }
    spare.sort((a, b) => b.d - a.d);
    let dropped = 0;
    for (const { f } of spare) {
      if (own <= cap) break;
      this.useGeneric(f.user as FigUser);
      own--;
      dropped++;
    }
    // a feature de quem soltou ainda aponta pra av-<id> (já fora do estilo): volta pra silhueta no próximo push
    if (dropped) this.schedulePush(0);
  }

  defineAvatars(defs: AvatarDefs): void {
    if (!defs) return;
    for (const key of Object.keys(defs)) {
      const d = defs[key];
      // (não lê d.l aqui: as camadas do mapAvatarDef são montadas sob demanda, só quando for rasterizar)
      // ('p' in d: não monta o rig aqui; o mapAvatarDef entrega sob demanda)
      if (!d || typeof d !== 'object' || !('p' in d)) continue;
      this.defs.set(key, d);
      const waiting = this.keyWaiters.get(key);
      this.keyWaiters.delete(key);
      if (waiting) {
        for (const id of waiting) {
          const f = this.figs.get(id);
          if (f && f.own) this.wantStatic(f);
        }
      }
    }
  }

  /** definição do visual da figura (null enquanto não chegou) */
  private defOf(f: Fig): AvatarDef | null {
    const k = f.user?.avatarKey;
    return k ? (this.defs.get(k) ?? null) : null;
  }

  /**
   * reação curta da figura. 'sig' = a animação assinatura do avatar (uma passada); com movimento reduzido ou sem a
   * definição ainda, vira o 'arrive' de sempre (um pulinho).
   */
  emote(id: string, kind: EmoteKind): void {
    const f = this.figs.get(id);
    if (!f || !f.own) return;
    const now = monoNow();
    let name: EmoteState = kind;
    let dur = DUR[kind];
    if (kind === 'sig') {
      if (f.one?.name === 'sig' && now - f.one.start < SIG_RETAP_MS) return;
      const def = this.defOf(f);
      const sig = def && !this.reduceMotion ? sigAssets(def) : null;
      if (sig) dur = sig.def.dur;
      else {
        name = 'arrive';
        dur = DUR.arrive;
      }
    }
    if (!dur) return;
    f.one = { name, start: now, dur };
    f.staticAt = 0;
    this.startClock();
  }

  /** caminhada até `to` em tempo proporcional à distância (1,5 m/s; 1,2–9 s); longe demais (ou sem vaga) = teleporte */
  private startMove(f: Fig, to: LngLat, now: number, canWalk = true): void {
    if (!f.pos) {
      f.pos = to;
      return;
    }
    // mesmo destino de uma caminhada em curso: segue andando (refetch ou heading não reiniciam o passo)
    if (f.move && distM(f.move.to, to) < 3) return;
    const d = distM(f.pos, to);
    if (d < 3 || !canWalk) {
      f.pos = to;
      f.move = null;
      return;
    }
    const mirror = to[0] < f.pos[0];
    if (mirror !== f.mirror) this.setMirror(f, mirror);
    if (d > 600) {
      f.pos = to;
      f.move = null;
      return;
    }
    f.move = { from: [f.pos[0], f.pos[1]], to, start: now, dur: Math.min(9000, Math.max(1200, (d / 1.5) * 1000)), run: d > 120 };
    this.startClock();
  }

  private setMirror(f: Fig, mirror: boolean): void {
    if (f.mirror === mirror) return;
    f.mirror = mirror;
    f.staticKey = null;
    f.staticRef = null;
    if (f.own) this.wantStatic(f);
  }

  // =====================================================================
  // Bolha de identidade (foto)
  // =====================================================================
  private bubbleStyle(u: FigUser, f: Fig): BubbleStyle {
    const o: BubbleStyle = { d: BUB.d, ring: 'rgba(250,250,250,0.92)', ringW: 2, glow: null, dot: u.isOnline ? '#7FFF00' : null, badge: null, tail: true };
    if (u.isBoosted) {
      o.ring = '#FFD700';
      o.glow = 'rgba(255,215,0,0.5)';
    }
    if (u.mutual) {
      o.ring = '#FF1493';
      o.badge = 'match';
    } else if (u.isNew) o.badge = 'new';
    if (f.moment) {
      o.ring = '#FF1493';
      o.glow = 'rgba(255,20,147,0.85)';
      o.ringW = 2.5;
      o.badge = 'match';
    }
    if (this.selected && this.selected === u.id) {
      o.ring = '#7FFF00';
      o.glow = 'rgba(127,255,0,0.75)';
      o.ringW = 2.5;
    }
    return o;
  }

  private bubbleSig(o: BubbleStyle): string {
    return [o.ring, o.glow ?? '', o.dot ?? '', o.badge ?? '', o.ringW].join('|');
  }

  private bubbleKey(url: string, sig: string): string {
    return `bub|${url}|${sig}|${RENDER_V}`;
  }

  /** cria a bolha (se tem foto e não está anônima); a foto só é baixada se a bolha pronta não estiver no disco */
  private ensureBubble(f: Fig, pri: number): void {
    const u = f.user;
    if (!u || !f.own) return;
    const url = u.isAnonymous ? null : u.photo || null;
    if (!url) {
      if (f.ph) this.dropBubble(f);
      return;
    }
    if (f.ph && f.ph.url !== url) this.dropBubble(f);
    if (!f.ph) {
      const ra = mapPhotos.retryAt(url);
      if (ra > Date.now()) {
        f.phWait = ra;
        return;
      }
      f.ph = { url, sig: '', ready: false };
    }
    const ph = f.ph;
    // bolha desse estilo já desenhada (inclusive numa sessão anterior): nem baixa nem decodifica a foto
    const style = this.bubbleStyle(u, f);
    const sig = this.bubbleSig(style);
    const hit = mapImages.get(this.bubbleKey(url, sig));
    if (hit) {
      ph.sig = sig;
      this.applyBubble(f, ph, sig, hit);
      return;
    }
    if (mapPhotos.status(url) === 'ok') {
      this.renderBubble(f);
      return;
    }
    mapPhotos
      .request(url, pri)
      .then((ok) => {
        if (!this.alive(f) || f.ph !== ph) return; // trocou de foto no meio / saiu do mapa
        if (!ok) {
          f.phWait = mapPhotos.retryAt(url);
          this.dropBubble(f);
          return;
        }
        this.renderBubble(f);
      })
      .catch(() => {});
  }

  private renderBubble(f: Fig): void {
    const u = f.user;
    const ph = f.ph;
    if (!u || !ph || !f.own) return;
    const style = this.bubbleStyle(u, f);
    const sig = this.bubbleSig(style);
    if (ph.sig === sig && ph.ready) return;
    ph.sig = sig;
    const url = ph.url;
    const key = this.bubbleKey(url, sig);
    const hit = mapImages.get(key);
    if (hit) {
      this.applyBubble(f, ph, sig, hit);
      return;
    }
    mapImages
      .request(
        key,
        this.priorityOf(f),
        () => {
          // thumb despejado do LRU antes do render rodar: não grava a bolha sem foto sob a chave da foto
          const th = mapPhotos.thumb(url);
          return th ? mapDraw.bubble(th, style) : null;
        },
        IMG_SCALE,
      )
      .then((ref) => {
        if (ref) {
          this.applyBubble(f, ph, sig, ref);
          return;
        }
        // falhou: sem bolha por 5 s e o LOD tenta de novo (senão ficava presa em 'não pronta' pra sempre)
        if (!this.alive(f) || f.ph !== ph) return;
        if (ph.ready) ph.sig = '';
        else {
          f.ph = null;
          f.phWait = Date.now() + 5000;
        }
      })
      .catch(() => {});
  }

  private applyBubble(f: Fig, ph: NonNullable<Fig['ph']>, sig: string, ref: MapImageRef): void {
    if (!this.alive(f) || f.ph !== ph || ph.sig !== sig) return;
    let fresh = false;
    if (f.id !== 'me' && !f.phSlot) {
      f.phSlot = this.acquire('b', f.id);
      if (!f.phSlot) {
        ph.sig = ''; // sem vaga agora: o retry redesenha (a bolha já está no disco)
        return;
      }
      fresh = true;
    }
    if (f.id === 'me') this.setImage('p:me', 'ph-me', ref);
    else this.setImage((f.phSlot as Slot).group, (f.phSlot as Slot).name, ref, fresh);
    if (ph.ready || ph.settling) return;
    // a feature só aponta pra ph-<id> depois que o nativo teve tempo de decodificar (senão pisca o placeholder)
    ph.settling = true;
    this.afterImages(fresh ? SLOT_SETTLE_EXTRA_MS : 0, () => {
      ph.settling = false;
      if (!this.alive(f) || f.ph !== ph) return;
      ph.ready = true;
      if (f.id === 'me') {
        this.pushMe();
        return;
      }
      // a foto chega com fade de 300 ms (o thumb aparecia transparente e acendia, no original). O fade roda em todas as
      // fontes de pessoa: o feature-state fica guardado por id na fonte, e quem troca de fonte (anda, ganha/perde boost)
      // levaria um pa=0 esquecido e ficaria sem bolha (a fila do feature-state junta tudo numa chamada por fonte)
      const now = monoNow();
      for (const s of PERSON_SOURCES) {
        this.setAlpha(s, f.id, 0, 'pa');
        this.addTween({ source: s, id: f.id, key: 'pa', from: 0, to: 1, start: now, dur: 300 });
      }
      this.schedulePush(0, this.inView(f));
    });
  }

  /** refetch trouxe a pessoa de novo: foto trocou/sumiu → descarta; estado mudou → redesenha */
  private syncBubble(f: Fig): void {
    if (!f.ph || !f.user) return;
    const url = f.user.isAnonymous ? null : f.user.photo || null;
    if (!url || url !== f.ph.url) {
      this.dropBubble(f);
      return;
    }
    if (f.ph.ready) this.renderBubble(f);
  }

  private refreshBubble(id: string): void {
    const f = this.figs.get(id);
    if (f?.user && f.ph?.ready) this.renderBubble(f);
  }

  private dropBubble(f: Fig): void {
    if (!f.ph) return;
    const wasReady = f.ph.ready;
    f.ph = null;
    // a vaga solta e esfria (a imagem fica registrada até outra bolha ocupar); a feature para de apontar pra ela
    this.release(f.phSlot);
    f.phSlot = null;
    if (wasReady) {
      if (f.id === 'me') this.pushMe();
      else this.schedulePush(0);
    }
  }

  // =====================================================================
  // Features
  // =====================================================================
  /**
   * Silhueta provisória com o visual da pessoa (anel de presença, anel premium, selo, véu anônimo) enquanto o desenho do
   * avatar não fica pronto ou pra quem está fora do teto de figuras. Poucas combinações, compartilhadas: a poça de luz
   * segue só boost/premium+ (a cor própria da aura ficaria uma variante por pessoa) e a silhueta não espelha (é simétrica).
   * Quem fica além do teto e aparece solto na tela ganha a versão colorida (roupa e pele da pessoa: silTintOf), pedida no
   * rebalanceOwn; aqui ela só é usada quando já está pronta.
   */
  private placeholderOf(u: FigUser, dim: Dim): string {
    const look = { ...this.lookOf(u), aura: '' };
    const sig = `${this.lookSig(look)}|${dim.w}x${dim.h}|${figVersion()}`;
    const tint = this.tintKey(u, sig);
    const colored = tint ? this.silReady.get(tint) : undefined;
    if (colored) return colored;
    const key = `sil|${sig}`;
    const ready = this.silReady.get(key);
    if (ready) return ready;
    this.requestSil(key, look, dim);
    return GENERIC_FIG;
  }

  /** cor da silhueta por visual (cache: a users republica as 300 pessoas e cada uma consultaria a paleta) */
  private tintOfKey(avatarKey: string): ReturnType<typeof silTintOf> {
    if (!avatarKey) return null;
    let t = this.tints.get(avatarKey);
    if (t === undefined) {
      const def = this.defs.get(avatarKey);
      if (!def) return null;
      t = silTintOf(def);
      this.tints.set(avatarKey, t);
    }
    return t;
  }

  /** chave da silhueta colorida da pessoa (null sem a definição do avatar ainda) */
  private tintKey(u: FigUser, sig: string): string | null {
    const t = this.tintOfKey(u.avatarKey);
    return t ? `silc|${sig}|${t.id}` : null;
  }

  /** pede a silhueta colorida de quem está além do teto (numa vaga 's'; `tinted` junta as cores pedidas nesta passada) */
  private wantTint(u: FigUser, tinted: Set<string>): void {
    const look = { ...this.lookOf(u), aura: '' };
    const sig = `${this.lookSig(look)}|${IMG.fig.w}x${IMG.fig.h}|${figVersion()}`;
    const key = this.tintKey(u, sig);
    if (!key) return;
    tinted.add(key);
    if (this.tintPending.has(key)) return;
    const slot = this.acquire('s', key);
    if (!slot) return; // todas ocupadas ou esfriando: o retry das vagas chama o rebalance de novo
    this.tintPending.set(key, slot);
    const t = this.tintOfKey(u.avatarKey) as NonNullable<ReturnType<typeof silTintOf>>;
    const tint = { body: t.body, skin: t.skin };
    mapImages
      .request(key, -1.5, () => mapDraw.figure(null, look, IMG.fig, null, false, { tint }), IMG_SCALE)
      .then((ref) => {
        if (!ref || this.disposed || this.tintPending.get(key) !== slot) return;
        this.setImage(slot.group, slot.name, ref, true);
        // vaga que era de outra cor: espera o arquivo novo chegar antes de apontar (como as figuras)
        this.afterImages(SLOT_SETTLE_EXTRA_MS, () => {
          if (this.tintPending.get(key) !== slot) return;
          this.silReady.set(key, slot.name);
          this.schedulePush(0);
          this.pushMe();
        });
      })
      .catch(() => {});
  }

  private requestSil(key: string, look: FigureLook, dim: Dim): void {
    if (this.silPending.has(key)) return;
    const name = 'sil-' + (this.silPending.size + 1);
    this.silPending.set(key, name);
    mapImages
      .request(key, -1.5, () => mapDraw.figure(null, look, dim, null, false), IMG_SCALE)
      .then((ref) => {
        if (!ref || this.disposed) return;
        this.setImage('sil', name, ref);
        this.afterImages(0, () => {
          this.silReady.set(key, name);
          this.schedulePush(0);
          this.pushMe();
        });
      })
      .catch(() => {});
  }

  /**
   * feature de uma pessoa: só o que o estilo lê (layers.tsx) — imagem, tamanho, nome, aura e foto; o deslocamento do
   * ícone e da bolha sai do estilo pela marca `b` (imagem no tamanho do boost). Cada byte vai pro nativo a cada envio.
   */
  private featureFor(u: FigUser, f: Fig, coords: LngLat, szMul = 1): Feature {
    const ready = f.own && f.imgReady;
    const props: Record<string, unknown> = {
      id: u.id,
      img: ready ? this.imgName(f) : this.placeholderOf(u, IMG.fig),
      sz: Math.round(f.sz * szMul * 1000) / 1000,
    };
    if (ready && f.dim === IMG.figBoost) props.b = 1;
    // campos vazios ficam de fora (menos JSON a cada republicação da fonte)
    const label = u.isAnonymous ? '' : u.label || u.name || '';
    if (label) props.label = label;
    if (!u.isBoosted && u.premiumTier === 'premium_plus') props.aura = 1;
    if (f.ph?.ready && f.phSlot) props.ph = f.phSlot.name;
    return point(coords, props, u.id);
  }

  /** intervalo mínimo entre republicações das fontes de pessoas (PUSH_GAP_MS): mais features no ar, mais espaçado */
  private pushGap(): number {
    const n = this.countOf('users') + this.countOf('usersBoost');
    return n > 200 ? PUSH_GAP_MS.crowd : n > 100 ? PUSH_GAP_MS.many : PUSH_GAP_MS.few;
  }

  /**
   * republica as fontes de pessoas no máximo a cada pushGap() (chegadas, saídas, figuras e bolhas prontas); `urgent` (figura
   * ou foto que ficou pronta na tela) usa o intervalo curto: a silhueta não fica esperando o ritmo da multidão
   */
  private schedulePush(delay: number, urgent = false): void {
    if (this.disposed) return;
    const gap = urgent ? PUSH_GAP_MS.few : this.pushGap();
    const due = Math.max(monoNow() + delay, this.lastPushAt + gap);
    if (this.pushTimer && urgent && due < this.pushDue) {
      clearTimeout(this.pushTimer);
      this.pushTimer = null;
    }
    if (this.pushTimer) return; // já tem um marcado: esse também entra nele
    this.pushDue = due;
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      // esfria ANTES: o que soltar durante este push (rebalanceOwn no fim do pushUsers) ainda está nas features que
      // acabaram de sair e só esfria no próximo push, que já sai sem a referência (senão a vaga voltava a servir em 400 ms
      // com a fonte ainda apontando pra ela, e a pessoa solta mostrava o boneco da nova dona)
      this.coolSlots();
      this.pushUsers();
      this.pushSpot();
    }, Math.max(0, due - monoNow()));
  }

  /** sem feature-state (MLRN sem o patch) a figura destacada sai das fontes de baixo, senão aparece dobrada sob o spot */
  private hiddenBySpot(): string | null {
    return this.noFeatureState ? this.momentUserId || this.selected : null;
  }

  /** monta as 3 fontes de pessoas: paradas (agrupadas), com boost e andando (posição interpolada) */
  private pushUsers(): void {
    this.lastPushAt = monoNow();
    const normal: Feature[] = [];
    const boosted: Feature[] = [];
    const movers: Feature[] = [];
    const hidden = this.hiddenBySpot();
    let aura = false;
    for (const [id, u] of this.users) {
      const f = this.figOf(id);
      f.parked = false; // quem chegou andando desce pra users agora, no mesmo commit que sai da movers
      if (!u.isBoosted && u.premiumTier === 'premium_plus') aura = true;
      if (id === hidden) continue;
      if (f.move && f.pos) movers.push(this.featureFor(u, f, f.pos, u.isBoosted ? 1.17 : 1));
      else (u.isBoosted ? boosted : normal).push(this.featureFor(u, f, f.pos ?? u.pos));
    }
    for (const [id, u] of this.leaving) {
      const f = this.figs.get(id);
      if (f?.pos) (u.isBoosted ? boosted : normal).push(this.featureFor(u, f, f.pos));
    }
    this.loadClusters(normal);
    this.publish('usersBoost', fc(boosted));
    this.publish('movers', fc(movers));
    this.setRings({ aura, auraBoost: boosted.length > 0 });
    this.rebalanceOwn();
  }

  /** reindexa os grupos com as pessoas paradas e publica a fonte users no zoom atual */
  private loadClusters(points: Feature[]): void {
    this.prevUsersIndex = this.usersIndex;
    if (!points.length) {
      this.usersIndex = null;
      this.clusterZoom = -1;
      this.publish('users', EMPTY_FC);
      return;
    }
    const index: UsersIndex = new Supercluster({ radius: CLUSTER_RADIUS, maxZoom: CLUSTER_MAX_ZOOM, extent: 512 });
    // toda feature daqui é Point (featureFor)
    index.load(points as Supercluster.PointFeature<GeoJSON.GeoJsonProperties>[]);
    this.usersIndex = index;
    this.clusterZoom = -1;
    this.publishClusters();
  }

  /**
   * Fonte users = grupos + pessoas soltas no zoom inteiro atual. Os grupos saem com as mesmas propriedades do antigo
   * cluster nativo (cluster, cluster_id, point_count, point_count_abbreviated); pessoas soltas são as features originais.
   */
  private publishClusters(): void {
    const index = this.usersIndex;
    if (!index) return;
    const z = clusterZoomOf(this.camera.state.zoom);
    this.clusterZoom = z;
    this.publish('users', fc(index.getClusters(WORLD_BBOX, z) as Feature[]));
  }

  private pushMovers(): void {
    const movers: Feature[] = [];
    const hidden = this.hiddenBySpot();
    for (const [id, u] of this.users) {
      const f = this.figs.get(id);
      if ((f?.move || f?.parked) && f.pos && id !== hidden) movers.push(this.featureFor(u, f, f.pos, u.isBoosted ? 1.17 : 1));
    }
    this.publish('movers', fc(movers));
  }

  private pushMe(): void {
    const f = this.figs.get('me');
    if (!f?.pos || !this.me) return;
    const dim = f.dim;
    const props: Record<string, unknown> = { img: f.imgReady ? this.imgName(f) : f.user ? this.placeholderOf(f.user, IMG.fig) : GENERIC_FIG, off: [0, figOffset(f.imgReady ? dim : IMG.fig)] };
    if (typeof this.me.heading === 'number') props.heading = this.me.heading;
    if (f.ph?.ready) {
      props.ph = 'ph-me';
      props.poff = [0, bubbleOffset(f.imgReady ? dim : IMG.fig)];
    }
    this.publish('me', fc([point(f.pos, props)]));
    this.setRings({ me: true });
  }

  private spotSourceOf(id: string): string {
    const f = this.figs.get(id);
    const u = this.users.get(id);
    return f?.move || f?.parked ? SRC.movers : u?.isBoosted ? SRC.usersBoost : SRC.users;
  }

  private pushSpot(): void {
    const id = this.momentUserId || this.selected;
    const u = id ? this.users.get(id) : undefined;
    const f = id ? this.figs.get(id) : undefined;
    if (!u || !f?.pos) {
      if (this.countOf('spot')) this.publish('spot', EMPTY_FC);
      this.setRings({ spotAura: null });
      return;
    }
    const feat = this.featureFor(u, f, f.pos, u.isBoosted ? 1.17 : 1);
    if (u.isBoosted) (feat.properties as Record<string, unknown>).aura = 1;
    this.publish('spot', fc([feat]));
    this.setRings({ spotAura: u.isBoosted ? 'boost' : u.premiumTier === 'premium_plus' ? 'plus' : null });
  }

  // =====================================================================
  // Dados: diff por id, entrada escalonada, hotspotBorn
  // =====================================================================
  setData(payload: MapDataPayload): void {
    const users = (payload?.users ?? []).slice(0, MAX_USERS);
    const pois = payload?.pois ?? [];
    if (typeof payload?.hotMin === 'number') this.hotMin = payload.hotMin;
    const now = monoNow();
    const isFirst = !this.hadData;
    const prev = this.users;
    const next = new Map<string, FigUser>();
    const newIds: { id: string; boosted: boolean }[] = [];
    // quem anda de verdade agora (o teto MOVE_CAP vale pro refetch inteiro)
    let walking = 0;
    for (const f of this.figs.values()) if (f.move) walking++;

    for (const raw of users) {
      if (!raw?.id || !raw.mapPosition || !Number.isFinite(raw.mapPosition.lat) || !Number.isFinite(raw.mapPosition.lng)) continue; // só posição VISUAL
      const to: LngLat = [raw.mapPosition.lng, raw.mapPosition.lat];
      const u: FigUser = {
        id: raw.id,
        name: raw.name,
        label: raw.label,
        avatarKey: raw.avatarKey || '',
        aura: raw.aura || '',
        isAnonymous: Boolean(raw.isAnonymous),
        isBoosted: Boolean(raw.isBoosted),
        premiumTier: raw.premiumTier ?? 'free',
        isVerified: Boolean(raw.isVerified),
        isOnline: Boolean(raw.isOnline),
        photo: raw.photo ?? null,
        isNew: Boolean(raw.isNew),
        mutual: Boolean(raw.mutual),
        pos: to,
      };
      next.set(u.id, u);
      // figura própria: quem já tem continua (o visual pode ter mudado); o resto entra no rebalanceOwn do pushUsers,
      // que dá figura a quem aparece solto na tela
      const had = this.figs.get(u.id);
      if (had?.own || u.id === this.selected || u.id === this.momentUserId) this.ensureOwn(u);
      else this.useGeneric(u);
      const f = this.figOf(u.id);
      const wasLeaving = this.leaving.has(u.id);
      if (wasLeaving) {
        // voltou enquanto sumia: cancela a saída e garante opacidade cheia
        this.leaving.delete(u.id);
        this.tweens = this.tweens.filter((t) => !(t.id === u.id && t.key === 'a'));
        for (const src of PERSON_SOURCES) this.setAlpha(src, u.id, 1);
      }
      f.leaving = 0;
      // posição mudou: a pessoa ANDA até lá (na tela e dentro do teto; o resto chega direto); na 1ª carga todo mundo já
      // nasce no lugar
      if ((prev.has(u.id) || wasLeaving) && !isFirst) {
        const wasMoving = Boolean(f.move);
        const canWalk = wasMoving || (walking < (MOVE_CAP[this.tier] ?? MOVE_CAP.mid) && (!f.pos || inBounds(f.pos, this.camera.state.bounds, 0.15) || inBounds(to, this.camera.state.bounds, 0.15)));
        this.startMove(f, to, now, canWalk);
        if (f.move && !wasMoving) walking++;
      } else {
        f.pos = to;
        f.move = null;
      }
      if (!prev.has(u.id) && !wasLeaving) newIds.push({ id: u.id, boosted: u.isBoosted });
    }

    // quem saiu some com fade (300 ms) e só depois leva as imagens junto; muita gente saindo junto some direto
    const gone = Array.from(prev.keys()).filter((id) => !next.has(id));
    const fadeOut = !isFirst && gone.length <= LEAVE_FADE_MAX;
    for (const oid of gone) {
      const ou = prev.get(oid) as FigUser;
      const lf = this.figs.get(oid);
      if (this.selected === oid) this.selected = null;
      if (!lf?.pos || !fadeOut) {
        this.removeFig(oid);
        continue;
      }
      lf.move = null;
      lf.one = null;
      lf.leaving = now;
      this.leaving.set(oid, ou);
      const token = now;
      this.addTween({
        source: ou.isBoosted ? SRC.usersBoost : SRC.users,
        id: oid,
        key: 'a',
        from: 1,
        to: 0,
        start: now,
        dur: 300,
        onDone: () => {
          const f2 = this.figs.get(oid);
          if (!f2 || f2.leaving !== token) return; // voltou no meio do fade
          this.leaving.delete(oid);
          this.schedulePush(0);
          setTimeout(() => {
            const f3 = this.figs.get(oid);
            if (f3 && f3.leaving === token && !this.users.has(oid) && !this.leaving.has(oid)) this.removeFig(oid);
          }, 400);
        },
      });
    }

    // definições de avatar só de quem está no mapa (+ eu)
    const usedKeys = new Set<string>();
    for (const u of next.values()) if (u.avatarKey) usedKeys.add(u.avatarKey);
    for (const u of this.leaving.values()) if (u.avatarKey) usedKeys.add(u.avatarKey);
    if (this.me?.avatarKey) usedKeys.add(this.me.avatarKey);
    for (const k of Array.from(this.defs.keys())) if (!usedKeys.has(k)) this.defs.delete(k);
    for (const k of Array.from(this.tints.keys())) if (!usedKeys.has(k)) this.tints.delete(k);
    for (const k of Array.from(this.keyWaiters.keys())) if (!usedKeys.has(k)) this.keyWaiters.delete(k);

    this.users = next;
    this.updateLod();
    this.pushUsers();
    this.pushSpot();

    // entrada escalonada: novos começam invisíveis e "pousam". Só os mais perto do centro fazem o fade (cada passo é
    // uma chamada ao nativo); o resto entra direto. Todo id novo volta pra a=1: o feature-state sobrevive à saída
    const c = this.camera.state.center;
    const byDist = newIds.map((n) => ({ ...n, d: distM(next.get(n.id)?.pos ?? c, c) })).sort((x, y) => x.d - y.d);
    const fadeCap = isFirst ? 24 : 40;
    byDist.forEach((n, i) => {
      const src = n.boosted ? SRC.usersBoost : SRC.users;
      if (i >= fadeCap) {
        this.setAlpha(src, n.id, 1);
        return;
      }
      this.setAlpha(src, n.id, 0);
      const delay = Math.min(600, i * 35);
      this.addTween({ source: src, id: n.id, key: 'a', from: 0, to: 1, start: now + delay, dur: 260 });
      if (!isFirst && i < 12) setTimeout(() => this.users.has(n.id) && this.emote(n.id, 'arrive'), delay + 120);
    });

    // POIs + hotspots
    const feats: Feature[] = [];
    const newHot: { poiId: number; name: string; userCount: number }[] = [];
    const nextHot = new Set<number>();
    const nextPois = new Map<number, POI>();
    const sonarLevels: [boolean, boolean, boolean] = [false, false, false];
    for (const poi of pois) {
      if (!poi || typeof poi.latitude !== 'number' || typeof poi.longitude !== 'number') continue;
      nextPois.set(poi.id, poi);
      const count = poi.userCount ?? 0;
      const hot = count >= this.hotMin;
      const isEvent = poi.category === 'event';
      const level = isEvent && !hot ? 1 : count >= 20 ? 3 : count >= 10 ? 2 : 1;
      if (hot || isEvent) sonarLevels[level - 1] = true;
      const img = this.ensurePoiImage(poi, hot);
      feats.push(
        point(
          [poi.longitude, poi.latitude],
          {
            id: poi.id,
            hot,
            event: isEvent,
            sonar: `sonar-${level}`,
            img,
            partner: Boolean(poi.isPartner),
            label: hot ? `${poi.name}\n${count} ${count === 1 ? 'pessoa' : 'pessoas'}` : isEvent ? `⚡ ${poi.name}` : poi.name,
          },
          poi.id,
        ),
      );
      if (hot) {
        nextHot.add(poi.id);
        if (!isFirst && !this.hotIds.has(poi.id)) newHot.push({ poiId: poi.id, name: poi.name, userCount: count });
      }
    }
    this.hotIds = nextHot;
    this.pois = nextPois;
    this.publish('pois', fc(feats));
    this.setRings({ sonar: sonarLevels });
    if (newHot.length) this.pulseRings();
    for (const h of newHot) {
      this.emit({ type: 'hotspotBorn', ...h });
      const p = this.pois.get(h.poiId);
      if (p) this.burst({ lat: p.latitude, lng: p.longitude, kind: 'match' });
    }
    this.hadData = true;
    this.retargetParticles();
    this.startClock();
  }

  /**
   * Gente invisível por perto (só Premium; pra quem é grátis o servidor manda null): um marcador por lugar ou quadra
   * com a contagem. O motor guarda só a coleção pronta (contagem, posição do grupo, nome do lugar) — nada por pessoa.
   */
  setInvisible(groups: InvisibleGroup[] | null): void {
    this.invisibleGroups = groups;
    // perto de mim o marcador sai de baixo do meu avatar (só desenho: invisible.drawPosition)
    const next = invisibleFeatures(groups, this.me);
    if (!next.features.length && !this.countOf('invisible')) return;
    this.publish('invisible', next);
  }

  private ensurePoiImage(p: POI, hot: boolean): string {
    const isEvent = p.category === 'event';
    const id = hot ? 'poi-hot' : isEvent ? 'poi-event' : `poi-${p.category || 'other'}${p.isPartner ? '-partner' : ''}`;
    const g = this.groups.get('poi');
    if (!g || !g[id]) {
      this.requestShared('poi', id, `${id}|${RENDER_V}`, () => mapDraw.poi({ category: p.category || 'other', hot, isEvent, isPartner: Boolean(p.isPartner) }), 0);
    }
    return id;
  }

  // =====================================================================
  // Eu, seleção, momento do match
  // =====================================================================
  setMe(me: MeState): void {
    if (!me || typeof me.lat !== 'number' || typeof me.lng !== 'number') return;
    const moved = !this.me || this.me.lat !== me.lat || this.me.lng !== me.lng;
    this.me = me;
    if (moved && this.invisibleGroups?.length) this.setInvisible(this.invisibleGroups);
    const u: FigUser = {
      id: 'me',
      name: me.name || 'você',
      label: '',
      avatarKey: me.avatarKey || '',
      aura: me.aura || '',
      isAnonymous: Boolean(me.isAnonymous),
      isBoosted: Boolean(me.isBoosted),
      premiumTier: me.tier || 'free',
      isVerified: false,
      isOnline: true,
      photo: me.photoUrl || null,
      isNew: false,
      mutual: false,
      pos: [me.lng, me.lat],
    };
    const f = this.figOf('me');
    const to: LngLat = [me.lng, me.lat];
    // só a posição mexe na caminhada (o heading chega a cada 100 ms e reiniciaria o passo)
    if (!f.pos) f.pos = to;
    else if (moved) this.startMove(f, to, monoNow());
    this.ensureOwn(u);
    this.ensureBubble(f, 0); // minha foto sempre
    this.pushMe();
    if (!this.located) {
      this.located = true;
      if (!this.revealed) {
        // a tela chama reveal(); se não chamar em 1,5 s, centraliza
        setTimeout(() => {
          if (!this.revealed && !this.disposed) this.setCenter(me.lat, me.lng, 16);
        }, 1500);
      }
    }
    this.retargetParticles();
  }

  private setAlpha(source: string, id: string, a: number, key: 'a' | 'pa' = 'a'): void {
    const k = `${source}|${id}|${key}`;
    const last = this.lastAlpha.get(k);
    if (last === a) return;
    this.lastAlpha.set(k, a);
    if (this.lastAlpha.size > 4000) this.lastAlpha.clear();
    if (key === 'a') {
      const f = this.figs.get(id);
      if (f) {
        if (a < 1) f.alphaDirty.add(source);
        else f.alphaDirty.delete(source);
      }
    }
    if (!this.fstate.set(source, id, { [key]: a }) && !this.noFeatureState) {
      // MLRN sem o patch do feature-state: fades somem; o destaque passa a esconder a figura de baixo pelas fontes
      this.noFeatureState = true;
      this.schedulePush(0);
    }
  }

  private setAlphaElsewhere(id: string, src: string, a: number): void {
    for (const o of [SRC.users, SRC.usersBoost, SRC.movers]) if (o !== src) this.setAlpha(o, id, a);
  }

  /** um tween por fonte|id|chave: o pedido novo substitui o anterior e parte do último alfa aplicado */
  private addTween(t: AlphaTween): void {
    const same = (x: AlphaTween) => x.source === t.source && x.id === t.id && x.key === t.key;
    // o onDone do tween substituído não pode se perder (é ele que tira a pessoa de 'leaving' ou limpa o spot)
    const old = this.tweens.find(same);
    if (old?.onDone && !t.onDone) t.onDone = old.onDone;
    this.tweens = this.tweens.filter((x) => !same(x));
    this.tweens.push(t);
    this.startClock();
  }

  private tween(source: string, id: string, to: number, dur: number, onDone?: () => void): void {
    const from = this.lastAlpha.get(`${source}|${id}|a`) ?? (to > 0 ? 0 : 1);
    this.addTween({ source, id, key: 'a', from, to, start: monoNow(), dur, onDone });
  }

  private spotIn(id: string): void {
    const f = this.figs.get(id);
    if (!f) return;
    if (f.user?.photo && !f.ph && !(f.phWait > Date.now())) this.ensureBubble(f, 0); // foto do selecionado tem prioridade máxima
    if (this.noFeatureState) this.schedulePush(0);
    this.pushSpot();
    this.setAlpha(SRC.spot, id, 0);
    this.tween(SRC.spot, id, 1, 220);
    const src = this.spotSourceOf(id);
    this.tween(src, id, 0, 220);
    this.setAlphaElsewhere(id, src, 0);
  }

  private spotOut(id: string): void {
    const f = this.figs.get(id);
    if (!f || !this.users.has(id)) {
      // saiu do mapa enquanto destacada: devolve a opacidade nas fontes (quem voltar não nasce invisível)
      for (const s of PERSON_SOURCES) this.setAlpha(s, id, 1);
      this.pushSpot();
      return;
    }
    const src = this.spotSourceOf(id);
    this.tween(src, id, 1, 200);
    this.setAlphaElsewhere(id, src, 1);
    this.tween(SRC.spot, id, 0, 200, () => this.pushSpot());
    if (this.noFeatureState) this.schedulePush(0);
  }

  /** toque na pessoa: anel no chão, figura + foto crescem (spot), câmera centraliza */
  select(id: string | null): void {
    const prevSel = this.selected;
    this.selected = id || null;
    const inMoment = Boolean(this.momentTimer);
    if (prevSel && prevSel !== this.selected) {
      this.refreshBubble(prevSel);
      // durante o momento o spot é do match: quem estava selecionado volta ao normal mesmo assim
      if (prevSel !== this.momentUserId) this.spotOut(prevSel);
    }
    if (!id && inMoment) return; // o momento do match está usando o anel
    const u = id ? this.users.get(id) : undefined;
    const f = id ? this.figs.get(id) : undefined;
    if (u && f && !f.own) {
      // estava na silhueta: ganha a própria
      this.ensureOwn(u);
      this.schedulePush(0);
    }
    // (a animação assinatura toca no toque da figura no mapa, em onTap; seleção vinda da lista não toca: cada toque
    // rasteriza vários quadros na CPU)
    this.publish('sel', u ? fc([point(u.pos, {})]) : EMPTY_FC);
    this.setRings({ sel: Boolean(u) });
    if (u) this.pulseRings(); // outra pessoa com o anel já ligado: pulsa de novo
    if (!u || !id) {
      if (!this.momentUserId) this.pushSpot();
      return;
    }
    this.refreshBubble(id);
    if (inMoment && id !== this.momentUserId) return;
    if (id !== this.momentUserId) this.spotIn(id);
    else this.pushSpot();
    const s = this.camera.state;
    this.camera.move({ center: offsetCenter(u.pos, 60, s.zoom, s.bearing, s.pitch), duration: 600, mode: 'easeTo' });
  }

  private clearMoment(): void {
    if (this.momentTimer) {
      clearTimeout(this.momentTimer);
      this.momentTimer = null;
    }
    for (const t of this.momentSeq) clearTimeout(t);
    this.momentSeq = [];
    if (this.countOf('moment')) this.publish('moment', EMPTY_FC);
    const mid = this.momentUserId;
    this.momentUserId = null;
    const fm = this.figs.get('me');
    if (fm) {
      fm.moment = false;
      this.refreshBubble('me');
    }
    if (mid) {
      const fu = this.figs.get(mid);
      if (fu) {
        fu.moment = false;
        this.refreshBubble(mid);
      }
      if (this.selected !== mid) this.spotOut(mid);
      else this.pushSpot();
    } else this.pushSpot();
    // alguém foi selecionado durante o momento: o destaque dela entra agora
    if (this.selected && this.selected !== mid && this.users.has(this.selected)) {
      const su = this.users.get(this.selected) as FigUser;
      this.publish('sel', fc([point(su.pos, {})]));
      this.spotIn(this.selected);
    }
    if (!this.selected) {
      this.publish('sel', EMPTY_FC);
      this.setRings({ sel: false });
    }
  }

  /** momento de match: os dois avatares enquadrados, arco de luz entre eles, pulsos e explosão no meio */
  matchMoment(m: { userId: string }): void {
    if (!m || !this.me) {
      this.emit({ type: 'matchMomentDone', userId: m ? m.userId : null, shown: false });
      return;
    }
    const u = this.users.get(m.userId);
    if (!u) {
      this.emit({ type: 'matchMomentDone', userId: m.userId, shown: false });
      return;
    }
    if (this.momentTimer || this.momentUserId) this.clearMoment();
    // quem estava destacado sai do spot agora (volta no fim do momento, se continuar selecionado)
    if (this.selected && this.selected !== m.userId) this.spotOut(this.selected);
    this.momentUserId = m.userId;
    const fu0 = this.figs.get(m.userId);
    if (fu0 && !fu0.own) {
      this.ensureOwn(u);
      this.schedulePush(0);
    }
    const fm = this.figs.get('me');
    const fu = this.figs.get(m.userId);
    if (fm) {
      fm.moment = true;
      this.refreshBubble('me');
    }
    if (fu) {
      fu.moment = true;
      this.refreshBubble(m.userId);
    }
    const a: LngLat = [this.me.lng, this.me.lat];
    const b: LngLat = u.pos;
    // um de frente pro outro
    if (fm) this.setMirror(fm, b[0] < a[0]);
    if (fu) this.setMirror(fu, a[0] < b[0]);
    this.emote('me', 'match');
    this.emote(m.userId, 'match');
    if (this.selected !== m.userId) this.spotIn(m.userId);
    else this.pushSpot();

    const mid = midpoint(a, b);
    const span = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), 0.0004);
    const pts: LngLat[] = [];
    for (let i = 0; i <= 28; i++) {
      const t = i / 28;
      const it = 1 - t;
      pts.push([it * it * a[0] + 2 * it * t * mid[0] + t * t * b[0], it * it * a[1] + 2 * it * t * (mid[1] + span * 0.45) + t * t * b[1]]);
    }
    this.publish('moment', fc([{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } }]));

    const pad = this.camera.padding;
    const fit = fitZoom(a, b, this.width || 400, this.height || 800, { top: pad.top + 140, bottom: pad.bottom + 40, left: pad.left + 60, right: pad.right + 60 }, 18, 55);
    const zoom = Number.isFinite(fit) ? fit : Math.min(this.camera.state.zoom, 17);
    const bearing = this.camera.state.bearing;
    // o padding do enquadramento é assimétrico (140 em cima, 40 embaixo): o par fica 50 px abaixo do centro, livre do banner
    this.camera.move({ center: offsetCenter(mid, -50, zoom, bearing, 55), zoom, pitch: 55, bearing, duration: 900, mode: 'easeTo' });

    [0, 380, 760, 1140, 1520].forEach((delay, k) => {
      this.momentSeq.push(
        setTimeout(() => {
          this.burst({ lat: a[1], lng: a[0], kind: 'match' });
          this.burst({ lat: b[1], lng: b[0], kind: 'match' });
          if (k === 2) this.burst({ lat: mid[1], lng: mid[0], kind: 'super' });
        }, delay),
      );
    });
    this.publish('sel', fc([point(b, {})]));
    this.setRings({ sel: true });
    this.momentTimer = setTimeout(() => {
      this.momentTimer = null;
      this.clearMoment();
      this.emit({ type: 'matchMomentDone', userId: m.userId, shown: true });
    }, 3400);
  }

  // =====================================================================
  // Efeitos: burst, pino
  // =====================================================================
  burst(b: BurstPayload): void {
    if (!b || typeof b.lat !== 'number' || typeof b.lng !== 'number') return;
    const kind = b.kind || 'like';
    const color = kind === 'super' ? '#FFD700' : kind === 'match' ? '#FF1493' : '#7FFF00';
    const color2 = kind === 'match' ? '#7FFF00' : color;
    this.fx.push({ id: `fx-${++this.fxSeq}`, at: [b.lng, b.lat], color, color2, start: monoNow(), dur: kind === 'super' ? 800 : kind === 'match' ? 1000 : 400 });
    this.startClock();
  }

  setPin(pin: PinPayload | null, fly: boolean): void {
    if (!pin || typeof pin.lat !== 'number' || typeof pin.lng !== 'number' || !Number.isFinite(pin.lat) || !Number.isFinite(pin.lng)) {
      this.pin = null;
      this.pinKey = '';
      this.pinAnimStart = 0;
      this.ch.set('pinLook', { dy: -70, alpha: 0 });
      this.publish('pin', EMPTY_FC);
      this.setRings({ pin: null });
      return;
    }
    this.pin = pin;
    const emoji = pin.emoji || '📍';
    const key = `pin|${emoji}|${pin.nightlife ? 1 : 0}|${RENDER_V}`;
    this.pinKey = key;
    // pedidos fora de ordem: só grava se ainda for o pino atual
    this.requestShared('pin', 'cz-pin-img', key, () => mapDraw.pin({ emoji, nightlife: Boolean(pin.nightlife) }), -1, () => this.pinKey === key);
    this.publish('pin', fc([point([pin.lng, pin.lat], { id: String(pin.id), label: String(pin.name || '').slice(0, 42), pulse: pin.nightlife ? 'n' : 'd', night: Boolean(pin.nightlife) })]));
    this.setRings({ pin: pin.nightlife ? 'n' : 'd' });
    this.pulseRings();
    if (!fly) {
      this.pinAnimStart = 0;
      this.ch.set('pinLook', { dy: 0, alpha: 1 });
      return;
    }
    this.ch.set('pinLook', { dy: -70, alpha: 0 });
    this.stopIdleCam();
    const s = this.camera.state;
    const zoom = Math.max(16.8, Math.min(17.5, s.zoom + 1));
    const bearing = s.bearing - 18;
    this.camera.move({ center: offsetCenter([pin.lng, pin.lat], 30, zoom, bearing, 60), zoom, pitch: 60, bearing, duration: 1700, mode: 'flyTo' }, (done) => {
      if (this.pin !== pin) return;
      // voo atropelado (gesto/outro movimento): o pino aparece direto, sem a queda nem o burst
      if (!done || this.reduceMotion) {
        this.ch.set('pinLook', { dy: 0, alpha: 1 });
        return;
      }
      this.pinAnimStart = monoNow();
      this.pulseRings(); // a onda do pino pulsa depois que ele cai
      this.startClock();
      setTimeout(() => {
        if (this.pin === pin) this.burst({ lat: pin.lat, lng: pin.lng, kind: pin.nightlife ? 'match' : 'like' });
      }, 380);
      this.scheduleIdleCam();
    });
  }

  // =====================================================================
  // Relógio: dorme quando nada anima; cada subsistema tem o seu ritmo
  // =====================================================================
  private startClock(): void {
    if (this.clockTimer != null || !this.active || this.disposed || !this.loaded) return;
    this.clockTimer = setTimeout(this.loop, 0);
  }

  private stopClock(): void {
    if (this.clockTimer != null) clearTimeout(this.clockTimer);
    this.clockTimer = null;
  }

  private readonly loop = (): void => {
    this.clockTimer = null;
    if (!this.active || this.disposed) return;
    const next = this.tick(monoNow());
    // o tick pode ter religado o relógio (updateCommitGap ao soltar o gesto chama startClock): um timer só, nunca dois
    if (next != null && this.clockTimer == null) this.clockTimer = setTimeout(this.loop, Math.max(4, next));
  };

  /** roda o que está vencido e devolve em quantos ms precisa voltar (null = nada anima: dorme) */
  private tick(now: number): number | null {
    let next = Infinity;
    const due = (last: number, every: number) => now - last >= every - 2;

    // fades, bursts e queda do pino
    const fast = this.tweens.length > 0 || this.fx.length > 0 || this.pinAnimStart > 0;
    if (fast) {
      if (due(this.lastFast, FAST_MS)) {
        this.lastFast = now;
        this.stepTweens(now);
        if (this.pinAnimStart) {
          const t = Math.min(1, (now - this.pinAnimStart) / 750);
          this.ch.set('pinLook', { dy: -70 * (1 - bounceOut(t)), alpha: Math.min(1, t * 4) });
          if (t >= 1) this.pinAnimStart = 0;
        }
      }
      if (due(this.lastFx, 50)) {
        this.lastFx = now;
        this.stepFx(now);
      } else if (!this.fx.length && this.countOf('fx')) this.publish('fx', EMPTY_FC);
      next = Math.min(next, FAST_MS);
    } else if (this.countOf('fx')) this.publish('fx', EMPTY_FC);

    // figuras: quem anda, quadros de animação, volta pra estática
    let anyFig = false;
    let walkers = 0;
    for (const f of this.figs.values()) {
      if (f.move) walkers++;
      // quadros na fila de quem já parou também acordam o passo (stopFrames tira eles da fila)
      if (f.move || f.one || f.frameKey || f.frameJobs.size) anyFig = true;
    }
    this.walkers = walkers;
    // multidão andando: os commits do mapa ficam mais espaçados (cada um é uma montagem na thread de UI)
    this.updateCommitGap();
    if (anyFig) {
      const every = walkers ? this.moversGap() : Math.round(1000 / 12);
      if (due(this.lastFigures, every)) {
        this.lastFigures = now;
        this.stepFigures(now);
      }
      next = Math.min(next, every);
    }

    // anéis/sonar/auras: pulsam até ringsUntil; depois um quadro fixo (RING_REST) e o mapa para de redesenhar. Com o dedo
    // no mapa nada disso sai (lote preso): o relógio nem acorda por eles e volta no fim do gesto
    const held = this.ch.isHeld;
    const ringFps = RING_FPS[this.tier] ?? 12;
    const ringsLive = !held && now < this.ringsUntil && this.ringsActive() && ringFps > 0;
    if (held) {
      // o anel fica no último desenho entregue
    } else if (ringsLive) {
      const every = Math.round(1000 / ringFps);
      if (due(this.lastRings, every)) {
        this.lastRings = now;
        this.ch.set('phase', (now / 1000) % 1000);
      }
      next = Math.min(next, every, this.ringsUntil - now);
    } else if (this.ch.get('phase') !== RING_REST) this.ch.set('phase', RING_REST);

    // partículas (só tier high, com âncora na tela, junto com o pulso dos anéis)
    if (held) {
      // idem
    } else if (ringsLive && this.particlesWanted()) {
      if (due(this.lastParticles, PARTICLES_MS)) {
        this.lastParticles = now;
        this.stepParticles(now);
      }
      next = Math.min(next, PARTICLES_MS);
    } else if (this.countOf('particles')) this.publish('particles', EMPTY_FC);

    return Number.isFinite(next) ? next : null;
  }

  private stepFigures(now: number): void {
    let moversDirty = false;
    let usersDirty = false;
    let meDirty = false;
    let spotDirty = false;
    // dedo no mapa: nada disso aparece (lote preso), então quem anda fica parado onde foi desenhado e retoma dali ao
    // soltar (updateCommitGap); quadro novo só pra eu, selecionado e match
    const held = this.ch.isHeld;
    // quem pode animar agora: eu, selecionado e o match sempre; depois os mais perto do centro que estão na tela
    const animating: Fig[] = [];
    for (const [id, f] of this.figs) {
      if (f.one && now - f.one.start > f.one.dur * 1000) f.one = null;
      if (f.move && !held) {
        const k = (now - f.move.start) / f.move.dur;
        if (k >= 1) {
          f.pos = f.move.to;
          f.move = null;
          if (f.own) f.one = { name: 'arrive', start: now, dur: DUR.arrive };
          if (id === 'me') meDirty = true;
          else {
            // segue na movers (já no ponto final) até a users republicar no ritmo dela: chegar não força envio da users
            f.parked = true;
            usersDirty = true;
            moversDirty = true;
          }
        } else {
          const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
          f.pos = [f.move.from[0] + (f.move.to[0] - f.move.from[0]) * e, f.move.from[1] + (f.move.to[1] - f.move.from[1]) * e];
          if (id === 'me') meDirty = true;
          else moversDirty = true;
        }
        if (id === this.selected || id === this.momentUserId) spotDirty = true;
      }
      if (f.own && f.user && (f.one || f.move)) animating.push(f);
      else this.stopFrames(f, now);
    }
    if (animating.length) {
      const s = this.camera.state;
      // longe (zoom baixo) a passada nem lê: só eu, o selecionado e o match animam. Movimento reduzido: ninguém troca de
      // quadro (a figura só desliza até o lugar novo)
      const near = s.zoom >= ANIM_MIN_ZOOM;
      const rank = (f: Fig) => (this.reduceMotion ? Infinity : this.isPinned(f.id) ? -1 : near && f.pos && inBounds(f.pos, s.bounds, 0.1) ? distM(f.pos, s.center) : Infinity);
      const ranked = animating
        .map((f) => ({ f, d: rank(f) }))
        .sort((a, b) => a.d - b.d);
      const cap = ANIM_CAP[this.tier] ?? ANIM_CAP.mid;
      let used = 0;
      for (const { f, d } of ranked) {
        if (d === -1 || (!held && d !== Infinity && used < cap)) {
          if (d !== -1) used += 1;
          this.applyFrame(f, now, d);
        } else this.stopFrames(f, now);
      }
    }
    // com o lote preso a fonte movers nem é montada (JSON de até 40 pessoas a 8–15 Hz pra nada): sai no fim do gesto
    if (moversDirty && !this.ch.isHeld && (usersDirty || now - this.lastMovers >= this.moversGap() - 2)) {
      this.lastMovers = now;
      this.pushMovers();
    }
    if (usersDirty) this.schedulePush(0);
    if (meDirty) this.pushMe();
    if (spotDirty) this.pushSpot();
  }

  /**
   * intervalo entre commits do mapa (mais espaçado com multidão andando) e, com o dedo no mapa, NENHUM commit: cada um é uma
   * montagem na thread de UI, a mesma que trata o gesto, e fazia a sobreposição RN redesenhar durante o arraste. O que mudou
   * no gesto sai num lote só quando ele acaba (moveend, 250 ms sem a câmera mexer)
   */
  private updateCommitGap(): void {
    this.ch.minGapMs = this.tier === 'low' || this.walkers > 15 ? COMMIT_GAP_MS.crowd : COMMIT_GAP_MS.normal;
    const gesture = this.camera.gestureActive && this.active && !this.disposed;
    if (gesture === this.ch.isHeld) return;
    this.ch.hold(gesture);
    const now = monoNow();
    if (gesture) {
      this.heldAt = now;
      return;
    }
    // soltou: a caminhada retoma de onde foi desenhada (sem isso os ~40 andantes pulavam de uma vez o que andaram no gesto:
    // 2 s de arraste + 1 s de inércia = ~4,5 m, 30–60 px no z18–19). Quem começou a andar no gesto parte de agora
    for (const f of this.figs.values()) if (f.move) f.move.start += now - Math.max(this.heldAt, f.move.start);
    // as vagas soltas no gesto esfriam no próximo push e o relógio retoma os anéis
    this.pushMovers();
    this.schedulePush(0);
    this.startClock();
  }

  /** ritmo da fonte movers: o do tier com pouca gente andando, mais espaçado com multidão (MOVERS_CROWD_MS) */
  private moversGap(): number {
    const base = MOVERS_MS[this.tier] ?? MOVERS_MS.mid;
    return this.walkers > 15 ? Math.max(base, MOVERS_CROWD_MS.many) : this.walkers > 6 ? Math.max(base, MOVERS_CROWD_MS.some) : base;
  }

  /** eu, o selecionado e o match: sempre animam e os quadros deles furam a fila */
  private isPinned(id: string): boolean {
    return id === 'me' || id === this.selected || id === this.momentUserId;
  }

  /** a figura não anima (acabou, saiu do teto ou da tela): tira da fila os quadros que ainda não rodaram e volta pra estática */
  private stopFrames(f: Fig, now: number): void {
    this.dropFrames(f);
    if (f.frameKey) this.endAnimation(f, now);
  }

  private dropFrames(f: Fig): void {
    if (!f.frameJobs.size) return;
    for (const key of f.frameJobs) mapImages.cancel(key);
    f.frameJobs.clear();
  }

  /** balde de quadros novos: FRAME_RATE por segundo; o adiantado só sai com folga (sobra pro quadro da vez) */
  private takeFrameToken(prefetch: boolean): boolean {
    const now = monoNow();
    const rate = FRAME_RATE[this.tier] ?? FRAME_RATE.mid;
    this.frameTokens = Math.min(rate, this.frameTokens + ((now - this.frameTokensAt) / 1000) * rate);
    this.frameTokensAt = now;
    if (this.frameTokens < (prefetch ? 2 : 1)) return false;
    this.frameTokens -= 1;
    return true;
  }

  /** fim da animação: espera STATIC_GRACE_MS (quadros em voo chegam antes) e volta pra pose neutra */
  private endAnimation(f: Fig, now: number): void {
    if (!f.staticAt) {
      f.staticAt = now + STATIC_GRACE_MS;
      return;
    }
    if (now < f.staticAt) return;
    f.staticAt = 0;
    f.frameKey = null;
    if (f.staticRef) this.showFig(f, f.staticRef);
    else this.wantStatic(f);
  }

  /**
   * Quadro da animação: pose calculada pelo tempo, quantizada (caminhada 12/8 fps, corrida 18/12, montado 10/8/6,
   * emotes 12, match 10, assinatura 12/10/8 com teto de quadros por tier) pra os quadros serem reaproveitados do cache
   * em disco. Se o quadro ainda não está pronto, fica o anterior. Com veículo, andar/correr vira 'ride'.
   */
  private applyFrame(f: Fig, now: number, dist: number): void {
    const u = f.user;
    if (!u) return;
    const def = u.avatarKey ? this.defs.get(u.avatarKey) : undefined;
    if (u.avatarKey && !def) return;
    f.staticAt = 0;
    const scene = def?.p.scene ?? null;
    const mount = scene?.mount ?? null;
    const one = f.one;
    const st: AnimState = one ? one.name : mount ? 'ride' : f.move?.run ? 'run' : 'walk';
    let sig: SigAssets | null = null;
    if (st === 'sig') {
      sig = def ? sigAssets(def) : null;
      if (!sig) {
        f.one = null;
        return;
      }
    }
    const loops = st === 'walk' || st === 'run' || st === 'ride';
    let k: number;
    let total: number;
    let tAt: (i: number) => number;
    if (st === 'walk' || st === 'run') {
      const freq = (st === 'walk' ? WALK.freq : RUN.freq) * f.v.sp; // ciclos por segundo (anim.gait)
      const fpsSt = st === 'walk' ? WALK_FPS[this.tier] : RUN_FPS[this.tier];
      total = Math.max(4, Math.round(fpsSt / freq));
      const elapsed = (now - (f.move?.start ?? now)) / 1000;
      k = Math.floor(elapsed * freq * total) % total;
      tAt = (i) => i / (freq * total);
    } else if (st === 'ride') {
      const period = ridePeriod(mount);
      total = Math.max(6, Math.round(period * (RIDE_FPS[this.tier] ?? 8)));
      const elapsed = (now - (f.move?.start ?? now)) / 1000;
      k = Math.floor((elapsed / period) * total) % total;
      tAt = (i) => (i * period) / total;
    } else {
      const dur = one?.dur ?? DUR[st];
      const fpsSt = sig ? Math.min(SIG_FPS[this.tier] ?? 10, (SIG_MAX_FRAMES[this.tier] ?? 28) / Math.max(0.5, dur)) : st === 'match' ? 10 : 12;
      total = Math.max(2, Math.ceil(dur * fpsSt));
      const elapsed = (now - (one?.start ?? now)) / 1000;
      k = Math.min(total - 1, Math.floor(elapsed * fpsSt));
      tAt = (i) => Math.min(dur, i / fpsSt);
    }
    const look = this.lookOf(u);
    const base = `fr|${u.avatarKey || 'sil'}|${this.lookSig(look)}|${f.dim.w}x${f.dim.h}|${st}|${total}|${f.mirror ? 1 : 0}|${f.v.ph.toFixed(3)}.${f.v.sp.toFixed(3)}.${f.v.en.toFixed(3)}|${figVersion()}`;
    const keyOf = (i: number) => `${base}|${i}`;
    const dim = f.dim;
    const mirror = f.mirror;
    const v = f.v;
    const sigDef = sig ? sig.def : null;
    const usesArms = usesArmsOf(st, sigDef);
    // braço solto só pra quem mexe os braços (o resto fica no repouso da pessoa)
    const x: AnimExtras = { rest: def && (usesArms || st === 'walk' || st === 'run') ? restArms(def) : null, sig: sigDef, mount, bob: (scene as { bob?: number } | null)?.bob ?? 0 };
    // a figura parada de qualquer um vem antes de quadro de animação (senão a fila de quadros, que nunca esvazia com
    // gente andando, deixava figura na silhueta por minutos); quadros de eu/selecionado/match logo depois das estáticas deles
    const pinned = dist < 0;
    /** j = 0 é o quadro da vez; 1..3 são os adiantados (vão depois, na ordem) */
    const request = (i: number, j: number) => {
      const key = keyOf(i);
      if (f.frameJobs.has(key) || mapImages.get(key)) return;
      if (!pinned && !this.takeFrameToken(j > 0)) return;
      const pri = pinned ? 0.5 + j * 0.01 : FRAME_PRIORITY * (j > 0 ? 2 : 1) + dist + j * 0.1;
      f.frameJobs.add(key);
      void mapImages
        .request(
          key,
          pri,
          () => {
            const t = tAt(i);
            // assinatura: expressão e objeto da animação trocados no quadro (como no palco)
            const d = sig && def ? { l: sig.layersAt(t / sig.def.dur), p: def.p } : (def ?? null);
            // a mão sai do guidão/volante/colo e volta junto com a entrada/saída da animação
            const armsW = !usesArms ? 0 : loops ? 1 : edgeW(t, one?.dur ?? DUR[st]);
            return mapDraw.figure(d, look, dim, pose(st, t, v, x), mirror, { usesArms: armsW });
          },
          IMG_SCALE,
        )
        .then(() => f.frameJobs.delete(key));
    };
    const key = keyOf(k);
    if (key !== f.frameKey) {
      const ref = mapImages.get(key);
      if (ref) {
        f.frameKey = key;
        this.showFig(f, ref);
      } else request(k, 0);
    }
    // adianta os próximos quadros
    for (let j = 1; j <= 3; j++) {
      const i = loops ? (k + j) % total : k + j;
      if (i < total) request(i, j);
    }
  }

  /** fades por feature-state (setFeatureState da fonte): no máximo ~5 degraus por fade (cada degrau é uma chamada ao nativo) */
  private stepTweens(now: number): void {
    if (!this.tweens.length) return;
    const keep: AlphaTween[] = [];
    const done: (() => void)[] = [];
    for (const t of this.tweens) {
      const k = (now - t.start) / t.dur;
      if (k < 0) {
        keep.push(t);
        continue;
      }
      const raw = t.from + (t.to - t.from) * (k >= 1 ? 1 : easeOutCubic(k));
      const v = k >= 1 ? t.to : Math.round(raw * 5) / 5;
      this.setAlpha(t.source, t.id, v, t.key);
      if (k < 1) keep.push(t);
      else if (t.onDone) done.push(t.onDone);
    }
    this.tweens = keep;
    for (const fn of done) fn();
  }

  private stepFx(now: number): void {
    if (!this.fx.length) {
      if (this.countOf('fx')) this.publish('fx', EMPTY_FC);
      return;
    }
    const feats: Feature[] = [];
    this.fx = this.fx.filter((x) => now - x.start < x.dur);
    for (const x of this.fx) {
      const p = easeOutCubic(Math.min(1, (now - x.start) / x.dur));
      feats.push(point(x.at, { id: x.id, color: x.color, color2: x.color2, p: Math.round(p * 1000) / 1000 }, x.id));
    }
    this.publish('fx', fc(feats));
  }

  // partículas ambientes (≤ 24 pontos, só tier high): vagalumes de dia, faíscas rosa/dourado à noite
  private retargetParticles(): void {
    const anchors: LngLat[] = [];
    if (this.me) anchors.push([this.me.lng, this.me.lat]);
    for (const id of this.hotIds) {
      const p = this.pois.get(id);
      if (p) anchors.push([p.longitude, p.latitude]);
    }
    this.anchors = anchors;
    while (this.particles.length < 24) {
      const i = this.particles.length;
      // determinístico (sem Math.random): o desenho não muda a cada abertura
      const h = (s: number) => {
        const x = Math.sin(i * 12.9898 + s * 78.233) * 43758.5453;
        return x - Math.floor(x);
      };
      this.particles.push({ a: h(1) * Math.PI * 2, r: 12 + h(2) * 40, sp: 0.3 + h(3) * 0.8, ph: h(4) * 10, k: Math.floor(h(5) * 100) });
    }
  }

  private particlesWanted(): boolean {
    const s = this.camera.state;
    if (this.tier !== 'high' || !this.anchors.length || s.zoom < 14) return false;
    return this.anchors.some((a) => inBounds(a, s.bounds, 0.2));
  }

  private stepParticles(now: number): void {
    const s = this.camera.state;
    const night = this.theme !== 'day';
    const b = s.bearing * DEG;
    const cosP = Math.max(0.3, Math.cos(s.pitch * DEG));
    const feats: Feature[] = [];
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      const an = this.anchors[p.k % this.anchors.length];
      const mpp = metersPerPixel(an[1], s.zoom);
      const t = (now / 1000) * p.sp + p.ph;
      const x = Math.cos(t + p.a) * p.r;
      const y = Math.sin(t * 1.3 + p.a) * p.r * 0.6 - ((t * 6) % 40);
      // px de tela → metros no chão (eixo x da tela = bearing+90°, "pra cima" = bearing; vertical esticado pelo pitch)
      const right = x * mpp;
      const up = (-y * mpp) / cosP;
      const east = right * Math.cos(b) + up * Math.sin(b);
      const north = -right * Math.sin(b) + up * Math.cos(b);
      const alpha = 0.35 + 0.35 * Math.sin(t * 2);
      const color = night ? (i % 2 ? '#FF1493' : '#FFD700') : '#7FFF00';
      feats.push(point(offsetMeters(an, east, north), { c: color, o: Math.round(alpha * 100) / 100, r: 1.6 + (i % 3) * 0.6 }));
    }
    this.publish('particles', fc(feats));
  }

  // =====================================================================
  // LOD: quem ganha bolha de foto (zoom ≥ 14, na tela ou até 30% fora)
  // =====================================================================
  private updateLod(): void {
    const s = this.camera.state;
    const wantPhotos = s.zoom >= PHOTO_MIN_ZOOM && this.active;
    const now = Date.now();
    const prio = new Map<string, number>();
    for (const [id, f] of this.figs) {
      if (!f.pos || id === 'me') continue;
      if (!inBounds(f.pos, s.bounds, 0.3)) continue;
      const d = distM(f.pos, s.center);
      if (f.ph) prio.set(f.ph.url, d);
      if (wantPhotos && f.own && !f.leaving && f.user?.photo && !f.ph && !(f.phWait > now)) this.ensureBubble(f, d);
    }
    mapPhotos.reprioritize((url) => prio.get(url) ?? 1e8);
  }

  // =====================================================================
  // idle-cam: rotação curta (25° em 20 s), UMA vez, só em tier high, ativo, sem gesto há 30 s
  // =====================================================================
  private scheduleIdleCam(): void {
    this.stopIdleCam();
    if (this.tier !== 'high' || !this.active || this.reduceMotion || this.disposed) return;
    this.idleTimer = setTimeout(() => this.spin(), 30_000);
  }

  private spin(): void {
    this.idleTimer = null;
    if (this.tier !== 'high' || !this.active || Date.now() - this.camera.lastGestureAt < 30_000) {
      this.scheduleIdleCam();
      return;
    }
    this.spinning = true;
    // terminou ou foi atropelado (gesto/outro movimento): não reagenda, volta no próximo reveal/setPin/setActive. Girar
    // de novo a cada 50 s deixava o mapa parado redesenhando a 60 fps por 20 s de cada 50
    this.camera.move({ bearing: this.camera.state.bearing + 25, duration: 20_000, mode: 'linearTo' }, () => {
      this.spinning = false;
    });
  }

  private stopIdleCam(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    if (this.spinning) {
      this.spinning = false;
      this.camera.stop();
    }
  }
}
