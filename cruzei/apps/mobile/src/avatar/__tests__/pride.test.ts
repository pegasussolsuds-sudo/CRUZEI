import type { AvatarConfig } from '@cruzei/shared-types';
import { DEFAULT_AVATAR, PRIDE_FLAGS, normalizeAvatarConfig } from '@cruzei/shared-utils';

import { buildAvatarLayers } from '../layers';
import { bandSurface, boxSurface, flagBands, flagOf, flagSequence, flagShapes, surfacePath, waveSurface } from '../parts/flags';
import { PRIDE_ITEMS } from '../parts/pride';
import type { AvatarLayer } from '../types';

const BAD = /NaN|Infinity|undefined/;
const base = normalizeAvatarConfig(DEFAULT_AVATAR) as AvatarConfig;
const cfgOf = (p: Partial<AvatarConfig>) => normalizeAvatarConfig({ ...base, ...p }) as AvatarConfig;
const prideLayers = (cfg: AvatarConfig, opts: Record<string, unknown> = {}) => buildAvatarLayers(cfg, opts as never).filter((l) => l.k === 'pride');

/** todos os números de um path (pra conferir que fica dentro do viewBox) */
function coords(d: string): number[] {
  return (d.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);
}

function assertClean(ls: AvatarLayer[], where: string): void {
  for (const l of ls) {
    const s = l.d + (l.cp ?? '') + JSON.stringify(l.gf ?? '') + JSON.stringify(l.gs ?? '');
    if (BAD.test(s)) throw new Error(`NaN/Infinity em ${where}: ${s.slice(0, 120)}`);
    for (const n of coords(l.d)) if (n < -20 || n > 160) throw new Error(`coordenada ${n} fora do quadro em ${where}`);
    if (l.o != null) expect(l.o >= 0 && l.o <= 1).toBe(true);
  }
}

describe('bandeiras (flags.ts)', () => {
  it('as 16 bandeiras do catálogo resolvem e as desconhecidas caem no arco-íris', () => {
    expect(PRIDE_FLAGS.length).toBe(16);
    for (const f of PRIDE_FLAGS) expect(flagOf(f.id).id).toBe(f.id);
    expect(flagOf('nao_existe').id).toBe('rainbow');
    expect(flagOf(null).stripes.length).toBe(6);
  });

  it('listras respeitam o peso oficial (bi 2:1:2, demi 3:1:3) e cobrem 0..1', () => {
    const bi = flagBands(flagOf('bi'));
    expect(bi.map((b) => [b.a, b.b])).toEqual([
      [0, 0.4],
      [0.4, 0.6],
      [0.6, 1],
    ]);
    const demi = flagBands(flagOf('demi'));
    expect(demi[1].a).toBeCloseTo(3 / 7);
    expect(demi[1].b).toBeCloseTo(4 / 7);
    for (const f of PRIDE_FLAGS) {
      const bands = flagBands(flagOf(f.id));
      expect(bands[0].a).toBe(0);
      expect(bands[bands.length - 1].b).toBeCloseTo(1);
    }
  });

  it('desenhos extras: chevron (5 peças), anel evenodd, triângulo, lambda (6 faixas)', () => {
    const box = { x: 0, y: 0, w: 30, h: 20 };
    const extras = (id: string) => flagShapes(flagOf(id), box).filter((p) => p.ov);
    expect(extras('progress').map((p) => p.f)).toEqual(['#000000', '#784F17', '#5BCEFA', '#F5A9B8', '#FFFFFF']);
    expect(extras('intersex')).toHaveLength(1);
    expect(extras('intersex')[0].r).toBe('evenodd');
    expect(extras('demi')).toHaveLength(1);
    expect(extras('ally')).toHaveLength(6);
    expect(extras('rainbow')).toHaveLength(0);
    for (const f of PRIDE_FLAGS) for (const p of flagShapes(flagOf(f.id), box, { angle: -12 })) expect(BAD.test(p.d)).toBe(false);
  });

  it('a sequência linear põe o desenho extra no lugar dele', () => {
    expect(flagSequence(flagOf('progress'))[0].hex).toBe('#FFFFFF');
    expect(flagSequence(flagOf('demi'))[0].hex).toBe('#000000');
    expect(flagSequence(flagOf('intersex')).map((s) => s.hex)).toContain('#7902AA');
    expect(flagSequence(flagOf('trans'))).toHaveLength(5);
  });

  it('superfícies dão contornos finitos (caixa girada, faixa curva, pano ondulando)', () => {
    const surfs = [
      boxSurface({ x: 10, y: 10, w: 8, h: 5 }, { angle: 30, bow: 1 }),
      bandSurface(
        [
          [10, 10],
          [20, 16],
          [30, 30],
        ],
        (u) => 3 + u,
      ),
      waveSurface({ hoist: [40, 40], down: [0, 1], fly: [-1, 0.2], len: 10, height: 6 }),
    ];
    for (const s of surfs) {
      expect(BAD.test(surfacePath(s))).toBe(false);
      expect(s.aspect).toBeGreaterThan(0);
    }
  });
});

describe('itens de orgulho (pride.ts)', () => {
  const bodies = ['slim', 'regular', 'broad', 'plus', 'curvy', 'athletic'] as const;
  const groupOf: Record<string, string> = { pin: 'body', heart_pin: 'body', sash: 'body', cape: 'body', band: 'foreR', flag: 'foreL', face_paint: 'head' };

  it('sem item, nenhuma camada de orgulho', () => {
    expect(prideLayers(cfgOf({ pride: 'none' }))).toHaveLength(0);
  });

  it.each(PRIDE_ITEMS)('%s: desenha em todos os corpos, completo e lite, sem NaN e no grupo certo', (item) => {
    for (const body of bodies) {
      for (const lod of ['full', 'lite'] as const) {
        const ls = prideLayers(cfgOf({ body, pride: item, prideFlag: 'progress' }), { lod });
        expect(ls.length).toBeGreaterThan(0);
        assertClean(ls, `${item}/${body}/${lod}`);
        expect(ls.some((l) => (l.g ?? 'body') === groupOf[item])).toBe(true);
      }
    }
  });

  it('todas as bandeiras em todos os itens montam sem NaN', () => {
    for (const f of PRIDE_FLAGS) for (const item of PRIDE_ITEMS) assertClean(prideLayers(cfgOf({ pride: item, prideFlag: f.id })), `${item}/${f.id}`);
  });

  it('o lite é mais leve que o completo', () => {
    for (const item of PRIDE_ITEMS) {
      const full = prideLayers(cfgOf({ pride: item }));
      const lite = prideLayers(cfgOf({ pride: item }), { lod: 'lite' });
      expect(lite.length).toBeLessThanOrEqual(full.length);
      expect(lite.filter((l) => l.b).length).toBeLessThanOrEqual(full.filter((l) => l.b).length);
    }
  });

  it('bandeirinha: com a mão aberta (braço erguido) troca de desenho; some no carro e na moto', () => {
    const cfg = cfgOf({ pride: 'flag' });
    const rest = prideLayers(cfg);
    const open = prideLayers(cfg, { hands: { L: 'open' } });
    assertClean(open, 'flag/open');
    expect(open.length).toBeGreaterThan(0);
    expect(open.map((l) => l.d)).not.toEqual(rest.map((l) => l.d));
    for (const vehicle of ['car', 'moto']) expect(prideLayers(cfgOf({ pride: 'flag', vehicle })).filter((l) => l.g === 'foreL')).toHaveLength(0);
  });

  it('pin fica no peito do lado esquerdo de quem veste (direita da tela), perto da gola', () => {
    for (const body of bodies) {
      const ls = prideLayers(cfgOf({ body, pride: 'pin' }));
      const xs = ls.flatMap((l) => coords(l.d).filter((_, i) => i % 2 === 0));
      const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
      expect(mid).toBeGreaterThan(51);
      expect(mid).toBeLessThan(62);
    }
  });
});
