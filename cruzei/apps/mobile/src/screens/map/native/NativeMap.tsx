// Mapa nativo do Metch (@maplibre/maplibre-react-native 11, MapLibre Native Android em OpenGL, tiles do OpenFreeMap).
// O mapa é desenhado numa SurfaceView própria (androidView 'surface'), composta pelo SurfaceFlinger, fora do pipeline do
// HWUI onde o Moto g54 caía (SIGSEGV em libhwui OpsTask::tryConcat logo depois de criar a WebView). Sem token nem
// telemetria: o MapLibre não tem nenhum dos dois.
//
// Interface igual à da época da WebView: a tela manda comandos (bridge.ts: cmd.*) por ref.run() e recebe os mesmos
// eventos por onEvent. Toda a lógica fica no motor (engine/MapEngine.ts); aqui só a árvore do <Map>.
//
// NUNCA trocar a prop mapStyle depois de montar: o MLRN recarrega o estilo inteiro e, com fill-extrusion adicionado em
// runtime, o app cai (MLRN#1647). O estilo é uma string fixa por vida do componente (fundo e luz do tema inicial);
// tema e tier mudam só as camadas (theme/).

import React, { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { Alert, Pressable, StyleSheet, Text, View, type LayoutChangeEvent, type NativeSyntheticEvent } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Camera,
  LogManager,
  Map as MapView,
  type CameraRef,
  type InitialViewState,
  type MapRef,
  type PressEvent,
  type PressEventWithFeatures,
  type ViewStateChangeEvent,
} from '@maplibre/maplibre-react-native';

import { config } from '../../../config';
import type { InitTier, MapCommand, MapEvent, MapTheme, PerfTier } from '../bridge';
import { BaseTheme, HORIZON_COLOR, MAP_ATTRIBUTION, MAP_LIGHT, makeBaseStyle } from './theme';
import { MapImages, MetchLayers } from './layers';
import { useChannel, useChannelSelector } from './engine/channels';
import { INITIAL_CAMERA } from './engine/camera';
import { MapEngine } from './engine/MapEngine';

export interface NativeMapHandle {
  run(c: MapCommand): void;
}

interface Props {
  initTheme: MapTheme;
  initTier: InitTier;
  onEvent: (ev: MapEvent) => void;
  /** distância do rodapé do mapa até o topo da lista recolhida: o © dos créditos fica visível acima dela */
  ornamentBottom: number;
  accessibilityLabel?: string;
}

const INITIAL_VIEW: InitialViewState = { center: INITIAL_CAMERA.center, zoom: INITIAL_CAMERA.zoom, pitch: INITIAL_CAMERA.pitch, bearing: INITIAL_CAMERA.bearing };
/** teto de fps do render nativo por tier (o painel do aparelho pode ser de 120 Hz) */
const MAX_FPS: Record<PerfTier, number> = { high: 60, mid: 60, low: 45 };
/**
 * Memória de GL e nativa dos tiles (patch do MLRN, MapLibre Android 13.6.1). Medido no S23 sob carga: GL ~550 MB e nativo
 * ~590 MB. Contas (modelo do tile cover do MapLibre em scratchpad/r3/tiles.js, tela de 360×760 dp):
 * - prefetchZoomDelta 1 (padrão 4): o pré-carregamento monta tiles 4 zooms abaixo da câmera (no z16: um z12 do
 *   OpenMapTiles, 16× a área de um z14, e z14 dos prédios extras) só pra ter o que mostrar se faltar o da vez. O app vive do
 *   z16 ao z19 e o OpenFreeMap para no z14: com 1, o OpenMapTiles não pré-carrega nada e os prédios, 1 nível (z15);
 * - tileCacheEnabled false: o cache guardava, por fonte, até 9 tiles fora da tela COM os buffers montados (27 no relevo,
 *   tiles de 256 px), entre eles o mesmo z14 em cada zoom inteiro por onde a câmera passou (cada um com o 3D dos prédios
 *   de 2,2 km × 2,2 km). Voltar a um zoom/lugar já visto refaz o layout nos workers do MapLibre (fora da thread de UI) e,
 *   enquanto isso, o tile do zoom vizinho que estava na tela segue desenhado;
 * - LOD do horizonte (tileLod*): fica no padrão (desligado no Android, que para em 60°). No modelo, nesta tela ele não tira
 *   nenhum tile da tela entre z15 e z19, e na visão de cidade (z14–15, pitch ≥ 45°) rebaixava a faixa do fundo pra z13/z12:
 *   prédios e rótulos lá longe sumiam e voltavam ao cruzar 45°. O patch ainda aceita as chaves.
 * Se o voo do pino (flyTo de 1,7 s) mostrar áreas vazias no aparelho, o próximo passo é prefetchZoomDelta 2, não o padrão.
 */
const TILE_TUNING = { prefetchZoomDelta: 1, tileCacheEnabled: false };

// tile cancelado ao mover o mapa é normal; o MLRN só rebaixa a variante "Canceled" e a do OkHttp ("stream was reset:
// CANCEL") virava aviso na tela de dev. true = tratado, não loga
LogManager.onLog((e) => e.tag === 'Mbgl-HttpRequest' && /cancel/i.test(e.message));
/** névoa do horizonte: faixa do topo do mapa e opacidade no pitch máximo (60°) */
const HAZE_HEIGHT = '20%';
const HAZE_MAX = 0.8;

type RegionEvent = NativeSyntheticEvent<ViewStateChangeEvent>;

/** mesma cor com alfa (o 'transparent' do gradiente passaria por preto e sujaria a faixa) */
function withAlpha(color: string, a: number): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1];
    return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
  }
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(color);
  return rgb ? `rgba(${rgb[1]},${rgb[2]},${rgb[3]},${a})` : 'transparent';
}

const Base = memo(function Base({ engine }: { engine: MapEngine }) {
  const look = useChannel(engine.ch, 'look');
  const buildingScale = useChannel(engine.ch, 'buildingScale');
  return <BaseTheme theme={look.theme} tier={look.tier} buildingScale={buildingScale} />;
});

/**
 * Névoa do horizonte (o MapLibre Native não tem sky/fog): gradiente da cor do tema pra transparente no topo do mapa,
 * mais forte quanto mais inclinado. View nativa com pointerEvents none — nada de Skia na tela (lição do boot).
 */
const HorizonHaze = memo(function HorizonHaze({ engine }: { engine: MapEngine }) {
  const theme = useChannelSelector(engine.ch, 'look', (l) => l.theme);
  const k = useChannel(engine.ch, 'horizon');
  const colors = useMemo(() => {
    const c = HORIZON_COLOR[theme] ?? HORIZON_COLOR.day;
    return [withAlpha(c, 1), withAlpha(c, 0)] as const;
  }, [theme]);
  if (k <= 0) return null;
  return <LinearGradient pointerEvents="none" colors={colors} style={[styles.haze, { opacity: HAZE_MAX * k }]} />;
});

/**
 * Créditos do mapa: um "©" pequeno e translúcido na cor do tema no lugar do ⓘ nativo. A ODbL do OpenStreetMap e o
 * OpenFreeMap exigem a atribuição visível; o botão recolhido que abre os créditos é a forma mínima aceita.
 */
const MapCredits = memo(function MapCredits({ engine, bottom }: { engine: MapEngine; bottom: number }) {
  const theme = useChannelSelector(engine.ch, 'look', (l) => l.theme);
  const onPress = useCallback(() => Alert.alert('Créditos do mapa', MAP_ATTRIBUTION), []);
  return (
    <Pressable
      onPress={onPress}
      hitSlop={16}
      accessibilityRole="button"
      accessibilityLabel="Créditos do mapa"
      style={[styles.credits, { bottom: Math.round(Math.max(6, bottom)) }]}
    >
      <Text style={[styles.creditsText, { color: theme === 'day' ? '#1A1A2E' : '#FFFFFF' }]}>©</Text>
    </Pressable>
  );
});

/** a árvore do mapa em si: não recebe nada que mude à toa (rótulo de acessibilidade, callbacks da tela) */
const MapTree = memo(function MapTree({ engine, mapStyle }: { engine: MapEngine; mapStyle: string }) {
  const mapRef = useRef<MapRef>(null);
  const camRef = useRef<CameraRef>(null);
  const tier = useChannelSelector(engine.ch, 'look', (l) => l.tier);
  const theme = useChannelSelector(engine.ch, 'look', (l) => l.theme);

  useEffect(() => {
    // refs: a câmera e as fontes só montam depois do 1º layout do <Map>; o motor lê o .current na hora de usar
    engine.attach(mapRef, camRef);
    return () => {
      engine.attach(null, null);
      engine.dispose();
    };
  }, [engine]);

  const onRegionChange = useCallback((e: RegionEvent) => engine.onRegionChange(e.nativeEvent), [engine]);
  const onRegionDidChange = useCallback((e: RegionEvent) => engine.onRegionDidChange(e.nativeEvent), [engine]);
  const onStyle = useCallback(() => engine.onStyleLoaded(), [engine]);
  const onLoaded = useCallback(() => engine.onMapLoaded(), [engine]);
  const onError = useCallback(() => engine.onLoadError(), [engine]);
  const onPress = useCallback(
    (e: NativeSyntheticEvent<PressEvent> | NativeSyntheticEvent<PressEventWithFeatures>) => {
      // point em dp, relativo ao mapa
      const p = e.nativeEvent?.point;
      if (p && Number.isFinite(p[0]) && Number.isFinite(p[1])) void engine.onPress(p[0], p[1]);
    },
    [engine],
  );


  return (
    <MapView
      ref={mapRef}
      style={styles.fill}
      mapStyle={mapStyle}
      light={MAP_LIGHT[theme]}
      androidView="surface"
      compass={false}
      scaleBar={false}
      // sem a marca do MapLibre (a licença BSD não exige) e sem o ⓘ nativo: os créditos obrigatórios ficam no MapCredits
      logo={false}
      attribution={false}
      touchPitch
      touchRotate
      preferredFramesPerSecond={MAX_FPS[tier]}
      onPress={onPress}
      onRegionWillChange={onRegionChange}
      onRegionIsChanging={onRegionChange}
      onRegionDidChange={onRegionDidChange}
      onDidFinishLoadingStyle={onStyle}
      onDidFinishLoadingMap={onLoaded}
      onDidFailLoadingMap={onError}
      // sem handler de quadro: o patch do MLRN só manda os eventos de quadro pro JS quando alguém ouve. O fps é contado no
      // nativo com a câmera andando e chega no onRegionDidChange (renderFps)
      tileTuning={TILE_TUNING}
    >
      {/* pitch: o MapLibre Android já limita a 60° (não há maxPitch no MLRN); o motor nunca pede mais que isso */}
      <Camera ref={camRef} initialViewState={INITIAL_VIEW} minZoom={10} maxZoom={22} />
      <Base engine={engine} />
      <MapImages engine={engine} />
      <MetchLayers engine={engine} />
    </MapView>
  );
});

export const NativeMap = memo(
  forwardRef<NativeMapHandle, Props>(function NativeMap({ initTheme, initTier, onEvent, ornamentBottom, accessibilityLabel }, ref) {
    const onEventRef = useRef(onEvent);
    onEventRef.current = onEvent;
    // ref (não useMemo): o Fast Refresh recalcula useMemo e criaria um motor vazio por baixo de um mapa já carregado.
    // Um motor por vida do componente: o <Map> nunca é remontado por key (recriar a superfície GL é caro e arriscado)
    const engineRef = useRef<MapEngine | null>(null);
    if (!engineRef.current) engineRef.current = new MapEngine({ emit: (ev) => onEventRef.current(ev), initTheme, initTier });
    const engine = engineRef.current;
    // string estável (o <Map> faz JSON.stringify de objeto a cada render e o nativo recarregaria o estilo): montada uma
    // vez com o fundo e a luz do tema inicial, pro fundo não piscar na cor da noite até o BaseTheme aplicar o tema
    const styleRef = useRef<string | null>(null);
    if (!styleRef.current) styleRef.current = JSON.stringify(makeBaseStyle(initTheme, config.apiBaseUrl));

    useImperativeHandle(ref, () => ({ run: (c) => engine.run(c) }), [engine]);

    const onLayout = useCallback((e: LayoutChangeEvent) => engine.setViewport(e.nativeEvent.layout.width, e.nativeEvent.layout.height), [engine]);

    return (
      <View style={styles.fill} onLayout={onLayout} accessibilityLabel={accessibilityLabel}>
        <MapTree engine={engine} mapStyle={styleRef.current} />
        <HorizonHaze engine={engine} />
        <MapCredits engine={engine} bottom={ornamentBottom} />
      </View>
    );
  }),
);

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFill, backgroundColor: '#0A0A1A' },
  haze: { position: 'absolute', top: 0, left: 0, right: 0, height: HAZE_HEIGHT },
  credits: { position: 'absolute', right: 10, paddingHorizontal: 4, paddingVertical: 2 },
  creditsText: { fontSize: 12, fontWeight: '600', opacity: 0.45 },
});
