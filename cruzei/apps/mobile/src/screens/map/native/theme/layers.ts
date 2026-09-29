// Camadas do mapa base (esquema OpenMapTiles do OpenFreeMap) como dado puro: o BaseTheme vira cada spec num <Layer>.
// Ordem do array = ordem de desenho (de baixo pra cima), sempre com as MESMAS camadas: desmontar um <Layer> remove a
// camada do estilo. O tier liga/desliga pelo layout visibility; o tema troca só paint constante ou por zoom (com
// *-transition, que o nativo interpola). Cor por feature (prédio por altura) não interpola: troca seca no fundo de um
// mergulho de opacidade (o BaseTheme controla o `shown`).
//
// TS puro (sem react-native): o preview/validador do scratchpad gera o JSON completo a partir daqui.

import type { MapTheme, PerfTier } from '../../bridge';
import { BASE_COLORS, type BaseColors } from './colors';
import { FIRST_LABEL_LAYER_ID, MAP_FONTS, SRC_DEM, SRC_OMT, SUN } from './style';
import { TEX, type LitTheme } from './textures';

type Expr = unknown[];

export interface BaseLayerSpec {
  id: string;
  type: 'background' | 'fill' | 'line' | 'symbol' | 'fill-extrusion' | 'hillshade';
  source?: string;
  'source-layer'?: string;
  minzoom?: number;
  maxzoom?: number;
  filter?: Expr;
  layout?: Record<string, unknown>;
  paint?: Record<string, unknown>;
}

export interface BaseLayerInput {
  /** tema alvo: cores constantes/por zoom vão direto pra ele, com transição */
  theme: MapTheme;
  /** tema das propriedades POR FEATURE dos prédios (cor por altura, textura): só troca no fundo do mergulho */
  shown: MapTheme;
  tier: PerfTier;
  /** buildingScale do motor (0..1): prédios aparecem (opacidade) e crescem (altura em degraus de 0,25) */
  scale: number;
  /** false = primeira aplicação, sem transição (senão o mapa nasceria desbotando do fundo do JSON) */
  fade: boolean;
  /**
   * extrusões usadas desde a última configuração assentada, inclusive ela (a que saiu segue visível até a
   * opacidade zerar). Omitido = assentado: a fora de uso (sólida na noite high/mid, acesa de dia) sai por
   * visibility 'none' e o nativo nem monta os buckets dela (memória; com cantos arredondados é ~5x)
   */
  trail?: BldUse;
}

/** extrusões dos prédios ligadas (visibility): sólida e com janelas acesas */
export interface BldUse {
  solid: boolean;
  lit: boolean;
}

interface Transition {
  duration: number;
  delay: number;
}
const T0: Transition = { duration: 0, delay: 0 };
/** crossfade da troca de tema (17h/19h/6h) */
export const FADE: Transition = { duration: 800, delay: 0 };
/** mergulho dos prédios: desce em DIP_MS, troca cor/textura lá embaixo, sobe em UP */
export const DIP_MS = 320;
const DIP: Transition = { duration: DIP_MS - 20, delay: 0 };
const UP: Transition = { duration: 450, delay: 0 };
/** prédios aparecendo no boot (o growBuildings original tinha 900 ms) */
const GROW: Transition = { duration: 900, delay: 0 };
/**
 * depois da última troca (mergulho terminado), quanto esperar pra desligar a extrusão que ficou com opacidade 0: o
 * fade dela é o UP ou, se o tier trocar antes da 1ª troca de tema (sem fade), o GROW
 */
export const settleMs = (fade: boolean): number => (fade ? UP : GROW).duration + 250;
/** opacidade dos prédios no fundo do mergulho */
const DIP_LEVEL = 0.15;

// paint sem *-transition: os que não aceitam (o validador do style-spec recusa) e as texturas, que trocam seco mesmo
const NO_TRANSITION = new Set([
  'fill-antialias',
  'fill-translate-anchor',
  'line-translate-anchor',
  'fill-extrusion-translate-anchor',
  'fill-extrusion-vertical-gradient',
  'hillshade-method',
  'hillshade-illumination-anchor',
  'hillshade-illumination-direction',
  'hillshade-illumination-altitude',
  'text-translate-anchor',
  'icon-translate-anchor',
  'line-gradient',
  'fill-extrusion-pattern',
  'fill-pattern',
]);

/** paint com *-transition em tudo que aceita; `over` troca a transição de propriedades específicas */
function paint(p: Record<string, unknown>, t: Transition, over?: Record<string, Transition>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(p)) {
    out[k] = p[k];
    if (!NO_TRANSITION.has(k)) out[`${k}-transition`] = over?.[k] ?? t;
  }
  return out;
}

const vis = (on: boolean): 'visible' | 'none' => (on ? 'visible' : 'none');

// ---------- filtros ----------
const cls = (list: string[]): Expr => ['match', ['get', 'class'], list, true, false];
const IS_LINE: Expr = ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false];
const IS_POLY: Expr = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false];
const IS_POINT: Expr = ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false];
const GROUND: Expr = ['match', ['get', 'brunnel'], ['bridge', 'tunnel'], false, true];
const BRIDGE: Expr = ['==', ['get', 'brunnel'], 'bridge'];
const TUNNEL: Expr = ['==', ['get', 'brunnel'], 'tunnel'];
const NOT_TUNNEL: Expr = ['!=', ['get', 'brunnel'], 'tunnel'];
const HAS_3D: Expr = ['!=', ['get', 'hide_3d'], true];

const HIGHWAY = ['motorway', 'trunk'];
const PRIMARY = ['primary'];
const SECONDARY = ['secondary', 'tertiary'];
const MINOR = ['minor'];
const SERVICE = ['service', 'track', 'raceway', 'busway'];
const PATH = ['path', 'pedestrian'];
const RAIL = ['rail', 'transit'];

/** nome em português quando houver */
const NAME: Expr = ['coalesce', ['get', 'name:pt'], ['get', 'name:latin'], ['get', 'name']];

// ---------- larguras (px de tela) ----------
type Stops = ReadonlyArray<readonly [number, number]>;
// prettier-ignore
const W = {
  highway:   [[8, 1], [12, 2.4], [14, 5], [16, 11], [18, 26], [20, 60]],
  primary:   [[10, 1], [12, 2], [14, 4.4], [16, 10], [18, 24], [20, 54]],
  secondary: [[11, 0.7], [12, 1.3], [14, 3.4], [16, 8], [18, 19], [20, 44]],
  minor:     [[13, 0.5], [14, 1.5], [16, 4.8], [18, 13], [20, 32]],
  service:   [[14, 0.5], [16, 2.4], [18, 7], [20, 16]],
  path:      [[15, 0.7], [16, 1.1], [18, 2.2], [20, 4]],
  rail:      [[12, 0.5], [15, 1.2], [18, 2.6], [20, 4]],
} satisfies Record<string, Stops>;
/** contorno de cada lado, por zoom */
const CASE: Stops = [[12, 0.4], [14, 0.8], [16, 1.3], [18, 2.2], [20, 3.5]];
/** links/alças (ramp=1) saem mais finos */
const RAMP: Expr = ['match', ['get', 'ramp'], 1, 0.65, 1];

function caseAt(z: number): number {
  const s = CASE;
  if (z <= s[0][0]) return s[0][1];
  for (let i = 1; i < s.length; i++) {
    if (z <= s[i][0]) {
      const t = (z - s[i - 1][0]) / (s[i][0] - s[i - 1][0]);
      return s[i - 1][1] + (s[i][1] - s[i - 1][1]) * t;
    }
  }
  return s[s.length - 1][1];
}

function interp(stops: Stops, opts: { base?: number; k?: number; add?: (z: number) => number; perFeature?: Expr } = {}): Expr {
  const out: unknown[] = ['interpolate', ['exponential', opts.base ?? 1.5], ['zoom']];
  for (const [z, v] of stops) {
    const val = v * (opts.k ?? 1) + (opts.add ? opts.add(z) : 0);
    out.push(z, opts.perFeature ? ['*', val, opts.perFeature] : val);
  }
  return out;
}

const roadW = (s: Stops) => interp(s, { perFeature: RAMP });
const caseW = (s: Stops) => interp(s, { add: (z) => 2 * caseAt(z), perFeature: RAMP });
/** opacidade que entra entre z0 e z1 (constante por tema x rampa de zoom: a transição do tema interpola) */
const zoomIn = (z0: number, z1: number, v: number): Expr => ['interpolate', ['linear'], ['zoom'], z0, 0, z1, v];

// ---------- prédios ----------
/** prédios nascem achatados no z14 e chegam à altura real no z15.5 */
const B_Z0 = 14;
const B_Z1 = 15.5;
/** faixas de altura (m) das cores e da textura */
const BANDS = [8, 25, 60] as const;
const TOWER_M = 12;

function heightExpr(prop: 'render_height' | 'render_min_height', mul: number): Expr {
  const v: Expr = mul >= 1 ? ['get', prop] : ['*', ['get', prop], mul];
  return ['interpolate', ['linear'], ['zoom'], B_Z0, 0, B_Z1, v];
}

function bandColor(c: BaseColors): Expr {
  return ['step', ['get', 'render_height'], c.bld[0], BANDS[0], c.bld[1], BANDS[1], c.bld[2], BANDS[2], c.bld[3]];
}

function facadeExpr(theme: MapTheme): Expr {
  const lt: LitTheme = theme === 'day' ? 'night' : theme;
  return ['step', ['get', 'render_height'], TEX.facade('low', lt), TOWER_M, TEX.facade('tower', lt)];
}

/** janelas acesas (fill-extrusion-pattern = 2 passadas + atlas): só high/mid e só entardecer/noite */
const litMode = (theme: MapTheme, tier: PerfTier): boolean => theme !== 'day' && tier !== 'low';

/**
 * extrusões que a configuração usa: a do tema na tela (shown) e, no mergulho, a do tema alvo (monta os buckets antes
 * de subir). Entardecer<->noite e high<->mid não mudam nenhuma das duas: a visibility fica como está.
 */
export function bldUse(theme: MapTheme, shown: MapTheme, tier: PerfTier): BldUse {
  const to = litMode(theme, tier);
  const on = litMode(shown, tier);
  return { solid: !to || !on, lit: to || on };
}

// ---------- sombra projetada falsa ----------
/** metros por px lógico no z16 na latitude de Uberlândia (tiles de 512 px) */
const M_PER_PX_Z16 = (40075016.686 * Math.cos((18.9 * Math.PI) / 180)) / (512 * 65536);
/** alturas representativas das 3 faixas de sombra (m) */
const SHADOW_BANDS: ReadonlyArray<{ id: string; filter: Expr; h: number }> = [
  { id: 'lo', filter: ['all', ['>=', ['get', 'render_height'], 1.5], ['<', ['get', 'render_height'], 10]], h: 5 },
  { id: 'mid', filter: ['all', ['>=', ['get', 'render_height'], 10], ['<', ['get', 'render_height'], 30]], h: 16 },
  { id: 'hi', filter: ['>=', ['get', 'render_height'], 30], h: 42 },
];
const SHADOW_ZOOMS = [14, 14.5, 15, 15.5, 16, 17, 18, 19, 20, 22];

/** fill-translate (px, âncora no mapa) da sombra de um prédio de h metros: oposta ao sol, cresce junto com os prédios */
function shadowTranslate(theme: MapTheme, h: number): Expr {
  const sun = SUN[theme];
  const len = h * Math.min(Math.tan((sun.polar * Math.PI) / 180), 1.5);
  const az = ((sun.azimuth + 180) * Math.PI) / 180;
  const out: unknown[] = ['interpolate', ['linear'], ['zoom']];
  for (const z of SHADOW_ZOOMS) {
    const grow = Math.max(0, Math.min(1, (z - B_Z0) / (B_Z1 - B_Z0)));
    const px = (len / M_PER_PX_Z16) * Math.pow(2, z - 16) * grow;
    out.push(z, ['literal', [round2(px * Math.sin(az)), round2(-px * Math.cos(az))]]);
  }
  return out;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** todas as camadas base, de baixo pra cima */
export function buildBaseLayers(input: BaseLayerInput): BaseLayerSpec[] {
  const { theme, shown, tier, fade, trail } = input;
  const scale = Math.max(0, Math.min(1, input.scale));
  const C = BASE_COLORS[theme];
  const S = BASE_COLORS[shown];
  const t = fade ? FADE : T0;
  const high = tier === 'high';
  const midUp = tier !== 'low';
  const dipping = shown !== theme;

  // prédios: opacidade = alvo do tema x aparecimento do boot; altura em degraus (cada troca reavalia os tiles)
  const heightMul = Math.round(scale * 4) / 4;
  const appear = Math.min(1, scale * 1.25);
  const bldT = dipping ? DIP : scale <= 0 ? T0 : fade ? UP : GROW;
  const solidOn = dipping ? (litMode(shown, tier) ? 0 : DIP_LEVEL) : litMode(theme, tier) ? 0 : 1;
  const litOn = dipping ? (litMode(shown, tier) ? DIP_LEVEL : 0) : litMode(theme, tier) ? 1 : 0;
  // liga só a extrusão que tem (ou ainda pode ter, saindo em fade) opacidade > 0
  const use = bldUse(theme, shown, tier);
  const solidVisible = use.solid || Boolean(trail?.solid);
  const litVisible = use.lit || Boolean(trail?.lit);
  // o que acompanha os prédios no chão (sombras, flood light) entra junto no boot e depois segue o crossfade do tema
  const groundT = scale <= 0 ? T0 : fade ? t : GROW;
  const fx = (v: number) => v * appear;

  const omt = (id: string, type: BaseLayerSpec['type'], sourceLayer: string, rest: Omit<BaseLayerSpec, 'id' | 'type' | 'source' | 'source-layer'>): BaseLayerSpec => ({
    id,
    type,
    source: SRC_OMT,
    'source-layer': sourceLayer,
    ...rest,
  });

  const symbolText = (color: string, halo: string, haloW = 1.3) =>
    paint({ 'text-color': color, 'text-halo-color': halo, 'text-halo-width': haloW, 'text-halo-blur': 0.4 }, t);

  const L: BaseLayerSpec[] = [
    // ---------------- chão ----------------
    { id: 'background', type: 'background', paint: paint({ 'background-color': C.bg }, t) },
    omt('base-farmland', 'fill', 'landcover', {
      filter: cls(['farmland']),
      paint: paint({ 'fill-color': C.farmland }, t),
    }),
    omt('base-landuse', 'fill', 'landuse', {
      filter: cls(['commercial', 'retail', 'industrial', 'railway', 'military', 'hospital', 'school', 'university', 'college', 'kindergarten', 'stadium', 'garages', 'bus_station', 'library', 'theme_park', 'zoo', 'dam', 'quarry', 'track', 'sand']),
      paint: paint({ 'fill-color': C.landuse }, t),
    }),
    omt('base-wood', 'fill', 'landcover', {
      filter: cls(['wood', 'wetland']),
      paint: paint({ 'fill-color': C.wood }, t),
    }),
    omt('base-grass', 'fill', 'landcover', {
      filter: cls(['grass']),
      paint: paint({ 'fill-color': C.park }, t),
    }),
    omt('base-green', 'fill', 'landuse', {
      filter: cls(['pitch', 'cemetery', 'playground']),
      paint: paint({ 'fill-color': C.park }, t),
    }),
    omt('base-park', 'fill', 'park', {
      paint: paint({ 'fill-color': C.park, 'fill-opacity': C.parkAlpha * 0.5 }, t),
    }),
    omt('base-park-line', 'line', 'landcover', {
      minzoom: 15,
      filter: cls(['grass', 'wood']),
      layout: { visibility: vis(midUp) },
      paint: paint({ 'line-color': C.parkLine, 'line-width': interp([[15, 0.5], [18, 1.2]]), 'line-opacity': zoomIn(15, 16, 0.55) }, t),
    }),
    // relevo sutil: DEM terrarium z12 esticado; cores SEMPRE em array (escalar derruba o iOS: maplibre-native#4453)
    {
      id: 'base-hillshade',
      type: 'hillshade',
      source: SRC_DEM,
      layout: { visibility: vis(midUp) },
      paint: paint(
        {
          'hillshade-method': 'multidirectional',
          'hillshade-illumination-direction': [335, 270],
          'hillshade-illumination-altitude': [40, 25],
          'hillshade-illumination-anchor': 'map',
          'hillshade-shadow-color': [...C.hillShadow],
          'hillshade-highlight-color': [...C.hillHighlight],
          'hillshade-accent-color': C.hillAccent,
          'hillshade-exaggeration': ['interpolate', ['linear'], ['zoom'], 10, C.hillExaggeration, 13, C.hillExaggeration * 0.8, 16, C.hillExaggeration * 0.4],
        },
        t,
      ),
    },

    // ---------------- água ----------------
    omt('base-water', 'fill', 'water', {
      filter: NOT_TUNNEL,
      paint: paint({ 'fill-color': C.water, 'fill-antialias': true }, t),
    }),
    omt('base-water-ripple', 'fill', 'water', {
      minzoom: 13,
      filter: NOT_TUNNEL,
      layout: { visibility: vis(midUp) },
      paint: paint({ 'fill-pattern': TEX.ripple, 'fill-opacity': zoomIn(13, 14.5, C.rippleAlpha) }, t),
    }),
    omt('base-waterway', 'line', 'waterway', {
      filter: NOT_TUNNEL,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: paint(
        {
          'line-color': C.waterway,
          'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 10, ['match', ['get', 'class'], ['river', 'canal'], 1, 0.4], 14, ['match', ['get', 'class'], ['river', 'canal'], 4, 1.4], 18, ['match', ['get', 'class'], ['river', 'canal'], 14, 4]],
        },
        t,
      ),
    }),
    // brilho na margem: a linha do contorno do polígono, borrada
    omt('base-water-glint', 'line', 'water', {
      minzoom: 12,
      filter: NOT_TUNNEL,
      paint: paint(
        {
          'line-color': C.glint,
          'line-width': interp([[12, 1], [15, 3], [17, 6], [20, 14]]),
          'line-blur': interp([[12, 0.8], [15, 2.4], [17, 5], [20, 12]]),
          'line-opacity': zoomIn(12, 13.5, C.glintAlpha),
        },
        t,
      ),
    }),

    // ---------------- aeroporto, praças ----------------
    omt('base-aeroway-area', 'fill', 'aeroway', {
      minzoom: 11,
      filter: IS_POLY,
      paint: paint({ 'fill-color': C.aeroway }, t),
    }),
    omt('base-aeroway-runway', 'line', 'aeroway', {
      minzoom: 11,
      filter: ['all', IS_LINE, cls(['runway', 'taxiway'])],
      paint: paint(
        {
          'line-color': C.road,
          'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 11, ['match', ['get', 'class'], 'runway', 3, 0.5], 14, ['match', ['get', 'class'], 'runway', 12, 3], 18, ['match', ['get', 'class'], 'runway', 60, 16]],
        },
        t,
      ),
    }),
    omt('base-plaza', 'fill', 'transportation', {
      minzoom: 14,
      filter: IS_POLY,
      paint: paint({ 'fill-color': C.plaza, 'fill-opacity': zoomIn(14, 15, 0.8) }, t),
    }),

    // ---------------- neon (embaixo de todas as ruas; de dia opacidade 0 = o nativo nem desenha) ----------------
    ...neonUnder(C, t, high, midUp),

    // ---------------- túneis ----------------
    omt('base-tunnel-case', 'line', 'transportation', {
      minzoom: 13,
      filter: ['all', TUNNEL, cls([...HIGHWAY, ...PRIMARY, ...SECONDARY, ...MINOR])],
      layout: { 'line-join': 'round' },
      paint: paint({ 'line-color': C.roadCase, 'line-width': caseW(W.secondary), 'line-dasharray': [0.6, 0.3] }, t),
    }),
    omt('base-tunnel', 'line', 'transportation', {
      minzoom: 13,
      filter: ['all', TUNNEL, cls([...HIGHWAY, ...PRIMARY, ...SECONDARY, ...MINOR])],
      layout: { 'line-join': 'round' },
      paint: paint({ 'line-color': C.road, 'line-width': roadW(W.secondary), 'line-opacity': 0.55 }, t),
    }),

    // ---------------- ruas no chão: contornos, depois preenchimentos (hierarquia de baixo pra cima) ----------------
    omt('base-path', 'line', 'transportation', {
      minzoom: 15,
      filter: ['all', IS_LINE, GROUND, cls(PATH)],
      layout: { 'line-join': 'round' },
      paint: paint({ 'line-color': C.path, 'line-width': interp(W.path), 'line-dasharray': [2, 1.2], 'line-opacity': zoomIn(15, 15.6, 1) }, t),
    }),
    omt('base-case-minor', 'line', 'transportation', {
      minzoom: 13,
      filter: ['all', IS_LINE, GROUND, cls([...MINOR, ...SERVICE])],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: paint(
        {
          'line-color': C.roadCase,
          'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 13, ['match', ['get', 'class'], MINOR, 0.8, 0], 14, ['match', ['get', 'class'], MINOR, 1.5 + 2 * caseAt(14), 0.5], 16, ['match', ['get', 'class'], MINOR, 4.8 + 2 * caseAt(16), 2.4 + 2 * caseAt(16)], 18, ['match', ['get', 'class'], MINOR, 13 + 2 * caseAt(18), 7 + 2 * caseAt(18)], 20, ['match', ['get', 'class'], MINOR, 32 + 2 * caseAt(20), 16 + 2 * caseAt(20)]],
          'line-opacity': zoomIn(13, 14, 1),
        },
        t,
      ),
    }),
    omt('base-case-secondary', 'line', 'transportation', {
      minzoom: 11,
      filter: ['all', GROUND, cls(SECONDARY)],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: paint({ 'line-color': C.roadCase, 'line-width': caseW(W.secondary) }, t),
    }),
    omt('base-case-primary', 'line', 'transportation', {
      minzoom: 10,
      filter: ['all', GROUND, cls(PRIMARY)],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: paint({ 'line-color': C.roadCase, 'line-width': caseW(W.primary) }, t),
    }),
    omt('base-case-highway', 'line', 'transportation', {
      minzoom: 8,
      filter: ['all', GROUND, cls(HIGHWAY)],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: paint({ 'line-color': C.roadCase, 'line-width': caseW(W.highway) }, t),
    }),
    omt('base-road-service', 'line', 'transportation', {
      minzoom: 14,
      filter: ['all', IS_LINE, GROUND, cls(SERVICE)],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: paint({ 'line-color': C.road, 'line-width': interp(W.service) }, t),
    }),
    omt('base-road-minor', 'line', 'transportation', {
      minzoom: 13,
      filter: ['all', IS_LINE, GROUND, cls(MINOR)],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: paint({ 'line-color': C.road, 'line-width': interp(W.minor), 'line-opacity': zoomIn(13, 13.6, 1) }, t),
    }),
    omt('base-road-secondary', 'line', 'transportation', {
      minzoom: 11,
      filter: ['all', GROUND, cls(SECONDARY)],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: paint({ 'line-color': C.secondary, 'line-width': roadW(W.secondary) }, t),
    }),
    omt('base-road-primary', 'line', 'transportation', {
      minzoom: 10,
      filter: ['all', GROUND, cls(PRIMARY)],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: paint({ 'line-color': C.primary, 'line-width': roadW(W.primary) }, t),
    }),
    omt('base-road-highway', 'line', 'transportation', {
      minzoom: 8,
      filter: ['all', GROUND, cls(HIGHWAY)],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: paint({ 'line-color': C.highway, 'line-width': roadW(W.highway) }, t),
    }),
    omt('base-rail', 'line', 'transportation', {
      minzoom: 12,
      filter: ['all', NOT_TUNNEL, cls(RAIL)],
      paint: paint({ 'line-color': C.rail, 'line-width': interp(W.rail) }, t),
    }),
    omt('base-rail-hatch', 'line', 'transportation', {
      minzoom: 15,
      filter: ['all', NOT_TUNNEL, cls(RAIL)],
      paint: paint({ 'line-color': C.rail, 'line-width': interp([[15, 3], [18, 6]]), 'line-dasharray': [0.15, 3] }, t),
    }),
    // núcleo do neon: linha fina e quente no meio das vias principais (entardecer/noite)
    omt('base-neon-core', 'line', 'transportation', {
      minzoom: 11,
      filter: ['all', NOT_TUNNEL, cls([...HIGHWAY, ...PRIMARY])],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: paint(
        {
          'line-color': ['match', ['get', 'class'], HIGHWAY, C.neonHighway, C.neonPrimary],
          'line-width': interp([[11, 0.5], [14, 1.1], [16, 2], [18, 3.6], [20, 7]], { perFeature: RAMP }),
          'line-opacity': C.neonCore,
        },
        t,
      ),
    }),

    // ---------------- pontes ----------------
    omt('base-bridge-case', 'line', 'transportation', {
      minzoom: 13,
      filter: ['all', BRIDGE, cls([...HIGHWAY, ...PRIMARY, ...SECONDARY, ...MINOR, ...SERVICE])],
      layout: { 'line-join': 'round' },
      paint: paint({ 'line-color': C.roadCase, 'line-width': caseW(W.primary) }, t),
    }),
    omt('base-bridge-minor', 'line', 'transportation', {
      minzoom: 13,
      filter: ['all', BRIDGE, cls([...MINOR, ...SERVICE])],
      layout: { 'line-join': 'round' },
      paint: paint({ 'line-color': C.road, 'line-width': interp(W.minor) }, t),
    }),
    omt('base-bridge-secondary', 'line', 'transportation', {
      minzoom: 13,
      filter: ['all', BRIDGE, cls(SECONDARY)],
      layout: { 'line-join': 'round' },
      paint: paint({ 'line-color': C.secondary, 'line-width': roadW(W.secondary) }, t),
    }),
    omt('base-bridge-primary', 'line', 'transportation', {
      minzoom: 13,
      filter: ['all', BRIDGE, cls(PRIMARY)],
      layout: { 'line-join': 'round' },
      paint: paint({ 'line-color': C.primary, 'line-width': roadW(W.primary) }, t),
    }),
    omt('base-bridge-highway', 'line', 'transportation', {
      minzoom: 13,
      filter: ['all', BRIDGE, cls(HIGHWAY)],
      layout: { 'line-join': 'round' },
      paint: paint({ 'line-color': C.highway, 'line-width': roadW(W.highway) }, t),
    }),
    omt('base-oneway', 'symbol', 'transportation', {
      minzoom: 16,
      filter: ['all', ['==', ['get', 'oneway'], 1], cls([...PRIMARY, ...SECONDARY, ...MINOR])],
      layout: { 'symbol-placement': 'line', 'symbol-spacing': 90, 'icon-image': 'arrow', 'icon-size': 0.75, 'icon-rotation-alignment': 'map', 'icon-padding': [2] },
      paint: paint({ 'icon-opacity': theme === 'day' ? 0.45 : 0.5 }, t),
    }),

    // ---------------- limites ----------------
    omt('base-boundary-state', 'line', 'boundary', {
      minzoom: 4,
      filter: ['all', ['>=', ['get', 'admin_level'], 3], ['<=', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]],
      paint: paint({ 'line-color': C.boundary, 'line-width': interp([[4, 0.5], [10, 1.2], [14, 2]]), 'line-dasharray': [3, 1.5], 'line-opacity': 0.6 }, t),
    }),
    omt('base-boundary-country', 'line', 'boundary', {
      filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
      paint: paint({ 'line-color': C.boundary, 'line-width': interp([[2, 0.6], [8, 1.6], [14, 3]]), 'line-opacity': 0.8 }, t),
    }),

    // ---------------- prédios: chão (sombras, flood light), depois as extrusões ----------------
    ...SHADOW_BANDS.map(
      (b): BaseLayerSpec =>
        omt(`base-bld-shadow-${b.id}`, 'fill', 'building', {
          minzoom: B_Z0,
          filter: ['all', HAS_3D, b.filter],
          layout: { visibility: vis(midUp) },
          paint: paint(
            {
              'fill-color': C.shadow,
              'fill-opacity': zoomIn(B_Z0 + 0.3, B_Z1, fx(C.shadowAlpha)),
              'fill-translate': shadowTranslate(theme, b.h),
              'fill-translate-anchor': 'map',
              'fill-antialias': false,
            },
            t,
            { 'fill-opacity': groundT },
          ),
        }),
    ),
    // sombra de contato (AO falso): contorno do pé do prédio, borrado; metade some embaixo da extrusão
    omt('base-bld-ao', 'line', 'building', {
      minzoom: B_Z0 + 0.3,
      filter: HAS_3D,
      layout: { visibility: vis(midUp), 'line-join': 'round' },
      paint: paint(
        {
          'line-color': C.ao,
          'line-width': interp([[14.3, 1], [16, 5], [18, 12], [20, 26]]),
          'line-blur': interp([[14.3, 1], [16, 4], [18, 9], [20, 20]]),
          'line-opacity': zoomIn(B_Z0 + 0.3, B_Z1, fx(C.aoAlpha)),
        },
        t,
        { 'line-opacity': groundT },
      ),
    }),
    // flood light neon no chão em volta dos prédios mais altos (substitui o flood-light do Mapbox)
    omt('base-bld-flood', 'line', 'building', {
      minzoom: 15,
      filter: ['all', HAS_3D, ['>=', ['get', 'render_height'], 10]],
      layout: { visibility: vis(high), 'line-join': 'round' },
      paint: paint(
        {
          'line-color': '#FF1493',
          'line-width': interp([[15, 6], [16, 10], [18, 22], [20, 44]]),
          'line-blur': interp([[15, 6], [16, 9], [18, 19], [20, 38]]),
          'line-opacity': zoomIn(15, 16, fx(C.floodAlpha)),
        },
        t,
        { 'line-opacity': groundT },
      ),
    }),
    // sólido: todos os temas no tier low; de dia em todos os tiers. Cor por altura = por feature: troca seca (T0)
    // no fundo do mergulho. Cantos arredondados (layout, metros) só no high: ~5x a memória das extrusões.
    omt('base-bld', 'fill-extrusion', 'building', {
      minzoom: B_Z0,
      filter: HAS_3D,
      layout: { visibility: vis(solidVisible), 'fill-extrusion-rounded-corner-distance': high ? 1.5 : 0 },
      paint: paint(
        {
          'fill-extrusion-color': bandColor(S),
          'fill-extrusion-height': heightExpr('render_height', heightMul),
          'fill-extrusion-base': heightExpr('render_min_height', heightMul),
          'fill-extrusion-opacity': solidOn * appear,
          'fill-extrusion-vertical-gradient': true,
        },
        T0,
        { 'fill-extrusion-opacity': bldT },
      ),
    }),
    // fachada com janelas acesas (entardecer/noite, high/mid)
    omt('base-bld-lit', 'fill-extrusion', 'building', {
      minzoom: B_Z0,
      filter: HAS_3D,
      layout: { visibility: vis(litVisible), 'fill-extrusion-rounded-corner-distance': high ? 1.5 : 0 },
      paint: paint(
        {
          'fill-extrusion-pattern': facadeExpr(shown),
          'fill-extrusion-height': heightExpr('render_height', heightMul),
          'fill-extrusion-base': heightExpr('render_min_height', heightMul),
          'fill-extrusion-opacity': litOn * appear,
          'fill-extrusion-vertical-gradient': true,
        },
        T0,
        { 'fill-extrusion-opacity': bldT },
      ),
    }),

    // ---------------- rótulos (os de cima têm prioridade na colisão) ----------------
    omt(FIRST_LABEL_LAYER_ID, 'symbol', 'waterway', {
      minzoom: 13,
      filter: IS_LINE,
      layout: { 'symbol-placement': 'line', 'symbol-spacing': 350, 'text-field': NAME, 'text-font': MAP_FONTS.italic, 'text-size': 12, 'text-letter-spacing': 0.1 },
      paint: symbolText(C.waterText, C.halo, 1.2),
    }),
    omt('base-label-water-line', 'symbol', 'water_name', {
      minzoom: 11,
      filter: IS_LINE,
      layout: { 'symbol-placement': 'line', 'symbol-spacing': 350, 'text-field': NAME, 'text-font': MAP_FONTS.italic, 'text-size': 12.5, 'text-letter-spacing': 0.1 },
      paint: symbolText(C.waterText, C.halo, 1.2),
    }),
    omt('base-label-water', 'symbol', 'water_name', {
      minzoom: 11,
      filter: IS_POINT,
      layout: { 'text-field': NAME, 'text-font': MAP_FONTS.italic, 'text-size': 12.5, 'text-letter-spacing': 0.1, 'text-max-width': 7 },
      paint: symbolText(C.waterText, C.halo, 1.2),
    }),
    omt('base-label-path', 'symbol', 'transportation_name', {
      minzoom: 16.5,
      filter: cls(['path']),
      layout: { 'symbol-placement': 'line', 'text-field': NAME, 'text-font': MAP_FONTS.regular, 'text-size': 10.5 },
      paint: symbolText(C.textDim, C.halo, 1.2),
    }),
    omt('base-label-road-minor', 'symbol', 'transportation_name', {
      minzoom: 14.5,
      filter: ['all', IS_LINE, cls(['minor', 'service', 'track'])],
      layout: {
        'symbol-placement': 'line',
        'text-field': NAME,
        'text-font': MAP_FONTS.regular,
        'text-size': interp([[15, 11.5], [17, 13], [19, 15]], { base: 1.2 }),
        'text-pitch-alignment': 'viewport',
        'text-max-angle': 30,
        'text-padding': 2,
      },
      paint: symbolText(C.text, C.halo, 1.5),
    }),
    omt('base-label-road-major', 'symbol', 'transportation_name', {
      minzoom: 12.5,
      filter: cls([...HIGHWAY, ...PRIMARY, ...SECONDARY]),
      layout: {
        'symbol-placement': 'line',
        'text-field': NAME,
        'text-font': MAP_FONTS.regular,
        'text-size': interp([[13, 12], [16, 14], [18, 16]], { base: 1.2 }),
        'text-pitch-alignment': 'viewport',
        'text-max-angle': 30,
        'text-padding': 2,
        'symbol-spacing': 300,
      },
      paint: symbolText(C.text, C.halo, 1.7),
    }),
    omt('base-road-shield', 'symbol', 'transportation_name', {
      minzoom: 10,
      maxzoom: 16,
      filter: ['all', IS_LINE, ['<=', ['get', 'ref_length'], 6], cls([...HIGHWAY, ...PRIMARY]), ['match', ['get', 'network'], ['us-highway', 'us-interstate', 'us-state'], false, true]],
      layout: {
        'icon-image': ['concat', 'road_', ['get', 'ref_length']],
        'icon-rotation-alignment': 'viewport',
        'symbol-placement': ['step', ['zoom'], 'point', 11, 'line'],
        'symbol-spacing': 400,
        'text-field': ['to-string', ['get', 'ref']],
        'text-font': MAP_FONTS.regular,
        'text-rotation-alignment': 'viewport',
        'text-size': 10,
      },
      paint: paint({ 'icon-opacity': C.poiIconAlpha, 'text-color': '#333333' }, t),
    }),
    omt('base-label-housenum', 'symbol', 'housenumber', {
      minzoom: 17.5,
      layout: { 'text-field': ['to-string', ['get', 'housenumber']], 'text-font': MAP_FONTS.regular, 'text-size': 9.5, 'text-padding': 3 },
      paint: symbolText(C.textDim, C.halo, 1),
    }),
    ...poiLayers(C, t, omt),
    omt('base-label-airport', 'symbol', 'aerodrome_label', {
      minzoom: 10,
      filter: ['has', 'iata'],
      layout: { 'icon-image': 'airport', 'icon-size': 0.9, 'text-field': NAME, 'text-font': MAP_FONTS.regular, 'text-size': 12, 'text-anchor': 'top', 'text-offset': [0, 1], 'text-optional': true },
      paint: { ...symbolText(C.text, C.halo), ...paint({ 'icon-opacity': C.poiIconAlpha }, t) },
    }),
    omt('base-label-district', 'symbol', 'place', {
      minzoom: 12,
      maxzoom: 17.5,
      filter: cls(['suburb', 'quarter', 'neighbourhood']),
      layout: {
        'text-field': NAME,
        'text-font': MAP_FONTS.bold,
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.14,
        'text-size': interp([[12, 9.5], [15, 11.5], [17, 12.5]], { base: 1.2 }),
        'text-max-width': 8,
        'text-padding': 6,
      },
      paint: {
        ...symbolText(C.district, C.halo, 1.4),
        ...paint({ 'text-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.7, 13, 0.9, 16.5, 0.9, 17.5, 0] }, t),
      },
    }),
    omt('base-label-town', 'symbol', 'place', {
      minzoom: 8,
      maxzoom: 15,
      filter: cls(['town', 'village', 'hamlet']),
      layout: { 'text-field': NAME, 'text-font': MAP_FONTS.regular, 'text-size': interp([[8, 11], [12, 13], [14, 14]], { base: 1.2 }), 'text-max-width': 8 },
      paint: symbolText(C.text, C.halo, 1.5),
    }),
    omt('base-label-city', 'symbol', 'place', {
      minzoom: 4,
      maxzoom: 15,
      filter: cls(['city']),
      layout: { 'text-field': NAME, 'text-font': MAP_FONTS.bold, 'text-size': interp([[4, 11], [8, 14], [11, 18], [14, 20]], { base: 1.2 }), 'text-max-width': 8, 'text-letter-spacing': 0.02 },
      paint: {
        ...symbolText(C.text, C.halo, 1.8),
        ...paint({ 'text-opacity': ['interpolate', ['linear'], ['zoom'], 13.5, 1, 14.8, 0] }, t),
      },
    }),
    omt('base-label-state', 'symbol', 'place', {
      minzoom: 4,
      maxzoom: 8,
      filter: cls(['state']),
      layout: { 'text-field': NAME, 'text-font': MAP_FONTS.italic, 'text-size': 11, 'text-transform': 'uppercase', 'text-letter-spacing': 0.1 },
      paint: symbolText(C.textDim, C.halo),
    }),
    omt('base-label-country', 'symbol', 'place', {
      maxzoom: 9,
      filter: cls(['country']),
      layout: { 'text-field': NAME, 'text-font': MAP_FONTS.bold, 'text-size': interp([[1, 10], [6, 14]], { base: 1.2 }), 'text-max-width': 6 },
      paint: symbolText(C.text, C.halo, 1.6),
    }),
  ];
  return L;
}

/** halo largo (high) + meio (high/mid) do neon das vias principais, embaixo de todas as ruas */
function neonUnder(C: BaseColors, t: Transition, high: boolean, midUp: boolean): BaseLayerSpec[] {
  const layer = (id: string, classes: string[], color: string, stops: Stops, blur: number, alpha: number, on: boolean): BaseLayerSpec => ({
    id,
    type: 'line',
    source: SRC_OMT,
    'source-layer': 'transportation',
    minzoom: 11,
    filter: ['all', NOT_TUNNEL, cls(classes)],
    layout: { visibility: vis(on), 'line-cap': 'round', 'line-join': 'round' },
    paint: paint({ 'line-color': color, 'line-width': interp(stops, { perFeature: RAMP }), 'line-blur': interp(stops, { k: blur }), 'line-opacity': alpha }, t),
  });
  // prettier-ignore
  const HALO: Stops = [[11, 5], [14, 14], [16, 28], [18, 56], [20, 110]];
  // prettier-ignore
  const MID: Stops = [[11, 2.4], [14, 6.5], [16, 13], [18, 26], [20, 52]];
  return [
    layer('base-neon-halo-primary', PRIMARY, C.neonPrimary, HALO, 0.65, C.neonHalo, high),
    layer('base-neon-halo-highway', HIGHWAY, C.neonHighway, HALO, 0.65, C.neonHalo, high),
    layer('base-neon-mid-primary', PRIMARY, C.neonPrimary, MID, 0.45, C.neonMid, midUp),
    layer('base-neon-mid-highway', HIGHWAY, C.neonHighway, MID, 0.45, C.neonMid, midUp),
  ];
}

/** POIs base com os ícones do sprite do OFM (mesma densidade por rank do Liberty) */
function poiLayers(
  C: BaseColors,
  t: Transition,
  omt: (id: string, type: BaseLayerSpec['type'], sourceLayer: string, rest: Omit<BaseLayerSpec, 'id' | 'type' | 'source' | 'source-layer'>) => BaseLayerSpec,
): BaseLayerSpec[] {
  const layout = {
    'icon-image': ['match', ['get', 'subclass'], ['florist', 'furniture'], ['get', 'subclass'], ['get', 'class']],
    'icon-size': 0.8,
    'text-field': NAME,
    'text-font': MAP_FONTS.regular,
    'text-size': 11,
    'text-anchor': 'top',
    'text-offset': [0, 0.8],
    'text-max-width': 8,
    'text-padding': 2,
    'text-optional': true,
  };
  const p = {
    ...paint({ 'text-color': C.text, 'text-halo-color': C.halo, 'text-halo-width': 1.2, 'text-halo-blur': 0.4 }, t),
    ...paint({ 'icon-opacity': C.poiIconAlpha }, t),
  };
  const rank = (lo: number, hi?: number): Expr => ['all', IS_POINT, ['>=', ['get', 'rank'], lo], ...(hi ? [['<', ['get', 'rank'], hi]] : []), ['match', ['get', 'class'], ['bus', 'railway', 'airport'], false, true]];
  return [
    omt('base-poi-r20', 'symbol', 'poi', { minzoom: 17.5, filter: rank(20), layout, paint: p }),
    omt('base-poi-r7', 'symbol', 'poi', { minzoom: 16.5, filter: rank(7, 20), layout, paint: p }),
    omt('base-poi-r1', 'symbol', 'poi', { minzoom: 15.5, filter: rank(1, 7), layout, paint: p }),
    omt('base-poi-bus', 'symbol', 'poi', {
      minzoom: 16.5,
      filter: ['all', IS_POINT, ['==', ['get', 'class'], 'bus']],
      layout: { ...layout, 'icon-image': 'bus', 'icon-size': 0.65, 'text-anchor': 'left', 'text-offset': [0.9, 0] },
      paint: p,
    }),
    omt('base-poi-rail', 'symbol', 'poi', {
      minzoom: 13,
      filter: ['all', IS_POINT, ['==', ['get', 'class'], 'railway']],
      layout: { ...layout, 'icon-image': 'railway', 'icon-size': 0.75, 'text-anchor': 'left', 'text-offset': [0.9, 0] },
      paint: p,
    }),
  ];
}
