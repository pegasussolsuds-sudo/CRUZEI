import React, { useEffect } from 'react';
import type { ViewProps, ViewStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
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
  /**
   * quantas respirações e para no repouso (default 3). Nunca é eterno: um pulso que não para deixa a tela parada
   * redesenhando a 60 fps (medido no S23). Pra chamar atenção de novo, desligue e ligue `active`.
   */
  cycles?: number;
  style?: ViewStyle | ViewStyle[];
}

/**
 * "Respiração" (scale 1 → max → 1) por alguns ciclos, depois para em escala 1. Com movimento reduzido, não anima.
 * Ex.: <Pulse active={isOnline} maxScale={1.2}><View style={dot} /></Pulse>
 */
export function Pulse({
  maxScale = scaleTokens.pulseMax,
  cycleMs = duration.pulse,
  active = true,
  minOpacity = 1,
  cycles = 3,
  style,
  children,
  ...rest
}: PulseProps) {
  const t = useSharedValue(0);
  /** 1 enquanto pulsa (e desligado, como antes): o vale fica em minOpacity; terminados os ciclos volta à opacidade cheia */
  const dim = useSharedValue(1);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!active || reduceMotion) {
      cancelAnimation(t);
      t.value = withTiming(0, { duration: 200 });
      dim.value = active ? 0 : 1;
      return;
    }
    const n = Math.max(1, Math.round(cycles));
    // sobe e desce com o próprio withRepeat (reverse), um número par de vezes: termina no repouso (t = 0)
    t.value = withRepeat(withTiming(1, { duration: cycleMs / 2, easing: Easing.inOut(Easing.ease) }), n * 2, true);
    dim.value = withSequence(withTiming(1, { duration: 0 }), withDelay(n * cycleMs, withTiming(0, { duration: 300 })));
    return () => {
      cancelAnimation(t);
      cancelAnimation(dim);
    };
  }, [active, reduceMotion, cycleMs, cycles, t, dim]);

  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + (maxScale - 1) * t.value }],
    opacity: 1 - dim.value * (1 - minOpacity) * (1 - t.value),
  }));

  return (
    <Animated.View {...rest} style={[style, animated]}>
      {children}
    </Animated.View>
  );
}
