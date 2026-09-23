import { colors } from './colors';
import { typography, fontFamily } from './typography';
import { spacing, radius, shadows } from './spacing';
import { motion, duration, spring, scale } from './motion';

export const theme = {
  colors,
  typography,
  fontFamily,
  spacing,
  radius,
  shadows,
  motion,
  gradient: {
    match: [colors.primary, colors.secondary],
    premium: [colors.accent, colors.secondary],
    boost: [colors.primary, colors.success],
    night: ['#0A0A1A', '#1A1A2E'],
  },
} as const;

export type Theme = typeof theme;
export { colors, typography, fontFamily, spacing, radius, shadows, motion, duration, spring, scale };
