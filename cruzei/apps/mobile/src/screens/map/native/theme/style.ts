// Estilo base do mapa (MapLibre): OpenFreeMap público (esquema OpenMapTiles, z14, sem chave), glyphs Noto Sans e sprite
// do OFM, relevo terrarium da AWS e os prédios extras do nosso backend (footprints da Microsoft onde o OSM não tem
// prédio). O JSON só tem as fontes e a camada background: todas as outras camadas base são <Layer> React no BaseTheme,
// pra o tema trocar por props com transição. NUNCA troque a prop mapStyle depois de montar (recarregar o estilo com
// fill-extrusion em runtime derruba o app: MLRN#1647).
//
// TS puro (sem react-native): o preview/validador do scratchpad importa este arquivo direto. Por isso a base da API
// entra por parâmetro (quem monta o <Map> lê do config do app).

import type { LightSpecification, StyleSpecification } from '@maplibre/maplibre-react-native';

import type { MapTheme } from '../../bridge';
import { BASE_COLORS } from './colors';

/** ids das fontes do estilo */
export const SRC_OMT = 'openmaptiles';
export const SRC_DEM = 'cz-dem';
/** prédios extras (MVT do backend: GET /v1/tiles/bld/{z}/{x}/{y}.mvt) */
export const SRC_BLD = 'cz-bld';
/** camada do MVT dos prédios extras: polígonos com `height` e `min_height` (m) */
export const BLD_SOURCE_LAYER = 'bld';
/**
 * faixa de zoom pedida ao backend (ele serve 13–16); acima do 16 o MapLibre faz overzoom do 16. Começa no 14 = B_Z0 das
 * camadas de prédio: com 13, o prefetch do MapLibre Native baixava o z13 (até ~120 KB gzip cada) que nenhuma camada desenha.
 */
const BLD_MIN_Z = 14;
const BLD_MAX_Z = 16;

/** URL dos tiles dos prédios extras a partir da base da API do app (a que já termina em /v1) */
export function bldTilesUrl(apiBaseUrl: string): string {
  return `${apiBaseUrl.replace(/\/+$/, '')}/tiles/bld/{z}/{x}/{y}.mvt`;
}

const OFM_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';
const DEM_ATTRIBUTION =
  '<a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank">Terrain Tiles</a> (Mapzen/AWS): SRTM, GMTED2010 e 3DEP cortesia do U.S. Geological Survey; ETOPO1: NOAA';
// altura dos extras hoje é heurística por área (sem 3D-GloBFP): se o backend passar a servir a altura do 3D-GloBFP,
// somar aqui e no MAP_ATTRIBUTION o crédito CC BY 4.0 dele (Che et al. 2024, ESSD 16:5357)
const BLD_ATTRIBUTION =
  '<a href="https://github.com/microsoft/GlobalMLBuildingFootprints" target="_blank">Building footprints &copy; Microsoft</a> (ODbL)';

/** créditos exigidos pelas fontes em uso, pro ⓘ do app (texto puro, uma fonte por linha) */
export const MAP_ATTRIBUTION = [
  'OpenFreeMap © OpenMapTiles Data from OpenStreetMap',
  '© colaboradores do OpenStreetMap (ODbL) — openstreetmap.org/copyright',
  'Building footprints © Microsoft (ODbL): prédios que faltam no OSM, de Global ML Building Footprints — github.com/microsoft/GlobalMLBuildingFootprints',
  'Relevo: Terrain Tiles (Mapzen, AWS Open Data). SRTM, GMTED2010 e 3DEP: cortesia do U.S. Geological Survey; ETOPO1: U.S. National Oceanic and Atmospheric Administration; demais fontes em github.com/tilezen/joerd/blob/master/docs/attribution.md',
].join('\n');

/** fontes dos rótulos (glyphs do OFM): o motor troca 'DIN Pro Medium'/'Arial Unicode MS Regular' por estas */
export const MAP_FONTS = {
  regular: ['Noto Sans Regular'],
  bold: ['Noto Sans Bold'],
  italic: ['Noto Sans Italic'],
} as const;

/** sol/lua por tema: de onde vem a luz (graus, azimute a partir do norte no sentido horário; polar 0 = a pino) */
export interface SunPosition {
  azimuth: number;
  polar: number;
}
// prettier-ignore
export const SUN: Record<MapTheme, SunPosition> = {
  // de dia: sol do meio-dia no hemisfério sul, ao norte e alto. As fachadas viradas pra câmera (sul) ficam na sombra
  // (dá volume) e a sombra projetada cai pra frente dos prédios, onde se vê
  day:   { azimuth: 330, polar: 35 },
  // entardecer: sol baixo a oeste, sombras longas pro leste
  dusk:  { azimuth: 280, polar: 62 },
  // noite: lua alta, quase sem sombra (quem manda são as janelas e o neon)
  night: { azimuth: 160, polar: 25 },
};

const LIGHT_FADE = { duration: 800, delay: 0 };

/**
 * prop `light` do <Map> por tema. No MapLibre a luz clássica só afeta extrusões (prédios); intensity perto de 0 deixa
 * tudo chapado e anula o gradiente vertical, e a cor multiplica tudo (inclusive as janelas acesas da textura) — por
 * isso a noite usa luz quase branca e o "escuro" vem das cores/texturas. Constantes: a transição interpola.
 */
// prettier-ignore
export const MAP_LIGHT: Record<MapTheme, LightSpecification> = {
  day:   { anchor: 'map', position: [1.15, SUN.day.azimuth, SUN.day.polar],     color: '#FFFFFF', intensity: 0.45,
           'position-transition': LIGHT_FADE, 'color-transition': LIGHT_FADE, 'intensity-transition': LIGHT_FADE },
  dusk:  { anchor: 'map', position: [1.5, SUN.dusk.azimuth, SUN.dusk.polar],    color: '#FFC8DC', intensity: 0.45,
           'position-transition': LIGHT_FADE, 'color-transition': LIGHT_FADE, 'intensity-transition': LIGHT_FADE },
  night: { anchor: 'map', position: [1.2, SUN.night.azimuth, SUN.night.polar],  color: '#ECE8FF', intensity: 0.3,
           'position-transition': LIGHT_FADE, 'color-transition': LIGHT_FADE, 'intensity-transition': LIGHT_FADE },
};

/**
 * névoa de horizonte (o MapLibre Native não tem sky/fog): o NativeMap desenha um gradiente de tela por cima do mapa,
 * transparente embaixo e nesta cor no topo, com alfa proporcional ao pitch
 */
export const HORIZON_COLOR: Record<MapTheme, string> = {
  day: '#E4F0F2',
  dusk: '#5C2F5C',
  night: '#0D0A26',
};

/** id da primeira camada de rótulo base: quem precisar desenhar abaixo dos rótulos usa beforeId={FIRST_LABEL_LAYER_ID} */
export const FIRST_LABEL_LAYER_ID = 'base-label-waterway';

/**
 * estilo base com o fundo e a luz de um tema: monte o <Map> UMA vez com makeBaseStyle(tema inicial, config.apiBaseUrl)
 * (evita o fundo piscar na cor errada até o BaseTheme aplicar o tema) e nunca mais troque. A base da API (…/v1) vira a
 * URL dos prédios extras: é constante de build, então já está pronta quando o mapa monta.
 */
export function makeBaseStyle(theme: MapTheme, apiBaseUrl: string): StyleSpecification {
  return {
    version: 8,
    name: 'Metch base',
    sources: {
      [SRC_OMT]: {
        type: 'vector',
        url: 'https://tiles.openfreemap.org/planet',
        attribution: OFM_ATTRIBUTION,
      },
      // encoding tem de ir no JSON e com `tiles` (com `url` o nativo ignora o encoding: maplibre-native#4357)
      [SRC_DEM]: {
        type: 'raster-dem',
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 12,
        attribution: DEM_ATTRIBUTION,
      },
      // tiles de 512 px como os do OFM (padrão do vector): no mesmo zoom de mapa os dois conjuntos pedem o mesmo z
      [SRC_BLD]: {
        type: 'vector',
        tiles: [bldTilesUrl(apiBaseUrl)],
        minzoom: BLD_MIN_Z,
        maxzoom: BLD_MAX_Z,
        attribution: BLD_ATTRIBUTION,
      },
    },
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    // ícones dos POIs base, setas de mão única e escudos de rodovia
    sprite: 'https://tiles.openfreemap.org/sprites/ofm_f384/ofm',
    light: MAP_LIGHT[theme],
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': BASE_COLORS[theme].bg } }],
  };
}
