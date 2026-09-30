/**
 * Barra de navegação do Android (3 botões) com edge-to-edge (Android 15+ / targetSdk 35+).
 *
 * A barra é transparente e, com botões, o sistema força contraste: desenha um véu por cima do app,
 * claro (ícones escuros) ou escuro (ícones claros) conforme a aparência da janela. O RN liga ícones
 * escuros no tema claro, mas no Android 12+ a saída da splash nativa (androidx core-splashscreen)
 * reaplica a aparência do AppTheme, que não define windowLightNavigationBar → ícones claros + véu
 * escuro pelo resto da sessão. Nada no JS mexe nisso depois (a StatusBar só cuida da barra de cima).
 * Sobre a tab bar escura o véu some; sobre tela clara vira uma faixa cinza.
 */

/** inset de baixo (dp) a partir do qual é barra de botões: 3 botões ≈ 48dp, gestos ≈ 16–24dp (sem véu) */
export const BUTTON_NAV_MIN_INSET = 32;

/** ícones claros na barra de navegação? Espelha o que o RN e a splash fazem no nativo */
export function navBarIconsLight(apiLevel: number, colorScheme: string | null | undefined): boolean {
  if (apiLevel >= 31) return true; // Android 12+: a splash zera a aparência (AppTheme sem windowLightNavigationBar)
  if (apiLevel < 26) return true; // antes do Android 8 não existe barra com ícones escuros
  return colorScheme === 'dark'; // Android 8–11: o RN escolhe pelo tema do sistema quando a Activity abre
}

/** pinta a faixa escura sob a barra? Só no Android, com barra de botões e ícones claros */
export function navBarNeedsBackdrop({
  os,
  apiLevel,
  colorScheme,
  bottomInset,
}: {
  os: string;
  apiLevel: number;
  colorScheme: string | null | undefined;
  bottomInset: number;
}): boolean {
  return os === 'android' && bottomInset >= BUTTON_NAV_MIN_INSET && navBarIconsLight(apiLevel, colorScheme);
}
