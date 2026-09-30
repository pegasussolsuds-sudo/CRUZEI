import { formatDate, parseDate, toIsoDate } from '../birthDate';

// Data de nascimento DD/MM/AAAA (cadastro e "Essa conta é sua?"): máscara, validação e o AAAA-MM-DD que vai pro servidor.

describe('birthDate', () => {
  it('formatDate põe as barras enquanto digita e corta em 8 dígitos', () => {
    expect(formatDate('2')).toBe('2');
    expect(formatDate('2107')).toBe('21/07');
    expect(formatDate('21071990')).toBe('21/07/1990');
    expect(formatDate('21/07/19901')).toBe('21/07/1990');
    expect(formatDate('ab21c07')).toBe('21/07');
  });

  it('parseDate aceita só data real e no passado', () => {
    expect(parseDate('21/07/1990')).toEqual(new Date(1990, 6, 21));
    expect(parseDate('31/02/1990')).toBeNull();
    expect(parseDate('21/7/1990')).toBeNull();
    expect(parseDate('01/01/2999')).toBeNull();
  });

  it('toIsoDate usa o dia local (sem o "dia anterior" do UTC)', () => {
    expect(toIsoDate(new Date(1990, 6, 21))).toBe('1990-07-21');
    expect(toIsoDate(new Date(2001, 0, 5, 23, 59))).toBe('2001-01-05');
  });
});
