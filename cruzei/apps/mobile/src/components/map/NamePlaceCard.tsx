import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fontFamily, radius, spacing, typography } from '@cruzei/ui-mobile';
import type { PlacePrompt } from '@cruzei/shared-types';
import { PressScale } from '../animated/PressScale';
import { placeKindMeta } from './placeKinds';

export type PlacePromptAnswer = { kind: 'confirm'; candidateId: string; name: string } | { kind: 'deny' } | { kind: 'dismiss' };

export interface NamePlaceCardProps {
  prompt: PlacePrompt;
  onAnswer: (a: PlacePromptAnswer) => void;
}

/**
 * "✨ Tá rolando algo aqui?": aparece pra quem está parado há alguns minutos perto de um lugar que a galera pediu (ou
 * onde a multidão se divide entre dois lugares). Um toque confirma qual é; "não é lugar público" ajuda a não publicar
 * casa/escritório. Sem Reanimated (card simples no meio do mapa com multidão).
 */
export const NamePlaceCard = memo(function NamePlaceCard({ prompt, onAnswer }: NamePlaceCardProps) {
  return (
    <View style={styles.card} accessibilityLiveRegion="polite">
      <Text style={styles.title} accessibilityRole="header">
        ✨ Tá rolando algo aqui?
      </Text>
      <Text style={styles.text}>Esse ponto tá movimentado. Ajuda a galera: qual é o lugar?</Text>
      <View style={styles.options}>
        {prompt.options.map((o) => (
          <PressScale
            key={o.candidateId}
            onPress={() => onAnswer({ kind: 'confirm', candidateId: o.candidateId, name: o.name })}
            accessibilityRole="button"
            accessibilityLabel={`É o ${o.name}`}
            style={styles.option}
          >
            <Text style={styles.optionEmoji}>{placeKindMeta(o.kind).emoji}</Text>
            <Text style={styles.optionText} numberOfLines={1}>
              É o {o.name}?
            </Text>
          </PressScale>
        ))}
      </View>
      <View style={styles.footer}>
        <PressScale onPress={() => onAnswer({ kind: 'deny' })} haptic={false} accessibilityRole="button" accessibilityLabel="Aqui não é lugar público" hitSlop={6}>
          <Text style={styles.link}>Aqui não é lugar público</Text>
        </PressScale>
        <PressScale onPress={() => onAnswer({ kind: 'dismiss' })} haptic={false} accessibilityRole="button" accessibilityLabel="Agora não" hitSlop={6}>
          <Text style={[styles.link, styles.linkMuted]}>Agora não</Text>
        </PressScale>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.lg,
    padding: spacing.md,
    gap: spacing.sm,
    borderRadius: radius.xl,
    backgroundColor: '#0E0E22',
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.55)',
  },
  title: { ...typography.h4, color: colors.white },
  text: { ...typography.bodySmall, color: colors.gray[300] },
  options: { gap: spacing.sm, marginTop: 2 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: 'rgba(127,255,0,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(127,255,0,0.45)',
  },
  optionEmoji: { fontSize: 18 },
  optionText: { flex: 1, fontFamily: fontFamily.bodyBold, fontSize: 15, color: colors.primary },
  footer: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  link: { fontFamily: fontFamily.bodyBold, fontSize: 13, color: colors.gray[300], paddingVertical: 6 },
  linkMuted: { color: colors.gray[500] },
});
