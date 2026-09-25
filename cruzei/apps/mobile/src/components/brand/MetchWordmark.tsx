import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Text, View, type ViewProps } from 'react-native';
import { BlurMask, Canvas, Group, LinearGradient, Path, Skia, rect, vec, type SkTypeface } from '@shopify/react-native-skia';
import {
  Easing,
  cancelAnimation,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { colors, fontFamily } from '@cruzei/ui-mobile';
import { BRAND } from '../../brand';
import { brandTypefaceFailed, getBrandTypeface, preloadBrandTypeface } from './brand-font';

/** métricas da Space Grotesk Bold em fração do tamanho (ascent 0,984 / descent 0,292) — pro fallback e pro alinhamento no MetchLogo */
export const WORDMARK_ASCENT = 0.984;
export const WORDMARK_DESCENT = 0.292;
/** distância da linha de base ao centro vertical do canvas, em fração do tamanho (o pad do halo é simétrico e se cancela) */
export const WORDMARK_BASELINE_FROM_CENTER = (WORDMARK_ASCENT - WORDMARK_DESCENT) / 2;

export interface MetchWordmarkProps extends ViewProps {
  /** tamanho da fonte em px (default 40) */
  size?: number;
  /** texto do wordmark (default "metch") */
  text?: string;
  /** cor base (default lima) */
  color?: string;
  /** cor do topo das letras — gradiente vertical dá volume (default lima clara) */
  highlight?: string;
  /** espaçamento entre letras em px (default −4,5 % do tamanho, como o display do design system) */
  letterSpacing?: number;
  /** halo desfocado atrás das letras (default true) */
  glow?: boolean;
  /** pausa o brilho automático (tela fora de foco) — o wordmark continua revelado */
  paused?: boolean;
  /** revelação externa 0..1 (varredura da esquerda pra direita) */
  reveal?: SharedValue<number>;
  /** brilho externo 0..1 (posição da faixa de luz que atravessa as letras) */
  shimmer?: SharedValue<number>;
  /** quando não há `reveal` externo: revela ao montar (default true) */
  animated?: boolean;
  /** quando não há `shimmer` externo: 'once' (default), 'loop' (a cada ~4 s) ou 'none' */
  autoShimmer?: 'none' | 'once' | 'loop';
  /** atraso da revelação automática */
  delay?: number;
}

/**
 * Wordmark "metch" desenhado em Skia com a fonte display (Space Grotesk Bold), convertido em path
 * (letra a letra, com letter-spacing): gradiente vertical, halo, revelação por varredura e
 * faixa de brilho diagonal premium. Cai pra <Text> comum se a fonte não carregar.
 * Ex.: <MetchWordmark size={58} reveal={reveal} shimmer={shimmer} />   |   <MetchWordmark size={32} autoShimmer="loop" />
 */
export function MetchWordmark({
  size = 40,
  text = BRAND.wordmark,
  color = colors.primary,
  highlight = '#D9FF8A',
  letterSpacing,
  glow = true,
  paused = false,
  reveal,
  shimmer,
  animated = true,
  autoShimmer = 'once',
  delay = 0,
  style,
  accessible,
  ...rest
}: MetchWordmarkProps) {
  const reduceMotion = useReducedMotion();
  const [typeface, setTypeface] = useState<SkTypeface | null>(getBrandTypeface);
  const [failed, setFailed] = useState(brandTypefaceFailed);
  const font = useMemo(() => (typeface ? Skia.Font(typeface, size) : null), [typeface, size]);

  useEffect(() => {
    if (typeface || failed) return;
    let on = true;
    preloadBrandTypeface().then((tf) => {
      if (!on) return;
      if (tf) setTypeface(tf);
      else setFailed(true);
    });
    return () => {
      on = false;
    };
  }, [typeface, failed]);

  const ownReveal = useSharedValue(reveal || !animated || reduceMotion ? 1 : 0);
  const ownShimmer = useSharedValue(0);
  const rv = reveal ?? ownReveal;
  const sh = shimmer ?? ownShimmer;

  const ls = letterSpacing ?? -size * 0.045;
  const pad = glow ? Math.ceil(size * 0.4) : 4;

  // Contorno das letras como um único path (posição por letra, com letter-spacing) + caixa do canvas
  const layout = useMemo(() => {
    if (!font) return null;
    const chars = Array.from(text);
    const ids = font.getGlyphIDs(text);
    const widths = font.getGlyphWidths(ids);
    const m = font.getMetrics();
    const baseline = pad - m.ascent; // ascent é negativo
    const path = Skia.Path.Make();
    let x = pad;
    chars.forEach((ch, i) => {
      const glyph = Skia.Path.MakeFromText(ch, x, baseline, font);
      if (glyph) path.addPath(glyph);
      x += (widths[i] ?? 0) + ls;
    });
    const textW = x - pad - ls;
    return {
      path,
      width: Math.ceil(textW + pad * 2),
      height: Math.ceil(-m.ascent + m.descent + pad * 2),
      baseline,
      textW,
    };
  }, [font, text, ls, pad]);

  // Revelação automática (só quando não há controle externo) — layout effect pra não esperar a thread JS livre
  useLayoutEffect(() => {
    if (reveal) return;
    if (!animated || reduceMotion) {
      ownReveal.value = 1;
      return;
    }
    ownReveal.value = 0;
    ownReveal.value = withDelay(delay, withTiming(1, { duration: 650, easing: Easing.out(Easing.cubic) }));
    return () => cancelAnimation(ownReveal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal, animated, reduceMotion, delay]);

  // Brilho automático (parado quando pausado)
  useLayoutEffect(() => {
    if (shimmer || autoShimmer === 'none' || reduceMotion || paused) {
      cancelAnimation(ownShimmer);
      ownShimmer.value = 0;
      return;
    }
    const sweep = withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.quad) });
    ownShimmer.value = 0;
    ownShimmer.value =
      autoShimmer === 'loop'
        ? withDelay(delay + 600, withRepeat(withSequence(sweep, withDelay(3400, withTiming(0, { duration: 1 }))), -1, false))
        : withDelay(delay + 600, sweep);
    return () => cancelAnimation(ownShimmer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shimmer, autoShimmer, reduceMotion, paused, delay]);

  // Varredura de revelação: clip retangular que anda da esquerda pra direita
  // (o Mask do Skia com gradiente alfa escurecia as letras neste device — clip é robusto)
  const W = layout?.width ?? 0;
  const H = layout?.height ?? 0;
  const revealClip = useDerivedValue(() => rect(0, 0, rv.value * W, H));
  // Faixa de brilho diagonal. Como é inclinada, sua pegada horizontal ao longo da altura é H²/(2·band):
  // o percurso inclui isso pra faixa ficar totalmente fora das letras em 0 e em 1 (sem resíduo em repouso)
  const band = size * 0.8;
  const off = band + (H * H) / (2 * band);
  const shimmerX = useDerivedValue(() => -off + sh.value * (W + 2 * off));
  const shimmerStart = useDerivedValue(() => vec(shimmerX.value - band, H));
  const shimmerEnd = useDerivedValue(() => vec(shimmerX.value + band, 0));

  const a11y = {
    accessible: accessible ?? true,
    accessibilityRole: 'image' as const,
    accessibilityLabel: BRAND.name,
  };

  if (failed) {
    // mesma caixa do canvas (pad do halo + ascent/descent da fonte) pra manter as margens dos callers
    const lineHeight = Math.ceil(size * (WORDMARK_ASCENT + WORDMARK_DESCENT));
    return (
      <View style={[{ paddingVertical: pad, paddingHorizontal: pad }, style]} {...a11y} {...rest}>
        <Text style={{ fontFamily: fontFamily.display, fontSize: size, lineHeight, letterSpacing: ls, color, includeFontPadding: false }}>{text}</Text>
      </View>
    );
  }

  if (!font || !layout) {
    // placeholder com o tamanho aproximado pra não pular o layout quando a fonte chegar
    return (
      <View
        style={[{ width: Math.ceil(size * 0.56 * text.length + pad * 2), height: Math.ceil(size * (WORDMARK_ASCENT + WORDMARK_DESCENT) + pad * 2) }, style]}
        {...a11y}
        {...rest}
      />
    );
  }

  return (
    <View style={[{ width: W, height: H }, style]} {...a11y} {...rest}>
      <Canvas style={{ width: W, height: H }} pointerEvents="none">
        <Group clip={revealClip}>
          {glow ? (
            <Group opacity={0.55}>
              <Path path={layout.path} color={color}>
                <BlurMask blur={size * 0.26} style="normal" />
              </Path>
            </Group>
          ) : null}
          <Path path={layout.path}>
            <LinearGradient start={vec(0, pad)} end={vec(0, H - pad)} colors={[highlight, color]} />
          </Path>
          {/* pontas em branco transparente (não preto transparente): o Skia interpola sem pré-multiplicar */}
          <Path path={layout.path}>
            <LinearGradient start={shimmerStart} end={shimmerEnd} colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.92)', 'rgba(255,255,255,0)']} />
          </Path>
        </Group>
      </Canvas>
    </View>
  );
}
