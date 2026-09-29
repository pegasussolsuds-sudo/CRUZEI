import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import { useAuthStore } from '../../stores/auth';
import type { ConversationSummary, InboxFolder } from '@cruzei/shared-types';
import { colors, radius, shadows, spacing, typography } from '@cruzei/ui-mobile';
import type { InboxStackParamList } from '../../navigation/InboxStack';
import { timeAgo } from '@cruzei/shared-utils';
import { FadeInView, Pulse } from '../../components/animated';
import { LiveDot } from '../../components/animated/LiveDot';
import { PressScale } from '../../components/animated/PressScale';
import { CruzeiAvatar } from '../../components/avatar/CruzeiAvatar';
import { IdentityBubble } from '../../components/identity/IdentityBubble';
import { resolveAvatar } from '../../avatar';
import { SafetySheet, askBlock } from '../../components/safety/SafetySheet';
import { toApiError } from '../../services/api';
import { useInboxCounts, useInboxList, usePromoteRequest } from '../../hooks/useInbox';
import { useMessagingLocked } from '../../hooks/useMessagingLock';
import { MessagingLocked } from '../../components/inbox/MessagingLocked';

const AVATAR = 56;
const SYSTEM_PREVIEW = 'Vocês se curtiram. A conversa foi movida para a principal.';

type Nav = NativeStackNavigationProp<InboxStackParamList, 'InboxList'>;

/** texto da última mensagem na linha (a de sistema vai em itálico) */
function previewOf(c: ConversationSummary, myId: string | undefined): { text: string; system: boolean } {
  const m = c.lastMessage;
  if (!m) return { text: 'Conversa nova', system: true };
  if (m.messageType === 'system') return { text: m.body ?? SYSTEM_PREVIEW, system: true };
  return { text: `${m.senderId === myId ? 'você: ' : ''}${m.body ?? ''}`, system: false };
}

// ───────────────────────────────────────────────────────────────────────────────
// Linhas SEM Reanimated (PressScale / LiveDot nativos): com conversa chegando a toda hora a lista re-renderiza e remonta
// linhas o tempo todo — um mapper do Reanimated por linha derrubava o app no Moto g54 (worklets::ShareableArray)
// ───────────────────────────────────────────────────────────────────────────────
interface RowProps {
  item: ConversationSummary;
  myId: string | undefined;
  onPress: (item: ConversationSummary) => void;
  onLongPress: (item: ConversationSummary) => void;
}

/** Principal: avatar, nome, última mensagem, hora e não lidas (e o selo "aguardando resposta" de quem mandou) */
const InboxRow = memo(function InboxRow({ item, myId, onPress, onLongPress }: RowProps) {
  const unread = item.unreadCount;
  const hasUnread = unread > 0;
  const { text, system } = previewOf(item, myId);
  const name = item.peer.age ? `${item.peer.name}, ${item.peer.age}` : item.peer.name;
  const a11y = `${name}. ${item.awaitingReply ? 'aguardando resposta. ' : ''}${text}${hasUnread ? `. ${unread} não lida${unread > 1 ? 's' : ''}` : ''}`;

  return (
    <PressScale
      haptic={false}
      onPress={() => onPress(item)}
      onLongPress={() => onLongPress(item)}
      delayLongPress={350}
      pressedScale={0.98}
      style={styles.row}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityHint="abre a conversa; toque longo pra denunciar, bloquear ou arquivar"
      accessibilityActions={[{ name: 'longpress', label: 'Denunciar, bloquear ou arquivar' }]}
      onAccessibilityAction={(e) => (e.nativeEvent.actionName === 'longpress' ? onLongPress(item) : undefined)}
    >
      <View style={styles.avatarSlot}>
        <CruzeiAvatar
          config={resolveAvatar(item.peer.avatar, item.peer.id)}
          mode="bust"
          size={AVATAR}
          backgroundColor={colors.surfaceAlt}
          accessibilityLabel={`Avatar de ${item.peer.name}`}
        />
        {hasUnread ? (
          <View style={styles.dotAnchor} pointerEvents="none">
            <LiveDot halo size={12} borderColor={colors.white} />
          </View>
        ) : null}
      </View>

      <View style={styles.rowContent}>
        <View style={styles.rowHeader}>
          <Text style={[styles.name, hasUnread && styles.nameUnread]} numberOfLines={1}>
            {name}
          </Text>
          {item.lastMessageAt ? <Text style={styles.time}>{timeAgo(item.lastMessageAt)}</Text> : null}
        </View>
        <View style={styles.previewLine}>
          {item.isMuted ? <Ionicons name="notifications-off-outline" size={13} color={colors.gray[400]} /> : null}
          <Text style={[styles.preview, hasUnread && styles.previewUnread, system && styles.previewSystem]} numberOfLines={1}>
            {text}
          </Text>
        </View>
        {item.awaitingReply ? (
          <View style={styles.waitingPill}>
            <Ionicons name="hourglass-outline" size={11} color={colors.info} />
            <Text style={styles.waitingText} numberOfLines={1}>
              aguardando resposta
            </Text>
          </View>
        ) : null}
      </View>

      {hasUnread ? (
        <View style={styles.badge} accessible={false}>
          <Text style={styles.badgeText}>{unread > 99 ? '99+' : unread}</Text>
        </View>
      ) : null}
    </PressScale>
  );
});

interface RequestRowProps extends RowProps {
  busy: boolean;
  onPromote: (item: ConversationSummary) => void;
  onBlock: (item: ConversationSummary) => void;
  onReport: (item: ConversationSummary) => void;
}

/** Solicitações: foto + preview e as ações Mover para principal / Bloquear / Denunciar (duas linhas: cabe em 360 dp) */
const RequestRow = memo(function RequestRow({ item, myId, busy, onPress, onLongPress, onPromote, onBlock, onReport }: RequestRowProps) {
  const { text, system } = previewOf(item, myId);
  const name = item.peer.age ? `${item.peer.name}, ${item.peer.age}` : item.peer.name;
  const avatar = resolveAvatar(item.peer.avatar, item.peer.id);

  return (
    <View style={styles.requestCard}>
      <PressScale
        haptic={false}
        onPress={() => onPress(item)}
        onLongPress={() => onLongPress(item)}
        delayLongPress={350}
        pressedScale={0.98}
        style={styles.requestTop}
        accessibilityRole="button"
        accessibilityLabel={`${name} quer conversar. ${text}`}
        accessibilityHint="abre a conversa sem avisar que você leu"
      >
        {/* foto aprovada (ou o busto do avatar enquanto carrega / sem foto) */}
        <IdentityBubble photoUrl={item.peer.mainPhotoUrl} avatar={avatar} size={AVATAR} name={item.peer.name} ring="default" accessible={false} />
        <View style={styles.rowContent}>
          <View style={styles.rowHeader}>
            <Text style={[styles.name, styles.nameUnread]} numberOfLines={1}>
              {name}
            </Text>
            {item.lastMessageAt ? <Text style={styles.time}>{timeAgo(item.lastMessageAt)}</Text> : null}
          </View>
          <Text style={[styles.preview, styles.previewUnread, system && styles.previewSystem]} numberOfLines={2}>
            {text}
          </Text>
        </View>
      </PressScale>

      <Pressable
        onPress={() => onPromote(item)}
        disabled={busy}
        style={({ pressed }) => [styles.promoteBtn, (pressed || busy) && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`Mover a conversa com ${item.peer.name} para a principal`}
        accessibilityState={{ disabled: busy, busy }}
      >
        {busy ? <ActivityIndicator color={colors.black} /> : <Text style={styles.promoteText}>Mover para principal</Text>}
      </Pressable>
      <View style={styles.requestActions}>
        <Pressable
          onPress={() => onBlock(item)}
          style={({ pressed }) => [styles.ghostBtn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`Bloquear ${item.peer.name}`}
        >
          <Ionicons name="ban-outline" size={16} color={colors.gray[700]} />
          <Text style={styles.ghostText} numberOfLines={1}>
            Bloquear
          </Text>
        </Pressable>
        <Pressable
          onPress={() => onReport(item)}
          style={({ pressed }) => [styles.ghostBtn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`Denunciar ${item.peer.name}`}
        >
          <Ionicons name="flag-outline" size={16} color={colors.danger} />
          <Text style={[styles.ghostText, styles.dangerText]} numberOfLines={1}>
            Denunciar
          </Text>
        </Pressable>
      </View>
    </View>
  );
});

// ───────────────────────────────────────────────────────────────────────────────
// Controle segmentado Principal | Solicitações (N)
// ───────────────────────────────────────────────────────────────────────────────
function Segmented({ folder, requests, unreadInbox, onChange }: { folder: InboxFolder; requests: number; unreadInbox: number; onChange: (f: InboxFolder) => void }) {
  const tabs: { key: InboxFolder; label: string; a11y: string; dot: boolean }[] = [
    { key: 'inbox', label: 'Principal', a11y: unreadInbox > 0 ? `Principal, ${unreadInbox} com mensagem nova` : 'Principal', dot: unreadInbox > 0 },
    {
      key: 'requests',
      label: requests > 0 ? `Solicitações (${requests > 99 ? '99+' : requests})` : 'Solicitações',
      a11y: `Solicitações, ${requests}`,
      dot: false,
    },
  ];
  return (
    <View style={styles.segment} accessibilityRole="tablist">
      {tabs.map((t) => {
        const active = t.key === folder;
        return (
          <Pressable
            key={t.key}
            onPress={() => onChange(t.key)}
            style={[styles.segmentItem, active && styles.segmentActive]}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={t.a11y}
          >
            <Text style={[styles.segmentText, active && styles.segmentTextActive]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
              {t.label}
            </Text>
            {t.dot ? <View style={styles.segmentDot} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
// Tela
// ───────────────────────────────────────────────────────────────────────────────
export function InboxScreen() {
  const nav = useNavigation<Nav>();
  const route = useRoute<RouteProp<InboxStackParamList, 'InboxList'>>();
  const qc = useQueryClient();
  const myId = useAuthStore((s) => s.user?.id);
  const [folder, setFolder] = useState<InboxFolder>(route.params?.folder ?? 'inbox');
  useEffect(() => {
    if (route.params?.folder) setFolder(route.params.folder);
  }, [route.params?.folder]);

  // invisível sem Premium: o servidor não entrega as listas (403) — só a contagem, pro convite
  const locked = useMessagingLocked();
  const counts = useInboxCounts();
  const inboxQ = useInboxList('inbox', !locked);
  // solicitações só carregam quando a aba abre (o número do segmentado vem da contagem)
  const [requestsSeen, setRequestsSeen] = useState(folder === 'requests');
  useEffect(() => {
    if (folder === 'requests') setRequestsSeen(true);
  }, [folder]);
  const requestsQ = useInboxList('requests', !locked && (requestsSeen || folder === 'requests'));
  const query = folder === 'inbox' ? inboxQ : requestsQ;
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data]);
  const c = counts.data;

  const openChat = useCallback(
    (item: ConversationSummary) =>
      nav.navigate('Chat', { conversationId: item.id, peer: { id: item.peer.id, name: item.peer.name, avatar: item.peer.avatar } }),
    [nav],
  );

  // toque longo / Denunciar: a folha de segurança com a conversa (denunciar, bloquear, arquivar)
  const [safetyFor, setSafetyFor] = useState<{ item: ConversationSummary; step: 'menu' | 'reasons' } | null>(null);
  const openSafety = useCallback((item: ConversationSummary) => setSafetyFor({ item, step: 'menu' }), []);
  const openReport = useCallback((item: ConversationSummary) => setSafetyFor({ item, step: 'reasons' }), []);

  const promote = usePromoteRequest();
  const promoteMutate = promote.mutate;
  const promotingId = promote.isPending ? promote.variables : null;
  const onPromote = useCallback(
    (item: ConversationSummary) => promoteMutate(item.id, { onError: (e) => Alert.alert('Não deu pra mover', toApiError(e).message) }),
    [promoteMutate],
  );
  const onBlock = useCallback(
    (item: ConversationSummary) =>
      askBlock({ target: { id: item.peer.id, name: item.peer.name }, source: 'requests', conversationId: item.id, qc, onBlocked: () => undefined }),
    [qc],
  );

  const renderItem = useCallback(
    ({ item }: { item: ConversationSummary }) =>
      folder === 'inbox' ? (
        <InboxRow item={item} myId={myId} onPress={openChat} onLongPress={openSafety} />
      ) : (
        <RequestRow
          item={item}
          myId={myId}
          busy={promotingId === item.id}
          onPress={openChat}
          onLongPress={openSafety}
          onPromote={onPromote}
          onBlock={onBlock}
          onReport={openReport}
        />
      ),
    [folder, myId, openChat, openSafety, openReport, onPromote, onBlock, promotingId],
  );

  const onEndReached = useCallback(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
  }, [query]);

  const conversations = items.length;
  const unreadInbox = c?.unreadInbox ?? 0;
  const subtitle =
    folder === 'inbox'
      ? conversations === 0
        ? 'ninguém por aqui… ainda'
        : unreadInbox > 0
          ? `${unreadInbox} ${unreadInbox === 1 ? 'conversa' : 'conversas'} com mensagem nova`
          : query.hasNextPage
            ? 'suas conversas'
            : `${conversations} ${conversations === 1 ? 'conversa' : 'conversas'}`
      : 'Pedidos de conversa. Responder ou mover pra principal aceita; antes disso ninguém sabe que você leu.';

  if (locked) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">
            mensagens
          </Text>
        </View>
        <MessagingLocked waiting={(c?.unreadInbox ?? 0) + (c?.requests ?? 0)} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <FadeInView fromY={10}>
          <Text style={styles.title} accessibilityRole="header">
            mensagens
          </Text>
        </FadeInView>
        <Segmented folder={folder} requests={c?.requests ?? 0} unreadInbox={c?.unreadInbox ?? 0} onChange={setFolder} />
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>

      {query.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : (
        <FlatList
          key={folder}
          data={items}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.listContent}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.4}
          refreshControl={
            <RefreshControl
              refreshing={query.isRefetching && !query.isFetchingNextPage}
              onRefresh={() => {
                void query.refetch();
                void counts.refetch();
              }}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator style={styles.more} color={colors.primary} /> : null}
          ListEmptyComponent={
            query.isError ? (
              <View style={styles.empty}>
                <Ionicons name="cloud-offline-outline" size={56} color={colors.gray[300]} />
                <Text style={styles.emptyTitle}>não deu pra carregar</Text>
                <Text style={styles.emptySub}>{toApiError(query.error).message}</Text>
              </View>
            ) : folder === 'inbox' ? (
              <View style={styles.empty}>
                <FadeInView fromScale={0.7} fromY={10}>
                  <Pulse maxScale={1.08} minOpacity={0.8} cycleMs={2400}>
                    <View style={styles.emptyIcon}>
                      <Ionicons name="chatbubbles-outline" size={56} color={colors.secondary} />
                    </View>
                  </Pulse>
                </FadeInView>
                <FadeInView delay={120} fromY={10}>
                  <Text style={styles.emptyTitle}>nenhuma conversa ainda</Text>
                </FadeInView>
                <FadeInView delay={200} fromY={10}>
                  <Text style={styles.emptySub}>
                    Curte quem te chamar atenção ou manda uma mensagem direto do perfil. Quando vocês se curtirem ou a pessoa responder, a conversa fica aqui 💚
                  </Text>
                </FadeInView>
              </View>
            ) : (
              <View style={styles.empty}>
                <FadeInView fromScale={0.7} fromY={10}>
                  <View style={[styles.emptyIcon, styles.emptyIconRequests]}>
                    <Ionicons name="mail-open-outline" size={52} color={colors.info} />
                  </View>
                </FadeInView>
                <FadeInView delay={120} fromY={10}>
                  <Text style={styles.emptyTitle}>nenhuma solicitação</Text>
                </FadeInView>
                <FadeInView delay={200} fromY={10}>
                  <Text style={styles.emptySub}>Quando alguém com quem você ainda não conversa te mandar mensagem, ela chega aqui. Você decide se responde.</Text>
                </FadeInView>
              </View>
            )
          }
          renderItem={renderItem}
        />
      )}

      <SafetySheet
        visible={safetyFor !== null}
        initialStep={safetyFor?.step ?? 'menu'}
        onClose={() => setSafetyFor(null)}
        target={safetyFor ? { id: safetyFor.item.peer.id, name: safetyFor.item.peer.name } : null}
        conversationId={safetyFor?.item.id ?? null}
        source={folder === 'requests' ? 'requests' : 'inbox'}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xs, gap: spacing.sm },
  title: { ...typography.h1, color: colors.black },
  subtitle: { ...typography.bodySmall, color: colors.gray[600] },
  listContent: { padding: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm, flexGrow: 1 },
  more: { marginVertical: spacing.md },
  pressed: { opacity: 0.6 },
  dangerText: { color: colors.danger },

  segment: { flexDirection: 'row', backgroundColor: colors.gray[100], borderRadius: radius.full, padding: 4, gap: 4 },
  segmentItem: {
    flex: 1,
    minHeight: 40,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: spacing.sm,
  },
  segmentActive: { backgroundColor: colors.black },
  segmentText: { ...typography.label, color: colors.gray[600], flexShrink: 1 },
  segmentTextActive: { color: colors.white },
  segmentDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },

  row: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    padding: spacing.md,
    borderRadius: radius.lg,
    alignItems: 'center',
    minHeight: 80,
    ...shadows.light,
  },
  avatarSlot: { width: AVATAR, height: AVATAR, marginRight: spacing.md },
  dotAnchor: { position: 'absolute', right: -1, bottom: -1, width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },

  rowContent: { flex: 1, minWidth: 0 },
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  name: { ...typography.h4, color: colors.black, flexShrink: 1 },
  nameUnread: { fontFamily: typography.h4.fontFamily },
  time: { ...typography.bodySmall, color: colors.gray[500] },
  previewLine: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  preview: { ...typography.body, color: colors.gray[600], flexShrink: 1 },
  previewUnread: { color: colors.black, fontFamily: typography.label.fontFamily },
  previewSystem: { fontStyle: 'italic', color: colors.gray[500], fontFamily: typography.body.fontFamily },
  waitingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    marginTop: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
    backgroundColor: 'rgba(0,139,139,0.10)',
  },
  waitingText: { ...typography.caption, color: colors.info },

  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    marginLeft: spacing.sm,
  },
  badgeText: { ...typography.caption, color: colors.black, fontFamily: typography.label.fontFamily },

  requestCard: { backgroundColor: colors.white, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm, ...shadows.light },
  requestTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  promoteBtn: {
    minHeight: 44,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  promoteText: { ...typography.label, color: colors.black, textAlign: 'center' },
  requestActions: { flexDirection: 'row', gap: spacing.sm },
  ghostBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.gray[200],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm,
  },
  ghostText: { ...typography.label, color: colors.gray[700], flexShrink: 1 },

  empty: { alignItems: 'center', padding: spacing.xl, paddingTop: spacing.xxxl, gap: spacing.sm },
  emptyIcon: { width: 88, height: 88, borderRadius: 44, backgroundColor: '#FFE0F0', alignItems: 'center', justifyContent: 'center' },
  emptyIconRequests: { backgroundColor: 'rgba(0,139,139,0.10)' },
  emptyTitle: { ...typography.h2, color: colors.black, textAlign: 'center' },
  emptySub: { ...typography.body, color: colors.gray[600], textAlign: 'center' },
});
