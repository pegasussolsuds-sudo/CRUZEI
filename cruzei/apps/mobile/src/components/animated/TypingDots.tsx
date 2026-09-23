import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { colors } from '@cruzei/ui-mobile';

export interface TypingDotsProps {
  color?: string;
  size?: number;
}

/** Indicador "digitando…": 3 pontos quicando em sequência (loop na UI thread). */
export function TypingDots({ color = colors.gray[500], size = 7 }: TypingDotsProps) {
  return (
    <View style={styles.row} accessibilityLabel="digitando" accessible>
      {[0, 1, 2].map((i) => (
        <Dot key={i} index={i} color={color} size={size} />
      ))}
    </View>
  );
}

function Dot({ index, color, size }: { index: number; color: string; size: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(
      index * 160,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 280, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 280, easing: Easing.in(Easing.quad) }),
          withTiming(0, { duration: 400 }),
        ),
        -1,
        false,
      ),
    );
    return () => cancelAnimation(t);
  }, [index, t]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: -5 * t.value }],
    opacity: 0.45 + 0.55 * t.value,
  }));

  return <Animated.View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }, style]} />;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4, height: 16 },
});
