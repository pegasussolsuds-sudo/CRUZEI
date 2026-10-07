// Correções de leitura no mapa e de roupa longa (rodada fix4, partes extras): objeto na mão e bicho flutuando crescem
// no corpo inteiro pequeno ('lite'), e a perna não sai pela lateral da túnica/sobretudo nas danças.
import type { AvatarConfig } from '@cruzei/shared-types';
import { DEFAULT_AVATAR, normalizeAvatarConfig } from '@cruzei/shared-utils';

import { buildAvatarLayers } from '../layers';
import { zero } from '../pose';
import { applyScene, resolveScene } from '../scene';
import type { AvatarLayer } from '../types';

const base = normalizeAvatarConfig(DEFAULT_AVATAR) as AvatarConfig;
const cfg = (over: Partial<AvatarConfig>) => ({ ...base, ...over }) as AvatarConfig;

/** largura × altura da caixa das camadas com a etiqueta k (números do path, aproximado) */
function boxOf(layers: AvatarLayer[], k: string): number {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const l of layers) {
    if (l.k !== k) continue;
    const n = (l.d.match(/-?\d*\.?\d+/g) ?? []).map(Number);
    for (let i = 0; i + 1 < n.length; i += 2) {
      x0 = Math.min(x0, n[i]);
      x1 = Math.max(x1, n[i]);
      y0 = Math.min(y0, n[i + 1]);
      y1 = Math.max(y1, n[i + 1]);
    }
  }
  return (x1 - x0) * (y1 - y0);
}

describe('objeto na mão no corpo inteiro pequeno', () => {
  it.each(['sparkler', 'mic', 'camera', 'coffee', 'boba', 'book', 'crystal_ball'])(
    '%s cresce no lite (mapa) em relação ao full',
    (held) => {
      const c = cfg({ held });
      // a primeira camada do objeto (cabo, haste, alça, copo) existe nos dois níveis: compara a área dela
      const first = (l: AvatarLayer[]) => [l.find((x) => x.k === 'held') as AvatarLayer];
      const full = boxOf(first(buildAvatarLayers(c, { groundShadow: true })), 'held');
      const lite = boxOf(first(buildAvatarLayers(c, { groundShadow: true, lod: 'lite' })), 'held');
      expect(lite).toBeGreaterThan(full * 2); // 1,5–1,6× = 2,3–2,6× a área
    },
  );
});

describe('fantasminha flutuando no corpo inteiro pequeno', () => {
  it('cresce no lite e não muda no full nem no busto', () => {
    const c = cfg({ pet: 'ghost', petPose: 'float' });
    const full = boxOf(buildAvatarLayers(c, {}), 'pet');
    const lite = boxOf(buildAvatarLayers(c, { lod: 'lite' }), 'pet');
    expect(lite).toBeGreaterThan(full * 1.5);
    const bust = boxOf(buildAvatarLayers(c, { mode: 'bust' }), 'pet');
    const bustLite = boxOf(buildAvatarLayers(c, { mode: 'bust', lod: 'lite' }), 'pet');
    expect(bustLite).toBeLessThanOrEqual(bust * 1.02); // o lite só perde o halo desfocado
  });
});

describe('perna sob roupa longa', () => {
  it('túnica ou sobretudo limitam o giro da perna; sem peça longa ou com veículo, não', () => {
    expect(resolveScene(cfg({ top: 'wizard' })).legK).toBeLessThan(0.5);
    expect(resolveScene(cfg({ outer: 'trench' })).legK).toBeLessThan(0.5);
    expect(resolveScene(cfg({ top: 'tee', outer: 'none' })).legK).toBeUndefined();
    expect(resolveScene(cfg({ top: 'wizard', vehicle: 'skate' })).legK).toBeUndefined();
  });

  it('applyScene encolhe coxa, canela e escorço pelo legK (sem mexer no resto)', () => {
    const s = resolveScene(cfg({ top: 'wizard' }));
    const k = s.legK as number;
    const p = zero();
    p.legL.r = 34;
    p.legL.sy = 0.8;
    p.shinL = { r: -50 };
    p.legR.r = -20;
    p.armL.r = 40;
    const out = applyScene(p, s, 0);
    expect(out).not.toBe(p);
    expect(out.legL.r).toBeCloseTo(34 * k);
    expect(out.shinL?.r).toBeCloseTo(-50 * k);
    expect(out.legR.r).toBeCloseTo(-20 * k);
    expect(out.legL.sy).toBeCloseTo(1 - 0.2 * k);
    expect(out.armL.r).toBe(40);
    expect(p.legL.r).toBe(34); // não muta a entrada
  });
});
