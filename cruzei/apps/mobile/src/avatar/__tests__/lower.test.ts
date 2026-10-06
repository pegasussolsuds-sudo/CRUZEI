// Parte de baixo, calçados, bolsas/costas e pulso: todo id do catálogo desenha algo próprio, sem NaN em nenhum corpo,
// em pé e sentado, no completo e no lite; cada peça no grupo certo do esqueleto; calça entra na bota alta.
import type { AvatarConfig } from '@cruzei/shared-types';
import { AVATAR_ITEM_SLOTS, DEFAULT_AVATAR, normalizeAvatarConfig } from '@cruzei/shared-utils';

import { createCtx, type LayerCtx } from '../ctx';
import { buildAvatarLayers } from '../layers';
import { bagBack, bagFront, bottom, legsVisible, shoes, wrist } from '../parts/lower';
import { BAG_KINDS } from '../parts/lower-bags';
import { BOTTOM_KINDS } from '../parts/lower-bottoms';
import { SHOE_KINDS } from '../parts/lower-shoes';
import { WRIST_KINDS } from '../parts/lower-wrist';
import { resolveScene } from '../scene';
import type { AvatarGroup, AvatarLayer } from '../types';

const BAD = /NaN|Infinity|undefined|null/;
const base = normalizeAvatarConfig(DEFAULT_AVATAR) as AvatarConfig;
const ids = (slot: string): string[] => AVATAR_ITEM_SLOTS.find((s) => s.slot === slot)?.items.map((i) => i.id) ?? [];
const BODIES = ['slim', 'regular', 'broad', 'plus', 'curvy', 'athletic'];

type Step = (ctx: LayerCtx) => void;

/** camadas de uma etapa isolada, com o grupo inicial que o layers.ts dá a ela */
function stepLayers(cfg: AvatarConfig, step: Step, g: AvatarGroup, lod?: 'lite'): AvatarLayer[] {
  const ctx = createCtx(cfg, resolveScene(cfg), { lod } as never);
  ctx.group(g);
  step(ctx);
  return ctx.layers;
}

function assertClean(layers: AvatarLayer[], where: string): void {
  for (const l of layers) {
    if (!l.d || BAD.test(l.d) || (l.cp && BAD.test(l.cp))) throw new Error(`path inválido em ${where}`);
    if (l.gf && BAD.test(JSON.stringify(l.gf))) throw new Error(`gradiente inválido em ${where}`);
    if (l.gs && BAD.test(JSON.stringify(l.gs))) throw new Error(`gradiente inválido em ${where}`);
    if (l.o != null && !(l.o >= 0 && l.o <= 1)) throw new Error(`opacidade fora de 0..1 em ${where}`);
    if (l.w != null && !Number.isFinite(l.w)) throw new Error(`traço inválido em ${where}`);
  }
}

/** maior y citado num path (bom o bastante pra comparar alturas) */
function maxY(d: string): number {
  const n = d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
  let m = -Infinity;
  for (let i = 1; i < n.length; i += 2) m = Math.max(m, n[i]);
  return m;
}

const seats: Partial<AvatarConfig>[] = [{ vehicle: 'none' }, { vehicle: 'wheelchair' }, { vehicle: 'bike' }];

describe('parte de baixo, calçados, bolsas e pulso', () => {
  it.each([
    ['bottom', BOTTOM_KINDS],
    ['shoes', SHOE_KINDS],
    ['bag', BAG_KINDS],
    ['wrist', WRIST_KINDS],
  ] as const)('todo id do slot %s tem desenho próprio', (slot, kinds) => {
    const drawn = new Set<string>(kinds);
    expect(ids(slot).filter((id) => id !== 'none' && !drawn.has(id))).toEqual([]);
  });

  it.each(ids('bottom'))('parte de baixo %s: limpa nos 6 corpos, em pé e sentado, completo e lite', (id) => {
    for (const body of BODIES) {
      for (const seat of seats) {
        for (const lod of [undefined, 'lite'] as const) {
          const ls = stepLayers({ ...base, body, ...seat, bottom: id } as AvatarConfig, bottom, 'legL', lod);
          expect(ls.length).toBeGreaterThan(3);
          assertClean(ls, `${id}/${body}/${seat.vehicle}/${lod ?? 'full'}`);
          for (const l of ls) expect(['body', 'legL', 'legR', 'shinL', 'shinR']).toContain(l.g);
        }
      }
    }
  });

  it.each(ids('shoes'))('calçado %s: limpo, no grupo da canela, nos 6 corpos (com calça e de perna de fora)', (id) => {
    for (const body of BODIES) {
      for (const b of ['jeans', 'shorts', 'wide']) {
        for (const seat of seats) {
          for (const lod of [undefined, 'lite'] as const) {
            const ls = stepLayers({ ...base, body, ...seat, bottom: b, shoes: id } as AvatarConfig, shoes, 'shinL', lod);
            expect(ls.length).toBeGreaterThan(3);
            assertClean(ls, `${id}/${body}/${b}/${seat.vehicle}/${lod ?? 'full'}`);
            for (const l of ls) expect(['shinL', 'shinR']).toContain(l.g);
          }
        }
      }
    }
  });

  it.each(ids('bag').filter((i) => i !== 'none'))('bolsa/costas %s: desenha em alguma etapa, limpa, no tronco (clutch na mão)', (id) => {
    for (const body of BODIES) {
      for (const seat of seats) {
        for (const lod of [undefined, 'lite'] as const) {
          const cfg = { ...base, body, ...seat, bag: id } as AvatarConfig;
          const ls = [...stepLayers(cfg, bagBack, 'body', lod), ...stepLayers(cfg, bagFront, 'body', lod), ...stepLayers(cfg, wrist, 'foreL', lod)];
          expect(ls.length).toBeGreaterThan(2);
          assertClean(ls, `${id}/${body}/${seat.vehicle}/${lod ?? 'full'}`);
          for (const l of ls) expect(['body', 'foreL']).toContain(l.g);
        }
      }
    }
  });

  it.each(ids('wrist').filter((i) => i !== 'none'))('pulso %s: limpo e no antebraço esquerdo', (id) => {
    for (const body of BODIES) {
      for (const seat of seats) {
        for (const lod of [undefined, 'lite'] as const) {
          const ls = stepLayers({ ...base, body, ...seat, wrist: id } as AvatarConfig, wrist, 'foreL', lod);
          // no lite (mapa) uma peça lisa pode virar uma camada só
          expect(ls.length).toBeGreaterThan(lod ? 0 : 1);
          assertClean(ls, `${id}/${body}/${seat.vehicle}/${lod ?? 'full'}`);
          for (const l of ls) expect(l.g).toBe('foreL');
        }
      }
    }
  });

  it('cada id desenha diferente dos outros do mesmo slot (nada de placeholder repetido)', () => {
    const slots: [keyof AvatarConfig, Step, AvatarGroup, Partial<AvatarConfig>][] = [
      ['bottom', bottom, 'legL', {}],
      ['shoes', shoes, 'shinL', { bottom: 'shorts' }],
      ['wrist', wrist, 'foreL', {}],
    ];
    for (const [slot, step, g, extra] of slots) {
      const seen = new Map<string, string>();
      for (const id of ids(slot).filter((i) => i !== 'none')) {
        const sig = stepLayers({ ...base, ...extra, [slot]: id } as AvatarConfig, step, g)
          .map((l) => l.d)
          .join('|');
        expect(seen.get(sig) ?? id).toBe(id);
        seen.set(sig, id);
      }
    }
    const bagSeen = new Map<string, string>();
    for (const id of ids('bag').filter((i) => i !== 'none')) {
      const cfg = { ...base, bag: id } as AvatarConfig;
      const sig = [...stepLayers(cfg, bagBack, 'body'), ...stepLayers(cfg, bagFront, 'body'), ...stepLayers(cfg, wrist, 'foreL')].map((l) => l.d).join('|');
      expect(bagSeen.get(sig) ?? id).toBe(id);
      bagSeen.set(sig, id);
    }
  });

  it('pele da perna aparece só com short, saia ou vestido', () => {
    expect(legsVisible({ ...base, bottom: 'jeans' } as AvatarConfig)).toBe(false);
    expect(legsVisible({ ...base, bottom: 'wide' } as AvatarConfig)).toBe(false);
    for (const b of ['shorts', 'bermuda', 'skirt', 'pleated', 'midi', 'kilt', 'tutu']) expect(legsVisible({ ...base, bottom: b } as AvatarConfig)).toBe(true);
    expect(legsVisible({ ...base, top: 'dress', bottom: 'jeans' } as AvatarConfig)).toBe(true);
  });

  it('calça larga entra na bota alta: a perna da calça para na boca do cano (não espia do lado da bota)', () => {
    for (const body of BODIES) {
      const shin = (sh: string) => stepLayers({ ...base, body, bottom: 'cargo', shoes: sh } as AvatarConfig, bottom, 'legL').find((l) => l.g === 'shinL');
      const free = shin('sneakers');
      const tucked = shin('combat');
      expect(free && tucked).toBeTruthy();
      expect(maxY(tucked!.d)).toBeLessThan(maxY(free!.d) - 4);
    }
  });

  it('look completo (calça, bota, mochila, relógio) em todos os corpos e veículos continua sem NaN', () => {
    for (const body of BODIES) {
      for (const vehicle of ['none', 'wheelchair', 'car', 'moto', 'carpet']) {
        for (const lod of [undefined, 'lite'] as const) {
          const cfg = { ...base, body, vehicle, bottom: 'tailored', shoes: 'texan', bag: 'wings_dragon', wrist: 'luxury' } as AvatarConfig;
          assertClean(buildAvatarLayers(cfg, { lod } as never), `${body}/${vehicle}/${lod ?? 'full'}`);
        }
      }
    }
  });
});
