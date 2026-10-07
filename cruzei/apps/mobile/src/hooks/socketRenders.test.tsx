// Custo de JS dos eventos do socket nas telas abertas: quantas tarefas de notificação (= passadas de render no RN) um
// evento de Mensagens agenda. Cada setQueryData fora de um lote agenda a própria notificação (setTimeout 0); no RN
// (arquitetura nova) as microtarefas drenam entre tarefas, então cada uma vira uma passada de render separada da tela
// de Mensagens, do chat aberto e da aba. O evento tem que chegar às telas numa tarefa só.

jest.mock('../services/api', () => ({
  api: { get: jest.fn(() => new Promise(() => undefined)), post: jest.fn(), patch: jest.fn() },
  toApiError: () => ({ status: 0, message: 'erro' }),
}));
jest.mock('../services/socket', () => ({ inboxPollMs: 120_000 }));

import type { ChatMessage, ConversationDetail, ConversationSummary } from '@cruzei/shared-types';
import { QueryClient, QueryObserver, notifyManager } from '@tanstack/react-query';

import { applyConversationNew, applyMessageNew, applyPromoted, applyRead, applyRemoved, applyUnread, inboxKeys, type InboxPages } from './useInbox';

const CONV = '00000000-0000-4000-8000-0000000000c1';
const ME = '00000000-0000-4000-8000-0000000000a1';
const PEER = '00000000-0000-4000-8000-0000000000b1';
const never = () => new Promise<never>(() => undefined);
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function msg(id: string, at: string, senderId = PEER): ChatMessage {
  return { id, conversationId: CONV, senderId, body: id, mediaUrl: null, createdAt: at, readAt: null, systemKind: null, messageType: 'text' } as ChatMessage;
}

const summary = {
  id: CONV,
  peer: { id: PEER, name: 'Bia', avatar: null, mainPhotoUrl: null },
  folder: 'requests',
  route: 'request',
  myRole: 'RECIPIENT',
  awaitingReply: false,
  lastMessage: msg('m1', '2026-10-06T10:00:00.000Z'),
  lastMessageAt: '2026-10-06T10:00:00.000Z',
  unreadCount: 2,
  isMuted: false,
  promotedAt: null,
  promotedReason: null,
  likeStatus: 'NONE',
} as unknown as ConversationSummary;

let qc: QueryClient;
let unsubs: Array<() => void> = [];
let tasks = 0;

beforeAll(() => {
  // conta as tarefas que o React Query agenda pra avisar as telas (o padrão é um setTimeout 0 por lote)
  notifyManager.setScheduler((cb) => {
    tasks += 1;
    setTimeout(cb, 0);
  });
});

beforeEach(async () => {
  qc = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, staleTime: Infinity, queryFn: never } } });
  const page = (items: ConversationSummary[]) => ({ pages: [{ items, nextCursor: null } as never], pageParams: [null] }) as InboxPages;
  qc.setQueryData(inboxKeys.list('inbox'), page([]));
  qc.setQueryData(inboxKeys.list('requests'), page([summary]));
  qc.setQueryData(inboxKeys.conversation(CONV), { ...summary, requestMessagesLeft: null } as unknown as ConversationDetail);
  qc.setQueryData(inboxKeys.messages(CONV), [msg('m0', '2026-10-06T09:00:00.000Z', ME), msg('m1', '2026-10-06T10:00:00.000Z')]);
  // telas abertas: Mensagens (as duas pastas), chat (detalhe + histórico) e o cartão (conversa do par), assinando como o
  // useQuery assina (batchCalls: o aviso à tela vai pela fila do notifyManager)
  for (const key of [inboxKeys.list('inbox'), inboxKeys.list('requests'), inboxKeys.conversation(CONV), inboxKeys.messages(CONV), inboxKeys.withUser(PEER)]) {
    unsubs.push(new QueryObserver(qc, { queryKey: key, notifyOnChangeProps: ['data', 'fetchStatus'] }).subscribe(notifyManager.batchCalls(() => undefined)));
  }
  await wait(10);
  tasks = 0;
});

afterEach(() => {
  unsubs.forEach((u) => u());
  unsubs = [];
  qc.clear();
});

/** tarefas agendadas pelo evento (sem a contagem da aba, que vem 800 ms depois, já juntada) */
async function tasksOf(fire: () => void): Promise<number> {
  fire();
  await wait(20);
  return tasks;
}

describe('evento do socket → UMA tarefa de render', () => {
  it('message:new (histórico, as duas pastas e o detalhe mudam)', async () => {
    expect(await tasksOf(() => applyMessageNew(qc, { conversationId: CONV, message: msg('m2', '2026-10-06T10:01:00.000Z'), unreadCount: 3 }))).toBe(1);
  });

  it('message:read meu (pasta e detalhe zeram)', async () => {
    expect(await tasksOf(() => applyRead(qc, { conversationId: CONV, readerId: ME, upToMessageId: null, readAt: '2026-10-06T10:02:00.000Z' }, ME))).toBe(1);
  });

  it('message:read do outro (recibo no histórico)', async () => {
    expect(await tasksOf(() => applyRead(qc, { conversationId: CONV, readerId: PEER, upToMessageId: null, readAt: '2026-10-06T10:02:00.000Z' }, ME))).toBe(1);
  });

  it('conversation:promoted (solicitação → principal, detalhe e conversa do par)', async () => {
    expect(await tasksOf(() => applyPromoted(qc, { conversationId: CONV, reason: 'manual', promotedAt: '2026-10-06T10:03:00.000Z' }))).toBe(1);
  });

  it('conversation:new', async () => {
    const c = { ...summary, id: 'c2', folder: 'inbox', peer: { ...summary.peer, id: 'p2' } } as ConversationSummary;
    expect(await tasksOf(() => applyConversationNew(qc, { conversation: c } as never))).toBe(1);
  });

  it('contagem da aba: rajada contínua (evento a cada 300 ms) busca 800 ms depois do 1º e depois no máx. 1 a cada 2 s', async () => {
    await wait(2_100); // a contagem agendada pelos testes de antes já saiu (e a janela dela fechou)
    const inv = jest.spyOn(qc, 'invalidateQueries');
    const countsCalls = () => inv.mock.calls.filter(([f]) => JSON.stringify(f?.queryKey) === JSON.stringify(inboxKeys.counts)).length;
    applyUnread(qc, CONV, 1);
    await wait(850);
    expect(countsCalls()).toBe(1); // o 1º evento depois do silêncio: 800 ms, como antes
    for (let i = 0; i < 14; i++) {
      applyUnread(qc, CONV, i % 2);
      await wait(300);
    }
    // +4,2 s de rajada: mais 2 buscas (2,8 s e 4,8 s), sem esperar a rajada acabar. A janela de 800 ms fazia 5
    expect(countsCalls()).toBe(3);
  }, 15_000);

  it('POST /read (applyUnread) e conversation:removed', async () => {
    expect(await tasksOf(() => applyUnread(qc, CONV, 0))).toBe(1);
    tasks = 0;
    expect(await tasksOf(() => applyRemoved(qc, CONV))).toBe(1);
  });
});
