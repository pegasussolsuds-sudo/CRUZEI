import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
  type QueryFunctionContext,
} from '@tanstack/react-query';
import type { AppNotification, NotificationSettings } from '@cruzei/shared-types';
import { api } from '../services/api';
import { getSocket } from '../services/socket';
import { parseTarget } from '../services/notificationTarget';

// Central de avisos (GET /notifications): lista, não lidas, marcar lida e o evento 'notification:new' do socket.

export const notificationKeys = {
  all: ['notifications'] as const,
  list: ['notifications', 'list'] as const,
  settings: ['notifications', 'settings'] as const,
};

export const NOTIFICATIONS_PAGE = 30;

/** próxima página: por cursor (se o servidor mandar nextCursor) ou por offset (lista pura, rota antiga) */
export type NotificationPageParam = { offset: number } | { cursor: string };

export interface NotificationPage {
  items: AppNotification[];
  next: NotificationPageParam | null;
  /** não lidas contadas pelo servidor, quando ele manda; senão o app conta nas páginas carregadas */
  unreadCount: number | null;
}

export type NotificationPages = InfiniteData<NotificationPage, NotificationPageParam | null>;

type Obj = Record<string, unknown>;
const asObj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null);
const text = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** linha do servidor → AppNotification (aceita o formato antigo, com o alvo dentro de `data`) */
export function toAppNotification(raw: unknown): AppNotification | null {
  const o = asObj(raw);
  if (!o) return null;
  const id = typeof o.id === 'string' ? o.id : typeof o.id === 'number' ? String(o.id) : null;
  const title = text(o.title);
  if (!id || title == null) return null;
  return {
    id,
    type: text(o.type) ?? 'campaign',
    title,
    body: text(o.body),
    target: parseTarget(o.target ?? asObj(o.data)?.target ?? null),
    readAt: text(o.readAt),
    sentAt: text(o.sentAt) ?? text(o.createdAt) ?? new Date().toISOString(),
  };
}

/** resposta do GET /notifications → página (lista pura ou {items, nextCursor, unreadCount}) */
export function normalizeNotificationPage(raw: unknown, param: NotificationPageParam | null, limit = NOTIFICATIONS_PAGE): NotificationPage {
  const obj = asObj(raw);
  const list: unknown[] = Array.isArray(raw) ? raw : Array.isArray(obj?.items) ? (obj.items as unknown[]) : [];
  const items = list.map(toAppNotification).filter((n): n is AppNotification => n != null);
  const unread = obj?.unreadCount ?? obj?.unread;
  let next: NotificationPageParam | null = null;
  if (obj && 'nextCursor' in obj) next = typeof obj.nextCursor === 'string' && obj.nextCursor ? { cursor: obj.nextCursor } : null;
  else if (list.length >= limit) next = { offset: (param && 'offset' in param ? param.offset : 0) + list.length };
  return { items, next, unreadCount: typeof unread === 'number' ? unread : null };
}

/** com o socket conectado os avisos chegam por evento (o polling é só rede de segurança) */
function notificationsPollMs(): number {
  return getSocket()?.connected ? 300_000 : 60_000;
}

export function useNotificationList(enabled = true) {
  return useInfiniteQuery<NotificationPage, Error, NotificationPages, readonly string[], NotificationPageParam | null>({
    queryKey: notificationKeys.list,
    enabled,
    initialPageParam: null,
    queryFn: async ({ pageParam }: QueryFunctionContext<readonly string[], NotificationPageParam | null>): Promise<NotificationPage> => {
      const params = pageParam && 'cursor' in pageParam ? { cursor: pageParam.cursor, limit: NOTIFICATIONS_PAGE } : { limit: NOTIFICATIONS_PAGE, offset: pageParam?.offset ?? 0 };
      const res = await api.get('/notifications', { params });
      return normalizeNotificationPage(res.data, pageParam, NOTIFICATIONS_PAGE);
    },
    getNextPageParam: (last: NotificationPage) => last.next,
    refetchInterval: notificationsPollMs,
  });
}

/** itens de todas as páginas, sem repetir (aviso novo empurra o offset e a próxima página pode repetir um) */
export function flattenNotifications(data: NotificationPages | undefined): AppNotification[] {
  const seen = new Set<string>();
  const out: AppNotification[] = [];
  for (const p of data?.pages ?? []) {
    for (const n of p.items) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      out.push(n);
    }
  }
  return out;
}

/** não lidas: a contagem do servidor quando ele manda; senão as das páginas carregadas */
export function unreadNotifications(data: NotificationPages | undefined): number {
  const first = data?.pages[0];
  if (!first) return 0;
  if (first.unreadCount != null) return Math.max(0, first.unreadCount);
  return flattenNotifications(data).filter((n) => !n.readAt).length;
}

// ───────────────────────────── cache (socket e ações) ─────────────────────────────

function patchPages(qc: QueryClient, fn: (d: NotificationPages) => NotificationPages): void {
  qc.setQueryData<NotificationPages>(notificationKeys.list, (d) => (d ? fn(d) : d));
}

/** aviso novo (socket ou push com o app aberto) no topo da 1ª página; repetido não entra de novo */
export function applyNotificationNew(qc: QueryClient, n: AppNotification): void {
  const data = qc.getQueryData<NotificationPages>(notificationKeys.list);
  if (!data) {
    // sem lista no cache: a 1ª busca já traz
    void qc.invalidateQueries({ queryKey: notificationKeys.list });
    return;
  }
  if (data.pages.some((p) => p.items.some((x) => x.id === n.id))) return;
  patchPages(qc, (d) => ({
    ...d,
    pages: d.pages.map((p, i) =>
      i === 0 ? { ...p, items: [n, ...p.items], unreadCount: p.unreadCount != null && !n.readAt ? p.unreadCount + 1 : p.unreadCount } : p,
    ),
  }));
  // busca em voo (ex.: reconexão) voltaria sem o aviso: refaz
  if (qc.getQueryState(notificationKeys.list)?.fetchStatus === 'fetching') void qc.invalidateQueries({ queryKey: notificationKeys.list });
}

export function applyNotificationRead(qc: QueryClient, id: string, readAt: string): void {
  patchPages(qc, (d) => {
    let changed = false;
    const pages = d.pages.map((p) => ({
      ...p,
      items: p.items.map((n) => {
        if (n.id !== id || n.readAt) return n;
        changed = true;
        return { ...n, readAt };
      }),
    }));
    if (!changed) return d;
    const first = pages[0];
    if (first && first.unreadCount != null) pages[0] = { ...first, unreadCount: Math.max(0, first.unreadCount - 1) };
    return { ...d, pages };
  });
}

export function applyAllNotificationsRead(qc: QueryClient, readAt: string): void {
  patchPages(qc, (d) => ({
    ...d,
    pages: d.pages.map((p, i) => ({
      ...p,
      items: p.items.map((n) => (n.readAt ? n : { ...n, readAt })),
      unreadCount: i === 0 && p.unreadCount != null ? 0 : p.unreadCount,
    })),
  }));
}

// ───────────────────────────── preferências ─────────────────────────────

/** o que a pessoa quer receber das campanhas (desligado = fora do público, no push e na central) */
export function useNotificationSettings() {
  return useQuery({
    queryKey: notificationKeys.settings,
    queryFn: async () => (await api.get<NotificationSettings>('/notifications/settings')).data,
  });
}

/** liga/desliga na hora; se o servidor recusar, volta como estava */
export function useUpdateNotificationSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<NotificationSettings>) =>
      (await api.patch<NotificationSettings>('/notifications/settings', { settings: patch })).data,
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: notificationKeys.settings });
      const prev = qc.getQueryData<NotificationSettings>(notificationKeys.settings);
      if (prev) qc.setQueryData<NotificationSettings>(notificationKeys.settings, { ...prev, ...patch });
      return { prev };
    },
    onError: (_err, _patch, ctx) => {
      if (ctx?.prev) qc.setQueryData(notificationKeys.settings, ctx.prev);
    },
    onSuccess: (saved) => {
      if (saved && typeof saved === 'object') qc.setQueryData(notificationKeys.settings, saved);
    },
  });
}

/** abriu um aviso: lida na hora na tela; se o servidor não confirmar, a lista volta a ser a dele */
export async function markNotificationRead(qc: QueryClient, id: string): Promise<void> {
  if (!id) return;
  applyNotificationRead(qc, id, new Date().toISOString());
  try {
    await api.post(`/notifications/${id}/read`);
  } catch {
    void qc.invalidateQueries({ queryKey: notificationKeys.list });
  }
}

/** "marcar todas como lidas": false = o servidor recusou (a lista volta como estava) */
export async function markAllNotificationsRead(qc: QueryClient): Promise<boolean> {
  const prev = qc.getQueryData<NotificationPages>(notificationKeys.list);
  applyAllNotificationsRead(qc, new Date().toISOString());
  try {
    await api.post('/notifications/read-all');
    return true;
  } catch {
    if (prev) qc.setQueryData(notificationKeys.list, prev);
    return false;
  }
}
