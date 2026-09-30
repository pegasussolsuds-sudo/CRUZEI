import {
  ageRangeLimitBody,
  ageRangeUpdate,
  cardLastSeen,
  cleanBio,
  cleanInterestNames,
  cleanName,
  nextAgeRange,
  orientationFlagsBlocked,
  orientationPatch,
  parseInstagramInput,
  profileCompleteness,
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

describe('nome, bio e interesses', () => {
  it('nome: tira espaços das pontas e repetidos; menos de 2 ou mais de 50 letras = inválido', () => {
    expect(cleanName('  Ana   Paula ')).toBe('Ana Paula');
    expect(cleanName('Jo')).toBe('Jo');
    expect(cleanName('  A  ')).toBeNull();
    expect(cleanName('   ')).toBeNull();
    expect(cleanName(null)).toBeNull();
    expect(cleanName('a'.repeat(50))).toHaveLength(50);
    expect(cleanName('a'.repeat(51))).toBeNull();
  });

  it('bio: undefined não mexe; vazio/só espaço apaga; o resto sem as pontas (até 500)', () => {
    expect(cleanBio(undefined)).toBeUndefined();
    expect(cleanBio(null)).toBeNull();
    expect(cleanBio('   \n ')).toBeNull();
    expect(cleanBio('  curto café e praia \n')).toBe('curto café e praia');
    expect(cleanBio('x'.repeat(600))).toHaveLength(500);
  });

  it('interesses: sem vazio, sem repetido, no máximo 10, na ordem que veio', () => {
    expect(cleanInterestNames(undefined)).toEqual([]);
    expect(cleanInterestNames([' Música ', 'Música', '', '  ', 'Praia'])).toEqual([
      'Música',
      'Praia',
    ]);
    const many = Array.from({ length: 14 }, (_, i) => `i${i}`);
    expect(cleanInterestNames(many)).toEqual(many.slice(0, 10));
    expect(cleanInterestNames([1 as unknown as string, 'Café'])).toEqual(['Café']);
  });

  it('completude: nome + intenção = 15; bio e 3+ interesses somam no cadastro', () => {
    expect(
      profileCompleteness({ name: 'Ana', photos: 0, interests: 0, lookingFor: 'casual' }),
    ).toBe(15);
    expect(
      profileCompleteness({ name: 'Ana', photos: 0, interests: 0, lookingFor: 'unspecified' }),
    ).toBe(10);
    expect(
      profileCompleteness({
        name: 'Ana',
        bio: 'oi',
        photos: 0,
        interests: 3,
        lookingFor: 'casual',
      }),
    ).toBe(45);
    expect(
      profileCompleteness({
        name: 'Ana',
        bio: 'oi',
        photos: 6,
        interests: 10,
        lookingFor: 'casual',
        isVerified: true,
      }),
    ).toBe(100);
  });
});

describe('faixa de idade do "quem ver"', () => {
  it('nada mandado: não mexe', () => {
    expect(ageRangeUpdate(undefined, undefined)).toBeNull();
  });

  it('as duas pontas: vale 18 <= de, de + 4 <= até <= 99 (inteiros)', () => {
    expect(ageRangeUpdate(25, 35)).toEqual({
      ok: true,
      data: { ageMin: 25, ageMax: 35 },
      guard: null,
    });
    expect(ageRangeUpdate(18, 99)).toMatchObject({ ok: true });
    expect(ageRangeUpdate(30, 34)).toMatchObject({ ok: true });
    for (const [a, b] of [
      [17, 30],
      [30, 25],
      [18, 100],
      [20.5, 30],
      [NaN, 30],
      // vão menor que 4 anos
      [30, 30],
      [30, 33],
    ]) {
      expect(ageRangeUpdate(a, b)).toEqual({ ok: false });
    }
  });

  it('só uma ponta: confere o limite dela e trava contra a outra no banco, com o vão de 4 anos', () => {
    expect(ageRangeUpdate(40, undefined)).toEqual({
      ok: true,
      data: { ageMin: 40 },
      guard: { ageMax: { gte: 44 } },
    });
    expect(ageRangeUpdate(undefined, 50)).toEqual({
      ok: true,
      data: { ageMax: 50 },
      guard: { ageMin: { lte: 46 } },
    });
    expect(ageRangeUpdate(95, undefined)).toMatchObject({ ok: true });
    expect(ageRangeUpdate(96, undefined)).toEqual({ ok: false });
    expect(ageRangeUpdate(undefined, 22)).toMatchObject({ ok: true });
    expect(ageRangeUpdate(undefined, 21)).toEqual({ ok: false });
    expect(ageRangeUpdate(17, undefined)).toEqual({ ok: false });
    expect(ageRangeUpdate(100, undefined)).toEqual({ ok: false });
    expect(ageRangeUpdate(undefined, 17)).toEqual({ ok: false });
    expect(ageRangeUpdate(undefined, 120)).toEqual({ ok: false });
  });

  it('faixa final (a ponta que falta vem do banco) e se muda algo', () => {
    const cur = { ageMin: 25, ageMax: 35 };
    expect(nextAgeRange(cur, { ageMin: 25, ageMax: 35 })).toEqual({
      ageMin: 25,
      ageMax: 35,
      changed: false,
    });
    expect(nextAgeRange(cur, { ageMax: 35 })).toMatchObject({ changed: false });
    expect(nextAgeRange(cur, { ageMin: 28 })).toEqual({ ageMin: 28, ageMax: 35, changed: true });
    // encosta no "até" gravado: fora da regra (não gasta mudança do dia)
    expect(nextAgeRange(cur, { ageMin: 32 })).toBeNull();
    expect(nextAgeRange(cur, { ageMax: 28 })).toBeNull();
    // faixa antiga estreita (antes do vão): abrir vale
    expect(nextAgeRange({ ageMin: 25, ageMax: 26 }, { ageMin: 20 })).toMatchObject({
      changed: true,
    });
  });

  it('429 amigável com o limite e quando volta', () => {
    const at = new Date('2026-10-04T03:00:00.000Z');
    expect(ageRangeLimitBody(at)).toEqual({
      error: 'age_range_limit',
      message: 'Dá pra mudar a faixa de idade 5 vezes por dia. Amanhã libera de novo 😉',
      limit: 5,
      resetsAt: '2026-10-04T03:00:00.000Z',
    });
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
