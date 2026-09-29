// Tema do mapa base: recolore o streets-v12 camada a camada (porta do applyTheme/applyTierEffects/addBaseLayers de
// mapbox-html.ts:209-307) com a luz 3D já assada nas cores (./palette), e monta o neon das ruas, os prédios 3D e a
// neblina/céu. Vai DENTRO do <MapView> com styleURL streets-v12.
//
// ATENÇÃO: não desmonte nem troque a key deste componente com o mapa vivo. No rnmapbox, desmontar uma camada `existing`
// REMOVE a camada do estilo (RNMBXLayer.removeFromMap) — o mapa base sumiria e, remontando, as camadas não existiriam
// mais. E só pode haver um <Atmosphere> na árvore.

import React, { memo, useMemo, useState } from 'react';
import {
  Atmosphere,
  BackgroundLayer,
  CircleLayer,
  FillExtrusionLayer,
  FillLayer,
  LineLayer,
  SymbolLayer,
  type AtmosphereLayerStyle,
  type BackgroundLayerStyle,
  type CircleLayerStyle,
  type FillExtrusionLayerStyle,
  type FillLayerStyle,
  type LineLayerStyle,
  type SymbolLayerStyle,
} from '@rnmapbox/maps';
import type { MapTheme, PerfTier } from '../../bridge';
import { lit, litExpr, PALETTES } from './palette';
import {
  FIRST_LABEL_LAYER_ID,
  FIRST_ROAD_LAYER_ID,
  STREETS_V12_LAYERS,
  STREETS_V12_UNTHEMED,
  type BaseKind,
  type BaseLayerType,
  type UnthemedPaint,
} from './streets-v12-layers';

interface Fade {
  duration: number;
  delay: number;
}
/** crossfade da troca de tema (17h/19h/6h): os -transition de 800 ms do applyTheme */
const FADE: Fade = { duration: 800, delay: 0 };
/** 1ª aplicação sem transição: senão o mapa nasceria com as cores do streets-v12 e desbotaria até o tema */
const NO_FADE: Fade = { duration: 0, delay: 0 };
/** prédios crescendo (growBuildings do original: 900 ms) */
const GROW: Fade = { duration: 900, delay: 0 };

type FillKind = 'water' | 'park' | 'landuse' | 'building';
type LineKind = 'roadCase' | 'highway' | 'primary' | 'secondary' | 'road';

type UnthemedStyle =
  | { id: string; type: 'fill'; style: FillLayerStyle }
  | { id: string; type: 'line'; style: LineLayerStyle }
  | { id: string; type: 'circle'; style: CircleLayerStyle };

interface ThemeStyles {
  bg: BackgroundLayerStyle;
  fill: Record<FillKind, FillLayerStyle>;
  line: Record<LineKind, LineLayerStyle>;
  symbol: SymbolLayerStyle;
  unthemed: readonly UnthemedStyle[];
  glowPrimary: LineLayerStyle;
  glowHighway: LineLayerStyle;
  atmosphere: AtmosphereLayerStyle;
}

// só verde nas classes de vegetação; aeroporto/hospital/escola ficam neutros (mapbox-html.ts:228)
const GREEN_CLASSES = [
  'park',
  'grass',
  'pitch',
  'garden',
  'wood',
  'scrub',
  'cemetery',
  'recreation_ground',
];

const GLOW_WIDTH: LineLayerStyle['lineWidth'] = [
  'interpolate',
  ['linear'],
  ['zoom'],
  13,
  3,
  16,
  9,
  18,
  16,
];
const GLOW_PRIMARY_FILTER: React.ComponentProps<typeof LineLayer>['filter'] = [
  'in',
  ['get', 'class'],
  ['literal', ['primary']],
];
const GLOW_HIGHWAY_FILTER: React.ComponentProps<typeof LineLayer>['filter'] = [
  'in',
  ['get', 'class'],
  ['literal', ['motorway', 'trunk']],
];

const EXTRUDE_FILTER: React.ComponentProps<typeof FillExtrusionLayer>['filter'] = [
  '==',
  ['get', 'extrude'],
  'true',
];
// nascem achatados no z14 e chegam à altura real no z15.2
const EXTRUSION_HEIGHT: FillExtrusionLayerStyle['fillExtrusionHeight'] = [
  'interpolate',
  ['linear'],
  ['zoom'],
  14,
  0,
  15.2,
  ['get', 'height'],
];
const EXTRUSION_BASE: FillExtrusionLayerStyle['fillExtrusionBase'] = [
  'interpolate',
  ['linear'],
  ['zoom'],
  14,
  0,
  15.2,
  ['get', 'min_height'],
];
/** emissive-strength do cz-3d no original: quase todo iluminado */
const BUILDING_EMISSIVE = 0.05;

/** as cores vêm do JSON do estilo (arrays genéricos), não do tipo Expression do rnmapbox: o cast é só de tipo */
function unthemedStyle<S>(paint: UnthemedPaint, theme: MapTheme, fade: Fade): S {
  const out: Record<string, unknown> = {};
  for (const [prop, value] of Object.entries(paint)) {
    if (value === undefined) continue;
    out[prop] = litExpr(value, theme);
    out[`${prop}Transition`] = fade;
  }
  return out as unknown as S;
}

function buildThemeStyles(theme: MapTheme, fade: Fade): ThemeStyles {
  const P = PALETTES[theme];
  const lineStyle = (color: string): LineLayerStyle => ({
    lineColor: lit(color, theme),
    lineColorTransition: fade,
  });
  // neon SEM luz (line-emissive-strength 1 no original); de dia (glow 0) nem desenha as linhas borradas.
  // Custo: dusk -> day some na hora em vez de desbotar.
  const glowStyle = (color: string): LineLayerStyle => ({
    visibility: P.glow > 0 ? 'visible' : 'none',
    lineCap: 'round',
    lineJoin: 'round',
    lineBlur: 6,
    lineWidth: GLOW_WIDTH,
    lineColor: color,
    lineColorTransition: fade,
    lineOpacity: P.glow,
    lineOpacityTransition: fade,
  });

  return {
    bg: { backgroundColor: lit(P.bg, theme), backgroundColorTransition: fade },
    fill: {
      water: { fillColor: lit(P.water, theme), fillColorTransition: fade },
      // parkAlpha é opacidade, não cor: a luz não entra nela
      park: {
        fillColor: lit(P.park, theme),
        fillColorTransition: fade,
        fillOpacity: P.parkAlpha,
        fillOpacityTransition: fade,
      },
      landuse: {
        fillColor: [
          'match',
          ['get', 'class'],
          GREEN_CLASSES,
          lit(P.park, theme),
          lit(P.landuse, theme),
        ],
        fillColorTransition: fade,
      },
      // o prédio 2D some; o 3D (cz-3d) toma o lugar
      building: { fillOpacity: 0, fillOpacityTransition: NO_FADE },
    },
    line: {
      roadCase: lineStyle(P.roadCase),
      highway: lineStyle(P.highway),
      primary: lineStyle(P.primary),
      secondary: lineStyle(P.secondary),
      road: lineStyle(P.road),
    },
    // Símbolos SEM luz: no GL JS v3.7 text-emissive-strength e icon-emissive-strength têm default 1, então nem texto nem
    // os ícones maki eram escurecidos (por isso não mexemos em iconColorBrightnessMax).
    symbol: {
      textColor: P.text,
      textColorTransition: fade,
      textHaloColor: P.halo,
      textHaloColorTransition: fade,
    },
    unthemed: STREETS_V12_UNTHEMED.map(([id, type, paint]): UnthemedStyle => {
      if (type === 'fill')
        return { id, type, style: unthemedStyle<FillLayerStyle>(paint, theme, fade) };
      if (type === 'line')
        return { id, type, style: unthemedStyle<LineLayerStyle>(paint, theme, fade) };
      return { id, type, style: unthemedStyle<CircleLayerStyle>(paint, theme, fade) };
    }),
    glowPrimary: glowStyle(P.primary),
    glowHighway: glowStyle(P.highway),
    // neblina/céu: fora do pipeline de luz
    atmosphere: {
      color: P.fog[0],
      colorTransition: fade,
      highColor: P.fog[1],
      highColorTransition: fade,
      spaceColor: P.fog[2],
      spaceColorTransition: fade,
      horizonBlend: theme === 'day' ? 0.08 : 0.16,
      horizonBlendTransition: fade,
      starIntensity: P.star,
      starIntensityTransition: fade,
      range: [0.8, 8],
    },
  };
}

// no máximo 6 combinações (3 temas x com/sem crossfade): calcula uma vez e reaproveita as MESMAS referências, pra
// nenhuma camada reenviar estilo ao native à toa
const themeStylesCache = new Map<string, ThemeStyles>();
function getThemeStyles(theme: MapTheme, animate: boolean): ThemeStyles {
  const key = `${theme}:${animate ? 1 : 0}`;
  let styles = themeStylesCache.get(key);
  if (!styles) {
    styles = buildThemeStyles(theme, animate ? FADE : NO_FADE);
    themeStylesCache.set(key, styles);
  }
  return styles;
}

function baseLayerElement(
  id: string,
  type: BaseLayerType,
  kind: BaseKind,
  s: ThemeStyles,
): React.ReactElement | null {
  switch (type) {
    case 'background':
      return <BackgroundLayer key={id} id={id} existing style={s.bg} />;
    case 'fill': {
      const style = s.fill[kind as FillKind];
      return style ? <FillLayer key={id} id={id} existing style={style} /> : null;
    }
    case 'line': {
      const style = s.line[kind as LineKind];
      return style ? <LineLayer key={id} id={id} existing style={style} /> : null;
    }
    case 'symbol':
      return <SymbolLayer key={id} id={id} existing style={s.symbol} />;
    default:
      return null;
  }
}

function unthemedElement(u: UnthemedStyle): React.ReactElement {
  switch (u.type) {
    case 'fill':
      return <FillLayer key={u.id} id={u.id} existing style={u.style} />;
    case 'line':
      return <LineLayer key={u.id} id={u.id} existing style={u.style} />;
    case 'circle':
      return <CircleLayer key={u.id} id={u.id} existing style={u.style} />;
  }
}

export interface BaseThemeProps {
  theme: MapTheme;
  tier: PerfTier;
  /** fill-extrusion-vertical-scale dos prédios 3D: 0 até o mapa carregar, depois 1 (a transição de 900 ms faz o crescimento) */
  buildingScale: number;
}

export const BaseTheme = memo(function BaseTheme({ theme, tier, buildingScale }: BaseThemeProps) {
  // a 1ª aplicação entra seca (como o applyTheme(theme, false) do load); da 1ª troca de tema em diante, crossfade
  const [bootTheme] = useState(theme);
  const [themeChanged, setThemeChanged] = useState(false);
  if (!themeChanged && theme !== bootTheme) setThemeChanged(true);
  const animate = themeChanged || theme !== bootTheme;

  const styles = getThemeStyles(theme, animate);

  // ~135 camadas: os elementos só mudam com o tema, então buildingScale/tier não re-renderizam nenhuma delas
  const baseLayers = useMemo(
    () => [
      ...STREETS_V12_LAYERS.map(([id, type, kind]) => baseLayerElement(id, type, kind, styles)),
      ...styles.unthemed.map(unthemedElement),
    ],
    [styles],
  );

  // prédios 3D: cor assada por tema, efeitos caros por tier (applyTierEffects) e a escala que o dono anima
  const extrusionStyle = useMemo((): FillExtrusionLayerStyle => {
    const P = PALETTES[theme];
    const high = tier === 'high';
    const flood = high && theme !== 'day';
    return {
      fillExtrusionColor: [
        'interpolate',
        ['linear'],
        ['get', 'height'],
        0,
        lit(P.bBase, theme, BUILDING_EMISSIVE),
        60,
        lit(P.bTop, theme, BUILDING_EMISSIVE),
      ],
      fillExtrusionColorTransition: animate ? FADE : NO_FADE,
      fillExtrusionHeight: EXTRUSION_HEIGHT,
      fillExtrusionBase: EXTRUSION_BASE,
      fillExtrusionOpacity: 0.85,
      fillExtrusionVerticalGradient: true,
      fillExtrusionVerticalScale: buildingScale,
      // prédios crescendo no 1º load: o dono troca 0 → 1 uma vez só e o nativo interpola (sem reenviar o estilo por quadro)
      fillExtrusionVerticalScaleTransition: GROW,
      // flood light rosa no chão só em high + noite/fim de tarde. Sem as luzes 3D (setLights) o SDK pode ignorar o flood
      // light; a oclusão ambiente funciona na luz clássica.
      fillExtrusionFloodLightColor: '#FF1493',
      fillExtrusionFloodLightIntensity: flood ? 0.3 : 0,
      fillExtrusionFloodLightGroundRadius: flood ? 7 : 0,
      fillExtrusionAmbientOcclusionIntensity: high ? 0.25 : 0,
    };
  }, [theme, tier, buildingScale, animate]);

  return (
    <>
      {baseLayers}
      {/* neon por baixo das ruas; primary antes de highway = mesma ordem do addLayer original */}
      <LineLayer
        id="cz-glow-primary"
        sourceID="composite"
        sourceLayerID="road"
        minZoomLevel={13}
        belowLayerID={FIRST_ROAD_LAYER_ID}
        filter={GLOW_PRIMARY_FILTER}
        style={styles.glowPrimary}
      />
      <LineLayer
        id="cz-glow-highway"
        sourceID="composite"
        sourceLayerID="road"
        minZoomLevel={13}
        belowLayerID={FIRST_ROAD_LAYER_ID}
        filter={GLOW_HIGHWAY_FILTER}
        style={styles.glowHighway}
      />
      {/* maxZoomLevel é obrigatório no tipo do FillExtrusionLayer; 24 = o máximo do style-spec (o mesmo que omitir) */}
      <FillExtrusionLayer
        id="cz-3d"
        sourceID="composite"
        sourceLayerID="building"
        minZoomLevel={14}
        maxZoomLevel={24}
        belowLayerID={FIRST_LABEL_LAYER_ID}
        filter={EXTRUDE_FILTER}
        style={extrusionStyle}
      />
      <Atmosphere style={styles.atmosphere} />
    </>
  );
});
