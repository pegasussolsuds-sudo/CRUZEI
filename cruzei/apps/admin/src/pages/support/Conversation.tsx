// Conversa ao vivo: mensagens, "digitando", nota interna, respostas rápidas, atribuir e resolver.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Clock, Lock, MessageSquareText, PanelRightOpen, RotateCcw, Send, UserMinus, UserPlus, Zap } from 'lucide-react';
import {
  SUPPORT_EVENTS,
  SUPPORT_LIMITS,
  type SupportMessage,
  type SupportThreadDetail,
  type SupportThreadList,
  type SupportThreadStatus,
  type SupportThreadSummary,
} from '@cruzei/shared-types';
import { adminApi } from '@/api/admin';
import { qk } from '@/api/keys';
import { errorMessage } from '@/api/http';
import { useMe } from '@/auth/AuthProvider';
import { formatShortDateTime, formatTime, TIME_ZONE } from '@/lib/format';
import { isPendingMessage, mergeMessage, PENDING_PREFIX, QUICK_REPLIES } from '@/lib/support';
import { useDismiss } from '@/lib/hooks';
import { useSocket, useSocketEvent } from '@/realtime/SocketProvider';
import { useSupportLive } from '@/realtime/SupportLive';
import { SupportStatusBadge } from '@/components/badges';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { ErrorState, LoadingState } from '@/components/ui/States';
import { useToast } from '@/components/ui/Toast';
import { ContextPanel } from './ContextPanel';

const TYPING_IDLE_MS = 3000;

/** dia da mensagem em São Paulo (separador "segunda-feira, 29 de setembro") */
function dayKey(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: TIME_ZONE });
}

function newClientId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `c${Date.now()}${Math.random().toString(36).slice(2)}`;
}

export function Conversation({ threadId }: { threadId: string }) {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const { socket } = useSocket();
  const { setViewing, applyThread } = useSupportLive();
  const [text, setText] = useState('');
  const [internal, setInternal] = useState(false);
  const [userTyping, setUserTyping] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const quickRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const typingSent = useRef(false);
  const typingTimer = useRef<number | undefined>(undefined);
  const userTypingTimer = useRef<number | undefined>(undefined);
  useDismiss(quickRef, quickOpen, () => setQuickOpen(false));

  const detail = useQuery({ queryKey: qk.supportThread(threadId), queryFn: () => adminApi.supportThread(threadId), staleTime: 0 });
  const t = detail.data;
  // atendimento encerrado só aceita nota interna (o servidor devolve 409 thread_resolved pra resposta)
  const noteOnly = t?.status === 'resolved';
  const asNote = internal || noteOnly;

  // abriu = leu: zera as não lidas na hora (listas) e avisa o servidor (POST /read → 'support:thread' pra equipe toda)
  const markRead = useCallback(() => {
    qc.setQueriesData<InfiniteData<SupportThreadList, string | null>>({ queryKey: qk.supportThreadsAll }, (old) =>
      old ? { ...old, pages: old.pages.map((p) => ({ ...p, items: p.items.map((x) => (x.id === threadId ? { ...x, staffUnread: 0 } : x)) })) } : old,
    );
    adminApi
      .supportRead(threadId)
      .then((s) => applyThread(s))
      .catch(() => undefined); // não lida é detalhe: falhou, fica pra próxima
  }, [qc, threadId, applyThread]);

  const hasUnread = (detail.data?.staffUnread ?? 0) > 0;
  useEffect(() => {
    if (detail.isSuccess && hasUnread && !document.hidden) markRead();
  }, [detail.isSuccess, hasUnread, markRead]);

  useEffect(() => {
    setViewing(threadId);
    return () => setViewing(null);
  }, [threadId, setViewing]);

  // "digitando" da pessoa (some sozinho se o "parou" se perder)
  useSocketEvent(SUPPORT_EVENTS.typing, (e) => {
    if (e.threadId !== threadId || e.author !== 'user') return;
    setUserTyping(e.isTyping);
    window.clearTimeout(userTypingTimer.current);
    if (e.isTyping) userTypingTimer.current = window.setTimeout(() => setUserTyping(false), 6000);
  });
  useSocketEvent(SUPPORT_EVENTS.message, (e) => {
    if (e.threadId !== threadId || e.message.author !== 'user') return;
    setUserTyping(false);
    // conversa aberta na tela: a mensagem nova já foi lida
    if (!document.hidden) markRead();
  });

  // voltou pra aba com mensagem nova: marca como lida
  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden && (qc.getQueryData<SupportThreadDetail>(qk.supportThread(threadId))?.staffUnread ?? 0) > 0) markRead();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [qc, threadId, markRead]);

  const emitTyping = useCallback(
    (isTyping: boolean) => {
      if (!socket || typingSent.current === isTyping) return;
      typingSent.current = isTyping;
      socket.emit(SUPPORT_EVENTS.typing, { threadId, isTyping });
    },
    [socket, threadId],
  );

  useEffect(
    () => () => {
      window.clearTimeout(typingTimer.current);
      window.clearTimeout(userTypingTimer.current);
      emitTyping(false);
    },
    [emitTyping],
  );

  // rolagem: gruda no fim se a pessoa já estava lá
  const messages = t?.messages ?? [];
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, userTyping]);

  const setDetail = (fn: (d: SupportThreadDetail) => SupportThreadDetail) =>
    qc.setQueryData<SupportThreadDetail>(qk.supportThread(threadId), (old) => (old ? fn(old) : old));

  const send = useMutation({
    mutationFn: (m: SupportMessage) => adminApi.supportSend(threadId, { body: m.body, internal: m.internal, clientId: m.clientId }),
    onMutate: (m) => {
      setDetail((d) => ({ ...d, messages: mergeMessage(d.messages, m) }));
    },
    onSuccess: (saved, m) => {
      setDetail((d) => ({ ...d, messages: mergeMessage(d.messages, { ...saved, clientId: saved.clientId ?? m.clientId }) }));
    },
    onError: (err, m) => {
      setDetail((d) => ({ ...d, messages: d.messages.filter((x) => x.id !== m.id) }));
      setText((cur) => cur || m.body);
      toast.error(`Não foi: ${errorMessage(err)}`);
    },
  });

  const submit = () => {
    const body = text.trim();
    if (!body || body.length > SUPPORT_LIMITS.bodyMax) return;
    const clientId = newClientId();
    const optimistic: SupportMessage = {
      id: `${PENDING_PREFIX}${clientId}`,
      threadId,
      author: 'staff',
      senderId: me.id,
      senderName: me.name,
      body,
      internal: asNote,
      createdAt: new Date().toISOString(),
      clientId,
    };
    stickToBottom.current = true;
    setText('');
    emitTyping(false);
    send.mutate(optimistic);
    inputRef.current?.focus();
  };

  const updateSummary = (s: SupportThreadSummary) => applyThread(s);

  const assign = useMutation({
    mutationFn: (userId: string | null) => adminApi.supportAssign(threadId, { userId }),
    onSuccess: (s, assigneeId) => {
      if (s) updateSummary(s);
      toast.success(assigneeId ? 'Atendimento com você' : 'Atribuição removida');
      void qc.invalidateQueries({ queryKey: qk.supportThreadsAll });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const status = useMutation({
    mutationFn: (s: SupportThreadStatus) => adminApi.supportStatus(threadId, { status: s }),
    onSuccess: (s, next) => {
      if (s) updateSummary(s);
      toast.success(next === 'resolved' ? 'Atendimento resolvido' : next === 'pending' ? 'Marcado como pendente' : 'Atendimento reaberto');
      void qc.invalidateQueries({ queryKey: qk.supportThreadsAll });
      void qc.invalidateQueries({ queryKey: qk.supportLive });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (detail.isPending) {
    return (
      <section className="support-conv" aria-label="Conversa">
        <LoadingState label="Abrindo conversa…" />
      </section>
    );
  }
  if (detail.isError || !t) {
    return (
      <section className="support-conv" aria-label="Conversa">
        <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
      </section>
    );
  }

  const mine = t.assignedTo?.id === me.id;
  const over = text.length > SUPPORT_LIMITS.bodyMax;

  return (
    <>
      <section className="support-conv" aria-label={`Conversa com ${t.user.name}`}>
        <header className="conv-head">
          <Link to="/suporte" className="btn btn-ghost btn-sm btn-icon conv-back" aria-label="Voltar pra fila">
            <ArrowLeft size={16} />
          </Link>
          <Avatar name={t.user.name} url={t.user.avatarUrl} size={40} premium={t.user.premiumTier !== 'free'} />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="row">
              <Link to={`/usuarios/${t.user.id}`} className="strong truncate conv-name">
                {t.user.name}
              </Link>
              <SupportStatusBadge status={t.status} />
            </div>
            <div className="xsmall faint truncate">
              {t.assignedTo ? (mine ? 'Com você' : `Com ${t.assignedTo.name}`) : 'Sem atribuição'} · aberto {formatShortDateTime(t.createdAt)}
            </div>
          </div>
          <div className="row conv-actions">
            {mine ? (
              <Button size="sm" variant="ghost" icon={<UserMinus size={14} />} loading={assign.isPending} onClick={() => assign.mutate(null)}>
                Soltar
              </Button>
            ) : (
              <Button size="sm" icon={<UserPlus size={14} />} loading={assign.isPending} onClick={() => assign.mutate(me.id)}>
                Pegar pra mim
              </Button>
            )}
            {t.status === 'resolved' ? (
              <Button size="sm" icon={<RotateCcw size={14} />} loading={status.isPending} onClick={() => status.mutate('open')}>
                Reabrir
              </Button>
            ) : (
              <>
                {t.status === 'open' ? (
                  <Button size="sm" variant="ghost" icon={<Clock size={14} />} loading={status.isPending && status.variables === 'pending'} onClick={() => status.mutate('pending')} title="Esperando a pessoa responder">
                    Pendente
                  </Button>
                ) : null}
                <Button size="sm" variant="primary" icon={<CheckCircle2 size={14} />} loading={status.isPending && status.variables === 'resolved'} onClick={() => status.mutate('resolved')}>
                  Resolver
                </Button>
              </>
            )}
            <Button size="sm" variant="ghost" iconOnly icon={<PanelRightOpen size={16} />} aria-label="Mostrar contexto da pessoa" aria-expanded={showContext} className="conv-context-toggle" onClick={() => setShowContext((v) => !v)} />
          </div>
        </header>

        <div
          className="conv-scroll"
          ref={scrollRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          <ol className="bubbles" aria-live="polite" aria-relevant="additions">
            {messages.map((m, i) => {
              const prev = messages[i - 1];
              const showDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
              return (
                <li key={m.id} className="bubble-row" data-author={m.author} data-internal={m.internal}>
                  {showDay ? <div className="day-sep">{new Date(m.createdAt).toLocaleDateString('pt-BR', { timeZone: TIME_ZONE, weekday: 'long', day: '2-digit', month: 'long' })}</div> : null}
                  {m.author === 'system' ? (
                    <div className="bubble-system">{m.body}</div>
                  ) : (
                    <div className="bubble" data-pending={isPendingMessage(m)}>
                      {m.internal ? (
                        <div className="bubble-note-tag">
                          <Lock size={11} /> Nota interna
                        </div>
                      ) : null}
                      <div className="pre-wrap">{m.body}</div>
                      <div className="bubble-meta">
                        {m.author === 'staff' ? `${m.senderName ?? 'Equipe'} · ` : ''}
                        {isPendingMessage(m) ? 'enviando…' : formatTime(m.createdAt)}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
            {!messages.length ? <li className="bubble-system">Sem mensagens ainda.</li> : null}
          </ol>
          {userTyping ? (
            <div className="typing" role="status">
              <span className="typing-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              {t.user.name.split(' ')[0]} está digitando…
            </div>
          ) : null}
        </div>

        <form
          className="composer-bar"
          data-internal={asNote}
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="composer-tools">
            <div className="segmented" role="radiogroup" aria-label="Tipo de mensagem">
              <button type="button" role="radio" aria-checked={!asNote} disabled={noteOnly} onClick={() => setInternal(false)} title={noteOnly ? 'Reabra o atendimento pra responder' : undefined}>
                <MessageSquareText size={14} /> Resposta
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={asNote}
                onClick={() => {
                  setInternal(true);
                  emitTyping(false);
                }}
              >
                <Lock size={14} /> Nota interna
              </button>
            </div>
            <div className="menu-wrap" ref={quickRef}>
              <Button size="sm" variant="ghost" icon={<Zap size={14} />} aria-haspopup="menu" aria-expanded={quickOpen} onClick={() => setQuickOpen((v) => !v)}>
                Respostas rápidas
              </Button>
              {quickOpen ? (
                <div className="menu quick-menu" role="menu" aria-label="Respostas rápidas">
                  {QUICK_REPLIES.map((q) => (
                    <button
                      key={q.label}
                      type="button"
                      role="menuitem"
                      className="menu-item"
                      onClick={() => {
                        setText((cur) => (cur.trim() ? `${cur.trim()}\n${q.body}` : q.body));
                        setInternal(false);
                        setQuickOpen(false);
                        inputRef.current?.focus();
                      }}
                    >
                      <span>
                        <span className="strong">{q.label}</span>
                        <span className="xsmall faint" style={{ display: 'block' }}>
                          {q.body}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <span className="spacer" />
            <span className={`xsmall num ${over ? 'text-danger' : 'faint'}`}>
              {text.length}/{SUPPORT_LIMITS.bodyMax}
            </span>
          </div>
          <div className="composer-input">
            <label htmlFor="support-input" className="sr-only">
              {asNote ? 'Nota interna (só a equipe vê)' : `Resposta pra ${t.user.name}`}
            </label>
            <textarea
              id="support-input"
              ref={inputRef}
              className="textarea"
              rows={2}
              placeholder={asNote ? 'Nota interna: só a equipe vê (Enter salva)' : `Responder ${t.user.name.split(' ')[0]}… (Enter envia)`}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                if (!asNote) {
                  emitTyping(true);
                  window.clearTimeout(typingTimer.current);
                  typingTimer.current = window.setTimeout(() => emitTyping(false), TYPING_IDLE_MS);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
              onBlur={() => emitTyping(false)}
            />
            <Button type="submit" variant={asNote ? 'secondary' : 'primary'} iconOnly icon={<Send size={16} />} aria-label={asNote ? 'Salvar nota' : 'Enviar'} disabled={!text.trim() || over} />
          </div>
          {noteOnly ? <div className="xsmall faint">Atendimento encerrado: dá pra deixar nota interna. Pra responder a pessoa, reabra.</div> : null}
        </form>
      </section>
      <ContextPanel thread={t} open={showContext} onClose={() => setShowContext(false)} />
    </>
  );
}
