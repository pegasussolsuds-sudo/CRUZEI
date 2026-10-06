import type { AvatarConfig } from '@cruzei/shared-types';
import { DEFAULT_AVATAR, normalizeAvatarConfig } from '@cruzei/shared-utils';

import { BODY_SPECS, bodyAnchors, buildAnatomy, faceDims, seatDropFor, SEAT_DROP } from '../anatomy';
import { fillConfig } from '../ctx';
import { buildAvatarLayers, buildAvatarRig } from '../layers';
import { VEHICLE_RIG, gripTargets } from '../parts/vehicles-geom';
import { zero } from '../pose';
import { groupMatrix, mApply } from '../rig';
import { applyScene, resolveScene, twoBoneAngles } from '../scene';
import type { AvatarLayer, Pt } from '../types';

const base = normalizeAvatarConfig(DEFAULT_AVATAR) as AvatarConfig;
const cfg = (over: Partial<AvatarConfig>) => ({ ...base, ...over }) as AvatarConfig;
const VEHICLES = Object.keys(VEHICLE_RIG);
const BODIES = Object.keys(BODY_SPECS);

/** caixa das coordenadas ABSOLUTAS de um path (comandos maiúsculos) */
function bbox(d: string): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  };
  for (const seg of d.match(/[A-Za-z][^A-Za-z]*/g) ?? []) {
    const c = seg[0];
    const n = (seg.slice(1).match(/-?\d*\.?\d+(?:e-?\d+)?/g) ?? []).map(Number);
    if (c === 'H') n.forEach((x) => add(x, (y0 + y1) / 2 || 70));
    else if (c === 'V') n.forEach((y) => add((x0 + x1) / 2 || 50, y));
    else if (c === 'A') for (let i = 0; i + 6 < n.length + 1; i += 7) add(n[i + 5], n[i + 6]);
    else if ('MLCQST'.includes(c)) for (let i = 0; i + 1 < n.length; i += 2) add(n[i], n[i + 1]);
  }
  return [x0, y0, x1, y1];
}

const vehicleLayers = (layers: AvatarLayer[]) => layers.filter((l) => l.k === 'mount');

describe('veículos: camadas', () => {
  it.each(VEHICLES)('%s: todo corpo, completo e lite — paths válidos, grupo mount/shadow, dentro do viewBox', (vehicle) => {
    for (const body of BODIES) {
      for (const lod of [undefined, 'lite'] as const) {
        const layers = buildAvatarLayers(cfg({ vehicle, body, vehicleColor: 'c_red' }), { groundShadow: true, lod } as never);
        const veh = vehicleLayers(layers);
        expect(veh.length).toBeGreaterThan(3);
        for (const l of veh) {
          const at = `${vehicle}/${body}/${lod ?? 'full'}: ${JSON.stringify(l).slice(0, 120)}`;
          if (!l.d || l.d.length < 3 || /NaN|Infinity|undefined/.test(JSON.stringify(l))) throw new Error('camada inválida ' + at);
          if (l.g !== 'mount' && l.g !== 'shadow') throw new Error('grupo errado ' + at);
          // camada recortada só aparece dentro do recorte: confere a caixa do recorte
          const [x0, y0, x1, y1] = bbox(l.cp ?? l.d);
          if (x0 < -1 || x1 > 101 || y0 < 20 || y1 > 140) throw new Error(`fora do viewBox (${x0.toFixed(1)},${y0.toFixed(1)})-(${x1.toFixed(1)},${y1.toFixed(1)}) ` + at);
        }
      }
    }
  });

  it('o lite é bem mais leve que o completo (mapa e miniatura)', () => {
    for (const vehicle of VEHICLES) {
      const full = vehicleLayers(buildAvatarLayers(cfg({ vehicle })));
      const lite = vehicleLayers(buildAvatarLayers(cfg({ vehicle }), { lod: 'lite' } as never));
      expect(lite.length).toBeLessThan(full.length);
      expect(lite.filter((l) => l.b).length).toBeLessThanOrEqual(4);
    }
  });

  it('busto não desenha veículo', () => {
    for (const vehicle of VEHICLES) expect(vehicleLayers(buildAvatarLayers(cfg({ vehicle }), { mode: 'bust' }))).toHaveLength(0);
  });

  it('cor do veículo muda a tinta', () => {
    const a = JSON.stringify(vehicleLayers(buildAvatarLayers(cfg({ vehicle: 'car', vehicleColor: 'c_red' }))));
    const b = JSON.stringify(vehicleLayers(buildAvatarLayers(cfg({ vehicle: 'car', vehicleColor: 'c_teal' }))));
    expect(a).not.toEqual(b);
  });
});

describe('veículos: o corpo encaixa', () => {
  /** palmas do piloto na pose-base parada (espaço do veículo) */
  function palms(c: AvatarConfig): [Pt, Pt] {
    const full = fillConfig(c);
    const rig = buildAvatarRig(full);
    const an = buildAnatomy(full, rig.scene);
    const ba = bodyAnchors(an);
    const p = applyScene(zero(), rig.scene, 0);
    return [mApply(groupMatrix('foreL', rig, p), ba.palmL[0], ba.palmL[1]), mApply(groupMatrix('foreR', rig, p), ba.palmR[0], ba.palmR[1])];
  }

  it.each(['car', 'classic', 'jeep', 'sport', 'moto', 'bike', 'lambreta', 'kick'])('%s: as palmas caem no volante/guidão em todo corpo', (vehicle) => {
    for (const body of BODIES) {
      const c = cfg({ vehicle, body });
      const full = fillConfig(c);
      const an = buildAnatomy(full, resolveScene(full));
      const grips = gripTargets(an, vehicle)!;
      const [L, R] = palms(c);
      expect(Math.hypot(L[0] - grips[0][0], L[1] - grips[0][1])).toBeLessThan(0.6);
      expect(Math.hypot(R[0] - grips[1][0], R[1] - grips[1][1])).toBeLessThan(0.6);
    }
  });

  it('dois ossos: o alvo alcançável é atingido e o cotovelo abre pro lado pedido', () => {
    const S: Pt = [35, 46];
    const E0: Pt = [32, 64];
    const P0: Pt = [34, 82];
    const T: Pt = [30, 76];
    const [a, f] = twoBoneAngles(S, E0, P0, T, -1);
    const rot = (p: Pt, c: Pt, deg: number): Pt => {
      const r = (deg * Math.PI) / 180;
      const dx = p[0] - c[0];
      const dy = p[1] - c[1];
      return [c[0] + dx * Math.cos(r) - dy * Math.sin(r), c[1] + dx * Math.sin(r) + dy * Math.cos(r)];
    };
    const E = rot(E0, S, a);
    const P = rot(rot(P0, S, a), E, f);
    expect(Math.hypot(P[0] - T[0], P[1] - T[1])).toBeLessThan(0.05);
    expect(E[0]).toBeLessThan(Math.min(S[0], T[0]));
  });

  it('cadeira: o tronco desce o tanto da pessoa (perna longa senta mais fundo)', () => {
    for (const body of BODIES) {
      const s = resolveScene(cfg({ vehicle: 'wheelchair', body }));
      expect(s.seatDrop).toBeCloseTo(seatDropFor({ body }), 9);
      expect(applyScene(zero(), s, 0).body.dy).toBeCloseTo(s.seatDrop ?? SEAT_DROP, 9);
    }
    expect(resolveScene(cfg({ vehicle: 'wheelchair', body: 'slim' })).seatDrop).toBeGreaterThan(SEAT_DROP);
  });

  it('de pé no deque/flutuando: a subida é pequena (cabelo alto não sai pelo topo) e o balanço é suave', () => {
    for (const v of VEHICLES) {
      expect(Math.abs(VEHICLE_RIG[v as keyof typeof VEHICLE_RIG].lift)).toBeLessThanOrEqual(4.5);
      expect(VEHICLE_RIG[v as keyof typeof VEHICLE_RIG].bob).toBeLessThanOrEqual(1.2);
    }
    // o topo do crânio do corpo mais alto, de pé no disco e no ponto mais alto do balanço, fica dentro do viewBox
    const an = buildAnatomy({ body: 'athletic' });
    expect(faceDims(an).crownY + VEHICLE_RIG.ufo.lift - VEHICLE_RIG.ufo.bob).toBeGreaterThan(1);
  });

  it.each(['kick', 'skate', 'hoverboard', 'carpet', 'cloud', 'ufo'])('%s: as solas ficam em cima do deque (subida aplicada no piloto)', (vehicle) => {
    const c = fillConfig(cfg({ vehicle }));
    const rig = buildAvatarRig(c);
    const an = buildAnatomy(c, rig.scene);
    const p = applyScene(zero(), rig.scene, 0);
    const sole = mApply(groupMatrix('shinL', rig, p), an.joints.ankleL[0], an.foot.soleY);
    expect(sole[1]).toBeCloseTo(an.foot.soleY + (rig.scene?.lift ?? 0), 0);
    expect(sole[1]).toBeLessThan(134);
  });
});
