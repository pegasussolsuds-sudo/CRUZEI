import type { ProximityBand } from '@cruzei/shared-types';

import {
  compareDiscovery,
  discoveryKey,
  fnv1a32,
  rotationSeed,
  rotationWindow,
  sameOrientationHit,
  showMeAllows,
  showMeMutual,
} from './discovery-order';
import { selectTop } from './hot-path';

const SALT = 'teste-salt';
const WINDOW = 10 * 60_000;
const T0 = Date.UTC(2026, 9, 3, 20, 0, 0);

describe('showMeAllows / showMeMutual ("Mostrar" recíproco)', () => {
  it('um lado: Mulheres só female, Homens só male, Todos (ou nulo) todo mundo', () => {
    const genders = ['female', 'male', 'non_binary', 'other'];
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
    const nb = (showMe: string) => ({ gender: 'non_binary', showMe });

    expect(showMeMutual(man('women'), woman('men'))).toBe(true);
    expect(showMeMutual(man('women'), woman('everyone'))).toBe(true);
    // ela só quer ver mulheres: ele some pra ela E ela some pra ele
    expect(showMeMutual(man('women'), woman('women'))).toBe(false);
    expect(showMeMutual(woman('women'), man('women'))).toBe(false);
    expect(showMeMutual(woman('women'), woman('women'))).toBe(true);
    expect(showMeMutual(man('men'), man('everyone'))).toBe(true);

    // não binário/outro só aparece pra quem escolheu Todos — e vê conforme a própria escolha
    expect(showMeMutual(man('everyone'), nb('everyone'))).toBe(true);
    expect(showMeMutual(man('women'), nb('everyone'))).toBe(false);
    expect(showMeMutual(nb('women'), woman('everyone'))).toBe(true);
    expect(showMeMutual(nb('women'), woman('women'))).toBe(false);
    expect(showMeMutual(nb('men'), woman('everyone'))).toBe(false);
    expect(showMeMutual({ gender: 'other', showMe: 'everyone' }, nb('everyone'))).toBe(true);
  });

  it('é simétrico (quem não vê também não é visto)', () => {
    const people = ['female', 'male', 'non_binary', 'other'].flatMap((gender) =>
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
