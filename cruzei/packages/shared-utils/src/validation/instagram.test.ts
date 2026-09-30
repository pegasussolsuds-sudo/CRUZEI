import { INSTAGRAM_HANDLE_RE, instagramUrl, isValidInstagramHandle, normalizeInstagramHandle } from './instagram';

describe('normalizeInstagramHandle', () => {
  it('tira @, espaços e maiúsculas', () => {
    expect(normalizeInstagramHandle('@Ana.Paula')).toBe('ana.paula');
    expect(normalizeInstagramHandle('  @@ana_paula  ')).toBe('ana_paula');
    expect(normalizeInstagramHandle('FULANO')).toBe('fulano');
  });

  it('aceita link colado do perfil (com www, m., barra final, ?query e #)', () => {
    expect(normalizeInstagramHandle('https://www.instagram.com/ana.paula/?hl=pt-br')).toBe('ana.paula');
    expect(normalizeInstagramHandle('http://instagram.com/Ana_1')).toBe('ana_1');
    expect(normalizeInstagramHandle('instagram.com/ana#top')).toBe('ana');
    expect(normalizeInstagramHandle('https://m.instagram.com/ana/reels/')).toBe('ana');
    expect(normalizeInstagramHandle('https://instagr.am/ana')).toBe('ana');
  });

  it('vazio vira null (apagar o @)', () => {
    expect(normalizeInstagramHandle('')).toBeNull();
    expect(normalizeInstagramHandle('   ')).toBeNull();
    expect(normalizeInstagramHandle('@')).toBeNull();
    expect(normalizeInstagramHandle(null)).toBeNull();
    expect(normalizeInstagramHandle(undefined)).toBeNull();
  });

  it('não valida: o que sobra pode ser inválido', () => {
    expect(normalizeInstagramHandle('ana paula')).toBe('ana paula');
    expect(isValidInstagramHandle(normalizeInstagramHandle('ana paula'))).toBe(false);
  });
});

describe('isValidInstagramHandle', () => {
  it('aceita letras, números, ponto e _ (1 a 30)', () => {
    for (const h of ['a', 'ana', 'ana.paula', 'ana_paula', 'ana.paula_1', '_ana_', '1234', 'a'.repeat(30)]) {
      expect(isValidInstagramHandle(h)).toBe(true);
    }
  });

  it('recusa ponto no início/fim, "..", mais de 30, acento, espaço, maiúscula e outros símbolos', () => {
    for (const h of ['.ana', 'ana.', 'a..b', 'a'.repeat(31), 'joão', 'ana paula', 'Ana', 'ana-paula', 'ana@x', '', '@ana']) {
      expect(isValidInstagramHandle(h)).toBe(false);
    }
    expect(isValidInstagramHandle(null)).toBe(false);
    expect(isValidInstagramHandle(undefined)).toBe(false);
  });

  it('a regex exportada é a mesma regra', () => {
    expect(INSTAGRAM_HANDLE_RE.test('ana.paula')).toBe(true);
    expect(INSTAGRAM_HANDLE_RE.test('ana..paula')).toBe(false);
  });
});

describe('instagramUrl', () => {
  it('monta o link do perfil', () => {
    expect(instagramUrl('ana.paula')).toBe('https://instagram.com/ana.paula');
  });
});
