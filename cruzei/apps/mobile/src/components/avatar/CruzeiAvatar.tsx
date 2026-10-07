import type { AvatarConfig } from '@cruzei/shared-types';
import React, { memo, useEffect, useId, useMemo, useState } from 'react';
import { Image, StyleSheet, View, type ViewStyle } from 'react-native';
import Svg, { ClipPath, Defs, Ellipse, FeGaussianBlur, Filter, G, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';

import { AVATAR_RENDER_VERSION, AVATAR_VIEWBOX, buildAvatarLayers, buildAvatarRig, bustBoxFor, keyOf, layersBytes } from '../../avatar';
import { MAP_HEAD_SCALE } from '../../avatar/anatomy';
import type { BuildOptions } from '../../avatar/ctx';
import { zero, type Pose } from '../../avatar/pose';
import { applyScene } from '../../avatar/scene';
import { buildSvgModel, microLayers, type SvgPathNode } from '../../avatar/svgModel';

import { avatarPng } from '../../screens/map/native/images/draw';
import { mapImages } from '../../screens/map/native/images/store';
import { MemCache } from '../../services/memCache';

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

// ---------------------------------------------------------------------------------------------------------------
// Fila das miniaturas (PNG). A fila de desenho é a do mapa (mapImages, thread JS em fatias): a miniatura entra com
// prioridade de figura a THUMB_PRIORITY metros (a pessoa selecionada, você e quem está perto no mapa vêm antes) e no
// máximo THUMB_INFLIGHT de cada vez na fila compartilhada — uma lista longa nunca empurra o mapa pra trás. Quem
// espera aqui sai na ordem inversa (o último montado é o que está na tela ao rolar) e quem desmontou sai da espera.
// ---------------------------------------------------------------------------------------------------------------
type ImgRef = Awaited<ReturnType<typeof mapImages.request>>;
/** prioridade da miniatura na fila do mapa (o mapa usa 0 = você/selecionada e 1 + distância em metros) */
export const THUMB_PRIORITY = 150;
/** miniaturas na fila compartilhada ao mesmo tempo */
export const THUMB_INFLIGHT = 2;

interface ThumbJob {
  key: string;
  render: () => Uint8Array | null;
  promise: Promise<ImgRef>;
  resolve: (r: ImgRef) => void;
  /** quantos avatares montados esperam esta chave */
  refs: number;
  sent: boolean;
  /** a fila do mapa já respondeu */
  settled?: boolean;
}
const thumbJobs = new Map<string, ThumbJob>();
const thumbWaiting: ThumbJob[] = [];
let thumbInflight = 0;

function pumpThumbs(): void {
  while (thumbInflight < THUMB_INFLIGHT && thumbWaiting.length) {
    const job = thumbWaiting.pop() as ThumbJob;
    if (job.refs <= 0) continue; // desmontou antes da vez
    job.sent = true;
    thumbInflight++;
    void mapImages
      .request(job.key, THUMB_PRIORITY, job.render)
      .catch(() => null)
      .then((ref) => {
        thumbInflight--;
        job.settled = true;
        if (thumbJobs.get(job.key) === job) thumbJobs.delete(job.key);
        job.resolve(ref);
        pumpThumbs();
      });
  }
}

/** pede o PNG da miniatura; devolve a promessa e quem solta (desmontou) */
function requestThumb(key: string, render: () => Uint8Array | null): { promise: Promise<ImgRef>; release: () => void } {
  let job = thumbJobs.get(key);
  if (!job) {
    let resolve: (r: ImgRef) => void = () => {};
    const promise = new Promise<ImgRef>((r) => {
      resolve = r;
    });
    job = { key, render, promise, resolve, refs: 0, sent: false };
    thumbJobs.set(key, job);
    thumbWaiting.push(job);
  }
  const j = job;
  j.refs++;
  pumpThumbs();
  let done = false;
  return {
    promise: j.promise,
    release: () => {
      if (done) return;
      done = true;
      j.refs--;
      if (j.refs > 0 || j.settled) return;
      // já na fila do mapa e ninguém mais espera: sai de lá também (rolar rápido não deixa desenho órfão na frente do
      // mapa); a promessa resolve null e o pumpThumbs libera a vaga
      if (j.sent) {
        if (thumbJobs.get(j.key) === j) thumbJobs.delete(j.key); // quem montar agora pede de novo
        mapImages.cancel(j.key);
        return;
      }
      // ninguém mais espera e ainda não foi pra fila do mapa: sai da espera
      thumbJobs.delete(j.key);
      const i = thumbWaiting.indexOf(j);
      if (i >= 0) thumbWaiting.splice(i, 1);
      j.resolve(null);
    },
  };
}

/** silhueta parada enquanto o PNG não chega (sem brilho animado: lista rolando não ganha quadro extra) */
const PLACEHOLDER = 'rgba(250,250,250,0.09)';
function Placeholder({ vb, width, height, mode }: { vb: { x: number; y: number; w: number; h: number }; width: number; height: number; mode: AvatarMode }) {
  const k = width / vb.w;
  const at = (x: number, y: number) => ({ left: (x - vb.x) * k, top: (y - vb.y) * k });
  const hr = 11.5 * k;
  const head = at(50, 23);
  const body =
    mode === 'bust'
      ? { ...at(29, 38.5), width: 42 * k, height: Math.max(0, height - (38.5 - vb.y) * k + 8 * k), borderTopLeftRadius: 18 * k, borderTopRightRadius: 18 * k }
      : { ...at(36, 37), width: 28 * k, height: 92 * k, borderRadius: 14 * k };
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[styles.ph, body]} />
      <View style={[styles.ph, { left: head.left - hr, top: head.top - hr, width: hr * 2, height: hr * 2, borderRadius: hr }]} />
    </View>
  );
}

/**
 * cache das camadas por visual (chave + modo + detalhe + sombra + mãos). Só serve enquanto o PNG da miniatura não
 * existe (o mesmo visual em outro tamanho logo depois) e pro SVG de reserva: PNG pronto não monta camadas. Cada visual
 * retém 0,35–0,7 MB de strings de path (com 120 visuais eram 40–85 MB do heap do Hermes): teto em bytes estimados.
 */
export const LAYER_CACHE_BYTES = 3 * 1024 * 1024;
const layerCache = new MemCache<ReturnType<typeof buildAvatarLayers>>('avatar.layers', LAYER_CACHE_BYTES, 24);
export function cachedLayers(config: AvatarConfig, key: string, opts: BuildOptions): ReturnType<typeof buildAvatarLayers> {
  const k = `${key}|${opts.mode}|${opts.lod}|${opts.groundShadow ? 1 : 0}|${opts.hands ? JSON.stringify(opts.hands) : ''}`;
  const hit = layerCache.get(k);
  if (hit) return hit;
  const layers = buildAvatarLayers(config, opts);
  return layerCache.set(k, layers, layersBytes(layers));
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
  const poseKey = pose ? JSON.stringify(pose) : '';
  const headScale = mode === 'full' && size < AVATAR_SMALL_FULL_PX ? MAP_HEAD_SCALE : 1;
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
  // a versão do desenho entra na chave: PNG antigo em disco não volta depois de uma mudança de visual
  const rasterKey = hq ? null : `av|${AVATAR_RENDER_VERSION}|${key}|${mode}|${lod}|${shadow ? 1 : 0}|${size}|${headScale}|${poseKey}|${handsKey}`;
  const [raster, setRaster] = useState<{ k: string; uri: string | null } | null>(() => {
    const ref = rasterKey ? mapImages.get(rasterKey) : undefined;
    return ref && rasterKey ? { k: rasterKey, uri: 'file://' + ref.path } : null;
  });
  const rasterUri = raster && raster.k === rasterKey ? raster.uri : undefined;
  const svgBody = !rasterKey || rasterUri === null;
  // camadas e rig só quando alguém vai desenhar: PNG já pronto = nada de buildAvatarLayers ao rolar a lista
  const opts: BuildOptions = { groundShadow: shadow, mode, lod, ...(hands ? { hands } : {}) };
  useEffect(() => {
    if (!rasterKey) return;
    const ready = mapImages.get(rasterKey);
    if (ready) {
      setRaster((r) => (r && r.k === rasterKey ? r : { k: rasterKey, uri: 'file://' + ready.path }));
      return;
    }
    let alive = true;
    const p = pose ?? null;
    const job = requestThumb(rasterKey, () => {
      const layers = cachedLayers(config, key, opts);
      return avatarPng(size <= AVATAR_MICRO_MAX_PX ? microLayers(layers) : layers, buildAvatarRig(config, { mode }), p, vb, width, height, headScale !== 1);
    });
    void job.promise.then((ref) => alive && setRaster({ k: rasterKey, uri: ref ? 'file://' + ref.path : null }));
    return () => {
      alive = false;
      job.release();
    };
  }, [rasterKey]); // eslint-disable-line react-hooks/exhaustive-deps -- a chave resume tudo
  const model = useMemo(() => {
    if (!svgBody) return null;
    const layers = cachedLayers(config, key, opts);
    const rig = buildAvatarRig(config, { mode });
    const posed = applyScene(pose ?? zero(), rig.scene, 0);
    return buildSvgModel(size <= AVATAR_MICRO_MAX_PX ? microLayers(layers) : layers, { idp, rig, pose: posed, blur: hq ? 'filter' : 'approx', headScale });
  }, [svgBody, key, shadow, mode, lod, handsKey, poseKey, idp, hq, headScale, size]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasDefs = !!aura || (!!model && (model.grads.length > 0 || model.clips.length > 0 || model.blurs.length > 0));
  const hasSvg = !!model || !!aura || !!fxBackdrop;

  return (
    <View
      style={[{ width, height }, backgroundColor ? { backgroundColor, borderRadius: mode === 'bust' ? size / 2 : 16, overflow: 'hidden' } : null, style]}
      {...(decorative ? HIDDEN_A11Y : { accessibilityRole: 'image' as const, accessibilityLabel: accessibilityLabel ?? 'Avatar' })}
    >
      {hasSvg ? (
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
              {model?.grads.map((g) =>
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
              {model?.clips.map((c) => (
                <ClipPath key={c.id} id={c.id}>
                  <Path d={c.d} />
                </ClipPath>
              ))}
              {model?.blurs.map((b) => (
                <Filter key={b.id} id={b.id} filterUnits="userSpaceOnUse" x={-60} y={-60} width={220} height={260}>
                  <FeGaussianBlur stdDeviation={b.sigma} />
                </Filter>
              ))}
            </Defs>
          ) : null}
          {fxBackdrop ? <FxSvgLayer model={fxBackdrop} idp={`${idp}fxd_`} /> : null}
          {aura ? <Ellipse cx={vb.x + vb.w / 2} cy={vb.y + vb.h / 2} rx={vb.w * 0.52} ry={vb.h * 0.48} fill={`url(#${auraId})`} /> : null}
          {fxAura ? <FxSvgLayer model={fxAura.back} idp={`${idp}fxb_`} /> : null}
          {model?.runs.map((r, ri) =>
            r.transform ? (
              <G key={ri} transform={r.transform}>
                {r.nodes.map(renderNode)}
              </G>
            ) : (
              r.nodes.map(renderNode)
            ),
          )}
          {model && fxAura ? <FxSvgLayer model={fxAura.front} idp={`${idp}fxf_`} /> : null}
        </Svg>
      ) : null}
      {rasterKey && rasterUri === undefined ? <Placeholder vb={vb} width={width} height={height} mode={mode} /> : null}
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

const styles = StyleSheet.create({
  ph: { position: 'absolute', backgroundColor: PLACEHOLDER },
});
