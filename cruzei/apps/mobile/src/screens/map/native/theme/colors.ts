// Cores finais do mapa base por tema (OpenFreeMap / esquema OpenMapTiles). O chão sai das paletas do Metch com a luz
// antiga assada (./palette: lit), que é a identidade que o app já tinha no Mapbox; o resto (prédios por altura,
// sombras, neon, água, relevo) é a "arte premium" feita só com o que o MapLibre Native desenha.
//
// Prédios NÃO passam por lit(): no MapLibre a luz clássica (MAP_LIGHT, prop light do <Map>) já sombreia as extrusões;
// assar aqui escureceria duas vezes. As cores deles são as do teto sob essa luz.

import type { MapTheme } from '../../bridge';
import { lit, PALETTES } from './palette';

export interface BaseColors {
  bg: string;
  landuse: string;
  /** lavoura/pasto na borda da cidade: quase o fundo */
  farmland: string;
  park: string;
  parkAlpha: number;
  /** mata (wood) um tom abaixo do parque */
  wood: string;
  /** contorno fino dos parques (z15+) */
  parkLine: string;
  water: string;
  /** rios/córregos em linha */
  waterway: string;
  /** brilho na margem da água: cor e opacidade */
  glint: string;
  glintAlpha: number;
  /** opacidade da textura de brilho da água */
  rippleAlpha: number;
  aeroway: string;
  /** áreas de pedestre (praças, calçadões em polígono) */
  plaza: string;
  roadCase: string;
  road: string;
  path: string;
  secondary: string;
  primary: string;
  highway: string;
  rail: string;
  boundary: string;
  /** neon das ruas (SEM luz, cor crua da paleta): halo largo, meio e núcleo fino */
  neonPrimary: string;
  neonHighway: string;
  neonHalo: number;
  neonMid: number;
  neonCore: number;
  /** prédio por faixa de altura: < 8 m, 8-25 m, 25-60 m, 60 m+ */
  bld: readonly [string, string, string, string];
  /** sombra projetada falsa (fill deslocado) e sombra de contato (linha borrada no pé do prédio) */
  shadow: string;
  shadowAlpha: number;
  ao: string;
  aoAlpha: number;
  /** flood light neon no chão em volta dos prédios altos (só tier high) */
  floodAlpha: number;
  /** relevo (hillshade multidirecional, 2 luzes): cores SEMPRE em array */
  hillShadow: readonly [string, string];
  hillHighlight: readonly [string, string];
  hillAccent: string;
  hillExaggeration: number;
  text: string;
  halo: string;
  /** rótulos secundários (ruas pequenas, números de casa) */
  textDim: string;
  /** bairros */
  district: string;
  /** nomes de rios/lagos */
  waterText: string;
  poiIconAlpha: number;
}

function build(theme: MapTheme): BaseColors {
  const P = PALETTES[theme];
  const L = (c: string) => lit(c, theme);
  switch (theme) {
    case 'day':
      return {
        bg: '#F3F5EC',
        landuse: '#E9EEE0',
        farmland: '#EEF2E5',
        park: L(P.park),
        parkAlpha: P.parkAlpha,
        wood: '#78DC00',
        parkLine: '#5FBF00',
        water: L(P.water),
        waterway: '#3FD9EA',
        glint: '#FFFFFF',
        glintAlpha: 0.75,
        rippleAlpha: 0.55,
        aeroway: '#E6EAE4',
        plaza: '#FFFFFF',
        roadCase: '#D6DCCB',
        road: L(P.road),
        path: '#C9D2C2',
        secondary: L(P.secondary),
        primary: L(P.primary),
        highway: L(P.highway),
        rail: '#B9BFB6',
        boundary: '#9AA6C8',
        neonPrimary: P.primary,
        neonHighway: P.highway,
        neonHalo: 0,
        neonMid: 0,
        neonCore: 0,
        bld: ['#F2EEC4', '#F6F3D8', '#FAF8EA', '#FFFFFF'],
        shadow: '#2E3A1E',
        shadowAlpha: 0.2,
        ao: '#3A4428',
        aoAlpha: 0.3,
        floodAlpha: 0,
        hillShadow: ['rgba(60, 72, 30, 0.32)', 'rgba(60, 72, 30, 0.18)'],
        hillHighlight: ['rgba(255, 255, 255, 0.35)', 'rgba(255, 255, 240, 0.2)'],
        hillAccent: 'rgba(70, 80, 40, 0.1)',
        hillExaggeration: 0.6,
        text: P.text,
        halo: P.halo,
        textDim: '#4A4F5A',
        district: '#5A5F6E',
        waterText: '#0E7F8E',
        poiIconAlpha: 1,
      };
    case 'dusk':
      return {
        bg: L(P.bg),
        landuse: L(P.landuse),
        farmland: '#3B213C',
        park: L(P.park),
        parkAlpha: P.parkAlpha,
        wood: '#35501F',
        parkLine: '#4E7A2E',
        water: L(P.water),
        waterway: '#23506A',
        glint: '#FF9AC8',
        glintAlpha: 0.35,
        rippleAlpha: 0.22,
        aeroway: '#43284A',
        plaza: '#5E3F5E',
        roadCase: L(P.roadCase),
        road: L(P.road),
        path: '#6A4868',
        secondary: L(P.secondary),
        primary: L(P.primary),
        highway: L(P.highway),
        rail: '#6E4E70',
        boundary: '#9A7AB8',
        neonPrimary: P.primary,
        neonHighway: P.highway,
        neonHalo: 0.1,
        neonMid: 0.22,
        neonCore: 0.55,
        bld: ['#5E4470', '#6E5484', '#836A9C', '#9C84B4'],
        shadow: '#12051C',
        shadowAlpha: 0.32,
        ao: '#12051C',
        aoAlpha: 0.36,
        floodAlpha: 0.12,
        hillShadow: ['rgba(20, 5, 30, 0.38)', 'rgba(20, 5, 30, 0.22)'],
        hillHighlight: ['rgba(255, 150, 200, 0.14)', 'rgba(255, 190, 150, 0.08)'],
        hillAccent: 'rgba(20, 5, 30, 0.12)',
        hillExaggeration: 0.5,
        text: P.text,
        halo: P.halo,
        textDim: '#D9C6E0',
        district: '#E8C8E8',
        waterText: '#9FD8EA',
        poiIconAlpha: 0.92,
      };
    case 'night':
    default:
      return {
        bg: L(P.bg),
        landuse: L(P.landuse),
        farmland: '#08061A',
        park: L(P.park),
        parkAlpha: P.parkAlpha,
        wood: '#0D1A10',
        parkLine: '#1C3A1C',
        water: L(P.water),
        waterway: '#0B2A48',
        glint: '#35D6FF',
        glintAlpha: 0.4,
        rippleAlpha: 0.12,
        aeroway: '#100C22',
        plaza: '#1C1430',
        roadCase: L(P.roadCase),
        road: '#221838',
        path: '#261C3C',
        secondary: L(P.secondary),
        primary: L(P.primary),
        highway: L(P.highway),
        rail: '#2A2240',
        boundary: '#5A4A8A',
        neonPrimary: P.primary,
        neonHighway: P.highway,
        neonHalo: 0.24,
        neonMid: 0.5,
        neonCore: 0.9,
        bld: ['#15112A', '#1C1734', '#252042', '#302A54'],
        shadow: '#000000',
        shadowAlpha: 0,
        ao: '#000000',
        aoAlpha: 0.5,
        floodAlpha: 0.34,
        hillShadow: ['rgba(0, 0, 0, 0.45)', 'rgba(0, 0, 0, 0.25)'],
        hillHighlight: ['rgba(140, 150, 255, 0.07)', 'rgba(180, 120, 255, 0.05)'],
        hillAccent: 'rgba(0, 0, 0, 0.12)',
        hillExaggeration: 0.45,
        text: P.text,
        halo: P.halo,
        textDim: '#B9B2D0',
        district: '#C9B8F0',
        waterText: '#5FC4E6',
        poiIconAlpha: 0.78,
      };
  }
}

export const BASE_COLORS: Record<MapTheme, BaseColors> = {
  day: build('day'),
  dusk: build('dusk'),
  night: build('night'),
};
