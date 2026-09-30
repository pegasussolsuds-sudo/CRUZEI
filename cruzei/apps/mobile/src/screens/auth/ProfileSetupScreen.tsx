import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScrollView } from 'react-native-gesture-handler';
import { useQuery } from '@tanstack/react-query';
import Animated, {
  Easing,
  cancelAnimation,
  interpolateColor,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

import { colors, duration, radius, spacing, spring, typography } from '@cruzei/ui-mobile';
import { calculateAge, INSTAGRAM_HANDLE_MAX, isAtLeast18 } from '@cruzei/shared-utils';
import {
  GENDER_LABELS,
  LEGAL_VERSION,
  ORIENTATIONS,
  ORIENTATION_LABELS,
  PROFILE_LIMITS,
  SHOW_ME_LABELS,
  type Gender,
  type LookingFor,
  type Orientation,
  type ShowMe,
} from '@cruzei/shared-types';
import { BlobBackground, FadeInView, Glow, ScaleOnPress } from '../../components/animated';
import { InterestPicker } from '../../components/profile/InterestPicker';
import type { CatalogItem } from '../../components/profile/interests';
import { useAuthStore } from '../../stores/auth';
import { useLocationStore } from '../../stores/location';
import { api, toApiError } from '../../services/api';
import { trackOnboardingStep } from '../../services/analytics';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { TermsCheck } from '../../components/legal/TermsCheck';
import { SHOW_ME_RECIPROCAL_NOTE } from '../../components/showMeNote';
import { formatDate, parseDate, toIsoDate } from './birthDate';
import {
  PHASES,
  SETUP_STEPS,
  TOTAL_STEPS,
  buildRegisterInput,
  checkInstagram,
  phaseFill,
  phaseProgress,
  precheckStep,
  stepErrorOf,
  stepIndexOf,
  type InstagramCheck,
  type StepError,
  type StepKey,
} from './profileSetupFlow';

// ─────────────────────────────────────────────────────────────────────────────
// Conteúdo
// ─────────────────────────────────────────────────────────────────────────────

// só Mulher / Homem / Outro (GENDER_LABELS; "Não-binário" saiu)
const GENDERS: { value: Gender; emoji: string }[] = [
  { value: 'female', emoji: '👩' },
  { value: 'male', emoji: '👨' },
  { value: 'other', emoji: '✨' },
];

const LOOKING_FOR: { value: LookingFor; label: string; emoji: string }[] = [
  { value: 'relationship', label: 'Namorar', emoji: '💚' },
  { value: 'casual', label: 'Algo casual', emoji: '🔥' },
  { value: 'friendship', label: 'Amizade', emoji: '🤝' },
  { value: 'network', label: 'Networking', emoji: '💼' },
];

// "Mostrar": quem aparece pra você (recíproco)
const SHOW_ME_OPTIONS: { value: ShowMe; emoji: string }[] = [
  { value: 'women', emoji: '👩' },
  { value: 'men', emoji: '👨' },
  { value: 'everyone', emoji: '🌈' },
];

/** orientação: null = ainda não escolheu (CTA vira "Pular"); 'none' = prefere não dizer (não manda nada) */
type OrientationPick = Orientation | 'none' | null;

const LAST_STEP = TOTAL_STEPS - 1;
const NAME_MAX = PROFILE_LIMITS.nameMax;
const BIO_MAX = PROFILE_LIMITS.bioMax;
const SLIDE_PX = 72;

type Props = NativeStackScreenProps<RootStackParamList, 'Register'>;
type AgeStatus = 'idle' | 'ok' | 'under' | 'invalid';

// ─────────────────────────────────────────────────────────────────────────────
// Tela
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ProfileSetup (rota Register): 10 etapas em 4 fases (profileSetupFlow) — Sobre você (nome, nascimento, gênero), O que
 * você procura ("quem ver", orientação opcional, intenção), Seu perfil (interesses, bio e Instagram, tudo pulável) e a
 * última (visibilidade + Termos). A barra mostra a fase, não "07/10", pra não cansar.
 * Fundo escuro com blobs vivos, transição horizontal entre etapas, chips animados e toggle Visível/Anônimo.
 * Cada etapa manda view/done pro funil (métricas próprias). Ao concluir chama register(); se o servidor recusar um
 * campo (filtro de abuso, @ fora da regra, 18+), volta pra etapa dele com a mensagem. Sucesso: o store marca
 * onboardingStep='avatar' e o RootNavigator segue pra AvatarSetup → PhotoUpload.
 */
export function ProfileSetupScreen({ route, navigation }: Props) {
  const { phone } = route.params;
  const register = useAuthStore((s) => s.register);
  const setAnonymous = useLocationStore((s) => s.setAnonymous);
  const focused = useIsFocused();

  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [birthDate, setBirthDate] = useState(''); // DD/MM/AAAA
  const [gender, setGender] = useState<Gender | null>(null);
  const [lookingFor, setLookingFor] = useState<LookingFor | null>(null);
  const [showMe, setShowMe] = useState<ShowMe | null>(null);
  const [orientation, setOrientation] = useState<OrientationPick>(null);
  const [showOrientation, setShowOrientation] = useState(false);
  const [sameOrientationFirst, setSameOrientationFirst] = useState(false);
  const [interests, setInterests] = useState<string[]>([]);
  const [bio, setBio] = useState('');
  const [instagram, setInstagram] = useState('');
  const [anonymous, setAnonymousLocal] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // campo recusado pelo servidor: mostra na etapa dele até a pessoa mexer no campo
  const [fieldError, setFieldError] = useState<StepError | null>(null);

  const parsedDate = parseDate(birthDate);
  const dateValid = Boolean(parsedDate && isAtLeast18(parsedDate));
  const age = parsedDate ? calculateAge(parsedDate) : null;
  const ageStatus: AgeStatus =
    birthDate.length < 10 ? 'idle' : !parsedDate ? 'invalid' : dateValid ? 'ok' : 'under';

  const current = SETUP_STEPS[step];
  const stepKey: StepKey = current.key;
  const progress = phaseProgress(step);
  // orientação escolhida de fato (não "prefiro não dizer"): só ela vai pro cadastro, junto com as duas chaves
  const pickedOrientation: Orientation | null = orientation && orientation !== 'none' ? orientation : null;
  const insta = checkInstagram(instagram);

  // catálogo de interesses (rota pública): busca um pouco antes da etapa, pra chegar pronto
  const interestsQuery = useQuery({
    queryKey: ['interests'],
    queryFn: async () => (await api.get<CatalogItem[]>('/interests')).data,
    staleTime: 60 * 60_000,
    enabled: step >= stepIndexOf('showMe'),
  });

  const clearFieldError = (k: StepKey) => setFieldError((cur) => (cur?.step === k ? null : cur));

  const canNext = ((): boolean => {
    switch (stepKey) {
      case 'name':
        return name.trim().length >= 2;
      case 'birth':
        return dateValid;
      case 'gender':
        return Boolean(gender);
      case 'showMe':
        return Boolean(showMe);
      case 'looking':
        return Boolean(lookingFor);
      case 'instagram':
        return insta.state !== 'invalid';
      case 'orientation':
      case 'interests':
      case 'bio':
        return true; // opcionais
      default:
        return termsAccepted;
    }
  })();

  // etapa opcional ainda vazia: o botão vira "Pular"
  const isEmptyOptional = ((): boolean => {
    switch (stepKey) {
      case 'orientation':
        return orientation === null;
      case 'interests':
        return interests.length === 0;
      case 'bio':
        return bio.trim().length === 0;
      case 'instagram':
        return insta.state === 'empty';
      default:
        return false;
    }
  })();

  // ── funil (métricas): etapa vista ao aparecer, concluída ao avançar/pular (o serviço conta 1x por abertura) ──
  useEffect(() => {
    trackOnboardingStep(SETUP_STEPS[step].track, 'view');
  }, [step]);
  const markDone = useCallback((k: StepKey) => {
    trackOnboardingStep(SETUP_STEPS[stepIndexOf(k)].track, 'done');
  }, []);

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
    // filtro de abuso (nome, bio, @) já aqui, com a mesma regra do servidor: avisa na etapa, não só no fim
    const blocked = precheckStep(stepKey, { name, bio, instagram });
    if (blocked) {
      setFieldError(blocked);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      return;
    }
    // colou o link do perfil: segue já com o @ limpo
    if (stepKey === 'instagram' && insta.state === 'ok' && insta.handle !== instagram) setInstagram(insta.handle);
    markDone(stepKey);
    goTo(step + 1);
  }, [bio, canNext, goTo, insta, instagram, markDone, name, step, stepKey]);

  const onFinish = useCallback(async () => {
    if (!parsedDate || !gender || !lookingFor || !termsAccepted || loading) return;
    setError(null);
    setFieldError(null);
    setLoading(true);
    try {
      await register(
        buildRegisterInput({
          phone,
          name,
          birthDate: toIsoDate(parsedDate),
          gender,
          showMe,
          orientation: pickedOrientation,
          showOrientation,
          sameOrientationFirst,
          lookingFor,
          interests,
          bio,
          instagram,
          anonymous,
          termsVersion: LEGAL_VERSION,
        }),
      );
      markDone('prefs');
      // sucesso → o store marca onboardingStep='avatar' e o RootNavigator vai pra AvatarSetup (depois PhotoUpload).
      setAnonymous(anonymous);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setLoading(false);
      // campo recusado (filtro de abuso, @ fora da regra, 18+): volta pra etapa dele com a mensagem do servidor
      const se = stepErrorOf(e);
      if (se) {
        setFieldError(se);
        goTo(stepIndexOf(se.step));
        return;
      }
      const err = toApiError(e);
      setError(
        err.status === 401 || err.status === 409
          ? 'Esse número já tem conta por aqui. Volta e faz login 😉'
          : !err.status
            ? 'Sem sinal com a gente agora. Confere sua internet e tenta de novo?'
            : `Deu ruim aqui do nosso lado (${err.message}). Tenta de novo?`,
      );
    }
  }, [
    anonymous,
    bio,
    gender,
    goTo,
    instagram,
    interests,
    loading,
    lookingFor,
    markDone,
    name,
    parsedDate,
    phone,
    pickedOrientation,
    register,
    sameOrientationFirst,
    setAnonymous,
    showMe,
    showOrientation,
    termsAccepted,
  ]);

  const isLast = step === LAST_STEP;
  const ctaLabel = isLast ? 'Bora te encontrar?' : isEmptyOptional ? 'Pular' : 'Continuar';
  const stepFieldError = fieldError?.step === stepKey ? fieldError.message : null;

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
        <KeyboardAvoidingView behavior="padding" style={styles.flex}>
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <PhaseBar step={step} />

            <Animated.View style={slideStyle}>
              <View style={styles.countRow}>
                <Text
                  style={styles.stepCount}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                  accessibilityLabel={`Etapa ${step + 1} de ${TOTAL_STEPS}: ${progress.label}`}
                >
                  {progress.counter}
                </Text>
                {current.optional ? (
                  <View style={styles.optionalPill}>
                    <Text style={styles.optionalText}>opcional</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.stepTitle} accessibilityRole="header">
                {current.title}
              </Text>
              <Text style={styles.stepHint}>{current.hint}</Text>

              {stepKey === 'name' ? (
                <>
                  <FocusInput
                    placeholder="Como você quer ser chamado(a)?"
                    value={name}
                    onChangeText={(t) => {
                      setName(t.slice(0, NAME_MAX));
                      clearFieldError('name');
                    }}
                    autoFocus
                    maxLength={NAME_MAX}
                    autoCapitalize="words"
                    autoCorrect={false}
                    returnKeyType="next"
                    onSubmitEditing={onNext}
                    counter={`${name.length}/${NAME_MAX}`}
                    invalid={Boolean(stepFieldError)}
                    accessibilityLabel="Seu nome"
                  />
                  <Reveal visible={name.trim().length >= 2 && !stepFieldError}>
                    <Text style={styles.preview}>Prazer, {name.trim()} 👋</Text>
                  </Reveal>
                </>
              ) : null}

              {stepKey === 'birth' ? (
                <>
                  <FocusInput
                    placeholder="DD/MM/AAAA"
                    value={birthDate}
                    onChangeText={(t) => {
                      setBirthDate(formatDate(t));
                      clearFieldError('birth');
                    }}
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

              {stepKey === 'gender' ? (
                <>
                  <View style={styles.chips} accessibilityRole="radiogroup">
                    {GENDERS.map((g, i) => (
                      <FadeInView
                        key={g.value}
                        delay={60 + i * 50}
                        fromY={10}
                        style={g.value === 'other' ? styles.chipWrapFull : styles.chipWrap}
                      >
                        <Chip label={GENDER_LABELS[g.value]} emoji={g.emoji} selected={gender === g.value} onPress={() => setGender(g.value)} />
                      </FadeInView>
                    ))}
                  </View>
                  <Reveal visible={gender === 'other'}>
                    <Text style={styles.stepNote}>Com "Outro", você aparece pra quem escolheu ver "Todos".</Text>
                  </Reveal>
                </>
              ) : null}

              {stepKey === 'showMe' ? (
                <>
                  <View style={styles.chips} accessibilityRole="radiogroup">
                    {SHOW_ME_OPTIONS.map((o, i) => (
                      <FadeInView key={o.value} delay={60 + i * 50} fromY={10} style={o.value === 'everyone' ? styles.chipWrapFull : styles.chipWrap}>
                        <Chip label={SHOW_ME_LABELS[o.value]} emoji={o.emoji} selected={showMe === o.value} onPress={() => setShowMe(o.value)} />
                      </FadeInView>
                    ))}
                  </View>
                  <Reveal visible={showMe !== null && showMe !== 'everyone'}>
                    <Text style={styles.stepNote}>Quem se identifica como "Outro" aparece em "Todos".</Text>
                  </Reveal>
                  {/* transparência: a escolha recíproca pode ser percebida (Política 3.3) */}
                  <Text style={styles.stepNote}>{SHOW_ME_RECIPROCAL_NOTE}</Text>
                </>
              ) : null}

              {stepKey === 'orientation' ? (
                <>
                  <View style={styles.chips} accessibilityRole="radiogroup">
                    {ORIENTATIONS.map((o, i) => (
                      <FadeInView key={o} delay={40 + i * 30} fromY={8} style={styles.chipWrap}>
                        <Chip
                          label={ORIENTATION_LABELS[o]}
                          selected={orientation === o}
                          // tocar de novo desmarca
                          onPress={() => setOrientation((cur) => (cur === o ? null : o))}
                        />
                      </FadeInView>
                    ))}
                    {/* largura cheia: "Prefiro não dizer" não cabe em meia coluna nos 360 dp */}
                    <FadeInView delay={40 + ORIENTATIONS.length * 30} fromY={8} style={styles.chipWrapFull}>
                      <Chip label="Prefiro não dizer" selected={orientation === 'none'} onPress={() => setOrientation((cur) => (cur === 'none' ? null : 'none'))} />
                    </FadeInView>
                  </View>
                  {pickedOrientation ? (
                    <FadeInView fromY={8} style={styles.orientationBlock}>
                      <View style={styles.consentBox} accessibilityRole="text">
                        <Ionicons name="lock-closed" size={18} color={colors.primary} />
                        <Text style={styles.consentText}>
                          É um dado sensível: a gente só guarda com o seu consentimento, e você apaga quando quiser em Editar perfil.
                          Por padrão ninguém vê.
                        </Text>
                      </View>
                      <DarkSwitchRow
                        label="Mostrar no meu perfil"
                        hint="Quem abrir seu perfil vê sua orientação."
                        value={showOrientation}
                        onChange={setShowOrientation}
                      />
                      <DarkSwitchRow
                        label="Ver primeiro quem tem a mesma orientação"
                        hint="Só muda a ordem, não esconde ninguém. Conta quem mostra a orientação no perfil."
                        value={sameOrientationFirst}
                        onChange={setSameOrientationFirst}
                      />
                    </FadeInView>
                  ) : null}
                </>
              ) : null}

              {stepKey === 'looking' ? (
                <View style={styles.chips} accessibilityRole="radiogroup">
                  {LOOKING_FOR.map((o, i) => (
                    <FadeInView key={o.value} delay={60 + i * 50} fromY={10} style={styles.chipWrap}>
                      <Chip label={o.label} emoji={o.emoji} selected={lookingFor === o.value} onPress={() => setLookingFor(o.value)} />
                    </FadeInView>
                  ))}
                </View>
              ) : null}

              {stepKey === 'interests' ? (
                <InterestPicker
                  items={interestsQuery.data}
                  selected={interests}
                  onChange={setInterests}
                  max={PROFILE_LIMITS.interestsMax}
                  loading={interestsQuery.isPending && interestsQuery.fetchStatus !== 'idle'}
                  error={interestsQuery.isError}
                  onRetry={() => interestsQuery.refetch()}
                />
              ) : null}

              {stepKey === 'bio' ? (
                <>
                  <FocusInput
                    placeholder="Ex.: samba no fim de semana, café coado e praia sempre que dá ☕🌊"
                    value={bio}
                    onChangeText={(t) => {
                      setBio(t.slice(0, BIO_MAX));
                      clearFieldError('bio');
                    }}
                    multiline
                    autoFocus
                    maxLength={BIO_MAX}
                    autoCapitalize="sentences"
                    invalid={Boolean(stepFieldError)}
                    accessibilityLabel="Sua bio"
                    accessibilityHint={`Opcional, até ${BIO_MAX} caracteres`}
                  />
                  <Text
                    style={[styles.bioCounter, bio.length >= BIO_MAX - 20 && styles.bioCounterWarn]}
                    accessibilityLabel={`${bio.length} de ${BIO_MAX} caracteres`}
                  >
                    {bio.length}/{BIO_MAX}
                  </Text>
                </>
              ) : null}

              {stepKey === 'instagram' ? (
                <>
                  <FocusInput
                    prefix="@"
                    placeholder="seu.perfil"
                    value={instagram}
                    onChangeText={(t) => {
                      setInstagram(t);
                      clearFieldError('instagram');
                    }}
                    // colou o link do perfil: vira só o @ ao sair do campo
                    onBlur={() => {
                      if (insta.state === 'ok' && insta.handle !== instagram) setInstagram(insta.handle);
                    }}
                    autoFocus
                    // cabe o link colado (instagram.com/fulano?...); o @ de verdade tem até 30
                    maxLength={100}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="off"
                    spellCheck={false}
                    keyboardType="default"
                    returnKeyType="done"
                    onSubmitEditing={onNext}
                    invalid={insta.state === 'invalid' || Boolean(stepFieldError)}
                    right={<InstaStatus check={insta} />}
                    accessibilityLabel="Seu @ do Instagram"
                    accessibilityHint="Opcional. Aparece no seu perfil pra todo mundo"
                  />
                  {!stepFieldError ? <InstaHint check={insta} /> : null}
                </>
              ) : null}

              {stepKey === 'prefs' ? (
                <FadeInView delay={80} fromY={10} style={styles.visibilityBlock}>
                  <VisibilityToggle anonymous={anonymous} onChange={setAnonymousLocal} />
                  <View style={{ height: spacing.lg }} />
                  <TermsCheck checked={termsAccepted} onChange={setTermsAccepted} onOpen={(slug) => navigation.navigate('Legal', { slug })} dark />
                </FadeInView>
              ) : null}

              {stepFieldError ? <ErrorBanner message={stepFieldError} /> : null}
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
              {/* "Pular" é vazado e sem halo: a ação principal continua sendo preencher */}
              <Glow color={colors.primary} spread={12} intensity={!isLast && isEmptyOptional ? 0 : 0.45} shape="pill" animated={isLast} style={styles.stretch}>
                <ScaleOnPress
                  onPress={isLast ? onFinish : onNext}
                  disabled={!canNext || loading}
                  glowColor={colors.primary}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !canNext || loading, busy: loading }}
                  accessibilityLabel={isLast ? 'Concluir cadastro' : ctaLabel === 'Pular' ? 'Pular essa etapa' : 'Continuar pra próxima etapa'}
                  style={[styles.cta, !isLast && isEmptyOptional ? styles.ctaSkip : {}]}
                >
                  {loading ? (
                    <ActivityIndicator color={colors.black} />
                  ) : (
                    <>
                      <Text style={[styles.ctaText, !isLast && isEmptyOptional ? styles.ctaSkipText : null]}>{ctaLabel}</Text>
                      <Ionicons
                        name={isLast ? 'sparkles' : isEmptyOptional ? 'play-skip-forward' : 'arrow-forward'}
                        size={20}
                        color={!isLast && isEmptyOptional ? colors.white : colors.black}
                      />
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
// Barra de progresso por fase (4 pedaços; cada um enche com spring)
// ─────────────────────────────────────────────────────────────────────────────

function PhaseBar({ step }: { step: number }) {
  const fills = phaseFill(step);
  return (
    <View
      style={styles.phaseBar}
      accessibilityRole="progressbar"
      accessibilityLabel={`Etapa ${step + 1} de ${TOTAL_STEPS}`}
      accessibilityValue={{ min: 0, max: TOTAL_STEPS, now: step + 1 }}
    >
      {PHASES.map((p, i) => (
        <PhaseSegment key={p.key} fill={fills[i]} />
      ))}
    </View>
  );
}

function PhaseSegment({ fill }: { fill: number }) {
  const [w, setW] = useState(0);
  const p = useSharedValue(fill);

  useEffect(() => {
    p.value = withSpring(fill, spring.soft);
  }, [fill, p]);

  const style = useAnimatedStyle(() => ({ width: w * Math.min(1, Math.max(0, p.value)) }));

  return (
    <View style={styles.progressTrack} onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}>
      <Animated.View style={[styles.progressFill, style]} />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Input com foco animado (borda + anel de glow); borda vermelha quando inválido
// ─────────────────────────────────────────────────────────────────────────────

interface FocusInputProps extends TextInputProps {
  counter?: string;
  mono?: boolean;
  /** texto fixo antes do campo (o "@" do Instagram) */
  prefix?: string;
  /** elemento à direita (ícone de status) */
  right?: React.ReactNode;
  /** borda vermelha (validação ao vivo / campo recusado) */
  invalid?: boolean;
}

function FocusInput({ counter, mono = false, prefix, right, invalid = false, multiline, onFocus, onBlur, style, ...rest }: FocusInputProps) {
  const focus = useSharedValue(0);
  const bad = useSharedValue(invalid ? 1 : 0);

  useEffect(() => {
    bad.value = withTiming(invalid ? 1 : 0, { duration: duration.fast });
  }, [bad, invalid]);

  const ring = useAnimatedStyle(() => ({
    opacity: 0.45 * focus.value * (1 - bad.value),
    transform: [{ scale: 1 + 0.008 * focus.value }],
  }));
  const box = useAnimatedStyle(() => ({
    borderColor: interpolateColor(
      bad.value,
      [0, 1],
      [interpolateColor(focus.value, [0, 1], ['rgba(250,250,250,0.16)', colors.primary]), colors.danger],
    ),
    shadowOpacity: 0.5 * focus.value * (1 - bad.value),
  }));

  return (
    <View style={styles.inputWrap}>
      <Animated.View pointerEvents="none" style={[styles.inputRing, ring]} />
      <Animated.View style={[styles.inputBox, multiline ? styles.inputBoxMultiline : null, box]}>
        {prefix ? (
          <Text style={styles.inputPrefix} importantForAccessibility="no" accessibilityElementsHidden>
            {prefix}
          </Text>
        ) : null}
        <TextInput
          {...rest}
          multiline={multiline}
          style={[
            styles.input,
            mono ? styles.inputMono : null,
            multiline ? styles.inputMultiline : null,
            prefix ? styles.inputWithPrefix : null,
            style,
          ]}
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
        {right}
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
// Instagram: ícone de status no campo + dica ao vivo embaixo
// ─────────────────────────────────────────────────────────────────────────────

function InstaStatus({ check }: { check: InstagramCheck }) {
  if (check.state === 'empty') return <Ionicons name="logo-instagram" size={20} color="rgba(250,250,250,0.35)" />;
  return (
    <FadeInView key={check.state} fromScale={0.6}>
      <Ionicons
        name={check.state === 'ok' ? 'checkmark-circle' : 'alert-circle'}
        size={22}
        color={check.state === 'ok' ? colors.primary : colors.danger}
      />
    </FadeInView>
  );
}

function InstaHint({ check }: { check: InstagramCheck }) {
  if (check.state === 'empty') return null;
  const ok = check.state === 'ok';
  return (
    <FadeInView key={ok ? 'ok' : 'bad'} fromY={6} style={styles.ageHint}>
      <Text style={[styles.ageHintText, { color: ok ? colors.primary : colors.danger }]} accessibilityLiveRegion="polite">
        {ok
          ? `Vai aparecer no seu perfil como @${check.handle}`
          : `Esse @ não rola no Instagram: só letras, números, ponto e _ (até ${INSTAGRAM_HANDLE_MAX}), sem ponto no começo ou no fim.`}
      </Text>
    </FadeInView>
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
        ? 'Ainda não rolou: o Metch é só pra maiores de 18.'
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
  /** sem emoji: chip só com o texto (orientação) */
  emoji?: string;
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
        {emoji ? <Text style={styles.chipEmoji}>{emoji}</Text> : null}
        {/* rótulos longos encolhem em vez de quebrar no meio da palavra (360 dp) */}
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
// Chave (Switch) no fundo escuro — texto quebra em telas estreitas (360 dp), a chave fica fixa à direita
// ─────────────────────────────────────────────────────────────────────────────

function DarkSwitchRow({ label, hint, value, onChange }: { label: string; hint: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.switchRow}>
      <View style={styles.switchText}>
        <Text style={styles.switchLabel}>{label}</Text>
        <Text style={styles.switchHint}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={(v) => {
          Haptics.selectionAsync().catch(() => {});
          onChange(v);
        }}
        trackColor={{ false: 'rgba(250,250,250,0.2)', true: colors.primary }}
        thumbColor={colors.white}
        ios_backgroundColor="rgba(250,250,250,0.2)"
        accessibilityRole="switch"
        accessibilityLabel={label}
        accessibilityHint={hint}
        accessibilityState={{ checked: value }}
      />
    </View>
  );
}

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
            ? 'Anônimo: você vê todo mundo, ninguém te vê. No grátis vale 24 h e dá pra religar no mapa quando quiser.'
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
// Estilos
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.black },
  safe: { flex: 1 },
  flex: { flex: 1 },
  stretch: { alignSelf: 'stretch' },
  content: { padding: spacing.xl, paddingTop: spacing.lg, flexGrow: 1 },

  // barra por fase: 4 pedaços lado a lado
  phaseBar: { flexDirection: 'row', gap: 6, marginBottom: spacing.xl },
  progressTrack: {
    flex: 1,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: 'rgba(250,250,250,0.12)',
    overflow: 'hidden',
  },
  progressFill: { height: 4, borderRadius: radius.full, backgroundColor: colors.primary },

  countRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  stepCount: { ...typography.mono, color: colors.primary, opacity: 0.9, flexShrink: 1 },
  optionalPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: 'rgba(250,250,250,0.25)',
  },
  optionalText: { ...typography.caption, color: 'rgba(250,250,250,0.7)' },
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
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    backgroundColor: 'rgba(250,250,250,0.06)',
    paddingRight: spacing.md,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 14,
  },
  inputBoxMultiline: { alignItems: 'flex-start' },
  input: { ...typography.h3, flex: 1, color: colors.white, padding: spacing.lg, minHeight: 60 },
  inputMono: { ...typography.mono, fontSize: 22, lineHeight: 28, letterSpacing: 2 },
  inputMultiline: { ...typography.bodyLarge, minHeight: 132, maxHeight: 220, textAlignVertical: 'top' },
  inputPrefix: { ...typography.h3, color: 'rgba(250,250,250,0.55)', paddingLeft: spacing.lg },
  inputWithPrefix: { paddingLeft: 2 },
  counter: { ...typography.caption, color: 'rgba(250,250,250,0.4)' },
  preview: { ...typography.h4, color: colors.primary, marginTop: spacing.md },
  bioCounter: { ...typography.caption, color: 'rgba(250,250,250,0.45)', textAlign: 'right', marginTop: spacing.sm },
  bioCounterWarn: { color: colors.warning },

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
  chipWrapFull: { flexGrow: 1, flexBasis: '100%' },
  stepNote: { ...typography.bodySmall, color: 'rgba(250,250,250,0.6)', marginTop: spacing.md },

  // orientação: aviso de consentimento + as duas chaves
  orientationBlock: { marginTop: spacing.lg, gap: spacing.sm },
  consentBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(127,255,0,0.35)',
    backgroundColor: 'rgba(127,255,0,0.08)',
  },
  consentText: { ...typography.bodySmall, color: colors.white, flex: 1 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 56,
  },
  switchText: { flex: 1, gap: 2 },
  switchLabel: { ...typography.label, color: colors.white },
  switchHint: { ...typography.caption, color: 'rgba(250,250,250,0.6)' },

  visibilityBlock: { marginTop: spacing.xxl },
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
  // "Pular": botão vazado (a ação principal continua sendo preencher)
  ctaSkip: { backgroundColor: 'rgba(250,250,250,0.08)', borderWidth: 1, borderColor: 'rgba(250,250,250,0.3)' },
  ctaText: { ...typography.h3, color: colors.black },
  ctaSkipText: { color: colors.white },
});
