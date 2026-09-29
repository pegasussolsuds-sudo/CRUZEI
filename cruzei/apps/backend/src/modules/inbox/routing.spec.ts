import {
  applyPlan,
  awaitingReply,
  canRequesterSend,
  folderFor,
  likeStatus,
  marksReadAllowed,
  NOOP,
  planReevaluation,
  route,
  ROUTING,
  type ConversationFacts,
  type InboxFolder,
  type LikeStatus,
  type MemberRole,
  type RouteFolder,
  type RouteReason,
} from './routing';

// A = REQUESTER (mandou a 1ª mensagem), B = RECIPIENT
const T0 = new Date('2026-09-29T12:00:00.000Z');
const T1 = new Date('2026-09-30T08:00:00.000Z');
const T2 = new Date('2026-10-01T20:00:00.000Z');

type Curtida = 'nenhuma' | 'de um lado' | 'mútua';

/** 1 mensagem = de A; 2 mensagens = uma de A e uma de B; curtida de um lado = A → B */
const facts = (msgs: 0 | 1 | 2, curtida: Curtida, promovida: boolean): ConversationFacts => ({
  likeAB: curtida !== 'nenhuma',
  likeBA: curtida === 'mútua',
  messageCount: msgs,
  messagesFromA: msgs >= 1 ? 1 : 0,
  messagesFromB: msgs === 2 ? 1 : 0,
  promotedAt: promovida ? T0 : null,
});

const f = (p: Partial<ConversationFacts>): ConversationFacts => ({
  likeAB: false,
  likeBA: false,
  messageCount: 0,
  messagesFromA: 0,
  messagesFromB: 0,
  promotedAt: null,
  ...p,
});

type Row = [
  msgs: 0 | 1 | 2,
  curtida: Curtida,
  promovida: boolean,
  pasta: RouteFolder,
  motivo: RouteReason,
  paraRequester: InboxFolder,
  paraRecipient: InboxFolder,
  promover: null | 'mutual' | 'bounce',
  sistema: 'mutual_like' | null,
  aguardando: boolean,
];

// Resultado ESCRITO À MÃO (não sai da implementação). 3 × 3 × 2 = 18 linhas.
// prettier-ignore
const TABLE: Row[] = [
  // msgs curtida       promovida  pasta        motivo      REQUESTER  RECIPIENT   promover  sistema        aguardando
  [0,    'nenhuma',     false,     'request',   null,       'inbox',   'requests', null,     null,          false],
  [0,    'de um lado',  false,     'request',   null,       'inbox',   'requests', null,     null,          false],
  [0,    'mútua',       false,     'principal', 'mutual',   'inbox',   'inbox',    'mutual', 'mutual_like', false],
  [1,    'nenhuma',     false,     'request',   null,       'inbox',   'requests', null,     null,          true ],
  [1,    'de um lado',  false,     'request',   null,       'inbox',   'requests', null,     null,          true ],
  [1,    'mútua',       false,     'principal', 'mutual',   'inbox',   'inbox',    'mutual', 'mutual_like', false],
  [2,    'nenhuma',     false,     'principal', 'bounce',   'inbox',   'inbox',    'bounce', null,          false],
  [2,    'de um lado',  false,     'principal', 'bounce',   'inbox',   'inbox',    'bounce', null,          false],
  [2,    'mútua',       false,     'principal', 'mutual',   'inbox',   'inbox',    'mutual', 'mutual_like', false],
  [0,    'nenhuma',     true,      'principal', 'promoted', 'inbox',   'inbox',    null,     null,          false],
  [0,    'de um lado',  true,      'principal', 'promoted', 'inbox',   'inbox',    null,     null,          false],
  [0,    'mútua',       true,      'principal', 'promoted', 'inbox',   'inbox',    null,     null,          false],
  [1,    'nenhuma',     true,      'principal', 'promoted', 'inbox',   'inbox',    null,     null,          false],
  [1,    'de um lado',  true,      'principal', 'promoted', 'inbox',   'inbox',    null,     null,          false],
  [1,    'mútua',       true,      'principal', 'promoted', 'inbox',   'inbox',    null,     null,          false],
  [2,    'nenhuma',     true,      'principal', 'promoted', 'inbox',   'inbox',    null,     null,          false],
  [2,    'de um lado',  true,      'principal', 'promoted', 'inbox',   'inbox',    null,     null,          false],
  [2,    'mútua',       true,      'principal', 'promoted', 'inbox',   'inbox',    null,     null,          false],
];

describe('tabela de transições (mensagens × curtida × promotedAt)', () => {
  it('a tabela tem as 18 combinações, sem repetir', () => {
    const keys = new Set(TABLE.map(([m, c, p]) => `${m}|${c}|${p}`));
    expect(keys.size).toBe(18);
  });

  it.each<Row>(TABLE)(
    '%i msg, curtida %s, promovida %s → %s (%s); REQUESTER vê %s, RECIPIENT vê %s; plano %s + %s',
    (
      msgs,
      curtida,
      promovida,
      pasta,
      motivo,
      paraRequester,
      paraRecipient,
      promover,
      sistema,
      aguardando,
    ) => {
      const fx = facts(msgs, curtida, promovida);
      const r = route(fx);
      expect(r).toEqual({ folder: pasta, reason: motivo });
      expect(folderFor('REQUESTER', r)).toBe(paraRequester);
      expect(folderFor('RECIPIENT', r)).toBe(paraRecipient);
      expect(planReevaluation(fx)).toEqual({ promote: promover, systemMessage: sistema });
      expect(awaitingReply('REQUESTER', fx)).toBe(aguardando);
      expect(awaitingReply('RECIPIENT', fx)).toBe(false);
    },
  );
});

describe('linhas fixas das ambiguidades', () => {
  it('2 mensagens do MESMO remetente continuam solicitação (bounce exige os dois lados)', () => {
    const fx = f({ messageCount: 2, messagesFromA: 2 });
    expect(route(fx)).toEqual({ folder: 'request', reason: null });
    expect(planReevaluation(fx)).toEqual(NOOP);
    expect(folderFor('RECIPIENT', route(fx))).toBe('requests');
    expect(awaitingReply('REQUESTER', fx)).toBe(true);
  });

  it('3 mensagens do mesmo remetente + curtida de um lado continuam solicitação', () => {
    const fx = f({ likeAB: true, messageCount: 3, messagesFromA: 3 });
    expect(route(fx)).toEqual({ folder: 'request', reason: null });
    expect(planReevaluation(fx)).toEqual(NOOP);
  });

  it('a regra do bounce troca em 1 linha: sem exigir os dois lados, 2 mensagens de A promovem', () => {
    const fx = f({ messageCount: 2, messagesFromA: 2 });
    const cfg = { ...ROUTING, BOUNCE_REQUIRES_BOTH_SIDES: false };
    expect(route(fx, cfg)).toEqual({ folder: 'principal', reason: 'bounce' });
    expect(planReevaluation(fx, cfg)).toEqual({ promote: 'bounce', systemMessage: null });
  });

  it('curtida de um lado no sentido contrário (B → A) também não promove', () => {
    const fx = f({ likeBA: true, messageCount: 1, messagesFromA: 1 });
    expect(route(fx)).toEqual({ folder: 'request', reason: null });
    expect(folderFor('RECIPIENT', route(fx))).toBe('requests');
  });

  it('promoção é permanente: curtida mútua promove e, desfeita a curtida depois, continua principal', () => {
    const antes = f({ likeAB: true, likeBA: true, messageCount: 1, messagesFromA: 1 });
    const plano = planReevaluation(antes);
    expect(plano).toEqual({ promote: 'mutual', systemMessage: 'mutual_like' });
    const promovida = applyPlan(antes, plano, T1);
    const descurtiu = { ...promovida, likeBA: false };
    expect(route(descurtiu)).toEqual({ folder: 'principal', reason: 'promoted' });
    expect(folderFor('RECIPIENT', route(descurtiu))).toBe('inbox');
    expect(planReevaluation(descurtiu)).toEqual(NOOP);
  });

  it('curtida mútua numa conversa já promovida por bounce → sem mensagem de sistema', () => {
    const conversa = f({ messageCount: 2, messagesFromA: 1, messagesFromB: 1 });
    const plano = planReevaluation(conversa);
    expect(plano).toEqual({ promote: 'bounce', systemMessage: null });
    const promovida = applyPlan(conversa, plano, T1);
    const curtiram = { ...promovida, likeAB: true, likeBA: true };
    expect(planReevaluation(curtiram)).toEqual({ promote: null, systemMessage: null });
    expect(route(curtiram)).toEqual({ folder: 'principal', reason: 'promoted' });
  });

  it('curtida mútua numa conversa promovida à mão → sem mensagem de sistema', () => {
    const manual = f({ messageCount: 1, messagesFromA: 1, promotedAt: T0 });
    expect(planReevaluation({ ...manual, likeAB: true, likeBA: true })).toEqual(NOOP);
  });

  it('resposta depois da curtida mútua não gera nada de novo', () => {
    const mutua = f({ likeAB: true, likeBA: true, messageCount: 1, messagesFromA: 1 });
    const promovida = applyPlan(mutua, planReevaluation(mutua), T1);
    const respondeu = { ...promovida, messageCount: 2, messagesFromB: 1 };
    expect(planReevaluation(respondeu)).toEqual(NOOP);
    expect(respondeu.promotedAt).toBe(T1);
  });
});

describe('idempotência da reavaliação (as 18 linhas)', () => {
  it.each<Row>(TABLE)(
    '%i msg, curtida %s, promovida %s: aplicar o plano e reavaliar dá NOOP',
    (msgs, curtida, promovida) => {
      const fx = facts(msgs, curtida, promovida);
      const f2 = applyPlan(fx, planReevaluation(fx), T1);
      expect(planReevaluation(f2)).toEqual(NOOP);
      // gravar não muda a pasta, só a torna permanente
      expect(route(f2).folder).toBe(route(fx).folder);
      expect(f2.promotedAt !== null).toBe(route(fx).folder === 'principal');
      // conversa já promovida mantém a data original
      if (promovida) expect(f2.promotedAt).toBe(T0);
      // segunda rodada não mexe em nada
      expect(applyPlan(f2, planReevaluation(f2), T2)).toEqual(f2);
    },
  );
});

describe('likeStatus (derivado das duas linhas de likes)', () => {
  it.each<[boolean, boolean, LikeStatus]>([
    [false, false, 'NONE'],
    [true, false, 'SENT'],
    [false, true, 'RECEIVED'],
    [true, true, 'MUTUAL'],
  ])('eu → par %s, par → eu %s → %s', (meToPeer, peerToMe, esperado) => {
    expect(likeStatus(meToPeer, peerToMe)).toBe(esperado);
  });
});

describe('folderFor (solicitações é só de quem recebeu)', () => {
  it.each<[MemberRole, RouteFolder, InboxFolder]>([
    ['REQUESTER', 'request', 'inbox'],
    ['RECIPIENT', 'request', 'requests'],
    ['REQUESTER', 'principal', 'inbox'],
    ['RECIPIENT', 'principal', 'inbox'],
  ])('%s com a conversa em %s → %s', (role, pasta, esperado) => {
    expect(folderFor(role, pasta)).toBe(esperado);
    expect(folderFor(role, { folder: pasta })).toBe(esperado);
  });
});

describe('awaitingReply (selo "aguardando resposta")', () => {
  it('REQUESTER com a solicitação sem resposta → aguardando', () => {
    expect(awaitingReply('REQUESTER', f({ messageCount: 2, messagesFromA: 2 }))).toBe(true);
  });
  it('o outro lado respondeu → não aguarda mais', () => {
    expect(
      awaitingReply('REQUESTER', f({ messageCount: 2, messagesFromA: 1, messagesFromB: 1 })),
    ).toBe(false);
  });
  it('promovida (curtida mútua ou à mão) sem resposta → sem selo, a conversa já está na principal dos dois', () => {
    expect(
      awaitingReply(
        'REQUESTER',
        f({ likeAB: true, likeBA: true, messageCount: 1, messagesFromA: 1 }),
      ),
    ).toBe(false);
    expect(
      awaitingReply('REQUESTER', f({ messageCount: 1, messagesFromA: 1, promotedAt: T0 })),
    ).toBe(false);
  });
  it('RECIPIENT nunca vê o selo', () => {
    expect(awaitingReply('RECIPIENT', f({ messageCount: 1, messagesFromA: 1 }))).toBe(false);
  });
});

describe('canRequesterSend (no máximo 3 mensagens até a primeira resposta)', () => {
  it.each<[string, ConversationFacts, boolean]>([
    ['nenhuma enviada', f({}), true],
    ['1 enviada', f({ messageCount: 1, messagesFromA: 1 }), true],
    ['2 enviadas', f({ messageCount: 2, messagesFromA: 2 }), true],
    ['3 enviadas → para aí', f({ messageCount: 3, messagesFromA: 3 }), false],
    [
      '3 enviadas com curtida de um lado → para aí',
      f({ likeAB: true, messageCount: 3, messagesFromA: 3 }),
      false,
    ],
    [
      '3 enviadas e o outro respondeu → livre',
      f({ messageCount: 4, messagesFromA: 3, messagesFromB: 1 }),
      true,
    ],
    [
      '3 enviadas e curtida mútua → livre',
      f({ likeAB: true, likeBA: true, messageCount: 3, messagesFromA: 3 }),
      true,
    ],
    [
      '3 enviadas e promovida à mão → livre',
      f({ messageCount: 3, messagesFromA: 3, promotedAt: T0 }),
      true,
    ],
  ])('%s', (_caso, fx, esperado) => {
    expect(canRequesterSend(fx)).toBe(esperado);
    expect(canRequesterSend(fx, fx.messagesFromA)).toBe(esperado);
  });
});

describe('marksReadAllowed (quem recebeu não dispara "lida" antes de aceitar)', () => {
  it.each<[MemberRole, RouteFolder, boolean]>([
    ['RECIPIENT', 'request', false],
    ['RECIPIENT', 'principal', true],
    ['REQUESTER', 'request', true],
    ['REQUESTER', 'principal', true],
  ])('%s com a conversa em %s → %s', (role, pasta, esperado) => {
    expect(marksReadAllowed(role, pasta)).toBe(esperado);
    expect(marksReadAllowed(role, { folder: pasta })).toBe(esperado);
  });
});

describe('conversa do começo ao fim', () => {
  it('A manda 3, trava; B responde; vira principal por bounce; curtida mútua depois não gera mensagem de sistema', () => {
    let c = f({});
    for (let i = 1; i <= 3; i++) {
      expect(canRequesterSend(c)).toBe(true);
      c = { ...c, messageCount: i, messagesFromA: i };
      expect(planReevaluation(c)).toEqual(NOOP);
      expect(folderFor('RECIPIENT', route(c))).toBe('requests');
      expect(marksReadAllowed('RECIPIENT', route(c))).toBe(false);
    }
    expect(canRequesterSend(c)).toBe(false);

    c = { ...c, messageCount: 4, messagesFromB: 1 };
    const plano = planReevaluation(c);
    expect(plano).toEqual({ promote: 'bounce', systemMessage: null });
    c = applyPlan(c, plano, T1);
    expect(folderFor('RECIPIENT', route(c))).toBe('inbox');
    expect(marksReadAllowed('RECIPIENT', route(c))).toBe(true);
    expect(canRequesterSend(c)).toBe(true);

    c = { ...c, likeAB: true, likeBA: true };
    expect(planReevaluation(c)).toEqual(NOOP);
    expect(c.promotedAt).toBe(T1);
  });
});
