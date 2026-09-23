import React, { useCallback } from 'react';
import { Platform, Pressable, type PressableProps, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { scale as scaleTokens, spring } from '@cruzei/ui-mobile';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface ScaleOnPressProps extends Omit<PressableProps, 'style'> {
  /** escala ao pressionar (default 0.96) */
  pressedScale?: number;
  /** vibração leve ao soltar (default true) */
  haptic?: boolean;
  /** brilho: aumenta a sombra (iOS) / elevação (Android) enquanto pressionado */
  glowColor?: string;
  style?: ViewStyle | ViewStyle[];
}

/**
 * Pressable com feedback de escala (spring) e glow opcional — o "tap" do design system (100ms).
 * Só valores numéricos são animados (shadowOffset fica estático) pra não disparar o aviso do RN.
 * Ex.: <ScaleOnPress onPress={...} glowColor="#7FFF00"><Text>Começar</Text></ScaleOnPress>
 */
export function ScaleOnPress({
  pressedScale = scaleTokens.pressed,
  haptic = true,
  glowColor,
  style,
  onPressIn,
  onPressOut,
  onPress,
  children,
  ...rest
}: ScaleOnPressProps) {
  const pressed = useSharedValue(0);

  const animated = useAnimatedStyle(() => {
    const base: Record<string, unknown> = { transform: [{ scale: 1 - (1 - pressedScale) * pressed.value }] };
    if (glowColor) {
      if (Platform.OS === 'android') base.elevation = 4 + 10 * pressed.value;
      else {
        base.shadowOpacity = 0.25 + 0.5 * pressed.value;
        base.shadowRadius = 8 + 16 * pressed.value;
      }
    }
    return base;
  });

  const staticGlow: ViewStyle | undefined = glowColor
    ? { shadowColor: glowColor, shadowOffset: { width: 0, height: 0 } }
    : undefined;

  const handleIn = useCallback<NonNullable<PressableProps['onPressIn']>>(
    (e) => {
      pressed.value = withTiming(1, { duration: 90 });
      onPressIn?.(e);
    },
    [onPressIn, pressed],
  );
  const handleOut = useCallback<NonNullable<PressableProps['onPressOut']>>(
    (e) => {
      pressed.value = withSpring(0, spring.press);
      onPressOut?.(e);
    },
    [onPressOut, pressed],
  );
  const handlePress = useCallback<NonNullable<PressableProps['onPress']>>(
    (e) => {
      if (haptic) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      onPress?.(e);
    },
    [haptic, onPress],
  );

  return (
    <AnimatedPressable {...rest} onPressIn={handleIn} onPressOut={handleOut} onPress={handlePress} style={[staticGlow, style, animated]}>
      {children}
    </AnimatedPressable>
  );
}
