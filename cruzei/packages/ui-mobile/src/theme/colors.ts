// Paleta Cruzei — alinhada com 06-identidade-visual.md e 17-design-system.md

export const colors = {
  // Marca
  primary: '#7FFF00', // verde-limão — ação principal, online, destaques
  secondary: '#FF1493', // rosa-magenta — match, premium, paixão
  accent: '#FFD700', // dourado — super curtida, conquistas

  // Estados
  success: '#00FF7F',
  warning: '#FFB800',
  danger: '#FF3B30',
  error: '#FF3B30',
  info: '#008B8B',
  online: '#00FF7F',

  // Neutros
  black: '#0A0A1A',
  white: '#FAFAFA',

  gray: {
    50: '#FAFAFA',
    100: '#F5F5F5',
    200: '#E5E5E5',
    300: '#D4D4D4',
    400: '#A3A3A3',
    500: '#737373',
    600: '#525252',
    700: '#404040',
    800: '#262626',
    900: '#0A0A1A',
  },

  // Backgrounds
  background: '#FAFAFA',
  surface: '#FFFFFF',
  surfaceAlt: '#F5F5F5',

  // Mapas
  map: {
    water: '#40E0D0',
    park: '#7FFF00',
    road: '#FFFFFF',
    building: '#D4D4AA',
    night: {
      bg: '#0A0A1A',
      water: '#0A3D4D',
      park: '#1A4D1A',
      road: '#2A2A3A',
    },
  },

  // Transparências
  overlay: 'rgba(10, 10, 26, 0.5)',
  overlayDark: 'rgba(10, 10, 26, 0.8)',
  shadow: 'rgba(10, 10, 26, 0.15)',
} as const;

export type Colors = typeof colors;
