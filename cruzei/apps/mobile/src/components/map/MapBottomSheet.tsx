import React, { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';
import BottomSheet, { BottomSheetFlatList, BottomSheetFooter, type BottomSheetFooterProps } from '@gorhom/bottom-sheet';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadows, spacing, typography } from '@cruzei/ui-mobile';
import type { NearbyUser } from '@cruzei/shared-types';
import type { MainTabParamList } from '../../navigation/MainTabs';
import { FadeInView } from '../animated/FadeInView';
import { Pulse } from '../animated/Pulse';
import { ScaleOnPress } from '../animated/ScaleOnPress';
import { PersonRow } from './PersonRow';

export const SHEET_SNAP_POINTS = ['22%', '68%'] as const;
export const SHEET_SNAP_FRACTIONS = [0.22, 0.68] as const;
const NEAR_M = 800;

export type SheetFilter = 'all' | 'online' | 'near';

export interface PoiFilter {
  id: number;
  name: string;
}

export interface MapBottomSheetHandle {
  snapToIndex: (index: number) => void;
  collapse: () => void;
  expand: () => void;
}

export interface MapBottomSheetProps {
  users: NearbyUser[];
  /** distância de cada pessoa a partir de mim (id -> metros) */
  distanceById: ReadonlyMap<string, number>;
  radiusM: number;
  isFree: boolean;
  isLoading: boolean;
  /** filtro por POI (tap num hotspot) */
  poiFilter: PoiFilter | null;
  onClearPoiFilter: () => void;
  onChange: (index: number) => void;
  /** posição animada do topo do sheet (gorhom) — o MapScreen usa pra o padding do mapa acompanhar o arraste */
  animatedPosition?: SharedValue<number>;
  onSelect: (user: NearbyUser) => void;
  onLike: (user: NearbyUser) => void;
  onSuperLike: (user: NearbyUser) => void;
  onPass: (user: NearbyUser) => void;
}

export function radiusLabel(radiusM: number): string {
  if (radiusM < 1000) return `em ${radiusM}m`;
  const km = radiusM / 1000;
  return `em ${Number.isInteger(km) ? km : km.toFixed(1).replace('.', ',')} km`;
}

const FILTERS: { key: SheetFilter; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'online', label: 'Online' },
  { key: 'near', label: 'Perto' },
];

export const MapBottomSheet = forwardRef<MapBottomSheetHandle, MapBottomSheetProps>(function MapBottomSheet(
  { users, distanceById, radiusM, isFree, isLoading, poiFilter, onClearPoiFilter, onChange, animatedPosition, onSelect, onLike, onSuperLike, onPass },
  ref,
) {
  const sheetRef = useRef<React.ElementRef<typeof BottomSheet>>(null);
  const nav = useNavigation<NavigationProp<MainTabParamList>>();
  const [filter, setFilter] = useState<SheetFilter>('all');

  useImperativeHandle(
    ref,
    () => ({
      snapToIndex: (i) => sheetRef.current?.snapToIndex(i),
      collapse: () => sheetRef.current?.collapse(),
      expand: () => sheetRef.current?.expand(),
    }),
    [],
  );

  const distanceOf = useCallback((u: NearbyUser) => distanceById.get(u.id) ?? u.distanceM, [distanceById]);

  const filtered = useMemo(() => {
    let list = users;
    if (poiFilter) list = list.filter((u) => u.poi?.id === poiFilter.id);
    if (filter === 'online') list = list.filter((u) => u.isOnline);
    else if (filter === 'near') list = list.filter((u) => distanceOf(u) <= NEAR_M);
    return list;
  }, [users, poiFilter, filter, distanceOf]);

  const title = poiFilter
    ? `${filtered.length} ${filtered.length === 1 ? 'pessoa' : 'pessoas'} no ${poiFilter.name}`
    : `${users.length} ${users.length === 1 ? 'pessoa' : 'pessoas'} ${radiusLabel(radiusM)}`;

  const renderItem = useCallback(
    ({ item, index }: { item: NearbyUser; index: number }) => (
      <FadeInView delay={Math.min(index, 8) * 35} fromY={8}>
        <PersonRow user={item} distanceM={distanceOf(item)} onPress={onSelect} onLike={onLike} onSuperLike={onSuperLike} onPass={onPass} />
      </FadeInView>
    ),
    [distanceOf, onSelect, onLike, onSuperLike, onPass],
  );

  const goPremium = useCallback(() => nav.navigate('Paywall'), [nav]);

  const renderFooter = useCallback(
    (props: BottomSheetFooterProps) => (
      <BottomSheetFooter {...props} bottomInset={0}>
        <View style={styles.footer}>
          <ScaleOnPress
            onPress={goPremium}
            accessibilityRole="button"
            accessibilityLabel="Desbloqueie Premium pra ver a cidade inteira"
            style={styles.premiumCta}
            glowColor={colors.secondary}
          >
            <Ionicons name="lock-open" size={18} color={colors.white} />
            <Text style={styles.premiumText} numberOfLines={2}>
              Desbloqueie Premium pra ver a cidade inteira
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.white} />
          </ScaleOnPress>
        </View>
      </BottomSheetFooter>
    ),
    [goPremium],
  );

  const header = (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
          👥 {title}
        </Text>
        {isLoading ? (
          <Pulse active maxScale={1.15} minOpacity={0.5} style={styles.loadingDot}>
            <View style={styles.loadingDotInner} />
          </Pulse>
        ) : null}
      </View>
      {poiFilter ? (
        <Pressable onPress={onClearPoiFilter} accessibilityRole="button" accessibilityLabel="Limpar filtro do lugar" style={styles.poiChip}>
          <Ionicons name="close-circle" size={16} color={colors.secondary} />
          <Text style={styles.poiChipText}>ver todo mundo por perto</Text>
        </Pressable>
      ) : null}
      <View style={styles.chips} accessibilityRole="tablist">
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <ScaleOnPress
              key={f.key}
              haptic={false}
              onPress={() => setFilter(f.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`Filtro ${f.label}`}
              style={active ? [styles.chip, styles.chipActive] : styles.chip}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{f.label}</Text>
            </ScaleOnPress>
          );
        })}
      </View>
    </View>
  );

  // empty state com contexto: filtro por lugar / chip ativo dizem POR QUE a lista tá vazia
  const emptyTitle = poiFilter
    ? `Ninguém no ${poiFilter.name} agora`
    : filter === 'online'
      ? 'Ninguém online agora'
      : filter === 'near'
        ? `Ninguém a menos de ${NEAR_M} m`
        : 'Ninguém por perto ainda 👀';
  const emptyText = poiFilter || filter !== 'all' ? 'Tira o filtro pra ver todo mundo' : 'Os hotspots da cidade continuam vivos no mapa';
  const empty = !isLoading ? (
    <FadeInView fromY={12} style={styles.empty}>
      <Text style={styles.emptyTitle}>{emptyTitle}</Text>
      <Text style={styles.emptyText}>{emptyText}</Text>
    </FadeInView>
  ) : null;

  return (
    <BottomSheet
      ref={sheetRef}
      index={0}
      snapPoints={SHEET_SNAP_POINTS}
      onChange={onChange}
      animatedPosition={animatedPosition}
      handleStyle={styles.handleWrap}
      handleIndicatorStyle={styles.handle}
      backgroundStyle={styles.sheetBg}
      style={styles.sheet}
      footerComponent={isFree ? renderFooter : undefined}
      enableDynamicSizing={false}
      accessibilityLabel="Pessoas por perto"
    >
      <BottomSheetFlatList
        data={filtered}
        keyExtractor={(u: NearbyUser) => u.id}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        contentContainerStyle={styles.listContent}
        enableFooterMarginAdjustment={isFree}
        initialNumToRender={8}
        windowSize={7}
        removeClippedSubviews
        showsVerticalScrollIndicator={false}
      />
    </BottomSheet>
  );
});

const styles = StyleSheet.create({
  sheet: { ...shadows.strong },
  sheetBg: { backgroundColor: colors.white, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg },
  handleWrap: { height: 24, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: colors.gray[300] },
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, gap: spacing.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { ...typography.h3, color: colors.black, flexShrink: 1 },
  loadingDot: { width: 12, height: 12, alignItems: 'center', justifyContent: 'center' },
  loadingDotInner: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  poiChip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start', minHeight: 44 },
  poiChipText: { ...typography.caption, color: colors.secondary },
  chips: { flexDirection: 'row', gap: spacing.sm },
  chip: { height: 44, paddingHorizontal: spacing.lg, borderRadius: radius.full, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  chipActive: { backgroundColor: colors.black },
  chipText: { ...typography.label, color: colors.gray[700] },
  chipTextActive: { color: colors.primary },
  // espaço pro footer fixo (CTA premium) não cobrir a última pessoa
  listContent: { paddingBottom: 132 },
  empty: { alignItems: 'center', paddingVertical: spacing.xl, paddingHorizontal: spacing.lg, gap: spacing.xs },
  emptyTitle: { ...typography.h3, color: colors.black, textAlign: 'center' },
  emptyText: { ...typography.body, color: colors.gray[600], textAlign: 'center' },
  footer: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, backgroundColor: colors.white },
  premiumCta: {
    minHeight: 52,
    borderRadius: radius.md,
    backgroundColor: colors.secondary,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  premiumText: { ...typography.label, color: colors.white, flex: 1 },
});
