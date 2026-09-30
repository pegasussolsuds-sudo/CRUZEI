import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import {
  EMERGENCY_PAUSE_DAYS,
  EMERGENCY_PHONE,
  EMERGENCY_THROTTLED_ERROR,
  type EmergencyRequest,
  type EmergencyResult,
} from '@cruzei/shared-types';
import { colors, fontFamily, radius, spacing, typography } from '@cruzei/ui-mobile';
import { api, toApiError } from '../../services/api';
import { useAuthStore } from '../../stores/auth';
import { inboxKeys } from '../../hooks/useInbox';
import { supportKeys } from '../../hooks/useSupport';
import { navigationRef } from '../../navigation/navigationRef';

export interface EmergencyTarget {
  id: string;
  name: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  /** a pessoa envolvida (chat/cartão); null = Ajuda e segurança */
  target?: EmergencyTarget | null;
  /** a conversa (quando veio do chat): a moderação lê as últimas mensagens */
  conversationId?: string | null;
  /** deu certo e a folha fechou (o chat/cartão sai: a pessoa foi bloqueada) */
  onDone?: (result: EmergencyResult) => void;
}

type Step = 'confirm' | 'done';

/** "07/10" (dia/mês do fim da pausa) */
function shortDate(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}

function call190() {
  Linking.openURL(`tel:${EMERGENCY_PHONE}`).catch(() =>
    Alert.alert('Não deu pra abrir o telefone', `Liga ${EMERGENCY_PHONE} direto pelo discador.`),
  );
}

/**
 * "🆘 Emergência" (POST /v1/safety/emergency): um botão só no menu do chat, no cartão da pessoa e em Ajuda e
 * segurança. Mostra antes o que vai acontecer + atalho "Ligar 190"; ao confirmar o servidor pausa o perfil por 7 dias,
 * bloqueia e denuncia a pessoa (se houver) e chama o suporte URGENTE. Nunca manda localização. Depois oferece abrir
 * o suporte. Modal simples (sem Reanimated por linha: listas animadas derrubavam o app no Moto).
 */
export function EmergencySheet({ visible, onClose, target = null, conversationId = null, onDone }: Props) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>('confirm');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<EmergencyResult | null>(null);

  useEffect(() => {
    if (!visible) return;
    setStep('confirm');
    setBusy(false);
    setResult(null);
  }, [visible]);

  const name = target?.name || 'essa pessoa';

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const body: EmergencyRequest = {
        ...(target ? { targetUserId: target.id } : {}),
        ...(conversationId ? { conversationId } : {}),
      };
      const res = await api.post<EmergencyResult>('/safety/emergency', body);
      setResult(res.data);
      setStep('done');
    } catch (e) {
      const err = toApiError(e);
      if (err.error === EMERGENCY_THROTTLED_ERROR) {
        // limite do botão: as tentativas anteriores podem ter falhado — nada de afirmar que a equipe foi avisada
        Alert.alert('Emergência acionada várias vezes', err.message, [
          { text: 'Fechar', style: 'cancel' },
          { text: 'Abrir o suporte', onPress: openSupportNow },
          { text: `Ligar ${EMERGENCY_PHONE}`, onPress: call190 },
        ]);
        return;
      }
      Alert.alert(
        'Não deu pra acionar agora',
        `${err.message}\n\nSe você está em perigo, ligue ${EMERGENCY_PHONE}.`,
        [
          { text: 'Fechar', style: 'cancel' },
          { text: `Ligar ${EMERGENCY_PHONE}`, onPress: call190 },
        ],
      );
    } finally {
      setBusy(false);
    }
  };

  /** fecha e, depois que a folha saiu, atualiza o que mostra a pessoa (pausa, bloqueio, suporte) */
  const finish = (openSupport: boolean) => {
    const r = result;
    onClose();
    if (!r) return;
    onDone?.(r);
    setTimeout(() => {
      useAuthStore.getState().refreshMe().catch(() => {});
      qc.invalidateQueries({ queryKey: supportKeys.all });
      qc.invalidateQueries({ queryKey: ['nearby'] });
      if (target) {
        qc.invalidateQueries({ queryKey: inboxKeys.all });
        qc.invalidateQueries({ queryKey: ['blocks'] });
        qc.invalidateQueries({ queryKey: ['user', target.id] });
      }
      if (openSupport && navigationRef.isReady()) navigationRef.navigate('SupportChat');
    }, 350);
  };

  /** 429 do botão: fecha a folha e abre o atendimento urgente que já existe */
  const openSupportNow = () => {
    onClose();
    setTimeout(() => {
      qc.invalidateQueries({ queryKey: supportKeys.all });
      if (navigationRef.isReady()) navigationRef.navigate('SupportChat');
    }, 350);
  };

  const close = () => {
    if (busy) return;
    if (step === 'done') finish(false);
    else onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close} statusBarTranslucent navigationBarTranslucent>
      <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="Fechar" />
      <View style={styles.anchor} pointerEvents="box-none">
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.grip} />
          <ScrollView bounces={false} contentContainerStyle={{ paddingBottom: spacing.xs }}>
            {step === 'confirm' ? (
              <>
                <View style={styles.head}>
                  <View style={styles.sosBadge}>
                    <Text style={styles.sosText} accessibilityElementsHidden importantForAccessibility="no">
                      🆘
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title} accessibilityRole="header">
                      Emergência
                    </Text>
                    <Text style={styles.subtitle}>Em perigo agora? Liga {EMERGENCY_PHONE} primeiro.</Text>
                  </View>
                </View>

                <Pressable
                  onPress={call190}
                  style={({ pressed }) => [styles.callBtn, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`Ligar ${EMERGENCY_PHONE}, Polícia Militar`}
                >
                  <Ionicons name="call" size={20} color={colors.danger} />
                  <Text style={styles.callText}>Ligar {EMERGENCY_PHONE}</Text>
                  <Text style={styles.callHint}>Polícia Militar</Text>
                </Pressable>

                <Text style={styles.section}>Ao confirmar, a gente:</Text>
                <Item icon="pause-circle-outline" title={`Pausa seu perfil por ${EMERGENCY_PAUSE_DAYS} dias`} hint="Você some do mapa. Dá pra despausar quando quiser" />
                {target ? (
                  <>
                    <Item icon="ban-outline" title={`Bloqueia ${name}`} hint="Some do seu mapa e do seu chat. A pessoa não é avisada" />
                    <Item icon="flag-outline" title="Manda uma denúncia de segurança" hint={conversationId ? 'A moderação vai poder ler esta conversa' : 'A moderação analisa com prioridade máxima'} />
                  </>
                ) : null}
                <Item icon="headset-outline" title="Chama a Equipe Metch no suporte" hint="Com prioridade máxima: seu atendimento vai pro topo da fila" />
                <Item icon="lock-closed-outline" title="Sua localização não é enviada" hint="Nem pra equipe, nem pra ninguém" last />

                <Pressable
                  onPress={confirm}
                  disabled={busy}
                  style={({ pressed }) => [styles.confirm, (pressed || busy) && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: busy, busy }}
                  accessibilityLabel="Confirmar emergência"
                >
                  {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.confirmText}>Confirmar emergência</Text>}
                </Pressable>
                <Pressable onPress={close} disabled={busy} style={styles.cancel} accessibilityRole="button">
                  <Text style={styles.cancelText}>Cancelar</Text>
                </Pressable>
              </>
            ) : null}

            {step === 'done' && result ? (
              <>
                <View style={styles.doneIcon}>
                  <Ionicons name="shield-checkmark" size={30} color={colors.black} />
                </View>
                <Text style={[styles.title, styles.center]} accessibilityRole="header">
                  Pronto. A equipe já foi avisada
                </Text>
                <Text style={[styles.subtitle, styles.center]}>A Equipe Metch vai falar com você no suporte, com prioridade.</Text>
                <View style={styles.doneList}>
                  <Done text={`Perfil pausado até ${shortDate(result.pausedUntil)}`} />
                  {target ? <Done text={result.blocked ? `Bloqueio feito: ${name}` : `Não deu pra bloquear ${name}: a equipe vai conferir`} ok={result.blocked} /> : null}
                  {target ? <Done text={result.reportId ? 'Denúncia de segurança enviada' : 'A equipe vai registrar a denúncia'} ok={Boolean(result.reportId)} /> : null}
                  <Done text="Suporte urgente aberto" />
                </View>
                <Pressable
                  onPress={() => finish(true)}
                  style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
                  accessibilityRole="button"
                >
                  <Ionicons name="chatbubbles" size={18} color={colors.white} />
                  <Text style={styles.primaryText}>Abrir o suporte</Text>
                </Pressable>
                <Pressable
                  onPress={call190}
                  style={({ pressed }) => [styles.callBtn, styles.callBtnDone, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`Ligar ${EMERGENCY_PHONE}, Polícia Militar`}
                >
                  <Ionicons name="call" size={20} color={colors.danger} />
                  <Text style={styles.callText}>Ligar {EMERGENCY_PHONE}</Text>
                </Pressable>
                <Pressable onPress={() => finish(false)} style={styles.cancel} accessibilityRole="button">
                  <Text style={styles.cancelText}>Fechar</Text>
                </Pressable>
              </>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Item({ icon, title, hint, last }: { icon: string; title: string; hint: string; last?: boolean }) {
  return (
    <View style={[styles.item, last && { borderBottomWidth: 0 }]}>
      <View style={styles.itemIcon}>
        <Ionicons name={icon as never} size={18} color={colors.black} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.itemTitle}>{title}</Text>
        <Text style={styles.itemHint}>{hint}</Text>
      </View>
    </View>
  );
}

function Done({ text, ok = true }: { text: string; ok?: boolean }) {
  return (
    <View style={styles.doneRow}>
      <Ionicons name={ok ? 'checkmark-circle' : 'alert-circle'} size={18} color={ok ? colors.black : colors.danger} />
      <Text style={styles.doneText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(10,10,26,0.6)' },
  anchor: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg * 1.5,
    borderTopRightRadius: radius.lg * 1.5,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    maxHeight: '92%',
  },
  grip: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.gray[300], marginBottom: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  sosBadge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,59,48,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sosText: { fontSize: 26 },
  title: { ...typography.h3, color: colors.black },
  subtitle: { ...typography.bodySmall, color: colors.gray[600], marginTop: 2 },
  center: { textAlign: 'center' },
  callBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 52,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.danger,
    backgroundColor: 'rgba(255,59,48,0.06)',
  },
  callBtnDone: { marginTop: spacing.sm, justifyContent: 'center' },
  callText: { ...typography.body, fontFamily: fontFamily.bodyBold, color: colors.danger },
  callHint: { ...typography.caption, color: colors.gray[600], marginLeft: 'auto' },
  section: { ...typography.label, color: colors.gray[500], marginTop: spacing.lg, marginBottom: spacing.xs },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.gray[200],
  },
  itemIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.gray[100], alignItems: 'center', justifyContent: 'center' },
  itemTitle: { ...typography.body, fontFamily: fontFamily.bodySemiBold, color: colors.black },
  itemHint: { ...typography.caption, color: colors.gray[500], marginTop: 1 },
  confirm: {
    marginTop: spacing.lg,
    backgroundColor: colors.danger,
    borderRadius: radius.lg,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmText: { ...typography.body, fontFamily: fontFamily.bodyBold, color: colors.white },
  cancel: { alignItems: 'center', paddingVertical: spacing.lg, marginTop: spacing.xs },
  cancelText: { ...typography.body, color: colors.gray[600], fontFamily: fontFamily.bodySemiBold },
  pressed: { opacity: 0.6 },
  doneIcon: {
    alignSelf: 'center',
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: spacing.md,
  },
  doneList: { marginTop: spacing.lg, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.gray[100], gap: spacing.sm },
  doneRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  doneText: { ...typography.bodySmall, color: colors.gray[800], flex: 1 },
  primary: {
    marginTop: spacing.lg,
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.black,
    borderRadius: radius.lg,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { ...typography.body, fontFamily: fontFamily.bodyBold, color: colors.white },
});
