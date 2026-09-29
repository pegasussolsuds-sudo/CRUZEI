import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, AppState, FlatList, Linking, Pressable, RefreshControl, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import type { AppNotification, NotificationSettings } from '@cruzei/shared-types';
import { colors, fontFamily, radius, shadows, spacing, typography } from '@cruzei/ui-mobile';
import { timeAgo } from '@cruzei/shared-utils';
import { PressScale } from '../../components/animated/PressScale';
import { toApiError } from '../../services/api';
import { pushPermissionState, requestPushPermission, type PushPermission } from '../../services/notifications';
import { routeForNotification } from '../../services/notificationTarget';
import { openTargetRoute } from '../../navigation/openTarget';
import {
  flattenNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  unreadNotifications,
  useNotificationList,
  useNotificationSettings,
  useUpdateNotificationSettings,
} from '../../hooks/useNotifications';

const ICON: Record<string, { name: string; color: string; bg: string }> = {
  event: { name: 'flash', color: '#7A2FD0', bg: 'rgba(155,92,255,0.14)' },
  support_reply: { name: 'chatbubbles', color: colors.info, bg: 'rgba(0,139,139,0.12)' },
  premium_granted: { name: 'diamond', color: colors.secondary, bg: 'rgba(255,20,147,0.10)' },
  place_approved: { name: 'location', color: '#3A7A00', bg: '#E9FFC7' },
  campaign: { name: 'megaphone', color: colors.black, bg: colors.gray[100] },
  moderation_warning: { name: 'warning', color: '#B26B00', bg: 'rgba(255,184,0,0.16)' },
};
const DEFAULT_ICON = { name: 'notifications', color: colors.black, bg: colors.gray[100] };

// Linha SEM Reanimated (PressScale nativo): a lista re-renderiza a cada aviso novo e marcação de lida
const NotificationRow = memo(function NotificationRow({ item, onPress }: { item: AppNotification; onPress: (n: AppNotification) => void }) {
  const unread = !item.readAt;
  const icon = ICON[item.type] ?? DEFAULT_ICON;
  const opens = routeForNotification(item) != null;
  return (
    <PressScale
      haptic={false}
      pressedScale={0.985}
      onPress={() => onPress(item)}
      style={[styles.row, unread && styles.rowUnread]}
      accessibilityRole="button"
      accessibilityLabel={`${unread ? 'Não lido. ' : ''}${item.title}${item.body ? `. ${item.body}` : ''}. ${timeAgo(item.sentAt)}`}
      accessibilityHint={opens ? 'abre o aviso' : undefined}
    >
      <View style={[styles.icon, { backgroundColor: icon.bg }]}>
        <Ionicons name={icon.name as never} size={20} color={icon.color} />
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowHead}>
          <Text style={[styles.title, unread && styles.titleUnread]} numberOfLines={2}>
            {item.title}
          </Text>
          <Text style={styles.time}>{timeAgo(item.sentAt)}</Text>
        </View>
        {item.body ? (
          <Text style={styles.body} numberOfLines={3}>
            {item.body}
          </Text>
        ) : null}
      </View>
      {unread ? <View style={styles.dot} /> : opens ? <Ionicons name="chevron-forward" size={18} color={colors.gray[400]} /> : null}
    </PressScale>
  );
});

/** push desligado: dá pra ativar daqui (quem disse "agora não" no pedido único) ou pelos ajustes do sistema */
function PushBanner() {
  const [state, setState] = useState<PushPermission | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    const check = () => pushPermissionState().then((s) => alive && setState(s));
    void check();
    // voltou dos ajustes do sistema: confere de novo
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void check();
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  if (state == null || state === 'granted' || state === 'unsupported') return null;
  const onPress = async () => {
    if (state === 'blocked') {
      Linking.openSettings().catch(() => undefined);
      return;
    }
    setBusy(true);
    const ok = await requestPushPermission();
    setBusy(false);
    setState(ok ? 'granted' : await pushPermissionState());
  };
  return (
    <View style={styles.banner}>
      <Ionicons name="notifications-off-outline" size={20} color={colors.gray[700]} />
      <Text style={styles.bannerText}>Avisos no celular desligados. Liga pra saber de eventos perto e das respostas do suporte.</Text>
      <Pressable
        onPress={onPress}
        disabled={busy}
        style={({ pressed }) => [styles.bannerBtn, (pressed || busy) && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={state === 'blocked' ? 'Abrir ajustes de notificação' : 'Ativar avisos no celular'}
      >
        {busy ? <ActivityIndicator color={colors.black} /> : <Text style={styles.bannerBtnText}>{state === 'blocked' ? 'Ajustes' : 'Ativar'}</Text>}
      </Pressable>
    </View>
  );
}

const PREFS: { key: keyof NotificationSettings; label: string; hint: string }[] = [
  { key: 'events', label: 'Eventos perto de você', hint: 'shows, festas e o que tá rolando na sua região' },
  { key: 'campaigns', label: 'Novidades do Metch', hint: 'avisos gerais e novidades do app' },
];

/** o que chegar de campanha (suporte, Premium e lugar aprovado são da conta e sempre chegam) */
function Preferences() {
  const settings = useNotificationSettings();
  const update = useUpdateNotificationSettings();
  const s = settings.data;
  if (!s) return null;
  return (
    <View style={styles.prefs}>
      <Text style={styles.prefsTitle}>receber avisos de</Text>
      {PREFS.map((p, i) => (
        <View key={p.key} style={[styles.prefRow, i === PREFS.length - 1 && styles.prefRowLast]}>
          <View style={styles.prefText}>
            <Text style={styles.prefLabel}>{p.label}</Text>
            <Text style={styles.prefHint}>{p.hint}</Text>
          </View>
          <Switch
            value={s[p.key]}
            onValueChange={(v) =>
              update.mutate({ [p.key]: v }, { onError: () => Alert.alert('Não deu pra salvar', 'Tenta de novo daqui a pouco.') })
            }
            trackColor={{ false: colors.gray[200], true: colors.primary }}
            thumbColor={colors.white}
            accessibilityLabel={p.label}
            accessibilityHint={p.hint}
          />
        </View>
      ))}
      <Text style={styles.prefsNote}>Respostas do suporte e avisos sobre a sua conta sempre chegam.</Text>
    </View>
  );
}

/** Central de avisos: eventos, respostas do suporte, Premium, lugar aprovado e campanhas */
export function NotificationsScreen() {
  const qc = useQueryClient();
  const query = useNotificationList();
  const items = useMemo(() => flattenNotifications(query.data), [query.data]);
  const unread = unreadNotifications(query.data);
  const [markingAll, setMarkingAll] = useState(false);

  const onPress = useCallback(
    (n: AppNotification) => {
      // sempre: o servidor conta o "abriu" da campanha uma vez só, mesmo se o aviso já estava lido
      void markNotificationRead(qc, n.id);
      const route = routeForNotification(n);
      if (route) openTargetRoute(route, qc);
    },
    [qc],
  );

  const onMarkAll = async () => {
    setMarkingAll(true);
    const ok = await markAllNotificationsRead(qc);
    setMarkingAll(false);
    if (!ok) Alert.alert('Não deu agora', 'Tenta de novo daqui a pouco.');
  };

  const onEndReached = useCallback(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
  }, [query]);

  const renderItem = useCallback(({ item }: { item: AppNotification }) => <NotificationRow item={item} onPress={onPress} />, [onPress]);

  const header = (
    <View style={styles.header}>
      <PushBanner />
      {items.length > 0 ? (
        <View style={styles.headRow}>
          <Text style={styles.headText}>{unread > 0 ? `${unread > 99 ? '99+' : unread} ${unread === 1 ? 'aviso novo' : 'avisos novos'}` : 'tudo lido'}</Text>
          {unread > 0 ? (
            <Pressable
              onPress={onMarkAll}
              disabled={markingAll}
              hitSlop={8}
              style={({ pressed }) => [styles.markAll, (pressed || markingAll) && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Marcar todas como lidas"
            >
              <Ionicons name="checkmark-done" size={16} color={colors.black} />
              <Text style={styles.markAllText}>Marcar todas como lidas</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {query.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(n) => n.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ListHeaderComponent={header}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={query.isRefetching && !query.isFetchingNextPage}
              onRefresh={() => void query.refetch()}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          ListFooterComponent={
            <>
              {query.isFetchingNextPage ? <ActivityIndicator style={styles.more} color={colors.primary} /> : null}
              {query.hasNextPage ? null : <Preferences />}
            </>
          }
          ListEmptyComponent={
            query.isError ? (
              <View style={styles.empty}>
                <Ionicons name="cloud-offline-outline" size={52} color={colors.gray[300]} />
                <Text style={styles.emptyTitle}>não deu pra carregar</Text>
                <Text style={styles.emptySub}>{toApiError(query.error).message}</Text>
                <Pressable onPress={() => void query.refetch()} style={styles.retry} accessibilityRole="button">
                  <Text style={styles.retryText}>Tentar de novo</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.empty}>
                <View style={styles.emptyIcon}>
                  <Ionicons name="notifications-outline" size={44} color={colors.info} />
                </View>
                <Text style={styles.emptyTitle}>nenhum aviso por enquanto</Text>
                <Text style={styles.emptySub}>Eventos perto de você, respostas do suporte e novidades do Metch aparecem aqui.</Text>
              </View>
            )
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm, flexGrow: 1 },
  more: { marginVertical: spacing.md },
  pressed: { opacity: 0.6 },

  header: { gap: spacing.sm, marginBottom: spacing.xs },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, minHeight: 36 },
  headText: { ...typography.bodySmall, color: colors.gray[600], flexShrink: 1 },
  markAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.gray[100],
  },
  markAllText: { ...typography.caption, fontFamily: fontFamily.bodySemiBold, color: colors.black },

  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.gray[200],
  },
  bannerText: { ...typography.bodySmall, color: colors.gray[700], flex: 1 },
  bannerBtn: { minHeight: 40, minWidth: 72, paddingHorizontal: spacing.md, borderRadius: radius.full, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  bannerBtnText: { ...typography.label, color: colors.black },

  // colors.white é igual ao fundo: o cartão precisa de borda
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.gray[200],
    ...shadows.light,
  },
  rowUnread: { borderColor: 'rgba(127,255,0,0.75)', backgroundColor: '#FBFFF5' },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1, minWidth: 0, gap: 2 },
  rowHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  title: { ...typography.body, color: colors.black, flex: 1 },
  titleUnread: { fontFamily: fontFamily.bodySemiBold },
  time: { ...typography.caption, color: colors.gray[500], marginTop: 2 },
  body: { ...typography.bodySmall, color: colors.gray[600], lineHeight: 18 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary, marginTop: spacing.xs, borderWidth: 1, borderColor: '#5FBF00' },

  prefs: {
    marginTop: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.gray[200],
  },
  prefsTitle: { ...typography.caption, fontFamily: fontFamily.bodySemiBold, color: colors.gray[500], textTransform: 'uppercase', letterSpacing: 0.8 },
  prefRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 56, borderBottomWidth: 1, borderBottomColor: colors.gray[100] },
  prefRowLast: { borderBottomWidth: 0 },
  prefText: { flex: 1 },
  prefLabel: { ...typography.body, color: colors.black },
  prefHint: { ...typography.caption, color: colors.gray[500], marginTop: 1 },
  prefsNote: { ...typography.caption, color: colors.gray[500], paddingTop: spacing.xs },

  empty: { alignItems: 'center', padding: spacing.xl, paddingTop: spacing.xxxl, gap: spacing.sm },
  emptyIcon: { width: 84, height: 84, borderRadius: 42, backgroundColor: 'rgba(0,139,139,0.10)', alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { ...typography.h3, color: colors.black, textAlign: 'center' },
  emptySub: { ...typography.body, color: colors.gray[600], textAlign: 'center' },
  retry: { marginTop: spacing.sm, minHeight: 44, paddingHorizontal: spacing.xl, borderRadius: radius.full, backgroundColor: colors.primary, justifyContent: 'center' },
  retryText: { ...typography.label, color: colors.black },
});
