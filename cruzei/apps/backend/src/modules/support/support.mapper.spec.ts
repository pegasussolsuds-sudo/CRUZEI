import {
  STAFF_DISPLAY_NAME,
  URGENT_ALERT_GAP_MS,
  URGENT_REPEAT_MS,
  claimUrgentAlert,
  urgentAlertKey,
  isUrgentOpen,
  isUrgentRepeat,
  messageForStaff,
  messageForUser,
  messagesForUser,
  normClientId,
  supportOrder,
  threadForUser,
  waitingSinceOf,
  welcomeText,
  type SupportMessageRow,
} from './support.mapper';

// O que o app vê do suporte (sem nota interna, atendente anônimo) × o que a equipe vê.

const ME = 'user-1';
const AGENT = 'staff-1';
const at = new Date('2026-10-02T12:00:00Z');
const msg = (o: Partial<SupportMessageRow>): SupportMessageRow => ({
  id: 'm',
  threadId: 't',
  senderId: ME,
  author: 'user',
  body: 'oi',
  internal: false,
  clientId: null,
  createdAt: at,
  ...o,
});

describe('mensagem pro app', () => {
  it('nota interna nunca sai', () => {
    expect(
      messageForUser(msg({ author: 'staff', senderId: AGENT, internal: true }), ME),
    ).toBeNull();
    const list = messagesForUser(
      [
        msg({ id: 'a' }),
        msg({ id: 'b', author: 'staff', senderId: AGENT, internal: true }),
        msg({ id: 'c', author: 'staff', senderId: AGENT }),
      ],
      ME,
    );
    expect(list.map((m) => m.id)).toEqual(['a', 'c']);
    expect(list.every((m) => m.internal === false)).toBe(true);
  });

  it('resposta da equipe: "Equipe Metch", sem o id de quem atendeu', () => {
    const m = messageForUser(msg({ author: 'staff', senderId: AGENT, clientId: 'painel-1' }), ME)!;
    expect(m.senderName).toBe(STAFF_DISPLAY_NAME);
    expect(m.senderId).toBeNull();
    expect(m.clientId).toBeUndefined();
    expect(JSON.stringify(m)).not.toContain(AGENT);
  });

  it('clientId só nas minhas mensagens; sistema sem remetente', () => {
    expect(messageForUser(msg({ clientId: 'c-1' }), ME)!.clientId).toBe('c-1');
    expect(messageForUser(msg({ clientId: 'c-1' }), 'outra-pessoa')!.clientId).toBeUndefined();
    const sys = messageForUser(
      msg({ author: 'system', senderId: null, body: welcomeText(24) }),
      ME,
    )!;
    expect(sys).toMatchObject({ author: 'system', senderId: null, senderName: null });
    expect(sys.body).toContain('24 horas');
  });
});

describe('mensagem pra equipe', () => {
  it('vê tudo, com nome real do atendente e da pessoa', () => {
    const names = new Map([
      [AGENT, 'Ana (suporte)'],
      [ME, 'Aline'],
    ]);
    expect(
      messageForStaff(msg({ author: 'staff', senderId: AGENT, internal: true }), names),
    ).toMatchObject({
      internal: true,
      senderId: AGENT,
      senderName: 'Ana (suporte)',
    });
    expect(messageForStaff(msg({}), names).senderName).toBe('Aline');
    expect(
      messageForStaff(msg({ author: 'staff', senderId: AGENT, clientId: 'p1' }), names, AGENT)
        .clientId,
    ).toBe('p1');
  });
});

describe('clientId', () => {
  it('curto e só com letras/números/_/-; o resto vira null (sem idempotência)', () => {
    expect(normClientId('abc-123_X')).toBe('abc-123_X');
    expect(normClientId(' abc ')).toBe('abc');
    expect(normClientId('a'.repeat(65))).toBeNull();
    expect(normClientId("x'; drop")).toBeNull();
    expect(normClientId(5)).toBeNull();
  });
});

describe('fila por espera', () => {
  it('ordem: só "oldest" muda; o resto é a de sempre (última mensagem primeiro)', () => {
    expect(supportOrder('oldest')).toBe('oldest');
    expect(supportOrder('recent')).toBe('recent');
    expect(supportOrder(undefined)).toBe('recent');
    expect(supportOrder("oldest'; drop")).toBe('recent');
  });

  it('esperando desde: só atendimento aberto com mensagem da pessoa sem resposta', () => {
    const since = new Date('2026-09-29T10:00:00Z');
    expect(waitingSinceOf('open', since)).toBe('2026-09-29T10:00:00.000Z');
    expect(waitingSinceOf('open', null)).toBeNull();
    expect(waitingSinceOf('pending', since)).toBeNull();
    expect(waitingSinceOf('resolved', since)).toBeNull();
  });
});

describe('urgente (botão de emergência)', () => {
  const row = {
    id: 't',
    userId: ME,
    status: 'open',
    createdAt: at,
    lastMessageAt: at,
    userUnread: 1,
    rating: null,
  };

  it('o app vê urgent só quando é urgente (atendimento comum mantém o formato de antes)', () => {
    expect(threadForUser(row)).not.toHaveProperty('urgent');
    expect(threadForUser({ ...row, urgent: false })).not.toHaveProperty('urgent');
    expect(threadForUser({ ...row, urgent: true })).toMatchObject({ urgent: true });
  });

  it('topo da fila: urgente e não resolvido', () => {
    expect(isUrgentOpen({ urgent: true, status: 'open' })).toBe(true);
    expect(isUrgentOpen({ urgent: true, status: 'pending' })).toBe(true);
    expect(isUrgentOpen({ urgent: true, status: 'resolved' })).toBe(false);
    expect(isUrgentOpen({ urgent: false, status: 'open' })).toBe(false);
    expect(isUrgentOpen({ status: 'open' })).toBe(false);
  });

  it('apertar de novo logo em seguida não repete as mensagens', () => {
    const now = at.getTime();
    expect(isUrgentRepeat({ urgent: true, urgent_at: new Date(now - 30_000) }, now)).toBe(true);
    expect(
      isUrgentRepeat({ urgent: true, urgent_at: new Date(now - URGENT_REPEAT_MS - 1) }, now),
    ).toBe(false);
    expect(isUrgentRepeat({ urgent: false, urgent_at: null }, now)).toBe(false);
  });

  it('alarme da equipe: 1 por atendimento a cada 10 min (SET NX PX); Redis fora → toca', async () => {
    const kv = new Set<string>();
    const set = jest.fn(async (k: string, _v: string, _px: string, _ms: number, nx: string) => {
      if (nx === 'NX' && kv.has(k)) return null;
      kv.add(k);
      return 'OK';
    });
    const redis = { set } as unknown as Parameters<typeof claimUrgentAlert>[0];
    expect(URGENT_ALERT_GAP_MS).toBe(10 * 60_000);
    expect(await claimUrgentAlert(redis, 't1')).toBe(true);
    expect(await claimUrgentAlert(redis, 't1')).toBe(false);
    // outro atendimento toca
    expect(await claimUrgentAlert(redis, 't2')).toBe(true);
    expect(set).toHaveBeenCalledWith(urgentAlertKey('t1'), '1', 'PX', URGENT_ALERT_GAP_MS, 'NX');
    // passou o intervalo (a chave venceu): toca de novo
    kv.delete(urgentAlertKey('t1'));
    expect(await claimUrgentAlert(redis, 't1')).toBe(true);
    const down = {
      set: jest.fn(async () => {
        throw new Error('redis fora');
      }),
    } as unknown as Parameters<typeof claimUrgentAlert>[0];
    expect(await claimUrgentAlert(down, 't1')).toBe(true);
  });
});
