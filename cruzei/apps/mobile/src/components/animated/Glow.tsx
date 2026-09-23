import React, { useEffect } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { colors } from '@cruzei/ui-mobile';

export interface GlowProps extends ViewProps {
  color?: string;
  /** raio do halo em px além do conteúdo */
  spread?: number;
  /** intensidade 0..1 */
  intensity?: number;
  /** anima o halo (respira) — desligue pra glow estático */
  animated?: boolean;
  /** formato: círculo (avatares) ou pílula (botões) */
  shape?: 'circle' | 'pill';
  cycleMs?: number;
}

/**
 * Halo luminoso atrás do conteúdo (Premium+, boost, CTA em destaque).
 * Implementado com camadas semitransparentes — funciona igual em iOS e Android (sem depender de shadow).
 * Ex.: <Glow color="#FF1493" spread={12}><Avatar .../></Glow>
 */
export function Glow({
  color = colors.primary,
  spread = 10,
  intensity = 0.7,
  animated = true,
  shape = 'circle',
  cycleMs = 1600,
  style,
  children,
  ...rest
}: GlowProps) {
  const t = useSharedValue(animated ? 0 : 1);

  useEffect(() => {
    if (!animated) {
      t.value = 1;
      return;
    }
    t.value = withRepeat(withTiming(1, { duration: cycleMs, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => cancelAnimation(t);
  }, [animated, cycleMs, t]);

  const outer = useAnimatedStyle(() => ({
    opacity: intensity * (0.25 + 0.35 * t.value),
    transform: [{ scale: 1 + 0.08 * t.value }],
  }));
  const inner = useAnimatedStyle(() => ({
    opacity: intensity * (0.45 + 0.4 * t.value),
  }));

  const radius = shape === 'circle' ? 9999 : 999;

  return (
    <View {...rest} style={[styles.wrap, style]}>
      <Animated.View pointerEvents="none" style={[styles.halo, { backgroundColor: color, borderRadius: radius, margin: -spread * 1.6 }, outer]} />
      <Animated.View pointerEvents="none" style={[styles.halo, { backgroundColor: color, borderRadius: radius, margin: -spread * 0.8 }, inner]} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'flex-start', alignItems: 'center', justifyContent: 'center' },
  halo: { ...StyleSheet.absoluteFillObject },
});
