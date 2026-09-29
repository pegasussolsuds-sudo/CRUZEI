// Eventos de tempo real da inbox: cada transação JUNTA os eventos numa lista e quem chamou envia DEPOIS do commit
// (flushInboxEvents). Emitir dentro do callback gera evento fantasma quando a transação é desfeita.
import { INBOX_EVENTS } from '@cruzei/shared-types';
import type {
  ConversationNewPayload,
  ConversationPromotedPayload,
  ConversationRemovedPayload,
  MessageNewPayload,
  MessageReadPayload,
} from '@cruzei/shared-types';

import type { ChatGateway } from '../../realtime/chat.gateway';

/** o pedaço do ChatGateway que a inbox usa (os testes passam um falso com a mesma forma) */
export type InboxGatewayPort = Pick<
  ChatGateway,
  'emitToUser' | 'emitToUsers' | 'removeFromConversation'
>;

/** payload de cada evento (nomes exatos do contrato; 'like_received' continua) */
export interface InboxEventPayloads {
  'conversation:new': ConversationNewPayload;
  'conversation:promoted': ConversationPromotedPayload;
  'message:new': MessageNewPayload;
  'message:read': MessageReadPayload;
  'conversation:removed': ConversationRemovedPayload;
  /** fromUserId só pra Premium+ vigente ou curtida mútua (quem não pode ver quem curtiu recebe só o sinal) */
  like_received: { fromUserId?: string; isSuper: boolean; isMutual?: boolean };
}
export type InboxEventName = keyof InboxEventPayloads;

/** emit para as salas user:<id> (só membros do par) ou saída da sala conv:<id> (bloqueio, arquivamento) */
export type InboxEvent =
  | {
      kind: 'emit';
      to: string[];
      event: InboxEventName;
      payload: InboxEventPayloads[InboxEventName];
    }
  | { kind: 'leave'; conversationId: string; userIds: string[] };

export function emitEvent<E extends InboxEventName>(
  to: string | string[],
  event: E,
  payload: InboxEventPayloads[E],
): InboxEvent {
  return { kind: 'emit', to: Array.isArray(to) ? to : [to], event, payload };
}

export function leaveEvent(conversationId: string, userIds: string[]): InboxEvent {
  return { kind: 'leave', conversationId, userIds };
}

/** eventos que entregam conversa/mensagem — quem não pode receber (visibility.messagingLocked) fica fora deles */
const DELIVERY_EVENTS: ReadonlySet<InboxEventName> = new Set<InboxEventName>([
  'conversation:new',
  'conversation:promoted',
  'message:new',
  'message:read',
]);

/** tira `held` dos destinatários dos eventos de entrega (emit sem ninguém some); leave e remoção passam intactos */
export function withoutHeld(
  events: readonly InboxEvent[],
  held: ReadonlySet<string>,
): InboxEvent[] {
  if (held.size === 0) return [...events];
  const out: InboxEvent[] = [];
  for (const e of events) {
    if (e.kind !== 'emit' || !DELIVERY_EVENTS.has(e.event)) {
      out.push(e);
      continue;
    }
    const to = e.to.filter((id) => !held.has(id));
    if (to.length) out.push({ ...e, to });
  }
  return out;
}

/** envia na ordem em que a transação juntou; mesmo payload pra duas pessoas = um emit só (um publish no Redis) */
export function flushInboxEvents(gateway: InboxGatewayPort, events: readonly InboxEvent[]): void {
  for (const e of events) {
    if (e.kind === 'leave') {
      gateway.removeFromConversation(e.conversationId, e.userIds);
    } else if (e.to.length === 1) {
      gateway.emitToUser(e.to[0], e.event, e.payload);
    } else if (e.to.length > 1) {
      gateway.emitToUsers(e.to, e.event, e.payload);
    }
  }
}

/** nomes de evento em uso aqui batem com o contrato do pacote (falha de compilação se o pacote mudar o nome) */
export const EVENT_NAMES_MATCH_CONTRACT: Record<keyof typeof INBOX_EVENTS, InboxEventName> =
  INBOX_EVENTS;
