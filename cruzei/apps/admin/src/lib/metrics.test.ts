import { describe, expect, it } from 'vitest';
import type { AdminFunnelStep, OnboardingStep } from '@cruzei/shared-types';
import { biggestDrop, continueRatio, formatPct, heatLevel, ratio, stepShare, weekRange } from './metrics';
import { NAV_ITEMS, visibleNav } from './permissions';

const s = (step: OnboardingStep, viewed: number, done: number): AdminFunnelStep => ({
  step,
  viewed,
  done,
  dropOffPct: viewed > 0 ? Math.round((Math.max(0, viewed - done) / viewed) * 1000) / 10 : null,
});

describe('métricas do painel', () => {
  it('maior queda: com amostra mínima, empate fica com a primeira, ninguém desistiu = null', () => {
    const steps = [s('welcome', 100, 80), s('phone', 80, 50), s('code', 50, 45), s('name', 4, 1)];
    // 'name' tem 75% de queda mas só 4 pessoas: vence 'phone' (37,5%)
    expect(biggestDrop(steps)?.step).toBe('phone');
    // sem nenhuma etapa com amostra, olha todas
    expect(biggestDrop([s('welcome', 3, 2), s('phone', 2, 0)])?.step).toBe('phone');
    expect(biggestDrop([s('welcome', 20, 10), s('phone', 10, 5)])?.step).toBe('welcome');
    expect(biggestDrop([s('welcome', 5, 5), s('phone', 0, 0)])).toBeNull();
    expect(biggestDrop([])).toBeNull();
  });

  it('barra relativa à etapa mais vista e % que segue', () => {
    const steps = [s('welcome', 200, 150), s('phone', 150, 100)];
    expect(stepShare(150, steps)).toBe(0.75);
    expect(stepShare(0, [])).toBe(0);
    expect(continueRatio({ viewed: 4, done: 3 })).toBe(0.75);
    expect(continueRatio({ viewed: 0, done: 0 })).toBeNull();
    expect(continueRatio({ viewed: 2, done: 3 })).toBe(1);
    expect(ratio(1, 4)).toBe(0.25);
    expect(ratio(1, 0)).toBeNull();
  });

  it('tom da retenção em faixas; semana e porcentagem em pt-BR', () => {
    expect([null, 0, 5, 10, 15, 30, 50, 80].map(heatLevel)).toEqual([0, 0, 1, 1, 2, 3, 4, 5]);
    expect(weekRange('2026-09-28')).toBe('28/09 – 04/10');
    expect(formatPct(33.3)).toBe('33,3%');
    expect(formatPct(50)).toBe('50%');
    expect(formatPct(null)).toBe('—');
  });

  it('Métricas no menu só pra quem tem a permissão (admin)', () => {
    expect(NAV_ITEMS.find((i) => i.key === 'metrics')).toMatchObject({ path: '/metricas', permission: 'metrics' });
    expect(visibleNav(['dashboard', 'users.read', 'support']).some((i) => i.key === 'metrics')).toBe(false);
    expect(visibleNav(['dashboard', 'metrics']).map((i) => i.key)).toEqual(['dashboard', 'metrics']);
  });
});
