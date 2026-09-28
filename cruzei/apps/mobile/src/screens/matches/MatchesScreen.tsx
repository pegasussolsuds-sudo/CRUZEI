import React, { memo, useCallback } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';

import { api } from '../../services/api';
import { matchesPollMs } from '../../services/socket';
import { useAuthStore } from '../../stores/auth';
import type { Match } from '@cruzei/shared-types';
import { colors, radius, shadows, spacing, typography } from '@cruzei/ui-mobile';
import type { MatchesStackParamList } from '../../navigation/MatchesStack';
import { timeAgo, formatChatExpiry } from '@cruzei/shared-utils';
import { FadeInView, Pulse } from '../../components/animated';
import { LiveDot } from '../../components/animated/LiveDot';
import { PressScale } from '../../components/animated/PressScale';
import { CruzeiAvatar } from '../../components/avatar/CruzeiAvatar';
import { resolveAvatar } from '../../avatar';

const AVATAR = 56;
const MATCHES_LIMIT = 100; // servidor aceita até 200; chats duram 48h, então a lista ativa é curta

// ───────────────────────────────────────────────────────────────────────────────
// Linha do match: avatar Cruzei (o mesmo do mapa), dot pulsando se há não lidas
// ───────────────────────────────────────────────────────────────────────────────
interface MatchRowProps {
  item: Match;
  myId: string | undefined;
  onPress: (item: Match) => void;
}

const MatchRow = memo(function MatchRow({ item, myId, onPress }: MatchRowProps) {
  const hasUnread = (item.unreadCount ?? 0) > 0;
  const mine = item.lastMessage?.senderId === myId;
  const preview = item.lastMessage
    ? `${mine ? 'você: ' : ''}${item.lastMessage.content}`
    : `${formatChatExpiry(item.chatExpiresAt)} — manda um oi`;
  const a11y = `${item.user.name}, ${item.user.age}. ${item.context ? `cruzaram em ${item.context}. ` : ''}${preview}${
    hasUnread ? `. ${item.unreadCount} não lida${item.unreadCount > 1 ? 's' : ''}` : ''
  }`;

  // linha SEM Reanimated (PressScale / LiveDot): com conversa chegando a toda hora a lista re-renderiza e remonta
  // linhas o tempo todo — um mapper do Reanimated por linha derrubava o app no Moto g54 (worklets::ShareableArray)
  return (
      <PressScale
        haptic={false}
        onPress={() => onPress(item)}
        pressedScale={0.98}
        style={styles.row}
        accessibilityRole="button"
        accessibilityLabel={a11y}
        accessibilityHint="abre a conversa"
      >
        <View style={styles.avatarSlot}>
          <CruzeiAvatar
            config={resolveAvatar(item.user.avatar, item.user.id)}
            mode="bust"
            size={AVATAR}
            backgroundColor={colors.surfaceAlt}
            accessibilityLabel={`Avatar de ${item.user.name}`}
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
              {item.user.name}, {item.user.age}
            </Text>
            {item.lastMessage ? <Text style={styles.time}>{timeAgo(item.lastMessage.createdAt)}</Text> : null}
          </View>
          {item.context ? (
            <Text style={styles.context} numberOfLines={1}>
              📍 {item.context}
            </Text>
          ) : null}
          <Text style={[styles.preview, hasUnread && styles.previewUnread, !item.lastMessage && styles.previewNudge]} numberOfLines={1}>
            {preview}
          </Text>
        </View>

        {hasUnread ? (
          <View style={styles.badge} accessible={false}>
            <Text style={styles.badgeText}>{item.unreadCount}</Text>
          </View>
        ) : null}
      </PressScale>
  );
});

// ───────────────────────────────────────────────────────────────────────────────
// Tela
// ───────────────────────────────────────────────────────────────────────────────
export function MatchesScreen() {
  const nav = useNavigation<NativeStackNavigationProp<MatchesStackParamList>>();
  const myId = useAuthStore((s) => s.user?.id);

  // o servidor corta em 20 por padrão (teto 200) — pede o bastante pra não sumir conversa antiga.
  // chave própria (prefixo ['matches'] continua invalidando) pra não brigar com o cache do badge
  const query = useQuery({
    queryKey: ['matches', { limit: MATCHES_LIMIT }],
    queryFn: async () => (await api.get<Match[]>('/matches', { params: { limit: MATCHES_LIMIT } })).data,
    refetchInterval: matchesPollMs,
  });

  const openChat = useCallback(
    (item: Match) => nav.navigate('Chat', { matchId: item.id, name: item.user.name }),
    [nav],
  );

  const renderItem = useCallback(
    ({ item }: { item: Match }) => <MatchRow item={item} myId={myId} onPress={openChat} />,
    [myId, openChat],
  );

  if (query.isLoading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </SafeAreaView>
    );
  }

  const matches = query.data ?? [];
  const unread = matches.reduce((n, m) => n + (m.unreadCount ?? 0), 0);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <FadeInView fromY={10}>
          <Text style={styles.title} accessibilityRole="header">
            matches
          </Text>
        </FadeInView>
        <FadeInView delay={60} fromY={8}>
          <Text style={styles.subtitle}>
            {matches.length === 0
              ? 'ninguém por aqui… ainda'
              : `${matches.length} ${matches.length === 1 ? 'conversa rolando' : 'conversas rolando'}`}
            {unread > 0 ? ` · ${unread} não lida${unread > 1 ? 's' : ''}` : ''}
          </Text>
        </FadeInView>
      </View>

      <FlatList
        data={matches}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} tintColor={colors.primary} colors={[colors.primary]} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <FadeInView fromScale={0.7} fromY={10}>
              <Pulse maxScale={1.08} minOpacity={0.8} cycleMs={2400}>
                <View style={styles.emptyIcon}>
                  <Ionicons name="heart-circle-outline" size={64} color={colors.secondary} />
                </View>
              </Pulse>
            </FadeInView>
            <FadeInView delay={120} fromY={10}>
              <Text style={styles.emptyTitle}>ninguém cruzou ainda</Text>
            </FadeInView>
            <FadeInView delay={200} fromY={10}>
              <Text style={styles.emptySub}>
                Sai de casa, passa naquele bar, curte quem te chamar atenção. Quando rolar match, a conversa aparece aqui 💚
              </Text>
            </FadeInView>
            <FadeInView delay={300} fromY={10}>
              <Text style={styles.emptyHint}>Lembra: cada chat dura 48h. Sem enrolação.</Text>
            </FadeInView>
          </View>
        }
        renderItem={renderItem}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  header: { padding: spacing.lg, paddingBottom: spacing.sm },
  title: { ...typography.h1, color: colors.black },
  subtitle: { ...typography.body, color: colors.gray[600], marginTop: spacing.xs },
  listContent: { padding: spacing.lg, gap: spacing.sm, flexGrow: 1 },

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

  rowContent: { flex: 1 },
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  name: { ...typography.h4, color: colors.black, flexShrink: 1 },
  nameUnread: { fontFamily: typography.h4.fontFamily },
  time: { ...typography.bodySmall, color: colors.gray[500] },
  context: { ...typography.bodySmall, color: colors.secondary, marginTop: 2 },
  preview: { ...typography.body, color: colors.gray[600], marginTop: 4 },
  previewUnread: { color: colors.black, fontFamily: typography.label.fontFamily },
  previewNudge: { color: colors.info },

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

  empty: { alignItems: 'center', padding: spacing.xl, paddingTop: spacing.xxxl, gap: spacing.sm },
  emptyIcon: { width: 88, height: 88, borderRadius: 44, backgroundColor: '#FFE0F0', alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { ...typography.h2, color: colors.black, textAlign: 'center' },
  emptySub: { ...typography.body, color: colors.gray[600], textAlign: 'center' },
  emptyHint: { ...typography.bodySmall, color: colors.gray[500], textAlign: 'center', marginTop: spacing.sm },
});
