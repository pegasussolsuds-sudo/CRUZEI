import type { AvatarConfig } from '@cruzei/shared-types';
import { DEFAULT_AVATAR, normalizeAvatarConfig } from '@cruzei/shared-utils';

import { stageLayout, STAGE_ASPECT, STAGE_INNER } from '../../components/avatar/stage/layout';
import { mergeStageLayers, roleVisible, stageRuns } from '../../components/avatar/stage/stageLayers';
import { AVATAR_BUST_VIEWBOX, buildAvatarLayers, buildAvatarRig, bustBoxFor, layersWithTag } from '../layers';
import { zero } from '../pose';
import { buildSvgModel, splitAlpha, svgModelToString } from '../svgModel';
import type { AvatarLayer } from '../types';

const base = normalizeAvatarConfig(DEFAULT_AVATAR) as AvatarConfig;

describe('svgModel', () => {
  const demo: AvatarLayer[] = [
    { d: 'M0,0H10V10Z', f: '#7FFF00', gf: { t: 'l', x1: 0, y1: 0, x2: 10, y2: 10, s: [[0, '#7FFF00'], [1, 'rgba(255,20,147,0.5)', 0.5]] } },
    { d: 'M0,0H10V10Z', f: '#000', b: 2, cp: 'M0,0H5V5Z' },
    { d: 'M0,0L10,10', s: '#fff', w: 1, da: [2, 1], g: 'head' },
    { d: 'M0,0L10,10', s: '#fff', w: 1, gs: { t: 'r', cx: 5, cy: 5, r: 5, fx: 3, fy: 3, s: [[0, '#fff']] } },
  ];

  it('gera gradiente, recorte, desfoque e tracejado com ids do prefixo', () => {
    const m = buildSvgModel(demo, { idp: 'x1_', blur: 'filter' });
    const s = svgModelToString(m);
    expect(s).toContain('<linearGradient id="x1_g0" gradientUnits="userSpaceOnUse"');
    expect(s).toContain('stop-opacity="0.25"'); // 0.5 da cor × 0.5 da parada
    expect(s).toContain('<radialGradient id="x1_g1"');
    expect(s).toContain('fx="3"');
    expect(s).toContain('<clipPath id="x1_c0"');
    expect(s).toContain('<feGaussianBlur stdDeviation="2"/>');
    expect(s).toContain('stroke-dasharray="2 1"');
    expect(s).toContain('clip-path="url(#x1_c0)"');
    expect(m.runs.map((r) => r.g)).toEqual(['body', 'head', 'body']);
  });

  it('desfoque aproximado vira preenchimento + halo; half = metade da opacidade', () => {
    const approx = buildSvgModel([demo[1]], { idp: 'a', blur: 'approx' });
    expect(approx.blurs).toHaveLength(0);
    expect(approx.runs[0].nodes).toHaveLength(2);
    const half = buildSvgModel([demo[1]], { idp: 'h', blur: 'half' });
    expect(half.runs[0].nodes[0].opacity).toBe(0.5);
  });

  it('sem pose não há transformação; com pose só nos grupos que mexem', () => {
    const layers = buildAvatarLayers(base);
    const rig = buildAvatarRig(base);
    expect(buildSvgModel(layers, { idp: 'p' }).runs.every((r) => r.transform === null)).toBe(true);
    const p = zero();
    p.armR.r = -90;
    const m = buildSvgModel(layers, { idp: 'p', rig, pose: p });
    expect(m.runs.filter((r) => r.transform).every((r) => r.g === 'armR' || r.g === 'foreR')).toBe(true);
    expect(m.runs.some((r) => r.transform)).toBe(true);
  });

  it('splitAlpha entende hex curto, hex com alfa e rgba', () => {
    expect(splitAlpha('#fff')).toEqual(['#ffffff', 1]);
    expect(splitAlpha('#FF000080')[1]).toBeCloseTo(128 / 255);
    expect(splitAlpha('rgba(0,0,0,0.28)')).toEqual(['#000000', 0.28]);
  });
});

describe('palco: camadas com papéis de troca', () => {
  const layers = buildAvatarLayers(base);
  const grin = layersWithTag(buildAvatarLayers({ ...base, face: 'grin' }), 'face');
  const prop: AvatarLayer[] = [{ d: 'M0,0H2V2Z', f: '#f00', g: 'foreR', k: 'held' }];

  it('expressões alternativas entram no lugar da expressão da config', () => {
    const merged = mergeStageLayers({ base: layers, altFaces: [grin], prop: [], propAt: -1 });
    const firstFace = merged.findIndex((m) => m.role === 'face');
    const firstAlt = merged.findIndex((m) => m.role === 'face0');
    expect(firstFace).toBeGreaterThan(0);
    expect(firstAlt).toBe(firstFace + layersWithTag(layers, 'face').length);
    expect(merged.filter((m) => m.role === 'n').length).toBe(layers.filter((l) => !l.k).length);
  });

  it('prop entra na posição pedida quando a config não tem objeto', () => {
    const merged = mergeStageLayers({ base: layers, altFaces: [], prop, propAt: 5 });
    expect(merged[5].role).toBe('prop');
    expect(merged.length).toBe(layers.length + 1);
  });

  it('corridas separam grupo e papel; visibilidade por papel', () => {
    const runs = stageRuns(mergeStageLayers({ base: layers, altFaces: [grin], prop, propAt: 5 }));
    for (let i = 1; i < runs.length; i++) expect(runs[i].g !== runs[i - 1].g || runs[i].role !== runs[i - 1].role).toBe(true);
    expect(roleVisible('n', 2, true)).toBe(true);
    expect(roleVisible('face', -1, false)).toBe(true);
    expect(roleVisible('face', 0, false)).toBe(false);
    expect(roleVisible('face0', 0, false)).toBe(true);
    expect(roleVisible('face1', 0, false)).toBe(false);
    expect(roleVisible('held', -1, true)).toBe(false);
    expect(roleVisible('prop', -1, true)).toBe(true);
  });

  it('enquadramento: avatar na caixa interna de 86%', () => {
    const full = stageLayout('full', 300);
    expect(full.h).toBe(300);
    expect(full.w).toBe(Math.round(300 * STAGE_ASPECT));
    expect(full.body.h).toBeCloseTo(300 * STAGE_INNER, 9);
    expect(full.body.x).toBeGreaterThan(0);
    expect(full.body.y + full.body.h).toBeLessThan(300);
    const bust = stageLayout('bust', 200);
    expect(bust.body.w).toBeCloseTo(200 * STAGE_INNER, 9);
    expect(bust.ox + AVATAR_BUST_VIEWBOX.x * bust.s).toBeCloseTo(bust.body.x, 9);
  });
});

describe('integração: mão aberta da animação, recorte do busto e cabeça da figura pequena', () => {
  it('mãos da config viram papel hand; a mão aberta entra logo depois como handOpen', () => {
    const layers = buildAvatarLayers(base);
    const open = layersWithTag(buildAvatarLayers(base, { hands: { L: 'open' } }), 'hand');
    expect(layersWithTag(layers, 'hand').length).toBeGreaterThan(0);
    const merged = mergeStageLayers({ base: layers, altFaces: [], prop: [], propAt: -1, hands: open });
    const first = merged.findIndex((m) => m.role === 'hand');
    const firstOpen = merged.findIndex((m) => m.role === 'handOpen');
    expect(firstOpen).toBe(first + layersWithTag(layers, 'hand').length);
    expect(merged.length).toBe(layers.length + open.length);
    expect(roleVisible('hand', -1, false)).toBe(true);
    expect(roleVisible('hand', -1, false, true)).toBe(false);
    expect(roleVisible('handOpen', -1, false, true)).toBe(true);
    expect(roleVisible('handOpen', -1, false)).toBe(false);
  });

  it('busto por pessoa: chapéu alto e cabelo alto ganham espaço em cima; olhos sempre dentro', () => {
    const plain = bustBoxFor({ ...base, hair: 'short', hat: 'none' });
    const tall = bustBoxFor({ ...base, hair: 'short', hat: 'top_hat' });
    const puff = bustBoxFor({ ...base, hair: 'afro_puff', hat: 'none' });
    expect(tall.y).toBeLessThan(plain.y);
    expect(puff.y).toBeLessThan(plain.y);
    for (const vb of [plain, tall, puff]) {
      expect(vb.w).toBe(vb.h);
      expect([vb.x, vb.y, vb.w].every(Number.isFinite)).toBe(true);
    }
  });

  it('headScale cresce só o grupo da cabeça em volta da base do pescoço', () => {
    const rig = buildAvatarRig(base);
    const m = buildSvgModel(buildAvatarLayers(base), { idp: 'h_', rig, pose: zero(), headScale: 1.24 });
    const head = m.runs.filter((r) => r.g === 'head');
    expect(head.length).toBeGreaterThan(0);
    expect(head.every((r) => r.transform?.startsWith('matrix(1.24'))).toBe(true);
    expect(m.runs.filter((r) => r.g !== 'head').every((r) => r.transform == null)).toBe(true);
  });
});
