// Chapelaria: todo id do catálogo desenha algo próprio (chapéus, óculos, acessórios), sem NaN em nenhum corpo/rosto,
// no completo e no lite; óculos nos olhos; modos de chapéu cobrindo o catálogo; fone por cima/por baixo do chapéu.
import type { AvatarConfig } from '@cruzei/shared-types';
import { AVATAR_ITEM_SLOTS, DEFAULT_AVATAR, normalizeAvatarConfig } from '@cruzei/shared-utils';

import { buildAnatomy, headAnchors } from '../anatomy';
import { createCtx } from '../ctx';
import { buildAvatarLayers } from '../layers';
import { hatLiftOf, hatModeOf } from '../parts/hat-modes';
import { HEADWEAR_IDS, glasses, hat, headAccessory, overHat } from '../parts/headwear';
import { eyeBox } from '../parts/headwear-glasses';
import { headFrame } from '../parts/headwear-kit';
import { resolveScene } from '../scene';
import type { AvatarLayer } from '../types';

const BAD = /NaN|Infinity|undefined|null/;
const base = normalizeAvatarConfig(DEFAULT_AVATAR) as AvatarConfig;
const ids = (slot: string): string[] => AVATAR_ITEM_SLOTS.find((s) => s.slot === slot)?.items.map((i) => i.id) ?? [];

const PEOPLE: Partial<AvatarConfig>[] = [
  { body: 'slim', faceShape: 'long', eyes: 'monolid', hair: 'long' },
  { body: 'plus', faceShape: 'round', eyes: 'hooded', hair: 'short', lines: 'marked' },
  { body: 'athletic', faceShape: 'square', eyes: 'round', hair: 'afro' },
  { body: 'curvy', faceShape: 'heart', eyes: 'upturned', hair: 'bald' },
];

type Step = (ctx: ReturnType<typeof createCtx>) => void;

/** camadas de uma etapa da chapelaria isolada */
function stepLayers(cfg: AvatarConfig, step: Step, lod?: 'lite'): AvatarLayer[] {
  const ctx = createCtx(cfg, resolveScene(cfg), { lod } as never);
  step(ctx);
  return ctx.layers;
}

function assertClean(layers: AvatarLayer[], where: string): void {
  for (const l of layers) {
    if (BAD.test(l.d) || (l.cp && BAD.test(l.cp))) throw new Error(`path inválido em ${where}`);
    if (l.gf && BAD.test(JSON.stringify(l.gf))) throw new Error(`gradiente inválido em ${where}`);
    if (l.gs && BAD.test(JSON.stringify(l.gs))) throw new Error(`gradiente inválido em ${where}`);
    if (l.o != null && (l.o < 0 || l.o > 1)) throw new Error(`opacidade fora de 0..1 em ${where}`);
    expect(l.g).toBe(l.g === 'body' ? 'body' : 'head');
  }
}

describe('chapelaria', () => {
  it.each([
    ['hat', 'hat'],
    ['glasses', 'glasses'],
    ['accessory', 'accessory'],
  ] as const)('desenha todos os ids do slot %s', (slot, key) => {
    const drawn = new Set<string>(HEADWEAR_IDS[key]);
    expect(ids(slot).filter((id) => id !== 'none' && !drawn.has(id))).toEqual([]);
  });

  it.each(ids('hat').filter((i) => i !== 'none'))('chapéu %s: camadas limpas em 4 pessoas, completo e lite', (id) => {
    for (const p of PEOPLE) {
      const cfg = { ...base, ...p, hat: id } as AvatarConfig;
      for (const lod of [undefined, 'lite'] as const) {
        const ls = stepLayers(cfg, hat, lod);
        expect(ls.length).toBeGreaterThan(2);
        assertClean(ls, `${id}/${p.body}/${lod ?? 'full'}`);
      }
    }
  });

  it.each(ids('glasses').filter((i) => i !== 'none'))('óculos %s: camadas limpas e na altura dos olhos', (id) => {
    for (const p of PEOPLE) {
      const cfg = { ...base, ...p, glasses: id } as AvatarConfig;
      for (const lod of [undefined, 'lite'] as const) {
        const ls = stepLayers(cfg, glasses, lod);
        expect(ls.length).toBeGreaterThan(2);
        assertClean(ls, `${id}/${p.body}/${lod ?? 'full'}`);
      }
    }
  });

  it.each(ids('accessory').filter((i) => i !== 'none'))('acessório %s: desenha em alguma etapa, camadas limpas', (id) => {
    for (const p of PEOPLE) {
      const cfg = { ...base, ...p, accessory: id } as AvatarConfig;
      for (const lod of [undefined, 'lite'] as const) {
        const ls = [...stepLayers(cfg, headAccessory, lod), ...stepLayers(cfg, overHat, lod)];
        expect(ls.length).toBeGreaterThan(1);
        assertClean(ls, `${id}/${p.body}/${lod ?? 'full'}`);
      }
    }
  });

  it('a armação fica nos olhos: lentes entre a sobrancelha e o nariz, sem passar da cabeça', () => {
    for (const p of PEOPLE) {
      const cfg = { ...base, ...p } as AvatarConfig;
      const an = buildAnatomy(cfg, resolveScene(cfg));
      const ha = headAnchors(an);
      const ctx = createCtx(cfg, resolveScene(cfg), {});
      const eb = eyeBox(headFrame(ctx));
      expect(eb.cy - eb.hh).toBeGreaterThan(ha.browY);
      expect(eb.cy + eb.hh).toBeLessThan(ha.nose[1]);
      expect(eb.dx - eb.hw).toBeGreaterThan(0.3);
      expect(eb.dx + eb.hw).toBeLessThan(eb.edge);
    }
  });

  it('todo chapéu do catálogo tem modo explícito pro cabelo (hijab cobre tudo)', () => {
    const fallback = ids('hat').filter((id) => id !== 'none' && id !== 'cap' && hatModeOf(id) === 'cap' && !['cap_back', 'beanie', 'bucket', 'flatcap', 'beret', 'durag'].includes(id));
    expect(fallback).toEqual([]);
    expect(hatModeOf('hijab')).toBe('full');
    expect(hatModeOf('turban')).toBe('wrap');
  });

  it('fone: arco por cima do boné e por baixo do chapéu de aba', () => {
    const over = stepLayers({ ...base, accessory: 'headphones', hat: 'cap' } as AvatarConfig, overHat);
    const overBrim = stepLayers({ ...base, accessory: 'headphones', hat: 'fedora' } as AvatarConfig, overHat);
    const underBrim = stepLayers({ ...base, accessory: 'headphones', hat: 'fedora' } as AvatarConfig, headAccessory);
    const underCap = stepLayers({ ...base, accessory: 'headphones', hat: 'cap' } as AvatarConfig, headAccessory);
    expect(over.length).toBeGreaterThan(overBrim.length);
    expect(underBrim.length).toBeGreaterThan(0);
    expect(underCap.length).toBe(0);
  });

  /** caixa de um path absoluto (M/C/L de smoothPath) */
  const box = (d: string) => {
    const n = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    const xs = n.filter((_, i) => i % 2 === 0);
    const ys = n.filter((_, i) => i % 2 === 1);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  };

  it('hijab: o caimento cobre os dois ombros e desce até o peito em todo corpo', () => {
    for (const p of PEOPLE) {
      const cfg = { ...base, ...p, hat: 'hijab' } as AvatarConfig;
      const an = buildAnatomy(cfg, resolveScene(cfg));
      const drape = stepLayers(cfg, hat).find((l) => l.g === 'body');
      expect(drape).toBeDefined();
      const b = box(drape!.d);
      expect(b.x0).toBeLessThan(an.cx - an.w.shoulder * 0.85);
      expect(b.x1).toBeGreaterThan(an.cx + an.w.shoulder * 0.85);
      expect(b.y1).toBeGreaterThan(an.armpitY + 4);
    }
  });

  it('chapéu de festa fica em pé (não deita) até no black power alto', () => {
    for (const body of ['slim', 'athletic', 'broad']) {
      const cfg = { ...base, body, hair: 'afro', hat: 'party' } as AvatarConfig;
      const cone = stepLayers(cfg, hat)[1];
      const b = box(cone.d);
      expect(b.y1 - b.y0).toBeGreaterThan((b.x1 - b.x0) * 0.6);
      expect(b.y0).toBeGreaterThan(0);
    }
  });

  it('o avatar inteiro com tudo da chapelaria junto continua sem NaN', () => {
    const cfg = { ...base, hat: 'cowboy', glasses: 'aviator', accessory: 'headset' } as AvatarConfig;
    for (const l of buildAvatarLayers(cfg, { groundShadow: true })) expect(BAD.test(l.d)).toBe(false);
  });
});

describe('hatLiftOf (recorte do busto)', () => {
  it('cobre todo chapéu do catálogo e soma ao cabelo alto só nos itens que sentam em cima', () => {
    for (const id of ids('hat')) expect(Number.isFinite(hatLiftOf(id, 2))).toBe(true);
    expect(hatLiftOf('none', 6.2)).toBe(6.2);
    expect(hatLiftOf('top_hat', 1.9)).toBeGreaterThan(8);
    expect(hatLiftOf('crown', 6.2)).toBeGreaterThan(hatLiftOf('crown', 1.9));
    expect(hatLiftOf('beanie', 6.2)).toBe(6.2);
  });
});
