import { interestEmoji, toggleInterest } from './interests';

describe('interesses', () => {
  it('emoji pelo ícone do catálogo; desconhecido ou vazio cai no ✨', () => {
    expect(interestEmoji('music')).toBe('🎵');
    expect(interestEmoji('coffee')).toBe('☕');
    expect(interestEmoji('skate')).toBe('✨');
    expect(interestEmoji(null)).toBe('✨');
  });

  it('marca, desmarca e não passa do teto (avisa que encheu)', () => {
    expect(toggleInterest([], 'Música')).toEqual({ list: ['Música'], full: false });
    expect(toggleInterest(['Música', 'Praia'], 'Música')).toEqual({ list: ['Praia'], full: false });
    const cheia = ['a', 'b', 'c'];
    expect(toggleInterest(cheia, 'd', 3)).toEqual({ list: cheia, full: true });
    // cheia ainda deixa desmarcar
    expect(toggleInterest(cheia, 'b', 3)).toEqual({ list: ['a', 'c'], full: false });
  });

  it('teto padrão é o do perfil (10)', () => {
    const dez = Array.from({ length: 10 }, (_, i) => `i${i}`);
    expect(toggleInterest(dez, 'novo').full).toBe(true);
  });
});
