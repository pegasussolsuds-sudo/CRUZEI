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
    /** plano de quem curte (padrão: grátis; invisível Premium usa 'premium') */
    likerTier?: 'free' | 'premium' | 'premium_plus';
    likerExpiresAt?: Date | null;
    /** super curtidas já usadas hoje (a leitura antes da transação) */
    superUsed?: number;
    /** o gasto atômico dentro da transação não acha cota (corrida com outra requisição) */
    spendFails?: boolean;
  } = {},
) {
  const liker = {
    visibilityMode: o.likerAnonymousPremium ? 'anonymous' : 'visible',
    premiumTier: o.likerTier ?? (o.likerAnonymousPremium ? 'premium' : 'free'),
    premiumExpiresAt: o.likerExpiresAt ?? null,
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
  const superUsed = o.superUsed ?? 0;
  // gasto atômico (INSERT ... ON CONFLICT ... RETURNING used): sem linha = acabou
  const spend = jest.fn(async (..._a: unknown[]) =>
    o.spendFails ? [] : [{ used: superUsed + 1 }],
  );
  const tx = {
    $queryRaw: spend,
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
    pass: {
      deleteMany: jest.fn(async () => ({ count: 1 })),
      findUnique: jest.fn(async (..._a: unknown[]): Promise<{ createdAt: Date } | null> => null),
    },
    auditLog: { create: jest.fn(async () => ({})) },
    // leitura da cota de hoje (SELECT used FROM super_like_uses)
    $queryRaw: jest.fn(async (..._a: unknown[]) => (superUsed ? [{ used: superUsed }] : [])),
    $executeRaw: jest.fn(async (..._a: unknown[]) => 1),
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
  return { svc, emitted, social, created, inbox, prisma, redis, spend };
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

/** corpo do 403 (ForbiddenException) */
async function limitBody(p: Promise<unknown>) {
  const err = (await p.then(
    () => null,
    (e: unknown) => e,
  )) as { getStatus(): number; getResponse(): Record<string, unknown> } | null;
  expect(err).not.toBeNull();
  expect(err!.getStatus()).toBe(403);
  return err!.getResponse();
}

describe('LikesService.like — limite diário da super curtida', () => {
  it('grátis com a cota livre: gasta 1 na transação, devolve 0 restando e atualiza o /me de quem mandou', async () => {
    const t = setup();
    const r = await t.svc.like(LIKER, LIKED, true);
    expect(r.superLikesRemainingToday).toBe(0);
    expect(t.spend).toHaveBeenCalledTimes(1);
    // o gasto leva o limite do plano (grátis = 1) como parâmetro
    expect(t.spend.mock.calls[0]).toContain(1);
    expect(t.created).toEqual([
      { data: { likerId: LIKER, likedId: LIKED, isSuper: true }, select: { id: true } },
    ]);
    expect(t.redis.invalidateProfile).toHaveBeenCalledWith(LIKER);
  });

  it('grátis sem cota: 403 super_like_limit com convite pro Premium, sem gastar o limite anti-abuso nem gravar', async () => {
    const t = setup({ superUsed: 1 });
    const body = await limitBody(t.svc.like(LIKER, LIKED, true));
    expect(body).toMatchObject({ error: 'super_like_limit', limit: 1, canUpgrade: true });
    expect(typeof body.resetsAt).toBe('string');
    expect(String(body.message)).toMatch(/Premium/);
    expect(t.redis.incrRate).not.toHaveBeenCalled();
    expect(t.spend).not.toHaveBeenCalled();
    expect(t.created).toEqual([]);
    expect(t.emitted).toEqual([]);
  });

  it('Premium: 7 por dia; na 8ª, 403 sem convite (canUpgrade false)', async () => {
    const ok = setup({ likerTier: 'premium', superUsed: 6 });
    const r = await ok.svc.like(LIKER, LIKED, true);
    expect(r.superLikesRemainingToday).toBe(0);
    expect(ok.spend.mock.calls[0]).toContain(7);

    const full = setup({ likerTier: 'premium_plus', superUsed: 7 });
    const body = await limitBody(full.svc.like(LIKER, LIKED, true));
    expect(body).toMatchObject({ error: 'super_like_limit', limit: 7, canUpgrade: false });
  });

  it('Premium vencido conta como grátis (1 por dia)', async () => {
    const t = setup({
      likerTier: 'premium',
      likerExpiresAt: new Date(Date.now() - 60_000),
      superUsed: 1,
    });
    const body = await limitBody(t.svc.like(LIKER, LIKED, true));
    expect(body).toMatchObject({ limit: 1, canUpgrade: true });
  });

  it('corrida: a cota acabou dentro da transação → 403, devolve o limite anti-abuso e não cria a curtida', async () => {
    const t = setup({ spendFails: true });
    const body = await limitBody(t.svc.like(LIKER, LIKED, true));
    expect(body).toMatchObject({ error: 'super_like_limit', canUpgrade: true });
    expect(t.redis.incrRate).toHaveBeenCalledTimes(1);
    expect(t.redis.client.decr).toHaveBeenCalledWith(`rate:${LIKER}:like`);
    expect(t.created).toEqual([]);
    expect(t.emitted).toEqual([]);
    expect(t.social.like).not.toHaveBeenCalled();
  });

  it('curtida normal não lê nem gasta a cota da super', async () => {
    const t = setup({ superUsed: 1 });
    const r = await t.svc.like(LIKER, LIKED, false);
    expect(r.superLikesRemainingToday).toBeUndefined();
    expect(t.prisma.$queryRaw).not.toHaveBeenCalled();
    expect(t.spend).not.toHaveBeenCalled();
  });

  it('super curtida pra quem eu já curti: devolve o estado, sem gastar', async () => {
    const t = setup();
    t.prisma.like.findUnique.mockResolvedValueOnce({ id: 3n } as never);
    const r = await t.svc.like(LIKER, LIKED, true);
    expect(r.likeId).toBe('3');
    expect(t.prisma.$queryRaw).not.toHaveBeenCalled();
    expect(t.spend).not.toHaveBeenCalled();
    expect(t.created).toEqual([]);
  });
});

describe('LikesService.like — a super curtida revela quem mandou', () => {
  it('quem recebe sem Premium+ ganha o id na super (na curtida normal, não) e o push nomeia', async () => {
    const t = setup();
    await t.svc.like(LIKER, LIKED, true);
    expect(t.emitted).toEqual([
      { to: LIKED, event: 'like_received', payload: { fromUserId: LIKER, isSuper: true } },
    ]);
    expect(t.social.like).toHaveBeenCalledWith({
      to: LIKED,
      likerId: LIKER,
      isSuper: true,
      reveal: true,
    });
  });

  it('super de quem está invisível (Premium): continua sem revelar', async () => {
    const t = setup({ likerAnonymousPremium: true });
    await t.svc.like(LIKER, LIKED, true);
    expect(t.emitted).toEqual([{ to: LIKED, event: 'like_received', payload: { isSuper: true } }]);
    expect(t.social.like).toHaveBeenCalledWith(expect.objectContaining({ reveal: false }));
  });
});

describe('LikesService — "Passar" salvo e "Voltar"', () => {
  it('passar grava na tabela passes (renova o prazo) e não escreve no audit_log', async () => {
    const t = setup();
    await t.svc.pass(LIKER, LIKED);
    expect(t.prisma.$executeRaw).toHaveBeenCalledTimes(1);
    const [sql, ...values] = t.prisma.$executeRaw.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    expect(sql.join('?')).toMatch(
      /INSERT INTO passes[\s\S]*ON CONFLICT \(user_id, target_id\) DO UPDATE SET created_at = now\(\)/,
    );
    expect(values).toEqual([LIKER, LIKED]);
    expect(t.prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('passar a si mesmo: 400', async () => {
    const t = setup();
    await expect(t.svc.pass(LIKER, LIKER)).rejects.toMatchObject({ status: 400 });
    expect(t.prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('voltar apaga só ESSE passar, se for o meu último e recente (numa instrução só)', async () => {
    const t = setup();
    await t.svc.unpass(LIKER, LIKED);
    expect(t.prisma.$executeRaw).toHaveBeenCalledTimes(1);
    const [sql, ...values] = t.prisma.$executeRaw.mock.calls[0] as [
      TemplateStringsArray,
      ...unknown[],
    ];
    const text = sql.join('?');
    expect(text).toMatch(
      /DELETE FROM passes p[\s\S]*p\.user_id = \?::uuid AND p\.target_id = \?::uuid/,
    );
    expect(text).toMatch(/p\.created_at > now\(\) - make_interval\(mins => \?::int\)/);
    // o último: nenhum passar meu mais novo que esse
    expect(text).toMatch(
      /NOT EXISTS \(\s*SELECT 1 FROM passes q WHERE q\.user_id = p\.user_id AND q\.created_at > p\.created_at/,
    );
    expect(values).toEqual([LIKER, LIKED, 10]);
    expect(t.prisma.pass.deleteMany).not.toHaveBeenCalled();
    // apagou: nem confere de novo
    expect(t.prisma.pass.findUnique).not.toHaveBeenCalled();
  });

  it('voltar sem passar gravado (já desfeito, resposta perdida): nada a fazer, sem erro', async () => {
    const t = setup();
    t.prisma.$executeRaw.mockResolvedValueOnce(0);
    await expect(t.svc.unpass(LIKER, LIKED)).resolves.toBeUndefined();
    expect(t.prisma.pass.findUnique).toHaveBeenCalledWith({
      where: { userId_targetId: { userId: LIKER, targetId: LIKED } },
      select: { createdAt: true },
    });
  });

  it('voltar um passar velho ou que não é o último: 409 com mensagem (o passar fica)', async () => {
    const t = setup();
    t.prisma.$executeRaw.mockResolvedValueOnce(0);
    t.prisma.pass.findUnique.mockResolvedValueOnce({ createdAt: new Date() });
    const err = await t.svc.unpass(LIKER, LIKED).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 409 });
    expect((err as { getResponse: () => unknown }).getResponse()).toEqual({
      error: 'pass_undo_unavailable',
      message: expect.stringMatching(/último passar, até 10 minutos/),
    });
  });
});
