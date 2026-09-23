import React, { useEffect, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type ViewProps } from 'react-native';
import { BlurMask, Canvas, Group, RoundedRect } from '@shopify/react-native-skia';
import { Easing, cancelAnimation, useDerivedValue, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { colors } from '@cruzei/ui-mobile';

export interface GlowProps extends ViewProps {
  color?: string;
  /** raio do halo em px além do conteúdo (= blur do Skia) */
  spread?: number;
  /** intensidade 0..1 */
  intensity?: number;
  /** anima o halo (respira) — desligue pra glow estático */
  animated?: boolean;
  /** formato: círculo (avatares) ou pílula (botões) */
  shape?: 'circle' | 'pill';
  cycleMs?: number;
}

/**
 * Halo luminoso atrás do conteúdo (Premium+, boost, CTA em destaque), com blur REAL (Skia BlurMask).
 * Mede o conteúdo via onLayout e desenha um Canvas maior por baixo — roda na GPU, sem re-render por frame.
 * Ex.: <Glow color="#FF1493" spread={14} shape="pill"><Button .../></Glow>
 */
export function Glow({
  color = colors.primary,
  spread = 12,
  intensity = 0.7,
  animated = true,
  shape = 'circle',
  cycleMs = 1600,
  style,
  children,
  ...rest
}: GlowProps) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const t = useSharedValue(animated ? 0 : 1);

  useEffect(() => {
    if (!animated) {
      t.value = 1;
      return;
    }
    t.value = withRepeat(withTiming(1, { duration: cycleMs, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => cancelAnimation(t);
  }, [animated, cycleMs, t]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width !== size.w || height !== size.h) setSize({ w: width, h: height });
  };

  // margem do canvas = 3x o blur pra não cortar o halo
  const pad = spread * 3;
  const canvasW = size.w + pad * 2;
  const canvasH = size.h + pad * 2;
  const radius = shape === 'circle' ? Math.max(size.w, size.h) / 2 : size.h / 2;

  const opacity = useDerivedValue(() => intensity * (0.35 + 0.45 * t.value));
  // o halo "respira": cresce um pouco no pico
  const grow = useDerivedValue(() => spread * 0.35 * t.value);
  const x = useDerivedValue(() => pad - grow.value);
  const y = useDerivedValue(() => pad - grow.value);
  const w = useDerivedValue(() => size.w + grow.value * 2);
  const h = useDerivedValue(() => size.h + grow.value * 2);
  const r = useDerivedValue(() => radius + grow.value);

  return (
    <View {...rest} style={[styles.wrap, style]}>
      {size.w > 0 ? (
        <Canvas
          pointerEvents="none"
          style={{ position: 'absolute', left: -pad, top: -pad, width: canvasW, height: canvasH }}
        >
          <Group opacity={opacity}>
            <RoundedRect x={x} y={y} width={w} height={h} r={r} color={color}>
              <BlurMask blur={spread} style="normal" />
            </RoundedRect>
          </Group>
        </Canvas>
      ) : null}
      <View onLayout={onLayout} style={styles.content}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'flex-start', alignItems: 'center', justifyContent: 'center' },
  content: { alignSelf: 'stretch' },
});
