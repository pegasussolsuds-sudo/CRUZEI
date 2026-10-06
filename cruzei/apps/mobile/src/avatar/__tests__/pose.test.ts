import type { AvatarConfig } from '@cruzei/shared-types';
import { DEFAULT_AVATAR, normalizeAvatarConfig } from '@cruzei/shared-utils';

import { DUR, RUN, WALK, pose as mapPose, run, walk } from '../../screens/map/native/images/anim';
import { emoteDef, emoteFaceAt, listEmotes } from '../emotes';
import { buildAvatarRig } from '../layers';
import { NEUTRAL_VARIATION, addPose, blend, breathe, clonePose, idle, poseIsFinite, variationFor, zero, type Pose } from '../pose';
import { groupMatrix, mApply, mIdentity, mIsIdentity, mMul, mToSkia } from '../rig';
import { AVATAR_GROUPS, type AvatarRig } from '../types';

const STATES = ['idle', 'walk', 'run', 'wave', 'like', 'celebrate', 'match', 'arrive'] as const;
const V = [NEUTRAL_VARIATION, variationFor('user-123'), variationFor('outra-pessoa')];

describe('pose', () => {
  it('zero é neutra e só tem os campos antigos', () => {
    const z = zero();
    expect(z).toEqual({ body: { r: 0, dy: 0, sx: 1, sy: 1 }, head: { r: 0, dy: 0 }, armL: { r: 0 }, armR: { r: 0 }, legL: { r: 0 }, legR: { r: 0 }, shadow: { s: 1 } });
  });

  it('blend: k<=0 devolve a, k>=1 devolve b (mesmo objeto), meio interpola', () => {
    const a = zero();
    const b = idle(1.3, NEUTRAL_VARIATION);
    expect(blend(a, b, 0)).toBe(a);
    expect(blend(a, b, 1)).toBe(b);
    const m = blend(a, b, 0.5);
    expect(m.armL.r).toBeCloseTo(b.armL.r / 2, 10);
    expect(m.foreL).toBeUndefined();
  });

  it('blend de campos opcionais: ausente vale 0 (escala vale 1)', () => {
    const a = zero();
    const b = zero();
    b.foreR = { r: 40 };
    b.pet = { dx: 10, dy: -4, r: 20, s: 3 };
    const m = blend(a, b, 0.25);
    expect(m.foreR?.r).toBeCloseTo(10);
    expect(m.pet).toEqual({ dx: 2.5, dy: -1, r: 5, s: 1.5 });
    expect(m.shinL).toBeUndefined();
  });

  it('addPose soma deltas e multiplica escalas', () => {
    const p = addPose(zero(), breathe(0.7, NEUTRAL_VARIATION));
    expect(poseIsFinite(p)).toBe(true);
    expect(p.body.sy).toBeCloseTo(breathe(0.7, NEUTRAL_VARIATION).body.sy, 10);
  });

  it('clonePose é profunda', () => {
    const a = zero();
    a.foreL = { r: 3 };
    const c = clonePose(a);
    c.foreL!.r = 9;
    c.body.r = 5;
    expect(a.foreL.r).toBe(3);
    expect(a.body.r).toBe(0);
  });

  it.each(STATES)('estado do mapa %s é finito em todo o ciclo', (st) => {
    for (const v of V) {
      for (let i = 0; i <= 40; i++) {
        const t = (i / 40) * (DUR[st] || 3);
        expect(poseIsFinite(mapPose(st, t, v))).toBe(true);
      }
    }
  });

  it('passada de frente: as pernas ALTERNAM (uma apoia reta, a outra encurta), sem compasso nem X, braços pouco', () => {
    const q = 1 / (4 * WALK.freq); // um quarto do ciclo: perna esquerda no alto
    const l = walk(q, NEUTRAL_VARIATION);
    expect(l.legL.sy!).toBeLessThan(0.93);
    expect(l.legR.sy!).toBeCloseTo(1, 6);
    const r = walk(3 * q, NEUTRAL_VARIATION);
    expect(r.legR.sy!).toBeLessThan(0.93);
    expect(r.legL.sy!).toBeCloseTo(1, 6);
    for (let i = 0; i <= 40; i++) {
      for (const p of [walk(i / 40 / WALK.freq, NEUTRAL_VARIATION), run(i / 40 / RUN.freq, NEUTRAL_VARIATION)]) {
        // coxas com o mesmo giro (o quadril vai pro apoio): nunca abrem e fecham juntas
        expect(p.legL.r).toBeCloseTo(p.legR.r, 9);
        expect(Math.abs(p.legL.r)).toBeLessThanOrEqual(6);
        // braços do mesmo lado e pequenos; cotovelo quase reto (mão não vem pro meio do corpo)
        expect(p.armL.r).toBeCloseTo(p.armR.r, 9);
        expect(Math.abs(p.armL.r)).toBeLessThanOrEqual(8);
        expect(Math.abs(p.foreL!.r)).toBeLessThanOrEqual(10);
        expect(Math.abs(p.foreR!.r)).toBeLessThanOrEqual(10);
      }
    }
  });

  it('animações registradas: pose finita em todo o ciclo, keyK válido, troca de rosto coerente', () => {
    for (const def of listEmotes()) {
      expect(emoteDef(def.id)).toBe(def);
      expect(def.dur).toBeGreaterThan(0);
      expect(def.keyK).toBeGreaterThanOrEqual(0);
      expect(def.keyK).toBeLessThanOrEqual(1);
      for (let i = 0; i <= 24; i++) {
        const k = i / 24;
        expect(poseIsFinite(def.pose(k, k * def.dur, NEUTRAL_VARIATION))).toBe(true);
        const f = emoteFaceAt(def, k);
        expect(f === null || typeof f === 'string').toBe(true);
      }
    }
    expect(emoteDef('none')).toBeNull();
    expect(emoteDef('nao-existe')).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// matrizes do esqueleto
// ---------------------------------------------------------------------------------------------------------------

/** a matemática antiga do draw.ts (canvas translate/rotate/scale) pra comparar */
function legacyMatrix(g: string, rig: AvatarRig, p: Pose) {
  const T = (x: number, y: number) => [1, 0, 0, 1, x, y] as [number, number, number, number, number, number];
  const R = (deg: number) => {
    const c = Math.cos((deg * Math.PI) / 180);
    const s = Math.sin((deg * Math.PI) / 180);
    return [c, s, -s, c, 0, 0] as [number, number, number, number, number, number];
  };
  const S = (x: number, y: number) => [x, 0, 0, y, 0, 0] as [number, number, number, number, number, number];
  const chain = (...ms: ReturnType<typeof T>[]) => ms.reduce((a, b) => mMul(a, b), mIdentity());
  const pivot = (pt: [number, number], deg: number) => chain(T(pt[0], pt[1]), R(deg), T(-pt[0], -pt[1]));
  const body = chain(T(rig.body[0], rig.body[1] + p.body.dy), R(p.body.r), S(p.body.sx, p.body.sy), T(-rig.body[0], -rig.body[1]));
  switch (g) {
    // perna: giro no quadril + escorço no eixo dela (passada de frente)
    case 'legL':
      return chain(T(rig.legL[0], rig.legL[1]), R(p.legL.r), S(1, p.legL.sy ?? 1), T(-rig.legL[0], -rig.legL[1]));
    case 'legR':
      return chain(T(rig.legR[0], rig.legR[1]), R(p.legR.r), S(1, p.legR.sy ?? 1), T(-rig.legR[0], -rig.legR[1]));
    case 'shadow':
      return chain(T(50, 135), S(p.shadow.s, 1), T(-50, -135));
    case 'body':
      return body;
    case 'head':
      return chain(body, T(rig.head[0], rig.head[1] + p.head.dy), R(p.head.r), T(-rig.head[0], -rig.head[1]));
    case 'armL':
      return chain(body, pivot(rig.armL, p.armL.r));
    case 'armR':
      return chain(body, pivot(rig.armR, p.armR.r));
    default:
      return mIdentity();
  }
}

describe('rig', () => {
  const cfg = normalizeAvatarConfig(DEFAULT_AVATAR) as AvatarConfig;
  const rig = buildAvatarRig(cfg);

  it('pose neutra = identidade em todos os grupos', () => {
    for (const g of AVATAR_GROUPS) expect(mIsIdentity(groupMatrix(g, rig, zero()))).toBe(true);
  });

  it('bate com a matemática antiga do mapa nos grupos antigos', () => {
    for (const st of STATES) {
      for (let i = 0; i < 12; i++) {
        const p = mapPose(st, i * 0.137, variationFor('abc'));
        for (const g of ['shadow', 'body', 'head', 'armL', 'armR', 'legL', 'legR']) {
          const a = groupMatrix(g as never, rig, p);
          const b = legacyMatrix(g, rig, p);
          for (let j = 0; j < 6; j++) expect(a[j]).toBeCloseTo(b[j], 9);
        }
      }
    }
  });

  it('antebraço gira no cotovelo (o pivô não sai do lugar) e herda o braço', () => {
    const p = zero();
    p.foreL = { r: 70 };
    const M = groupMatrix('foreL', rig, p);
    const [x, y] = mApply(M, rig.foreL[0], rig.foreL[1]);
    expect(x).toBeCloseTo(rig.foreL[0], 9);
    expect(y).toBeCloseTo(rig.foreL[1], 9);
    p.armL.r = 30;
    const elbow = mApply(groupMatrix('armL', rig, p), rig.foreL[0], rig.foreL[1]);
    const elbow2 = mApply(groupMatrix('foreL', rig, p), rig.foreL[0], rig.foreL[1]);
    expect(elbow2[0]).toBeCloseTo(elbow[0], 9);
    expect(elbow2[1]).toBeCloseTo(elbow[1], 9);
  });

  it('canela gira no joelho e herda a coxa', () => {
    const p = zero();
    p.legR.r = -20;
    p.shinR = { r: 35 };
    const knee = mApply(groupMatrix('legR', rig, p), rig.shinR[0], rig.shinR[1]);
    const knee2 = mApply(groupMatrix('shinR', rig, p), rig.shinR[0], rig.shinR[1]);
    expect(knee2[0]).toBeCloseTo(knee[0], 9);
    expect(knee2[1]).toBeCloseTo(knee[1], 9);
  });

  it('com veículo o piloto vai junto do mount; sem veículo não', () => {
    const p = zero();
    p.mount = { dy: -5, r: 0 };
    const riding = buildAvatarRig({ ...cfg, vehicle: 'carpet' } as AvatarConfig);
    expect(mApply(groupMatrix('body', riding, p), 50, 90)[1]).toBeCloseTo(90 - 5 + (riding.scene?.lift ?? 0), 9);
    expect(mApply(groupMatrix('legL', riding, p), 40, 120)[1]).toBeCloseTo(120 - 5 + (riding.scene?.lift ?? 0), 9);
    expect(mApply(groupMatrix('body', rig, p), 50, 90)[1]).toBeCloseTo(90, 9);
    expect(mApply(groupMatrix('shadow', riding, p), 50, 135)[1]).toBeCloseTo(135, 9);
  });

  it('pet no colo acompanha o tronco; no chão não', () => {
    const p = zero();
    p.body.dy = -6;
    const arms = buildAvatarRig({ ...cfg, pet: 'cat_orange', petPose: 'arms' } as AvatarConfig);
    const side = buildAvatarRig({ ...cfg, pet: 'dog_caramel', petPose: 'side' } as AvatarConfig);
    expect(arms.petAttach).toBe('body');
    expect(side.petAttach).toBe('root');
    expect(mApply(groupMatrix('pet', arms, p), 50, 80)[1]).toBeCloseTo(74, 9);
    expect(mApply(groupMatrix('pet', side, p), 80, 130)[1]).toBeCloseTo(130, 9);
  });

  it('mToSkia é a 3x3 linha a linha', () => {
    expect(mToSkia([1, 2, 3, 4, 5, 6])).toEqual([1, 3, 5, 2, 4, 6, 0, 0, 1]);
  });
});
