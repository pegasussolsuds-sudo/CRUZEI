import {
  cardLastSeen,
  orientationFlagsBlocked,
  orientationPatch,
  parseInstagramInput,
  publicOrientation,
} from './profile-prefs';

// Regras puras dos campos do perfil (o filtro "Mostrar" e a ordem por orientação têm spec próprio em
// location/discovery-order.spec.ts).

const NOW = new Date('2026-10-03T12:00:00Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

describe('orientação no cartão público', () => {
  it('só aparece quando a pessoa exibe', () => {
    expect(publicOrientation({ orientation: 'gay', showOrientation: true })).toBe('gay');
    expect(publicOrientation({ orientation: 'gay', showOrientation: false })).toBeNull();
    expect(publicOrientation({ orientation: null, showOrientation: true })).toBeNull();
  });
});

describe('PATCH /me orientation', () => {
  it('undefined não mexe; mesmo valor não recarimba', () => {
    expect(orientationPatch('gay', undefined, NOW)).toEqual({});
    expect(orientationPatch('gay', 'gay', NOW)).toEqual({});
  });

  it('valor novo grava e carimba o consentimento', () => {
    expect(orientationPatch(null, 'queer', NOW)).toEqual({
      orientation: 'queer',
      orientationConsentedAt: NOW,
    });
    expect(orientationPatch('queer', 'pansexual', NOW)).toEqual({
      orientation: 'pansexual',
      orientationConsentedAt: NOW,
    });
  });

  it('null apaga tudo: orientação, exibir, ordem e o carimbo (revogação)', () => {
    expect(orientationPatch('queer', null, NOW)).toEqual({
      orientation: null,
      showOrientation: false,
      sameOrientationFirst: false,
      orientationConsentedAt: null,
    });
    expect(orientationPatch(null, null, NOW)).toEqual({});
  });

  it('ligar exibir/ordem sem orientação é bloqueado (400 orientation_required); desligar sempre pode', () => {
    expect(orientationFlagsBlocked({ showOrientation: true }, null)).toBe(true);
    expect(orientationFlagsBlocked({ sameOrientationFirst: true }, null)).toBe(true);
    expect(
      orientationFlagsBlocked({ showOrientation: false, sameOrientationFirst: false }, null),
    ).toBe(false);
    expect(
      orientationFlagsBlocked({ showOrientation: true, sameOrientationFirst: true }, 'asexual'),
    ).toBe(false);
    expect(orientationFlagsBlocked({}, null)).toBe(false);
  });
});

describe('Instagram', () => {
  it('undefined não mexe; vazio ou null apaga', () => {
    expect(parseInstagramInput(undefined)).toBeUndefined();
    expect(parseInstagramInput(null)).toEqual({ ok: true, handle: null });
    expect(parseInstagramInput('   ')).toEqual({ ok: true, handle: null });
    expect(parseInstagramInput('@')).toEqual({ ok: true, handle: null });
  });

  it('normaliza @, link colado e maiúsculas', () => {
    expect(parseInstagramInput('@Fulana.Silva')).toEqual({ ok: true, handle: 'fulana.silva' });
    expect(parseInstagramInput('https://www.instagram.com/fulana_99/?hl=pt-br')).toEqual({
      ok: true,
      handle: 'fulana_99',
    });
  });

  it('fora da regra do Instagram: recusa', () => {
    for (const bad of [
      '.fulana',
      'fulana.',
      'ful..ana',
      'joão',
      'com espaço',
      'a'.repeat(31),
      'fulana!',
    ]) {
      expect(parseInstagramInput(bad)).toEqual({ ok: false });
    }
  });
});

describe('última atividade no cartão (sem horário exato)', () => {
  const t = NOW.getTime();

  it('com direito: só faixa online (< 15 min) / recent (< 60 min); mais antigo = nada', () => {
    expect(cardLastSeen(minutesAgo(2), true, t)).toBe('online');
    expect(cardLastSeen(minutesAgo(30), true, t)).toBe('recent');
    expect(cardLastSeen(minutesAgo(61), true, t)).toBeNull();
    expect(cardLastSeen(null, true, t)).toBeNull();
  });

  it('sem direito (estranho): nada, nem online', () => {
    expect(cardLastSeen(minutesAgo(1), false, t)).toBeNull();
  });
});
