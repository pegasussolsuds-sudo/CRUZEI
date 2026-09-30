import type { ReportContext } from '@cruzei/shared-types';

// Ficha da moderação: quais conversas uma denúncia cita (a do contexto + a lista da denúncia automática de golpe).

/** conversas citadas, na ordem (a 1ª é a do contexto), sem repetir; só as que a ficha trouxe (`loaded`) */
export function reportConversationIds(c: ReportContext | null | undefined, loaded?: ReadonlySet<string>): string[] {
  if (!c) return [];
  const ids = [c.conversationId, ...(c.occurrences ?? []).map((o) => o.conversationId)].filter(
    (id): id is string => Boolean(id) && (!loaded || loaded.has(id as string)),
  );
  return [...new Set(ids)];
}

/** conversa aberta na ficha: a escolhida; sem escolha, só a 1ª */
export function isConversationOpen(open: Readonly<Record<string, boolean>>, id: string, index: number): boolean {
  return open[id] ?? index === 0;
}
