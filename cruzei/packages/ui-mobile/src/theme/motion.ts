// Motion Cruzei — durações/easings do design system (06-identidade-visual + 17-design-system)
// Regra: interações ≤ 300ms; loops lentos e sutis; springs pra bottom sheet e match.

export const duration = {
  tap: 100, // scale ao pressionar
  fast: 150, // fade out
  base: 200, // fade in / crossfade
  slow: 300, // slide up, transições de tela
  pulse: 1200, // loop de "respiração" (600 + 600)
  sonar: 2000, // onda concêntrica de hotspot
  match: 800, // bounce da tela de match
} as const;

// Configs de spring pra Reanimated withSpring()
export const spring = {
  bouncy: { damping: 8, stiffness: 140, mass: 0.8 }, // entrada de logo/match
  soft: { damping: 14, stiffness: 120, mass: 1 }, // bottom sheet, cards
  snappy: { damping: 18, stiffness: 260, mass: 0.6 }, // toggles, chips
  press: { damping: 15, stiffness: 400, mass: 0.5 }, // scale ao pressionar
} as const;

export const scale = {
  pressed: 0.96,
  hover: 1.04,
  pulseMax: 1.08,
  boost: 1.6, // avatar com boost ativo no mapa
} as const;

export const motion = { duration, spring, scale } as const;
export type Motion = typeof motion;
