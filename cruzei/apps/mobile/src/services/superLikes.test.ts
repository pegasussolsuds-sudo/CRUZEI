import type { SuperLikeQuota } from '@cruzei/shared-types';

import {
  quotaAfterSuperLike,
  quotaFromLimit,
  quotaRemaining,
  resetInText,
  superLikeLimitCopy,
  superLikeLimitOf,
} from './superLikes';

const NOW = Date.parse('2026-09-30T20:00:00Z'); // 17h em Brasília
const MIDNIGHT = '2026-10-01T03:00:00.000Z';
const free: SuperLikeQuota = { tier: 'free', limit: 1, used: 0, remaining: 1, resetsAt: MIDNIGHT };

describe('403 super_like_limit', () => {
  it('reconhece o corpo do servidor e ignora outros erros', () => {
    const err = {
      response: {
        status: 403,
        data: { error: 'super_like_limit', message: 'acabou', limit: 1, resetsAt: MIDNIGHT, canUpgrade: true },
      },
    };
    expect(superLikeLimitOf(err)).toEqual({
      error: 'super_like_limit',
      message: 'acabou',
      limit: 1,
      resetsAt: MIDNIGHT,
      canUpgrade: true,
    });
    expect(superLikeLimitOf({ response: { status: 403, data: { error: 'anonymous_requires_premium' } } })).toBeNull();
    expect(superLikeLimitOf({ response: { status: 400, data: { error: 'super_like_limit' } } })).toBeNull();
    expect(superLikeLimitOf(new Error('rede'))).toBeNull();
    expect(superLikeLimitOf(null)).toBeNull();
  });
});

describe('contador', () => {
  it('sem cota ainda: não sabe (null); passou da meia-noite: cheia até o servidor confirmar', () => {
    expect(quotaRemaining(null, NOW)).toBeNull();
    expect(quotaRemaining({ ...free, remaining: 0, used: 1 }, NOW)).toBe(0);
    expect(quotaRemaining({ ...free, remaining: 0, used: 1 }, Date.parse(MIDNIGHT) + 1)).toBe(1);
  });

  it('depois da super: usa o que o servidor devolveu; sem o número, pede de novo (null)', () => {
    const premium: SuperLikeQuota = { tier: 'premium', limit: 7, used: 2, remaining: 5, resetsAt: MIDNIGHT };
    expect(quotaAfterSuperLike(premium, { superLikesRemainingToday: 4 })).toEqual({ ...premium, used: 3, remaining: 4 });
    expect(quotaAfterSuperLike(premium, {})).toBeNull();
    expect(quotaAfterSuperLike(null, { superLikesRemainingToday: 4 })).toBeNull();
  });

  it('o 403 zera o contador', () => {
    expect(
      quotaFromLimit(free, { error: 'super_like_limit', message: '', limit: 1, resetsAt: MIDNIGHT, canUpgrade: true }),
    ).toEqual({ ...free, used: 1, remaining: 0 });
  });
});

describe('textos', () => {
  it('quanto falta pra voltar', () => {
    expect(resetInText(MIDNIGHT, NOW)).toBe('daqui a 7 h');
    expect(resetInText(MIDNIGHT, Date.parse(MIDNIGHT) - 20 * 60_000)).toBe('daqui a 20 min');
    expect(resetInText('', NOW)).toBe('');
  });

  it('grátis: convite pro Premium; Premium: só quando volta', () => {
    const f = superLikeLimitCopy({ canUpgrade: true, limit: 1, resetsAt: MIDNIGHT }, NOW);
    expect(f.title).toMatch(/super curtida de hoje já foi/);
    expect(f.body).toMatch(/Premium são 7 por dia/);
    expect(f.body).toMatch(/daqui a 7 h/);
    const p = superLikeLimitCopy({ canUpgrade: false, limit: 7, resetsAt: MIDNIGHT }, NOW);
    expect(p.body).toMatch(/7 super curtidas/);
    expect(p.body).not.toMatch(/Premium/);
  });
});
