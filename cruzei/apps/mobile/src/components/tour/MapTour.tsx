import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Spotlight, type SpotlightValues } from './Spotlight';
import { CARD_BG, TourCard } from './TourCard';
import { clampHole, holeFor, placeCard, type Hole } from './geometry';
import { measureTourTarget } from './targets';
import { REPLAY_WELCOME_TITLE, tourStep, type TourStepId } from './steps';

/** o recorte anda entre os alvos com esse tempo (ease-out forte: chega macio) */
const MOVE_MS = 560;
const MOVE_EASING = Easing.bezier(0.22, 1, 0.36, 1);
/** altura do cartão antes da 1ª medida */
const CARD_H_GUESS = 210;
const CARD_MAX_W = 420;
const CARET = 14;

export interface MapTourProps {
  visible: boolean;
  stepId: TourStepId;
  index: number;
  total: number;
  /** revendo pela Ajuda: o 1º passo não é "bem-vindo" */
  replay: boolean;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  /** passo "você no mapa": a câmera vai até mim */
  onFocusMe: () => void;
}

/**
 * Tour do mapa por cima de tudo (Modal: cobre as abas e isola o leitor de tela). Véu com recorte nos elementos reais
 * (medidos na janela), anel neon e cartão que acompanha o recorte. Sem movimento (acessibilidade): troca seca, sem
 * onda nem giro.
 */
export function MapTour({ visible, stepId, index, total, replay, onNext, onBack, onSkip, onFocusMe }: MapTourProps) {
  const reduceMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
  const [size, setSize] = useState({ w: win.width, h: win.height });
  const [hole, setHole] = useState<Hole | null>(null);
  const [cardH, setCardH] = useState(CARD_H_GUESS);
  const def = tourStep(stepId);
  const title = stepId === 'welcome' && replay ? REPLAY_WELCOME_TITLE : def.title;

  // ---------- recorte (UI thread) ----------
  const x = useSharedValue(win.width / 2);
  const y = useSharedValue(win.height * 0.46);
  const w = useSharedValue(0);
  const h = useSharedValue(0);
  const r = useSharedValue(0);
  const ring = useSharedValue(0);
  const pulse = useSharedValue(0);
  const spin = useSharedValue(0);
  const v: SpotlightValues = useMemo(() => ({ x, y, w, h, r, ring, pulse, spin }), [x, y, w, h, r, ring, pulse, spin]);

  // mede o alvo do passo (e leva a câmera até mim no passo "você no mapa")
  const focusMeRef = useRef(onFocusMe);
  focusMeRef.current = onFocusMe;
  useEffect(() => {
    if (!visible) return;
    const step = tourStep(stepId);
    let cancelled = false;
    if (step.focusMe) focusMeRef.current();
    const run = async () => {
      const rect = step.target ? await measureTourTarget(step.target) : null;
      if (cancelled) return;
      setHole(rect ? clampHole(holeFor(rect, step.shape, step.pad, step.radius), size.w, size.h) : null);
    };
    const id = setTimeout(() => void run(), step.measureDelayMs ?? 0);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [visible, stepId, size.w, size.h]);

  // fechou: o próximo tour nasce do meio da tela, sem recorte
  useEffect(() => {
    if (visible) return;
    setHole(null);
  }, [visible]);

  // o recorte anda até o alvo novo (sem alvo: fecha num ponto no meio, como uma íris)
  useEffect(() => {
    const t = hole ?? { x: size.w / 2, y: size.h * 0.46, width: 0, height: 0, r: 0 };
    const go = (sv: typeof x, to: number) => {
      sv.value = reduceMotion ? to : withTiming(to, { duration: MOVE_MS, easing: MOVE_EASING });
    };
    go(x, t.x);
    go(y, t.y);
    go(w, t.width);
    go(h, t.height);
    go(r, t.r);
    ring.value = reduceMotion ? (hole ? 1 : 0) : withTiming(hole ? 1 : 0, { duration: 320 });
  }, [hole, size.w, size.h, reduceMotion, x, y, w, h, r, ring]);

  // onda e giro do anel: só com movimento e com o tour na tela
  useEffect(() => {
    if (!visible || reduceMotion) {
      cancelAnimation(pulse);
      cancelAnimation(spin);
      pulse.value = 0;
      return;
    }
    pulse.value = 0;
    pulse.value = withRepeat(withTiming(1, { duration: 1800, easing: Easing.out(Easing.quad) }), -1, false);
    spin.value = 0;
    spin.value = withRepeat(withTiming(Math.PI * 2, { duration: 4200, easing: Easing.linear }), -1, false);
    return () => {
      cancelAnimation(pulse);
      cancelAnimation(spin);
    };
  }, [visible, reduceMotion, pulse, spin]);

  // ---------- cartão ----------
  const cardW = Math.min(size.w - 32, CARD_MAX_W);
  const cardLeft = Math.round((size.w - cardW) / 2);
  const place = placeCard({ hole, screenH: size.h, cardLeft, cardW, cardH, insets: { top: insets.top, bottom: insets.bottom } });
  const cardTop = useSharedValue(place.top);
  const caretX = useSharedValue(place.caretX);
  const placedOnce = useRef(false);
  useEffect(() => {
    if (!visible) {
      placedOnce.current = false;
      return;
    }
    const instant = reduceMotion || !placedOnce.current;
    placedOnce.current = true;
    cardTop.value = instant ? place.top : withTiming(place.top, { duration: MOVE_MS, easing: MOVE_EASING });
    caretX.value = instant ? place.caretX : withTiming(place.caretX, { duration: MOVE_MS, easing: MOVE_EASING });
  }, [visible, place.top, place.caretX, reduceMotion, cardTop, caretX]);
  const cardStyle = useAnimatedStyle(() => ({ transform: [{ translateY: cardTop.value }] }));
  const caretStyle = useAnimatedStyle(() => ({ transform: [{ translateX: caretX.value - CARET / 2 }, { rotate: '45deg' }] }));

  const onRootLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0 && (width !== size.w || height !== size.h)) setSize({ w: width, h: height });
  };
  const onCardLayout = (e: LayoutChangeEvent) => {
    const ch = Math.round(e.nativeEvent.layout.height);
    if (ch > 0 && Math.abs(ch - cardH) > 1) setCardH(ch);
  };

  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType={reduceMotion ? 'none' : 'fade'}
      // voltar do Android: passo anterior; no primeiro, pula
      onRequestClose={index > 0 ? onBack : onSkip}
    >
      <View style={styles.root} onLayout={onRootLayout} accessibilityViewIsModal>
        {/* o véu é só visual: o leitor de tela lê o cartão */}
        <View style={StyleSheet.absoluteFill} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Spotlight width={size.w} height={size.h} v={v} />
        </View>

        <Animated.View style={[styles.cardWrap, { left: cardLeft, width: cardW }, cardStyle]} onLayout={onCardLayout}>
          <TourCard
            index={index}
            total={total}
            title={title}
            body={def.body}
            reduceMotion={reduceMotion}
            onNext={onNext}
            onBack={onBack}
            onSkip={onSkip}
          />
          {place.caret ? (
            <Animated.View
              pointerEvents="none"
              style={[styles.caret, place.caret === 'up' ? styles.caretUp : styles.caretDown, caretStyle]}
              importantForAccessibility="no"
              accessibilityElementsHidden
            />
          ) : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  cardWrap: { position: 'absolute', top: 0 },
  caret: { position: 'absolute', left: 0, width: CARET, height: CARET, backgroundColor: CARD_BG, borderColor: 'rgba(127,255,0,0.22)' },
  // quadrado girado 45°: as bordas de cima+esquerda viram a ponta de cima; baixo+direita, a de baixo
  caretUp: { top: -CARET / 2, borderTopWidth: 1, borderLeftWidth: 1 },
  caretDown: { bottom: -CARET / 2, borderBottomWidth: 1, borderRightWidth: 1 },
});
