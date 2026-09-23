import React, { useEffect } from 'react';
import { StyleSheet, type ViewStyle } from 'react-native';
import { Canvas, LinearGradient, Rect, vec } from '@shopify/react-native-skia';
import { Easing, cancelAnimation, useDerivedValue, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { colors } from '@cruzei/ui-mobile';

export interface AnimatedGradientProps {
  colorsList?: string[];
  /** ms por ciclo completo de rotação do gradiente */
  cycleMs?: number;
  style?: ViewStyle;
  width: number;
  height: number;
  paused?: boolean;
}

/**
 * Gradiente linear que gira lentamente (Skia). Use como fundo de botões premium/paywall.
 * Ex.: <AnimatedGradient width={w} height={56} colorsList={[colors.accent, colors.secondary]} />
 */
export function AnimatedGradient({
  colorsList = [colors.accent, colors.secondary, colors.primary],
  cycleMs = 6000,
  style,
  width,
  height,
  paused = false,
}: AnimatedGradientProps) {
  const t = useSharedValue(0);

  useEffect(() => {
    if (paused) {
      cancelAnimation(t);
      return;
    }
    t.value = withRepeat(withTiming(1, { duration: cycleMs, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(t);
  }, [cycleMs, paused, t]);

  const cx = width / 2;
  const cy = height / 2;
  const r = Math.max(width, height);
  const start = useDerivedValue(() => {
    const a = t.value * Math.PI * 2;
    return vec(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  });
  const end = useDerivedValue(() => {
    const a = t.value * Math.PI * 2 + Math.PI;
    return vec(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  });

  return (
    <Canvas style={[{ width, height }, StyleSheet.absoluteFillObject, style]} pointerEvents="none">
      <Rect x={0} y={0} width={width} height={height}>
        <LinearGradient start={start} end={end} colors={colorsList} />
      </Rect>
    </Canvas>
  );
}
