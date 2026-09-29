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
import { AccessibilityInfo } from 'react-native';
import type { CameraRef, GeoJSONSourceRef, MapRef, ViewStateChangeEvent } from '@maplibre/maplibre-react-native';
import Supercluster from 'supercluster';
import type { POI } from '@cruzei/shared-types';

import type { AvatarDefs, BurstPayload, CameraOpts, EmoteKind, MapCommand, MapDataPayload, MapEvent, MapPadding, MapTheme, MapUser, MeState, PerfTier, PinPayload, InitTier } from '../../bridge';
import { BUB, IMG, IMG_SCALE, bubbleOffset, figOffset, type AvatarDef, type BubbleStyle, type Dim, type EmoteState, type FigureLook, type MapImageEntry, type MapImageRef, type PoseVariation } from '../contracts';
import { mapDraw } from '../images/draw';
import { DUR, pose, sizeFor, variationFor } from '../images/anim';
import { mapImages } from '../images/store';
import { mapPhotos } from '../images/photos';
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

export interface MapChannels {
  users: FC;
  usersBoost: FC;
  movers: FC;
  spot: FC;
  me: FC;
  sel: FC;
  fx: FC;
  pois: FC;
  pin: FC;
  moment: FC;
  particles: FC;
  images: ImageGroups;
  /** relógio das animações de paint (s) — só muda com algo em rings */
  phase: number;
  rings: RingsState;
  look: MapLook;
  /** prédios crescendo no 1º load: 0 → 1 (a transição de 900 ms é nativa) */
  buildingScale: number;
  /** queda do pino da busca */
  pinLook: { dy: number; alpha: number };
  /** amostra de fps ligada só com a câmera em movimento */
  frameEvents: boolean;
  /** névoa do horizonte: 0 (pitch 0) → 1 (pitch 60), em degraus de 0,05 */
  horizon: number;
  [key: string]: unknown;
}

export const EMPTY_FC: FC = { type: 'FeatureCollection', features: [] };
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
} as const;
const PERSON_SOURCES = [SRC.users, SRC.usersBoost, SRC.movers, SRC.spot];

/** camadas que contam como toque numa pessoa */
export const TAP_PERSON_LAYERS = ['cz-users', 'cz-users-photo', 'cz-users-boost', 'cz-users-boost-photo', 'cz-movers', 'cz-movers-photo', 'cz-spot', 'cz-spot-photo', 'cz-users-dot', 'cz-users-boost-dot', 'cz-movers-dot'];
const TAP_LAYERS = [...TAP_PERSON_LAYERS, 'cz-poi', 'cz-cluster', 'cz-cluster-count', 'cz-pin'];

const MAX_USERS = 300;
/** grupos (supercluster): mesmos raio e zoom máximo do antigo cluster nativo; acima de 21 ninguém se agrupa */
const CLUSTER_RADIUS = 70;
const CLUSTER_MAX_ZOOM = 21;
const WORLD_BBOX: GeoJSON.BBox = [-180, -85, 180, 85];
/** 'ready' de reserva: o MapLibre só avisa o fim do load com todos os tiles da tela carregados (OpenFreeMap sem SLA) */
const READY_FALLBACK_MS = 6000;
const HORIZON_THROTTLE_MS = 80;
/** teto de figuras próprias por tier (o resto usa a silhueta) — memória de textura no Moto g54 */
const FIG_CAP: Record<PerfTier, number> = { high: 90, mid: 60, low: 40 };
/** teto de figuras animando ao mesmo tempo (eu, selecionado e o match sempre animam); o resto desliza parado */
const ANIM_CAP: Record<PerfTier, number> = { high: 10, mid: 6, low: 3 };
/** fps dos quadros: caminhada, corrida */
const WALK_FPS: Record<PerfTier, number> = { high: 12, mid: 8, low: 8 };
const RUN_FPS: Record<PerfTier, number> = { high: 18, mid: 12, low: 12 };
/** fps dos anéis/sonar/auras (paint constante, sem relayout) */
const RING_FPS: Record<PerfTier, number> = { high: 20, mid: 15, low: 8 };
const PHOTO_MIN_ZOOM = 14;
/** ritmos do relógio (ms) */
const FAST_MS = 33; // fades, bursts, queda do pino
const MOVERS_MS = 66; // quem anda (fonte movers) ~15 Hz
const PARTICLES_MS = 100;
const PUSH_MIN_MS = 200; // republicar a fonte users (clusterizada, até 300 features) no máximo 5x/s
/** acima disso, quem sai some direto (cada passo do fade é uma chamada ao nativo por pessoa) */
const LEAVE_FADE_MAX = 15;
/** espera depois de registrar uma imagem nova antes de apontar a feature pra ela (o nativo decodifica assíncrono) */
const IMAGE_SETTLE_MS = 160;
/** fim da animação: espera os quadros em voo chegarem antes de voltar pra estática (senão um quadro atrasado vence) */
const STATIC_GRACE_MS = 250;
/** versão do desenho: muda quando draw.ts mudar o visual (invalida o cache em disco) */
const RENDER_V = 'r1x' + IMG_SCALE;
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
  matchId: string | null;
  pos: LngLat;
}

interface Fig {
  id: string;
  user: FigUser | null;
  pos: LngLat | null;
  move: { from: LngLat; to: LngLat; start: number; dur: number; run: boolean } | null;
  one: { name: EmoteState; start: number } | null;
  mirror: boolean;
  v: PoseVariation;
  sz: number;
  /** tem figura própria (dentro do teto) */
  own: boolean;
  dim: Dim;
  staticKey: string | null;
  staticRef: MapImageRef | null;
  /** a imagem av-<id> já está registrada e a feature pode apontar pra ela */
  imgReady: boolean;
  settling: boolean;
  frameKey: string | null;
  /** fim da animação: quando voltar pra estática */
  staticAt: number;
  leaving: number;
  moment: boolean;
  ph: { url: string; sig: string; ready: boolean; settling?: boolean } | null;
  phWait: number;
  /** fontes em que o feature-state 'a' ficou diferente de 1 (pra limpar quando a pessoa sai de vez) */
  alphaDirty: Set<string>;
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
  const f: Feature = { type: 'Feature', properties, geometry: { type: 'Point', coordinates: coords } };
  if (id != null) f.id = id;
  return f;
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
    users: EMPTY_FC,
    usersBoost: EMPTY_FC,
    movers: EMPTY_FC,
    spot: EMPTY_FC,
    me: EMPTY_FC,
    sel: EMPTY_FC,
    fx: EMPTY_FC,
    pois: EMPTY_FC,
    pin: EMPTY_FC,
    moment: EMPTY_FC,
    particles: EMPTY_FC,
    images: {},
    phase: 0,
    rings: NO_RINGS,
    look: { theme: 'day', tier: 'high' },
    buildingScale: 0,
    pinLook: { dy: -70, alpha: 0 },
    frameEvents: false,
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
  private lastHorizonAt = 0;
  private width = 0;
  private height = 0;

  // ---------- estado (espelha o `state` do WebView) ----------
  private theme: MapTheme;
  private tier: PerfTier = 'high';
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
  private imagesDirty = false;

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
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPushAt = 0;
  private moveEndTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private spinning = false;

  // ---------- medição de fps ----------
  private frameStamps: number[] = [];
  private lastCameraMoveAt = 0;

  private disposed = false;

  constructor(private readonly deps: EngineDeps) {
    this.theme = deps.initTheme;
    this.initTier = deps.initTier;
    if (deps.initTier !== 'auto') this.tier = deps.initTier;
    this.camera = new CameraCtl(() => this.camRef?.current ?? null);
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
  }

  private emit(ev: MapEvent): void {
    if (!this.disposed) this.deps.emit(ev);
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
    this.lastCameraMoveAt = Date.now();
    // amostra de fps só com a câmera andando (parado, o mapa repinta no ritmo dos anéis e isso não mede o aparelho)
    if (this.active && !this.ch.get('frameEvents')) this.ch.set('frameEvents', true);
    // 'moveend' = 250 ms sem a câmera mexer. O onRegionDidChange não serve sozinho: um dedo parado no meio do gesto não
    // gera idle, e o fim das animações nossas é estimado por timer
    if (this.moveEndTimer) clearTimeout(this.moveEndTimer);
    this.moveEndTimer = setTimeout(() => this.moveEnded(), 250);
  }

  /** onRegionDidChange (câmera ociosa: gesto e fling acabaram): o padding pendente entra (era o onMapIdle) */
  onRegionDidChange(e: ViewStateChangeEvent): void {
    this.updateCamera(e, false);
    this.camera.flushPadding();
  }

  private moveEnded(): void {
    this.moveEndTimer = null;
    if (this.disposed) return;
    // 250 ms sem mexer: se o payload não trouxe o fim do gesto (dedo parado), não segura o padding pra sempre
    this.camera.gestureActive = false;
    this.camera.flushPadding();
    const s = this.camera.state;
    let userMoved = this.camera.takeGesture();
    const animated = this.camera.takeAnimated();
    const prev = this.lastMoveEnd;
    if (!userMoved && !animated && this.camera.programmatic === 0 && prev && (Math.abs(prev.zoom - s.zoom) > 0.05 || distM(prev.center, s.center) > 15)) userMoved = true;
    this.lastMoveEnd = { center: s.center, zoom: s.zoom };
    if (this.located) this.emit({ type: 'moveend', lat: s.center[1], lng: s.center[0], zoom: s.zoom, userMoved });
    this.ch.set('frameEvents', false);
    const fps = this.estimateFps();
    if (fps != null) this.emit({ type: 'perf', fps });
    this.updateLod();
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
    // grupos mudam no zoom inteiro (igual ao cluster por tile do nativo)
    if (this.usersIndex && clusterZoomOf(cam.zoom) !== this.clusterZoom) this.publishClusters();
    this.updateHorizon(cam.pitch);
    return true;
  }

  /** névoa do horizonte proporcional ao pitch, com throttle (a última mudança sempre entra) */
  private updateHorizon(pitch: number): void {
    const q = Math.round(Math.min(1, Math.max(0, pitch / MAX_PITCH)) * 20) / 20;
    if (q === this.ch.get('horizon')) return;
    const wait = this.lastHorizonAt + HORIZON_THROTTLE_MS - Date.now();
    if (wait > 0) {
      if (!this.horizonTimer) {
        this.horizonTimer = setTimeout(() => {
          this.horizonTimer = null;
          this.updateHorizon(this.camera.state.pitch);
        }, wait);
      }
      return;
    }
    this.lastHorizonAt = Date.now();
    this.ch.set('horizon', q);
  }

  /** onDidFinishRenderingFrameFully: o MLRN manda todo quadro; só conta com a amostra ligada e a câmera andando */
  onRenderFrame(): void {
    if (!this.ch.get('frameEvents')) return;
    const now = Date.now();
    if (now - this.lastCameraMoveAt > 120) return;
    this.frameStamps.push(now);
    if (this.frameStamps.length > 600) this.frameStamps.shift();
  }

  /** fps = mediana do intervalo entre quadros com a câmera andando */
  private estimateFps(): number | null {
    const st = this.frameStamps;
    const iv: number[] = [];
    for (let i = 1; i < st.length; i++) {
      const d = st[i] - st[i - 1];
      // < 8 ms é lote de eventos entregue de uma vez com a thread JS ocupada (o carimbo é da chegada, não do quadro)
      if (d >= 8 && d < 250) iv.push(d);
    }
    this.frameStamps = [];
    if (iv.length < 20) return null;
    iv.sort((a, b) => a - b);
    return Math.min(60, Math.round(1000 / iv[Math.floor(iv.length / 2)]));
  }

  /** toque no mapa: uma consulta só, com prioridade pino > pessoa > grupo > lugar > mapa vazio */
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
      this.emote(uid, 'arrive');
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
      if (this.ch.get('particles').features.length) this.ch.set('particles', EMPTY_FC);
    }
    this.startClock();
  }

  setActive(active: boolean): void {
    this.active = Boolean(active);
    if (this.active) {
      this.startClock();
      this.scheduleIdleCam();
    } else {
      this.stopClock();
      this.stopIdleCam();
      this.ch.set('frameEvents', false);
      if (this.ch.get('particles').features.length) this.ch.set('particles', EMPTY_FC);
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
  private setImage(group: string, name: string, ref: MapImageRef): void {
    const cur = this.groups.get(group);
    const uri = ref.path;
    if (cur && cur[name] && cur[name].source.uri === uri) return;
    this.groups.set(group, { ...(cur ?? {}), [name]: { source: { uri, scale: ref.scale } } });
    this.markImagesDirty();
  }

  private dropGroup(group: string): void {
    if (!this.groups.delete(group)) return;
    this.markImagesDirty();
  }

  private markImagesDirty(): void {
    if (this.imagesDirty) return;
    this.imagesDirty = true;
    // junta várias trocas do mesmo tick num commit só
    void Promise.resolve().then(() => {
      this.imagesDirty = false;
      const out: ImageGroups = {};
      for (const [k, v] of this.groups) out[k] = v;
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
    this.requestShared('base', GENERIC_FIG, P('fig-generic'), () => mapDraw.figure(null, { recent: true, boosted: false, premiumTier: 'free', verified: false, aura: '', anonymous: false }, IMG.fig, null, false), -2);
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
        imgReady: false,
        settling: false,
        frameKey: null,
        staticAt: 0,
        leaving: 0,
        moment: false,
        ph: null,
        phWait: 0,
        alphaDirty: new Set(),
      };
      this.figs.set(id, f);
    }
    return f;
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

  private groupOf(f: Fig): string {
    return 'p:' + f.id;
  }

  private imgName(f: Fig): string {
    return 'av-' + f.id;
  }

  /** prioridade de desenho: eu, selecionado e o match primeiro; depois quem está mais perto do centro */
  private priorityOf(f: Fig): number {
    if (f.id === 'me' || f.id === this.selected || f.id === this.momentUserId) return 0;
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
    const key = `fig|${u.avatarKey || 'sil'}|${this.lookSig(look)}|${f.dim.w}x${f.dim.h}|n|${f.mirror ? 1 : 0}|${RENDER_V}`;
    if (f.staticKey === key && f.staticRef) {
      if (!f.frameKey) this.showFig(f, f.staticRef);
      return;
    }
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
        if (!ref || !this.alive(f) || f.staticKey !== key) return;
        f.staticRef = ref;
        if (!f.frameKey) this.showFig(f, ref);
      })
      .catch(() => {});
  }

  private showFig(f: Fig, ref: MapImageRef): void {
    if (!f.own) return;
    this.setImage(this.groupOf(f), this.imgName(f), ref);
    if (!f.imgReady && !f.settling) {
      // a feature só aponta pra av-<id> depois que o nativo teve tempo de decodificar (senão pisca o placeholder)
      f.settling = true;
      setTimeout(() => {
        f.settling = false;
        if (!this.alive(f)) return;
        f.imgReady = true;
        if (f.id === 'me') this.pushMe();
        else this.schedulePush(0);
      }, IMAGE_SETTLE_MS);
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
      this.dropGroup(this.groupOf(f));
    }
    f.dim = IMG.fig;
  }

  private removeFig(id: string): void {
    const f = this.figs.get(id);
    if (!f) return;
    // invalida o objeto: toda tarefa assíncrona em voo (desenho, foto) cai fora nos guards
    f.own = false;
    f.ph = null;
    f.staticKey = null;
    this.dropGroup(this.groupOf(f));
    // o feature-state fica guardado por id na fonte mesmo sem a feature: quem voltar não pode nascer invisível
    for (const src of f.alphaDirty) this.setAlpha(src, id, 1);
    this.figs.delete(id);
  }

  /** quem ganha figura própria: selecionado/momento/boost/match sempre; depois os mais perto de mim (ou do centro) */
  private ownFigureSet(users: MapUser[]): Set<string> | null {
    const cap = FIG_CAP[this.tier] ?? FIG_CAP.mid;
    if (users.length <= cap) return null;
    const ref: LngLat = this.me ? [this.me.lng, this.me.lat] : this.camera.state.center;
    const k = Math.cos(ref[1] * DEG);
    const ranked: { id: string; d: number }[] = [];
    for (const u of users) {
      if (!u?.mapPosition) continue;
      const pinned = u.id === this.selected || u.id === this.momentUserId || u.isBoosted || Boolean(u.matchId);
      const dx = (u.mapPosition.lng - ref[0]) * k;
      const dy = u.mapPosition.lat - ref[1];
      ranked.push({ id: u.id, d: pinned ? -1 : dx * dx + dy * dy });
    }
    ranked.sort((a, b) => a.d - b.d);
    return new Set(ranked.slice(0, cap).map((r) => r.id));
  }

  defineAvatars(defs: AvatarDefs): void {
    if (!defs) return;
    for (const key of Object.keys(defs)) {
      const d = defs[key];
      if (!d || !Array.isArray(d.l) || !d.l.length) continue;
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

  emote(id: string, kind: EmoteKind): void {
    const f = this.figs.get(id);
    if (!f || !DUR[kind] || !f.own) return;
    f.one = { name: kind, start: Date.now() };
    f.staticAt = 0;
    this.startClock();
  }

  /** caminhada até `to` em tempo proporcional à distância (1,5 m/s; 1,2–9 s); longe demais = teleporte */
  private startMove(f: Fig, to: LngLat, now: number): void {
    if (!f.pos) {
      f.pos = to;
      return;
    }
    // mesmo destino de uma caminhada em curso: segue andando (refetch ou heading não reiniciam o passo)
    if (f.move && distM(f.move.to, to) < 3) return;
    const d = distM(f.pos, to);
    if (d < 3) {
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
    if (u.matchId) {
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
    this.setImage(this.groupOf(f), 'ph-' + f.id, ref);
    if (ph.ready || ph.settling) return;
    // a feature só aponta pra ph-<id> depois que o nativo teve tempo de decodificar (senão pisca o placeholder)
    ph.settling = true;
    setTimeout(() => {
      ph.settling = false;
      if (!this.alive(f) || f.ph !== ph) return;
      ph.ready = true;
      if (f.id === 'me') {
        this.pushMe();
        return;
      }
      // a foto chega com fade de 300 ms (o thumb aparecia transparente e acendia, no original)
      for (const s of PERSON_SOURCES) this.setAlpha(s, f.id, 0, 'pa');
      const now = Date.now();
      this.addTween({ source: this.spotSourceOf(f.id), id: f.id, key: 'pa', from: 0, to: 1, start: now, dur: 300 });
      this.addTween({ source: SRC.spot, id: f.id, key: 'pa', from: 0, to: 1, start: now, dur: 300 });
      this.schedulePush(0);
    }, IMAGE_SETTLE_MS);
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
    // a imagem fica no grupo até a pessoa sair (o grupo desmonta e leva junto); a feature só para de apontar pra ela
    if (wasReady) {
      if (f.id === 'me') this.pushMe();
      else this.schedulePush(0);
    }
  }

  // =====================================================================
  // Features
  // =====================================================================
  /**
   * Silhueta provisória com o visual da pessoa (anel de presença, aura, anel premium, selo, véu anônimo) enquanto o
   * desenho do avatar não fica pronto ou pra quem está fora do teto de figuras. Poucas combinações, compartilhadas.
   */
  private placeholderOf(u: FigUser, dim: Dim, mirror: boolean): string {
    const look = this.lookOf(u);
    const key = `sil|${this.lookSig(look)}|${dim.w}x${dim.h}|${mirror ? 1 : 0}|${RENDER_V}`;
    const ready = this.silReady.get(key);
    if (ready) return ready;
    if (!this.silPending.has(key)) {
      const name = 'sil-' + (this.silPending.size + 1);
      this.silPending.set(key, name);
      mapImages
        .request(key, -1.5, () => mapDraw.figure(null, look, dim, null, mirror), IMG_SCALE)
        .then((ref) => {
          if (!ref || this.disposed) return;
          this.setImage('sil', name, ref);
          setTimeout(() => {
            this.silReady.set(key, name);
            this.schedulePush(0);
            this.pushMe();
          }, IMAGE_SETTLE_MS);
        })
        .catch(() => {});
    }
    return GENERIC_FIG;
  }

  private featureFor(u: FigUser, f: Fig, coords: LngLat, szMul = 1): Feature {
    const dim = f.own ? f.dim : IMG.fig;
    const props: Record<string, unknown> = {
      id: u.id,
      img: f.own && f.imgReady ? this.imgName(f) : this.placeholderOf(u, dim, f.mirror),
      off: [0, Math.round(figOffset(dim) * 100) / 100],
      sz: Math.round(f.sz * szMul * 1000) / 1000,
    };
    // campos vazios ficam de fora (menos JSON a cada republicação da fonte)
    const label = u.isAnonymous ? '' : u.label || u.name || '';
    if (label) props.label = label;
    if (u.isAnonymous) props.anon = true;
    if (!u.isBoosted && u.premiumTier === 'premium_plus') props.aura = 'aura-plus';
    if (f.ph?.ready) {
      props.ph = 'ph-' + f.id;
      props.poff = [0, Math.round(bubbleOffset(dim) * 100) / 100];
    }
    return point(coords, props, u.id);
  }

  /** republica as fontes de pessoas no máximo a cada PUSH_MIN_MS (chegadas, saídas, figuras e bolhas prontas) */
  private schedulePush(delay: number): void {
    if (this.disposed) return;
    const due = Math.max(Date.now() + delay, this.lastPushAt + PUSH_MIN_MS);
    if (this.pushTimer) return; // já tem um marcado: esse também entra nele
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      this.pushUsers();
      this.pushSpot();
    }, Math.max(0, due - Date.now()));
  }

  /** sem feature-state (MLRN sem o patch) a figura destacada sai das fontes de baixo, senão aparece dobrada sob o spot */
  private hiddenBySpot(): string | null {
    return this.noFeatureState ? this.momentUserId || this.selected : null;
  }

  /** monta as 3 fontes de pessoas: paradas (agrupadas), com boost e andando (posição interpolada) */
  private pushUsers(): void {
    this.lastPushAt = Date.now();
    const normal: Feature[] = [];
    const boosted: Feature[] = [];
    const movers: Feature[] = [];
    const hidden = this.hiddenBySpot();
    let aura = false;
    for (const [id, u] of this.users) {
      const f = this.figOf(id);
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
    this.ch.set('usersBoost', fc(boosted));
    this.ch.set('movers', fc(movers));
    this.setRings({ aura, auraBoost: boosted.length > 0 });
  }

  /** reindexa os grupos com as pessoas paradas e publica a fonte users no zoom atual */
  private loadClusters(points: Feature[]): void {
    this.prevUsersIndex = this.usersIndex;
    if (!points.length) {
      this.usersIndex = null;
      this.clusterZoom = -1;
      this.ch.set('users', EMPTY_FC);
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
    this.ch.set('users', fc(index.getClusters(WORLD_BBOX, z) as Feature[]));
  }

  private pushMovers(): void {
    const movers: Feature[] = [];
    const hidden = this.hiddenBySpot();
    for (const [id, u] of this.users) {
      const f = this.figs.get(id);
      if (f?.move && f.pos && id !== hidden) movers.push(this.featureFor(u, f, f.pos, u.isBoosted ? 1.17 : 1));
    }
    this.ch.set('movers', fc(movers));
  }

  private pushMe(): void {
    const f = this.figs.get('me');
    if (!f?.pos || !this.me) return;
    const dim = f.dim;
    const props: Record<string, unknown> = { img: f.imgReady ? this.imgName(f) : f.user ? this.placeholderOf(f.user, dim, f.mirror) : GENERIC_FIG, off: [0, figOffset(dim)] };
    if (typeof this.me.heading === 'number') props.heading = this.me.heading;
    if (f.ph?.ready) {
      props.ph = 'ph-me';
      props.poff = [0, bubbleOffset(dim)];
    }
    this.ch.set('me', fc([point(f.pos, props)]));
    this.setRings({ me: true });
  }

  private spotSourceOf(id: string): string {
    const f = this.figs.get(id);
    const u = this.users.get(id);
    return f?.move ? SRC.movers : u?.isBoosted ? SRC.usersBoost : SRC.users;
  }

  private pushSpot(): void {
    const id = this.momentUserId || this.selected;
    const u = id ? this.users.get(id) : undefined;
    const f = id ? this.figs.get(id) : undefined;
    if (!u || !f?.pos) {
      if (this.ch.get('spot').features.length) this.ch.set('spot', EMPTY_FC);
      this.setRings({ spotAura: null });
      return;
    }
    const feat = this.featureFor(u, f, f.pos, u.isBoosted ? 1.17 : 1);
    if (u.isBoosted) (feat.properties as Record<string, unknown>).aura = 'aura-boost';
    this.ch.set('spot', fc([feat]));
    this.setRings({ spotAura: u.isBoosted ? 'boost' : u.premiumTier === 'premium_plus' ? 'plus' : null });
  }

  // =====================================================================
  // Dados: diff por id, entrada escalonada, hotspotBorn
  // =====================================================================
  setData(payload: MapDataPayload): void {
    const users = (payload?.users ?? []).slice(0, MAX_USERS);
    const pois = payload?.pois ?? [];
    if (typeof payload?.hotMin === 'number') this.hotMin = payload.hotMin;
    const now = Date.now();
    const isFirst = !this.hadData;
    const prev = this.users;
    const next = new Map<string, FigUser>();
    const newIds: { id: string; boosted: boolean }[] = [];
    const own = this.ownFigureSet(users);

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
        matchId: raw.matchId ?? null,
        pos: to,
      };
      next.set(u.id, u);
      if (!own || own.has(u.id)) this.ensureOwn(u);
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
      // posição mudou: a pessoa ANDA até lá; na 1ª carga todo mundo já nasce no lugar
      if ((prev.has(u.id) || wasLeaving) && !isFirst) this.startMove(f, to, now);
      else {
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
    this.ch.set('pois', fc(feats));
    this.setRings({ sonar: sonarLevels });
    for (const h of newHot) {
      this.emit({ type: 'hotspotBorn', ...h });
      const p = this.pois.get(h.poiId);
      if (p) this.burst({ lat: p.latitude, lng: p.longitude, kind: 'match' });
    }
    this.hadData = true;
    this.retargetParticles();
    this.startClock();
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
      matchId: null,
      pos: [me.lng, me.lat],
    };
    const f = this.figOf('me');
    const to: LngLat = [me.lng, me.lat];
    // só a posição mexe na caminhada (o heading chega a cada 100 ms e reiniciaria o passo)
    if (!f.pos) f.pos = to;
    else if (moved) this.startMove(f, to, Date.now());
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
    this.addTween({ source, id, key: 'a', from, to, start: Date.now(), dur, onDone });
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
    this.ch.set('sel', u ? fc([point(u.pos, {})]) : EMPTY_FC);
    this.setRings({ sel: Boolean(u) });
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
    if (this.ch.get('moment').features.length) this.ch.set('moment', EMPTY_FC);
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
      this.ch.set('sel', fc([point(su.pos, {})]));
      this.spotIn(this.selected);
    }
    if (!this.selected) {
      this.ch.set('sel', EMPTY_FC);
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
    this.ch.set('moment', fc([{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } }]));

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
    this.ch.set('sel', fc([point(b, {})]));
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
    this.fx.push({ id: `fx-${++this.fxSeq}`, at: [b.lng, b.lat], color, color2, start: Date.now(), dur: kind === 'super' ? 800 : kind === 'match' ? 1000 : 400 });
    this.startClock();
  }

  setPin(pin: PinPayload | null, fly: boolean): void {
    if (!pin || typeof pin.lat !== 'number' || typeof pin.lng !== 'number' || !Number.isFinite(pin.lat) || !Number.isFinite(pin.lng)) {
      this.pin = null;
      this.pinKey = '';
      this.pinAnimStart = 0;
      this.ch.set('pinLook', { dy: -70, alpha: 0 });
      this.ch.set('pin', EMPTY_FC);
      this.setRings({ pin: null });
      return;
    }
    this.pin = pin;
    const emoji = pin.emoji || '📍';
    const key = `pin|${emoji}|${pin.nightlife ? 1 : 0}|${RENDER_V}`;
    this.pinKey = key;
    // pedidos fora de ordem: só grava se ainda for o pino atual
    this.requestShared('pin', 'cz-pin-img', key, () => mapDraw.pin({ emoji, nightlife: Boolean(pin.nightlife) }), -1, () => this.pinKey === key);
    this.ch.set('pin', fc([point([pin.lng, pin.lat], { id: String(pin.id), label: String(pin.name || '').slice(0, 42), pulse: pin.nightlife ? 'n' : 'd', night: Boolean(pin.nightlife) })]));
    this.setRings({ pin: pin.nightlife ? 'n' : 'd' });
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
      this.pinAnimStart = Date.now();
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
    const next = this.tick(Date.now());
    if (next != null) this.clockTimer = setTimeout(this.loop, Math.max(4, next));
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
      } else if (!this.fx.length && this.ch.get('fx').features.length) this.ch.set('fx', EMPTY_FC);
      next = Math.min(next, FAST_MS);
    } else if (this.ch.get('fx').features.length) this.ch.set('fx', EMPTY_FC);

    // figuras: quem anda, quadros de animação, volta pra estática
    let anyFig = false;
    let anyMover = false;
    for (const f of this.figs.values()) {
      if (f.move) anyMover = true;
      if (f.move || f.one || f.frameKey) anyFig = true;
    }
    if (anyFig) {
      const every = anyMover ? MOVERS_MS : Math.round(1000 / 12);
      if (due(this.lastFigures, every)) {
        this.lastFigures = now;
        this.stepFigures(now);
      }
      next = Math.min(next, every);
    }

    // anéis/sonar/auras
    const ringFps = RING_FPS[this.tier] ?? 12;
    if (this.ringsActive() && ringFps > 0) {
      const every = Math.round(1000 / ringFps);
      if (due(this.lastRings, every)) {
        this.lastRings = now;
        this.ch.set('phase', (now / 1000) % 1000);
      }
      next = Math.min(next, every);
    }

    // partículas (só tier high, com âncora na tela)
    if (this.particlesWanted()) {
      if (due(this.lastParticles, PARTICLES_MS)) {
        this.lastParticles = now;
        this.stepParticles(now);
      }
      next = Math.min(next, PARTICLES_MS);
    } else if (this.ch.get('particles').features.length) this.ch.set('particles', EMPTY_FC);

    return Number.isFinite(next) ? next : null;
  }

  private stepFigures(now: number): void {
    let moversDirty = false;
    let usersDirty = false;
    let meDirty = false;
    let spotDirty = false;
    // quem pode animar agora: eu, selecionado e o match sempre; depois os mais perto do centro que estão na tela
    const animating: Fig[] = [];
    for (const [id, f] of this.figs) {
      if (f.one && now - f.one.start > DUR[f.one.name] * 1000) f.one = null;
      if (f.move) {
        const k = (now - f.move.start) / f.move.dur;
        if (k >= 1) {
          f.pos = f.move.to;
          f.move = null;
          if (f.own) f.one = { name: 'arrive', start: now };
          if (id === 'me') meDirty = true;
          else usersDirty = true;
        } else {
          const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
          f.pos = [f.move.from[0] + (f.move.to[0] - f.move.from[0]) * e, f.move.from[1] + (f.move.to[1] - f.move.from[1]) * e];
          if (id === 'me') meDirty = true;
          else moversDirty = true;
        }
        if (id === this.selected || id === this.momentUserId) spotDirty = true;
      }
      if (f.own && f.user && (f.one || f.move)) animating.push(f);
      else if (f.frameKey) this.endAnimation(f, now);
    }
    if (animating.length) {
      const center = this.camera.state.center;
      const bounds = this.camera.state.bounds;
      const pinned = (f: Fig) => f.id === 'me' || f.id === this.selected || f.id === this.momentUserId;
      const ranked = animating
        .map((f) => ({ f, d: pinned(f) ? -1 : f.pos && inBounds(f.pos, bounds, 0.1) ? distM(f.pos, center) : Infinity }))
        .sort((a, b) => a.d - b.d);
      const cap = ANIM_CAP[this.tier] ?? ANIM_CAP.mid;
      let used = 0;
      for (const { f, d } of ranked) {
        if (d === -1 || (d !== Infinity && used < cap)) {
          if (d !== -1) used += 1;
          this.applyFrame(f, now);
        } else if (f.frameKey) this.endAnimation(f, now);
      }
    }
    if (usersDirty) this.schedulePush(0);
    else if (moversDirty && now - this.lastMovers >= MOVERS_MS - 2) {
      this.lastMovers = now;
      this.pushMovers();
    }
    if (meDirty) this.pushMe();
    if (spotDirty) this.pushSpot();
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
   * Quadro da animação: pose calculada pelo tempo, quantizada (caminhada 12/8 fps, corrida 18/12, emotes 12, match 10)
   * pra os quadros serem reaproveitados do cache em disco. Se o quadro ainda não está pronto, fica o anterior.
   */
  private applyFrame(f: Fig, now: number): void {
    const u = f.user;
    if (!u) return;
    const def = u.avatarKey ? this.defs.get(u.avatarKey) : undefined;
    if (u.avatarKey && !def) return;
    f.staticAt = 0;
    const st = f.one ? f.one.name : f.move?.run ? 'run' : 'walk';
    let k: number;
    let total: number;
    let tAt: (i: number) => number;
    if (st === 'walk' || st === 'run') {
      const freq = (st === 'walk' ? 1.9 : 2.9) * f.v.sp;
      const fpsSt = st === 'walk' ? WALK_FPS[this.tier] : RUN_FPS[this.tier];
      total = Math.max(4, Math.round(fpsSt / freq));
      const elapsed = (now - (f.move?.start ?? now)) / 1000;
      k = Math.floor(elapsed * freq * total) % total;
      tAt = (i) => i / (freq * total);
    } else {
      const fpsSt = st === 'match' ? 10 : 12;
      total = Math.max(2, Math.ceil(DUR[st] * fpsSt));
      const elapsed = (now - (f.one?.start ?? now)) / 1000;
      k = Math.min(total - 1, Math.floor(elapsed * fpsSt));
      tAt = (i) => i / fpsSt;
    }
    const look = this.lookOf(u);
    const base = `fr|${u.avatarKey || 'sil'}|${this.lookSig(look)}|${f.dim.w}x${f.dim.h}|${st}|${total}|${f.mirror ? 1 : 0}|${f.v.ph.toFixed(3)}.${f.v.sp.toFixed(3)}.${f.v.en.toFixed(3)}|${RENDER_V}`;
    const keyOf = (i: number) => `${base}|${i}`;
    const dim = f.dim;
    const mirror = f.mirror;
    const v = f.v;
    const request = (i: number, pri: number) => {
      const key = keyOf(i);
      if (mapImages.get(key)) return;
      void mapImages.request(key, pri, () => mapDraw.figure(def ?? null, look, dim, pose(st, tAt(i), v), mirror), IMG_SCALE).catch(() => null);
    };
    const key = keyOf(k);
    if (key !== f.frameKey) {
      const ref = mapImages.get(key);
      if (ref) {
        f.frameKey = key;
        this.showFig(f, ref);
      } else request(k, -3);
    }
    // adianta os próximos quadros
    for (let j = 1; j <= 3; j++) {
      const i = st === 'walk' || st === 'run' ? (k + j) % total : k + j;
      if (i < total) request(i, -2 + j * 0.1);
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
      if (this.ch.get('fx').features.length) this.ch.set('fx', EMPTY_FC);
      return;
    }
    const feats: Feature[] = [];
    this.fx = this.fx.filter((x) => now - x.start < x.dur);
    for (const x of this.fx) {
      const p = easeOutCubic(Math.min(1, (now - x.start) / x.dur));
      feats.push(point(x.at, { id: x.id, color: x.color, color2: x.color2, p: Math.round(p * 1000) / 1000 }, x.id));
    }
    this.ch.set('fx', fc(feats));
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
    this.ch.set('particles', fc(feats));
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
  // idle-cam: rotação curta (25° em 20 s) só em tier high, ativo, sem gesto há 30 s
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
    this.camera.move({ bearing: this.camera.state.bearing + 25, duration: 20_000, mode: 'linearTo' }, (done) => {
      if (!done) {
        // outro movimento/gesto parou o giro: não reagenda (volta no próximo reveal/setPin/setActive)
        this.spinning = false;
        return;
      }
      if (!this.spinning) return;
      this.spinning = false;
      this.scheduleIdleCam();
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
