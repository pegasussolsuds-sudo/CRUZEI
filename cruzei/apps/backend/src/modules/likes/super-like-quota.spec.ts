import {
  buildQuota,
  spendSuperLike,
  superLikeDay,
  superLikeLimit,
  superLikeLimitError,
  superLikeResetsAt,
  superLikeTier,
} from './super-like-quota';

// Cota da super curtida: o dia vira à meia-noite de São Paulo (UTC-3, sem horário de verão desde 2019), o plano é o
// EFETIVO (vencido = grátis) e o 403 convida pro Premium só no grátis.

describe('dia de São Paulo', () => {
  it('23h59 de lá ainda é o mesmo dia; meia-noite de lá já é o próximo', () => {
    // 02:59:59Z = 23:59:59 em São Paulo (dia 30)
    expect(superLikeDay(new Date('2026-10-01T02:59:59Z'))).toBe('2026-09-30');
    // 03:00:00Z = 00:00 em São Paulo (dia 1º)
    expect(superLikeDay(new Date('2026-10-01T03:00:00Z'))).toBe('2026-10-01');
  });

  it('virada de mês e de ano', () => {
    expect(superLikeDay(new Date('2027-01-01T01:00:00Z'))).toBe('2026-12-31');
    expect(superLikeDay(new Date('2027-01-01T03:30:00Z'))).toBe('2027-01-01');
  });

  it('volta na próxima meia-noite de São Paulo', () => {
    expect(superLikeResetsAt(new Date('2026-09-30T15:00:00Z')).toISOString()).toBe(
      '2026-10-01T03:00:00.000Z',
    );
    // 01:00Z do dia 1º ainda é dia 30 em São Paulo: volta às 03:00Z do mesmo dia 1º
    expect(superLikeResetsAt(new Date('2026-10-01T01:00:00Z')).toISOString()).toBe(
      '2026-10-01T03:00:00.000Z',
    );
    // exatamente na meia-noite: a próxima é a do dia seguinte
    expect(superLikeResetsAt(new Date('2026-10-01T03:00:00Z')).toISOString()).toBe(
      '2026-10-02T03:00:00.000Z',
    );
    expect(superLikeResetsAt(new Date('2026-12-31T20:00:00.500Z')).toISOString()).toBe(
      '2027-01-01T03:00:00.000Z',
    );
  });
});

describe('plano e limite', () => {
  const now = new Date('2026-09-30T12:00:00Z');
  it('grátis 1, Premium e Premium+ 7', () => {
    expect(superLikeLimit('free')).toBe(1);
    expect(superLikeLimit('premium')).toBe(7);
    expect(superLikeLimit('premium_plus')).toBe(7);
  });

  it('assinatura vencida conta como grátis; sem vencimento ou no futuro vale o plano', () => {
    expect(
      superLikeTier(
        { premiumTier: 'premium', premiumExpiresAt: new Date('2026-09-29T00:00:00Z') },
        now,
      ),
    ).toBe('free');
    expect(superLikeTier({ premiumTier: 'premium_plus', premiumExpiresAt: null }, now)).toBe(
      'premium_plus',
    );
    expect(
      superLikeTier(
        { premiumTier: 'premium', premiumExpiresAt: new Date('2026-10-30T00:00:00Z') },
        now,
      ),
    ).toBe('premium');
    expect(superLikeTier(null, now)).toBe('free');
  });

  it('a cota do dia nunca fica negativa', () => {
    expect(buildQuota('free', 0, now)).toEqual({
      tier: 'free',
      limit: 1,
      used: 0,
      remaining: 1,
      resetsAt: '2026-10-01T03:00:00.000Z',
    });
    expect(buildQuota('premium', 9, now).remaining).toBe(0);
  });
});

describe('403 super_like_limit', () => {
  const now = new Date('2026-09-30T12:00:00Z');
  it('grátis: convite pro Premium', () => {
    const e = superLikeLimitError('free', now);
    expect(e.getStatus()).toBe(403);
    expect(e.getResponse()).toEqual({
      error: 'super_like_limit',
      message: expect.stringContaining('Premium'),
      limit: 1,
      resetsAt: '2026-10-01T03:00:00.000Z',
      canUpgrade: true,
    });
  });

  it('Premium: sem convite, avisa que amanhã tem mais', () => {
    const body = superLikeLimitError('premium_plus', now).getResponse() as Record<string, unknown>;
    expect(body).toMatchObject({ limit: 7, canUpgrade: false });
    expect(String(body.message)).toMatch(/Amanhã/);
  });
});

describe('gasto atômico', () => {
  it('limite 0 nem consulta o banco', async () => {
    const db = { $queryRaw: jest.fn() };
    expect(await spendSuperLike(db as never, 'u', '2026-09-30', 0)).toBeNull();
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });

  it('sem linha de volta = acabou; com linha = usadas depois do gasto', async () => {
    const empty = { $queryRaw: jest.fn(async () => []) };
    expect(await spendSuperLike(empty as never, 'u', '2026-09-30', 1)).toBeNull();
    const one = { $queryRaw: jest.fn(async () => [{ used: 3 }]) };
    expect(await spendSuperLike(one as never, 'u', '2026-09-30', 7)).toBe(3);
    const [sql] = one.$queryRaw.mock.calls[0] as unknown as [TemplateStringsArray];
    expect(sql.join('?')).toMatch(
      /ON CONFLICT \(user_id, day\) DO UPDATE SET used = super_like_uses\.used \+ 1\s+WHERE super_like_uses\.used < \?/,
    );
  });
});
