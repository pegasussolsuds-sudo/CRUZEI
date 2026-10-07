import type { AvatarConfig, AvatarTier } from '@cruzei/shared-types';
import {
  AVATAR_CATEGORIES,
  AVATAR_ITEM_SLOTS,
  DEFAULT_AVATAR,
  FREE_TIERS,
  PLUS_TIERS,
  PREMIUM_TIERS,
  avatarSlotDef,
  normalizeAvatarConfig,
  type AvatarItemDef,
} from '@cruzei/shared-utils';

import { poseIsFinite } from '../../../avatar/pose';
import {
  EDITOR_CATEGORIES,
  applyItem,
  canUnlockWithPremium,
  categoryOfTab,
  emoteStillPose,
  filterItems,
  lockedEntries,
  secondaryRows,
  surpriseConfig,
  tabKind,
  tabLabel,
  tileA11yLabel,
  tileMode,
  tilePreviewConfig,
  editorCategory,
} from '../editorModel';

const base = normalizeAvatarConfig(DEFAULT_AVATAR);
const cat = (k: string) => editorCategory(k as never);

describe('categorias e abas', () => {
  it('Looks primeiro e depois todas as categorias do catálogo, na ordem', () => {
    expect(EDITOR_CATEGORIES.map((c) => c.key)).toEqual(['looks', ...AVATAR_CATEGORIES.map((c) => c.key)]);
    for (const c of EDITOR_CATEGORIES) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.tabs.length).toBeGreaterThan(0);
    }
  });

  it('todo slot de item do catálogo tem aba, exceto os que viram chips (intensidade e posição do pet)', () => {
    const tabs = new Set(EDITOR_CATEGORIES.flatMap((c) => c.tabs as string[]));
    const missing = AVATAR_ITEM_SLOTS.map((s) => s.slot).filter((s) => !tabs.has(s));
    expect(missing.sort()).toEqual(['auraLevel', 'petPose']);
  });

  it('cores extras do Visual entram logo depois do item delas', () => {
    const t = cat('look').tabs;
    expect(t.indexOf('skin')).toBe(t.indexOf('body') + 1);
    expect(t.indexOf('eyeColor')).toBe(t.indexOf('eyes') + 1);
  });

  it('tipo e rótulo de cada aba', () => {
    expect(tabKind('looks')).toBe('looks');
    expect(tabKind('prideFlag')).toBe('flags');
    expect(tabKind('pronouns')).toBe('pronouns');
    expect(tabKind('skin')).toBe('colors');
    expect(tabKind('hair')).toBe('items');
    expect(tabLabel('skin')).toBe('Tom de pele');
    expect(tabLabel('looks')).toBe('Looks prontos');
    expect(categoryOfTab('vehicle')?.key).toBe('rides');
    expect(categoryOfTab('looks')?.key).toBe('looks');
    expect(categoryOfTab('xyz')).toBeNull();
  });

  it('miniatura: rosto e cabeça no busto, tronco e mão da cintura pra cima, o resto no corpo inteiro', () => {
    expect(tileMode('hair')).toBe('bust');
    expect(tileMode('glasses')).toBe('bust');
    expect(tileMode('top')).toBe('upper');
    expect(tileMode('held')).toBe('upper');
    expect(tileMode('emote')).toBe('upper');
    expect(tileMode('shoes')).toBe('full');
    expect(tileMode('vehicle')).toBe('full');
  });
});

describe('linhas secundárias', () => {
  it('cor do item só quando tem item pra pintar (cabelo sempre)', () => {
    expect(secondaryRows(cat('hair'), 'hair', { ...base, hair: 'bald' }).color).toBe('hairColor');
    expect(secondaryRows(cat('clothes'), 'top', base).color).toBe('topColor');
    expect(secondaryRows(cat('clothes'), 'outer', { ...base, outer: 'none' }).color).toBeNull();
    expect(secondaryRows(cat('clothes'), 'outer', { ...base, outer: 'blazer' }).color).toBe('outerColor');
    expect(secondaryRows(cat('rides'), 'vehicle', { ...base, vehicle: 'bike' }).color).toBe('vehicleColor');
  });

  it('intensidade só com aura; posição do pet só as que o pet aceita (e só se tiver escolha)', () => {
    expect(secondaryRows(cat('effects'), 'aura', base).chips).toBeNull();
    expect(secondaryRows(cat('effects'), 'aura', { ...base, aura: 'galaxy' }).chips).toEqual({ slot: 'auraLevel', ids: ['soft', 'medium', 'max'] });
    expect(secondaryRows(cat('pets'), 'pet', base).chips).toBeNull();
    expect(secondaryRows(cat('pets'), 'pet', { ...base, pet: 'cat_orange' }).chips).toEqual({ slot: 'petPose', ids: ['arms', 'side', 'shoulder'] });
    expect(secondaryRows(cat('pets'), 'pet', { ...base, pet: 'husky' }).chips).toBeNull();
  });

  it('bandeira aparece na aba de itens de orgulho', () => {
    expect(secondaryRows(cat('pride'), 'pride', base).flags).toBe(true);
    expect(secondaryRows(cat('pride'), 'pronouns', base).flags).toBe(false);
  });
});

describe('filtros', () => {
  const items: Pick<AvatarItemDef, 'id' | 'tier' | 'isNew'>[] = [
    { id: 'a', tier: 'free' },
    { id: 'b', tier: 'free', isNew: true },
    { id: 'c', tier: 'premium' },
    { id: 'd', tier: 'plus', isNew: true },
    { id: 'e', tier: 'event' },
  ];
  const ids = (f: Parameters<typeof filterItems>[1], t: ReadonlySet<AvatarTier>) => filterItems(items, f, t).map((i) => i.id);

  it('Todos / Liberados / Premium / Novos', () => {
    expect(ids('all', FREE_TIERS)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(ids('unlocked', FREE_TIERS)).toEqual(['a', 'b']);
    expect(ids('unlocked', PREMIUM_TIERS)).toEqual(['a', 'b', 'c']);
    expect(ids('unlocked', PLUS_TIERS)).toEqual(['a', 'b', 'c', 'd']);
    expect(ids('premium', FREE_TIERS)).toEqual(['c', 'd']);
    expect(ids('new', FREE_TIERS)).toEqual(['b', 'd']);
  });

  it('no catálogo de verdade: "Novos" acha os cabelos novos e "Premium" só premium/plus', () => {
    const hair = avatarSlotDef('hair').items;
    expect(filterItems(hair, 'new', FREE_TIERS).map((i) => i.id)).toContain('pixie');
    expect(filterItems(hair, 'premium', FREE_TIERS).every((i) => i.tier === 'premium' || i.tier === 'plus')).toBe(true);
  });
});

describe('rótulo acessível do tile', () => {
  it('nome, categoria, raridade, estado e como liberar', () => {
    const l = tileA11yLabel({ label: 'Smoking', category: 'Roupas', rarity: 'rare', tier: 'premium', equipped: false, locked: true, isNew: true });
    expect(l).toBe('Smoking. Roupas. Raro. Bloqueado. Incluído no Premium e no Premium+. Novo');
  });
  it('equipado e liberado / experimentando bloqueado / animado', () => {
    expect(tileA11yLabel({ label: 'Camiseta', category: 'Roupas', rarity: 'common', tier: 'free', equipped: true, locked: false })).toBe('Camiseta. Roupas. Comum. Equipado. Liberado');
    expect(tileA11yLabel({ label: 'Supernova', category: 'Efeitos', rarity: 'legendary', tier: 'plus', equipped: true, locked: true, animated: true })).toBe(
      'Supernova. Efeitos. Lendário. Experimentando na prévia. Bloqueado. Exclusivo do Premium+. Animado',
    );
  });
});

describe('aplicar e miniaturas', () => {
  it('trocar o pet acerta a posição; mesmo item devolve a mesma config', () => {
    const a = applyItem({ ...base, petPose: 'shoulder' }, 'pet', 'husky');
    expect(a.pet).toBe('husky');
    expect(a.petPose).toBe('side');
    const b = applyItem({ ...base, petPose: 'shoulder' }, 'pet', 'cat_black');
    expect(b.petPose).toBe('shoulder');
    expect(applyItem(a, 'pet', 'husky')).toBe(a);
  });

  it('capa da bandeira e capa/manto por cima não convivem: vale a última escolhida', () => {
    const a = applyItem({ ...base, outer: 'cape' }, 'pride', 'cape');
    expect([a.pride, a.outer]).toEqual(['cape', 'none']);
    const b = applyItem(a, 'outer', 'mantle');
    expect([b.pride, b.outer]).toEqual(['none', 'mantle']);
  });

  it('animação que pede pet, sem pet: a miniatura ganha um pet de prévia', () => {
    const id = ['pet_love', 'pet_cuddle'].find((e) => tilePreviewConfig(base, 'emote', e).pet !== 'none');
    expect(id).toBeDefined();
    const t = tilePreviewConfig({ ...base, pet: 'none' }, 'emote', id as string);
    expect(t.pet).toBe('cat_orange');
  });

  it('miniatura limpa: sem veículo/pet/aura fora das abas deles; rosto sem chapéu e óculos', () => {
    const cfg: AvatarConfig = { ...base, vehicle: 'car', pet: 'pug', aura: 'galaxy', hat: 'cap', glasses: 'round' };
    const top = tilePreviewConfig(cfg, 'top', 'tux');
    expect([top.top, top.vehicle, top.pet, top.aura, top.hat]).toEqual(['tux', 'none', 'none', 'none', 'cap']);
    const veh = tilePreviewConfig(cfg, 'vehicle', 'moto');
    expect([veh.vehicle, veh.pet]).toEqual(['moto', 'none']);
    const pet = tilePreviewConfig(cfg, 'pet', 'husky');
    expect([pet.pet, pet.petPose, pet.vehicle]).toEqual(['husky', 'side', 'none']);
    expect(tilePreviewConfig(cfg, 'aura', 'flames').aura).toBe('flames');
    const hair = tilePreviewConfig(cfg, 'hair', 'afro');
    expect([hair.hat, hair.glasses]).toEqual(['none', 'round']);
    const eyes = tilePreviewConfig(cfg, 'eyes', 'round');
    expect([eyes.hat, eyes.glasses]).toEqual(['none', 'none']);
    expect(cfg.vehicle).toBe('car'); // não mexe na config original
  });

  it('a miniatura dos outros itens não muda quando o item do próprio slot muda', () => {
    const a = tilePreviewConfig({ ...base, hat: 'beanie' }, 'hat', 'fedora');
    const b = tilePreviewConfig({ ...base, hat: 'cap' }, 'hat', 'fedora');
    expect(a).toEqual(b);
  });

  it('pose parada de toda animação registrada é finita (e id sem animação dá null)', () => {
    for (const it of avatarSlotDef('emote').items) {
      const p = emoteStillPose(it.id);
      if (p) expect(poseIsFinite(p)).toBe(true);
    }
    expect(emoteStillPose('none')).toBeNull();
    expect(emoteStillPose('nao-existe')).toBeNull();
  });

  it('miniaturas de gesto diferentes entre si: nenhum par com braços e pernas quase iguais (beijo = acenar, vitória = pulo = estrelas = fogos)', () => {
    const ids = ['wave', 'kiss', 'victory', 'jump', 'starfall', 'fireworks', 'flex', 'magic', 'greet'];
    const sig = (id: string) => {
      const p = emoteStillPose(id)!;
      return [p.armL.r, p.armR.r, p.foreL?.r ?? 0, p.foreR?.r ?? 0, p.legL?.r ?? 0, p.legR?.r ?? 0, p.shinL?.r ?? 0, p.shinR?.r ?? 0];
    };
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = sig(ids[i]);
        const b = sig(ids[j]);
        const far = Math.max(...a.map((v, k) => Math.abs(v - b[k])));
        expect({ par: `${ids[i]}×${ids[j]}`, distinto: far > 25 }).toEqual({ par: `${ids[i]}×${ids[j]}`, distinto: true });
      }
    }
  });
});

describe('itens bloqueados na prévia', () => {
  it('lista itens e cores fora do plano com rótulo e tier', () => {
    const cfg: AvatarConfig = { ...base, top: 'tux', aura: 'supernova', hairColor: 'h_teal' };
    const e = lockedEntries(cfg, FREE_TIERS);
    expect(e.map((x) => x.slot).sort()).toEqual(['aura', 'hairColor', 'top']);
    expect(e.find((x) => x.slot === 'top')).toMatchObject({ label: 'Smoking', tier: 'premium' });
    expect(e.find((x) => x.slot === 'hairColor')).toMatchObject({ label: 'Cor do cabelo: Turquesa', tier: 'premium' });
    expect(lockedEntries(cfg, PREMIUM_TIERS).map((x) => x.slot)).toEqual(['aura']);
    expect(lockedEntries(cfg, PLUS_TIERS)).toEqual([]);
  });

  it('"Ver Premium" só faz sentido se tiver algo que a assinatura libera', () => {
    expect(canUnlockWithPremium([{ slot: 'hat', id: 'crown', label: 'Coroa', tier: 'event' }])).toBe(false);
    expect(canUnlockWithPremium([{ slot: 'aura', id: 'supernova', label: 'Supernova', tier: 'plus' }])).toBe(true);
  });
});

describe('Surpreender', () => {
  it('fica dentro do plano e mantém o que é da pessoa (pronomes, bandeira, hijab, cadeira de rodas)', () => {
    const cur: AvatarConfig = { ...base, pronouns: 'elu', prideFlag: 'trans', pride: 'pin', hat: 'hijab', hatColor: 'c_navy', vehicle: 'wheelchair', vehicleColor: 'c_red', accessory: 'hearing_aid' };
    for (const seed of ['a', 'b', 'c', 'd']) {
      const next = surpriseConfig(seed, cur, null, FREE_TIERS);
      expect(lockedEntries(next, FREE_TIERS)).toEqual([]);
      expect([next.pronouns, next.prideFlag, next.pride, next.hat, next.hatColor, next.vehicle, next.vehicleColor, next.accessory]).toEqual([
        'elu',
        'trans',
        'pin',
        'hijab',
        'c_navy',
        'wheelchair',
        'c_red',
        'hearing_aid',
      ]);
    }
  });

  it('sem item protegido, o sorteio decide chapéu e veículo', () => {
    const next = surpriseConfig('x', { ...base, hat: 'fedora', vehicle: 'bike' }, null, FREE_TIERS);
    expect(next.vehicle).toBe('none');
  });
});
