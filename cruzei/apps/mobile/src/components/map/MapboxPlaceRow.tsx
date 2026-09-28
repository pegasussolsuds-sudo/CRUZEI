import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamily, radius, spacing, typography } from '@cruzei/ui-mobile';
import { formatApproxDistance } from '@cruzei/shared-utils';
import type { MapboxPlace } from '@cruzei/shared-types';
import { PressScale } from '../animated/PressScale';
import { placeKindMeta } from './placeKinds';

export interface MapboxPlaceRowProps {
  place: MapboxPlace;
  index: number;
  onPress: (place: MapboxPlace) => void;
  /** anima a entrada (só na abertura da busca; digitando, as linhas entram sem animação) */
  animate?: boolean;
}

/**
 * Linha de lugar da cidade (Mapbox Search Box): bar, balada, restaurante… Não tem "gente agora" (não é dado do app),
 * então o destaque é o tipo do lugar: noite ganha selo rosa. Tocar leva a câmera e crava o pino no mapa.
 */
export const MapboxPlaceRow = memo(function MapboxPlaceRow({ place, index, onPress, animate = true }: MapboxPlaceRowProps) {
  const reduceMotion = useReducedMotion();
  const meta = placeKindMeta(place.kind);
  const where = place.neighborhood ?? place.city;
  const a11y = [place.name, meta.label, place.address ?? where ?? '', `a ${formatApproxDistance(place.distanceM)}`, 'toque pra ver no mapa']
    .filter(Boolean)
    .join(', ');

  return (
    <Animated.View entering={reduceMotion || !animate ? undefined : FadeInDown.delay(Math.min(index, 8) * 40).duration(220)}>
      <PressScale onPress={() => onPress(place)} accessibilityRole="button" accessibilityLabel={a11y} style={styles.row}>
        <View style={[styles.tile, ...(place.nightlife ? [styles.tileNight] : [])]}>
          <Text style={styles.tileEmoji}>{meta.emoji}</Text>
        </View>
        <View style={styles.main}>
          <Text style={styles.name} numberOfLines={1}>
            {place.name}
          </Text>
          <View style={styles.metaRow}>
            <View style={[styles.kindPill, ...(place.nightlife ? [styles.kindPillNight] : [])]}>
              <Text style={[styles.kindText, ...(place.nightlife ? [styles.kindTextNight] : [])]}>{meta.label.toUpperCase()}</Text>
            </View>
            {where ? (
              <Text style={styles.meta} numberOfLines={1}>
                {where}
              </Text>
            ) : null}
          </View>
          {place.address ? (
            <Text style={styles.sub} numberOfLines={1}>
              {place.address}
            </Text>
          ) : null}
        </View>
        <View style={styles.right}>
          <Text style={styles.dist}>{formatApproxDistance(place.distanceM)}</Text>
          <Ionicons name="location" size={14} color={place.nightlife ? colors.secondary : colors.gray[500]} />
        </View>
      </PressScale>
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
  tile: {
    width: 52,
    height: 52,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(250,250,250,0.08)',
    backgroundColor: 'rgba(250,250,250,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileNight: { borderColor: 'rgba(255,20,147,0.45)', backgroundColor: 'rgba(255,20,147,0.12)' },
  tileEmoji: { fontSize: 24 },
  main: { flex: 1, minWidth: 0, gap: 3 },
  name: { ...typography.h4, color: colors.white },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  kindPill: { paddingHorizontal: spacing.sm, height: 18, borderRadius: radius.full, backgroundColor: 'rgba(250,250,250,0.12)', justifyContent: 'center' },
  kindPillNight: { backgroundColor: 'rgba(255,20,147,0.22)' },
  kindText: { fontFamily: fontFamily.bodyBold, fontSize: 9, color: colors.gray[200], letterSpacing: 0.6 },
  kindTextNight: { color: '#FF7AC3' },
  meta: { ...typography.bodySmall, color: colors.gray[300], flexShrink: 1 },
  sub: { ...typography.caption, color: colors.gray[500] },
  right: { alignItems: 'flex-end', gap: 4, minWidth: 56 },
  dist: { fontFamily: fontFamily.display, fontSize: 14, color: colors.gray[300] },
});
