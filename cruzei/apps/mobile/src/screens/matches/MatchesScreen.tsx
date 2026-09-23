import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
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
import { useAuthStore } from '../../stores/auth';
import type { Match } from '@cruzei/shared-types';
import { colors, radius, shadows, spacing, typography } from '@cruzei/ui-mobile';
import type { MatchesStackParamList } from '../../navigation/MatchesStack';
import { timeAgo, formatChatExpiry } from '@cruzei/shared-utils';

export function MatchesScreen() {
  const nav = useNavigation<NativeStackNavigationProp<MatchesStackParamList>>();
  const myId = useAuthStore((s) => s.user?.id);

  const query = useQuery({
    queryKey: ['matches'],
    queryFn: async () => (await api.get<Match[]>('/matches')).data,
    refetchInterval: 30_000,
  });

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
        <Text style={styles.title}>matches</Text>
        <Text style={styles.subtitle}>
          {matches.length} {matches.length === 1 ? 'conversa rolando' : 'conversas rolando'}
          {unread > 0 ? ` · ${unread} não lida${unread > 1 ? 's' : ''}` : ''}
        </Text>
      </View>

      <FlatList
        data={matches}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.sm, flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => query.refetch()} tintColor={colors.primary} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="heart-circle-outline" size={64} color={colors.gray[300]} />
            <Text style={styles.emptyTitle}>sem matches ainda</Text>
            <Text style={styles.emptySub}>
              Sai um pouco, curte quem te interessar — quando rolar match você vê aqui.
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const hasUnread = (item.unreadCount ?? 0) > 0;
          const mine = item.lastMessage?.senderId === myId;
          return (
            <Pressable
              onPress={() => nav.navigate('Chat', { matchId: item.id, name: item.user.name })}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
            >
              {item.user.mainPhotoUrl ? (
                <Image source={{ uri: item.user.mainPhotoUrl }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarPlaceholder]}>
                  <Ionicons name="person" size={24} color={colors.gray[400]} />
                </View>
              )}
              <View style={styles.rowContent}>
                <View style={styles.rowHeader}>
                  <Text style={styles.name}>
                    {item.user.name}, {item.user.age}
                  </Text>
                  {item.lastMessage ? <Text style={styles.time}>{timeAgo(item.lastMessage.createdAt)}</Text> : null}
                </View>
                {item.context ? (
                  <Text style={styles.context} numberOfLines={1}>
                    📍 {item.context}
                  </Text>
                ) : null}
                {item.lastMessage ? (
                  <Text style={[styles.preview, hasUnread && styles.previewUnread]} numberOfLines={1}>
                    {mine ? 'você: ' : ''}
                    {item.lastMessage.content}
                  </Text>
                ) : (
                  <Text style={[styles.preview, { color: colors.info }]}>{formatChatExpiry(item.chatExpiresAt)} — manda um oi</Text>
                )}
              </View>
              {hasUnread ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{item.unreadCount}</Text>
                </View>
              ) : null}
            </Pressable>
          );
        }}
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
  row: { flexDirection: 'row', backgroundColor: colors.white, padding: spacing.md, borderRadius: radius.lg, alignItems: 'center', ...shadows.light },
  avatar: { width: 56, height: 56, borderRadius: 28, marginRight: spacing.md },
  avatarPlaceholder: { backgroundColor: colors.gray[100], alignItems: 'center', justifyContent: 'center' },
  rowContent: { flex: 1 },
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { ...typography.h4, color: colors.black },
  time: { ...typography.bodySmall, color: colors.gray[500] },
  context: { ...typography.bodySmall, color: colors.secondary, marginTop: 2 },
  preview: { ...typography.body, color: colors.gray[600], marginTop: 4 },
  previewUnread: { color: colors.black, fontWeight: '700' },
  badge: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, marginLeft: spacing.sm },
  badgeText: { ...typography.bodySmall, color: colors.black, fontWeight: '800' },
  empty: { alignItems: 'center', padding: spacing.xl, paddingTop: spacing.xxxl, gap: spacing.sm },
  emptyTitle: { ...typography.h2, color: colors.black },
  emptySub: { ...typography.body, color: colors.gray[600], textAlign: 'center' },
});
