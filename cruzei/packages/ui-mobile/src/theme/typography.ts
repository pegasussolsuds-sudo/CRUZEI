// Tipografia Cruzei — Space Grotesk (display/headings) + Inter (body) + JetBrains Mono (timers)
// As famílias são carregadas no app via @expo-google-fonts (ver apps/mobile/src/theme/fonts.ts).
// Em Android, fontWeight é ignorado quando fontFamily é custom — por isso cada peso tem sua própria família.

export const fontFamily = {
  display: 'SpaceGrotesk_700Bold',
  displayMedium: 'SpaceGrotesk_500Medium',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemiBold: 'Inter_600SemiBold',
  bodyBold: 'Inter_700Bold',
  mono: 'JetBrainsMono_500Medium',
} as const;

export const typography = {
  display: {
    fontFamily: fontFamily.display,
    fontSize: 40,
    lineHeight: 48,
    letterSpacing: -1,
  },
  h1: {
    fontFamily: fontFamily.display,
    fontSize: 32,
    lineHeight: 40,
    letterSpacing: -0.5,
  },
  h2: {
    fontFamily: fontFamily.display,
    fontSize: 24,
    lineHeight: 32,
  },
  h3: {
    fontFamily: fontFamily.display,
    fontSize: 20,
    lineHeight: 28,
  },
  h4: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 18,
    lineHeight: 24,
  },
  bodyLarge: {
    fontFamily: fontFamily.body,
    fontSize: 16,
    lineHeight: 24,
  },
  body: {
    fontFamily: fontFamily.body,
    fontSize: 14,
    lineHeight: 20,
  },
  bodySmall: {
    fontFamily: fontFamily.body,
    fontSize: 12,
    lineHeight: 16,
  },
  label: {
    fontFamily: fontFamily.bodySemiBold,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: 0.3,
  },
  caption: {
    fontFamily: fontFamily.bodyMedium,
    fontSize: 11,
    lineHeight: 14,
  },
  mono: {
    fontFamily: fontFamily.mono,
    fontSize: 14,
    lineHeight: 20,
  },
} as const;

export type TypographyToken = keyof typeof typography;
