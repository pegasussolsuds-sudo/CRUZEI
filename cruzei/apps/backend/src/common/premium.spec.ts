import {
  ANON_FREE_HOURS,
  ANON_FREE_MS,
  anonymousWindowAction,
  decideAnonymous,
  effectiveTier,
  isPremiumActive,
  visibleAnonymousUntil,
} from './premium';

const NOW = new Date('2026-10-03T15:00:00.000Z');
const H = 3_600_000;
const at = (hours: number) => new Date(NOW.getTime() + hours * H);

describe('plano efetivo', () => {
  it('free é free; pago sem vencimento ou vencendo no futuro vale; vencido conta como free', () => {
    expect(effectiveTier('free', null, NOW)).toBe('free');
    expect(effectiveTier('premium', null, NOW)).toBe('premium');
    expect(effectiveTier('premium_plus', at(1), NOW)).toBe('premium_plus');
    expect(effectiveTier('premium', at(-1), NOW)).toBe('free');
    expect(effectiveTier('premium', NOW, NOW)).toBe('free'); // vence no instante: já é free
  });

  it('isPremiumActive segue a mesma regra (e aceita linha nula)', () => {
    expect(isPremiumActive(null)).toBe(false);
    expect(isPremiumActive({ premiumTier: 'free', premiumExpiresAt: null }, NOW)).toBe(false);
    expect(isPremiumActive({ premiumTier: 'premium', premiumExpiresAt: null }, NOW)).toBe(true);
    expect(isPremiumActive({ premiumTier: 'premium_plus', premiumExpiresAt: at(2) }, NOW)).toBe(
      true,
    );
    expect(isPremiumActive({ premiumTier: 'premium', premiumExpiresAt: at(-2) }, NOW)).toBe(false);
    expect(isPremiumActive({ premiumTier: 'lixo', premiumExpiresAt: null }, NOW)).toBe(false);
  });
});

describe('decideAnonymous (ligar o invisível)', () => {
  it('janela de 24 h', () => {
    expect(ANON_FREE_HOURS).toBe(24);
    expect(ANON_FREE_MS).toBe(24 * H);
  });

  it('Premium vigente: sem prazo', () => {
    expect(
      decideAnonymous({ premium: true, visibilityMode: 'visible', anonymousUntil: null }, NOW),
    ).toEqual({
      kind: 'unlimited',
      until: null,
    });
    // mesmo com uma janela grátis antiga gravada
    expect(
      decideAnonymous({ premium: true, visibilityMode: 'anonymous', anonymousUntil: at(3) }, NOW)
        .until,
    ).toBeNull();
  });

  it('grátis visível: janela nova a partir de agora', () => {
    expect(
      decideAnonymous({ premium: false, visibilityMode: 'visible', anonymousUntil: null }, NOW),
    ).toEqual({
      kind: 'new',
      until: at(24),
    });
  });

  it('PATCH repetido com a janela valendo NÃO estende o prazo', () => {
    const d = decideAnonymous(
      { premium: false, visibilityMode: 'anonymous', anonymousUntil: at(5) },
      NOW,
    );
    expect(d).toEqual({ kind: 'keep', until: at(5) });
  });

  it('pode religar quando quiser: desligou (visível) e liga de novo → janela nova, sem espera', () => {
    // a última janela ainda "valeria" por 5 h, mas a pessoa desligou: religar abre 24 h de novo
    const d = decideAnonymous(
      { premium: false, visibilityMode: 'visible', anonymousUntil: at(5) },
      NOW,
    );
    expect(d).toEqual({ kind: 'new', until: at(24) });
  });

  it('invisível com janela vencida (tarefa ainda não passou) ou sem janela → janela nova', () => {
    expect(
      decideAnonymous({ premium: false, visibilityMode: 'anonymous', anonymousUntil: at(-1) }, NOW)
        .kind,
    ).toBe('new');
    expect(
      decideAnonymous({ premium: false, visibilityMode: 'anonymous', anonymousUntil: null }, NOW)
        .kind,
    ).toBe('new');
    expect(
      decideAnonymous({ premium: false, visibilityMode: 'anonymous', anonymousUntil: NOW }, NOW)
        .kind,
    ).toBe('new');
  });
});

describe('visibleAnonymousUntil (o prazo que o /me e o painel mostram)', () => {
  const base = {
    premiumTier: 'free',
    premiumExpiresAt: null,
    visibilityMode: 'anonymous',
    anonymousUntil: at(4),
  };

  it('invisível grátis com janela no futuro → o prazo', () => {
    expect(visibleAnonymousUntil(base, NOW)).toEqual(at(4));
  });

  it('visível, Premium vigente ou janela já passada → null', () => {
    expect(visibleAnonymousUntil({ ...base, visibilityMode: 'visible' }, NOW)).toBeNull();
    expect(visibleAnonymousUntil({ ...base, premiumTier: 'premium' }, NOW)).toBeNull();
    expect(visibleAnonymousUntil({ ...base, anonymousUntil: at(-1) }, NOW)).toBeNull();
    expect(visibleAnonymousUntil({ ...base, anonymousUntil: null }, NOW)).toBeNull();
  });

  it('Premium vencido conta como grátis (mostra o prazo gravado)', () => {
    expect(
      visibleAnonymousUntil({ ...base, premiumTier: 'premium', premiumExpiresAt: at(-1) }, NOW),
    ).toEqual(at(4));
  });
});

describe('anonymousWindowAction (/me, pelo tier GRAVADO)', () => {
  const base = {
    premiumTier: 'free',
    visibilityMode: 'anonymous',
    anonymousUntil: at(2) as Date | null,
  };

  it('janela valendo ou visível: nada', () => {
    expect(anonymousWindowAction(base, NOW)).toBe('none');
    expect(
      anonymousWindowAction({ ...base, visibilityMode: 'visible', anonymousUntil: at(-2) }, NOW),
    ).toBe('none');
  });

  it('janela vencida → volta ao visível; sem janela → abre as 24 h', () => {
    expect(anonymousWindowAction({ ...base, anonymousUntil: at(-1) }, NOW)).toBe('expire');
    expect(anonymousWindowAction({ ...base, anonymousUntil: NOW }, NOW)).toBe('expire');
    expect(anonymousWindowAction({ ...base, anonymousUntil: null }, NOW)).toBe('open');
  });

  it('tier gravado pago (mesmo vencido): espera o rebaixamento, que dá as 24 h — ninguém aparece de surpresa', () => {
    expect(
      anonymousWindowAction({ ...base, premiumTier: 'premium', anonymousUntil: at(-10) }, NOW),
    ).toBe('none');
    expect(
      anonymousWindowAction({ ...base, premiumTier: 'premium_plus', anonymousUntil: null }, NOW),
    ).toBe('none');
  });
});
