// Correções finais da fase 2 (crítica visual): colo sem braços em X e pet que desce do colo nas animações de braço,
// durag como turbante, crista do moicano embaixo de coroa, cabelo com turbante, formatos de rosto distintos, pele muito
// clara com sombra visível e o filtro da miniatura de lista.
import type { AvatarConfig } from '@cruzei/shared-types';
import { DEFAULT_AVATAR, normalizeAvatarConfig } from '@cruzei/shared-utils';

import { FACE_SPECS, hairLiftOf } from '../anatomy';
import { createCtx } from '../ctx';
import { hairBack } from '../parts/hair';
import { hatFlattensCrest, hatModeOf } from '../parts/hat-modes';
import { cradleHands } from '../parts/pets';
import { zero } from '../pose';
import { CRADLE_ARMS, applyScene, resolveScene } from '../scene';
import { lum, skinTones } from '../shading';
import { microLayers } from '../svgModel';
import type { AvatarLayer } from '../types';

const base = normalizeAvatarConfig(DEFAULT_AVATAR) as AvatarConfig;
const cfg = (p: Partial<AvatarConfig>) => normalizeAvatarConfig({ ...base, ...p }) as AvatarConfig;

type P2 = readonly [number, number];
/** os segmentos ab e cd se cruzam? */
function crosses(a: P2, b: P2, c: P2, d: P2): boolean {
  const o = (p: P2, q: P2, r: P2) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}

describe('pet no colo', () => {
  it('braços do colo: um por baixo, outro por cima — as mãos não trocam de lado (sem X)', () => {
    const s = resolveScene(cfg({ pet: 'pug', petPose: 'arms' }));
    expect(s.hands).toBe('cradle');
    expect(s.arms).toEqual([...CRADLE_ARMS]);
    for (const body of ['slim', 'regular', 'plus', 'curvy', 'athletic'] as const) {
      const c = cfg({ body, pet: 'pug', petPose: 'arms' });
      const h = cradleHands(createCtx(c, resolveScene(c), {}));
      // a mão esquerda (apoio) fica mais baixa que a direita e os antebraços não se cruzam (empilhados, sem X)
      expect(h.L[1]).toBeGreaterThan(h.R[1]);
      expect(crosses(h.elbowL, h.L, h.elbowR, h.R)).toBe(false);
    }
  });

  it('animação que usa os braços: o bicho desce pro chão ao lado; sem ela, fica no colo', () => {
    const s = resolveScene(cfg({ pet: 'cat_black', petPose: 'arms' }));
    expect(s.petDrop).toHaveLength(2);
    const free = applyScene(zero(), s, 0, { usesArms: true });
    expect(free.pet?.dx).toBeGreaterThan(10);
    expect(free.pet?.dy).toBeGreaterThan(30);
    expect([free.pet?.dx, free.pet?.dy, free.armL.r, free.foreR?.r ?? 0].every(Number.isFinite)).toBe(true);
    const held = applyScene(zero(), s, 0);
    expect(held.pet).toBeUndefined();
    expect(held.armL.r).toBe(CRADLE_ARMS[0]);
    expect(held.foreR?.r).toBe(CRADLE_ARMS[3]);
  });

  it('na cadeira de rodas o bicho fica no colo (sem petDrop)', () => {
    expect(resolveScene(cfg({ vehicle: 'wheelchair', pet: 'cat_black', petPose: 'arms' })).petDrop ?? null).toBeNull();
  });
});

describe('chapéus × cabelo', () => {
  it('durag cobre o cabelo inteiro como o turbante', () => {
    expect(hatModeOf('durag')).toBe('wrap');
  });

  it('coroa, chapéu de festa e tiara achatam a crista do moicano (o item senta no crânio)', () => {
    for (const hat of ['crown', 'neon_crown', 'party', 'tiara']) {
      expect(hatFlattensCrest(hat)).toBe(true);
      expect(hairLiftOf('mohawk', hat)).toBeLessThan(2);
    }
    expect(hatFlattensCrest('headband')).toBe(false);
    expect(hairLiftOf('mohawk', 'none')).toBe(10);
    expect(hairLiftOf(null, null, 1.9)).toBe(1.9);
  });

  const backLayers = (p: Partial<AvatarConfig>): AvatarLayer[] => {
    const c = cfg(p);
    const ctx = createCtx(c, resolveScene(c), {});
    hairBack(ctx);
    return ctx.layers;
  };

  it('turbante: cabelo solto e longo sai da nuca; tranças, raspado lateral e presos ficam dentro do pano', () => {
    for (const hair of ['long', 'wavy', 'long_curly', 'curtain']) {
      const l = backLayers({ hair, hat: 'turban' });
      expect(l.length).toBeGreaterThan(0);
      for (const x of l) expect(x.cp && !/NaN/.test(x.cp)).toBeTruthy();
    }
    for (const hair of ['braids', 'twists', 'dreads', 'cornrows', 'side_shave', 'mullet', 'ponytail', 'low_bun']) {
      expect(backLayers({ hair, hat: 'turban' })).toHaveLength(0);
    }
  });
});

describe('rosto e pele', () => {
  it('formatos de rosto com contraste de verdade', () => {
    const F = FACE_SPECS;
    expect(F.round.cheek - F.oval.cheek).toBeGreaterThanOrEqual(1);
    expect(F.oval.chinY - F.round.chinY).toBeGreaterThanOrEqual(1);
    expect(F.long.chinY - F.oval.chinY).toBeGreaterThanOrEqual(1.4);
    // o longo se lê pelo estreitamento (o comprimento é limitado pela proporção adulta de ~5,5 cabeças)
    expect(F.oval.cranium - F.long.cranium).toBeGreaterThanOrEqual(0.6);
    expect(F.oval.cheek - F.long.cheek).toBeGreaterThanOrEqual(0.5);
    expect(F.oval.jaw - F.heart.jaw).toBeGreaterThanOrEqual(1);
    expect(F.square.jawSharp).toBeGreaterThanOrEqual(1);
    expect(F.square.cheek - F.square.jaw).toBeLessThanOrEqual(0.55);
    expect(F.diamond.cheek - F.diamond.temple).toBeGreaterThanOrEqual(2);
  });

  it('pele muito clara (s9) ganha sombra mais forte que uma pele média, em proporção', () => {
    const drop = (hex: string) => {
      const t = skinTones(hex);
      return 1 - lum(t.shade) / lum(t.base);
    };
    expect(drop('#FBE4DC')).toBeGreaterThan(drop('#C68A62') + 0.04);
    // pele escura e fantasia não mudam de regra
    expect(skinTones('#3B2219').dark).toBe(true);
  });
});

describe('miniatura de lista', () => {
  it('microLayers tira véus quase invisíveis e mantém a expressão', () => {
    const L: AvatarLayer[] = [
      { d: 'M0,0L1,1Z', g: 'body', f: '#fff' },
      { d: 'M0,0L1,1Z', g: 'body', f: '#000', o: 0.15, cp: 'M0,0L2,2Z' },
      { d: 'M0,0L1,1Z', g: 'body', f: '#000', o: 0.05 },
      { d: 'M0,0L1,1Z', g: 'head', f: '#000', o: 0.05, k: 'face' },
      { d: 'M0,0L1,1Z', g: 'body', f: '#000', o: 0.5, cp: 'M0,0L2,2Z' },
    ];
    const out = microLayers(L);
    expect(out).toHaveLength(3);
    expect(out[1].k).toBe('face');
  });
});
