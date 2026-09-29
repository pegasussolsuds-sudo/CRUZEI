import {
  cardVisible,
  isPausedNow,
  peerReachable,
  senderDenied,
  type CardTarget,
  type SenderAccount,
} from './visibility';

// Quem pode ABRIR conversa: a mesma visibilidade do cartão público. Qualquer "não" vira o mesmo 404 no service.

const NOW = new Date('2026-09-29T12:00:00Z');
const ok: CardTarget = {
  deletedAt: null,
  isPaused: false,
  pausedUntil: null,
  accountStatus: 'active',
  reviewHoldAt: null,
  visibilityMode: 'visible',
};

describe('cardVisible', () => {
  // prettier-ignore
  it.each([
    ['visível e ativa',               {},                                                         true ],
    ['apagada',                       { deletedAt: NOW },                                         false],
    ['pausada sem prazo',             { isPaused: true },                                         false],
    ['pausada até amanhã',            { isPaused: true, pausedUntil: new Date('2026-09-30') },    false],
    ['pausa vencida (conta visível)', { isPaused: true, pausedUntil: new Date('2026-09-28') },    true ],
    ['suspensa',                      { accountStatus: 'suspended' },                             false],
    ['banida',                        { accountStatus: 'banned' },                                false],
    ['em análise (reviewHold)',       { reviewHoldAt: NOW },                                      false],
    ['anônima',                       { visibilityMode: 'anonymous' },                            false],
  ] as const)('%s → %s', (_label, over, expected) => {
    expect(cardVisible({ ...ok, ...over }, NOW)).toBe(expected);
  });

  it('inexistente → false', () => {
    expect(cardVisible(null, NOW)).toBe(false);
    expect(cardVisible(undefined, NOW)).toBe(false);
  });
});

describe('isPausedNow', () => {
  it('pausa vencida não conta', () => {
    expect(isPausedNow({ isPaused: true, pausedUntil: new Date('2026-09-28') }, NOW)).toBe(false);
    expect(isPausedNow({ isPaused: false, pausedUntil: null }, NOW)).toBe(false);
  });
});

describe('peerReachable (conversa que já existe: o chat nunca é bloqueado)', () => {
  it('só conta apagada ou fora de active corta; anônima/pausada/em análise continuam recebendo', () => {
    expect(peerReachable({ deletedAt: null, accountStatus: 'active' })).toBe(true);
    expect(peerReachable({ deletedAt: NOW, accountStatus: 'active' })).toBe(false);
    expect(peerReachable({ deletedAt: null, accountStatus: 'banned' })).toBe(false);
    expect(peerReachable(null)).toBe(false);
  });
});

describe('senderDenied (quem ENVIA)', () => {
  const active: SenderAccount = { deletedAt: null, accountStatus: 'active', reviewHoldAt: null };
  // prettier-ignore
  it.each([
    ['ativa abre conversa',                 {},                                'start',   null     ],
    ['ativa insiste na solicitação',        {},                                'request', null     ],
    ['banida não responde',                 { accountStatus: 'banned' },       'reply',   'account'],
    ['suspensa não responde',               { accountStatus: 'suspended' },    'reply',   'account'],
    ['apagada não responde',                { deletedAt: NOW },                'reply',   'account'],
    ['em análise não abre conversa nova',   { reviewHoldAt: NOW },             'start',   'hold'   ],
    ['em análise não insiste na solicitação', { reviewHoldAt: NOW },           'request', 'hold'   ],
    ['em análise responde',                 { reviewHoldAt: NOW },             'reply',   null     ],
    ['banida E em análise: conta primeiro', { accountStatus: 'banned', reviewHoldAt: NOW }, 'reply', 'account'],
  ] as const)('%s', (_label, over, intent, esperado) => {
    expect(senderDenied({ ...active, ...over }, intent)).toBe(esperado);
  });

  it('inexistente → account', () => {
    expect(senderDenied(null, 'reply')).toBe('account');
    expect(senderDenied(undefined, 'start')).toBe('account');
  });
});
