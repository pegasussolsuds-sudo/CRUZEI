// Config do avatar: normalize (inclusive config antiga), validação tolerante/estrita, tiers por plano, petPose,
// looks prontos, tamanho máximo e chave do cache.

import type { AvatarConfig, AvatarSlot } from '@cruzei/shared-types';
import { AVATAR_COLOR_SLOTS, AVATAR_ITEM_SLOTS, AVATAR_LOOKS, NONE, avatarItem } from './catalog';
import {
  ALL_TIERS,
  AVATAR_CONFIG_MAX_BYTES,
  AVATAR_V11_SLOTS,
  DEFAULT_AVATAR,
  FREE_TIERS,
  PLUS_TIERS,
  PREMIUM_TIERS,
  applyLook,
  avatarKey,
  avatarTiersFor,
  isValidAvatarConfig,
  lockedAvatarSlots,
  normalizeAvatarConfig,
} from './config';

/** config gravada antes da v1.1 (formato exato de users.avatar_config até então) */
const OLD_CONFIG = {
  v: 1,
  body: 'broad',
  skin: 's6',
  hair: 'curly',
  hairColor: 'h_blonde',
  face: 'laugh',
  facialHair: 'beard',
  top: 'shirt',
  topColor: 'c_beige',
  bottom: 'pants',
  bottomColor: 'c_navy',
  shoes: 'sneakers',
  shoesColor: 'c_black',
  hat: 'cap',
  hatColor: 'c_olive',
  glasses: 'round',
  accessory: 'necklace',
  bag: 'crossbody',
  wrist: 'watch',
  aura: NONE,
};

const OLD_SLOTS = Object.keys(OLD_CONFIG).filter((k) => k !== 'v' && k !== 'accessory') as AvatarSlot[];

describe('DEFAULT_AVATAR', () => {
  it('tem os padrões novos do SPEC', () => {
    expect(DEFAULT_AVATAR).toMatchObject({
      faceShape: 'oval',
      eyes: 'almond',
      eyeColor: 'e_dark',
      brows: 'soft',
      nose: 'soft',
      lines: 'none',
      faceDetail: 'none',
      outer: 'none',
      outerColor: 'c_navy',
      neck: 'none',
      pride: 'none',
      prideFlag: 'rainbow',
      pronouns: 'none',
      auraColor: 'a_auto',
      auraLevel: 'medium',
      backdrop: 'none',
      emote: 'none',
      pet: 'none',
      petPose: 'side',
      vehicle: 'none',
      vehicleColor: 'c_red',
      held: 'none',
    });
  });

  it('é válido e estável no normalize', () => {
    expect(isValidAvatarConfig(DEFAULT_AVATAR, FREE_TIERS)).toBe(true);
    expect(normalizeAvatarConfig(DEFAULT_AVATAR, FREE_TIERS)).toEqual(DEFAULT_AVATAR);
  });
});

describe('normalizeAvatarConfig', () => {
  it('config antiga: mantém os campos antigos, preenche os novos e leva o colar pro pescoço', () => {
    const n = normalizeAvatarConfig(OLD_CONFIG, FREE_TIERS);
    for (const slot of OLD_SLOTS)
      expect({ slot, v: n[slot] }).toEqual({
        slot,
        v: (OLD_CONFIG as Record<string, unknown>)[slot],
      });
    expect(n.accessory).toBe(NONE);
    expect(n.neck).toBe('necklace');
    for (const slot of AVATAR_V11_SLOTS) {
      if (slot === 'neck') continue;
      expect({ slot, v: n[slot] }).toEqual({ slot, v: DEFAULT_AVATAR[slot] });
    }
  });

  it('cachecol antigo também migra', () => {
    const n = normalizeAvatarConfig({ ...OLD_CONFIG, accessory: 'scarf' });
    expect(n).toMatchObject({ accessory: NONE, neck: 'scarf' });
  });

  it('corrente (premium) só migra com tier liberado', () => {
    expect(normalizeAvatarConfig({ ...OLD_CONFIG, accessory: 'chain' }, PREMIUM_TIERS)).toMatchObject({
      accessory: NONE,
      neck: 'chain',
    });
    expect(normalizeAvatarConfig({ ...OLD_CONFIG, accessory: 'chain' }, FREE_TIERS)).toMatchObject({
      accessory: NONE,
      neck: NONE,
    });
  });

  it('não sobrescreve um pescoço já escolhido', () => {
    const n = normalizeAvatarConfig({ ...OLD_CONFIG, accessory: 'necklace', neck: 'tie' });
    expect(n).toMatchObject({ accessory: NONE, neck: 'tie' });
    // neck 'none' explícito conta como vazio
    expect(normalizeAvatarConfig({ ...OLD_CONFIG, accessory: 'scarf', neck: NONE })).toMatchObject({
      accessory: NONE,
      neck: 'scarf',
    });
  });

  it('ids desconhecidos, tipos errados e lixo voltam ao padrão', () => {
    const n = normalizeAvatarConfig({
      v: 1,
      hair: 'nope',
      top: 42,
      pet: { x: 1 },
      vehicle: null,
      skin: 'zz',
      foo: 'bar',
    });
    expect(n.hair).toBe(DEFAULT_AVATAR.hair);
    expect(n.top).toBe(DEFAULT_AVATAR.top);
    expect(n.pet).toBe(NONE);
    expect(n.vehicle).toBe(NONE);
    expect(n.skin).toBe(DEFAULT_AVATAR.skin);
    expect((n as unknown as Record<string, unknown>).foo).toBeUndefined();
    expect(normalizeAvatarConfig(null)).toEqual(DEFAULT_AVATAR);
    expect(normalizeAvatarConfig('oi')).toEqual(DEFAULT_AVATAR);
  });

  it('itens fora do tier voltam ao padrão (premium, plus e evento)', () => {
    const cfg = {
      ...DEFAULT_AVATAR,
      hair: 'mohawk',
      top: 'royal',
      hat: 'crown',
      vehicle: 'ufo',
      pet: 'dragon',
      petPose: 'float',
      topColor: 'c_gold',
    };
    const free = normalizeAvatarConfig(cfg, FREE_TIERS);
    expect(free).toMatchObject({
      hair: 'short',
      top: 'tee',
      hat: NONE,
      vehicle: NONE,
      pet: NONE,
      topColor: 'c_black',
    });
    const premium = normalizeAvatarConfig(cfg, PREMIUM_TIERS);
    expect(premium).toMatchObject({
      hair: 'mohawk',
      top: 'tee',
      hat: NONE,
      vehicle: NONE,
      pet: 'dragon',
      topColor: 'c_gold',
    });
    const plus = normalizeAvatarConfig(cfg, PLUS_TIERS);
    expect(plus).toMatchObject({
      hair: 'mohawk',
      top: 'royal',
      hat: NONE,
      vehicle: 'ufo',
      pet: 'dragon',
    });
    const all = normalizeAvatarConfig(cfg, ALL_TIERS);
    expect(all).toMatchObject({ hat: 'crown' });
  });

  it('nunca devolve accessory legado', () => {
    for (const acc of ['necklace', 'chain', 'scarf']) {
      expect(normalizeAvatarConfig({ ...DEFAULT_AVATAR, accessory: acc }, FREE_TIERS).accessory).toBe(NONE);
    }
  });
});

describe('petPose', () => {
  it('pet sem posição usa a primeira do pet', () => {
    expect(normalizeAvatarConfig({ ...OLD_CONFIG, pet: 'arara' }).petPose).toBe('shoulder');
    expect(normalizeAvatarConfig({ ...OLD_CONFIG, pet: 'pug' }).petPose).toBe('arms');
    expect(normalizeAvatarConfig({ ...OLD_CONFIG, pet: 'dog_caramel' }).petPose).toBe('side');
  });

  it('posição não aceita pelo pet é corrigida; aceita é mantida', () => {
    expect(normalizeAvatarConfig({ ...DEFAULT_AVATAR, pet: 'arara', petPose: 'side' }).petPose).toBe('shoulder');
    expect(normalizeAvatarConfig({ ...DEFAULT_AVATAR, pet: 'husky', petPose: 'arms' }).petPose).toBe('side');
    expect(normalizeAvatarConfig({ ...DEFAULT_AVATAR, pet: 'cat_orange', petPose: 'shoulder' }).petPose).toBe('shoulder');
    expect(normalizeAvatarConfig({ ...DEFAULT_AVATAR, pet: 'dragon', petPose: 'nope' }).petPose).toBe('float');
  });

  it('sem pet, guarda a posição escolhida (vale pro próximo pet)', () => {
    expect(normalizeAvatarConfig({ ...DEFAULT_AVATAR, pet: NONE, petPose: 'float' }).petPose).toBe('float');
    expect(normalizeAvatarConfig({ ...DEFAULT_AVATAR, pet: NONE, petPose: 'nope' }).petPose).toBe('side');
  });

  it('todo pet do catálogo termina numa posição dele', () => {
    for (const p of avatarItemsOf('pet')) {
      for (const pose of ['side', 'arms', 'shoulder', 'float']) {
        const n = normalizeAvatarConfig({ ...DEFAULT_AVATAR, pet: p.id, petPose: pose });
        if (p.id === NONE) expect(n.petPose).toBe(pose);
        else expect(p.petPoses).toContain(n.petPose);
      }
    }
  });
});

function avatarItemsOf(slot: 'pet') {
  return AVATAR_ITEM_SLOTS.find((s) => s.slot === slot)!.items;
}

describe('isValidAvatarConfig', () => {
  it('tolerante: config antiga (sem chaves v1.1 e com colar no accessory) é válida', () => {
    expect(isValidAvatarConfig(OLD_CONFIG, FREE_TIERS)).toBe(true);
    expect(isValidAvatarConfig({ ...OLD_CONFIG, accessory: 'scarf' }, FREE_TIERS)).toBe(true);
    expect(isValidAvatarConfig({ ...OLD_CONFIG, accessory: 'chain' }, PREMIUM_TIERS)).toBe(true);
  });

  it('tolerante: só parte das chaves v1.1 presente', () => {
    expect(isValidAvatarConfig({ ...OLD_CONFIG, eyes: 'round', pet: 'arara' }, PREMIUM_TIERS)).toBe(true);
    expect(isValidAvatarConfig({ ...OLD_CONFIG, petPose: 'float' }, FREE_TIERS)).toBe(true);
  });

  it('tolerante: colar legado + pescoço novo juntos', () => {
    expect(isValidAvatarConfig({ ...OLD_CONFIG, accessory: 'necklace', neck: 'tie' }, FREE_TIERS)).toBe(true);
  });

  it('config completa normalizada é válida', () => {
    const full = normalizeAvatarConfig({
      ...DEFAULT_AVATAR,
      pet: 'cat_black',
      petPose: 'shoulder',
      vehicle: 'bike',
      held: 'rose',
    });
    expect(isValidAvatarConfig(full, FREE_TIERS)).toBe(true);
  });

  it('estrito: chave antiga ausente, v errado e não-objeto', () => {
    const { body: _body, ...noBody } = OLD_CONFIG;
    void _body;
    expect(isValidAvatarConfig(noBody, FREE_TIERS)).toBe(false);
    expect(isValidAvatarConfig({ ...OLD_CONFIG, v: 2 }, FREE_TIERS)).toBe(false);
    expect(isValidAvatarConfig(null)).toBe(false);
    expect(isValidAvatarConfig([OLD_CONFIG])).toBe(false);
    expect(isValidAvatarConfig('x')).toBe(false);
  });

  it('estrito: id desconhecido em chave antiga ou nova', () => {
    expect(isValidAvatarConfig({ ...OLD_CONFIG, hair: 'nope' })).toBe(false);
    expect(isValidAvatarConfig({ ...OLD_CONFIG, eyes: 'nope' })).toBe(false);
    expect(isValidAvatarConfig({ ...OLD_CONFIG, vehicleColor: 'nope' })).toBe(false);
    expect(isValidAvatarConfig({ ...OLD_CONFIG, held: 42 })).toBe(false);
    expect(isValidAvatarConfig({ ...OLD_CONFIG, neck: null })).toBe(false);
  });

  it('estrito: item fora do plano', () => {
    expect(isValidAvatarConfig({ ...OLD_CONFIG, hair: 'mohawk' }, FREE_TIERS)).toBe(false);
    expect(isValidAvatarConfig({ ...OLD_CONFIG, accessory: 'chain' }, FREE_TIERS)).toBe(false);
    expect(isValidAvatarConfig({ ...OLD_CONFIG, top: 'royal' }, PREMIUM_TIERS)).toBe(false);
    expect(isValidAvatarConfig({ ...OLD_CONFIG, top: 'royal' }, PLUS_TIERS)).toBe(true);
    expect(isValidAvatarConfig({ ...OLD_CONFIG, hat: 'crown' }, PLUS_TIERS)).toBe(false);
    expect(isValidAvatarConfig({ ...OLD_CONFIG, skin: 'f_jade' }, FREE_TIERS)).toBe(false);
  });

  it('estrito: posição que o pet não aceita', () => {
    expect(isValidAvatarConfig({ ...OLD_CONFIG, pet: 'arara', petPose: 'side' }, PREMIUM_TIERS)).toBe(false);
    expect(isValidAvatarConfig({ ...OLD_CONFIG, pet: 'arara', petPose: 'float' }, PREMIUM_TIERS)).toBe(true);
  });

  it('estrito: accessory com id desconhecido continua inválido', () => {
    expect(isValidAvatarConfig({ ...OLD_CONFIG, accessory: 'colar' }, FREE_TIERS)).toBe(false);
  });
});

describe('tiers por plano', () => {
  it('conjuntos', () => {
    expect([...FREE_TIERS]).toEqual(['free']);
    expect([...PREMIUM_TIERS].sort()).toEqual(['free', 'premium']);
    expect([...PLUS_TIERS].sort()).toEqual(['free', 'plus', 'premium']);
    expect([...ALL_TIERS].sort()).toEqual(['event', 'free', 'plus', 'premium']);
  });

  it('avatarTiersFor', () => {
    expect(avatarTiersFor('premium')).toBe(PREMIUM_TIERS);
    expect(avatarTiersFor('premium_plus')).toBe(PLUS_TIERS);
    expect(avatarTiersFor('free')).toBe(FREE_TIERS);
    expect(avatarTiersFor(null)).toBe(FREE_TIERS);
    expect(avatarTiersFor(undefined)).toBe(FREE_TIERS);
    expect(avatarTiersFor('qualquer')).toBe(FREE_TIERS);
    expect(avatarTiersFor('premium', false)).toBe(FREE_TIERS);
    expect(avatarTiersFor('premium_plus', false)).toBe(FREE_TIERS);
  });

  it('lockedAvatarSlots devolve slots de item e de cor', () => {
    const cfg: AvatarConfig = {
      ...DEFAULT_AVATAR,
      top: 'royal',
      hair: 'mohawk',
      topColor: 'c_gold',
      skin: 'f_cosmic',
      pet: 'phoenix',
      petPose: 'float',
    };
    expect(lockedAvatarSlots(cfg, FREE_TIERS).sort()).toEqual(['hair', 'pet', 'skin', 'top', 'topColor']);
    expect(lockedAvatarSlots(cfg, PREMIUM_TIERS).sort()).toEqual(['pet', 'top']);
    expect(lockedAvatarSlots(cfg, PLUS_TIERS)).toEqual([]);
    expect(lockedAvatarSlots(DEFAULT_AVATAR, FREE_TIERS)).toEqual([]);
  });
});

describe('tamanho', () => {
  it('a maior config possível cabe em AVATAR_CONFIG_MAX_BYTES', () => {
    expect(AVATAR_CONFIG_MAX_BYTES).toBe(2048);
    const big: Record<string, unknown> = { v: 1 };
    for (const s of [...AVATAR_ITEM_SLOTS, ...AVATAR_COLOR_SLOTS]) {
      big[s.slot] = s.items.reduce((a, b) => (Buffer.byteLength(b.id) > Buffer.byteLength(a.id) ? b : a)).id;
    }
    const bytes = Buffer.byteLength(JSON.stringify(big));
    expect(bytes).toBeLessThan(AVATAR_CONFIG_MAX_BYTES);
    // e com folga (indentação de cliente antigo, chaves extras pequenas)
    expect(Buffer.byteLength(JSON.stringify(big, null, 2))).toBeLessThan(AVATAR_CONFIG_MAX_BYTES);
  });
});

describe('avatarKey', () => {
  it('estável e cobre todos os slots', () => {
    const base = normalizeAvatarConfig(DEFAULT_AVATAR);
    const k = avatarKey(base);
    expect(avatarKey({ ...base })).toBe(k);
    for (const s of [...AVATAR_ITEM_SLOTS, ...AVATAR_COLOR_SLOTS]) {
      const other = s.items.find((i) => i.id !== base[s.slot as AvatarSlot]);
      if (!other) continue;
      const changed = { ...base, [s.slot]: other.id } as AvatarConfig;
      expect({ slot: s.slot, same: avatarKey(changed) === k }).toEqual({
        slot: s.slot,
        same: false,
      });
    }
  });
});

describe('applyLook', () => {
  const PERSONAL = ['body', 'skin', 'faceShape', 'eyes', 'eyeColor', 'brows', 'nose', 'face', 'hair', 'hairColor', 'facialHair'];
  PERSONAL.push('lines', 'faceDetail', 'pronouns', 'prideFlag');
  const me = normalizeAvatarConfig({
    ...DEFAULT_AVATAR,
    body: 'curvy',
    skin: 's12',
    faceShape: 'heart',
    eyes: 'hooded',
    eyeColor: 'e_green',
    brows: 'arched',
    nose: 'aquiline',
    face: 'serene',
    hair: 'updo',
    hairColor: 'h_salt',
    facialHair: 'boxed',
    lines: 'soft',
    faceDetail: 'freckles',
    pronouns: 'elu',
    prideFlag: 'trans',
    pet: 'cat_black',
    petPose: 'shoulder',
  });

  it('nunca mexe nos traços da pessoa', () => {
    for (const look of AVATAR_LOOKS) {
      const out = applyLook(me, look.id);
      for (const s of PERSONAL)
        expect({ look: look.id, s, v: out[s as AvatarSlot] }).toEqual({
          look: look.id,
          s,
          v: me[s as AvatarSlot],
        });
      expect(isValidAvatarConfig(out)).toBe(true);
    }
  });

  it('aplica o look inteiro quando tudo está liberado', () => {
    const out = applyLook(me, 'praia');
    const look = AVATAR_LOOKS.find((l) => l.id === 'praia')!;
    expect(out).toMatchObject(look.set);
    // pet não faz parte do look: continua
    expect(out).toMatchObject({ pet: 'cat_black', petPose: 'shoulder' });
  });

  it('com o plano, itens bloqueados ficam de fora (e a cor deles também)', () => {
    const base = normalizeAvatarConfig({ ...me, top: 'hoodie', topColor: 'c_green' });
    const out = applyLook(base, 'futurista', FREE_TIERS);
    // tudo do futurista é premium: nada muda na roupa
    expect(out).toMatchObject({ top: 'hoodie', topColor: 'c_green', vehicle: NONE, glasses: NONE });
    for (const s of Object.keys(out) as (keyof AvatarConfig)[]) {
      if (s === 'v') continue;
      expect(FREE_TIERS.has(avatarTierFor(s, out[s]))).toBe(true);
    }
    // premium leva tudo
    expect(applyLook(base, 'futurista', PREMIUM_TIERS)).toMatchObject({
      top: 'cyber',
      vehicle: 'hoverboard',
      glasses: 'cyber',
    });
  });

  it('itens protegidos (fé, acessibilidade) nunca saem', () => {
    const cfg = normalizeAvatarConfig({
      ...me,
      hat: 'hijab',
      hatColor: 'c_teal',
      accessory: 'hearing_aid',
      vehicle: 'wheelchair',
      vehicleColor: 'c_purple',
    });
    for (const look of AVATAR_LOOKS) {
      const out = applyLook(cfg, look.id);
      expect({ look: look.id, hat: out.hat, hatColor: out.hatColor }).toEqual({
        look: look.id,
        hat: 'hijab',
        hatColor: 'c_teal',
      });
      expect({ look: look.id, acc: out.accessory }).toEqual({ look: look.id, acc: 'hearing_aid' });
      expect({ look: look.id, v: out.vehicle, c: out.vehicleColor }).toEqual({
        look: look.id,
        v: 'wheelchair',
        c: 'c_purple',
      });
    }
  });

  it('look desconhecido não muda nada', () => {
    expect(applyLook(me, 'nope')).toEqual(me);
  });

  it('aceita config antiga (migra o colar antes)', () => {
    const out = applyLook(OLD_CONFIG as unknown as AvatarConfig, 'casual');
    expect(out.accessory).toBe(NONE);
    expect(out.neck).toBe(NONE); // o look casual define pescoço vazio
    expect(out.hair).toBe('curly');
  });
});

function avatarTierFor(slot: keyof AvatarConfig, id: unknown) {
  const item = AVATAR_ITEM_SLOTS.find((s) => s.slot === slot)?.items.find((i) => i.id === id);
  const color = AVATAR_COLOR_SLOTS.find((s) => s.slot === slot)?.items.find((i) => i.id === id);
  return (item ?? color)?.tier ?? 'free';
}

// sanity: helper de item usado acima existe
it('avatarItem acha itens migrados no neck', () => {
  expect(avatarItem('neck', 'necklace')?.label).toBe('Colar');
  expect(avatarItem('accessory', 'necklace')).toBeUndefined();
});
