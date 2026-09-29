import { describe, expect, it } from 'vitest';
import {
  formatCompact,
  formatDate,
  formatDateTime,
  formatDay,
  formatDayOrDate,
  formatMinutes,
  formatNumber,
  formatPercent,
  formatPhoneInput,
  formatRelative,
  formatShortDateTime,
  initials,
  isNoExpiry,
  isValidPhoneBR,
  normalizePhoneBR,
  plural,
} from './format';

describe('números', () => {
  it('formata no padrão brasileiro e trata vazio', () => {
    expect(formatNumber(1234567)).toBe('1.234.567');
    expect(formatNumber(null)).toBe('—');
    expect(formatNumber(Number.NaN)).toBe('—');
  });

  it('compacta só a partir de 10 mil', () => {
    expect(formatCompact(9999)).toBe('9.999');
    expect(formatCompact(12_900)).toMatch(/^12,9\s?mil$/);
  });

  it('porcentagem com casas decimais', () => {
    expect(formatPercent(0.4567)).toBe('46%');
    expect(formatPercent(0.4567, 1)).toBe('45,7%');
    expect(formatPercent(null)).toBe('—');
  });

  it('plural', () => {
    expect(plural(1, 'pessoa', 'pessoas')).toBe('1 pessoa');
    expect(plural(1200, 'pessoa', 'pessoas')).toBe('1.200 pessoas');
  });
});

describe('datas (fuso de São Paulo)', () => {
  it('data e hora independem do fuso da máquina', () => {
    // 02:30 UTC = 23:30 do dia anterior em São Paulo
    expect(formatDateTime('2026-09-30T02:30:00Z')).toBe('29/09/2026 23:30');
    expect(formatDate('2026-09-30T02:30:00Z')).toBe('29 set 2026');
    expect(formatShortDateTime('2026-09-29T17:05:00Z')).toBe('29 set 14:05');
  });

  it('dia do servidor vira dd/mm sem passar por Date', () => {
    expect(formatDay('2026-09-01')).toBe('01/09');
    expect(formatDay('lixo')).toBe('lixo');
  });

  it('dia puro não volta um dia no fuso de São Paulo', () => {
    expect(formatDayOrDate('2026-09-29')).toBe('29/09/2026');
    expect(formatDayOrDate('2026-09-30T02:30:00Z')).toBe('29 set 2026');
    expect(formatDayOrDate(null)).toBe('—');
  });

  it('tempo relativo', () => {
    const now = Date.parse('2026-09-29T12:00:00Z');
    expect(formatRelative('2026-09-29T11:59:40Z', now)).toBe('agora');
    expect(formatRelative('2026-09-29T11:55:00Z', now)).toBe('há 5 min');
    expect(formatRelative('2026-09-29T09:00:00Z', now)).toBe('há 3 h');
    expect(formatRelative('2026-09-28T12:00:00Z', now)).toBe('ontem');
    expect(formatRelative('2026-09-25T12:00:00Z', now)).toBe('há 4 dias');
    expect(formatRelative('2026-09-29T14:00:00Z', now)).toBe('em 2 h');
    expect(formatRelative('2026-09-30T12:00:00Z', now)).toBe('amanhã');
    expect(formatRelative(null, now)).toBe('—');
  });

  it('minutos em texto curto', () => {
    expect(formatMinutes(12)).toBe('12 min');
    expect(formatMinutes(65)).toBe('1 h 5 min');
    expect(formatMinutes(120)).toBe('2 h');
    expect(formatMinutes(60 * 27)).toBe('1 d 3 h');
    expect(formatMinutes(null)).toBe('—');
  });
});

describe('telefone (mesmas regras do shared-utils)', () => {
  it('normaliza pra E.164', () => {
    expect(normalizePhoneBR('(34) 99999-1234')).toBe('+5534999991234');
    expect(normalizePhoneBR('+55 34 99999-1234')).toBe('+5534999991234');
    expect(normalizePhoneBR('123')).toBeNull();
  });

  it('valida DDD e tamanho', () => {
    expect(isValidPhoneBR('(34) 99999-1234')).toBe(true);
    expect(isValidPhoneBR('(34) 3333-1234')).toBe(true);
    expect(isValidPhoneBR('(05) 99999-1234')).toBe(false);
  });

  it('máscara enquanto digita', () => {
    expect(formatPhoneInput('3')).toBe('(3');
    expect(formatPhoneInput('3499')).toBe('(34) 99');
    expect(formatPhoneInput('3433331234')).toBe('(34) 3333-1234');
    expect(formatPhoneInput('34999991234')).toBe('(34) 99999-1234');
    expect(formatPhoneInput('5534999991234')).toBe('(34) 99999-1234');
  });
});

it('iniciais', () => {
  expect(initials('Ana Paula Souza')).toBe('AS');
  expect(initials('bia')).toBe('B');
  expect(initials('  ')).toBe('?');
});

it('Premium sem vencimento (2099)', () => {
  expect(isNoExpiry('2099-12-31T00:00:00.000Z')).toBe(true);
  expect(isNoExpiry('2026-12-31T00:00:00.000Z')).toBe(false);
  expect(isNoExpiry(null)).toBe(false);
});
