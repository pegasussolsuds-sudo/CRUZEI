import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Animated, {
  cancelAnimation,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { api, toApiError } from '../../services/api';
import { getSocket } from '../../services/socket';
import { useAuthStore } from '../../stores/auth';
import type { MatchDetail, Message } from '@cruzei/shared-types';
import { colors, duration, fontFamily, radius, spacing, spring, typography } from '@cruzei/ui-mobile';
import { formatChatExpiry, timeAgo } from '@cruzei/shared-utils';
import type { MatchesStackParamList } from '../../navigation/MatchesStack';
import { FadeInView, Pulse, ScaleOnPress, SlideInView, TypingDots } from '../../components/animated';

type ChatMessage = Message & { pending?: boolean; failed?: boolean };

const MS_HOUR = 3_600_000;
const MS_MIN = 60_000;
const URGENT_HOURS = 12;
const EXPIRY_TICK_MS = 30_000;

/** chave estável do balão: clientId sobrevive à reconciliação otimista → sem remount */
const keyOf = (m: ChatMessage) => m.clientId ?? m.id;

// ───────────────────────────────────────────────────────────────────────────────
// Read receipt: ✓ cinza → ✓✓ verde-limão com crossfade + bounce quando readAt chega
// ───────────────────────────────────────────────────────────────────────────────
function ReadReceipt({ read }: { read: boolean }) {
  const p = useSharedValue(read ? 1 : 0);
  const bump = useSharedValue(1);
  const wasRead = useRef(read);

  useEffect(() => {
    if (read && !wasRead.current) {
      p.value = withTiming(1, { duration: duration.slow });
      bump.value = withSequence(withSpring(1.45, spring.snappy), withSpring(1, spring.press));
    } else if (!read) {
      p.value = withTiming(0, { duration: duration.fast });
    }
    wasRead.current = read;
    return () => {
      cancelAnimation(p);
      cancelAnimation(bump);
    };
  }, [read, p, bump]);

  const wrap = useAnimatedStyle(() => ({ transform: [{ scale: bump.value }] }));
  const sent = useAnimatedStyle(() => ({ opacity: 1 - p.value }));
  const seen = useAnimatedStyle(() => ({ opacity: p.value }));

  return (
    <Animated.View
      style={[styles.receipt, wrap]}
      accessibilityLabel={read ? 'lida' : 'enviada'}
      accessible
    >
      <Animated.View style={[styles.receiptLayer, sent]}>
        <Ionicons name="checkmark" size={14} color="rgba(255,255,255,0.7)" />
      </Animated.View>
      <Animated.View style={[styles.receiptLayer, seen]}>
        <Ionicons name="checkmark-done" size={14} color={colors.primary} />
      </Animated.View>
    </Animated.View>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
// Balão: entra com slide + bounce (spring) só quando é mensagem NOVA
// ───────────────────────────────────────────────────────────────────────────────
interface BubbleProps {
  item: ChatMessage;
  isMe: boolean;
  animateIn: boolean;
}

const Bubble = memo(function Bubble({ item, isMe, animateIn }: BubbleProps) {
  // decidido uma única vez por montagem — re-render por readAt não troca o wrapper
  const shouldAnimate = useRef(animateIn).current;

  const body = (
    <View style={[styles.bubbleRow, isMe && styles.bubbleRowMe]}>
      <View
        style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleOther, item.failed && styles.bubbleFailed, item.pending && styles.bubblePending]}
        accessibilityRole="text"
        accessibilityLabel={`${isMe ? 'você' : 'mensagem'}: ${item.content ?? ''}`}
      >
        <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>{item.content}</Text>
        <View style={styles.meta}>
          <Text style={[styles.bubbleTime, isMe && styles.bubbleTimeMe]}>
            {item.pending ? 'enviando…' : item.failed ? 'não foi 😕' : timeAgo(item.createdAt)}
          </Text>
          {isMe && !item.pending && !item.failed ? <ReadReceipt read={Boolean(item.readAt)} /> : null}
        </View>
      </View>
    </View>
  );

  if (!shouldAnimate) return body;
  return (
    <SlideInView from={isMe ? 'right' : 'left'} distance={36} springPreset="soft">
      {body}
    </SlideInView>
  );
});

// ───────────────────────────────────────────────────────────────────────────────
// Banner de expiração com timer ao vivo — pulsa magenta quando faltam < 12h
// ───────────────────────────────────────────────────────────────────────────────
function ExpiryBanner({ context, expiresAt, now }: { context: string | null; expiresAt: string; now: number }) {
  const msLeft = new Date(expiresAt).getTime() - now;
  const expired = msLeft <= 0;
  const hoursLeft = Math.floor(msLeft / MS_HOUR);
  const minsLeft = Math.floor((msLeft % MS_HOUR) / MS_MIN);
  const urgent = !expired && msLeft < URGENT_HOURS * MS_HOUR;

  let text: string;
  if (expired) text = 'Esse chat sumiu ⏳';
  else if (urgent) {
    const human = hoursLeft >= 1 ? `${hoursLeft}h` : `${Math.max(1, minsLeft)} min`;
    text = `Faltam ${human} pra esse chat sumir. Manda aquela mensagem 😉`;
  } else text = `${context ? `${context} · ` : ''}${formatChatExpiry(expiresAt)}`;

  const timer = expired ? '00:00' : `${String(hoursLeft).padStart(2, '0')}:${String(minsLeft).padStart(2, '0')}`;
  const tint = urgent ? colors.white : colors.secondary;

  return (
    <Pulse active={urgent} maxScale={1.015} minOpacity={0.82} cycleMs={duration.pulse * 1.4} style={styles.bannerWrap}>
      <View style={[styles.banner, urgent && styles.bannerUrgent]} accessibilityRole="text" accessibilityLabel={text} accessibilityLiveRegion="polite">
        <Ionicons name={expired ? 'time-outline' : urgent ? 'flash' : 'location'} size={16} color={tint} />
        <Text style={[styles.bannerText, { color: tint }]} numberOfLines={2}>
          {text}
        </Text>
        {!expired ? (
          <Text style={[styles.bannerTimer, { color: tint }]} accessibilityLabel={`tempo restante ${hoursLeft} horas e ${minsLeft} minutos`}>
            {timer}
          </Text>
        ) : null}
      </View>
    </Pulse>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
// Tela
// ───────────────────────────────────────────────────────────────────────────────
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
  const [now, setNow] = useState(() => Date.now());
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** ids/clientIds já exibidos — só o que NÃO está aqui entra animado */
  const seenIds = useRef<Set<string>>(new Set());

  const matchQuery = useQuery({
    queryKey: ['match', matchId],
    queryFn: async () => (await api.get<MatchDetail>(`/matches/${matchId}`)).data,
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

  // Relógio do banner: recalcula a cada 30s
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), EXPIRY_TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Histórico → estado local (mantém otimistas ainda pendentes). Histórico nunca anima.
  useEffect(() => {
    if (!historyQuery.data) return;
    for (const m of historyQuery.data) {
      seenIds.current.add(m.id);
      if (m.clientId) seenIds.current.add(m.clientId);
    }
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

  // Quando o outro começa a digitar, mostra o balão no fim da lista
  useEffect(() => {
    if (typing) listRef.current?.scrollToEnd({ animated: true });
  }, [typing]);

  useEffect(
    () => () => {
      if (typingTimer.current) clearTimeout(typingTimer.current);
    },
    [],
  );

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
      const res = await api.post<{ id: string; createdAt: string }>(`/matches/${matchId}/messages`, { content: trimmed, clientId });
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
    return at ? new Date(at).getTime() < now : false;
  }, [matchQuery.data?.chatExpiresAt, now]);

  // ── Composer: foco animado + botão enviar que "acende" quando há texto ──────
  const focus = useSharedValue(0);
  const canSend = useSharedValue(0);
  const hasText = content.trim().length > 0;

  useEffect(() => {
    canSend.value = withSpring(hasText ? 1 : 0, spring.snappy);
  }, [hasText, canSend]);

  useEffect(
    () => () => {
      cancelAnimation(focus);
      cancelAnimation(canSend);
    },
    [focus, canSend],
  );

  const inputAnim = useAnimatedStyle(() => ({
    borderColor: interpolateColor(focus.value, [0, 1], [colors.gray[200], colors.primary]),
    shadowOpacity: 0.25 * focus.value,
    shadowRadius: 6 + 6 * focus.value,
    elevation: 3 * focus.value,
  }));
  const sendAnim = useAnimatedStyle(() => ({
    opacity: 0.45 + 0.55 * canSend.value,
    transform: [{ scale: 0.9 + 0.1 * canSend.value }, { rotate: `${-12 * (1 - canSend.value)}deg` }],
  }));

  const renderItem = useCallback(
    ({ item }: { item: ChatMessage }) => {
      const key = keyOf(item);
      const isNew = !seenIds.current.has(key) && !seenIds.current.has(item.id);
      if (isNew) {
        seenIds.current.add(key);
        seenIds.current.add(item.id);
      }
      return <Bubble item={item} isMe={item.senderId === myId} animateIn={isNew} />;
    },
    [myId],
  );

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {matchQuery.data ? (
        <ExpiryBanner context={matchQuery.data.context} expiresAt={matchQuery.data.chatExpiresAt} now={now} />
      ) : null}

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex} keyboardVerticalOffset={90}>
        {historyQuery.isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={keyOf}
            contentContainerStyle={styles.list}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
            keyboardShouldPersistTaps="handled"
            renderItem={renderItem}
            ListEmptyComponent={
              <View style={styles.emptyChat}>
                <FadeInView fromScale={0.8} fromY={8}>
                  <Ionicons name="chatbubbles-outline" size={48} color={colors.gray[300]} />
                </FadeInView>
                <FadeInView delay={80} fromY={8}>
                  <Text style={styles.emptyChatTitle}>Vocês se cruzaram. E agora?</Text>
                  <Text style={styles.emptyChatText}>Quebra o gelo com o contexto do cruzamento:</Text>
                </FadeInView>
                {(templatesQuery.data ?? []).map((t, i) => (
                  <FadeInView key={t} delay={160 + i * 60} fromY={10} style={styles.templateWrap}>
                    <ScaleOnPress
                      onPress={() => send(t)}
                      style={styles.template}
                      accessibilityRole="button"
                      accessibilityLabel={`enviar: ${t}`}
                    >
                      <Text style={styles.templateText}>{t}</Text>
                    </ScaleOnPress>
                  </FadeInView>
                ))}
              </View>
            }
            ListFooterComponent={
              typing ? (
                <FadeInView fromY={6} fromScale={0.9} style={styles.bubbleRow}>
                  <View style={[styles.bubble, styles.bubbleTyping]} accessibilityLabel={`${name} está digitando`} accessible>
                    <TypingDots color={colors.gray[500]} />
                  </View>
                </FadeInView>
              ) : null
            }
          />
        )}

        {error ? (
          <FadeInView fromY={6}>
            <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text>
          </FadeInView>
        ) : null}

        {expired ? (
          <FadeInView fromY={12} style={styles.expired}>
            <Ionicons name="hourglass-outline" size={18} color={colors.gray[500]} />
            <Text style={styles.expiredText}>Esse chat expirou. Cruzem de novo pra reabrir por mais 48h.</Text>
          </FadeInView>
        ) : (
          <View style={styles.composer}>
            <Animated.View style={[styles.inputWrap, inputAnim]}>
              <TextInput
                style={styles.input}
                placeholder="manda uma mensagem..."
                placeholderTextColor={colors.gray[400]}
                value={content}
                onChangeText={onChangeText}
                onFocus={() => {
                  focus.value = withTiming(1, { duration: duration.base });
                }}
                onBlur={() => {
                  focus.value = withTiming(0, { duration: duration.fast });
                }}
                multiline
                maxLength={500}
                accessibilityLabel="campo de mensagem"
                accessibilityHint="escreve e toca em enviar"
              />
            </Animated.View>
            <Animated.View style={sendAnim}>
              <ScaleOnPress
                onPress={() => send(content)}
                disabled={!hasText}
                pressedScale={0.88}
                glowColor={colors.primary}
                style={styles.sendBtn}
                accessibilityRole="button"
                accessibilityLabel="enviar mensagem"
                accessibilityState={{ disabled: !hasText }}
              >
                <Ionicons name="send" size={20} color={colors.black} />
              </ScaleOnPress>
            </Animated.View>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  bannerWrap: { alignSelf: 'stretch' },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    backgroundColor: '#FFE0F0',
    gap: spacing.sm,
    minHeight: 44,
  },
  bannerUrgent: { backgroundColor: colors.secondary },
  bannerText: { ...typography.bodySmall, flex: 1 },
  bannerTimer: { fontFamily: fontFamily.mono, fontSize: 13, letterSpacing: 0.5 },

  list: { padding: spacing.lg, paddingBottom: spacing.md, gap: spacing.sm, flexGrow: 1 },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowMe: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '78%', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.lg },
  bubbleMe: { backgroundColor: colors.secondary, borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: colors.white, borderBottomLeftRadius: 4 },
  bubbleTyping: { backgroundColor: colors.gray[200], borderBottomLeftRadius: 4, paddingVertical: spacing.md, justifyContent: 'center' },
  bubbleFailed: { opacity: 0.5 },
  bubblePending: { opacity: 0.75 },
  bubbleText: { ...typography.body, color: colors.black },
  bubbleTextMe: { color: colors.white },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2, alignSelf: 'flex-end' },
  bubbleTime: { ...typography.bodySmall, color: colors.gray[500], fontSize: 11 },
  bubbleTimeMe: { color: 'rgba(255,255,255,0.7)' },
  receipt: { width: 16, height: 16, alignItems: 'center', justifyContent: 'center' },
  receiptLayer: { position: 'absolute' },

  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.gray[200],
    gap: spacing.sm,
    backgroundColor: colors.background,
  },
  inputWrap: {
    flex: 1,
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.gray[200],
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
  },
  input: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm + 2, minHeight: 44, maxHeight: 100, ...typography.body, color: colors.black },
  sendBtn: { backgroundColor: colors.primary, width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },

  emptyChat: { alignItems: 'center', padding: spacing.xl, gap: spacing.sm, flex: 1, justifyContent: 'center' },
  emptyChatTitle: { ...typography.h3, color: colors.black, textAlign: 'center', marginTop: spacing.sm },
  emptyChatText: { ...typography.body, color: colors.gray[500], textAlign: 'center', marginTop: spacing.xs, marginBottom: spacing.sm },
  templateWrap: { alignSelf: 'stretch', alignItems: 'center' },
  template: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray[200],
    borderRadius: radius.full,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 44,
    justifyContent: 'center',
  },
  templateText: { ...typography.bodySmall, color: colors.black },

  error: { ...typography.bodySmall, color: colors.danger, textAlign: 'center', paddingHorizontal: spacing.lg, paddingBottom: spacing.xs },
  expired: { flexDirection: 'row', gap: spacing.sm, padding: spacing.lg, backgroundColor: colors.gray[100], alignItems: 'center', justifyContent: 'center' },
  expiredText: { ...typography.bodySmall, color: colors.gray[600], textAlign: 'center', flexShrink: 1 },
});
