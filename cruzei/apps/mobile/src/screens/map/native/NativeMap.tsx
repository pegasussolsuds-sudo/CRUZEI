// Mapa nativo do Metch (@rnmapbox/maps, Mapbox Maps SDK v11). Substitui a WebView com mapbox-gl JS: o mapa agora é
// desenhado numa SurfaceView própria (padrão do rnmapbox), composta pelo SurfaceFlinger, fora do pipeline do HWUI onde
// o Moto g54 caía (SIGSEGV em libhwui OpsTask::tryConcat logo depois de criar a WebView).
//
// Interface igual à da época da WebView: a tela manda comandos (bridge.ts: cmd.*) por ref.run() e recebe os mesmos
// eventos por onEvent. Toda a lógica fica no motor (engine/MapEngine.ts); aqui só a árvore do <MapView>.

import React, { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Mapbox, { Camera, MapView, type CameraStop, type MapState } from '@rnmapbox/maps';

import { config } from '../../../config';
import type { InitTier, MapCommand, MapEvent, MapTheme, PerfTier } from '../bridge';
import { BaseTheme } from './theme/BaseTheme';
import { MapImages, MetchLayers } from './layers';
import { useChannel, useChannelSelector } from './engine/channels';
import { INITIAL_CAMERA, type CameraRef } from './engine/camera';
import { MapEngine } from './engine/MapEngine';

export interface NativeMapHandle {
  run(c: MapCommand): void;
}

interface Props {
  initTheme: MapTheme;
  initTier: InitTier;
  onEvent: (ev: MapEvent) => void;
  /** distância do rodapé do mapa até o topo da lista recolhida: logo e atribuição do Mapbox ficam visíveis acima dela */
  ornamentBottom: number;
  accessibilityLabel?: string;
}

const STYLE_URL = 'mapbox://styles/mapbox/streets-v12';
const DEFAULT_CAMERA: CameraStop = { centerCoordinate: INITIAL_CAMERA.center, zoomLevel: INITIAL_CAMERA.zoom, pitch: INITIAL_CAMERA.pitch, heading: INITIAL_CAMERA.bearing };
/** teto de fps do render nativo por tier (o painel do aparelho pode ser de 120 Hz) */
const MAX_FPS: Record<PerfTier, number> = { high: 60, mid: 60, low: 45 };

// token pk só do .env (EXPO_PUBLIC_MAPBOX_TOKEN via config.ts), nunca no app.json; tem de valer antes do 1º MapView
if (config.mapboxToken) {
  Mapbox.setAccessToken(config.mapboxToken).catch(() => {});
}

let telemetryOff = false;
/** telemetria do SDK desligada (privacidade, doc 07); o rnmapbox cria um MapView descartável pra isso (destruído pelo patch) */
function disableTelemetryOnce() {
  if (telemetryOff) return;
  telemetryOff = true;
  try {
    Mapbox.setTelemetryEnabled(false);
  } catch {
    /* versão sem a API: segue */
  }
}

const Base = memo(function Base({ engine }: { engine: MapEngine }) {
  const look = useChannel(engine.ch, 'look');
  const buildingScale = useChannel(engine.ch, 'buildingScale');
  return <BaseTheme theme={look.theme} tier={look.tier} buildingScale={buildingScale} />;
});

/** a árvore do mapa em si: não recebe nada que mude à toa (rótulo de acessibilidade, callbacks da tela) */
const MapTree = memo(function MapTree({ engine, ornamentBottom }: { engine: MapEngine; ornamentBottom: number }) {
  const mapRef = useRef<MapView>(null);
  const camRef = useRef<CameraRef>(null);
  const frameEvents = useChannel(engine.ch, 'frameEvents');
  const tier = useChannelSelector(engine.ch, 'look', (l) => l.tier);

  useEffect(() => {
    engine.attach(mapRef.current, camRef.current);
    return () => {
      engine.attach(null, null);
      engine.dispose();
    };
  }, [engine]);

  const onCameraChanged = useCallback((s: MapState) => engine.onCameraChanged(s), [engine]);
  const onMapIdle = useCallback((s: MapState) => engine.onMapIdle(s), [engine]);
  const onStyle = useCallback(() => engine.onStyleLoaded(), [engine]);
  const onLoaded = useCallback(() => {
    engine.attach(mapRef.current, camRef.current);
    engine.onMapLoaded();
    disableTelemetryOnce();
  }, [engine]);
  const onError = useCallback(() => engine.onLoadError(), [engine]);
  const onFrame = useCallback(() => engine.onRenderFrame(), [engine]);
  const onPress = useCallback(
    (feature: GeoJSON.Feature) => {
      const p = (feature?.properties ?? {}) as { screenPointX?: number; screenPointY?: number };
      if (typeof p.screenPointX === 'number' && typeof p.screenPointY === 'number') void engine.onPress(p.screenPointX, p.screenPointY);
    },
    [engine],
  );

  const ornaments = useMemo(
    () => ({
      logo: { bottom: Math.max(8, ornamentBottom), left: 8 },
      attribution: { bottom: Math.max(8, ornamentBottom), right: 8 },
    }),
    [ornamentBottom],
  );

  return (
    <MapView
      ref={mapRef}
      style={styles.fill}
      styleURL={STYLE_URL}
      projection="mercator"
      scaleBarEnabled={false}
      compassEnabled={false}
      logoEnabled
      attributionEnabled
      logoPosition={ornaments.logo}
      attributionPosition={ornaments.attribution}
      maxPitch={70}
      pitchEnabled
      rotateEnabled
      preferredFramesPerSecond={MAX_FPS[tier]}
      onPress={onPress}
      onCameraChanged={onCameraChanged}
      onMapIdle={onMapIdle}
      onDidFinishLoadingStyle={onStyle}
      onDidFinishLoadingMap={onLoaded}
      onMapLoadingError={onError}
      // no Android o rnmapbox só emite o evento "Fully" a cada quadro renderizado (RNMBXMapView.setupEvents);
      // ligado só com a câmera andando (amostra de fps)
      onDidFinishRenderingFrameFully={frameEvents ? onFrame : undefined}
    >
      <Camera ref={camRef} defaultSettings={DEFAULT_CAMERA} minZoomLevel={10} maxZoomLevel={22} />
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
    // Um motor por vida do componente: o MapView nunca é remontado por key (recriar a superfície GL é caro e arriscado)
    const engineRef = useRef<MapEngine | null>(null);
    if (!engineRef.current) engineRef.current = new MapEngine({ emit: (ev) => onEventRef.current(ev), initTheme, initTier });
    const engine = engineRef.current;

    useImperativeHandle(ref, () => ({ run: (c) => engine.run(c) }), [engine]);

    const onLayout = useCallback((e: LayoutChangeEvent) => engine.setViewport(e.nativeEvent.layout.width, e.nativeEvent.layout.height), [engine]);

    return (
      <View style={styles.fill} onLayout={onLayout} accessibilityLabel={accessibilityLabel}>
        <MapTree engine={engine} ornamentBottom={ornamentBottom} />
      </View>
    );
  }),
);

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFill, backgroundColor: '#0A0A1A' },
});
