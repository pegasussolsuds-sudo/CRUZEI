import { QueryClient } from '@tanstack/react-query';
import type { AppNotification } from '@cruzei/shared-types';

jest.mock('../services/api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../services/socket', () => ({ getSocket: () => null }));

import {
  applyAllNotificationsRead,
  applyNotificationNew,
  applyNotificationRead,
  flattenNotifications,
  normalizeNotificationPage,
  notificationKeys,
  toAppNotification,
  unreadNotifications,
  type NotificationPages,
} from './useNotifications';

function n(id: string, over: Partial<AppNotification> = {}): AppNotification {
  return { id, type: 'campaign', title: `t-${id}`, body: null, target: null, readAt: null, sentAt: '2026-09-29T12:00:00.000Z', ...over };
}

// gcTime infinito: sem timer de coleta pendurado no fim dos testes
const clients: QueryClient[] = [];
function client(): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  clients.push(qc);
  return qc;
}
afterEach(() => {
  for (const qc of clients.splice(0)) qc.clear();
});

function seed(qc: QueryClient, items: AppNotification[], unreadCount: number | null = null): void {
  qc.setQueryData<NotificationPages>(notificationKeys.list, { pages: [{ items, next: null, unreadCount }], pageParams: [null] });
}

describe('GET /notifications: formatos aceitos', () => {
  it('lista pura (rota antiga): próxima página por offset quando veio cheia', () => {
    const raw = Array.from({ length: 3 }, (_, i) => ({ id: `n${i}`, type: 'event', title: 'x', sentAt: '2026-09-29T12:00:00.000Z' }));
    expect(normalizeNotificationPage(raw, null, 3).next).toEqual({ offset: 3 });
    expect(normalizeNotificationPage(raw, { offset: 3 }, 3).next).toEqual({ offset: 6 });
    expect(normalizeNotificationPage(raw.slice(0, 2), null, 3).next).toBeNull();
  });

  it('{items, nextCursor, unreadCount}: cursor e contagem do servidor', () => {
    const page = normalizeNotificationPage({ items: [{ id: 'a', title: 'A', sentAt: 's' }], nextCursor: 'k2', unreadCount: 5 }, null);
    expect(page.next).toEqual({ cursor: 'k2' });
    expect(page.unreadCount).toBe(5);
    expect(normalizeNotificationPage({ items: [], nextCursor: null }, null).next).toBeNull();
  });

  it('linha no formato antigo (alvo dentro de data, createdAt) e linhas inválidas fora', () => {
    const a = toAppNotification({ id: 'a', type: 'event', title: 'Show', data: { target: { kind: 'place', poiId: 3 } }, createdAt: '2026-09-29T10:00:00.000Z' });
    expect(a).toMatchObject({ id: 'a', target: { kind: 'place', poiId: '3' }, sentAt: '2026-09-29T10:00:00.000Z', readAt: null });
    expect(toAppNotification({ id: 'b' })).toBeNull();
    expect(toAppNotification({ id: 'c', title: 'C', target: { kind: 'url', href: 'x' } })?.target).toBeNull();
  });
});

describe('cache da central', () => {
  it("'notification:new' entra no topo uma vez só e soma na contagem do servidor", () => {
    const qc = client();
    seed(qc, [n('old', { readAt: '2026-09-29T11:00:00.000Z' })], 0);
    applyNotificationNew(qc, n('new'));
    applyNotificationNew(qc, n('new')); // socket + push em primeiro plano
    const d = qc.getQueryData<NotificationPages>(notificationKeys.list);
    expect(flattenNotifications(d).map((x) => x.id)).toEqual(['new', 'old']);
    expect(unreadNotifications(d)).toBe(1);
  });

  it('sem contagem do servidor, conta as não lidas carregadas (sem repetir entre páginas)', () => {
    const qc = client();
    qc.setQueryData<NotificationPages>(notificationKeys.list, {
      pages: [
        { items: [n('a'), n('b', { readAt: 'x' })], next: { offset: 2 }, unreadCount: null },
        { items: [n('a'), n('c')], next: null, unreadCount: null },
      ],
      pageParams: [null, { offset: 2 }],
    });
    expect(unreadNotifications(qc.getQueryData(notificationKeys.list))).toBe(2);
  });

  it('marcar lida: só a não lida muda e a contagem desce uma vez', () => {
    const qc = client();
    seed(qc, [n('a'), n('b')], 2);
    applyNotificationRead(qc, 'a', '2026-09-29T12:05:00.000Z');
    applyNotificationRead(qc, 'a', '2026-09-29T12:06:00.000Z');
    const d = qc.getQueryData<NotificationPages>(notificationKeys.list);
    expect(flattenNotifications(d).find((x) => x.id === 'a')?.readAt).toBe('2026-09-29T12:05:00.000Z');
    expect(unreadNotifications(d)).toBe(1);
  });

  it('marcar todas: zera', () => {
    const qc = client();
    seed(qc, [n('a'), n('b')], 2);
    applyAllNotificationsRead(qc, '2026-09-29T12:05:00.000Z');
    const d = qc.getQueryData<NotificationPages>(notificationKeys.list);
    expect(unreadNotifications(d)).toBe(0);
    expect(flattenNotifications(d).every((x) => x.readAt)).toBe(true);
  });
});
