import { describe, expect, it } from 'vitest';
import type { SupportMessage, SupportThreadSummary } from '@cruzei/shared-types';
import {
  applyMessageToSummary,
  countWaiting,
  isWaitingStaff,
  mergeMessage,
  sortThreads,
  threadMatchesFilter,
  upsertThread,
  upsertThreadInPages,
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
    expect(countWaiting([thread({ id: 'a', staffUnread: 1 }), thread({ id: 'b' })])).toBe(1);
  });

  it('ordena: esperando primeiro, depois o mais recente', () => {
    const list = sortThreads([
      thread({ id: 'velho', lastMessageAt: '2026-09-29T08:00:00Z' }),
      thread({ id: 'novo', lastMessageAt: '2026-09-29T11:00:00Z' }),
      thread({ id: 'esperando', staffUnread: 1, lastMessageAt: '2026-09-29T07:00:00Z' }),
    ]);
    expect(list.map((t) => t.id)).toEqual(['esperando', 'novo', 'velho']);
  });
});

describe('atualização ao vivo da fila', () => {
  it('entra, atualiza e sai conforme o filtro', () => {
    const base = [thread({ id: 'a' }), thread({ id: 'b' })];
    const updated = upsertThread(base, thread({ id: 'a', staffUnread: 3 }), 'open', 'me');
    expect(updated[0]?.id).toBe('a');
    expect(updated.find((t) => t.id === 'a')?.staffUnread).toBe(3);
    const resolved = upsertThread(base, thread({ id: 'a', status: 'resolved' }), 'open', 'me');
    expect(resolved.map((t) => t.id)).toEqual(['b']);
    const novo = upsertThread(base, thread({ id: 'c' }), 'open', 'me');
    expect(novo).toHaveLength(3);
  });

  it('lista paginada: tira de todas as páginas e põe na primeira', () => {
    const pages = [
      { items: [thread({ id: 'a' })], nextCursor: 'x' },
      { items: [thread({ id: 'b' })], nextCursor: null },
    ];
    const next = upsertThreadInPages(pages, thread({ id: 'b', staffUnread: 1 }), 'open', 'me');
    expect(next[0]?.items.map((t) => t.id)).toEqual(['b', 'a']);
    expect(next[1]?.items).toEqual([]);
    expect(next[0]?.nextCursor).toBe('x');
    const gone = upsertThreadInPages(pages, thread({ id: 'a', status: 'resolved' }), 'open', 'me');
    expect(gone[0]?.items).toEqual([]);
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
