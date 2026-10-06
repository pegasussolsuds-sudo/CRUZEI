import type { AvatarColorSlot, AvatarConfig, AvatarItemSlot, AvatarSlot } from '@cruzei/shared-types';
import {
  AVATAR_LOOKS,
  applyLook,
  avatarItem,
  avatarLookTier,
  avatarSlotDef,
  avatarTiersFor,
  normalizeAvatarConfig,
  type AvatarColorDef,
  type AvatarItemDef,
  type AvatarLookDef,
} from '@cruzei/shared-utils';
import { colors, fontFamily, radius, spacing, spring, typography } from '@cruzei/ui-mobile';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import React, { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, FlatList, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { keyOf, resolveAvatar } from '../../avatar';
import { emoteDef } from '../../avatar/emotes';
import { BlobBackground, FadeInView, Glow, ScaleOnPress } from '../../components/animated';
import { PressScale } from '../../components/animated/PressScale';
import { AvatarItemTile } from '../../components/avatar/AvatarItemTile';
import { CruzeiPremiumBadge } from '../../components/avatar/CruzeiPremiumBadge';
import { AvatarStage, useEmotePlayer } from '../../components/avatar/stage';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { api, toApiError } from '../../services/api';
import { useAuthStore } from '../../stores/auth';
import { clearAvatarDraft, loadAvatarDraft, peekAvatarDraft, saveAvatarDraft, type AvatarDraft } from '../../stores/avatarDraft';

import { CategoryBar, ChipRow, ColorRow, FlagChoice, FlagRow, H_PAD, LookCard, Swatch, cellWidth, colsFor, type ChipOpt } from './EditorControls';
import { ItemSheet, SavePanel } from './EditorSheets';
import {
  EDITOR_CATEGORIES,
  ITEM_FILTERS,
  applyItem,
  canUnlockWithPremium,
  categoryLabelOf,
  categoryOfTab,
  editorCategory,
  filterItems,
  lockedEntries,
  secondaryRows,
  surpriseConfig,
  tabKind,
  tabLabel,
  tileMode,
  type EditorCatKey,
  type EditorTab,
  type ItemFilter,
  type LockedEntry,
} from './editorModel';

type Nav = NativeStackNavigationProp<RootStackParamList, 'AvatarSetup'>;
type Route = RouteProp<RootStackParamList, 'AvatarSetup'>;

type SheetState = { kind: 'item'; slot: AvatarItemSlot; item: AvatarItemDef } | { kind: 'save'; entries: LockedEntry[] } | null;

const GAP = spacing.sm;
const TOAST_MS = 2800;
const DRAFT_SAVE_MS = 500;
const COLS = 4;

/** uma célula da grade (o tipo depende da aba) */
type Cell =
  | { t: 'item'; item: AvatarItemDef }
  | { t: 'color'; color: AvatarColorDef }
  | { t: 'flag'; item: AvatarItemDef }
  | { t: 'pron'; item: AvatarItemDef }
  | { t: 'look'; look: AvatarLookDef };

function cellKey(c: Cell): string {
  switch (c.t) {
    case 'color':
      return c.color.id;
    case 'look':
      return c.look.id;
    default:
      return c.item.id;
  }
}

function initialTab(draft: AvatarDraft | null): { cat: EditorCatKey; tab: EditorTab } {
  const cat = draft?.tab ? categoryOfTab(draft.tab) : null;
  return cat ? { cat: cat.key, tab: draft!.tab as EditorTab } : { cat: 'look', tab: 'body' };
}

// ---------------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------------

/**
 * AvatarSetup: "Monta o seu avatar" (pós-cadastro) / "Seu avatar" (vindo do perfil). Editor e loja do avatar.
 * - prévia grande animada (AvatarStage: respiração, fundo, pronomes) mostrando o que está sendo experimentado — inclusive
 *   itens bloqueados, com o selo "Prévia";
 * - categorias (AVATAR_CATEGORIES + Looks) → abas de slot → linhas contextuais (cores, intensidade, posição do pet,
 *   bandeira) → filtros → grade virtualizada de tiles (miniatura SVG estática, raridade, estado, Novo, Animado);
 * - ficha do item (toque longo / "i"), animações com Reproduzir/Pausar/Ver de novo, Surpreender;
 * - salvar com PATCH /me { avatar }; item bloqueado → painel "Ver Premium" ou "Salvar sem eles";
 * - rascunho guardado por conta (stores/avatarDraft) e restaurado ao voltar ("Rascunho restaurado · Descartar").
 */
export function AvatarCustomizerScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const fromOnboarding = route.params?.fromOnboarding ?? false;
  const focused = useIsFocused();
  const reduce = useReducedMotion();
  const qc = useQueryClient();
  const { width: screenW, height: screenH } = useWindowDimensions();

  const me = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const setOnboardingStep = useAuthStore((s) => s.setOnboardingStep);
  const userId = me?.id ?? null;

  const allowed = useMemo(() => avatarTiersFor(me?.premiumTier ?? 'free'), [me?.premiumTier]);
  const saved = useMemo(() => resolveAvatar(me?.avatar, me?.id ?? 'me', me?.gender), [me?.avatar, me?.id, me?.gender]);
  const savedKey = keyOf(saved);

  // --- rascunho: o da memória entra já (volta do Paywall sem piscar); o do aparelho chega logo depois -------------
  const [boot] = useState(() => {
    const known = userId ? peekAvatarDraft(userId) : null;
    const draft = known && keyOf(known.config) !== savedKey ? known : null;
    return { draft, pending: !!userId && known === undefined };
  });
  const [config, setConfig] = useState<AvatarConfig>(boot.draft?.config ?? saved);
  const [{ cat, tab }, setNav] = useState(() => initialTab(boot.draft));
  const [banner, setBanner] = useState(!!boot.draft);
  const [restoreDone, setRestoreDone] = useState(!boot.pending);
  const touched = useRef(false);
  const done = useRef(false);

  const [filter, setFilter] = useState<ItemFilter>('all');
  const [sheet, setSheet] = useState<SheetState>(null);
  const [trying, setTrying] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triedLockedOnce = useRef(false);

  const configKey = keyOf(config);
  const dirty = configKey !== savedKey;

  useEffect(() => {
    if (!boot.pending || !userId) return;
    let alive = true;
    loadAvatarDraft(userId).then((d) => {
      if (!alive) return;
      if (d && !touched.current && keyOf(d.config) !== savedKey) {
        setConfig(d.config);
        setNav(initialTab(d));
        setBanner(true);
      }
      setRestoreDone(true);
    });
    return () => {
      alive = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // grava o rascunho (memória já; aparelho com um respiro) e apaga quando volta a ser igual ao salvo
  const latest = useRef({ config, tab });
  latest.current = { config, tab };
  useEffect(() => {
    if (!userId || !restoreDone || done.current) return;
    if (!dirty) {
      if (peekAvatarDraft(userId)) void clearAvatarDraft(userId);
      return;
    }
    const id = setTimeout(() => void saveAvatarDraft(userId, latest.current.config, latest.current.tab), DRAFT_SAVE_MS);
    return () => clearTimeout(id);
  }, [configKey, dirty, userId, restoreDone]);
  // saiu sem salvar (voltar, gesto): o que estava na tela fica guardado
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(
    () => () => {
      if (userId && !done.current && dirtyRef.current) void saveAvatarDraft(userId, latest.current.config, latest.current.tab);
    },
    [userId],
  );

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

  /** a pessoa mexeu: o rascunho do aparelho não sobrescreve mais e o aviso some */
  const touch = useCallback(() => {
    touched.current = true;
    setBanner(false);
  }, []);

  // --- prévia: pop de escala a cada mudança ---------------------------------
  const pop = useSharedValue(1);
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (reduce) return;
    pop.value = 0.94;
    pop.value = withSpring(1, spring.bouncy);
  }, [configKey, pop, reduce]);
  useEffect(() => () => cancelAnimation(pop), [pop]);
  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));

  // --- animação da prévia -----------------------------------------------------
  // movimento reduzido: nada toca sozinho — a prévia mostra o quadro parado (keyK) e "Reproduzir" toca de verdade
  const player = useEmotePlayer();
  const [explicit, setExplicit] = useState(false);
  const emoteId = config.emote !== 'none' ? config.emote : null;
  const emote = emoteId ? emoteDef(emoteId) : null;
  const stillMode = reduce && !explicit;
  const { playing, play, pause, replay: replayEmote } = player;
  const onEmoteEnd = player.stageProps.onEmoteEnd;
  const isPlaying = playing && (!reduce || explicit);
  const stageEnd = useCallback(() => {
    onEmoteEnd();
    setExplicit(false);
  }, [onEmoteEnd]);
  const startEmote = useCallback(() => {
    if (reduce) setExplicit(false);
    else replayEmote();
  }, [reduce, replayEmote]);
  const togglePlay = useCallback(() => {
    if (isPlaying) {
      pause();
      setExplicit(false);
      return;
    }
    if (reduce) setExplicit(true);
    play();
  }, [isPlaying, pause, play, reduce]);
  const replay = useCallback(() => {
    if (reduce) setExplicit(true);
    replayEmote();
  }, [replayEmote, reduce]);

  // --- layout -----------------------------------------------------------------
  const stageSize = Math.max(170, Math.min(260, Math.round(screenH * 0.27)));
  const gridW = screenW - H_PAD * 2;
  const kind = tabKind(tab);
  const cols = kind === 'items' ? COLS : kind === 'colors' ? colsFor(gridW, 56, 4) : kind === 'flags' ? 3 : 2;
  const cellW = cellWidth(gridW, cols, kind === 'colors' ? 4 : GAP);

  // --- seleção --------------------------------------------------------------
  const pick = useCallback(
    (slot: AvatarSlot, id: string, label: string, locked: boolean) => {
      touch();
      Haptics.selectionAsync().catch(() => {});
      setConfig((c) => applyItem(c, slot, id));
      setTrying(label);
      if (locked && !triedLockedOnce.current) {
        triedLockedOnce.current = true;
        showToast('Experimentando ✨ Vê como fica antes de liberar.');
      }
    },
    [touch, showToast],
  );

  const onItem = useCallback(
    (slot: AvatarItemSlot, item: AvatarItemDef) => {
      pick(slot, item.id, item.label, !allowed.has(item.tier));
      if (slot === 'emote' && item.id !== 'none') {
        startEmote();
        if (emoteDef(item.id)?.needsPet && latest.current.config.pet === 'none') showToast('Essa fica mais fofa com um pet 🐾 (aba Pets)');
      }
    },
    [pick, allowed, startEmote, showToast],
  );
  const onInfo = useCallback((slot: AvatarItemSlot, item: AvatarItemDef) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setSheet({ kind: 'item', slot, item });
  }, []);
  const onColor = useCallback(
    (slot: AvatarColorSlot, id: string) => {
      const def = avatarSlotDef(slot).items.find((c) => c.id === id);
      if (def) pick(slot, id, def.label, !allowed.has(def.tier));
    },
    [pick, allowed],
  );
  const onLook = useCallback(
    (id: string) => {
      const look = AVATAR_LOOKS.find((l) => l.id === id);
      if (!look) return;
      touch();
      Haptics.selectionAsync().catch(() => {});
      setConfig((c) => applyLook(c, id));
      setTrying(`Look ${look.label}`);
      if (!allowed.has(avatarLookTier(id)) && !triedLockedOnce.current) {
        triedLockedOnce.current = true;
        showToast('Experimentando ✨ Vê como fica antes de liberar.');
      }
    },
    [touch, allowed, showToast],
  );

  const pickCat = useCallback((k: EditorCatKey) => {
    Haptics.selectionAsync().catch(() => {});
    startTransition(() => setNav({ cat: k, tab: editorCategory(k).tabs[0] }));
  }, []);
  const pickTab = useCallback(
    (t: string) => {
      Haptics.selectionAsync().catch(() => {});
      startTransition(() => setNav({ cat, tab: t as EditorTab }));
    },
    [cat],
  );

  const surprise = useCallback(() => {
    touch();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setConfig((c) => surpriseConfig(`${Date.now()}-${Math.random()}`, c, me?.gender, allowed));
    setTrying('Visual sorteado');
  }, [touch, me?.gender, allowed]);

  const discardDraft = useCallback(() => {
    touch();
    setConfig(saved);
    setTrying(null);
    if (userId) void clearAvatarDraft(userId);
  }, [touch, saved, userId]);

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
      done.current = true;
      if (userId) void clearAvatarDraft(userId);
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
      showToast(e.status === 400 ? e.message : !e.status ? 'Sem sinal com a gente agora. Tenta de novo?' : 'Não rolou salvar. Tenta de novo?');
    },
  });
  const saving = save.isPending;

  const locked = useMemo(() => lockedEntries(config, allowed), [config, allowed]);
  const onSave = useCallback(() => {
    if (locked.length) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      setSheet({ kind: 'save', entries: locked });
      return;
    }
    save.mutate(config);
  }, [locked, config, save]);
  const saveWithout = useCallback(() => {
    const clean = normalizeAvatarConfig(config, allowed);
    setSheet(null);
    setConfig(clean);
    save.mutate(clean);
  }, [config, allowed, save]);

  const skip = useCallback(() => {
    done.current = true;
    if (userId) void clearAvatarDraft(userId);
    finish();
  }, [userId, finish]);

  /** sai pro Paywall guardando o rascunho antes (a tela desmonta; na volta ele é restaurado) */
  const goPremium = useCallback(() => {
    if (userId) void saveAvatarDraft(userId, config, tab);
    done.current = true;
    setSheet(null);
    nav.navigate('Main', { screen: 'Paywall' }, { pop: true });
  }, [userId, config, tab, nav]);

  useEffect(() => {
    if (!sheet) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setSheet(null);
      return true;
    });
    return () => sub.remove();
  }, [sheet]);

  // --- dados da aba ativa -----------------------------------------------------
  const category = editorCategory(cat);
  const rows = useMemo(() => secondaryRows(category, tab, config), [category, tab, config]);
  const slotDef = kind === 'looks' ? null : avatarSlotDef(tab as AvatarSlot);
  const catLabel = tab === 'looks' ? 'Looks' : categoryLabelOf(tab as AvatarSlot);
  const filterable = kind === 'items' || kind === 'colors';

  const cells = useMemo<Cell[]>(() => {
    if (kind === 'looks') return AVATAR_LOOKS.map((look) => ({ t: 'look', look }));
    const def = avatarSlotDef(tab as AvatarSlot);
    if (kind === 'colors') return filterItems(def.items as AvatarColorDef[], filter, allowed).map((color) => ({ t: 'color', color }));
    const items = def.items as AvatarItemDef[];
    if (kind === 'flags') return items.map((item) => ({ t: 'flag', item }));
    if (kind === 'pronouns') return items.map((item) => ({ t: 'pron', item }));
    return filterItems(items, filter, allowed).map((item) => ({ t: 'item', item }));
  }, [kind, tab, filter, allowed]);

  const lookPreviews = useMemo(() => (kind === 'looks' ? new Map(AVATAR_LOOKS.map((l) => [l.id, applyLook(config, l.id)])) : null), [kind, config]);

  const renderCell = useCallback(
    ({ item: c }: { item: Cell }) => {
      switch (c.t) {
        case 'item': {
          const slot = tab as AvatarItemSlot;
          return (
            <AvatarItemTile
              config={config}
              slot={slot}
              item={c.item}
              category={catLabel}
              equipped={config[slot] === c.item.id}
              locked={!allowed.has(c.item.tier)}
              mode={tileMode(slot)}
              width={cellW}
              showBackdrop={slot === 'backdrop'}
              onPress={onItem}
              onInfo={onInfo}
            />
          );
        }
        case 'color': {
          const slot = tab as AvatarColorSlot;
          return (
            <View style={{ width: cellW, alignItems: 'center' }}>
              <Swatch color={c.color} big selected={config[slot] === c.color.id} locked={!allowed.has(c.color.tier)} onPick={(id) => onColor(slot, id)} />
            </View>
          );
        }
        case 'flag':
          return <FlagChoice tile width={cellW} flag={c.item} selected={config.prideFlag === c.item.id} onPick={(id) => pick('prideFlag', id, `Bandeira ${c.item.label}`, false)} />;
        case 'pron': {
          const on = config.pronouns === c.item.id;
          return (
            <PressScale
              onPress={() => pick('pronouns', c.item.id, c.item.id === 'none' ? 'Sem pronomes' : c.item.label, false)}
              haptic={false}
              accessibilityRole="radio"
              accessibilityState={{ selected: on, checked: on }}
              accessibilityLabel={`Pronomes: ${c.item.label}${on ? '. Selecionado' : ''}`}
              style={[styles.pron, { width: cellW }, on ? styles.pronOn : null]}
            >
              <Text style={[styles.pronText, on ? styles.pronTextOn : null]} numberOfLines={1}>
                {c.item.label}
              </Text>
            </PressScale>
          );
        }
        case 'look': {
          const preview = lookPreviews?.get(c.look.id) ?? config;
          const tier = avatarLookTier(c.look.id);
          return (
            <LookCard look={c.look} preview={preview} tier={tier} locked={!allowed.has(tier)} equipped={keyOf(preview) === configKey} width={cellW} onPick={onLook} />
          );
        }
      }
    },
    [tab, config, configKey, catLabel, allowed, cellW, onItem, onInfo, onColor, pick, lookPreviews, onLook],
  );

  // --- linhas de cima da grade (rolam junto) ------------------------------------
  const chipOpts = useMemo<ChipOpt[] | null>(() => {
    if (!rows.chips) return null;
    const s = rows.chips.slot;
    return rows.chips.ids.map((id) => {
      const it = avatarItem(s, id);
      return { key: id, label: it?.label ?? id, lockTier: it && !allowed.has(it.tier) ? it.tier : null, a11y: `${avatarSlotDef(s).label}: ${it?.label ?? id}` };
    });
  }, [rows.chips, allowed]);
  const filterOpts = useMemo<ChipOpt[]>(() => ITEM_FILTERS.map((f) => ({ key: f.key, label: f.label, a11y: `Mostrar: ${f.label}` })), []);

  const header = (
    <View style={styles.listHeader}>
      {rows.color ? (
        <ColorRow
          title={avatarSlotDef(rows.color).label}
          items={avatarSlotDef(rows.color).items}
          value={config[rows.color]}
          allowed={allowed}
          onPick={(id) => onColor(rows.color as AvatarColorSlot, id)}
        />
      ) : null}
      {rows.chips && chipOpts ? (
        <View style={styles.block}>
          <Text style={styles.blockTitle}>{avatarSlotDef(rows.chips.slot).label}</Text>
          <ChipRow
            small
            opts={chipOpts}
            active={config[rows.chips.slot]}
            label={avatarSlotDef(rows.chips.slot).label}
            onPick={(id) => {
              const s = rows.chips!.slot;
              const it = avatarItem(s, id);
              pick(s, id, it?.label ?? id, !!it && !allowed.has(it.tier));
            }}
          />
        </View>
      ) : null}
      {rows.flags ? (
        <FlagRow flags={avatarSlotDef('prideFlag').items} value={config.prideFlag} onPick={(id) => pick('prideFlag', id, `Bandeira ${avatarItem('prideFlag', id)?.label ?? ''}`, false)} />
      ) : null}
      {slotDef?.hint ? <Text style={styles.hint}>{slotDef.hint}</Text> : null}
      {kind === 'looks' ? <Text style={styles.hint}>Combinações prontas por estilo. Seu corpo, rosto, cabelo e pronomes continuam seus.</Text> : null}
      {filterable ? <ChipRow small role="radio" opts={filterOpts} active={filter} label="Filtro dos itens" onPick={(k) => setFilter(k as ItemFilter)} /> : null}
    </View>
  );

  const empty = (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{filter === 'new' ? 'Nada novo por aqui ainda.' : filter === 'premium' ? 'Esta aba não tem itens Premium.' : 'Nada por aqui com esse filtro.'}</Text>
      <PressScale onPress={() => setFilter('all')} haptic={false} accessibilityRole="button" accessibilityLabel="Ver todos os itens" style={styles.emptyBtn}>
        <Text style={styles.emptyBtnText}>Ver todos</Text>
      </PressScale>
    </View>
  );

  const tabOpts = useMemo<ChipOpt[]>(() => category.tabs.map((t) => ({ key: t, label: tabLabel(t) })), [category]);

  const title = fromOnboarding ? 'Monta o seu avatar' : 'Seu avatar';
  const previewLocked = locked.length > 0;
  const showTrying = dirty && !!trying;
  const showStatus = showTrying || previewLocked;
  const sheetItem = sheet?.kind === 'item' ? sheet : null;

  return (
    <View style={styles.root}>
      <BlobBackground intensity={0.2} speed={0.8} palette={[colors.primary, colors.secondary, colors.info]} paused={!focused || reduce} />
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
            <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
              {title}
            </Text>
            {screenH >= 760 ? (
              <Text style={styles.subtitle} numberOfLines={1}>
                {fromOnboarding ? 'É assim que você aparece no mapa. Dá pra mudar depois.' : 'É assim que te veem no mapa. Capricha 😉'}
              </Text>
            ) : null}
          </View>
          {fromOnboarding ? (
            <PressScale
              onPress={skip}
              disabled={saving}
              haptic={false}
              accessibilityRole="button"
              accessibilityLabel="Pular por agora"
              accessibilityHint="Segue com o avatar padrão; dá pra personalizar depois no perfil"
              style={styles.skip}
            >
              <Text style={styles.skipText}>Pular por agora</Text>
            </PressScale>
          ) : null}
        </FadeInView>

        {banner ? (
          <View style={styles.banner} accessibilityLiveRegion="polite">
            <Ionicons name="time-outline" size={16} color={colors.primary} />
            <Text style={styles.bannerText} numberOfLines={1}>
              Rascunho restaurado
            </Text>
            <PressScale onPress={discardDraft} haptic={false} accessibilityRole="button" accessibilityLabel="Descartar rascunho e voltar pro avatar salvo" style={styles.bannerBtn}>
              <Text style={styles.bannerBtnText}>Descartar</Text>
            </PressScale>
            <PressScale onPress={() => setBanner(false)} haptic={false} accessibilityRole="button" accessibilityLabel="Fechar aviso" style={styles.bannerClose}>
              <Ionicons name="close" size={18} color="rgba(250,250,250,0.7)" />
            </PressScale>
          </View>
        ) : null}

        {/* prévia */}
        <View style={[styles.previewArea, { height: stageSize + spacing.sm }]}>
          <Glow color={colors.primary} spread={22} intensity={0.22} shape="circle" cycleMs={3200} animated={!reduce}>
            <Animated.View style={popStyle}>
              <AvatarStage
                config={config}
                size={stageSize}
                mode="full"
                emote={emoteId}
                {...player.stageProps}
                onEmoteEnd={stageEnd}
                playing={stillMode ? !!emote : playing}
                loop={stillMode ? true : undefined}
                reduceMotion={stillMode}
                idle={!reduce}
                showBackdrop
                showPronouns
                paused={!focused}
                accessibilityLabel={`Prévia do seu avatar${previewLocked ? ', com itens em prévia' : ''}`}
              />
            </Animated.View>
          </Glow>

          {showStatus ? (
            <View style={styles.status} pointerEvents="none" accessibilityLiveRegion="polite">
              {showTrying ? <Text style={styles.statusCaption}>Experimentando</Text> : null}
              {showTrying ? (
                <Text style={styles.statusName} numberOfLines={2}>
                  {trying}
                </Text>
              ) : null}
              {previewLocked ? (
                <View style={styles.previewBadge} accessible accessibilityLabel={`Prévia: ${locked.length} ${locked.length > 1 ? 'itens bloqueados' : 'item bloqueado'}`}>
                  <Ionicons name="eye-outline" size={11} color={colors.black} />
                  <Text style={styles.previewBadgeText}>Prévia</Text>
                </View>
              ) : null}
            </View>
          ) : null}

          <View style={styles.sideActions}>
            <PressScale onPress={surprise} haptic={false} accessibilityRole="button" accessibilityLabel="Surpreender: sorteia um visual" style={styles.sideBtn}>
              <Text style={styles.sideEmoji}>🎲</Text>
              <Text style={styles.sideText}>Surpreender</Text>
            </PressScale>
            {emote ? (
              <>
                <PressScale onPress={togglePlay} haptic={false} accessibilityRole="button" accessibilityLabel={isPlaying ? 'Pausar animação' : 'Reproduzir animação'} style={styles.sideBtn}>
                  <Ionicons name={isPlaying ? 'pause' : 'play'} size={18} color={colors.primary} />
                  <Text style={styles.sideText}>{isPlaying ? 'Pausar' : 'Reproduzir'}</Text>
                </PressScale>
                <PressScale onPress={replay} haptic={false} accessibilityRole="button" accessibilityLabel="Ver a animação de novo" style={styles.sideBtn}>
                  <Ionicons name="refresh" size={18} color={colors.primary} />
                  <Text style={styles.sideText}>Ver de novo</Text>
                </PressScale>
              </>
            ) : null}
          </View>
        </View>

        {/* categorias + abas */}
        <CategoryBar cats={EDITOR_CATEGORIES} active={cat} onPick={pickCat} />
        {tabOpts.length > 1 ? <ChipRow role="tab" opts={tabOpts} active={tab} label={`Abas de ${category.label}`} onPick={pickTab} /> : null}

        {/* grade */}
        <View style={styles.gridRegion}>
          <FlatList
            key={`${tab}:${cols}`}
            data={cells}
            keyExtractor={cellKey}
            renderItem={renderCell}
            numColumns={cols}
            columnWrapperStyle={cols > 1 ? (kind === 'colors' ? styles.colorRowWrap : styles.rowWrap) : undefined}
            ListHeaderComponent={header}
            ListEmptyComponent={filterable ? empty : null}
            contentContainerStyle={styles.gridContent}
            showsVerticalScrollIndicator={false}
            initialNumToRender={cols * 3}
            maxToRenderPerBatch={cols * 2}
            windowSize={5}
            extraData={configKey}
            accessibilityLabel={tab === 'looks' ? 'Looks prontos' : slotDef?.label}
          />
          {toast ? (
            <View style={styles.toast} accessibilityLiveRegion="polite" accessibilityRole="alert">
              <Text style={styles.toastText}>{toast}</Text>
            </View>
          ) : null}
        </View>

        {/* rodapé */}
        <View style={styles.footer}>
          <ScaleOnPress
            onPress={onSave}
            disabled={saving}
            glowColor={colors.primary}
            accessibilityRole="button"
            accessibilityLabel={fromOnboarding ? 'Continuar' : 'Salvar avatar'}
            accessibilityHint={previewLocked ? 'Tem itens em prévia: você escolhe se libera ou salva sem eles' : undefined}
            accessibilityState={{ disabled: saving, busy: saving }}
            style={saving ? [styles.cta, styles.ctaBusy] : styles.cta}
          >
            {saving ? (
              <ActivityIndicator color={colors.black} />
            ) : (
              <>
                <Text style={styles.ctaText}>{fromOnboarding ? 'Continuar' : 'Salvar avatar'}</Text>
                {previewLocked ? <CruzeiPremiumBadge tier={locked.some((e) => e.tier === 'plus') ? 'plus' : locked.every((e) => e.tier === 'event') ? 'event' : 'premium'} compact /> : null}
                <Ionicons name={fromOnboarding ? 'arrow-forward' : 'checkmark'} size={22} color={colors.black} />
              </>
            )}
          </ScaleOnPress>
        </View>
      </SafeAreaView>

      {sheetItem ? (
        <ItemSheet
          slot={sheetItem.slot}
          item={sheetItem.item}
          config={config}
          equipped={config[sheetItem.slot] === sheetItem.item.id}
          locked={!allowed.has(sheetItem.item.tier)}
          fromOnboarding={fromOnboarding}
          reduceMotion={reduce}
          onTry={() => {
            onItem(sheetItem.slot, sheetItem.item);
            setSheet(null);
          }}
          onPremium={goPremium}
          onClose={() => setSheet(null)}
        />
      ) : null}
      {sheet?.kind === 'save' ? (
        <SavePanel
          entries={sheet.entries}
          canBuy={canUnlockWithPremium(sheet.entries)}
          fromOnboarding={fromOnboarding}
          reduceMotion={reduce}
          onPremium={goPremium}
          onSaveWithout={saveWithout}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Estilos
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.black },
  safe: { flex: 1 },

  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: H_PAD, paddingTop: spacing.xs, minHeight: 48 },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -spacing.sm },
  headerText: { flex: 1 },
  title: { ...typography.h3, color: colors.white },
  subtitle: { ...typography.bodySmall, color: 'rgba(250,250,250,0.7)', marginTop: 1 },
  skip: { minHeight: 44, paddingHorizontal: spacing.sm, alignItems: 'center', justifyContent: 'center' },
  skipText: { ...typography.label, color: colors.gray[300] },

  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginHorizontal: H_PAD,
    marginTop: spacing.xs,
    paddingLeft: spacing.md,
    borderRadius: radius.full,
    backgroundColor: 'rgba(127,255,0,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(127,255,0,0.4)',
  },
  bannerText: { ...typography.bodySmall, color: colors.white, flex: 1 },
  bannerBtn: { minHeight: 44, paddingHorizontal: spacing.sm, justifyContent: 'center' },
  bannerBtnText: { ...typography.label, color: colors.primary, textDecorationLine: 'underline' },
  bannerClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },

  previewArea: { alignItems: 'center', justifyContent: 'center', marginTop: spacing.xs },
  status: { position: 'absolute', left: H_PAD, top: spacing.xs, maxWidth: '27%', gap: 3 },
  statusCaption: { fontFamily: fontFamily.bodyBold, fontSize: 10, lineHeight: 13, letterSpacing: 1, textTransform: 'uppercase', color: colors.primary },
  statusName: { fontFamily: fontFamily.bodySemiBold, fontSize: 12, lineHeight: 16, color: colors.white },
  previewBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, alignSelf: 'flex-start', height: 18, paddingHorizontal: 6, borderRadius: radius.full, backgroundColor: colors.accent },
  previewBadgeText: { fontFamily: fontFamily.bodyBold, fontSize: 9, lineHeight: 12, letterSpacing: 0.4, textTransform: 'uppercase', color: colors.black },
  sideActions: { position: 'absolute', right: H_PAD - 4, top: 0, gap: spacing.xs, alignItems: 'center' },
  sideBtn: {
    width: 84,
    minHeight: 50,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
    backgroundColor: 'rgba(10,10,26,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(250,250,250,0.16)',
  },
  sideEmoji: { fontSize: 18, lineHeight: 22 },
  sideText: { fontFamily: fontFamily.bodySemiBold, fontSize: 11, lineHeight: 14, color: colors.white },

  gridRegion: { flex: 1 },
  gridContent: { paddingHorizontal: H_PAD, paddingTop: spacing.xs, paddingBottom: spacing.lg },
  rowWrap: { gap: GAP, marginBottom: GAP },
  colorRowWrap: { gap: 4, marginBottom: 4 },
  listHeader: { marginHorizontal: -H_PAD, marginBottom: spacing.sm },
  block: { marginBottom: spacing.sm },
  blockTitle: { ...typography.caption, color: 'rgba(250,250,250,0.62)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2, paddingHorizontal: H_PAD },
  hint: { ...typography.bodySmall, color: 'rgba(250,250,250,0.7)', paddingHorizontal: H_PAD, marginBottom: spacing.xs },

  pron: {
    minHeight: 44,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    backgroundColor: 'rgba(250,250,250,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(250,250,250,0.14)',
  },
  pronOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  pronText: { ...typography.label, color: colors.white },
  pronTextOn: { color: colors.black },

  empty: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.sm },
  emptyText: { ...typography.body, color: 'rgba(250,250,250,0.75)', textAlign: 'center' },
  emptyBtn: { minHeight: 44, paddingHorizontal: spacing.lg, borderRadius: radius.full, borderWidth: 1, borderColor: colors.primary, justifyContent: 'center' },
  emptyBtnText: { ...typography.label, color: colors.primary },

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
    borderTopWidth: 1,
    borderTopColor: 'rgba(250,250,250,0.08)',
  },
  cta: {
    height: 54,
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
});
