import type { AvatarConfig, AvatarPetPose } from '@cruzei/shared-types';
import { DEFAULT_AVATAR, HELD_ITEMS, normalizeAvatarConfig, PET_ITEMS, petPosesOf } from '@cruzei/shared-utils';

import { BODY_SPECS } from '../anatomy';
import { buildAvatarLayers } from '../layers';
import { heldDef, HELD_DEFS, PROP_AXIS } from '../parts/held';
import { petDef, PET_DEFS } from '../parts/pets';
import type { AvatarLayer } from '../types';

const base = normalizeAvatarConfig(DEFAULT_AVATAR) as AvatarConfig;
const cfg = (over: Partial<AvatarConfig>) => ({ ...base, ...over }) as AvatarConfig;
const BODIES = Object.keys(BODY_SPECS);
const PETS = PET_ITEMS.map((i) => i.id).filter((id) => id !== 'none');
const HELD = HELD_ITEMS.map((i) => i.id).filter((id) => id !== 'none');

/** caixa das coordenadas absolutas de um path */
function bbox(d: string): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const seg of d.match(/[A-Za-z][^A-Za-z]*/g) ?? []) {
    const n = (seg.slice(1).match(/-?\d*\.?\d+(?:e-?\d+)?/g) ?? []).map(Number);
    for (let i = 0; i + 1 < n.length; i += 2) {
      x0 = Math.min(x0, n[i]);
      x1 = Math.max(x1, n[i]);
      y0 = Math.min(y0, n[i + 1]);
      y1 = Math.max(y1, n[i + 1]);
    }
  }
  return [x0, y0, x1, y1];
}

function checkLayers(ls: AvatarLayer[], at: string, box: [number, number, number, number]): void {
  for (const l of ls) {
    const s = JSON.stringify(l);
    if (!l.d || l.d.length < 3 || /NaN|Infinity|undefined|null/.test(s)) throw new Error(`camada inválida ${at}: ${s.slice(0, 140)}`);
    const [x0, y0, x1, y1] = bbox(l.cp ?? l.d);
    if (x0 < box[0] || y0 < box[1] || x1 > box[2] || y1 > box[3]) throw new Error(`fora da caixa (${x0.toFixed(1)},${y0.toFixed(1)})-(${x1.toFixed(1)},${y1.toFixed(1)}) ${at}`);
  }
}

describe('pets', () => {
  it('todo pet do catálogo tem desenho próprio (e só eles)', () => {
    expect(PETS.length).toBe(24);
    for (const id of PETS) expect(petDef(id)).not.toBeNull();
    expect(Object.keys(PET_DEFS).sort()).toEqual([...PETS].sort());
    expect(petDef('none')).toBeNull();
    expect(petDef('dinossauro')).toBeNull();
    // nada de reaproveitar o desenho de um bicho em outro
    const draws = new Set(PETS.map((id) => PET_DEFS[id]));
    expect(draws.size).toBe(PETS.length);
  });

  it.each(PETS)('%s: toda posição aceita, todo corpo, completo e lite — camadas válidas, grupo e etiqueta pet, dentro do viewBox', (pet) => {
    for (const petPose of petPosesOf(pet) as AvatarPetPose[]) {
      for (const body of BODIES) {
        for (const lod of [undefined, 'lite'] as const) {
          const ls = buildAvatarLayers(cfg({ pet, petPose, body }), { groundShadow: true, lod } as never).filter((l) => l.k === 'pet');
          expect(ls.length).toBeGreaterThan(lod ? 3 : 8);
          for (const l of ls) expect(l.g).toBe('pet');
          checkLayers(ls, `${pet}/${petPose}/${body}/${lod ?? 'full'}`, [-2, -2, 102, 141]);
        }
      }
    }
  });

  it('lite tem bem menos camadas que o completo', () => {
    for (const pet of PETS) {
      const petPose = petPosesOf(pet)[0] as AvatarPetPose;
      const full = buildAvatarLayers(cfg({ pet, petPose })).filter((l) => l.k === 'pet');
      const lite = buildAvatarLayers(cfg({ pet, petPose }), { lod: 'lite' } as never).filter((l) => l.k === 'pet');
      expect(lite.length).toBeLessThan(full.length);
      expect(lite.filter((l) => l.b).length).toBeLessThanOrEqual(3);
    }
  });

  it('busto: só ombro e flutuando aparecem', () => {
    for (const [pet, petPose, shows] of [
      ['cat_orange', 'shoulder', true],
      ['dragon', 'float', true],
      ['dog_caramel', 'side', false],
      ['cat_orange', 'arms', false],
    ] as const) {
      const ls = buildAvatarLayers(cfg({ pet, petPose }), { mode: 'bust' }).filter((l) => l.k === 'pet');
      expect(ls.length > 0).toBe(shows);
    }
  });

  it('com veículo o pet continua válido (passageiro, em cima do tapete, no colo da cadeira)', () => {
    for (const vehicle of ['car', 'moto', 'bike', 'wheelchair', 'carpet', 'ufo', 'skate']) {
      for (const [pet, petPose] of [
        ['dog_caramel', 'side'],
        ['cat_orange', 'arms'],
        ['hamster', 'shoulder'],
        ['phoenix', 'float'],
      ] as const) {
        const ls = buildAvatarLayers(cfg({ pet, petPose, vehicle }), { groundShadow: true }).filter((l) => l.k === 'pet');
        expect(ls.length).toBeGreaterThan(0);
        checkLayers(ls, `${vehicle}/${pet}/${petPose}`, [-6, -6, 106, 146]);
      }
    }
  });
});

describe('objetos na mão', () => {
  it('todo objeto do catálogo tem desenho próprio (e só eles)', () => {
    expect(HELD.length).toBe(26);
    for (const id of HELD) expect(heldDef(id)).not.toBeNull();
    expect(Object.keys(HELD_DEFS).sort()).toEqual([...HELD].sort());
    expect(heldDef('none')).toBeNull();
    const draws = new Set(HELD.map((id) => HELD_DEFS[id].draw));
    expect(draws.size).toBe(HELD.length);
  });

  it('os props das animações existem', () => {
    for (const id of ['guitar', 'mic', 'tambourine', 'wand', 'rose']) {
      expect(heldDef(id)).not.toBeNull();
      expect(PROP_AXIS[id]).toBeDefined();
    }
  });

  it.each(HELD)('%s: todo corpo, completo e lite — no antebraço direito, etiqueta held, dentro do viewBox', (held) => {
    for (const body of BODIES) {
      for (const lod of [undefined, 'lite'] as const) {
        const ls = buildAvatarLayers(cfg({ held, body }), { lod } as never).filter((l) => l.k === 'held');
        expect(ls.length).toBeGreaterThan(2);
        for (const l of ls) expect(l.g).toBe('foreR');
        checkLayers(ls, `${held}/${body}/${lod ?? 'full'}`, [-1, 0, 101, 140]);
      }
    }
  });

  it('volante, guidão e pet no colo escondem o objeto', () => {
    for (const over of [{ vehicle: 'car' }, { vehicle: 'moto' }, { pet: 'cat_orange', petPose: 'arms' }] as const) {
      const ls = buildAvatarLayers(cfg({ held: 'rose', ...over })).filter((l) => l.k === 'held');
      expect(ls).toHaveLength(0);
    }
  });
});
