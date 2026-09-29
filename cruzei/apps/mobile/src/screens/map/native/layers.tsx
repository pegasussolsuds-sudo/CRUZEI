// Camadas do Metch no mapa nativo — porta 1:1 do addCruzeiLayers do antigo mapbox-html.ts (mesmos ids, ordem, tamanhos
// por zoom, cores e filtros). O que pulsava com imagem animada (sonar, anéis, auras, onda do pino) virou camada circle com
// paint recalculado pelo relógio do motor (canal 'phase'): muda só uniform, sem relayout de símbolo. Cada anel só
// acompanha o relógio quando o canal 'rings' diz que ele tem o que mostrar; parado, nem re-renderiza.
// Ordem de montagem = ordem de desenho (de baixo pra cima). <Layer> do MLRN: paint/layout em kebab-case da style-spec.

import React, { memo, useEffect, useMemo, useRef } from 'react';
import {
  GeoJSONSource,
  Images,
  Layer,
  type CircleLayerSpecification,
  type FilterSpecification,
  type GeoJSONSourceRef,
  type LineLayerSpecification,
  type SymbolLayerSpecification,
} from '@maplibre/maplibre-react-native';

import type { MapTheme } from '../bridge';
import { MAP_FONTS } from './theme';
import { IMG, type MapImageEntry } from './contracts';
import { useChannel, useChannelSelector, useChannelWhen } from './engine/channels';
import { SRC, type MapChannels, type MapEngine } from './engine/MapEngine';

type Expr = unknown[];
type Engine = MapEngine;
type SymbolPaint = NonNullable<SymbolLayerSpecification['paint']>;
type SymbolLayout = NonNullable<SymbolLayerSpecification['layout']>;
type CirclePaint = NonNullable<CircleLayerSpecification['paint']>;
type LinePaint = NonNullable<LineLayerSpecification['paint']>;
type LineLayout = NonNullable<LineLayerSpecification['layout']>;
interface SymbolStyle {
  layout: SymbolLayout;
  paint: SymbolPaint;
}

// as expressões daqui são arrays soltos (Expr), não a união de tuplas da style-spec: o cast é só de tipo
const symbolLayout = (o: Record<string, unknown>) => o as unknown as SymbolLayout;
const symbolPaint = (o: Record<string, unknown>) => o as unknown as SymbolPaint;
const circlePaint = (o: Record<string, unknown>) => o as unknown as CirclePaint;
const filterOf = (e: Expr) => e as unknown as FilterSpecification;

/** text-font pede lista; aceita o nome solto ou a pilha que o tema exportar */
function fontStack(f: string | readonly string[]): string[] {
  return typeof f === 'string' ? [f] : [...f];
}
/** nomes, grupos, pino e destaque: Noto Sans Bold (o antigo era DIN Pro Medium); rótulo de lugar: Regular */
const FONT = fontStack(MAP_FONTS.bold);
const FONT_REGULAR = fontStack(MAP_FONTS.regular);

/** cor crua dos rótulos do Metch por tema (camadas Metch não recebem a luz), igual à paleta antiga */
const LABEL: Record<MapTheme, { text: string; halo: string }> = {
  day: { text: '#0A0A1A', halo: '#FAFAFA' },
  dusk: { text: '#FAFAFA', halo: '#1A1A2A' },
  night: { text: '#FAFAFA', halo: '#0A0A1A' },
};

const FAR_ZOOM = 13;
const PHOTO_MIN_ZOOM = 14;
/** feature-state só vale em paint: entrada/saída/destaque mexem em icon-opacity ('a') */
const S_ALPHA: Expr = ['coalesce', ['feature-state', 'a'], 1];
/** bolha de foto: alfa da pessoa x fade próprio da foto ('pa') */
const PH_ALPHA: Expr = ['*', S_ALPHA, ['coalesce', ['feature-state', 'pa'], 1]];
/** lugar em alta / evento aparece maior */
const POI_SCALE: Expr = ['case', ['==', ['get', 'hot'], true], 1.3, ['==', ['get', 'event'], true], 1.15, 1];
const HOT: Expr = ['any', ['==', ['get', 'hot'], true], ['==', ['get', 'event'], true]];
const HOT_FILTER = filterOf(HOT);
const NOT_CLUSTER_E: Expr = ['!', ['has', 'point_count']];
const NOT_CLUSTER = filterOf(NOT_CLUSTER_E);
const IS_CLUSTER = filterOf(['has', 'point_count']);
const HAS_PH_E: Expr = ['has', 'ph'];
const HAS_PH = filterOf(HAS_PH_E);
const USERS_PH = filterOf(['all', NOT_CLUSTER_E, HAS_PH_E]);
const AURA_USERS = filterOf(['all', NOT_CLUSTER_E, ['has', 'aura']]);
const HAS_HEADING = filterOf(['has', 'heading']);
const HAS_AURA = filterOf(['has', 'aura']);
const SONAR_FILTERS: FilterSpecification[] = [1, 2, 3].map((v) => filterOf(['all', HOT, ['==', ['get', 'sonar'], `sonar-${v}`]]));
const SIZE_N = [0.42, 0.72, 0.95];
const SIZE_B = [0.5, 0.85, 1.1];

/** sem transição: o relógio troca o paint a cada tick (a transição padrão de 300 ms borraria o ciclo) */
const NO_T = { duration: 0, delay: 0 };
const CIRCLE_NO_T = {
  'circle-radius-transition': NO_T,
  'circle-stroke-width-transition': NO_T,
  'circle-stroke-color-transition': NO_T,
  'circle-color-transition': NO_T,
  'circle-blur-transition': NO_T,
  'circle-opacity-transition': NO_T,
};

function zoomScale(stops: [number, number][], k = 1): Expr {
  const out: unknown[] = ['interpolate', ['linear'], ['zoom']];
  for (const [z, v] of stops) out.push(z, v * k);
  return out;
}

function sizeExpr(b: number[]): Expr {
  return ['interpolate', ['linear'], ['zoom'], 12, ['*', b[0], ['get', 'sz']], 15, ['*', b[1], ['get', 'sz']], 18, ['*', b[2], ['get', 'sz']]];
}

function rgba(rgb: string, a: number): string {
  return `rgba(${rgb},${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}

const symbolBase = { 'icon-allow-overlap': true, 'icon-ignore-placement': true } as const;

function userStyle(boost: boolean): SymbolStyle {
  return {
    layout: symbolLayout({
      ...symbolBase,
      'icon-image': ['get', 'img'],
      'icon-anchor': 'bottom',
      'icon-pitch-alignment': 'viewport',
      'icon-rotation-alignment': 'viewport',
      'icon-offset': ['get', 'off'],
      'icon-size': sizeExpr(boost ? SIZE_B : SIZE_N),
    }),
    paint: symbolPaint({ 'icon-opacity': S_ALPHA }),
  };
}

function photoStyle(boost: boolean): SymbolStyle {
  return {
    layout: symbolLayout({
      ...symbolBase,
      'icon-image': ['get', 'ph'],
      'icon-anchor': 'bottom',
      'icon-pitch-alignment': 'viewport',
      'icon-rotation-alignment': 'viewport',
      'icon-offset': ['get', 'poff'],
      'icon-size': sizeExpr(boost ? SIZE_B : SIZE_N),
    }),
    paint: symbolPaint({ 'icon-opacity': PH_ALPHA }),
  };
}

const LABEL_LAYOUT = symbolLayout({
  'text-field': ['coalesce', ['get', 'label'], ''],
  'text-font': FONT,
  'text-size': 11,
  'text-anchor': 'top',
  'text-offset': [0, 0.35],
  'text-optional': true,
  'text-max-width': 8,
  'text-letter-spacing': 0.02,
});

function labelPaint(text: string, halo: string): SymbolPaint {
  return symbolPaint({ 'text-color': text, 'text-halo-color': halo, 'text-halo-width': 1.2, 'text-opacity': S_ALPHA });
}

function dotPaint(color: string): CirclePaint {
  return circlePaint({
    'circle-radius': zoomScale([
      [10, 2.5],
      [13, 4],
    ]),
    'circle-color': color,
    'circle-stroke-color': '#0A0A1A',
    'circle-stroke-width': 1.2,
    'circle-opacity': S_ALPHA,
    'circle-pitch-alignment': 'map',
  });
}

const ME_SIZE = zoomScale([
  [12, 0.5],
  [15, 0.78],
  [18, 1.0],
]);

// ---------- estáticos ----------
const STYLE = {
  sonarGlow: {
    layout: symbolLayout({
      ...symbolBase,
      'icon-image': 'glow-sonar',
      'icon-pitch-alignment': 'viewport',
      'icon-size': zoomScale([
        [13, 1.0],
        [16, 1.8],
        [18, 2.4],
      ]),
    }),
  },
  poi: {
    layout: symbolLayout({
      ...symbolBase,
      'icon-image': ['get', 'img'],
      'icon-anchor': 'center',
      'icon-size': ['interpolate', ['linear'], ['zoom'], 12, ['*', 0.55, POI_SCALE], 15, ['*', 0.8, POI_SCALE], 18, ['*', 1.0, POI_SCALE]],
    }),
  },
  cluster: circlePaint({
    'circle-color': '#12122A',
    'circle-radius': ['step', ['get', 'point_count'], 19, 10, 23, 30, 28],
    'circle-stroke-color': '#7FFF00',
    'circle-stroke-width': 2.5,
    'circle-pitch-alignment': 'viewport',
  }),
  clusterCount: {
    layout: symbolLayout({
      'icon-image': 'people-icon',
      'icon-size': 0.5,
      'icon-offset': [-22, 0],
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-pitch-alignment': 'viewport',
      'text-field': ['get', 'point_count_abbreviated'],
      'text-font': FONT,
      'text-size': 13,
      'text-offset': [0.55, 0],
      'text-allow-overlap': true,
      'text-ignore-placement': true,
      'text-pitch-alignment': 'viewport',
    }),
    paint: symbolPaint({ 'text-color': '#FFFFFF' }),
  },
  usersDot: dotPaint('#7FFF00'),
  boostDot: dotPaint('#FFD700'),
  users: userStyle(false),
  usersPhoto: photoStyle(false),
  boost: userStyle(true),
  boostPhoto: photoStyle(true),
  meGlow: {
    layout: symbolLayout({
      ...symbolBase,
      'icon-image': 'glow-me',
      'icon-pitch-alignment': 'map',
      'icon-size': zoomScale([
        [12, 0.7],
        [16, 1.1],
        [18, 1.4],
      ]),
    }),
  },
  meHeading: {
    layout: symbolLayout({
      ...symbolBase,
      'icon-image': 'me-cone',
      'icon-rotate': ['get', 'heading'],
      'icon-rotation-alignment': 'map',
      'icon-pitch-alignment': 'map',
      'icon-size': 1,
    }),
    paint: symbolPaint({ 'icon-opacity': 0.9 }),
  },
  me: {
    layout: symbolLayout({
      ...symbolBase,
      'icon-image': ['get', 'img'],
      'icon-anchor': 'bottom',
      'icon-pitch-alignment': 'viewport',
      'icon-rotation-alignment': 'viewport',
      'icon-offset': ['get', 'off'],
      'icon-size': ME_SIZE,
    }),
  },
  mePhoto: {
    layout: symbolLayout({
      ...symbolBase,
      'icon-image': ['get', 'ph'],
      'icon-anchor': 'bottom',
      'icon-pitch-alignment': 'viewport',
      'icon-rotation-alignment': 'viewport',
      'icon-offset': ['get', 'poff'],
      'icon-size': ME_SIZE,
    }),
  },
  spot: {
    layout: symbolLayout({
      ...symbolBase,
      'icon-image': ['get', 'img'],
      'icon-anchor': 'bottom',
      'icon-pitch-alignment': 'viewport',
      'icon-rotation-alignment': 'viewport',
      'icon-offset': ['get', 'off'],
      'icon-size': zoomScale([
        [12, 0.55],
        [15, 0.9],
        [18, 1.15],
      ]),
      'text-field': ['coalesce', ['get', 'label'], ''],
      'text-font': FONT,
      'text-size': 12,
      'text-anchor': 'top',
      'text-offset': [0, 0.35],
      'text-optional': true,
      'text-letter-spacing': 0.02,
    }),
    paint: symbolPaint({
      'icon-opacity': S_ALPHA,
      'text-color': '#0A0A1A',
      'text-halo-color': '#7FFF00',
      'text-halo-width': 1.4,
      'text-opacity': S_ALPHA,
    }),
  },
  spotPhoto: {
    layout: symbolLayout({
      ...symbolBase,
      'icon-image': ['get', 'ph'],
      'icon-anchor': 'bottom',
      'icon-pitch-alignment': 'viewport',
      'icon-rotation-alignment': 'viewport',
      'icon-offset': ['get', 'poff'],
      // 1.18x: a foto do selecionado cresce mais que o boneco
      'icon-size': zoomScale([
        [12, 0.65],
        [15, 1.06],
        [18, 1.36],
      ]),
    }),
    paint: symbolPaint({ 'icon-opacity': PH_ALPHA }),
  },
  fxOuter: circlePaint({
    'circle-radius': ['interpolate', ['linear'], ['get', 'p'], 0, 6, 1, 70],
    'circle-color': ['get', 'color2'],
    'circle-opacity': ['interpolate', ['linear'], ['get', 'p'], 0, 0.7, 1, 0],
    'circle-pitch-alignment': 'map',
  }),
  fxInner: circlePaint({
    'circle-radius': ['interpolate', ['linear'], ['get', 'p'], 0, 2, 0.5, 34, 1, 40],
    'circle-color': ['get', 'color'],
    'circle-opacity': ['interpolate', ['linear'], ['get', 'p'], 0, 0.9, 0.6, 0.35, 1, 0],
    'circle-pitch-alignment': 'map',
  }),
  momentLayout: { 'line-cap': 'round', 'line-join': 'round' } as LineLayout,
  momentGlow: { 'line-color': '#FF1493', 'line-width': 16, 'line-blur': 12, 'line-opacity': 0.6 } as LinePaint,
  momentLine: { 'line-color': '#7FFF00', 'line-width': 3, 'line-opacity': 0.95 } as LinePaint,
  particles: circlePaint({ 'circle-color': ['get', 'c'], 'circle-opacity': ['get', 'o'], 'circle-radius': ['get', 'r'], 'circle-pitch-alignment': 'viewport' }),
};

// ---------- fontes ----------
/** uma fonte GeoJSON por canal; a ref vai pro motor (feature-state é por fonte) */
function Source({ engine, name, id }: { engine: Engine; name: keyof MapChannels; id: string }) {
  const data = useChannel(engine.ch, name) as GeoJSON.FeatureCollection;
  const ref = useRef<GeoJSONSourceRef>(null);
  useEffect(() => {
    engine.attachSource(id, ref);
    return () => engine.attachSource(id, null);
  }, [engine, id]);
  // users sem cluster nativo: os grupos já chegam prontos do motor (supercluster)
  return <GeoJSONSource ref={ref} id={id} data={data} />;
}

// ---------- imagens (um <Images> por grupo: desmontar o grupo tira as imagens do estilo) ----------
const ImageGroup = memo(function ImageGroup({ images }: { images: Record<string, MapImageEntry> }) {
  return <Images images={images} />;
});

export function MapImages({ engine }: { engine: Engine }) {
  const groups = useChannel(engine.ch, 'images');
  return (
    <>
      {Object.keys(groups).map((g) => (
        <ImageGroup key={g} images={groups[g]} />
      ))}
    </>
  );
}

// ---------- o que pulsa (relógio 'phase', só quando 'rings' manda) ----------
const SONAR_PERIOD = [2.4, 1.9, 1.4];
const SONAR_SIZE: [number, number][] = [
  [13, 1.0],
  [16, 1.8],
  [18, 2.4],
];
const SONAR_MAX_R = IMG.sonar / 2 - 2;

function ringPaint(r: number, width: number, color: string, stops: [number, number][], pitch: 'map' | 'viewport'): CirclePaint {
  // o anel do canvas é centrado no raio; no círculo do MapLibre o traço fica por fora do raio
  return circlePaint({
    ...CIRCLE_NO_T,
    'circle-color': 'rgba(0,0,0,0)',
    'circle-radius': zoomScale(stops.map(([z, s]) => [z, Math.max(0, r - width / 2) * s])),
    'circle-stroke-width': zoomScale(stops.map(([z, s]) => [z, width * s])),
    'circle-stroke-color': color,
    'circle-pitch-alignment': pitch,
  });
}

/** um nível de sonar (5-9 → 1 anel, 10-19 → 2, 20+ → 3): período menor com mais gente */
const SonarLevel = memo(function SonarLevel({ engine, v }: { engine: Engine; v: 1 | 2 | 3 }) {
  const active = useChannelSelector(engine.ch, 'rings', (r) => r.sonar[v - 1]);
  const phase = useChannelWhen(engine.ch, 'phase', active);
  const period = SONAR_PERIOD[v - 1];
  return (
    <>
      {Array.from({ length: v }, (_, i) => {
        const t = (phase / period + i / v) % 1;
        const r = 10 + (SONAR_MAX_R - 10) * t;
        return (
          <Layer
            key={`s${v}-${i}`}
            type="circle"
            id={`cz-hot-sonar-${v}-${i}`}
            source={SRC.pois}
            filter={SONAR_FILTERS[v - 1]}
            paint={ringPaint(r, 4, rgba('255,20,147', 0.85 * (1 - t)), SONAR_SIZE, 'viewport')}
          />
        );
      })}
    </>
  );
});

/** auras (boost/premium+) por baixo das figuras: gradiente radial = círculo com blur; o raio externo pulsa */
function auraPaint(phase: number, stops: [number, number][], color: string): CirclePaint {
  const pulse = 0.85 + 0.15 * Math.sin(phase * 3);
  const c = IMG.aura / 2;
  return circlePaint({
    ...CIRCLE_NO_T,
    'circle-color': color,
    'circle-radius': zoomScale(stops.map(([z, s]) => [z, c * pulse * s])),
    'circle-blur': 1 - 0.35 / pulse,
    'circle-opacity': ['*', 0.45, S_ALPHA],
    'circle-pitch-alignment': 'map',
  });
}
const AURA_N: [number, number][] = [
  [12, 0.5],
  [16, 0.9],
  [18, 1.2],
];
const AURA_B: [number, number][] = [
  [12, 0.8],
  [16, 1.4],
  [18, 1.8],
];

const AuraUsers = memo(function AuraUsers({ engine }: { engine: Engine }) {
  const active = useChannelSelector(engine.ch, 'rings', (r) => r.aura);
  const phase = useChannelWhen(engine.ch, 'phase', active);
  return <Layer type="circle" id="cz-aura" source={SRC.users} filter={AURA_USERS} paint={auraPaint(phase, AURA_N, '#FF1493')} />;
});

const AuraBoost = memo(function AuraBoost({ engine }: { engine: Engine }) {
  const active = useChannelSelector(engine.ch, 'rings', (r) => r.auraBoost);
  const phase = useChannelWhen(engine.ch, 'phase', active);
  return <Layer type="circle" id="cz-aura-boost" source={SRC.usersBoost} paint={auraPaint(phase, AURA_B, '#FFD700')} />;
});

/** aura do destaque: cor e tamanho vêm do canal (constantes), nada de ['get'] no paint que anima (evita relayout) */
const AuraSpot = memo(function AuraSpot({ engine }: { engine: Engine }) {
  const kind = useChannelSelector(engine.ch, 'rings', (r) => r.spotAura);
  const phase = useChannelWhen(engine.ch, 'phase', kind != null);
  const paint = kind === 'boost' ? auraPaint(phase, AURA_B, '#FFD700') : auraPaint(phase, AURA_N, '#FF1493');
  return <Layer type="circle" id="cz-spot-aura" source={SRC.spot} filter={HAS_AURA} paint={paint} />;
});

const SelRing = memo(function SelRing({ engine }: { engine: Engine }) {
  const active = useChannelSelector(engine.ch, 'rings', (r) => r.sel);
  const phase = useChannelWhen(engine.ch, 'phase', active);
  const pulse = 0.5 + 0.5 * Math.sin(phase * 4);
  const c = IMG.aura / 2;
  const paint = ringPaint(c - 6 - 3 * pulse, 3, '#7FFF00', [
    [12, 0.45],
    [15, 0.7],
    [18, 0.9],
  ], 'map');
  return <Layer type="circle" id="cz-sel" source={SRC.sel} paint={paint} />;
});

const MeRing = memo(function MeRing({ engine }: { engine: Engine }) {
  const active = useChannelSelector(engine.ch, 'rings', (r) => r.me);
  const phase = useChannelWhen(engine.ch, 'phase', active);
  const c = IMG.ring / 2;
  const t = (phase % 2.2) / 2.2;
  const r = 14 + (c - 6 - 14) * t;
  const paint = ringPaint(r, 2.5, rgba('127,255,0', 0.7 * (1 - t)), [
    [12, 0.7],
    [16, 1.1],
    [18, 1.4],
  ], 'map');
  return <Layer type="circle" id="cz-me-ring" source={SRC.me} paint={paint} />;
});

const PIN_STOPS: [number, number][] = [
  [12, 0.6],
  [16, 1.2],
  [18, 1.8],
];

const PIN_LAYOUT = symbolLayout({
  ...symbolBase,
  'icon-image': 'cz-pin-img',
  'icon-anchor': 'bottom',
  'icon-pitch-alignment': 'viewport',
  'icon-rotation-alignment': 'viewport',
  'icon-size': zoomScale([
    [12, 0.7],
    [16, 0.95],
    [18, 1.1],
  ]),
  'text-field': ['get', 'label'],
  'text-font': FONT,
  'text-size': 13,
  'text-anchor': 'top',
  'text-offset': [0, 0.5],
  'text-max-width': 12,
  'text-allow-overlap': true,
  'text-ignore-placement': true,
});

/** pino do lugar da busca: onda no chão (2 anéis) + brilho + gota com nome; a queda vem do canal 'pinLook' */
const PinLayers = memo(function PinLayers({ engine }: { engine: Engine }) {
  const kind = useChannelSelector(engine.ch, 'rings', (r) => r.pin);
  const phase = useChannelWhen(engine.ch, 'phase', kind != null);
  const look = useChannel(engine.ch, 'pinLook');
  const pulseAlpha = look.dy > -2 ? look.alpha : 0;
  const rgb = kind === 'n' ? '255,20,147' : '127,255,0';
  const glowLayout = useMemo(
    () =>
      symbolLayout({
        ...symbolBase,
        'icon-image': kind === 'n' ? 'glow-pin-n' : 'glow-pin-d',
        'icon-pitch-alignment': 'map',
        'icon-size': zoomScale(PIN_STOPS),
      }),
    [kind],
  );
  const glowPaint = useMemo(() => symbolPaint({ 'icon-opacity': pulseAlpha, 'icon-opacity-transition': NO_T }), [pulseAlpha]);
  const pinPaint = useMemo(
    () =>
      symbolPaint({
        'icon-opacity': look.alpha,
        'text-opacity': look.dy > -8 ? look.alpha : 0,
        'text-color': '#FFFFFF',
        'text-halo-color': kind === 'n' ? '#B0105F' : '#2F6300',
        'text-halo-width': 2.2,
        'icon-translate': [0, look.dy],
        'icon-translate-transition': NO_T,
        'icon-opacity-transition': NO_T,
        'text-opacity-transition': NO_T,
      }),
    [look.alpha, look.dy, kind],
  );
  const maxR = IMG.sonar / 2 - 2;
  return (
    <>
      <Layer type="symbol" id="cz-pin-glow" source={SRC.pin} layout={glowLayout} paint={glowPaint} />
      {[0, 1].map((i) => {
        const t = (phase / 2.2 + i / 2) % 1;
        return (
          <Layer
            key={`p${i}`}
            type="circle"
            id={`cz-pin-pulse-${i}`}
            source={SRC.pin}
            paint={ringPaint(8 + (maxR - 8) * t, 3.5, rgba(rgb, 0.8 * (1 - t) * pulseAlpha), PIN_STOPS, 'map')}
          />
        );
      })}
      <Layer type="symbol" id="cz-pin" source={SRC.pin} layout={PIN_LAYOUT} paint={pinPaint} />
    </>
  );
});

// ---------- gente invisível (só Premium): fantasma discreto por lugar/quadra, nunca uma pessoa ----------
/**
 * cor crua por tema (camadas Metch não recebem a luz): disco translúcido com borda suave e um brilho difuso em volta;
 * de dia um lilás acinzentado que não some no chão claro, à noite quase branco e bem transparente
 */
const GHOST: Record<MapTheme, { fill: string; stroke: string; glow: string; text: string; halo: string }> = {
  day: { fill: 'rgba(96,104,160,0.16)', stroke: 'rgba(72,80,136,0.55)', glow: 'rgba(120,128,200,0.22)', text: '#3C4270', halo: '#FAFAFA' },
  dusk: { fill: 'rgba(226,218,255,0.14)', stroke: 'rgba(236,230,255,0.55)', glow: 'rgba(200,190,255,0.20)', text: '#EEE9FF', halo: '#1A1A2A' },
  night: { fill: 'rgba(206,214,255,0.12)', stroke: 'rgba(220,226,255,0.50)', glow: 'rgba(160,176,255,0.18)', text: '#DCE2FF', halo: '#0A0A1A' },
};
/** raio (px) do disco por zoom: um pouco maior que o ícone do lugar (44 px x 0,8 no z15), que fica por cima */
const GHOST_R: [number, number][] = [
  [10, 4],
  [13, 9],
  [15, 19],
  [18, 28],
];
const GHOST_GLOW_R = GHOST_R.map(([z, r]): [number, number] => [z, r * 1.45]);
const GHOST_STROKE_W: [number, number][] = [
  [10, 0.8],
  [15, 1.4],
  [18, 1.8],
];
/** rótulo só de perto (longe fica só o disco, como o ponto das pessoas) */
const GHOST_LABEL_MIN_ZOOM = 14;
const GHOST_PLACE = filterOf(['has', 'place']);
const GHOST_CELL = filterOf(['!', ['has', 'place']]);
// text-offset sempre array e text-font de uma fonte que o OpenFreeMap serve (o factory do MLRN Android cai com número
// solto); texto puro, sem emoji (a fonte SDF não tem o glifo)
const GHOST_LABEL_BASE = {
  'text-field': ['coalesce', ['get', 'label'], ''],
  'text-font': FONT,
  'text-size': 11,
  'text-max-width': 8,
  'text-letter-spacing': 0.02,
  'text-pitch-alignment': 'viewport',
  // o número é o recado do marcador: aparece mesmo cruzando nome de rua (e não esconde nome nenhum)
  'text-allow-overlap': true,
  'text-ignore-placement': true,
};
/**
 * rótulo sempre EM CIMA do disco: embaixo ficam o nome do lugar e os ícones de lugar da quadra (que desenham por cima
 * dos invisíveis e escondiam o "3 invisíveis" — visto no Moto)
 */
const GHOST_LABEL_ABOVE = symbolLayout({ ...GHOST_LABEL_BASE, 'text-anchor': 'bottom', 'text-offset': [0, -2.2] });

const GhostLayers = memo(function GhostLayers({ engine }: { engine: Engine }) {
  const theme = useChannelSelector(engine.ch, 'look', (l) => l.theme);
  const C = GHOST[theme] ?? GHOST.day;
  const glow = useMemo(
    () => circlePaint({ 'circle-radius': zoomScale(GHOST_GLOW_R), 'circle-color': C.glow, 'circle-blur': 0.9, 'circle-pitch-alignment': 'viewport' }),
    [C.glow],
  );
  const disc = useMemo(
    () =>
      circlePaint({
        'circle-radius': zoomScale(GHOST_R),
        'circle-color': C.fill,
        'circle-stroke-color': C.stroke,
        'circle-stroke-width': zoomScale(GHOST_STROKE_W),
        'circle-pitch-alignment': 'viewport',
      }),
    [C.fill, C.stroke],
  );
  const label = useMemo(() => symbolPaint({ 'text-color': C.text, 'text-halo-color': C.halo, 'text-halo-width': 1.2 }), [C.text, C.halo]);
  return (
    <>
      <Layer type="circle" id="cz-invisible-glow" source={SRC.invisible} paint={glow} />
      <Layer type="circle" id="cz-invisible" source={SRC.invisible} paint={disc} />
      <Layer type="symbol" id="cz-invisible-label" source={SRC.invisible} minzoom={GHOST_LABEL_MIN_ZOOM} filter={GHOST_CELL} layout={GHOST_LABEL_ABOVE} paint={label} />
      <Layer type="symbol" id="cz-invisible-place-label" source={SRC.invisible} minzoom={GHOST_LABEL_MIN_ZOOM} filter={GHOST_PLACE} layout={GHOST_LABEL_ABOVE} paint={label} />
    </>
  );
});

// ---------- rótulos com cor do tema (camadas Metch não recebem a luz: cor crua) ----------
const POI_LABEL_LAYOUT = symbolLayout({
  'text-field': ['step', ['zoom'], '', 15, ['get', 'label']],
  'text-font': FONT_REGULAR,
  'text-size': 11,
  'text-anchor': 'top',
  'text-offset': [0, 1.6],
  'text-max-width': 9,
  'text-optional': true,
  'text-line-height': 1.15,
});

const ThemedLabels = memo(function ThemedLabels({ engine, which }: { engine: Engine; which: 'poi' | 'users' | 'boost' | 'movers' }) {
  const theme = useChannelSelector(engine.ch, 'look', (l) => l.theme);
  const C = LABEL[theme] ?? LABEL.day;
  const paint = useMemo(() => {
    if (which === 'poi') return symbolPaint({ 'text-color': ['case', ['==', ['get', 'hot'], true], '#FF1493', C.text], 'text-halo-color': C.halo, 'text-halo-width': 1.3 });
    return labelPaint(C.text, C.halo);
  }, [which, C.text, C.halo]);
  if (which === 'poi') return <Layer type="symbol" id="cz-poi-label" source={SRC.pois} minzoom={14.5} layout={POI_LABEL_LAYOUT} paint={paint} />;
  if (which === 'users') return <Layer type="symbol" id="cz-users-label" source={SRC.users} minzoom={15.5} filter={NOT_CLUSTER} layout={LABEL_LAYOUT} paint={paint} />;
  if (which === 'boost') return <Layer type="symbol" id="cz-users-boost-label" source={SRC.usersBoost} minzoom={15} layout={LABEL_LAYOUT} paint={paint} />;
  return <Layer type="symbol" id="cz-movers-label" source={SRC.movers} minzoom={15} layout={LABEL_LAYOUT} paint={paint} />;
});

/** fontes + camadas do Metch, na ordem do WebView */
export const MetchLayers = memo(function MetchLayers({ engine }: { engine: Engine }) {
  return (
    <>
      <Source engine={engine} name="users" id={SRC.users} />
      <Source engine={engine} name="usersBoost" id={SRC.usersBoost} />
      <Source engine={engine} name="pois" id={SRC.pois} />
      <Source engine={engine} name="me" id={SRC.me} />
      <Source engine={engine} name="sel" id={SRC.sel} />
      <Source engine={engine} name="fx" id={SRC.fx} />
      <Source engine={engine} name="spot" id={SRC.spot} />
      <Source engine={engine} name="movers" id={SRC.movers} />
      <Source engine={engine} name="moment" id={SRC.moment} />
      <Source engine={engine} name="pin" id={SRC.pin} />
      <Source engine={engine} name="particles" id={SRC.particles} />
      <Source engine={engine} name="invisible" id={SRC.invisible} />

      {/* arco do momento do match: por baixo das auras */}
      <Layer type="line" id="cz-moment-glow" source={SRC.moment} layout={STYLE.momentLayout} paint={STYLE.momentGlow} />
      <Layer type="line" id="cz-moment-line" source={SRC.moment} layout={STYLE.momentLayout} paint={STYLE.momentLine} />
      {/* auras (boost/premium+) por baixo dos avatares */}
      <AuraUsers engine={engine} />
      <AuraBoost engine={engine} />
      {/* gente invisível (só Premium): abaixo do sonar, dos lugares e de todo mundo visível; rótulo cede a vez aos outros */}
      <GhostLayers engine={engine} />
      {/* sonar dos hotspots: acima das auras, abaixo dos avatares */}
      <Layer type="symbol" id="cz-hot-sonar" source={SRC.pois} filter={HOT_FILTER} layout={STYLE.sonarGlow.layout} />
      <SonarLevel engine={engine} v={1} />
      <SonarLevel engine={engine} v={2} />
      <SonarLevel engine={engine} v={3} />
      {/* lugares */}
      <Layer type="symbol" id="cz-poi" source={SRC.pois} layout={STYLE.poi.layout} />
      <ThemedLabels engine={engine} which="poi" />
      {/* grupos */}
      <Layer type="circle" id="cz-cluster" source={SRC.users} filter={IS_CLUSTER} paint={STYLE.cluster} />
      <Layer type="symbol" id="cz-cluster-count" source={SRC.users} filter={IS_CLUSTER} layout={STYLE.clusterCount.layout} paint={STYLE.clusterCount.paint} />
      {/* longe (zoom < 13): só um ponto por pessoa */}
      <Layer type="circle" id="cz-users-dot" source={SRC.users} maxzoom={FAR_ZOOM} filter={NOT_CLUSTER} paint={STYLE.usersDot} />
      <Layer type="circle" id="cz-users-boost-dot" source={SRC.usersBoost} maxzoom={FAR_ZOOM} paint={STYLE.boostDot} />
      <Layer type="circle" id="cz-movers-dot" source={SRC.movers} maxzoom={FAR_ZOOM} paint={STYLE.usersDot} />
      {/* pessoas */}
      <Layer type="symbol" id="cz-users" source={SRC.users} minzoom={FAR_ZOOM} filter={NOT_CLUSTER} layout={STYLE.users.layout} paint={STYLE.users.paint} />
      <Layer type="symbol" id="cz-users-photo" source={SRC.users} minzoom={PHOTO_MIN_ZOOM} filter={USERS_PH} layout={STYLE.usersPhoto.layout} paint={STYLE.usersPhoto.paint} />
      <Layer type="symbol" id="cz-users-boost" source={SRC.usersBoost} minzoom={FAR_ZOOM} layout={STYLE.boost.layout} paint={STYLE.boost.paint} />
      <Layer type="symbol" id="cz-users-boost-photo" source={SRC.usersBoost} minzoom={PHOTO_MIN_ZOOM} filter={HAS_PH} layout={STYLE.boostPhoto.layout} paint={STYLE.boostPhoto.paint} />
      <ThemedLabels engine={engine} which="users" />
      <ThemedLabels engine={engine} which="boost" />
      {/* quem está andando (o boost já entra no 'sz'); a bolha anda junto */}
      <Layer type="symbol" id="cz-movers" source={SRC.movers} minzoom={FAR_ZOOM} layout={STYLE.users.layout} paint={STYLE.users.paint} />
      <Layer type="symbol" id="cz-movers-photo" source={SRC.movers} minzoom={PHOTO_MIN_ZOOM} filter={HAS_PH} layout={STYLE.usersPhoto.layout} paint={STYLE.usersPhoto.paint} />
      <ThemedLabels engine={engine} which="movers" />
      {/* seleção */}
      <SelRing engine={engine} />
      {/* eu */}
      <MeRing engine={engine} />
      <Layer type="symbol" id="cz-me-glow" source={SRC.me} layout={STYLE.meGlow.layout} />
      <Layer type="symbol" id="cz-me-heading" source={SRC.me} filter={HAS_HEADING} layout={STYLE.meHeading.layout} paint={STYLE.meHeading.paint} />
      <Layer type="symbol" id="cz-me" source={SRC.me} layout={STYLE.me.layout} />
      <Layer type="symbol" id="cz-me-photo" source={SRC.me} minzoom={PHOTO_MIN_ZOOM} filter={HAS_PH} layout={STYLE.mePhoto.layout} />
      {/* destaque (selecionada / momento do match): por cima de tudo, ~20% maior */}
      <AuraSpot engine={engine} />
      <Layer type="symbol" id="cz-spot" source={SRC.spot} layout={STYLE.spot.layout} paint={STYLE.spot.paint} />
      <Layer type="symbol" id="cz-spot-photo" source={SRC.spot} minzoom={13} filter={HAS_PH} layout={STYLE.spotPhoto.layout} paint={STYLE.spotPhoto.paint} />
      {/* efeitos one-shot (curtir / super / match) */}
      <Layer type="circle" id="cz-fx-outer" source={SRC.fx} paint={STYLE.fxOuter} />
      <Layer type="circle" id="cz-fx-inner" source={SRC.fx} paint={STYLE.fxInner} />
      {/* pino do lugar da cidade escolhido na busca */}
      <PinLayers engine={engine} />
      {/* partículas ambientes (só tier high) */}
      <Layer type="circle" id="cz-particles" source={SRC.particles} paint={STYLE.particles} />
    </>
  );
});
