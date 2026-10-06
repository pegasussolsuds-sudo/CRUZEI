// Regressão do randomAvatarConfig: quem nunca editou o avatar continua com o mesmo visual depois da v1.1.
// Valores anotados rodando o código de ANTES desta mudança (6 seeds × gênero null/male/female, tiers free, e as
// mesmas seeds com tiers premium). Colar/cachecol sorteados no accessory agora aparecem no `neck`.

import { AVATAR_V11_SLOTS, DEFAULT_AVATAR, FREE_TIERS, PREMIUM_TIERS, isValidAvatarConfig, randomAvatarConfig } from './config';

const FIELDS = [
  'body',
  'skin',
  'hair',
  'hairColor',
  'face',
  'facialHair',
  'top',
  'topColor',
  'bottom',
  'bottomColor',
  'shoes',
  'shoesColor',
  'hat',
  'hatColor',
  'glasses',
  'accessory',
  'bag',
  'wrist',
  'aura',
] as const;

/** `${seed}|${gênero}` → valores de FIELDS, na ordem (tiers padrão = free) */
const BEFORE: Record<string, string> = {
  'a|null': 'regular s8 long h_red wink none polo c_blue pants c_gray boots c_black none c_olive none none none bracelet none',
  'a|male':
    'broad s6 curly h_blonde laugh none shirt c_beige pants c_navy sneakers c_black none c_olive none none crossbody none none',
  'a|female':
    'regular s8 braids h_red wink none crop c_blue shorts c_gray boots c_black none c_olive none none none bracelet none',
  'b|null':
    'regular s2 quiff h_red smile none polo c_yellow jeans c_beige sneakers c_gray none c_black sun flower crossbody none none',
  'b|male':
    'slim s6 side h_black wink none shirt c_pink jeans c_lightdenim hightops c_beige cap c_brown none none crossbody none none',
  'b|female':
    'regular s2 wavy h_red smile none crop c_yellow jeans c_beige sneakers c_gray none c_black sun flower crossbody none none',
  'user-1|null':
    'slim s2 quiff h_dark laugh none hoodie c_brown pants c_gray sandals c_black beanie c_white none none none none none',
  'user-1|male':
    'slim s6 side h_gray blush stubble sweater c_beige pants c_lightdenim sneakers c_gray bucket c_beige none none backpack none none',
  'user-1|female':
    'slim s2 wavy h_dark laugh none hoodie c_brown shorts c_gray sandals c_black beanie c_white none none none none none',
  '2b328b97|null':
    'regular s1 short h_dark laugh none shirt c_black pants c_denim sneakers c_gray bucket c_navy square none backpack none none',
  '2b328b97|male':
    'slim s2 short h_red smile none hoodie c_white pants c_lightdenim hightops c_black none c_navy square none backpack none none',
  '2b328b97|female':
    'regular s1 long h_dark laugh none dress c_black shorts c_denim sneakers c_gray bucket c_navy square none backpack none none',
  'seed-xyz|null':
    'broad s2 quiff h_light laugh none shirt c_white jeans c_beige sneakers c_white none c_brown none none crossbody watch none',
  'seed-xyz|male':
    'slim s3 side h_red smile none shirt c_purple jeans c_black sneakers c_gray none c_gray none scarf backpack none none',
  'seed-xyz|female':
    'broad s2 wavy h_light laugh none dress c_white jeans c_beige sneakers c_white none c_brown none none crossbody watch none',
  '|null':
    'regular s7 long h_black blush none shirt c_navy joggers c_gray hightops c_gray none c_white none headphones none none none',
  '|male':
    'broad s1 curly h_white grin none hoodie c_beige joggers c_navy hightops c_black beanie c_gray none none none none none',
  '|female':
    'regular s7 braids h_black blush none dress c_navy leggings c_gray hightops c_gray none c_white none headphones none none none',
};

/** mesmas seeds, gênero null, tiers free+premium (o antigo ALL_TIERS sem evento dava a mesma paleta) */
const BEFORE_PREMIUM: Record<string, string> = {
  a: 'regular s8 long h_red wink none polo c_pink pants c_gray boots c_black none c_olive none none none bracelet none',
  b: 'regular s2 quiff h_red smile none polo c_teal jeans c_beige sneakers c_gray none c_black sun flower crossbody none none',
  'user-1': 'slim s2 quiff h_dark laugh none hoodie c_lime pants c_gray sandals c_black beanie c_white none none none none none',
  '2b328b97':
    'regular s1 short h_dark laugh none shirt c_black pants c_denim sneakers c_gray bucket c_navy square none backpack none none',
  'seed-xyz':
    'broad s2 quiff h_light laugh none shirt c_white jeans c_beige sneakers c_white none c_brown none none crossbody watch none',
  '': 'regular s7 long h_black blush none shirt c_denim joggers c_gray hightops c_gray none c_white none headphones none none none',
};

const LEGACY_NECK = ['necklace', 'chain', 'scarf'];

function expectSameAsBefore(cfg: Record<string, string>, before: string, label: string) {
  const values = before.split(' ');
  FIELDS.forEach((f, i) => {
    const old = values[i];
    if (f === 'accessory' && LEGACY_NECK.includes(old)) {
      expect({ label, accessory: cfg.accessory, neck: cfg.neck }).toEqual({
        label,
        accessory: 'none',
        neck: old,
      });
    } else {
      expect({ label, field: f, value: cfg[f] }).toEqual({ label, field: f, value: old });
    }
  });
}

describe('randomAvatarConfig — regressão', () => {
  for (const [key, before] of Object.entries(BEFORE)) {
    it(`mesmo avatar de antes: ${key}`, () => {
      const [seed, g] = key.split('|');
      const cfg = randomAvatarConfig(seed, {
        gender: g === 'null' ? null : (g as 'male' | 'female'),
      });
      expectSameAsBefore(cfg as unknown as Record<string, string>, before, key);
      // campos novos ficam no padrão (o neck só muda pela migração do colar/cachecol)
      for (const slot of AVATAR_V11_SLOTS) {
        if (slot === 'neck') continue;
        expect({ key, slot, v: cfg[slot] }).toEqual({ key, slot, v: DEFAULT_AVATAR[slot] });
      }
      expect(isValidAvatarConfig(cfg, FREE_TIERS)).toBe(true);
    });
  }

  for (const [seed, before] of Object.entries(BEFORE_PREMIUM)) {
    it(`mesmo avatar de antes com tiers premium: "${seed}"`, () => {
      const cfg = randomAvatarConfig(seed, { gender: null, tiers: PREMIUM_TIERS });
      expectSameAsBefore(cfg as unknown as Record<string, string>, before, `premium:${seed}`);
      expect(isValidAvatarConfig(cfg, PREMIUM_TIERS)).toBe(true);
    });
  }

  it('o caso com cachecol migra pro pescoço', () => {
    expect(randomAvatarConfig('seed-xyz', { gender: 'male' })).toMatchObject({
      accessory: 'none',
      neck: 'scarf',
    });
  });

  it('determinístico e sempre válido no plano grátis', () => {
    for (let i = 0; i < 300; i++) {
      const seed = `u-${i}`;
      const a = randomAvatarConfig(seed, {
        gender: i % 3 === 0 ? 'male' : i % 3 === 1 ? 'female' : null,
      });
      const b = randomAvatarConfig(seed, {
        gender: i % 3 === 0 ? 'male' : i % 3 === 1 ? 'female' : null,
      });
      expect(a).toEqual(b);
      expect(isValidAvatarConfig(a, FREE_TIERS)).toBe(true);
      expect(['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8']).toContain(a.skin);
    }
  });
});
