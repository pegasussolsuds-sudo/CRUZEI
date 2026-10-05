import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Button, colors, spacing, typography } from '@cruzei/ui-mobile';

import { toApiError } from '../../services/api';
import { forgetLocationHistory, forgetSummary } from '../../services/privacy';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { Bullets, Notice, Section, ui } from './privacyUi';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const ERASED = [
  'O histórico arredondado das suas posições (inclusive o que ainda ia ser gravado)',
  'Suas presenças em lugares e os "estou aqui"',
  'Sua posição atual no mapa (volta quando o app atualizar)',
  'A referência contra GPS falso',
];

const KEPT = [
  'Suas áreas privadas (apague em Perfil → Áreas privadas)',
  'O movimento dos lugares: é anônimo e não identifica ninguém',
];

type Status = { tone: 'ok' | 'danger'; text: string } | null;

/** Apagar histórico de localização (LGPD art. 18 VI): na hora, sem esperar a limpeza automática de ~3 dias */
export function LocationHistoryScreen() {
  const nav = useNavigation<Nav>();
  const qc = useQueryClient();
  const [learnedHome, setLearnedHome] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  const run = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const r = await forgetLocationHistory(learnedHome);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setStatus({ tone: 'ok', text: forgetSummary(r) });
      // o mapa busca de novo (minha presença saiu)
      qc.invalidateQueries({ queryKey: ['nearby'] });
    } catch (e) {
      const err = toApiError(e);
      setStatus({ tone: 'danger', text: err.status ? err.message : 'Sem conexão agora. Tenta de novo?' });
    } finally {
      setBusy(false);
    }
  };

  const confirm = () =>
    Alert.alert(
      'Apagar histórico de localização?',
      learnedHome
        ? 'Isso não tem volta. A casa aprendida também sai: até o app aprender de novo, use as Áreas privadas pra se esconder perto de casa.'
        : 'Isso não tem volta.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Apagar', style: 'destructive', onPress: () => void run() },
      ],
    );

  return (
    <SafeAreaView style={ui.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={ui.content}>
        <Text style={ui.lead}>
          O Metch já apaga o histórico sozinho em cerca de 3 dias. Aqui você apaga agora.
        </Text>

        <Section title="o que sai" />
        <View style={ui.card}>
          <Bullets items={ERASED} />
          <View style={styles.switchRow}>
            <View style={ui.flex}>
              <Text style={styles.switchLabel}>Também apagar a casa aprendida</Text>
              <Text style={styles.switchHint}>
                Ela te esconde perto de casa. Apagando, o app aprende de novo em umas 3 noites.
              </Text>
            </View>
            <Switch
              value={learnedHome}
              onValueChange={setLearnedHome}
              trackColor={{ false: colors.gray[300], true: colors.primary }}
              thumbColor={colors.white}
              accessibilityLabel="Também apagar a casa aprendida"
            />
          </View>
        </View>

        <Section title="o que fica" />
        <View style={ui.card}>
          <Bullets items={KEPT} />
        </View>

        {status ? (
          <Notice tone={status.tone} icon={status.tone === 'ok' ? 'checkmark-circle-outline' : 'alert-circle-outline'}>
            {status.text}
          </Notice>
        ) : null}

        <View style={ui.actions}>
          <Button title="Apagar histórico agora" variant="danger" onPress={confirm} loading={busy} fullWidth size="lg" />
          <Button title="Áreas privadas" variant="ghost" onPress={() => nav.navigate('PrivateAreas')} fullWidth />
        </View>
        <Text style={ui.note}>Dá pra apagar até 3 vezes por dia.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    marginTop: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.gray[200],
  },
  switchLabel: { ...typography.body, color: colors.black },
  switchHint: { ...typography.bodySmall, color: colors.gray[600], marginTop: 2 },
});
