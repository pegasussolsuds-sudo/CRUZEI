// Rajada do socket com o mapa aberto: 60 s a ~45 eventos/s (o total que o teste de carga de 1.000 pessoas gerou),
// numa conta muito procurada (mensagens de 15 conversas, curtidas com aviso, matches, solicitações novas, leituras).
// Mede, antes (a ligação antiga do App.tsx, copiada aqui) e depois (services/realtime.ts + lote por quadro):
//   - passadas de render = tarefas da thread JS em que alguma tela aberta recebe aviso (no RN bridgeless o React desenha
//     uma vez por tarefa);
//   - chamadas de rede por minuto (GET), por rota.
// Telas abertas: Mapa por cima, abas montadas (contador das Mensagens, lista e solicitações, ponto dos avisos, /me do
// Perfil), aviso rápido no topo e a fila da comemoração do match.

jest.mock('socket.io-client', () => ({ io: jest.fn() }));
jest.mock('./api', () => ({
  api: { get: jest.fn(), post: jest.fn(() => Promise.resolve({ data: {} })), patch: jest.fn() },
  toApiError: () => ({ status: 0, message: 'erro' }),
  getToken: jest.fn(() => Promise.resolve('tok')),
  refreshAccessToken: jest.fn(),
  reportAccountBlocked: jest.fn(),
  clearSession: jest.fn(() => Promise.resolve()),
  setToken: jest.fn(() => Promise.resolve()),
  setRefreshToken: jest.fn(() => Promise.resolve()),
  setUnauthorizedHandler: jest.fn(),
}));
jest.mock('./notifications', () => ({ unregisterPushDevice: jest.fn(() => Promise.resolve()) }));
jest.mock('./analytics', () => ({ getInstallId: jest.fn(() => Promise.resolve(null)), linkInstallToUser: jest.fn(() => Promise.resolve()) }));

import { InfiniteQueryObserver, QueryClient, QueryObserver, notifyManager } from '@tanstack/react-query';
import type { ConversationSummary, InboxCounts } from '@cruzei/shared-types';

import { api } from './api';
import { coalesce } from './socket';
import { nextFrame } from './frameBatch';
import { bindRealtime, type RealtimeSocket } from './realtime';
import { applyConversationNew, applyMessageNew, applyPromoted, applyRead, applyRemoved, inboxKeys, type InboxPages } from '../hooks/useInbox';
import { applyNotificationNew, notificationKeys, toAppNotification, type NotificationPages } from '../hooks/useNotifications';
import { useAuthStore } from '../stores/auth';
import { showNotificationNotice, useInAppNoticeStore } from '../stores/inAppNotice';
import { useMatchCelebrationStore } from '../stores/matchCelebration';

const get = api.get as jest.Mock;
const ME = { id: 'me', name: 'Eu', premiumTier: 'free', settings: { visibilityMode: 'visible' } };
const SECONDS = 60;
const NET_MS = 30; // ida e volta de uma requisição

// ───────────── relógio de tarefas: cada evento, cada timer e cada resposta de rede é uma tarefa ─────────────
let task = 0;
const passes = new Set<number>();
const mark = () => passes.add(task);

/** pseudoaleatório fixo: as duas rodadas veem exatamente os mesmos eventos */
function prng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

class FakeSocket implements RealtimeSocket {
  private handlers = new Map<string, Array<(p: unknown) => void>>();
  on(event: string, listener: (payload: never) => void) {
    const list = this.handlers.get(event) ?? [];
    list.push(listener as (p: unknown) => void);
    this.handlers.set(event, list);
    return this;
  }
  emit(event: string, payload: unknown) {
    for (const h of this.handlers.get(event) ?? []) h(payload);
  }
}

const conv = (i: number, folder: 'inbox' | 'requests' = 'inbox'): ConversationSummary =>
  ({
    id: `c${i}`,
    peer: { id: `p${i}`, name: `Pessoa ${i}`, avatar: null, mainPhotoUrl: null },
    folder,
    route: folder === 'inbox' ? 'principal' : 'request',
    myRole: 'RECIPIENT',
    awaitingReply: false,
    lastMessage: null,
    lastMessageAt: `2026-10-06T10:00:${String(i).padStart(2, '0')}.000Z`,
    unreadCount: 0,
    isMuted: false,
    promotedAt: null,
    promotedReason: null,
    likeStatus: 'NONE',
  }) as unknown as ConversationSummary;

const COUNTS: InboxCounts = { unreadInbox: 3, requests: 1, unreadRequests: 1 };
const page = (items: ConversationSummary[]) => ({ items, nextCursor: null, counts: COUNTS });

function routeOf(url: string): string {
  return url.startsWith('/inbox/requests') ? '/inbox/requests' : url;
}

/** a ligação de ANTES (App.tsx até a rodada 1): cada evento na hora, invalidações sem juntar */
function bindLegacy(socket: FakeSocket, qc: QueryClient) {
  const invalidateMe = coalesce(() => void qc.invalidateQueries({ queryKey: ['me'] }), 5_000);
  socket.on('notification:new', ((p: { notification?: unknown }) => {
    const n = toAppNotification(p?.notification);
    if (!n) return;
    applyNotificationNew(qc, n);
    showNotificationNotice(n);
  }) as never);
  socket.on('account:changed', (() =>
    notifyManager.batch(() => {
      void qc.invalidateQueries({ queryKey: ['me'] });
      useAuthStore.getState().refreshMe().catch(() => undefined);
    })) as never);
  socket.on('message:new', ((p: never) => applyMessageNew(qc, p)) as never);
  socket.on('conversation:new', ((p: never) => applyConversationNew(qc, p)) as never);
  socket.on('conversation:promoted', ((p: never) => applyPromoted(qc, p)) as never);
  socket.on('message:read', ((p: never) => applyRead(qc, p, useAuthStore.getState().user?.id)) as never);
  socket.on('conversation:removed', (({ conversationId }: { conversationId: string }) => applyRemoved(qc, conversationId)) as never);
  socket.on('like_received', invalidateMe as never);
  socket.on('match:new', ((p: never) => {
    useMatchCelebrationStore.getState().enqueue(p);
    void qc.invalidateQueries({ queryKey: inboxKeys.all });
    invalidateMe();
  }) as never);
}

type Ev = { at: number; name: string; payload: unknown };

/** ~45 eventos/s; o que o servidor manda junto (curtida + aviso, match + promoção + curtida) chega no mesmo ms */
function schedule(): Ev[] {
  const r = prng(7);
  const evs: Ev[] = [];
  const unread = new Map<string, number>();
  let n = 0;
  let strangers = 100;
  const at = (s: number) => s * 1000 + Math.floor(r() * 1000);
  const msg = (cid: string, peer: string, t: number) => {
    const u = (unread.get(cid) ?? 0) + 1;
    unread.set(cid, u);
    n += 1;
    const createdAt = new Date(Date.UTC(2026, 9, 6, 11, 0, 0, t)).toISOString();
    return { conversationId: cid, unreadCount: u, message: { id: `m${n}`, conversationId: cid, senderId: peer, body: 'oi', mediaUrl: null, createdAt, readAt: null, systemKind: null, messageType: 'text' } };
  };
  for (let s = 0; s < SECONDS; s++) {
    for (let k = 0; k < 21; k++) {
      const t = at(s);
      const i = Math.floor(r() * 15);
      evs.push({ at: t, name: 'message:new', payload: msg(`c${i}`, `p${i}`, t) });
    }
    for (let k = 0; k < 8; k++) {
      const i = Math.floor(r() * 15);
      evs.push({ at: at(s), name: 'message:read', payload: { conversationId: `c${i}`, readerId: `p${i}`, upToMessageId: null, readAt: '2026-10-06T11:00:00.000Z' } });
    }
    for (let k = 0; k < 5; k++) {
      const t = at(s);
      n += 1;
      evs.push({ at: t, name: 'like_received', payload: { isSuper: false } });
      evs.push({ at: t, name: 'notification:new', payload: { notification: { id: `n${n}`, type: 'like', title: 'Alguém te curtiu', sentAt: '2026-10-06T11:00:00.000Z' } } });
    }
    for (let k = 0; k < 2; k++) {
      const t = at(s);
      const id = strangers++;
      const c = conv(id, 'requests');
      evs.push({ at: t, name: 'conversation:new', payload: { conversation: c } });
      evs.push({ at: t, name: 'message:new', payload: msg(c.id, c.peer.id, t) });
    }
    if (s % 2 === 0) {
      const t = at(s);
      const i = Math.floor(r() * 15);
      evs.push({ at: t, name: 'conversation:promoted', payload: { conversationId: `c${i}`, reason: 'mutual', promotedAt: '2026-10-06T11:00:00.000Z' } });
      evs.push({ at: t, name: 'like_received', payload: { fromUserId: `p${i}`, isSuper: false, isMutual: true } });
      evs.push({ at: t, name: 'match:new', payload: { peer: { id: `p${i}`, name: `Pessoa ${i}`, avatar: null, mainPhotoUrl: null }, conversationId: `c${i}`, matchedAt: `2026-10-06T11:00:${String(s).padStart(2, '0')}.000Z` } });
    }
    if (s % 20 === 5) evs.push({ at: at(s), name: 'account:changed', payload: { reason: 'premium' } });
  }
  return evs.sort((a, b) => a.at - b.at);
}

async function drain() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function run(mode: 'antes' | 'depois') {
  task = 0;
  passes.clear();
  get.mockReset();
  const calls: Record<string, number> = {};
  get.mockImplementation((url: string) => {
    const route = routeOf(url);
    calls[route] = (calls[route] ?? 0) + 1;
    const data =
      route === '/inbox' ? page(Array.from({ length: 15 }, (_, i) => conv(i))) : route === '/inbox/requests' ? page([]) : route === '/inbox/counts' ? COUNTS : route === '/me' ? ME : route === '/notifications' ? { items: [], nextCursor: null, unreadCount: 0 } : [];
    // a resposta volta numa tarefa própria
    return new Promise((resolve) =>
      setTimeout(() => {
        task += 1;
        resolve({ data });
      }, NET_MS),
    );
  });

  if (mode === 'antes') {
    notifyManager.setScheduler((cb) =>
      setTimeout(() => {
        task += 1;
        cb();
      }, 0),
    );
  } else {
    notifyManager.setScheduler((cb) => nextFrame(cb));
  }

  const qc = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, staleTime: Infinity, retry: false } } });
  qc.setQueryData(inboxKeys.list('inbox'), { pages: [page(Array.from({ length: 15 }, (_, i) => conv(i)))], pageParams: [null] } as InboxPages);
  qc.setQueryData(inboxKeys.list('requests'), { pages: [page([])], pageParams: [null] } as InboxPages);
  qc.setQueryData(inboxKeys.counts, COUNTS);
  qc.setQueryData(notificationKeys.list, { pages: [{ items: [], next: null, unreadCount: 0 }], pageParams: [null] } as NotificationPages);
  qc.setQueryData(['me'], ME);
  useAuthStore.setState({ user: ME as never, isAuthenticated: true, isLoading: false });
  useMatchCelebrationStore.getState().reset();
  useInAppNoticeStore.setState({ current: null });

  const unsubs: Array<() => void> = [];
  for (const folder of ['inbox', 'requests'] as const) {
    const obs = new InfiniteQueryObserver(qc, {
      queryKey: inboxKeys.list(folder),
      queryFn: async () => (await api.get(folder === 'inbox' ? '/inbox' : '/inbox/requests')).data,
      initialPageParam: null,
      getNextPageParam: () => null,
      notifyOnChangeProps: ['data', 'fetchStatus'],
    });
    unsubs.push(obs.subscribe(mark));
  }
  unsubs.push(
    new QueryObserver(qc, { queryKey: inboxKeys.counts, queryFn: async () => (await api.get('/inbox/counts')).data, notifyOnChangeProps: ['data'] }).subscribe(mark),
  );
  unsubs.push(
    new InfiniteQueryObserver(qc, {
      queryKey: notificationKeys.list,
      queryFn: async () => (await api.get('/notifications')).data,
      initialPageParam: null,
      getNextPageParam: () => null,
      notifyOnChangeProps: ['data'],
    }).subscribe(mark),
  );
  unsubs.push(new QueryObserver(qc, { queryKey: ['me'], queryFn: async () => (await api.get('/me')).data, notifyOnChangeProps: ['data'] }).subscribe(mark));
  // stores com seletor: a tela só re-renderiza se o pedaço lido mudou
  unsubs.push(useInAppNoticeStore.subscribe((s, p) => s.current !== p.current && mark()));
  unsubs.push(useMatchCelebrationStore.subscribe((s, p) => (s.queue !== p.queue || s.current !== p.current) && mark()));
  unsubs.push(useAuthStore.subscribe((s, p) => s.user !== p.user && mark()));

  const socket = new FakeSocket();
  if (mode === 'antes') bindLegacy(socket, qc);
  else bindRealtime(socket, qc);
  await drain();
  get.mockClear();
  for (const k of Object.keys(calls)) delete calls[k];
  passes.clear();

  const evs = schedule();
  let e = 0;
  for (let ms = 0; ms < SECONDS * 1000; ms++) {
    while (e < evs.length && evs[e].at === ms) {
      task += 1;
      socket.emit(evs[e].name, evs[e].payload);
      e += 1;
      await drain();
    }
    jest.advanceTimersByTime(1);
    await drain();
  }
  // o que ficou agendado (janelas de 2–5 s, respostas em voo) termina
  for (let i = 0; i < 6000; i += 10) {
    jest.advanceTimersByTime(10);
    await drain();
  }
  unsubs.forEach((u) => u());
  qc.clear();
  const network = Object.values(calls).reduce((a, b) => a + b, 0);
  return { events: evs.length, renders: passes.size, network, calls: { ...calls } };
}

beforeAll(() => {
  // quadro de 16 ms (vsync): o requestAnimationFrame do teste dispara na próxima borda de quadro, numa tarefa própria
  (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (cb: (t: number) => void) =>
    setTimeout(() => {
      task += 1;
      cb(Date.now());
    }, 16 - (Date.now() % 16)) as unknown as number;
  (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = (id: number) => clearTimeout(id as never);
});

beforeEach(() => jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'], now: 0 }));
afterEach(() => jest.useRealTimers());

it(
  `rajada de ${SECONDS} s a ~45 eventos/s: passadas de render e GETs por minuto, antes × depois`,
  async () => {
    const before = await run('antes');
    const after = await run('depois');
    // eslint-disable-next-line no-console
    console.log(
      `eventos ${before.events} (${(before.events / SECONDS).toFixed(1)}/s)\n` +
        `passadas de render: antes ${before.renders} (${(before.renders / SECONDS).toFixed(1)}/s) → depois ${after.renders} (${(after.renders / SECONDS).toFixed(1)}/s)\n` +
        `GETs no minuto: antes ${before.network} ${JSON.stringify(before.calls)} → depois ${after.network} ${JSON.stringify(after.calls)}`,
    );
    expect(after.events).toBe(before.events);
    // rajada: no máx. um lote de eventos a cada 100 ms (+ as respostas de rede), ~1/3 das passadas de antes
    expect(after.renders / SECONDS).toBeLessThan(11);
    expect(after.renders).toBeLessThan(before.renders * 0.4);
    // menos GETs mesmo contra a ligação antiga já com os hooks novos (contagem a cada 2 s, listas uma vez por lote)
    expect(after.network).toBeLessThan(before.network * 0.8);
  },
  120_000,
);
