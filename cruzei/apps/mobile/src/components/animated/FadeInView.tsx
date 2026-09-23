import React, { useEffect } from 'react';
import type { ViewProps, ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { duration } from '@cruzei/ui-mobile';

export interface FadeInViewProps extends ViewProps {
  /** atraso em ms — use pra stagger de listas */
  delay?: number;
  /** duração do fade (default 200ms ease-out, do design system) */
  durationMs?: number;
  /** deslocamento inicial em px (positivo = sobe ao entrar) */
  fromY?: number;
  fromX?: number;
  /** escala inicial (ex.: 0.95 pra "pop" sutil) */
  fromScale?: number;
  style?: ViewStyle | ViewStyle[];
}

/**
 * Fade-in com deslocamento opcional. Roda na UI thread (Reanimated 3).
 * Ex.: <FadeInView delay={120} fromY={12}>...</FadeInView>
 */
export function FadeInView({
  delay = 0,
  durationMs = duration.base,
  fromY = 0,
  fromX = 0,
  fromScale = 1,
  style,
  children,
  ...rest
}: FadeInViewProps) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(delay, withTiming(1, { duration: durationMs, easing: Easing.out(Easing.cubic) }));
  }, [delay, durationMs, progress]);

  const animated = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { translateY: (1 - progress.value) * fromY },
      { translateX: (1 - progress.value) * fromX },
      { scale: fromScale + (1 - fromScale) * progress.value },
    ],
  }));

  return (
    <Animated.View {...rest} style={[style, animated]}>
      {children}
    </Animated.View>
  );
}
