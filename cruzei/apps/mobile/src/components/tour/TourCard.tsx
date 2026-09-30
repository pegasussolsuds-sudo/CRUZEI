import React, { useEffect } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, FadeInDown, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamily, radius, shadows, spacing, typography } from '@cruzei/ui-mobile';
import { ScaleOnPress } from '../animated/ScaleOnPress';

export const CARD_BG = '#14142C';
const DOT = 6;
const DOT_ACTIVE = 20;

export interface TourCardProps {
  index: number;
  total: number;
  title: string;
  body: string;
  reduceMotion: boolean;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

/**
 * Cartão do passo: bolinhas de progresso + Pular em cima, título e texto, Voltar e Próximo/Começar embaixo.
 * Os botões não remontam entre passos (o foco do leitor de tela fica no Próximo); a cada troca o leitor ouve
 * "Passo X de N" + o passo inteiro, e só o bloco de texto entra animado.
 */
export function TourCard({ index, total, title, body, reduceMotion, onNext, onBack, onSkip }: TourCardProps) {
  const isLast = index === total - 1;

  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(`Passo ${index + 1} de ${total}. ${title}. ${body}`);
  }, [index, total, title, body]);

  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <View style={styles.dots} accessible accessibilityLabel={`Passo ${index + 1} de ${total}`}>
          {Array.from({ length: total }, (_, i) => (
            <Dot key={i} state={i === index ? 'active' : i < index ? 'done' : 'todo'} reduceMotion={reduceMotion} />
          ))}
        </View>
        {!isLast ? (
          <Pressable onPress={onSkip} hitSlop={12} style={styles.skip} accessibilityRole="button" accessibilityLabel="Pular o tour">
            <Text style={styles.skipText}>Pular</Text>
          </Pressable>
        ) : null}
      </View>

      {/* key = passo: o texto novo entra de baixo (sem movimento: troca seca) */}
      <Animated.View key={index} entering={reduceMotion ? undefined : FadeInDown.duration(260)}>
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        <Text style={styles.body}>{body}</Text>
      </Animated.View>

      <View style={styles.actions}>
        {index > 0 ? (
          <Pressable onPress={onBack} hitSlop={8} style={styles.back} accessibilityRole="button" accessibilityLabel="Voltar um passo">
            <Ionicons name="chevron-back" size={20} color={colors.white} />
          </Pressable>
        ) : (
          <View />
        )}
        <ScaleOnPress
          onPress={onNext}
          style={styles.next}
          glowColor={colors.primary}
          accessibilityRole="button"
          accessibilityLabel={isLast ? 'Começar a usar o mapa' : 'Próximo passo'}
        >
          <Text style={styles.nextText}>{isLast ? 'Começar' : 'Próximo'}</Text>
          <Ionicons name={isLast ? 'sparkles' : 'arrow-forward'} size={16} color={colors.black} />
        </ScaleOnPress>
      </View>
    </View>
  );
}

/** bolinha: a do passo atual estica numa pílula lima; as já vistas ficam lima apagado */
function Dot({ state, reduceMotion }: { state: 'active' | 'done' | 'todo'; reduceMotion: boolean }) {
  const on = useSharedValue(state === 'active' ? 1 : 0);
  useEffect(() => {
    const target = state === 'active' ? 1 : 0;
    on.value = reduceMotion ? target : withTiming(target, { duration: 260, easing: Easing.out(Easing.cubic) });
  }, [state, reduceMotion, on]);
  const style = useAnimatedStyle(() => ({ width: DOT + (DOT_ACTIVE - DOT) * on.value }));
  return <Animated.View style={[styles.dot, state === 'todo' ? styles.dotTodo : styles.dotOn, state === 'done' && styles.dotDone, style]} />;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: CARD_BG,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: 'rgba(127,255,0,0.22)',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    ...shadows.strong,
  },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 32, marginBottom: spacing.sm },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: spacing.xs },
  dot: { height: DOT, borderRadius: DOT / 2 },
  dotOn: { backgroundColor: colors.primary },
  dotDone: { opacity: 0.45 },
  dotTodo: { backgroundColor: 'rgba(250,250,250,0.22)' },
  skip: { minHeight: 32, paddingHorizontal: spacing.sm, justifyContent: 'center' },
  skipText: { ...typography.label, color: colors.gray[400] },
  title: { ...typography.h3, color: colors.white },
  body: { ...typography.body, fontSize: 15, lineHeight: 22, color: colors.gray[300], marginTop: spacing.xs },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.lg },
  back: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(250,250,250,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  next: {
    minHeight: 46,
    minWidth: 132,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  nextText: { fontFamily: fontFamily.bodyBold, fontSize: 15, color: colors.black },
});
