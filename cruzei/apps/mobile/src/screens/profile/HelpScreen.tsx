import React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, fontFamily, radius, spacing, typography } from '@cruzei/ui-mobile';
import { BRAND } from '../../brand';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { EMERGENCY_NUMBERS } from '../../components/safety/reasons';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const DATE_TIPS = [
  'Marque o primeiro encontro num lugar público e movimentado.',
  'Avise alguém de confiança aonde você vai e com quem.',
  'Vá e volte por conta própria.',
  'Nunca mande dinheiro, códigos ou fotos íntimas pra quem você não conhece.',
  'Se algo parecer estranho, confie no seu instinto: bloqueie e denuncie.',
];

/** Ajuda e segurança: contato com o suporte, documentos legais, bloqueados, dicas e telefones de emergência */
export function HelpScreen() {
  const nav = useNavigation<Nav>();
  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.section}>fale com a gente</Text>
        <View style={styles.card}>
          <Pressable
            style={styles.row}
            onPress={() => Linking.openURL(`mailto:${BRAND.supportEmail}?subject=${encodeURIComponent('Ajuda com o Metch')}`)}
            accessibilityRole="button"
            accessibilityLabel={`Mandar e-mail pro suporte: ${BRAND.supportEmail}`}
          >
            <Ionicons name="mail-outline" size={20} color={colors.black} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>E-mail do suporte</Text>
              <Text style={styles.rowHint} selectable>
                {BRAND.supportEmail}
              </Text>
            </View>
            <Ionicons name="open-outline" size={18} color={colors.gray[400]} />
          </Pressable>
          <Text style={styles.note}>Contestação de suspensão ou banimento também é por aqui.</Text>
        </View>

        <Text style={styles.section}>denunciar e bloquear</Text>
        <View style={styles.card}>
          <Text style={styles.body}>
            No perfil de alguém ou no chat, toque em <Text style={styles.bold}>⋯</Text>. Em Mensagens, segure a conversa. Dali
            você denuncia, bloqueia ou arquiva a conversa. Nas solicitações, Bloquear e Denunciar ficam direto em cada uma. Quem
            você denuncia não sabe que foi você.
          </Text>
          <LinkRow icon="ban-outline" label="Pessoas bloqueadas" onPress={() => nav.navigate('BlockedUsers')} last />
        </View>

        <Text style={styles.section}>documentos</Text>
        <View style={styles.card}>
          <LinkRow icon="document-text-outline" label="Termos de Uso" onPress={() => nav.navigate('Legal', { slug: 'termos' })} />
          <LinkRow icon="lock-closed-outline" label="Política de privacidade" onPress={() => nav.navigate('Legal', { slug: 'privacidade' })} />
          <LinkRow icon="shield-outline" label="Padrões de segurança infantil" onPress={() => nav.navigate('Legal', { slug: 'seguranca-infantil' })} last />
        </View>

        <Text style={styles.section}>encontros com segurança</Text>
        <View style={styles.card}>
          {DATE_TIPS.map((t) => (
            <View key={t} style={styles.tip}>
              <Text style={styles.tipDot}>•</Text>
              <Text style={[styles.body, { flex: 1 }]}>{t}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.section}>emergência</Text>
        <View style={styles.card}>
          {EMERGENCY_NUMBERS.map((e, i) => (
            <Pressable
              key={e.number}
              style={[styles.row, i === EMERGENCY_NUMBERS.length - 1 && { borderBottomWidth: 0 }]}
              onPress={() => Linking.openURL(`tel:${e.number}`)}
              accessibilityRole="button"
              accessibilityLabel={`Ligar ${e.number}, ${e.label}`}
            >
              <Text style={styles.phone}>{e.number}</Text>
              <Text style={[styles.rowLabel, { flex: 1 }]}>{e.label}</Text>
              <Ionicons name="call-outline" size={18} color={colors.danger} />
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function LinkRow({ icon, label, onPress, last }: { icon: string; label: string; onPress: () => void; last?: boolean }) {
  return (
    <Pressable style={[styles.row, last && { borderBottomWidth: 0 }]} onPress={onPress} accessibilityRole="button">
      <Ionicons name={icon as never} size={20} color={colors.black} />
      <Text style={[styles.rowLabel, { flex: 1 }]}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.gray[400]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  section: { ...typography.label, color: colors.gray[500], textTransform: 'uppercase', letterSpacing: 1, marginTop: spacing.lg, marginBottom: spacing.sm },
  card: { backgroundColor: colors.white, borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.gray[200],
  },
  rowLabel: { ...typography.body, color: colors.black },
  rowHint: { ...typography.bodySmall, color: colors.gray[600], marginTop: 2 },
  note: { ...typography.caption, color: colors.gray[500], paddingVertical: spacing.sm },
  body: { ...typography.body, color: colors.gray[800], lineHeight: 22, paddingVertical: spacing.sm },
  bold: { fontFamily: fontFamily.bodyBold, color: colors.black },
  tip: { flexDirection: 'row', gap: spacing.sm },
  tipDot: { ...typography.body, color: colors.gray[400], paddingVertical: spacing.sm },
  phone: { ...typography.h4, color: colors.danger, minWidth: 44 },
});
