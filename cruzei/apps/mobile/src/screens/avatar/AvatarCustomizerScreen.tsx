import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Animated, { cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { AvatarColorSlot, AvatarConfig, AvatarItemSlot, AvatarSlot, AvatarTier } from '@cruzei/shared-types';
import {
  AVATAR_COLOR_SLOTS,
  AVATAR_ITEM_SLOTS,
  FREE_TIERS,
  SKIN_COLORS,
  randomAvatarConfig,
  type AvatarColorDef,
} from '@cruzei/shared-utils';
import { colors, fontFamily, radius, spacing, spring, typography } from '@cruzei/ui-mobile';
import { BlobBackground, FadeInView, Glow, ScaleOnPress } from '../../components/animated';
import { CruzeiAvatar } from '../../components/avatar/CruzeiAvatar';
import { AvatarItemTile } from '../../components/avatar/AvatarItemTile';
import { CruzeiPremiumBadge } from '../../components/avatar/CruzeiPremiumBadge';
import { keyOf, resolveAvatar } from '../../avatar';
import { api, toApiError } from '../../services/api';
import { useAuthStore } from '../../stores/auth';
import type { RootStackParamList } from '../../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList, 'AvatarSetup'>;
type Route = RouteProp<RootStackParamList, 'AvatarSetup'>;

/** abas = slots de item + "Pele" (que é só cor) */
type TabKey = AvatarItemSlot | 'skin';

const PREMIUM_TIERS: ReadonlySet<AvatarTier> = new Set<AvatarTier>(['free', 'premium']);

/** slot de cor que acompanha a aba (faixa de bolinhas embaixo da grade) */
const COLOR_OF_SLOT: Partial<Record<AvatarItemSlot, AvatarColorSlot>> = {
  hair: 'hairColor',
  top: 'topColor',
  bottom: 'bottomColor',
  shoes: 'shoesColor',
  hat: 'hatColor',
};

/** itens que só dá pra ver no corpo inteiro (o bust corta abaixo dos ombros) */
const FULL_PREVIEW_SLOTS: ReadonlySet<AvatarItemSlot> = new Set<AvatarItemSlot>(['body', 'top', 'bottom', 'shoes', 'bag', 'wrist']);

// Corpo, Pele, Cabelo, Rosto, Barba, Parte de cima, ... (rótulos vêm do catálogo)
const TABS: { key: TabKey; label: string }[] = AVATAR_ITEM_SLOTS.flatMap((s) => {
  const tab = { key: s.slot as AvatarItemSlot, label: s.label };
  return s.slot === 'body' ? [tab, { key: 'skin' as const, label: 'Pele' }] : [tab];
});

const COLS = 4;
const GAP = spacing.sm;
const H_PAD = spacing.lg;
const TOAST_MS = 2800;

function hapticWarn() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
}

// ---------------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------------

/**
 * AvatarSetup: "Monta o seu avatar" (pós-cadastro) / "Seu avatar" (vindo do perfil).
 * Prévia grande que dá um pop a cada mudança, "🎲 Surpreender", abas por slot, grade de tiles
 * com o item aplicado, faixa de cores contextual e rodapé fixo. Itens fora do tier viram
 * badge Premium/Evento (toque → paywall / toast). Salva com PATCH /me { avatar }.
 */
export function AvatarCustomizerScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const fromOnboarding = route.params?.fromOnboarding ?? false;
  const focused = useIsFocused();
  const reduceMotion = useReducedMotion();
  const qc = useQueryClient();
  const { width: screenW, height: screenH } = useWindowDimensions();

  const me = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const setOnboardingStep = useAuthStore((s) => s.setOnboardingStep);

  const premiumTier = me?.premiumTier ?? 'free';
  const allowedTiers = useMemo(() => (premiumTier === 'free' ? FREE_TIERS : PREMIUM_TIERS), [premiumTier]);

  const [config, setConfig] = useState<AvatarConfig>(() => resolveAvatar(me?.avatar, me?.id ?? 'me', me?.gender));
  const [tab, setTab] = useState<TabKey>('body');
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  // --- prévia: pop de escala a cada mudança ---------------------------------
  const pop = useSharedValue(1);
  const configKey = keyOf(config);
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (reduceMotion) return;
    pop.value = 0.9;
    pop.value = withSpring(1, spring.bouncy);
  }, [configKey, pop, reduceMotion]);
  useEffect(() => () => cancelAnimation(pop), [pop]);
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));

  // em telas baixas a prévia encolhe um pouco pra sobrar grade
  const previewSize = Math.max(180, Math.min(240, Math.round(screenH * 0.28)));
  const tileW = Math.floor((screenW - H_PAD * 2 - GAP * (COLS - 1)) / COLS);

  // --- seleção --------------------------------------------------------------
  const select = useCallback(
    (slot: AvatarSlot, id: string, tier: AvatarTier, locked: boolean) => {
      if (locked) {
        hapticWarn();
        if (tier === 'event') {
          showToast('Item de evento — em breve');
        } else if (fromOnboarding) {
          // no meio do cadastro não vale a pena sair pro paywall: dá pra liberar depois pelo perfil
          showToast('Item Premium — dá pra liberar depois no Perfil ✨');
        } else {
          nav.navigate('Main', { screen: 'Paywall' });
        }
        return;
      }
      Haptics.selectionAsync().catch(() => {});
      setConfig((c) => (c[slot] === id ? c : { ...c, [slot]: id }));
    },
    [fromOnboarding, nav, showToast],
  );

  const surprise = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setConfig(randomAvatarConfig(`${Date.now()}-${Math.random()}`, { gender: me?.gender ?? null, tiers: allowedTiers }));
  }, [allowedTiers, me?.gender]);

  // --- salvar / sair --------------------------------------------------------
  const finish = useCallback(() => {
    if (fromOnboarding) {
      // próxima etapa do pós-cadastro: fotos (replace → sem voltar pro avatar)
      nav.replace('PhotoUpload', { fromOnboarding: true });
      setOnboardingStep('photo');
    } else if (nav.canGoBack()) {
      nav.goBack();
    } else {
      nav.replace('Main');
    }
  }, [fromOnboarding, nav, setOnboardingStep]);

  const save = useMutation({
    mutationFn: async (avatar: AvatarConfig) => {
      await api.patch('/me', { avatar });
      return avatar;
    },
    onSuccess: (avatar) => {
      const cur = useAuthStore.getState().user;
      if (cur) setUser({ ...cur, avatar });
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['nearby'] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      finish();
    },
    onError: (err) => {
      const e = toApiError(err);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      showToast(
        e.status === 400 ? e.message : !e.status ? 'Sem sinal com a gente agora. Tenta de novo?' : 'Não rolou salvar. Tenta de novo?',
      );
    },
  });

  // --- dados da aba ativa ---------------------------------------------------
  const slotDef = tab === 'skin' ? null : AVATAR_ITEM_SLOTS.find((s) => s.slot === tab) ?? null;
  const colorSlot: AvatarColorSlot | null = tab === 'skin' ? 'skin' : COLOR_OF_SLOT[tab] ?? null;
  const colorDef = colorSlot ? AVATAR_COLOR_SLOTS.find((s) => s.slot === colorSlot) ?? null : null;
  const tileMode = tab !== 'skin' && FULL_PREVIEW_SLOTS.has(tab) ? 'full' : 'bust';

  const title = fromOnboarding ? 'Monta o seu avatar' : 'Seu avatar';
  const subtitle = fromOnboarding ? 'É assim que você aparece no mapa. Dá pra mudar depois.' : 'É assim que te veem no mapa. Capricha 😉';
  const saving = save.isPending;

  return (
    <View style={styles.root}>
      <BlobBackground intensity={0.2} speed={0.8} palette={[colors.primary, colors.secondary, colors.info]} paused={!focused} />
      <LinearGradient
        colors={['rgba(10,10,26,0.25)', 'rgba(10,10,26,0.8)', 'rgba(10,10,26,0.98)']}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {/* topo */}
        <FadeInView delay={60} fromY={-6} style={styles.header}>
          {!fromOnboarding ? (
            <ScaleOnPress onPress={finish} haptic={false} accessibilityRole="button" accessibilityLabel="Voltar" style={styles.backBtn}>
              <Ionicons name="chevron-back" size={24} color={colors.white} />
            </ScaleOnPress>
          ) : null}
          <View style={styles.headerText}>
            <Text style={styles.title} accessibilityRole="header">
              {title}
            </Text>
            <Text style={styles.subtitle} numberOfLines={2}>
              {subtitle}
            </Text>
          </View>
        </FadeInView>

        {/* prévia */}
        <FadeInView delay={160} fromScale={0.92} style={styles.previewArea}>
          <Glow color={colors.primary} spread={26} intensity={0.28} shape="circle" cycleMs={3200}>
            <Animated.View style={popStyle}>
              <CruzeiAvatar config={config} mode="full" size={previewSize} groundShadow accessibilityLabel="Prévia do seu avatar" />
            </Animated.View>
          </Glow>
          <ScaleOnPress
            onPress={surprise}
            haptic={false}
            pressedScale={0.93}
            glowColor={colors.secondary}
            accessibilityRole="button"
            accessibilityLabel="Surpreender: sorteia um visual"
            style={styles.dice}
          >
            <Text style={styles.diceText}>🎲 Surpreender</Text>
          </ScaleOnPress>
        </FadeInView>

        {/* abas */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabs}
          style={styles.tabsScroll}
          accessibilityRole="tablist"
        >
          {TABS.map((t) => {
            const active = t.key === tab;
            return (
              <ScaleOnPress
                key={t.key}
                onPress={() => {
                  if (!active) {
                    Haptics.selectionAsync().catch(() => {});
                    setTab(t.key);
                  }
                }}
                haptic={false}
                pressedScale={0.95}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={t.label}
                style={active ? [styles.tab, styles.tabActive] : styles.tab}
              >
                <Text style={active ? [styles.tabText, styles.tabTextActive] : styles.tabText}>{t.label}</Text>
              </ScaleOnPress>
            );
          })}
        </ScrollView>

        {/* grade + cores */}
        <View style={styles.gridRegion}>
          <ScrollView contentContainerStyle={styles.gridScroll} showsVerticalScrollIndicator={false} key={tab}>
            {slotDef ? (
              <View style={styles.grid} accessibilityRole="radiogroup" accessibilityLabel={slotDef.label}>
                {slotDef.items.map((item) => (
                  <AvatarItemTile
                    key={item.id}
                    config={config}
                    slot={slotDef.slot as AvatarItemSlot}
                    itemId={item.id}
                    label={item.label}
                    tier={item.tier}
                    selected={config[slotDef.slot as AvatarItemSlot] === item.id}
                    locked={!allowedTiers.has(item.tier)}
                    mode={tileMode}
                    width={tileW}
                    onPress={(id, tier, locked) => select(slotDef.slot as AvatarItemSlot, id, tier, locked)}
                  />
                ))}
              </View>
            ) : null}

            {colorSlot && colorDef ? (
              <View style={tab === 'skin' ? styles.colorBlockSkin : styles.colorBlock}>
                <Text style={styles.colorLabel}>{colorDef.label}</Text>
                <View style={styles.swatches} accessibilityRole="radiogroup" accessibilityLabel={colorDef.label}>
                  {(tab === 'skin' ? SKIN_COLORS : colorDef.items).map((c) => (
                    <ColorSwatch
                      key={c.id}
                      color={c}
                      big={tab === 'skin'}
                      selected={config[colorSlot] === c.id}
                      locked={!allowedTiers.has(c.tier)}
                      onPress={() => select(colorSlot, c.id, c.tier, !allowedTiers.has(c.tier))}
                    />
                  ))}
                </View>
              </View>
            ) : null}
          </ScrollView>

          {toast ? (
            <FadeInView fromY={8} style={styles.toast} accessibilityLiveRegion="polite" accessibilityRole="alert">
              <Text style={styles.toastText}>{toast}</Text>
            </FadeInView>
          ) : null}
        </View>

        {/* rodapé */}
        <FadeInView delay={320} fromY={16} style={styles.footer}>
          <Glow color={colors.primary} spread={14} intensity={saving ? 0.2 : 0.5} animated={!saving} shape="pill" style={styles.stretch}>
            <ScaleOnPress
              onPress={() => save.mutate(config)}
              disabled={saving}
              glowColor={colors.primary}
              accessibilityRole="button"
              accessibilityLabel={fromOnboarding ? 'Continuar' : 'Salvar avatar'}
              accessibilityState={{ disabled: saving, busy: saving }}
              style={saving ? [styles.cta, styles.ctaBusy] : styles.cta}
            >
              {saving ? (
                <ActivityIndicator color={colors.black} />
              ) : (
                <>
                  <Text style={styles.ctaText}>{fromOnboarding ? 'Continuar' : 'Salvar avatar'}</Text>
                  <Ionicons name={fromOnboarding ? 'arrow-forward' : 'checkmark'} size={22} color={colors.black} />
                </>
              )}
            </ScaleOnPress>
          </Glow>
          {fromOnboarding ? (
            <ScaleOnPress
              onPress={finish}
              disabled={saving}
              haptic={false}
              accessibilityRole="button"
              accessibilityLabel="Pular por agora"
              accessibilityHint="Segue com o avatar padrão; dá pra personalizar depois no perfil"
              style={styles.skip}
            >
              <Text style={styles.skipText}>Pular por agora</Text>
            </ScaleOnPress>
          ) : null}
        </FadeInView>
      </SafeAreaView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Bolinha de cor
// ---------------------------------------------------------------------------

interface ColorSwatchProps {
  color: AvatarColorDef;
  selected: boolean;
  locked: boolean;
  /** tom de pele: bolinhas maiores numa grade que quebra linha */
  big?: boolean;
  onPress: () => void;
}

function ColorSwatch({ color, selected, locked, big = false, onPress }: ColorSwatchProps) {
  const ring = big ? styles.swatchRingBig : styles.swatchRing;
  const dot = big ? styles.swatchDotBig : styles.swatchDot;
  const a11y = `${color.label}${selected ? ', selecionada' : ''}${locked ? `, bloqueada, ${color.tier === 'event' ? 'item de evento' : 'exclusiva Premium'}` : ''}`;
  return (
    <ScaleOnPress
      onPress={onPress}
      haptic={false}
      pressedScale={0.9}
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      accessibilityLabel={a11y}
      style={styles.swatchHit}
    >
      <View style={selected ? [ring, styles.swatchRingSelected] : ring}>
        <View style={[dot, { backgroundColor: color.hex }, locked ? styles.swatchLocked : {}]} />
      </View>
      {locked ? <CruzeiPremiumBadge tier={color.tier === 'event' ? 'event' : 'premium'} compact style={styles.swatchBadge} /> : null}
    </ScaleOnPress>
  );
}

// ---------------------------------------------------------------------------
// Estilos
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.black },
  safe: { flex: 1 },
  stretch: { alignSelf: 'stretch' },

  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: H_PAD, paddingTop: spacing.sm },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -spacing.sm },
  headerText: { flex: 1 },
  title: { ...typography.h2, color: colors.white },
  subtitle: { ...typography.bodySmall, color: 'rgba(250,250,250,0.7)', marginTop: 2 },

  previewArea: { alignItems: 'center', justifyContent: 'center', marginTop: spacing.sm, marginBottom: spacing.sm },
  dice: {
    position: 'absolute',
    right: H_PAD,
    bottom: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: 'rgba(255,20,147,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(255,20,147,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  diceText: { ...typography.label, color: colors.white },

  tabsScroll: { flexGrow: 0 },
  tabs: { paddingHorizontal: H_PAD, gap: spacing.sm, paddingVertical: spacing.xs },
  tab: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: 'rgba(250,250,250,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(250,250,250,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { ...typography.label, color: colors.white },
  tabTextActive: { color: colors.black },

  gridRegion: { flex: 1 },
  gridScroll: { paddingHorizontal: H_PAD, paddingTop: spacing.sm, paddingBottom: spacing.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },

  colorBlock: { marginTop: spacing.lg },
  colorBlockSkin: { marginTop: spacing.xs },
  colorLabel: { ...typography.caption, color: 'rgba(250,250,250,0.55)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: spacing.xs },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  swatchHit: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  swatchRing: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  swatchRingBig: { width: 48, height: 48, borderRadius: 24, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  swatchRingSelected: { borderColor: colors.primary },
  swatchDot: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: 'rgba(250,250,250,0.25)' },
  swatchDotBig: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: 'rgba(250,250,250,0.25)' },
  swatchLocked: { opacity: 0.45 },
  swatchBadge: { position: 'absolute', top: 2, right: 2 },

  toast: {
    position: 'absolute',
    bottom: spacing.sm,
    alignSelf: 'center',
    maxWidth: '90%',
    backgroundColor: colors.black,
    borderWidth: 1,
    borderColor: 'rgba(250,250,250,0.2)',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    minHeight: 40,
    justifyContent: 'center',
  },
  toastText: { ...typography.bodySmall, color: colors.white, textAlign: 'center' },

  footer: {
    paddingHorizontal: H_PAD,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: 'rgba(250,250,250,0.08)',
  },
  cta: {
    height: 56,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  ctaBusy: { opacity: 0.7 },
  ctaText: { ...typography.h4, fontFamily: fontFamily.display, color: colors.black },
  skip: { height: 44, alignItems: 'center', justifyContent: 'center' },
  skipText: { ...typography.label, color: colors.gray[400] },
});
