import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { colors, radius, shadows, spacing, typography, fontFamily, duration } from '@cruzei/ui-mobile';
import { api } from '../../services/api';
import { usePlaceName } from '../../hooks/usePlaceName';
import { FadeInView } from '../animated/FadeInView';
import { Pulse } from '../animated/Pulse';
import { ScaleOnPress } from '../animated/ScaleOnPress';

export interface ActiveBoost {
  id: string;
  startedAt: string;
  expiresAt: string;
  minutesRemaining: number;
}

/**
 * GET /boosts/active a cada 60s — null quando não há boost. Compartilhado entre header e MapScreen (mesma query).
 * `polling=false` pausa o intervalo (tela fora de foco / app em background — o app não liga focusManager ao AppState).
 */
export function useActiveBoost(enabled = true, polling = true) {
  return useQuery({
    queryKey: ['boosts', 'active'],
    enabled,
    refetchInterval: polling ? 60_000 : false,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await api.get<ActiveBoost | null | ''>('/boosts/active');
      return res.data ? res.data : null;
    },
  });
}

export interface MapHeaderProps {
  lat: number | null;
  lng: number | null;
  isAnonymous: boolean;
  togglePending: boolean;
  onToggleVisibility: () => void;
  onCenter: () => void;
  boostMinutes: number | null;
  /** indicadores discretos do universo (doc §16): lugares em alta, pessoas perto, novidades */
  indicators?: { hot: number; near: number; fresh: boolean } | null;
}

export function MapHeader({ lat, lng, isAnonymous, togglePending, onToggleVisibility, onCenter, boostMinutes, indicators }: MapHeaderProps) {
  const placeName = usePlaceName(lat, lng);

  // crossfade 200ms entre os dois estados do chip (design system: toggle = crossfade + slide curto)
  const anon = useSharedValue(isAnonymous ? 1 : 0);
  useEffect(() => {
    anon.value = withTiming(isAnonymous ? 1 : 0, { duration: duration.base, easing: Easing.out(Easing.cubic) });
  }, [isAnonymous, anon]);

  const visibleStyle = useAnimatedStyle(() => ({
    opacity: 1 - anon.value,
    transform: [{ translateX: -12 * anon.value }],
  }));
  const anonStyle = useAnimatedStyle(() => ({
    opacity: anon.value,
    transform: [{ translateX: 12 * (1 - anon.value) }],
  }));
  const chipBgStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(anon.value, [0, 1], [colors.overlayDark, colors.black]),
    borderColor: interpolateColor(anon.value, [0, 1], [colors.primary, colors.gray[600]]),
  }));

  return (
    <SafeAreaView style={styles.wrap} pointerEvents="box-none" edges={['top']}>
      <View style={styles.row} pointerEvents="box-none">
        {/* é o centro do MAPA (o usuário arrasta), não necessariamente onde ele está */}
        <View style={styles.place} accessibilityRole="header" accessibilityLabel={`Mostrando ${placeName}`}>
          <Ionicons name="location" size={16} color={colors.primary} />
          <Text style={styles.placeText} numberOfLines={1}>
            {placeName}
          </Text>
        </View>

        <ScaleOnPress
          onPress={onToggleVisibility}
          disabled={togglePending}
          accessibilityRole="switch"
          accessibilityState={{ checked: isAnonymous, disabled: togglePending }}
          accessibilityLabel={isAnonymous ? 'Modo anônimo ativo. Tocar pra ficar visível' : 'Modo visível ativo. Tocar pra ficar anônimo'}
          style={styles.toggle}
        >
          <Animated.View style={[styles.toggleInner, chipBgStyle]}>
            <Animated.View style={[styles.toggleFace, visibleStyle]}>
              <Ionicons name="eye" size={16} color={colors.primary} />
              <Text style={[styles.toggleText, { color: colors.primary }]}>Visível</Text>
            </Animated.View>
            <Animated.View style={[styles.toggleFace, styles.toggleFaceAbs, anonStyle]}>
              <Ionicons name="glasses" size={16} color={colors.gray[300]} />
              <Text style={[styles.toggleText, { color: colors.gray[300] }]}>Anônimo</Text>
              <Ionicons name="checkmark" size={14} color={colors.primary} />
            </Animated.View>
          </Animated.View>
        </ScaleOnPress>

        <ScaleOnPress onPress={onCenter} accessibilityRole="button" accessibilityLabel="Centralizar em mim" style={styles.fab} glowColor={colors.primary}>
          <Ionicons name="locate" size={20} color={colors.black} />
        </ScaleOnPress>
      </View>

      {indicators && (indicators.hot > 0 || indicators.near > 0 || indicators.fresh) ? (
        <FadeInView fromY={-6} style={styles.indicators} pointerEvents="none">
          {indicators.hot > 0 ? (
            <View style={[styles.indicator, styles.indicatorHot]} accessibilityLabel={`${indicators.hot} lugares em alta`}>
              <Text style={styles.indicatorText}>🔥 {indicators.hot} em alta</Text>
            </View>
          ) : null}
          {indicators.near > 0 ? (
            <View style={styles.indicator} accessibilityLabel={`${indicators.near} pessoas perto`}>
              <Text style={styles.indicatorText}>👥 {indicators.near} perto</Text>
            </View>
          ) : null}
          {indicators.fresh ? (
            <View style={styles.indicator} accessibilityLabel="Novidades por perto">
              <Text style={styles.indicatorText}>✨ novidades</Text>
            </View>
          ) : null}
        </FadeInView>
      ) : null}

      {boostMinutes != null ? (
        <FadeInView fromY={-8} style={styles.boostBar}>
          <Pulse active maxScale={1.06} style={styles.boostIconWrap}>
            <Text style={styles.boostIcon}>⚡</Text>
          </Pulse>
          <Text style={styles.boostText} accessibilityLabel={`Boost ativo, ${boostMinutes} minutos restantes`}>
            Boost ativo: {boostMinutes}min
          </Text>
        </FadeInView>
      ) : null}

      {isAnonymous ? (
        <FadeInView fromY={-8} style={styles.banner}>
          <View style={styles.bannerDot} />
          <Text style={styles.bannerText} numberOfLines={1}>
            Você está oculto do mapa
          </Text>
          <ScaleOnPress
            onPress={onToggleVisibility}
            disabled={togglePending}
            accessibilityRole="button"
            accessibilityLabel="Quero me revelar"
            style={styles.bannerBtn}
          >
            <Text style={styles.bannerBtnText}>Quero me revelar</Text>
          </ScaleOnPress>
        </FadeInView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, right: 0 },
  row: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  place: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    height: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.overlayDark,
  },
  placeText: { fontFamily: fontFamily.display, fontSize: 15, color: colors.white, flexShrink: 1 },
  toggle: { height: 44, borderRadius: radius.full, ...shadows.medium },
  toggleInner: { height: 44, minWidth: 116, paddingHorizontal: spacing.md, borderRadius: radius.full, borderWidth: 1, justifyContent: 'center' },
  toggleFace: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  toggleFaceAbs: { position: 'absolute', left: spacing.md, right: spacing.md },
  toggleText: { ...typography.label },
  fab: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', ...shadows.medium },
  indicators: { marginTop: spacing.xs, marginHorizontal: spacing.lg, flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' },
  indicator: { height: 26, paddingHorizontal: spacing.sm, borderRadius: radius.full, backgroundColor: colors.overlayDark, justifyContent: 'center' },
  indicatorHot: { backgroundColor: 'rgba(255,20,147,0.85)' },
  indicatorText: { ...typography.caption, color: colors.white },
  boostBar: {
    marginTop: spacing.sm,
    marginHorizontal: spacing.lg,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    ...shadows.light,
  },
  boostIconWrap: { alignItems: 'center', justifyContent: 'center' },
  boostIcon: { fontSize: 14 },
  boostText: { ...typography.mono, color: colors.black },
  banner: {
    marginTop: spacing.sm,
    marginHorizontal: spacing.lg,
    minHeight: 44,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.overlayDark,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  bannerDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.gray[400] },
  bannerText: { ...typography.bodySmall, color: colors.white, flex: 1 },
  bannerBtn: { minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.full, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  bannerBtnText: { ...typography.caption, color: colors.black },
});
