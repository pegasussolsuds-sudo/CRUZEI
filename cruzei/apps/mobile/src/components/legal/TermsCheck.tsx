import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { LegalSlug } from '@cruzei/shared-types';
import { colors, spacing, typography } from '@cruzei/ui-mobile';

/** "Li e aceito os Termos de Uso e a Política de privacidade" — caixa obrigatória no fim do cadastro e no novo aceite */
export function TermsCheck({
  checked,
  onChange,
  onOpen,
  dark = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  onOpen: (slug: LegalSlug) => void;
  dark?: boolean;
}) {
  const fg = dark ? colors.white : colors.black;
  const muted = dark ? 'rgba(250,250,250,0.72)' : colors.gray[600];
  return (
    <Pressable
      onPress={() => onChange(!checked)}
      style={styles.row}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel="Li e aceito os Termos de Uso e a Política de privacidade"
    >
      <View style={[styles.box, { borderColor: checked ? colors.primary : muted }, checked && { backgroundColor: colors.primary }]}>
        {checked ? <Ionicons name="checkmark" size={16} color={colors.black} /> : null}
      </View>
      <Text style={[styles.text, { color: muted }]}>
        Tenho 18 anos ou mais, li e aceito os{' '}
        <Text style={[styles.link, { color: fg }]} onPress={() => onOpen('termos')} accessibilityRole="link">
          Termos de Uso
        </Text>{' '}
        e a{' '}
        <Text style={[styles.link, { color: fg }]} onPress={() => onOpen('privacidade')} accessibilityRole="link">
          Política de privacidade
        </Text>
        .
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: spacing.sm },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  text: { ...typography.bodySmall, flex: 1, lineHeight: 20 },
  link: { fontWeight: '700', textDecorationLine: 'underline' },
});
