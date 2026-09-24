import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Animated, {
  Easing,
  cancelAnimation,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';

import { colors, duration, fontFamily, radius, spacing, spring, typography } from '@cruzei/ui-mobile';
import { formatPhoneBR, isValidPhoneBR, normalizePhoneBR } from '@cruzei/shared-utils';
import { BlobBackground, FadeInView, ScaleOnPress, SlideInView } from '../../components/animated';
import { useAuthStore } from '../../stores/auth';
import { toApiError } from '../../services/api';
import type { RootStackParamList } from '../../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Login'>;

const BORDER_IDLE = 'rgba(250,250,250,0.14)';
const FIELD_BG = 'rgba(250,250,250,0.06)';

/**
 * PhoneScreen (rota "Login"): o usuário digita o celular e recebe o código por SMS.
 * - chip +55 🇧🇷 desliza da esquerda (SlideInView)
 * - campo com máscara animada (formatPhoneBR) e borda que ganha glow verde-limão no foco
 * - check verde entra com spring quando o número é válido; campo treme se tentar enviar inválido
 * - CTA "Continuar" com ScaleOnPress + glow, estado de loading inline
 */
export function PhoneScreen() {
  const nav = useNavigation<Nav>();
  const focused = useIsFocused();
  const requestCode = useAuthStore((s) => s.requestCode);

  const inputRef = useRef<TextInput>(null);
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = isValidPhoneBR(phone);

  // ── shared values (UI thread) ─────────────────────────────────────────────
  const focus = useSharedValue(0); // 0 = blur, 1 = foco
  const check = useSharedValue(0); // 0 = escondido, 1 = visível
  const shake = useSharedValue(0); // translateX do campo
  const digitPop = useSharedValue(1); // "respiro" do texto a cada dígito
  const ctaReady = useSharedValue(0); // 0 = desabilitado, 1 = pronto

  useEffect(() => {
    check.value = valid ? withSpring(1, spring.bouncy) : withTiming(0, { duration: duration.fast });
    ctaReady.value = withTiming(valid ? 1 : 0, { duration: duration.base, easing: Easing.out(Easing.cubic) });
  }, [valid, check, ctaReady]);

  useEffect(
    () => () => {
      cancelAnimation(shake);
      cancelAnimation(digitPop);
      cancelAnimation(check);
    },
    [shake, digitPop, check],
  );

  const fieldStyle = useAnimatedStyle(() => {
    const base: Record<string, unknown> = {
      borderColor: interpolateColor(focus.value, [0, 1], [BORDER_IDLE, colors.primary]),
      transform: [{ translateX: shake.value }],
    };
    if (Platform.OS === 'android') base.elevation = 6 * focus.value;
    else {
      base.shadowOpacity = 0.55 * focus.value;
      base.shadowRadius = 6 + 14 * focus.value;
    }
    return base;
  });

  const textStyle = useAnimatedStyle(() => ({ transform: [{ scale: digitPop.value }] }));

  const checkStyle = useAnimatedStyle(() => ({
    opacity: check.value,
    transform: [{ scale: 0.4 + 0.6 * check.value }, { rotate: `${(1 - check.value) * -40}deg` }],
  }));

  const ctaStyle = useAnimatedStyle(() => ({ opacity: 0.45 + 0.55 * ctaReady.value }));

  // ── handlers ──────────────────────────────────────────────────────────────
  const onChange = useCallback(
    (t: string) => {
      const next = formatPhoneBR(t);
      if (next.length > phone.length) {
        // micro-pop a cada dígito novo (100ms, sutil)
        digitPop.value = withSequence(withTiming(1.03, { duration: 60 }), withTiming(1, { duration: 90 }));
      }
      if (error) setError(null);
      setPhone(next);
    },
    [phone.length, error, digitPop],
  );

  const shakeField = useCallback(() => {
    shake.value = withSequence(
      withTiming(-10, { duration: 45 }),
      withTiming(10, { duration: 45 }),
      withTiming(-7, { duration: 45 }),
      withTiming(7, { duration: 45 }),
      withTiming(0, { duration: 60 }),
    );
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
  }, [shake]);

  const onContinue = useCallback(async () => {
    if (loading) return;
    setError(null);
    const normalized = normalizePhoneBR(phone);
    if (!normalized || !isValidPhoneBR(phone)) {
      shakeField();
      setError(phone.replace(/\D/g, '').length < 10 ? 'Faltou um pedaço. É DDD + número, tipo (34) 99999-9999.' : 'Esse DDD não existe por aqui. Confere aí?');
      inputRef.current?.focus();
      return;
    }
    setLoading(true);
    try {
      const res = await requestCode(normalized);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      nav.navigate('Code', { phone: normalized, devCode: res.devCode ?? null, expiresIn: res.expiresIn });
    } catch (e) {
      const err = toApiError(e);
      shakeField();
      setError(err.status === 429 ? err.message : 'Deu ruim pra enviar o código. Tenta de novo?');
    } finally {
      setLoading(false);
    }
  }, [loading, phone, requestCode, nav, shakeField]);

  return (
    <View style={styles.root}>
      <BlobBackground intensity={0.25} paused={!focused} />

      <SafeAreaView style={styles.safe}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kb}>
          <FadeInView delay={60} fromX={-8} style={styles.topBar}>
            <Pressable
              onPress={() => nav.goBack()}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Voltar"
              style={styles.back}
            >
              <Ionicons name="chevron-back" size={26} color={colors.white} />
            </Pressable>
          </FadeInView>

          <View style={styles.content}>
            <FadeInView delay={120} fromY={14}>
              <Text style={styles.title}>Seu número.</Text>
            </FadeInView>
            <FadeInView delay={220} fromY={10}>
              <Text style={styles.subtitle}>A gente manda um código, prometo que é rápido.</Text>
            </FadeInView>

            <View style={styles.row}>
              <SlideInView from="left" distance={48} delay={320} springPreset="soft">
                <View style={styles.chip} accessible accessibilityLabel="Brasil, código do país mais 55">
                  <Text style={styles.flag}>🇧🇷</Text>
                  <Text style={styles.chipText}>+55</Text>
                </View>
              </SlideInView>

              <FadeInView delay={380} fromY={8} style={styles.fieldWrap}>
                <Animated.View style={[styles.field, fieldStyle]}>
                  <Animated.View style={[styles.inputWrap, textStyle]}>
                    <TextInput
                      ref={inputRef}
                      value={phone}
                      onChangeText={onChange}
                      onFocus={() => {
                        focus.value = withTiming(1, { duration: duration.base, easing: Easing.out(Easing.cubic) });
                      }}
                      onBlur={() => {
                        focus.value = withTiming(0, { duration: duration.base });
                      }}
                      placeholder="(11) 99999-9999"
                      placeholderTextColor="rgba(250,250,250,0.3)"
                      keyboardType="phone-pad"
                      textContentType="telephoneNumber"
                      autoComplete="tel"
                      autoFocus
                      maxLength={15}
                      returnKeyType="send"
                      onSubmitEditing={onContinue}
                      editable={!loading}
                      selectionColor={colors.primary}
                      style={styles.input}
                      accessibilityLabel="Número de celular com DDD"
                    />
                  </Animated.View>
                  <Animated.View style={[styles.check, checkStyle]} pointerEvents="none">
                    <Ionicons name="checkmark-circle" size={26} color={colors.success} />
                  </Animated.View>
                </Animated.View>
              </FadeInView>
            </View>

            <View style={styles.feedback}>
              {error ? (
                <FadeInView key={error} fromY={-4} durationMs={duration.fast} style={styles.errorRow}>
                  <Ionicons name="alert-circle" size={16} color={colors.danger} />
                  <Text style={styles.errorText} accessibilityLiveRegion="polite">
                    {error}
                  </Text>
                </FadeInView>
              ) : (
                <FadeInView key="hint" fromY={-4} durationMs={duration.fast}>
                  <Text style={styles.hint}>Só celular brasileiro, com DDD. Sem +55, a gente já cuida disso.</Text>
                </FadeInView>
              )}
            </View>
          </View>

          <FadeInView delay={520} fromY={18} style={styles.footer}>
            <Animated.View style={ctaStyle}>
              <ScaleOnPress
                onPress={onContinue}
                glowColor={colors.primary}
                disabled={loading}
                accessibilityRole="button"
                accessibilityLabel={loading ? 'Enviando código' : 'Continuar'}
                accessibilityState={{ disabled: loading || !valid, busy: loading }}
                style={styles.cta}
              >
                {loading ? (
                  <>
                    <ActivityIndicator color={colors.black} />
                    <Text style={styles.ctaText}>Mandando o código…</Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.ctaText}>Continuar</Text>
                    <Ionicons name="arrow-forward" size={22} color={colors.black} />
                  </>
                )}
              </ScaleOnPress>
            </Animated.View>
            <Text style={styles.legal}>Você recebe um SMS com 6 dígitos. Tarifas da sua operadora podem rolar.</Text>
          </FadeInView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.black },
  safe: { flex: 1 },
  kb: { flex: 1 },
  topBar: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  back: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: { flex: 1, paddingHorizontal: spacing.xl, paddingTop: spacing.xl },
  title: { ...typography.display, fontSize: 38, lineHeight: 44, color: colors.white },
  subtitle: { ...typography.bodyLarge, color: colors.white, opacity: 0.72, marginTop: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xxl },
  chip: {
    height: 64,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: FIELD_BG,
    borderWidth: 1,
    borderColor: BORDER_IDLE,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  flag: { fontSize: 22 },
  chipText: { fontFamily: fontFamily.mono, fontSize: 18, color: colors.white },
  fieldWrap: { flex: 1 },
  field: {
    height: 64,
    borderRadius: radius.lg,
    backgroundColor: FIELD_BG,
    borderWidth: 1.5,
    borderColor: BORDER_IDLE,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing.lg,
    paddingRight: spacing.md,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
  },
  inputWrap: { flex: 1 },
  input: {
    fontFamily: fontFamily.mono,
    fontSize: 22,
    color: colors.white,
    padding: 0,
    height: 60,
    letterSpacing: 0.5,
  },
  check: { marginLeft: spacing.sm },
  feedback: { minHeight: 44, marginTop: spacing.md },
  errorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  errorText: { ...typography.body, color: colors.danger, flex: 1 },
  hint: { ...typography.bodySmall, color: colors.gray[400] },
  footer: { paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, gap: spacing.md },
  cta: {
    height: 58,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
  },
  ctaText: { ...typography.h3, color: colors.black },
  legal: { ...typography.caption, color: colors.gray[500], textAlign: 'center' },
});
