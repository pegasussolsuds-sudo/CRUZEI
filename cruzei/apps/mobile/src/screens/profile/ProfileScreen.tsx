import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  RefreshControl,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  Pressable,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation, type CompositeNavigationProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, {
  Easing,
  Extrapolation,
  cancelAnimation,
  interpolate,
  useAnimatedProps,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { Canvas, Circle, Path, Skia, SweepGradient, rect, vec } from '@shopify/react-native-skia';

import { api, toApiError } from '../../services/api';
import { useAuthStore } from '../../stores/auth';
import { useVisibility } from '../../hooks/useVisibility';
import { anonymousUntilLabel } from '../../services/anonymousWindow';
import { unreadNotifications, useNotificationList } from '../../hooks/useNotifications';
import { FadeInView, Glow, Pulse, ScaleOnPress } from '../../components/animated';
import { CruzeiAvatar } from '../../components/avatar/CruzeiAvatar';
import { SHOW_ME_RECIPROCAL_NOTE } from '../../components/showMeNote';
import { resolveAvatar } from '../../avatar';
import { Button } from '@cruzei/ui-mobile';
import { colors, radius, shadows, spacing, typography } from '@cruzei/ui-mobile';
import { AGE_MAX, AGE_MIN, AGE_RANGE_DAILY_CHANGES, ORIENTATION_LABELS, SHOW_ME, SHOW_ME_LABELS, type ShowMe, type User } from '@cruzei/shared-types';
import { AgeRangeSlider } from '../../components/profile/AgeRangeSlider';
import { useAgeRangeDraft } from '../../components/profile/ageRangeDraft';
import type { ProfileStackParamList } from '../../navigation/ProfileStack';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { BRAND } from '../../brand';

type ProfileNav = CompositeNavigationProp<
  NativeStackNavigationProp<ProfileStackParamList, 'ProfileHome'>,
  NativeStackNavigationProp<RootStackParamList>
>;

const LOOKING_FOR_LABEL: Record<string, string> = {
  relationship: 'Namorar',
  casual: 'Algo casual',
  friendship: 'Amizade',
  network: 'Networking',
  unspecified: 'Ainda decidindo',
};

// Faixa de scroll em que o avatar encolhe/sobe e a barra compacta aparece
const PARALLAX_RANGE = 170;
const AVATAR = 128;
const RING = 152;
const RING_STROKE = 6;
const CRUZEI_AVATAR = 132; // boneco no card "seu avatar"

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

const lightTap = () => Haptics.selectionAsync().catch(() => {});

type SettingsPatch = {
  showDistance?: boolean;
  showAge?: boolean;
  showPhotoOnMap?: boolean;
  discoveryMode?: 'everyone' | 'compatible' | 'nobody';
  showOrientation?: boolean;
  sameOrientationFirst?: boolean;
  showMe?: ShowMe;
  /** faixa de idade que eu vejo (não recíproca); 99 = sem limite em cima */
  ageMin?: number;
  ageMax?: number;
};

export function ProfileScreen() {
  const nav = useNavigation<ProfileNav>();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const { logout, setUser } = useAuthStore();
  const { isAnonymous, anonymousUntil, askToggle: toggleAnonymous } = useVisibility();
  // invisível grátis: "Invisível até 14h32" (janela de 24 h; dá pra religar quando quiser)
  const anonUntil = anonymousUntilLabel(anonymousUntil);
  const [busy, setBusy] = useState(false);
  // avisos não lidos: ponto no sininho (a mesma lista do ponto da aba)
  const notifications = useNotificationList();
  const unreadNotices = unreadNotifications(notifications.data);

  const query = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const me = (await api.get<User>('/me')).data;
      setUser(me);
      return me;
    },
    // perfil do store enquanto o /me chega (sem spinner eterno depois de login/logout)
    placeholderData: () => useAuthStore.getState().user ?? undefined,
  });

  // otimista: o switch fica onde o usuário deixou; volta só se o servidor recusar
  const settings = useMutation({
    mutationKey: ['me-settings'],
    mutationFn: async (patch: SettingsPatch) => (await api.patch('/me/settings', patch)).data,
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ['me'] });
      const prev = qc.getQueryData<User>(['me']);
      qc.setQueryData<User>(['me'], (old) => (old ? { ...old, settings: { ...old.settings, ...patch } } : old));
      return { prev };
    },
    onError: (err, _patch, ctx) => {
      if (ctx?.prev) qc.setQueryData(['me'], ctx.prev);
      Alert.alert('Ops', toApiError(err).message);
    },
    // "Mostrar", faixa de idade e "mesma orientação primeiro" mudam quem aparece e a ordem: mapa, lista e deck buscam de novo
    onSuccess: (_data, patch) => {
      if (
        patch.showMe !== undefined ||
        patch.sameOrientationFirst !== undefined ||
        patch.ageMin !== undefined ||
        patch.ageMax !== undefined
      )
        qc.invalidateQueries({ queryKey: ['nearby'] });
    },
    // só refaz o /me quando o último toque terminar (senão um refetch no meio desfaz o seguinte)
    onSettled: () => {
      if (qc.isMutating({ mutationKey: ['me-settings'] }) === 1) qc.invalidateQueries({ queryKey: ['me'] });
    },
  });

  // ---- parallax do header (UI thread) ----
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  const avatarStyle = useAnimatedStyle(() => {
    const scale = interpolate(scrollY.value, [-120, 0, PARALLAX_RANGE], [1.15, 1, 0.55], Extrapolation.CLAMP);
    const translateY = interpolate(scrollY.value, [0, PARALLAX_RANGE], [0, PARALLAX_RANGE * 0.35], Extrapolation.CLAMP);
    const opacity = interpolate(scrollY.value, [0, PARALLAX_RANGE * 0.9], [1, 0], Extrapolation.CLAMP);
    return { opacity, transform: [{ translateY }, { scale }] };
  });

  const identityStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [0, PARALLAX_RANGE * 0.6], [1, 0], Extrapolation.CLAMP),
    transform: [{ translateY: interpolate(scrollY.value, [0, PARALLAX_RANGE], [0, -24], Extrapolation.CLAMP) }],
  }));

  const compactBarStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [PARALLAX_RANGE * 0.55, PARALLAX_RANGE], [0, 1], Extrapolation.CLAMP),
    transform: [{ translateY: interpolate(scrollY.value, [PARALLAX_RANGE * 0.55, PARALLAX_RANGE], [-8, 0], Extrapolation.CLAMP) }],
  }));

  if (query.isError && !query.data) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.loadingText}>{toApiError(query.error).message}</Text>
        <Button title="Tentar de novo" onPress={() => query.refetch()} loading={query.isFetching} />
      </SafeAreaView>
    );
  }

  if (query.isPending || !query.data) {
    return (
      <SafeAreaView style={styles.center}>
        <Pulse maxScale={1.12} minOpacity={0.6}>
          <ActivityIndicator color={colors.primary} size="large" />
        </Pulse>
        <Text style={styles.loadingText}>buscando seu perfil…</Text>
      </SafeAreaView>
    );
  }

  const me = query.data;
  const mainPhoto = me.photos?.find((p) => p.isMain) ?? me.photos?.[0];
  const completeness = Math.max(0, Math.min(100, me.profileCompleteness ?? 0));

  const confirmLogout = () =>
    Alert.alert('Sair da conta?', 'Você vai precisar do código SMS pra entrar de novo.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sair', style: 'destructive', onPress: () => logout() },
    ]);

  const pause = () =>
    Alert.alert('Pausar perfil', 'Você some do mapa e das curtidas por 24h. Suas conversas continuam.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Pausar 24h',
        onPress: async () => {
          setBusy(true);
          try {
            await api.patch('/me/pause', { durationHours: 24 });
            qc.invalidateQueries({ queryKey: ['me'] });
          } catch (err) {
            Alert.alert('Ops', toApiError(err).message);
          } finally {
            setBusy(false);
          }
        },
      },
    ]);

  const resume = async () => {
    setBusy(true);
    try {
      await api.delete('/me/pause');
      qc.invalidateQueries({ queryKey: ['me'] });
      qc.invalidateQueries({ queryKey: ['nearby'] });
    } catch (err) {
      Alert.alert('Ops', toApiError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const goEdit = () => nav.navigate('EditProfile');
  const goBoost = () => nav.navigate('Boost');
  const goPhotos = () => nav.navigate('PhotoUpload', { fromOnboarding: false });
  const goAvatar = () => nav.navigate('AvatarSetup', { fromOnboarding: false });
  const goNotifications = () => nav.navigate('Notifications');
  const cruzeiAvatar = resolveAvatar(me.avatar, me.id, me.gender);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Barra compacta: aparece quando o avatar grande já saiu de cena */}
      <Animated.View pointerEvents="none" style={[styles.compactBar, { top: insets.top }, compactBarStyle]}>
        {mainPhoto ? <Image source={{ uri: mainPhoto.url }} style={styles.compactAvatar} /> : <View style={[styles.compactAvatar, styles.compactAvatarEmpty]} />}
        <Text style={styles.compactName} numberOfLines={1}>
          {me.name}, {me.age}
        </Text>
        <View style={styles.compactPct}>
          <Text style={styles.compactPctText}>{completeness}%</Text>
        </View>
      </Animated.View>

      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl + insets.bottom }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} tintColor={colors.primary} />}
      >
        <FadeInView fromY={-8} style={styles.titleRow}>
          <Text style={styles.title}>seu perfil</Text>
          <View style={styles.titleActions}>
            <Pressable
              onPress={goNotifications}
              style={({ pressed }) => [styles.bellBtn, pressed && { opacity: 0.6 }]}
              accessibilityRole="button"
              accessibilityLabel={unreadNotices > 0 ? `Avisos, ${unreadNotices} ${unreadNotices === 1 ? 'novo' : 'novos'}` : 'Avisos'}
            >
              <Ionicons name={unreadNotices > 0 ? 'notifications' : 'notifications-outline'} size={20} color={colors.black} />
              {unreadNotices > 0 ? <View style={styles.bellDot} /> : null}
            </Pressable>
            <ScaleOnPress onPress={goEdit} style={styles.editBtn} accessibilityRole="button" accessibilityLabel="Editar perfil" glowColor={colors.primary}>
              <Ionicons name="create-outline" size={18} color={colors.black} />
              <Text style={styles.editText}>Editar</Text>
            </ScaleOnPress>
          </View>
        </FadeInView>

        {/* Header com parallax */}
        <View style={styles.header}>
          <Animated.View style={avatarStyle}>
            <ScaleOnPress onPress={goEdit} pressedScale={0.97} accessibilityRole="imagebutton" accessibilityLabel="Sua foto principal. Toque pra editar o perfil">
              <Glow color={colors.primary} spread={16} intensity={0.55} cycleMs={2400} shape="circle">
                <CompletenessRing percent={completeness}>
                  {mainPhoto ? (
                    <Image source={{ uri: mainPhoto.url }} style={styles.avatar} />
                  ) : (
                    <View style={[styles.avatar, styles.avatarPlaceholder]}>
                      <Ionicons name="camera-outline" size={32} color={colors.gray[400]} />
                      <Text style={styles.avatarHint}>adicionar foto</Text>
                    </View>
                  )}
                </CompletenessRing>
              </Glow>
            </ScaleOnPress>
          </Animated.View>

          <Animated.View style={[styles.identity, identityStyle]}>
            <FadeInView delay={120} fromY={10}>
              <Text style={styles.name}>
                {me.name}, {me.age}
                {me.isVerified ? '  ' : ''}
                {me.isVerified ? <Ionicons name="checkmark-circle" size={20} color={colors.info} /> : null}
              </Text>
            </FadeInView>
            <FadeInView delay={180} fromY={10}>
              <Text style={styles.age}>{LOOKING_FOR_LABEL[me.lookingFor] ?? me.lookingFor}</Text>
            </FadeInView>
            <FadeInView delay={260} fromScale={0.9} style={styles.completePill}>
              <AnimatedNumber value={completeness} delay={300} style={styles.completeText} suffix="% completo" />
            </FadeInView>
            {completeness < 100 ? (
              <FadeInView delay={340}>
                <Text style={styles.completeHint}>{completenessHint(me)}</Text>
              </FadeInView>
            ) : null}
          </Animated.View>
        </View>

        {me.bio ? (
          <FadeInView delay={300} fromY={12}>
            <Text style={styles.bio}>{me.bio}</Text>
          </FadeInView>
        ) : null}

        {me.interests?.length ? (
          <View style={styles.chips}>
            {me.interests.map((i, idx) => (
              <FadeInView key={i} delay={320 + idx * 35} fromScale={0.8} style={styles.chip}>
                <Text style={styles.chipText}>{i}</Text>
              </FadeInView>
            ))}
          </View>
        ) : null}

        {/* @ do Instagram à vista (é público no cartão); sem @, o atalho pra pôr em Editar perfil */}
        <FadeInView delay={350} fromScale={0.92} style={styles.instaWrap}>
          <ScaleOnPress
            onPress={goEdit}
            pressedScale={0.96}
            style={me.instagram ? styles.instaPill : [styles.instaPill, styles.instaPillEmpty]}
            accessibilityRole="button"
            accessibilityLabel={me.instagram ? `Seu Instagram: @${me.instagram}. Toque pra editar` : 'Adicionar seu Instagram'}
          >
            <Ionicons name={me.instagram ? 'logo-instagram' : 'add'} size={16} color={colors.black} />
            <Text style={styles.instaText} numberOfLines={1}>
              {me.instagram ? `@${me.instagram}` : 'Adicionar seu Instagram'}
            </Text>
          </ScaleOnPress>
        </FadeInView>

        <FadeInView delay={380} fromY={16} style={styles.statsRow}>
          <Stat label="curtidas" value={me.stats?.likesReceived ?? 0} delay={450} />
          <View style={styles.statDivider} />
          <Stat label="matches" value={me.stats?.matches ?? 0} delay={520} accent />
          <View style={styles.statDivider} />
          <Stat label="fotos" value={me.photos?.length ?? 0} delay={590} />
        </FadeInView>

        {/* Ações rápidas */}
        <FadeInView delay={460} fromY={16} style={styles.actionsRow}>
          <Glow color={colors.primary} spread={10} intensity={0.45} shape="pill" cycleMs={2200} style={{ flex: 1 }}>
            <ScaleOnPress onPress={goBoost} style={[styles.actionBtn, styles.actionBoost]} accessibilityRole="button" accessibilityLabel="Ativar boost">
              <Ionicons name="flash" size={18} color={colors.primary} />
              <Text style={styles.actionBoostText}>Boost ⚡</Text>
            </ScaleOnPress>
          </Glow>
          <ScaleOnPress onPress={goPhotos} style={[styles.actionBtn, styles.actionPhotos]} accessibilityRole="button" accessibilityLabel="Gerenciar fotos">
            <Ionicons name="images-outline" size={18} color={colors.black} />
            <Text style={styles.actionPhotosText}>Fotos</Text>
          </ScaleOnPress>
        </FadeInView>

        {/* Seu avatar — o boneco que aparece no mapa */}
        <FadeInView delay={500} fromY={16} style={styles.avatarCard}>
          <ScaleOnPress
            onPress={goAvatar}
            pressedScale={0.98}
            haptic={false}
            style={styles.avatarCardInner}
            accessibilityRole="button"
            accessibilityLabel="Seu avatar. Toque pra personalizar"
          >
            <View style={styles.avatarStage}>
              <Glow color={colors.primary} spread={22} intensity={0.35} shape="circle" cycleMs={3000}>
                <CruzeiAvatar config={cruzeiAvatar} mode="full" size={CRUZEI_AVATAR} groundShadow accessibilityLabel={`Seu avatar ${BRAND.name}`} />
              </Glow>
            </View>
            <View style={styles.avatarInfo}>
              <Text style={styles.avatarTitle}>seu avatar</Text>
              <Text style={styles.avatarHintText}>É assim que você aparece no mapa pra quem te cruza.</Text>
              <View style={styles.avatarBtn}>
                <Ionicons name="color-palette-outline" size={16} color={colors.black} />
                <Text style={styles.avatarBtnText}>Personalizar</Text>
              </View>
            </View>
          </ScaleOnPress>
        </FadeInView>

        <Section title="visibilidade" delay={540}>
          <Row
            icon={isAnonymous ? 'eye-off-outline' : 'eye-outline'}
            label="Modo anônimo"
            hint={anonUntil ? `Invisível até ${anonUntil}` : 'Você vê todo mundo, ninguém sabe que é você'}
            value={isAnonymous}
            onToggle={() => toggleAnonymous()}
          />
          <Row icon="navigate-outline" label="Mostrar distância" value={me.settings.showDistance} onToggle={(v) => settings.mutate({ showDistance: v })} />
          <Row
            icon="image-outline"
            label="Mostrar minha foto no mapa"
            hint="Desligado: no mapa aparece só o seu avatar"
            value={me.settings.showPhotoOnMap ?? true}
            onToggle={(v) => settings.mutate({ showPhotoOnMap: v })}
          />
          <Row icon="calendar-outline" label="Mostrar idade" value={me.settings.showAge} onToggle={(v) => settings.mutate({ showAge: v })} />
          <DiscoveryModeRow value={me.settings.discoveryMode ?? 'everyone'} onChange={(discoveryMode) => settings.mutate({ discoveryMode })} />
          <Link icon="home-outline" label="Áreas privadas" hint="casa, trabalho… ninguém te descobre lá" onPress={() => nav.navigate('PrivateAreas' as never)} last />
        </Section>

        {/* quem aparece pra você (recíproco) e a orientação: exibir no perfil / mesma orientação primeiro */}
        <Section title="quem você vê" delay={560}>
          <ShowMeRow value={me.settings.showMe ?? 'everyone'} onChange={(showMe) => settings.mutate({ showMe })} />
          <AgeRangeRow
            min={me.settings.ageMin ?? AGE_MIN}
            max={me.settings.ageMax ?? AGE_MAX}
            onChange={(ageMin, ageMax) => settings.mutate({ ageMin, ageMax })}
          />
          {me.orientation ? (
            <>
              <Row
                icon="eye-outline"
                label={ORIENTATION_LABELS[me.orientation] ? `Mostrar "${ORIENTATION_LABELS[me.orientation]}" no perfil` : 'Mostrar orientação no perfil'}
                hint="Quem abrir seu perfil vê sua orientação"
                value={me.settings.showOrientation ?? false}
                onToggle={(v) => settings.mutate({ showOrientation: v })}
              />
              <Row
                icon="swap-vertical-outline"
                label="Mesma orientação primeiro"
                hint="Quem mostra a mesma orientação aparece antes. Só muda a ordem"
                value={me.settings.sameOrientationFirst ?? false}
                onToggle={(v) => settings.mutate({ sameOrientationFirst: v })}
                last
              />
            </>
          ) : (
            <Link icon="heart-half-outline" label="Orientação" hint="informe em Editar perfil (opcional)" onPress={goEdit} last />
          )}
        </Section>

        <Section title="segurança" delay={580}>
          <Link icon="help-buoy-outline" label="Ajuda e segurança" hint="suporte e termos" onPress={() => nav.navigate('Help' as never)} />
          <Link icon="ban-outline" label="Pessoas bloqueadas" onPress={() => nav.navigate('BlockedUsers' as never)} last={me.role !== 'moderator' && me.role !== 'admin'} />
          {me.role === 'moderator' || me.role === 'admin' ? (
            <Link icon="shield-half-outline" label="Moderação" hint="denúncias e fotos em análise" onPress={() => nav.navigate('Moderation' as never)} last />
          ) : null}
        </Section>

        <Section title="conta" delay={620}>
          <Link
            icon="notifications-outline"
            label="Avisos"
            hint={unreadNotices > 0 ? `${unreadNotices > 99 ? '99+' : unreadNotices} ${unreadNotices === 1 ? 'novo' : 'novos'}` : 'eventos, suporte e novidades'}
            onPress={goNotifications}
          />
          <Link
            icon="shield-checkmark-outline"
            label="Verificação por selfie"
            hint={me.isVerified ? 'verificado' : 'em breve'}
            onPress={() => Alert.alert('Em breve', 'A verificação por selfie chega no beta.')}
          />
          <Link
            icon="pause-circle-outline"
            label={me.settings.isPaused ? 'Retomar perfil agora' : 'Pausar perfil por 24h'}
            hint={me.settings.isPaused ? 'você está fora do mapa e das curtidas' : undefined}
            onPress={me.settings.isPaused ? resume : pause}
            disabled={busy}
          />
          <Link
            icon="download-outline"
            label="Baixar meus dados (LGPD)"
            onPress={() => Alert.alert('Baixar meus dados', `Manda um "meus dados" pro ${BRAND.supportEmail} — o export automático chega no beta.`)}
          />
          <Link
            icon="trash-outline"
            label="Excluir conta"
            danger
            last
            onPress={() => Alert.alert('Excluir conta', `Manda um "excluir" pro ${BRAND.supportEmail} — a exclusão automática chega no beta.`)}
          />
        </Section>

        <FadeInView delay={700}>
          <View style={{ height: spacing.lg }} />
          <Button title="Sair" variant="ghost" onPress={confirmLogout} fullWidth />
          <Text style={styles.version}>{BRAND.wordmark} {BRAND.version} · {me.phone}</Text>
        </FadeInView>
      </Animated.ScrollView>
    </SafeAreaView>
  );
}

// Dica curta do que falta pra completar o perfil (só a primeira pendência)
function completenessHint(me: User): string {
  if (!me.photos?.length) return 'Bota uma foto e já sobe um monte 📸';
  if (!me.bio) return 'Uma bio de uma frase já ajuda muito ✍️';
  if (!me.interests?.length) return 'Marca uns interesses pra render papo 💬';
  if ((me.photos?.length ?? 0) < 3) return 'Com 3 fotos seu perfil fica redondo 🔥';
  return 'Quase lá — falta pouco pra 100%';
}

/* ---------- Anel de completude (Skia) ---------- */

function CompletenessRing({ percent, children }: { percent: number; children: React.ReactNode }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(350, withTiming(Math.max(0.02, percent / 100), { duration: 1100, easing: Easing.out(Easing.cubic) }));
    return () => cancelAnimation(progress);
  }, [percent, progress]);

  const inset = RING_STROKE / 2;
  const path = useMemo(() => {
    return Skia.PathBuilder.Make().addArc(rect(inset, inset, RING - RING_STROKE, RING - RING_STROKE), -90, 359.9).build();
  }, [inset]);

  const c = RING / 2;

  return (
    <View style={styles.ringWrap} accessibilityLabel={`Perfil ${percent}% completo`}>
      <Canvas style={styles.ringCanvas} pointerEvents="none">
        <Circle cx={c} cy={c} r={c - inset} color={colors.gray[200]} style="stroke" strokeWidth={RING_STROKE} />
        <Path path={path} style="stroke" strokeWidth={RING_STROKE} strokeCap="round" start={0} end={progress}>
          <SweepGradient c={vec(c, c)} colors={[colors.primary, colors.success, colors.primary]} />
        </Path>
      </Canvas>
      {children}
    </View>
  );
}

/* ---------- Número com contagem animada (sem setState por frame) ---------- */

function AnimatedNumber({ value, delay = 0, style, suffix = '' }: { value: number; delay?: number; style: StyleProp<TextStyle>; suffix?: string }) {
  const v = useSharedValue(0);

  useEffect(() => {
    v.value = withDelay(delay, withTiming(value, { duration: 900, easing: Easing.out(Easing.cubic) }));
    return () => cancelAnimation(v);
  }, [delay, v, value]);

  const animatedProps = useAnimatedProps(() => {
    const text = `${Math.round(v.value)}${suffix}`;
    return { text, defaultValue: text } as unknown as TextInputProps;
  });

  return (
    <AnimatedTextInput
      animatedProps={animatedProps}
      editable={false}
      underlineColorAndroid="transparent"
      defaultValue={`0${suffix}`}
      style={[styles.animatedNumber, style]}
      accessibilityLabel={`${value}${suffix}`}
      importantForAccessibility="no-hide-descendants"
    />
  );
}

function Stat({ label, value, delay, accent }: { label: string; value: number; delay: number; accent?: boolean }) {
  return (
    <View style={styles.stat}>
      <AnimatedNumber value={value} delay={delay} style={[styles.statValue, accent && { color: colors.secondary }]} />
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const DISCOVERY_OPTIONS: { value: 'everyone' | 'compatible' | 'nobody'; label: string; hint: string }[] = [
  { value: 'everyone', label: '🟢 Todos', hint: 'quem está perto te descobre (e você descobre)' },
  { value: 'compatible', label: '🟡 Interesses', hint: 'só quem divide um interesse com você' },
  { value: 'nobody', label: '🔴 Ninguém', hint: 'você some da descoberta por proximidade' },
];

/** Descoberta por proximidade (brief PRIVACIDADE §12/§13): recíproca — vale pros dois lados. */
function DiscoveryModeRow({ value, onChange }: { value: 'everyone' | 'compatible' | 'nobody'; onChange: (v: 'everyone' | 'compatible' | 'nobody') => void }) {
  const current = DISCOVERY_OPTIONS.find((o) => o.value === value) ?? DISCOVERY_OPTIONS[0];
  return (
    <View style={styles.row}>
      <View style={[styles.rowIcon, value !== 'nobody' && styles.rowIconOn]}>
        <Ionicons name="radio-outline" size={20} color={colors.black} />
      </View>
      <View style={{ flex: 1, gap: 6 }}>
        <Text style={styles.rowLabel}>Descoberta por proximidade</Text>
        <Text style={styles.rowHint}>{current.hint}</Text>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {DISCOVERY_OPTIONS.map((o) => (
            <Pressable
              key={o.value}
              onPress={() => {
                lightTap();
                onChange(o.value);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: o.value === value }}
              accessibilityLabel={`${o.label}: ${o.hint}`}
              style={{ paddingHorizontal: 12, height: 32, borderRadius: 16, justifyContent: 'center', backgroundColor: o.value === value ? colors.black : colors.surfaceAlt }}
            >
              <Text style={{ ...typography.caption, color: o.value === value ? colors.primary : colors.black }}>{o.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

const SHOW_ME_HINT: Record<ShowMe, string> = {
  women: 'só mulheres, e só quem também quer te ver',
  men: 'só homens, e só quem também quer te ver',
  everyone: 'todo mundo que também quer te ver',
};

/** "Mostrar: Mulheres / Homens / Todos" — recíproco: vale no mapa, na lista e nas curtidas */
function ShowMeRow({ value, onChange }: { value: ShowMe; onChange: (v: ShowMe) => void }) {
  return (
    <View style={styles.row}>
      <View style={[styles.rowIcon, styles.rowIconOn]}>
        <Ionicons name="people-outline" size={20} color={colors.black} />
      </View>
      <View style={{ flex: 1, gap: 6 }}>
        <Text style={styles.rowLabel}>Mostrar</Text>
        <Text style={styles.rowHint}>{SHOW_ME_HINT[value]}</Text>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }} accessibilityRole="radiogroup">
          {SHOW_ME.map((o) => (
            <Pressable
              key={o}
              onPress={() => {
                if (o === value) return;
                lightTap();
                onChange(o);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: o === value, checked: o === value }}
              accessibilityLabel={`Mostrar ${SHOW_ME_LABELS[o]}: ${SHOW_ME_HINT[o]}`}
              style={{ paddingHorizontal: 12, minHeight: 32, borderRadius: 16, justifyContent: 'center', backgroundColor: o === value ? colors.black : colors.surfaceAlt }}
            >
              <Text style={{ ...typography.caption, color: o === value ? colors.primary : colors.black }}>{SHOW_ME_LABELS[o]}</Text>
            </Pressable>
          ))}
        </View>
        {/* transparência: a escolha recíproca pode ser percebida (Política 3.3) */}
        <Text style={styles.rowHint}>{SHOW_ME_RECIPROCAL_NOTE}</Text>
      </View>
    </View>
  );
}

/** "Idade: de X a Y anos" — só o que EU vejo (não recíproco), no mapa, na lista e nas curtidas */
function AgeRangeRow({ min, max, onChange }: { min: number; max: number; onChange: (min: number, max: number) => void }) {
  // grava 1,5 s depois de soltar: mexer no "de" e no "até" em seguida gasta 1 das 5 mudanças do dia
  const draft = useAgeRangeDraft([min, max], onChange);
  return (
    <View style={styles.row}>
      <View style={[styles.rowIcon, styles.rowIconOn, styles.rowIconTop]}>
        <Ionicons name="options-outline" size={20} color={colors.black} />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.rowLabel}>Idade</Text>
        <AgeRangeSlider min={draft.value[0]} max={draft.value[1]} onChange={draft.change} />
        <Text style={styles.rowHint}>
          Só muda quem aparece pra você (não é recíproco). Quem esconde a idade entra pelo bloco de 5 anos dela, sem a
          idade aparecer. Dá pra mudar a faixa {AGE_RANGE_DAILY_CHANGES} vezes por dia.
        </Text>
      </View>
    </View>
  );
}

function Section({ title, delay, children }: { title: string; delay: number; children: React.ReactNode }) {
  return (
    <FadeInView delay={delay} fromY={18} style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </FadeInView>
  );
}

function Row({ icon, label, hint, value, onToggle, last }: { icon: string; label: string; hint?: string; value: boolean; onToggle: (next: boolean) => void; last?: boolean }) {
  // repassa o valor novo do Switch (não o inverso do cache, que pode estar velho)
  const change = (next: boolean) => {
    lightTap();
    onToggle(next);
  };
  return (
    <View style={[styles.row, last && styles.rowLast]}>
      <View style={[styles.rowIcon, value && styles.rowIconOn]}>
        <Ionicons name={icon as never} size={20} color={colors.black} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={change}
        trackColor={{ false: colors.gray[200], true: colors.primary }}
        thumbColor={colors.white}
        ios_backgroundColor={colors.gray[200]}
        accessibilityRole="switch"
        accessibilityLabel={label}
        accessibilityHint={hint}
        accessibilityState={{ checked: value }}
      />
    </View>
  );
}

function Link({
  icon,
  label,
  hint,
  danger,
  disabled,
  last,
  onPress,
}: {
  icon: string;
  label: string;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  last?: boolean;
  onPress: () => void;
}) {
  return (
    <ScaleOnPress
      style={[styles.link, last ? styles.rowLast : {}, disabled ? { opacity: 0.5 } : {}]}
      onPress={onPress}
      disabled={disabled}
      pressedScale={0.985}
      haptic={false}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!disabled }}
    >
      <View style={[styles.rowIcon, danger && styles.rowIconDanger]}>
        <Ionicons name={icon as never} size={20} color={danger ? colors.danger : colors.black} />
      </View>
      <Text style={[styles.linkText, danger && { color: colors.danger }]}>{label}</Text>
      {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      <Ionicons name="chevron-forward" size={20} color={colors.gray[400]} />
    </ScaleOnPress>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, gap: spacing.md },
  loadingText: { ...typography.bodySmall, color: colors.gray[500] },

  compactBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    // opaco: com a barra visível, os títulos da lista ("SEGURANÇA"…) não podem vazar por baixo dela
    backgroundColor: colors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.gray[200],
  },
  compactAvatar: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: colors.primary },
  compactAvatarEmpty: { backgroundColor: colors.gray[200] },
  compactName: { ...typography.h4, color: colors.black, flex: 1 },
  compactPct: { backgroundColor: '#E9FFC7', borderRadius: radius.full, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  compactPctText: { ...typography.caption, color: '#3A7A00' },

  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg },
  title: { ...typography.h1, color: colors.black },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    borderRadius: radius.full,
  },
  editText: { ...typography.label, color: colors.black },
  titleActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  // colors.white é o fundo: o botão redondo precisa de borda
  bellBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.gray[200],
  },
  bellDot: {
    position: 'absolute',
    top: 9,
    right: 10,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
    borderWidth: 1.5,
    borderColor: colors.surface,
  },

  header: { alignItems: 'center', marginBottom: spacing.lg },
  ringWrap: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
  ringCanvas: { ...StyleSheet.absoluteFill, width: RING, height: RING },
  avatar: { width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, backgroundColor: colors.gray[100] },
  avatarPlaceholder: { alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderStyle: 'dashed', borderColor: colors.gray[300] },
  avatarHint: { ...typography.bodySmall, color: colors.gray[500], marginTop: 4 },
  identity: { alignItems: 'center', marginTop: spacing.md },
  name: { ...typography.h2, color: colors.black, textAlign: 'center' },
  age: { ...typography.body, color: colors.gray[600], marginTop: spacing.xs },
  completePill: { marginTop: spacing.md, backgroundColor: '#E9FFC7', borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: 4, alignItems: 'center' },
  completeText: { ...typography.label, color: '#3A7A00', textAlign: 'center' },
  completeHint: { ...typography.bodySmall, color: colors.gray[500], marginTop: spacing.sm, textAlign: 'center' },
  animatedNumber: { padding: 0, margin: 0, textAlign: 'center' },

  bio: { ...typography.body, color: colors.black, textAlign: 'center', marginBottom: spacing.lg, paddingHorizontal: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'center', marginBottom: spacing.lg },
  chip: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.gray[200], borderRadius: radius.full, paddingHorizontal: spacing.md, paddingVertical: 6 },
  chipText: { ...typography.bodySmall, color: colors.black },

  instaWrap: { alignItems: 'center', marginBottom: spacing.lg },
  instaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '100%',
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray[200],
  },
  instaPillEmpty: { borderStyle: 'dashed', borderColor: colors.gray[400], backgroundColor: 'transparent' },
  instaText: { ...typography.label, color: colors.black, flexShrink: 1 },
  statsRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.white, borderRadius: radius.lg, marginBottom: spacing.md, ...shadows.light },
  stat: { flex: 1, alignItems: 'center', paddingVertical: spacing.md },
  statDivider: { width: StyleSheet.hairlineWidth, height: 28, backgroundColor: colors.gray[200] },
  statValue: { ...typography.h3, color: colors.black },
  statLabel: { ...typography.bodySmall, color: colors.gray[500] },

  actionsRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.xl },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, minHeight: 48, borderRadius: radius.full },
  actionBoost: { backgroundColor: colors.black },
  actionBoostText: { ...typography.label, color: colors.primary },
  actionPhotos: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.gray[200] },
  actionPhotosText: { ...typography.label, color: colors.black },

  avatarCard: { marginBottom: spacing.xl, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.black, ...shadows.medium },
  avatarCardInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, paddingLeft: spacing.lg },
  avatarStage: { width: CRUZEI_AVATAR, alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.sm },
  avatarInfo: { flex: 1, gap: spacing.xs },
  avatarTitle: { ...typography.h3, color: colors.white },
  avatarHintText: { ...typography.bodySmall, color: colors.gray[400] },
  avatarBtn: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.xs,
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
  },
  avatarBtnText: { ...typography.label, color: colors.black },

  section: { marginBottom: spacing.xl },
  sectionTitle: { ...typography.label, color: colors.gray[500], textTransform: 'uppercase', marginBottom: spacing.sm },
  sectionBody: { backgroundColor: colors.white, borderRadius: radius.lg, overflow: 'hidden', ...shadows.light },
  row: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, minHeight: 56, borderBottomWidth: 1, borderBottomColor: colors.gray[100], gap: spacing.md },
  rowLast: { borderBottomWidth: 0 },
  rowIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.gray[100], alignItems: 'center', justifyContent: 'center' },
  rowIconOn: { backgroundColor: '#E9FFC7' },
  rowIconTop: { alignSelf: 'flex-start' },
  rowIconDanger: { backgroundColor: '#FFECEB' },
  rowLabel: { ...typography.body, color: colors.black },
  rowHint: { ...typography.bodySmall, color: colors.gray[500] },
  link: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, minHeight: 56, borderBottomWidth: 1, borderBottomColor: colors.gray[100], gap: spacing.md, backgroundColor: colors.white },
  linkText: { ...typography.body, color: colors.black, flex: 1 },
  version: { ...typography.bodySmall, color: colors.gray[400], textAlign: 'center', marginTop: spacing.lg },
});
