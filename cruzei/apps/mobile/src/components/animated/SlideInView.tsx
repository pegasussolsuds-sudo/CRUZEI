import React, { useEffect } from 'react';
import type { ViewProps, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSpring } from 'react-native-reanimated';
import { spring } from '@cruzei/ui-mobile';

export type SlideDirection = 'left' | 'right' | 'up' | 'down';

export interface SlideInViewProps extends ViewProps {
  from?: SlideDirection;
  /** distância do deslize em px */
  distance?: number;
  delay?: number;
  /** config de spring do design system (default 'soft') */
  springPreset?: keyof typeof spring;
  style?: ViewStyle | ViewStyle[];
}

/**
 * Entrada com spring a partir de uma direção. Usado em subtítulos, cards e balões de chat.
 * Ex.: <SlideInView from="left" distance={40}>...</SlideInView>
 */
export function SlideInView({
  from = 'up',
  distance = 24,
  delay = 0,
  springPreset = 'soft',
  style,
  children,
  ...rest
}: SlideInViewProps) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(delay, withSpring(1, spring[springPreset]));
  }, [delay, progress, springPreset]);

  const animated = useAnimatedStyle(() => {
    const remaining = (1 - progress.value) * distance;
    const x = from === 'left' ? -remaining : from === 'right' ? remaining : 0;
    const y = from === 'up' ? remaining : from === 'down' ? -remaining : 0;
    return {
      opacity: Math.min(1, progress.value * 1.4),
      transform: [{ translateX: x }, { translateY: y }],
    };
  });

  return (
    <Animated.View {...rest} style={[style, animated]}>
      {children}
    </Animated.View>
  );
}
