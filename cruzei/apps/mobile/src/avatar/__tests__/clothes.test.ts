// Roupas de cima (parts/clothes*.ts): toda peça desenha camadas válidas em todo corpo, em pé e sentado, completo e lite,
// sem NaN e dentro do viewBox; e os contratos lidos pelo corpo e pela parte de baixo dão respostas coerentes.
import type { AvatarConfig } from '@cruzei/shared-types';
import { DEFAULT_AVATAR, avatarSlotDef, normalizeAvatarConfig } from '@cruzei/shared-utils';

import { buildAnatomy } from '../anatomy';
import { createCtx, type BuildOptions } from '../ctx';
import * as clothes from '../parts/clothes';
import { OUTERS, TOPS } from '../parts/clothes-kit';
import { NECK_ITEMS } from '../parts/clothes-neck';
import { resolveScene } from '../scene';
import type { AvatarGradient, AvatarLayer } from '../types';

const base = normalizeAvatarConfig(DEFAULT_AVATAR) as AvatarConfig;
const BODIES = ['slim', 'regular', 'broad', 'plus', 'curvy', 'athletic'];
const BAD = /NaN|Infinity|undefined|null/;

const ids = (slot: 'top' | 'outer' | 'neck') =>
  avatarSlotDef(slot)
    .items.map((i) => i.id)
    .filter((id) => id !== 'none');

function gradOk(g: AvatarGradient | undefined): boolean {
  if (!g) return true;
  const nums = g.t === 'l' ? [g.x1, g.y1, g.x2, g.y2] : [g.cx, g.cy, g.r, g.fx ?? 0, g.fy ?? 0];
  return nums.every(Number.isFinite) && g.s.every((st) => Number.isFinite(st[0]));
}

/** só as camadas das roupas de cima (as etapas deste dono), numa config */
function upperLayers(cfg: AvatarConfig, opts: BuildOptions = {}): AvatarLayer[] {
  const ctx = createCtx(cfg, resolveScene(cfg), opts);
  for (const fn of [clothes.hood, clothes.top, clothes.outer, clothes.neck, clothes.sleevesUpper, clothes.sleevesLower]) {
    ctx.group('body').tag(null);
    fn(ctx);
  }
  return ctx.layers;
}

function check(layers: AvatarLayer[], where: string): void {
  for (const l of layers) {
    const w = `${where}: ${JSON.stringify(l).slice(0, 140)}`;
    if (typeof l.d !== 'string' || l.d.length < 3 || BAD.test(l.d)) throw new Error(`path inválido em ${w}`);
    if (l.cp != null && BAD.test(l.cp)) throw new Error(`recorte inválido em ${w}`);
    if (!gradOk(l.gf) || !gradOk(l.gs)) throw new Error(`gradiente inválido em ${w}`);
    for (const n of [l.w, l.o, l.b]) if (n != null && !Number.isFinite(n)) throw new Error(`número inválido em ${w}`);
    // coordenadas absolutas (comandos em maiúscula) dentro do viewBox, com folga pra texturas recortadas e desfoque
    for (const [, cmd, args] of l.d.matchAll(/([A-Za-z])([^A-Za-z]*)/g)) {
      if (cmd !== cmd.toUpperCase()) continue;
      const nums = (args.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
      const m = l.cp ? 30 : 12; // textura recortada pode sobrar fora (o recorte esconde)
      if (nums.some((n) => n < -m || n > 140 + m)) throw new Error(`fora do viewBox em ${w}`);
    }
  }
}

describe('roupas de cima', () => {
  const variants: { name: string; cfg: Partial<AvatarConfig>; opts?: BuildOptions }[] = [
    { name: 'em pé', cfg: {} },
    { name: 'lite', cfg: {}, opts: { lod: 'lite' } },
    { name: 'sentado', cfg: { vehicle: 'wheelchair' } },
  ];

  it.each(ids('top'))('parte de cima %s desenha em todo corpo, em pé/lite/sentado', (top) => {
    for (const body of BODIES)
      for (const v of variants) {
        const layers = upperLayers({ ...base, ...v.cfg, body, top } as AvatarConfig, v.opts);
        expect(layers.length).toBeGreaterThan(4);
        check(layers, `${top}/${body}/${v.name}`);
      }
  });

  it.each(ids('outer'))('sobreposição %s desenha em todo corpo', (outer) => {
    for (const body of BODIES)
      for (const v of variants) {
        const cfg = { ...base, ...v.cfg, body, top: 'shirt', outer } as AvatarConfig;
        const plain = upperLayers({ ...cfg, outer: 'none' }, v.opts).length;
        const layers = upperLayers(cfg, v.opts);
        expect(layers.length).toBeGreaterThan(plain);
        check(layers, `${outer}/${body}/${v.name}`);
      }
  });

  it.each(ids('neck'))('item de pescoço %s desenha', (neck) => {
    for (const body of BODIES)
      for (const top of ['tee', 'shirt', 'tank', 'turtleneck']) {
        const cfg = { ...base, body, top, neck } as AvatarConfig;
        const layers = upperLayers(cfg);
        expect(layers.length).toBeGreaterThan(upperLayers({ ...cfg, neck: 'none' }).length);
        check(layers, `${neck}/${body}/${top}`);
      }
  });

  it('todo id do catálogo tem desenho próprio (tabelas e pescoço)', () => {
    for (const id of ids('top')) expect(TOPS[id]).toBeDefined();
    for (const id of ids('outer')) expect(OUTERS[id]).toBeDefined();
    for (const id of ids('neck')) expect(NECK_ITEMS as readonly string[]).toContain(id);
  });

  it('peças diferentes desenham coisas diferentes (nada de placeholder repetido)', () => {
    const sig = (cfg: Partial<AvatarConfig>) =>
      upperLayers({ ...base, ...cfg } as AvatarConfig)
        .map((l) => l.d)
        .join('|');
    const tops = new Set(ids('top').map((top) => sig({ top })));
    expect(tops.size).toBe(ids('top').length);
    const outers = new Set(ids('outer').map((outer) => sig({ top: 'tee', outer })));
    expect(outers.size).toBe(ids('outer').length);
    const necks = new Set(ids('neck').map((neck) => sig({ top: 'tee', neck })));
    expect(necks.size).toBe(ids('neck').length);
  });

  it('a camiseta do orgulho muda com a bandeira', () => {
    const a = upperLayers({ ...base, top: 'pride_tee', prideFlag: 'rainbow' } as AvatarConfig);
    const b = upperLayers({ ...base, top: 'pride_tee', prideFlag: 'trans' } as AvatarConfig);
    const fills = (ls: AvatarLayer[]) => ls.map((l) => l.f ?? '').join(',');
    expect(fills(a)).not.toBe(fills(b));
  });

  it('mangas acompanham o braço (grupos armX/foreX)', () => {
    const groups = (cfg: Partial<AvatarConfig>) => new Set(upperLayers({ ...base, ...cfg } as AvatarConfig).map((l) => l.g));
    const longS = groups({ top: 'shirt' });
    for (const g of ['armL', 'armR', 'foreL', 'foreR']) expect(longS.has(g as never)).toBe(true);
    const shortS = groups({ top: 'tee' });
    expect(shortS.has('armL')).toBe(true);
    expect(shortS.has('foreL')).toBe(false);
    const none = groups({ top: 'tank' });
    expect(none.has('armL')).toBe(false);
  });
});

describe('contratos das roupas de cima', () => {
  const cfg = (c: Partial<AvatarConfig>) => ({ ...base, ...c }) as AvatarConfig;

  it('sleeveKind considera a sobreposição', () => {
    expect(clothes.sleeveKind(cfg({ top: 'tee' }))).toBe('short');
    expect(clothes.sleeveKind(cfg({ top: 'tank' }))).toBe('none');
    expect(clothes.sleeveKind(cfg({ top: 'shirt' }))).toBe('long');
    expect(clothes.sleeveKind(cfg({ top: 'tee', outer: 'blazer' }))).toBe('long');
    expect(clothes.sleeveKind(cfg({ top: 'tank', outer: 'vest' }))).toBe('none');
    expect(clothes.sleeveKind(cfg({ top: 'linen' }))).toBe('short');
  });

  it('bottomKind: vestido e vestido de gala cobrem as pernas', () => {
    expect(clothes.bottomKind(cfg({ top: 'dress' }))).toBe('dress');
    expect(clothes.bottomKind(cfg({ top: 'gown' }))).toBe('dress');
    expect(clothes.bottomKind(cfg({ top: 'tee', bottom: 'skirt' }))).toBe('skirt');
  });

  it('neckCoverY: só golas que sobem pelo pescoço', () => {
    for (const body of BODIES) {
      const an = buildAnatomy(cfg({ body }));
      expect(clothes.neckCoverY(cfg({ body, top: 'tee' }), an)).toBeNull();
      const turtle = clothes.neckCoverY(cfg({ body, top: 'turtleneck' }), an);
      const collar = clothes.neckCoverY(cfg({ body, top: 'shirt' }), an);
      expect(turtle).not.toBeNull();
      expect(collar).not.toBeNull();
      expect(turtle as number).toBeLessThan(collar as number);
      expect(collar as number).toBeLessThan(an.collarY);
      expect(clothes.neckCoverY(cfg({ body, top: 'tee', neck: 'scarf' }), an)).not.toBeNull();
    }
  });

  it('topHemY: cropped acima da cintura, túnica abaixo da camiseta, nunca abaixo do gancho', () => {
    for (const body of BODIES) {
      const hem = (top: string) => {
        const c = cfg({ body, top });
        return clothes.topHemY(createCtx(c, resolveScene(c), {}));
      };
      const an = buildAnatomy(cfg({ body }));
      expect(hem('crop')).toBeLessThan(an.waistY);
      expect(hem('tunic')).toBeGreaterThan(hem('tee'));
      for (const top of ids('top')) expect(hem(top)).toBeLessThanOrEqual(an.torsoBottom);
    }
  });

  it('neckItem aceita o colar antigo do slot accessory', () => {
    expect(clothes.neckItem(cfg({ neck: 'none', accessory: 'chain' }))).toBe('chain');
    expect(clothes.neckItem(cfg({ neck: 'pearls', accessory: 'chain' }))).toBe('pearls');
    expect(clothes.neckItem(cfg({ neck: 'none', accessory: 'earrings' }))).toBe('none');
    expect(clothes.waistShown(cfg({ top: 'crop' }))).toBe(true);
  });
});
