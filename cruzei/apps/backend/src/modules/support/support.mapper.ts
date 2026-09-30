import type {
  SupportAuthor,
  SupportMessage,
  SupportThreadForUser,
  SupportThreadStatus,
} from '@cruzei/shared-types';
import type { Redis } from 'ioredis';

// Regras puras do suporte: o que o APP vê (sem nota interna, atendente sempre "Equipe Metch") e o que a EQUIPE vê.
// Testadas em support.mapper.spec.ts.

/** o app nunca vê quem atendeu */
export const STAFF_DISPLAY_NAME = 'Equipe Metch';

/** prazo prometido na mensagem de boas-vindas (horas) */
export const SUPPORT_REPLY_HOURS = Math.max(1, Number(process.env.SUPPORT_REPLY_HOURS) || 24);

export function welcomeText(hours = SUPPORT_REPLY_HOURS): string {
  return (
    `Oi! Aqui é a ${STAFF_DISPLAY_NAME} 👋 Recebemos sua mensagem e respondemos em até ${hours} horas ` +
    '(quase sempre bem antes). Se quiser, manda mais detalhes por aqui.'
  );
}

export const CLOSING_TEXT =
  'Atendimento encerrado. Se precisar de mais alguma coisa, é só mandar outra mensagem por aqui.';

export interface SupportMessageRow {
  id: string;
  threadId: string;
  senderId: string | null;
  author: string;
  body: string;
  internal: boolean;
  clientId: string | null;
  createdAt: Date;
}

export interface SupportThreadRow {
  id: string;
  userId: string;
  status: string;
  createdAt: Date;
  lastMessageAt: Date;
  userUnread: number;
  rating: number | null;
  /** botão de emergência (ausente = false) */
  urgent?: boolean;
}

/**
 * Mensagem como o APP vê. Nota interna → null (NUNCA sai pro app, nem por HTTP nem por socket).
 * Da equipe: sem id de quem atendeu, nome "Equipe Metch". clientId só nas mensagens da própria pessoa.
 */
export function messageForUser(m: SupportMessageRow, viewerId: string): SupportMessage | null {
  if (m.internal) return null;
  const author = m.author as SupportAuthor;
  const mine = author === 'user' && m.senderId === viewerId;
  const out: SupportMessage = {
    id: m.id,
    threadId: m.threadId,
    author,
    senderId: author === 'user' ? m.senderId : null,
    senderName: author === 'staff' ? STAFF_DISPLAY_NAME : null,
    body: m.body,
    internal: false,
    createdAt: m.createdAt.toISOString(),
  };
  if (mine && m.clientId) out.clientId = m.clientId;
  return out;
}

/** lista pro app: sem as internas */
export function messagesForUser(rows: SupportMessageRow[], viewerId: string): SupportMessage[] {
  return rows
    .map((m) => messageForUser(m, viewerId))
    .filter((m): m is SupportMessage => m !== null);
}

/** mensagem como a EQUIPE vê: tudo, com o nome real do atendente; clientId de quem está vendo (envio otimista do painel) */
export function messageForStaff(
  m: SupportMessageRow,
  names: ReadonlyMap<string, string>,
  viewerId?: string,
): SupportMessage {
  const author = m.author as SupportAuthor;
  const out: SupportMessage = {
    id: m.id,
    threadId: m.threadId,
    author,
    senderId: author === 'system' ? null : m.senderId,
    senderName:
      author === 'staff'
        ? (m.senderId && names.get(m.senderId)) || STAFF_DISPLAY_NAME
        : author === 'user'
          ? (m.senderId && names.get(m.senderId)) || null
          : null,
    body: m.body,
    internal: m.internal,
    createdAt: m.createdAt.toISOString(),
  };
  if (viewerId && m.senderId === viewerId && m.clientId) out.clientId = m.clientId;
  return out;
}

export function threadForUser(t: SupportThreadRow): SupportThreadForUser {
  return {
    id: t.id,
    status: t.status as SupportThreadStatus,
    createdAt: t.createdAt.toISOString(),
    lastMessageAt: t.lastMessageAt.toISOString(),
    unread: t.userUnread,
    rating: t.rating,
    // só aparece quando é urgente (atendimento comum continua com o mesmo formato de antes)
    ...(t.urgent ? { urgent: true } : {}),
  };
}

/** clientId aceito: curto e sem caracteres estranhos (vai pro índice único); inválido = sem idempotência */
export function normClientId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  return /^[\w-]{1,64}$/.test(v) ? v : null;
}

/** ordem da fila da equipe: 'oldest' = quem espera há mais tempo primeiro (aba Abertos); padrão, última mensagem */
export type SupportOrder = 'recent' | 'oldest';

export function supportOrder(raw: unknown): SupportOrder {
  return raw === 'oldest' ? 'oldest' : 'recent';
}

/**
 * Desde quando a pessoa espera a equipe: a 1ª mensagem dela depois da última resposta pública da equipe (o SQL traz
 * esse horário). Só vale com o atendimento aberto — pendente/resolvido não está esperando ninguém da equipe.
 */
export function waitingSinceOf(status: string, since: Date | null): string | null {
  return status === 'open' && since ? since.toISOString() : null;
}

// ─── botão de emergência (suporte URGENTE) ───

/** apertar de novo dentro desse tempo não repete as mensagens automáticas (só reavisa a fila) */
export const URGENT_REPEAT_MS = 2 * 60_000;

/** urgente ainda valendo: vai pro topo da fila */
export function isUrgentOpen(t: { urgent?: boolean | null; status: string }): boolean {
  return Boolean(t.urgent) && t.status !== 'resolved';
}

/** repetição do botão (mesmo atendimento urgente há menos de URGENT_REPEAT_MS) */
export function isUrgentRepeat(
  t: { urgent: boolean; urgent_at: Date | null },
  now = Date.now(),
): boolean {
  return t.urgent && t.urgent_at !== null && now - t.urgent_at.getTime() < URGENT_REPEAT_MS;
}

/** alarme 'support:urgent' (toque no painel): no máximo 1 por atendimento nesse intervalo */
export const URGENT_ALERT_GAP_MS = 10 * 60_000;

export const urgentAlertKey = (threadId: string) => `support:urgent-alert:${threadId}`;

/**
 * Vez do alarme do atendimento (SET NX PX no Redis): true = toca agora; apertar de novo dentro do intervalo = false
 * (só a fila atualiza). Redis fora do ar → toca (alarme a mais é melhor que alarme perdido).
 */
export async function claimUrgentAlert(
  redis: Pick<Redis, 'set'>,
  threadId: string,
): Promise<boolean> {
  try {
    const r = await redis.set(urgentAlertKey(threadId), '1', 'PX', URGENT_ALERT_GAP_MS, 'NX');
    return r === 'OK';
  } catch {
    return true;
  }
}
