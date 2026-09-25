import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Keyboard, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { colors, fontFamily, radius, spacing, typography } from '@cruzei/ui-mobile';
import type { VibeFilter, VibePlace } from '@cruzei/shared-types';
import { useVibe, vibeOrigin } from '../../hooks/useVibe';
import { useGeocodeSearch, type GeocodeResult } from '../../hooks/useGeocodeSearch';
import { FadeInView } from '../animated/FadeInView';
import { Pulse } from '../animated/Pulse';
import { ScaleOnPress } from '../animated/ScaleOnPress';
import { VibePlaceRow } from './VibePlaceRow';

export interface VibeOverlayProps {
  visible: boolean;
  /** centro do mapa (a busca gira em volta dele) */
  center: { lat: number; lng: number } | null;
  /** minha posição (filtro "perto de mim") */
  myLocation: { lat: number; lng: number } | null;
  /** app em background / tela fora de foco: para a atualização periódica */
  paused?: boolean;
  onClose: () => void;
  onPickPlace: (place: VibePlace) => void;
  onPickGeocode: (result: GeocodeResult) => void;
}

const FILTERS: { key: VibeFilter; label: string }[] = [
  { key: 'all', label: '✨ Tudo' },
  { key: 'hot', label: '🔥 Em alta' },
  { key: 'events', label: '🎤 Eventos' },
  { key: 'people', label: '👥 Mais gente' },
  { key: 'near', label: '📍 Perto de mim' },
];

const CATEGORIES: { key: string; label: string }[] = [
  { key: 'bar', label: '🍻 Bares' },
  { key: 'restaurant', label: '🍔 Comer' },
  { key: 'cafe', label: '☕ Cafés' },
  { key: 'park', label: '🌳 Parques' },
  { key: 'show', label: '🎵 Shows' },
  { key: 'shopping', label: '🛍️ Shopping' },
];

const EMPTY_TEXT: Record<VibeFilter, string> = {
  all: 'Nenhum lugar por aqui ainda. Arrasta o mapa pra outra região ou busca um bairro.',
  hot: 'Nada bombando agora 😴 Os lugares acendem quando têm 2+ pessoas do app.',
  events: 'Nenhum evento no raio agora.',
  people: 'Ninguém em lugares por aqui agora — volta mais tarde.',
  near: 'Sem a sua posição ainda: ativa a localização pra ver o que tá perto de você.',
};
const NO_ORIGIN_TEXT = 'Ativa a localização, arrasta o mapa ou busca um bairro pra ver a vibe.';

const GEO_ICON: Record<GeocodeResult['type'], keyof typeof Ionicons.glyphMap> = {
  place: 'business-outline',
  locality: 'map-outline',
  neighborhood: 'map-outline',
  street: 'navigate-outline',
  address: 'home-outline',
  other: 'location-outline',
};

function useDebounced(value: string, ms: number): string {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** altura do teclado no Android: com statusBarTranslucent o Modal não redimensiona sozinho */
function useKeyboardHeight(): number {
  const [h, setH] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const show = Keyboard.addListener('keyboardDidShow', (e) => setH(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setH(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return h;
}

/**
 * Overlay "Onde tá a vibe": busca + filtros rápidos + ranking ao vivo dos lugares (gente agora, tendência,
 * eventos) e, ao digitar, lugares/bairros/ruas do Mapbox pra levar a câmera até lá.
 * Modal por cima do mapa; entra deslizando de cima, sai em fade. Fecha com o botão do sistema.
 */
export function VibeOverlay({ visible, center, myLocation, paused = false, onClose, onPickPlace, onPickGeocode }: VibeOverlayProps) {
  const reduceMotion = useReducedMotion();
  const [mounted, setMounted] = useState(visible);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<VibeFilter>('all');
  const [category, setCategory] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const debouncedRaw = useDebounced(query, 350);
  // limpar o campo (ou reabrir) não espera o timer: vazio é vazio na hora
  const debounced = query === '' ? '' : debouncedRaw;
  const keyboardH = useKeyboardHeight();

  // entrada/saída
  const anim = useSharedValue(0);
  useEffect(() => {
    if (visible) {
      setMounted(true);
      anim.value = withTiming(1, { duration: reduceMotion ? 0 : 280, easing: Easing.out(Easing.cubic) });
    } else if (mounted) {
      anim.value = withTiming(0, { duration: reduceMotion ? 0 : 200, easing: Easing.in(Easing.cubic) });
      const id = setTimeout(() => setMounted(false), reduceMotion ? 0 : 210);
      return () => clearTimeout(id);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // ao abrir: estado limpo e foco no campo
  useEffect(() => {
    if (!visible) return undefined;
    setQuery('');
    setFilter('all');
    setCategory(null);
    const id = setTimeout(() => inputRef.current?.focus(), reduceMotion ? 50 : 320);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const panelStyle = useAnimatedStyle(() => ({
    opacity: anim.value,
    transform: [{ translateY: (1 - anim.value) * (reduceMotion ? 0 : -28) }],
  }));

  const active = mounted && visible;
  const origin = vibeOrigin(filter, center, myLocation);
  const vibe = useVibe({ center, myLocation, filter, q: debounced, category, enabled: active, polling: !paused });
  const geo = useGeocodeSearch(debounced, center, active);
  const places = origin ? (vibe.data?.places ?? []) : [];
  const geoResults = geo.data ?? [];
  const showGeo = debounced.trim().length >= 3;
  // dados "emprestados" da consulta anterior enquanto a nova carrega: mostra carregando, nunca um vazio falso
  const loading = Boolean(origin) && (vibe.isPending || vibe.isPlaceholderData);

  const pickFilter = useCallback((f: VibeFilter) => {
    Haptics.selectionAsync().catch(() => {});
    setFilter(f);
  }, []);
  const pickCategory = useCallback((c: string) => {
    Haptics.selectionAsync().catch(() => {});
    setCategory((cur) => (cur === c ? null : c));
  }, []);

  const summary = useMemo(() => {
    const d = vibe.data;
    if (!d || !origin) return null;
    const parts: string[] = [];
    if (d.peopleAtPlaces > 0) parts.push(`${d.peopleAtPlaces} ${d.peopleAtPlaces === 1 ? 'pessoa' : 'pessoas'} em lugares`);
    if (d.hotCount > 0) parts.push(`${d.hotCount} em alta`);
    return parts.length > 0 ? parts.join(' · ') : 'a cidade tá quieta agora';
  }, [vibe.data, origin]);

  const renderPlace = useCallback(({ item, index }: { item: VibePlace; index: number }) => <VibePlaceRow place={item} index={index} onPress={onPickPlace} />, [onPickPlace]);
  const keyExtractor = useCallback((p: VibePlace) => String(p.id), []);

  if (!mounted) return null;

  const emptyText = !origin ? (filter === 'near' ? EMPTY_TEXT.near : NO_ORIGIN_TEXT) : debounced ? `Nada com "${debounced}" nos lugares do app.` : EMPTY_TEXT[filter];

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={onClose} onShow={() => inputRef.current?.focus()}>
      <Animated.View style={[styles.root, panelStyle]}>
        {/* fundo sem canvas Skia (TextureView por abertura derrubava o HWUI do aparelho de teste): dois gradientes bastam */}
        <LinearGradient colors={['rgba(127,255,0,0.16)', 'rgba(255,20,147,0.08)', colors.black]} locations={[0, 0.45, 1]} style={StyleSheet.absoluteFill} pointerEvents="none" />
        <LinearGradient colors={['rgba(10,10,26,0.2)', 'rgba(10,10,26,0.9)', colors.black]} locations={[0, 0.4, 1]} style={StyleSheet.absoluteFill} pointerEvents="none" />

        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          {/* busca */}
          <View style={styles.searchRow}>
            <ScaleOnPress onPress={onClose} accessibilityRole="button" accessibilityLabel="Fechar busca" style={styles.backBtn}>
              <Ionicons name="arrow-back" size={22} color={colors.white} />
            </ScaleOnPress>
            <View style={[styles.inputWrap, ...(focused ? [styles.inputWrapFocused] : [])]}>
              <Ionicons name="search" size={18} color={focused ? colors.primary : colors.gray[400]} />
              <TextInput
                ref={inputRef}
                value={query}
                onChangeText={setQuery}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                placeholder="Lugar, bairro, rua ou evento…"
                placeholderTextColor={colors.gray[500]}
                returnKeyType="search"
                autoFocus
                autoCorrect={false}
                autoCapitalize="none"
                style={styles.input}
                accessibilityLabel="Buscar lugar, bairro, rua ou evento"
              />
              {query.length > 0 ? (
                <ScaleOnPress onPress={() => setQuery('')} haptic={false} accessibilityRole="button" accessibilityLabel="Limpar busca" style={styles.clearBtn}>
                  <Ionicons name="close-circle" size={18} color={colors.gray[400]} />
                </ScaleOnPress>
              ) : null}
            </View>
          </View>

          {/* filtros rápidos — ScrollView nasce com flexGrow 1 no RN: sem flexGrow 0 a fila estica na vertical */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
            {FILTERS.map((f) => {
              const on = filter === f.key;
              return (
                <ScaleOnPress
                  key={f.key}
                  onPress={() => pickFilter(f.key)}
                  haptic={false}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={f.label}
                  style={[styles.chip, ...(on ? [styles.chipOn] : [])]}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{f.label}</Text>
                </ScaleOnPress>
              );
            })}
            <View style={styles.chipDivider} />
            {CATEGORIES.map((c) => {
              const on = category === c.key;
              return (
                <ScaleOnPress
                  key={c.key}
                  onPress={() => pickCategory(c.key)}
                  haptic={false}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={c.label}
                  style={[styles.chip, styles.chipCat, ...(on ? [styles.chipCatOn] : [])]}
                >
                  <Text style={[styles.chipText, on && styles.chipCatTextOn]}>{c.label}</Text>
                </ScaleOnPress>
              );
            })}
          </ScrollView>

          {/* resumo ao vivo */}
          <View style={styles.summaryRow} accessibilityLiveRegion="polite">
            <Pulse maxScale={1.5} cycleMs={1600}>
              <View style={styles.liveDot} />
            </Pulse>
            <Text style={styles.summaryLive}>AO VIVO</Text>
            {summary ? (
              <Text style={styles.summaryText} numberOfLines={1}>
                · {summary}
              </Text>
            ) : null}
            {vibe.isFetching ? <ActivityIndicator size="small" color={colors.primary} style={styles.summarySpinner} /> : null}
          </View>

          <FlatList
            data={places}
            keyExtractor={keyExtractor}
            renderItem={renderPlace}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={[styles.list, ...(keyboardH > 0 ? [{ paddingBottom: keyboardH + spacing.lg }] : [])]}
            ItemSeparatorComponent={Separator}
            ListEmptyComponent={
              loading ? (
                <View style={styles.loading}>
                  <ActivityIndicator color={colors.primary} />
                  <Text style={styles.loadingText}>medindo a vibe da cidade…</Text>
                </View>
              ) : (
                <FadeInView fromY={8} style={styles.empty}>
                  <Text style={styles.emptyEmoji}>{!origin ? '📍' : filter === 'hot' || filter === 'people' ? '😴' : '🔎'}</Text>
                  <Text style={styles.emptyText}>{emptyText}</Text>
                </FadeInView>
              )
            }
            ListFooterComponent={
              showGeo ? (
                <View style={styles.geoSection}>
                  <Text style={styles.sectionTitle}>Ir até um lugar</Text>
                  {geo.isPending && geoResults.length === 0 ? (
                    <ActivityIndicator color={colors.gray[400]} style={{ marginTop: spacing.sm }} />
                  ) : geoResults.length === 0 ? (
                    <Text style={styles.geoEmpty}>{geo.isError ? 'A busca de endereços falhou. Tenta de novo.' : `Nenhum bairro, rua ou lugar chamado "${debounced}".`}</Text>
                  ) : (
                    geoResults.map((r, i) => (
                      <FadeInView key={r.id} delay={i * 40} fromY={8} durationMs={220}>
                        <ScaleOnPress
                          onPress={() => onPickGeocode(r)}
                          accessibilityRole="button"
                          accessibilityLabel={`Ir até ${r.name}${r.context ? `, ${r.context}` : ''}`}
                          style={styles.geoRow}
                        >
                          <View style={styles.geoIcon}>
                            <Ionicons name={GEO_ICON[r.type]} size={18} color={colors.primary} />
                          </View>
                          <View style={styles.geoMain}>
                            <Text style={styles.geoName} numberOfLines={1}>
                              {r.name}
                            </Text>
                            {r.context ? (
                              <Text style={styles.geoContext} numberOfLines={1}>
                                {r.context}
                              </Text>
                            ) : null}
                          </View>
                          <Ionicons name="arrow-forward" size={18} color={colors.gray[500]} />
                        </ScaleOnPress>
                      </FadeInView>
                    ))
                  )}
                </View>
              ) : vibe.data && origin ? (
                <Text style={styles.footerHint}>Digita um bairro ou uma rua pra levar o mapa até lá.</Text>
              ) : null
            }
          />
        </SafeAreaView>
      </Animated.View>
    </Modal>
  );
}

function Separator() {
  return <View style={{ height: spacing.sm }} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.black },
  safe: { flex: 1 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(250,250,250,0.08)', alignItems: 'center', justifyContent: 'center' },
  inputWrap: {
    flex: 1,
    height: 50,
    borderRadius: radius.full,
    backgroundColor: 'rgba(250,250,250,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(250,250,250,0.12)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
  },
  inputWrapFocused: { borderColor: colors.primary, backgroundColor: 'rgba(127,255,0,0.06)' },
  input: { flex: 1, minWidth: 0, fontFamily: fontFamily.displayMedium, fontSize: 16, color: colors.white, paddingVertical: 0 },
  clearBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  chipsScroll: { flexGrow: 0, flexShrink: 0 },
  chips: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.sm, alignItems: 'center' },
  chip: { height: 36, paddingHorizontal: spacing.md, borderRadius: radius.full, backgroundColor: 'rgba(250,250,250,0.08)', borderWidth: 1, borderColor: 'rgba(250,250,250,0.1)', justifyContent: 'center' },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipCat: { backgroundColor: 'transparent' },
  chipCatOn: { borderColor: colors.secondary, backgroundColor: 'rgba(255,20,147,0.18)' },
  chipText: { ...typography.label, color: colors.gray[200] },
  chipTextOn: { color: colors.black },
  chipCatTextOn: { color: colors.white },
  chipDivider: { width: 1, height: 20, backgroundColor: 'rgba(250,250,250,0.15)', marginHorizontal: spacing.xs },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xs },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary },
  summaryLive: { ...typography.caption, color: colors.primary, letterSpacing: 1, marginLeft: 2 },
  summaryText: { ...typography.caption, color: colors.gray[300], flexShrink: 1 },
  summarySpinner: { marginLeft: spacing.xs },
  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs, paddingBottom: spacing.xxl },
  loading: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxl },
  loadingText: { ...typography.bodySmall, color: colors.gray[400] },
  empty: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl, paddingHorizontal: spacing.lg },
  emptyEmoji: { fontSize: 32 },
  emptyText: { ...typography.body, color: colors.gray[300], textAlign: 'center' },
  geoSection: { marginTop: spacing.lg, gap: spacing.sm },
  sectionTitle: { ...typography.label, color: colors.gray[400], textTransform: 'uppercase', letterSpacing: 1, marginBottom: spacing.xs },
  geoEmpty: { ...typography.bodySmall, color: colors.gray[500] },
  geoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.lg, backgroundColor: 'rgba(250,250,250,0.04)' },
  geoIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(127,255,0,0.1)', alignItems: 'center', justifyContent: 'center' },
  geoMain: { flex: 1, minWidth: 0 },
  geoName: { ...typography.h4, color: colors.white },
  geoContext: { ...typography.caption, color: colors.gray[400] },
  footerHint: { ...typography.caption, color: colors.gray[600], textAlign: 'center', marginTop: spacing.lg },
});
