// Camadas do Metch no mapa nativo — porta 1:1 do addCruzeiLayers do antigo mapbox-html.ts (mesmos ids, ordem, tamanhos
// por zoom, cores e filtros). O que pulsava com imagem animada (sonar, anéis, auras, onda do pino) virou CircleLayer com
// paint recalculado pelo relógio do motor (canal 'phase'): muda só uniform, sem relayout de símbolo. Cada anel só
// acompanha o relógio quando o canal 'rings' diz que ele tem o que mostrar; parado, nem re-renderiza.
// Ordem de montagem = ordem de desenho (de baixo pra cima).

import React, { memo, useEffect, useMemo, useRef } from 'react';
import { CircleLayer, Images, LineLayer, ShapeSource, SymbolLayer } from '@rnmapbox/maps';
import type { CircleLayerStyle, LineLayerStyle, SymbolLayerStyle } from '@rnmapbox/maps';

import { PALETTES } from './theme/palette';
import { IMG } from './contracts';
import { useChannel, useChannelSelector, useChannelWhen } from './engine/channels';
import { SRC, type MapChannels, type MapEngine } from './engine/MapEngine';

type Expr = unknown[];
type Engine = MapEngine;

const FONTS = ['DIN Pro Medium', 'Arial Unicode MS Regular'];
const FAR_ZOOM = 13;
const PHOTO_MIN_ZOOM = 14;
/** feature-state só vale em paint: entrada/saída/destaque mexem em icon-opacity ('a') */
const S_ALPHA: Expr = ['coalesce', ['feature-state', 'a'], 1];
/** bolha de foto: alfa da pessoa x fade próprio da foto ('pa') */
const PH_ALPHA: Expr = ['*', S_ALPHA, ['coalesce', ['feature-state', 'pa'], 1]];
/** lugar em alta / evento aparece maior */
const POI_SCALE: Expr = ['case', ['==', ['get', 'hot'], true], 1.3, ['==', ['get', 'event'], true], 1.15, 1];
const HOT_FILTER: Expr = ['any', ['==', ['get', 'hot'], true], ['==', ['get', 'event'], true]];
const NOT_CLUSTER: Expr = ['!', ['has', 'point_count']];
const IS_CLUSTER: Expr = ['has', 'point_count'];
const HAS_PH: Expr = ['has', 'ph'];
const USERS_PH: Expr = ['all', NOT_CLUSTER, HAS_PH];
const AURA_USERS: Expr = ['all', NOT_CLUSTER, ['has', 'aura']];
const HAS_HEADING: Expr = ['has', 'heading'];
const HAS_AURA: Expr = ['has', 'aura'];
const SONAR_FILTERS: Expr[] = [1, 2, 3].map((v) => ['all', HOT_FILTER, ['==', ['get', 'sonar'], `sonar-${v}`]]);
const SIZE_N = [0.42, 0.72, 0.95];
const SIZE_B = [0.5, 0.85, 1.1];

/** sem transição: o relógio troca o paint a cada tick (a transição padrão de 300 ms borraria o ciclo) */
const NO_T = { duration: 0, delay: 0 };
const CIRCLE_NO_T = {
  circleRadiusTransition: NO_T,
  circleStrokeWidthTransition: NO_T,
  circleStrokeColorTransition: NO_T,
  circleColorTransition: NO_T,
  circleBlurTransition: NO_T,
  circleOpacityTransition: NO_T,
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

const symbolBase = { iconAllowOverlap: true, iconIgnorePlacement: true } as const;

function userLayout(boost: boolean): SymbolLayerStyle {
  return {
    ...symbolBase,
    iconImage: ['get', 'img'],
    iconAnchor: 'bottom',
    iconPitchAlignment: 'viewport',
    iconRotationAlignment: 'viewport',
    iconOffset: ['get', 'off'],
    iconSize: sizeExpr(boost ? SIZE_B : SIZE_N),
    iconOpacity: S_ALPHA,
  } as unknown as SymbolLayerStyle;
}

function photoLayout(boost: boolean): SymbolLayerStyle {
  return {
    ...symbolBase,
    iconImage: ['get', 'ph'],
    iconAnchor: 'bottom',
    iconPitchAlignment: 'viewport',
    iconRotationAlignment: 'viewport',
    iconOffset: ['get', 'poff'],
    iconSize: sizeExpr(boost ? SIZE_B : SIZE_N),
    iconOpacity: PH_ALPHA,
  } as unknown as SymbolLayerStyle;
}

function labelStyle(text: string, halo: string): SymbolLayerStyle {
  return {
    textField: ['coalesce', ['get', 'label'], ''],
    textFont: FONTS,
    textSize: 11,
    textAnchor: 'top',
    textOffset: [0, 0.35],
    textOptional: true,
    textMaxWidth: 8,
    textLetterSpacing: 0.02,
    textColor: text,
    textHaloColor: halo,
    textHaloWidth: 1.2,
    textOpacity: S_ALPHA,
  } as unknown as SymbolLayerStyle;
}

function dotStyle(color: string): CircleLayerStyle {
  return {
    circleRadius: zoomScale([
      [10, 2.5],
      [13, 4],
    ]),
    circleColor: color,
    circleStrokeColor: '#0A0A1A',
    circleStrokeWidth: 1.2,
    circleOpacity: S_ALPHA,
    circlePitchAlignment: 'map',
  } as unknown as CircleLayerStyle;
}

// ---------- estáticos ----------
const STYLE = {
  sonarGlow: {
    ...symbolBase,
    iconImage: 'glow-sonar',
    iconPitchAlignment: 'viewport',
    iconSize: zoomScale([
      [13, 1.0],
      [16, 1.8],
      [18, 2.4],
    ]),
  } as unknown as SymbolLayerStyle,
  poi: {
    ...symbolBase,
    iconImage: ['get', 'img'],
    iconAnchor: 'center',
    iconSize: ['interpolate', ['linear'], ['zoom'], 12, ['*', 0.55, POI_SCALE], 15, ['*', 0.8, POI_SCALE], 18, ['*', 1.0, POI_SCALE]],
  } as unknown as SymbolLayerStyle,
  cluster: {
    circleColor: '#12122A',
    circleRadius: ['step', ['get', 'point_count'], 19, 10, 23, 30, 28],
    circleStrokeColor: '#7FFF00',
    circleStrokeWidth: 2.5,
    circlePitchAlignment: 'viewport',
  } as unknown as CircleLayerStyle,
  clusterCount: {
    iconImage: 'people-icon',
    iconSize: 0.5,
    iconOffset: [-22, 0],
    iconAllowOverlap: true,
    iconIgnorePlacement: true,
    iconPitchAlignment: 'viewport',
    textField: ['get', 'point_count_abbreviated'],
    textFont: FONTS,
    textSize: 13,
    textOffset: [0.55, 0],
    textAllowOverlap: true,
    textIgnorePlacement: true,
    textPitchAlignment: 'viewport',
    textColor: '#FFFFFF',
  } as unknown as SymbolLayerStyle,
  usersDot: dotStyle('#7FFF00'),
  boostDot: dotStyle('#FFD700'),
  users: userLayout(false),
  usersPhoto: photoLayout(false),
  boost: userLayout(true),
  boostPhoto: photoLayout(true),
  meGlow: {
    ...symbolBase,
    iconImage: 'glow-me',
    iconPitchAlignment: 'map',
    iconSize: zoomScale([
      [12, 0.7],
      [16, 1.1],
      [18, 1.4],
    ]),
  } as unknown as SymbolLayerStyle,
  meHeading: {
    ...symbolBase,
    iconImage: 'me-cone',
    iconRotate: ['get', 'heading'],
    iconRotationAlignment: 'map',
    iconPitchAlignment: 'map',
    iconSize: 1,
    iconOpacity: 0.9,
  } as unknown as SymbolLayerStyle,
  me: {
    ...symbolBase,
    iconImage: ['get', 'img'],
    iconAnchor: 'bottom',
    iconPitchAlignment: 'viewport',
    iconRotationAlignment: 'viewport',
    iconOffset: ['get', 'off'],
    iconSize: zoomScale([
      [12, 0.5],
      [15, 0.78],
      [18, 1.0],
    ]),
  } as unknown as SymbolLayerStyle,
  mePhoto: {
    ...symbolBase,
    iconImage: ['get', 'ph'],
    iconAnchor: 'bottom',
    iconPitchAlignment: 'viewport',
    iconRotationAlignment: 'viewport',
    iconOffset: ['get', 'poff'],
    iconSize: zoomScale([
      [12, 0.5],
      [15, 0.78],
      [18, 1.0],
    ]),
  } as unknown as SymbolLayerStyle,
  spot: {
    ...symbolBase,
    iconImage: ['get', 'img'],
    iconAnchor: 'bottom',
    iconPitchAlignment: 'viewport',
    iconRotationAlignment: 'viewport',
    iconOffset: ['get', 'off'],
    iconSize: zoomScale([
      [12, 0.55],
      [15, 0.9],
      [18, 1.15],
    ]),
    textField: ['coalesce', ['get', 'label'], ''],
    textFont: FONTS,
    textSize: 12,
    textAnchor: 'top',
    textOffset: [0, 0.35],
    textOptional: true,
    textLetterSpacing: 0.02,
    iconOpacity: S_ALPHA,
    textColor: '#0A0A1A',
    textHaloColor: '#7FFF00',
    textHaloWidth: 1.4,
    textOpacity: S_ALPHA,
  } as unknown as SymbolLayerStyle,
  spotPhoto: {
    ...symbolBase,
    iconImage: ['get', 'ph'],
    iconAnchor: 'bottom',
    iconPitchAlignment: 'viewport',
    iconRotationAlignment: 'viewport',
    iconOffset: ['get', 'poff'],
    // 1.18x: a foto do selecionado cresce mais que o boneco
    iconSize: zoomScale([
      [12, 0.65],
      [15, 1.06],
      [18, 1.36],
    ]),
    iconOpacity: PH_ALPHA,
  } as unknown as SymbolLayerStyle,
  fxOuter: {
    circleRadius: ['interpolate', ['linear'], ['get', 'p'], 0, 6, 1, 70],
    circleColor: ['get', 'color2'],
    circleOpacity: ['interpolate', ['linear'], ['get', 'p'], 0, 0.7, 1, 0],
    circlePitchAlignment: 'map',
  } as unknown as CircleLayerStyle,
  fxInner: {
    circleRadius: ['interpolate', ['linear'], ['get', 'p'], 0, 2, 0.5, 34, 1, 40],
    circleColor: ['get', 'color'],
    circleOpacity: ['interpolate', ['linear'], ['get', 'p'], 0, 0.9, 0.6, 0.35, 1, 0],
    circlePitchAlignment: 'map',
  } as unknown as CircleLayerStyle,
  momentGlow: { lineCap: 'round', lineJoin: 'round', lineColor: '#FF1493', lineWidth: 16, lineBlur: 12, lineOpacity: 0.6 } as unknown as LineLayerStyle,
  momentLine: { lineCap: 'round', lineJoin: 'round', lineColor: '#7FFF00', lineWidth: 3, lineOpacity: 0.95 } as unknown as LineLayerStyle,
  particles: { circleColor: ['get', 'c'], circleOpacity: ['get', 'o'], circleRadius: ['get', 'r'], circlePitchAlignment: 'viewport' } as unknown as CircleLayerStyle,
};

// ---------- fontes ----------
function Source({ engine, name, id }: { engine: Engine; name: keyof MapChannels; id: string }) {
  const shape = useChannel(engine.ch, name) as GeoJSON.FeatureCollection;
  return <ShapeSource id={id} shape={shape} />;
}

function UsersSource({ engine }: { engine: Engine }) {
  const shape = useChannel(engine.ch, 'users');
  const ref = useRef<ShapeSource>(null);
  useEffect(() => {
    engine.attachUsersSource(ref.current);
    return () => engine.attachUsersSource(null);
  }, [engine]);
  return <ShapeSource ref={ref} id={SRC.users} shape={shape} cluster clusterRadius={70} clusterMaxZoomLevel={21} maxZoomLevel={22} />;
}

// ---------- imagens (um <Images> por grupo: desmontar o grupo tira as imagens do estilo) ----------
const ImageGroup = memo(function ImageGroup({ images }: { images: Record<string, { url: string; scale: number }> }) {
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

function ringStyle(r: number, width: number, color: string, stops: [number, number][], pitch: 'map' | 'viewport'): CircleLayerStyle {
  // o anel do canvas é centrado no raio; no círculo do Mapbox o traço fica por fora do raio
  return {
    ...CIRCLE_NO_T,
    circleColor: 'rgba(0,0,0,0)',
    circleRadius: zoomScale(stops.map(([z, s]) => [z, Math.max(0, r - width / 2) * s])),
    circleStrokeWidth: zoomScale(stops.map(([z, s]) => [z, width * s])),
    circleStrokeColor: color,
    circlePitchAlignment: pitch,
  } as unknown as CircleLayerStyle;
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
          <CircleLayer
            key={`s${v}-${i}`}
            id={`cz-hot-sonar-${v}-${i}`}
            sourceID={SRC.pois}
            filter={SONAR_FILTERS[v - 1] as never}
            style={ringStyle(r, 4, rgba('255,20,147', 0.85 * (1 - t)), SONAR_SIZE, 'viewport')}
          />
        );
      })}
    </>
  );
});

/** auras (boost/premium+) por baixo das figuras: gradiente radial = círculo com blur; o raio externo pulsa */
function auraStyle(phase: number, stops: [number, number][], color: string): CircleLayerStyle {
  const pulse = 0.85 + 0.15 * Math.sin(phase * 3);
  const c = IMG.aura / 2;
  return {
    ...CIRCLE_NO_T,
    circleColor: color,
    circleRadius: zoomScale(stops.map(([z, s]) => [z, c * pulse * s])),
    circleBlur: 1 - 0.35 / pulse,
    circleOpacity: ['*', 0.45, S_ALPHA],
    circlePitchAlignment: 'map',
  } as unknown as CircleLayerStyle;
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
  return <CircleLayer id="cz-aura" sourceID={SRC.users} filter={AURA_USERS as never} style={auraStyle(phase, AURA_N, '#FF1493')} />;
});

const AuraBoost = memo(function AuraBoost({ engine }: { engine: Engine }) {
  const active = useChannelSelector(engine.ch, 'rings', (r) => r.auraBoost);
  const phase = useChannelWhen(engine.ch, 'phase', active);
  return <CircleLayer id="cz-aura-boost" sourceID={SRC.usersBoost} style={auraStyle(phase, AURA_B, '#FFD700')} />;
});

/** aura do destaque: cor e tamanho vêm do canal (constantes), nada de ['get'] no paint que anima (evita relayout) */
const AuraSpot = memo(function AuraSpot({ engine }: { engine: Engine }) {
  const kind = useChannelSelector(engine.ch, 'rings', (r) => r.spotAura);
  const phase = useChannelWhen(engine.ch, 'phase', kind != null);
  const style = kind === 'boost' ? auraStyle(phase, AURA_B, '#FFD700') : auraStyle(phase, AURA_N, '#FF1493');
  return <CircleLayer id="cz-spot-aura" sourceID={SRC.spot} filter={HAS_AURA as never} style={style} />;
});

const SelRing = memo(function SelRing({ engine }: { engine: Engine }) {
  const active = useChannelSelector(engine.ch, 'rings', (r) => r.sel);
  const phase = useChannelWhen(engine.ch, 'phase', active);
  const pulse = 0.5 + 0.5 * Math.sin(phase * 4);
  const c = IMG.aura / 2;
  const style = ringStyle(c - 6 - 3 * pulse, 3, '#7FFF00', [
    [12, 0.45],
    [15, 0.7],
    [18, 0.9],
  ], 'map');
  return <CircleLayer id="cz-sel" sourceID={SRC.sel} style={style} />;
});

const MeRing = memo(function MeRing({ engine }: { engine: Engine }) {
  const active = useChannelSelector(engine.ch, 'rings', (r) => r.me);
  const phase = useChannelWhen(engine.ch, 'phase', active);
  const c = IMG.ring / 2;
  const t = (phase % 2.2) / 2.2;
  const r = 14 + (c - 6 - 14) * t;
  const style = ringStyle(r, 2.5, rgba('127,255,0', 0.7 * (1 - t)), [
    [12, 0.7],
    [16, 1.1],
    [18, 1.4],
  ], 'map');
  return <CircleLayer id="cz-me-ring" sourceID={SRC.me} style={style} />;
});

const PIN_STOPS: [number, number][] = [
  [12, 0.6],
  [16, 1.2],
  [18, 1.8],
];

/** pino do lugar da busca: onda no chão (2 anéis) + brilho + gota com nome; a queda vem do canal 'pinLook' */
const PinLayers = memo(function PinLayers({ engine }: { engine: Engine }) {
  const kind = useChannelSelector(engine.ch, 'rings', (r) => r.pin);
  const phase = useChannelWhen(engine.ch, 'phase', kind != null);
  const look = useChannel(engine.ch, 'pinLook');
  const pulseAlpha = look.dy > -2 ? look.alpha : 0;
  const rgb = kind === 'n' ? '255,20,147' : '127,255,0';
  const glow = useMemo(
    () =>
      ({
        ...symbolBase,
        iconImage: kind === 'n' ? 'glow-pin-n' : 'glow-pin-d',
        iconPitchAlignment: 'map',
        iconSize: zoomScale(PIN_STOPS),
        iconOpacity: pulseAlpha,
        iconOpacityTransition: NO_T,
      }) as unknown as SymbolLayerStyle,
    [pulseAlpha, kind],
  );
  const pin = useMemo(
    () =>
      ({
        ...symbolBase,
        iconImage: 'cz-pin-img',
        iconAnchor: 'bottom',
        iconPitchAlignment: 'viewport',
        iconRotationAlignment: 'viewport',
        iconSize: zoomScale([
          [12, 0.7],
          [16, 0.95],
          [18, 1.1],
        ]),
        textField: ['get', 'label'],
        textFont: FONTS,
        textSize: 13,
        textAnchor: 'top',
        textOffset: [0, 0.5],
        textMaxWidth: 12,
        textAllowOverlap: true,
        textIgnorePlacement: true,
        iconOpacity: look.alpha,
        textOpacity: look.dy > -8 ? look.alpha : 0,
        textColor: '#FFFFFF',
        textHaloColor: kind === 'n' ? '#B0105F' : '#2F6300',
        textHaloWidth: 2.2,
        iconTranslate: [0, look.dy],
        iconTranslateTransition: NO_T,
        iconOpacityTransition: NO_T,
        textOpacityTransition: NO_T,
      }) as unknown as SymbolLayerStyle,
    [look.alpha, look.dy, kind],
  );
  const maxR = IMG.sonar / 2 - 2;
  return (
    <>
      <SymbolLayer id="cz-pin-glow" sourceID={SRC.pin} style={glow} />
      {[0, 1].map((i) => {
        const t = (phase / 2.2 + i / 2) % 1;
        return <CircleLayer key={`p${i}`} id={`cz-pin-pulse-${i}`} sourceID={SRC.pin} style={ringStyle(8 + (maxR - 8) * t, 3.5, rgba(rgb, 0.8 * (1 - t) * pulseAlpha), PIN_STOPS, 'map')} />;
      })}
      <SymbolLayer id="cz-pin" sourceID={SRC.pin} style={pin} />
    </>
  );
});

// ---------- rótulos com cor do tema (camadas Metch não recebem a luz: cor da paleta crua) ----------
const ThemedLabels = memo(function ThemedLabels({ engine, which }: { engine: Engine; which: 'poi' | 'users' | 'boost' | 'movers' }) {
  const theme = useChannelSelector(engine.ch, 'look', (l) => l.theme);
  const P = PALETTES[theme] ?? PALETTES.day;
  const style = useMemo(() => {
    if (which === 'poi') {
      return {
        textField: ['step', ['zoom'], '', 15, ['get', 'label']],
        textFont: FONTS,
        textSize: 11,
        textAnchor: 'top',
        textOffset: [0, 1.6],
        textMaxWidth: 9,
        textOptional: true,
        textLineHeight: 1.15,
        textColor: ['case', ['==', ['get', 'hot'], true], '#FF1493', P.text],
        textHaloColor: P.halo,
        textHaloWidth: 1.3,
      } as unknown as SymbolLayerStyle;
    }
    return labelStyle(P.text, P.halo);
  }, [which, P.text, P.halo]);
  if (which === 'poi') return <SymbolLayer id="cz-poi-label" sourceID={SRC.pois} minZoomLevel={14.5} style={style} />;
  if (which === 'users') return <SymbolLayer id="cz-users-label" sourceID={SRC.users} minZoomLevel={15.5} filter={NOT_CLUSTER as never} style={style} />;
  if (which === 'boost') return <SymbolLayer id="cz-users-boost-label" sourceID={SRC.usersBoost} minZoomLevel={15} style={style} />;
  return <SymbolLayer id="cz-movers-label" sourceID={SRC.movers} minZoomLevel={15} style={style} />;
});

/** fontes + camadas do Metch, na ordem do WebView */
export const MetchLayers = memo(function MetchLayers({ engine }: { engine: Engine }) {
  return (
    <>
      <UsersSource engine={engine} />
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

      {/* arco do momento do match: por baixo das auras */}
      <LineLayer id="cz-moment-glow" sourceID={SRC.moment} style={STYLE.momentGlow} />
      <LineLayer id="cz-moment-line" sourceID={SRC.moment} style={STYLE.momentLine} />
      {/* auras (boost/premium+) por baixo dos avatares */}
      <AuraUsers engine={engine} />
      <AuraBoost engine={engine} />
      {/* sonar dos hotspots: acima das auras, abaixo dos avatares */}
      <SymbolLayer id="cz-hot-sonar" sourceID={SRC.pois} filter={HOT_FILTER as never} style={STYLE.sonarGlow} />
      <SonarLevel engine={engine} v={1} />
      <SonarLevel engine={engine} v={2} />
      <SonarLevel engine={engine} v={3} />
      {/* lugares */}
      <SymbolLayer id="cz-poi" sourceID={SRC.pois} style={STYLE.poi} />
      <ThemedLabels engine={engine} which="poi" />
      {/* grupos */}
      <CircleLayer id="cz-cluster" sourceID={SRC.users} filter={IS_CLUSTER as never} style={STYLE.cluster} />
      <SymbolLayer id="cz-cluster-count" sourceID={SRC.users} filter={IS_CLUSTER as never} style={STYLE.clusterCount} />
      {/* longe (zoom < 13): só um ponto por pessoa */}
      <CircleLayer id="cz-users-dot" sourceID={SRC.users} maxZoomLevel={FAR_ZOOM} filter={NOT_CLUSTER as never} style={STYLE.usersDot} />
      <CircleLayer id="cz-users-boost-dot" sourceID={SRC.usersBoost} maxZoomLevel={FAR_ZOOM} style={STYLE.boostDot} />
      <CircleLayer id="cz-movers-dot" sourceID={SRC.movers} maxZoomLevel={FAR_ZOOM} style={STYLE.usersDot} />
      {/* pessoas */}
      <SymbolLayer id="cz-users" sourceID={SRC.users} minZoomLevel={FAR_ZOOM} filter={NOT_CLUSTER as never} style={STYLE.users} />
      <SymbolLayer id="cz-users-photo" sourceID={SRC.users} minZoomLevel={PHOTO_MIN_ZOOM} filter={USERS_PH as never} style={STYLE.usersPhoto} />
      <SymbolLayer id="cz-users-boost" sourceID={SRC.usersBoost} minZoomLevel={FAR_ZOOM} style={STYLE.boost} />
      <SymbolLayer id="cz-users-boost-photo" sourceID={SRC.usersBoost} minZoomLevel={PHOTO_MIN_ZOOM} filter={HAS_PH as never} style={STYLE.boostPhoto} />
      <ThemedLabels engine={engine} which="users" />
      <ThemedLabels engine={engine} which="boost" />
      {/* quem está andando (o boost já entra no 'sz'); a bolha anda junto */}
      <SymbolLayer id="cz-movers" sourceID={SRC.movers} minZoomLevel={FAR_ZOOM} style={STYLE.users} />
      <SymbolLayer id="cz-movers-photo" sourceID={SRC.movers} minZoomLevel={PHOTO_MIN_ZOOM} filter={HAS_PH as never} style={STYLE.usersPhoto} />
      <ThemedLabels engine={engine} which="movers" />
      {/* seleção */}
      <SelRing engine={engine} />
      {/* eu */}
      <MeRing engine={engine} />
      <SymbolLayer id="cz-me-glow" sourceID={SRC.me} style={STYLE.meGlow} />
      <SymbolLayer id="cz-me-heading" sourceID={SRC.me} filter={HAS_HEADING as never} style={STYLE.meHeading} />
      <SymbolLayer id="cz-me" sourceID={SRC.me} style={STYLE.me} />
      <SymbolLayer id="cz-me-photo" sourceID={SRC.me} minZoomLevel={PHOTO_MIN_ZOOM} filter={HAS_PH as never} style={STYLE.mePhoto} />
      {/* destaque (selecionada / momento do match): por cima de tudo, ~20% maior */}
      <AuraSpot engine={engine} />
      <SymbolLayer id="cz-spot" sourceID={SRC.spot} style={STYLE.spot} />
      <SymbolLayer id="cz-spot-photo" sourceID={SRC.spot} minZoomLevel={13} filter={HAS_PH as never} style={STYLE.spotPhoto} />
      {/* efeitos one-shot (curtir / super / match) */}
      <CircleLayer id="cz-fx-outer" sourceID={SRC.fx} style={STYLE.fxOuter} />
      <CircleLayer id="cz-fx-inner" sourceID={SRC.fx} style={STYLE.fxInner} />
      {/* pino do lugar da cidade escolhido na busca */}
      <PinLayers engine={engine} />
      {/* partículas ambientes (só tier high) */}
      <CircleLayer id="cz-particles" sourceID={SRC.particles} style={STYLE.particles} />
    </>
  );
});
