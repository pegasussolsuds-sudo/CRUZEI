import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  Extrapolation,
  cancelAnimation,
  interpolate,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { Canvas, Group, Path, Skia, type SkPath } from '@shopify/react-native-skia';

import { api, toApiError } from '../../services/api';
import { FadeInView, Glow, ScaleOnPress, SlideInView } from '../../components/animated';
import { MatchModal, type MatchInfo } from '../../components/MatchModal';
import { CruzeiAvatar } from '../../components/avatar/CruzeiAvatar';
import { resolveAvatar } from '../../avatar';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import type { AvatarConfig, LikeResult, LookingFor, PremiumTier, SealType, UserSeal } from '@cruzei/shared-types';
import { timeAgo, formatApproxDistance } from '@cruzei/shared-utils';
import { colors, fontFamily, radius, shadows, spacing, typography } from '@cruzei/ui-mobile';

// ───────────────────────────── tipos ─────────────────────────────

interface UserCardPhoto {
  id: string;
  url: string;
  isMain: boolean;
}

interface UserCardData {
  id: string;
  name: string;
  age: number | null;
  bio: string | null;
  photos: UserCardPhoto[];
  interests: string[];
  seals: UserSeal[];
  lookingFor: LookingFor;
  isVerified: boolean;
  premiumTier: PremiumTier;
  lastActiveAt: string | null;
  distanceM: number | null;
  likedByMe: boolean;
  likedMe: boolean;
  match: { id: string; context: string | null } | null;
  /** avatar Cruzei (null/ausente → determinístico pelo id) */
  avatar?: AvatarConfig | null;
}

const AVATAR_CHIP = 52;

type Nav = NativeStackNavigationProp<RootStackParamList, 'UserCard'>;
type Route = RouteProp<RootStackParamList, 'UserCard'>;
type BurstKind = 'heart' | 'star';

// ───────────────────────────── constantes ─────────────────────────────

const SEALS: Record<SealType, { emoji: string; label: string }> = {
  cafeteria: { emoji: '☕', label: 'Cafeteria' },
  praieiro: { emoji: '🏖️', label: 'Praieiro' },
  roadie: { emoji: '🎸', label: 'Roadie' },
  boemio: { emoji: '🍻', label: 'Boêmio' },
  natureza: { emoji: '🌿', label: 'Natureza' },
  urbanista: { emoji: '🏙️', label: 'Urbanista' },
  fitness: { emoji: '💪', label: 'Fitness' },
  cultural: { emoji: '🎭', label: 'Cultural' },
};

const LOOKING_FOR: Record<LookingFor, string | null> = {
  relationship: 'Quer namorar',
  casual: 'Algo casual',
  friendship: 'Quer amizade',
  network: 'Networking',
  unspecified: null,
};

const FOOTER_H = 112;

// Material icons (24x24) — desenhados em Skia, sem asset
const HEART_SVG =
  'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z';
const STAR_SVG = 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z';

function formatDistance(m: number | null | undefined): string | null {
  if (m == null || !Number.isFinite(m)) return null;
  return `a ${formatApproxDistance(m)}`; // mesma régua de degraus do resto do app
}

function seeded(i: number, salt: number): number {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

// ───────────────────────────── tela ─────────────────────────────

export function UserCardScreen() {
  const nav = useNavigation<Nav>();
  const { params } = useRoute<Route>();
  const { userId, distanceM: distanceParam } = params;
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const HEADER_H = Math.min(Math.round(width * 1.25), Math.round(height * 0.72));

  const [match, setMatch] = useState<MatchInfo | null>(null);
  const [burst, setBurst] = useState<{ kind: BurstKind; x: number; y: number; key: number } | null>(null);
  const [sent, setSent] = useState<'like' | 'super' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const likeBtnRef = useRef<View>(null);
  const superBtnRef = useRef<View>(null);

  const userQuery = useQuery({
    queryKey: ['user', userId],
    queryFn: async () => (await api.get<UserCardData>(`/users/${userId}`)).data,
    retry: (count, err) => toApiError(err).status !== 404 && count < 2,
  });

  const likeMutation = useMutation({
    mutationFn: async (isSuper: boolean) =>
      (await api.post<LikeResult>(isSuper ? '/likes/super' : '/likes', { userId })).data,
  });

  // Parallax da foto: a header vive DENTRO do scroll e anda na metade da velocidade.
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });
  const headerStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: scrollY.value * 0.5 },
      { scale: interpolate(scrollY.value, [-HEADER_H, 0], [2, 1], Extrapolation.CLAMP) },
    ],
  }));
  const headerFade = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, HEADER_H * 0.6], [1, 0.35], Extrapolation.CLAMP),
  }));

  const user = userQuery.data;
  const photos = useMemo(() => {
    if (!user) return [];
    return [...user.photos].sort((a, b) => Number(b.isMain) - Number(a.isMain));
  }, [user]);
  const mainPhoto = photos[0]?.url ?? null;
  // o servidor manda null quando a pessoa desligou 'mostrar distância': não cair no valor do mapa
  const distance = formatDistance(user ? user.distanceM : distanceParam);
  const alreadyMatched = user?.match ?? null;
  const alreadyLiked = user?.likedByMe ?? false;

  const fireBurst = useCallback(
    (kind: BurstKind) => {
      const ref = kind === 'heart' ? likeBtnRef : superBtnRef;
      const node = ref.current;
      const fallback = { x: kind === 'heart' ? width / 2 : width * 0.8, y: height - FOOTER_H / 2 - insets.bottom };
      if (!node) {
        setBurst({ kind, ...fallback, key: Date.now() });
        return;
      }
      node.measureInWindow((x, y, w, h) => {
        const ok = Number.isFinite(x) && Number.isFinite(y);
        setBurst({ kind, x: ok ? x + w / 2 : fallback.x, y: ok ? y + h / 2 : fallback.y, key: Date.now() });
      });
    },
    [height, insets.bottom, width],
  );

  const onLike = useCallback(
    async (isSuper: boolean) => {
      if (!user || likeMutation.isPending || sent) return;
      setActionError(null);
      fireBurst(isSuper ? 'star' : 'heart');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      try {
        const res = await likeMutation.mutateAsync(isSuper);
        setSent(isSuper ? 'super' : 'like');
        qc.invalidateQueries({ queryKey: ['nearby'] });
        if (res.isMatch && res.matchId) {
          qc.invalidateQueries({ queryKey: ['matches'] });
          setMatch({
            matchId: res.matchId,
            userId: user.id,
            name: user.name,
            photo: mainPhoto,
            avatar: user.avatar ?? null,
            context: res.context ?? null,
            distanceM: user.distanceM ?? null,
          });
        } else {
          setTimeout(() => nav.goBack(), 1100);
        }
      } catch (err) {
        setActionError(toApiError(err).message);
      }
    },
    [distanceParam, fireBurst, likeMutation, mainPhoto, nav, qc, sent, user],
  );

  const onPass = useCallback(() => {
    if (!user) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    api.post('/passes', { userId: user.id }).catch(() => {});
    qc.invalidateQueries({ queryKey: ['nearby'] });
    nav.goBack();
  }, [nav, qc, user]);

  const openChat = useCallback(() => {
    if (!user || !alreadyMatched) return;
    nav.navigate('Main', {
      screen: 'Matches',
      params: { screen: 'Chat', initial: false, params: { matchId: alreadyMatched.id, name: user.name } },
    } as never);
  }, [alreadyMatched, nav, user]);

  // ── estados de carregamento/erro ──
  if (userQuery.isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.black }]}>
        <ActivityIndicator color={colors.primary} size="large" />
        <BackButton top={insets.top} onPress={() => nav.goBack()} />
      </View>
    );
  }

  if (userQuery.isError || !user) {
    const apiErr = userQuery.error ? toApiError(userQuery.error) : null;
    const gone = apiErr?.status === 404 || !user;
    return (
      <View style={[styles.center, { backgroundColor: colors.black }]}>
        <FadeInView fromScale={0.9} style={styles.centerInner}>
          <Ionicons name={gone ? 'eye-off-outline' : 'cloud-offline-outline'} size={56} color={colors.gray[500]} />
          <Text style={styles.errTitle}>{gone ? 'Essa pessoa não tá disponível agora' : 'Deu ruim por aqui'}</Text>
          <Text style={styles.errSub}>
            {gone ? 'Pode ter ficado anônima ou saído da área. Bora ver quem mais tá por perto?' : apiErr?.message ?? 'Tenta de novo em instantes.'}
          </Text>
          <ScaleOnPress
            onPress={() => (gone ? nav.goBack() : userQuery.refetch())}
            style={styles.errBtn}
            accessibilityRole="button"
            accessibilityLabel={gone ? 'Voltar' : 'Tentar de novo'}
          >
            <Text style={styles.errBtnText}>{gone ? 'Voltar' : 'Tentar de novo'}</Text>
          </ScaleOnPress>
        </FadeInView>
        <BackButton top={insets.top} onPress={() => nav.goBack()} />
      </View>
    );
  }

  const lookingLabel = LOOKING_FOR[user.lookingFor] ?? null;
  const completedSeals = user.seals.filter((s) => s.isCompleted);
  const showSeals = completedSeals.length > 0 ? completedSeals : user.seals.slice(0, 4);
  const active = user.lastActiveAt ? timeAgo(user.lastActiveAt) : null;

  return (
    <View style={styles.root}>
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ flexGrow: 1 }}
        bounces
      >
        {/* ── header com parallax + carrossel ── */}
        <Animated.View style={[{ width, height: HEADER_H, backgroundColor: colors.gray[900] }, headerStyle]}>
          <PhotoCarousel photos={photos} width={width} height={HEADER_H} name={user.name} topInset={insets.top} />
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, headerFade]}>
            <LinearGradient
              colors={['rgba(10,10,26,0)', 'rgba(10,10,26,0.15)', 'rgba(10,10,26,0.85)']}
              locations={[0.45, 0.65, 1]}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.headerInfo}>
              {/* avatar Cruzei — o mesmo boneco que aparece no mapa */}
              <FadeInView delay={40} fromScale={0.7} style={styles.avatarChip}>
                <CruzeiAvatar
                  config={resolveAvatar(user.avatar, user.id)}
                  mode="bust"
                  size={AVATAR_CHIP}
                  backgroundColor={colors.black}
                  accessibilityLabel={`Avatar de ${user.name}`}
                />
              </FadeInView>
              <FadeInView delay={80} fromY={12}>
                <View style={styles.nameRow}>
                  <Text style={styles.name} numberOfLines={1}>
                    {user.name}
                    {user.age != null ? <Text style={styles.age}>, {user.age}</Text> : null}
                  </Text>
                  {user.isVerified ? (
                    <View style={styles.verified} accessibilityLabel="Perfil verificado">
                      <Ionicons name="checkmark" size={13} color={colors.black} />
                    </View>
                  ) : null}
                </View>
              </FadeInView>
              <FadeInView delay={160} fromY={10}>
                <View style={styles.metaRow}>
                  {distance ? (
                    <View style={styles.metaChip}>
                      <Ionicons name="location" size={13} color={colors.primary} />
                      <Text style={styles.metaText}>{distance}</Text>
                    </View>
                  ) : null}
                  {active ? (
                    <View style={styles.metaChip}>
                      <View style={[styles.dot, active === 'agora' && { backgroundColor: colors.online }]} />
                      <Text style={styles.metaText}>{active === 'agora' ? 'online agora' : `ativo ${active}`}</Text>
                    </View>
                  ) : null}
                  {user.premiumTier !== 'free' ? (
                    <View style={[styles.metaChip, styles.premiumChip]}>
                      <Ionicons name="sparkles" size={12} color={colors.accent} />
                      <Text style={[styles.metaText, { color: colors.accent }]}>Premium</Text>
                    </View>
                  ) : null}
                </View>
              </FadeInView>
            </View>
          </Animated.View>
        </Animated.View>

        {/* ── folha de conteúdo ── */}
        {/* a sheet cresce até o fim da tela pra não aparecer o fundo escuro ao rolar */}
        <View style={[styles.sheet, { flexGrow: 1, paddingBottom: FOOTER_H + insets.bottom + spacing.xl }]}>
          {alreadyMatched ? (
            <SlideInView from="left" distance={40} delay={120} springPreset="soft">
              <View style={styles.contextBox}>
                <Text style={styles.contextEmoji}>💫</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.contextEyebrow}>deu match</Text>
                  <Text style={styles.contextText}>{alreadyMatched.context ?? 'Vocês se cruzaram por aqui 💚'}</Text>
                </View>
              </View>
            </SlideInView>
          ) : user.likedMe ? (
            <SlideInView from="left" distance={40} delay={120} springPreset="soft">
              <View style={[styles.contextBox, styles.likedMeBox]}>
                <Text style={styles.contextEmoji}>👀</Text>
                <Text style={[styles.contextText, { flex: 1 }]}>Já te curtiu. Só falta você 😉</Text>
              </View>
            </SlideInView>
          ) : null}

          {lookingLabel ? (
            <FadeInView delay={180} fromY={8}>
              <View style={styles.lookingRow}>
                <Ionicons name="compass-outline" size={16} color={colors.info} />
                <Text style={styles.lookingText}>{lookingLabel}</Text>
              </View>
            </FadeInView>
          ) : null}

          {user.bio ? (
            <FadeInView delay={220} fromY={10}>
              <Text style={styles.sectionTitle}>sobre</Text>
              <Text style={styles.bio}>{user.bio}</Text>
            </FadeInView>
          ) : null}

          {user.interests.length > 0 ? (
            <View>
              <FadeInView delay={260}>
                <Text style={styles.sectionTitle}>curte</Text>
              </FadeInView>
              <View style={styles.chips}>
                {user.interests.map((it, i) => (
                  <FadeInView key={it} delay={280 + i * 40} fromY={8} fromScale={0.9}>
                    <View style={styles.chip}>
                      <Text style={styles.chipText}>{it}</Text>
                    </View>
                  </FadeInView>
                ))}
              </View>
            </View>
          ) : null}

          {showSeals.length > 0 ? (
            <View>
              <FadeInView delay={320 + user.interests.length * 40}>
                <Text style={styles.sectionTitle}>selos</Text>
              </FadeInView>
              <View style={styles.chips}>
                {showSeals.map((s, i) => {
                  const meta = SEALS[s.type] ?? { emoji: '🏅', label: s.type };
                  return (
                    <FadeInView key={s.type} delay={340 + user.interests.length * 40 + i * 50} fromY={8} fromScale={0.9}>
                      <View style={[styles.seal, s.isCompleted && styles.sealDone]}>
                        <Text style={styles.sealEmoji}>{meta.emoji}</Text>
                        <Text style={[styles.sealText, s.isCompleted && styles.sealTextDone]}>
                          {meta.label}
                          {!s.isCompleted ? ` ${s.progress}/${s.target}` : ''}
                        </Text>
                      </View>
                    </FadeInView>
                  );
                })}
              </View>
            </View>
          ) : null}

          {!user.bio && user.interests.length === 0 && showSeals.length === 0 ? (
            <FadeInView delay={220}>
              <Text style={styles.emptyBio}>Perfil ainda tímido. Quem sabe vocês se cruzam de novo? 😉</Text>
            </FadeInView>
          ) : null}
        </View>
      </Animated.ScrollView>

      <BackButton top={insets.top} onPress={() => nav.goBack()} />

      {/* ── rodapé fixo ── */}
      <View pointerEvents="box-none" style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <LinearGradient
          pointerEvents="none"
          colors={['rgba(250,250,250,0)', 'rgba(250,250,250,0.92)', colors.background]}
          locations={[0, 0.35, 1]}
          style={StyleSheet.absoluteFill}
        />
        {actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}
        {alreadyMatched ? (
          <SlideInView from="up" distance={30} delay={200} springPreset="soft" style={styles.footerRow}>
            <ScaleOnPress
              onPress={openChat}
              glowColor={colors.secondary}
              style={styles.chatBtn}
              accessibilityRole="button"
              accessibilityLabel={`Mandar mensagem pra ${user.name}`}
            >
              <Ionicons name="chatbubble-ellipses" size={20} color={colors.white} />
              <Text style={styles.chatBtnText}>Mandar mensagem</Text>
            </ScaleOnPress>
          </SlideInView>
        ) : sent || alreadyLiked ? (
          <FadeInView fromY={12} style={styles.footerRow}>
            <View style={styles.sentPill}>
              <Text style={styles.sentText}>
                {sent === 'super' ? 'Super curtida enviada ⭐' : alreadyLiked && !sent ? 'Você já curtiu. Agora é esperar 😉' : 'Curtida enviada 💚'}
              </Text>
            </View>
          </FadeInView>
        ) : (
          <SlideInView from="up" distance={30} delay={200} springPreset="soft" style={styles.footerRow}>
            <ScaleOnPress
              onPress={onPass}
              pressedScale={0.9}
              style={[styles.btn, styles.btnPass]}
              accessibilityRole="button"
              accessibilityLabel="Passar"
              accessibilityHint="Pula essa pessoa"
            >
              <Ionicons name="close" size={30} color={colors.danger} />
            </ScaleOnPress>

            <View ref={likeBtnRef} collapsable={false}>
              <Glow color={colors.primary} spread={14} intensity={0.55} shape="circle" cycleMs={2200}>
                <ScaleOnPress
                  onPress={() => onLike(false)}
                  pressedScale={0.9}
                  haptic={false}
                  disabled={likeMutation.isPending}
                  style={[styles.btn, styles.btnLike]}
                  accessibilityRole="button"
                  accessibilityLabel="Curtir"
                  accessibilityHint={`Curte ${user.name}`}
                >
                  <Ionicons name="heart" size={34} color={colors.black} />
                </ScaleOnPress>
              </Glow>
            </View>

            <View ref={superBtnRef} collapsable={false}>
              <ScaleOnPress
                onPress={() => onLike(true)}
                pressedScale={0.9}
                haptic={false}
                disabled={likeMutation.isPending}
                glowColor={colors.accent}
                style={[styles.btn, styles.btnSuper]}
                accessibilityRole="button"
                accessibilityLabel="Super curtir"
                accessibilityHint={`Manda uma super curtida pra ${user.name}`}
              >
                <Ionicons name="star" size={28} color={colors.black} />
              </ScaleOnPress>
            </View>
          </SlideInView>
        )}
      </View>

      {burst ? (
        <ParticleBurst key={burst.key} kind={burst.kind} originX={burst.x} originY={burst.y} onDone={() => setBurst(null)} />
      ) : null}

      <MatchModal
        match={match}
        onClose={() => {
          setMatch(null);
          nav.goBack();
        }}
      />
    </View>
  );
}

// ───────────────────────────── botão voltar ─────────────────────────────

function BackButton({ top, onPress }: { top: number; onPress: () => void }) {
  return (
    <ScaleOnPress
      onPress={onPress}
      style={[styles.back, { top: top + spacing.sm }]}
      accessibilityRole="button"
      accessibilityLabel="Voltar"
    >
      <Ionicons name="chevron-back" size={26} color={colors.white} />
    </ScaleOnPress>
  );
}

// ───────────────────────────── carrossel de fotos ─────────────────────────────

function PhotoCarousel({
  photos,
  width,
  height,
  name,
  topInset,
}: {
  photos: UserCardPhoto[];
  width: number;
  height: number;
  name: string;
  topInset: number;
}) {
  const count = Math.max(1, photos.length);
  const x = useSharedValue(0);
  const startX = useSharedValue(0);
  const index = useDerivedValue(() => -x.value / width);

  useEffect(() => () => cancelAnimation(x), [x]);

  const snapTo = (target: number, velocity = 0) => {
    'worklet';
    const clamped = Math.min(count - 1, Math.max(0, target));
    x.value = withSpring(-clamped * width, { damping: 22, stiffness: 190, mass: 0.7, velocity, overshootClamping: true });
  };

  const tick = () => {
    Haptics.selectionAsync().catch(() => {});
  };

  const pan = Gesture.Pan()
    .enabled(count > 1)
    .activeOffsetX([-12, 12])
    .failOffsetY([-14, 14])
    .onStart(() => {
      startX.value = x.value;
    })
    .onUpdate((e) => {
      const min = -(count - 1) * width;
      let next = startX.value + e.translationX;
      // rubber band nas bordas
      if (next > 0) next = next / 3;
      else if (next < min) next = min + (next - min) / 3;
      x.value = next;
    })
    .onEnd((e) => {
      const current = Math.round(-startX.value / width);
      // momentum: projeta 0,18s da velocidade pra decidir o snap
      const projected = (-x.value - e.velocityX * 0.18) / width;
      let target = Math.round(projected);
      if (Math.abs(e.velocityX) > 400) target = e.velocityX < 0 ? current + 1 : current - 1;
      target = Math.min(count - 1, Math.max(0, target));
      if (target !== current) runOnJS(tick)();
      snapTo(target, e.velocityX);
    });

  const tap = Gesture.Tap()
    .enabled(count > 1)
    .maxDuration(250)
    .onEnd((e) => {
      const current = Math.round(-x.value / width);
      const dir = e.x > width / 2 ? 1 : -1;
      const target = Math.min(count - 1, Math.max(0, current + dir));
      if (target !== current) runOnJS(tick)();
      snapTo(target);
    });

  const strip = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <View style={{ width, height, overflow: 'hidden' }}>
      <GestureDetector gesture={Gesture.Race(pan, tap)}>
        <Animated.View
          style={[{ flexDirection: 'row', width: width * count, height }, strip]}
          accessible
          accessibilityRole="image"
          accessibilityLabel={`Fotos de ${name}, ${count} ${count === 1 ? 'foto' : 'fotos'}`}
        >
          {photos.length === 0 ? (
            <View style={[styles.photoPlaceholder, { width, height }]}>
              <Ionicons name="person" size={96} color={colors.gray[700]} />
            </View>
          ) : (
            photos.map((p, i) => <CarouselPhoto key={p.id} uri={p.url} i={i} width={width} height={height} index={index} />)
          )}
        </Animated.View>
      </GestureDetector>
      {count > 1 ? (
        <View pointerEvents="none" style={[styles.dots, { top: topInset + 28 }]} accessibilityElementsHidden>
          {photos.map((p, i) => (
            <Dot key={p.id} i={i} index={index} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function CarouselPhoto({ uri, i, width, height, index }: { uri: string; i: number; width: number; height: number; index: SharedValue<number> }) {
  // leve zoom/parallax interno enquanto a foto entra/sai
  const style = useAnimatedStyle(() => {
    const d = index.value - i;
    return {
      transform: [{ translateX: d * width * 0.18 }, { scale: interpolate(Math.abs(d), [0, 1], [1, 1.12], Extrapolation.CLAMP) }],
    };
  });
  return (
    <View style={{ width, height, overflow: 'hidden' }}>
      <Animated.View style={[StyleSheet.absoluteFill, style]}>
        <Image source={{ uri }} style={{ width, height }} resizeMode="cover" />
      </Animated.View>
    </View>
  );
}

function Dot({ i, index }: { i: number; index: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({
    width: interpolate(index.value, [i - 1, i, i + 1], [6, 22, 6], Extrapolation.CLAMP),
    opacity: interpolate(index.value, [i - 1, i, i + 1], [0.45, 1, 0.45], Extrapolation.CLAMP),
  }));
  return <Animated.View style={[styles.dot2, style]} />;
}

// ───────────────────────────── explosão de partículas (Skia) ─────────────────────────────

const HEART_PATH = Skia.Path.MakeFromSVGString(HEART_SVG);
const STAR_PATH = Skia.Path.MakeFromSVGString(STAR_SVG);

interface ParticleSpec {
  vx: number;
  vy: number;
  size: number;
  spin: number;
  delay: number;
  color: string;
}

function ParticleBurst({
  kind,
  originX,
  originY,
  onDone,
}: {
  kind: BurstKind;
  originX: number;
  originY: number;
  onDone: () => void;
}) {
  const t = useSharedValue(0);
  const DURATION = 1000;
  const seconds = DURATION / 1000;
  const path = kind === 'heart' ? HEART_PATH : STAR_PATH;

  const particles = useMemo<ParticleSpec[]>(() => {
    const n = kind === 'heart' ? 13 : 14;
    const palette = kind === 'heart' ? [colors.primary, colors.primary, colors.success, '#B8FF66'] : [colors.accent, '#FFE766', colors.accent, '#FFC400'];
    return Array.from({ length: n }, (_, i) => {
      const angle = -Math.PI / 2 + (seeded(i, 1) - 0.5) * (kind === 'heart' ? Math.PI * 0.9 : Math.PI * 1.6);
      const speed = (kind === 'heart' ? 420 : 520) + seeded(i, 2) * 360;
      return {
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 0.7 + seeded(i, 3) * 1.1,
        spin: (seeded(i, 4) - 0.5) * (kind === 'heart' ? 3 : 10),
        delay: seeded(i, 5) * 0.12,
        color: palette[i % palette.length],
      };
    });
  }, [kind]);

  useEffect(() => {
    t.value = 0;
    t.value = withTiming(1, { duration: DURATION, easing: Easing.out(Easing.quad) }, (finished) => {
      if (finished) runOnJS(onDone)();
    });
    return () => cancelAnimation(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!path) return null;

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      {particles.map((p, i) => (
        <Particle key={i} p={p} t={t} path={path} ox={originX} oy={originY} seconds={seconds} gravity={kind === 'heart' ? 520 : 900} />
      ))}
    </Canvas>
  );
}

function Particle({
  p,
  t,
  path,
  ox,
  oy,
  seconds,
  gravity,
}: {
  p: ParticleSpec;
  t: SharedValue<number>;
  path: SkPath;
  ox: number;
  oy: number;
  seconds: number;
  gravity: number;
}) {
  const transform = useDerivedValue(() => {
    const s = Math.max(0, t.value * seconds - p.delay);
    const grow = Math.min(1, s * 6); // pop de entrada
    const scale = p.size * grow * 1.6;
    return [
      { translateX: ox + p.vx * s * 0.55 },
      { translateY: oy + p.vy * s * 0.55 + 0.5 * gravity * s * s * 0.55 },
      { rotate: p.spin * s },
      { scale },
      // centraliza o path de 24x24
      { translateX: -12 },
      { translateY: -12 },
    ];
  });
  const opacity = useDerivedValue(() => {
    const s = Math.max(0, t.value * seconds - p.delay);
    const life = s / seconds;
    return life < 0.55 ? 1 : Math.max(0, 1 - (life - 0.55) / 0.45);
  });
  return (
    <Group transform={transform} opacity={opacity}>
      <Path path={path} color={p.color} />
    </Group>
  );
}

// ───────────────────────────── estilos ─────────────────────────────

const btnBase: ViewStyle = {
  width: 60,
  height: 60,
  borderRadius: 30,
  alignItems: 'center',
  justifyContent: 'center',
  ...shadows.medium,
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.black },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  centerInner: { alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg },
  errTitle: { ...typography.h2, color: colors.white, textAlign: 'center', marginTop: spacing.sm },
  errSub: { ...typography.body, color: colors.gray[400], textAlign: 'center' },
  errBtn: { marginTop: spacing.lg, backgroundColor: colors.primary, borderRadius: radius.full, paddingHorizontal: spacing.xl, height: 48, justifyContent: 'center' },
  errBtnText: { ...typography.label, color: colors.black, fontSize: 15 },

  back: {
    position: 'absolute',
    left: spacing.lg,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(10,10,26,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },

  headerInfo: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.xl + spacing.lg },
  avatarChip: {
    alignSelf: 'flex-start',
    width: AVATAR_CHIP + 6,
    height: AVATAR_CHIP + 6,
    borderRadius: (AVATAR_CHIP + 6) / 2,
    borderWidth: 3,
    borderColor: colors.white,
    backgroundColor: colors.black,
    marginBottom: spacing.sm,
    ...shadows.medium,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { fontFamily: fontFamily.display, fontSize: 34, lineHeight: 40, letterSpacing: -0.5, color: colors.white, flexShrink: 1 },
  age: { fontFamily: fontFamily.displayMedium, fontSize: 30, color: colors.gray[200] },
  verified: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(250,250,250,0.14)',
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    height: 28,
  },
  premiumChip: { backgroundColor: 'rgba(255,215,0,0.16)' },
  metaText: { ...typography.caption, fontSize: 12, color: colors.white },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.gray[400] },
  dots: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 5 },
  dot2: { height: 4, borderRadius: 2, backgroundColor: colors.white, ...shadows.light },
  photoPlaceholder: { backgroundColor: colors.gray[800], alignItems: 'center', justifyContent: 'center' },

  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    marginTop: -radius.xl,
    padding: spacing.lg,
    paddingTop: spacing.xl,
    gap: spacing.lg,
    minHeight: 320,
  },
  contextBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: '#FFE0F0',
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  likedMeBox: { backgroundColor: '#EDFFD6' },
  contextEmoji: { fontSize: 24 },
  contextEyebrow: { ...typography.caption, color: colors.secondary, letterSpacing: 1.5, textTransform: 'uppercase' },
  contextText: { ...typography.body, fontFamily: fontFamily.bodyMedium, color: colors.black },
  lookingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  lookingText: { ...typography.label, color: colors.info },
  sectionTitle: { ...typography.h3, color: colors.black, marginBottom: spacing.sm },
  bio: { ...typography.bodyLarge, color: colors.gray[700] },
  emptyBio: { ...typography.body, color: colors.gray[500], fontStyle: 'italic' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.gray[200], borderRadius: radius.full, paddingHorizontal: spacing.md, height: 36, justifyContent: 'center' },
  chipText: { ...typography.label, color: colors.black },
  seal: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.gray[100], borderRadius: radius.full, paddingHorizontal: spacing.md, height: 36 },
  sealDone: { backgroundColor: '#FFF6CC', borderWidth: 1.5, borderColor: colors.accent },
  sealEmoji: { fontSize: 15 },
  sealText: { ...typography.label, color: colors.gray[500] },
  sealTextDone: { color: colors.black },

  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: spacing.xl, alignItems: 'center' },
  footerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xl, width: '100%' },
  btn: btnBase,
  btnPass: { backgroundColor: colors.white, borderWidth: 2, borderColor: colors.danger },
  btnLike: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.primary },
  btnSuper: { backgroundColor: colors.accent },
  chatBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.secondary,
    borderRadius: radius.full,
    height: 56,
    paddingHorizontal: spacing.xxl,
    ...shadows.medium,
  },
  chatBtnText: { ...typography.label, color: colors.white, fontSize: 16 },
  sentPill: { backgroundColor: colors.black, borderRadius: radius.full, paddingHorizontal: spacing.xl, height: 48, justifyContent: 'center' },
  sentText: { ...typography.label, color: colors.primary, fontSize: 15 },
  actionError: { ...typography.bodySmall, color: colors.danger, textAlign: 'center', marginBottom: spacing.sm, paddingHorizontal: spacing.lg },
});
