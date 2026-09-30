import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type AccessibilityActionEvent, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { AGE_MAX, AGE_MIN, AGE_SLIDER_MAX } from '@cruzei/shared-types';
import { ageToSlider, isAgeRangeOpen, sliderToAgeMax } from '@cruzei/shared-utils';
import { colors, radius, spacing, spring, typography } from '@cruzei/ui-mobile';
import {
  ageToProgress,
  maxThumbLimit,
  minThumbLimit,
  pickThumb,
  progressToAge,
  sliderLabel,
  withAgeGap,
} from './ageSlider';

const THUMB = 28;
const HIT = 48;
const TRACK_H = 6;

interface AgeRangeSliderProps {
  /** o que está gravado (AGE_MIN..AGE_MAX; 99 = sem limite em cima) */
  min: number;
  max: number;
  /** soltou o dedo (ou ação de acessibilidade): já no formato de gravar (o topo "80+" vira 99) */
  onChange: (min: number, max: number) => void;
  disabled?: boolean;
}

/**
 * Faixa "de X a Y anos" com dois polegares (gesture-handler + Reanimated, 60 fps na UI thread). O arrasto só pega na
 * horizontal (a rolagem da tela continua funcionando); cada ano vibra de leve; soltou → onChange uma vez. Topo = "80+"
 * (sem limite). Os polegares ficam a pelo menos AGE_RANGE_MIN_GAP anos (a mesma regra do servidor). Leitor de tela:
 * cada polegar é "ajustável" (sobe/desce 1 ano).
 */
export function AgeRangeSlider({ min, max, onChange, disabled }: AgeRangeSliderProps) {
  const reduceMotion = useReducedMotion();
  const [w, setW] = useState(0);
  const usable = Math.max(1, w - THUMB);

  // idades do slider (18..80) enquanto arrasta: só o texto e a vibração passam pelo JS
  const [draft, setDraft] = useState<[number, number]>([ageToSlider(min), ageToSlider(max)]);
  const pMin = useSharedValue(ageToProgress(min));
  const pMax = useSharedValue(ageToProgress(max));
  const active = useSharedValue<0 | 1 | 2 | 3>(0); // 0 nenhum · 1 "de" · 2 "até" · 3 empate (o 1º movimento decide)
  // arrasto começou de verdade (rolar a tela por cima do slider não "pega" o polegar)
  const grabbed = useSharedValue(0);
  const lastMin = useSharedValue(ageToSlider(min));
  const lastMax = useSharedValue(ageToSlider(max));
  const startP = useSharedValue(0);

  // valor gravado mudou por fora (servidor, reset, outro aparelho): acompanha se ninguém está arrastando
  useEffect(() => {
    if (active.value !== 0) return;
    const a = ageToProgress(min);
    const b = ageToProgress(max);
    pMin.value = reduceMotion ? a : withSpring(a, spring.snappy);
    pMax.value = reduceMotion ? b : withSpring(b, spring.snappy);
    lastMin.value = ageToSlider(min);
    lastMax.value = ageToSlider(max);
    setDraft([ageToSlider(min), ageToSlider(max)]);
  }, [active, lastMax, lastMin, max, min, pMax, pMin, reduceMotion]);

  const tick = useCallback((a: number, b: number) => {
    setDraft([a, b]);
    Haptics.selectionAsync().catch(() => {});
  }, []);

  const commit = useCallback(
    (a: number, b: number) => {
      setDraft([a, b]);
      const nextMax = sliderToAgeMax(b);
      if (a !== min || nextMax !== max) onChange(a, nextMax);
    },
    [max, min, onChange],
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!disabled)
        // só arrasto horizontal: na vertical quem ganha é a rolagem da tela
        .activeOffsetX([-6, 6])
        .failOffsetY([-14, 14])
        .onBegin((e) => {
          const minX = THUMB / 2 + pMin.value * usable;
          const maxX = THUMB / 2 + pMax.value * usable;
          const t = pickThumb(e.x, minX, maxX);
          active.value = t === 'min' ? 1 : t === 'max' ? 2 : 3;
          startP.value = t === 'max' ? pMax.value : pMin.value;
        })
        .onStart(() => {
          grabbed.value = reduceMotion ? 1 : withSpring(1, spring.snappy);
        })
        .onUpdate((e) => {
          if (active.value === 3) {
            // empate: pra esquerda mexe o "de", pra direita o "até" (no topo só o "de" consegue sair)
            active.value = e.translationX < 0 || pMax.value >= 1 ? 1 : 2;
          }
          const p = startP.value + e.translationX / usable;
          // vão mínimo de 4 anos entre os polegares (com o "até" no "80+" o "de" vai até o topo)
          if (active.value === 1) pMin.value = Math.min(minThumbLimit(pMax.value), Math.max(0, p));
          else if (active.value === 2) pMax.value = Math.max(maxThumbLimit(pMin.value), Math.min(1, p));
          const a = progressToAge(pMin.value);
          const b = progressToAge(pMax.value);
          if (a !== lastMin.value || b !== lastMax.value) {
            lastMin.value = a;
            lastMax.value = b;
            runOnJS(tick)(a, b);
          }
        })
        .onFinalize(() => {
          grabbed.value = reduceMotion ? 0 : withSpring(0, spring.snappy);
          if (active.value === 0) return;
          const moved = active.value === 2 ? 'max' : 'min';
          active.value = 0;
          // arredondou pro ano: confere o vão de novo (a mesma regra do servidor)
          const [a, b] = withAgeGap(progressToAge(pMin.value), progressToAge(pMax.value), moved);
          // encaixa no ano inteiro
          pMin.value = withTiming(ageToProgress(a), { duration: 120 });
          pMax.value = withTiming(ageToProgress(b), { duration: 120 });
          runOnJS(commit)(a, b);
        }),
    [active, commit, disabled, grabbed, lastMax, lastMin, pMax, pMin, reduceMotion, startP, tick, usable],
  );

  const fillStyle = useAnimatedStyle(() => ({
    left: THUMB / 2 + pMin.value * usable,
    width: Math.max(0, (pMax.value - pMin.value) * usable),
  }));
  const minThumb = useAnimatedStyle(() => ({
    transform: [{ translateX: pMin.value * usable }, { scale: 1 + (active.value === 1 ? 0.15 * grabbed.value : 0) }],
  }));
  const maxThumb = useAnimatedStyle(() => ({
    transform: [{ translateX: pMax.value * usable }, { scale: 1 + (active.value === 2 ? 0.15 * grabbed.value : 0) }],
  }));

  const [dMin, dMax] = draft;
  const nudge = (which: 'min' | 'max') => (e: AccessibilityActionEvent) => {
    const delta = e.nativeEvent.actionName === 'increment' ? 1 : e.nativeEvent.actionName === 'decrement' ? -1 : 0;
    if (!delta) return;
    // vão de 4 anos: o polegar para no limite em vez de encostar no outro
    if (which === 'min') commit(...withAgeGap(Math.min(AGE_SLIDER_MAX, Math.max(AGE_MIN, dMin + delta)), dMax, 'min'));
    else commit(...withAgeGap(dMin, Math.max(AGE_MIN, Math.min(AGE_SLIDER_MAX, dMax + delta)), 'max'));
  };

  return (
    <View style={disabled ? styles.disabled : null}>
      <View style={styles.head}>
        <Text style={styles.value} accessibilityLiveRegion="polite">
          {sliderLabel(dMin, dMax)}
        </Text>
        {!isAgeRangeOpen(min, max) ? (
          <Pressable
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              onChange(AGE_MIN, AGE_MAX);
            }}
            hitSlop={8}
            style={({ pressed }) => [styles.reset, pressed && { opacity: 0.6 }]}
            accessibilityRole="button"
            accessibilityLabel="Qualquer idade: tirar o filtro"
          >
            <Text style={styles.resetText}>Qualquer idade</Text>
          </Pressable>
        ) : null}
      </View>

      <GestureDetector gesture={pan}>
        <View style={styles.hit} onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}>
          <View style={styles.track} />
          <Animated.View style={[styles.fill, fillStyle]} />
          <Animated.View
            style={[styles.thumbWrap, minThumb]}
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel="Idade mínima"
            accessibilityValue={{ text: `${dMin} anos` }}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={nudge('min')}
          >
            <View style={styles.thumb} />
          </Animated.View>
          <Animated.View
            style={[styles.thumbWrap, maxThumb]}
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel="Idade máxima"
            accessibilityValue={{ text: dMax >= AGE_SLIDER_MAX ? `${AGE_SLIDER_MAX} ou mais` : `${dMax} anos` }}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={nudge('max')}
          >
            <View style={styles.thumb} />
          </Animated.View>
        </View>
      </GestureDetector>

      <View style={styles.ends} importantForAccessibility="no-hide-descendants">
        <Text style={styles.end}>{AGE_MIN}</Text>
        <Text style={styles.end}>{AGE_SLIDER_MAX}+</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  disabled: { opacity: 0.5 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, minHeight: 32 },
  value: { ...typography.label, color: colors.black },
  reset: {
    paddingHorizontal: spacing.md,
    minHeight: 32,
    borderRadius: radius.full,
    justifyContent: 'center',
    backgroundColor: colors.surfaceAlt,
  },
  resetText: { ...typography.caption, color: colors.black },
  hit: { height: HIT, justifyContent: 'center', marginTop: spacing.xs },
  track: {
    position: 'absolute',
    left: THUMB / 2,
    right: THUMB / 2,
    height: TRACK_H,
    borderRadius: radius.full,
    backgroundColor: colors.gray[200],
  },
  fill: { position: 'absolute', height: TRACK_H, borderRadius: radius.full, backgroundColor: colors.primary },
  thumbWrap: { position: 'absolute', left: 0, top: (HIT - THUMB) / 2, width: THUMB, height: THUMB },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: colors.white,
    borderWidth: 3,
    borderColor: colors.primary,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 3,
  },
  ends: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 2 },
  end: { ...typography.caption, color: colors.gray[400] },
});
