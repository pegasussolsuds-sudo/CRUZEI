import React, { useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { LEGAL_VERSION, type LegalSlug } from '@cruzei/shared-types';
import { colors, radius, spacing, typography } from '@cruzei/ui-mobile';
import { api, toApiError } from '../../services/api';
import { useAuthStore } from '../../stores/auth';
import { LegalDocView } from './LegalDocView';
import { TermsCheck } from './TermsCheck';

const TITLES: Record<LegalSlug, string> = {
  termos: 'Termos de Uso',
  privacidade: 'Política de privacidade',
  'seguranca-infantil': 'Segurança infantil',
};

/**
 * Aceite pendente dos Termos/Política (conta criada antes do aceite existir, ou versão nova): trava o app até aceitar.
 * O servidor diz a versão aceita × a vigente no /me.
 */
export function TermsGate() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState<LegalSlug | null>(null);

  const legal = user?.legal;
  if (!user || !legal || legal.acceptedVersion === legal.currentVersion) return null;
  const firstTime = !legal.acceptedVersion;

  const accept = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ acceptedVersion: string; currentVersion: string }>('/me/terms', { version: LEGAL_VERSION });
      setUser({ ...user, legal: res.data });
    } catch (e) {
      Alert.alert('Não deu pra salvar', toApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible animationType="fade" onRequestClose={() => undefined} statusBarTranslucent navigationBarTranslucent>
      <SafeAreaView style={styles.safe}>
        {/* fundo claro: ícones escuros na barra de status (o mapa por baixo pede claros) */}
        <StatusBar style="dark" />
        <View style={styles.body}>
          <Ionicons name="document-text-outline" size={40} color={colors.black} />
          <Text style={styles.title} accessibilityRole="header">
            {firstTime ? 'Antes de continuar' : 'Atualizamos nossos termos'}
          </Text>
          <Text style={styles.text}>
            {firstTime
              ? 'Pra seguir usando o Metch, leia e aceite os Termos de Uso e a Política de privacidade. Eles explicam as regras do app e o que fazemos com seus dados, inclusive a localização.'
              : 'Os Termos de Uso e a Política de privacidade mudaram. Dá uma lida e aceite pra continuar.'}
          </Text>
          <TermsCheck checked={checked} onChange={setChecked} onOpen={setReading} />
        </View>
        <Pressable
          onPress={accept}
          disabled={!checked || busy}
          style={[styles.btn, (!checked || busy) && { opacity: 0.4 }]}
          accessibilityRole="button"
          accessibilityState={{ disabled: !checked || busy }}
        >
          {busy ? <ActivityIndicator color={colors.black} /> : <Text style={styles.btnText}>Aceitar e continuar</Text>}
        </Pressable>
      </SafeAreaView>

      <Modal
        visible={reading !== null}
        animationType="slide"
        onRequestClose={() => setReading(null)}
        statusBarTranslucent
        navigationBarTranslucent
      >
        <SafeAreaView style={styles.readerSafe}>
          <View style={styles.readerHeader}>
            <Text style={styles.readerTitle}>{reading ? TITLES[reading] : ''}</Text>
            <Pressable onPress={() => setReading(null)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Fechar">
              <Ionicons name="close" size={26} color={colors.black} />
            </Pressable>
          </View>
          {reading ? <LegalDocView slug={reading} /> : null}
        </SafeAreaView>
      </Modal>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background, padding: spacing.xl },
  body: { flex: 1, justifyContent: 'center', gap: spacing.md },
  title: { ...typography.h2, color: colors.black },
  text: { ...typography.body, color: colors.gray[700], lineHeight: 22 },
  btn: { backgroundColor: colors.primary, borderRadius: radius.lg, paddingVertical: spacing.md + 2, alignItems: 'center' },
  btnText: { ...typography.body, fontWeight: '700', color: colors.black },
  readerSafe: { flex: 1, backgroundColor: colors.background },
  readerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.gray[200],
  },
  readerTitle: { ...typography.h4, color: colors.black },
});
