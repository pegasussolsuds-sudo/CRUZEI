import { discoveryPassDays, passCutoff } from './passes';

describe('prazo do "Passar" (DISCOVERY_PASS_DAYS)', () => {
  it('padrão 30; inteiro de 1 a 365 vale; o resto cai no padrão', () => {
    expect(discoveryPassDays({})).toBe(30);
    expect(discoveryPassDays({ DISCOVERY_PASS_DAYS: '' })).toBe(30);
    expect(discoveryPassDays({ DISCOVERY_PASS_DAYS: ' 14 ' })).toBe(14);
    expect(discoveryPassDays({ DISCOVERY_PASS_DAYS: '1' })).toBe(1);
    expect(discoveryPassDays({ DISCOVERY_PASS_DAYS: '365' })).toBe(365);
    expect(discoveryPassDays({ DISCOVERY_PASS_DAYS: '0' })).toBe(30);
    expect(discoveryPassDays({ DISCOVERY_PASS_DAYS: '-3' })).toBe(30);
    expect(discoveryPassDays({ DISCOVERY_PASS_DAYS: '2.5' })).toBe(30);
    expect(discoveryPassDays({ DISCOVERY_PASS_DAYS: '400' })).toBe(30);
    expect(discoveryPassDays({ DISCOVERY_PASS_DAYS: 'trinta' })).toBe(30);
  });

  it('corte = agora menos o prazo', () => {
    const now = new Date('2026-09-30T12:00:00Z');
    expect(passCutoff(now, 30).toISOString()).toBe('2026-08-31T12:00:00.000Z');
    expect(passCutoff(now, 1).toISOString()).toBe('2026-09-29T12:00:00.000Z');
  });
});
