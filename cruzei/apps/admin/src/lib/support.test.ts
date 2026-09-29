import { describe, expect, it } from 'vitest';
import type { SupportMessage, SupportThreadSummary } from '@cruzei/shared-types';
import {
  applyMessageToSummary,
  applyToLiveQueue,
  closedWhileReplying,
  escGoesBackToQueue,
  filterOrder,
  isWaitingStaff,
  mergeMessage,
  readDraft,
  seedLiveQueue,
  sortThreads,
  threadMatchesFilter,
  upsertThread,
  upsertThreadInPages,
  writeDraft,
} from './support';

function thread(p: Partial<SupportThreadSummary> & { id: string }): SupportThreadSummary {
  return {
    status: 'open',
    user: { id: `u-${p.id}`, name: 'Pessoa', avatarUrl: null, premiumTier: 'free', accountStatus: 'active' },
    assignedTo: null,
    lastMessage: null,
    staffUnread: 0,
    createdAt: '2026-09-29T10:00:00Z',
    lastMessageAt: '2026-09-29T10:00:00Z',
    firstResponseMinutes: null,
    waitingSince: null,
    ...p,
  };
}

function msg(p: Partial<SupportMessage> & { id: string }): SupportMessage {
  return {
    threadId: 't1',
    author: 'user',
    senderId: 'u1',
    senderName: null,
    body: 'oi',
    internal: false,
    createdAt: '2026-09-29T10:00:00Z',
    ...p,
  };
}

describe('filtros da fila', () => {
  it('status e "meus"', () => {
    const mine = thread({ id: 'a', assignedTo: { id: 'me', name: 'Eu' } });
    expect(threadMatchesFilter(mine, 'open', 'me')).toBe(true);
    expect(threadMatchesFilter(mine, 'mine', 'me')).toBe(true);
    expect(threadMatchesFilter({ ...mine, status: 'resolved' }, 'mine', 'me')).toBe(false);
    expect(threadMatchesFilter(mine, 'mine', 'outra')).toBe(false);
    expect(threadMatchesFilter(thread({ id: 'b', status: 'pending' }), 'open', 'me')).toBe(false);
  });
});

describe('quem espera a equipe', () => {
  it('aberto com não lida ou com a pessoa falando por último', () => {
    expect(isWaitingStaff(thread({ id: 'a', staffUnread: 2 }))).toBe(true);
    expect(isWaitingStaff(thread({ id: 'b', lastMessage: { body: 'oi', author: 'user', createdAt: '2026-09-29T10:00:00Z' } }))).toBe(true);
    expect(isWaitingStaff(thread({ id: 'c', lastMessage: { body: 'ok', author: 'staff', createdAt: '2026-09-29T10:00:00Z' } }))).toBe(false);
    expect(isWaitingStaff(thread({ id: 'd', status: 'pending', staffUnread: 1 }))).toBe(false);
  });

  it('ordena: esperando primeiro, depois o mais recente', () => {
    const list = sortThreads([
      thread({ id: 'velho', lastMessageAt: '2026-09-29T08:00:00Z' }),
      thread({ id: 'novo', lastMessageAt: '2026-09-29T11:00:00Z' }),
      thread({ id: 'esperando', staffUnread: 1, lastMessageAt: '2026-09-29T07:00:00Z' }),
    ]);
    expect(list.map((t) => t.id)).toEqual(['esperando', 'novo', 'velho']);
  });

  it('Abertos: quem espera há mais tempo primeiro (insistir não joga pro fim)', () => {
    expect(filterOrder('open')).toBe('oldest');
    expect(filterOrder('pending')).toBe('recent');
    expect(filterOrder('mine')).toBe('recent');
    const list = sortThreads(
      [
        thread({ id: 'novo', waitingSince: '2026-09-29T11:00:00Z', lastMessageAt: '2026-09-29T11:00:00Z' }),
        // espera desde as 8 h e mandou outra agora: continua na frente
        thread({ id: 'insistiu', waitingSince: '2026-09-29T08:00:00Z', lastMessageAt: '2026-09-29T11:30:00Z' }),
        thread({ id: 'reaberto', waitingSince: null, lastMessageAt: '2026-09-29T09:00:00Z' }),
      ],
      'oldest',
    );
    expect(list.map((t) => t.id)).toEqual(['insistiu', 'reaberto', 'novo']);
  });
});

describe('atualização ao vivo da fila', () => {
  it('entra, atualiza e sai conforme o filtro', () => {
    const base = [thread({ id: 'a' }), thread({ id: 'b' })];
    const updated = upsertThread(base, thread({ id: 'a', staffUnread: 3 }), 'open', 'me');
    expect(updated.find((t) => t.id === 'a')?.staffUnread).toBe(3);
    const resolved = upsertThread(base, thread({ id: 'a', status: 'resolved' }), 'open', 'me');
    expect(resolved.map((t) => t.id)).toEqual(['b']);
    const novo = upsertThread(base, thread({ id: 'c' }), 'open', 'me');
    expect(novo).toHaveLength(3);
    const pend = upsertThread([thread({ id: 'a', status: 'pending' })], thread({ id: 'b', status: 'pending', lastMessageAt: '2026-09-29T12:00:00Z' }), 'pending', 'me');
    expect(pend[0]?.id).toBe('b');
  });

  it('lista paginada (mais recente primeiro): tira de todas as páginas e põe na primeira', () => {
    const pending = (id: string) => thread({ id, status: 'pending' });
    const pages = [
      { items: [pending('a')], nextCursor: 'x' },
      { items: [pending('b')], nextCursor: null },
    ];
    const next = upsertThreadInPages(pages, { ...pending('b'), lastMessageAt: '2026-09-29T12:00:00Z' }, 'pending', 'me');
    expect(next[0]?.items.map((t) => t.id)).toEqual(['b', 'a']);
    expect(next[1]?.items).toEqual([]);
    expect(next[0]?.nextCursor).toBe('x');
    const gone = upsertThreadInPages(pages, thread({ id: 'a', status: 'resolved' }), 'pending', 'me');
    expect(gone[0]?.items).toEqual([]);
  });

  it('lista paginada de Abertos: quem já estava fica na página dele; o novo entra na última carregada', () => {
    const pages = [
      { items: [thread({ id: 'a', waitingSince: '2026-09-29T08:00:00Z' })], nextCursor: 'x' },
      { items: [thread({ id: 'b', waitingSince: '2026-09-29T09:00:00Z' })], nextCursor: null },
    ];
    const read = upsertThreadInPages(pages, thread({ id: 'b', waitingSince: '2026-09-29T09:00:00Z' }), 'open', 'me');
    expect(read.map((p) => p.items.map((t) => t.id))).toEqual([['a'], ['b']]);
    const novo = upsertThreadInPages(pages, thread({ id: 'c', waitingSince: '2026-09-29T12:00:00Z' }), 'open', 'me');
    expect(novo.map((p) => p.items.map((t) => t.id))).toEqual([['a'], ['b', 'c']]);
    const saiu = upsertThreadInPages(pages, thread({ id: 'a', status: 'pending' }), 'open', 'me');
    expect(saiu[0]?.items).toEqual([]);
  });
});

describe('quem está esperando (número do servidor + socket)', () => {
  it('semente: o total do servidor vale mesmo com só a 1ª página carregada', () => {
    const q = seedLiveQueue([thread({ id: 'a' }), thread({ id: 'b' })], 130);
    expect(q.total).toBe(130);
    expect(q.open.size).toBe(2);
    expect(seedLiveQueue([thread({ id: 'a' })], 0).total).toBe(1);
  });

  it('entra, atualiza e sai dos abertos; saída de quem não estava carregado pede conferência', () => {
    let q = seedLiveQueue([thread({ id: 'a' })], 40);
    q = applyToLiveQueue(q, thread({ id: 'novo' })).queue;
    expect(q.total).toBe(41);
    q = applyToLiveQueue(q, thread({ id: 'novo', staffUnread: 2 })).queue;
    expect(q.total).toBe(41);
    q = applyToLiveQueue(q, thread({ id: 'a', status: 'pending' })).queue;
    expect(q.total).toBe(40);
    const unknown = applyToLiveQueue(q, thread({ id: 'fora-da-lista', status: 'resolved' }));
    expect(unknown.recheck).toBe(true);
    expect(unknown.queue.total).toBe(40);
    // tudo carregado: quem não está na lista não era aberto
    const all = seedLiveQueue([thread({ id: 'a' })], 1);
    expect(applyToLiveQueue(all, thread({ id: 'x', status: 'pending' })).recheck).toBe(false);
  });
});

describe('mensagens', () => {
  it('troca a otimista pela do servidor (mesmo clientId) e não duplica', () => {
    const pending = msg({ id: 'pending:c1', clientId: 'c1', author: 'staff', createdAt: '2026-09-29T10:00:01Z' });
    const fromSocket = msg({ id: 'm1', author: 'staff', createdAt: '2026-09-29T10:00:02Z' });
    const fromPost = msg({ id: 'm1', clientId: 'c1', author: 'staff', createdAt: '2026-09-29T10:00:02Z' });
    let list = mergeMessage([], pending);
    list = mergeMessage(list, fromSocket);
    expect(list).toHaveLength(2);
    list = mergeMessage(list, fromPost);
    expect(list.map((m) => m.id)).toEqual(['m1']);
  });

  it('mantém ordem por horário', () => {
    const list = mergeMessage([msg({ id: 'b', createdAt: '2026-09-29T10:05:00Z' })], msg({ id: 'a', createdAt: '2026-09-29T10:01:00Z' }));
    expect(list.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('resumo da fila acompanha a mensagem nova', () => {
    const t = thread({ id: 't1', staffUnread: 1 });
    const fromUser = applyMessageToSummary(t, msg({ id: 'm', body: 'socorro', createdAt: '2026-09-29T12:00:00Z' }), false);
    expect(fromUser.staffUnread).toBe(2);
    expect(fromUser.lastMessage?.body).toBe('socorro');
    expect(applyMessageToSummary(t, msg({ id: 'm', author: 'user' }), true).staffUnread).toBe(1);
    expect(applyMessageToSummary(t, msg({ id: 'm', author: 'staff' }), false).staffUnread).toBe(0);
    // nota interna não mexe na fila
    expect(applyMessageToSummary(t, msg({ id: 'm', author: 'staff', internal: true }), false)).toBe(t);
  });
});

describe('conversa', () => {
  it('rascunho por atendimento: trocar de conversa não apaga; texto vazio some', () => {
    writeDraft('t1', 'oi, já estou vendo');
    writeDraft('t2', 'outra');
    expect(readDraft('t1')).toBe('oi, já estou vendo');
    expect(readDraft('t2')).toBe('outra');
    writeDraft('t1', '   ');
    expect(readDraft('t1')).toBe('');
    expect(readDraft('nunca')).toBe('');
  });

  it('Esc só volta pra fila sem nada em andamento', () => {
    const base = { text: '', quickOpen: false, contextOpen: false, typingInField: false, inDialog: false };
    expect(escGoesBackToQueue(base)).toBe(true);
    expect(escGoesBackToQueue({ ...base, text: 'meio escrito' })).toBe(false);
    expect(escGoesBackToQueue({ ...base, text: '   ' })).toBe(true);
    expect(escGoesBackToQueue({ ...base, quickOpen: true })).toBe(false);
    expect(escGoesBackToQueue({ ...base, contextOpen: true })).toBe(false);
    expect(escGoesBackToQueue({ ...base, typingInField: true })).toBe(false);
    expect(escGoesBackToQueue({ ...base, inDialog: true })).toBe(false);
  });

  it('encerrado por outra pessoa no meio de uma resposta: avisa (só na virada pra resolvido)', () => {
    expect(closedWhileReplying('open', 'resolved', true)).toBe(true);
    expect(closedWhileReplying('pending', 'resolved', true)).toBe(true);
    expect(closedWhileReplying('open', 'resolved', false)).toBe(false);
    expect(closedWhileReplying('resolved', 'resolved', true)).toBe(false);
    expect(closedWhileReplying(undefined, 'resolved', true)).toBe(false);
    expect(closedWhileReplying('open', 'pending', true)).toBe(false);
  });
});
