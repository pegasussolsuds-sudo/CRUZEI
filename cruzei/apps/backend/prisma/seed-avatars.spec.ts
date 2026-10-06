import { avatarKey, avatarTierOf, avatarTiersFor, isValidAvatarConfig } from '@cruzei/shared-utils';

import { demoAvatar, type DemoAvatarInput } from './seed-avatars';

// Avatares do seed-dev: dentro do plano de cada fake, estáveis, variados e com os itens novos no mapa de demonstração.

const GENDERS = ['female', 'male', 'other'];
/** mesma mistura do seed-dev (extraFake): 1 em 11 Premium, 1 em 29 Premium+, 1 em 12 mais velho */
const crowd: DemoAvatarInput[] = Array.from({ length: 400 }, (_, k) => ({
  seed: `+5534900000${String(k + 9).padStart(3, '0')}`,
  gender: GENDERS[k % 3],
  tier: k % 11 === 10 ? 'premium' : k % 29 === 28 ? 'premium_plus' : undefined,
  age: k % 12 === 7 ? 50 + (k % 19) : 22 + (k % 15),
}));
const cfgs = crowd.map(demoAvatar);
const count = (pred: (i: number) => boolean) => cfgs.filter((_, i) => pred(i)).length;
const paid = (i: number) => crowd[i].tier !== undefined;

describe('demoAvatar (seed-dev)', () => {
  it('cada fake só usa itens do próprio plano e sai igual a cada execução', () => {
    crowd.forEach((p, i) => {
      expect(isValidAvatarConfig(cfgs[i], avatarTiersFor(p.tier ?? 'free'))).toBe(true);
      expect(demoAvatar(p)).toEqual(cfgs[i]);
    });
  });

  it('pessoas diferentes: quase nenhum visual repetido, rosto, corpo e pele variados', () => {
    expect(new Set(cfgs.map(avatarKey)).size).toBeGreaterThan(395);
    for (const slot of ['faceShape', 'eyes', 'brows', 'nose', 'body', 'skin', 'hair'] as const)
      expect(new Set(cfgs.map((c) => c[slot])).size).toBeGreaterThan(5);
    expect(count((i) => cfgs[i].lines !== 'none')).toBeGreaterThan(20); // gente madura
  });

  it('mapa vivo: pets, veículos (com cadeira de rodas), objetos, animações e looks', () => {
    expect(count((i) => cfgs[i].pet !== 'none')).toBeGreaterThan(100);
    expect(count((i) => cfgs[i].vehicle !== 'none')).toBeGreaterThan(50);
    expect(count((i) => cfgs[i].vehicle.startsWith('wheelchair'))).toBeGreaterThan(5);
    expect(count((i) => cfgs[i].held !== 'none')).toBeGreaterThan(80);
    expect(count((i) => cfgs[i].emote !== 'none')).toBeGreaterThan(80);
    expect(count((i) => cfgs[i].outer !== 'none')).toBeGreaterThan(80);
  });

  it('aura e itens pagos só em quem é Premium; Premium+ ganha itens plus', () => {
    cfgs.forEach((c, i) => {
      if (paid(i)) expect(c.aura).not.toBe('none');
      else expect(['none', 'sparkle', 'pride']).toContain(c.aura);
    });
    const plus = cfgs.filter((_, i) => crowd[i].tier === 'premium_plus');
    expect(
      plus.some((c) =>
        Object.entries(c).some(
          ([s, id]) => s !== 'v' && avatarTierOf(s as never, id as string) === 'plus',
        ),
      ),
    ).toBe(true);
  });

  it('pronomes e orgulho em alguns (voluntário), pronomes dentro do gênero declarado', () => {
    const withPronouns = count((i) => cfgs[i].pronouns !== 'none');
    expect(withPronouns).toBeGreaterThan(40);
    expect(withPronouns).toBeLessThan(200);
    expect(count((i) => cfgs[i].pride !== 'none')).toBeGreaterThan(15);
    cfgs.forEach((c, i) => {
      if (crowd[i].gender === 'female') expect(c.pronouns).not.toMatch(/^ele($|_)/);
      if (crowd[i].gender === 'male') expect(c.pronouns).not.toMatch(/^ela($|_)/);
    });
  });

  it('visual escolhido a dedo vale por cima do sorteio e respeita o plano', () => {
    const chosen = {
      hair: 'long_curly',
      pet: 'phoenix',
      petPose: 'float',
      aura: 'supernova',
      pronouns: 'ela',
    } as const;
    const plus = demoAvatar({
      seed: 'x',
      gender: 'female',
      tier: 'premium_plus',
      age: 25,
      avatar: chosen,
    });
    expect(plus).toMatchObject(chosen);
    const free = demoAvatar({ seed: 'x', gender: 'female', age: 25, avatar: chosen });
    expect(free).toMatchObject({ hair: 'long_curly', pet: 'none', aura: 'none', pronouns: 'ela' });
  });
});
