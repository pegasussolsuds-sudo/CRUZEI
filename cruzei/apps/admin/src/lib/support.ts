// Fila do suporte ao vivo: filtros, ordem, contagem de quem espera, mescla de mensagens do socket e rascunhos.
import type { SupportMessage, SupportThreadStatus, SupportThreadSummary } from '@cruzei/shared-types';

export type SupportFilter = 'open' | 'pending' | 'resolved' | 'mine';

export const SUPPORT_FILTERS: readonly { key: SupportFilter; label: string }[] = [
  { key: 'open', label: 'Abertos' },
  { key: 'pending', label: 'Pendentes' },
  { key: 'resolved', label: 'Resolvidos' },
  { key: 'mine', label: 'Meus' },
];

/** ordem da lista: Abertos = quem espera há mais tempo primeiro (order=oldest no servidor); o resto, a mais recente */
export type SupportOrder = 'recent' | 'oldest';

export function filterOrder(filter: SupportFilter): SupportOrder {
  return filter === 'open' ? 'oldest' : 'recent';
}

export function threadMatchesFilter(t: SupportThreadSummary, filter: SupportFilter, meId: string | null): boolean {
  if (filter === 'mine') return !!meId && t.assignedTo?.id === meId && t.status !== 'resolved';
  return t.status === filter;
}

/** a pessoa falou por último e ninguém respondeu: é quem está esperando a equipe */
export function isWaitingStaff(t: SupportThreadSummary): boolean {
  return t.status === 'open' && (t.staffUnread > 0 || t.lastMessage?.author === 'user');
}

/** desde quando espera (o servidor calcula); sem isso, a última mensagem */
function waitKey(t: SupportThreadSummary): number {
  return Date.parse(t.waitingSince ?? t.lastMessageAt);
}

/**
 * 'recent': quem espera primeiro; dentro de cada grupo, o mais recente em cima.
 * 'oldest' (Abertos): quem espera há mais tempo em cima — a mesma ordem do servidor.
 */
export function sortThreads(list: readonly SupportThreadSummary[], order: SupportOrder = 'recent'): SupportThreadSummary[] {
  if (order === 'oldest') {
    return [...list].sort((a, b) => waitKey(a) - waitKey(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
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
  return sortThreads([...rest, thread], filterOrder(filter));
}

/**
 * Mesma coisa pra lista paginada (useInfiniteQuery). Mais recente primeiro: sai de todas as páginas e entra na
 * primeira. Quem espera há mais tempo primeiro (Abertos): fica na página onde estava; se é novo, entra na última
 * carregada (o novo é quem espera há menos tempo).
 */
export function upsertThreadInPages<P extends { items: SupportThreadSummary[] }>(
  pages: readonly P[],
  thread: SupportThreadSummary,
  filter: SupportFilter,
  meId: string | null,
): P[] {
  const at = pages.findIndex((p) => p.items.some((t) => t.id === thread.id));
  const cleaned = pages.map((p) => ({ ...p, items: p.items.filter((t) => t.id !== thread.id) }));
  if (!threadMatchesFilter(thread, filter, meId) || !cleaned.length) return cleaned;
  const order = filterOrder(filter);
  const target = order === 'oldest' ? (at >= 0 ? at : cleaned.length - 1) : 0;
  return cleaned.map((p, i) => (i === target ? { ...p, items: sortThreads([thread, ...p.items], order) } : p));
}

// ─── quem está esperando (topo, barra lateral, título da aba) ───

/**
 * Abertos conhecidos + o total do servidor (status open: a mesma conta do Painel). A lista pode ter só a 1ª página;
 * o total é o número de verdade e os eventos do socket o ajustam na hora até a próxima busca.
 */
export interface LiveQueue {
  open: ReadonlyMap<string, SupportThreadSummary>;
  total: number;
}

export const EMPTY_LIVE_QUEUE: LiveQueue = { open: new Map(), total: 0 };

export function seedLiveQueue(items: readonly SupportThreadSummary[], total: number): LiveQueue {
  const open = new Map(items.filter((t) => t.status === 'open').map((t) => [t.id, t]));
  return { open, total: Math.max(total, open.size) };
}

/**
 * 'support:thread' na fila ao vivo. `recheck`: saiu dos abertos um atendimento que não estava na lista carregada —
 * pode ou não ter sido aberto (o total do servidor sabe): quem chama busca de novo.
 */
export function applyToLiveQueue(q: LiveQueue, thread: SupportThreadSummary): { queue: LiveQueue; recheck: boolean } {
  const known = q.open.has(thread.id);
  if (thread.status === 'open') {
    const open = new Map(q.open);
    open.set(thread.id, thread);
    return { queue: { open, total: known ? q.total : q.total + 1 }, recheck: false };
  }
  if (known) {
    const open = new Map(q.open);
    open.delete(thread.id);
    return { queue: { open, total: Math.max(0, q.total - 1) }, recheck: false };
  }
  return { queue: q, recheck: q.total > q.open.size };
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

// ─── conversa ───

/**
 * Rascunho por atendimento (trocar de conversa não apaga o que estava sendo escrito). Só na memória desta aba:
 * some ao recarregar — texto de atendimento não fica guardado no navegador.
 */
const drafts = new Map<string, string>();

export function readDraft(threadId: string): string {
  return drafts.get(threadId) ?? '';
}

export function writeDraft(threadId: string, text: string): void {
  if (text.trim()) drafts.set(threadId, text);
  else drafts.delete(threadId);
}

/**
 * Esc no tablet volta pra fila — mas nunca por cima de algo em andamento: texto digitado, respostas rápidas ou
 * contexto abertos, foco num campo de texto, ou um diálogo aberto (o Esc é dele).
 */
export function escGoesBackToQueue(s: { text: string; quickOpen: boolean; contextOpen: boolean; typingInField: boolean; inDialog: boolean }): boolean {
  return !s.text.trim() && !s.quickOpen && !s.contextOpen && !s.typingInField && !s.inDialog;
}

/**
 * Atendimento encerrado (por outra pessoa) enquanto uma RESPOSTA estava sendo escrita: o envio vira nota interna e
 * a tela precisa avisar (nunca trocar calada).
 */
export function closedWhileReplying(prev: SupportThreadStatus | undefined, next: SupportThreadStatus | undefined, replying: boolean): boolean {
  return replying && prev !== undefined && prev !== 'resolved' && next === 'resolved';
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
