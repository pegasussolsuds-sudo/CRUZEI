import React from 'react';
import { StyleSheet } from 'react-native';
import { BlurMask, Canvas, Group, Path, RoundedRect, Skia, SweepGradient, rect, rrect, vec } from '@shopify/react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';
import { colors } from '@cruzei/ui-mobile';

/** véu do tour: escuro o bastante pro recorte saltar, sem apagar o mapa */
const VEIL = 'rgba(5,5,16,0.78)';
/** anel: lima → magenta → dourado (as cores da marca) */
const RING_COLORS = [colors.primary, colors.secondary, colors.accent, colors.primary];
const VEIL_BLEED = 64;

export interface SpotlightValues {
  x: SharedValue<number>;
  y: SharedValue<number>;
  w: SharedValue<number>;
  h: SharedValue<number>;
  r: SharedValue<number>;
  /** 0..1: brilho do anel (0 sem recorte) */
  ring: SharedValue<number>;
  /** 0..1 em loop: a onda que abre e some */
  pulse: SharedValue<number>;
  /** ângulo do gradiente do anel (rad) */
  spin: SharedValue<number>;
}

/**
 * Véu com o recorte (um Path com o buraco, regra par-ímpar) + anel neon com brilho + onda. Tudo dirigido por shared
 * values na UI thread: o recorte anda entre os alvos sem re-render do React. Um canvas só (regra do Moto g54).
 */
export function Spotlight({ width, height, v }: { width: number; height: number; v: SpotlightValues }) {
  const veil = useDerivedValue(() => {
    const b = Skia.PathBuilder.Make();
    // véu com sobra: se a janela do Modal for um pouco maior que a medida (barras do sistema), não sobra faixa clara
    b.addRect(Skia.XYWHRect(-VEIL_BLEED, -VEIL_BLEED, width + VEIL_BLEED * 2, height + VEIL_BLEED * 4));
    if (v.w.value > 1 && v.h.value > 1) {
      b.addRRect(Skia.RRectXY(Skia.XYWHRect(v.x.value, v.y.value, v.w.value, v.h.value), v.r.value, v.r.value));
    }
    return b.build();
  }, [width, height]);

  // anel 2 px pra fora (não pinta em cima do alvo)
  const ring = useDerivedValue(() => rrect(rect(v.x.value - 2, v.y.value - 2, v.w.value + 4, v.h.value + 4), v.r.value + 2, v.r.value + 2));
  const halo = useDerivedValue(() => rrect(rect(v.x.value - 4, v.y.value - 4, v.w.value + 8, v.h.value + 8), v.r.value + 4, v.r.value + 4));
  const wave = useDerivedValue(() => {
    const k = 4 + v.pulse.value * 18;
    return rrect(rect(v.x.value - k, v.y.value - k, v.w.value + k * 2, v.h.value + k * 2), v.r.value + k, v.r.value + k);
  });
  const waveOpacity = useDerivedValue(() => v.ring.value * (1 - v.pulse.value) * 0.6);
  const center = useDerivedValue(() => vec(v.x.value + v.w.value / 2, v.y.value + v.h.value / 2));
  const spinTransform = useDerivedValue(() => [{ rotate: v.spin.value }]);

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Path path={veil} fillType="evenOdd" color={VEIL} />
      <Group opacity={v.ring}>
        {/* brilho largo e desfocado */}
        <RoundedRect rect={halo} style="stroke" strokeWidth={8} color={colors.primary} opacity={0.35}>
          <BlurMask blur={10} style="normal" />
        </RoundedRect>
        {/* anel nítido com o gradiente da marca girando */}
        <RoundedRect rect={ring} style="stroke" strokeWidth={2.5}>
          <SweepGradient c={center} colors={RING_COLORS} origin={center} transform={spinTransform} />
        </RoundedRect>
      </Group>
      <RoundedRect rect={wave} style="stroke" strokeWidth={2} color={colors.primary} opacity={waveOpacity} />
    </Canvas>
  );
}
