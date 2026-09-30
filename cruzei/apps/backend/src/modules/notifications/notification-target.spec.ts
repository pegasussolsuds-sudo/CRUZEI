import {
  parseTarget,
  pushDataOf,
  pushDataRecord,
  targetFromData,
  toAppNotification,
} from './notification-target';

// Destino do toque (deep link): só tipos conhecidos, ids no formato certo, nada além do contrato.

const EV = '11111111-2222-4333-8444-555555555555';

describe('parseTarget', () => {
  it('aceita os destinos do contrato', () => {
    expect(parseTarget({ kind: 'map' })).toEqual({ kind: 'map' });
    expect(parseTarget({ kind: 'premium' })).toEqual({ kind: 'premium' });
    expect(parseTarget({ kind: 'support' })).toEqual({ kind: 'support' });
    expect(parseTarget({ kind: 'likes' })).toEqual({ kind: 'likes' });
    expect(parseTarget({ kind: 'place', poiId: 42 })).toEqual({ kind: 'place', poiId: '42' });
    expect(parseTarget({ kind: 'place', poiId: '42' })).toEqual({ kind: 'place', poiId: '42' });
    expect(parseTarget({ kind: 'event', eventId: EV.toUpperCase(), poiId: '7' })).toEqual({
      kind: 'event',
      eventId: EV,
      poiId: '7',
    });
    expect(parseTarget({ kind: 'event', eventId: EV })).toEqual({
      kind: 'event',
      eventId: EV,
      poiId: null,
    });
    expect(parseTarget({ kind: 'conversation', conversationId: EV })).toEqual({
      kind: 'conversation',
      conversationId: EV,
    });
    // push social do match: só o id da pessoa, em minúsculas
    expect(parseTarget({ kind: 'match', userId: EV.toUpperCase() })).toEqual({
      kind: 'match',
      userId: EV,
    });
  });

  it('match: campos extras saem; id que não é uuid é recusado', () => {
    expect(parseTarget({ kind: 'match', userId: EV, name: 'Ana', url: 'https://x' })).toEqual({
      kind: 'match',
      userId: EV,
    });
    expect(parseTarget({ kind: 'match' })).toBeNull();
    expect(parseTarget({ kind: 'match', userId: 'ana' })).toBeNull();
    expect(parseTarget({ kind: 'match', userId: 42 })).toBeNull();
  });

  it('descarta campos extras (URL livre nunca chega no app)', () => {
    expect(parseTarget({ kind: 'map', url: 'https://golpe.example' })).toEqual({ kind: 'map' });
  });

  it.each([
    [null],
    ['map'],
    [[{ kind: 'map' }]],
    [{ kind: 'url', url: 'https://x' }],
    [{ kind: 'place' }],
    [{ kind: 'place', poiId: '0' }],
    [{ kind: 'place', poiId: '12abc' }],
    [{ kind: 'place', poiId: -3 }],
    [{ kind: 'event', eventId: 'nao-e-uuid' }],
    [{ kind: 'event', eventId: EV, poiId: 'x' }],
    [{ kind: 'conversation', conversationId: '../../etc' }],
  ])('recusa %j', (raw) => {
    expect(parseTarget(raw)).toBeNull();
  });
});

describe('central de avisos e push', () => {
  const row = {
    id: 'n1',
    type: 'campaign',
    title: 'Oi',
    body: 'Novidade',
    data: { target: { kind: 'place', poiId: 9 }, campaignId: 'interno' },
    readAt: null,
    sentAt: new Date('2026-10-02T12:00:00Z'),
  };

  it('AppNotification: destino lido de data.target; o resto de data fica de fora', () => {
    expect(toAppNotification(row)).toEqual({
      id: 'n1',
      type: 'campaign',
      title: 'Oi',
      body: 'Novidade',
      target: { kind: 'place', poiId: '9' },
      readAt: null,
      sentAt: '2026-10-02T12:00:00.000Z',
    });
  });

  it('aviso antigo (sem data ou com destino inválido) sai com target null', () => {
    expect(toAppNotification({ ...row, data: null }).target).toBeNull();
    expect(targetFromData({ target: { kind: 'url' } })).toBeNull();
    expect(targetFromData('lixo')).toBeNull();
  });

  it('PushData: notificationId, tipo e destino em JSON (texto, como o FCM exige)', () => {
    const d = pushDataOf('n1', 'event', { kind: 'event', eventId: EV, poiId: '7' });
    expect(d).toEqual({
      notificationId: 'n1',
      type: 'event',
      target: JSON.stringify({ kind: 'event', eventId: EV, poiId: '7' }),
    });
    expect(Object.values(pushDataRecord(d)).every((v) => typeof v === 'string')).toBe(true);
    // push sem central: id vazio; sem destino: sem a chave
    expect(pushDataRecord(pushDataOf(null, 'campaign', null))).toEqual({
      notificationId: '',
      type: 'campaign',
    });
  });
});
