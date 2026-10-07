import React, { useEffect, useMemo } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '@cruzei/ui-mobile';

// Um relógio só pra todos os pontos "online" da tela, no Animated NATIVO do RN (roda na thread de UI, sem worklets).
// O Pulse (Reanimated) cria um mapper + uma animação por instância; numa lista que remonta linhas a cada atualização
// (multidão em volta, conversas chegando) isso virava centenas de montagens por minuto e derrubava o app no Moto g54
// com crash nativo em worklets::ShareableArray::toJSValue.
// O relógio respira CYCLES vezes quando um ponto aparece e para no repouso (ponto normal, halo apagado): um loop eterno
// numa linha de lista (ainda que fora da tela, embaixo da folha recolhida do mapa) fazia a janela redesenhar a 60 fps.
const HALF_CYCLE_MS = 800;
const CYCLES = 3;
/** respirou até o fim há menos disso: ponto novo (linha que remonta numa lista viva) não religa o relógio de todos */
const REARM_MS = 30_000;
let clock: Animated.Value | null = null;
let loop: Animated.CompositeAnimation | null = null;
let holders = 0;
let lastEnd = -Infinity;
let reduceMotion = false;

/** movimento reduzido ligou (no boot, depois de algum ponto já ter montado, ou com o app aberto): para e volta ao repouso */
function setReduceMotion(v: boolean): void {
  reduceMotion = v;
  if (!v) return;
  loop?.stop();
  loop = null;
  clock?.setValue(0);
}
AccessibilityInfo.isReduceMotionEnabled()
  .then(setReduceMotion)
  .catch(() => {});
try {
  AccessibilityInfo.addEventListener?.('reduceMotionChanged', setReduceMotion);
} catch {
  // ambiente sem o evento (teste): fica a leitura do boot
}

function getClock(): Animated.Value {
  if (!clock) clock = new Animated.Value(0);
  return clock;
}

/** (re)liga a respiração quando um ponto monta (se não estiver rodando) e devolve quem desliga (no último desmontado) */
function holdClock(): () => void {
  const value = getClock();
  holders++;
  if (!loop && !reduceMotion && Date.now() - lastEnd >= REARM_MS) {
    const ease = Easing.inOut(Easing.ease);
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(value, { toValue: 1, duration: HALF_CYCLE_MS, easing: ease, useNativeDriver: true }),
        Animated.timing(value, { toValue: 0, duration: HALF_CYCLE_MS, easing: ease, useNativeDriver: true }),
      ]),
      { iterations: CYCLES },
    );
    loop = anim;
    anim.start(({ finished }) => {
      if (loop === anim) loop = null;
      if (finished) lastEnd = Date.now();
    });
  }
  return () => {
    if (--holders > 0) return;
    holders = 0;
    loop?.stop();
    loop = null;
    getClock().setValue(0); // parou no meio: o próximo ponto não nasce meio inflado
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
 * Ponto "online" que respira umas vezes ao aparecer. Ex.: <LiveDot size={8} /> numa linha de lista; <LiveDot halo size={12} borderColor="#fff" />
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
