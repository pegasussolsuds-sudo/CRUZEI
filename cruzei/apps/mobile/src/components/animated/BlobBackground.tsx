import React, { useLayoutEffect, useMemo } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { Canvas, Circle, Fill, Group, RadialGradient, Skia, vec } from '@shopify/react-native-skia';
import { Easing, cancelAnimation, useDerivedValue, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { colors } from '@cruzei/ui-mobile';

export interface BlobBackgroundProps {
  /** cor de fundo sólida por baixo dos blobs */
  background?: string;
  /** cores dos 3 blobs (default: lima, magenta, dourado) */
  palette?: [string, string, string];
  /** opacidade geral dos blobs (0..1) */
  intensity?: number;
  /** velocidade do movimento (1 = ~14s pra dar a volta) */
  speed?: number;
  /** pausa a animação (ex.: tela fora de foco) */
  paused?: boolean;
}

/**
 * círculo desfocado (sigma `blur`) feito com gradiente radial: o mesmo perfil do BlurMask (cheio até r − 2σ, metade em r,
 * some em r + 2σ) sem o passe de desfoque de tela inteira a cada quadro
 */
function blobStops(color: string, r: number, blur: number) {
  const c = Skia.Color(color);
  const at = (a: number) => Float32Array.of(c[0], c[1], c[2], c[3] * a);
  const R = r + 2 * blur;
  return {
    R,
    colors: [at(1), at(1), at(0.84), at(0.5), at(0.16), at(0)],
    // tela baixa: o blob menor pode ter r < 2σ (o começo do perfil cai no centro)
    positions: [0, r - 2 * blur, r - blur, r, r + blur, R].map((d) => Math.max(0, d / R)),
  };
}

/**
 * Fundo "vivo": 3 blobs desfocados (Skia, gradiente radial) que dão UMA volta lenta ao aparecer e param onde começaram.
 * Parado, o Canvas não redesenha (o loop eterno com BlurMask custava a thread de UI inteira nas telas de cadastro, no
 * editor do avatar e no match). Com movimento reduzido ou `paused`, já nasce parado.
 * Ex.: <BlobBackground intensity={0.55} />  (posicione absoluto atrás do conteúdo)
 */
export function BlobBackground({
  background = colors.black,
  palette = [colors.primary, colors.secondary, colors.accent],
  intensity = 0.5,
  speed = 1,
  paused = false,
}: BlobBackgroundProps) {
  const { width, height } = useWindowDimensions();
  const t = useSharedValue(0);
  const reduceMotion = useReducedMotion();

  useLayoutEffect(() => {
    if (paused || reduceMotion) {
      cancelAnimation(t);
      return;
    }
    // uma volta inteira (t 0 → 1 = o "8" completo): termina no mesmo desenho do começo, com velocidade zero
    t.value = withTiming(1, { duration: 14_000 / speed, easing: Easing.inOut(Easing.sin) });
    return () => cancelAnimation(t);
  }, [paused, reduceMotion, speed, t]);

  // Trajetórias suaves em "8" — cada blob com fase diferente
  const r = useMemo(() => Math.max(width, height) * 0.42, [width, height]);
  const g1 = useMemo(() => blobStops(palette[0], r, 90), [palette, r]);
  const g2 = useMemo(() => blobStops(palette[1], r * 0.9, 100), [palette, r]);
  const g3 = useMemo(() => blobStops(palette[2], r * 0.7, 110), [palette, r]);
  const c1 = useDerivedValue(() => vec(width * 0.25 + Math.sin(t.value * Math.PI * 2) * width * 0.18, height * 0.28 + Math.cos(t.value * Math.PI * 2) * height * 0.08));
  const c2 = useDerivedValue(() => vec(width * 0.78 - Math.sin(t.value * Math.PI * 2 + 1.7) * width * 0.16, height * 0.62 + Math.sin(t.value * Math.PI * 2 + 0.6) * height * 0.1));
  const c3 = useDerivedValue(() => vec(width * 0.5 + Math.cos(t.value * Math.PI * 2 + 3.1) * width * 0.22, height * 0.9 - Math.sin(t.value * Math.PI * 2 + 2.2) * height * 0.07));

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Fill color={background} />
      <Group opacity={intensity}>
        <Circle c={c1} r={g1.R}>
          <RadialGradient c={c1} r={g1.R} colors={g1.colors} positions={g1.positions} />
        </Circle>
        <Circle c={c2} r={g2.R}>
          <RadialGradient c={c2} r={g2.R} colors={g2.colors} positions={g2.positions} />
        </Circle>
        <Circle c={c3} r={g3.R}>
          <RadialGradient c={c3} r={g3.R} colors={g3.colors} positions={g3.positions} />
        </Circle>
      </Group>
    </Canvas>
  );
}
