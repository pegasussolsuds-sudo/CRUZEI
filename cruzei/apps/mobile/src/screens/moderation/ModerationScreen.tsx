import React, { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ModerationPhoto, ModerationQueue, ModerationReportGroup } from '@cruzei/shared-types';
import { colors, radius, spacing, typography } from '@cruzei/ui-mobile';
import { api, toApiError } from '../../services/api';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { REASON_OPTIONS } from '../../components/safety/reasons';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export const reasonLabel = (r: string) => REASON_OPTIONS.find((o) => o.reason === r)?.label ?? r;
const PRIORITY_COLOR = ['#737373', '#9A5B00', '#C8261B', '#C8261B'];
// o Alert do Android mostra no máximo 3 botões: 2 motivos + cancelar
const PHOTO_REJECT_REASONS = ['Nudez ou conteúdo sexual', 'Parece ter menos de 18 anos'];

/** fila da moderação: denúncias agrupadas por pessoa (prioridade primeiro) e fotos em análise */
export function ModerationScreen() {
  const nav = useNavigation<Nav>();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'reports' | 'photos'>('reports');
  const q = useQuery({
    queryKey: ['admin', 'queue'],
    queryFn: async () => (await api.get<ModerationQueue>('/admin/queue')).data,
    refetchInterval: 30_000,
  });
  const decide = useMutation({
    mutationFn: async (v: { id: string; decision: 'approve' | 'reject'; reason?: string }) =>
      api.post(`/admin/photos/${v.id}`, { decision: v.decision, reason: v.reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'queue'] }),
    onError: (e) => Alert.alert('Não deu', toApiError(e).message),
  });

  const reject = (p: ModerationPhoto) =>
    Alert.alert('Recusar foto', `Motivo que ${p.userName} vai ver:`, [
      ...PHOTO_REJECT_REASONS.map((r) => ({ text: r, onPress: () => decide.mutate({ id: p.id, decision: 'reject', reason: r }) })),
      { text: 'Cancelar', style: 'cancel' as const },
    ]);

  if (q.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.black} />
      </View>
    );
  }
  if (q.isError) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>{toApiError(q.error).message}</Text>
      </View>
    );
  }
  const data = q.data ?? { reports: [], photos: [] };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <View style={styles.tabs}>
        <Tab label={`Denúncias · ${data.reports.length}`} active={tab === 'reports'} onPress={() => setTab('reports')} />
        <Tab label={`Fotos · ${data.photos.length}`} active={tab === 'photos'} onPress={() => setTab('photos')} />
      </View>
      {tab === 'reports' ? (
        <FlatList
          data={data.reports}
          keyExtractor={(g) => g.user.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} />}
          ListEmptyComponent={<Text style={styles.empty}>Nenhuma denúncia pendente.</Text>}
          renderItem={({ item }) => <ReportGroupRow g={item} onPress={() => nav.navigate('ModerationUser', { userId: item.user.id })} />}
        />
      ) : (
        <FlatList
          data={data.photos}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} />}
          ListEmptyComponent={<Text style={styles.empty}>Nenhuma foto em análise.</Text>}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <Image source={{ uri: item.url }} style={styles.photo} resizeMode="cover" />
              <View style={{ padding: spacing.md, gap: spacing.xs }}>
                <Pressable onPress={() => nav.navigate('ModerationUser', { userId: item.userId })} accessibilityRole="link">
                  <Text style={styles.name}>{item.userName}</Text>
                </Pressable>
                <Text style={styles.muted}>{item.labels.length ? item.labels.join(' · ') : 'sem análise automática'}</Text>
                <View style={styles.row}>
                  <Pressable
                    style={[styles.btn, styles.approve]}
                    onPress={() => decide.mutate({ id: item.id, decision: 'approve' })}
                    disabled={decide.isPending}
                    accessibilityRole="button"
                  >
                    <Text style={styles.btnText}>Aprovar</Text>
                  </Pressable>
                  <Pressable style={[styles.btn, styles.reject]} onPress={() => reject(item)} disabled={decide.isPending} accessibilityRole="button">
                    <Text style={[styles.btnText, { color: colors.white }]}>Recusar</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

function ReportGroupRow({ g, onPress }: { g: ModerationReportGroup; onPress: () => void }) {
  const reasons = [...new Set(g.reports.map((r) => reasonLabel(r.reason)))];
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, styles.groupRow, pressed && { opacity: 0.7 }]} accessibilityRole="button">
      {g.user.mainPhotoUrl ? <Image source={{ uri: g.user.mainPhotoUrl }} style={styles.thumb} /> : <View style={[styles.thumb, { backgroundColor: colors.gray[200] }]} />}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.name}>
          {g.user.name}, {g.user.age}
          {g.user.reviewHoldAt ? '  · fora da descoberta' : ''}
          {g.user.accountStatus !== 'active' ? `  · ${g.user.accountStatus === 'banned' ? 'banida' : 'suspensa'}` : ''}
        </Text>
        <Text style={[styles.reasons, { color: PRIORITY_COLOR[Math.min(g.priority, 3)] }]} numberOfLines={2}>
          {reasons.join(' · ')}
        </Text>
        <Text style={styles.muted}>
          {g.reports.length} {g.reports.length === 1 ? 'denúncia' : 'denúncias'} de {g.distinctReporters} {g.distinctReporters === 1 ? 'pessoa' : 'pessoas'} · desde{' '}
          {new Date(g.firstAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>
    </Pressable>
  );
}

function Tab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.tab, active && styles.tabActive]} accessibilityRole="tab" accessibilityState={{ selected: active }}>
      <Text style={[styles.tabText, active && { color: colors.white }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  tabs: { flexDirection: 'row', gap: spacing.sm, padding: spacing.lg, paddingBottom: spacing.sm },
  tab: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: 999, backgroundColor: colors.gray[100] },
  tabActive: { backgroundColor: colors.black },
  tabText: { ...typography.bodySmall, fontWeight: '600', color: colors.black },
  list: { padding: spacing.lg, gap: spacing.md, flexGrow: 1 },
  empty: { ...typography.body, color: colors.gray[500], textAlign: 'center', marginTop: spacing.xxxl },
  card: { backgroundColor: colors.white, borderRadius: radius.lg, overflow: 'hidden' },
  groupRow: { flexDirection: 'row', gap: spacing.md, padding: spacing.md, alignItems: 'center' },
  thumb: { width: 52, height: 52, borderRadius: 26 },
  name: { ...typography.body, fontWeight: '700', color: colors.black },
  reasons: { ...typography.bodySmall, fontWeight: '600' },
  muted: { ...typography.caption, color: colors.gray[500] },
  photo: { width: '100%', aspectRatio: 1, backgroundColor: colors.gray[200] },
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  btn: { flex: 1, paddingVertical: spacing.sm + 2, borderRadius: radius.md, alignItems: 'center' },
  approve: { backgroundColor: colors.primary },
  reject: { backgroundColor: colors.danger },
  btnText: { ...typography.body, fontWeight: '700', color: colors.black },
});
