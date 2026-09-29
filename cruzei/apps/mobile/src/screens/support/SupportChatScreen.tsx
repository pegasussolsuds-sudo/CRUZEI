import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, Keyboard, KeyboardAvoidingView, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { useHeaderHeight } from '@react-navigation/elements';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { SUPPORT_LIMITS, type SupportMessageEvent, type SupportThreadResponse, type SupportTypingEvent } from '@cruzei/shared-types';
import { colors, fontFamily, radius, spacing, typography } from '@cruzei/ui-mobile';
import { timeAgo } from '@cruzei/shared-utils';
import { TypingDots } from '../../components/animated';
import { api, toApiError } from '../../services/api';
import { connectSocket, getSocket } from '../../services/socket';
import { useAuthStore } from '../../stores/auth';
import {
  applySupportMessage,
  createTypingEmitter,
  mergeSupportView,
  parseSendResponse,
  pruneSupportOutbox,
  settleSupportOutbox,
  setSupportChatOpen,
  supportKeys,
  useSupportThread,
  type SupportOutboxMessage,
} from '../../hooks/useSupport';

/** o app nunca mostra o nome do atendente: a equipe fala como uma só */
const STAFF_NAME = 'Equipe Metch';
/** "digitando" da equipe some sozinho se o painel cair sem mandar isTyping:false */
const TYPING_TTL_MS = 6000;

type Row = { kind: 'msg'; key: string; m: SupportOutboxMessage; showName: boolean } | { kind: 'resolved'; key: string };

function newClientId(): string {
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** texto do 429 (limite de mensagens por minuto): a mensagem do servidor quando é nossa, senão uma do app */
function rateLimitText(err: unknown): string {
  const msg = toApiError(err).message;
  if (msg && !/throttler|too many|status code 429/i.test(msg)) return msg;
  const body = axios.isAxiosError(err) ? (err.response?.data as { retryAfter?: number | string } | undefined) : undefined;
  const s = Number(body?.retryAfter ?? (axios.isAxiosError(err) ? err.response?.headers?.['retry-after'] : undefined));
  return `Calma: muita mensagem em pouco tempo. ${Number.isFinite(s) && s > 0 ? `Tenta de novo em ${Math.ceil(s)} s.` : 'Espera um pouquinho e tenta de novo.'}`;
}

function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setOpen(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return open;
}

// ───────────────────────────────────────────────────────────────────────────────
// Balões SEM Reanimated por linha (a lista re-renderiza a cada mensagem e reconciliação)
// ───────────────────────────────────────────────────────────────────────────────

const Bubble = memo(function Bubble({ m, showName, onRetry }: { m: SupportOutboxMessage; showName: boolean; onRetry: (m: SupportOutboxMessage) => void }) {
  const isMe = m.author === 'user';
  const meta = m.pending ? 'enviando…' : m.failed ? 'não foi 😕 · toca pra reenviar' : timeAgo(m.createdAt);
  const inner = (
    <>
      <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>{m.body}</Text>
      <Text style={[styles.bubbleTime, isMe && styles.bubbleTimeMe]}>{meta}</Text>
    </>
  );
  const bubbleStyle = [styles.bubble, isMe ? styles.bubbleMe : styles.bubbleStaff, m.pending && styles.bubblePending, m.failed && styles.bubbleFailed];
  return (
    <View style={[styles.bubbleRow, isMe && styles.bubbleRowMe]}>
      {showName ? <Text style={styles.staffName}>{STAFF_NAME}</Text> : null}
      {isMe && m.failed ? (
        <Pressable
          onPress={() => onRetry(m)}
          style={bubbleStyle}
          accessibilityRole="button"
          accessibilityLabel={`você: ${m.body}. não foi enviada`}
          accessibilityHint="toca pra reenviar"
        >
          {inner}
        </Pressable>
      ) : (
        <View style={bubbleStyle} accessibilityRole="text" accessibilityLabel={`${isMe ? 'você' : STAFF_NAME}: ${m.body}`}>
          {inner}
        </View>
      )}
    </View>
  );
});

/** mensagem de sistema (atendimento aberto, encerrado, transferido…): pílula central */
const SystemPill = memo(function SystemPill({ text }: { text: string }) {
  return (
    <View style={styles.systemRow} accessibilityRole="text" accessibilityLabel={text}>
      <View style={styles.systemPill}>
        <Ionicons name="information-circle-outline" size={14} color={colors.gray[600]} />
        <Text style={styles.systemText}>{text}</Text>
      </View>
    </View>
  );
});

/** atendimento resolvido: "Atendimento encerrado" + avaliação de 1 a 5 (uma vez) */
function ResolvedCard({ rating, busy, onRate }: { rating: number | null; busy: boolean; onRate: (n: number) => void }) {
  const [picked, setPicked] = useState<number | null>(null);
  const shown = rating ?? picked ?? 0;
  const rated = rating != null;
  return (
    <View style={styles.resolved}>
      <View style={styles.resolvedHead}>
        <Ionicons name="checkmark-circle" size={20} color={colors.info} />
        <Text style={styles.resolvedTitle} accessibilityRole="header">
          Atendimento encerrado
        </Text>
      </View>
      <Text style={styles.resolvedText}>
        {rated ? 'Valeu pela avaliação!' : 'Como foi o atendimento? Toca nas estrelas pra avaliar.'}
      </Text>
      <View style={styles.stars} accessibilityRole="adjustable" accessibilityLabel={rated ? `Você deu ${rating} de 5` : 'Avaliar de 1 a 5'}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable
            key={n}
            disabled={rated || busy}
            onPress={() => {
              setPicked(n);
              onRate(n);
            }}
            style={styles.star}
            accessibilityRole="button"
            accessibilityLabel={`${n} ${n === 1 ? 'estrela' : 'estrelas'}`}
            accessibilityState={{ selected: n <= shown, disabled: rated || busy }}
          >
            <Ionicons name={n <= shown ? 'star' : 'star-outline'} size={30} color={n <= shown ? colors.accent : colors.gray[300]} />
          </Pressable>
        ))}
        {busy ? <ActivityIndicator color={colors.primary} style={styles.starBusy} /> : null}
      </View>
      <Text style={styles.resolvedHint}>Precisa de mais alguma coisa? É só mandar mensagem: abre outro atendimento.</Text>
    </View>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
// Tela
// ───────────────────────────────────────────────────────────────────────────────

/** Suporte ao vivo: um atendimento por vez com a Equipe Metch (aberto pela Ajuda e segurança ou pelo push) */
export function SupportChatScreen() {
  const qc = useQueryClient();
  const isFocused = useIsFocused();
  const headerHeight = useHeaderHeight();
  const insets = useSafeAreaInsets();
  const keyboardOpen = useKeyboardOpen();
  const myId = useAuthStore((s) => s.user?.id ?? null);
  const query = useSupportThread();
  const thread = query.data?.thread ?? null;
  const history = useMemo(() => query.data?.messages ?? [], [query.data]);
  const resolved = thread?.status === 'resolved';

  const [content, setContent] = useState('');
  const [outbox, setOutbox] = useState<SupportOutboxMessage[]>([]);
  const [staffTyping, setStaffTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rating, setRating] = useState(false);
  const listRef = useRef<FlatList<Row>>(null);
  const typingTtl = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** clientIds que o servidor já confirmou (resposta, eco do socket ou histórico): erro atrasado do POST não vira "falhou" */
  const confirmedRef = useRef<Set<string>>(new Set());
  const outboxRef = useRef(outbox);
  outboxRef.current = outbox;
  const threadRef = useRef(thread);
  threadRef.current = thread;

  // chat na tela: a leitura é daqui (o App não busca a contagem a cada resposta)
  useEffect(() => {
    if (!isFocused) return;
    setSupportChatOpen(true);
    return () => setSupportChatOpen(false);
  }, [isFocused]);

  const [appActive, setAppActive] = useState(() => AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);

  // atendimento novo na tela: as confirmadas do anterior saem do outbox
  const shownThreadId = thread?.id ?? null;
  useEffect(() => {
    if (shownThreadId) setOutbox((prev) => pruneSupportOutbox(prev, shownThreadId));
  }, [shownThreadId]);

  // histórico com o mesmo clientId: o balão otimista (inclusive o "não foi") vira o real
  useEffect(() => {
    const delivered = new Map<string, (typeof history)[number]>();
    for (const m of history) if (m.clientId && m.author === 'user') delivered.set(m.clientId, m);
    if (!delivered.size) return;
    for (const cid of delivered.keys()) confirmedRef.current.add(cid);
    setOutbox((prev) => settleSupportOutbox(prev, delivered));
  }, [history]);

  // socket: "digitando" da equipe e o eco das minhas (o cache do atendimento o App acerta)
  useEffect(() => {
    let cancelled = false;
    let off: (() => void) | null = null;
    const onTyping = (e: SupportTypingEvent) => {
      const t = threadRef.current;
      if (e.author !== 'staff' || (t && e.threadId !== t.id)) return;
      setStaffTyping(e.isTyping);
      if (typingTtl.current) clearTimeout(typingTtl.current);
      if (e.isTyping) typingTtl.current = setTimeout(() => setStaffTyping(false), TYPING_TTL_MS);
    };
    const onMessage = (e: SupportMessageEvent) => {
      const m = e.message;
      if (m.author === 'staff') setStaffTyping(false);
      const cid = m.clientId;
      if (m.author !== 'user' || !cid || !outboxRef.current.some((o) => o.clientId === cid)) return;
      confirmedRef.current.add(cid);
      setOutbox((prev) => settleSupportOutbox(prev, new Map([[cid, m]])));
    };
    // connectSocket: aberto direto pelo push no app frio, o socket pode estar nascendo
    connectSocket()
      .then((s) => {
        if (cancelled || !s) return;
        s.on('support:typing', onTyping);
        s.on('support:message', onMessage);
        off = () => {
          s.off('support:typing', onTyping);
          s.off('support:message', onMessage);
        };
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      off?.();
      if (typingTtl.current) clearTimeout(typingTtl.current);
    };
  }, []);

  // lida: ao abrir com não lidas e a cada resposta nova da equipe com o chat na tela e o app na frente
  const lastStaffId = useMemo(() => {
    for (let i = history.length - 1; i >= 0; i--) if (history[i].author === 'staff') return history[i].id;
    return null;
  }, [history]);
  const readSent = useRef<string | null>(null);
  useEffect(() => {
    if (!thread || !isFocused || !appActive) return;
    const key = `${thread.id}:${lastStaffId ?? ''}`;
    if (thread.unread === 0 && (readSent.current === null || readSent.current === key)) {
      readSent.current = key; // nada pendente
      return;
    }
    readSent.current = key;
    api
      .post('/support/read')
      .then(() =>
        qc.setQueryData<SupportThreadResponse>(supportKeys.thread, (d) => (d?.thread && d.thread.id === thread.id ? { ...d, thread: { ...d.thread, unread: 0 } } : d)),
      )
      .catch(() => {
        readSent.current = null;
      });
  }, [thread, lastStaffId, isFocused, appActive, qc]);

  // "digitando" meu: só com atendimento em andamento (sem atendimento ou encerrado não há ninguém do outro lado)
  const typing = useMemo(() => createTypingEmitter((isTyping) => getSocket()?.emit('support:typing', { isTyping })), []);
  const typingOn = Boolean(thread) && !resolved;
  useEffect(() => () => typing.dispose(), [typing]);
  useEffect(() => {
    if (!isFocused || !typingOn) typing.stop();
  }, [isFocused, typingOn, typing]);

  const markOutbox = useCallback((clientId: string, patch: Partial<SupportOutboxMessage>) => {
    setOutbox((prev) => prev.map((m) => (m.clientId === clientId ? { ...m, ...patch } : m)));
  }, []);

  // POST com o clientId do balão: envio e reenvio (o servidor dedupa pelo clientId e devolve a que já existe)
  const deliver = useCallback(
    async (clientId: string, text: string) => {
      try {
        const res = await api.post('/support/messages', { body: text, clientId });
        const { message, thread: t } = parseSendResponse(res.data);
        confirmedRef.current.add(clientId);
        if (t) {
          qc.setQueryData<SupportThreadResponse>(supportKeys.thread, (d) => (d?.thread && d.thread.id === t.id ? { ...d, thread: { ...d.thread, ...t } } : d));
        }
        if (message) {
          const mine = { ...message, clientId };
          markOutbox(clientId, { ...mine, pending: false, failed: false, sent: true });
          // atendimento novo (1ª mensagem, ou depois de encerrado): o cache é de outro e o atendimento é buscado de novo
          applySupportMessage(qc, { threadId: message.threadId, message: mine });
        } else {
          // resposta sem a mensagem: o histórico novo traz a real e o balão otimista sai
          await qc.invalidateQueries({ queryKey: supportKeys.thread });
          setOutbox((prev) => prev.filter((o) => o.clientId !== clientId));
        }
      } catch (err) {
        if (confirmedRef.current.has(clientId)) return;
        const e = toApiError(err);
        setOutbox((prev) => prev.map((m) => (m.clientId === clientId && m.pending ? { ...m, pending: false, failed: true } : m)));
        setError(e.status === 429 ? rateLimitText(err) : e.message);
      }
    },
    [markOutbox, qc],
  );

  const send = () => {
    const body = content.trim();
    if (!body) return;
    setError(null);
    typing.stop();
    const clientId = newClientId();
    const optimistic: SupportOutboxMessage = {
      id: clientId,
      threadId: thread?.id ?? '',
      author: 'user',
      senderId: myId,
      senderName: null,
      body,
      internal: false,
      createdAt: new Date().toISOString(),
      clientId,
      pending: true,
    };
    setContent('');
    setOutbox((prev) => [...prev, optimistic]);
    void deliver(clientId, body);
  };

  const retry = useCallback(
    (m: SupportOutboxMessage) => {
      if (!m.clientId) return;
      setError(null);
      markOutbox(m.clientId, { pending: true, failed: false });
      void deliver(m.clientId, m.body);
    },
    [deliver, markOutbox],
  );

  const rate = useCallback(
    async (n: number) => {
      const t = threadRef.current;
      if (!t) return;
      setRating(true);
      try {
        await api.post('/support/thread/rate', { rating: n });
        qc.setQueryData<SupportThreadResponse>(supportKeys.thread, (d) => (d?.thread && d.thread.id === t.id ? { ...d, thread: { ...d.thread, rating: n } } : d));
      } catch (err) {
        setError(toApiError(err).message);
      } finally {
        setRating(false);
      }
    },
    [qc],
  );

  // histórico + as minhas ainda no ar; o "encerrado" fica entre o atendimento que acabou e o que eu mandar agora
  const rows = useMemo<Row[]>(() => {
    const list = mergeSupportView(history, outbox);
    const out: Row[] = [];
    list.forEach((m, i) => {
      if (resolved && i === history.length) out.push({ kind: 'resolved', key: 'resolved' });
      const prev = list[i - 1];
      out.push({ kind: 'msg', key: m.clientId ?? m.id, m, showName: m.author === 'staff' && prev?.author !== 'staff' });
    });
    if (resolved && list.length === history.length) out.push({ kind: 'resolved', key: 'resolved' });
    return out;
  }, [history, outbox, resolved]);

  const renderItem = useCallback(
    ({ item }: { item: Row }) => {
      if (item.kind === 'resolved') return <ResolvedCard rating={thread?.rating ?? null} busy={rating} onRate={rate} />;
      if (item.m.author === 'system') return <SystemPill text={item.m.body} />;
      return <Bubble m={item.m} showName={item.showName} onRetry={retry} />;
    },
    [thread?.rating, rating, rate, retry],
  );

  useEffect(() => {
    if (staffTyping) listRef.current?.scrollToEnd({ animated: true });
  }, [staffTyping]);

  const canSend = content.trim().length > 0;
  const loading = query.isLoading && outbox.length === 0;

  return (
    <View style={styles.safe}>
      {/* edge-to-edge: a janela não encolhe com o teclado, o padding vale nas duas plataformas */}
      <KeyboardAvoidingView behavior="padding" style={styles.flex} keyboardVerticalOffset={headerHeight}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : query.isError && !query.data && outbox.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="cloud-offline-outline" size={48} color={colors.gray[300]} />
            <Text style={styles.emptyTitle}>não deu pra carregar</Text>
            <Text style={styles.emptyText}>{toApiError(query.error).message}</Text>
            <Pressable onPress={() => void query.refetch()} style={styles.retryBtn} accessibilityRole="button">
              <Text style={styles.retryText}>Tentar de novo</Text>
            </Pressable>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={rows}
            keyExtractor={(r) => r.key}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
            ListEmptyComponent={
              <View style={styles.empty}>
                <View style={styles.emptyIcon}>
                  <Ionicons name="chatbubbles-outline" size={40} color={colors.info} />
                </View>
                <Text style={styles.emptyTitle}>Fala com a Equipe Metch</Text>
                <Text style={styles.emptyText}>
                  Conta o que aconteceu que a gente responde por aqui mesmo. Quando chegar resposta, você recebe um aviso.
                </Text>
              </View>
            }
            ListFooterComponent={
              staffTyping ? (
                <View style={styles.bubbleRow}>
                  <View style={[styles.bubble, styles.bubbleTyping]} accessibilityLabel={`${STAFF_NAME} está digitando`} accessible>
                    <TypingDots color={colors.gray[500]} />
                  </View>
                </View>
              ) : null
            }
          />
        )}

        {error ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}

        <View style={[styles.composer, { paddingBottom: spacing.md + (keyboardOpen ? 0 : insets.bottom) }]}>
          <TextInput
            style={styles.input}
            placeholder={resolved ? 'escreve pra abrir outro atendimento...' : 'escreve pra equipe...'}
            placeholderTextColor={colors.gray[400]}
            value={content}
            onChangeText={(t) => {
              setContent(t);
              if (typingOn) typing.input(t.trim().length);
            }}
            multiline
            maxLength={SUPPORT_LIMITS.bodyMax}
            accessibilityLabel="mensagem pro suporte"
          />
          <Pressable
            onPress={send}
            disabled={!canSend}
            style={({ pressed }) => [styles.sendBtn, !canSend && styles.sendOff, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="enviar mensagem"
            accessibilityState={{ disabled: !canSend }}
          >
            <Ionicons name="send" size={20} color={colors.black} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  pressed: { opacity: 0.6 },

  list: { padding: spacing.lg, paddingBottom: spacing.md, gap: spacing.sm, flexGrow: 1 },
  bubbleRow: { alignItems: 'flex-start' },
  bubbleRowMe: { alignItems: 'flex-end' },
  staffName: { ...typography.caption, fontFamily: fontFamily.bodySemiBold, color: colors.info, marginBottom: 2, marginLeft: spacing.xs },
  bubble: { maxWidth: '82%', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.lg },
  bubbleMe: { backgroundColor: colors.secondary, borderBottomRightRadius: 4 },
  // colors.white é o fundo: o balão da equipe precisa de borda
  bubbleStaff: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.gray[200], borderBottomLeftRadius: 4 },
  bubbleTyping: { backgroundColor: colors.gray[200], borderBottomLeftRadius: 4, paddingVertical: spacing.md },
  bubblePending: { opacity: 0.75 },
  bubbleFailed: { opacity: 0.5 },
  bubbleText: { ...typography.body, color: colors.black },
  bubbleTextMe: { color: colors.white },
  bubbleTime: { ...typography.bodySmall, fontSize: 11, color: colors.gray[500], marginTop: 2, alignSelf: 'flex-end' },
  bubbleTimeMe: { color: 'rgba(255,255,255,0.75)' },

  systemRow: { alignItems: 'center', paddingVertical: spacing.xs },
  systemPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '92%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.lg,
    backgroundColor: colors.gray[100],
  },
  systemText: { ...typography.bodySmall, color: colors.gray[700], textAlign: 'center', flexShrink: 1 },

  resolved: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.gray[200],
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
    marginVertical: spacing.sm,
  },
  resolvedHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  resolvedTitle: { ...typography.h4, color: colors.black, flexShrink: 1 },
  resolvedText: { ...typography.bodySmall, color: colors.gray[600] },
  stars: { flexDirection: 'row', alignItems: 'center' },
  star: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  starBusy: { marginLeft: spacing.sm },
  resolvedHint: { ...typography.caption, color: colors.gray[500] },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  emptyIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(0,139,139,0.10)', alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { ...typography.h3, color: colors.black, textAlign: 'center' },
  emptyText: { ...typography.body, color: colors.gray[600], textAlign: 'center' },
  retryBtn: { marginTop: spacing.sm, minHeight: 44, paddingHorizontal: spacing.xl, borderRadius: radius.full, backgroundColor: colors.primary, justifyContent: 'center' },
  retryText: { ...typography.label, color: colors.black },

  error: { ...typography.bodySmall, color: colors.danger, textAlign: 'center', paddingHorizontal: spacing.lg, paddingBottom: spacing.xs },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.gray[200],
    gap: spacing.sm,
    backgroundColor: colors.background,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 110,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.gray[200],
    backgroundColor: colors.surface,
    ...typography.body,
    color: colors.black,
  },
  sendBtn: { backgroundColor: colors.primary, width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  sendOff: { opacity: 0.45 },
});
