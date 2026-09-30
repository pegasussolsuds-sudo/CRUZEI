import { anonymousBannerText, anonymousUntilLabel } from './anonymousWindow';

// datas no fuso do aparelho (o teste monta com o construtor local, então vale em qualquer fuso)
const NOW = new Date(2026, 9, 3, 10, 5); // 03/10 10h05

describe('anonymousUntilLabel', () => {
  it('mesmo dia → só a hora', () => {
    expect(anonymousUntilLabel(new Date(2026, 9, 3, 14, 32).toISOString(), NOW)).toBe('14h32');
  });

  it('dia seguinte (a janela normal de 24 h) → "amanhã"', () => {
    expect(anonymousUntilLabel(new Date(2026, 9, 4, 10, 5).toISOString(), NOW)).toBe('amanhã, 10h05');
  });

  it('mais longe → data curta', () => {
    expect(anonymousUntilLabel(new Date(2026, 9, 15, 9, 0).toISOString(), NOW)).toBe('15/10, 09h00');
  });

  it('sem prazo, inválido ou já passado → null', () => {
    expect(anonymousUntilLabel(null, NOW)).toBeNull();
    expect(anonymousUntilLabel(undefined, NOW)).toBeNull();
    expect(anonymousUntilLabel('lixo', NOW)).toBeNull();
    expect(anonymousUntilLabel(new Date(2026, 9, 3, 9, 0).toISOString(), NOW)).toBeNull();
  });
});

describe('anonymousBannerText', () => {
  it('grátis mostra o prazo; Premium (sem prazo) mantém o texto de sempre', () => {
    expect(anonymousBannerText(new Date(2026, 9, 3, 14, 32).toISOString(), NOW)).toBe('Invisível até 14h32');
    expect(anonymousBannerText(null, NOW)).toBe('Você está oculto do mapa');
  });
});
