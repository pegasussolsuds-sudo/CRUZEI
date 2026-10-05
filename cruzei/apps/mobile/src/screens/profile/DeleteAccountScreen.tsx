import React, { useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import {
  ACCOUNT_DELETION_CONFIRM,
  DELETION_REASONS,
  DELETION_REASON_LABELS,
  type DeletionReason,
} from '@cruzei/shared-types';
import { Button, colors, fontFamily, radius, spacing, typography } from '@cruzei/ui-mobile';

import { toApiError } from '../../services/api';
import { confirmMatches, getDeletionPreview, longDateBR } from '../../services/privacy';
import { useAuthStore } from '../../stores/auth';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { Bullets, Notice, Section, ui } from './privacyUi';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** onde a pessoa cancela a assinatura (excluir a conta não cancela na loja) */
const STORE_SUBSCRIPTIONS: Record<string, { label: string; url: string }> = {
  android: { label: 'Google Play', url: 'https://play.google.com/store/account/subscriptions' },
  ios: { label: 'App Store', url: 'https://apps.apple.com/account/subscriptions' },
};

/**
 * Excluir conta (Apple 5.1.1(v), Google Play, LGPD art. 18 VI): prévia do servidor (prazo, assinatura ativa, conta da
 * equipe), motivo opcional e EXCLUIR digitado. Depois do 202 o store encerra a sessão local e o app volta pro começo.
 */
export function DeleteAccountScreen() {
  const nav = useNavigation<Nav>();
  const deleteAccount = useAuthStore((s) => s.deleteAccount);
  const [reason, setReason] = useState<DeletionReason | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useQuery({ queryKey: ['me-deletion'], queryFn: getDeletionPreview, staleTime: 0 });
  const p = preview.data;
  const graceDays = p?.graceDays ?? 30;
  const ok = confirmMatches(typed, ACCOUNT_DELETION_CONFIRM);

  const submit = async () => {
    if (!ok || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await deleteAccount({ confirm: ACCOUNT_DELETION_CONFIRM, ...(reason ? { reason } : {}) });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      // a sessão já caiu (o app volta pro começo); o aviso fica por cima
      Alert.alert(
        'Conta marcada pra exclusão',
        `Ela já sumiu pra todo mundo e apaga de vez em ${longDateBR(r.scheduledFor)}. Mudou de ideia? É só entrar de novo com o seu número até lá.`,
      );
    } catch (e) {
      const err = toApiError(e);
      setError(err.status ? err.message : 'Sem conexão agora. Tenta de novo?');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setBusy(false);
    }
  };

  if (preview.isPending) {
    return (
      <SafeAreaView style={[ui.safe, styles.center]} edges={['bottom']}>
        <ActivityIndicator color={colors.primary} size="large" />
      </SafeAreaView>
    );
  }

  if (preview.isError) {
    return (
      <SafeAreaView style={[ui.safe, styles.center]} edges={['bottom']}>
        <Text style={[ui.body, styles.textCenter]}>{toApiError(preview.error).message}</Text>
        <Button title="Tentar de novo" onPress={() => void preview.refetch()} loading={preview.isFetching} />
      </SafeAreaView>
    );
  }

  if (p?.staff) {
    return (
      <SafeAreaView style={ui.safe} edges={['bottom']}>
        <ScrollView contentContainerStyle={ui.content}>
          <Notice icon="shield-half-outline">
            Conta da equipe (moderação ou administração) não se exclui pelo app. Peça pra um admin tirar o seu papel no painel
            e depois volte aqui.
          </Notice>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const store = p?.activeSubscription ? STORE_SUBSCRIPTIONS[p.activeSubscription.platform] : undefined;

  return (
    <SafeAreaView style={ui.safe} edges={['bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={ui.flex}>
        <ScrollView contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled">
          <Text style={ui.lead}>Que pena te ver indo. Antes, dá uma olhada no que acontece:</Text>

          <Section title="o que acontece" />
          <View style={ui.card}>
            <Bullets
              items={[
                'Na hora, sua conta some do mapa, das curtidas e das conversas da outra pessoa, e você sai do app.',
                `Você tem ${graceDays} dias pra voltar atrás: é só entrar de novo com o seu número e cancelar.`,
                `Depois disso (em ${p ? longDateBR(p.wouldCompleteAt) : `${graceDays} dias`}), perfil, fotos, conversas e curtidas são apagados de vez.`,
                'Fica só o que a lei ou a segurança exigem, pelo tempo certo (pagamentos, registros de acesso, denúncias).',
              ]}
            />
            <Pressable onPress={() => nav.navigate('Legal', { slug: 'excluir-conta' })} accessibilityRole="link">
              <Text style={ui.link}>Ver tudo o que é apagado e o que fica</Text>
            </Pressable>
          </View>

          {p?.activeSubscription ? (
            <Notice icon="card-outline">
              Sua assinatura{store ? ` (${store.label})` : ''} vale até {longDateBR(p.activeSubscription.expiresAt)} e NÃO é cancelada
              aqui. Pra não ser cobrado de novo, cancele na loja.
            </Notice>
          ) : null}
          {store ? (
            <Pressable onPress={() => void Linking.openURL(store.url)} accessibilityRole="link">
              <Text style={ui.link}>Abrir assinaturas na {store.label}</Text>
            </Pressable>
          ) : null}

          <Section title="quer só dar um tempo?" />
          <View style={ui.card}>
            <Text style={ui.body}>
              Dá pra pausar o perfil ou ficar invisível no Perfil, sem perder nada. E se quiser, baixe uma cópia dos seus dados
              antes.
            </Text>
            <Pressable onPress={() => nav.navigate('DataExport')} accessibilityRole="link">
              <Text style={ui.link}>Baixar meus dados</Text>
            </Pressable>
          </View>

          <Section title="por que você tá saindo? (opcional)" />
          <View style={styles.chips}>
            {DELETION_REASONS.map((r) => {
              const on = reason === r;
              return (
                <Pressable
                  key={r}
                  onPress={() => setReason(on ? null : r)}
                  style={[styles.chip, on && styles.chipOn]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{DELETION_REASON_LABELS[r]}</Text>
                </Pressable>
              );
            })}
          </View>

          <Section title="confirmação" />
          <Text style={ui.body}>
            Digita <Text style={ui.bold}>{ACCOUNT_DELETION_CONFIRM}</Text> pra confirmar.
          </Text>
          <TextInput
            value={typed}
            onChangeText={(v) => {
              setTyped(v);
              if (error) setError(null);
            }}
            placeholder={ACCOUNT_DELETION_CONFIRM}
            placeholderTextColor={colors.gray[400]}
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            maxLength={20}
            style={[styles.input, ok && styles.inputOk]}
            accessibilityLabel={`Digite ${ACCOUNT_DELETION_CONFIRM} pra confirmar`}
            returnKeyType="done"
            onSubmitEditing={() => void submit()}
          />
          {error ? <Text style={ui.errorText}>{error}</Text> : null}

          <View style={ui.actions}>
            <Button title="Excluir minha conta" variant="danger" onPress={() => void submit()} disabled={!ok} loading={busy} fullWidth size="lg" />
            <Button title="Cancelar" variant="ghost" onPress={() => nav.goBack()} disabled={busy} fullWidth />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.lg },
  textCenter: { textAlign: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.gray[300],
    backgroundColor: colors.white,
  },
  chipOn: { backgroundColor: colors.black, borderColor: colors.black },
  chipText: { ...typography.bodySmall, color: colors.black },
  chipTextOn: { color: colors.white },
  input: {
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.gray[300],
    borderRadius: radius.md,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.lg,
    minHeight: 52,
    fontFamily: fontFamily.mono,
    fontSize: 18,
    letterSpacing: 2,
    color: colors.black,
  },
  inputOk: { borderColor: colors.danger },
});
