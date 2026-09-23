// Tipografia Cruzei — Space Grotesk (display/headings) + Inter (body) + JetBrains Mono (timers)
// Família deve estar linkada via react-native-asset ou @expo-google-fonts no app.

export const typography = {
  display: {
    fontFamily: 'SpaceGrotesk-Bold',
    fontSize: 40,
    fontWeight: '800' as const,
    lineHeight: 48,
    letterSpacing: -1,
  },
  h1: {
    fontFamily: 'SpaceGrotesk-Bold',
    fontSize: 32,
    fontWeight: '700' as const,
    lineHeight: 40,
    letterSpacing: -0.5,
  },
  h2: {
    fontFamily: 'SpaceGrotesk-Bold',
    fontSize: 24,
    fontWeight: '700' as const,
    lineHeight: 32,
  },
  h3: {
    fontFamily: 'SpaceGrotesk-Bold',
    fontSize: 20,
    fontWeight: '600' as const,
    lineHeight: 28,
  },
  h4: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 18,
    fontWeight: '600' as const,
    lineHeight: 24,
  },
  bodyLarge: {
    fontFamily: 'Inter-Regular',
    fontSize: 16,
    fontWeight: '400' as const,
    lineHeight: 24,
  },
  body: {
    fontFamily: 'Inter-Regular',
    fontSize: 14,
    fontWeight: '400' as const,
    lineHeight: 20,
  },
  bodySmall: {
    fontFamily: 'Inter-Regular',
    fontSize: 12,
    fontWeight: '400' as const,
    lineHeight: 16,
  },
  label: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 14,
    fontWeight: '600' as const,
    lineHeight: 20,
    letterSpacing: 0.3,
  },
  caption: {
    fontFamily: 'Inter-Regular',
    fontSize: 11,
    fontWeight: '400' as const,
    lineHeight: 14,
  },
  mono: {
    fontFamily: 'JetBrainsMono-Regular',
    fontSize: 14,
    fontWeight: '500' as const,
    lineHeight: 20,
  },
} as const;

export type TypographyToken = keyof typeof typography;
