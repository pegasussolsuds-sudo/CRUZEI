import {
  STAFF_DISPLAY_NAME,
  messageForStaff,
  messageForUser,
  messagesForUser,
  normClientId,
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
