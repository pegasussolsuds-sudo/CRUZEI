import type { ProximityBand } from '@cruzei/shared-types';
import { AGE_MAX, AGE_MIN, DISCOVERY_PASS_DAYS_DEFAULT } from '@cruzei/shared-types';

import {
  DECK,
  ageFilter,
  ageOn,
  compareDiscovery,
  deckPassDays,
  discoveryKey,
  fnv1a32,
  mergeDeck,
  rotationSeed,
  rotationWindow,
  sameOrientationHit,
  showMeAllows,
  showMeMutual,
  superLikerShown,
} from './discovery-order';
import { selectTop } from './hot-path';

const SALT = 'teste-salt';
const WINDOW = 10 * 60_000;
const T0 = Date.UTC(2026, 9, 3, 20, 0, 0);

describe('showMeAllows / showMeMutual ("Mostrar" recíproco)', () => {
  it('um lado: Mulheres só female, Homens só male, Todos (ou nulo) todo mundo', () => {
    const genders = ['female', 'male', 'other'];
    expect(genders.filter((g) => showMeAllows('women', g))).toEqual(['female']);
    expect(genders.filter((g) => showMeAllows('men', g))).toEqual(['male']);
    expect(genders.filter((g) => showMeAllows('everyone', g))).toEqual(genders);
    // coluna nova ainda sem valor (ou valor desconhecido): nunca esvazia a descoberta
    expect(genders.filter((g) => showMeAllows(null, g))).toEqual(genders);
    expect(genders.filter((g) => showMeAllows('qualquer', g))).toEqual(genders);
  });

  it('matriz recíproca: os dois precisam querer ver o gênero do outro', () => {
    const man = (showMe: string) => ({ gender: 'male', showMe });
    const woman = (showMe: string) => ({ gender: 'female', showMe });
    const outro = (showMe: string) => ({ gender: 'other', showMe });

    expect(showMeMutual(man('women'), woman('men'))).toBe(true);
    expect(showMeMutual(man('women'), woman('everyone'))).toBe(true);
    // ela só quer ver mulheres: ele some pra ela E ela some pra ele
    expect(showMeMutual(man('women'), woman('women'))).toBe(false);
    expect(showMeMutual(woman('women'), man('women'))).toBe(false);
    expect(showMeMutual(woman('women'), woman('women'))).toBe(true);
    expect(showMeMutual(man('men'), man('everyone'))).toBe(true);

    // "Outro" só aparece pra quem escolheu Todos — e vê conforme a própria escolha
    expect(showMeMutual(man('everyone'), outro('everyone'))).toBe(true);
    expect(showMeMutual(man('women'), outro('everyone'))).toBe(false);
    expect(showMeMutual(outro('women'), woman('everyone'))).toBe(true);
    expect(showMeMutual(outro('women'), woman('women'))).toBe(false);
    expect(showMeMutual(outro('men'), woman('everyone'))).toBe(false);
    expect(showMeMutual(outro('everyone'), outro('everyone'))).toBe(true);
  });

  it('é simétrico (quem não vê também não é visto)', () => {
    const people = ['female', 'male', 'other'].flatMap((gender) =>
      ['women', 'men', 'everyone'].map((showMe) => ({ gender, showMe })),
    );
    for (const a of people)
      for (const b of people) expect(showMeMutual(a, b)).toBe(showMeMutual(b, a));
  });
});

describe('sameOrientationHit (mesma orientação primeiro)', () => {
  const me = { sameOrientationFirst: true, orientation: 'lesbian' };

  it('sobe só quem EXIBE a orientação e tem o mesmo valor', () => {
    expect(sameOrientationHit(me, { showOrientation: true, orientation: 'lesbian' })).toBe(true);
    // escondida: nunca sobe (a posição no deck vazaria a orientação)
    expect(sameOrientationHit(me, { showOrientation: false, orientation: 'lesbian' })).toBe(false);
    // valor idêntico: gay ≠ lésbica
    expect(sameOrientationHit(me, { showOrientation: true, orientation: 'gay' })).toBe(false);
    expect(sameOrientationHit(me, { showOrientation: true, orientation: null })).toBe(false);
  });

  it('desligado ou sem a própria orientação: ninguém sobe', () => {
    expect(
      sameOrientationHit(
        { sameOrientationFirst: false, orientation: 'lesbian' },
        { showOrientation: true, orientation: 'lesbian' },
      ),
    ).toBe(false);
    expect(
      sameOrientationHit(
        { sameOrientationFirst: true, orientation: null },
        { showOrientation: true, orientation: null },
      ),
    ).toBe(false);
  });
});

describe('compareDiscovery (boost → mesma orientação → faixa → rotação → id)', () => {
  const key = (
    id: string,
    o: { boosted?: boolean; same?: boolean; band?: ProximityBand | null; seed?: number } = {},
  ) =>
    discoveryKey({
      id,
      boosted: !!o.boosted,
      sameOrientation: !!o.same,
      band: o.band === undefined ? 'very_near' : o.band,
      seed: o.seed ?? 1,
    });

  it('boost sempre na frente, mesmo de longe (faixa boost)', () => {
    const list = [
      key('perto', { band: 'very_near' }),
      key('longe-boost', { boosted: true, band: 'boost' }),
      key('mesma', { same: true }),
    ];
    expect(list.sort(compareDiscovery).map((k) => k.id)).toEqual(['longe-boost', 'mesma', 'perto']);
  });

  it('mesma orientação antes da faixa; dentro do mesmo grupo, faixa mais perto primeiro', () => {
    const list = [
      key('a', { band: 'region', same: true }),
      key('b', { band: 'very_near' }),
      key('c', { band: 'near', same: true }),
    ];
    expect(list.sort(compareDiscovery).map((k) => k.id)).toEqual(['c', 'a', 'b']);
  });

  it('faixa desconhecida vai pro fim; empate total resolve pelo id (ordem nunca depende da chegada)', () => {
    const a = { b: 1 as const, o: 1 as const, r: 0, h: 5, id: 'b' };
    const b = { ...a, id: 'a' };
    expect([a, b].sort(compareDiscovery).map((k) => k.id)).toEqual(['a', 'b']);
    expect(key('x', { band: null }).r).toBeGreaterThan(key('y', { band: 'boost' }).r);
  });
});

describe('rotação justa em lugar lotado', () => {
  const ids = Array.from(
    { length: 1000 },
    (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  );
  const pick = (viewer: string, now: number, k = 300) => {
    const seed = rotationSeed(SALT, viewer, now, WINDOW);
    const keyed = ids.map((id) =>
      discoveryKey({ id, boosted: false, sameOrientation: false, band: 'very_near', seed }),
    );
    return selectTop(keyed, k, compareDiscovery).top.map((x) => x.id);
  };

  it('mesma pessoa na mesma janela: mesma ordem (não pisca entre as buscas de 45 s)', () => {
    const w0 = rotationWindow(SALT, 'viewer-a', T0, WINDOW);
    // um instante da mesma janela, 1 min depois (se a fase cair na virada, pega 1 min antes)
    const t1 =
      rotationWindow(SALT, 'viewer-a', T0 + 60_000, WINDOW) === w0 ? T0 + 60_000 : T0 - 60_000;
    expect(pick('viewer-a', T0)).toEqual(pick('viewer-a', t1));
  });

  it('pessoa diferente ou janela seguinte: recorte diferente', () => {
    const a = pick('viewer-a', T0);
    const b = pick('viewer-b', T0);
    const next = pick('viewer-a', T0 + WINDOW);
    const overlap = (x: string[], y: string[]) => x.filter((id) => new Set(y).has(id)).length;
    // ~30% de 300 em comum por acaso; muito longe de igual
    expect(overlap(a, b)).toBeLessThan(150);
    expect(overlap(a, next)).toBeLessThan(150);
  });

  it('fase por pessoa: nem todo mundo troca de recorte no mesmo segundo', () => {
    const viewers = Array.from({ length: 50 }, (_, i) => `viewer-${i}`);
    const switched = viewers.filter(
      (v) => rotationWindow(SALT, v, T0, WINDOW) !== rotationWindow(SALT, v, T0 + 60_000, WINDOW),
    );
    // em 1 min de 10, uns ~10% trocam — nunca todos
    expect(switched.length).toBeLessThan(viewers.length / 2);
  });

  it('justiça: 1000 no lugar, teto de 300, 40 janelas → todo mundo aparece, e sem ninguém fixo', () => {
    const seen = new Map<string, number>();
    for (let w = 0; w < 40; w++)
      for (const id of pick('viewer-a', T0 + w * WINDOW)) seen.set(id, (seen.get(id) ?? 0) + 1);
    expect(seen.size).toBe(ids.length);
    // esperado 12 de 40 (30%); ninguém sempre dentro
    expect(Math.max(...seen.values())).toBeLessThan(30);
  });

  it('boost e mesma orientação sempre entram no recorte, qualquer que seja a janela', () => {
    for (let w = 0; w < 10; w++) {
      const seed = rotationSeed(SALT, 'viewer-a', T0 + w * WINDOW, WINDOW);
      const keyed = ids.map((id, i) =>
        discoveryKey({
          id,
          boosted: i === 999,
          sameOrientation: i === 998,
          band: i === 999 ? 'boost' : 'very_near',
          seed,
        }),
      );
      const top = selectTop(keyed, 300, compareDiscovery).top.map((x) => x.id);
      expect(top[0]).toBe(ids[999]);
      expect(top[1]).toBe(ids[998]);
    }
  });

  it('o sal muda a ordem (sem o LOCATION_SALT não dá pra prever o recorte de ninguém)', () => {
    expect(rotationSeed('outro-sal', 'viewer-a', T0, WINDOW)).not.toBe(
      rotationSeed(SALT, 'viewer-a', T0, WINDOW),
    );
  });

  it('fnv1a32: estável, 32 bits sem sinal e sensível à semente', () => {
    expect(fnv1a32('abc')).toBe(fnv1a32('abc'));
    expect(fnv1a32('abc', 1)).not.toBe(fnv1a32('abc', 2));
    expect(fnv1a32('abc')).toBeGreaterThanOrEqual(0);
    expect(fnv1a32('abc')).toBeLessThan(2 ** 32);
  });
});

describe('faixa de idade do "quem ver" (só o meu lado; idade escondida = bloco de 5 anos)', () => {
  // data local (a mesma conta da idade mostrada no /nearby)
  const NOW = new Date(2026, 8, 30, 12, 0, 0);
  const born = (y: number, m: number, d: number) => new Date(y, m - 1, d);
  // quem MOSTRA a idade (filtro pela idade exata) e quem ESCONDE (filtro pelo bloco)
  const shown = (y: number, m: number, d: number) => ({ birthDate: born(y, m, d), showAge: true });
  const hidden = (y: number, m: number, d: number) => ({
    birthDate: born(y, m, d),
    showAge: false,
  });

  it('ageOn: anos completos, virando no dia do aniversário', () => {
    expect(ageOn(born(2000, 9, 30), NOW)).toBe(26);
    expect(ageOn(born(2000, 10, 1), NOW)).toBe(25);
    expect(ageOn(born(2008, 9, 30), NOW)).toBe(18);
    expect(ageOn(born(2008, 10, 1), NOW)).toBe(17);
  });

  it('sem limite (18 a 99, ou nada gravado): nenhum filtro', () => {
    expect(ageFilter({ ageMin: AGE_MIN, ageMax: AGE_MAX }, NOW)).toBeNull();
    expect(ageFilter({}, NOW)).toBeNull();
    expect(ageFilter({ ageMin: null, ageMax: null }, NOW)).toBeNull();
  });

  it('faixa inválida (fora do CHECK) nunca esvazia a descoberta', () => {
    expect(ageFilter({ ageMin: 40, ageMax: 30 }, NOW)).toBeNull();
    expect(ageFilter({ ageMin: 25.5, ageMax: 30 }, NOW)).toBeNull();
  });

  it('quem mostra a idade: bordas inclusivas, 25 a 30 anos', () => {
    const ok = ageFilter({ ageMin: 25, ageMax: 30 }, NOW)!;
    expect(ok(shown(2001, 9, 30))).toBe(true); // fez 25 hoje
    expect(ok(shown(2001, 10, 1))).toBe(false); // 24 até amanhã
    expect(ok(shown(1996, 10, 1))).toBe(true); // 29, faz 30 amanhã
    expect(ok(shown(1995, 10, 1))).toBe(true); // 30
    expect(ok(shown(1995, 9, 30))).toBe(false); // fez 31 hoje
  });

  it('topo "80+" (99) = sem limite em cima; 80 = até 80', () => {
    const open = ageFilter({ ageMin: 30, ageMax: AGE_MAX }, NOW)!;
    expect(open(shown(1920, 1, 1))).toBe(true); // 106 anos
    expect(open(shown(1996, 1, 1))).toBe(true); // 30
    expect(open(shown(1997, 1, 1))).toBe(false); // 29
    const upTo80 = ageFilter({ ageMin: AGE_MIN, ageMax: 80 }, NOW)!;
    expect(upTo80(shown(1946, 1, 1))).toBe(true); // 80
    expect(upTo80(shown(1945, 1, 1))).toBe(false); // 81
  });

  it('quem esconde a idade: passa se o BLOCO de 5 anos (18–22, 23–27, 28–32…) encosta na faixa', () => {
    const ok = ageFilter({ ageMin: 25, ageMax: 30 }, NOW)!;
    expect(ok(hidden(2003, 1, 1))).toBe(true); // 23, bloco 23–27
    expect(ok(hidden(1994, 1, 1))).toBe(true); // 32, bloco 28–32
    expect(ok(hidden(2004, 1, 1))).toBe(false); // 22, bloco 18–22
    expect(ok(hidden(1993, 1, 1))).toBe(false); // 33, bloco 33–37
    // a mesma pessoa mostrando a idade: vale a exata
    expect(ok(shown(2003, 1, 1))).toBe(false);
    expect(ok(shown(1994, 1, 1))).toBe(false);
  });

  it('busca binária na faixa não passa do bloco: duas idades escondidas do mesmo bloco nunca se separam', () => {
    // 28 e 32 anos (bloco 28–32), a um dia do aniversário ou não
    const a = hidden(1998, 1, 1);
    const b = hidden(1993, 10, 1);
    const diff: string[] = [];
    for (let min = AGE_MIN; min <= AGE_MAX; min++)
      for (let max = min; max <= AGE_MAX; max++) {
        const f = ageFilter({ ageMin: min, ageMax: max }, NOW);
        if (f && f(a) !== f(b)) diff.push(`${min}-${max}`);
      }
    expect(diff).toEqual([]);
  });

  it('showAge ausente conta como escondida (o lado seguro)', () => {
    const ok = ageFilter({ ageMin: 25, ageMax: 30 }, NOW)!;
    expect(ok({ birthDate: born(2003, 1, 1) })).toBe(true); // 23, bloco 23–27
    expect(ok({ birthDate: born(2003, 1, 1), showAge: null })).toBe(true);
  });

  it('sem data de nascimento com filtro ligado: fora', () => {
    const ok = ageFilter({ ageMin: 20, ageMax: 30 }, NOW)!;
    expect(ok({ birthDate: null, showAge: true })).toBe(false);
    expect(ok({ birthDate: undefined, showAge: false })).toBe(false);
    expect(ok({})).toBe(false);
  });
});

describe('deck: super curtida pendente, "passar" e ordem', () => {
  it('DISCOVERY_PASS_DAYS: inteiro de 1 a 365; o resto cai no padrão (30)', () => {
    expect(DISCOVERY_PASS_DAYS_DEFAULT).toBe(30);
    expect(deckPassDays(undefined)).toBe(30);
    expect(deckPassDays('')).toBe(30);
    expect(deckPassDays('7')).toBe(7);
    expect(deckPassDays('0')).toBe(30);
    expect(deckPassDays('-3')).toBe(30);
    expect(deckPassDays('2.5')).toBe(30);
    expect(deckPassDays('9999')).toBe(30);
    expect(deckPassDays('abc')).toBe(30);
    expect(DECK.SUPER_MAX).toBeLessThanOrEqual(DECK.SUPER_SCAN);
  });

  it('super curtida no topo respeita o MEU "Mostrar" (um lado), a MINHA faixa e "Ninguém"', () => {
    const woman = {
      gender: 'female',
      discoveryMode: 'everyone',
      birthDate: new Date(1995, 0, 1),
      showAge: true,
    };
    const man = { ...woman, gender: 'male' };
    const outro = { ...woman, gender: 'other' };
    expect(superLikerShown({ showMe: 'women' }, woman, null)).toBe(true);
    expect(superLikerShown({ showMe: 'women' }, man, null)).toBe(false);
    expect(superLikerShown({ showMe: 'women' }, outro, null)).toBe(false);
    expect(superLikerShown({ showMe: 'everyone' }, outro, null)).toBe(true);
    // o "Mostrar" DELA não conta: ela já quis me ver
    expect(
      superLikerShown({ showMe: 'everyone' }, { ...man, discoveryMode: 'compatible' }, null),
    ).toBe(true);
    // "Ninguém": fora da descoberta, fora do topo
    expect(
      superLikerShown({ showMe: 'everyone' }, { ...woman, discoveryMode: 'nobody' }, null),
    ).toBe(false);
    const now = new Date(2026, 8, 30);
    expect(
      superLikerShown({ showMe: 'everyone' }, woman, ageFilter({ ageMin: 18, ageMax: 30 }, now)),
    ).toBe(
      false, // 31 anos
    );
    expect(
      superLikerShown({ showMe: 'everyone' }, woman, ageFilter({ ageMin: 30, ageMax: 35 }, now)),
    ).toBe(true);
    // escondendo a idade: 31 anos, bloco 28–32 encosta em 18–30
    expect(
      superLikerShown(
        { showMe: 'everyone' },
        { ...woman, showAge: false },
        ageFilter({ ageMin: 18, ageMax: 30 }, now),
      ),
    ).toBe(true);
    expect(
      superLikerShown(
        { showMe: 'everyone' },
        { ...woman, showAge: false },
        ageFilter({ ageMin: 33, ageMax: 40 }, now),
      ),
    ).toBe(false);
  });

  it('mergeDeck: super curtidas primeiro, na ordem dada, sem repetir ninguém', () => {
    const u = (id: string) => ({ id });
    expect(mergeDeck([u('s2'), u('s1')], [u('a'), u('s1'), u('b')]).map((x) => x.id)).toEqual([
      's2',
      's1',
      'a',
      'b',
    ]);
    expect(mergeDeck([], [u('a')]).map((x) => x.id)).toEqual(['a']);
    expect(mergeDeck([u('s')], []).map((x) => x.id)).toEqual(['s']);
  });
});
