import type { AvatarColorSlot, AvatarConfig, AvatarItemSlot } from '@cruzei/shared-types';
import { AVATAR_COLOR_SLOTS, AVATAR_ITEM_SLOTS, DEFAULT_AVATAR, normalizeAvatarConfig } from '@cruzei/shared-utils';

import { buildAvatarLayers, buildAvatarRig, layersWithTag } from '../layers';
import { AVATAR_GROUPS, type AvatarGradient, type AvatarLayer, type AvatarRig } from '../types';

const BAD = /NaN|Infinity|undefined|null/;

function gradOk(g: AvatarGradient | undefined): boolean {
  if (!g) return true;
  const nums = g.t === 'l' ? [g.x1, g.y1, g.x2, g.y2] : [g.cx, g.cy, g.r, g.fx ?? 0, g.fy ?? 0];
  return nums.every(Number.isFinite) && g.s.length > 0 && g.s.every((st) => Number.isFinite(st[0]) && typeof st[1] === 'string');
}

function assertLayers(layers: AvatarLayer[], where: string): void {
  expect(Array.isArray(layers)).toBe(true);
  for (const l of layers) {
    const ctx = `${where}: ${JSON.stringify(l).slice(0, 160)}`;
    if (typeof l.d !== 'string' || l.d.length < 3 || BAD.test(l.d)) throw new Error(`path inválido em ${ctx}`);
    if (l.cp != null && (l.cp.length < 3 || BAD.test(l.cp))) throw new Error(`recorte inválido em ${ctx}`);
    if (l.g != null && !AVATAR_GROUPS.includes(l.g)) throw new Error(`grupo desconhecido em ${ctx}`);
    if (!l.f && !l.s && !l.gf && !l.gs) throw new Error(`camada sem tinta em ${ctx}`);
    for (const n of [l.w, l.o, l.b]) if (n != null && !Number.isFinite(n)) throw new Error(`número inválido em ${ctx}`);
    if (l.o != null && (l.o < 0 || l.o > 1)) throw new Error(`opacidade fora de 0..1 em ${ctx}`);
    if (l.da && !l.da.every((x) => Number.isFinite(x) && x >= 0)) throw new Error(`tracejado inválido em ${ctx}`);
    if (!gradOk(l.gf) || !gradOk(l.gs)) throw new Error(`gradiente inválido em ${ctx}`);
  }
}

function assertRig(rig: AvatarRig, where: string): void {
  const pts = [rig.body, rig.head, rig.armL, rig.armR, rig.foreL, rig.foreR, rig.legL, rig.legR, rig.shinL, rig.shinR, rig.mount, rig.pet];
  for (const p of pts) if (!p.every(Number.isFinite)) throw new Error(`pivô inválido em ${where}`);
  expect(['root', 'body']).toContain(rig.petAttach);
}

const base = normalizeAvatarConfig(DEFAULT_AVATAR) as AvatarConfig;

describe('buildAvatarLayers', () => {
  it('monta a config padrão sem NaN, com pivôs finitos', () => {
    const layers = buildAvatarLayers(base, { groundShadow: true });
    expect(layers.length).toBeGreaterThan(10);
    assertLayers(layers, 'padrão');
    assertRig(buildAvatarRig(base), 'padrão');
  });

  it.each(AVATAR_ITEM_SLOTS.map((s) => [s.slot, s.items.map((i) => i.id)] as const))('todos os itens do slot %s', (slot, ids) => {
    for (const id of ids) {
      const cfg = { ...base, [slot as AvatarItemSlot]: id } as AvatarConfig;
      const where = `${slot}=${id}`;
      expect(() => buildAvatarLayers(cfg, { groundShadow: true })).not.toThrow();
      assertLayers(buildAvatarLayers(cfg, { groundShadow: true }), where);
      assertLayers(buildAvatarLayers(cfg, { mode: 'bust' }), `${where} (busto)`);
      assertRig(buildAvatarRig(cfg), where);
    }
  });

  it.each(AVATAR_COLOR_SLOTS.map((s) => [s.slot, s.items.map((i) => i.id)] as const))('todas as cores do slot %s', (slot, ids) => {
    for (const id of ids) {
      const cfg = { ...base, [slot as AvatarColorSlot]: id } as AvatarConfig;
      assertLayers(buildAvatarLayers(cfg), `${slot}=${id}`);
    }
  });

  it('veículo × pet × posição do pet não quebra', () => {
    const vehicles = AVATAR_ITEM_SLOTS.find((s) => s.slot === 'vehicle')?.items.map((i) => i.id) ?? ['none'];
    const pets = AVATAR_ITEM_SLOTS.find((s) => s.slot === 'pet')?.items.map((i) => i.id) ?? ['none'];
    for (const vehicle of vehicles) {
      for (const pet of pets.slice(0, 6)) {
        for (const petPose of ['side', 'arms', 'shoulder', 'float']) {
          const cfg = { ...base, vehicle, pet, petPose, held: 'rose', pride: 'flag' } as AvatarConfig;
          const where = `${vehicle}/${pet}/${petPose}`;
          assertLayers(buildAvatarLayers(cfg, { groundShadow: true }), where);
          assertRig(buildAvatarRig(cfg), where);
        }
      }
    }
  });

  it('config antiga sem os slots novos continua desenhando (padrão nos slots que faltam)', () => {
    const legacy = { v: 1, body: 'broad', skin: 's5', hair: 'long', hairColor: 'h_gray', face: 'wink', facialHair: 'none', top: 'shirt', topColor: 'c_olive', bottom: 'skirt', bottomColor: 'c_gray', shoes: 'sneakers', shoesColor: 'c_beige', hat: 'none', hatColor: 'c_white', glasses: 'none', accessory: 'scarf', bag: 'backpack', wrist: 'bracelet', aura: 'none' } as unknown as AvatarConfig;
    const layers = buildAvatarLayers(legacy);
    assertLayers(layers, 'legado cru');
    // cachecol antigo (slot accessory) ainda aparece mesmo sem normalizar
    expect(layers.some((l) => l.f === '#C0392B')).toBe(true);
  });

  it('expressão sai etiquetada k:face no grupo da cabeça', () => {
    const faces = layersWithTag(buildAvatarLayers(base), 'face');
    expect(faces.length).toBeGreaterThan(2);
    expect(faces.every((l) => l.g === 'head')).toBe(true);
  });

  it('braços e pernas usam os grupos de junta (antebraço e canela)', () => {
    const groups = new Set(buildAvatarLayers(base).map((l) => l.g));
    for (const g of ['armL', 'armR', 'foreL', 'foreR', 'legL', 'legR', 'shinL', 'shinR'] as const) expect(groups.has(g)).toBe(true);
  });

  it('busto não desenha pernas nem sapatos', () => {
    const groups = new Set(buildAvatarLayers(base, { mode: 'bust' }).map((l) => l.g));
    expect(groups.has('shinL')).toBe(false);
    expect(groups.has('legR')).toBe(false);
  });

  it('é determinístico (mesma config → mesmas camadas)', () => {
    const a = JSON.stringify(buildAvatarLayers(base, { groundShadow: true }));
    const b = JSON.stringify(buildAvatarLayers({ ...base }, { groundShadow: true }));
    expect(a).toBe(b);
  });
});
