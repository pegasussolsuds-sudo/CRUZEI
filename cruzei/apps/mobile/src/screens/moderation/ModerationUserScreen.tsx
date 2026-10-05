import React, { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { instagramUrl } from '@cruzei/shared-utils';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ModerationActionPayload, ModerationDecision, ModerationUserDetail } from '@cruzei/shared-types';
import { colors, fontFamily, radius, spacing, typography } from '@cruzei/ui-mobile';
import { api, toApiError } from '../../services/api';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { reasonLabel } from './ModerationScreen';
import { isConversationOpen, reportConversationIds } from './reportConversations';

type Props = NativeStackScreenProps<RootStackParamList, 'ModerationUser'>;

const SOURCE_LABEL: Record<string, string> = {
  profile: 'pelo perfil',
  chat: 'pelo chat',
  inbox: 'pela lista de Mensagens',
  requests: 'pelas solicitações',
  map: 'pelo mapa',
  likes: 'pelas curtidas',
  emergency: 'pelo botão de emergência',
  auto_filter: 'pelo filtro automático',
};
const ACTION_LABEL: Record<string, string> = {
  auto_hold: 'fora da descoberta',
  dismiss: 'denúncias dispensadas',
  warn: 'advertência',
  ban: 'banimento',
  reinstate: 'reabilitada',
  photo_approve: 'foto aprovada',
  photo_reject: 'foto recusada',
  photo_review: 'foto pra revisão',
  photo_retain: 'foto retida por denúncia (a pessoa apagou)',
};
const actionLabel = (a: string) => {
  if (ACTION_LABEL[a]) return ACTION_LABEL[a];
  if (!a.startsWith('suspend:')) return a;
  const d = a.slice(8);
  return d === 'revisao' ? 'suspensão até revisão' : `suspensão de ${d} dias`;
};

const ACTIONS: { action: ModerationDecision; days?: number; label: string; confirm: string; danger?: boolean }[] = [
  { action: 'dismiss', label: 'Dispensar denúncias', confirm: 'As denúncias pendentes são arquivadas e a pessoa volta pra descoberta.' },
  { action: 'warn', label: 'Advertir', confirm: 'A pessoa recebe um aviso com o motivo escrito acima.' },
  { action: 'suspend', days: 7, label: 'Suspender 7 dias', confirm: 'A pessoa perde o acesso por 7 dias e sai do mapa na hora.', danger: true },
  { action: 'suspend', label: 'Suspender até revisão', confirm: 'A pessoa perde o acesso até alguém da moderação reabilitar.', danger: true },
  { action: 'ban', label: 'Banir', confirm: 'Banimento definitivo: a pessoa perde o acesso, as conversas dela são arquivadas e o número não cria outra conta.', danger: true },
  { action: 'reinstate', label: 'Reabilitar conta', confirm: 'Tira suspensão, banimento e a retenção fora da descoberta.' },
];

/** tudo o que a moderação precisa pra decidir sobre uma pessoa: fotos, denúncias, conversas citadas e histórico */
export function ModerationUserScreen({ route, navigation }: Props) {
  const { userId } = route.params;
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  // conversas citadas: fechadas menos a 1ª; o botão da denúncia abre e rola até a certa
  const [openConv, setOpenConv] = useState<Record<string, boolean>>({});
  const scrollRef = useRef<ScrollView>(null);
  const convY = useRef<Record<string, number>>({});
  const showConversation = (id: string) => {
    setOpenConv((o) => ({ ...o, [id]: true }));
    const y = convY.current[id];
    if (y !== undefined) scrollRef.current?.scrollTo({ y: Math.max(0, y - spacing.sm), animated: true });
  };
  const q = useQuery({
    queryKey: ['admin', 'user', userId],
    queryFn: async () => (await api.get<ModerationUserDetail>(`/admin/users/${userId}`)).data,
  });
  const act = useMutation({
    mutationFn: async (p: ModerationActionPayload) => api.post(`/admin/users/${userId}/action`, p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin'] });
      Alert.alert('Feito', 'Decisão registrada.', [{ text: 'Ok', onPress: () => navigation.goBack() }]);
    },
    onError: (e) => Alert.alert('Não deu', toApiError(e).message),
  });

  if (q.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.black} />
      </View>
    );
  }
  if (q.isError || !q.data) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>{toApiError(q.error).message}</Text>
      </View>
    );
  }
  const d = q.data;
  const u = d.user;
  const loadedConvs = new Set(d.conversations.map((c) => c.conversationId));
  const run = (a: (typeof ACTIONS)[number]) => {
    if ((a.action === 'suspend' || a.action === 'ban' || a.action === 'warn') && !reason.trim()) {
      Alert.alert('Falta o motivo', 'Escreva o motivo que a pessoa vai ver.');
      return;
    }
    Alert.alert(a.label, a.confirm, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Confirmar',
        style: a.danger ? 'destructive' : 'default',
        onPress: () => act.mutate({ action: a.action, days: a.days, reason: reason.trim() || undefined }),
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>
          {u.name}, {u.age}
        </Text>
        <Text style={styles.muted}>
          {u.phoneMasked ?? 'sem telefone'} · conta desde {new Date(u.createdAt).toLocaleDateString('pt-BR')} · {statusText(u)}
        </Text>
        {u.bio ? <Text style={styles.bio}>{u.bio}</Text> : null}
        {/* @ do Instagram é público no cartão: spam, venda ou perfil de outra pessoa também se denuncia aqui */}
        {u.instagram ? (
          <Pressable
            onPress={() => Linking.openURL(instagramUrl(u.instagram as string)).catch(() => undefined)}
            accessibilityRole="link"
            accessibilityLabel={`Instagram: arroba ${u.instagram}`}
            style={styles.insta}
          >
            <Text style={styles.instaText}>Instagram: @{u.instagram}</Text>
          </Pressable>
        ) : null}

        <Text style={styles.section}>fotos</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
          {d.photos.map((p) => (
            <View key={p.id}>
              <Image source={{ uri: p.url }} style={styles.photo} />
              {/* retida: a pessoa apagou com denúncia de menor/abuso aberta; fica só aqui até a denúncia fechar */}
              <Text style={[styles.badge, (p.retained || p.status === 'rejected') && { color: colors.danger }]}>
                {p.retained
                  ? 'retida por denúncia'
                  : p.status === 'approved'
                    ? 'aprovada'
                    : p.status === 'pending'
                      ? 'em análise'
                      : 'recusada'}
                {p.isMain ? ' · principal' : ''}
              </Text>
            </View>
          ))}
          {d.photos.length === 0 ? <Text style={styles.muted}>Sem fotos.</Text> : null}
        </ScrollView>

        <Text style={styles.section}>denúncias ({d.reports.length})</Text>
        {d.reports.map((r) => (
          <View key={r.id} style={styles.card}>
            <Text style={styles.cardTitle}>{reasonLabel(r.reason)}</Text>
            <Text style={styles.muted}>
              {new Date(r.createdAt).toLocaleString('pt-BR')} · {SOURCE_LABEL[r.context?.source ?? ''] ?? 'pelo app'}
            </Text>
            {r.description ? <Text style={styles.cardText}>{r.description}</Text> : null}
            <ReportConversationLinks ids={reportConversationIds(r.context, loadedConvs)} onOpen={showConversation} />
          </View>
        ))}

        {d.conversations.map((c, i) => {
          const open = isConversationOpen(openConv, c.conversationId, i);
          return (
            <View
              key={c.conversationId}
              onLayout={(e) => {
                convY.current[c.conversationId] = e.nativeEvent.layout.y;
              }}
            >
              <Pressable
                onPress={() => setOpenConv((o) => ({ ...o, [c.conversationId]: !open }))}
                style={styles.convHead}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityLabel={`Conversa denunciada ${i + 1}, ${c.messages.length} mensagens. Toque pra ${open ? 'fechar' : 'abrir'}`}
              >
                <Text style={[styles.section, styles.convTitle]}>
                  {open ? '▾' : '▸'} conversa denunciada{d.conversations.length > 1 ? ` ${i + 1}` : ''} · {c.messages.length}{' '}
                  {c.messages.length === 1 ? 'mensagem' : 'mensagens'}
                </Text>
              </Pressable>
              {open ? (
                <View style={styles.card}>
                  {c.messages.length === 0 ? <Text style={styles.muted}>Sem mensagens.</Text> : null}
                  {c.messages.map((m) => (
                    <Text key={m.id} style={styles.msg}>
                      <Text style={{ fontFamily: fontFamily.bodyBold, color: m.senderId === u.id ? colors.danger : colors.gray[600] }}>
                        {m.senderId === u.id ? u.name : 'outra pessoa'}:
                      </Text>{' '}
                      {m.content ?? `[${m.messageType}]`}
                    </Text>
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}

        {d.actions.length ? <Text style={styles.section}>histórico</Text> : null}
        {d.actions.map((a, i) => (
          <Text key={i} style={styles.history}>
            {new Date(a.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · {actionLabel(a.action)}
            {a.moderatorId ? '' : ' (automático)'}
            {a.note ? ` · ${a.note}` : ''}
          </Text>
        ))}

        <Text style={styles.section}>decisão</Text>
        <TextInput
          value={reason}
          onChangeText={setReason}
          placeholder="Motivo que a pessoa vai ver (advertência, suspensão, banimento)"
          placeholderTextColor={colors.gray[400]}
          style={styles.input}
          multiline
          maxLength={255}
        />
        <View style={styles.actions}>
          {ACTIONS.map((a) => (
            <Pressable
              key={a.label}
              onPress={() => run(a)}
              disabled={act.isPending}
              style={({ pressed }) => [styles.action, a.danger && styles.actionDanger, pressed && { opacity: 0.6 }]}
              accessibilityRole="button"
            >
              <Text style={[styles.actionText, a.danger && { color: colors.white }]}>{a.label}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/** conversas citadas numa denúncia (a automática de golpe lista várias): cada uma abre o bloco dela na ficha */
function ReportConversationLinks({ ids, onOpen }: { ids: string[]; onOpen: (id: string) => void }) {
  if (!ids.length) return null;
  return (
    <View style={styles.convLinks}>
      <Text style={styles.muted}>{ids.length === 1 ? 'conversa citada:' : `em ${ids.length} conversas:`}</Text>
      {ids.map((id, i) => (
        <Pressable
          key={id}
          onPress={() => onOpen(id)}
          style={({ pressed }) => [styles.convLink, pressed && { opacity: 0.6 }]}
          accessibilityRole="button"
          accessibilityLabel={`Abrir a conversa ${i + 1} citada`}
          hitSlop={6}
        >
          <Text style={styles.convLinkText}>{ids.length === 1 ? 'abrir' : `abrir ${i + 1}`}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function statusText(u: ModerationUserDetail['user']): string {
  if (u.accountStatus === 'banned') return 'banida';
  if (u.accountStatus === 'suspended') return u.suspendedUntil ? `suspensa até ${new Date(u.suspendedUntil).toLocaleDateString('pt-BR')}` : 'suspensa até revisão';
  return u.reviewHoldAt ? 'ativa, fora da descoberta até revisão' : 'ativa';
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  title: { ...typography.h2, color: colors.black },
  muted: { ...typography.caption, color: colors.gray[500] },
  bio: { ...typography.body, color: colors.gray[800], marginTop: spacing.sm },
  insta: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  instaText: { ...typography.body, color: colors.info, textDecorationLine: 'underline' },
  section: { ...typography.label, color: colors.gray[500], textTransform: 'uppercase', letterSpacing: 1, marginTop: spacing.xl, marginBottom: spacing.sm },
  photo: { width: 120, height: 150, borderRadius: radius.md, backgroundColor: colors.gray[200] },
  badge: { ...typography.caption, color: colors.gray[600], marginTop: 2 },
  card: { backgroundColor: colors.white, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, gap: 2 },
  cardTitle: { ...typography.body, fontFamily: fontFamily.bodyBold, color: colors.black },
  cardText: { ...typography.body, color: colors.gray[800], marginTop: spacing.xs },
  msg: { ...typography.bodySmall, color: colors.gray[800], paddingVertical: 2 },
  convHead: { minHeight: 44, justifyContent: 'flex-end' },
  convTitle: { marginBottom: spacing.sm },
  convLinks: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
  convLink: { paddingVertical: 4, paddingHorizontal: spacing.sm, borderRadius: 999, borderWidth: 1, borderColor: colors.gray[300] },
  convLinkText: { ...typography.caption, fontFamily: fontFamily.bodyBold, color: colors.black },
  history: { ...typography.caption, color: colors.gray[600], paddingVertical: 2 },
  input: {
    minHeight: 64,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gray[200],
    backgroundColor: colors.white,
    padding: spacing.md,
    ...typography.body,
    color: colors.black,
    textAlignVertical: 'top',
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  action: { paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.md, borderRadius: 999, borderWidth: 1, borderColor: colors.gray[300], backgroundColor: colors.white },
  actionDanger: { backgroundColor: colors.danger, borderColor: colors.danger },
  actionText: { ...typography.bodySmall, fontFamily: fontFamily.bodyBold, color: colors.black },
});
