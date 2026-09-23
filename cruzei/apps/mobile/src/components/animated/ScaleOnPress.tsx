import React, { useCallback } from 'react';
import { Pressable, type PressableProps, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { scale as scaleTokens, spring } from '@cruzei/ui-mobile';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface ScaleOnPressProps extends Omit<PressableProps, 'style'> {
  /** escala ao pressionar (default 0.96) */
  pressedScale?: number;
  /** vibração leve ao soltar (default true) */
  haptic?: boolean;
  /** brilho: aumenta a sombra/elevação enquanto pressionado */
  glowColor?: string;
  style?: ViewStyle | ViewStyle[];
}

/**
 * Pressable com feedback de escala (spring) e glow opcional — o "tap" do design system (100ms).
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

  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - (1 - pressedScale) * pressed.value }],
    ...(glowColor
      ? {
          shadowColor: glowColor,
          shadowOpacity: 0.25 + 0.5 * pressed.value,
          shadowRadius: 8 + 16 * pressed.value,
          shadowOffset: { width: 0, height: 0 },
          elevation: 4 + 10 * pressed.value,
        }
      : {}),
  }));

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
    <AnimatedPressable {...rest} onPressIn={handleIn} onPressOut={handleOut} onPress={handlePress} style={[style, animated]}>
      {children}
    </AnimatedPressable>
  );
}
