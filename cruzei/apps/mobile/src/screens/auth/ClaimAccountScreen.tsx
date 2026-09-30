import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import type { PhoneReleaseReason } from '@cruzei/shared-types';

import { colors, duration, fontFamily, radius, spacing, spring, typography } from '@cruzei/ui-mobile';
import { maskPhoneBR } from '@cruzei/shared-utils';
import { BlobBackground, FadeInView, Glow, ScaleOnPress } from '../../components/animated';
import { useAuthStore } from '../../stores/auth';
import { toApiError } from '../../services/api';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { formatDate, parseDate, toIsoDate } from './birthDate';

type Nav = NativeStackNavigationProp<RootStackParamList, 'ClaimAccount'>;
type Route = RouteProp<RootStackParamList, 'ClaimAccount'>;

type Step = 'ask' | 'birth' | 'released';

const VERIFIED_HOLD_MS = 650;

function attemptsText(n: number): string {
  if (n <= 0) return 'Sem tentativas';
  return n === 1 ? 'Última tentativa' : `${n} tentativas`;
}

const RELEASED_COPY: Record<PhoneReleaseReason, string> = {
  not_mine: 'Pronto: a conta antiga perdeu o vínculo com esse número. Agora é criar a sua do zero.',
  birthdate_mismatch:
    'A data não bateu nas tentativas, então a conta antiga perdeu o vínculo com esse número. Se ela era sua, fala com o suporte depois de entrar.',
  account_deleted: 'A conta antiga desse número tinha sido excluída. Agora é criar a sua do zero.',
  admin: 'A conta antiga perdeu o vínculo com esse número. Agora é criar a sua do zero.',
};

/**
 * ClaimAccountScreen (rota "ClaimAccount"): número reciclado. A conta desse número está parada há 90+ dias, então o SMS
 * sozinho não entra: "Essa conta é sua?" (só a inicial de cada nome; nada de data nem tamanho do nome).
 * - Sim → data de nascimento (DD/MM/AAAA). Acertou: check e entra. Errou: shake + tentativas restantes (por conta, os
 *   erros somam sem prazo).
 * - Não é minha (com confirmação) ou tentativas esgotadas → aviso "número liberado" → cadastro (Register).
 * - Desafio vencido (10 min) → volta pro Login.
 */
export function ClaimAccountScreen() {
  const nav = useNavigation<Nav>();
  const { params } = useRoute<Route>();
  const focused = useIsFocused();
  const { confirmClaim, releaseClaim, commitAuth } = useAuthStore();
  const { phone, claim } = params;

  const [step, setStep] = useState<Step>('ask');
  const [birth, setBirth] = useState('');
  const [attemptsLeft, setAttemptsLeft] = useState(claim.attemptsLeft);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<'confirm' | 'release' | null>(null);
  const [verified, setVerified] = useState(false);
  const [released, setReleased] = useState<PhoneReleaseReason | null>(null);

  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCommit = useRef(false);
  const inputRef = useRef<TextInput>(null);

  const shake = useSharedValue(0);
  const badge = useSharedValue(0);

  useEffect(
    () => () => {
      if (holdRef.current) clearTimeout(holdRef.current);
      // saiu da tela antes do hold acabar: não deixa a sessão pendurada
      if (pendingCommit.current) useAuthStore.getState().commitAuth();
      cancelAnimation(shake);
      cancelAnimation(badge);
    },
    [shake, badge],
  );

  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));
  const badgeStyle = useAnimatedStyle(() => ({
    opacity: badge.value,
    transform: [{ scale: 0.6 + 0.4 * badge.value }],
  }));

  const parsed = parseDate(birth);
  const initial = Array.from(claim.maskedName)[0] ?? '?';
  const noAttempts = attemptsLeft <= 0;

  /** desafio vencido (10 min) ou já usado: volta pro Login pra pedir outro código */
  const backToLogin = useCallback(() => {
    Alert.alert('Essa confirmação venceu', 'Pede outro código pra entrar de novo.', [
      { text: 'Ok', onPress: () => nav.replace('Login') },
    ]);
  }, [nav]);

  const goReleased = useCallback((reason: PhoneReleaseReason) => {
    setReleased(reason);
    setMessage(null);
    setStep('released');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  }, []);

  const failWith = useCallback(
    (msg: string) => {
      setMessage(msg);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      shake.value = withSequence(
        withTiming(-10, { duration: 50 }),
        withTiming(10, { duration: 60 }),
        withTiming(-6, { duration: 50 }),
        withTiming(6, { duration: 50 }),
        withTiming(0, { duration: 50 }),
      );
    },
    [shake],
  );

  const onConfirm = useCallback(async () => {
    if (!parsed || busy || verified || noAttempts) return;
    setBusy('confirm');
    setMessage(null);
    try {
      const r = await confirmClaim(claim.challengeId, toIsoDate(parsed), { deferAuth: true });
      if (r.isNew) {
        // esgotou as tentativas: o número saiu da conta antiga
        setAttemptsLeft(0);
        goReleased(r.released ?? 'birthdate_mismatch');
        return;
      }
      pendingCommit.current = true;
      setVerified(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      badge.value = withSpring(1, spring.bouncy);
      holdRef.current = setTimeout(() => {
        pendingCommit.current = false;
        commitAuth();
      }, VERIFIED_HOLD_MS);
    } catch (e) {
      const err = toApiError(e);
      const data = (e as { response?: { data?: { attemptsLeft?: unknown } } })?.response?.data;
      if (err.error === 'claim_mismatch') {
        const left = typeof data?.attemptsLeft === 'number' ? data.attemptsLeft : Math.max(0, attemptsLeft - 1);
        setAttemptsLeft(left);
        setBirth('');
        failWith(left === 1 ? 'Não bateu. Última tentativa: se errar, o número sai da conta antiga.' : `Não bateu. Restam ${left} tentativas.`);
        setTimeout(() => inputRef.current?.focus(), 350);
      } else if (err.error === 'claim_expired') backToLogin();
      else if (err.status === 429) failWith(err.message);
      else if (err.status === 403) failWith('Essa conta não pode entrar agora.');
      else if (!err.status) failWith('Sem sinal com a gente agora. Confere sua internet e tenta de novo?');
      else failWith('Não deu pra confirmar agora. Tenta de novo em instantes?');
    } finally {
      setBusy(null);
    }
  }, [parsed, busy, verified, noAttempts, confirmClaim, claim.challengeId, goReleased, badge, commitAuth, attemptsLeft, failWith, backToLogin]);

  const doRelease = useCallback(async () => {
    if (busy) return;
    setBusy('release');
    setMessage(null);
    try {
      const r = await releaseClaim(claim.challengeId);
      goReleased(r.released ?? 'not_mine');
    } catch (e) {
      const err = toApiError(e);
      if (err.error === 'claim_expired') backToLogin();
      else if (err.status === 429) failWith(err.message);
      else if (!err.status) failWith('Sem sinal com a gente agora. Confere sua internet e tenta de novo?');
      else failWith('Não deu agora. Tenta de novo em instantes?');
    } finally {
      setBusy(null);
    }
  }, [busy, releaseClaim, claim.challengeId, goReleased, backToLogin, failWith]);

  // irreversível pra conta antiga: sempre pergunta antes
  const onNotMine = useCallback(() => {
    if (busy || verified) return;
    Alert.alert(
      'A conta não é sua?',
      'A conta antiga perde o vínculo com esse número e você cria uma conta nova. Se ela for sua, isso não dá pra desfazer por aqui.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Não é minha', style: 'destructive', onPress: () => void doRelease() },
      ],
    );
  }, [busy, verified, doRelease]);

  const onYes = useCallback(() => {
    if (noAttempts) return;
    setMessage(null);
    setStep('birth');
  }, [noAttempts]);

  const toRegister = useCallback(() => {
    nav.replace('Register', { phone, released: released ?? undefined });
  }, [nav, phone, released]);

  const canGoBack = step !== 'released' && !verified && !busy;

  return (
    <View style={styles.root}>
      <BlobBackground intensity={0.22} paused={!focused} />

      <SafeAreaView style={styles.safe}>
        <KeyboardAvoidingView behavior="padding" style={styles.flex}>
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <View style={styles.topBar}>
              {canGoBack ? (
                <Pressable
                  onPress={() => (step === 'birth' ? setStep('ask') : nav.goBack())}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel={step === 'birth' ? 'Voltar' : 'Voltar e trocar número'}
                  style={styles.back}
                >
                  <Ionicons name="chevron-back" size={26} color={colors.white} />
                </Pressable>
              ) : (
                <View style={styles.back} />
              )}
            </View>

            {step === 'ask' ? (
              <View key="ask" style={styles.content}>
                <FadeInView delay={60} fromY={12}>
                  <Text style={styles.eyebrow}>{maskPhoneBR(phone)}</Text>
                  <Text style={styles.title}>Esse número já tem uma conta no Metch</Text>
                  <Text style={styles.subtitle}>
                    Ela tá parada faz um tempo. Antes de entrar, confirma pra gente: essa conta é sua?
                  </Text>
                </FadeInView>

                <FadeInView delay={180} fromY={14} fromScale={0.97}>
                  <View style={styles.card} accessible accessibilityLabel={`Conta ${claim.maskedName}`}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{initial}</Text>
                    </View>
                    <View style={styles.flex}>
                      <Text style={styles.cardName} numberOfLines={1}>
                        {claim.maskedName}
                      </Text>
                      <Text style={styles.cardMeta}>conta do Metch</Text>
                    </View>
                    <Ionicons name="lock-closed" size={18} color="rgba(250,250,250,0.45)" />
                  </View>
                </FadeInView>

                {noAttempts ? (
                  <FadeInView delay={240} fromY={8}>
                    <View style={styles.note}>
                      <Ionicons name="time-outline" size={16} color={colors.accent} />
                      <Text style={styles.noteText}>
                        As tentativas acabaram. Se a conta é sua, fala com o suporte.
                      </Text>
                    </View>
                  </FadeInView>
                ) : null}

                <View style={styles.spacer} />

                <FadeInView delay={300} fromY={16} style={styles.actions}>
                  <Glow color={colors.primary} spread={12} intensity={0.4} shape="pill" style={styles.stretch}>
                    <ScaleOnPress
                      onPress={onYes}
                      disabled={noAttempts || !!busy}
                      glowColor={colors.primary}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: noAttempts || !!busy }}
                      accessibilityLabel="Sim, a conta é minha"
                      style={noAttempts ? [styles.cta, styles.ctaDisabled] : styles.cta}
                    >
                      <Text style={styles.ctaText}>Sim, é minha</Text>
                      <Ionicons name="arrow-forward" size={20} color={colors.black} />
                    </ScaleOnPress>
                  </Glow>
                  <ScaleOnPress
                    onPress={onNotMine}
                    disabled={!!busy}
                    haptic={false}
                    accessibilityRole="button"
                    accessibilityLabel="Não, a conta não é minha"
                    style={styles.outline}
                  >
                    {busy === 'release' ? (
                      <ActivityIndicator color={colors.white} />
                    ) : (
                      <Text style={styles.outlineText}>Não é minha</Text>
                    )}
                  </ScaleOnPress>
                  <Text style={styles.footnote}>
                    Se não for sua, a conta antiga perde o vínculo com esse número e você cria a sua.
                  </Text>
                </FadeInView>
              </View>
            ) : null}

            {step === 'birth' ? (
              <View key="birth" style={styles.content}>
                <FadeInView delay={40} fromY={12}>
                  <Text style={styles.title}>Qual sua data de nascimento?</Text>
                  <Text style={styles.subtitle}>A mesma que tá na conta. É só pra ter certeza que é você mesmo.</Text>
                </FadeInView>

                <FadeInView delay={140} fromY={10}>
                  <Animated.View style={[styles.inputBox, message ? styles.inputBoxError : null, shakeStyle]}>
                    <TextInput
                      ref={inputRef}
                      value={birth}
                      onChangeText={(t) => {
                        if (message) setMessage(null);
                        setBirth(formatDate(t));
                      }}
                      onSubmitEditing={() => void onConfirm()}
                      placeholder="DD/MM/AAAA"
                      placeholderTextColor="rgba(250,250,250,0.35)"
                      keyboardType="number-pad"
                      maxLength={10}
                      autoFocus
                      editable={!verified && !busy}
                      selectionColor={colors.primary}
                      cursorColor={colors.primary}
                      keyboardAppearance="dark"
                      accessibilityLabel="Data de nascimento, dia, mês e ano"
                      style={styles.input}
                    />
                    {verified ? (
                      <Animated.View style={badgeStyle} accessibilityLabel="Confirmado">
                        <Ionicons name="checkmark-circle" size={30} color={colors.success} />
                      </Animated.View>
                    ) : null}
                  </Animated.View>
                </FadeInView>

                <View style={styles.feedback}>
                  {message ? (
                    <FadeInView key={message} fromY={-4} durationMs={duration.fast} style={styles.messageRow}>
                      <Ionicons name="alert-circle" size={16} color={colors.danger} />
                      <Text style={styles.messageText} accessibilityLiveRegion="polite">
                        {message}
                      </Text>
                    </FadeInView>
                  ) : verified ? (
                    <Text style={styles.okText}>É você mesmo. Bora 💚</Text>
                  ) : (
                    <View style={styles.attempts}>
                      <Ionicons name="shield-checkmark-outline" size={14} color="rgba(250,250,250,0.55)" />
                      <Text style={styles.attemptsText}>{attemptsText(attemptsLeft)}</Text>
                    </View>
                  )}
                </View>

                <View style={styles.spacer} />

                <View style={styles.actions}>
                  <Glow color={colors.primary} spread={12} intensity={0.4} shape="pill" style={styles.stretch}>
                    <ScaleOnPress
                      onPress={() => void onConfirm()}
                      disabled={!parsed || !!busy || verified}
                      glowColor={colors.primary}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: !parsed || !!busy || verified, busy: busy === 'confirm' }}
                      accessibilityLabel="Confirmar data de nascimento"
                      style={parsed ? styles.cta : [styles.cta, styles.ctaDisabled]}
                    >
                      {busy === 'confirm' ? (
                        <ActivityIndicator color={colors.black} />
                      ) : (
                        <Text style={styles.ctaText}>Confirmar</Text>
                      )}
                    </ScaleOnPress>
                  </Glow>
                  <Pressable
                    onPress={onNotMine}
                    disabled={!!busy || verified}
                    accessibilityRole="button"
                    accessibilityLabel="A conta não é minha"
                    style={styles.link}
                  >
                    <Text style={[styles.linkText, busy || verified ? styles.linkDisabled : null]}>
                      Não é minha
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            {step === 'released' && released ? (
              <View key="released" style={styles.content}>
                <FadeInView delay={40} fromScale={0.9}>
                  <View style={styles.releasedIcon}>
                    <Ionicons name="sparkles" size={34} color={colors.primary} />
                  </View>
                </FadeInView>
                <FadeInView delay={140} fromY={12}>
                  <Text style={styles.title}>Número liberado pra você</Text>
                  <Text style={styles.subtitle}>{RELEASED_COPY[released]}</Text>
                </FadeInView>

                <View style={styles.spacer} />

                <FadeInView delay={260} fromY={16} style={styles.actions}>
                  <Glow color={colors.primary} spread={12} intensity={0.45} shape="pill" animated style={styles.stretch}>
                    <ScaleOnPress
                      onPress={toRegister}
                      glowColor={colors.primary}
                      accessibilityRole="button"
                      accessibilityLabel="Criar minha conta"
                      style={styles.cta}
                    >
                      <Text style={styles.ctaText}>Criar minha conta</Text>
                      <Ionicons name="arrow-forward" size={20} color={colors.black} />
                    </ScaleOnPress>
                  </Glow>
                </FadeInView>
              </View>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.black },
  safe: { flex: 1 },
  flex: { flex: 1 },
  scroll: { flexGrow: 1 },
  topBar: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  back: { width: 44, height: 44, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1, paddingHorizontal: spacing.xl, paddingTop: spacing.lg, paddingBottom: spacing.lg },
  eyebrow: { fontFamily: fontFamily.mono, fontSize: 14, color: colors.primary, marginBottom: spacing.sm, letterSpacing: 0.5 },
  title: { ...typography.h1, color: colors.white },
  subtitle: { ...typography.bodyLarge, color: colors.white, opacity: 0.72, marginTop: spacing.sm },
  card: {
    marginTop: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(250,250,250,0.14)',
    backgroundColor: 'rgba(250,250,250,0.06)',
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: radius.full,
    backgroundColor: 'rgba(127,255,0,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(127,255,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { ...typography.h3, color: colors.primary },
  cardName: { fontFamily: fontFamily.mono, fontSize: 20, color: colors.white, letterSpacing: 1 },
  cardMeta: { ...typography.bodySmall, color: 'rgba(250,250,250,0.6)', marginTop: 2 },
  note: {
    marginTop: spacing.lg,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,215,0,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.35)',
  },
  noteText: { ...typography.bodySmall, color: colors.white, flex: 1 },
  spacer: { flex: 1, minHeight: spacing.xl },
  actions: { gap: spacing.md },
  stretch: { alignSelf: 'stretch' },
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
  ctaDisabled: { opacity: 0.45 },
  ctaText: { ...typography.h3, color: colors.black },
  outline: {
    height: 56,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: 'rgba(250,250,250,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  outlineText: { ...typography.h3, color: colors.white },
  footnote: { ...typography.bodySmall, color: 'rgba(250,250,250,0.5)', textAlign: 'center' },
  inputBox: {
    marginTop: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(250,250,250,0.16)',
    backgroundColor: 'rgba(250,250,250,0.06)',
    paddingRight: spacing.md,
  },
  inputBoxError: { borderColor: colors.danger },
  input: {
    flex: 1,
    fontFamily: fontFamily.mono,
    fontSize: 22,
    letterSpacing: 2,
    color: colors.white,
    padding: spacing.lg,
    minHeight: 60,
  },
  feedback: { minHeight: 44, marginTop: spacing.md },
  messageRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  messageText: { ...typography.body, color: colors.danger, flex: 1 },
  okText: { ...typography.body, color: colors.success },
  attempts: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  attemptsText: { ...typography.bodySmall, color: 'rgba(250,250,250,0.55)' },
  link: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  linkText: { ...typography.label, color: colors.white, opacity: 0.85 },
  linkDisabled: { opacity: 0.3 },
  releasedIcon: {
    width: 72,
    height: 72,
    borderRadius: radius.full,
    backgroundColor: 'rgba(127,255,0,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(127,255,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
});
