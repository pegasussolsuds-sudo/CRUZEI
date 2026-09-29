// Tema do mapa base (MapLibre + OpenFreeMap): todas as camadas base como <Layer> filhos do <Map>, montadas sempre
// (./layers). O estilo JSON (./style: BASE_STYLE/makeBaseStyle) só tem as fontes e o background; aqui o tema troca por
// props com *-transition (o nativo interpola cor constante/por zoom) e o tier liga/desliga os efeitos caros por
// visibility. Registra também as texturas geradas em código (./textures: fachadas acesas e brilho da água).
//
// ATENÇÃO: não desmonte nem troque a key deste componente com o mapa vivo. No MLRN, desmontar um <Layer> REMOVE a
// camada do estilo (MLRNLayer.removeFromMap), inclusive o background do JSON.

import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Images, Layer, type ImageEntry, type LayerProps } from '@maplibre/maplibre-react-native';

import type { MapTheme, PerfTier } from '../../bridge';
import { buildBaseLayers, DIP_MS, SETTLE_MS, type BaseLayerSpec } from './layers';
import { TEX_SCALE, textureDataUris } from './textures';

export interface BaseThemeProps {
  theme: MapTheme;
  tier: PerfTier;
  /**
   * prédios "crescendo" no boot (0..1; o MapLibre não tem vertical-scale): 0 = invisíveis; qualquer valor > 0 entra
   * com fade de 900 ms na opacidade e a altura segue em degraus de 0,25. Pular 0 -> 1 = aparecem já na altura real;
   * pra crescerem, o motor manda 0,25 / 0,5 / 0,75 / 1 espaçados (~150 ms).
   */
  buildingScale: number;
}

let texImages: Record<string, ImageEntry> | null = null;
/** texturas como data URI com densidade 2 (o <Images> repassa {uri, scale} ao nativo pelo resolveAssetSource) */
function textureImages(): Record<string, ImageEntry> {
  if (!texImages) {
    const out: Record<string, ImageEntry> = {};
    const uris = textureDataUris();
    for (const name of Object.keys(uris)) out[name] = { source: { uri: uris[name], scale: TEX_SCALE } };
    texImages = out;
  }
  return texImages;
}

interface Cached {
  json: string;
  el: React.ReactElement;
}

export const BaseTheme = memo(function BaseTheme({ theme, tier, buildingScale }: BaseThemeProps) {
  // a 1ª aplicação entra seca; da 1ª troca de tema em diante, crossfade
  const [bootTheme] = useState(theme);
  const [themeChanged, setThemeChanged] = useState(false);
  if (!themeChanged && theme !== bootTheme) setThemeChanged(true);
  const fade = themeChanged || theme !== bootTheme;

  // cor/textura dos prédios são por feature (não interpolam): o tema delas ("shown") só troca no fundo do mergulho
  const [shown, setShown] = useState(theme);
  useEffect(() => {
    if (shown === theme) return undefined;
    const id = setTimeout(() => setShown(theme), DIP_MS);
    return () => clearTimeout(id);
  }, [theme, shown]);

  // assentou (sem troca em andamento): a extrusão fora de uso sai por visibility, depois que a opacidade dela zerou
  const settleKey = `${theme}|${shown}|${tier}`;
  const [settledKey, setSettledKey] = useState(settleKey);
  useEffect(() => {
    if (shown !== theme || settledKey === settleKey) return undefined;
    const id = setTimeout(() => setSettledKey(settleKey), SETTLE_MS);
    return () => clearTimeout(id);
  }, [settleKey, settledKey, shown, theme]);
  const settled = settledKey === settleKey;

  const specs = useMemo(
    () => buildBaseLayers({ theme, shown, tier, scale: buildingScale, fade, settled }),
    [theme, shown, tier, buildingScale, fade, settled],
  );

  // o <Layer> do MLRN reenvia o estilo inteiro ao nativo a cada render: reaproveita o MESMO elemento quando a spec
  // da camada não mudou, e o React nem re-renderiza ela (troca de buildingScale só mexe nas camadas dos prédios)
  const cache = useRef(new Map<string, Cached>());
  const layers = specs.map((spec: BaseLayerSpec) => {
    const json = JSON.stringify(spec);
    const hit = cache.current.get(spec.id);
    if (hit && hit.json === json) return hit.el;
    // as specs são arrays genéricos do style-spec (e têm a prop só-nativa rounded-corner): o cast é só de tipo
    const el = <Layer key={spec.id} {...(spec as unknown as LayerProps)} />;
    cache.current.set(spec.id, { json, el });
    return el;
  });

  return (
    <>
      <Images images={textureImages()} />
      {layers}
    </>
  );
});
