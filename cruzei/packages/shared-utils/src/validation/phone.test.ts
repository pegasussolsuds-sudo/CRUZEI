import { BR_DDDS, isMobilePhoneBR, phoneKindBR } from './phone';

// Login por SMS: só celular brasileiro com DDD que existe (fixo não recebe SMS; DDD inventado é número errado).

describe('BR_DDDS', () => {
  it('tem os 67 DDDs da Anatel, sem repetição', () => {
    expect(BR_DDDS).toHaveLength(67);
    expect(new Set(BR_DDDS).size).toBe(67);
    for (const ddd of [20, 23, 25, 26, 29, 30, 36, 39, 40, 50, 52, 56, 57, 58, 59, 60, 70, 72, 76, 78, 80, 90]) {
      expect(BR_DDDS).not.toContain(ddd);
    }
  });
});

describe('phoneKindBR / isMobilePhoneBR', () => {
  it('celular de DDD válido passa em qualquer formato', () => {
    for (const p of ['(34) 99999-1234', '34999991234', '+55 11 91234-5678', '5521987654321', '(99) 98888-7777']) {
      expect(phoneKindBR(p)).toBe('mobile');
      expect(isMobilePhoneBR(p)).toBe(true);
    }
  });

  it('fixo (10 dígitos começando com 2 a 5) é landline', () => {
    expect(phoneKindBR('(34) 3232-1234')).toBe('landline');
    expect(phoneKindBR('1145678901')).toBe('landline');
    expect(isMobilePhoneBR('(34) 3232-1234')).toBe(false);
  });

  it('DDD inexistente, celular sem o 9, número curto ou de fora é inválido', () => {
    expect(phoneKindBR('(20) 99999-1234')).toBe('invalid');
    expect(phoneKindBR('(23) 99999-1234')).toBe('invalid');
    expect(phoneKindBR('(30) 99999-1234')).toBe('invalid');
    // 11 dígitos sem o 9 na frente
    expect(phoneKindBR('(34) 89999-1234')).toBe('invalid');
    // celular antigo, sem o nono dígito
    expect(phoneKindBR('(34) 9999-1234')).toBe('invalid');
    expect(phoneKindBR('999991234')).toBe('invalid');
    expect(phoneKindBR('+1 415 555 2671')).toBe('invalid');
    expect(phoneKindBR('')).toBe('invalid');
    expect(isMobilePhoneBR('(20) 99999-1234')).toBe(false);
  });
});
