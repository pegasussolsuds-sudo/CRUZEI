import React, { useEffect, useMemo } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { Canvas, Group, RoundedRect } from '@shopify/react-native-skia';
import { Easing, cancelAnimation, runOnJS, useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';
import { colors } from '@cruzei/ui-mobile';

export interface ConfettiProps {
  /** dispara a explosão (mude pra true pra rodar; volta a false pra reiniciar) */
  active: boolean;
  count?: number;
  palette?: string[];
  durationMs?: number;
  /** ponto de origem em fração da tela (0..1) — default centro-alto */
  origin?: { x: number; y: number };
  onDone?: () => void;
}

function seeded(i: number, salt: number): number {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Confete em Skia: N retângulos disparados de um ponto com gravidade, giro e fade.
 * Um único shared value dirige tudo (GPU/UI thread). Usado na celebração do match.
 * Ex.: <Confetti active={showMatch} onDone={() => ...} />
 */
export function Confetti({
  active,
  count = 90,
  palette = [colors.primary, colors.secondary, colors.accent, colors.white],
  durationMs = 2600,
  origin = { x: 0.5, y: 0.35 },
  onDone,
}: ConfettiProps) {
  const { width, height } = useWindowDimensions();
  const t = useSharedValue(0);

  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const angle = -Math.PI / 2 + (seeded(i, 1) - 0.5) * Math.PI * 1.1; // leque pra cima
        const speed = 380 + seeded(i, 2) * 520;
        return {
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          w: 6 + seeded(i, 3) * 8,
          h: 10 + seeded(i, 4) * 10,
          spin: (seeded(i, 5) - 0.5) * 12,
          delay: seeded(i, 6) * 0.15,
          color: palette[i % palette.length],
        };
      }),
    [count, palette],
  );

  useEffect(() => {
    if (!active) {
      cancelAnimation(t);
      t.value = 0;
      return;
    }
    t.value = 0;
    t.value = withTiming(1, { duration: durationMs, easing: Easing.linear }, (finished) => {
      if (finished && onDone) runOnJS(onDone)();
    });
    return () => cancelAnimation(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, durationMs]);

  const ox = width * origin.x;
  const oy = height * origin.y;
  const g = 1400; // gravidade px/s²

  const groupOpacity = useDerivedValue(() => (t.value < 0.7 ? 1 : 1 - (t.value - 0.7) / 0.3));

  if (!active) return null;

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Group opacity={groupOpacity}>
        {pieces.map((p, i) => (
          <Piece key={i} p={p} t={t} ox={ox} oy={oy} g={g} seconds={durationMs / 1000} />
        ))}
      </Group>
    </Canvas>
  );
}

type PieceSpec = { vx: number; vy: number; w: number; h: number; spin: number; delay: number; color: string };

function Piece({ p, t, ox, oy, g, seconds }: { p: PieceSpec; t: { value: number }; ox: number; oy: number; g: number; seconds: number }) {
  // tempo próprio (com delay) em segundos
  const x = useDerivedValue(() => {
    const s = Math.max(0, t.value * seconds - p.delay);
    return ox + p.vx * s * 0.6;
  });
  const y = useDerivedValue(() => {
    const s = Math.max(0, t.value * seconds - p.delay);
    return oy + p.vy * s * 0.6 + 0.5 * g * s * s * 0.6;
  });
  const transform = useDerivedValue(() => {
    const s = Math.max(0, t.value * seconds - p.delay);
    return [{ translateX: x.value }, { translateY: y.value }, { rotate: p.spin * s }, { scaleX: Math.cos(s * 9) }];
  });
  return (
    <Group transform={transform}>
      <RoundedRect x={-p.w / 2} y={-p.h / 2} width={p.w} height={p.h} r={2} color={p.color} />
    </Group>
  );
}
