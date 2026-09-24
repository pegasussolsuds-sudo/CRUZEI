import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type AccessibilityActionEvent,
  type LayoutChangeEvent,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  cancelAnimation,
  interpolateColor,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

import { colors, duration, radius, spacing, spring, typography } from '@cruzei/ui-mobile';
import { calculateAge, isAtLeast18 } from '@cruzei/shared-utils';
import { BlobBackground, FadeInView, Glow, ScaleOnPress } from '../../components/animated';
import { useAuthStore } from '../../stores/auth';
import { useLocationStore } from '../../stores/location';
import { api, toApiError } from '../../services/api';
import type { RootStackParamList } from '../../navigation/RootNavigator';

// ─────────────────────────────────────────────────────────────────────────────
// Conteúdo
// ─────────────────────────────────────────────────────────────────────────────

const GENDERS = [
  { value: 'female', label: 'Mulher', emoji: '👩' },
  { value: 'male', label: 'Homem', emoji: '👨' },
  { value: 'non_binary', label: 'Não-binário', emoji: '🧑' },
  { value: 'other', label: 'Outro', emoji: '✨' },
] as const;

const LOOKING_FOR = [
  { value: 'relationship', label: 'Namorar', emoji: '💚' },
  { value: 'casual', label: 'Algo casual', emoji: '🔥' },
  { value: 'friendship', label: 'Amizade', emoji: '🤝' },
  { value: 'network', label: 'Networking', emoji: '💼' },
] as const;

const STEPS = [
  { key: 'name', title: 'Qual seu nome?', hint: 'É assim que as pessoas vão te ver no mapa.' },
  { key: 'birth', title: 'Quando você nasceu?', hint: 'Só pra garantir que você tem 18+. A idade aparece no perfil, a data não.' },
  { key: 'gender', title: 'Como você se identifica?', hint: 'Isso ajuda a mostrar seu perfil pra quem faz sentido.' },
  { key: 'looking', title: 'O que você procura?', hint: 'Dá pra mudar depois, sem drama.' },
  { key: 'prefs', title: 'Até que distância?', hint: 'Quem cruzou seu caminho aparece no mapa. Você decide o quão perto.' },
] as const;

const TOTAL_STEPS = STEPS.length;
const LAST_STEP = TOTAL_STEPS - 1;
const NAME_MAX = 50;
const SLIDE_PX = 72;

const MIN_M = 100;
const MAX_M = 5000;
const STEP_M = 100;
const DEFAULT_M = 1000;
const THUMB = 28;
const LABEL_W = 72;

type Props = NativeStackScreenProps<RootStackParamList, 'Register'>;
type AgeStatus = 'idle' | 'ok' | 'under' | 'invalid';

// ─────────────────────────────────────────────────────────────────────────────
// Tela
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ProfileSetup (rota Register): 5 etapas — nome, nascimento, gênero, intenção, preferências.
 * Fundo escuro com blobs vivos, barra de progresso com spring, transição horizontal entre etapas,
 * chips animados, slider de raio (gesture-handler + Reanimated) e toggle Visível/Anônimo.
 * Ao concluir chama register(); o store marca onboardingStep='avatar' e o RootNavigator segue pra AvatarSetup → PhotoUpload.
 */
export function ProfileSetupScreen({ route }: Props) {
  const { phone } = route.params;
  const register = useAuthStore((s) => s.register);
  const setAnonymous = useLocationStore((s) => s.setAnonymous);
  const focused = useIsFocused();

  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [birthDate, setBirthDate] = useState(''); // DD/MM/AAAA
  const [gender, setGender] = useState<string | null>(null);
  const [lookingFor, setLookingFor] = useState<string | null>(null);
  // Raio de busca: o backend ainda não persiste raio (não há campo no useLocationStore nem endpoint).
  // Fica só em estado local por enquanto; quando existir, é só plugar aqui.
  const [radiusM, setRadiusM] = useState(DEFAULT_M);
  const [anonymous, setAnonymousLocal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedDate = parseDate(birthDate);
  const dateValid = Boolean(parsedDate && isAtLeast18(parsedDate));
  const age = parsedDate ? calculateAge(parsedDate) : null;
  const ageStatus: AgeStatus =
    birthDate.length < 10 ? 'idle' : !parsedDate ? 'invalid' : dateValid ? 'ok' : 'under';

  const canNext =
    step === 0
      ? name.trim().length >= 2
      : step === 1
        ? dateValid
        : step === 2
          ? Boolean(gender)
          : step === 3
            ? Boolean(lookingFor)
            : true;

  // ── transição horizontal entre etapas ──────────────────────────────────────
  const slideX = useSharedValue(0);
  const slideOpacity = useSharedValue(1);
  const animatingRef = useRef(false);

  const commitStep = useCallback(
    (next: number, dir: number) => {
      slideX.value = dir * SLIDE_PX;
      slideOpacity.value = 0;
      animatingRef.current = false;
      setStep(next);
    },
    [slideOpacity, slideX],
  );

  const goTo = useCallback(
    (next: number) => {
      if (animatingRef.current || next < 0 || next > LAST_STEP || next === step) return;
      animatingRef.current = true;
      Keyboard.dismiss();
      setError(null);
      const dir = next > step ? 1 : -1;
      slideOpacity.value = withTiming(0, { duration: duration.fast });
      slideX.value = withTiming(
        -dir * SLIDE_PX,
        { duration: duration.fast, easing: Easing.in(Easing.cubic) },
        (finished) => {
          if (finished) runOnJS(commitStep)(next, dir);
        },
      );
    },
    [commitStep, slideOpacity, slideX, step],
  );

  useEffect(() => {
    // entrada da nova etapa (na montagem inicial vai de 0 → 0, sem efeito visível)
    slideX.value = withSpring(0, spring.soft);
    slideOpacity.value = withTiming(1, { duration: duration.base, easing: Easing.out(Easing.cubic) });
    return () => {
      cancelAnimation(slideX);
      cancelAnimation(slideOpacity);
    };
  }, [step, slideOpacity, slideX]);

  const slideStyle = useAnimatedStyle(() => ({
    opacity: slideOpacity.value,
    transform: [{ translateX: slideX.value }],
  }));

  // ── CTA ────────────────────────────────────────────────────────────────────
  const enabled = useSharedValue(canNext ? 1 : 0);
  useEffect(() => {
    enabled.value = withTiming(canNext ? 1 : 0, { duration: duration.base });
  }, [canNext, enabled]);
  const ctaStyle = useAnimatedStyle(() => ({ opacity: 0.35 + 0.65 * enabled.value }));

  const onNext = useCallback(() => {
    if (!canNext) return;
    goTo(step + 1);
  }, [canNext, goTo, step]);

  const onFinish = useCallback(async () => {
    if (!parsedDate || !gender || !lookingFor || loading) return;
    setError(null);
    setLoading(true);
    try {
      await register({
        phone,
        name: name.trim(),
        birthDate: toIsoDate(parsedDate),
        gender,
        lookingFor,
      });
      // sucesso → o store marca onboardingStep='avatar' e o RootNavigator vai pra AvatarSetup (depois PhotoUpload).
      setAnonymous(anonymous);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      if (!anonymous) {
        try {
          await api.patch('/me/settings', { visibilityMode: 'visible' });
        } catch {
          /* não trava o onboarding — dá pra mudar a visibilidade no mapa depois */
        }
      }
    } catch (e) {
      const err = toApiError(e);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setError(
        err.status === 401 || err.status === 409
          ? 'Esse número já tem conta por aqui. Volta e faz login 😉'
          : !err.status
            ? 'Sem sinal com a gente agora. Confere sua internet e tenta de novo?'
            : `Deu ruim aqui do nosso lado (${err.message}). Tenta de novo?`,
      );
      setLoading(false);
    }
  }, [anonymous, gender, loading, lookingFor, name, parsedDate, phone, register, setAnonymous]);

  const current = STEPS[step];
  const isLast = step === LAST_STEP;

  return (
    <View style={styles.root}>
      <BlobBackground intensity={0.22} speed={0.8} paused={!focused} />
      <LinearGradient
        colors={['rgba(10,10,26,0.2)', 'rgba(10,10,26,0.7)', 'rgba(10,10,26,0.96)']}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <ProgressBar step={step} />

            <Animated.View style={slideStyle}>
              <Text style={styles.stepCount} accessibilityLabel={`Etapa ${step + 1} de ${TOTAL_STEPS}`}>
                {`${String(step + 1).padStart(2, '0')} / ${String(TOTAL_STEPS).padStart(2, '0')}`}
              </Text>
              <Text style={styles.stepTitle} accessibilityRole="header">
                {current.title}
              </Text>
              <Text style={styles.stepHint}>{current.hint}</Text>

              {step === 0 ? (
                <>
                  <FocusInput
                    placeholder="Como você quer ser chamado(a)?"
                    value={name}
                    onChangeText={(t) => setName(t.slice(0, NAME_MAX))}
                    autoFocus
                    maxLength={NAME_MAX}
                    autoCapitalize="words"
                    autoCorrect={false}
                    returnKeyType="next"
                    onSubmitEditing={onNext}
                    counter={`${name.length}/${NAME_MAX}`}
                    accessibilityLabel="Seu nome"
                  />
                  <Reveal visible={name.trim().length >= 2}>
                    <Text style={styles.preview}>Prazer, {name.trim()} 👋</Text>
                  </Reveal>
                </>
              ) : null}

              {step === 1 ? (
                <>
                  <FocusInput
                    placeholder="DD/MM/AAAA"
                    value={birthDate}
                    onChangeText={(t) => setBirthDate(formatDate(t))}
                    keyboardType="number-pad"
                    maxLength={10}
                    autoFocus
                    returnKeyType="done"
                    onSubmitEditing={onNext}
                    mono
                    accessibilityLabel="Data de nascimento, dia mês e ano"
                  />
                  <AgeHint status={ageStatus} age={age} />
                </>
              ) : null}

              {step === 2 ? (
                <View style={styles.chips}>
                  {GENDERS.map((g, i) => (
                    <FadeInView key={g.value} delay={60 + i * 50} fromY={10} style={styles.chipWrap}>
                      <Chip label={g.label} emoji={g.emoji} selected={gender === g.value} onPress={() => setGender(g.value)} />
                    </FadeInView>
                  ))}
                </View>
              ) : null}

              {step === 3 ? (
                <View style={styles.chips}>
                  {LOOKING_FOR.map((o, i) => (
                    <FadeInView key={o.value} delay={60 + i * 50} fromY={10} style={styles.chipWrap}>
                      <Chip
                        label={o.label}
                        emoji={o.emoji}
                        selected={lookingFor === o.value}
                        onPress={() => setLookingFor(o.value)}
                      />
                    </FadeInView>
                  ))}
                </View>
              ) : null}

              {step === 4 ? (
                <>
                  <FadeInView delay={80} fromY={10}>
                    <RadiusSlider value={radiusM} onChange={setRadiusM} />
                  </FadeInView>
                  <FadeInView delay={200} fromY={10} style={styles.visibilityBlock}>
                    <Text style={styles.sectionTitle}>Como você quer aparecer?</Text>
                    <VisibilityToggle anonymous={anonymous} onChange={setAnonymousLocal} />
                  </FadeInView>
                </>
              ) : null}

              {error ? <ErrorBanner message={error} /> : null}
            </Animated.View>
          </ScrollView>

          <View style={styles.footer}>
            {step > 0 ? (
              <FadeInView key="back" fromX={-8} style={styles.backWrap}>
                <ScaleOnPress
                  onPress={() => goTo(step - 1)}
                  disabled={loading}
                  haptic={false}
                  accessibilityRole="button"
                  accessibilityLabel="Voltar pra etapa anterior"
                  style={styles.back}
                >
                  <Ionicons name="chevron-back" size={22} color={colors.white} />
                </ScaleOnPress>
              </FadeInView>
            ) : null}

            <Animated.View style={[styles.flex, ctaStyle]}>
              <Glow color={colors.primary} spread={12} intensity={0.45} shape="pill" animated={isLast} style={styles.stretch}>
                <ScaleOnPress
                  onPress={isLast ? onFinish : onNext}
                  disabled={!canNext || loading}
                  glowColor={colors.primary}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !canNext || loading, busy: loading }}
                  accessibilityLabel={isLast ? 'Concluir cadastro' : 'Continuar pra próxima etapa'}
                  style={styles.cta}
                >
                  {loading ? (
                    <ActivityIndicator color={colors.black} />
                  ) : (
                    <>
                      <Text style={styles.ctaText}>{isLast ? 'Bora te encontrar?' : 'Continuar'}</Text>
                      <Ionicons name={isLast ? 'sparkles' : 'arrow-forward'} size={20} color={colors.black} />
                    </>
                  )}
                </ScaleOnPress>
              </Glow>
            </Animated.View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Barra de progresso (largura com spring)
// ─────────────────────────────────────────────────────────────────────────────

function ProgressBar({ step }: { step: number }) {
  const [trackW, setTrackW] = useState(0);
  const p = useSharedValue((step + 1) / TOTAL_STEPS);

  useEffect(() => {
    p.value = withSpring((step + 1) / TOTAL_STEPS, spring.soft);
  }, [p, step]);

  const fill = useAnimatedStyle(() => ({ width: trackW * p.value }));

  return (
    <View
      style={styles.progressTrack}
      onLayout={(e: LayoutChangeEvent) => setTrackW(e.nativeEvent.layout.width)}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: TOTAL_STEPS, now: step + 1 }}
    >
      <Animated.View style={[styles.progressFill, fill]} />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Input com foco animado (borda + anel de glow)
// ─────────────────────────────────────────────────────────────────────────────

interface FocusInputProps extends TextInputProps {
  counter?: string;
  mono?: boolean;
}

function FocusInput({ counter, mono = false, onFocus, onBlur, style, ...rest }: FocusInputProps) {
  const focus = useSharedValue(0);

  const ring = useAnimatedStyle(() => ({
    opacity: 0.45 * focus.value,
    transform: [{ scale: 1 + 0.008 * focus.value }],
  }));
  const box = useAnimatedStyle(() => ({
    borderColor: interpolateColor(focus.value, [0, 1], ['rgba(250,250,250,0.16)', colors.primary]),
    shadowOpacity: 0.5 * focus.value,
  }));

  return (
    <View style={styles.inputWrap}>
      <Animated.View pointerEvents="none" style={[styles.inputRing, ring]} />
      <Animated.View style={[styles.inputBox, box]}>
        <TextInput
          {...rest}
          style={[styles.input, mono ? styles.inputMono : null, style]}
          placeholderTextColor="rgba(250,250,250,0.35)"
          selectionColor={colors.primary}
          cursorColor={colors.primary}
          keyboardAppearance="dark"
          onFocus={(e) => {
            focus.value = withTiming(1, { duration: duration.base });
            onFocus?.(e);
          }}
          onBlur={(e) => {
            focus.value = withTiming(0, { duration: duration.fast });
            onBlur?.(e);
          }}
        />
        {counter ? (
          <Text style={styles.counter} accessibilityElementsHidden importantForAccessibility="no">
            {counter}
          </Text>
        ) : null}
      </Animated.View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Reveal — mostra/esconde com fade+lift sem remontar (não re-anima a cada tecla)
// ─────────────────────────────────────────────────────────────────────────────

function Reveal({ visible, children }: { visible: boolean; children: React.ReactNode }) {
  const v = useSharedValue(visible ? 1 : 0);
  useEffect(() => {
    v.value = withTiming(visible ? 1 : 0, { duration: duration.base, easing: Easing.out(Easing.cubic) });
  }, [v, visible]);
  const style = useAnimatedStyle(() => ({
    opacity: v.value,
    transform: [{ translateY: (1 - v.value) * 6 }],
  }));
  return (
    <Animated.View style={style} pointerEvents="none">
      {children}
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Mensagem de idade (pop no ok, shake no erro)
// ─────────────────────────────────────────────────────────────────────────────

function AgeHint({ status, age }: { status: AgeStatus; age: number | null }) {
  const pop = useSharedValue(0);
  const shake = useSharedValue(0);

  useEffect(() => {
    if (status === 'idle') {
      pop.value = withTiming(0, { duration: duration.fast });
      return;
    }
    pop.value = 0;
    pop.value = withSpring(1, spring.bouncy);
    if (status === 'ok') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } else {
      shake.value = withSequence(
        withTiming(-8, { duration: 45 }),
        withTiming(8, { duration: 45 }),
        withTiming(-5, { duration: 45 }),
        withTiming(0, { duration: 45 }),
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    }
    return () => {
      cancelAnimation(pop);
      cancelAnimation(shake);
    };
  }, [pop, shake, status]);

  const style = useAnimatedStyle(() => ({
    opacity: Math.min(1, pop.value),
    transform: [{ scale: 0.85 + 0.15 * pop.value }, { translateX: shake.value }],
  }));

  const ok = status === 'ok';
  const text =
    status === 'ok'
      ? `Fechou: ${age} anos. Tá liberado ✅`
      : status === 'under'
        ? 'Ainda não rolou: o Cruzei é só pra maiores de 18.'
        : status === 'invalid'
          ? 'Essa data não existe. Confere aí?'
          : '';

  return (
    <Animated.View style={[styles.ageHint, style]} accessibilityLiveRegion="polite">
      {text ? (
        <>
          <Ionicons name={ok ? 'checkmark-circle' : 'alert-circle'} size={18} color={ok ? colors.primary : colors.danger} />
          <Text style={[styles.ageHintText, { color: ok ? colors.primary : colors.danger }]}>{text}</Text>
        </>
      ) : null}
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Chip selecionável (scale + cor preenchendo + haptics via ScaleOnPress)
// ─────────────────────────────────────────────────────────────────────────────

interface ChipProps {
  label: string;
  emoji: string;
  selected: boolean;
  onPress: () => void;
}

function Chip({ label, emoji, selected, onPress }: ChipProps) {
  const sel = useSharedValue(selected ? 1 : 0);

  useEffect(() => {
    sel.value = withSpring(selected ? 1 : 0, spring.snappy);
  }, [sel, selected]);

  const box = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(sel.value, [0, 1], ['rgba(250,250,250,0.06)', colors.primary]),
    borderColor: interpolateColor(sel.value, [0, 1], ['rgba(250,250,250,0.18)', colors.primary]),
    transform: [{ scale: 1 + 0.03 * sel.value }],
  }));
  const text = useAnimatedStyle(() => ({
    color: interpolateColor(sel.value, [0, 1], [colors.white, colors.black]),
  }));
  const check = useAnimatedStyle(() => ({
    opacity: sel.value,
    transform: [{ scale: 0.5 + 0.5 * sel.value }],
  }));

  return (
    <ScaleOnPress
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      accessibilityLabel={label}
    >
      <Animated.View style={[styles.chip, box]}>
        <Text style={styles.chipEmoji}>{emoji}</Text>
        {/* rótulos longos ("Não-binário") encolhem em vez de quebrar no meio da palavra */}
        <Animated.Text style={[styles.chipText, text]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
          {label}
        </Animated.Text>
        <Animated.View style={[styles.chipCheck, check]}>
          <Ionicons name="checkmark-circle" size={20} color={colors.black} />
        </Animated.View>
      </Animated.View>
    </ScaleOnPress>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Slider de raio (100 m – 5 km) — gesture-handler + Reanimated, label flutuante
// ─────────────────────────────────────────────────────────────────────────────

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

function formatRadius(m: number): string {
  'worklet';
  if (m < 1000) return `${m} m`;
  const km = m / 1000;
  return `${Number.isInteger(km) ? String(km) : km.toFixed(1).replace('.', ',')} km`;
}

function toProgress(m: number): number {
  'worklet';
  return (m - MIN_M) / (MAX_M - MIN_M);
}

function snapMeters(p: number): number {
  'worklet';
  return MIN_M + Math.round((p * (MAX_M - MIN_M)) / STEP_M) * STEP_M;
}

interface RadiusSliderProps {
  value: number;
  onChange: (meters: number) => void;
}

function RadiusSlider({ value, onChange }: RadiusSliderProps) {
  const [trackW, setTrackW] = useState(0);
  const usable = Math.max(1, trackW - THUMB);

  const progress = useSharedValue(toProgress(value));
  const dragging = useSharedValue(0);
  const lastSnapped = useSharedValue(value);
  const snapped = useDerivedValue(() => snapMeters(progress.value));

  useEffect(() => {
    // sincroniza quando o valor muda por fora (ex.: ações de acessibilidade)
    if (dragging.value === 0) progress.value = withSpring(toProgress(value), spring.snappy);
  }, [dragging, progress, value]);

  const tick = useCallback(() => {
    Haptics.selectionAsync().catch(() => {});
  }, []);

  const setFromX = (x: number) => {
    'worklet';
    const p = Math.min(1, Math.max(0, (x - THUMB / 2) / usable));
    progress.value = p;
    const s = snapMeters(p);
    if (s !== lastSnapped.value) {
      lastSnapped.value = s;
      runOnJS(tick)();
    }
  };

  const pan = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => {
      dragging.value = withSpring(1, spring.snappy);
      setFromX(e.x);
    })
    .onUpdate((e) => {
      setFromX(e.x);
    })
    .onFinalize(() => {
      dragging.value = withSpring(0, spring.snappy);
      const s = snapped.value;
      progress.value = withSpring(toProgress(s), spring.snappy);
      runOnJS(onChange)(s);
    });

  const fillStyle = useAnimatedStyle(() => ({ width: THUMB / 2 + progress.value * usable }));
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * usable }, { scale: 1 + 0.18 * dragging.value }],
  }));
  const labelStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: progress.value * usable + THUMB / 2 - LABEL_W / 2 },
      { translateY: -6 * dragging.value },
      { scale: 1 + 0.06 * dragging.value },
    ],
  }));
  const labelProps = useAnimatedProps(() => {
    const t = formatRadius(snapped.value);
    return { text: t, defaultValue: t } as unknown as TextInputProps;
  });

  const onAccessibilityAction = (e: AccessibilityActionEvent) => {
    const delta = e.nativeEvent.actionName === 'increment' ? 500 : e.nativeEvent.actionName === 'decrement' ? -500 : 0;
    if (!delta) return;
    onChange(Math.min(MAX_M, Math.max(MIN_M, value + delta)));
  };

  return (
    <View
      style={styles.sliderBlock}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Distância máxima"
      accessibilityValue={{ text: formatRadius(value) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={onAccessibilityAction}
    >
      <View style={styles.sliderLabelRow}>
        <Animated.View style={[styles.sliderLabel, labelStyle]}>
          <AnimatedTextInput
            animatedProps={labelProps}
            defaultValue={formatRadius(value)}
            editable={false}
            underlineColorAndroid="transparent"
            style={styles.sliderLabelText}
          />
        </Animated.View>
      </View>

      <GestureDetector gesture={pan}>
        <View style={styles.sliderHit} onLayout={(e: LayoutChangeEvent) => setTrackW(e.nativeEvent.layout.width)}>
          <View style={styles.sliderTrack}>
            <Animated.View style={[styles.sliderFill, fillStyle]} />
          </View>
          <Animated.View style={[styles.thumbWrap, thumbStyle]} pointerEvents="none">
            <Glow color={colors.primary} spread={10} intensity={0.8} shape="circle" cycleMs={2200}>
              <View style={styles.thumb} />
            </Glow>
          </Animated.View>
        </View>
      </GestureDetector>

      <View style={styles.sliderEnds}>
        <Text style={styles.sliderEnd}>100 m</Text>
        <Text style={styles.sliderEnd}>5 km</Text>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Toggle Visível / Anônimo (segmento deslizante com spring)
// ─────────────────────────────────────────────────────────────────────────────

interface VisibilityToggleProps {
  anonymous: boolean;
  onChange: (anonymous: boolean) => void;
}

function VisibilityToggle({ anonymous, onChange }: VisibilityToggleProps) {
  const [w, setW] = useState(0);
  const pos = useSharedValue(anonymous ? 1 : 0);

  useEffect(() => {
    pos.value = withSpring(anonymous ? 1 : 0, spring.snappy);
  }, [anonymous, pos]);

  const half = Math.max(0, (w - 8) / 2);
  const knob = useAnimatedStyle(() => ({
    width: half,
    transform: [{ translateX: pos.value * half }],
    backgroundColor: interpolateColor(pos.value, [0, 1], [colors.primary, colors.white]),
  }));
  const leftText = useAnimatedStyle(() => ({
    color: interpolateColor(pos.value, [0, 1], [colors.black, 'rgba(250,250,250,0.7)']),
  }));
  const rightText = useAnimatedStyle(() => ({
    color: interpolateColor(pos.value, [0, 1], ['rgba(250,250,250,0.7)', colors.black]),
  }));

  const pick = (v: boolean) => {
    if (v === anonymous) return;
    Haptics.selectionAsync().catch(() => {});
    onChange(v);
  };

  return (
    <View>
      <View style={styles.toggle} onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)} accessibilityRole="radiogroup">
        <Animated.View style={[styles.toggleKnob, knob]} pointerEvents="none" />
        <Pressable
          style={styles.toggleSeg}
          onPress={() => pick(false)}
          accessibilityRole="radio"
          accessibilityState={{ selected: !anonymous, checked: !anonymous }}
          accessibilityLabel="Visível no mapa"
        >
          <Animated.Text style={[styles.toggleText, leftText]}>👀 Visível</Animated.Text>
        </Pressable>
        <Pressable
          style={styles.toggleSeg}
          onPress={() => pick(true)}
          accessibilityRole="radio"
          accessibilityState={{ selected: anonymous, checked: anonymous }}
          accessibilityLabel="Anônimo"
        >
          <Animated.Text style={[styles.toggleText, rightText]}>🕶️ Anônimo</Animated.Text>
        </Pressable>
      </View>
      <FadeInView key={anonymous ? 'anon' : 'vis'} fromY={4} durationMs={duration.base}>
        <Text style={styles.toggleHint}>
          {anonymous
            ? 'Anônimo: você vê todo mundo, ninguém te vê. Dá pra mudar no mapa.'
            : 'Visível: quem cruzou seu caminho te vê no mapa e pode dar match. Dá pra mudar no mapa.'}
        </Text>
      </FadeInView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Erro com shake de entrada
// ─────────────────────────────────────────────────────────────────────────────

function ErrorBanner({ message }: { message: string }) {
  const shake = useSharedValue(0);
  useEffect(() => {
    shake.value = withSequence(
      withTiming(-6, { duration: 45 }),
      withTiming(6, { duration: 45 }),
      withTiming(-3, { duration: 45 }),
      withTiming(0, { duration: 45 }),
    );
    return () => cancelAnimation(shake);
  }, [message, shake]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));

  return (
    <FadeInView fromY={6}>
      <Animated.View style={[styles.errorBox, style]} accessibilityLiveRegion="assertive" accessibilityRole="alert">
        <Ionicons name="alert-circle" size={18} color={colors.danger} />
        <Text style={styles.errorText}>{message}</Text>
      </Animated.View>
    </FadeInView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Datas
// ─────────────────────────────────────────────────────────────────────────────

// Auto-insere as barras enquanto digita
function formatDate(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

function parseDate(s: string): Date | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  const valid = d.getFullYear() === Number(yyyy) && d.getMonth() === Number(mm) - 1 && d.getDate() === Number(dd);
  if (!valid || d.getTime() > Date.now()) return null;
  return d;
}

// YYYY-MM-DD no fuso local (evita o "dia anterior" do toISOString em UTC-3)
function toIsoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Estilos
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.black },
  safe: { flex: 1 },
  flex: { flex: 1 },
  stretch: { alignSelf: 'stretch' },
  content: { padding: spacing.xl, paddingTop: spacing.lg, flexGrow: 1 },

  progressTrack: {
    height: 4,
    borderRadius: radius.full,
    backgroundColor: 'rgba(250,250,250,0.12)',
    overflow: 'hidden',
    marginBottom: spacing.xl,
  },
  progressFill: { height: 4, borderRadius: radius.full, backgroundColor: colors.primary },

  stepCount: { ...typography.mono, color: colors.primary, marginBottom: spacing.xs, opacity: 0.9 },
  stepTitle: { ...typography.h1, color: colors.white, marginBottom: spacing.xs },
  stepHint: { ...typography.body, color: 'rgba(250,250,250,0.65)', marginBottom: spacing.xl },

  inputWrap: { position: 'relative' },
  inputRing: {
    position: 'absolute',
    left: -4,
    right: -4,
    top: -4,
    bottom: -4,
    borderRadius: radius.md + 4,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    backgroundColor: 'rgba(250,250,250,0.06)',
    paddingRight: spacing.md,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 14,
  },
  input: { ...typography.h3, flex: 1, color: colors.white, padding: spacing.lg, minHeight: 60 },
  inputMono: { ...typography.mono, fontSize: 22, lineHeight: 28, letterSpacing: 2 },
  counter: { ...typography.caption, color: 'rgba(250,250,250,0.4)' },
  preview: { ...typography.h4, color: colors.primary, marginTop: spacing.md },

  ageHint: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md, minHeight: 24 },
  ageHintText: { ...typography.label, flex: 1 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chipWrap: { flexGrow: 1, flexBasis: '45%' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  chipEmoji: { fontSize: 18 },
  chipText: { ...typography.h4, flex: 1 },
  chipCheck: { marginLeft: spacing.xs },

  sliderBlock: { paddingTop: spacing.xxl },
  sliderLabelRow: { height: 34, marginBottom: spacing.xs },
  sliderLabel: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: LABEL_W,
    height: 30,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sliderLabelText: {
    ...typography.mono,
    color: colors.black,
    textAlign: 'center',
    padding: 0,
    width: LABEL_W,
    height: 30,
  },
  sliderHit: { height: 44, justifyContent: 'center' },
  sliderTrack: {
    height: 6,
    borderRadius: radius.full,
    backgroundColor: 'rgba(250,250,250,0.14)',
    marginHorizontal: THUMB / 2,
    overflow: 'hidden',
  },
  sliderFill: { height: 6, borderRadius: radius.full, backgroundColor: colors.primary, marginLeft: -THUMB / 2 },
  thumbWrap: { position: 'absolute', left: 0, top: (44 - THUMB) / 2, width: THUMB, height: THUMB },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: colors.primary,
    borderWidth: 3,
    borderColor: colors.black,
  },
  sliderEnds: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
  sliderEnd: { ...typography.caption, color: 'rgba(250,250,250,0.45)' },

  visibilityBlock: { marginTop: spacing.xxl },
  sectionTitle: { ...typography.h4, color: colors.white, marginBottom: spacing.md },
  toggle: {
    flexDirection: 'row',
    height: 52,
    padding: 4,
    borderRadius: radius.full,
    backgroundColor: 'rgba(250,250,250,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(250,250,250,0.14)',
  },
  toggleKnob: { position: 'absolute', left: 4, top: 4, bottom: 4, borderRadius: radius.full },
  toggleSeg: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  toggleText: { ...typography.label },
  toggleHint: { ...typography.body, color: 'rgba(250,250,250,0.65)', marginTop: spacing.md },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,59,48,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,59,48,0.4)',
  },
  errorText: { ...typography.body, color: colors.white, flex: 1 },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: 'rgba(250,250,250,0.08)',
  },
  backWrap: {},
  back: {
    width: 52,
    height: 52,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: 'rgba(250,250,250,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  ctaText: { ...typography.h3, color: colors.black },
});
