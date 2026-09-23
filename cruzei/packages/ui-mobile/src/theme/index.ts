import { colors } from './colors';
import { typography } from './typography';
import { spacing, radius, shadows } from './spacing';

export const theme = {
  colors,
  typography,
  spacing,
  radius,
  shadows,
  gradient: {
    match: [colors.primary, colors.secondary],
    premium: [colors.accent, colors.secondary],
    boost: [colors.primary, colors.success],
  },
} as const;

export type Theme = typeof theme;
export { colors, typography, spacing, radius, shadows };
