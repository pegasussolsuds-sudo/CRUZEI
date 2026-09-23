import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

import { api, toApiError } from '../../services/api';
import { useAuthStore } from '../../stores/auth';
import { Button } from '@cruzei/ui-mobile';
import { colors, radius, spacing, typography } from '@cruzei/ui-mobile';
import { formatBRL } from '@cruzei/shared-utils';

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

const PERKS = [
  { icon: 'eye-off-outline', label: 'Modo anônimo ilimitado' },
  { icon: 'flash-outline', label: '1 boost grátis por semana' },
  { icon: 'heart-outline', label: '5 super curtidas por dia' },
  { icon: 'refresh-outline', label: 'Reverter última curtida' },
  { icon: 'navigate-outline', label: 'Lugares visitados (heat map)' },
  { icon: 'star-outline', label: 'Selo verificado prioritário' },
];

export function PaywallScreen() {
  const qc = useQueryClient();
  const refreshMe = useAuthStore((s) => s.refreshMe);
  const [selected, setSelected] = useState<string | null>(null);

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
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.xxl }}>
        <Text style={styles.eyebrow}>cruzei premium</Text>
        <Text style={styles.title}>mais conexões,{'\n'}menos espera</Text>
        <Text style={styles.subtitle}>
          Fica invisível quando quiser, turbina sua presença e vê quem curtiu você antes de você curtir de volta.
        </Text>

        {isPremium ? (
          <View style={styles.activeBox}>
            <Ionicons name="diamond" size={20} color={colors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={styles.activeTitle}>Você é {TIER_LABEL[status.tier] ?? status.tier}</Text>
              <Text style={styles.activeSub}>{status.daysRemaining} dias restantes</Text>
            </View>
            <Pressable onPress={() => cancel.mutate()} disabled={cancel.isPending}>
              <Text style={styles.cancelText}>Cancelar</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.perksList}>
          {PERKS.map((p) => (
            <View key={p.label} style={styles.perk}>
              <Ionicons name={p.icon as never} size={22} color={colors.primary} />
              <Text style={styles.perkText}>{p.label}</Text>
            </View>
          ))}
        </View>

        {plansQuery.isLoading ? (
          <ActivityIndicator color={colors.primary} size="large" style={{ marginVertical: spacing.xl }} />
        ) : (
          <View style={styles.plans}>
            {plans.map((plan) => {
              const active = chosen?.id === plan.id;
              return (
                <Pressable key={plan.id} onPress={() => setSelected(plan.id)} style={[styles.planCard, active && styles.planCardActive]}>
                  <View style={styles.planHeader}>
                    <Text style={styles.planTier}>{TIER_LABEL[plan.tier] ?? plan.tier}</Text>
                    {plan.savingsPercent ? (
                      <View style={styles.savings}>
                        <Text style={styles.savingsText}>-{plan.savingsPercent}%</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.planPrice}>{formatBRL(plan.priceCents)}</Text>
                  <Text style={styles.planInterval}>por {INTERVAL_LABEL[plan.interval] ?? plan.interval}</Text>
                  {plan.trialDays ? <Text style={styles.planTrial}>{plan.trialDays} dias grátis</Text> : null}
                  {active ? <Ionicons name="checkmark-circle" size={22} color={colors.primary} style={styles.check} /> : null}
                </Pressable>
              );
            })}
          </View>
        )}

        <View style={{ height: spacing.xl }} />
        {!isPremium ? (
          <Button title="Começar agora" variant="primary" size="lg" fullWidth onPress={onStart} loading={subscribe.isPending} disabled={!chosen} />
        ) : null}

        <Text style={styles.disclaimer}>
          Cancela quando quiser, sem fidelidade. Renova automaticamente. Pagamento pela loja (Google Play / App Store).
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.black },
  eyebrow: { ...typography.label, color: colors.primary, textAlign: 'center', letterSpacing: 2 },
  title: { ...typography.display, color: colors.white, textAlign: 'center', marginTop: spacing.sm },
  subtitle: { ...typography.body, color: colors.gray[400], textAlign: 'center', marginTop: spacing.md },
  activeBox: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: '#1A1A2E', borderRadius: radius.lg, padding: spacing.md, marginTop: spacing.lg, borderWidth: 1, borderColor: colors.accent },
  activeTitle: { ...typography.h4, color: colors.white },
  activeSub: { ...typography.bodySmall, color: colors.gray[400] },
  cancelText: { ...typography.label, color: colors.gray[400] },
  perksList: { marginTop: spacing.xl, gap: spacing.sm },
  perk: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xs },
  perkText: { ...typography.body, color: colors.white },
  plans: { marginTop: spacing.xl, gap: spacing.md },
  planCard: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: '#1A1A2E', borderWidth: 1, borderColor: '#33334D' },
  planCardActive: { borderColor: colors.primary, backgroundColor: '#1E2A1A' },
  planHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  planTier: { ...typography.h4, color: colors.white },
  savings: { backgroundColor: colors.accent, paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.full },
  savingsText: { ...typography.bodySmall, color: colors.black, fontWeight: '800' },
  planPrice: { ...typography.h2, color: colors.primary, marginTop: spacing.sm },
  planInterval: { ...typography.body, color: colors.gray[400] },
  planTrial: { ...typography.bodySmall, color: colors.success, marginTop: spacing.xs },
  check: { position: 'absolute', right: spacing.lg, bottom: spacing.lg },
  disclaimer: { ...typography.bodySmall, color: colors.gray[500], textAlign: 'center', marginTop: spacing.lg, paddingHorizontal: spacing.lg },
});
