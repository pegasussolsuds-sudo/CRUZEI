import React, { useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import { DATA_EXPORT_DAILY_LIMIT_DEFAULT } from '@cruzei/shared-types';
import { Button } from '@cruzei/ui-mobile';

import { toApiError } from '../../services/api';
import {
  exportRunStatus,
  fetchMyDataExport,
  keepPendingAfter,
  pickExportFolder,
  runDataExport,
  saveExport,
  type ExportStatus,
} from '../../services/privacy';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { Bullets, Notice, Section, ui } from './privacyUi';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const INCLUDED = [
  'Conta, perfil, configurações e fotos',
  'Áreas privadas (com o ponto central exato) e as áreas da casa aprendida',
  'Localização guardada: posição atual, histórico arredondado e presenças em lugares',
  'Curtidas e dispensas que você fez, visitas, bloqueios e as SUAS mensagens',
  'Denúncias que você fez e decisões da moderação sobre a conta',
  'Avisos, aparelhos, compras, atendimentos, métricas de uso e registros de acesso',
];

const NOT_INCLUDED = [
  'Mensagens das outras pessoas',
  'Denúncias feitas contra você (protege quem denunciou)',
  'Quem curtiu ou visitou você (vai só a contagem)',
  'Notas internas da equipe e dados antifraude',
];

/** download falhou: 429 export_limit já vem com a mensagem certa do servidor */
function fetchErrorText(e: unknown): string {
  const err = toApiError(e);
  return err.status ? err.message : 'Sem conexão agora. Tenta de novo?';
}

/** Baixar meus dados (LGPD art. 18): JSON salvo na pasta que a pessoa escolher (sem app de terceiros) */
export function DataExportScreen() {
  const nav = useNavigation<Nav>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<ExportStatus | null>(null);
  // cópia baixada e ainda não salva: a do dia já foi gasta, então tenta salvar de novo sem pedir outra
  const pending = useRef<string | null>(null);
  const [hasPending, setHasPending] = useState(false);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // pasta antes (cancelar não gasta a cópia); salvar é um passo à parte do download
      const r = await runDataExport(
        { pickFolder: pickExportFolder, fetchJson: fetchMyDataExport, save: saveExport },
        pending.current,
      );
      pending.current = keepPendingAfter(r, pending.current);
      setHasPending(pending.current !== null);
      const next = exportRunStatus(r, fetchErrorText);
      if (next) setStatus(next);
      if (r.kind === 'done' && r.outcome.kind === 'saved') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      } else if (r.kind === 'fetch_failed' || r.kind === 'save_failed') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={ui.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={ui.content}>
        <Text style={ui.lead}>
          Uma cópia de tudo que o Metch guarda sobre você, num arquivo JSON (dá pra abrir em qualquer editor de texto).
        </Text>

        <Notice icon="lock-closed-outline">
          O arquivo tem dados sensíveis: o centro exato das suas áreas privadas, as áreas da sua casa, seu histórico de
          localização, sua orientação (se você informou) e os IPs dos seus acessos. Guarda num lugar seguro e não manda pra
          ninguém.
        </Notice>

        <Section title="o que vem" />
        <View style={ui.card}>
          <Bullets items={INCLUDED} />
        </View>

        <Section title="o que não vem" />
        <View style={ui.card}>
          <Bullets items={NOT_INCLUDED} />
        </View>

        {status ? (
          <Notice tone={status.tone} icon={status.tone === 'ok' ? 'checkmark-circle-outline' : 'alert-circle-outline'}>
            {status.text}
          </Notice>
        ) : null}

        <View style={ui.actions}>
          <Button
            title={hasPending ? 'Tentar salvar de novo' : 'Escolher pasta e baixar'}
            onPress={() => void run()}
            loading={busy}
            fullWidth
            size="lg"
          />
          <Button title="Ler a Política de privacidade" variant="ghost" onPress={() => nav.navigate('Legal', { slug: 'privacidade' })} fullWidth />
        </View>
        <Text style={ui.note}>Até {DATA_EXPORT_DAILY_LIMIT_DEFAULT} cópias por dia.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
