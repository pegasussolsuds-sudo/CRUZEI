import { profileFieldErrorOf, textBlockedOf } from './fieldError';

const http = (status: number, data?: unknown) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });

describe('textBlockedOf', () => {
  it('lê o 400 text_blocked do filtro de abuso com campo, motivo e a mensagem do servidor', () => {
    expect(
      textBlockedOf(http(400, { error: 'text_blocked', field: 'bio', reason: 'hate', message: 'Tira a ofensa da bio' })),
    ).toEqual({ error: 'text_blocked', field: 'bio', reason: 'hate', message: 'Tira a ofensa da bio' });
  });

  it('sem mensagem: texto padrão amigável', () => {
    expect(textBlockedOf(http(400, { error: 'text_blocked', field: 'name', reason: 'profanity' }))?.message).toMatch(/regras do Metch/);
  });

  it('outros erros, outro status, campo desconhecido ou sem resposta: null', () => {
    expect(textBlockedOf(http(400, { error: 'instagram_invalid' }))).toBeNull();
    expect(textBlockedOf(http(403, { error: 'text_blocked', field: 'bio' }))).toBeNull();
    expect(textBlockedOf(http(400, { error: 'text_blocked', field: 'foto' }))).toBeNull();
    expect(textBlockedOf(new Error('Network Error'))).toBeNull();
    expect(textBlockedOf(null)).toBeNull();
  });
});

describe('profileFieldErrorOf', () => {
  it('filtro de abuso em nome, bio ou @ aponta o campo', () => {
    for (const field of ['name', 'bio', 'instagram'] as const) {
      expect(profileFieldErrorOf(http(400, { error: 'text_blocked', field, reason: 'scam', message: 'ajusta' }))).toEqual({
        field,
        message: 'ajusta',
        code: 'text_blocked',
      });
    }
  });

  it('mensagem de chat não é campo do perfil', () => {
    expect(profileFieldErrorOf(http(400, { error: 'text_blocked', field: 'message', reason: 'hate', message: 'x' }))).toBeNull();
  });

  it('@ fora da regra e nome curto viram erro do campo (com texto padrão se vier sem)', () => {
    expect(profileFieldErrorOf(http(400, { error: 'instagram_invalid', message: 'Esse @ não rola' }))).toEqual({
      field: 'instagram',
      message: 'Esse @ não rola',
      code: 'instagram_invalid',
    });
    expect(profileFieldErrorOf(http(400, { error: 'name_invalid' }))?.message).toMatch(/2 letras/);
  });

  it('erro que não é de campo: null', () => {
    expect(profileFieldErrorOf(http(400, { error: 'underage' }))).toBeNull();
    expect(profileFieldErrorOf(http(500, { error: 'text_blocked', field: 'bio' }))).toBeNull();
    expect(profileFieldErrorOf(http(400, 'texto cru'))).toBeNull();
  });
});
