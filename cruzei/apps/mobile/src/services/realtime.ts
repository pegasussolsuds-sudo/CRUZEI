// Socket global: os eventos que mantêm as listas e o perfil certos com o app aberto (saiu do App.tsx pra ser testável).
// Todo evento entra no lote de rajada (frameBatch.soon): o 1º depois de um silêncio sai no próximo quadro; os que chegam
// em seguida — curtida + match + conversa promovida, uma rajada de mensagens — saem juntos, no máx. um lote a cada
// 100 ms, numa passada de render só. Os repetidos do lote (leitura da mesma conversa, mesma conversa removida/promovida,
// mesmo aviso de conta) rodam uma vez só, o último.
import { Alert } from 'react-native';
import { notifyManager, type QueryClient } from '@tanstack/react-query';
import type {
  AppNotification,
  ConversationNewPayload,
  ConversationPromotedPayload,
  MatchCelebration,
  MessageNewPayload,
  MessageReadPayload,
  SupportMessageEvent,
} from '@cruzei/shared-types';

import { applyConversationNew, applyMessageNew, applyPromoted, applyRead, applyRemoved, inboxKeys } from '../hooks/useInbox';
import { applyNotificationNew, notificationKeys, toAppNotification } from '../hooks/useNotifications';
import { applySupportMessage, supportKeys } from '../hooks/useSupport';
import { useAuthStore } from '../stores/auth';
import { asAccountBlocked, useAccountBlockStore } from '../stores/accountBlock';
import { showNotificationNotice } from '../stores/inAppNotice';
import { useMatchCelebrationStore } from '../stores/matchCelebration';
import { soon } from './frameBatch';
import { coalesce } from './socket';

/** o que o realtime usa do socket.io (o teste passa um emissor simples) */
export interface RealtimeSocket {
  on(event: string, listener: (payload: never) => void): unknown;
}

/** notificação nova com o app aberto (socket ou push em primeiro plano): central atualizada + aviso rápido */
export function onNotificationNew(qc: QueryClient, n: AppNotification): void {
  applyNotificationNew(qc, n);
  showNotificationNotice(n);
}

/** Liga os eventos do socket ao cache e aos stores. Uma vez por socket (o App chama depois de conectar). */
export function bindRealtime(socket: RealtimeSocket, qc: QueryClient): void {
  /** evento → lote de rajada; `key` descarta o anterior igual que ainda não rodou */
  const on = <P>(event: string, handler: (p: P) => void, key?: (p: P) => string | undefined) =>
    socket.on(event, ((p: P) => soon(() => notifyManager.batch(() => handler(p)), key?.(p))) as (payload: never) => void);

  // curtida recebida, match… em rajada (gente curtindo junto): o /me (contador do perfil) no máx. 1 vez a cada 5 s
  const invalidateMe = coalesce(() => void qc.invalidateQueries({ queryKey: ['me'] }), 5_000);
  // aviso de conta (Premium, foto moderada…) em rajada: um /me no store a cada 2 s, não um por evento
  const refreshMe = coalesce(() => {
    void qc.invalidateQueries({ queryKey: ['me'] });
    useAuthStore.getState().refreshMe().catch(() => undefined);
  }, 2_000);
  // match em rajada: as listas de Mensagens buscam de novo no máx. 1 vez a cada 2 s (eram 3 GETs por match). Com a
  // lista aberta a contagem vem na 1ª página dela: não busca a contagem à parte
  const invalidateInbox = coalesce(() => {
    const listOpen = qc.getQueryCache().find({ queryKey: inboxKeys.list('inbox'), exact: true })?.isActive() ?? false;
    void qc.invalidateQueries({ queryKey: inboxKeys.all, predicate: (q) => !(listOpen && q.queryKey[1] === 'counts') });
  }, 2_000);

  // (re)conectou: o que chegou enquanto o socket estava fora não virou evento — atualiza Mensagens uma vez
  // várias invalidações juntas = um aviso só às telas (notifyManager.batch), não uma passada de render por chave
  socket.on('connect', () => {
    notifyManager.batch(() => {
      void qc.invalidateQueries({ queryKey: inboxKeys.all });
      void qc.invalidateQueries({ queryKey: ['conversation'] });
      void qc.invalidateQueries({ queryKey: ['messages'] });
      void qc.invalidateQueries({ queryKey: notificationKeys.all });
      void qc.invalidateQueries({ queryKey: supportKeys.all });
    });
    // o que falhou com o servidor fora (pessoas no mapa, bairro, curtidas…) busca de novo agora, sem esperar o
    // próximo ciclo — só as que estão em erro, com até 2 s de atraso pra não voltar todo mundo no mesmo segundo
    setTimeout(() => void qc.invalidateQueries({ predicate: (q) => q.state.status === 'error' }), Math.random() * 2_000);
    // boot sem rede deixou a sessão sem perfil: o servidor voltou, busca o /me agora
    void useAuthStore.getState().ensureMe();
    // match que aconteceu com o app fechado (ou sem push): pendentes no servidor, a cada (re)conexão
    void useMatchCelebrationStore.getState().syncPending();
  });
  void useMatchCelebrationStore.getState().syncPending();

  // central de avisos: aviso novo entra na lista e aparece no topo (o push em primeiro plano cai no mesmo lugar)
  on<{ notification?: unknown } | undefined>('notification:new', (p) => {
    const n = toAppNotification(p?.notification);
    if (!n) return;
    onNotificationNew(qc, n);
    // Premium dado/tirado pelo painel: o /me novo tira (ou põe) os convites e libera o que é do plano na hora
    if (n.type === 'premium_granted') refreshMe();
  });

  // Premium dado/tirado com o "avisar a pessoa" desligado não gera aviso: o sinal silencioso atualiza o /me igual
  on<{ reason?: string } | undefined>(
    'account:changed',
    (p) => {
      refreshMe();
      // invisível grátis acabou / Premium venceu: o mapa, as conversas (invisível grátis não conversa) e a Paywall mudam
      if (p?.reason === 'visibility' || p?.reason === 'premium_expired') {
        void qc.invalidateQueries({ queryKey: ['nearby'] });
        void qc.invalidateQueries({ queryKey: inboxKeys.all });
        void qc.invalidateQueries({ queryKey: ['conversation'] });
        void qc.invalidateQueries({ queryKey: ['messages'] });
        void qc.invalidateQueries({ queryKey: ['premium-status'] });
        void qc.invalidateQueries({ queryKey: ['plans'] });
      }
    },
    (p) => `account:${p?.reason ?? ''}`,
  );

  // lugar entrou/saiu do mapa: busca de novo sem esperar o refetch de 45 s — com atraso aleatório de até 3 s pra
  // os apps abertos não baterem todos no mesmo segundo. Aviso que chega com uma busca já agendada pega carona nela
  let poisTimer: ReturnType<typeof setTimeout> | null = null;
  socket.on('pois:changed', () => {
    if (poisTimer) return;
    poisTimer = setTimeout(() => {
      poisTimer = null;
      void qc.invalidateQueries({ queryKey: ['nearby', 'pois'] });
    }, Math.random() * 3_000);
  });

  // suporte ao vivo: a conversa com a equipe fica certa mesmo com o chat fechado (contador da Ajuda)
  on<SupportMessageEvent | undefined>('support:message', (p) => {
    if (p?.message && p.threadId) applySupportMessage(qc, p);
  });

  // Mensagens: o evento traz o estado do servidor (unread, pasta, promoção); o cache só troca a conversa de lugar
  on<MessageNewPayload>('message:new', (p) => applyMessageNew(qc, p));
  on<ConversationNewPayload>('conversation:new', (p) => applyConversationNew(qc, p), (p) => `conversation:new:${p?.conversation?.id}`);
  on<ConversationPromotedPayload>('conversation:promoted', (p) => applyPromoted(qc, p), (p) => `promoted:${p?.conversationId}`);
  on<MessageReadPayload>(
    'message:read',
    (p) => applyRead(qc, p, useAuthStore.getState().user?.id),
    // a leitura mais nova da mesma pessoa na mesma conversa cobre as anteriores do quadro
    (p) => `read:${p?.conversationId}:${p?.readerId}`,
  );
  // bloqueio, arquivamento ou moderação: a conversa some da lista na hora (o chat aberto fecha sozinho)
  on<{ conversationId: string }>('conversation:removed', ({ conversationId }) => applyRemoved(qc, conversationId), (p) => `removed:${p?.conversationId}`);

  // curtida recebida: só o contador do perfil. O payload pode vir sem fromUserId (quem não é Premium+ não vê quem
  // curtiu), então aqui nada depende de quem foi. Rajada de curtidas = um /me só a cada 5 s
  socket.on('like_received', invalidateMe);
  // match fechado por quem eu curti: a comemoração entra na fila (o host mostra com a tela livre)
  on<MatchCelebration>('match:new', (p) => {
    useMatchCelebrationStore.getState().enqueue(p);
    invalidateInbox();
    invalidateMe();
  });

  // conta suspensa/banida: na hora, fora do lote
  socket.on('account_blocked', ((data: unknown) => {
    const b = asAccountBlocked(data);
    if (b) useAccountBlockStore.getState().setBlocked(b);
  }) as (payload: never) => void);
  on<{ message: string }>('account_notice', ({ message }) => {
    Alert.alert('Aviso da moderação', message);
  });
  on<{ status: string; reason?: string | null }>('photo_moderated', ({ status, reason }) => {
    refreshMe();
    if (status === 'rejected') {
      Alert.alert('Foto recusada', `${reason ?? 'Uma foto sua não segue as regras do Metch'}. Ela não aparece pra ninguém; dá pra trocar no seu perfil.`);
    }
  });
}
