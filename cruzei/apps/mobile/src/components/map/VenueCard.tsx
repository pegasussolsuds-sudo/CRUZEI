import React, { memo, useCallback } from 'react';
import { Linking, Platform, Share, StyleSheet, Text, View } from 'react-native';
import Animated, { SlideInDown, useReducedMotion } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamily, radius, spacing, typography } from '@cruzei/ui-mobile';
import { distanceMeters, formatApproxDistance } from '@cruzei/shared-utils';
import type { MapboxPlace } from '@cruzei/shared-types';
import { ScaleOnPress } from '../animated/ScaleOnPress';
import { PressScale } from '../animated/PressScale';
import { placeKindMeta } from './placeKinds';

export interface VenueCardProps {
  place: MapboxPlace;
  /** minha posição, pra "a X de você" */
  me: { lat: number; lng: number } | null;
  onClose: () => void;
}

/** abre o app de navegação do aparelho (o usuário escolhe qual) no lugar */
async function openDirections(place: MapboxPlace): Promise<void> {
  const { latitude: lat, longitude: lng, name } = place;
  const label = encodeURIComponent(name);
  const native = Platform.select({
    ios: `maps:0,0?q=${label}@${lat},${lng}`,
    default: `geo:${lat},${lng}?q=${lat},${lng}(${label})`,
  });
  try {
    await Linking.openURL(native);
  } catch {
    await Linking.openURL(`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`).catch(() => {});
  }
}

/**
 * Card do lugar da cidade escolhido na busca (o pino já está no mapa): tipo, endereço, distância,
 * "Como chegar" e "Mandar" pra chamar alguém. Fechar tira o pino.
 */
export const VenueCard = memo(function VenueCard({ place, me, onClose }: VenueCardProps) {
  const reduceMotion = useReducedMotion();
  const meta = placeKindMeta(place.kind);
  const dist = me ? distanceMeters(me.lat, me.lng, place.latitude, place.longitude) : null;
  const where = [meta.label, place.neighborhood ?? place.city].filter(Boolean).join(' · ');

  const go = useCallback(() => {
    openDirections(place).catch(() => {});
  }, [place]);
  const share = useCallback(() => {
    const line = [place.name, place.address].filter(Boolean).join(' — ');
    Share.share({ message: `Bora? ${line}` }).catch(() => {});
  }, [place]);

  return (
    <Animated.View
      entering={reduceMotion ? undefined : SlideInDown.duration(260)}
      style={[styles.card, ...(place.nightlife ? [styles.cardNight] : [])]}
      accessibilityLiveRegion="polite"
    >
      <View style={styles.top}>
        <View style={[styles.tile, ...(place.nightlife ? [styles.tileNight] : [])]}>
          <Text style={styles.tileEmoji}>{meta.emoji}</Text>
        </View>
        <View style={styles.main}>
          <Text style={styles.name} numberOfLines={1} accessibilityRole="header">
            {place.name}
          </Text>
          <Text style={[styles.where, ...(place.nightlife ? [styles.whereNight] : [])]} numberOfLines={1}>
            {where}
          </Text>
          {place.address ? (
            <Text style={styles.address} numberOfLines={1}>
              {place.address}
            </Text>
          ) : null}
        </View>
        <PressScale onPress={onClose} haptic={false} accessibilityRole="button" accessibilityLabel="Tirar o lugar do mapa" style={styles.close} hitSlop={8}>
          <Ionicons name="close" size={18} color={colors.gray[300]} />
        </PressScale>
      </View>

      <View style={styles.actions}>
        {dist != null ? (
          <View style={styles.distBox} accessibilityLabel={`a ${formatApproxDistance(dist)} de você`}>
            <Ionicons name="walk-outline" size={16} color={colors.gray[300]} />
            <Text style={styles.distText}>{formatApproxDistance(dist)}</Text>
          </View>
        ) : null}
        <ScaleOnPress onPress={share} accessibilityRole="button" accessibilityLabel={`Mandar ${place.name} pra alguém`} style={styles.ghostBtn}>
          <Ionicons name="paper-plane-outline" size={16} color={colors.white} />
          <Text style={styles.ghostText}>Mandar</Text>
        </ScaleOnPress>
        <ScaleOnPress onPress={go} accessibilityRole="button" accessibilityLabel={`Como chegar em ${place.name}`} style={[styles.goBtn, ...(place.nightlife ? [styles.goBtnNight] : [])]}>
          <Ionicons name="navigate" size={16} color={place.nightlife ? colors.white : colors.black} />
          <Text style={[styles.goText, ...(place.nightlife ? [styles.goTextNight] : [])]}>Como chegar</Text>
        </ScaleOnPress>
      </View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.lg,
    padding: spacing.md,
    gap: spacing.md,
    borderRadius: radius.xl,
    backgroundColor: '#0E0E22',
    borderWidth: 1,
    borderColor: 'rgba(127,255,0,0.35)',
  },
  cardNight: { borderColor: 'rgba(255,20,147,0.5)' },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  tile: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: 'rgba(127,255,0,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(127,255,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileNight: { backgroundColor: 'rgba(255,20,147,0.14)', borderColor: 'rgba(255,20,147,0.5)' },
  tileEmoji: { fontSize: 24 },
  main: { flex: 1, minWidth: 0, gap: 2 },
  name: { ...typography.h4, color: colors.white },
  where: { fontFamily: fontFamily.bodyBold, fontSize: 12, color: colors.primary, textTransform: 'uppercase', letterSpacing: 0.6 },
  whereNight: { color: '#FF7AC3' },
  address: { ...typography.caption, color: colors.gray[400] },
  close: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(250,250,250,0.08)', alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  distBox: { flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 'auto' },
  distText: { fontFamily: fontFamily.display, fontSize: 14, color: colors.gray[200] },
  ghostBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: 'rgba(250,250,250,0.1)',
  },
  ghostText: { ...typography.label, color: colors.white },
  goBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: spacing.lg, borderRadius: radius.full, backgroundColor: colors.primary },
  goBtnNight: { backgroundColor: colors.secondary },
  goText: { ...typography.label, color: colors.black },
  goTextNight: { color: colors.white },
});
