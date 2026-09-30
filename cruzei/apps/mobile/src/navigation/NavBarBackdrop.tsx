import React from 'react';
import { Appearance, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@cruzei/ui-mobile';

import { navBarNeedsBackdrop } from './systemNavBar';

// tema do sistema quando o app abriu: é dele que o RN tira a cor dos botões (e não reaplica depois)
const SCHEME_AT_START = Appearance.getColorScheme();

/**
 * Tela clara empilhada por cima das abas: pinta de escuro a faixa sob a barra de 3 botões do Android.
 * Os botões ficam claros com véu escuro por cima do app (ver systemNavBar.ts): no fundo claro isso vira
 * uma faixa cinza translúcida; sobre a faixa escura fica igual às abas. Com gestos não pinta nada.
 */
export function NavBarBackdrop({ children }: { children: React.ReactNode }) {
  const { bottom } = useSafeAreaInsets();
  const paint = navBarNeedsBackdrop({
    os: Platform.OS,
    apiLevel: Number(Platform.Version),
    colorScheme: SCHEME_AT_START,
    bottomInset: bottom,
  });

  // o wrapper fica sempre (a tela não remonta se o inset mudar)
  return (
    <View style={styles.fill}>
      {children}
      {paint ? <View pointerEvents="none" style={[styles.strip, { height: bottom }]} /> : null}
    </View>
  );
}

type LayoutArgs = { route: { name: string }; options: { contentStyle?: StyleProp<ViewStyle> }; children: React.ReactElement };

/**
 * screenLayout de navegador: faixa só nas telas de fundo claro (as escuras já combinam com a barra).
 * `withTabBar`: rotas que mostram a tab bar escura embaixo (ex.: 'Main') ficam de fora.
 */
export function navBarScreenLayout(withTabBar: readonly string[]) {
  const skip = new Set(withTabBar);
  // chamada como função pelo React Navigation (não é componente): sem hooks aqui, eles ficam no NavBarBackdrop
  return ({ route, options, children }: LayoutArgs): React.ReactElement => {
    const bg = StyleSheet.flatten(options.contentStyle)?.backgroundColor;
    if (skip.has(route.name) || bg === colors.black) return children;
    return <NavBarBackdrop>{children}</NavBarBackdrop>;
  };
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // mesma cor da tab bar
  strip: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.black },
});
