import React, { useLayoutEffect, useMemo } from 'react';
import { View, type ViewProps } from 'react-native';
import { BlurMask, Canvas, Circle, Group, LinearGradient, Path, Skia, vec } from '@shopify/react-native-skia';
import {
  Easing,
  cancelAnimation,
  runOnJS,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { colors, spring } from '@cruzei/ui-mobile';
import { BRAND } from '../../brand';

export interface MetchMarkProps extends ViewProps {
  /** lado do quadrado em px (default 48) */
  size?: number;
  /** cor dos traços (default lima) */
  color?: string;
  /** cor dos traços no ponto de encontro — mais clara pra dar volume */
  tipColor?: string;
  /** faísca no ponto onde os dois caminhos se encontram (default magenta) */
  sparkColor?: string;
  /** desenha os traços ao montar (default true); false = já pronto, sem animação */
  animated?: boolean;
  /** duração do desenho em ms (default 900) */
  drawMs?: number;
  /** atraso antes de começar a desenhar */
  delay?: number;
  /** halo que respira atrás do monograma (default true) */
  glow?: boolean;
  /** pausa o halo (tela fora de foco, splash saindo) — os traços continuam desenhados */
  paused?: boolean;
  /** chamado no instante em que os dois traços se encontram (só no modo interno) */
  onMeet?: () => void;
  /** controle externo (linha do tempo na UI thread): progresso do desenho 0..1 — desliga a animação interna */
  progress?: SharedValue<number>;
  /** controle externo: faísca + onda 0..1 (a faísca "estoura" nos primeiros 60 %, a onda usa o intervalo todo) */
  sparkProgress?: SharedValue<number>;
}

// Geometria em caixa 100×100 (a mesma dos ícones gerados pelo script brand-icons2.js):
// dois caminhos que sobem pelas laterais e descem até se encontrar no centro — "met".
const LEFT = 'M15 84 L15 20 L50 60';
const RIGHT = 'M85 84 L85 20 L50 60';
const MEET = vec(50, 60);
const STROKE = 13;
/** base visual do M (fim dos traços + ponta redonda) em fração do lado — usado pelo MetchLogo pra alinhar a linha de base */
export const MARK_BASE = 0.905;

const noop = () => {};

function backOut(x: number): number {
  'worklet';
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

/**
 * Monograma da marca: um "M" desenhado por dois traços que se encontram, com uma faísca no encontro.
 * Skia + Reanimated — o desenho (trim de path), a faísca e a onda rodam na UI thread.
 * Ex.: <MetchMark size={120} onMeet={() => burst()} />   |   <MetchMark size={28} animated={false} glow={false} />
 *      <MetchMark size={132} progress={draw} sparkProgress={spark} />  (coreografia externa, ver SplashScreen)
 */
export function MetchMark({
  size = 48,
  color = colors.primary,
  tipColor = '#D9FF8A',
  sparkColor = colors.secondary,
  animated = true,
  drawMs = 900,
  delay = 0,
  glow = true,
  paused = false,
  onMeet,
  progress,
  sparkProgress,
  style,
  accessible,
  ...rest
}: MetchMarkProps) {
  const reduceMotion = useReducedMotion();
  const external = Boolean(progress);
  const instant = !external && (!animated || reduceMotion);

  const ownDraw = useSharedValue(instant ? 1 : 0);
  const ownSpark = useSharedValue(instant ? 1 : 0);
  const ownRipple = useSharedValue(1); // 1 = onda já dissipada (invisível)
  const breath = useSharedValue(0.5);
  const draw = progress ?? ownDraw;

  const left = useMemo(() => Skia.Path.MakeFromSVGString(LEFT)!, []);
  const right = useMemo(() => Skia.Path.MakeFromSVGString(RIGHT)!, []);
  const meet = onMeet ?? noop;

  // useLayoutEffect: começa logo após o commit, antes dos efeitos passivos (que no boot podem atrasar segundos)
  useLayoutEffect(() => {
    if (external) return;
    if (instant) {
      ownDraw.value = 1;
      ownSpark.value = 1;
      ownRipple.value = 1;
      return;
    }
    ownDraw.value = 0;
    ownSpark.value = 0;
    ownRipple.value = 1;
    ownDraw.value = withDelay(
      delay,
      withTiming(1, { duration: drawMs, easing: Easing.out(Easing.cubic) }, (finished) => {
        if (!finished) return;
        ownSpark.value = withSpring(1, spring.bouncy);
        ownRipple.value = 0;
        ownRipple.value = withTiming(1, { duration: 700, easing: Easing.out(Easing.quad) });
        runOnJS(meet)();
      }),
    );
    return () => {
      cancelAnimation(ownDraw);
      cancelAnimation(ownSpark);
      cancelAnimation(ownRipple);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [external, instant, delay, drawMs]);

  // Halo respirando — parado quando pausado, sem halo ou com "reduzir movimento" (nada redesenha por frame)
  useLayoutEffect(() => {
    if (!glow || reduceMotion || paused) {
      cancelAnimation(breath);
      breath.value = 0.5;
      return;
    }
    breath.value = withRepeat(withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => cancelAnimation(breath);
  }, [breath, glow, reduceMotion, paused]);

  const glowOpacity = useDerivedValue(() => (glow ? (0.28 + 0.3 * breath.value) * draw.value : 0));
  const sparkScale = useDerivedValue(() => {
    if (sparkProgress) return backOut(Math.min(1, sparkProgress.value / 0.6));
    if (external) return draw.value >= 0.999 ? 1 : 0;
    return ownSpark.value;
  });
  const rippleP = useDerivedValue(() => (sparkProgress ? sparkProgress.value : external ? 1 : ownRipple.value));
  const sparkTransform = useDerivedValue(() => [{ scale: Math.max(0, sparkScale.value) }]);
  const rippleR = useDerivedValue(() => 7 + 30 * rippleP.value);
  // invisível antes do encontro (p = 0) e depois de dissipar (p = 1)
  const rippleOpacity = useDerivedValue(() => (rippleP.value <= 0 || rippleP.value >= 1 ? 0 : (1 - rippleP.value) * 0.9));
  const rippleWidth = useDerivedValue(() => 0.5 + 2.5 * (1 - rippleP.value));

  // O canvas sangra além da caixa pra não cortar o halo desfocado; o layout continua ocupando `size`
  const inset = glow ? Math.ceil(size * 0.3) : 0;
  const canvas = size + inset * 2;

  return (
    <View
      style={[{ width: size, height: size }, style]}
      accessible={accessible ?? true}
      accessibilityRole="image"
      accessibilityLabel={BRAND.name}
      {...rest}
    >
      <Canvas style={{ position: 'absolute', left: -inset, top: -inset, width: canvas, height: canvas }} pointerEvents="none">
        <Group transform={[{ translateX: inset }, { translateY: inset }, { scale: size / 100 }]}>
          {/* halo: os mesmos traços, mais grossos e desfocados */}
          {glow ? (
            <Group opacity={glowOpacity}>
              <Path path={left} style="stroke" strokeWidth={STROKE + 5} strokeCap="round" strokeJoin="round" color={color} start={0} end={draw}>
                <BlurMask blur={9} style="normal" />
              </Path>
              <Path path={right} style="stroke" strokeWidth={STROKE + 5} strokeCap="round" strokeJoin="round" color={color} start={0} end={draw}>
                <BlurMask blur={9} style="normal" />
              </Path>
            </Group>
          ) : null}

          {/* traços: gradiente da base (cor) até o encontro (mais claro) */}
          <Path path={left} style="stroke" strokeWidth={STROKE} strokeCap="round" strokeJoin="round" start={0} end={draw}>
            <LinearGradient start={vec(15, 84)} end={MEET} colors={[color, tipColor]} />
          </Path>
          <Path path={right} style="stroke" strokeWidth={STROKE} strokeCap="round" strokeJoin="round" start={0} end={draw}>
            <LinearGradient start={vec(85, 84)} end={MEET} colors={[color, tipColor]} />
          </Path>

          {/* onda que sai do encontro */}
          <Circle c={MEET} r={rippleR} style="stroke" strokeWidth={rippleWidth} color={sparkColor} opacity={rippleOpacity} />

          {/* faísca */}
          <Group transform={sparkTransform} origin={MEET}>
            <Circle c={MEET} r={11} color={sparkColor} opacity={0.55}>
              <BlurMask blur={6} style="normal" />
            </Circle>
            <Circle c={MEET} r={6.4} color={sparkColor} />
            <Circle c={MEET} r={2.8} color={colors.white} />
          </Group>
        </Group>
      </Canvas>
    </View>
  );
}
