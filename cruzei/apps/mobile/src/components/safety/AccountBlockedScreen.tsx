import React, { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import type { AccountBlockedError } from '@cruzei/shared-types';
import { colors, fontFamily, radius, spacing, typography } from '@cruzei/ui-mobile';
import { BRAND } from '../../brand';
import { useAccountBlockStore } from '../../stores/accountBlock';
import { useAuthStore } from '../../stores/auth';

/** conta suspensa ou banida: substitui o app inteiro (motivo, prazo e como contestar) */
export function AccountBlockedScreen({ blocked }: { blocked: AccountBlockedError }) {
  const setBlocked = useAccountBlockStore((s) => s.setBlocked);
  const logout = useAuthStore((s) => s.logout);
  const refreshMe = useAuthStore((s) => s.refreshMe);
  const [busy, setBusy] = useState(false);
  const banned = blocked.error === 'account_banned';
  const expired = blocked.until ? new Date(blocked.until).getTime() <= Date.now() : false;

  const leave = async () => {
    setBusy(true);
    await logout(); // o /auth/logout responde 403 e o interceptor marca de novo: limpa só depois
    setBlocked(null);
    setBusy(false);
  };

  // suspensão com prazo vencido: tenta de novo (o servidor reativa sozinho)
  const retry = async () => {
    setBusy(true);
    setBlocked(null);
    try {
      await refreshMe();
    } catch {
      /* se ainda estiver suspensa, o 403 volta pra esta tela */
    }
    setBusy(false);
  };

  const mail = `mailto:${BRAND.supportEmail}?subject=${encodeURIComponent(banned ? 'Contestar banimento' : 'Contestar suspensão')}`;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <View style={styles.body}>
        <View style={styles.icon}>
          <Ionicons name={banned ? 'ban' : 'pause'} size={34} color={colors.white} />
        </View>
        <Text style={styles.title} accessibilityRole="header">
          {banned ? 'Conta banida' : 'Conta suspensa'}
        </Text>
        <Text style={styles.message}>{blocked.message}</Text>
        {blocked.reason ? (
          <View style={styles.reason}>
            <Text style={styles.reasonLabel}>Motivo</Text>
            <Text style={styles.reasonText}>{blocked.reason}</Text>
          </View>
        ) : null}
        <Text style={styles.hint}>
          Acha que foi um engano? Escreva pra <Text style={styles.email}>{BRAND.supportEmail}</Text> com o número do seu celular.
        </Text>
      </View>
      <View style={styles.actions}>
        {!banned && expired ? (
          <Pressable onPress={retry} disabled={busy} style={[styles.btn, styles.primary]} accessibilityRole="button">
            <Text style={[styles.btnText, { color: colors.black }]}>Tentar de novo</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={() => Linking.openURL(mail)} style={[styles.btn, styles.outline]} accessibilityRole="button">
          <Text style={styles.btnText}>Contestar por e-mail</Text>
        </Pressable>
        <Pressable onPress={leave} disabled={busy} style={styles.link} accessibilityRole="button">
          {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.linkText}>Sair da conta</Text>}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.black, paddingHorizontal: spacing.xl },
  body: { flex: 1, justifyContent: 'center', gap: spacing.md },
  icon: { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(255,59,48,0.9)', alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  title: { ...typography.h1, color: colors.white },
  message: { ...typography.bodyLarge, color: 'rgba(250,250,250,0.86)' },
  reason: { marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: 'rgba(250,250,250,0.08)' },
  reasonLabel: { ...typography.caption, color: 'rgba(250,250,250,0.6)', textTransform: 'uppercase', letterSpacing: 1 },
  reasonText: { ...typography.body, color: colors.white, marginTop: 4 },
  hint: { ...typography.bodySmall, color: 'rgba(250,250,250,0.7)', marginTop: spacing.md, lineHeight: 20 },
  email: { color: colors.white, fontFamily: fontFamily.bodyBold },
  actions: { gap: spacing.sm, paddingBottom: spacing.lg },
  btn: { borderRadius: radius.lg, paddingVertical: spacing.md + 2, alignItems: 'center' },
  primary: { backgroundColor: colors.primary },
  outline: { borderWidth: 1, borderColor: 'rgba(250,250,250,0.4)' },
  btnText: { ...typography.body, fontFamily: fontFamily.bodyBold, color: colors.white },
  link: { alignItems: 'center', paddingVertical: spacing.md },
  linkText: { ...typography.body, color: 'rgba(250,250,250,0.7)' },
});
