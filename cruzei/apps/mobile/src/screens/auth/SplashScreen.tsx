import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { BlurMask, Canvas, Circle, Group } from '@shopify/react-native-skia';
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { colors, spring, typography } from '@cruzei/ui-mobile';
import { BlobBackground } from '../../components/animated/BlobBackground';

export interface SplashScreenProps {
  /** chamado quando a animação de saída termina (≈2.6s) */
  onFinish: () => void;
  /** segura a saída até estar pronto (fontes, sessão) — a splash continua viva enquanto false */
  ready?: boolean;
  /** duração mínima em ms antes de sair (default 2400) */
  minDurationMs?: number;
}

const PARTICLES = 22;

// Pseudo-aleatório determinístico (mesma explosão em todo boot — parece intencional, não bug)
function seeded(i: number, salt: number): number {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Splash animada: blobs de gradiente vivos (Skia), logo "cruzei" com bounce,
 * partículas saindo do logo, tagline em fade e saída suave pra Welcome.
 * Uso: <SplashScreen ready={fontsReady && !authLoading} onFinish={() => setSplashDone(true)} />
 */
export function SplashScreen({ onFinish, ready = true, minDurationMs = 2400 }: SplashScreenProps) {
  const { width, height } = useWindowDimensions();
  const logoScale = useSharedValue(0.4);
  const logoOpacity = useSharedValue(0);
  const glow = useSharedValue(0);
  const burst = useSharedValue(0); // 0 → 1: partículas saem do centro
  const tagline = useSharedValue(0);
  const exit = useSharedValue(0); // 0 → 1: fade-out/scale-up de saída
  const elapsed = useSharedValue(0);

  // Partículas: ângulo, distância e tamanho fixos por índice
  const particles = useMemo(
    () =>
      Array.from({ length: PARTICLES }, (_, i) => ({
        angle: seeded(i, 1) * Math.PI * 2,
        dist: 90 + seeded(i, 2) * 150,
        size: 2 + seeded(i, 3) * 4,
        color: [colors.primary, colors.secondary, colors.accent][i % 3],
        delay: seeded(i, 4) * 0.25,
      })),
    [],
  );

  useEffect(() => {
    // 1) logo entra com bounce (overshoot 1.15 → 1)
    logoOpacity.value = withTiming(1, { duration: 500, easing: Easing.out(Easing.quad) });
    logoScale.value = withSequence(withSpring(1.15, spring.bouncy), withSpring(1, spring.soft));
    // 2) glow respira
    glow.value = withDelay(300, withRepeat(withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.ease) }), -1, true));
    // 3) partículas explodem logo após o bounce
    burst.value = withDelay(350, withTiming(1, { duration: 1400, easing: Easing.out(Easing.cubic) }));
    // 4) tagline
    tagline.value = withDelay(700, withTiming(1, { duration: 500, easing: Easing.out(Easing.quad) }));
    // 5) relógio da duração mínima
    elapsed.value = withTiming(1, { duration: minDurationMs, easing: Easing.linear });
  }, [burst, elapsed, glow, logoOpacity, logoScale, minDurationMs, tagline]);

  // Saída: só quando passou a duração mínima E o app está pronto
  const canExit = ready;
  useEffect(() => {
    if (!canExit) return;
    const id = setTimeout(() => {
      exit.value = withTiming(1, { duration: 450, easing: Easing.in(Easing.cubic) }, (finished) => {
        if (finished) runOnJS(onFinish)();
      });
    }, Math.max(0, minDurationMs - Math.round(elapsed.value * minDurationMs)));
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canExit]);

  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value * (1 - exit.value),
    transform: [{ scale: logoScale.value * (1 + 0.25 * exit.value) }],
  }));
  const taglineStyle = useAnimatedStyle(() => ({
    opacity: tagline.value * (1 - exit.value),
    transform: [{ translateY: (1 - tagline.value) * 10 }],
  }));
  const containerStyle = useAnimatedStyle(() => ({ opacity: 1 - exit.value * 0.15 }));

  // Partículas em Skia: posição derivada do progresso (cada uma com delay próprio)
  const cx = width / 2;
  const cy = height / 2 - 20;
  const particleValues = particles.map((p) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const px = useDerivedValue(() => {
      const t = Math.max(0, Math.min(1, (burst.value - p.delay) / (1 - p.delay)));
      return cx + Math.cos(p.angle) * p.dist * t;
    });
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const py = useDerivedValue(() => {
      const t = Math.max(0, Math.min(1, (burst.value - p.delay) / (1 - p.delay)));
      return cy + Math.sin(p.angle) * p.dist * t + 30 * t * t; // leve gravidade
    });
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const pr = useDerivedValue(() => {
      const t = Math.max(0, Math.min(1, (burst.value - p.delay) / (1 - p.delay)));
      return p.size * (1 - t * 0.6);
    });
    return { px, py, pr, color: p.color };
  });
  const particleOpacity = useDerivedValue(() => (burst.value < 0.05 ? 0 : (1 - burst.value) * 0.9 * (1 - exit.value)));
  // halo desfocado atrás do logo (Skia) — respira junto com o glow
  const haloOpacity = useDerivedValue(() => interpolate(glow.value, [0, 1], [0.28, 0.6]) * (1 - exit.value));
  const haloR = useDerivedValue(() => interpolate(glow.value, [0, 1], [120, 150]));

  return (
    <Animated.View style={[styles.container, containerStyle]} accessibilityRole="image" accessibilityLabel="Cruzei">
      <BlobBackground intensity={0.32} speed={1.3} />

      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        <Group opacity={haloOpacity}>
          <Circle cx={cx} cy={cy} r={haloR} color={colors.primary}>
            <BlurMask blur={70} style="normal" />
          </Circle>
        </Group>
        <Group opacity={particleOpacity}>
          {particleValues.map((p, i) => (
            <Circle key={i} cx={p.px} cy={p.py} r={p.pr} color={p.color} />
          ))}
        </Group>
      </Canvas>

      <View style={styles.center}>
        <Animated.Text style={[styles.logo, logoStyle]}>cruzei</Animated.Text>
        <Animated.Text style={[styles.tagline, taglineStyle]}>quem você quase conheceu hoje</Animated.Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.black },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: -20 },
  logo: {
    ...typography.display,
    fontSize: 64,
    lineHeight: 72,
    letterSpacing: -2.5,
    color: colors.primary,
    textShadowColor: 'rgba(127,255,0,0.55)',
    textShadowRadius: 24,
    textShadowOffset: { width: 0, height: 0 },
  },
  tagline: {
    ...typography.bodyLarge,
    color: colors.white,
    opacity: 0.85,
    marginTop: 6,
  },
});
