import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';

import { colors, fontFamily, radius, spacing, typography } from '@cruzei/ui-mobile';
import { maskPhoneBR } from '@cruzei/shared-utils';
import { BlobBackground, FadeInView, Glow, ScaleOnPress } from '../../components/animated';
import { useAuthStore } from '../../stores/auth';
import { toApiError } from '../../services/api';
import { longDateBR } from '../../services/accountPrivacy';
import type { RootStackParamList } from '../../navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList, 'RestoreAccount'>;
type Route = RouteProp<RootStackParamList, 'RestoreAccount'>;

/** tempo do "Que bom te ver de volta!" antes de entrar */
const WELCOME_HOLD_MS = 1100;

/**
 * RestoreAccountScreen (rota "RestoreAccount"): o SMS confirmou, mas a conta tem exclusão pedida dentro do prazo. Nada
 * de sessão até a pessoa escolher:
 * - Cancelar exclusão → POST /auth/deletion/cancel → "Que bom te ver de volta!" e entra com tudo como estava.
 * - Manter exclusão → volta pro começo; a conta segue marcada e some de vez na data.
 * - Desafio vencido (10 min) ou já usado → pede outro código.
 */
export function RestoreAccountScreen() {
  const nav = useNavigation<Nav>();
  const { params } = useRoute<Route>();
  const focused = useIsFocused();
  const { cancelDeletion, commitAuth } = useAuthStore();
  const { phone, pending } = params;

  const [busy, setBusy] = useState(false);
  const [restored, setRestored] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCommit = useRef(false);

  useEffect(
    () => () => {
      if (holdRef.current) clearTimeout(holdRef.current);
      // saiu da tela antes do "bem-vindo" acabar: não deixa a sessão pendurada
      if (pendingCommit.current) useAuthStore.getState().commitAuth();
    },
    [],
  );

  const until = longDateBR(pending.scheduledFor);

  const backToLogin = useCallback(() => {
    Alert.alert('Essa confirmação venceu', 'Pede outro código pra entrar de novo.', [
      { text: 'Ok', onPress: () => nav.replace('Login') },
    ]);
  }, [nav]);

  const onRestore = useCallback(async () => {
    if (busy || restored) return;
    setBusy(true);
    setMessage(null);
    try {
      await cancelDeletion(pending.challengeId, { deferAuth: true });
      pendingCommit.current = true;
      setRestored(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      holdRef.current = setTimeout(() => {
        pendingCommit.current = false;
        commitAuth();
      }, WELCOME_HOLD_MS);
    } catch (e) {
      const err = toApiError(e);
      if (err.status === 401) backToLogin();
      // 403 (banida/suspensa): a tela de bloqueio assume pelo interceptor
      else if (err.status !== 403) {
        setMessage(err.status ? err.message : 'Sem conexão agora. Tenta de novo?');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      }
    } finally {
      setBusy(false);
    }
  }, [busy, restored, cancelDeletion, pending.challengeId, commitAuth, backToLogin]);

  const onKeep = useCallback(() => {
    Alert.alert(
      'Manter a exclusão?',
      `Tudo bem. A conta continua marcada e some de vez em ${until}. Até lá dá pra mudar de ideia entrando de novo.`,
      [
        { text: 'Voltar', style: 'cancel' },
        { text: 'Manter exclusão', style: 'destructive', onPress: () => nav.reset({ index: 0, routes: [{ name: 'Onboarding' }] }) },
      ],
    );
  }, [nav, until]);

  return (
    <View style={styles.root}>
      <BlobBackground intensity={0.22} paused={!focused} />
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} bounces={false}>
          <View style={styles.topBar}>
            {!busy && !restored ? (
              <Pressable
                onPress={() => nav.replace('Login')}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Voltar e trocar número"
                style={styles.back}
              >
                <Ionicons name="chevron-back" size={26} color={colors.white} />
              </Pressable>
            ) : (
              <View style={styles.back} />
            )}
          </View>

          {restored ? (
            <View style={[styles.content, styles.center]}>
              <FadeInView fromScale={0.8}>
                <View style={styles.okIcon}>
                  <Ionicons name="heart" size={34} color={colors.primary} />
                </View>
              </FadeInView>
              <FadeInView delay={120} fromY={10}>
                <Text style={[styles.title, styles.textCenter]} accessibilityRole="header">
                  Que bom te ver de volta!
                </Text>
                <Text style={[styles.subtitle, styles.textCenter]}>A exclusão foi cancelada. Tá tudo como você deixou.</Text>
              </FadeInView>
            </View>
          ) : (
            <View style={styles.content}>
              <FadeInView delay={60} fromY={12}>
                <Text style={styles.eyebrow}>{maskPhoneBR(phone)}</Text>
                <Text style={styles.title} accessibilityRole="header">
                  Tua conta tá marcada pra exclusão
                </Text>
                <Text style={styles.subtitle}>
                  Ela some de vez em {until}. Até lá dá pra cancelar e voltar com tudo: perfil, fotos, conversas e curtidas.
                </Text>
              </FadeInView>

              <FadeInView delay={180} fromY={14} fromScale={0.97}>
                <View style={styles.card}>
                  <View style={styles.cardIcon}>
                    <Ionicons name="time-outline" size={22} color={colors.accent} />
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.cardTitle}>Exclusão pedida em {longDateBR(pending.requestedAt)}</Text>
                    <Text style={styles.cardMeta}>Apaga de vez em {until}</Text>
                  </View>
                </View>
              </FadeInView>

              {message ? (
                <View style={styles.messageRow} accessibilityLiveRegion="polite">
                  <Ionicons name="alert-circle" size={16} color={colors.danger} />
                  <Text style={styles.messageText}>{message}</Text>
                </View>
              ) : null}

              <View style={styles.spacer} />

              <FadeInView delay={300} fromY={16} style={styles.actions}>
                <Glow color={colors.primary} spread={12} intensity={0.4} shape="pill" style={styles.stretch}>
                  <ScaleOnPress
                    onPress={() => void onRestore()}
                    disabled={busy}
                    glowColor={colors.primary}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: busy, busy }}
                    accessibilityLabel="Cancelar exclusão e voltar"
                    style={styles.cta}
                  >
                    {busy ? (
                      <ActivityIndicator color={colors.black} />
                    ) : (
                      <>
                        <Text style={styles.ctaText}>Cancelar exclusão e voltar</Text>
                        <Ionicons name="arrow-forward" size={20} color={colors.black} />
                      </>
                    )}
                  </ScaleOnPress>
                </Glow>
                <ScaleOnPress
                  onPress={onKeep}
                  disabled={busy}
                  haptic={false}
                  accessibilityRole="button"
                  accessibilityLabel="Manter a exclusão"
                  style={styles.outline}
                >
                  <Text style={styles.outlineText}>Manter exclusão</Text>
                </ScaleOnPress>
                <Text style={styles.footnote}>
                  Pra criar uma conta nova com esse número, espera a exclusão terminar.
                </Text>
              </FadeInView>
            </View>
          )}
        </ScrollView>
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
  center: { alignItems: 'center', justifyContent: 'center' },
  textCenter: { textAlign: 'center' },
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
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: 'rgba(255,215,0,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { ...typography.label, color: colors.white },
  cardMeta: { ...typography.bodySmall, color: 'rgba(250,250,250,0.6)', marginTop: 2 },
  messageRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs, marginTop: spacing.lg },
  messageText: { ...typography.body, color: colors.danger, flex: 1 },
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
  okIcon: {
    width: 76,
    height: 76,
    borderRadius: radius.full,
    backgroundColor: 'rgba(127,255,0,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(127,255,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
});
