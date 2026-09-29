import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { SupportMessage, SupportMessageEvent, SupportThreadForUser, SupportThreadResponse } from '@cruzei/shared-types';
import { api, toApiError } from '../services/api';
import { getSocket } from '../services/socket';

// Suporte ao vivo (lado do app): o atendimento atual (ou o último encerrado) com as mensagens, o evento do socket e as
// funções puras do envio otimista (reconciliação por clientId) e do "digitando".

export const supportKeys = {
  all: ['support'] as const,
  thread: ['support', 'thread'] as const,
};

/** balão meu ainda não confirmado (pending/failed) ou já confirmado pelo servidor (sent, com o id real) */
export type SupportOutboxMessage = SupportMessage & { pending?: boolean; failed?: boolean; sent?: boolean };

type Obj = Record<string, unknown>;
const asObj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null);

function isMessage(v: unknown): v is SupportMessage {
  const o = asObj(v);
  return Boolean(o && typeof o.id === 'string' && typeof o.body === 'string' && typeof o.author === 'string');
}

function byCreatedAt(a: SupportMessage, b: SupportMessage): number {
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

/** nota interna nunca aparece no app (o servidor já tira; aqui é só a segunda trava) */
function visible(messages: SupportMessage[]): SupportMessage[] {
  return messages.filter((m) => !m.internal);
}

/** GET /support/thread (defensivo: sem atendimento = thread null e lista vazia) */
export function normalizeThreadResponse(raw: unknown): SupportThreadResponse {
  const o = asObj(raw);
  const thread = asObj(o?.thread) ? (o?.thread as SupportThreadForUser) : null;
  const messages = Array.isArray(o?.messages) ? visible((o?.messages as unknown[]).filter(isMessage)) : [];
  return { thread, messages: [...messages].sort(byCreatedAt) };
}

/**
 * Resposta nova do GET com o cache de antes: do mesmo atendimento, não perde o que chegou pelo socket enquanto a
 * requisição voltava e mantém o clientId das minhas (o balão não remonta).
 */
export function mergeFetchedThread(prev: SupportThreadResponse | undefined, fetched: SupportThreadResponse): SupportThreadResponse {
  if (!prev?.thread || !fetched.thread || prev.thread.id !== fetched.thread.id || !prev.messages.length) return fetched;
  const cid = new Map<string, string>();
  for (const m of prev.messages) if (m.clientId) cid.set(m.id, m.clientId);
  const ids = new Set(fetched.messages.map((m) => m.id));
  const lastAt = fetched.messages.length ? fetched.messages[fetched.messages.length - 1].createdAt : '';
  const late = prev.messages.filter((m) => !ids.has(m.id) && m.createdAt > lastAt);
  const messages = [...fetched.messages.map((m) => (!m.clientId && cid.has(m.id) ? { ...m, clientId: cid.get(m.id) } : m)), ...late];
  return { ...fetched, messages };
}

/** sem socket, o que chega da equipe só aparece pelo polling */
function supportPollMs(): number | false {
  return getSocket()?.connected ? false : 30_000;
}

export function useSupportThread(enabled = true) {
  const qc = useQueryClient();
  return useQuery<SupportThreadResponse>({
    queryKey: supportKeys.thread,
    enabled,
    queryFn: async () => {
      let raw: unknown;
      try {
        raw = (await api.get('/support/thread')).data;
      } catch (err) {
        // "ainda não tem atendimento" como 404: a tela abre vazia e a 1ª mensagem cria o atendimento
        if (toApiError(err).status !== 404) throw err;
        raw = null;
      }
      return mergeFetchedThread(qc.getQueryData<SupportThreadResponse>(supportKeys.thread), normalizeThreadResponse(raw));
    },
    refetchInterval: supportPollMs,
  });
}

/** mensagens da equipe que a pessoa ainda não leu (contador do botão "Falar com o suporte") */
export function supportUnread(data: SupportThreadResponse | undefined): number {
  return Math.max(0, data?.thread?.unread ?? 0);
}

// ───────────────────────────── envio otimista ─────────────────────────────

/**
 * Lista na tela = histórico + as minhas que o servidor ainda não devolveu. A que o histórico trouxe sem clientId herda o
 * da otimista (chave estável do balão).
 */
export function mergeSupportView(history: SupportMessage[], outbox: SupportOutboxMessage[]): SupportOutboxMessage[] {
  const histIds = new Set(history.map((m) => m.id));
  const histCids = new Set(history.map((m) => m.clientId).filter(Boolean));
  const sentCid = new Map<string, string>();
  for (const o of outbox) if (o.sent && o.clientId) sentCid.set(o.id, o.clientId);
  const merged = history.map((m) => (!m.clientId && sentCid.has(m.id) ? { ...m, clientId: sentCid.get(m.id) } : m));
  const local = outbox.filter((o) => !histIds.has(o.id) && !(o.clientId && histCids.has(o.clientId)));
  return [...merged, ...local];
}

/**
 * A tela passou a mostrar outro atendimento (o anterior foi encerrado e a pessoa abriu outro): as minhas já confirmadas
 * de atendimentos anteriores saem do outbox (senão voltariam como "no ar" embaixo do atendimento novo). As que ainda
 * estão no ar ou falharam ficam. Nada muda = o mesmo array.
 */
export function pruneSupportOutbox(outbox: SupportOutboxMessage[], threadId: string): SupportOutboxMessage[] {
  const next = outbox.filter((o) => !o.sent || o.threadId === threadId);
  return next.length === outbox.length ? outbox : next;
}

/**
 * O servidor já tem a mensagem (resposta do POST, eco do socket ou histórico com o mesmo clientId): o balão otimista
 * vira a real, inclusive o "não foi · toca pra reenviar" cuja resposta se perdeu. Nada muda = o mesmo array.
 */
export function settleSupportOutbox(outbox: SupportOutboxMessage[], delivered: ReadonlyMap<string, SupportMessage>): SupportOutboxMessage[] {
  let changed = false;
  const next = outbox.map((o) => {
    const m = o.clientId && !o.sent ? delivered.get(o.clientId) : undefined;
    if (!m || !o.clientId) return o;
    changed = true;
    return { ...o, ...m, clientId: o.clientId, pending: false, failed: false, sent: true };
  });
  return changed ? next : outbox;
}

/** POST /support/messages: a mensagem (e o atendimento, quando o servidor manda junto) */
export function parseSendResponse(raw: unknown): { message: SupportMessage | null; thread: SupportThreadForUser | null } {
  if (isMessage(raw)) return { message: raw, thread: null };
  const o = asObj(raw);
  return { message: isMessage(o?.message) ? o.message : null, thread: asObj(o?.thread) ? (o?.thread as SupportThreadForUser) : null };
}

// ───────────────────────────── cache (socket e ações) ─────────────────────────────

/**
 * 'support:message' no cache do atendimento: troca a otimista (clientId) ou a repetida (id), senão entra em ordem.
 * `stale`: o cache não serve pra esse evento (atendimento novo, ou mensagem de sistema, que costuma mudar o status) e o
 * atendimento precisa ser buscado de novo.
 */
export function upsertSupportMessage(
  prev: SupportThreadResponse | undefined,
  ev: SupportMessageEvent,
): { next: SupportThreadResponse | undefined; stale: boolean } {
  const m = ev.message;
  if (!prev) return { next: prev, stale: false };
  if (m.internal) return { next: prev, stale: false };
  if (!prev.thread || prev.thread.id !== ev.threadId) return { next: prev, stale: true };
  const i = prev.messages.findIndex((x) => x.id === m.id || (m.clientId != null && x.clientId === m.clientId));
  let messages: SupportMessage[];
  if (i >= 0) {
    messages = [...prev.messages];
    messages[i] = { ...prev.messages[i], ...m, clientId: m.clientId ?? prev.messages[i].clientId };
  } else {
    messages = [...prev.messages, m];
    if (prev.messages.length && prev.messages[prev.messages.length - 1].createdAt > m.createdAt) messages.sort(byCreatedAt);
  }
  const lastMessageAt = m.createdAt > prev.thread.lastMessageAt ? m.createdAt : prev.thread.lastMessageAt;
  return { next: { ...prev, thread: { ...prev.thread, lastMessageAt }, messages }, stale: m.author === 'system' };
}

/** o chat do suporte está na tela (a leitura é dele; o contador de não lidas não precisa ir ao servidor) */
let supportChatOpen = false;
export function setSupportChatOpen(open: boolean): void {
  supportChatOpen = open;
}

/** busca de novo descartando a que está em voo (a resposta dela pode ser de antes do evento) */
function refetchThread(qc: QueryClient): void {
  const st = qc.getQueryState(supportKeys.thread);
  if (st?.fetchStatus === 'fetching' && st.data === undefined) void qc.cancelQueries({ queryKey: supportKeys.thread, exact: true });
  void qc.invalidateQueries({ queryKey: supportKeys.thread, exact: true });
}

/** 'support:message' (sala user:<id>) e a resposta do meu POST */
export function applySupportMessage(qc: QueryClient, ev: SupportMessageEvent): void {
  const { next, stale } = upsertSupportMessage(qc.getQueryData<SupportThreadResponse>(supportKeys.thread), ev);
  if (next) qc.setQueryData(supportKeys.thread, next);
  // resposta da equipe fora do chat: o contador de não lidas vem do servidor
  if (stale || (ev.message.author === 'staff' && !supportChatOpen)) refetchThread(qc);
  else if (qc.getQueryState(supportKeys.thread)?.fetchStatus === 'fetching') refetchThread(qc);
}

// ───────────────────────────── "digitando" ─────────────────────────────

export interface TypingEmitterOptions {
  /** true repetido enquanto a pessoa segue digitando (o outro lado apaga o "digitando" sozinho depois de uns segundos) */
  repeatMs?: number;
  /** sem tecla por esse tempo = parou de digitar */
  idleMs?: number;
  now?: () => number;
}

/**
 * "digitando" com moderação: manda só na mudança (true ao começar, false ao parar ou enviar) e repete o true a cada
 * `repeatMs` enquanto a pessoa segue digitando. Um false solto nunca sai (diria que a pessoa está ali sem estar).
 */
export function createTypingEmitter(emit: (isTyping: boolean) => void, opts: TypingEmitterOptions = {}) {
  const repeatMs = opts.repeatMs ?? 3000;
  const idleMs = opts.idleMs ?? 1500;
  const now = opts.now ?? Date.now;
  let typing = false;
  let lastTrueAt = 0;
  let idle: ReturnType<typeof setTimeout> | null = null;

  const stop = () => {
    if (idle) clearTimeout(idle);
    idle = null;
    if (!typing) return;
    typing = false;
    emit(false);
  };

  return {
    /** tecla no campo (texto vazio = apagou tudo: parou) */
    input(textLength: number) {
      if (textLength === 0) return stop();
      const t = now();
      if (!typing || t - lastTrueAt >= repeatMs) {
        typing = true;
        lastTrueAt = t;
        emit(true);
      }
      if (idle) clearTimeout(idle);
      idle = setTimeout(stop, idleMs);
    },
    stop,
    /** saiu da tela: fecha o "digitando" e solta o timer */
    dispose: stop,
  };
}
