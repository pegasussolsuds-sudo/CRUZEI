import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { BlurMask, Canvas, Circle, Group } from '@shopify/react-native-skia';
import * as Haptics from 'expo-haptics';
import Animated, {
  Easing,
  Extrapolation,
  cancelAnimation,
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { colors, typography } from '@cruzei/ui-mobile';
import { BlobBackground } from '../../components/animated/BlobBackground';
import { MetchMark, MetchWordmark } from '../../components/brand';
import { BRAND } from '../../brand';

export interface SplashScreenProps {
  /** chamado quando a animação de saída termina (≈3 s) */
  onFinish: () => void;
  /** chamado quando a coreografia termina (≈2,3 s) — hora de montar o app por baixo sem engasgar a animação */
  onSettled?: () => void;
  /** segura a saída até estar pronto (fontes, sessão) — a splash continua viva enquanto false */
  ready?: boolean;
  /** já saiu: fica montada, invisível e fora do toque/acessibilidade (evita destruir os canvases Skia) */
  done?: boolean;
  /** duração mínima em ms antes de sair (default 2600) */
  minDurationMs?: number;
}

const PARTICLES = 26;
const MARK = 132;
const WORD = 58;

// Linha do tempo (ms) — UMA animação linear na UI thread; tudo deriva dela.
// No boot a thread JS fica ocupada montando o mapa por baixo, então nada aqui depende de callbacks JS.
const T = {
  drawStart: 100,
  drawMs: 900,
  meet: 1000, // = drawStart + drawMs: os traços se encontram
  sparkMs: 700,
  burstMs: 1200,
  haloMs: 600,
  reveal: 1060,
  revealMs: 620,
  shimmer: 1500,
  shimmerMs: 800,
  tagline: 1560,
  taglineMs: 480,
  end: 2300,
} as const;

// Pseudo-aleatório determinístico (mesma explosão em todo boot — parece intencional, não bug)
function seeded(i: number, salt: number): number {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function seg(t: number, start: number, ms: number): number {
  'worklet';
  return Math.max(0, Math.min(1, (t - start) / ms));
}
function outCubic(x: number): number {
  'worklet';
  return 1 - Math.pow(1 - x, 3);
}
function outQuad(x: number): number {
  'worklet';
  return 1 - (1 - x) * (1 - x);
}
function inOutQuad(x: number): number {
  'worklet';
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}

/**
 * Splash da marca: os dois traços do monograma se desenham e se encontram; no encontro,
 * faísca + onda + partículas, o wordmark "metch" se revela com uma faixa de luz, a tagline sobe,
 * e tudo sai num zoom suave pra tela de baixo. "Reduzir movimento": estado final direto e saída em fade.
 * Uso: <SplashScreen ready={!authLoading} onSettled={mountApp} onFinish={() => setSplashDone(true)} />
 */
export function SplashScreen({ onFinish, onSettled, ready = true, minDurationMs = 2600, done = false }: SplashScreenProps) {
  const { width, height } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const startedAt = useRef(Date.now());
  const markRef = useRef<View>(null);
  // Depois da saída, TODAS as animações param antes de desmontar: os canvases Skia (TextureViews) são
  // destruídos sem redraw pendente — desmontar com mapper rodando, junto com o GL do mapa nascendo, já derrubou o HWUI.
  const [stopped, setStopped] = useState(false);

  const t = useSharedValue(reduceMotion ? T.end : 0); // relógio da coreografia (ms)
  const breath = useSharedValue(0.5);
  const exit = useSharedValue(0); // 0 → 1: fade-out/scale-up de saída
  // origem das partículas = faísca do monograma (estimativa pelo layout; refinada por measureInWindow)
  const ox = useSharedValue(width / 2);
  const oy = useSharedValue(height / 2 - 82);

  const particles = useMemo(
    () =>
      Array.from({ length: PARTICLES }, (_, i) => ({
        angle: seeded(i, 1) * Math.PI * 2,
        dist: 70 + seeded(i, 2) * 150,
        size: 1.6 + seeded(i, 3) * 3.4,
        color: [colors.primary, colors.secondary, colors.white, colors.primary][i % 4],
        delay: seeded(i, 4) * 0.25,
      })),
    [],
  );

  // Começa no commit (layout effect), não nos efeitos passivos — que no boot rodam segundos depois
  useLayoutEffect(() => {
    startedAt.current = Date.now();
    if (!reduceMotion) {
      t.value = withTiming(T.end, { duration: T.end, easing: Easing.linear });
      breath.value = withRepeat(withTiming(1, { duration: 1700, easing: Easing.inOut(Easing.sin) }), -1, true);
    }
    return () => {
      cancelAnimation(t);
      cancelAnimation(breath);
      cancelAnimation(exit);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Callbacks em refs: o App passa arrows novas a cada render e as reações não devem re-registrar
  // (re-registrar zera o "was" e dispararia de novo). Cada evento acontece UMA vez por montagem.
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;
  const firedRef = useRef({ meet: false, settled: false, finished: false });

  // Ponto de encontro dos traços em coordenadas de tela (as partículas nascem dali)
  const onMarkLayout = useCallback(() => {
    markRef.current?.measureInWindow((x, y, w, h) => {
      if (w > 0) {
        ox.value = x + w * 0.5;
        oy.value = y + h * 0.6;
      }
    });
  }, [ox, oy]);

  // Toque háptico no encontro (o único ponto que precisa da thread JS — se atrasar, não atrasa o visual)
  const haptic = useCallback(() => {
    if (firedRef.current.meet) return;
    firedRef.current.meet = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, []);
  useAnimatedReaction(
    () => t.value >= T.meet,
    (met, was) => {
      if (met && was === false) runOnJS(haptic)();
    },
    [],
  );

  // Coreografia terminada → o App monta o navegador por baixo (a montagem segura a thread JS ~1 s;
  // aqui só resta o halo respirando, então o engasgo não aparece)
  const settled = useCallback(() => {
    if (firedRef.current.settled) return;
    firedRef.current.settled = true;
    onSettledRef.current?.();
  }, []);
  useAnimatedReaction(
    () => t.value >= T.end,
    (done, was) => {
      if (done && !was) runOnJS(settled)();
    },
    [],
  );

  // Saída terminou: para tudo (halo, blobs), espera um frame e só então avisa o App pra desmontar
  const finish = useCallback(() => {
    if (firedRef.current.finished) return;
    firedRef.current.finished = true;
    cancelAnimation(breath);
    breath.value = 0.5;
    setStopped(true);
    setTimeout(() => onFinishRef.current(), 60);
  }, [breath]);

  // Saída: só quando passou a duração mínima E o app está pronto
  useEffect(() => {
    if (!ready) return;
    const elapsed = Date.now() - startedAt.current;
    const id = setTimeout(
      () => {
        exit.value = withTiming(1, { duration: 500, easing: Easing.in(Easing.cubic) }, (finished) => {
          if (finished) runOnJS(finish)();
        });
      },
      Math.max(0, minDurationMs - elapsed),
    );
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Derivados da linha do tempo
  const draw = useDerivedValue(() => outCubic(seg(t.value, T.drawStart, T.drawMs)));
  const spark = useDerivedValue(() => seg(t.value, T.meet, T.sparkMs));
  const burst = useDerivedValue(() => seg(t.value, T.meet, T.burstMs));
  const halo = useDerivedValue(() => outQuad(seg(t.value, T.meet, T.haloMs)));
  const reveal = useDerivedValue(() => outCubic(seg(t.value, T.reveal, T.revealMs)));
  const shimmer = useDerivedValue(() => inOutQuad(seg(t.value, T.shimmer, T.shimmerMs)));
  const tagline = useDerivedValue(() => outQuad(seg(t.value, T.tagline, T.taglineMs)));

  const exitScale = reduceMotion ? 0 : 0.22; // com "reduzir movimento" a saída é só um fade
  const contentStyle = useAnimatedStyle(() => ({
    opacity: 1 - exit.value,
    transform: [{ scale: 1 + exitScale * exit.value }],
  }));
  const taglineStyle = useAnimatedStyle(() => ({
    opacity: tagline.value,
    transform: [{ translateY: (1 - tagline.value) * 10 }],
  }));
  // O conteúdo sai primeiro; o véu escuro cruza pra tela de baixo no fim e desmonta em opacidade 0 (sem corte seco)
  const containerStyle = useAnimatedStyle(() => ({
    opacity: interpolate(exit.value, [0.35, 1], [1, 0], Extrapolation.CLAMP),
  }));

  // Partículas em Skia: posição derivada do progresso (cada uma com delay próprio e saída em ease-out)
  const particleValues = particles.map((p) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const px = useDerivedValue(() => {
      const e = outCubic(seg(burst.value, p.delay, 1 - p.delay));
      return ox.value + Math.cos(p.angle) * p.dist * e;
    });
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const py = useDerivedValue(() => {
      const e = outCubic(seg(burst.value, p.delay, 1 - p.delay));
      return oy.value + Math.sin(p.angle) * p.dist * e + 34 * e * e; // leve gravidade
    });
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const pr = useDerivedValue(() => {
      const e = outCubic(seg(burst.value, p.delay, 1 - p.delay));
      return p.size * (1 - e * 0.6);
    });
    return { px, py, pr, color: p.color };
  });
  const particleOpacity = useDerivedValue(() => (burst.value < 0.02 ? 0 : (1 - burst.value) * 0.95 * (1 - exit.value)));
  // halo desfocado atrás do monograma — acende no encontro e respira
  const haloOpacity = useDerivedValue(() => halo.value * interpolate(breath.value, [0, 1], [0.22, 0.5]) * (1 - exit.value));
  const haloR = useDerivedValue(() => interpolate(breath.value, [0, 1], [130, 165]) * (1 + exitScale * exit.value));

  return (
    <Animated.View
      style={[styles.container, containerStyle]}
      pointerEvents={stopped || done ? 'none' : 'auto'}
      accessibilityRole="image"
      accessibilityLabel={BRAND.name}
      accessibilityElementsHidden={stopped || done}
      importantForAccessibility={stopped || done ? 'no-hide-descendants' : 'auto'}
    >
      <BlobBackground intensity={0.26} speed={1.2} paused={stopped} />

      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        <Group opacity={haloOpacity}>
          <Circle cx={ox} cy={oy} r={haloR} color={colors.primary}>
            <BlurMask blur={80} style="normal" />
          </Circle>
        </Group>
        <Group opacity={particleOpacity}>
          {particleValues.map((p, i) => (
            <Circle key={i} cx={p.px} cy={p.py} r={p.pr} color={p.color} />
          ))}
        </Group>
      </Canvas>

      <Animated.View style={[styles.center, contentStyle]} pointerEvents="none">
        <View ref={markRef} onLayout={onMarkLayout} collapsable={false}>
          <MetchMark size={MARK} progress={draw} sparkProgress={spark} paused={stopped} accessible={false} />
        </View>
        <MetchWordmark size={WORD} reveal={reveal} shimmer={shimmer} accessible={false} style={styles.word} />
        <Animated.Text style={[styles.tagline, taglineStyle]}>{BRAND.tagline}</Animated.Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.black },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: -24 },
  // o canvas do wordmark tem margem interna pro halo; puxa pra perto do monograma e da tagline
  word: { marginTop: -22 },
  tagline: {
    ...typography.bodyLarge,
    color: colors.white,
    opacity: 0.85,
    marginTop: -26,
  },
});
