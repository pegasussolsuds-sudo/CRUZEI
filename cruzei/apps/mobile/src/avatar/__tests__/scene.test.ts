import type { AvatarConfig } from '@cruzei/shared-types';
import { DEFAULT_AVATAR, normalizeAvatarConfig } from '@cruzei/shared-utils';

import { SEAT_DROP } from '../anatomy';
import { buildAvatarLayers, buildAvatarRig } from '../layers';
import { idle, NEUTRAL_VARIATION, poseIsFinite, zero } from '../pose';
import { applyScene, EMPTY_SCENE, HAND_POSES, resolveScene } from '../scene';

const base = normalizeAvatarConfig(DEFAULT_AVATAR) as AvatarConfig;
const cfg = (over: Partial<AvatarConfig>) => ({ ...base, ...over }) as AvatarConfig;

describe('resolveScene', () => {
  it('sem veículo e sem pet = cena vazia', () => {
    expect(resolveScene(base)).toEqual(EMPTY_SCENE);
  });

  it.each(['car', 'classic', 'jeep', 'sport'])('carro %s: pernas escondidas, mãos no volante, objeto e bandeirinha somem', (vehicle) => {
    const s = resolveScene(cfg({ vehicle }));
    expect(s.mount).toBe('cover');
    expect(s.hideLegs).toBe(true);
    expect(s.hands).toBe('wheel');
    expect(s.showHeld).toBe(false);
    expect(s.showLeftHandFlag).toBe(false);
  });

  it('carro com pet no colo: pet vira passageiro (ao lado)', () => {
    const s = resolveScene(cfg({ vehicle: 'car', pet: 'cat_orange', petPose: 'arms' }));
    expect(s.petPose).toBe('side');
    expect(s.hands).toBe('wheel');
  });

  it.each(['bike', 'moto', 'lambreta'])('%s: pernas abertas, mãos no guidão, pet do colo vai pro lado', (vehicle) => {
    const s = resolveScene(cfg({ vehicle, pet: 'pug', petPose: 'arms' }));
    expect(s.mount).toBe('straddle');
    expect(s.hands).toBe('bars');
    expect(s.showHeld).toBe(false);
    expect(s.petPose).toBe('side');
    expect(s.hideLegs).toBe(false);
  });

  it('patinete: mãos no guidão; skate e hoverboard: mãos livres', () => {
    expect(resolveScene(cfg({ vehicle: 'kick' })).hands).toBe('bars');
    expect(resolveScene(cfg({ vehicle: 'skate' })).hands).toBe('free');
    expect(resolveScene(cfg({ vehicle: 'hoverboard' })).hands).toBe('free');
    expect(resolveScene(cfg({ vehicle: 'skate' })).showHeld).toBe(true);
    expect(resolveScene(cfg({ vehicle: 'skate' })).lift).toBeLessThan(0);
  });

  it.each(['wheelchair', 'wheelchair_sport'])('%s: sentado, mãos livres, pet no colo fica no colo', (vehicle) => {
    const s = resolveScene(cfg({ vehicle, pet: 'cat_black', petPose: 'arms' }));
    expect(s.mount).toBe('seat');
    expect(s.seated).toBe(true);
    expect(s.petPose).toBe('arms');
    expect(s.petAttach).toBe('body');
    expect(s.hideLegs).toBe(false);
    // com o pet no colo as mãos aninham
    expect(s.hands).toBe('cradle');
    expect(resolveScene(cfg({ vehicle })).hands).toBe('free');
  });

  it.each(['carpet', 'cloud', 'ufo'])('%s: hover, pet ao lado continua ao lado (sobe no veículo)', (vehicle) => {
    const s = resolveScene(cfg({ vehicle, pet: 'dog_caramel', petPose: 'side' }));
    expect(s.mount).toBe('hover');
    expect(s.petPose).toBe('side');
    expect(s.petAttach).toBe('root');
    expect(s.lift).toBeLessThan(0);
  });

  it('sem veículo e pet no colo: mãos cradle, objeto e bandeirinha somem', () => {
    const s = resolveScene(cfg({ pet: 'bunny', petPose: 'arms', held: 'rose', pride: 'flag' }));
    expect(s.hands).toBe('cradle');
    expect(s.showHeld).toBe(false);
    expect(s.showLeftHandFlag).toBe(false);
  });

  it('posição de pet não aceita cai na primeira aceita', () => {
    // capivara só aceita 'side'
    expect(resolveScene(cfg({ pet: 'capybara', petPose: 'shoulder' })).petPose).toBe('side');
    expect(resolveScene(cfg({ pet: 'arara', petPose: 'shoulder' })).petAttach).toBe('body');
  });

  it('busto ignora o veículo', () => {
    expect(resolveScene(cfg({ vehicle: 'wheelchair' }), { noVehicle: true }).mount).toBeNull();
    expect(buildAvatarRig(cfg({ vehicle: 'wheelchair' }), { mode: 'bust' }).scene?.seated).toBe(false);
  });
});

describe('applyScene', () => {
  it('cena vazia devolve a mesma pose (sem cópia)', () => {
    const p = idle(0.4, NEUTRAL_VARIATION);
    expect(applyScene(p, EMPTY_SCENE, 0)).toBe(p);
    expect(applyScene(p, null, 0)).toBe(p);
  });

  it('não muta a pose de entrada', () => {
    const p = zero();
    const s = resolveScene(cfg({ vehicle: 'car' }));
    applyScene(p, s, 1);
    expect(p).toEqual(zero());
  });

  it('carro põe as mãos no volante, a não ser que a animação use os braços', () => {
    const s = resolveScene(cfg({ vehicle: 'car' }));
    const p = zero();
    p.armR.r = -150;
    const free = applyScene(p, s, 0);
    // braços calculados pra esta pessoa (dois ossos até o aro do volante)
    expect(s.arms).toHaveLength(4);
    expect(free.armL.r).toBe(s.arms![0]);
    expect(free.foreR?.r).toBe(s.arms![3]);
    // sem os braços da cena (cena antiga/serializada), cai na tabela
    const legacy = applyScene(p, { ...s, arms: null }, 0);
    expect(legacy.armL.r).toBe(HAND_POSES.wheel[0]);
    expect(legacy.foreR?.r).toBe(-HAND_POSES.wheel[1]);
    const waving = applyScene(p, s, 0, { usesArms: true });
    expect(waving.armR.r).toBe(-150);
  });

  it('cadeira de rodas desce o tronco SEAT_DROP e prende as pernas', () => {
    const s = resolveScene(cfg({ vehicle: 'wheelchair' }));
    const walkLike = zero();
    walkLike.legL.r = 25;
    const p = applyScene(walkLike, s, 0);
    expect(p.body.dy).toBe(SEAT_DROP);
    expect(p.legL.r).toBe(0);
  });

  it('moto abre as pernas e dobra os joelhos pra dentro', () => {
    const p = applyScene(zero(), resolveScene(cfg({ vehicle: 'moto' })), 0);
    expect(p.legL.r).toBeGreaterThan(0);
    expect(p.legR.r).toBeLessThan(0);
    expect(p.shinL!.r).toBeLessThan(0);
    expect(p.shinR!.r).toBeGreaterThan(0);
  });

  it('hover balança com o tempo (mount.dy) e é finito', () => {
    const s = resolveScene(cfg({ vehicle: 'cloud' }));
    const a = applyScene(zero(), s, 0);
    const b = applyScene(zero(), s, 0.6);
    expect(a.mount?.dy).toBeCloseTo(0, 9);
    expect(Math.abs(b.mount!.dy)).toBeGreaterThan(0.5);
    for (let t = 0; t < 5; t += 0.37) expect(poseIsFinite(applyScene(idle(t, NEUTRAL_VARIATION), s, t))).toBe(true);
  });

  it('cena com carro: camadas sem pernas, sapatos nem objeto na mão', () => {
    const layers = buildAvatarLayers(cfg({ vehicle: 'car', held: 'rose' }));
    expect(layers.some((l) => l.g === 'shinL' || l.g === 'legR')).toBe(false);
    expect(layers.some((l) => l.k === 'held')).toBe(false);
  });
});
