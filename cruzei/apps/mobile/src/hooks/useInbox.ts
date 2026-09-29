import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
  type QueryFunctionContext,
  type UseInfiniteQueryResult,
  type UseQueryOptions,
} from '@tanstack/react-query';
import {
  INBOX_LIMITS,
  type ChatMessageWithClientId,
  type ConversationDetail,
  type ConversationRef,
  type ConversationLookupResponse,
  type ConversationNewPayload,
  type ConversationPromotedPayload,
  type ConversationSummary,
  type InboxCounts,
  type InboxFolder,
  type InboxListResponse,
  type LikeStatus,
  type MessageNewPayload,
  type MessageReadPayload,
} from '@cruzei/shared-types';
import { api, toApiError } from '../services/api';
import { inboxPollMs } from '../services/socket';

// Mensagens: Principal + Solicitações. Chaves, queries e as funções que acertam o cache com os eventos do socket.
// Regra: unreadCount, pasta e promoção vêm SEMPRE do servidor (listas, detalhe ou payload do evento); o app só move a
// conversa de lugar no cache, nunca conta mensagens.

export const inboxKeys = {
  /** prefixo de tudo da aba Mensagens (principal, solicitações e contagem): invalidar ['inbox'] atualiza as três */
  all: ['inbox'] as const,
  list: (folder: InboxFolder) => (folder === 'inbox' ? (['inbox'] as const) : (['inbox', 'requests'] as const)),
  counts: ['inbox', 'counts'] as const,
  conversation: (id: string) => ['conversation', id] as const,
  messages: (id: string) => ['messages', id] as const,
  /** conversa do par (GET /conversations/with/:userId) */
  withUser: (userId: string) => ['conversation', 'with', userId] as const,
};

export type InboxPages = InfiniteData<InboxListResponse, string | null>;
/** mensagem no cache do chat: a que eu mandei guarda o clientId (chave estável do balão) */
export type CachedMessage = ChatMessageWithClientId;

// ───────────────────────────── queries ─────────────────────────────

/** GET /inbox (principal) ou GET /inbox/requests, por cursor (última mensagem mais recente primeiro) */
export function useInboxList(folder: InboxFolder, enabled = true): UseInfiniteQueryResult<InboxPages, Error> {
  const qc = useQueryClient();
  return useInfiniteQuery<InboxListResponse, Error, InboxPages, readonly string[], string | null>({
    queryKey: inboxKeys.list(folder),
    enabled,
    initialPageParam: null,
    queryFn: async ({ pageParam }: QueryFunctionContext<readonly string[], string | null>): Promise<InboxListResponse> => {
      const startedAt = Date.now();
      const res = await api.get<InboxListResponse>(folder === 'inbox' ? '/inbox' : '/inbox/requests', {
        params: pageParam ? { cursor: pageParam } : undefined,
      });
      // a 1ª página traz a contagem do servidor: aba e segmentado usam sem outra requisição. Não troca uma contagem
      // buscada depois que esta requisição saiu (ela é mais nova que a desta página)
      const countsAt = qc.getQueryState(inboxKeys.counts)?.dataUpdatedAt ?? 0;
      if (!pageParam && res.data.counts && countsAt <= startedAt) qc.setQueryData(inboxKeys.counts, res.data.counts);
      return res.data;
    },
    getNextPageParam: (last: InboxListResponse) => last.nextCursor ?? null,
    refetchInterval: inboxPollMs,
  });
}

/** contagem da aba (badge) e do segmentado (GET /inbox/counts; a 1ª página das listas também atualiza) */
export function useInboxCounts(enabled = true) {
  return useQuery({
    queryKey: inboxKeys.counts,
    enabled,
    queryFn: async () => (await api.get<InboxCounts>('/inbox/counts')).data,
    refetchInterval: inboxPollMs,
  });
}

/** número do badge da aba Mensagens: principal com não lidas + solicitações recebidas */
export function inboxBadge(c: InboxCounts | undefined): number {
  return c ? c.unreadInbox + c.requests : 0;
}

/** detalhe da conversa (opções fora do hook: o teste da corrida com o socket usa as mesmas) */
export function conversationQuery(
  id: string | undefined,
): UseQueryOptions<ConversationDetail, Error, ConversationDetail, ReturnType<typeof inboxKeys.conversation>> {
  return {
    queryKey: inboxKeys.conversation(id ?? ''),
    enabled: Boolean(id),
    queryFn: async () => (await api.get<ConversationDetail>(`/conversations/${id}`)).data,
    retry: (count, err) => toApiError(err).status !== 404 && count < 2,
  };
}

export function useConversation(id: string | undefined) {
  return useQuery(conversationQuery(id));
}

/** histórico (crescente). O servidor corta em INBOX_LIMITS.historyPageMax */
export function conversationMessagesQuery(
  qc: QueryClient,
  id: string | undefined,
): UseQueryOptions<CachedMessage[], Error, CachedMessage[], ReturnType<typeof inboxKeys.messages>> {
  return {
    queryKey: inboxKeys.messages(id ?? ''),
    enabled: Boolean(id),
    queryFn: async (): Promise<CachedMessage[]> => {
      // as minhas podem vir com clientId (o outbox do chat reconcilia por ele)
      const res = await api.get<CachedMessage[]>(`/conversations/${id}/messages`, { params: { limit: INBOX_LIMITS.historyPageMax } });
      const fetched = res.data;
      const prev = qc.getQueryData<CachedMessage[]>(inboxKeys.messages(id ?? ''));
      if (!prev?.length) return fetched;
      // sem clientId no histórico, mantém o das que já estavam no cache (balão não remonta) e não perde o que chegou
      // pelo socket enquanto a requisição voltava
      const cid = new Map<string, string>();
      for (const m of prev) if (m.clientId) cid.set(m.id, m.clientId);
      const ids = new Set(fetched.map((m) => m.id));
      const lastAt = fetched.length ? fetched[fetched.length - 1].createdAt : '';
      const late = prev.filter((m) => !ids.has(m.id) && m.createdAt > lastAt);
      return [...fetched.map((m) => (!m.clientId && cid.has(m.id) ? { ...m, clientId: cid.get(m.id) } : m)), ...late];
    },
    retry: (count, err) => toApiError(err).status !== 404 && count < 2,
  };
}

export function useConversationMessages(id: string | undefined) {
  const qc = useQueryClient();
  return useQuery(conversationMessagesQuery(qc, id));
}

/** a conversa do par, se existir (cartão, mapa e chat em rascunho) */
export function useConversationWith(userId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: inboxKeys.withUser(userId ?? ''),
    enabled: Boolean(userId) && enabled,
    queryFn: async (): Promise<ConversationLookupResponse> => {
      const d = (await api.get<ConversationLookupResponse | '' | null>(`/conversations/with/${userId}`)).data;
      // sem conversa = null (defensivo: corpo vazio também vira null)
      return d && typeof d === 'object' && 'id' in d ? d : null;
    },
  });
}

// ───────────────────────────── ações ─────────────────────────────

/** "Mover para principal" (só quem recebeu a solicitação). Idempotente no servidor; devolve a conversa já promovida */
export function usePromoteRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (conversationId: string) => (await api.post<ConversationSummary>(`/inbox/requests/${conversationId}/promote`)).data,
    onSuccess: (c) =>
      applyPromoted(qc, { conversationId: c.id, reason: c.promotedReason ?? 'manual', promotedAt: c.promotedAt ?? new Date().toISOString() }),
  });
}

/** arquiva do MEU lado (PATCH archived): some das minhas listas; a outra pessoa não é avisada */
export async function archiveConversation(qc: QueryClient, conversationId: string): Promise<void> {
  await api.patch(`/conversations/${conversationId}`, { archived: true });
  applyRemoved(qc, conversationId);
}

// ───────────────────────────── status da curtida ─────────────────────────────

/** o /nearby e o cartão mandam likeStatus (novo) e, enquanto existirem, likedByMe/likedMe (antigos) */
export interface LikeFlags {
  likeStatus?: LikeStatus | null;
  likedByMe?: boolean | null;
  likedMe?: boolean | null;
}

/** conversa do par que o /nearby e o cartão mandam junto ({id, folder}; null = não há, ou arquivada por mim) */
export interface ConversationFlag {
  conversation?: ConversationRef | null;
}

export function likeStatusOf(u: LikeFlags): LikeStatus {
  if (u.likeStatus) return u.likeStatus;
  const mine = Boolean(u.likedByMe);
  const theirs = Boolean(u.likedMe);
  if (mine && theirs) return 'MUTUAL';
  if (mine) return 'SENT';
  return theirs ? 'RECEIVED' : 'NONE';
}

/** eu já curti (sozinho ou os dois) */
export function iLiked(s: LikeStatus): boolean {
  return s === 'SENT' || s === 'MUTUAL';
}

/**
 * Quem curtiu, no 'like_received'. O servidor só manda fromUserId pra Premium+ ou quando a curtida fechou o par (mútua,
 * os dois veem); pros outros vem só {isSuper}. Sem id = sem identidade nenhuma na tela (nem emote no mapa).
 */
export function likerIdOf(p: unknown): string | null {
  const id = p && typeof p === 'object' ? (p as { fromUserId?: unknown }).fromUserId : undefined;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

// ───────────────────────────── outbox do chat ─────────────────────────────

/** balão meu ainda não confirmado pelo servidor (pending/failed) ou já confirmado (sent, com o id real) */
export type OutboxMessage = CachedMessage & { pending?: boolean; failed?: boolean; sent?: boolean };

/**
 * O servidor já tem a mensagem (histórico ou eco do socket trouxe o mesmo clientId): o balão otimista vira a real,
 * inclusive o que ficou "não foi · toca pra reenviar" porque a resposta do POST se perdeu. Devolve o mesmo array
 * quando nada muda (sem re-render).
 */
export function settleOutbox(outbox: OutboxMessage[], delivered: ReadonlyMap<string, CachedMessage>): OutboxMessage[] {
  let changed = false;
  const next = outbox.map((o) => {
    const m = o.clientId && !o.sent ? delivered.get(o.clientId) : undefined;
    if (!m || !o.clientId) return o;
    changed = true;
    return { ...o, ...m, clientId: o.clientId, pending: false, failed: false, sent: true };
  });
  return changed ? next : outbox;
}

// ───────────────────────────── cache (socket e ações) ─────────────────────────────

function sortKey(c: ConversationSummary): string {
  return c.lastMessageAt ?? '';
}

function removeFromList(qc: QueryClient, folder: InboxFolder, id: string): void {
  qc.setQueryData<InboxPages>(inboxKeys.list(folder), (d) =>
    d ? { ...d, pages: d.pages.map((p) => ({ ...p, items: p.items.filter((c) => c.id !== id) })) } : d,
  );
}

/**
 * Coloca a conversa na pasta dela (c.folder), na posição da última mensagem, e tira da outra pasta.
 * false = a lista dessa pasta não está no cache (ela vem inteira do servidor quando abrir).
 */
function placeInList(qc: QueryClient, c: ConversationSummary): boolean {
  removeFromList(qc, c.folder === 'inbox' ? 'requests' : 'inbox', c.id);
  const key = inboxKeys.list(c.folder);
  const data = qc.getQueryData<InboxPages>(key);
  if (!data) return false;
  const pages = data.pages.map((p) => ({ ...p, items: p.items.filter((x) => x.id !== c.id) }));
  const first = pages[0];
  if (!first) return false;
  // a mais recente fica em cima; conversa mais velha que a 1ª página inteira vai pro fim dela (a próxima página confirma)
  const at = first.items.findIndex((x) => sortKey(x) <= sortKey(c));
  const items = [...first.items];
  items.splice(at === -1 ? items.length : at, 0, c);
  pages[0] = { ...first, items };
  qc.setQueryData<InboxPages>(key, { ...data, pages });
  return true;
}

function patchInList(qc: QueryClient, id: string, fn: (c: ConversationSummary) => ConversationSummary): void {
  for (const folder of ['inbox', 'requests'] as const) {
    qc.setQueryData<InboxPages>(inboxKeys.list(folder), (d) =>
      d ? { ...d, pages: d.pages.map((p) => ({ ...p, items: p.items.map((c) => (c.id === id ? fn(c) : c)) })) } : d,
    );
  }
}

export function findSummary(qc: QueryClient, id: string): { folder: InboxFolder; item: ConversationSummary } | null {
  for (const folder of ['inbox', 'requests'] as const) {
    const data = qc.getQueryData<InboxPages>(inboxKeys.list(folder));
    for (const p of data?.pages ?? []) {
      const item = p.items.find((c) => c.id === id);
      if (item) return { folder, item };
    }
  }
  return null;
}

/**
 * Busca de novo DESCARTANDO a resposta em voo: o SELECT dela pode ter rodado antes do commit do evento, e ela
 * sobrescreveria o que o evento acertou. Com dados, o invalidate já cancela a busca velha (cancelRefetch); na 1ª carga
 * (sem dados) o React Query só pegaria carona nela, então cancela antes (volta pro estado de antes da busca).
 */
function refetchFresh(qc: QueryClient, queryKey: readonly unknown[]): void {
  const st = qc.getQueryState(queryKey);
  if (st?.fetchStatus === 'fetching' && st.data === undefined) void qc.cancelQueries({ queryKey, exact: true });
  void qc.invalidateQueries({ queryKey, exact: true });
}

/** evento do socket numa query com busca em andamento: refaz a busca (sem busca em voo, o setQueryData já basta) */
function refetchIfInFlight(qc: QueryClient, queryKey: readonly unknown[]): void {
  if (qc.getQueryState(queryKey)?.fetchStatus === 'fetching') refetchFresh(qc, queryKey);
}

function refetchListsIfInFlight(qc: QueryClient): void {
  refetchIfInFlight(qc, inboxKeys.list('inbox'));
  refetchIfInFlight(qc, inboxKeys.list('requests'));
}

/** GET /conversations/with/:userId no cache (cartão e chat em rascunho acham a conversa sem ir ao servidor) */
function setLookup(qc: QueryClient, userId: string, ref: ConversationLookupResponse): void {
  const key = inboxKeys.withUser(userId);
  qc.setQueryData(key, ref);
  refetchIfInFlight(qc, key);
}

function invalidateLists(qc: QueryClient): void {
  refetchFresh(qc, inboxKeys.list('inbox'));
  refetchFresh(qc, inboxKeys.list('requests'));
}

let countsTimer: ReturnType<typeof setTimeout> | null = null;
/** a contagem da aba vem do servidor: junta rajadas de eventos numa requisição só */
export function refreshCounts(qc: QueryClient): void {
  if (countsTimer) clearTimeout(countsTimer);
  countsTimer = setTimeout(() => {
    countsTimer = null;
    qc.invalidateQueries({ queryKey: inboxKeys.counts });
  }, 800);
}

/**
 * Mensagem nova no histórico aberto: substitui a otimista (clientId) ou a repetida (id); senão entra em ordem.
 * Sem histórico no cache ele vem inteiro do servidor quando o chat abrir; se a busca já está em voo, ela é refeita
 * (a resposta dela pode não ter a mensagem, e o chat aberto ficaria sem ela).
 */
export function upsertMessage(qc: QueryClient, conversationId: string, m: CachedMessage): void {
  const key = inboxKeys.messages(conversationId);
  qc.setQueryData<CachedMessage[]>(key, (prev) => {
    if (!prev) return prev;
    const i = prev.findIndex((x) => x.id === m.id || (m.clientId != null && x.clientId === m.clientId));
    if (i >= 0) {
      const next = [...prev];
      next[i] = { ...prev[i], ...m, clientId: m.clientId ?? prev[i].clientId, readAt: m.readAt ?? prev[i].readAt };
      return next;
    }
    const next = [...prev, m];
    // chegou fora de ordem (reconexão): mantém crescente
    if (prev.length && prev[prev.length - 1].createdAt > m.createdAt) next.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
    return next;
  });
  refetchIfInFlight(qc, key);
}

/** 'message:new' (inclui a de sistema; unreadCount é o meu, contado pelo servidor) */
export function applyMessageNew(qc: QueryClient, p: MessageNewPayload): void {
  upsertMessage(qc, p.conversationId, p.message);
  const found = findSummary(qc, p.conversationId);
  if (found) {
    placeInList(qc, { ...found.item, lastMessage: p.message, lastMessageAt: p.message.createdAt, unreadCount: p.unreadCount });
    refetchListsIfInFlight(qc);
  } else {
    // fora do cache (lista não carregada, conversa que voltou do arquivo): o servidor manda a lista certa
    invalidateLists(qc);
  }
  const detailKey = inboxKeys.conversation(p.conversationId);
  qc.setQueryData<ConversationDetail>(detailKey, (d) =>
    d ? { ...d, lastMessage: p.message, lastMessageAt: p.message.createdAt, unreadCount: p.unreadCount } : d,
  );
  refetchIfInFlight(qc, detailKey);
  refreshCounts(qc);
}

/** 'conversation:new' (um por lado: pasta, peer e unread já vêm do meu ponto de vista) */
export function applyConversationNew(qc: QueryClient, p: ConversationNewPayload): void {
  const c = p.conversation;
  placeInList(qc, c);
  refetchListsIfInFlight(qc);
  setLookup(qc, c.peer.id, { id: c.id, folder: c.folder });
  refreshCounts(qc);
}

/** 'conversation:promoted': solicitação → principal (banner some, conversa troca de aba) */
export function applyPromoted(qc: QueryClient, p: ConversationPromotedPayload): void {
  const promote = <T extends ConversationSummary>(c: T): T =>
    ({
      ...c,
      promotedAt: p.promotedAt,
      promotedReason: p.reason,
      route: 'principal',
      folder: 'inbox',
      awaitingReply: false,
      likeStatus: p.reason === 'mutual' ? 'MUTUAL' : c.likeStatus,
    }) as T;
  const found = findSummary(qc, p.conversationId);
  if (found) {
    if (found.folder === 'requests') {
      removeFromList(qc, 'requests', p.conversationId);
      if (!placeInList(qc, promote(found.item))) invalidateLists(qc);
      else refetchListsIfInFlight(qc);
    } else {
      patchInList(qc, p.conversationId, promote);
      refetchListsIfInFlight(qc);
    }
  } else invalidateLists(qc);
  let peerId = found?.item.peer.id;
  const detailKey = inboxKeys.conversation(p.conversationId);
  qc.setQueryData<ConversationDetail>(detailKey, (d) => {
    if (!d) return d;
    peerId = peerId ?? d.peer.id;
    return { ...promote(d), requestMessagesLeft: null };
  });
  // o GET do detalhe em voo (ex.: invalidado depois de um envio) voltaria com a rota de antes e travaria o composer
  refetchIfInFlight(qc, detailKey);
  if (peerId) setLookup(qc, peerId, { id: p.conversationId, folder: 'inbox' });
  refreshCounts(qc);
}

/**
 * 'message:read'. Eu li (neste ou em outro aparelho): o servidor zerou o unread_count dessa conversa.
 * O outro leu: recibo (✓✓) nas minhas mensagens até upToMessageId.
 */
export function applyRead(qc: QueryClient, p: MessageReadPayload, myId: string | undefined): void {
  if (p.readerId === myId) {
    const last = findSummary(qc, p.conversationId)?.item.lastMessage ?? qc.getQueryData<ConversationDetail>(inboxKeys.conversation(p.conversationId))?.lastMessage;
    // leu até a última (ou tudo): o servidor zerou. Leitura parcial: busca a contagem certa em vez de calcular aqui
    if (!p.upToMessageId || !last || last.id === p.upToMessageId) applyUnread(qc, p.conversationId, 0);
    else {
      invalidateLists(qc);
      refetchFresh(qc, inboxKeys.conversation(p.conversationId));
      refreshCounts(qc);
    }
    return;
  }
  const key = inboxKeys.messages(p.conversationId);
  qc.setQueryData<CachedMessage[]>(key, (prev) => {
    if (!prev) return prev;
    const upTo = p.upToMessageId ? prev.findIndex((m) => m.id === p.upToMessageId) : prev.length - 1;
    let changed = false;
    const next = prev.map((m, i) => {
      const mine = m.senderId !== p.readerId && m.messageType !== 'system';
      // sem a mensagem no cache (fora da página): vale o que foi criado antes da leitura
      const covered = upTo >= 0 ? i <= upTo : m.createdAt <= p.readAt;
      if (!mine || m.readAt || !covered) return m;
      changed = true;
      return { ...m, readAt: p.readAt };
    });
    return changed ? next : prev;
  });
  refetchIfInFlight(qc, key);
}

/** não lidas de uma conversa com o número que o servidor devolveu (POST /read) */
export function applyUnread(qc: QueryClient, conversationId: string, unreadCount: number): void {
  patchInList(qc, conversationId, (c) => (c.unreadCount === unreadCount ? c : { ...c, unreadCount }));
  refetchListsIfInFlight(qc);
  const detailKey = inboxKeys.conversation(conversationId);
  qc.setQueryData<ConversationDetail>(detailKey, (d) => (d && d.unreadCount !== unreadCount ? { ...d, unreadCount } : d));
  refetchIfInFlight(qc, detailKey);
  refreshCounts(qc);
}

/** 'conversation:removed' (bloqueio, moderação) ou arquivar: some das listas; o chat aberto fecha sozinho */
export function applyRemoved(qc: QueryClient, conversationId: string): void {
  const found = findSummary(qc, conversationId);
  removeFromList(qc, 'inbox', conversationId);
  removeFromList(qc, 'requests', conversationId);
  refetchListsIfInFlight(qc);
  const peerId = found?.item.peer.id ?? qc.getQueryData<ConversationDetail>(inboxKeys.conversation(conversationId))?.peer.id;
  if (peerId) setLookup(qc, peerId, null);
  // o chat aberto (query ativa) cuida de si; o resto do cache da conversa sai
  qc.removeQueries({ queryKey: inboxKeys.messages(conversationId), type: 'inactive' });
  qc.removeQueries({ queryKey: inboxKeys.conversation(conversationId), type: 'inactive' });
  refreshCounts(qc);
}
