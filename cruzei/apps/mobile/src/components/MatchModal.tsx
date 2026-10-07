import React, { useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo, Modal, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';

import type { AvatarConfig, ProximityBand } from '@cruzei/shared-types';
import { useAuthStore } from '../stores/auth';
import { useMatchCelebrationStore } from '../stores/matchCelebration';
import { resolveAvatar } from '../avatar';
import { colors, radius, spacing, spring, typography } from '@cruzei/ui-mobile';
import { openChat } from '../navigation/openChat';
import { BlobBackground, Confetti, FadeInView, Glow, Pulse, ScaleOnPress, SlideInView } from './animated';
import { SignatureAvatar } from './avatar/SignatureAvatar';
import { PronounTag } from './avatar/stage';
import { matchDistanceText } from './map/proximityText';
import { BRAND } from '../brand';

/** curtida mútua (os dois se curtiram): a celebração e o atalho pro chat */
export interface MatchInfo {
  /** id da pessoa (abre o chat e é a seed do avatar quando ela ainda não personalizou) */
  userId: string;
  name: string;
  /** foto principal (legado — o card agora mostra avatares) */
  photo: string | null;
  context?: string | null;
  /** conversa do par, se já existe (a curtida mútua a promoveu pra principal); sem ela o chat abre em rascunho */
  conversationId?: string | null;
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

// Timeline de quem RECEBE o match (curtiu primeiro e soube depois): os dois avatares vêm de longe e se encontram no
// meio; no encontro, onda de choque, coração, háptico e confete saindo do ponto de encontro.
const TR = {
  flip: 120,
  title: 560,
  names: 700,
  approach: 380,
  meet: 900,
  context: 1080,
  buttons: 1220,
} as const;
/** de quanto longe cada avatar vem (px) */
const APPROACH = 104;

/** depois da entrada (botões + este tempo), o fundo, os halos e os pulsos param: celebração parada não gasta quadro */
const SETTLE_AFTER_MS = 3000;

/** palco do avatar dentro do anel (122 de altura → boneco com ~105; a aura transborda um pouco o anel, de propósito) */
const AVATAR = 122;
const RING = 124;
const CARD_BG = '#12122A';

export interface MatchModalProps {
  match: MatchInfo | null;
  onClose: () => void;
  /** "🗺️ Ver no mapa" — só aparece quando a tela dona sabe centralizar a pessoa no mapa */
  onViewOnMap?: (info: MatchInfo) => void;
  /**
   * 'sent' (padrão): quem completou o match, na hora da curtida. 'received': quem curtiu primeiro e ficou sabendo
   * depois (socket, push ou pendente) — avatares se encontrando, "curtiu você de volta" (MatchCelebrationHost).
   */
  variant?: 'sent' | 'received';
}

/**
 * "METCH! 🔥" — tela de celebração premium: confete, card com flip 3D, coração pulsando
 * com glow magenta, os dois avatares com anel neon e o contexto de ONDE vocês se cruzaram.
 * API pública: <MatchModal match={info | null} onClose={...} onViewOnMap={...} variant="sent|received" />
 */
export function MatchModal({ match, onClose, onViewOnMap, variant = 'sent' }: MatchModalProps) {
  const me = useAuthStore((s) => s.user);
  // modal de quem curtiu aberto: a comemoração recebida espera a vez (nunca dois Modals empilhados)
  const holdKey = match && variant === 'sent' ? match.userId : null;
  useEffect(() => {
    if (!holdKey) return;
    return useMatchCelebrationStore.getState().holdLocal();
  }, [holdKey]);

  if (!match) return null;
  const myAvatar = resolveAvatar(me?.avatar, me?.id ?? 'me', me?.gender);
  const theirAvatar = resolveAvatar(match.avatar, match.userId);

  // pelo Main (raiz): funciona tanto do mapa (aba) quanto do cartão (pilha raiz); sem conversa ainda, abre em rascunho
  const onOpenChat = () => {
    onClose();
    openChat({ id: match.userId, name: match.name, avatar: match.avatar ?? null }, match.conversationId);
  };

  const viewOnMap = onViewOnMap
    ? () => {
        onClose();
        onViewOnMap(match);
      }
    : undefined;

  return (
    <Modal visible transparent statusBarTranslucent navigationBarTranslucent animationType="fade" onRequestClose={onClose}>
      {/* key = pessoa → cada match novo remonta a celebração e roda todas as entradas do zero */}
      <Celebration
        key={`${variant}:${match.userId}`}
        match={match}
        myAvatar={myAvatar}
        theirAvatar={theirAvatar}
        onClose={onClose}
        onOpenChat={onOpenChat}
        onViewOnMap={viewOnMap}
        received={variant === 'received'}
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
  received,
}: {
  match: MatchInfo;
  myAvatar: AvatarConfig;
  theirAvatar: AvatarConfig;
  onClose: () => void;
  onOpenChat: () => void;
  onViewOnMap?: () => void;
  received: boolean;
}) {
  const reduceMotion = useReducedMotion();
  // recebido: o confete espera o encontro dos avatares
  const [confetti, setConfetti] = useState(!reduceMotion && !received);
  const t = received ? TR : T;
  // a festa assenta: fundo vivo, halos e pulsos param (sem movimento reduzido já nascem parados)
  const [settled, setSettled] = useState(reduceMotion);
  useEffect(() => {
    if (settled) return;
    const id = setTimeout(() => setSettled(true), t.buttons + SETTLE_AFTER_MS);
    return () => clearTimeout(id);
  }, [settled, t]);
  const live = !settled && !reduceMotion;

  // flip 3D do card: 180° (de costas) → 0° com spring
  const rotate = useSharedValue(reduceMotion ? 0 : 180);
  // bounce do título "É um match!"
  const titlePop = useSharedValue(reduceMotion ? 1 : 0);

  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(
      received ? `${match.name} curtiu você de volta. Deu match!` : `Deu match com ${match.name}`,
    );
    // quem recebe sente o háptico no encontro dos avatares (sem movimento: na hora)
    const meetDelay = received && !reduceMotion ? TR.meet : 0;
    const buzz = setTimeout(() => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      if (received && !reduceMotion) setConfetti(true);
    }, meetDelay);

    if (!reduceMotion) {
      rotate.value = withDelay(t.flip, withSpring(0, { damping: 15, stiffness: 95, mass: 1 }));
      titlePop.value = withDelay(t.title, withSpring(1, spring.bouncy));
    }
    return () => {
      clearTimeout(buzz);
      cancelAnimation(rotate);
      cancelAnimation(titlePop);
    };
  }, [match.name, reduceMotion, received, rotate, t, titlePop]);

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
  // quem recebe fica sabendo depois (pode ser horas): nada de "estiveram perto hoje"
  const contextText = match.context ?? (received ? 'Vocês se curtiram' : 'Vocês estiveram perto hoje.');
  // faixa 'boost' (até 5 km) tem frase própria: "em destaque na região um do outro" não existe
  const distanceText = matchDistanceText(match.band);
  // avatares: de longe até o meio no recebido; sem movimento, parados no lugar
  const avatarDistance = reduceMotion ? 0 : received ? APPROACH : 48;
  const avatarDelay = received ? TR.approach : T.avatars;
  const heartDelay = received ? TR.meet : T.heart;

  return (
    <View style={styles.root} accessibilityViewIsModal>
      {/* fundo vivo magenta/lima + véu escuro pra dar contraste ao card */}
      <BlobBackground palette={[colors.secondary, colors.primary, colors.secondary]} intensity={0.85} speed={1.6} paused={!live} />
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
            <FadeInView delay={t.names} fromY={8}>
              {received ? (
                <Text style={styles.names}>
                  <Text style={styles.nameHighlight}>{match.name}</Text> curtiu você de volta!
                </Text>
              ) : (
                <Text style={styles.names}>
                  Você e <Text style={styles.nameHighlight}>{match.name}</Text> demonstraram interesse.
                </Text>
              )}
              {distanceText ? <Text style={styles.distance}>{distanceText}</Text> : null}
            </FadeInView>

            <View style={styles.avatars}>
              <SlideInView from="left" distance={avatarDistance} delay={avatarDelay} springPreset="bouncy">
                <Glow color={colors.primary} spread={14} intensity={0.85} cycleMs={1800} animated={live}>
                  <AvatarRing config={myAvatar} ring={colors.primary} label="Seu avatar" playAt={avatarDelay + 650} />
                </Glow>
              </SlideInView>

              <View style={styles.heartSlot}>
                {/* recebido: a onda do encontro (anel que abre e some) atrás do coração */}
                {received && !reduceMotion ? (
                  <>
                    <ShockRing delay={TR.meet} color={colors.secondary} />
                    <ShockRing delay={TR.meet + 140} color={colors.primary} />
                  </>
                ) : null}
                <FadeInView delay={heartDelay} fromScale={received ? 0.1 : 0.3} durationMs={260}>
                  <Glow color={colors.secondary} spread={20} intensity={1} cycleMs={1200} animated={live}>
                    <Pulse maxScale={1.14} cycleMs={1000} active={live}>
                      <View style={styles.heart} accessible={false}>
                        <Ionicons name="heart" size={30} color={colors.white} />
                      </View>
                    </Pulse>
                  </Glow>
                </FadeInView>
              </View>

              <SlideInView from="right" distance={avatarDistance} delay={avatarDelay} springPreset="bouncy">
                <Glow color={colors.secondary} spread={14} intensity={0.85} cycleMs={1800} animated={live}>
                  {/* recebido: o anel da pessoa pulsa (foi ela que fechou o match) */}
                  <Pulse maxScale={1.05} cycleMs={1400} active={received && live}>
                    <AvatarRing config={theirAvatar} ring={colors.secondary} label={`Avatar de ${match.name}`} playAt={avatarDelay + 800} />
                  </Pulse>
                </Glow>
              </SlideInView>
            </View>

            <SlideInView from="up" distance={reduceMotion ? 0 : 20} delay={t.context} style={styles.contextBox}>
              <Ionicons name={received ? 'heart' : 'location'} size={16} color={colors.secondary} />
              <Text style={styles.contextText}>
                {contextText} 💚{received ? ' Manda um oi antes que esfrie.' : ''}
              </Text>
            </SlideInView>

            <FadeInView delay={t.buttons} fromY={16} style={styles.actions}>
              <Glow color={colors.primary} spread={14} intensity={0.6} shape="pill" cycleMs={2000} animated={live} style={styles.stretch}>
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

      {/* confete por cima de tudo (Canvas sem toque); no recebido, sai do ponto de encontro dos avatares */}
      <Confetti
        active={confetti}
        count={received ? 140 : 120}
        origin={received ? { x: 0.5, y: 0.46 } : { x: 0.5, y: 0.4 }}
        palette={[colors.secondary, colors.primary, colors.accent, colors.white]}
        onDone={onConfettiDone}
      />
    </View>
  );
}

/** onda do encontro: anel que abre do centro e some (UI thread; um shared value só) */
function ShockRing({ delay, color }: { delay: number; color: string }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withDelay(delay, withTiming(1, { duration: 720, easing: Easing.out(Easing.cubic) }));
    return () => cancelAnimation(p);
  }, [delay, p]);
  const style = useAnimatedStyle(() => ({
    opacity: p.value === 0 ? 0 : 0.9 * (1 - p.value),
    transform: [{ scale: 0.5 + p.value * 2.6 }],
  }));
  return <Animated.View pointerEvents="none" style={[styles.shock, { borderColor: color }, style]} />;
}

/**
 * avatar de corpo inteiro dentro de um anel neon (lima = você, magenta = a pessoa): vivo, toca a animação assinatura
 * quando os dois já chegaram (`playAt` ms; nunca com movimento reduzido) e a cada toque; pronomes numa plaquinha no pé
 */
function AvatarRing({ config, ring, label, playAt }: { config: AvatarConfig; ring: string; label: string; playAt: number }) {
  return (
    <View style={[styles.avatarRing, { borderColor: ring }]}>
      <SignatureAvatar config={config} size={AVATAR} groundShadow autoplay autoplayDelay={playAt} showBackdrop={false} showPronouns={false} label={label} />
      {config.pronouns && config.pronouns !== 'none' ? (
        <View style={styles.pronouns} pointerEvents="none">
          <PronounTag pronouns={config.pronouns} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.black },
  veil: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(10,10,26,0.5)' },
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
    ...StyleSheet.absoluteFill,
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
  shock: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 3,
  },
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
  pronouns: { position: 'absolute', bottom: -12, left: -8, right: -8, alignItems: 'center' },
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
