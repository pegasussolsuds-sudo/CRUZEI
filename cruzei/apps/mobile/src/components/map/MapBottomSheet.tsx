import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';
import BottomSheet, { BottomSheetFlatList, BottomSheetFooter, type BottomSheetFooterProps } from '@gorhom/bottom-sheet';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadows, spacing, typography } from '@cruzei/ui-mobile';
import { proximityRank } from '@cruzei/shared-utils';
import type { NearbyUser, ProximityBand } from '@cruzei/shared-types';
import type { MainTabParamList } from '../../navigation/MainTabs';
import { FadeInView } from '../animated/FadeInView';
import { LiveDot } from '../animated/LiveDot';
import { ScaleOnPress } from '../animated/ScaleOnPress';
import { PersonRow } from './PersonRow';
import { invisibleSummary } from './invisible';
import { nearbyFailCopy, nearbyNetState, nearbyStaleA11y, nearbyStaleText, type NearbyFailKind } from './nearbyStatus';

export const SHEET_SNAP_POINTS: string[] = ['22%', '68%'];
export const SHEET_SNAP_FRACTIONS = [0.22, 0.68] as const;
const HANDLE_H = 24; // = styles.handleWrap.height

/**
 * Altura da lista recolhida: 22% da tela, mas nunca menos que alça + título + filtros (+ CTA Premium).
 * Em tela baixa (S23: ~670dp de mapa) os 22% davam 147dp e o CTA cobria os filtros.
 */
export function sheetPeekHeight(containerH: number, contentH: number): number {
  return Math.max(Math.round(containerH * SHEET_SNAP_FRACTIONS[0]), Math.ceil(contentH));
}
// "Perto" = faixas bem perto + perto (≤ 250 m); o app nunca vê metros de outra pessoa
const NEAR_RANK_MAX = 1;

export type SheetFilter = 'all' | 'online' | 'near';

export interface PoiFilter {
  id: number;
  name: string;
}

/** grupo de pessoas num mesmo ponto (toque num cluster no zoom máximo) */
export interface GroupFilter {
  ids: string[];
  label: string;
}

export interface MapBottomSheetHandle {
  snapToIndex: (index: number) => void;
  collapse: () => void;
  expand: () => void;
}

export interface MapBottomSheetProps {
  users: NearbyUser[];
  /** distância de cada pessoa a partir de mim (id -> metros) */
  bandById: ReadonlyMap<string, ProximityBand>;
  /** pessoas por perto que o servidor não mostra (região esparsa) — só o número */
  hiddenCount?: number;
  /** gente invisível (modo anônimo) por perto — só Premium; grátis recebe null do servidor e aqui chega 0 */
  invisibleTotal?: number;
  radiusM: number;
  isFree: boolean;
  isLoading: boolean;
  /** a última busca de pessoas falhou (servidor fora / sem rede) */
  isOffline?: boolean;
  /** por que falhou: sem resposta (rede) ou erro do servidor (ocupado) — muda o texto do aviso */
  failKind?: NearbyFailKind;
  /** quando a lista na tela chegou do servidor (ms); 0 = não tem lista */
  updatedAt?: number;
  /** tentando buscar de novo depois da falha */
  isRetrying?: boolean;
  onRetry?: () => void;
  /** altura da área do mapa (a mesma base dos percentuais dos snap points) */
  containerHeight: number;
  /** altura real da lista recolhida em px, depois de medir o conteúdo (0 = ainda não mediu) */
  onPeekHeight?: (px: number) => void;
  /** filtro por POI (tap num hotspot) */
  poiFilter: PoiFilter | null;
  /** ids de quem conta como 'nesse lugar' (check-in ou a poucos metros) — o MapScreen calcula */
  poiFilterIds?: string[] | null;
  onClearPoiFilter: () => void;
  groupFilter?: GroupFilter | null;
  onClearGroupFilter?: () => void;
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
  { users, bandById, hiddenCount = 0, invisibleTotal = 0, radiusM, isFree, isLoading, isOffline = false, failKind = 'network', updatedAt = 0, isRetrying = false, onRetry, containerHeight, onPeekHeight, poiFilter, poiFilterIds, onClearPoiFilter, groupFilter, onClearGroupFilter, onChange, animatedPosition, onSelect, onLike, onSuperLike, onPass },
  ref,
) {
  const sheetRef = useRef<React.ElementRef<typeof BottomSheet>>(null);
  const nav = useNavigation<NavigationProp<MainTabParamList>>();
  const [filter, setFilter] = useState<SheetFilter>('all');
  const [headerH, setHeaderH] = useState(0);
  const [footerH, setFooterH] = useState(0);
  const onHeaderLayout = useCallback((e: LayoutChangeEvent) => setHeaderH(Math.round(e.nativeEvent.layout.height)), []);
  const onFooterLayout = useCallback((e: LayoutChangeEvent) => setFooterH(Math.round(e.nativeEvent.layout.height)), []);
  const peekH = containerHeight > 0 && headerH > 0 ? sheetPeekHeight(containerHeight, HANDLE_H + headerH + (isFree ? footerH : 0)) : 0;
  const snapPoints = useMemo(() => (peekH > 0 ? [peekH, SHEET_SNAP_POINTS[1]] : SHEET_SNAP_POINTS), [peekH]);
  useEffect(() => {
    onPeekHeight?.(peekH);
  }, [peekH, onPeekHeight]);

  useImperativeHandle(
    ref,
    () => ({
      snapToIndex: (i) => sheetRef.current?.snapToIndex(i),
      collapse: () => sheetRef.current?.collapse(),
      expand: () => sheetRef.current?.expand(),
    }),
    [],
  );

  // /location/nearby fora: sem lista → aviso com "Tentar de novo" no lugar dos filtros; com lista → idade dela no topo
  const net = nearbyNetState(isOffline, updatedAt);
  // "atualizado há X min" anda sozinho enquanto a conexão não volta (o MapScreen só re-renderiza a cada tentativa)
  const [, setTick] = useState(0);
  useEffect(() => {
    if (net !== 'stale') return;
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, [net]);
  const now = Date.now();

  const rankOf = useCallback((u: NearbyUser) => proximityRank(bandById.get(u.id) ?? u.proximityBand), [bandById]);

  const filtered = useMemo(() => {
    let list = users;
    if (groupFilter) {
      const ids = new Set(groupFilter.ids);
      list = list.filter((u) => ids.has(u.id));
    } else if (poiFilter) {
      const ids = poiFilterIds ? new Set(poiFilterIds) : null;
      list = list.filter((u) => (ids ? ids.has(u.id) : u.poi?.id === poiFilter.id));
    }
    if (filter === 'online') list = list.filter((u) => u.isOnline);
    else if (filter === 'near') list = list.filter((u) => rankOf(u) <= NEAR_RANK_MAX);
    return list;
  }, [users, groupFilter, poiFilter, poiFilterIds, filter, rankOf]);

  // " · 👻 N invisíveis por perto" só no resumo geral (Premium; grátis = '')
  const invisibleText = groupFilter || poiFilter ? '' : invisibleSummary(invisibleTotal);
  const failCopy = nearbyFailCopy(failKind);
  const title = net === 'offline'
    ? failCopy.title
    : groupFilter
    ? groupFilter.label
    : poiFilter
      ? `${filtered.length} ${filtered.length === 1 ? 'pessoa' : 'pessoas'} no ${poiFilter.name}`
      : `${users.length} ${users.length === 1 ? 'pessoa' : 'pessoas'} ${radiusLabel(radiusM)}${hiddenCount > 0 ? ` · +${hiddenCount} por perto` : ''}${invisibleText}`;

  const renderItem = useCallback(
    // sem animação de entrada por linha: com multidão em volta a lista troca dezenas de linhas a cada atualização
    ({ item }: { item: NearbyUser }) => (
      <PersonRow user={item} band={bandById.get(item.id) ?? item.proximityBand ?? null} onPress={onSelect} onLike={onLike} onSuperLike={onSuperLike} onPass={onPass} />
    ),
    [bandById, onSelect, onLike, onSuperLike, onPass],
  );

  const goPremium = useCallback(() => nav.navigate('Paywall'), [nav]);

  const renderFooter = useCallback(
    (props: BottomSheetFooterProps) => (
      <BottomSheetFooter {...props} bottomInset={0}>
        <View style={styles.footer} onLayout={onFooterLayout}>
          <ScaleOnPress
            onPress={goPremium}
            accessibilityRole="button"
            accessibilityLabel="Desbloqueie Premium: avatar exclusivo e modo anônimo sem limite"
            style={styles.premiumCta}
            glowColor={colors.secondary}
          >
            <Ionicons name="lock-open" size={18} color={colors.white} />
            <Text style={styles.premiumText} numberOfLines={2}>
              Desbloqueie Premium: avatar exclusivo e modo anônimo sem limite
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.white} />
          </ScaleOnPress>
        </View>
      </BottomSheetFooter>
    ),
    [goPremium, onFooterLayout],
  );

  const header = (
    <View style={styles.header} onLayout={onHeaderLayout}>
      <View style={styles.titleRow}>
        {/* com os invisíveis o resumo passa de uma linha nos 360 dp: quebra em vez de cortar (a altura recolhida é medida) */}
        <Text style={styles.title} numberOfLines={invisibleText || net === 'offline' ? 2 : 1} accessibilityRole="header">
          {net === 'offline' ? failCopy.emoji : '👥'} {title}
        </Text>
        {isLoading ? (
          <LiveDot size={8} style={styles.loadingDot} />
        ) : null}
      </View>
      {/* lista antiga na tela: aviso discreto de uma linha só, sem botão (a busca segue tentando sozinha) */}
      {net === 'stale' ? (
        <View style={styles.staleRow} accessible accessibilityLabel={nearbyStaleA11y(updatedAt, now, failKind)}>
          <Ionicons name="cloud-offline-outline" size={14} color={colors.warning} />
          <Text style={styles.staleText} numberOfLines={1}>
            {nearbyStaleText(updatedAt, now, failKind)}
          </Text>
        </View>
      ) : null}
      {groupFilter ? (
        <Pressable onPress={onClearGroupFilter} accessibilityRole="button" accessibilityLabel="Limpar filtro do grupo" style={styles.poiChip}>
          <Ionicons name="close-circle" size={16} color={colors.secondary} />
          <Text style={styles.poiChipText}>ver todo mundo por perto</Text>
        </Pressable>
      ) : null}
      {poiFilter && !groupFilter ? (
        <Pressable onPress={onClearPoiFilter} accessibilityRole="button" accessibilityLabel="Limpar filtro do lugar" style={styles.poiChip}>
          <Ionicons name="close-circle" size={16} color={colors.secondary} />
          <Text style={styles.poiChipText}>ver todo mundo por perto</Text>
        </Pressable>
      ) : null}
      {net === 'offline' ? (
        // sem lista pra filtrar: o aviso entra no lugar dos filtros, na mesma altura (44), e aparece com a sheet recolhida
        <View style={styles.offlineRow}>
          <ScaleOnPress
            onPress={onRetry}
            disabled={isRetrying || !onRetry}
            accessibilityRole="button"
            accessibilityLabel="Tentar de novo"
            accessibilityState={{ busy: isRetrying, disabled: isRetrying || !onRetry }}
            style={styles.retryBtn}
          >
            <View style={styles.retryIcon}>
              {isRetrying ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name="refresh" size={18} color={colors.primary} />}
            </View>
            <Text style={styles.retryText}>Tentar de novo</Text>
          </ScaleOnPress>
          <Text style={styles.offlineHint} numberOfLines={2}>
            {failCopy.hint}
          </Text>
        </View>
      ) : (
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
      )}
    </View>
  );

  // empty state com contexto: filtro por lugar / chip ativo dizem POR QUE a lista tá vazia
  const emptyTitle = groupFilter
    ? 'Ninguém nesse ponto agora'
    : poiFilter
    ? `Ninguém no ${poiFilter.name} agora`
    : filter === 'online'
      ? 'Ninguém online agora'
      : filter === 'near'
        ? 'Ninguém bem perto agora'
        : 'Ninguém por perto ainda 👀';
  const emptyText = groupFilter || poiFilter || filter !== 'all' ? 'Tira o filtro pra ver todo mundo' : 'Os hotspots da cidade continuam vivos no mapa';
  // sem conexão e sem lista: o aviso do cabeçalho já diz tudo (nada de "Ninguém por perto" com servidor fora)
  const empty = !isLoading && net !== 'offline' ? (
    <FadeInView fromY={12} style={styles.empty}>
      <Text style={styles.emptyTitle}>{emptyTitle}</Text>
      <Text style={styles.emptyText}>{emptyText}</Text>
    </FadeInView>
  ) : null;

  return (
    <BottomSheet
      ref={sheetRef}
      index={0}
      snapPoints={snapPoints}
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
  staleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  staleText: { ...typography.caption, color: colors.gray[600], flexShrink: 1 },
  offlineRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 44 },
  retryBtn: { height: 44, paddingHorizontal: spacing.lg, borderRadius: radius.full, backgroundColor: colors.black, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  retryIcon: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  retryText: { ...typography.label, color: colors.primary },
  offlineHint: { ...typography.bodySmall, color: colors.gray[600], flex: 1 },
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
