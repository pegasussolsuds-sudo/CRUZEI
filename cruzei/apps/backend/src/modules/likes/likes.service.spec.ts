import { LikesService } from './likes.service';

// LikesService sem banco: o que sai DEPOIS do commit (like_received, match:new e push) conforme quem curtiu.
// Curtidor em análise: a curtida é gravada, mas não avisa ninguém (nem ao vivo nem push). O caminho com banco de
// verdade fica no test/db/social-push.db-spec.ts.

jest.mock('./match-celebrations', () => ({
  upsertCelebration: jest.fn(async () => ({ row: true })),
  toMatchCelebration: jest.fn(() => ({
    peer: { id: 'ana' },
    conversationId: null,
    matchedAt: 'agora',
  })),
  pendingCelebrations: jest.fn(),
  markCelebrationSeen: jest.fn(),
}));

const LIKER = 'ana';
const LIKED = 'bia';

function setup(
  o: {
    likerHold?: boolean;
    likerAnonymousPremium?: boolean;
    mutual?: boolean;
    likedPlus?: boolean;
  } = {},
) {
  const liker = {
    visibilityMode: o.likerAnonymousPremium ? 'anonymous' : 'visible',
    premiumTier: o.likerAnonymousPremium ? 'premium' : 'free',
    premiumExpiresAt: null,
    reviewHoldAt: o.likerHold ? new Date() : null,
  };
  const target = {
    id: LIKED,
    deletedAt: null,
    visibilityMode: 'visible',
    accountStatus: 'active',
    reviewHoldAt: null,
    premiumTier: o.likedPlus ? 'premium_plus' : 'free',
    premiumExpiresAt: null,
  };
  const findUser = jest.fn(async (a: { where: { id: string } }) =>
    a.where.id === LIKER ? liker : target,
  );
  const created: unknown[] = [];
  const tx = {
    block: { findFirst: jest.fn(async () => null) },
    user: { findUnique: findUser },
    like: {
      // 1ª: a curtida de novo (não existe); 2ª: a reversa (existe se mutual)
      findUnique: jest.fn(async (a: { where: { likerId_likedId: { likerId: string } } }) =>
        a.where.likerId_likedId.likerId === LIKED && o.mutual ? { id: 7n } : null,
      ),
      create: jest.fn(async (a: unknown) => {
        created.push(a);
        return { id: 1n };
      }),
    },
  };
  const prisma = {
    user: { findUnique: findUser },
    block: { findFirst: jest.fn(async () => null) },
    like: { findUnique: jest.fn(async () => null) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const redis = {
    incrRate: jest.fn(async () => 1),
    invalidateProfile: jest.fn(async () => undefined),
    client: { decr: jest.fn(async () => 0), get: jest.fn(async () => '1') },
  };
  const emitted: { to: string; event: string; payload: unknown }[] = [];
  const gateway = {
    emitToUser: jest.fn(
      (to: string, event: string, payload: unknown) => void emitted.push({ to, event, payload }),
    ),
  };
  const inbox = {
    lockPair: jest.fn(async () => undefined),
    onMutualLike: jest.fn(async () => ({ promotedConversationIds: [], events: [] })),
    flush: jest.fn(),
  };
  const social = { like: jest.fn(async () => undefined), match: jest.fn(async () => undefined) };
  const svc = new LikesService(
    prisma as never,
    redis as never,
    gateway as never,
    inbox as never,
    social as never,
  );
  return { svc, emitted, social, created, inbox };
}

describe('LikesService.like — avisos depois do commit', () => {
  it('curtidor em análise: a curtida é gravada, mas sem like_received e sem push', async () => {
    const t = setup({ likerHold: true, likedPlus: true });
    const r = await t.svc.like(LIKER, LIKED, false);
    expect(r.likeStatus).toBe('SENT');
    expect(t.created).toEqual([
      { data: { likerId: LIKER, likedId: LIKED, isSuper: false }, select: { id: true } },
    ]);
    expect(t.emitted).toEqual([]);
    expect(t.social.like).not.toHaveBeenCalled();
    expect(t.social.match).not.toHaveBeenCalled();
  });

  it('curtidor em análise com super curtida: também nada', async () => {
    const t = setup({ likerHold: true });
    await t.svc.like(LIKER, LIKED, true);
    expect(t.emitted).toEqual([]);
    expect(t.social.like).not.toHaveBeenCalled();
  });

  it('curtidor em análise fechando o match: sem like_received, sem comemoração e sem push (igual à comemoração)', async () => {
    const t = setup({ likerHold: true, mutual: true });
    const r = await t.svc.like(LIKER, LIKED, false);
    expect(r.isMutual).toBe(true);
    expect(t.inbox.onMutualLike).toHaveBeenCalled();
    expect(t.emitted).toEqual([]);
    expect(t.social.like).not.toHaveBeenCalled();
    expect(t.social.match).not.toHaveBeenCalled();
  });

  it('curtidor comum: like_received sem id (quem recebe não é Premium+) e push da curtida', async () => {
    const t = setup();
    await t.svc.like(LIKER, LIKED, false);
    expect(t.emitted).toEqual([{ to: LIKED, event: 'like_received', payload: { isSuper: false } }]);
    expect(t.social.like).toHaveBeenCalledWith({
      to: LIKED,
      likerId: LIKER,
      isSuper: false,
      reveal: false,
    });
  });

  it('Premium+ recebe o id; curtidor invisível (Premium) nunca é revelado, mas avisa', async () => {
    const t = setup({ likedPlus: true });
    await t.svc.like(LIKER, LIKED, false);
    expect(t.emitted).toEqual([
      { to: LIKED, event: 'like_received', payload: { fromUserId: LIKER, isSuper: false } },
    ]);
    expect(t.social.like).toHaveBeenCalledWith(expect.objectContaining({ reveal: true }));

    const t2 = setup({ likedPlus: true, likerAnonymousPremium: true });
    await t2.svc.like(LIKER, LIKED, false);
    expect(t2.emitted).toEqual([
      { to: LIKED, event: 'like_received', payload: { isSuper: false } },
    ]);
    expect(t2.social.like).toHaveBeenCalledWith(expect.objectContaining({ reveal: false }));
  });

  it('match com curtidor comum: like_received mútuo, comemoração e push do match', async () => {
    const t = setup({ mutual: true });
    await t.svc.like(LIKER, LIKED, false);
    expect(t.emitted.map((e) => e.event)).toEqual(['like_received', 'match:new']);
    expect(t.emitted[0].payload).toEqual({ fromUserId: LIKER, isSuper: false, isMutual: true });
    expect(t.social.match).toHaveBeenCalledWith({ to: LIKED, peerId: LIKER });
    expect(t.social.like).not.toHaveBeenCalled();
  });
});
