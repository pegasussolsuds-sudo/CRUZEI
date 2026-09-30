// Contexto da denúncia na ficha: quais conversas ela cita (a do contexto + a lista da denúncia automática de golpe).
import type { ReportContext } from '@cruzei/shared-types';

/** conversas citadas, na ordem (a 1ª é a do contexto), sem repetir */
export function reportConversationIds(c: ReportContext | null | undefined): string[] {
  if (!c) return [];
  const ids = [c.conversationId, ...(c.occurrences ?? []).map((o) => o.conversationId)].filter((id): id is string => Boolean(id));
  return [...new Set(ids)];
}

/** id do bloco da conversa na ficha (o link da denúncia abre e rola até ele) */
export const convAnchor = (conversationId: string) => `conversa-${conversationId}`;

/** abre o bloco da conversa (details) e rola até ele */
export function openConversation(conversationId: string, doc: Pick<Document, 'getElementById'> = document): boolean {
  const el = doc.getElementById(convAnchor(conversationId));
  if (!el) return false;
  if ('open' in el) (el as HTMLDetailsElement).open = true;
  el.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  return true;
}
