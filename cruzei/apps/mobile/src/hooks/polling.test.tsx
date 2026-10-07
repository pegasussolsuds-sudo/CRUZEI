// Polling de segurança com o socket conectado, 10 min parado no mapa com as abas já visitadas: contagem da aba
// (barra de abas + Mensagens + chat aberto) e avisos (barra de abas + Perfil + central). Cada tela com o hook tem o
// próprio relógio, mas o React Query realinha os relógios a cada busca e junta as que saem juntas (conferido aqui: 3
// telas = 1 GET por volta). O que muda é a volta das Mensagens: 2 min → 5 min com o socket.
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let mockPollMs = 300_000;
jest.mock('../services/api', () => ({ api: { get: jest.fn() }, toApiError: () => ({ status: 0, message: 'erro' }) }));
jest.mock('../services/socket', () => ({ inboxPollMs: () => mockPollMs, getSocket: () => ({ connected: true }) }));

import { api } from '../services/api';
import { refreshCounts, useInboxCounts } from './useInbox';
import { useNotificationList } from './useNotifications';

const get = api.get as jest.Mock;

function Counts() {
  useInboxCounts();
  return null;
}
function Notices() {
  useNotificationList();
  return null;
}

/** GETs em 10 min; telas montando em horas diferentes (aba no boot, Mensagens aos 37 s, chat/Perfil aos 81 s) */
async function tenMinutes(): Promise<Record<string, number>> {
  get.mockReset();
  get.mockImplementation((url: string) =>
    Promise.resolve({ data: url === '/inbox/counts' ? { unreadInbox: 0, requests: 0, unreadRequests: 0 } : { items: [], nextCursor: null, unreadCount: 0 } }),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, retry: false } } });
  const tree = (n: number) => (
    <QueryClientProvider client={qc}>
      <Counts />
      <Notices />
      {n >= 1 ? <Counts /> : null}
      {n >= 2 ? <Counts /> : null}
      {n >= 2 ? <Notices /> : null}
      {n >= 2 ? <Notices /> : null}
    </QueryClientProvider>
  );
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(tree(0));
  });
  await act(async () => {
    jest.advanceTimersByTime(37_000);
    r.update(tree(1));
  });
  await act(async () => {
    jest.advanceTimersByTime(44_000);
    r.update(tree(2));
  });
  get.mockClear(); // conta só o polling (as 1ªs buscas ao montar são iguais nos dois casos)
  for (let t = 0; t < 600_000; t += 1_000) {
    await act(async () => {
      jest.advanceTimersByTime(1_000);
    });
  }
  const calls: Record<string, number> = {};
  for (const [url] of get.mock.calls as [string][]) calls[url] = (calls[url] ?? 0) + 1;
  act(() => r.unmount());
  qc.clear();
  return calls;
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it('10 min no mapa com o socket: contagem 5 → 2 GETs (3 telas, 1 GET por volta); avisos 2 → 2', async () => {
  mockPollMs = 120_000;
  const before = await tenMinutes();
  mockPollMs = 300_000;
  const after = await tenMinutes();
  // eslint-disable-next-line no-console
  console.log(`polling em 10 min: antes ${JSON.stringify(before)} → depois ${JSON.stringify(after)}`);
  expect(before['/inbox/counts']).toBe(5); // 3 telas com o hook, uma busca por volta (o React Query junta)
  expect(after['/inbox/counts']).toBe(2);
  expect(before['/notifications']).toBe(2);
  expect(after['/notifications']).toBe(2);
}, 60_000);

it('contador da aba: o relógio do aparelho voltando 1 h não congela a busca (espera de no máx. 2 s)', () => {
  const qc = new QueryClient();
  const invalidate = jest.spyOn(qc, 'invalidateQueries').mockResolvedValue(undefined);
  refreshCounts(qc);
  jest.advanceTimersByTime(2_000); // (até 2 s: o relógio falso recomeça a cada teste)
  expect(invalidate).toHaveBeenCalledTimes(1);
  jest.setSystemTime(Date.now() - 3_600_000); // ajuste automático de hora
  refreshCounts(qc);
  jest.advanceTimersByTime(2_000);
  expect(invalidate).toHaveBeenCalledTimes(2); // antes: esperava "última + 2 s - agora" = 1 h
});
