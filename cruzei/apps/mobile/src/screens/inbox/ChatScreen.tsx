import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useHeaderHeight } from '@react-navigation/elements';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
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
import {
  INBOX_LIMITS,
  type ChatMessageWithClientId,
  type ConversationDetail,
  type ConversationRemovedPayload,
  type CreateConversationResponse,
  type MessageNewPayload,
  type SystemMessageKind,
} from '@cruzei/shared-types';
import { colors, duration, radius, spacing, spring, typography } from '@cruzei/ui-mobile';
import { timeAgo } from '@cruzei/shared-utils';
import type { InboxStackParamList } from '../../navigation/InboxStack';
import { FadeInView, ScaleOnPress, SlideInView, TypingDots } from '../../components/animated';
import { CruzeiAvatar } from '../../components/avatar/CruzeiAvatar';
import { resolveAvatar } from '../../avatar';
import { SafetySheet, askBlock } from '../../components/safety/SafetySheet';
import { MessagingLocked } from '../../components/inbox/MessagingLocked';
import { isMessagingLockedError, useMessagingLocked } from '../../hooks/useMessagingLock';
import {
  applyConversationNew,
  applyUnread,
  inboxKeys,
  settleOutbox,
  upsertMessage,
  useConversation,
  useConversationMessages,
  useConversationWith,
  useInboxCounts,
  usePromoteRequest,
  type CachedMessage,
  type OutboxMessage,
} from '../../hooks/useInbox';

/** balão na tela: as minhas ainda não confirmadas ficam só aqui (pending/failed) até o servidor devolver */
type LocalMessage = OutboxMessage;
type ChatNav = NativeStackNavigationProp<InboxStackParamList, 'Chat'>;

const HEADER_AVATAR = 32;
/** "digitando" some sozinho se o outro lado cair sem mandar isTyping:false */
const TYPING_TTL_MS = 6000;

const SYSTEM_TEXT: Record<SystemMessageKind, string> = {
  mutual_like: 'Vocês se curtiram. A conversa foi movida para a principal.',
};

/** chave estável do balão: clientId sobrevive à reconciliação otimista → sem remount */
const keyOf = (m: LocalMessage) => m.clientId ?? m.id;

function newClientId(): string {
  return `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** segundos do 429 (corpo retryAfter ou header Retry-After) */
function retryAfterSeconds(err: unknown): number | null {
  if (!axios.isAxiosError(err)) return null;
  const body = err.response?.data as { retryAfter?: number | string } | undefined;
  const n = Number(body?.retryAfter ?? err.response?.headers?.['retry-after']);
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : null;
}

/** texto do 429: a mensagem do servidor quando é nossa (limite da solicitação); a do throttler vira texto do app */
function rateLimitText(err: unknown): string {
  const msg = toApiError(err).message;
  if (msg && !/throttler|too many|status code 429/i.test(msg)) return msg;
  const s = retryAfterSeconds(err);
  return `Calma: muita mensagem em pouco tempo. ${s ? `Tenta de novo em ${s} s.` : 'Espera um pouquinho e tenta de novo.'}`;
}

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
    <Animated.View style={[styles.receipt, wrap]} accessibilityLabel={read ? 'lida' : 'enviada'} accessible>
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
  item: LocalMessage;
  isMe: boolean;
  animateIn: boolean;
  /** só pra mensagem minha que falhou — toca e reenvia com o mesmo clientId */
  onRetry?: (item: LocalMessage) => void;
}

const Bubble = memo(function Bubble({ item, isMe, animateIn, onRetry }: BubbleProps) {
  // decidido uma única vez por montagem — re-render por readAt não troca o wrapper
  const shouldAnimate = useRef(animateIn).current;
  const canRetry = Boolean(isMe && item.failed && onRetry);
  const text = item.body ?? '';

  const inner = (
    <>
      <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>{text}</Text>
      <View style={styles.meta}>
        <Text style={[styles.bubbleTime, isMe && styles.bubbleTimeMe]}>
          {item.pending ? 'enviando…' : item.failed ? 'não foi 😕 · toca pra reenviar' : timeAgo(item.createdAt)}
        </Text>
        {isMe && !item.pending && !item.failed ? <ReadReceipt read={Boolean(item.readAt)} /> : null}
      </View>
    </>
  );
  const bubbleStyle = [styles.bubble, isMe ? styles.bubbleMe : styles.bubbleOther, item.failed && styles.bubbleFailed, item.pending && styles.bubblePending];

  const body = (
    <View style={[styles.bubbleRow, isMe && styles.bubbleRowMe]}>
      {canRetry ? (
        <Pressable
          onPress={() => onRetry?.(item)}
          style={bubbleStyle}
          accessibilityRole="button"
          accessibilityLabel={`você: ${text}. não foi enviada`}
          accessibilityHint="toca pra reenviar"
        >
          {inner}
        </Pressable>
      ) : (
        <View style={bubbleStyle} accessibilityRole="text" accessibilityLabel={`${isMe ? 'você' : 'mensagem'}: ${text}`}>
          {inner}
        </View>
      )}
    </View>
  );

  if (!shouldAnimate) return body;
  return (
    <SlideInView from={isMe ? 'right' : 'left'} distance={36} springPreset="soft">
      {body}
    </SlideInView>
  );
});

/** mensagem de sistema: centralizada, em itálico, sem recibo e fora da marcação de lidas */
const SystemBubble = memo(function SystemBubble({ item }: { item: LocalMessage }) {
  const text = item.body ?? (item.systemKind ? SYSTEM_TEXT[item.systemKind] : '');
  return (
    <View style={styles.systemRow} accessibilityRole="text" accessibilityLabel={text}>
      <View style={styles.systemPill}>
        <Ionicons name="heart" size={12} color={colors.secondary} />
        <Text style={styles.systemText}>{text}</Text>
      </View>
    </View>
  );
});

// ───────────────────────────────────────────────────────────────────────────────
// Banners de solicitação: no topo da LISTA (rolam junto; com o teclado aberto em 360 dp não roubam a altura das mensagens)
// ───────────────────────────────────────────────────────────────────────────────

/** quem RECEBEU: aceitar (mover/responder), bloquear ou denunciar */
function RequestBanner({
  name,
  busy,
  onPromote,
  onBlock,
  onReport,
}: {
  name: string;
  busy: boolean;
  onPromote: () => void;
  onBlock: () => void;
  onReport: () => void;
}) {
  return (
    <View style={styles.requestBanner}>
      <View style={styles.requestHead}>
        <Ionicons name="mail-unread-outline" size={20} color={colors.secondary} />
        <Text style={styles.requestTitle} accessibilityRole="header">
          {name} quer conversar
        </Text>
      </View>
      <Text style={styles.requestText}>Responder ou mover pra principal aceita a conversa. Até lá, {name} não vê que você leu.</Text>
      <Pressable
        onPress={onPromote}
        disabled={busy}
        style={({ pressed }) => [styles.requestPrimary, (pressed || busy) && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Mover para principal"
        accessibilityState={{ disabled: busy, busy }}
      >
        {busy ? <ActivityIndicator color={colors.black} /> : <Text style={styles.requestPrimaryText}>Mover para principal</Text>}
      </Pressable>
      <View style={styles.requestRow}>
        <Pressable
          onPress={onBlock}
          style={({ pressed }) => [styles.requestGhost, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`Bloquear ${name}`}
        >
          <Ionicons name="ban-outline" size={16} color={colors.gray[700]} />
          <Text style={styles.requestGhostText} numberOfLines={1}>
            Bloquear
          </Text>
        </Pressable>
        <Pressable
          onPress={onReport}
          style={({ pressed }) => [styles.requestGhost, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`Denunciar ${name}`}
        >
          <Ionicons name="flag-outline" size={16} color={colors.danger} />
          <Text style={[styles.requestGhostText, styles.dangerText]} numberOfLines={1}>
            Denunciar
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/** quem MANDOU a 1ª mensagem, enquanto a conversa não vai pra principal */
function WaitingBanner({ name, left }: { name: string; left: number | null | undefined }) {
  const leftText = left != null && left > 0 ? `Dá pra mandar mais ${left} ${left === 1 ? 'mensagem' : 'mensagens'} até ${name} responder.` : null;
  return (
    <View style={styles.waitBanner}>
      <Ionicons name="hourglass-outline" size={16} color={colors.info} />
      <View style={styles.flex}>
        <Text style={styles.waitText}>Fica nas solicitações até {name} responder ou vocês se curtirem.</Text>
        {leftText ? <Text style={styles.waitSub}>{leftText}</Text> : null}
      </View>
    </View>
  );
}

// ───────────────────────────────────────────────────────────────────────────────
// Tela
// ───────────────────────────────────────────────────────────────────────────────
/** invisível sem Premium: o chat vira o convite (e sai da sala do "digitando" ao desmontar o chat de verdade) */
export function ChatScreen() {
  const locked = useMessagingLocked();
  return locked ? <ChatLocked /> : <ChatScreenInner />;
}

function ChatLocked() {
  const route = useRoute<RouteProp<InboxStackParamList, 'Chat'>>();
  const nav = useNavigation<ChatNav>();
  const counts = useInboxCounts();
  const name = route.params.peer.name;
  useEffect(() => {
    nav.setOptions({ title: name });
  }, [nav, name]);
  const c = counts.data;
  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <MessagingLocked waiting={(c?.unreadInbox ?? 0) + (c?.requests ?? 0)} />
    </SafeAreaView>
  );
}

function ChatScreenInner() {
  const route = useRoute<RouteProp<InboxStackParamList, 'Chat'>>();
  const nav = useNavigation<ChatNav>();
  const qc = useQueryClient();
  const isFocused = useIsFocused();
  const { conversationId, peer } = route.params;
  const name = peer.name;
  const myId = useAuthStore((s) => s.user?.id);

  const [content, setContent] = useState('');
  const [outbox, setOutbox] = useState<LocalMessage[]>([]);
  const [typing, setTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [safety, setSafety] = useState<null | 'menu' | 'reasons'>(null);
  const headerHeight = useHeaderHeight();
  const listRef = useRef<FlatList<LocalMessage>>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingTtl = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** ids/clientIds já exibidos — só o que NÃO está aqui entra animado */
  const seenIds = useRef<Set<string>>(new Set());
  /** a conversa atual sem closure velha (o 1º envio do rascunho troca o id no meio) */
  const convIdRef = useRef(conversationId);
  convIdRef.current = conversationId ?? convIdRef.current;
  /** clientIds que o servidor já confirmou (resposta, eco do socket ou histórico): erro atrasado do POST não vira "falhou" */
  const confirmedRef = useRef<Set<string>>(new Set());
  const outboxRef = useRef(outbox);
  outboxRef.current = outbox;

  // rascunho (sem id): procura a conversa do par; achou → vira o chat normal
  const lookup = useConversationWith(peer.id, !conversationId);
  const foundId = lookup.data?.id;
  useEffect(() => {
    if (!conversationId && foundId) nav.setParams({ conversationId: foundId });
  }, [conversationId, foundId, nav]);
  const resolving = !conversationId && lookup.isLoading;

  const detailQuery = useConversation(conversationId);
  const historyQuery = useConversationMessages(conversationId);
  const detail: ConversationDetail | undefined = detailQuery.data;
  const promote = usePromoteRequest();

  const isRecipientRequest = detail?.route === 'request' && detail.myRole === 'RECIPIENT';
  const isRequesterWaiting = detail?.route === 'request' && detail.myRole === 'REQUESTER';
  // limite do REQUESTER até a 1ª resposta (o servidor conta; aqui só trava o campo e explica)
  const requestLimitHit = isRequesterWaiting && detail?.requestMessagesLeft === 0;
  // quem RECEBEU a solicitação não manda "digitando" até aceitar: contaria a quem pediu que ela foi aberta (o recibo de
  // leitura também fica retido até lá). Com o detalhe ainda carregando, fica mudo até saber a rota
  const typingMutedRef = useRef(true);
  typingMutedRef.current = isRecipientRequest || (Boolean(conversationId) && !detail);

  // Header: avatar da pessoa (bust) + nome
  const peerAvatar = detail?.peer.avatar ?? peer.avatar ?? null;
  useEffect(() => {
    nav.setOptions({
      title: name,
      headerTitle: () => (
        <View style={styles.headerTitle}>
          <CruzeiAvatar
            config={resolveAvatar(peerAvatar, peer.id)}
            mode="bust"
            size={HEADER_AVATAR}
            backgroundColor={colors.gray[800]}
            accessibilityLabel={`Avatar de ${name}`}
          />
          <Text style={styles.headerName} numberOfLines={1}>
            {name}
          </Text>
        </View>
      ),
      headerRight: () => (
        <Pressable onPress={() => setSafety('menu')} hitSlop={12} accessibilityRole="button" accessibilityLabel={`Denunciar ou bloquear ${name}`}>
          <Ionicons name="ellipsis-vertical" size={20} color={colors.white} />
        </Pressable>
      ),
    });
  }, [nav, name, peer.id, peerAvatar]);

  // conversa removida (bloqueio, moderação) com o chat aberto: sai da conversa
  const closedRef = useRef(false);
  const leaveClosed = useCallback(
    (message: string) => {
      if (closedRef.current) return;
      closedRef.current = true;
      qc.invalidateQueries({ queryKey: inboxKeys.all });
      Alert.alert('Conversa encerrada', message, [{ text: 'Ok', onPress: () => nav.goBack() }], { cancelable: false });
    },
    [nav, qc],
  );
  /** quem fechou fui eu (bloquear/arquivar): sai sem o alerta de "conversa encerrada" */
  const leaveByMe = useCallback(() => {
    closedRef.current = true;
    nav.goBack();
  }, [nav]);
  useEffect(() => {
    if (!conversationId) return;
    const socket = getSocket();
    if (!socket) return;
    const onRemoved = (d: ConversationRemovedPayload) => {
      if (d.conversationId === conversationId && safety === null) leaveClosed('Essa conversa não está mais disponível.');
    };
    socket.on('conversation:removed', onRemoved);
    return () => {
      socket.off('conversation:removed', onRemoved);
    };
  }, [leaveClosed, conversationId, safety]);
  useEffect(() => {
    if (detailQuery.isError && toApiError(detailQuery.error).status === 404) leaveClosed('Essa conversa não está mais disponível.');
  }, [detailQuery.isError, detailQuery.error, leaveClosed]);

  // lista = histórico (cache; o App acerta com o socket) + as minhas que ainda não voltaram do servidor
  const history = historyQuery.data;
  const messages = useMemo<LocalMessage[]>(() => {
    const hist = history ?? [];
    const histIds = new Set(hist.map((m) => m.id));
    const histCids = new Set(hist.map((m) => m.clientId).filter(Boolean));
    // a que eu mandei e o histórico trouxe sem clientId herda o da otimista (chave estável)
    const sentCid = new Map<string, string>();
    for (const o of outbox) if (o.sent && o.clientId) sentCid.set(o.id, o.clientId);
    const merged = hist.map((m) => (!m.clientId && sentCid.has(m.id) ? { ...m, clientId: sentCid.get(m.id) } : m));
    const local = outbox.filter((o) => !histIds.has(o.id) && !(o.clientId && histCids.has(o.clientId)));
    return [...merged, ...local];
  }, [history, outbox]);

  // histórico nunca anima
  useEffect(() => {
    for (const m of history ?? []) {
      seenIds.current.add(m.id);
      if (m.clientId) seenIds.current.add(m.clientId);
    }
  }, [history]);

  // o histórico já tem a minha mensagem (mesmo clientId): o balão "não foi · toca pra reenviar" vira a real e o reenvio
  // some (a resposta do POST se perdeu, mas a mensagem chegou)
  useEffect(() => {
    const delivered = new Map<string, CachedMessage>();
    for (const m of history ?? []) if (m.clientId && m.senderId === myId) delivered.set(m.clientId, m);
    if (!delivered.size) return;
    for (const cid of delivered.keys()) confirmedRef.current.add(cid);
    setOutbox((prev) => settleOutbox(prev, delivered));
  }, [history, myId]);

  // eco do socket (message:new com o meu clientId) confirma o balão mesmo sem a resposta do POST, inclusive no
  // rascunho, quando o histórico ainda nem existe
  useEffect(() => {
    const socket = getSocket();
    if (!socket || !myId) return;
    const onNew = (p: MessageNewPayload) => {
      const m = p?.message;
      const cid = m?.clientId;
      if (!cid || m.senderId !== myId || !outboxRef.current.some((o) => o.clientId === cid)) return;
      confirmedRef.current.add(cid);
      setOutbox((prev) => settleOutbox(prev, new Map([[cid, m]])));
    };
    socket.on('message:new', onNew);
    return () => {
      socket.off('message:new', onNew);
    };
  }, [myId]);

  // o rascunho achou a conversa sem a resposta do POST (lookup ou conversation:new): com balão ainda não confirmado,
  // busca o histórico de novo pra reconciliar pelo clientId (um cache velho não teria a mensagem)
  const hadConversation = useRef(Boolean(conversationId));
  useEffect(() => {
    if (!conversationId || hadConversation.current) return;
    hadConversation.current = true;
    if (outboxRef.current.some((o) => !o.sent)) void qc.invalidateQueries({ queryKey: inboxKeys.messages(conversationId), exact: true });
  }, [conversationId, qc]);

  // app em segundo plano com o chat aberto: o que chega nesse tempo não foi visto, então não marca como lida
  const [appActive, setAppActive] = useState(() => AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);

  // Marca como lida até a última do outro QUE ESTÁ NA TELA (a de sistema não conta), só com o chat em foco e o app na
  // frente. Quem recebeu a solicitação também chama: o servidor zera o badge dele mas só manda o recibo
  // (readAt/message:read pro outro) depois de aceitar — mover ou responder
  const lastPeer = useMemo(() => {
    const hist = history ?? [];
    for (let i = hist.length - 1; i >= 0; i--) {
      const m = hist[i];
      if (m.messageType !== 'system' && m.senderId !== myId) return m;
    }
    return null;
  }, [history, myId]);
  const readSent = useRef<string | null>(null);
  const readKey = lastPeer && detail ? `${lastPeer.id}:${detail.route}` : null; // aceitar a solicitação manda o recibo de novo
  useEffect(() => {
    if (!conversationId || !detail || !lastPeer || !readKey || !isFocused || !appActive) return;
    if (readSent.current === readKey) return;
    if (lastPeer.readAt && detail.unreadCount === 0) return;
    readSent.current = readKey;
    api
      .post<{ unreadCount: number; readAt: string | null }>(`/conversations/${conversationId}/read`, { upToMessageId: lastPeer.id })
      .then((res) => applyUnread(qc, conversationId, res.data.unreadCount))
      .catch(() => {
        readSent.current = null;
      });
  }, [conversationId, detail, lastPeer, readKey, isFocused, appActive, qc]);

  // Tempo real da tela: sala conv:<id> só pro "digitando" (mensagem e leitura chegam pela sala do usuário, no App)
  useEffect(() => {
    if (!conversationId) return;
    const socket = getSocket();
    if (!socket) return;
    const join = () => socket.emit('join_conversation', { conversationId });
    join();
    socket.on('connect', join); // reconexão (rede, token renovado) cria outra conexão, sem a sala
    const onTyping = (d: { conversationId: string; userId: string; isTyping: boolean }) => {
      if (d.conversationId !== conversationId || d.userId === myId) return;
      setTyping(d.isTyping);
      if (typingTtl.current) clearTimeout(typingTtl.current);
      if (d.isTyping) typingTtl.current = setTimeout(() => setTyping(false), TYPING_TTL_MS);
    };
    socket.on('typing_indicator', onTyping);
    return () => {
      socket.emit('leave_conversation', { conversationId });
      socket.off('connect', join);
      socket.off('typing_indicator', onTyping);
      if (typingTtl.current) clearTimeout(typingTtl.current);
    };
  }, [conversationId, myId]);

  // mensagem do outro chegou: o "digitando" dele acabou
  useEffect(() => {
    setTyping(false);
  }, [lastPeer?.id]);

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

  /** mandei isTyping:true e ainda não o false: só então o false sai (um false solto também diria que a pessoa está ali) */
  const typingOnRef = useRef(false);
  const typingSentAt = useRef(0);
  const emitTyping = useCallback((isTyping: boolean) => {
    const id = convIdRef.current;
    if (!id) return;
    if (isTyping ? typingMutedRef.current : !typingOnRef.current) return;
    // um true por tecla é ruído: só na mudança, repetido antes do TYPING_TTL_MS do outro lado vencer
    if (isTyping && typingOnRef.current && Date.now() - typingSentAt.current < TYPING_TTL_MS / 2) return;
    if (isTyping) typingSentAt.current = Date.now();
    typingOnRef.current = isTyping;
    getSocket()?.emit('typing', { conversationId: id, isTyping });
  }, []);

  const onChangeText = (t: string) => {
    setContent(t);
    if (!convIdRef.current) return; // rascunho: ainda não há sala
    emitTyping(true);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => emitTyping(false), 1500);
  };

  const markOutbox = useCallback((clientId: string, patch: Partial<LocalMessage>) => {
    setOutbox((prev) => prev.map((m) => (m.clientId === clientId ? { ...m, ...patch } : m)));
  }, []);

  const requesterWaiting = isRequesterWaiting;
  // POST com o clientId do balão otimista — usado no envio e no reenvio (reenvio é sempre manual, inclusive no 429)
  const deliver = useCallback(
    async (clientId: string, text: string) => {
      const id = convIdRef.current;
      if (!id) setCreating(true);
      try {
        if (!id) {
          // rascunho: a 1ª mensagem cria (ou reusa) a conversa do par
          const res = await api.post<CreateConversationResponse>('/conversations', { toUserId: peer.id, body: text, clientId });
          const { conversation, message } = res.data;
          confirmedRef.current.add(clientId);
          markOutbox(clientId, { ...message, clientId, pending: false, failed: false, sent: true });
          applyConversationNew(qc, { conversation });
          convIdRef.current = conversation.id;
          nav.setParams({ conversationId: conversation.id });
          return;
        }
        // reenvio com a conversa já descoberta vem por aqui com o MESMO clientId: o servidor dedupa por remetente e
        // devolve a mensagem que já existe em vez de gravar outra
        const res = await api.post<ChatMessageWithClientId>(`/conversations/${id}/messages`, { body: text, clientId });
        confirmedRef.current.add(clientId);
        upsertMessage(qc, id, { ...res.data, clientId });
        markOutbox(clientId, { ...res.data, clientId, pending: false, failed: false, sent: true });
        // quem pediu e ainda espera resposta: o servidor recalcula quantas ainda cabem
        if (requesterWaiting) qc.invalidateQueries({ queryKey: inboxKeys.conversation(id) });
      } catch (err) {
        // a resposta se perdeu mas o servidor já confirmou (eco do socket ou histórico): não é falha
        if (confirmedRef.current.has(clientId)) return;
        const e = toApiError(err);
        setOutbox((prev) => prev.map((m) => (m.clientId === clientId && m.pending ? { ...m, pending: false, failed: true } : m)));
        if (e.status === 429) setError(rateLimitText(err));
        else if (isMessagingLockedError(err)) {
          // o app achava que estava visível (ou com Premium): o /me novo troca o chat pelo convite
          setError(e.message);
          useAuthStore.getState().refreshMe().catch(() => {});
        }
        else if (e.status === 404 && id) leaveClosed('Essa conversa não está mais disponível.');
        else if (e.status === 404) {
          // alvo anônimo, bloqueado, pausado, fora do ar: o servidor responde igual pra todos
          closedRef.current = true;
          Alert.alert('Não dá pra mandar mensagem', `${name} não está disponível agora.`, [{ text: 'Ok', onPress: () => nav.goBack() }], {
            cancelable: false,
          });
        } else setError(e.message);
      } finally {
        if (!id) setCreating(false);
      }
    },
    [leaveClosed, markOutbox, name, nav, peer.id, qc, requesterWaiting],
  );

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !myId || creating || requestLimitHit) return;
    setError(null);
    emitTyping(false);
    const clientId = newClientId();
    const optimistic: LocalMessage = {
      id: clientId,
      conversationId: convIdRef.current ?? '',
      senderId: myId,
      body: trimmed,
      mediaUrl: null,
      createdAt: new Date().toISOString(),
      readAt: null,
      systemKind: null,
      messageType: 'text',
      clientId,
      pending: true,
    };
    setContent('');
    setOutbox((prev) => [...prev, optimistic]);
    void deliver(clientId, trimmed);
  };

  // Reenvio: volta o balão pra "enviando…" e tenta de novo com o mesmo clientId
  const retry = useCallback(
    (item: LocalMessage) => {
      if (!item.clientId || !item.body || creating) return;
      const { clientId, body } = item;
      setError(null);
      markOutbox(clientId, { pending: true, failed: false });
      void deliver(clientId, body);
    },
    [creating, deliver, markOutbox],
  );

  const onPromote = () => {
    if (!conversationId) return;
    promote.mutate(conversationId, {
      onError: (e) => Alert.alert('Não deu pra mover', toApiError(e).message),
    });
  };
  const onBlock = () =>
    askBlock({
      target: { id: peer.id, name },
      source: 'requests',
      conversationId,
      qc,
      // o conversation:removed do próprio bloqueio pode chegar antes da resposta: sem o alerta de "conversa encerrada"
      onBusy: (busy) => {
        closedRef.current = busy;
      },
      onBlocked: leaveByMe,
    });

  // ── Composer: foco animado + botão enviar que "acende" quando há texto ──────
  const focus = useSharedValue(0);
  const canSend = useSharedValue(0);
  const hasText = content.trim().length > 0;
  const sendDisabled = !hasText || creating;

  useEffect(() => {
    canSend.value = withSpring(sendDisabled ? 0 : 1, spring.snappy);
  }, [sendDisabled, canSend]);

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
    ({ item }: { item: LocalMessage }) => {
      const key = keyOf(item);
      const isNew = !seenIds.current.has(key) && !seenIds.current.has(item.id);
      if (isNew) {
        seenIds.current.add(key);
        seenIds.current.add(item.id);
      }
      if (item.messageType === 'system') return <SystemBubble item={item} />;
      const isMe = item.senderId === myId;
      return <Bubble item={item} isMe={isMe} animateIn={isNew} onRetry={isMe && item.failed ? retry : undefined} />;
    },
    [myId, retry],
  );

  const banner = isRecipientRequest ? (
    <RequestBanner name={name} busy={promote.isPending} onPromote={onPromote} onBlock={onBlock} onReport={() => setSafety('reasons')} />
  ) : isRequesterWaiting ? (
    <WaitingBanner name={name} left={detail?.requestMessagesLeft} />
  ) : null;

  // o 1º envio do rascunho já mostra o balão enquanto o histórico da conversa nova carrega
  const loading = resolving || (Boolean(conversationId) && historyQuery.isLoading && outbox.length === 0);

  return (
    // sem borda de baixo: a barra de abas já fica embaixo e cuida da barra de navegação do Android (edge-to-edge)
    <SafeAreaView style={styles.safe} edges={[]}>
      {/* Android 15+/targetSdk 36 é edge-to-edge: a janela não encolhe mais com o teclado, então o padding vale nas duas plataformas */}
      <KeyboardAvoidingView behavior="padding" style={styles.flex} keyboardVerticalOffset={headerHeight}>
        {loading ? (
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
            ListHeaderComponent={banner}
            ListEmptyComponent={
              <View style={styles.emptyChat}>
                <FadeInView fromScale={0.8} fromY={8}>
                  <Ionicons name="chatbubbles-outline" size={48} color={colors.gray[300]} />
                </FadeInView>
                <FadeInView delay={80} fromY={8}>
                  <Text style={styles.emptyChatTitle}>Manda a primeira mensagem</Text>
                  <Text style={styles.emptyChatText}>
                    Se vocês ainda não se curtiram, ela chega nas solicitações de {name}, que decide se responde.
                  </Text>
                </FadeInView>
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
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>
          </FadeInView>
        ) : null}

        {requestLimitHit ? (
          <View style={styles.limit} accessibilityLiveRegion="polite">
            <Ionicons name="hourglass-outline" size={18} color={colors.gray[500]} />
            <Text style={styles.limitText}>
              Você já mandou {INBOX_LIMITS.requesterMessagesBeforeReply} mensagens. Agora é esperar {name} responder.
            </Text>
          </View>
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
                maxLength={INBOX_LIMITS.messageBodyMax}
                accessibilityLabel="campo de mensagem"
                accessibilityHint="escreve e toca em enviar"
              />
            </Animated.View>
            <Animated.View style={sendAnim}>
              <ScaleOnPress
                onPress={() => send(content)}
                disabled={sendDisabled}
                pressedScale={0.88}
                glowColor={colors.primary}
                style={styles.sendBtn}
                accessibilityRole="button"
                accessibilityLabel="enviar mensagem"
                accessibilityState={{ disabled: sendDisabled, busy: creating }}
              >
                {creating ? <ActivityIndicator color={colors.black} /> : <Ionicons name="send" size={20} color={colors.black} />}
              </ScaleOnPress>
            </Animated.View>
          </View>
        )}
      </KeyboardAvoidingView>
      <SafetySheet
        visible={safety !== null}
        initialStep={safety ?? 'menu'}
        onClose={() => setSafety(null)}
        target={{ id: peer.id, name }}
        conversationId={conversationId ?? null}
        source={isRecipientRequest ? 'requests' : 'chat'}
        onDone={(outcome) => {
          if (outcome !== 'reported') leaveByMe();
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  dangerText: { color: colors.danger },

  headerTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, maxWidth: 240 },
  headerName: { ...typography.h4, color: colors.white, flexShrink: 1 },

  list: { padding: spacing.lg, paddingBottom: spacing.md, gap: spacing.sm, flexGrow: 1 },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowMe: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '78%', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.lg },
  bubbleMe: { backgroundColor: colors.secondary, borderBottomRightRadius: 4 },
  // colors.white é #FAFAFA, igual ao fundo: sem borda o balão recebido some
  bubbleOther: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.gray[200], borderBottomLeftRadius: 4 },
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

  systemRow: { alignItems: 'center', paddingVertical: spacing.xs },
  systemPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '92%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.lg,
    backgroundColor: '#FFE0F0',
  },
  systemText: { ...typography.bodySmall, color: colors.gray[700], fontStyle: 'italic', textAlign: 'center', flexShrink: 1 },

  requestBanner: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,20,147,0.35)',
    padding: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  requestHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  requestTitle: { ...typography.h4, color: colors.black, flexShrink: 1 },
  requestText: { ...typography.bodySmall, color: colors.gray[600] },
  requestPrimary: {
    minHeight: 44,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    marginTop: spacing.xs,
  },
  requestPrimaryText: { ...typography.label, color: colors.black, textAlign: 'center' },
  requestRow: { flexDirection: 'row', gap: spacing.sm },
  requestGhost: {
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
  requestGhostText: { ...typography.label, color: colors.gray[700], flexShrink: 1 },

  waitBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.gray[100],
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  waitText: { ...typography.bodySmall, color: colors.gray[700] },
  waitSub: { ...typography.caption, color: colors.gray[500], marginTop: 2 },

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
  emptyChatText: { ...typography.body, color: colors.gray[500], textAlign: 'center', marginTop: spacing.xs },

  error: { ...typography.bodySmall, color: colors.danger, textAlign: 'center', paddingHorizontal: spacing.lg, paddingBottom: spacing.xs },
  limit: { flexDirection: 'row', gap: spacing.sm, padding: spacing.lg, backgroundColor: colors.gray[100], alignItems: 'center', justifyContent: 'center' },
  limitText: { ...typography.bodySmall, color: colors.gray[600], textAlign: 'center', flexShrink: 1 },
});
