import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  Extrapolation,
  cancelAnimation,
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { BlurMask, Canvas, DashPathEffect, Group, RoundedRect } from '@shopify/react-native-skia';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { colors, fontFamily, radius, spacing, spring, typography } from '@cruzei/ui-mobile';
import type { User, UserPhoto } from '@cruzei/shared-types';
import { BlobBackground, FadeInView, Glow, Pulse, ScaleOnPress, SlideInView } from '../../components/animated';
import { api, toApiError } from '../../services/api';
import { pickPhoto, takePhoto, uploadPhoto } from '../../services/photos';
import { useAuthStore } from '../../stores/auth';
import type { RootStackParamList } from '../../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList, 'PhotoUpload'>;
type Route = RouteProp<RootStackParamList, 'PhotoUpload'>;

const MAX_PHOTOS = 6;
const COLS = 3;
const ROWS = 2;
const GAP = 10;
const H_PAD = spacing.xl;
const TILE_RADIUS = radius.lg;
const PREVIEW_W = 132;
const PREVIEW_H = 165;

type Positions = Record<string, number>;

// ---------------------------------------------------------------------------
// Helpers (UI thread)
// ---------------------------------------------------------------------------

function slotX(index: number, cellW: number): number {
  'worklet';
  return (index % COLS) * (cellW + GAP);
}

function slotY(index: number, cellH: number): number {
  'worklet';
  return Math.floor(index / COLS) * (cellH + GAP);
}

function clamp(v: number, lo: number, hi: number): number {
  'worklet';
  return Math.max(lo, Math.min(hi, v));
}

/** inclinação base por coluna — dá o efeito de "leque" empilhado em 3D */
function baseTiltY(index: number): number {
  'worklet';
  const col = index % COLS;
  return (1 - col) * 5;
}

function hapticLift() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}
function hapticSwap() {
  Haptics.selectionAsync().catch(() => {});
}
function hapticSuccess() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

// ---------------------------------------------------------------------------
// NeonFrame — borda neon com blur real (Skia) + "luz" que percorre a moldura.
// Local desta tela: o Glow compartilhado só desenha círculo/pílula.
// ---------------------------------------------------------------------------

interface NeonFrameProps {
  width: number;
  height: number;
  r: number;
  color: string;
  paused?: boolean;
}

function NeonFrame({ width, height, r, color, paused = false }: NeonFrameProps) {
  const t = useSharedValue(0);
  const sweep = useSharedValue(0);
  const pad = 28;
  // perímetro aproximado do retângulo arredondado — pro traço de luz dar a volta completa
  const perimeter = 2 * (width + height) - (8 - 2 * Math.PI) * r;

  useEffect(() => {
    if (paused) {
      cancelAnimation(t);
      cancelAnimation(sweep);
      return;
    }
    t.value = withRepeat(withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.sin) }), -1, true);
    sweep.value = withRepeat(withTiming(1, { duration: 3200, easing: Easing.linear }), -1, false);
    return () => {
      cancelAnimation(t);
      cancelAnimation(sweep);
    };
  }, [paused, sweep, t]);

  const haloOpacity = useDerivedValue(() => 0.45 + 0.45 * t.value);
  const phase = useDerivedValue(() => -sweep.value * perimeter);

  return (
    <Canvas
      pointerEvents="none"
      style={{ position: 'absolute', left: -pad, top: -pad, width: width + pad * 2, height: height + pad * 2 }}
    >
      <Group opacity={haloOpacity}>
        <RoundedRect x={pad} y={pad} width={width} height={height} r={r} color={color} style="stroke" strokeWidth={7}>
          <BlurMask blur={16} style="normal" />
        </RoundedRect>
      </Group>
      <RoundedRect x={pad} y={pad} width={width} height={height} r={r} color={color} style="stroke" strokeWidth={2} />
      <RoundedRect
        x={pad}
        y={pad}
        width={width}
        height={height}
        r={r}
        color={colors.white}
        style="stroke"
        strokeWidth={2.5}
        strokeCap="round"
      >
        <DashPathEffect intervals={[46, Math.max(1, perimeter - 46)]} phase={phase} />
        <BlurMask blur={2} style="solid" />
      </RoundedRect>
    </Canvas>
  );
}

// ---------------------------------------------------------------------------
// MainPreview — card principal flutuando em 3D com moldura neon magenta
// ---------------------------------------------------------------------------

interface MainPreviewProps {
  photo: UserPhoto | null;
  paused: boolean;
}

function MainPreview({ photo, paused }: MainPreviewProps) {
  const float = useSharedValue(0);

  useEffect(() => {
    if (paused) {
      cancelAnimation(float);
      return;
    }
    float.value = withRepeat(withTiming(1, { duration: 3400, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => cancelAnimation(float);
  }, [float, paused]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { perspective: 900 },
      { translateY: -4 * float.value },
      { rotateY: `${-6 + 12 * float.value}deg` },
      { rotateX: `${3 - 5 * float.value}deg` },
    ],
  }));

  return (
    <Animated.View style={[styles.previewWrap, style]}>
      <NeonFrame width={PREVIEW_W} height={PREVIEW_H} r={TILE_RADIUS} color={colors.secondary} paused={paused} />
      <View style={styles.previewCard}>
        {photo ? (
          <FadeInView key={photo.url} fromScale={0.92} durationMs={260} style={StyleSheet.absoluteFillObject}>
            <Image source={{ uri: photo.thumbnailUrl ?? photo.url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          </FadeInView>
        ) : (
          <View style={styles.previewEmpty}>
            <Pulse maxScale={1.12} cycleMs={1400}>
              <Ionicons name="person" size={44} color="rgba(250,250,250,0.35)" />
            </Pulse>
          </View>
        )}
        {photo ? (
          <View style={styles.previewBadge}>
            <Ionicons name="star" size={11} color={colors.black} />
            <Text style={styles.previewBadgeText}>principal</Text>
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// PhotoTile — card arrastável com perspectiva 3D
// ---------------------------------------------------------------------------

interface PhotoTileProps {
  photo: UserPhoto;
  initialIndex: number;
  count: number;
  cellW: number;
  cellH: number;
  positions: SharedValue<Positions>;
  dragActive: SharedValue<boolean>;
  entryDelay: number;
  onTap: (photo: UserPhoto) => void;
  onDrop: (positions: Positions) => void;
}

function PhotoTile({
  photo,
  initialIndex,
  count,
  cellW,
  cellH,
  positions,
  dragActive,
  entryDelay,
  onTap,
  onDrop,
}: PhotoTileProps) {
  const id = photo.id;
  const tx = useSharedValue(slotX(initialIndex, cellW));
  const ty = useSharedValue(slotY(initialIndex, cellH));
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const dragging = useSharedValue(false);
  const lift = useSharedValue(0);
  const tilt = useSharedValue(0);
  const press = useSharedValue(0);
  const enter = useSharedValue(0);

  // entrada: fade + zoom + bounce
  useEffect(() => {
    enter.value = withDelay(entryDelay, withSpring(1, spring.bouncy));
    return () => {
      cancelAnimation(enter);
      cancelAnimation(tx);
      cancelAnimation(ty);
      cancelAnimation(lift);
      cancelAnimation(tilt);
      cancelAnimation(press);
    };
  }, [enter, entryDelay, lift, press, tilt, tx, ty]);

  // quando alguém troca de lugar comigo (ou a grade muda), deslizo pro meu novo slot
  useAnimatedReaction(
    () => positions.value[id],
    (idx, prev) => {
      if (idx === undefined || dragging.value) return;
      if (prev === null || prev === undefined || idx !== prev) {
        tx.value = withSpring(slotX(idx, cellW), spring.soft);
        ty.value = withSpring(slotY(idx, cellH), spring.soft);
      }
    },
    [cellW, cellH, id],
  );

  const pan = Gesture.Pan()
    .activateAfterLongPress(200)
    .onStart(() => {
      const idx = positions.value[id] ?? 0;
      dragging.value = true;
      dragActive.value = true;
      startX.value = slotX(idx, cellW);
      startY.value = slotY(idx, cellH);
      tx.value = startX.value;
      ty.value = startY.value;
      lift.value = withSpring(1, spring.snappy);
      runOnJS(hapticLift)();
    })
    .onUpdate((e) => {
      tx.value = startX.value + e.translationX;
      ty.value = startY.value + e.translationY;
      tilt.value = interpolate(e.translationX, [-120, 120], [-10, 10], Extrapolation.CLAMP);

      const cx = tx.value + cellW / 2;
      const cy = ty.value + cellH / 2;
      const col = clamp(Math.floor(cx / (cellW + GAP)), 0, COLS - 1);
      const row = clamp(Math.floor(cy / (cellH + GAP)), 0, ROWS - 1);
      const next = clamp(row * COLS + col, 0, count - 1);
      const cur = positions.value[id] ?? 0;
      if (next === cur) return;

      const updated: Positions = {};
      const keys = Object.keys(positions.value);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const v = positions.value[k];
        if (k === id) continue;
        if (cur < next && v > cur && v <= next) updated[k] = v - 1;
        else if (cur > next && v >= next && v < cur) updated[k] = v + 1;
        else updated[k] = v;
      }
      updated[id] = next;
      positions.value = updated;
      runOnJS(hapticSwap)();
    })
    .onEnd(() => {
      const idx = positions.value[id] ?? 0;
      tx.value = withSpring(slotX(idx, cellW), spring.soft);
      ty.value = withSpring(slotY(idx, cellH), spring.soft);
      runOnJS(onDrop)(positions.value);
    })
    .onFinalize(() => {
      dragging.value = false;
      dragActive.value = false;
      lift.value = withSpring(0, spring.soft);
      tilt.value = withSpring(0, spring.soft);
    });

  const tap = Gesture.Tap()
    .maxDuration(190)
    .onBegin(() => {
      press.value = withTiming(1, { duration: 90 });
    })
    .onFinalize(() => {
      press.value = withSpring(0, spring.press);
    })
    .onEnd(() => {
      runOnJS(onTap)(photo);
    });

  const gesture = Gesture.Race(pan, tap);

  const animated = useAnimatedStyle(() => {
    const idx = positions.value[id] ?? initialIndex;
    const entryScale = 0.55 + 0.45 * enter.value;
    const scale = entryScale * (1 + 0.06 * lift.value) * (1 - 0.04 * press.value);
    const rotY = baseTiltY(idx) * (1 - lift.value) + tilt.value;
    const rotX = 4 * (1 - lift.value);
    const base: Record<string, unknown> = {
      opacity: Math.min(1, enter.value * 1.3),
      zIndex: dragging.value ? 100 : 1,
      transform: [
        { translateX: tx.value },
        { translateY: ty.value },
        { perspective: 900 },
        { rotateX: `${rotX}deg` },
        { rotateY: `${rotY}deg` },
        { scale },
      ],
    };
    if (Platform.OS === 'android') base.elevation = 3 + 12 * lift.value;
    else {
      base.shadowOpacity = 0.28 + 0.4 * lift.value;
      base.shadowRadius = 8 + 14 * lift.value;
    }
    return base;
  });

  const label = `Foto ${initialIndex + 1} de ${count}${photo.isMain ? ', principal' : ''}. Toque pra opções, segure e arraste pra reordenar`;

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        accessible
        accessibilityRole="button"
        accessibilityLabel={label}
        style={[styles.tile, { width: cellW, height: cellH }, animated]}
      >
        <View style={styles.tileInner}>
          <Image source={{ uri: photo.thumbnailUrl ?? photo.url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          <LinearGradient
            colors={['rgba(10,10,26,0)', 'rgba(10,10,26,0.55)']}
            locations={[0.55, 1]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <View style={styles.tileIndex}>
            <Text style={styles.tileIndexText}>{initialIndex + 1}</Text>
          </View>
          {photo.isMain ? (
            <View style={styles.tileStar}>
              <Ionicons name="star" size={12} color={colors.black} />
            </View>
          ) : null}
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

// ---------------------------------------------------------------------------
// EmptyTile — slot vazio com "+" pulsante
// ---------------------------------------------------------------------------

interface EmptyTileProps {
  index: number;
  cellW: number;
  cellH: number;
  isNext: boolean;
  uploadingUri: string | null;
  entryDelay: number;
  onPress: () => void;
}

function EmptyTile({ index, cellW, cellH, isNext, uploadingUri, entryDelay, onPress }: EmptyTileProps) {
  const left = slotX(index, cellW);
  const top = slotY(index, cellH);
  const tiltY = baseTiltY(index);

  return (
    <FadeInView
      delay={entryDelay}
      fromScale={0.85}
      style={[styles.emptyWrap, { left, top, width: cellW, height: cellH }]}
    >
      <View style={[styles.emptyPerspective, { transform: [{ perspective: 900 }, { rotateX: '4deg' }, { rotateY: `${tiltY}deg` }] }]}>
        {uploadingUri ? (
          <View style={[styles.emptyTile, styles.uploadingTile]}>
            <Image source={{ uri: uploadingUri }} style={[StyleSheet.absoluteFill, { opacity: 0.45 }]} resizeMode="cover" />
            <ActivityIndicator color={colors.secondary} />
            <Text style={styles.uploadingText}>subindo…</Text>
          </View>
        ) : (
          <ScaleOnPress
            onPress={onPress}
            pressedScale={0.94}
            accessibilityRole="button"
            accessibilityLabel={isNext ? 'Adicionar foto' : `Slot ${index + 1} vazio, adicionar foto`}
            style={isNext ? [styles.emptyTile, styles.emptyTileNext] : styles.emptyTile}
          >
            <Pulse active={isNext} maxScale={1.18} cycleMs={1300} minOpacity={0.75}>
              <View style={[styles.plusCircle, isNext ? styles.plusCircleNext : null]}>
                <Ionicons name="add" size={isNext ? 26 : 20} color={isNext ? colors.black : 'rgba(250,250,250,0.55)'} />
              </View>
            </Pulse>
          </ScaleOnPress>
        )}
      </View>
    </FadeInView>
  );
}

// ---------------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------------

/**
 * PhotoUpload: "Mostra sua cara 😎".
 * Preview principal com moldura neon magenta (Skia), grade 3x2 de cards 3D arrastáveis
 * (Pan + Reanimated na UI thread, haptics ao trocar de posição), foto entra com fade + zoom + bounce,
 * slot vazio com "+" pulsante, Câmera/Galeria com ScaleOnPress e CTA com Glow.
 */
export function PhotoUploadScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<Route>();
  const fromOnboarding = route.params?.fromOnboarding ?? false;
  const focused = useIsFocused();
  const qc = useQueryClient();
  const { width: screenW } = useWindowDimensions();
  const setUser = useAuthStore((s) => s.setUser);

  const gridW = screenW - H_PAD * 2;
  const cellW = Math.floor((gridW - GAP * (COLS - 1)) / COLS);
  const cellH = Math.round(cellW * 1.25);
  const gridH = ROWS * cellH + (ROWS - 1) * GAP;

  const [uploadingUri, setUploadingUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showError = useCallback((msg: string) => {
    setError(msg);
    if (errorTimer.current) clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setError(null), 4200);
  }, []);
  useEffect(() => () => {
    if (errorTimer.current) clearTimeout(errorTimer.current);
  }, []);

  // --- dados ---------------------------------------------------------------
  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get<User>('/me')).data,
    placeholderData: () => useAuthStore.getState().user ?? undefined,
  });

  useEffect(() => {
    if (meQuery.data && !meQuery.isPlaceholderData) setUser(meQuery.data);
  }, [meQuery.data, meQuery.isPlaceholderData, setUser]);

  const photos = useMemo<UserPhoto[]>(
    () => [...(meQuery.data?.photos ?? [])].sort((a, b) => a.orderIndex - b.orderIndex).slice(0, MAX_PHOTOS),
    [meQuery.data?.photos],
  );
  const count = photos.length;
  const isFull = count >= MAX_PHOTOS;
  const mainPhoto = photos.find((p) => p.isMain) ?? photos[0] ?? null;

  // posições (id → slot) na UI thread; sincroniza quando a lista do servidor muda
  const positions = useSharedValue<Positions>({});
  const dragActive = useSharedValue(false);
  const idsKey = photos.map((p) => p.id).join(',');
  useEffect(() => {
    const next: Positions = {};
    photos.forEach((p, i) => {
      next[p.id] = i;
    });
    positions.value = next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, positions]);

  const patchMe = useCallback(
    (updater: (me: User) => User) => {
      qc.setQueryData<User>(['me'], (old) => (old ? updater(old) : old));
    },
    [qc],
  );
  const invalidateMe = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['me'] });
  }, [qc]);

  const addMutation = useMutation({
    mutationFn: async (uri: string) => {
      const up = await uploadPhoto(uri);
      await api.post('/me/photos', { url: up.url, thumbnailUrl: up.thumbnailUrl });
    },
    onSuccess: () => {
      hapticSuccess();
    },
    onError: (err) => {
      const e = toApiError(err);
      showError(e.status === 413 ? 'Essa foto tá pesada demais. Tenta outra?' : 'Deu ruim no upload. Tenta de novo?');
    },
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: ['me'] });
      setUploadingUri(null);
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (photoId: string) => {
      await api.delete(`/me/photos/${photoId}`);
    },
    onMutate: async (photoId) => {
      await qc.cancelQueries({ queryKey: ['me'] });
      const prev = qc.getQueryData<User>(['me']);
      patchMe((me) => ({ ...me, photos: me.photos.filter((p) => p.id !== photoId) }));
      return { prev };
    },
    onError: (err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(['me'], ctx.prev);
      showError(toApiError(err).message || 'Não rolou remover. Tenta de novo?');
    },
    onSettled: invalidateMe,
  });

  const mainMutation = useMutation({
    mutationFn: async (photoId: string) => {
      await api.put(`/me/photos/${photoId}/main`);
    },
    onMutate: async (photoId) => {
      await qc.cancelQueries({ queryKey: ['me'] });
      const prev = qc.getQueryData<User>(['me']);
      patchMe((me) => ({ ...me, photos: me.photos.map((p) => ({ ...p, isMain: p.id === photoId })) }));
      hapticSuccess();
      return { prev };
    },
    onError: (err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(['me'], ctx.prev);
      showError(toApiError(err).message || 'Não deu pra trocar a principal.');
    },
    onSettled: invalidateMe,
  });

  const reorderMutation = useMutation({
    mutationFn: async (photoIds: string[]) => {
      await api.put('/me/photos/reorder', { photoIds });
    },
    onMutate: async (photoIds) => {
      await qc.cancelQueries({ queryKey: ['me'] });
      const prev = qc.getQueryData<User>(['me']);
      patchMe((me) => ({
        ...me,
        photos: me.photos.map((p) => ({ ...p, orderIndex: Math.max(0, photoIds.indexOf(p.id)) })),
      }));
      return { prev };
    },
    onError: (err, _ids, ctx) => {
      if (ctx?.prev) qc.setQueryData(['me'], ctx.prev);
      showError(toApiError(err).message || 'A ordem não salvou. Tenta de novo?');
    },
    onSettled: invalidateMe,
  });

  // --- ações ---------------------------------------------------------------
  const addFrom = useCallback(
    async (picker: () => Promise<string | null>) => {
      if (isFull || uploadingUri) return;
      try {
        const uri = await picker();
        if (!uri) return;
        setUploadingUri(uri);
        addMutation.mutate(uri);
      } catch {
        showError('Não consegui abrir a foto. Tenta de novo?');
      }
    },
    [addMutation, isFull, showError, uploadingUri],
  );

  const chooseSource = useCallback(() => {
    if (isFull) {
      showError('Tá cheio! 6 fotos é o máximo 😎');
      return;
    }
    Alert.alert('Nova foto', 'De onde vem essa?', [
      { text: 'Câmera', onPress: () => void addFrom(takePhoto) },
      { text: 'Galeria', onPress: () => void addFrom(pickPhoto) },
      { text: 'Cancelar', style: 'cancel' },
    ]);
  }, [addFrom, isFull, showError]);

  const onTilePress = useCallback(
    (photo: UserPhoto) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      Alert.alert('Essa foto', photo.isMain ? 'É a sua principal ⭐' : 'O que fazemos com ela?', [
        ...(!photo.isMain ? [{ text: 'Usar como principal', onPress: () => mainMutation.mutate(photo.id) }] : []),
        {
          text: 'Remover',
          style: 'destructive' as const,
          onPress: () => removeMutation.mutate(photo.id),
        },
        { text: 'Deixa quieto', style: 'cancel' as const },
      ]);
    },
    [mainMutation, removeMutation],
  );

  const onDrop = useCallback(
    (pos: Positions) => {
      const ordered = Object.keys(pos).sort((a, b) => (pos[a] ?? 0) - (pos[b] ?? 0));
      const current = photos.map((p) => p.id);
      if (ordered.length !== current.length || ordered.every((id, i) => id === current[i])) return;
      reorderMutation.mutate(ordered);
    },
    [photos, reorderMutation],
  );

  const finish = useCallback(() => {
    // pós-cadastro essa é a única rota da pilha (sem params): não tem pra onde voltar, vai pro mapa
    if (fromOnboarding || !nav.canGoBack()) nav.replace('Main');
    else nav.goBack();
    useAuthStore.getState().clearPhotoOnboarding();
  }, [fromOnboarding, nav]);

  // dica "segura e arrasta" some enquanto arrasta
  const hintStyle = useAnimatedStyle(() => ({
    opacity: withTiming(dragActive.value ? 0 : 1, { duration: 150 }),
  }));

  const canContinue = count > 0 && !uploadingUri;
  const isBusy = meQuery.isLoading && !meQuery.data;

  return (
    <View style={styles.root}>
      <BlobBackground
        intensity={0.3}
        palette={[colors.secondary, colors.primary, colors.info]}
        paused={!focused}
      />
      <LinearGradient
        colors={['rgba(10,10,26,0.2)', 'rgba(10,10,26,0.85)', 'rgba(10,10,26,0.98)']}
        locations={[0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* topo */}
          <FadeInView delay={60} fromY={-6} style={styles.topRow}>
            {!fromOnboarding ? (
              <ScaleOnPress
                onPress={() => nav.goBack()}
                haptic={false}
                accessibilityRole="button"
                accessibilityLabel="Voltar"
                style={styles.backBtn}
              >
                <Ionicons name="chevron-back" size={24} color={colors.white} />
              </ScaleOnPress>
            ) : (
              <View style={styles.backBtn} />
            )}
            <View style={styles.counterChip}>
              <Ionicons name="images-outline" size={14} color={colors.primary} />
              <Text style={styles.counterText}>
                {count}/{MAX_PHOTOS}
              </Text>
            </View>
          </FadeInView>

          <FadeInView delay={140} fromY={10}>
            <Text style={styles.title} accessibilityRole="header">
              Mostra sua cara 😎
            </Text>
          </FadeInView>
          <SlideInView from="up" distance={14} delay={260}>
            <Text style={styles.subtitle}>
              Quem te cruzou quer te reconhecer. Até {MAX_PHOTOS} fotos — a principal é a que brilha no mapa.
            </Text>
          </SlideInView>

          {/* preview principal */}
          <FadeInView delay={380} fromScale={0.9} style={styles.previewRow}>
            <MainPreview photo={mainPhoto} paused={!focused} />
            <View style={styles.previewInfo}>
              <Text style={styles.previewLabel}>{mainPhoto ? 'Sua foto principal' : 'Ainda sem foto'}</Text>
              <Text style={styles.previewHint}>
                {mainPhoto
                  ? 'É ela que aparece no mapa pra quem te cruzou. Capricha 😉'
                  : 'Bora mostrar esse sorriso? Uma já basta pra começar.'}
              </Text>
              {count > 1 ? (
                <Text style={styles.previewTip}>Toque numa foto pra torná-la principal ⭐</Text>
              ) : null}
            </View>
          </FadeInView>

          {/* grade */}
          <View style={[styles.grid, { height: gridH }]}>
            {isBusy ? (
              <View style={styles.loading}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : (
              <>
                {Array.from({ length: MAX_PHOTOS - count }, (_, i) => {
                  const index = count + i;
                  return (
                    <EmptyTile
                      key={`empty-${index}`}
                      index={index}
                      cellW={cellW}
                      cellH={cellH}
                      isNext={i === 0 && !uploadingUri}
                      uploadingUri={i === 0 ? uploadingUri : null}
                      entryDelay={480 + index * 60}
                      onPress={chooseSource}
                    />
                  );
                })}
                {photos.map((p, i) => (
                  <PhotoTile
                    key={p.id}
                    photo={p}
                    initialIndex={i}
                    count={count}
                    cellW={cellW}
                    cellH={cellH}
                    positions={positions}
                    dragActive={dragActive}
                    entryDelay={i * 70}
                    onTap={onTilePress}
                    onDrop={onDrop}
                  />
                ))}
              </>
            )}
          </View>

          <Animated.View style={[styles.hintRow, hintStyle]}>
            {count > 1 ? (
              <>
                <Ionicons name="move-outline" size={14} color={colors.gray[500]} />
                <Text style={styles.hint}>Segura e arrasta pra mudar a ordem</Text>
              </>
            ) : null}
          </Animated.View>

          {error ? (
            <FadeInView fromY={6} style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color={colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </FadeInView>
          ) : null}

          {/* Câmera / Galeria */}
          <FadeInView delay={720} fromY={12} style={styles.sourceRow}>
            <ScaleOnPress
              onPress={() => void addFrom(takePhoto)}
              disabled={isFull || !!uploadingUri}
              glowColor={colors.secondary}
              accessibilityRole="button"
              accessibilityLabel="Tirar foto com a câmera"
              accessibilityState={{ disabled: isFull || !!uploadingUri }}
              style={isFull ? [styles.sourceBtn, styles.sourceBtnOutline, styles.disabled] : [styles.sourceBtn, styles.sourceBtnOutline]}
            >
              <Ionicons name="camera-outline" size={20} color={colors.white} />
              <Text style={styles.sourceText}>Câmera</Text>
            </ScaleOnPress>
            <ScaleOnPress
              onPress={() => void addFrom(pickPhoto)}
              disabled={isFull || !!uploadingUri}
              glowColor={colors.secondary}
              accessibilityRole="button"
              accessibilityLabel="Escolher foto da galeria"
              accessibilityState={{ disabled: isFull || !!uploadingUri }}
              style={isFull ? [styles.sourceBtn, styles.sourceBtnFilled, styles.disabled] : [styles.sourceBtn, styles.sourceBtnFilled]}
            >
              <Ionicons name="images" size={20} color={colors.white} />
              <Text style={styles.sourceText}>Galeria</Text>
            </ScaleOnPress>
          </FadeInView>
          {isFull ? (
            <FadeInView fromY={4}>
              <Text style={styles.fullText}>6 de 6 — tá lindo demais 😎</Text>
            </FadeInView>
          ) : null}
        </ScrollView>

        {/* rodapé */}
        <FadeInView delay={860} fromY={16} style={styles.footer}>
          <Glow
            color={colors.primary}
            spread={14}
            intensity={canContinue ? 0.55 : 0}
            animated={canContinue}
            shape="pill"
            style={{ alignSelf: 'stretch' }}
          >
            <ScaleOnPress
              onPress={finish}
              disabled={!canContinue}
              glowColor={canContinue ? colors.primary : undefined}
              accessibilityRole="button"
              accessibilityLabel={canContinue ? 'Continuar' : 'Continuar, adicione ao menos uma foto'}
              accessibilityState={{ disabled: !canContinue }}
              style={canContinue ? styles.cta : [styles.cta, styles.ctaDisabled]}
            >
              <Text style={[styles.ctaText, !canContinue ? styles.ctaTextDisabled : null]}>
                {count === 0 ? 'Adiciona uma foto pra continuar' : 'Continuar'}
              </Text>
              {canContinue ? <Ionicons name="arrow-forward" size={22} color={colors.black} /> : null}
            </ScaleOnPress>
          </Glow>
          <ScaleOnPress
            onPress={finish}
            haptic={false}
            accessibilityRole="button"
            accessibilityLabel="Pular por agora"
            style={styles.skip}
          >
            <Text style={styles.skipText}>Pular por agora</Text>
          </ScaleOnPress>
        </FadeInView>
      </SafeAreaView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Estilos
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.black },
  safe: { flex: 1 },
  scroll: { paddingHorizontal: H_PAD, paddingBottom: spacing.lg },

  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.sm,
    marginBottom: spacing.md,
  },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginLeft: -spacing.sm },
  counterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 32,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: 'rgba(250,250,250,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(127,255,0,0.35)',
  },
  counterText: { fontFamily: fontFamily.mono, fontSize: 13, color: colors.primary },

  title: { ...typography.h1, color: colors.white },
  subtitle: { ...typography.body, color: colors.white, opacity: 0.72, marginTop: spacing.xs },

  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    marginTop: spacing.xl,
    marginBottom: spacing.xl,
    paddingLeft: spacing.xs,
  },
  previewWrap: { width: PREVIEW_W, height: PREVIEW_H },
  previewCard: {
    width: PREVIEW_W,
    height: PREVIEW_H,
    borderRadius: TILE_RADIUS,
    overflow: 'hidden',
    backgroundColor: colors.gray[800],
  },
  previewEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  previewBadge: {
    position: 'absolute',
    left: spacing.sm,
    bottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    height: 22,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
  previewBadgeText: { ...typography.caption, color: colors.black },
  previewInfo: { flex: 1, gap: spacing.xs },
  previewLabel: { ...typography.h4, color: colors.white },
  previewHint: { ...typography.body, color: colors.white, opacity: 0.7 },
  previewTip: { ...typography.bodySmall, color: colors.accent, marginTop: spacing.xs },

  grid: { width: '100%', position: 'relative' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  tile: {
    position: 'absolute',
    left: 0,
    top: 0,
    borderRadius: TILE_RADIUS,
    backgroundColor: colors.gray[800],
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.28,
    shadowRadius: 8,
    elevation: 3,
  },
  tileInner: { flex: 1, borderRadius: TILE_RADIUS, overflow: 'hidden' },
  tileIndex: {
    position: 'absolute',
    left: spacing.sm,
    top: spacing.sm,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: radius.full,
    backgroundColor: 'rgba(10,10,26,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileIndexText: { fontFamily: fontFamily.mono, fontSize: 11, color: colors.white },
  tileStar: {
    position: 'absolute',
    right: spacing.sm,
    top: spacing.sm,
    width: 22,
    height: 22,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },

  emptyWrap: { position: 'absolute' },
  emptyPerspective: { flex: 1 },
  emptyTile: {
    flex: 1,
    borderRadius: TILE_RADIUS,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(250,250,250,0.18)',
    backgroundColor: 'rgba(250,250,250,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTileNext: { borderColor: 'rgba(127,255,0,0.6)', backgroundColor: 'rgba(127,255,0,0.06)' },
  uploadingTile: { borderStyle: 'solid', borderColor: 'rgba(255,20,147,0.6)', overflow: 'hidden', gap: spacing.xs },
  uploadingText: { ...typography.caption, color: colors.white },
  plusCircle: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: 'rgba(250,250,250,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusCircleNext: { width: 46, height: 46, backgroundColor: colors.primary },

  hintRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 24, marginTop: spacing.md },
  hint: { ...typography.bodySmall, color: colors.gray[500] },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,59,48,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,59,48,0.35)',
  },
  errorText: { ...typography.bodySmall, color: colors.white, flex: 1 },

  sourceRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  sourceBtn: {
    flex: 1,
    height: 52,
    borderRadius: radius.full,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  sourceBtnOutline: { borderWidth: 1.5, borderColor: 'rgba(250,250,250,0.3)' },
  sourceBtnFilled: { backgroundColor: 'rgba(255,20,147,0.22)', borderWidth: 1.5, borderColor: colors.secondary },
  sourceText: { ...typography.label, color: colors.white },
  disabled: { opacity: 0.4 },
  fullText: { ...typography.bodySmall, color: colors.primary, textAlign: 'center', marginTop: spacing.sm },

  footer: { paddingHorizontal: H_PAD, paddingTop: spacing.sm, paddingBottom: spacing.sm, gap: spacing.xs },
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
  ctaDisabled: { backgroundColor: 'rgba(250,250,250,0.1)' },
  ctaText: { ...typography.h4, fontFamily: fontFamily.display, color: colors.black },
  ctaTextDisabled: { color: colors.gray[400] },
  skip: { height: 44, alignItems: 'center', justifyContent: 'center' },
  skipText: { ...typography.label, color: colors.gray[400] },
});
