import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  cancelAnimation,
  interpolate,
  runOnJS,
  runOnUI,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { api, toApiError } from '../../services/api';
import { useMyLocation } from '../../hooks/useMyLocation';
import { MatchModal, type MatchInfo } from '../../components/MatchModal';
import { FadeInView, Pulse, ScaleOnPress } from '../../components/animated';
import { CruzeiAvatar } from '../../components/avatar/CruzeiAvatar';
import { resolveAvatar } from '../../avatar';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { proximityBandLabel } from '@cruzei/shared-utils';
import type { LikeResult, NearbyUser } from '@cruzei/shared-types';
import { colors, fontFamily, radius, shadows, spacing, typography } from '@cruzei/ui-mobile';

const RADIUS_M = 5000;
const SWIPE_RATIO = 0.35; // soltar além de 35% da largura = ação
const FLING_VELOCITY = 900; // px/s — um "peteleco" também conta
const MAX_ROTATION = 12; // graus
const AVATAR_BADGE = 44; // bust do avatar no canto do card

type DeckAction = 'like' | 'super' | 'pass';
type Nav = NativeStackNavigationProp<RootStackParamList>;

export interface SwipeCardHandle {
  /** dispara a animação de saída e, ao terminar, a ação */
  swipe: (action: DeckAction) => void;
}

// faixa de proximidade (nunca metros de outra pessoa)
function formatDistance(band: NearbyUser['proximityBand'] | null | undefined): string {
  return proximityBandLabel(band);
}

export function LikesScreen() {
  const qc = useQueryClient();
  const nav = useNavigation<Nav>();
  const { width } = useWindowDimensions();
  const { lat, lng, status, locate } = useMyLocation();
  const [queue, setQueue] = useState<NearbyUser[]>([]);
  const [seeded, setSeeded] = useState(false);
  const [match, setMatch] = useState<MatchInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const topRef = useRef<SwipeCardHandle>(null);
  const busy = useRef(false);

  // progresso 0..1 do card de cima rumo ao limiar — o card de baixo cresce 0.95 → 1 com isso
  const progress = useSharedValue(0);

  const nearbyQuery = useQuery({
    queryKey: ['nearby', 'deck', lat?.toFixed(3), lng?.toFixed(3)],
    enabled: lat != null && lng != null,
    queryFn: async () => {
      const res = await api.get<NearbyUser[]>('/location/nearby', {
        params: { lat, lng, radius_meters: RADIUS_M },
      });
      return res.data;
    },
  });

  // Monta a fila uma vez por carga (ignora anônimos — não dá pra curtir quem não se revelou)
  useEffect(() => {
    if (nearbyQuery.data && !seeded) {
      setQueue(nearbyQuery.data.filter((u) => !u.isAnonymous));
      setSeeded(true);
    }
  }, [nearbyQuery.data, seeded]);

  const likeMutation = useMutation({
    mutationFn: async ({ userId, isSuper }: { userId: string; isSuper: boolean }) =>
      (await api.post<LikeResult>(isSuper ? '/likes/super' : '/likes', { userId })).data,
  });

  // Chamado quando o card já saiu da tela (fim da animação).
  const onAction = useCallback(
    async (action: DeckAction) => {
      const card = queue[0];
      busy.current = false;
      if (!card) return;
      setError(null);
      progress.value = 0;
      setQueue((q) => q.slice(1));
      try {
        if (action === 'pass') {
          await api.post('/passes', { userId: card.id });
          return;
        }
        const res = await likeMutation.mutateAsync({ userId: card.id, isSuper: action === 'super' });
        if (res.isMatch && res.matchId) {
          setMatch({
            matchId: res.matchId,
            userId: card.id,
            name: card.name,
            photo: card.mainPhotoUrl,
            avatar: card.avatar ?? null,
            context: res.context ?? null,
            band: card.proximityBand ?? null,
          });
          qc.invalidateQueries({ queryKey: ['matches'] });
        }
      } catch (err) {
        setError(toApiError(err).message);
      }
    },
    [likeMutation, progress, qc, queue],
  );

  // Botões do rodapé: mesma animação de saída do swipe.
  const trigger = useCallback((action: DeckAction) => {
    if (busy.current) return;
    busy.current = true;
    topRef.current?.swipe(action);
  }, []);

  const openCard = useCallback(
    (card: NearbyUser) => {
      nav.navigate('UserCard', { userId: card.id, band: card.proximityBand ?? null });
    },
    [nav],
  );

  const reload = () => {
    setSeeded(false);
    setQueue([]);
    progress.value = 0;
    nearbyQuery.refetch();
  };

  if (status === 'denied' || status === 'unavailable') {
    return (
      <SafeAreaView style={styles.center}>
        <FadeInView fromScale={0.92} style={styles.centerInner}>
          <Ionicons name="navigate-circle-outline" size={64} color={colors.gray[300]} />
          <Text style={styles.emptyTitle}>cadê você?</Text>
          <Text style={styles.emptySub}>Precisamos da sua localização pra mostrar quem tá por perto.</Text>
          <ScaleOnPress onPress={locate} style={styles.reload} accessibilityRole="button" accessibilityLabel="Permitir localização">
            <Text style={styles.reloadText}>Permitir localização</Text>
          </ScaleOnPress>
        </FadeInView>
      </SafeAreaView>
    );
  }

  if (nearbyQuery.isLoading || status === 'loading' || (!seeded && lat != null)) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </SafeAreaView>
    );
  }

  const top = queue[0];
  const next = queue[1];

  if (!top) {
    return (
      <SafeAreaView style={styles.center}>
        <FadeInView fromScale={0.92} style={styles.centerInner}>
          <Ionicons name="heart-outline" size={64} color={colors.gray[300]} />
          <Text style={styles.emptyTitle}>acabou por aqui</Text>
          <Text style={styles.emptySub}>
            Ninguém novo num raio de 5 km agora. Sai um pouco, volta mais tarde ou recarrega.
          </Text>
          <ScaleOnPress onPress={reload} style={styles.reload} accessibilityRole="button" accessibilityLabel="Recarregar">
            <Text style={styles.reloadText}>Recarregar</Text>
          </ScaleOnPress>
        </FadeInView>
        <MatchModal match={match} onClose={() => setMatch(null)} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>quem tá por perto</Text>
        <Text style={styles.subtitle}>
          {queue.length} {queue.length === 1 ? 'pessoa' : 'pessoas'} num raio de 5 km · arrasta pro lado
        </Text>
      </View>

      <View style={styles.deck}>
        {next ? <NextCard key={next.id} card={next} progress={progress} /> : null}
        <SwipeCard
          key={top.id}
          ref={topRef}
          card={top}
          width={width}
          progress={progress}
          onSwiped={onAction}
          onOpen={() => openCard(top)}
        />
        {error ? (
          <FadeInView fromY={6} style={styles.errorWrap}>
            <Text style={styles.error}>{error}</Text>
          </FadeInView>
        ) : null}
      </View>

      <View style={styles.actions}>
        <ScaleOnPress
          onPress={() => trigger('pass')}
          pressedScale={0.88}
          style={[styles.btn, styles.btnPass]}
          accessibilityRole="button"
          accessibilityLabel="Passar"
          accessibilityHint={`Pula ${top.name}`}
        >
          <Ionicons name="close" size={30} color={colors.danger} />
        </ScaleOnPress>
        <ScaleOnPress
          onPress={() => trigger('like')}
          pressedScale={0.88}
          glowColor={colors.primary}
          style={[styles.btn, styles.btnLike]}
          accessibilityRole="button"
          accessibilityLabel="Curtir"
          accessibilityHint={`Curte ${top.name}`}
        >
          <Ionicons name="heart" size={34} color={colors.black} />
        </ScaleOnPress>
        <ScaleOnPress
          onPress={() => trigger('super')}
          pressedScale={0.88}
          glowColor={colors.accent}
          style={[styles.btn, styles.btnSuper]}
          accessibilityRole="button"
          accessibilityLabel="Super curtir"
          accessibilityHint={`Manda uma super curtida pra ${top.name}`}
        >
          <Ionicons name="star" size={28} color={colors.black} />
        </ScaleOnPress>
      </View>

      <MatchModal match={match} onClose={() => setMatch(null)} />
    </SafeAreaView>
  );
}

// ───────────────────────────── card de cima (swipe) ─────────────────────────────

interface SwipeCardProps {
  card: NearbyUser;
  width: number;
  progress: SharedValue<number>;
  onSwiped: (action: DeckAction) => void;
  onOpen: () => void;
}

function hapticThreshold() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}
function hapticCommit(action: DeckAction) {
  if (action === 'super') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  else Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

const SwipeCard = forwardRef<SwipeCardHandle, SwipeCardProps>(function SwipeCard({ card, width, progress, onSwiped, onOpen }, ref) {
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const superStamp = useSharedValue(0);
  const crossed = useSharedValue(0); // 0 = dentro, 1 = além do limiar (pra haptic único)
  const leaving = useSharedValue(0);
  const threshold = width * SWIPE_RATIO;

  useEffect(
    () => () => {
      cancelAnimation(tx);
      cancelAnimation(ty);
      cancelAnimation(superStamp);
    },
    [tx, ty, superStamp],
  );

  const finish = (action: DeckAction) => {
    onSwiped(action);
  };

  // Animação de saída — usada pelo gesto E pelos botões.
  const flyOut = (action: DeckAction, velocityX = 0, velocityY = 0) => {
    'worklet';
    if (leaving.value === 1) return;
    leaving.value = 1;
    progress.value = withTiming(1, { duration: 180 });
    runOnJS(hapticCommit)(action);
    const cfg = { damping: 24, stiffness: 140, mass: 0.7, overshootClamping: true };
    if (action === 'super') {
      superStamp.value = withTiming(1, { duration: 120 });
      tx.value = withSpring(tx.value * 0.4, { ...cfg, velocity: velocityX });
      ty.value = withSpring(-width * 2.2, { ...cfg, velocity: velocityY }, (finished) => {
        if (finished) runOnJS(finish)(action);
      });
      return;
    }
    const dir = action === 'like' ? 1 : -1;
    // se o dedo não puxou pra direção certa, empurra o card pra ela
    if (Math.sign(tx.value) !== dir) tx.value = dir * 24;
    ty.value = withSpring(ty.value * 0.6, { ...cfg, velocity: velocityY });
    tx.value = withSpring(dir * width * 1.6, { ...cfg, velocity: velocityX }, (finished) => {
      if (finished) runOnJS(finish)(action);
    });
  };

  useImperativeHandle(ref, () => ({ swipe: (action) => runOnUI(flyOut)(action) }), [flyOut]);

  const pan = Gesture.Pan()
    .activeOffsetX([-8, 8])
    .onUpdate((e) => {
      if (leaving.value === 1) return;
      tx.value = e.translationX;
      ty.value = e.translationY * 0.6;
      const p = Math.min(1, Math.abs(e.translationX) / threshold);
      progress.value = p;
      const over = p >= 1 ? 1 : 0;
      if (over !== crossed.value) {
        crossed.value = over;
        if (over === 1) runOnJS(hapticThreshold)();
      }
    })
    .onEnd((e) => {
      if (leaving.value === 1) return;
      const far = Math.abs(tx.value) > threshold;
      const fast = Math.abs(e.velocityX) > FLING_VELOCITY;
      if (far || fast) {
        const dir = far ? Math.sign(tx.value) : Math.sign(e.velocityX);
        flyOut(dir > 0 ? 'like' : 'pass', e.velocityX, e.velocityY);
        return;
      }
      crossed.value = 0;
      progress.value = withSpring(0, { damping: 16, stiffness: 180 });
      tx.value = withSpring(0, { damping: 15, stiffness: 160, mass: 0.8, velocity: e.velocityX });
      ty.value = withSpring(0, { damping: 15, stiffness: 160, mass: 0.8, velocity: e.velocityY });
    });

  const tap = Gesture.Tap()
    .maxDuration(260)
    .maxDistance(8)
    .onEnd(() => {
      if (leaving.value === 1) return;
      runOnJS(onOpen)();
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { rotate: `${interpolate(tx.value, [-width, 0, width], [-MAX_ROTATION, 0, MAX_ROTATION], Extrapolation.CLAMP)}deg` },
    ],
  }));
  const likeStamp = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [0, threshold * 0.6], [0, 1], Extrapolation.CLAMP),
    transform: [{ rotate: '-14deg' }, { scale: interpolate(tx.value, [0, threshold * 0.6], [1.3, 1], Extrapolation.CLAMP) }],
  }));
  const passStamp = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [-threshold * 0.6, 0], [1, 0], Extrapolation.CLAMP),
    transform: [{ rotate: '14deg' }, { scale: interpolate(tx.value, [-threshold * 0.6, 0], [1, 1.3], Extrapolation.CLAMP) }],
  }));
  const superStampStyle = useAnimatedStyle(() => ({
    opacity: superStamp.value,
    transform: [{ scale: interpolate(superStamp.value, [0, 1], [1.4, 1], Extrapolation.CLAMP) }],
  }));
  const likeTint = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [0, threshold], [0, 0.28], Extrapolation.CLAMP),
  }));
  const passTint = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [-threshold, 0], [0.28, 0], Extrapolation.CLAMP),
  }));

  return (
    <GestureDetector gesture={Gesture.Race(pan, tap)}>
      <Animated.View
        style={[styles.card, cardStyle]}
        accessible
        accessibilityRole="button"
        accessibilityLabel={`${card.name}${card.age ? `, ${card.age} anos` : ''}, a ${formatDistance(card.proximityBand)}`}
        accessibilityHint="Toca pra ver o perfil. Arrasta pra direita pra curtir, pra esquerda pra passar"
      >
        <CardBody card={card} />

        {/* tintas de direção */}
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.primary }, likeTint]} />
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: colors.danger }, passTint]} />

        {/* carimbos */}
        <Animated.View pointerEvents="none" style={[styles.stamp, styles.stampLike, likeStamp]}>
          <Text style={[styles.stampText, { color: colors.primary }]}>CURTIR</Text>
        </Animated.View>
        <Animated.View pointerEvents="none" style={[styles.stamp, styles.stampPass, passStamp]}>
          <Text style={[styles.stampText, { color: colors.danger }]}>PASSAR</Text>
        </Animated.View>
        <Animated.View pointerEvents="none" style={[styles.stamp, styles.stampSuper, superStampStyle]}>
          <Text style={[styles.stampText, { color: colors.accent }]}>SUPER ⭐</Text>
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
});

// ───────────────────────────── card de baixo ─────────────────────────────

function NextCard({ card, progress }: { card: NearbyUser; progress: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: 0.95 + 0.05 * progress.value }, { translateY: 12 - 12 * progress.value }],
    opacity: 0.85 + 0.15 * progress.value,
  }));
  return (
    <Animated.View pointerEvents="none" style={[styles.card, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <CardBody card={card} />
    </Animated.View>
  );
}

// ───────────────────────────── conteúdo do card ─────────────────────────────

function CardBody({ card }: { card: NearbyUser }) {
  return (
    <View style={styles.cardInner}>
      {card.mainPhotoUrl ? (
        <Image source={{ uri: card.mainPhotoUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.photoPlaceholder]}>
          <Ionicons name="person" size={96} color={colors.gray[300]} />
        </View>
      )}
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(10,10,26,0)', 'rgba(10,10,26,0.1)', 'rgba(10,10,26,0.85)']}
        locations={[0.5, 0.65, 1]}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.badges} pointerEvents="none">
        {/* avatar Cruzei da pessoa — o mesmo que aparece no mapa */}
        <View style={styles.avatarBadge}>
          <CruzeiAvatar
            config={resolveAvatar(card.avatar, card.id)}
            mode="bust"
            size={AVATAR_BADGE}
            backgroundColor={colors.black}
            accessibilityLabel={`Avatar de ${card.name}`}
          />
        </View>
        {card.isBoosted ? (
          <View style={[styles.badge, { backgroundColor: colors.secondary }]}>
            <Ionicons name="flame" size={12} color={colors.white} />
            <Text style={[styles.badgeText, { color: colors.white }]}>em alta</Text>
          </View>
        ) : null}
        {card.premiumTier !== 'free' ? (
          <View style={[styles.badge, { backgroundColor: 'rgba(10,10,26,0.55)' }]}>
            <Ionicons name="sparkles" size={12} color={colors.accent} />
            <Text style={[styles.badgeText, { color: colors.accent }]}>premium</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.cardFooter} pointerEvents="none">
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>
            {card.name}
            {card.age ? <Text style={styles.age}>, {card.age}</Text> : null}
          </Text>
          {card.isVerified ? (
            <View style={styles.verified}>
              <Ionicons name="checkmark" size={12} color={colors.black} />
            </View>
          ) : null}
        </View>
        <View style={styles.metaRow}>
          <View style={styles.metaChip}>
            <Ionicons name="location" size={13} color={colors.primary} />
            <Text style={styles.metaText}>a {formatDistance(card.proximityBand)}</Text>
          </View>
          {card.isOnline ? (
            <View style={styles.metaChip}>
              <Pulse maxScale={1.35} minOpacity={0.6} cycleMs={1400}>
                <View style={styles.onlineDot} />
              </Pulse>
              <Text style={styles.metaText}>online</Text>
            </View>
          ) : null}
          {card.poi?.name ? (
            <View style={styles.metaChip}>
              <Ionicons name="pin" size={12} color={colors.secondary} />
              <Text style={styles.metaText} numberOfLines={1}>
                {card.poi.name}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

// ───────────────────────────── estilos ─────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, padding: spacing.xl },
  centerInner: { alignItems: 'center' },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  title: { ...typography.h2, color: colors.black },
  subtitle: { ...typography.bodySmall, color: colors.gray[600], marginTop: 2 },

  deck: { flex: 1, margin: spacing.lg, marginBottom: spacing.sm },
  card: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radius.xl,
    backgroundColor: colors.white,
    overflow: 'hidden',
    ...shadows.strong,
  },
  cardInner: { flex: 1, backgroundColor: colors.gray[100] },
  photoPlaceholder: { backgroundColor: colors.gray[100], alignItems: 'center', justifyContent: 'center' },
  badges: { position: 'absolute', top: spacing.md, left: spacing.md, right: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatarBadge: {
    width: AVATAR_BADGE + 4,
    height: AVATAR_BADGE + 4,
    borderRadius: (AVATAR_BADGE + 4) / 2,
    borderWidth: 2,
    borderColor: colors.white,
    backgroundColor: colors.black,
    ...shadows.medium,
  },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.full, paddingHorizontal: spacing.sm + 2, height: 26 },
  badgeText: { ...typography.caption, textTransform: 'uppercase', letterSpacing: 0.8 },

  cardFooter: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.lg },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { fontFamily: fontFamily.display, fontSize: 30, lineHeight: 36, letterSpacing: -0.5, color: colors.white, flexShrink: 1 },
  age: { fontFamily: fontFamily.displayMedium, fontSize: 26, color: colors.gray[200] },
  verified: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(250,250,250,0.16)',
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    height: 28,
    maxWidth: 200,
  },
  metaText: { ...typography.caption, fontSize: 12, color: colors.white },
  onlineDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.online },

  stamp: { position: 'absolute', top: spacing.xl + spacing.md, borderWidth: 4, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: 4 },
  stampLike: { left: spacing.lg, borderColor: colors.primary },
  stampPass: { right: spacing.lg, borderColor: colors.danger },
  stampSuper: { alignSelf: 'center', top: '42%', borderColor: colors.accent },
  stampText: { fontFamily: fontFamily.display, fontSize: 34, letterSpacing: 2 },

  errorWrap: { position: 'absolute', left: 0, right: 0, bottom: -spacing.lg, alignItems: 'center' },
  error: { ...typography.bodySmall, color: colors.danger, textAlign: 'center' },

  actions: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: spacing.xl, paddingHorizontal: spacing.xl, paddingVertical: spacing.lg },
  btn: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', ...shadows.medium },
  btnPass: { backgroundColor: colors.white, borderWidth: 2, borderColor: colors.danger },
  btnLike: { width: 74, height: 74, borderRadius: 37, backgroundColor: colors.primary },
  btnSuper: { backgroundColor: colors.accent },

  emptyTitle: { ...typography.h2, color: colors.black, marginTop: spacing.lg },
  emptySub: { ...typography.body, color: colors.gray[600], textAlign: 'center', marginTop: spacing.sm },
  reload: { marginTop: spacing.xl, paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: radius.md, backgroundColor: colors.primary },
  reloadText: { ...typography.label, color: colors.black },
});
