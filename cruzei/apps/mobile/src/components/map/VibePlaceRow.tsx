import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { colors, fontFamily, radius, spacing, typography } from '@cruzei/ui-mobile';
import { formatApproxDistance } from '@cruzei/shared-utils';
import type { VibeLevel, VibePlace } from '@cruzei/shared-types';
import { Pulse } from '../animated/Pulse';
import { ScaleOnPress } from '../animated/ScaleOnPress';
import { CATEGORY_LABEL } from './PlacePreviewSheet';

export interface VibePlaceRowProps {
  place: VibePlace;
  index: number;
  onPress: (place: VibePlace) => void;
}

const LEVEL_TEXT: Record<VibeLevel, string> = {
  quiet: 'quieto',
  warming: 'esquentando',
  hot: 'em alta',
  peak: 'bombando',
};

const LEVEL_TILE: Record<VibeLevel, { bg: string; border: string }> = {
  quiet: { bg: 'rgba(250,250,250,0.06)', border: 'rgba(250,250,250,0.08)' },
  warming: { bg: 'rgba(127,255,0,0.14)', border: 'rgba(127,255,0,0.35)' },
  hot: { bg: 'rgba(255,20,147,0.18)', border: 'rgba(255,20,147,0.55)' },
  peak: { bg: 'rgba(255,20,147,0.3)', border: colors.secondary },
};

/** medidor de 5 barras: lima nas primeiras, magenta nas últimas (a vibe "esquenta" pra direita) */
function VibeMeter({ score, level }: { score: number; level: VibeLevel }) {
  const filled = Math.max(level === 'quiet' ? 0 : 1, Math.round(score / 20));
  return (
    <View style={styles.meter} accessible={false}>
      {[0, 1, 2, 3, 4].map((i) => {
        const on = i < filled;
        const color = i < 3 ? colors.primary : colors.secondary;
        return <View key={i} style={[styles.meterBar, { height: 6 + i * 2.5, backgroundColor: on ? color : 'rgba(250,250,250,0.12)' }]} />;
      })}
    </View>
  );
}

// faixa (nunca minutos): o servidor não entrega horário de ninguém
const ACTIVE_TEXT: Record<NonNullable<VibePlace['lastActive']>, string> = {
  online: 'ativo agora',
  recent: 'ativo há pouco',
  earlier: 'esteve por aqui',
};
function activeText(band: VibePlace['lastActive']): string | null {
  return band ? ACTIVE_TEXT[band] : null;
}

/**
 * Linha de lugar no overlay "Onde tá a vibe": tile com a categoria (acende conforme o nível), nome,
 * bairro/categoria, distância e atividade; à direita, gente agora, tendência e o medidor de vibe.
 */
export const VibePlaceRow = memo(function VibePlaceRow({ place, index, onPress }: VibePlaceRowProps) {
  const reduceMotion = useReducedMotion();
  const cat = CATEGORY_LABEL[place.category] ?? CATEGORY_LABEL.other;
  const tile = LEVEL_TILE[place.vibeLevel];
  const hot = place.vibeLevel === 'hot' || place.vibeLevel === 'peak';
  const meta = [cat.label, place.neighborhood].filter(Boolean).join(' · ');
  const active = activeText(place.lastActive);
  const sub = [formatApproxDistance(place.distanceM), active].filter(Boolean).join(' · ');
  const trendText = place.peopleNow > 0 ? (place.trend > 0 ? `▲ +${place.trend}` : place.trend < 0 ? `▼ ${Math.abs(place.trend)}` : '= estável') : null;
  const a11y = [
    place.name,
    place.isEvent ? `evento ${place.eventLabel ?? ''}` : cat.label,
    place.peopleNow > 0 ? `${place.peopleNow} pessoas agora, ${LEVEL_TEXT[place.vibeLevel]}` : 'sem gente do app agora',
    `a ${formatApproxDistance(place.distanceM)}`,
  ].join(', ');

  const tileEl = (
    <View style={[styles.tile, { backgroundColor: tile.bg, borderColor: tile.border }, ...(place.vibeLevel === 'peak' ? [styles.tilePeak] : [])]}>
      <Text style={styles.tileEmoji}>{place.isEvent ? '⚡' : cat.emoji}</Text>
    </View>
  );

  return (
    // entrada em cascata por layout animation (o FadeInView ficava invisível dentro da FlatList neste device)
    <Animated.View entering={reduceMotion ? undefined : FadeInDown.delay(Math.min(index, 8) * 40).duration(240)}>
      <ScaleOnPress onPress={() => onPress(place)} accessibilityRole="button" accessibilityLabel={a11y} style={[styles.row, ...(hot ? [styles.rowHot] : [])]}>
        {/* "bombando": pulso + sombra magenta (sem canvas Skia dentro da lista) */}
        {place.vibeLevel === 'peak' ? <Pulse maxScale={1.05} cycleMs={1400}>{tileEl}</Pulse> : tileEl}

        <View style={styles.main}>
          <View style={styles.titleRow}>
            <Text style={styles.name} numberOfLines={1}>
              {place.name}
            </Text>
            {place.isEvent ? (
              <View style={styles.eventPill}>
                <Text style={styles.eventPillText}>🎤 {place.eventLabel ?? 'Hoje'}</Text>
              </View>
            ) : null}
          </View>
          {meta ? (
            <Text style={styles.meta} numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
          <Text style={styles.sub} numberOfLines={1}>
            {sub}
          </Text>
        </View>

        <View style={styles.right}>
          {place.peopleNow > 0 ? (
            <>
              <Text style={[styles.count, hot && styles.countHot]}>👥 {place.peopleNow}</Text>
              <Text style={[styles.trend, place.trend > 0 && styles.trendUp, place.trend < 0 && styles.trendDown]}>{trendText}</Text>
            </>
          ) : (
            <Text style={styles.quiet}>{LEVEL_TEXT.quiet}</Text>
          )}
          <VibeMeter score={place.vibeScore} level={place.vibeLevel} />
        </View>
      </ScaleOnPress>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(250,250,250,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(250,250,250,0.06)',
  },
  rowHot: { backgroundColor: 'rgba(255,20,147,0.07)', borderColor: 'rgba(255,20,147,0.25)' },
  tile: { width: 52, height: 52, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  tilePeak: { shadowColor: colors.secondary, shadowOpacity: 0.9, shadowRadius: 12, shadowOffset: { width: 0, height: 0 }, elevation: 8 },
  tileEmoji: { fontSize: 24 },
  main: { flex: 1, minWidth: 0, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  name: { ...typography.h4, color: colors.white, flexShrink: 1 },
  eventPill: { paddingHorizontal: spacing.sm, height: 20, borderRadius: radius.full, backgroundColor: 'rgba(255,20,147,0.9)', justifyContent: 'center' },
  eventPillText: { fontFamily: fontFamily.bodyBold, fontSize: 10, color: colors.white, letterSpacing: 0.3 },
  meta: { ...typography.bodySmall, color: colors.gray[300] },
  sub: { ...typography.caption, color: colors.gray[500] },
  right: { alignItems: 'flex-end', gap: 3, minWidth: 64 },
  count: { fontFamily: fontFamily.display, fontSize: 16, color: colors.white },
  countHot: { color: colors.secondary },
  trend: { ...typography.caption, color: colors.gray[400] },
  trendUp: { color: colors.primary },
  trendDown: { color: colors.gray[500] },
  quiet: { ...typography.caption, color: colors.gray[500] },
  meter: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 16, marginTop: 2 },
  meterBar: { width: 5, borderRadius: 2 },
});
