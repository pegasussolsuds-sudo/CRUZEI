// Cabelo e barba: todo id do catálogo desenha algo próprio (nada de placeholder), sem NaN em nenhum rosto/corpo, no
// completo e no lite; contrato com os modos de chapéu (hat-modes.ts): boné/aba achatam, turbante e hijab escondem.
import type { AvatarConfig } from '@cruzei/shared-types';
import { AVATAR_ITEM_SLOTS, DEFAULT_AVATAR, normalizeAvatarConfig } from '@cruzei/shared-utils';

import { faceDims } from '../anatomy';
import { createCtx } from '../ctx';
import { HAIR_STYLES, facialHair, hairBack, hairFront } from '../parts/hair';
import { BEARDS } from '../parts/hair-beard';
import { resolveScene } from '../scene';
import type { AvatarLayer } from '../types';

const BAD = /NaN|Infinity|undefined|null/;
const base = normalizeAvatarConfig(DEFAULT_AVATAR) as AvatarConfig;
const ids = (slot: string): string[] => AVATAR_ITEM_SLOTS.find((s) => s.slot === slot)?.items.map((i) => i.id) ?? [];

const PEOPLE: Partial<AvatarConfig>[] = [
  { body: 'curvy', faceShape: 'heart', eyes: 'almond', hairColor: 'h_brown', skin: 's2' },
  { body: 'athletic', faceShape: 'square', eyes: 'round', hairColor: 'h_black', skin: 's8' },
  { body: 'plus', faceShape: 'round', eyes: 'hooded', hairColor: 'h_silver', skin: 's11', lines: 'soft' },
  { body: 'broad', faceShape: 'long', eyes: 'downturned', hairColor: 'h_salt', skin: 's14', lines: 'marked' },
  { body: 'slim', faceShape: 'diamond', eyes: 'monolid', hairColor: 'h_lavender', skin: 's10' },
];

type Step = (ctx: ReturnType<typeof createCtx>) => void;

function stepLayers(cfg: AvatarConfig, steps: Step[], lod?: 'lite'): AvatarLayer[] {
  const ctx = createCtx(cfg, resolveScene(cfg), { lod } as never);
  for (const st of steps) st(ctx);
  return ctx.layers;
}

function assertClean(layers: AvatarLayer[], where: string): void {
  for (const l of layers) {
    if (typeof l.d !== 'string' || l.d.length < 3 || BAD.test(l.d) || (l.cp && BAD.test(l.cp))) throw new Error(`path inválido em ${where}`);
    if (l.gf && BAD.test(JSON.stringify(l.gf))) throw new Error(`gradiente inválido em ${where}`);
    if (l.o != null && (l.o < 0 || l.o > 1)) throw new Error(`opacidade fora de 0..1 em ${where}: ${l.o}`);
    if (l.b != null && !Number.isFinite(l.b)) throw new Error(`desfoque inválido em ${where}`);
    if (!l.f && !l.s && !l.gf && !l.gs) throw new Error(`camada sem tinta em ${where}`);
    expect(l.g).toBe('head');
  }
}

/** menor y entre os pontos "x,y" do path */
function minY(d: string): number {
  let m = Infinity;
  for (const [, , y] of d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)) m = Math.min(m, Number(y));
  return m;
}

const cfgOf = (p: Partial<AvatarConfig>, extra: Partial<AvatarConfig>) => normalizeAvatarConfig({ ...base, ...p, ...extra }) as AvatarConfig;

describe('cabelo', () => {
  const hairs = ids('hair');

  it('todo cabelo do catálogo tem desenho (só careca é vazio)', () => {
    expect(hairs.length).toBeGreaterThanOrEqual(32);
    for (const h of hairs) {
      if (h === 'bald') continue;
      const st = HAIR_STYLES[h];
      expect(st && (st.front || st.back)).toBeTruthy();
    }
  });

  it('cada cabelo desenha algo diferente dos outros (nada reaproveitado como placeholder)', () => {
    const seen = new Map<string, string>();
    for (const h of hairs) {
      if (h === 'bald') continue;
      const key = stepLayers(cfgOf(PEOPLE[0], { hair: h }), [hairBack, hairFront])
        .map((l) => l.d)
        .join('|');
      expect(key.length).toBeGreaterThan(100);
      if (seen.has(key)) throw new Error(`${h} desenha igual a ${seen.get(key)}`);
      seen.set(key, h);
    }
  });

  it.each(PEOPLE.map((p, i) => [i, p] as const))('sem NaN, no completo e no lite (pessoa %i)', (_i, p) => {
    for (const h of hairs) {
      for (const lod of [undefined, 'lite'] as const) {
        const cfg = cfgOf(p, { hair: h });
        assertClean(stepLayers(cfg, [hairBack, hairFront], lod), `${h} ${lod ?? 'full'}`);
      }
    }
  });

  it('hijab esconde todo o cabelo; turbante só deixa o que cai abaixo da mandíbula, atrás', () => {
    for (const h of hairs) {
      const p = PEOPLE[1];
      expect(stepLayers(cfgOf(p, { hair: h, hat: 'hijab' }), [hairBack, hairFront])).toHaveLength(0);
      const wrap = stepLayers(cfgOf(p, { hair: h, hat: 'turban' }), [hairFront]);
      expect(wrap).toHaveLength(0);
      const back = stepLayers(cfgOf(p, { hair: h, hat: 'turban' }), [hairBack]);
      for (const l of back) expect(l.cp).toBeTruthy();
    }
  });

  it('boné e aba: nada do cabelo sobe muito acima do crânio', () => {
    for (const hat of ['cap', 'fedora', 'beanie']) {
      for (const p of PEOPLE) {
        for (const h of hairs) {
          const cfg = cfgOf(p, { hair: h, hat });
          const ctx = createCtx(cfg, resolveScene(cfg), {} as never);
          const crown = faceDims(ctx.an).crownY;
          for (const l of stepLayers(cfg, [hairFront])) {
            if (l.b || l.cp) continue;
            if (minY(l.d) < crown - 1.6) throw new Error(`${h} com ${hat} passa do chapéu (y ${minY(l.d).toFixed(1)} < ${(crown - 1.6).toFixed(1)})`);
          }
        }
      }
    }
  });
});

describe('barba', () => {
  const beards = ids('facialHair');

  it('toda barba do catálogo tem desenho', () => {
    expect(beards.length).toBeGreaterThanOrEqual(11);
    for (const b of beards) if (b !== 'none') expect(typeof BEARDS[b]).toBe('function');
  });

  it('cada barba é diferente, em todo formato de rosto, sem NaN (completo e lite)', () => {
    for (const p of PEOPLE) {
      const seen = new Set<string>();
      for (const b of beards) {
        if (b === 'none') continue;
        for (const lod of [undefined, 'lite'] as const) {
          const layers = stepLayers(cfgOf(p, { facialHair: b }), [facialHair], lod);
          expect(layers.length).toBeGreaterThan(0);
          assertClean(layers, `${b} ${p.faceShape} ${lod ?? 'full'}`);
          if (!lod) {
            const key = layers.map((l) => l.d).join('|');
            expect(seen.has(key)).toBe(false);
            seen.add(key);
          }
        }
      }
    }
  });

  it('a barba continua com hijab (só o cabelo some)', () => {
    expect(stepLayers(cfgOf(PEOPLE[1], { facialHair: 'beard', hat: 'hijab' }), [facialHair]).length).toBeGreaterThan(0);
  });
});
