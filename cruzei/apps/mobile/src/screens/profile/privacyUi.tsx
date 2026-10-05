// Peças visuais das telas de conta e privacidade (Baixar meus dados, Histórico de localização, Excluir conta): mesmo
// cartão claro com borda da Ajuda e segurança.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamily, radius, spacing, typography } from '@cruzei/ui-mobile';

export function Section({ title }: { title: string }) {
  return <Text style={ui.section}>{title}</Text>;
}

export function Bullets({ items }: { items: string[] }) {
  return (
    <View>
      {items.map((t) => (
        <View key={t} style={ui.bulletRow}>
          <Text style={ui.bulletDot}>•</Text>
          <Text style={[ui.body, ui.flex]}>{t}</Text>
        </View>
      ))}
    </View>
  );
}

/** aviso amarelo (dado sensível, assinatura na loja) */
export function Notice({ icon = 'alert-circle-outline', tone = 'warn', children }: { icon?: string; tone?: 'warn' | 'danger' | 'ok'; children: React.ReactNode }) {
  const t = tone === 'danger' ? ui.noticeDanger : tone === 'ok' ? ui.noticeOk : ui.noticeWarn;
  const c = tone === 'danger' ? colors.danger : tone === 'ok' ? colors.success : colors.black;
  return (
    <View style={[ui.notice, t]}>
      <Ionicons name={icon as never} size={18} color={c} />
      <Text style={[ui.noticeText, ui.flex]}>{children}</Text>
    </View>
  );
}

export const ui = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  flex: { flex: 1 },
  lead: { ...typography.bodyLarge, color: colors.gray[800] },
  section: { ...typography.label, color: colors.gray[500], textTransform: 'uppercase', letterSpacing: 1, marginTop: spacing.lg, marginBottom: spacing.sm },
  // colors.white é o fundo: o cartão precisa de borda
  card: { backgroundColor: colors.white, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.gray[200], paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  body: { ...typography.body, color: colors.gray[800], lineHeight: 22, paddingVertical: 4 },
  bold: { fontFamily: fontFamily.bodyBold, color: colors.black },
  bulletRow: { flexDirection: 'row', gap: spacing.sm },
  bulletDot: { ...typography.body, color: colors.gray[400], paddingVertical: 4 },
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, marginTop: spacing.lg },
  noticeWarn: { backgroundColor: 'rgba(255,215,0,0.14)', borderColor: 'rgba(200,160,0,0.45)' },
  noticeDanger: { backgroundColor: 'rgba(255,59,48,0.08)', borderColor: 'rgba(255,59,48,0.4)' },
  noticeOk: { backgroundColor: 'rgba(52,199,89,0.10)', borderColor: 'rgba(52,199,89,0.45)' },
  noticeText: { ...typography.bodySmall, color: colors.gray[900], lineHeight: 20 },
  note: { ...typography.caption, color: colors.gray[500], marginTop: spacing.sm, textAlign: 'center' },
  actions: { marginTop: spacing.xl, gap: spacing.sm },
  errorText: { ...typography.body, color: colors.danger, marginTop: spacing.md },
  link: { ...typography.label, color: colors.info, paddingVertical: spacing.sm },
});
