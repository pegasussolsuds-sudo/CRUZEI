import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { BlurMask, Canvas, Group, Path, RoundedRect, Skia, vec } from '@shopify/react-native-skia';
import Animated, {
  Easing,
  cancelAnimation,
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { api, toApiError } from '../../services/api';
import { useAuthStore } from '../../stores/auth';
import { colors, fontFamily, radius, spacing, spring, typography } from '@cruzei/ui-mobile';
import { formatBRL } from '@cruzei/shared-utils';
import {
  AnimatedGradient,
  Confetti,
  FadeInView,
  Glow,
  Pulse,
  ScaleOnPress,
  SlideInView,
  StaggerText,
} from '../../components/animated';

// ─────────────────────────────────────────────────────────────────────────────
// Tipos / constantes (lógica preservada)
// ─────────────────────────────────────────────────────────────────────────────

interface Plan {
  id: string;
  tier: string;
  interval: string;
  priceCents: number;
  currency: string;
  trialDays?: number;
  savingsPercent?: number;
}

interface PremiumStatus {
  tier: 'free' | 'premium' | 'premium_plus';
  expiresAt?: string;
  daysRemaining: number;
}

const TIER_LABEL: Record<string, string> = { premium: 'Premium', premium_plus: 'Premium+' };
const INTERVAL_LABEL: Record<string, string> = { month: 'mês', quarter: 'trimestre', year: 'ano' };

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const PERKS: { icon: IoniconName; label: string; hint: string }[] = [
  { icon: 'eye-off-outline', label: 'Modo anônimo ilimitado', hint: 'Some do mapa quando quiser' },
  { icon: 'flash-outline', label: '1 boost grátis por semana', hint: 'Seu avatar cresce e brilha' },
  { icon: 'heart-outline', label: '5 super curtidas por dia', hint: 'Pra quem não dá pra deixar passar' },
  { icon: 'refresh-outline', label: 'Reverter última curtida', hint: 'Passou sem querer? Volta.' },
  { icon: 'navigate-outline', label: 'Lugares visitados (heat map)', hint: 'Onde você mais cruza gente' },
  { icon: 'star-outline', label: 'Selo verificado prioritário', hint: 'Fila VIP pra verificação' },
  { icon: 'color-palette-outline', label: 'Itens exclusivos de avatar', hint: 'Auras, cores neon e roupas só pra Premium' },
  { icon: 'locate-outline', label: 'Destaque no mapa', hint: 'Seu avatar aparece maior em áreas movimentadas' },
];

const GRADIENT_PREMIUM = [colors.secondary, colors.accent, colors.primary];
const CARD_BORDER_IDLE = '#33334D';
const CARD_BG_IDLE = 'rgba(26, 26, 46, 0.92)';
const CARD_BG_ACTIVE = 'rgba(30, 42, 26, 0.96)';

// ─────────────────────────────────────────────────────────────────────────────
// Coroa Skia com "sweep" de luz girando
// ─────────────────────────────────────────────────────────────────────────────

const CROWN_SIZE = 112;
// Coroa desenhada em um espaço 100x100 e escalada pro canvas.
const CROWN_SVG =
  'M12 66 L8 26 L32 46 L50 12 L68 46 L92 26 L88 66 Z ' + // corpo com 3 pontas
  'M12 72 H88 V84 H12 Z'; // base

function CrownSweep() {
  const angle = useSharedValue(0);
  const crownPath = useMemo(() => Skia.Path.MakeFromSVGString(CROWN_SVG), []);

  useEffect(() => {
    angle.value = withRepeat(withTiming(Math.PI * 2, { duration: 2600, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(angle);
  }, [angle]);

  const c = CROWN_SIZE / 2;
  const sweepTransform = useDerivedValue(() => [{ rotate: angle.value }]);
  const sweepTransform2 = useDerivedValue(() => [{ rotate: angle.value + Math.PI * 0.5 }]);
  const scale = CROWN_SIZE / 100;

  if (!crownPath) return null;

  return (
    <View accessible accessibilityRole="image" accessibilityLabel="Coroa Cruzei Premium">
      <Glow color={colors.accent} spread={18} intensity={0.75} shape="circle" cycleMs={2200}>
        <Canvas style={{ width: CROWN_SIZE, height: CROWN_SIZE }} pointerEvents="none">
          <Group transform={[{ scale }]}>
            {/* corpo dourado */}
            <Path path={crownPath} color={colors.accent} />
            {/* sombra interna sutil pra dar volume */}
            <Path path={crownPath} color="rgba(10,10,26,0.18)" style="stroke" strokeWidth={2} />
          </Group>
          {/* luz varrendo por dentro da coroa (clip no path) */}
          <Group clip={crownPath} transform={[{ scale }]}>
            <Group transform={sweepTransform} origin={vec(c / scale, c / scale)}>
              <RoundedRect
                x={c / scale - 4}
                y={c / scale - 90}
                width={8}
                height={180}
                r={4}
                color="rgba(250,250,250,0.85)"
              >
                <BlurMask blur={6} style="normal" />
              </RoundedRect>
            </Group>
            <Group transform={sweepTransform2} origin={vec(c / scale, c / scale)}>
              <RoundedRect
                x={c / scale - 2}
                y={c / scale - 90}
                width={4}
                height={180}
                r={2}
                color="rgba(255,20,147,0.55)"
              >
                <BlurMask blur={8} style="normal" />
              </RoundedRect>
            </Group>
          </Group>
        </Canvas>
      </Glow>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Card de plano com seleção animada
// ─────────────────────────────────────────────────────────────────────────────

interface PlanCardProps {
  plan: Plan;
  active: boolean;
  index: number;
  onSelect: (id: string) => void;
}

function PlanCard({ plan, active, index, onSelect }: PlanCardProps) {
  const sel = useSharedValue(active ? 1 : 0);
  const badge = useSharedValue(0);

  useEffect(() => {
    sel.value = withSpring(active ? 1 : 0, spring.snappy);
  }, [active, sel]);

  useEffect(() => {
    // "-44%" entra com bounce; re-bounce leve quando o card é selecionado
    badge.value = 0.6;
    badge.value = withDelay(
      active ? 0 : 260 + index * 90,
      withSequence(withSpring(1.22, spring.snappy), withSpring(1, spring.bouncy)),
    );
    return () => cancelAnimation(badge);
  }, [active, badge, index]);

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + 0.02 * sel.value }],
    borderColor: interpolateColor(sel.value, [0, 1], [CARD_BORDER_IDLE, colors.primary]),
    backgroundColor: interpolateColor(sel.value, [0, 1], [CARD_BG_IDLE, CARD_BG_ACTIVE]),
  }));
  const checkStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, sel.value)),
    transform: [{ scale: Math.max(0.01, sel.value) }, { rotate: `${(1 - sel.value) * -40}deg` }],
  }));
  const badgeStyle = useAnimatedStyle(() => ({ transform: [{ scale: badge.value }] }));

  const tier = TIER_LABEL[plan.tier] ?? plan.tier;
  const interval = INTERVAL_LABEL[plan.interval] ?? plan.interval;

  return (
    <SlideInView from="up" distance={20} delay={180 + index * 90} springPreset="soft">
      <ScaleOnPress
        onPress={() => onSelect(plan.id)}
        pressedScale={0.975}
        accessibilityRole="radio"
        accessibilityState={{ selected: active }}
        accessibilityLabel={`${tier}, ${formatBRL(plan.priceCents)} por ${interval}${plan.savingsPercent ? `, ${plan.savingsPercent}% de desconto` : ''}${plan.trialDays ? `, ${plan.trialDays} dias grátis` : ''}`}
      >
        <Animated.View style={[styles.planCard, cardStyle]}>
          <View style={styles.planHeader}>
            <Text style={styles.planTier}>{tier}</Text>
            {plan.savingsPercent ? (
              <Animated.View style={[styles.savings, badgeStyle]}>
                <Text style={styles.savingsText}>-{plan.savingsPercent}%</Text>
              </Animated.View>
            ) : null}
          </View>
          <View style={styles.priceRow}>
            <Text style={styles.planPrice}>{formatBRL(plan.priceCents)}</Text>
            <Text style={styles.planInterval}>/{interval}</Text>
          </View>
          {plan.trialDays ? (
            <Text style={styles.planTrial}>✨ {plan.trialDays} dias grátis pra testar</Text>
          ) : (
            <Text style={styles.planHint}>Cancela quando quiser</Text>
          )}
          <Animated.View style={[styles.check, checkStyle]} pointerEvents="none">
            <Ionicons name="checkmark-circle" size={26} color={colors.primary} />
          </Animated.View>
        </Animated.View>
      </ScaleOnPress>
    </SlideInView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CTA com gradiente animado
// ─────────────────────────────────────────────────────────────────────────────

interface PremiumCtaProps {
  title: string;
  onPress: () => void;
  loading: boolean;
  disabled: boolean;
}

function PremiumCta({ title, onPress, loading, disabled }: PremiumCtaProps) {
  const [w, setW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => {
    const next = Math.round(e.nativeEvent.layout.width);
    if (next !== w) setW(next);
  };
  const isOff = disabled || loading;

  return (
    <Glow color={colors.primary} spread={16} intensity={isOff ? 0.25 : 0.7} shape="pill" cycleMs={2000} style={styles.ctaGlow}>
      <ScaleOnPress
        onPress={onPress}
        disabled={isOff}
        pressedScale={0.97}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ disabled: isOff, busy: loading }}
        style={isOff ? [styles.cta, styles.ctaOff] : styles.cta}
        onLayout={onLayout}
      >
        {w > 0 ? <AnimatedGradient width={w} height={CTA_HEIGHT} colorsList={GRADIENT_PREMIUM} cycleMs={5000} paused={isOff} /> : null}
        {loading ? (
          <ActivityIndicator color={colors.black} />
        ) : (
          <View style={styles.ctaInner}>
            <Ionicons name="diamond" size={18} color={colors.black} />
            <Text style={styles.ctaText}>{title}</Text>
          </View>
        )}
      </ScaleOnPress>
    </Glow>
  );
}

const CTA_HEIGHT = 58;

// ─────────────────────────────────────────────────────────────────────────────
// Badge "você é Premium" animado
// ─────────────────────────────────────────────────────────────────────────────

interface ActiveBadgeProps {
  status: PremiumStatus;
  onCancel: () => void;
  cancelling: boolean;
}

function ActiveBadge({ status, onCancel, cancelling }: ActiveBadgeProps) {
  const shimmer = useSharedValue(0);
  useEffect(() => {
    shimmer.value = withRepeat(withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => cancelAnimation(shimmer);
  }, [shimmer]);

  const borderStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(shimmer.value, [0, 1], [colors.accent, colors.primary]),
  }));

  const tier = TIER_LABEL[status.tier] ?? status.tier;

  return (
    <SlideInView from="up" distance={18} delay={120} springPreset="bouncy">
      <Animated.View style={[styles.activeBox, borderStyle]} accessible accessibilityLabel={`Você é ${tier}. ${status.daysRemaining} dias restantes.`}>
        <Glow color={colors.accent} spread={10} intensity={0.8} shape="circle" cycleMs={1800}>
          <Pulse maxScale={1.12} cycleMs={1800}>
            <View style={styles.activeIcon}>
              <Ionicons name="diamond" size={22} color={colors.black} />
            </View>
          </Pulse>
        </Glow>
        <View style={{ flex: 1 }}>
          <Text style={styles.activeTitle}>Você é {tier} 💚</Text>
          <Text style={styles.activeSub}>
            {status.daysRemaining} {status.daysRemaining === 1 ? 'dia restante' : 'dias restantes'} · aproveita
          </Text>
        </View>
        <Pressable
          onPress={onCancel}
          disabled={cancelling}
          hitSlop={8}
          style={styles.cancelBtn}
          accessibilityRole="button"
          accessibilityLabel="Cancelar assinatura"
          accessibilityState={{ disabled: cancelling }}
        >
          {cancelling ? <ActivityIndicator color={colors.gray[400]} size="small" /> : <Text style={styles.cancelText}>Cancelar</Text>}
        </Pressable>
      </Animated.View>
    </SlideInView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tela
// ─────────────────────────────────────────────────────────────────────────────

export function PaywallScreen() {
  const qc = useQueryClient();
  const refreshMe = useAuthStore((s) => s.refreshMe);
  const [selected, setSelected] = useState<string | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const { width, height } = useWindowDimensions();

  const plansQuery = useQuery({
    queryKey: ['plans'],
    queryFn: async () => (await api.get<{ plans: Plan[] }>('/premium/plans')).data.plans,
  });
  const statusQuery = useQuery({
    queryKey: ['premium-status'],
    queryFn: async () => (await api.get<PremiumStatus>('/premium/status')).data,
  });

  const subscribe = useMutation({
    // Em produção o pagamento passa pela loja (Google Play Billing / StoreKit) e o
    // backend valida o recibo. Aqui o backend aceita direto em modo dev.
    mutationFn: async (planId: string) =>
      (await api.post('/premium/subscribe', { planId, platform: 'android', receipt: 'dev' })).data,
    onSuccess: async () => {
      setCelebrate(true);
      await qc.invalidateQueries({ queryKey: ['premium-status'] });
      await qc.invalidateQueries({ queryKey: ['me'] });
      refreshMe().catch(() => {});
      Alert.alert('Bem-vindo(a) ao Premium 💚', 'Modo anônimo ilimitado e super curtidas liberados.');
    },
    onError: (err) => Alert.alert('Não rolou', toApiError(err).message),
  });

  const cancel = useMutation({
    mutationFn: async () => (await api.post('/premium/cancel')).data,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['premium-status'] });
      await qc.invalidateQueries({ queryKey: ['me'] });
      refreshMe().catch(() => {});
    },
    onError: (err) => Alert.alert('Ops', toApiError(err).message),
  });

  const plans = plansQuery.data ?? [];
  const status = statusQuery.data;
  const isPremium = status && status.tier !== 'free';
  const chosen = plans.find((p) => p.id === selected) ?? plans[0];

  const onStart = () => {
    if (!chosen) return;
    Alert.alert(
      `${TIER_LABEL[chosen.tier] ?? chosen.tier} — ${formatBRL(chosen.priceCents)}/${INTERVAL_LABEL[chosen.interval] ?? chosen.interval}`,
      chosen.trialDays ? `${chosen.trialDays} dias grátis, depois renova automaticamente. Cancela quando quiser.` : 'Renova automaticamente. Cancela quando quiser.',
      [
        { text: 'Agora não', style: 'cancel' },
        { text: 'Assinar', onPress: () => subscribe.mutate(chosen.id) },
      ],
    );
  };

  return (
    <View style={styles.root}>
      {/* fundo vivo: gradiente lento magenta → dourado → lima, sob um véu escuro */}
      <AnimatedGradient width={width} height={height} colorsList={GRADIENT_PREMIUM} cycleMs={16000} />
      <View style={styles.veil} pointerEvents="none" />

      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* hero */}
          <View style={styles.hero}>
            <FadeInView fromScale={0.6} durationMs={420}>
              <CrownSweep />
            </FadeInView>
            <FadeInView delay={200} fromY={6}>
              <Text style={styles.eyebrow}>cruzei premium</Text>
            </FadeInView>
            <StaggerText
              text="mais conexões, menos espera"
              by="word"
              stagger={110}
              delay={320}
              fromY={14}
              style={styles.title}
              containerStyle={styles.titleWrap}
            />
            <FadeInView delay={820} fromY={10}>
              <Text style={styles.subtitle}>
                Fica invisível quando quiser, turbina sua presença e vê quem curtiu você antes de você curtir de volta.
              </Text>
            </FadeInView>
          </View>

          {isPremium && status ? (
            <ActiveBadge status={status} onCancel={() => cancel.mutate()} cancelling={cancel.isPending} />
          ) : null}

          {/* benefícios, um por um */}
          <View style={styles.perksList} accessibilityRole="list">
            {PERKS.map((p, i) => (
              <FadeInView key={p.label} delay={900 + i * 90} fromX={-18} durationMs={260} style={styles.perk}>
                <Pulse maxScale={1.1} cycleMs={2000 + i * 140}>
                  <View style={styles.perkIcon}>
                    <Ionicons name={p.icon} size={20} color={colors.primary} />
                  </View>
                </Pulse>
                <View style={{ flex: 1 }}>
                  <Text style={styles.perkText}>{p.label}</Text>
                  <Text style={styles.perkHint}>{p.hint}</Text>
                </View>
              </FadeInView>
            ))}
          </View>

          {/* planos */}
          {plansQuery.isLoading ? (
            <ActivityIndicator color={colors.primary} size="large" style={{ marginVertical: spacing.xl }} />
          ) : plans.length > 0 ? (
            <View style={styles.plans} accessibilityRole="radiogroup">
              <FadeInView delay={160} fromY={6}>
                <Text style={styles.plansLabel}>{isPremium ? 'seu plano' : 'escolhe o seu'}</Text>
              </FadeInView>
              {plans.map((plan, i) => (
                <PlanCard key={plan.id} plan={plan} index={i} active={chosen?.id === plan.id} onSelect={setSelected} />
              ))}
            </View>
          ) : plansQuery.isError ? (
            <FadeInView style={styles.errorBox}>
              <Text style={styles.errorText}>Não consegui carregar os planos. Puxa pra tentar de novo.</Text>
              <Pressable onPress={() => plansQuery.refetch()} style={styles.retry} accessibilityRole="button" accessibilityLabel="Tentar de novo">
                <Text style={styles.retryText}>Tentar de novo</Text>
              </Pressable>
            </FadeInView>
          ) : null}

          <View style={{ height: spacing.xl }} />

          {!isPremium ? (
            <FadeInView delay={600} fromY={16} durationMs={320}>
              <PremiumCta title="Virar Premium" onPress={onStart} loading={subscribe.isPending} disabled={!chosen} />
              {chosen ? (
                <Text style={styles.ctaHint}>
                  {chosen.trialDays
                    ? `${chosen.trialDays} dias grátis, depois ${formatBRL(chosen.priceCents)}/${INTERVAL_LABEL[chosen.interval] ?? chosen.interval}`
                    : `${formatBRL(chosen.priceCents)}/${INTERVAL_LABEL[chosen.interval] ?? chosen.interval} · sem fidelidade`}
                </Text>
              ) : null}
            </FadeInView>
          ) : null}

          <Text style={styles.disclaimer}>
            Cancela quando quiser, sem fidelidade. Renova automaticamente. Pagamento pela loja (Google Play / App Store).
          </Text>
        </ScrollView>
      </SafeAreaView>

      <Confetti active={celebrate} onDone={() => setCelebrate(false)} origin={{ x: 0.5, y: 0.3 }} />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Estilos
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.black },
  veil: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(10, 10, 26, 0.84)' },
  safe: { flex: 1 },
  scroll: { padding: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.xxxl },

  hero: { alignItems: 'center' },
  eyebrow: { ...typography.label, color: colors.accent, textAlign: 'center', letterSpacing: 2.5, marginTop: spacing.lg, textTransform: 'uppercase', fontSize: 12 },
  titleWrap: { justifyContent: 'center', marginTop: spacing.sm, paddingHorizontal: spacing.sm },
  title: { ...typography.display, fontSize: 36, lineHeight: 42, color: colors.white, textAlign: 'center' },
  subtitle: { ...typography.body, color: colors.gray[400], textAlign: 'center', marginTop: spacing.md, paddingHorizontal: spacing.sm },

  activeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: 'rgba(26, 26, 46, 0.92)',
    borderRadius: radius.lg,
    padding: spacing.md,
    marginTop: spacing.xl,
    borderWidth: 1.5,
    borderColor: colors.accent,
  },
  activeIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  activeTitle: { ...typography.h4, fontFamily: fontFamily.display, color: colors.white },
  activeSub: { ...typography.bodySmall, color: colors.gray[400], marginTop: 2 },
  cancelBtn: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm },
  cancelText: { ...typography.label, color: colors.gray[400] },

  perksList: { marginTop: spacing.xl, gap: spacing.xs },
  perk: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  perkIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(127, 255, 0, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(127, 255, 0, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  perkText: { ...typography.body, fontFamily: fontFamily.bodySemiBold, color: colors.white },
  perkHint: { ...typography.bodySmall, color: colors.gray[500], marginTop: 1 },

  plans: { marginTop: spacing.xl, gap: spacing.md },
  plansLabel: { ...typography.label, color: colors.gray[500], letterSpacing: 2, textTransform: 'uppercase', fontSize: 12, marginBottom: spacing.xs },
  planCard: {
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    minHeight: 44,
  },
  planHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  planTier: { ...typography.h4, fontFamily: fontFamily.display, color: colors.white },
  savings: { backgroundColor: colors.accent, paddingHorizontal: spacing.sm + 2, paddingVertical: 3, borderRadius: radius.full },
  savingsText: { ...typography.bodySmall, fontFamily: fontFamily.bodyBold, color: colors.black },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 2, marginTop: spacing.sm },
  planPrice: { ...typography.h2, color: colors.primary },
  planInterval: { ...typography.body, color: colors.gray[400] },
  planTrial: { ...typography.bodySmall, color: colors.success, marginTop: spacing.xs },
  planHint: { ...typography.bodySmall, color: colors.gray[500], marginTop: spacing.xs },
  check: { position: 'absolute', right: spacing.lg, bottom: spacing.lg },

  ctaGlow: { alignSelf: 'stretch' },
  cta: {
    height: CTA_HEIGHT,
    borderRadius: radius.full,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  ctaOff: { opacity: 0.55 },
  ctaInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  ctaText: { fontFamily: fontFamily.display, fontSize: 18, lineHeight: 22, color: colors.black, letterSpacing: -0.2 },
  ctaHint: { ...typography.bodySmall, color: colors.gray[400], textAlign: 'center', marginTop: spacing.md },

  errorBox: { marginTop: spacing.xl, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: 'rgba(26, 26, 46, 0.92)', alignItems: 'center', gap: spacing.md },
  errorText: { ...typography.body, color: colors.gray[400], textAlign: 'center' },
  retry: { minHeight: 44, paddingHorizontal: spacing.lg, justifyContent: 'center', borderRadius: radius.full, borderWidth: 1, borderColor: colors.primary },
  retryText: { ...typography.label, color: colors.primary },

  disclaimer: { ...typography.bodySmall, color: colors.gray[500], textAlign: 'center', marginTop: spacing.lg, paddingHorizontal: spacing.lg },
});
