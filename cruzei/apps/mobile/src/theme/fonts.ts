// Fontes do design system, carregadas via @expo-google-fonts.
// Os nomes das famílias batem com packages/ui-mobile/src/theme/typography.ts (fontFamily.*).
import { useFonts } from 'expo-font';
import { SpaceGrotesk_500Medium, SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono';

export const FONT_MAP = {
  SpaceGrotesk_500Medium,
  SpaceGrotesk_700Bold,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  JetBrainsMono_500Medium,
} as const;

/** true quando as fontes estão prontas (ou falharam — o app segue com a fonte do sistema). */
export function useAppFonts(): boolean {
  const [loaded, error] = useFonts(FONT_MAP);
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('fontes não carregaram, usando fallback do sistema:', error.message);
  }
  return loaded || Boolean(error);
}
