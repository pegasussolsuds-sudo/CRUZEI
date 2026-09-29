import { actionPattern, auditTargetId } from './audit.service';

// Filtros da auditoria: a ação é buscada por trecho (as gravadas começam com 'moderation.'/'admin.') e o alvo aceita
// uuid ou número (lugar e sugestão têm id numérico).

describe('filtro por ação', () => {
  it('trecho em qualquer posição: "ban" acha "moderation.ban"', () => {
    expect(actionPattern('ban')).toBe('%ban%');
    expect(actionPattern('  event.publish ')).toBe('%event.publish%');
  });

  it('curinga do LIKE digitado vira texto (o valor ainda vai parametrizado)', () => {
    expect(actionPattern('100%')).toBe('%100\\%%');
    expect(actionPattern('a_b')).toBe('%a\\_b%');
    expect(actionPattern('c:\\x')).toBe('%c:\\\\x%');
  });
});

describe('filtro por alvo', () => {
  it('uuid (em minúsculas) ou número; o resto é recusado', () => {
    expect(auditTargetId('0A000000-0000-4000-8000-00000000000A')).toBe(
      '0a000000-0000-4000-8000-00000000000a',
    );
    expect(auditTargetId(' 12345 ')).toBe('12345');
    expect(auditTargetId('123456789012345678')).toBe('123456789012345678');
    expect(auditTargetId('1234567890123456789')).toBeNull();
    expect(auditTargetId('0a000000-0000')).toBeNull();
    expect(auditTargetId('1; drop table')).toBeNull();
    expect(auditTargetId('')).toBeNull();
    expect(auditTargetId(undefined)).toBeNull();
  });
});
