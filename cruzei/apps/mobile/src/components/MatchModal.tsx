import React, { useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo, Modal, StyleSheet, Text, View } from 'react-native';
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

import type { AvatarConfig, ProximityBand } from '@cruzei/shared-types';
import { proximityBandLabel } from '@cruzei/shared-utils';
import { useAuthStore } from '../stores/auth';
import { resolveAvatar } from '../avatar';
import { colors, radius, spacing, spring, typography } from '@cruzei/ui-mobile';
import type { MainTabParamList } from '../navigation/MainTabs';
import { BlobBackground, Confetti, FadeInView, Glow, Pulse, ScaleOnPress, SlideInView } from './animated';
import { CruzeiAvatar } from './avatar/CruzeiAvatar';
import { BRAND } from '../brand';

export interface MatchInfo {
  matchId: string;
  name: string;
  /** foto principal (legado — o card agora mostra avatares) */
  photo: string | null;
  context?: string | null;
  /** id da pessoa: seed do avatar quando ela ainda não personalizou (cai no matchId se faltar) */
  userId?: string;
  avatar?: AvatarConfig | null;
  /** faixa de proximidade no momento do match (nunca metros) */
  band?: ProximityBand | null;
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

const AVATAR = 110;
const RING = 124;
const CARD_BG = '#12122A';

export interface MatchModalProps {
  match: MatchInfo | null;
  onClose: () => void;
  /** "🗺️ Ver no mapa" — só aparece quando a tela dona sabe centralizar a pessoa no mapa */
  onViewOnMap?: (info: MatchInfo) => void;
}

/**
 * "METCH! 🔥" — tela de celebração premium: confete, card com flip 3D, coração pulsando
 * com glow magenta, os dois avatares com anel neon e o contexto de ONDE vocês se cruzaram.
 * API pública: <MatchModal match={info | null} onClose={...} onViewOnMap={...} />
 */
export function MatchModal({ match, onClose, onViewOnMap }: MatchModalProps) {
  const nav = useNavigation<NavigationProp<MainTabParamList>>();
  const me = useAuthStore((s) => s.user);

  if (!match) return null;
  const myAvatar = resolveAvatar(me?.avatar, me?.id ?? 'me', me?.gender);
  const theirAvatar = resolveAvatar(match.avatar, match.userId ?? match.matchId);

  const openChat = () => {
    onClose();
    // initial:false → MatchesList fica embaixo na pilha e o chat ganha botão de voltar
    nav.navigate('Matches', { screen: 'Chat', initial: false, params: { matchId: match.matchId, name: match.name } } as never);
  };

  const viewOnMap = onViewOnMap
    ? () => {
        onClose();
        onViewOnMap(match);
      }
    : undefined;

  return (
    <Modal visible transparent statusBarTranslucent animationType="fade" onRequestClose={onClose}>
      {/* key = matchId → cada match novo remonta a celebração e roda todas as entradas do zero */}
      <Celebration
        key={match.matchId}
        match={match}
        myAvatar={myAvatar}
        theirAvatar={theirAvatar}
        onClose={onClose}
        onOpenChat={openChat}
        onViewOnMap={viewOnMap}
      />
    </Modal>
  );
}

function Celebration({
  match,
  myAvatar,
  theirAvatar,
  onClose,
  onOpenChat,
  onViewOnMap,
}: {
  match: MatchInfo;
  myAvatar: AvatarConfig;
  theirAvatar: AvatarConfig;
  onClose: () => void;
  onOpenChat: () => void;
  onViewOnMap?: () => void;
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
  const distanceText = match.band ? `Vocês estão ${proximityBandLabel(match.band)} um do outro.` : null;

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
              {BRAND.matchShout} 🔥
            </Animated.Text>
            <FadeInView delay={T.names} fromY={8}>
              <Text style={styles.names}>
                Você e <Text style={styles.nameHighlight}>{match.name}</Text> demonstraram interesse.
              </Text>
              {distanceText ? <Text style={styles.distance}>{distanceText}</Text> : null}
            </FadeInView>

            <View style={styles.avatars}>
              <SlideInView from="left" distance={48} delay={T.avatars} springPreset="bouncy">
                <Glow color={colors.primary} spread={14} intensity={0.85} cycleMs={1800}>
                  <AvatarRing config={myAvatar} ring={colors.primary} label="Seu avatar" />
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
                  <AvatarRing config={theirAvatar} ring={colors.secondary} label={`Avatar de ${match.name}`} />
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
                  accessibilityLabel={`Conversar com ${match.name}`}
                >
                  <Text style={styles.primaryText}>💬 Conversar</Text>
                </ScaleOnPress>
              </Glow>
              {onViewOnMap ? (
                <ScaleOnPress
                  onPress={onViewOnMap}
                  pressedScale={0.97}
                  style={styles.secondary}
                  accessibilityRole="button"
                  accessibilityLabel={`Ver ${match.name} no mapa`}
                >
                  <Text style={styles.secondaryText}>🗺️ Ver no mapa</Text>
                </ScaleOnPress>
              ) : null}
              <ScaleOnPress
                onPress={onClose}
                pressedScale={0.97}
                haptic={false}
                style={styles.ghost}
                accessibilityRole="button"
                accessibilityLabel="Fechar"
                accessibilityHint="Fecha a celebração"
              >
                <Text style={styles.ghostText}>Fechar</Text>
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

/** avatar de corpo inteiro dentro de um anel neon (lima = você, magenta = a pessoa) */
function AvatarRing({ config, ring, label }: { config: AvatarConfig; ring: string; label: string }) {
  return (
    <View style={[styles.avatarRing, { borderColor: ring }]} accessibilityLabel={label} accessible>
      <CruzeiAvatar config={config} mode="full" size={AVATAR} groundShadow accessibilityLabel={label} />
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
  title: { ...typography.h1, color: colors.primary, textAlign: 'center', letterSpacing: 1 },
  names: { ...typography.bodyLarge, color: colors.gray[300], marginTop: spacing.xs, textAlign: 'center' },
  nameHighlight: { fontFamily: typography.h4.fontFamily, color: colors.white },
  distance: { ...typography.bodySmall, color: colors.secondary, marginTop: spacing.xs, textAlign: 'center' },
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
  avatarRing: {
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    borderWidth: 3,
    backgroundColor: 'rgba(250,250,250,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  secondary: {
    height: 50,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: 'rgba(250,250,250,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  secondaryText: { ...typography.label, color: colors.white, fontSize: 15 },
  ghost: { height: 44, alignItems: 'center', justifyContent: 'center', width: '100%' },
  ghostText: { ...typography.label, color: colors.gray[400] },
});
