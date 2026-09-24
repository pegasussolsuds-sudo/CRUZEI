import React, { useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo, Image, Modal, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';

import { useAuthStore } from '../stores/auth';
import { colors, radius, spacing, spring, typography } from '@cruzei/ui-mobile';
import type { MainTabParamList } from '../navigation/MainTabs';
import { BlobBackground, Confetti, FadeInView, Glow, Pulse, ScaleOnPress, SlideInView } from './animated';

export interface MatchInfo {
  matchId: string;
  name: string;
  photo: string | null;
  context?: string | null;
}

// Timeline da celebração (ms) — cada peça entra em cascata depois do flip do card.
const T = {
  flip: 120,
  heart: 520,
  title: 640,
  names: 760,
  avatars: 700,
  context: 900,
  buttons: 1050,
} as const;

const AVATAR = 88;
const CARD_BG = '#12122A';

/**
 * "É um match!" — tela de celebração premium: confete, card com flip 3D, coração pulsando
 * com glow magenta, avatares com anel neon e o contexto de ONDE vocês se cruzaram.
 * API pública: <MatchModal match={info | null} onClose={...} />
 */
export function MatchModal({ match, onClose }: { match: MatchInfo | null; onClose: () => void }) {
  const nav = useNavigation<NavigationProp<MainTabParamList>>();
  const me = useAuthStore((s) => s.user);

  if (!match) return null;
  const myPhoto = me?.photos?.find((p) => p.isMain)?.url ?? me?.photos?.[0]?.url ?? null;

  const openChat = () => {
    onClose();
    // initial:false → MatchesList fica embaixo na pilha e o chat ganha botão de voltar
    nav.navigate('Matches', { screen: 'Chat', initial: false, params: { matchId: match.matchId, name: match.name } } as never);
  };

  return (
    <Modal visible transparent statusBarTranslucent animationType="fade" onRequestClose={onClose}>
      {/* key = matchId → cada match novo remonta a celebração e roda todas as entradas do zero */}
      <Celebration key={match.matchId} match={match} myPhoto={myPhoto} onClose={onClose} onOpenChat={openChat} />
    </Modal>
  );
}

function Celebration({
  match,
  myPhoto,
  onClose,
  onOpenChat,
}: {
  match: MatchInfo;
  myPhoto: string | null;
  onClose: () => void;
  onOpenChat: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const [confetti, setConfetti] = useState(!reduceMotion);

  // flip 3D do card: 180° (de costas) → 0° com spring
  const rotate = useSharedValue(reduceMotion ? 0 : 180);
  // bounce do título "É um match!"
  const titlePop = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    AccessibilityInfo.announceForAccessibility(`Deu match com ${match.name}`);

    if (!reduceMotion) {
      rotate.value = withDelay(T.flip, withSpring(0, { damping: 15, stiffness: 95, mass: 1 }));
      titlePop.value = withDelay(T.title, withSpring(1, spring.bouncy));
    }
    return () => {
      cancelAnimation(rotate);
      cancelAnimation(titlePop);
    };
  }, [match.name, reduceMotion, rotate, titlePop]);

  const frontStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 1200 }, { rotateY: `${rotate.value}deg` }],
  }));
  const backStyle = useAnimatedStyle(() => ({
    transform: [{ perspective: 1200 }, { rotateY: `${rotate.value + 180}deg` }],
  }));
  const titleStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, titlePop.value * 1.5),
    transform: [{ scale: titlePop.value }],
  }));

  const onConfettiDone = useCallback(() => setConfetti(false), []);
  const contextText = match.context ?? 'Vocês estiveram perto hoje.';

  return (
    <View style={styles.root} accessibilityViewIsModal>
      {/* fundo vivo magenta/lima + véu escuro pra dar contraste ao card */}
      <BlobBackground palette={[colors.secondary, colors.primary, colors.secondary]} intensity={0.85} speed={1.6} />
      <View style={styles.veil} pointerEvents="none" />

      <View style={styles.center}>
        <View style={styles.cardWrap}>
          {/* verso do card: aparece nos primeiros 90° do flip */}
          <Animated.View style={[styles.card, styles.cardBack, backStyle]} pointerEvents="none">
            <Ionicons name="heart" size={96} color={colors.white} />
          </Animated.View>

          {/* frente do card */}
          <Animated.View style={[styles.card, frontStyle]}>
            <Animated.Text style={[styles.title, titleStyle]} accessibilityRole="header" allowFontScaling>
              É um match!
            </Animated.Text>
            <FadeInView delay={T.names} fromY={8}>
              <Text style={styles.names}>
                você e <Text style={styles.nameHighlight}>{match.name}</Text>
              </Text>
            </FadeInView>

            <View style={styles.avatars}>
              <SlideInView from="left" distance={48} delay={T.avatars} springPreset="bouncy">
                <Glow color={colors.primary} spread={14} intensity={0.85} cycleMs={1800}>
                  <Avatar uri={myPhoto} ring={colors.primary} label="Sua foto" />
                </Glow>
              </SlideInView>

              <FadeInView delay={T.heart} fromScale={0.3} durationMs={260} style={styles.heartSlot}>
                <Glow color={colors.secondary} spread={20} intensity={1} cycleMs={1200}>
                  <Pulse maxScale={1.14} cycleMs={1000}>
                    <View style={styles.heart} accessible={false}>
                      <Ionicons name="heart" size={30} color={colors.white} />
                    </View>
                  </Pulse>
                </Glow>
              </FadeInView>

              <SlideInView from="right" distance={48} delay={T.avatars} springPreset="bouncy">
                <Glow color={colors.secondary} spread={14} intensity={0.85} cycleMs={1800}>
                  <Avatar uri={match.photo} ring={colors.secondary} label={`Foto de ${match.name}`} />
                </Glow>
              </SlideInView>
            </View>

            <SlideInView from="up" distance={20} delay={T.context} style={styles.contextBox}>
              <Ionicons name="location" size={16} color={colors.secondary} />
              <Text style={styles.contextText}>{contextText} 💚</Text>
            </SlideInView>

            <FadeInView delay={T.buttons} fromY={16} style={styles.actions}>
              <Glow color={colors.primary} spread={14} intensity={0.6} shape="pill" cycleMs={2000} style={styles.stretch}>
                <ScaleOnPress
                  onPress={onOpenChat}
                  glowColor={colors.primary}
                  style={styles.primary}
                  accessibilityRole="button"
                  accessibilityLabel={`Mandar mensagem pra ${match.name}`}
                >
                  <Ionicons name="chatbubble-ellipses" size={18} color={colors.black} />
                  <Text style={styles.primaryText}>Mandar mensagem</Text>
                </ScaleOnPress>
              </Glow>
              <ScaleOnPress
                onPress={onClose}
                pressedScale={0.97}
                style={styles.secondary}
                accessibilityRole="button"
                accessibilityLabel="Continuar explorando"
                accessibilityHint="Fecha a celebração e volta pro mapa"
              >
                <Text style={styles.secondaryText}>Continuar explorando</Text>
              </ScaleOnPress>
            </FadeInView>
          </Animated.View>
        </View>
      </View>

      {/* confete por cima de tudo (Canvas sem toque) */}
      <Confetti
        active={confetti}
        count={120}
        origin={{ x: 0.5, y: 0.4 }}
        palette={[colors.secondary, colors.primary, colors.accent, colors.white]}
        onDone={onConfettiDone}
      />
    </View>
  );
}

function Avatar({ uri, ring, label }: { uri: string | null; ring: string; label: string }) {
  return uri ? (
    <Image source={{ uri }} style={[styles.avatar, { borderColor: ring }]} accessibilityLabel={label} accessible />
  ) : (
    <View style={[styles.avatar, styles.avatarPlaceholder, { borderColor: ring }]} accessibilityLabel={label} accessible>
      <Ionicons name="person" size={36} color={colors.gray[400]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.black },
  veil: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(10,10,26,0.5)' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  cardWrap: { width: '100%', maxWidth: 420 },
  card: {
    width: '100%',
    backgroundColor: CARD_BG,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: 'rgba(250,250,250,0.1)',
    padding: spacing.xl,
    alignItems: 'center',
    backfaceVisibility: 'hidden',
  },
  cardBack: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.secondary,
    borderColor: 'rgba(250,250,250,0.25)',
    justifyContent: 'center',
  },
  title: { ...typography.h1, color: colors.primary, textAlign: 'center' },
  names: { ...typography.bodyLarge, color: colors.gray[300], marginTop: spacing.xs, textAlign: 'center' },
  nameHighlight: { fontFamily: typography.h4.fontFamily, color: colors.white },
  avatars: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xl,
    marginBottom: spacing.xl,
    gap: spacing.md,
  },
  heartSlot: { alignItems: 'center', justifyContent: 'center' },
  heart: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: { width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2, borderWidth: 3, backgroundColor: colors.gray[800] },
  avatarPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  contextBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(255,20,147,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,20,147,0.35)',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    width: '100%',
  },
  contextText: { ...typography.body, color: colors.white, flex: 1 },
  actions: { width: '100%', marginTop: spacing.xl, gap: spacing.sm },
  stretch: { alignSelf: 'stretch' },
  primary: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  primaryText: { ...typography.label, color: colors.black, fontSize: 16 },
  secondary: { height: 48, alignItems: 'center', justifyContent: 'center', width: '100%' },
  secondaryText: { ...typography.label, color: colors.gray[300] },
});
