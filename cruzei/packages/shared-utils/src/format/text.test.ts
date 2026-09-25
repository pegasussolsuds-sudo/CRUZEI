import { formatMapName, MAP_NAME_MAX, truncate } from './text';

describe('formatMapName (rótulo curto do mapa)', () => {
  it('primeiro nome + inicial do sobrenome', () => {
    expect(formatMapName('Leonardo Silva')).toBe('Leonardo S.');
    expect(formatMapName('Wellington Ribeiro')).toBe('Wellington R.');
  });

  it('nome único fica inteiro; vazio vira vazio', () => {
    expect(formatMapName('Bia')).toBe('Bia');
    expect(formatMapName('')).toBe('');
    expect(formatMapName(null)).toBe('');
    expect(formatMapName('   ')).toBe('');
  });

  it('pula partículas (da, de, dos…)', () => {
    expect(formatMapName('João da Silva')).toBe('João S.');
    expect(formatMapName('Ana de Oliveira')).toBe('Ana O.');
    expect(formatMapName('Lu dos Santos')).toBe('Lu S.');
  });

  it('nome composto longo cai pro primeiro nome quando não cabe', () => {
    expect(formatMapName('Maria Eduarda Albuquerque')).toBe('Maria E.');
    expect(formatMapName('Guilherme Henrique de Souza')).toBe('Guilherme H.');
    expect(formatMapName('Wolfeschlegelsteinhausen Berger')).toBe('Wolfeschlegel…');
    expect(Array.from(formatMapName('Wolfeschlegelsteinhausen Berger')).length).toBeLessThanOrEqual(MAP_NAME_MAX);
  });

  it('emoji e pontuação nunca viram inicial (nem surrogate solto)', () => {
    expect(formatMapName('Ana 🌸 Lima')).toBe('Ana L.');
    expect(formatMapName('Léo 🔥')).toBe('Léo');
    expect(formatMapName('João (Jota) Pereira')).toBe('João P.');
    for (const n of ['Ana 🌸Lima', 'Léo 🔥', 'Zé "Zezinho" Reis']) {
      const out = formatMapName(n);
      expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(out)).toBe(false);
    }
  });

  it('acentos contam como um caractere', () => {
    expect(formatMapName('Éverton Assunção')).toBe('Éverton A.');
  });
});

describe('truncate', () => {
  it('corta com reticências', () => {
    expect(truncate('abcdef', 4)).toBe('abc…');
    expect(truncate('abc', 4)).toBe('abc');
  });
});
