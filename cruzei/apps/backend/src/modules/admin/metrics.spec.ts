import { ONBOARDING_STEPS } from '@cruzei/shared-types';

import {
  addDays,
  clampInt,
  cohortReady,
  dropOffPct,
  funnelSteps,
  pct,
  retentionCell,
} from './metrics';
import { can } from './permissions';

describe('métricas do painel', () => {
  it('parâmetros da query: faixa, padrão e lixo', () => {
    expect(clampInt(undefined, 1, 90, 30)).toBe(30);
    expect(clampInt('', 1, 90, 30)).toBe(30);
    expect(clampInt('abc', 1, 90, 30)).toBe(30);
    expect(clampInt('7', 1, 90, 30)).toBe(7);
    expect(clampInt('500', 1, 90, 30)).toBe(90);
    expect(clampInt('-3', 1, 90, 30)).toBe(1);
    expect(clampInt('12.9', 1, 52, 12)).toBe(12);
  });

  it('porcentagens com uma casa', () => {
    expect(pct(1, 3)).toBe(33.3);
    expect(pct(0, 0)).toBe(0);
    expect(dropOffPct(0, 0)).toBeNull();
    expect(dropOffPct(10, 7)).toBe(30);
    // "concluiu" a mais que "viu" (evento de ver perdido) não vira queda negativa
    expect(dropOffPct(5, 6)).toBe(0);
  });

  it('funil: todas as etapas na ordem, com zero nas que não tiveram evento', () => {
    const steps = funnelSteps([
      { step: 'phone', viewed: 8, done: 6 },
      { step: 'welcome', viewed: 10, done: 8 },
      { step: 'etapa_velha', viewed: 3, done: 3 },
    ]);
    expect(steps.map((s) => s.step)).toEqual([...ONBOARDING_STEPS]);
    expect(steps[0]).toEqual({ step: 'welcome', viewed: 10, done: 8, dropOffPct: 20 });
    expect(steps[1]).toEqual({ step: 'phone', viewed: 8, done: 6, dropOffPct: 25 });
    expect(steps[2]).toEqual({ step: 'code', viewed: 0, done: 0, dropOffPct: null });
  });

  it('retenção: o dia N só conta quando passou pro grupo inteiro (segunda + 6 + N < hoje)', () => {
    expect(addDays('2026-09-28', 6)).toBe('2026-10-04');
    expect(addDays('2026-02-27', 2)).toBe('2026-03-01');
    // semana de 21/09 (seg) a 27/09 (dom): D1 do domingo é 28/09
    expect(cohortReady('2026-09-21', 1, '2026-09-28')).toBe(false);
    expect(cohortReady('2026-09-21', 1, '2026-09-29')).toBe(true);
    expect(cohortReady('2026-09-21', 7, '2026-09-30')).toBe(false);
    expect(cohortReady('2026-08-10', 30, '2026-09-30')).toBe(true);
    expect(retentionCell(4, 1, true)).toEqual({ returned: 1, pct: 25 });
    expect(retentionCell(0, 0, true)).toEqual({ returned: 0, pct: 0 });
    expect(retentionCell(4, 1, false)).toBeNull();
  });

  it('Métricas é só de admin', () => {
    expect(can('admin', 'metrics')).toBe(true);
    expect(can('moderator', 'metrics')).toBe(false);
    expect(can('user', 'metrics')).toBe(false);
  });
});
