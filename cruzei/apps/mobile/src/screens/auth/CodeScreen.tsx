import React, { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Canvas, Circle, Group, Path } from '@shopify/react-native-skia';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';

import { colors, duration, fontFamily, radius, spacing, spring, typography } from '@cruzei/ui-mobile';
import { maskPhoneBR } from '@cruzei/shared-utils';
import { BlobBackground, FadeInView, ScaleOnPress } from '../../components/animated';
import { OtpInput } from '../../components/ui/OtpInput';
import { useAuthStore } from '../../stores/auth';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { clock, readSmsError, secondsLeft } from './smsError';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Code'>;
type Route = RouteProp<RootStackParamList, 'Code'>;

const RESEND_SECONDS = 45;
/** trava padrão se o servidor não disser (5 erros → 15 min) */
const LOCK_FALLBACK_S = 900;
const ALREADY_SENT_TEXT = 'Já mandei um código pra esse número agora há pouco. Usa ele, ou pede outro quando o tempo acabar.';

/** primeira espera: a do 429 sms_cooldown (código anterior ainda vale) ou no mínimo os 45 s de sempre */
function firstWait(p: { resendIn?: number; alreadySent?: boolean }): number {
  if (p.alreadySent) return Math.max(1, Math.ceil(p.resendIn ?? RESEND_SECONDS));
  return Math.max(RESEND_SECONDS, Math.ceil(p.resendIn ?? 0));
}
const VERIFIED_HOLD_MS = 650;
const CHECK_SIZE = 96;
// check desenhado numa caixa 96x96 (dois segmentos: descida curta + subida longa)
const CHECK_PATH = 'M 28 50 L 43 65 L 70 34';

/**
 * CodeScreen (rota "Code"): confirma o SMS de 6 dígitos.
 * - OtpInput com bounce por dígito, shake em erro, verde quando verificado
 * - timer "Reenviar em 45s" em JetBrains Mono com barra que esvazia (UI thread) e pop a cada segundo
 * - erros do servidor: tentativas que restam, trava de 15 min com contagem (OTP bloqueado), tetos de reenvio
 * - dica de dev (devCode) que preenche ao tocar
 * - verificação automática ao completar; sucesso desenha um check em Skia (Path trim) por ~600ms
 */
export function CodeScreen() {
  const nav = useNavigation<Nav>();
  const { params } = useRoute<Route>();
  const focused = useIsFocused();
  const { requestCode, verifyCode, commitAuth } = useAuthStore();

  const phone = params.phone;
  const [devCode, setDevCode] = useState<string | null>(params.devCode ?? null);
  const [code, setCode] = useState('');
  const [error, setError] = useState(false);
  const initialWait = useRef(firstWait(params)).current;
  const [message, setMessage] = useState<string | null>(params.alreadySent ? ALREADY_SENT_TEXT : null);
  const [tone, setTone] = useState<'ok' | 'error'>(params.alreadySent ? 'ok' : 'error');
  const [verified, setVerified] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [seconds, setSeconds] = useState(initialWait);
  // 429 sms_locked: até quando o número fica travado (o servidor apagou o código; depois pede outro)
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const inFlight = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCommit = useRef(false);

  // ── shared values (UI thread) ─────────────────────────────────────────────
  const timerBar = useSharedValue(1); // 1 = cheia, 0 = vazia
  const tick = useSharedValue(0); // pop do número a cada segundo
  const checkProgress = useSharedValue(0); // trim do Path do check (0..1)
  const badge = useSharedValue(0); // escala/opacidade do círculo do check
  const otpFade = useSharedValue(1); // OTP some enquanto o check aparece

  // ── countdown ─────────────────────────────────────────────────────────────
  const startCountdown = useCallback((total: number = RESEND_SECONDS) => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setSeconds(total);
    timerBar.value = 1;
    timerBar.value = withTiming(0, { duration: total * 1000, easing: Easing.linear });
    intervalRef.current = setInterval(() => {
      setSeconds((s) => {
        if (s <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          intervalRef.current = null;
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  }, [timerBar]);

  /** libera o reenvio na hora (código venceu ou a trava acabou) */
  const stopCountdown = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = null;
    cancelAnimation(timerBar);
    timerBar.value = 0;
    setSeconds(0);
  }, [timerBar]);

  const lockFor = useCallback(
    (secs: number) => {
      stopCountdown();
      setNow(Date.now());
      setLockedUntil(Date.now() + secs * 1000);
    },
    [stopCountdown],
  );

  // contagem da trava; no fim libera pedir código novo
  useEffect(() => {
    if (!lockedUntil) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= lockedUntil) {
        setLockedUntil(null);
        setTone('ok');
        setMessage('Pronto, já dá pra pedir um código novo.');
      }
    }, 1000);
    return () => clearInterval(id);
  }, [lockedUntil]);

  useEffect(() => {
    startCountdown(initialWait);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (holdRef.current) clearTimeout(holdRef.current);
      // saiu da tela antes do hold acabar (ex.: voltar): não deixa a sessão pendurada
      if (pendingCommit.current) useAuthStore.getState().commitAuth();
      cancelAnimation(timerBar);
      cancelAnimation(tick);
      cancelAnimation(checkProgress);
      cancelAnimation(badge);
      cancelAnimation(otpFade);
    };
  }, [startCountdown, initialWait, timerBar, tick, checkProgress, badge, otpFade]);

  useEffect(() => {
    if (seconds <= 0) return;
    tick.value = withSequence(withTiming(1, { duration: 70 }), withTiming(0, { duration: 160, easing: Easing.out(Easing.cubic) }));
  }, [seconds, tick]);

  // ── animated styles ───────────────────────────────────────────────────────
  const timerBarStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: timerBar.value }] }));
  const tickStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -3 * tick.value }, { scale: 1 + 0.06 * tick.value }],
  }));
  const badgeStyle = useAnimatedStyle(() => ({
    opacity: badge.value,
    transform: [{ scale: 0.6 + 0.4 * badge.value }],
  }));
  const otpStyle = useAnimatedStyle(() => ({
    opacity: otpFade.value,
    transform: [{ scale: 0.96 + 0.04 * otpFade.value }],
  }));

  // ── verificação ───────────────────────────────────────────────────────────
  const playVerified = useCallback(() => {
    otpFade.value = withTiming(0.35, { duration: duration.base });
    badge.value = withSpring(1, spring.bouncy);
    checkProgress.value = withDelay(120, withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) }));
  }, [otpFade, badge, checkProgress]);

  const failWith = useCallback((msg: string) => {
    setTone('error');
    setMessage(msg);
    setError(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    // dá tempo do shake rodar (~260ms) e limpa pra digitar de novo
    setTimeout(() => {
      setCode('');
      setError(false);
    }, 320);
  }, []);

  const onComplete = useCallback(
    async (value: string) => {
      if (inFlight.current || verified || lockedUntil) return;
      inFlight.current = true;
      setVerifying(true);
      setMessage(null);
      try {
        // deferAuth: o RootNavigator só troca pra Main depois do commitAuth (deixa o check animar)
        const result = await verifyCode(phone, value, { deferAuth: true });
        // sessão aberta só quando não é conta nova nem conta parada ("Essa conta é sua?")
        pendingCommit.current = !result.isNew && !result.claim && !result.deletionPending;
        setVerified(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        playVerified();
        holdRef.current = setTimeout(() => {
          // exclusão pedida no prazo: pergunta se quer cancelar (sem sessão até confirmar)
          if (result.deletionPending) nav.replace('RestoreAccount', { phone, pending: result.deletionPending });
          else if (result.claim) nav.replace('ClaimAccount', { phone, claim: result.claim });
          else if (result.isNew) nav.replace('Register', { phone, released: result.released });
          else {
            pendingCommit.current = false;
            commitAuth();
          }
        }, VERIFIED_HOLD_MS);
      } catch (e) {
        // texto do servidor: code_invalid já diz quantas tentativas restam, sms_locked quanto esperar
        const err = readSmsError(e, 'verify');
        failWith(err.message);
        if (err.code === 'sms_locked') lockFor(err.retryAfter ?? LOCK_FALLBACK_S);
        // venceu ou já foi usado: libera o reenvio sem esperar o timer
        else if (err.code === 'code_expired') stopCountdown();
      } finally {
        setVerifying(false);
        inFlight.current = false;
      }
    },
    [phone, verified, lockedUntil, verifyCode, commitAuth, nav, playVerified, failWith, lockFor, stopCountdown],
  );

  // ── reenviar ──────────────────────────────────────────────────────────────
  const onResend = useCallback(async () => {
    if (resending || seconds > 0 || verified || lockedUntil) return;
    setResending(true);
    setMessage(null);
    setCode('');
    try {
      const res = await requestCode(phone);
      setDevCode(res.devCode ?? null);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      setTone('ok');
      setMessage('Mandei outro. Dá uma olhada aí 👀');
      startCountdown(Math.max(RESEND_SECONDS, Math.ceil(res.resendIn ?? 0)));
    } catch (e) {
      const err = readSmsError(e, 'request');
      if (err.code === 'sms_cooldown') {
        setTone('ok');
        setMessage('O último código ainda vale. Dá pra pedir outro quando o tempo acabar.');
        startCountdown(err.retryAfter ?? 30);
      } else {
        setTone('error');
        setMessage(err.message);
        if (err.code === 'sms_locked') lockFor(err.retryAfter ?? LOCK_FALLBACK_S);
        // teto por número/conexão ou global: o timer mostra quanto falta
        else if (err.retryAfter && (err.code === 'sms_rate_limited' || err.code === 'sms_unavailable')) startCountdown(err.retryAfter);
      }
    } finally {
      setResending(false);
    }
  }, [resending, seconds, verified, lockedUntil, requestCode, phone, startCountdown, lockFor]);

  const onChangeCode = useCallback(
    (v: string) => {
      if (verified || lockedUntil) return;
      if (message && !error) setMessage(null);
      setCode(v);
    },
    [verified, lockedUntil, message, error],
  );

  const lockLeft = secondsLeft(lockedUntil, now);
  const locked = lockedUntil !== null;
  const canResend = seconds <= 0 && !verified && !resending && !locked;
  const statusIsError = error || (message !== null && tone === 'error');

  return (
    <View style={styles.root}>
      <BlobBackground intensity={0.25} paused={!focused} />

      <SafeAreaView style={styles.safe}>
        <KeyboardAvoidingView behavior="padding" style={styles.kb}>
          {/* rola quando o teclado deixa pouca altura (no S23 sobram ~410dp); sem isso o rodapé cobre o campo */}
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <FadeInView delay={60} fromX={-8} style={styles.topBar}>
              <Pressable
                onPress={() => nav.goBack()}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Voltar e trocar número"
                style={styles.back}
                disabled={verified}
              >
                <Ionicons name="chevron-back" size={26} color={colors.white} />
              </Pressable>
            </FadeInView>

            <View style={styles.content}>
              <FadeInView delay={120} fromY={14}>
                <Text style={styles.title}>
                  Chegou no <Text style={styles.titlePhone}>{maskPhoneBR(phone)}</Text>
                </Text>
              </FadeInView>
              <FadeInView delay={220} fromY={10}>
                <Text style={styles.subtitle}>
                  {verified ? 'Confirmado. Bora te encontrar 💚' : 'Digita os 6 dígitos do SMS. Se o celular preencher sozinho, melhor ainda.'}
                </Text>
              </FadeInView>

              <View style={styles.otpArea}>
                <Animated.View
                  style={[styles.otpWrap, otpStyle, locked && styles.otpLocked]}
                  pointerEvents={verified || locked ? 'none' : 'auto'}
                >
                  <FadeInView delay={340} fromY={10}>
                    <OtpInput
                      value={code}
                      onChange={onChangeCode}
                      onComplete={onComplete}
                      verified={verified}
                      error={error}
                      autoFocus
                    />
                  </FadeInView>
                </Animated.View>

                {verified ? (
                  <Animated.View style={[styles.badge, badgeStyle]} pointerEvents="none" accessibilityLabel="Código verificado">
                    <Canvas style={{ width: CHECK_SIZE, height: CHECK_SIZE }}>
                      <Group>
                        <Circle cx={CHECK_SIZE / 2} cy={CHECK_SIZE / 2} r={CHECK_SIZE / 2 - 2} color={colors.success} opacity={0.18} />
                        <Circle cx={CHECK_SIZE / 2} cy={CHECK_SIZE / 2} r={CHECK_SIZE / 2 - 2} color={colors.success} style="stroke" strokeWidth={2.5} />
                        <Path
                          path={CHECK_PATH}
                          color={colors.success}
                          style="stroke"
                          strokeWidth={7}
                          strokeCap="round"
                          strokeJoin="round"
                          start={0}
                          end={checkProgress}
                        />
                      </Group>
                    </Canvas>
                  </Animated.View>
                ) : null}
              </View>

              <View style={styles.feedback}>
                {message ? (
                  <FadeInView key={message} fromY={-4} durationMs={duration.fast} style={styles.messageRow}>
                    <Ionicons
                      name={statusIsError ? 'alert-circle' : 'checkmark-circle'}
                      size={16}
                      color={statusIsError ? colors.danger : colors.success}
                    />
                    <Text style={[styles.messageText, statusIsError ? styles.messageError : styles.messageOk]} accessibilityLiveRegion="polite">
                      {message}
                    </Text>
                  </FadeInView>
                ) : verifying ? (
                  <FadeInView key="verifying" fromY={-4} durationMs={duration.fast}>
                    <Text style={styles.hint}>Conferindo…</Text>
                  </FadeInView>
                ) : null}
              </View>

              {devCode && !verified ? (
                <FadeInView delay={480} fromY={8}>
                  <ScaleOnPress
                    onPress={() => setCode(devCode)}
                    haptic={false}
                    accessibilityRole="button"
                    accessibilityLabel={`Ambiente de desenvolvimento, código ${devCode}, toca pra preencher`}
                    style={styles.devBox}
                  >
                    <Ionicons name="construct-outline" size={16} color={colors.accent} />
                    <Text style={styles.devText}>
                      dev · código <Text style={styles.devCode}>{devCode}</Text> · toca pra preencher
                    </Text>
                  </ScaleOnPress>
                </FadeInView>
              ) : null}
            </View>

            <FadeInView delay={520} fromY={18} style={styles.footer}>
              {locked ? (
                <View style={styles.timerBox} accessible accessibilityLabel={`Código novo liberado em ${clock(lockLeft)}`}>
                  <View style={styles.timerRow}>
                    <Ionicons name="lock-closed" size={16} color={colors.white} style={styles.lockIcon} />
                    <Text style={styles.timerLabel}>Código novo em</Text>
                    <Text style={styles.timerValue}>{clock(lockLeft)}</Text>
                  </View>
                </View>
              ) : canResend ? (
                <ScaleOnPress
                  onPress={onResend}
                  glowColor={colors.primary}
                  accessibilityRole="button"
                  accessibilityLabel="Reenviar código"
                  style={styles.resendBtn}
                >
                  <Ionicons name="refresh" size={20} color={colors.black} />
                  <Text style={styles.resendBtnText}>Reenviar código</Text>
                </ScaleOnPress>
              ) : (
                <View style={styles.timerBox} accessible accessibilityLabel={resending ? 'Reenviando código' : `Reenviar em ${clock(seconds)}`}>
                  <View style={styles.timerRow}>
                    <Text style={styles.timerLabel}>{resending ? 'Reenviando' : verified ? 'Tudo certo' : 'Reenviar em'}</Text>
                    {!verified && !resending ? (
                      <Animated.Text style={[styles.timerValue, tickStyle]}>{clock(seconds)}</Animated.Text>
                    ) : null}
                  </View>
                  <View style={styles.timerTrack}>
                    <Animated.View style={[styles.timerFill, timerBarStyle]} />
                  </View>
                </View>
              )}

              <Pressable
                onPress={() => nav.goBack()}
                disabled={verified}
                accessibilityRole="button"
                accessibilityLabel="Trocar número"
                style={styles.swap}
              >
                <Text style={[styles.swapText, verified && styles.swapDisabled]}>Trocar número</Text>
              </Pressable>
            </FadeInView>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.black },
  safe: { flex: 1 },
  kb: { flex: 1 },
  scroll: { flexGrow: 1 },
  topBar: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  back: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { flex: 1, paddingHorizontal: spacing.xl, paddingTop: spacing.xl },
  title: { ...typography.h1, color: colors.white },
  titlePhone: { fontFamily: fontFamily.mono, fontSize: 26, color: colors.primary, letterSpacing: -0.5 },
  subtitle: { ...typography.bodyLarge, color: colors.white, opacity: 0.72, marginTop: spacing.sm },
  otpArea: { marginTop: spacing.xxl, minHeight: 100, justifyContent: 'center' },
  otpWrap: { alignSelf: 'stretch' },
  otpLocked: { opacity: 0.35 },
  badge: {
    position: 'absolute',
    alignSelf: 'center',
    top: -18,
    width: CHECK_SIZE,
    height: CHECK_SIZE,
  },
  feedback: { minHeight: 44, marginTop: spacing.md },
  messageRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  messageText: { ...typography.body, flex: 1 },
  messageError: { color: colors.danger },
  messageOk: { color: colors.success },
  hint: { ...typography.bodySmall, color: colors.gray[400] },
  devBox: {
    marginTop: spacing.sm,
    marginBottom: spacing.sm, // respiro antes do pill "Reenviar em"
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,215,0,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.35)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  devText: { ...typography.bodySmall, color: colors.accent, flex: 1 },
  devCode: { fontFamily: fontFamily.mono, fontSize: 14, color: colors.white },
  footer: { paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, gap: spacing.md },
  timerBox: {
    height: 58,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: 'rgba(250,250,250,0.18)',
    backgroundColor: 'rgba(250,250,250,0.05)',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    overflow: 'hidden',
  },
  timerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  timerLabel: { ...typography.label, color: colors.white, opacity: 0.8 },
  timerValue: { fontFamily: fontFamily.mono, fontSize: 18, color: colors.primary, minWidth: 40 },
  lockIcon: { opacity: 0.8 },
  timerTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: 'rgba(250,250,250,0.08)',
  },
  timerFill: {
    height: 3,
    backgroundColor: colors.primary,
    transformOrigin: 'left',
  },
  resendBtn: {
    height: 58,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  resendBtnText: { ...typography.h3, color: colors.black },
  swap: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  swapText: { ...typography.label, color: colors.white, opacity: 0.85 },
  swapDisabled: { opacity: 0.3 },
});
