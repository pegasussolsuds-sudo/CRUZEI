import React, { useLayoutEffect, useMemo } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { BlurMask, Canvas, Circle, Fill, Group } from '@shopify/react-native-skia';
import { Easing, cancelAnimation, useDerivedValue, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { colors } from '@cruzei/ui-mobile';

export interface BlobBackgroundProps {
  /** cor de fundo sólida por baixo dos blobs */
  background?: string;
  /** cores dos 3 blobs (default: lima, magenta, dourado) */
  palette?: [string, string, string];
  /** opacidade geral dos blobs (0..1) */
  intensity?: number;
  /** velocidade do movimento (1 = ~14s por ciclo) */
  speed?: number;
  /** pausa a animação (ex.: tela fora de foco) */
  paused?: boolean;
}

/**
 * Fundo "vivo": 3 blobs desfocados (Skia + BlurMask) que orbitam lentamente.
 * Roda 100% na GPU/UI thread — sem re-render React por frame.
 * Ex.: <BlobBackground intensity={0.55} />  (posicione absoluto atrás do conteúdo)
 */
export function BlobBackground({
  background = colors.black,
  palette = [colors.primary, colors.secondary, colors.accent],
  intensity = 0.5,
  speed = 1,
  paused = false,
}: BlobBackgroundProps) {
  const { width, height } = useWindowDimensions();
  const t = useSharedValue(0);
  const reduceMotion = useReducedMotion();

  useLayoutEffect(() => {
    if (paused || reduceMotion) {
      cancelAnimation(t);
      return;
    }
    t.value = withRepeat(withTiming(1, { duration: 14_000 / speed, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => cancelAnimation(t);
  }, [paused, reduceMotion, speed, t]);

  // Trajetórias suaves em "8" — cada blob com fase diferente
  const r = useMemo(() => Math.max(width, height) * 0.42, [width, height]);
  const c1x = useDerivedValue(() => width * 0.25 + Math.sin(t.value * Math.PI * 2) * width * 0.18);
  const c1y = useDerivedValue(() => height * 0.28 + Math.cos(t.value * Math.PI * 2) * height * 0.08);
  const c2x = useDerivedValue(() => width * 0.78 - Math.sin(t.value * Math.PI * 2 + 1.7) * width * 0.16);
  const c2y = useDerivedValue(() => height * 0.62 + Math.sin(t.value * Math.PI * 2 + 0.6) * height * 0.1);
  const c3x = useDerivedValue(() => width * 0.5 + Math.cos(t.value * Math.PI * 2 + 3.1) * width * 0.22);
  const c3y = useDerivedValue(() => height * 0.9 - Math.sin(t.value * Math.PI * 2 + 2.2) * height * 0.07);

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Fill color={background} />
      <Group opacity={intensity}>
        <Circle cx={c1x} cy={c1y} r={r} color={palette[0]}>
          <BlurMask blur={90} style="normal" />
        </Circle>
        <Circle cx={c2x} cy={c2y} r={r * 0.9} color={palette[1]}>
          <BlurMask blur={100} style="normal" />
        </Circle>
        <Circle cx={c3x} cy={c3y} r={r * 0.7} color={palette[2]}>
          <BlurMask blur={110} style="normal" />
        </Circle>
      </Group>
    </Canvas>
  );
}
