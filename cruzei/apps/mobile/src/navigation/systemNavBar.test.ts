import { BUTTON_NAV_MIN_INSET, navBarIconsLight, navBarNeedsBackdrop } from './systemNavBar';

describe('navBarIconsLight', () => {
  it('Android 12+: ícones claros em qualquer tema (a splash zera a aparência)', () => {
    expect(navBarIconsLight(31, 'light')).toBe(true);
    expect(navBarIconsLight(35, 'light')).toBe(true);
    expect(navBarIconsLight(36, 'dark')).toBe(true);
  });

  it('Android 8–11: segue o tema do sistema', () => {
    expect(navBarIconsLight(30, 'light')).toBe(false);
    expect(navBarIconsLight(26, 'light')).toBe(false);
    expect(navBarIconsLight(29, null)).toBe(false);
    expect(navBarIconsLight(29, 'dark')).toBe(true);
  });

  it('antes do Android 8: sempre claros', () => {
    expect(navBarIconsLight(24, 'light')).toBe(true);
    expect(navBarIconsLight(25, 'light')).toBe(true);
  });
});

describe('navBarNeedsBackdrop', () => {
  const moto = { os: 'android', apiLevel: 35, colorScheme: 'light', bottomInset: 48 };

  it('pinta na barra de 3 botões com ícones claros (Moto g54)', () => {
    expect(navBarNeedsBackdrop(moto)).toBe(true);
  });

  it('não pinta com navegação por gestos (inset baixo, sem véu)', () => {
    expect(navBarNeedsBackdrop({ ...moto, bottomInset: 24 })).toBe(false);
    expect(navBarNeedsBackdrop({ ...moto, bottomInset: 0 })).toBe(false);
    expect(navBarNeedsBackdrop({ ...moto, bottomInset: BUTTON_NAV_MIN_INSET })).toBe(true);
  });

  it('não pinta quando os ícones já são escuros (o véu é claro e some no fundo claro)', () => {
    expect(navBarNeedsBackdrop({ ...moto, apiLevel: 30 })).toBe(false);
  });

  it('nunca no iOS', () => {
    expect(navBarNeedsBackdrop({ ...moto, os: 'ios', apiLevel: 18, bottomInset: 34 })).toBe(false);
  });
});
