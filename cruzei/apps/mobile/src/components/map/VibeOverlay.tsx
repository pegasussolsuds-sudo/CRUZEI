import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Keyboard, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, { Easing, FadeIn, FadeInDown, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { colors, fontFamily, radius, spacing, typography } from '@cruzei/ui-mobile';
import type { MapboxPlace, PlaceCategoryKey, VibeFilter, VibePlace } from '@cruzei/shared-types';
import { useVibe, vibeOrigin } from '../../hooks/useVibe';
import { useGeocodeSearch, type GeocodeResult } from '../../hooks/useGeocodeSearch';
import { shouldSearchPlaces, usePlaceSearch } from '../../hooks/usePlaceSearch';
import { Pulse } from '../animated/Pulse';
import { ScaleOnPress } from '../animated/ScaleOnPress';
import { PressScale } from '../animated/PressScale';
import { VibePlaceRow } from './VibePlaceRow';
import { MapboxPlaceRow } from './MapboxPlaceRow';
import { BRAND } from '../../brand';

export interface VibeOverlayProps {
  visible: boolean;
  /** centro do mapa (a busca gira em volta dele) */
  center: { lat: number; lng: number } | null;
  /** minha posição (filtro "perto de mim") */
  myLocation: { lat: number; lng: number } | null;
  /** app em background / tela fora de foco: para a atualização periódica */
  paused?: boolean;
  onClose: () => void;
  /** POI do app (Cruzei) ou do Mapbox Search Box — o tipo discrimina a fonte */
  onPickPlace: (place: VibePlace | MapboxPlace) => void;
  onPickGeocode: (result: GeocodeResult) => void;
}

const FILTERS: { key: VibeFilter; label: string }[] = [
  { key: 'all', label: '✨ Tudo' },
  { key: 'hot', label: '🔥 Em alta' },
  { key: 'events', label: '🎤 Eventos' },
  { key: 'people', label: '👥 Mais gente' },
  { key: 'near', label: '📍 Perto de mim' },
];

const CATEGORIES: { key: PlaceCategoryKey; label: string }[] = [
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
  const [category, setCategory] = useState<PlaceCategoryKey | null>(null);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const debouncedRaw = useDebounced(query, 350);
  // limpar o campo (ou reabrir) não espera o timer: vazio é vazio na hora
  const debounced = query === '' ? '' : debouncedRaw;
  const keyboardH = useKeyboardHeight();

  // entrada/saída
  const anim = useSharedValue(0);
  // escolheu um lugar: some na hora (a câmera já vai voar; fade + voo + pino no mesmo quadro derrubavam o HWUI do Moto g54)
  const fastClose = useRef(false);
  // as linhas só entram animadas logo depois de abrir; digitando, entram direto (cada letra remontava dezenas de animações)
  const [animateRows, setAnimateRows] = useState(true);
  useEffect(() => {
    if (visible) {
      fastClose.current = false;
      setAnimateRows(true);
      setMounted(true);
      anim.value = withTiming(1, { duration: reduceMotion ? 0 : 280, easing: Easing.out(Easing.cubic) });
    } else if (mounted) {
      const instant = reduceMotion || fastClose.current;
      anim.value = withTiming(0, { duration: instant ? 0 : 200, easing: Easing.in(Easing.cubic) });
      const id = setTimeout(() => setMounted(false), instant ? 0 : 210);
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
  // busca genérica do Mapbox (bares/baladas etc.) só roda com texto (>=2) OU chip de categoria ligado
  const wantPlaces = shouldSearchPlaces(debounced, category);
  const places = usePlaceSearch({ q: debounced, category, mapCenter: center, myLocation, enabled: active && wantPlaces });
  const vibePlaces = origin ? (vibe.data?.places ?? []) : [];
  const mapboxPlaces = wantPlaces ? (places.data?.places ?? []) : [];
  // dedupe simples: POI do Mapbox a < 30 m de um POI do app some (o app ganha, porque tem "vibe")
  const dedupMapbox: typeof mapboxPlaces = useMemo(() => {
    if (mapboxPlaces.length === 0 || vibePlaces.length === 0) return mapboxPlaces;
    return mapboxPlaces.filter((m) => {
      for (const v of vibePlaces) {
        const dLat = (v.latitude - m.latitude) * 111_000;
        const meanLat = ((v.latitude + m.latitude) / 2) * (Math.PI / 180);
        const dLng = (v.longitude - m.longitude) * 111_000 * Math.cos(meanLat);
        if (dLat * dLat + dLng * dLng < 30 * 30) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapboxPlaces, vibePlaces]);
  const geoResults = geo.data ?? [];
  // bairros e ruas: com lugar encontrado, a seção só aparece se tiver resultado (sem "nenhuma rua" como ruído)
  const showGeo = debounced.trim().length >= 3 && (geoResults.length > 0 || dedupMapbox.length === 0);
  // dados "emprestados" da consulta anterior enquanto a nova carrega: mostra carregando, nunca um vazio falso
  const loading = Boolean(origin) && (vibe.isPending || vibe.isPlaceholderData || (wantPlaces && places.isPending));

  useEffect(() => {
    if (query.length > 0) setAnimateRows(false);
  }, [query]);
  const pickPlace = useCallback(
    (p: VibePlace | MapboxPlace) => {
      fastClose.current = true;
      onPickPlace(p);
    },
    [onPickPlace],
  );
  const pickGeocode = useCallback(
    (r: GeocodeResult) => {
      fastClose.current = true;
      onPickGeocode(r);
    },
    [onPickGeocode],
  );

  const pickFilter = useCallback((f: VibeFilter) => {
    Haptics.selectionAsync().catch(() => {});
    setFilter(f);
  }, []);
  const pickCategory = useCallback((c: PlaceCategoryKey) => {
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

  // lista unificada: POIs do Cruzei (com "vibe") + POIs do Mapbox (genéricos), separados por cabeçalho de seção
  type Row =
    | { kind: 'cruzei'; place: VibePlace }
    | { kind: 'mapbox'; place: MapboxPlace }
    | { kind: 'section'; key: string; title: string };
  const items: Row[] = useMemo(() => {
    const list: Row[] = [];
    if (vibePlaces.length > 0) {
      list.push({ kind: 'section', key: 'cruzei', title: `Ao vivo no ${BRAND.name} · ${vibePlaces.length}` });
      for (const p of vibePlaces) list.push({ kind: 'cruzei', place: p });
    }
    if (dedupMapbox.length > 0) {
      list.push({ kind: 'section', key: 'mapbox', title: `${debounced.trim() || category ? 'Na cidade' : 'Por perto'} · ${dedupMapbox.length}` });
      for (const p of dedupMapbox) list.push({ kind: 'mapbox', place: p });
    }
    return list;
  }, [vibePlaces, dedupMapbox, debounced, category]);

  const renderItem = useCallback(
    ({ item, index }: { item: Row; index: number }) => {
      if (item.kind === 'section') {
        return (
          <Text style={styles.sectionTitleList} accessibilityRole="header">
            {item.title}
          </Text>
        );
      }
      // re-index só dentro da própria seção pra animação em cascata não pular
      const idx = index;
      if (item.kind === 'cruzei') return <VibePlaceRow place={item.place} index={idx} onPress={pickPlace} animate={animateRows} />;
      return <MapboxPlaceRow place={item.place} index={idx} onPress={pickPlace} animate={animateRows} />;
    },
    [pickPlace, animateRows],
  );
  const keyExtractor = useCallback((r: Row) => (r.kind === 'section' ? `sec:${r.key}` : `${r.kind}:${String(r.kind === 'cruzei' ? r.place.id : r.place.id)}`), []);

  if (!mounted) return null;

  const emptyText = !origin
    ? filter === 'near'
      ? EMPTY_TEXT.near
      : NO_ORIGIN_TEXT
    : places.isError && wantPlaces
      ? 'A busca de lugares falhou. Confere a internet e tenta de novo.'
      : debounced
        ? `Não achei "${debounced}" por aqui. Confere o nome ou arrasta o mapa pra outra região.`
        : EMPTY_TEXT[filter];

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
                placeholder="Bar, balada, bairro ou rua…"
                placeholderTextColor={colors.gray[500]}
                returnKeyType="search"
                autoFocus
                autoCorrect={false}
                autoCapitalize="none"
                style={styles.input}
                accessibilityLabel="Buscar bar, balada, bairro ou rua"
              />
              {query.length > 0 ? (
                <PressScale onPress={() => setQuery('')} haptic={false} accessibilityRole="button" accessibilityLabel="Limpar busca" style={styles.clearBtn}>
                  <Ionicons name="close-circle" size={18} color={colors.gray[400]} />
                </PressScale>
              ) : null}
            </View>
          </View>

          {/* filtros rápidos — ScrollView nasce com flexGrow 1 no RN: sem flexGrow 0 a fila estica na vertical */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
            {FILTERS.map((f) => {
              const on = filter === f.key;
              return (
                <PressScale
                  key={f.key}
                  onPress={() => pickFilter(f.key)}
                  haptic={false}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={f.label}
                  style={[styles.chip, ...(on ? [styles.chipOn] : [])]}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{f.label}</Text>
                </PressScale>
              );
            })}
            <View style={styles.chipDivider} />
            {CATEGORIES.map((c) => {
              const on = category === c.key;
              return (
                <PressScale
                  key={c.key}
                  onPress={() => pickCategory(c.key)}
                  haptic={false}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={c.label}
                  style={[styles.chip, styles.chipCat, ...(on ? [styles.chipCatOn] : [])]}
                >
                  <Text style={[styles.chipText, on && styles.chipCatTextOn]}>{c.label}</Text>
                </PressScale>
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
            data={items}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
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
                <Animated.View entering={reduceMotion || !animateRows ? undefined : FadeIn.duration(200)} style={styles.empty}>
                  <Text style={styles.emptyEmoji}>{!origin ? '📍' : filter === 'hot' || filter === 'people' ? '😴' : '🔎'}</Text>
                  <Text style={styles.emptyText}>{emptyText}</Text>
                </Animated.View>
              )
            }
            ListFooterComponent={
              showGeo ? (
                <View style={styles.geoSection}>
                  <Text style={styles.sectionTitle}>Bairros e ruas</Text>
                  {geo.isPending && geoResults.length === 0 ? (
                    <ActivityIndicator color={colors.gray[400]} style={{ marginTop: spacing.sm }} />
                  ) : geoResults.length === 0 ? (
                    <Text style={styles.geoEmpty}>{geo.isError ? 'A busca de endereços falhou. Tenta de novo.' : `Nenhum bairro ou rua chamado "${debounced}".`}</Text>
                  ) : (
                    geoResults.map((r, i) => (
                      <Animated.View key={r.id} entering={reduceMotion || !animateRows ? undefined : FadeInDown.delay(i * 40).duration(220)}>
                        <PressScale
                          onPress={() => pickGeocode(r)}
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
                        </PressScale>
                      </Animated.View>
                    ))
                  )}
                </View>
              ) : vibe.data && origin ? (
                <Text style={styles.footerHint}>Busca um bar, uma balada, um bairro ou uma rua. Ex.: "hub", "zenaide", "balada".</Text>
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
  sectionTitleList: { ...typography.label, color: colors.gray[300], textTransform: 'uppercase', letterSpacing: 1, marginTop: spacing.md, marginBottom: spacing.xs },
  geoEmpty: { ...typography.bodySmall, color: colors.gray[500] },
  geoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.lg, backgroundColor: 'rgba(250,250,250,0.04)' },
  geoIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(127,255,0,0.1)', alignItems: 'center', justifyContent: 'center' },
  geoMain: { flex: 1, minWidth: 0 },
  geoName: { ...typography.h4, color: colors.white },
  geoContext: { ...typography.caption, color: colors.gray[400] },
  footerHint: { ...typography.caption, color: colors.gray[600], textAlign: 'center', marginTop: spacing.lg },
});
