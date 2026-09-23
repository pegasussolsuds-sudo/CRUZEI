import React from 'react';
import { StyleSheet, View, ViewProps } from 'react-native';
import { colors, radius, shadows, spacing } from '../theme';

export interface CardProps extends ViewProps {
  variant?: 'elevated' | 'flat';
  padding?: keyof typeof spacing;
}

export function Card({
  variant = 'elevated',
  padding = 'lg',
  style,
  children,
  ...rest
}: CardProps) {
  return (
    <View
      {...rest}
      style={[
        styles.base,
        variant === 'elevated' ? shadows.light : null,
        { padding: spacing[padding] },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
  },
});

export default Card;
