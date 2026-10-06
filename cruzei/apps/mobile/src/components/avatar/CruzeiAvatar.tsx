import type { AvatarConfig } from '@cruzei/shared-types';
import React, { memo, useEffect, useId, useMemo, useState } from 'react';
import { Image, StyleSheet, View, type ViewStyle } from 'react-native';
import Svg, { ClipPath, Defs, Ellipse, FeGaussianBlur, Filter, G, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';

import { AVATAR_VIEWBOX, buildAvatarLayers, buildAvatarRig, bustBoxFor, keyOf } from '../../avatar';
import { MAP_HEAD_SCALE } from '../../avatar/anatomy';
import type { BuildOptions } from '../../avatar/ctx';
import { zero, type Pose } from '../../avatar/pose';
import { applyScene } from '../../avatar/scene';
import { buildSvgModel, microLayers, type SvgPathNode } from '../../avatar/svgModel';

import { avatarPng } from '../../screens/map/native/images/draw';
import { mapImages } from '../../screens/map/native/images/store';

import { staticAura, staticBackdrop } from './stage/fx-static';
import { FxSvgLayer } from './stage/fx-svg-view';

export type AvatarMode = 'full' | 'bust';

export interface CruzeiAvatarProps {
  config: AvatarConfig;
  /** altura em px no modo full (largura = size * 100/140); lado no modo bust */
  size?: number;
  mode?: AvatarMode;
  /** sombra elíptica embaixo dos pés (só full) */
  groundShadow?: boolean;
  /** fundo circular atrás (bust) — cor ou undefined */
  backgroundColor?: string;
  style?: ViewStyle;
  accessibilityLabel?: string;
  /** dentro de um botão/rádio que já tem rótulo: some do leitor de tela (sem foco nem leitura dobrada) */
  decorative?: boolean;
  /** pose parada (mesma matemática do mapa e do palco); ausente = repouso. A cena (veículo, pet no colo) entra sempre. */
  pose?: Pose | null;
  /** desfoque de verdade (FeGaussianBlur) em vez do aproximado — só em telas grandes, nunca em listas */
  hq?: boolean;
  /** desenha o fundo da config (slot `backdrop`), parado, recortado no círculo (busto) ou nos cantos (corpo inteiro) */
  showBackdrop?: boolean;
  /** desenha a aura da config parada (padrão true) */
  showAura?: boolean;
  /** mão aberta (palma pra câmera) por lado — miniatura de animação que pede (emoteHands) */
  hands?: BuildOptions['hands'] | null;
}

/** tamanho (px) até onde o avatar sai no nível de detalhe leve (lista, mapa, miniatura) */
export const AVATAR_LITE_MAX_PX = 100;
/** até este tamanho (px) a miniatura também perde os véus de sombra quase invisíveis (svgModel.microLayers) */
export const AVATAR_MICRO_MAX_PX = 56;
/** corpo inteiro abaixo disto: a cabeça cresce MAP_HEAD_SCALE (como no mapa), senão o rosto some */
export const AVATAR_SMALL_FULL_PX = 64;

/** some do leitor de tela (avatar dentro de um controle que já tem rótulo) */
const HIDDEN_A11Y = { accessible: false, importantForAccessibility: 'no-hide-descendants' } as const;

/**
 * cache do módulo das camadas por visual (chave + modo + detalhe + sombra + mãos): voltar pra uma aba ou rolar a lista
 * não remonta o desenho (~10 ms por avatar). LRU pequeno.
 */
const LAYER_CACHE_MAX = 120;
const layerCache = new Map<string, ReturnType<typeof buildAvatarLayers>>();
function cachedLayers(config: AvatarConfig, key: string, opts: BuildOptions): ReturnType<typeof buildAvatarLayers> {
  const k = `${key}|${opts.mode}|${opts.lod}|${opts.groundShadow ? 1 : 0}|${opts.hands ? JSON.stringify(opts.hands) : ''}`;
  const hit = layerCache.get(k);
  if (hit) {
    layerCache.delete(k);
    layerCache.set(k, hit);
    return hit;
  }
  const layers = buildAvatarLayers(config, opts);
  if (layerCache.size >= LAYER_CACHE_MAX) {
    const oldest = layerCache.keys().next().value;
    if (oldest !== undefined) layerCache.delete(oldest);
  }
  layerCache.set(k, layers);
  return layers;
}

/**
 * Avatar Metch em vetor (react-native-svg). Mesmas camadas do mapa e do palco → identidade consistente em todo lugar.
 * `mode="bust"` recorta cabeça + ombros (listas, chat, perfil); `mode="full"` corpo inteiro (customizador, match).
 * Suporta o contrato inteiro da camada: gradiente (gf/gs), recorte (cp), desfoque (b, aproximado por padrão) e
 * tracejado (da), com ids únicos por instância. Listas usam SEMPRE este componente (nunca o palco Skia).
 */
function CruzeiAvatarInner({ config, size = 64, mode = 'bust', groundShadow = false, backgroundColor, style, accessibilityLabel, decorative = false, pose, hq = false, showBackdrop = false, showAura = true, hands }: CruzeiAvatarProps) {
  const key = keyOf(config);
  const rawId = useId();
  const idp = useMemo(() => 'a' + rawId.replace(/[^a-zA-Z0-9]/g, '') + '_', [rawId]);
  const shadow = groundShadow && mode === 'full';
  // key resume a config (o objeto pode mudar de identidade sem mudar o visual)
  // até ~100 px o detalhe fino (trama, costura, fio de cabelo) nem aparece: nível leve (shading.lodCtx)
  const lod: 'full' | 'lite' = size <= AVATAR_LITE_MAX_PX ? 'lite' : 'full';
  const handsKey = hands ? JSON.stringify(hands) : '';
  const layers = useMemo(() => cachedLayers(config, key, { groundShadow: shadow, mode, lod, ...(hands ? { hands } : {}) }), [key, shadow, mode, lod, handsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const rig = useMemo(() => buildAvatarRig(config, { mode }), [key, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const headScale = mode === 'full' && size < AVATAR_SMALL_FULL_PX ? MAP_HEAD_SCALE : 1;
  const model = useMemo(() => {
    const posed = applyScene(pose ?? zero(), rig.scene, 0);
    return buildSvgModel(size <= AVATAR_MICRO_MAX_PX ? microLayers(layers) : layers, { idp, rig, pose: posed, blur: hq ? 'filter' : 'approx', headScale });
  }, [layers, rig, pose, idp, hq, headScale, size]);
  // busto: recorte desta pessoa (olhos a 42%, cabelo e chapéu inteiros)
  const vb = useMemo(() => (mode === 'bust' ? bustBoxFor(config) : AVATAR_VIEWBOX), [key, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const width = mode === 'bust' ? size : Math.round((size * vb.w) / vb.h);
  const height = size;
  // aura e fundo parados (o palco Skia é que anima); o brilho de base usa o id `${idp}aura`
  const fxAura = useMemo(() => (showAura ? staticAura(config, mode, vb) : null), [key, mode, showAura]); // eslint-disable-line react-hooks/exhaustive-deps
  const fxBackdrop = useMemo(() => (showBackdrop ? staticBackdrop(config, mode, vb) : null), [key, mode, showBackdrop]); // eslint-disable-line react-hooks/exhaustive-deps
  const aura = fxAura?.color;
  const auraId = `${idp}aura`;
  // listas/miniaturas: PNG do Skia de CPU (desfoque de verdade, um nó só, cache em disco como o mapa); o SVG aproximado
  // só aparece se o PNG falhar. hq = SVG com filtro (telas grandes).
  const rasterKey = hq ? null : `av|${key}|${mode}|${lod}|${shadow ? 1 : 0}|${size}|${headScale}|${pose ? JSON.stringify(pose) : ''}|${handsKey}`;
  const [raster, setRaster] = useState<{ k: string; uri: string | null } | null>(() => {
    const ref = rasterKey ? mapImages.get(rasterKey) : undefined;
    return ref && rasterKey ? { k: rasterKey, uri: 'file://' + ref.path } : null;
  });
  useEffect(() => {
    if (!rasterKey) return;
    let alive = true;
    const lay = size <= AVATAR_MICRO_MAX_PX ? microLayers(layers) : layers;
    void mapImages
      .request(rasterKey, 0, () => avatarPng(lay, rig, pose ?? null, vb, width, height, headScale !== 1))
      .then((ref) => alive && setRaster({ k: rasterKey, uri: ref ? 'file://' + ref.path : null }));
    return () => {
      alive = false;
    };
  }, [rasterKey]); // eslint-disable-line react-hooks/exhaustive-deps -- a chave resume tudo
  const rasterUri = raster && raster.k === rasterKey ? raster.uri : undefined;
  const svgBody = !rasterKey || rasterUri === null;
  const hasDefs = !!aura || (svgBody && (model.grads.length > 0 || model.clips.length > 0 || model.blurs.length > 0));

  return (
    <View
      style={[{ width, height }, backgroundColor ? { backgroundColor, borderRadius: mode === 'bust' ? size / 2 : 16, overflow: 'hidden' } : null, style]}
      {...(decorative ? HIDDEN_A11Y : { accessibilityRole: 'image' as const, accessibilityLabel: accessibilityLabel ?? 'Avatar' })}
    >
      <Svg width={width} height={height} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} style={StyleSheet.absoluteFill}>
        {hasDefs ? (
          <Defs>
            {aura ? (
              <RadialGradient id={auraId} cx="50%" cy="50%" r="50%">
                <Stop offset="0%" stopColor={aura} stopOpacity={0.3} />
                <Stop offset="70%" stopColor={aura} stopOpacity={0.1} />
                <Stop offset="100%" stopColor={aura} stopOpacity={0} />
              </RadialGradient>
            ) : null}
            {svgBody && model.grads.map((g) =>
              g.kind === 'linear' ? (
                <LinearGradient key={g.id} id={g.id} gradientUnits="userSpaceOnUse" x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2}>
                  {g.stops.map((s, i) => (
                    <Stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={s.opacity} />
                  ))}
                </LinearGradient>
              ) : (
                <RadialGradient key={g.id} id={g.id} gradientUnits="userSpaceOnUse" cx={g.cx} cy={g.cy} r={g.r} fx={g.fx} fy={g.fy}>
                  {g.stops.map((s, i) => (
                    <Stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={s.opacity} />
                  ))}
                </RadialGradient>
              ),
            )}
            {svgBody && model.clips.map((c) => (
              <ClipPath key={c.id} id={c.id}>
                <Path d={c.d} />
              </ClipPath>
            ))}
            {svgBody && model.blurs.map((b) => (
              <Filter key={b.id} id={b.id} filterUnits="userSpaceOnUse" x={-60} y={-60} width={220} height={260}>
                <FeGaussianBlur stdDeviation={b.sigma} />
              </Filter>
            ))}
          </Defs>
        ) : null}
        {fxBackdrop ? <FxSvgLayer model={fxBackdrop} idp={`${idp}fxd_`} /> : null}
        {aura ? <Ellipse cx={vb.x + vb.w / 2} cy={vb.y + vb.h / 2} rx={vb.w * 0.52} ry={vb.h * 0.48} fill={`url(#${auraId})`} /> : null}
        {fxAura ? <FxSvgLayer model={fxAura.back} idp={`${idp}fxb_`} /> : null}
        {svgBody && model.runs.map((r, ri) =>
          r.transform ? (
            <G key={ri} transform={r.transform}>
              {r.nodes.map(renderNode)}
            </G>
          ) : (
            r.nodes.map(renderNode)
          ),
        )}
        {svgBody && fxAura ? <FxSvgLayer model={fxAura.front} idp={`${idp}fxf_`} /> : null}
      </Svg>
      {rasterUri ? <Image source={{ uri: rasterUri }} style={{ position: 'absolute', left: 0, top: 0, width, height }} fadeDuration={0} /> : null}
      {rasterUri && fxAura ? (
        <Svg width={width} height={height} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} style={StyleSheet.absoluteFill}>
          <FxSvgLayer model={fxAura.front} idp={`${idp}fxF_`} />
        </Svg>
      ) : null}
    </View>
  );
}

function renderNode(p: SvgPathNode) {
  const path = (
    <Path
      key={p.key}
      d={p.d}
      fill={p.fill}
      fillRule={p.fillRule}
      stroke={p.stroke}
      strokeWidth={p.strokeWidth}
      strokeLinecap={p.cap}
      strokeLinejoin="round"
      strokeDasharray={p.dash}
      opacity={p.opacity}
      filter={p.filterId ? `url(#${p.filterId})` : undefined}
      // sem filtro, o recorte vai no próprio path (um nó a menos por camada recortada nas listas)
      clipPath={p.clipId && !p.filterId ? `url(#${p.clipId})` : undefined}
    />
  );
  // com filtro, recorte num <G> próprio: o desfoque acontece antes e é cortado pelo recorte (igual ao Skia)
  return p.clipId && p.filterId ? (
    <G key={p.key} clipPath={`url(#${p.clipId})`}>
      {path}
    </G>
  ) : (
    path
  );
}

export const CruzeiAvatar = memo(CruzeiAvatarInner);
