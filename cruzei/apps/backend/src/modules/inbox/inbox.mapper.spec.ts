import {
  ageOn,
  decodeCursor,
  encodeCursor,
  factsFromRow,
  routeOf,
  toSummary,
  type SummaryRow,
} from './inbox.mapper';

// Linha → contrato: a pasta vem de folderFor(papel, promoção gravada); "aguardando resposta" só pro REQUESTER;
// RECEIVED só aparece pra Premium+ (mesma regra do cartão e do mapa). Nada disso é calculado no app.

const NOW = new Date('2026-09-29T12:00:00Z');

function row(over: Partial<SummaryRow> = {}): SummaryRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    created_at: new Date('2026-09-29T10:00:00Z'),
    promoted_at: null,
    promoted_reason: null,
    last_message_at: new Date('2026-09-29T11:00:00Z'),
    sort_key: '2026-09-29T11:00:00.000000',
    my_role: 'REQUESTER',
    unread_count: 0,
    is_muted: false,
    archived_at: null,
    viewer_premium_tier: 'free',
    viewer_premium_expires_at: null,
    peer_id: '22222222-2222-4222-8222-222222222222',
    peer_name: 'Bia',
    peer_birth_date: new Date('2000-09-30T00:00:00Z'),
    peer_show_age: true,
    peer_gender: 'female',
    peer_avatar_config: null,
    peer_photo_url: null,
    like_me_peer: false,
    like_peer_me: false,
    msgs_from_me: 1,
    msgs_from_peer: 0,
    lm_id: '33333333-3333-4333-8333-333333333333',
    lm_sender_id: '44444444-4444-4444-8444-444444444444',
    lm_body: 'oi',
    lm_media_url: null,
    lm_message_type: 'text',
    lm_system_kind: null,
    lm_read_at: null,
    lm_created_at: new Date('2026-09-29T11:00:00Z'),
    ...over,
  };
}

describe('toSummary — pasta e selo por papel', () => {
  // prettier-ignore
  it.each([
    // papel,       promovida, msgs eu, msgs outro, pasta,      aguardando
    ['REQUESTER',   false,     1,       0,          'inbox',    true ],
    ['RECIPIENT',   false,     0,       1,          'requests', false],
    ['REQUESTER',   true,      0,       0,          'inbox',    false],
    ['RECIPIENT',   true,      0,       0,          'inbox',    false],
  ] as const)('%s promovida=%s → %s (aguardando=%s)', (role, promoted, fromMe, fromPeer, folder, awaiting) => {
    const s = toSummary(row({ my_role: role, promoted_at: promoted ? NOW : null, msgs_from_me: fromMe, msgs_from_peer: fromPeer }), NOW);
    expect(s.folder).toBe(folder);
    expect(s.route).toBe(promoted ? 'principal' : 'request');
    expect(s.awaitingReply).toBe(awaiting);
    expect(s.myRole).toBe(role);
  });

  it('REQUESTER que já recebeu resposta não está aguardando', () => {
    expect(toSummary(row({ msgs_from_me: 2, msgs_from_peer: 1 }), NOW).awaitingReply).toBe(false);
  });

  it('mensagem de sistema vira lastMessage com systemKind', () => {
    const s = toSummary(
      row({
        lm_system_kind: 'mutual_like',
        lm_message_type: 'system',
        lm_body: 'Vocês se curtiram.',
      }),
      NOW,
    );
    expect(s.lastMessage).toMatchObject({
      systemKind: 'mutual_like',
      messageType: 'system',
      conversationId: s.id,
    });
  });

  it('sem mensagem: lastMessage null', () => {
    expect(
      toSummary(row({ lm_id: null, lm_created_at: null, last_message_at: null }), NOW).lastMessage,
    ).toBeNull();
  });

  it('idade respeita showAge; avatar de fallback sempre presente', () => {
    const shown = toSummary(row(), NOW);
    expect(shown.peer.age).toBe(25); // faz 26 só amanhã (30/09)
    expect(shown.peer.avatar).toBeTruthy();
    const hidden = toSummary(row({ peer_show_age: false }), NOW);
    expect('age' in hidden.peer).toBe(false);
  });
});

describe('toSummary — likeStatus (RECEIVED só pra Premium+)', () => {
  // prettier-ignore
  it.each([
    // eu→outro, outro→eu, plano,          esperado
    [false,      false,    'free',         'NONE'    ],
    [true,       false,    'free',         'SENT'    ],
    [false,      true,     'free',         'NONE'    ], // "já te curtiu" escondido
    [false,      true,     'premium',      'NONE'    ],
    [false,      true,     'premium_plus', 'RECEIVED'],
    [true,       true,     'free',         'MUTUAL'  ],
  ] as const)('%s/%s plano=%s → %s', (meToPeer, peerToMe, tier, expected) => {
    const s = toSummary(row({ like_me_peer: meToPeer, like_peer_me: peerToMe, viewer_premium_tier: tier }), NOW);
    expect(s.likeStatus).toBe(expected);
  });

  it('Premium+ vencido não vê RECEIVED', () => {
    const s = toSummary(
      row({
        like_peer_me: true,
        viewer_premium_tier: 'premium_plus',
        viewer_premium_expires_at: new Date('2026-09-01T00:00:00Z'),
      }),
      NOW,
    );
    expect(s.likeStatus).toBe('NONE');
  });
});

describe('factsFromRow — A é sempre o REQUESTER', () => {
  it('RECIPIENT consultando troca os lados', () => {
    const f = factsFromRow({
      my_role: 'RECIPIENT',
      like_me_peer: true,
      like_peer_me: false,
      msgs_from_me: 0,
      msgs_from_peer: 2,
      promoted_at: null,
    });
    expect(f).toEqual({
      likeAB: false,
      likeBA: true,
      messageCount: 2,
      messagesFromA: 2,
      messagesFromB: 0,
      promotedAt: null,
    });
  });
  it('routeOf segue só a promoção gravada', () => {
    expect(routeOf(null)).toBe('request');
    expect(routeOf(NOW)).toBe('principal');
  });
});

describe('cursor', () => {
  it('ida e volta sem perder microssegundos', () => {
    const c = { at: '2026-09-29T11:00:00.123456', id: '11111111-1111-4111-8111-111111111111' };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });
  it.each([
    '',
    'lixo',
    Buffer.from('2026-09-29|x').toString('base64url'),
    Buffer.from("x'; DROP TABLE users;--|y").toString('base64url'),
  ])('inválido → null (%s)', (raw) => {
    expect(decodeCursor(raw)).toBeNull();
  });
});

describe('ageOn', () => {
  it('aniversário hoje conta, amanhã não', () => {
    expect(ageOn(new Date('2000-09-29T00:00:00Z'), NOW)).toBe(26);
    expect(ageOn(new Date('2000-09-30T00:00:00Z'), NOW)).toBe(25);
  });
});
