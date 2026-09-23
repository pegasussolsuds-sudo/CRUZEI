import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { api, toApiError } from '../../services/api';
import { getSocket } from '../../services/socket';
import { useAuthStore } from '../../stores/auth';
import type { Message } from '@cruzei/shared-types';
import { colors, radius, spacing, typography } from '@cruzei/ui-mobile';
import { formatChatExpiry, timeAgo } from '@cruzei/shared-utils';
import type { MatchesStackParamList } from '../../navigation/MatchesStack';

type ChatMessage = Message & { pending?: boolean; failed?: boolean };

export function ChatScreen() {
  const route = useRoute<RouteProp<MatchesStackParamList, 'Chat'>>();
  const nav = useNavigation();
  const qc = useQueryClient();
  const { matchId, name } = route.params;
  const myId = useAuthStore((s) => s.user?.id);

  const [content, setContent] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const matchQuery = useQuery({
    queryKey: ['match', matchId],
    queryFn: async () => (await api.get(`/matches/${matchId}`)).data,
  });

  const historyQuery = useQuery({
    queryKey: ['messages', matchId],
    queryFn: async () => (await api.get<Message[]>(`/matches/${matchId}/messages`, { params: { limit: 100 } })).data,
  });

  const templatesQuery = useQuery({
    queryKey: ['templates', matchId],
    queryFn: async () => (await api.get<{ templates: string[] }>(`/matches/${matchId}/templates`)).data.templates,
  });

  useEffect(() => {
    nav.setOptions({ title: name });
  }, [nav, name]);

  // Histórico → estado local (mantém otimistas ainda pendentes)
  useEffect(() => {
    if (!historyQuery.data) return;
    setMessages((prev) => {
      const pending = prev.filter((m) => m.pending);
      return [...historyQuery.data!, ...pending];
    });
  }, [historyQuery.data]);

  // Marca como lidas as mensagens do outro
  useEffect(() => {
    const unread = messages.filter((m) => m.senderId !== myId && !m.readAt && !m.pending).map((m) => m.id);
    if (unread.length === 0) return;
    api.post(`/matches/${matchId}/messages/read`, { messageIds: unread }).then(() => {
      qc.invalidateQueries({ queryKey: ['matches'] });
    }).catch(() => {});
  }, [messages, myId, matchId, qc]);

  // Tempo real
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    socket.emit('join_match', { matchId });

    const onMessage = ({ matchId: mid, message }: { matchId: string; message: Message }) => {
      if (mid !== matchId) return;
      setMessages((prev) => {
        // reconcilia otimista pelo clientId, ou ignora duplicata
        const idx = message.clientId ? prev.findIndex((m) => m.clientId === message.clientId) : -1;
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...message, pending: false };
          return next;
        }
        if (prev.some((m) => m.id === message.id)) return prev;
        return [...prev, message];
      });
    };
    const onTyping = ({ matchId: mid, isTyping }: { matchId: string; userId: string; isTyping: boolean }) => {
      if (mid === matchId) setTyping(isTyping);
    };
    const onRead = ({ matchId: mid, messageIds, readAt }: { matchId: string; messageIds: string[]; readAt: string }) => {
      if (mid !== matchId) return;
      setMessages((prev) => prev.map((m) => (messageIds.includes(m.id) ? { ...m, readAt } : m)));
    };

    socket.on('message_received', onMessage);
    socket.on('typing_indicator', onTyping);
    socket.on('message_read', onRead);
    return () => {
      socket.emit('leave_match', { matchId });
      socket.off('message_received', onMessage);
      socket.off('typing_indicator', onTyping);
      socket.off('message_read', onRead);
    };
  }, [matchId]);

  const emitTyping = useCallback(
    (isTyping: boolean) => {
      getSocket()?.emit('typing', { matchId, isTyping });
    },
    [matchId],
  );

  const onChangeText = (t: string) => {
    setContent(t);
    emitTyping(true);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => emitTyping(false), 1500);
  };

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !myId) return;
    setError(null);
    emitTyping(false);
    const clientId = `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const optimistic: ChatMessage = {
      id: clientId,
      matchId,
      senderId: myId,
      type: 'text',
      content: trimmed,
      mediaUrl: null,
      mediaExpiresAt: null,
      readAt: null,
      createdAt: new Date().toISOString(),
      clientId,
      pending: true,
    };
    setContent('');
    setMessages((prev) => [...prev, optimistic]);
    try {
      const res = await api.post(`/matches/${matchId}/messages`, { content: trimmed, clientId });
      setMessages((prev) =>
        prev.map((m) => (m.clientId === clientId ? { ...m, id: res.data.id, createdAt: res.data.createdAt, pending: false } : m)),
      );
      qc.invalidateQueries({ queryKey: ['matches'] });
    } catch (err) {
      setMessages((prev) => prev.map((m) => (m.clientId === clientId ? { ...m, pending: false, failed: true } : m)));
      setError(toApiError(err).message);
    }
  };

  const expired = useMemo(() => {
    const at = matchQuery.data?.chatExpiresAt;
    return at ? new Date(at).getTime() < Date.now() : false;
  }, [matchQuery.data?.chatExpiresAt]);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {matchQuery.data ? (
        <View style={styles.banner}>
          <Ionicons name={expired ? 'time-outline' : 'location'} size={16} color={colors.secondary} />
          <Text style={styles.bannerText} numberOfLines={2}>
            {matchQuery.data.context ? `${matchQuery.data.context} · ` : ''}
            {formatChatExpiry(matchQuery.data.chatExpiresAt)}
          </Text>
        </View>
      ) : null}

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }} keyboardVerticalOffset={90}>
        {historyQuery.isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.list}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
            renderItem={({ item }) => {
              const isMe = item.senderId === myId;
              return (
                <View style={[styles.bubbleRow, isMe && styles.bubbleRowMe]}>
                  <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleOther, item.failed && styles.bubbleFailed]}>
                    <Text style={[styles.bubbleText, isMe && { color: colors.white }]}>{item.content}</Text>
                    <View style={styles.meta}>
                      <Text style={[styles.bubbleTime, isMe && { color: 'rgba(255,255,255,0.7)' }]}>
                        {item.pending ? 'enviando…' : item.failed ? 'falhou' : timeAgo(item.createdAt)}
                      </Text>
                      {isMe && !item.pending && !item.failed ? (
                        <Ionicons name={item.readAt ? 'checkmark-done' : 'checkmark'} size={14} color={item.readAt ? colors.primary : 'rgba(255,255,255,0.7)'} />
                      ) : null}
                    </View>
                  </View>
                </View>
              );
            }}
            ListEmptyComponent={
              <View style={styles.emptyChat}>
                <Ionicons name="chatbubbles-outline" size={48} color={colors.gray[300]} />
                <Text style={styles.emptyChatText}>Quebra o gelo com o contexto do cruzamento:</Text>
                {(templatesQuery.data ?? []).map((t) => (
                  <Pressable key={t} onPress={() => send(t)} style={styles.template}>
                    <Text style={styles.templateText}>{t}</Text>
                  </Pressable>
                ))}
              </View>
            }
            ListFooterComponent={typing ? <Text style={styles.typing}>{name} está digitando…</Text> : null}
          />
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {expired ? (
          <View style={styles.expired}>
            <Text style={styles.expiredText}>Esse chat expirou. Cruzem de novo pra reabrir por mais 48h.</Text>
          </View>
        ) : (
          <View style={styles.composer}>
            <TextInput
              style={styles.input}
              placeholder="manda uma mensagem..."
              placeholderTextColor={colors.gray[400]}
              value={content}
              onChangeText={onChangeText}
              multiline
              maxLength={500}
            />
            <Pressable
              onPress={() => send(content)}
              disabled={!content.trim()}
              style={({ pressed }) => [styles.sendBtn, (!content.trim() || pressed) && { opacity: 0.6 }]}
            >
              <Ionicons name="send" size={20} color={colors.black} />
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  banner: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, backgroundColor: '#FFE0F0', gap: spacing.sm },
  bannerText: { ...typography.bodySmall, color: colors.secondary, flex: 1 },
  list: { padding: spacing.lg, paddingBottom: spacing.md, gap: spacing.sm, flexGrow: 1 },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowMe: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '78%', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.lg },
  bubbleMe: { backgroundColor: colors.secondary, borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: colors.white, borderBottomLeftRadius: 4 },
  bubbleFailed: { opacity: 0.5 },
  bubbleText: { ...typography.body, color: colors.black },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2, alignSelf: 'flex-end' },
  bubbleTime: { ...typography.bodySmall, color: colors.gray[500], fontSize: 11 },
  typing: { ...typography.bodySmall, color: colors.gray[500], marginTop: spacing.sm, fontStyle: 'italic' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.gray[200], gap: spacing.sm, backgroundColor: colors.background },
  input: { flex: 1, backgroundColor: colors.white, borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, maxHeight: 100, ...typography.body, color: colors.black },
  sendBtn: { backgroundColor: colors.primary, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  emptyChat: { alignItems: 'center', padding: spacing.xl, gap: spacing.sm, flex: 1, justifyContent: 'center' },
  emptyChatText: { ...typography.body, color: colors.gray[500], textAlign: 'center', marginBottom: spacing.sm },
  template: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.gray[200], borderRadius: radius.full, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  templateText: { ...typography.bodySmall, color: colors.black },
  error: { ...typography.bodySmall, color: colors.danger, textAlign: 'center', paddingHorizontal: spacing.lg },
  expired: { padding: spacing.lg, backgroundColor: colors.gray[100], alignItems: 'center' },
  expiredText: { ...typography.bodySmall, color: colors.gray[600], textAlign: 'center' },
});
