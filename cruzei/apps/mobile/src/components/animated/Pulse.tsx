import React, { useEffect } from 'react';
import type { ViewProps, ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { duration, scale as scaleTokens } from '@cruzei/ui-mobile';

export interface PulseProps extends ViewProps {
  /** escala máxima do loop (default 1.08 — "respiração" sutil) */
  maxScale?: number;
  /** duração do ciclo completo em ms (default 1200 = 600 + 600) */
  cycleMs?: number;
  /** liga/desliga sem desmontar (ex.: só quando online) */
  active?: boolean;
  /** opacidade mínima no vale do pulso (1 = sem fade) */
  minOpacity?: number;
  style?: ViewStyle | ViewStyle[];
}

/**
 * Loop de "respiração" (scale 1 → max → 1). Usado em dot online, avatar premium e CTAs.
 * Ex.: <Pulse active={isOnline} maxScale={1.2}><View style={dot} /></Pulse>
 */
export function Pulse({
  maxScale = scaleTokens.pulseMax,
  cycleMs = duration.pulse,
  active = true,
  minOpacity = 1,
  style,
  children,
  ...rest
}: PulseProps) {
  const t = useSharedValue(0);

  useEffect(() => {
    if (!active) {
      cancelAnimation(t);
      t.value = withTiming(0, { duration: 200 });
      return;
    }
    t.value = withRepeat(
      withSequence(
        withTiming(1, { duration: cycleMs / 2, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: cycleMs / 2, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(t);
  }, [active, cycleMs, t]);

  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + (maxScale - 1) * t.value }],
    opacity: minOpacity + (1 - minOpacity) * t.value,
  }));

  return (
    <Animated.View {...rest} style={[style, animated]}>
      {children}
    </Animated.View>
  );
}
