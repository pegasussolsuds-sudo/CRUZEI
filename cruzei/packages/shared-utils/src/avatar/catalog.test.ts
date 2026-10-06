// Integridade do catálogo do avatar: ids, tiers, raridade, pets, veículos, bandeiras, categorias e looks.

import * as fs from 'fs';
import * as path from 'path';
import type { AvatarColorSlot, AvatarItemSlot, AvatarSlot, AvatarTier } from '@cruzei/shared-types';
import {
  AVATAR_CATEGORIES,
  AVATAR_COLOR_SLOTS,
  AVATAR_ITEM_SLOTS,
  AVATAR_LOOK_SLOTS,
  AVATAR_LOOKS,
  AVATAR_PROTECTED_ITEMS,
  NONE,
  PRIDE_FLAGS,
  RARITY_BY_TIER,
  RARITY_LABEL,
  SKIN_COLORS,
  STYLE_TAG_LABEL,
  TIER_LABEL,
  avatarAuraTint,
  avatarCategoryOf,
  avatarColor,
  avatarColorHex,
  avatarItem,
  avatarLookTier,
  avatarPronounsLabel,
  avatarRarityOf,
  avatarSlotDef,
  avatarTierOf,
  avatarUnlockText,
  isAnimatedItem,
  petPosesOf,
  prideFlagDef,
  vehicleMountOf,
} from './catalog';
import { AVATAR_V11_SLOTS, DEFAULT_AVATAR } from './config';

const TIERS: AvatarTier[] = ['free', 'premium', 'plus', 'event'];
const RARITIES = ['common', 'rare', 'epic', 'legendary'];
const POSES = ['side', 'arms', 'shoulder', 'float'];
const MOUNTS = ['cover', 'straddle', 'stand', 'seat', 'hover'];
const HEX = /^#[0-9A-F]{6}$/;

const ALL_SLOTS = Object.keys(DEFAULT_AVATAR).filter((k) => k !== 'v') as AvatarSlot[];
const ITEM_SLOTS = AVATAR_ITEM_SLOTS.map((s) => s.slot as AvatarItemSlot);
const COLOR_SLOTS = AVATAR_COLOR_SLOTS.map((s) => s.slot as AvatarColorSlot);

// ---- fonte da verdade: o SPEC do catálogo (id[:T][!epic]) — T: F free (padrão), P premium, X plus, E event ----
const SPEC: Record<string, string> = {
  body: 'slim regular broad plus curvy athletic',
  faceShape: 'oval round square heart long diamond',
  eyes: 'almond round upturned downturned monolid hooded',
  brows: 'soft thick thin arched straight bushy',
  nose: 'soft button straight wide aquiline small',
  face: 'smile grin calm wink laugh cool blush kiss serene smirk surprised starry:P hearts:P',
  lines: 'none soft marked',
  faceDetail: 'none freckles mole vitiligo lipstick liner glam:P glitter:P star_cheek:P',
  hair:
    'bald buzz short side quiff curly afro bob long wavy ponytail bun braids mohawk:P dreads:P receding thinning classic pixie ' +
    'updo low_bun curtain twists cornrows space_buns undercut long_curly afro_puff pompadour:P mullet:P side_shave:P braid_crown:P!epic',
  facialHair: 'none stubble beard goatee mustache chevron handlebar:P van_dyke long_beard boxed sideburns',
  top:
    'tee tank polo shirt hoodie sweater jacket crop dress neon_jacket:P jersey:E striped graphic flannel turtleneck linen blouse ' +
    'tunic oversized basket hawaiian pride_tee tux:P gown:P!epic satin:P sequin:P!epic cyber:P armor:P!epic wizard:P royal:X holo:X',
  outer: 'none blazer cardigan vest denim leather bomber varsity trench:P puffer:P kimono:P cape:P!epic mecha:P mantle:X',
  bottom: 'jeans pants shorts skirt joggers leggings cargo:P tailored pleated midi wide bermuda ripped kilt metallic:P tutu:P',
  shoes: 'sneakers hightops boots sandals runners:P loafers oxford flats heels combat texan slides platform:P skates:P glass:P!epic hover:X',
  hat:
    'none cap cap_back beanie bucket headband straw:P crown:E fedora flatcap beret panama cowboy party turban hijab durag tiara:P ' +
    'top_hat:P witch:P cat_ears:P horns:P halo:P!epic neon_crown:X',
  glasses: 'none round square sun aviator:P visor:P reading cat_eye rimless big round_gold:P heart:P star:P monocle:P cyber:P!epic',
  accessory: 'none earrings headphones flower hearing_aid hoops pearl_earrings nose_ring ear_cuff headset:P butterflies:P flower_crown:P',
  neck: 'none necklace chain:P scarf pearls tie bowtie silk bandana lei choker medal:P amulet:P!epic',
  bag: 'none backpack crossbody tote clutch fanny guitar_back wings_angel:P!epic wings_butterfly:P!epic wings_dragon:P!epic jetpack:P wings_neon:X',
  wrist: 'none watch bracelet smartwatch:P bangles beads scrunchie fitness luxury:P cuff:P',
  pride: 'none pin heart_pin band face_paint sash cape flag',
  prideFlag: 'rainbow progress trans bi pan lesbian gay nonbinary ace demi aro intersex genderfluid agender genderqueer ally',
  pronouns: 'none ela ele elu ela_elu ele_elu ela_ele any',
  aura:
    'none lime:P magenta:P gold:P fest:E sparkle pride galaxy:P!epic flames:P electric:P crystals:P!epic mist:P stardust:P petals:P ' +
    'hologram:P!epic golden:P!epic rainbow:P hearts:P bubbles:P snow:P fireflies:P music:P supernova:X',
  auraLevel: 'soft medium max',
  backdrop: 'none sunset beach hearts garden studio pride night_city:P neon_grid:P galaxy:P aurora:P!epic confetti:P gold_luxe:P carnival:P stage:X',
  emote:
    'none wave greet clap kiss:P heart:P victory:P bow:P shy:P laugh:P jump:P spin:P flex:P dance_samba:P!epic dance_passinho:P!epic ' +
    'dance_hiphop:P dance_disco:P dance_robot:P dance_kpop:P!epic dance_vogue:P!epic dance_shuffle:P guitar:P mic:P pandeiro:P ' +
    'pose_hero:P pose_model:P magic:P!epic pet_love:P starfall:X fireworks:X',
  pet:
    'none dog_caramel dog_black pug dachshund cat_orange cat_black cat_tuxedo bunny hamster turtle poodle:P husky:P cat_siamese:P ' +
    'arara:P parrot:P capybara:P!epic sloth:P axolotl:P dragon:P!epic unicorn:P!epic fox_spirit:P!epic robot_dog:P ghost:P phoenix:X',
  petPose: 'side arms shoulder float',
  vehicle:
    'none bike kick skate wheelchair wheelchair_sport moto:P lambreta:P car:P classic:P jeep:P hoverboard:P carpet:P!epic cloud:P sport:X ufo:X',
  held:
    'none rose bouquet sunflower coffee coconut milkshake boba ice_cream popcorn gift book camera mic tambourine fan heart_sign ' +
    'balloon:P guitar:P trophy:P sparkler:P potion:P wand:P crystal_ball:P!epic lantern:P saber:P!epic orb:X',
  skin: 's1 s2 s3 s4 s5 s6 s7 s8 s9 s10 s11 s12 s13 s14 f_lunar:P f_cosmic:P f_jade:P',
  eyeColor: 'e_dark e_brown e_hazel e_amber e_green e_blue e_gray e_black e_violet:P e_gold:P e_ice:P e_ruby:P',
  hairColor:
    'h_black h_dark h_brown h_light h_blonde h_platinum h_red h_auburn h_gray h_white h_pink:P h_blue:P h_purple:P h_green:P h_lime:P ' +
    'h_silver h_salt h_steel h_teal:P h_lavender:P h_rosegold:P h_fire:P h_ice:P',
  auraColor: 'a_auto a_lime a_magenta a_gold a_cyan a_violet a_fire a_rose a_emerald a_ice a_silver a_crimson',
};
const CLOTH =
  'c_black c_white c_gray c_navy c_denim c_lightdenim c_red c_coral c_orange c_yellow c_green c_teal c_blue c_purple c_pink c_beige ' +
  'c_brown c_olive c_lime:P c_magenta:P c_gold:P';
for (const s of ['topColor', 'outerColor', 'bottomColor', 'shoesColor', 'hatColor', 'vehicleColor']) SPEC[s] = CLOTH;

const TIER_OF: Record<string, AvatarTier> = { F: 'free', P: 'premium', X: 'plus', E: 'event' };
function parseSpec(s: string): { id: string; tier: AvatarTier; epic: boolean }[] {
  return s.split(/\s+/).map((tok) => {
    const epic = tok.endsWith('!epic');
    const [id, t] = tok.replace('!epic', '').split(':');
    return { id, tier: TIER_OF[t ?? 'F'], epic };
  });
}

const PET_POSES_SPEC: Record<string, string> = {
  dog_caramel: 'side arms',
  dog_black: 'side arms',
  pug: 'arms side',
  dachshund: 'side arms',
  cat_orange: 'arms side shoulder',
  cat_black: 'arms side shoulder',
  cat_tuxedo: 'arms side shoulder',
  bunny: 'arms side',
  hamster: 'shoulder arms',
  turtle: 'side arms',
  poodle: 'side arms',
  husky: 'side',
  cat_siamese: 'arms side shoulder',
  arara: 'shoulder float',
  parrot: 'shoulder float',
  capybara: 'side',
  sloth: 'arms',
  axolotl: 'arms float',
  dragon: 'float shoulder',
  unicorn: 'side arms',
  fox_spirit: 'side float',
  robot_dog: 'side',
  ghost: 'float shoulder',
  phoenix: 'float shoulder',
};

const MOUNT_SPEC: Record<string, string> = {
  bike: 'straddle',
  kick: 'stand',
  skate: 'stand',
  wheelchair: 'seat',
  wheelchair_sport: 'seat',
  moto: 'straddle',
  lambreta: 'straddle',
  car: 'cover',
  classic: 'cover',
  jeep: 'cover',
  hoverboard: 'stand',
  carpet: 'hover',
  cloud: 'hover',
  sport: 'cover',
  ufo: 'hover',
};

// catálogo de antes da v1.1: id, rótulo e tier têm de continuar iguais (colares foram pro neck)
const LEGACY: Record<string, [string, string, string][]> = {
  body: [
    ['slim', 'Esguio', 'F'],
    ['regular', 'Médio', 'F'],
    ['broad', 'Largo', 'F'],
  ],
  hair: [
    ['bald', 'Careca', 'F'],
    ['buzz', 'Raspado', 'F'],
    ['short', 'Curto', 'F'],
    ['side', 'Risca lateral', 'F'],
    ['quiff', 'Topete', 'F'],
    ['curly', 'Cacheado', 'F'],
    ['afro', 'Black power', 'F'],
    ['bob', 'Chanel', 'F'],
    ['long', 'Longo liso', 'F'],
    ['wavy', 'Ondulado', 'F'],
    ['ponytail', 'Rabo de cavalo', 'F'],
    ['bun', 'Coque', 'F'],
    ['braids', 'Tranças', 'F'],
    ['mohawk', 'Moicano', 'P'],
    ['dreads', 'Dreads', 'P'],
  ],
  face: [
    ['smile', 'Sorriso', 'F'],
    ['grin', 'Sorrisão', 'F'],
    ['calm', 'Tranquilo', 'F'],
    ['wink', 'Piscada', 'F'],
    ['laugh', 'Risada', 'F'],
    ['cool', 'Descolado', 'F'],
    ['blush', 'Tímido', 'F'],
  ],
  facialHair: [
    ['none', 'Nenhuma', 'F'],
    ['stubble', 'Barba rala', 'F'],
    ['beard', 'Barba cheia', 'F'],
    ['goatee', 'Cavanhaque', 'F'],
    ['mustache', 'Bigode', 'F'],
  ],
  top: [
    ['tee', 'Camiseta', 'F'],
    ['tank', 'Regata', 'F'],
    ['polo', 'Polo', 'F'],
    ['shirt', 'Camisa', 'F'],
    ['hoodie', 'Moletom', 'F'],
    ['sweater', 'Suéter', 'F'],
    ['jacket', 'Jaqueta', 'F'],
    ['crop', 'Cropped', 'F'],
    ['dress', 'Vestido', 'F'],
    ['neon_jacket', 'Jaqueta neon', 'P'],
    ['jersey', 'Camisa 10', 'E'],
  ],
  bottom: [
    ['jeans', 'Jeans', 'F'],
    ['pants', 'Calça', 'F'],
    ['shorts', 'Shorts', 'F'],
    ['skirt', 'Saia', 'F'],
    ['joggers', 'Jogger', 'F'],
    ['leggings', 'Legging', 'F'],
    ['cargo', 'Cargo', 'P'],
  ],
  shoes: [
    ['sneakers', 'Tênis', 'F'],
    ['hightops', 'Cano alto', 'F'],
    ['boots', 'Bota', 'F'],
    ['sandals', 'Sandália', 'F'],
    ['runners', 'Tênis neon', 'P'],
  ],
  hat: [
    ['none', 'Sem chapéu', 'F'],
    ['cap', 'Boné', 'F'],
    ['cap_back', 'Boné virado', 'F'],
    ['beanie', 'Gorro', 'F'],
    ['bucket', 'Bucket', 'F'],
    ['headband', 'Faixa', 'F'],
    ['straw', 'Chapéu de palha', 'P'],
    ['crown', 'Coroa', 'E'],
  ],
  glasses: [
    ['none', 'Sem óculos', 'F'],
    ['round', 'Redondo', 'F'],
    ['square', 'Quadrado', 'F'],
    ['sun', 'Escuro', 'F'],
    ['aviator', 'Aviador', 'P'],
    ['visor', 'Visor neon', 'P'],
  ],
  accessory: [
    ['none', 'Nenhum', 'F'],
    ['earrings', 'Brincos', 'F'],
    ['headphones', 'Fone', 'F'],
    ['flower', 'Flor no cabelo', 'F'],
  ],
  neck: [
    ['necklace', 'Colar', 'F'],
    ['scarf', 'Cachecol', 'F'],
    ['chain', 'Corrente dourada', 'P'],
  ],
  bag: [
    ['none', 'Sem bolsa', 'F'],
    ['backpack', 'Mochila', 'F'],
    ['crossbody', 'Transversal', 'F'],
  ],
  wrist: [
    ['none', 'Nada', 'F'],
    ['watch', 'Relógio', 'F'],
    ['bracelet', 'Pulseira', 'F'],
    ['smartwatch', 'Smartwatch', 'P'],
  ],
  aura: [
    ['none', 'Sem efeito', 'F'],
    ['lime', 'Aura lima', 'P'],
    ['magenta', 'Aura magenta', 'P'],
    ['gold', 'Aura dourada', 'P'],
    ['fest', 'Aura Metch Fest', 'E'],
  ],
  skin: [
    ['s1', 'Pele 1', 'F'],
    ['s2', 'Pele 2', 'F'],
    ['s3', 'Pele 3', 'F'],
    ['s4', 'Pele 4', 'F'],
    ['s5', 'Pele 5', 'F'],
    ['s6', 'Pele 6', 'F'],
    ['s7', 'Pele 7', 'F'],
    ['s8', 'Pele 8', 'F'],
  ],
  hairColor: [
    ['h_black', 'Preto', 'F'],
    ['h_dark', 'Castanho escuro', 'F'],
    ['h_brown', 'Castanho', 'F'],
    ['h_light', 'Castanho claro', 'F'],
    ['h_blonde', 'Loiro', 'F'],
    ['h_platinum', 'Platinado', 'F'],
    ['h_red', 'Ruivo', 'F'],
    ['h_auburn', 'Acobreado', 'F'],
    ['h_gray', 'Grisalho', 'F'],
    ['h_white', 'Branco', 'F'],
    ['h_pink', 'Rosa', 'P'],
    ['h_blue', 'Azul', 'P'],
    ['h_purple', 'Roxo', 'P'],
    ['h_green', 'Verde', 'P'],
    ['h_lime', 'Lima neon', 'P'],
  ],
};

function itemsOf(slot: AvatarSlot): { id: string; label: string; tier: AvatarTier }[] {
  return avatarSlotDef(slot).items;
}

/** L* (CIELAB) de um hex sRGB */
function lightness(hex: string): number {
  const lin = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  const y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  return 116 * Math.cbrt(y) - 16;
}

describe('slots', () => {
  it('cobre exatamente todos os slots da AvatarConfig, cada um uma vez', () => {
    const declared = [...ITEM_SLOTS, ...COLOR_SLOTS];
    expect(new Set(declared).size).toBe(declared.length);
    expect([...declared].sort()).toEqual([...ALL_SLOTS].sort());
  });

  it('bate com o SPEC: mesmos ids, tiers e raridades explícitas', () => {
    for (const slot of ALL_SLOTS) {
      const spec = parseSpec(SPEC[slot]);
      const items = itemsOf(slot);
      expect({ slot, ids: items.map((i) => i.id).sort() }).toEqual({
        slot,
        ids: spec.map((s) => s.id).sort(),
      });
      for (const s of spec) {
        expect({ slot, id: s.id, tier: avatarTierOf(slot, s.id) }).toEqual({
          slot,
          id: s.id,
          tier: s.tier,
        });
        const expected = s.epic ? 'epic' : RARITY_BY_TIER[s.tier];
        expect({ slot, id: s.id, rarity: avatarRarityOf(slot, s.id) }).toEqual({
          slot,
          id: s.id,
          rarity: expected,
        });
      }
    }
  });

  it('ids únicos por slot, rótulos preenchidos e o padrão existe e é free', () => {
    for (const slot of ALL_SLOTS) {
      const items = itemsOf(slot);
      const ids = items.map((i) => i.id);
      expect({ slot, dup: ids.length - new Set(ids).size }).toEqual({ slot, dup: 0 });
      for (const i of items) {
        expect(i.label.trim().length).toBeGreaterThan(0);
        expect(TIERS).toContain(i.tier);
      }
      const def = DEFAULT_AVATAR[slot];
      expect({ slot, def, found: ids.includes(def) }).toEqual({ slot, def, found: true });
      expect({ slot, tier: avatarTierOf(slot, def) }).toEqual({ slot, tier: 'free' });
    }
  });

  it('slot opcional tem "none" free; slot obrigatório não tem', () => {
    for (const s of AVATAR_ITEM_SLOTS) {
      const none = s.items.find((i) => i.id === NONE);
      if (s.optional) expect({ slot: s.slot, tier: none?.tier }).toEqual({ slot: s.slot, tier: 'free' });
      else expect({ slot: s.slot, none: !!none }).toEqual({ slot: s.slot, none: false });
    }
  });

  it('itens têm desc, emoji, raridade válida e tags válidas', () => {
    for (const s of AVATAR_ITEM_SLOTS) {
      for (const i of s.items) {
        const where = `${s.slot}.${i.id}`;
        expect({ where, desc: !!i.desc && i.desc.trim().length > 3 }).toEqual({
          where,
          desc: true,
        });
        expect({ where, emoji: !!i.emoji }).toEqual({ where, emoji: true });
        expect(RARITIES).toContain(i.rarity);
        for (const t of i.tags ?? []) expect(Object.keys(STYLE_TAG_LABEL)).toContain(t);
      }
    }
  });

  it('cores com hex válido', () => {
    for (const s of AVATAR_COLOR_SLOTS) for (const c of s.items) expect({ id: c.id, ok: HEX.test(c.hex) }).toEqual({ id: c.id, ok: true });
  });

  it('itens antigos mantêm id, rótulo e tier', () => {
    for (const [slot, rows] of Object.entries(LEGACY)) {
      for (const [id, label, t] of rows) {
        const got = (ITEM_SLOTS as string[]).includes(slot) ? avatarItem(slot as AvatarItemSlot, id) : avatarColor(slot as AvatarColorSlot, id);
        expect({ slot, id, label: got?.label, tier: got?.tier }).toEqual({
          slot,
          id,
          label,
          tier: TIER_OF[t],
        });
      }
    }
  });

  it('selo "Novo" só nos itens novos (e nunca no "none")', () => {
    const legacy = new Map(Object.entries(LEGACY).map(([slot, rows]) => [slot, new Set(rows.map((r) => r[0]))]));
    for (const s of AVATAR_ITEM_SLOTS) {
      for (const i of s.items) {
        const isLegacy = legacy.get(s.slot)?.has(i.id) ?? false;
        const shouldBeNew = !isLegacy && i.id !== NONE;
        expect({ where: `${s.slot}.${i.id}`, isNew: !!i.isNew }).toEqual({
          where: `${s.slot}.${i.id}`,
          isNew: shouldBeNew,
        });
      }
    }
  });

  it('slots v1.1 declarados batem com os slots novos', () => {
    const OLD = ['body', 'skin', 'hair', 'hairColor', 'face', 'facialHair', 'top', 'topColor', 'bottom', 'bottomColor'];
    OLD.push('shoes', 'shoesColor', 'hat', 'hatColor', 'glasses', 'accessory', 'bag', 'wrist', 'aura');
    const v11 = ALL_SLOTS.filter((s) => !OLD.includes(s));
    expect([...AVATAR_V11_SLOTS].sort()).toEqual(v11.sort());
  });

  it('avatarSlotDef lança pra slot desconhecido', () => {
    expect(() => avatarSlotDef('nope' as AvatarSlot)).toThrow();
  });
});

describe('pele', () => {
  it('tons naturais em ordem de claro → escuro, com degraus perceptíveis', () => {
    const natural = SKIN_COLORS.filter((c) => /^s\d+$/.test(c.id));
    expect(natural).toHaveLength(14);
    for (let i = 1; i < natural.length; i++) {
      const prev = lightness(natural[i - 1].hex);
      const cur = lightness(natural[i].hex);
      expect({ pair: `${natural[i - 1].id}>${natural[i].id}`, ok: prev - cur >= 1.5 }).toEqual({
        pair: `${natural[i - 1].id}>${natural[i].id}`,
        ok: true,
      });
    }
    // cobre do muito claro ao muito escuro
    expect(lightness(natural[0].hex)).toBeGreaterThan(88);
    expect(lightness(natural[natural.length - 1].hex)).toBeLessThan(20);
  });

  it('cada tom tem descrição acessível (subtom)', () => {
    for (const c of SKIN_COLORS) expect(c.desc).toBeTruthy();
  });

  it('peles de fantasia ficam depois das naturais', () => {
    const idx = SKIN_COLORS.findIndex((c) => c.id.startsWith('f_'));
    expect(SKIN_COLORS.slice(idx).every((c) => c.id.startsWith('f_'))).toBe(true);
  });
});

describe('pets e veículos', () => {
  it('pets têm petPoses do SPEC (a primeira é a padrão); só pets têm petPoses', () => {
    for (const s of AVATAR_ITEM_SLOTS) {
      for (const i of s.items) {
        if (s.slot === 'pet' && i.id !== NONE) {
          expect({ id: i.id, poses: i.petPoses }).toEqual({
            id: i.id,
            poses: PET_POSES_SPEC[i.id].split(' '),
          });
          for (const p of i.petPoses ?? []) expect(POSES).toContain(p);
          expect(new Set(i.petPoses).size).toBe(i.petPoses?.length);
        } else {
          expect({ where: `${s.slot}.${i.id}`, poses: i.petPoses }).toEqual({
            where: `${s.slot}.${i.id}`,
            poses: undefined,
          });
        }
      }
    }
    expect(petPosesOf('arara')).toEqual(['shoulder', 'float']);
    expect(petPosesOf(NONE)).toEqual([]);
    expect(petPosesOf('nope')).toEqual([]);
    expect(petPosesOf(null)).toEqual([]);
  });

  it('veículos têm mount do SPEC; só veículos têm mount', () => {
    for (const s of AVATAR_ITEM_SLOTS) {
      for (const i of s.items) {
        if (s.slot === 'vehicle' && i.id !== NONE) {
          expect({ id: i.id, mount: i.mount }).toEqual({ id: i.id, mount: MOUNT_SPEC[i.id] });
          expect(MOUNTS).toContain(i.mount);
        } else {
          expect({ where: `${s.slot}.${i.id}`, mount: i.mount }).toEqual({
            where: `${s.slot}.${i.id}`,
            mount: undefined,
          });
        }
      }
    }
    expect(vehicleMountOf('car')).toBe('cover');
    expect(vehicleMountOf('wheelchair')).toBe('seat');
    expect(vehicleMountOf(NONE)).toBeNull();
    expect(vehicleMountOf('nope')).toBeNull();
    expect(vehicleMountOf(undefined)).toBeNull();
  });
});

describe('animados', () => {
  it('auras novas e todas as animações (menos "none") são animadas', () => {
    for (const i of avatarSlotDef('aura').items) {
      expect({ id: i.id, animated: isAnimatedItem('aura', i.id) }).toEqual({
        id: i.id,
        animated: !!i.isNew,
      });
    }
    for (const i of avatarSlotDef('emote').items) {
      expect({ id: i.id, animated: isAnimatedItem('emote', i.id) }).toEqual({
        id: i.id,
        animated: i.id !== NONE,
      });
    }
    expect(isAnimatedItem('hair', 'short')).toBe(false);
    expect(isAnimatedItem('aura', 'nope')).toBe(false);
  });
});

describe('bandeiras', () => {
  it('listras com hex válido, pesos positivos e overlay conhecido', () => {
    expect(PRIDE_FLAGS.map((f) => f.id)).toEqual(SPEC.prideFlag.split(' '));
    for (const f of PRIDE_FLAGS) {
      expect(f.stripes.length).toBeGreaterThan(0);
      for (const s of f.stripes) {
        expect({ flag: f.id, hex: s.hex, ok: HEX.test(s.hex) }).toEqual({
          flag: f.id,
          hex: s.hex,
          ok: true,
        });
        if (s.w !== undefined) expect(s.w).toBeGreaterThan(0);
      }
      if (f.overlay) expect(['progress', 'intersex', 'demi', 'ally']).toContain(f.overlay);
      expect(avatarItem('prideFlag', f.id)?.label).toBe(f.label);
    }
  });

  it('listras oficiais', () => {
    const hex = (id: string) => prideFlagDef(id).stripes.map((s) => s.hex.slice(1));
    expect(hex('rainbow')).toEqual(['E40303', 'FF8C00', 'FFED00', '008026', '004DFF', '750787']);
    expect(hex('trans')).toEqual(['5BCEFA', 'F5A9B8', 'FFFFFF', 'F5A9B8', '5BCEFA']);
    expect(prideFlagDef('bi').stripes).toEqual([
      { hex: '#D60270', w: 2 },
      { hex: '#9B4F96', w: 1 },
      { hex: '#0038A8', w: 2 },
    ]);
    expect(prideFlagDef('progress').overlay).toBe('progress');
    expect(prideFlagDef('intersex')).toMatchObject({
      overlay: 'intersex',
      stripes: [{ hex: '#FFD800' }],
    });
    expect(prideFlagDef('demi').overlay).toBe('demi');
    expect(prideFlagDef('ally').overlay).toBe('ally');
  });

  it('reserva arco-íris', () => {
    expect(prideFlagDef('nope').id).toBe('rainbow');
    expect(prideFlagDef(null).id).toBe('rainbow');
  });
});

describe('categorias', () => {
  const ioniconsMap = (() => {
    // o mapa de glifos do Ionicons do @expo/vector-icons (na raiz do monorepo); se não achar, só confere não-vazio
    let dir = __dirname;
    for (let i = 0; i < 8; i++) {
      const p = path.join(dir, 'node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json');
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, number>;
      dir = path.dirname(dir);
    }
    return null;
  })();

  it('chaves e rótulos do SPEC, ícones válidos do Ionicons', () => {
    expect(AVATAR_CATEGORIES.map((c) => `${c.key}:${c.label}`)).toEqual([
      'look:Visual',
      'hair:Cabelo',
      'clothes:Roupas',
      'accessories:Acessórios',
      'pride:Orgulho',
      'effects:Efeitos',
      'emotes:Animações',
      'pets:Pets',
      'rides:Veículos',
      'held:Na mão',
    ]);
    for (const c of AVATAR_CATEGORIES) {
      expect(c.icon.trim().length).toBeGreaterThan(0);
      if (ioniconsMap) expect({ icon: c.icon, ok: c.icon in ioniconsMap }).toEqual({ icon: c.icon, ok: true });
    }
  });

  it('todo slot aparece numa categoria só, e a categoria do slot bate', () => {
    const seen = new Map<string, string>();
    for (const c of AVATAR_CATEGORIES) {
      const own = [...c.slots, ...Object.values(c.chipsOf ?? {}), ...Object.values(c.colorOf ?? {}), ...(c.extraColors ?? [])] as string[];
      for (const s of new Set(own)) {
        expect({ slot: s, twice: seen.has(s) }).toEqual({ slot: s, twice: false });
        seen.set(s, c.key);
      }
      for (const k of Object.keys(c.colorOf ?? {})) expect(c.slots).toContain(k);
      for (const k of Object.keys(c.chipsOf ?? {})) expect(c.slots).toContain(k);
    }
    for (const slot of ALL_SLOTS) {
      expect({ slot, cat: seen.get(slot) }).toEqual({ slot, cat: avatarCategoryOf(slot) });
    }
  });

  it('cores e chips do SPEC', () => {
    const byKey = Object.fromEntries(AVATAR_CATEGORIES.map((c) => [c.key, c]));
    expect(byKey.look.extraColors).toEqual(['skin', 'eyeColor']);
    expect(byKey.hair.colorOf).toEqual({ hair: 'hairColor', facialHair: 'hairColor' });
    expect(byKey.effects.chipsOf).toEqual({ aura: 'auraLevel' });
    expect(byKey.pets.chipsOf).toEqual({ pet: 'petPose' });
    expect(byKey.rides.colorOf).toEqual({ vehicle: 'vehicleColor' });
  });
});

describe('rótulos e textos', () => {
  it('tiers, raridades e estilos em pt-BR', () => {
    expect(TIER_LABEL).toEqual({
      free: 'Grátis',
      premium: 'Premium',
      plus: 'Premium+',
      event: 'Evento',
    });
    expect(RARITY_LABEL).toEqual({
      common: 'Comum',
      rare: 'Raro',
      epic: 'Épico',
      legendary: 'Lendário',
    });
    expect(Object.keys(STYLE_TAG_LABEL)).toHaveLength(10);
    expect(avatarUnlockText('free')).toBe('Liberado pra todo mundo');
    expect(avatarUnlockText('premium')).toBe('Incluído no Premium e no Premium+');
    expect(avatarUnlockText('plus')).toBe('Exclusivo do Premium+');
    expect(avatarUnlockText('event')).toBe('Item de evento — chega em breve');
  });

  it('rótulos dos slots novos', () => {
    const want: Record<string, string> = {
      faceShape: 'Rosto',
      eyes: 'Olhos',
      brows: 'Sobrancelhas',
      nose: 'Nariz',
      face: 'Expressão',
      lines: 'Marcas do tempo',
      faceDetail: 'Detalhes',
      outer: 'Sobreposição',
      neck: 'Pescoço',
      bag: 'Bolsa e costas',
      pride: 'Itens',
      prideFlag: 'Bandeira',
      pronouns: 'Pronomes',
      aura: 'Aura',
      auraLevel: 'Intensidade',
      backdrop: 'Fundo',
      emote: 'Animação',
      pet: 'Pet',
      petPose: 'Posição',
      vehicle: 'Veículo',
      held: 'Na mão',
      eyeColor: 'Cor dos olhos',
      outerColor: 'Cor da sobreposição',
      auraColor: 'Cor da aura',
      vehicleColor: 'Cor do veículo',
    };
    for (const [slot, label] of Object.entries(want)) expect({ slot, label: avatarSlotDef(slot as AvatarSlot).label }).toEqual({ slot, label });
  });

  it('helpers de cor, aura e pronomes', () => {
    expect(avatarColorHex('auraColor', 'a_auto')).toBe('#FFFFFF');
    expect(avatarAuraTint('a_auto')).toBeNull();
    expect(avatarAuraTint('a_lime')).toBe('#7FFF00');
    expect(avatarAuraTint('nope')).toBeNull();
    expect(avatarColorHex('skin', 'nope')).toBe(SKIN_COLORS[0].hex);
    expect(avatarColorHex('eyeColor', 'e_dark')).toBe('#3B2416');
    expect(avatarPronounsLabel('elu')).toBe('elu/delu');
    expect(avatarPronounsLabel(NONE)).toBeNull();
    expect(avatarPronounsLabel('nope')).toBeNull();
    expect(avatarRarityOf('topColor', 'c_gold')).toBe('rare');
    expect(avatarRarityOf('hair', 'nope')).toBe('common');
  });
});

describe('looks prontos', () => {
  const FORBIDDEN = [
    'body',
    'skin',
    'faceShape',
    'eyes',
    'eyeColor',
    'brows',
    'nose',
    'face',
    'hair',
    'hairColor',
    'facialHair',
    'lines',
    'faceDetail',
    'pronouns',
    'prideFlag',
  ];

  it('cerca de 10 looks, ids únicos, tag e textos preenchidos', () => {
    expect(AVATAR_LOOKS.length).toBeGreaterThanOrEqual(10);
    expect(new Set(AVATAR_LOOKS.map((l) => l.id)).size).toBe(AVATAR_LOOKS.length);
    for (const l of AVATAR_LOOKS) {
      expect(l.label.trim()).not.toBe('');
      expect(l.desc.trim()).not.toBe('');
      expect(Object.keys(STYLE_TAG_LABEL)).toContain(l.tag);
    }
    const tagsCovered = new Set(AVATAR_LOOKS.map((l) => l.tag));
    for (const t of ['casual', 'elegante', 'urbano', 'fantasia', 'futurista', 'festa', 'atemporal', 'praia', 'orgulho', 'esporte']) {
      expect(tagsCovered.has(t as never)).toBe(true);
    }
  });

  it('só slots de look, nunca slots da pessoa, e só ids válidos', () => {
    for (const s of FORBIDDEN) expect(AVATAR_LOOK_SLOTS).not.toContain(s);
    for (const l of AVATAR_LOOKS) {
      for (const [slot, id] of Object.entries(l.set)) {
        expect({
          look: l.id,
          slot,
          allowed: (AVATAR_LOOK_SLOTS as string[]).includes(slot),
        }).toEqual({ look: l.id, slot, allowed: true });
        expect(FORBIDDEN).not.toContain(slot);
        const exists = (ITEM_SLOTS as string[]).includes(slot)
          ? !!avatarItem(slot as AvatarItemSlot, String(id))
          : !!avatarColor(slot as AvatarColorSlot, String(id));
        expect({ look: l.id, slot, id, exists }).toEqual({ look: l.id, slot, id, exists: true });
      }
    }
  });

  it('todo look define a roupa inteira (sem sobra do look anterior)', () => {
    for (const l of AVATAR_LOOKS) {
      for (const s of [
        'top',
        'topColor',
        'outer',
        'bottom',
        'bottomColor',
        'shoes',
        'shoesColor',
        'hat',
        'neck',
        'bag',
        'wrist',
        'held',
        'aura',
        'backdrop',
      ]) {
        expect({ look: l.id, slot: s, has: s in l.set }).toEqual({
          look: l.id,
          slot: s,
          has: true,
        });
      }
    }
  });

  it('nenhum look põe item protegido nem item de evento', () => {
    for (const l of AVATAR_LOOKS) {
      for (const [slot, ids] of Object.entries(AVATAR_PROTECTED_ITEMS)) {
        const v = (l.set as Record<string, string | undefined>)[slot];
        if (v) expect(ids).not.toContain(v);
      }
      expect(avatarLookTier(l.id)).not.toBe('event');
    }
  });

  it('tier do look é o maior tier dos itens', () => {
    expect(avatarLookTier('casual')).toBe('free');
    expect(avatarLookTier('orgulho')).toBe('free');
    expect(avatarLookTier('futurista')).toBe('premium');
    expect(avatarLookTier('nope')).toBe('free');
    const free = AVATAR_LOOKS.filter((l) => avatarLookTier(l.id) === 'free');
    expect(free.length).toBeGreaterThanOrEqual(5); // a maioria dos looks é grátis
  });
});
