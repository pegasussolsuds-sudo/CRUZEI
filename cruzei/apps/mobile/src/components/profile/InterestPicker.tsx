import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';

import { colors, radius, spacing, spring, typography } from '@cruzei/ui-mobile';
import { FadeInView, ScaleOnPress } from '../animated';
import { interestEmoji, toggleInterest, type CatalogItem } from './interests';

interface InterestPickerProps {
  items: readonly CatalogItem[] | undefined;
  selected: readonly string[];
  onChange: (next: string[]) => void;
  max: number;
  loading?: boolean;
  /** catálogo não veio: mostra "tentar de novo" (a etapa continua pulável) */
  error?: boolean;
  onRetry?: () => void;
}

/**
 * Chips de interesse no fundo escuro do cadastro: emoji + nome, quebram em várias linhas (cabem 360 dp), marcar anima
 * a cor e dá um "pulo"; no teto o chip treme e vibra de aviso. Contador "3/10" no topo.
 */
export function InterestPicker({ items, selected, onChange, max, loading, error, onRetry }: InterestPickerProps) {
  const toggle = (name: string) => {
    const r = toggleInterest(selected, name, max);
    if (r.full) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      return false;
    }
    Haptics.selectionAsync().catch(() => {});
    onChange(r.list);
    return true;
  };

  if (loading) {
    return (
      <View style={styles.state}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (error || !items) {
    return (
      <View style={styles.state}>
        <Text style={styles.stateText}>Não deu pra carregar os interesses agora.</Text>
        {onRetry ? (
          <ScaleOnPress onPress={onRetry} style={styles.retry} accessibilityRole="button" accessibilityLabel="Tentar carregar de novo">
            <Ionicons name="refresh" size={16} color={colors.black} />
            <Text style={styles.retryText}>Tentar de novo</Text>
          </ScaleOnPress>
        ) : null}
      </View>
    );
  }

  const full = selected.length >= max;
  return (
    <View>
      <View style={styles.counterRow} accessibilityLiveRegion="polite">
        <Text style={[styles.counter, full && styles.counterFull]}>
          {selected.length}/{max}
        </Text>
        <Text style={styles.counterHint}>{full ? 'Deu o máximo: tira um pra pôr outro' : selected.length ? 'boa escolha 👌' : 'toca pra marcar'}</Text>
      </View>
      <View style={styles.wrap}>
        {items.map((it, i) => (
          // entrada em cascata curta (teto de 300 ms pra lista não "demorar" a aparecer)
          <FadeInView key={it.id} delay={Math.min(300, 30 + i * 18)} fromY={8} fromScale={0.94}>
            <InterestChip
              label={it.name}
              emoji={interestEmoji(it.icon)}
              selected={selected.includes(it.name)}
              dimmed={full && !selected.includes(it.name)}
              onPress={() => toggle(it.name)}
            />
          </FadeInView>
        ))}
      </View>
    </View>
  );
}

function InterestChip({
  label,
  emoji,
  selected,
  dimmed,
  onPress,
}: {
  label: string;
  emoji: string;
  selected: boolean;
  dimmed: boolean;
  /** false = não marcou (teto) */
  onPress: () => boolean;
}) {
  const sel = useSharedValue(selected ? 1 : 0);
  const pop = useSharedValue(1);
  const shake = useSharedValue(0);

  useEffect(() => {
    sel.value = withSpring(selected ? 1 : 0, spring.snappy);
  }, [sel, selected]);

  const box = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(sel.value, [0, 1], ['rgba(250,250,250,0.06)', colors.primary]),
    borderColor: interpolateColor(sel.value, [0, 1], ['rgba(250,250,250,0.18)', colors.primary]),
    transform: [{ scale: pop.value }, { translateX: shake.value }],
  }));
  const text = useAnimatedStyle(() => ({
    color: interpolateColor(sel.value, [0, 1], [colors.white, colors.black]),
  }));

  const press = () => {
    const ok = onPress();
    if (ok) {
      pop.value = withSequence(withTiming(0.92, { duration: 70 }), withSpring(1, spring.bouncy));
    } else {
      shake.value = withSequence(
        withTiming(-5, { duration: 40 }),
        withTiming(5, { duration: 40 }),
        withTiming(-3, { duration: 40 }),
        withTiming(0, { duration: 40 }),
      );
    }
  };

  return (
    <ScaleOnPress
      onPress={press}
      haptic={false}
      pressedScale={0.95}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected, disabled: dimmed }}
    >
      <Animated.View style={[styles.chip, dimmed && styles.chipDimmed, box]}>
        <Text style={styles.chipEmoji}>{emoji}</Text>
        <Animated.Text style={[styles.chipText, text]} numberOfLines={1}>
          {label}
        </Animated.Text>
      </Animated.View>
    </ScaleOnPress>
  );
}

const styles = StyleSheet.create({
  state: { alignItems: 'flex-start', gap: spacing.md, paddingVertical: spacing.lg },
  stateText: { ...typography.body, color: 'rgba(250,250,250,0.7)' },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
  },
  retryText: { ...typography.label, color: colors.black },

  counterRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, marginBottom: spacing.md },
  counter: { ...typography.mono, color: colors.primary },
  counterFull: { color: colors.warning },
  counterHint: { ...typography.caption, color: 'rgba(250,250,250,0.55)', flex: 1 },

  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  chipDimmed: { opacity: 0.45 },
  chipEmoji: { fontSize: 16 },
  chipText: { ...typography.label },
});
