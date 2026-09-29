// Fila do suporte ao vivo: filtros, ordem, contagem de quem espera e mescla de mensagens do socket.
import type { SupportMessage, SupportThreadSummary } from '@cruzei/shared-types';

export type SupportFilter = 'open' | 'pending' | 'resolved' | 'mine';

export const SUPPORT_FILTERS: readonly { key: SupportFilter; label: string }[] = [
  { key: 'open', label: 'Abertos' },
  { key: 'pending', label: 'Pendentes' },
  { key: 'resolved', label: 'Resolvidos' },
  { key: 'mine', label: 'Meus' },
];

export function threadMatchesFilter(t: SupportThreadSummary, filter: SupportFilter, meId: string | null): boolean {
  if (filter === 'mine') return !!meId && t.assignedTo?.id === meId && t.status !== 'resolved';
  return t.status === filter;
}

/** a pessoa falou por último e ninguém respondeu: é quem está esperando a equipe */
export function isWaitingStaff(t: SupportThreadSummary): boolean {
  return t.status === 'open' && (t.staffUnread > 0 || t.lastMessage?.author === 'user');
}

export function countWaiting(threads: Iterable<SupportThreadSummary>): number {
  let n = 0;
  for (const t of threads) if (isWaitingStaff(t)) n++;
  return n;
}

/** quem espera primeiro; dentro de cada grupo, o mais recente em cima */
export function sortThreads(list: readonly SupportThreadSummary[]): SupportThreadSummary[] {
  return [...list].sort((a, b) => {
    const wa = isWaitingStaff(a) ? 1 : 0;
    const wb = isWaitingStaff(b) ? 1 : 0;
    if (wa !== wb) return wb - wa;
    return Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt);
  });
}

/** aplica um 'support:thread' numa lista filtrada: atualiza, entra ou sai da lista */
export function upsertThread(
  list: readonly SupportThreadSummary[],
  thread: SupportThreadSummary,
  filter: SupportFilter,
  meId: string | null,
): SupportThreadSummary[] {
  const rest = list.filter((t) => t.id !== thread.id);
  if (!threadMatchesFilter(thread, filter, meId)) return rest.length === list.length ? [...list] : rest;
  return sortThreads([...rest, thread]);
}

/** mesma coisa pra lista paginada (useInfiniteQuery): sai de todas as páginas e, se ainda cabe no filtro, entra na primeira */
export function upsertThreadInPages<P extends { items: SupportThreadSummary[] }>(
  pages: readonly P[],
  thread: SupportThreadSummary,
  filter: SupportFilter,
  meId: string | null,
): P[] {
  const cleaned = pages.map((p) => ({ ...p, items: p.items.filter((t) => t.id !== thread.id) }));
  if (!threadMatchesFilter(thread, filter, meId) || !cleaned.length) return cleaned;
  const [first, ...rest] = cleaned;
  return [{ ...(first as P), items: sortThreads([thread, ...(first as P).items]) }, ...rest];
}

/**
 * Junta uma mensagem na conversa: substitui a otimista (mesmo clientId) ou a repetida (mesmo id),
 * senão entra no fim — mantendo a ordem por horário.
 */
export function mergeMessage(messages: readonly SupportMessage[], msg: SupportMessage): SupportMessage[] {
  // tira todas as cópias (a do socket pode ter chegado antes da resposta do POST) e põe a versão nova
  const rest = messages.filter((m) => m.id !== msg.id && !(msg.clientId && m.clientId === msg.clientId));
  return [...rest, msg].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

export const PENDING_PREFIX = 'pending:';

export function isPendingMessage(m: SupportMessage): boolean {
  return m.id.startsWith(PENDING_PREFIX);
}

/** resumo novo da fila quando chega mensagem e o servidor ainda não mandou o 'support:thread' */
export function applyMessageToSummary<T extends SupportThreadSummary>(t: T, msg: SupportMessage, viewing: boolean): T {
  if (msg.internal) return t;
  return {
    ...t,
    lastMessage: { body: msg.body, author: msg.author, createdAt: msg.createdAt },
    lastMessageAt: msg.createdAt,
    staffUnread: msg.author === 'user' && !viewing ? t.staffUnread + 1 : msg.author === 'staff' ? 0 : t.staffUnread,
  };
}

/** respostas rápidas (o atendente ainda revisa antes de mandar) */
export const QUICK_REPLIES: readonly { label: string; body: string }[] = [
  { label: 'Oi', body: 'Oi! Aqui é da equipe do Metch. Já estou vendo o seu caso, só um minutinho.' },
  { label: 'Mais detalhes', body: 'Pode me contar um pouco mais? Se tiver print, manda aqui que ajuda bastante.' },
  { label: 'Verificando', body: 'Obrigado por avisar! Estou verificando aqui e te dou retorno já já.' },
  { label: 'Denúncia', body: 'Recebemos a sua denúncia e a moderação já está olhando. Obrigado por ajudar a manter o Metch seguro.' },
  { label: 'Premium', body: 'Sobre o Premium: confere se a compra aparece na loja (Google Play ou App Store) com o mesmo e-mail da conta. Se aparecer e o Premium não entrou, me manda o número do pedido.' },
  { label: 'Atualizar app', body: 'Tenta atualizar o Metch pela loja e abrir de novo. Se continuar, me conta o que aparece na tela.' },
  { label: 'Resolvido', body: 'Prontinho, resolvido! Se precisar de mais alguma coisa, é só chamar aqui.' },
];
