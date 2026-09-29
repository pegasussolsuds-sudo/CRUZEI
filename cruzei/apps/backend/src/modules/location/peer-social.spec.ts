import { peerConversation, seesLikesReceived, visibleLikeStatus } from './peer-social';

// Relação social no mapa/cartão: RECEIVED ("já te curtiu") só pra Premium+ vigente — corrige o vazamento em que o
// servidor mandava likedMe pra todo mundo e só o app escondia.

const NOW = new Date('2026-10-01T12:00:00Z');
const FUTURE = new Date('2026-11-01T12:00:00Z');
const PAST = new Date('2026-09-01T12:00:00Z');

describe('seesLikesReceived', () => {
  it.each([
    ['free', null, false],
    ['premium', null, false],
    ['premium', FUTURE, false],
    ['premium_plus', null, true],
    ['premium_plus', FUTURE, true],
    ['premium_plus', PAST, false], // assinatura vencida conta como free
  ] as const)('%s vencendo em %s → %s', (premiumTier, premiumExpiresAt, expected) => {
    expect(seesLikesReceived({ premiumTier, premiumExpiresAt }, NOW)).toBe(expected);
  });

  it('sem usuário → false', () => {
    expect(seesLikesReceived(null, NOW)).toBe(false);
    expect(seesLikesReceived(undefined, NOW)).toBe(false);
  });
});

describe('visibleLikeStatus', () => {
  // [eu→par, par→eu, Premium+, esperado] escrito à mão
  it.each([
    [false, false, false, 'NONE'],
    [false, false, true, 'NONE'],
    [true, false, false, 'SENT'],
    [true, false, true, 'SENT'],
    [false, true, false, 'NONE'], // o vazamento: fora do Premium+ "já te curtiu" não sai do servidor
    [false, true, true, 'RECEIVED'],
    [true, true, false, 'MUTUAL'], // mútuo todo mundo vê (os dois curtiram)
    [true, true, true, 'MUTUAL'],
  ] as const)('eu→par=%s par→eu=%s premium+=%s → %s', (meToPeer, peerToMe, sees, expected) => {
    expect(visibleLikeStatus(meToPeer, peerToMe, sees)).toBe(expected);
  });
});

describe('peerConversation', () => {
  const id = '0f5c3a4e-1111-4222-8333-444455556666';
  it.each([
    ['REQUESTER', null, 'inbox'], // quem mandou a 1ª vê na principal ("aguardando resposta")
    ['RECIPIENT', null, 'requests'], // quem recebeu vê nas solicitações
    ['REQUESTER', NOW, 'inbox'],
    ['RECIPIENT', NOW, 'inbox'], // promovida: principal pros dois
  ] as const)('%s com promotedAt=%s → %s', (role, promotedAt, folder) => {
    expect(peerConversation({ id, role, promotedAt })).toEqual({ id, folder });
  });
});
