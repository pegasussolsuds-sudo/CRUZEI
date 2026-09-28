import React, { useEffect, useMemo } from 'react';
import { Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '@cruzei/ui-mobile';

// Um relógio só pra todos os pontos "online" da tela, no Animated NATIVO do RN (roda na thread de UI, sem worklets).
// O Pulse (Reanimated) cria um mapper + uma animação por instância; numa lista que remonta linhas a cada atualização
// (multidão em volta, conversas chegando) isso virava centenas de montagens por minuto e derrubava o app no Moto g54
// com crash nativo em worklets::ShareableArray::toJSValue.
const HALF_CYCLE_MS = 800;
let clock: Animated.Value | null = null;
let loop: Animated.CompositeAnimation | null = null;
let holders = 0;

function getClock(): Animated.Value {
  if (!clock) clock = new Animated.Value(0);
  return clock;
}

/** liga o loop no primeiro ponto montado e devolve quem desliga (no último desmontado) */
function holdClock(): () => void {
  const value = getClock();
  if (holders++ === 0) {
    const ease = Easing.inOut(Easing.ease);
    loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, { toValue: 1, duration: HALF_CYCLE_MS, easing: ease, useNativeDriver: true }),
        Animated.timing(value, { toValue: 0, duration: HALF_CYCLE_MS, easing: ease, useNativeDriver: true }),
      ]),
    );
    loop.start();
  }
  return () => {
    if (--holders > 0) return;
    holders = 0;
    loop?.stop();
    loop = null;
  };
}

export interface LiveDotProps {
  /** diâmetro do ponto (default 8) */
  size?: number;
  color?: string;
  /** anel que expande e some em volta do ponto */
  halo?: boolean;
  /** borda do ponto (ex.: branca sobre avatar) */
  borderColor?: string;
  style?: StyleProp<ViewStyle>;
}

/**
 * Ponto "online" que respira. Ex.: <LiveDot size={8} /> numa linha de lista; <LiveDot halo size={12} borderColor="#fff" />
 * no canto do avatar.
 */
export function LiveDot({ size = 8, color = colors.primary, halo = false, borderColor, style }: LiveDotProps) {
  const t = getClock();
  useEffect(holdClock, []);

  const dotStyle = useMemo(
    () => ({ transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] }) }] }),
    [t],
  );
  const haloStyle = useMemo(
    () => ({
      opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
      transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [1, 2.2] }) }],
    }),
    [t],
  );
  const round = { width: size, height: size, borderRadius: size / 2, backgroundColor: color };

  return (
    <View style={[styles.wrap, style]} pointerEvents="none">
      {halo ? <Animated.View style={[styles.abs, round, haloStyle]} /> : null}
      <Animated.View style={[round, borderColor ? { borderWidth: 2, borderColor } : null, dotStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  abs: { position: 'absolute' },
});
