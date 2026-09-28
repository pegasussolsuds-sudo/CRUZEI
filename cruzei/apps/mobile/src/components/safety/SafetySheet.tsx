import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import type { ReportReason, ReportResult, ReportSource } from '@cruzei/shared-types';
import { colors, radius, spacing, typography } from '@cruzei/ui-mobile';
import { api, toApiError } from '../../services/api';
import { EMERGENCY_NUMBERS, REASON_OPTIONS, URGENT_REASONS } from './reasons';

export interface SafetyTarget {
  id: string;
  name: string;
}

export type SafetyOutcome = 'reported' | 'blocked' | 'unmatched';

type Step = 'menu' | 'reasons' | 'details' | 'done';

interface Props {
  visible: boolean;
  onClose: () => void;
  target: SafetyTarget | null;
  /** com match: aparece "Desfazer match" e a denúncia leva a conversa pra moderação */
  matchId?: string | null;
  source: ReportSource;
  /** depois de bloquear/desfazer/denunciar-e-bloquear a tela costuma sair (a pessoa sumiu) */
  onDone?: (outcome: SafetyOutcome) => void;
}

/**
 * Menu de segurança de uma pessoa: denunciar (motivo → detalhes → pronto), bloquear e desfazer match.
 * Modal simples (sem Reanimated por linha: listas com animação por item derrubavam o app no Moto).
 */
export function SafetySheet({ visible, onClose, target, matchId, source, onDone }: Props) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>('menu');
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReportResult | null>(null);

  useEffect(() => {
    if (!visible) return;
    setStep('menu');
    setReason(null);
    setDetails('');
    setAlsoBlock(true);
    setResult(null);
    setBusy(false);
  }, [visible]);

  if (!target) return null;
  const name = target.name || 'essa pessoa';

  const refreshLists = () => {
    qc.invalidateQueries({ queryKey: ['matches'] });
    qc.invalidateQueries({ queryKey: ['nearby'] });
    qc.invalidateQueries({ queryKey: ['blocks'] });
    qc.invalidateQueries({ queryKey: ['user', target.id] });
  };

  const finish = (outcome: SafetyOutcome) => {
    onClose();
    onDone?.(outcome);
    // só depois que a folha fechou: atualizar antes derrubava o cartão por baixo ("não disponível") e sumia com a
    // confirmação da denúncia junto
    setTimeout(refreshLists, 400);
  };

  const block = () => {
    Alert.alert(`Bloquear ${name}?`, `${name} não vai mais te ver no mapa nem conseguir falar com você. A pessoa não é avisada.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Bloquear',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await api.post('/blocks', { userId: target.id, reason: `bloqueio pelo ${source}` });
            finish('blocked');
          } catch (e) {
            setBusy(false);
            Alert.alert('Não deu pra bloquear', toApiError(e).message);
          }
        },
      },
    ]);
  };

  const unmatch = () => {
    if (!matchId) return;
    Alert.alert('Desfazer o match?', `A conversa com ${name} some pra vocês dois.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Desfazer',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await api.delete(`/matches/${matchId}`);
            finish('unmatched');
          } catch (e) {
            setBusy(false);
            Alert.alert('Não deu pra desfazer', toApiError(e).message);
          }
        },
      },
    ]);
  };

  const submit = async () => {
    if (!reason) return;
    setBusy(true);
    try {
      const res = await api.post<ReportResult>('/reports', {
        userId: target.id,
        reason,
        description: details.trim() || undefined,
        block: alsoBlock,
        context: { source, ...(matchId ? { matchId } : {}) },
      });
      setResult(res.data);
      setStep('done');
    } catch (e) {
      Alert.alert('Não deu pra enviar', toApiError(e).message);
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (step === 'done') finish(result?.blocked ? 'blocked' : 'reported');
    else onClose();
  };

  const reasonLabel = REASON_OPTIONS.find((o) => o.reason === reason)?.label ?? '';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="Fechar" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.anchor} pointerEvents="box-none">
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.grip} />

          {step === 'menu' ? (
            <>
              <Text style={styles.title}>{name}</Text>
              <Action icon="flag-outline" label={`Denunciar ${name}`} hint="A moderação analisa. A pessoa não sabe quem denunciou." onPress={() => setStep('reasons')} danger />
              <Action icon="ban-outline" label={`Bloquear ${name}`} hint="Some do seu mapa e não fala mais com você" onPress={block} />
              {matchId ? <Action icon="heart-dislike-outline" label="Desfazer match" hint="A conversa some pros dois" onPress={unmatch} /> : null}
              <Pressable onPress={close} style={styles.cancel} accessibilityRole="button">
                <Text style={styles.cancelText}>Cancelar</Text>
              </Pressable>
              {busy ? <ActivityIndicator style={styles.busy} color={colors.black} /> : null}
            </>
          ) : null}

          {step === 'reasons' ? (
            <>
              <StepHeader title="Qual é o problema?" onBack={() => setStep('menu')} />
              <ScrollView style={styles.reasons} contentContainerStyle={{ paddingBottom: spacing.sm }}>
                {REASON_OPTIONS.map((o) => (
                  <Pressable
                    key={o.reason}
                    onPress={() => {
                      setReason(o.reason);
                      setStep('details');
                    }}
                    style={({ pressed }) => [styles.reason, pressed && styles.pressed]}
                    accessibilityRole="button"
                  >
                    <Ionicons name={o.icon as never} size={20} color={o.reason === 'child_safety' ? colors.danger : colors.gray[700]} />
                    <Text style={styles.reasonText}>{o.label}</Text>
                    <Ionicons name="chevron-forward" size={18} color={colors.gray[400]} />
                  </Pressable>
                ))}
              </ScrollView>
            </>
          ) : null}

          {step === 'details' ? (
            <>
              <StepHeader title={reasonLabel} onBack={() => setStep('reasons')} />
              <Text style={styles.label}>Quer contar o que aconteceu? (opcional)</Text>
              <TextInput
                value={details}
                onChangeText={setDetails}
                placeholder="Ex.: mandou mensagens ofensivas depois que eu não respondi"
                placeholderTextColor={colors.gray[400]}
                multiline
                maxLength={1000}
                style={styles.input}
                accessibilityLabel="Detalhes da denúncia"
              />
              <View style={styles.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.switchLabel}>Bloquear {name} também</Text>
                  <Text style={styles.switchHint}>Recomendado: a pessoa some do seu mapa e do seu chat</Text>
                </View>
                <Switch
                  value={alsoBlock}
                  onValueChange={setAlsoBlock}
                  trackColor={{ true: colors.primary, false: colors.gray[300] }}
                  thumbColor={colors.white}
                  accessibilityLabel={`Bloquear ${name} também`}
                />
              </View>
              {matchId ? <Text style={styles.note}>A moderação vai poder ler esta conversa pra analisar a denúncia.</Text> : null}
              <Pressable
                onPress={submit}
                disabled={busy}
                style={({ pressed }) => [styles.submit, (pressed || busy) && styles.pressed]}
                accessibilityRole="button"
              >
                {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.submitText}>Enviar denúncia</Text>}
              </Pressable>
            </>
          ) : null}

          {step === 'done' ? (
            <>
              <View style={styles.doneIcon}>
                <Ionicons name="checkmark" size={28} color={colors.black} />
              </View>
              <Text style={[styles.title, { textAlign: 'center' }]}>Recebemos sua denúncia</Text>
              <Text style={styles.doneText}>
                A moderação vai analisar{result?.blocked ? ` e você não vai mais ver ${name}` : ''}. Obrigado por ajudar a manter o Metch seguro.
              </Text>
              {reason && URGENT_REASONS.has(reason) ? (
                <View style={styles.urgent}>
                  <Text style={styles.urgentTitle}>Se alguém corre perigo agora, ligue:</Text>
                  {EMERGENCY_NUMBERS.map((e) => (
                    <Pressable key={e.number} onPress={() => Linking.openURL(`tel:${e.number}`)} style={styles.phone} accessibilityRole="button">
                      <Text style={styles.phoneNumber}>{e.number}</Text>
                      <Text style={styles.phoneLabel}>{e.label}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              <Pressable onPress={close} style={({ pressed }) => [styles.submit, pressed && styles.pressed]} accessibilityRole="button">
                <Text style={styles.submitText}>Fechar</Text>
              </Pressable>
            </>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Action({ icon, label, hint, onPress, danger }: { icon: string; label: string; hint: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.action, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={label}>
      <View style={[styles.actionIcon, danger && { backgroundColor: 'rgba(255,59,48,0.10)' }]}>
        <Ionicons name={icon as never} size={20} color={danger ? colors.danger : colors.black} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.actionLabel, danger && { color: colors.danger }]}>{label}</Text>
        <Text style={styles.actionHint}>{hint}</Text>
      </View>
    </Pressable>
  );
}

function StepHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={styles.stepHeader}>
      <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Voltar">
        <Ionicons name="chevron-back" size={22} color={colors.black} />
      </Pressable>
      <Text style={styles.stepTitle} numberOfLines={2}>
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(10,10,26,0.55)' },
  anchor: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg * 1.5,
    borderTopRightRadius: radius.lg * 1.5,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    maxHeight: '88%',
  },
  grip: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.gray[300], marginBottom: spacing.md },
  title: { ...typography.h3, color: colors.black, marginBottom: spacing.md },
  action: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  actionIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.gray[100], alignItems: 'center', justifyContent: 'center' },
  actionLabel: { ...typography.body, fontWeight: '600', color: colors.black },
  actionHint: { ...typography.caption, color: colors.gray[500], marginTop: 2 },
  cancel: { alignItems: 'center', paddingVertical: spacing.lg, marginTop: spacing.xs },
  cancelText: { ...typography.body, color: colors.gray[600], fontWeight: '600' },
  busy: { position: 'absolute', top: spacing.lg, right: spacing.lg },
  pressed: { opacity: 0.6 },
  stepHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  stepTitle: { ...typography.h4, color: colors.black, flex: 1 },
  reasons: { maxHeight: 460 },
  reason: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.gray[200],
  },
  reasonText: { ...typography.body, color: colors.black, flex: 1 },
  label: { ...typography.bodySmall, color: colors.gray[600], marginBottom: spacing.sm },
  input: {
    minHeight: 96,
    maxHeight: 180,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gray[200],
    backgroundColor: colors.white,
    padding: spacing.md,
    ...typography.body,
    color: colors.black,
    textAlignVertical: 'top',
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.lg },
  switchLabel: { ...typography.body, fontWeight: '600', color: colors.black },
  switchHint: { ...typography.caption, color: colors.gray[500], marginTop: 2 },
  note: { ...typography.caption, color: colors.gray[500], marginTop: spacing.md },
  submit: {
    marginTop: spacing.lg,
    backgroundColor: colors.black,
    borderRadius: radius.lg,
    paddingVertical: spacing.md + 2,
    alignItems: 'center',
  },
  submitText: { ...typography.body, fontWeight: '700', color: colors.white },
  doneIcon: {
    alignSelf: 'center',
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: spacing.md,
  },
  doneText: { ...typography.body, color: colors.gray[700], textAlign: 'center' },
  urgent: { marginTop: spacing.lg, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.gray[100], gap: spacing.xs },
  urgentTitle: { ...typography.bodySmall, fontWeight: '700', color: colors.black, marginBottom: spacing.xs },
  phone: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.md, paddingVertical: spacing.xs },
  phoneNumber: { ...typography.h4, color: colors.danger, minWidth: 44 },
  phoneLabel: { ...typography.bodySmall, color: colors.gray[700], flex: 1 },
});
