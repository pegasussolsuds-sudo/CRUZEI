// Auras e fundos (lógica, sem Skia): parâmetros, contagem de partículas por nível, números finitos em toda chamada
// da caneta, quadro parado determinístico, figura por corpo e o modelo SVG estático das listas.

import type { AvatarConfig } from '@cruzei/shared-types';
import { AVATAR_ITEM_SLOTS, DEFAULT_AVATAR } from '@cruzei/shared-utils';

// só os enums do Skia (a caneta Skia não roda aqui; a lógica usa uma caneta de conferência)
jest.mock('@shopify/react-native-skia', () => ({ ...jest.requireActual('@shopify/react-native-skia/lib/commonjs/skia/types'), Skia: {} }));

import { AVATAR_BUST_VIEWBOX, AVATAR_VIEWBOX } from '../../../../avatar/layers';
import { flagOf } from '../../../../avatar/parts/flags';
import { AURA_IDS, AURA_PARTICLES, auraFigure, auraFrame, auraSpec, drawAura, flagRings, svgAuraFrame, drawAuraUnits, type AuraSpec } from '../fx-auras';
import { BACKDROP_IDS, backdropSpec, drawBackdropPart, drawBackdropSvg, stageBdFrame } from '../fx-backdrops';
import { hexRgb, retint, type FxPaint, type Pen } from '../fx-core';
import { SHAPES } from '../fx-shapes';
import { svgPen, fxSvgToString } from '../fx-svg';
import { stageLayout } from '../layout';

/** caneta que só confere os números e conta os desenhos */
function checkPen(lite = false): Pen & { calls: number; bad: string[]; log: string[] } {
  const bad: string[] = [];
  const log: string[] = [];
  const st = { calls: 0 };
  const chk = (name: string, nums: number[], p?: FxPaint) => {
    st.calls++;
    const all = [...nums];
    if (p) {
      for (const v of [p.a, p.w, p.c]) if (v != null) all.push(v);
      if (p.g) {
        const g = p.g;
        all.push(...(g.t === 'l' ? [g.x1, g.y1, g.x2, g.y2] : [g.cx, g.cy, g.r]));
        for (const s of g.s) all.push(...s);
      }
    }
    if (all.some((n) => typeof n !== 'number' || !Number.isFinite(n))) bad.push(`${name}(${all.join(',')})`);
    log.push(name + ':' + all.map((n) => Math.round(n * 1000)).join(','));
  };
  const pen = {
    lite,
    get calls() {
      return st.calls;
    },
    bad,
    log,
    save: () => undefined,
    restore: () => undefined,
    translate: (x: number, y: number) => chk('translate', [x, y]),
    rotate: (d: number) => chk('rotate', [d]),
    scale: (x: number, y: number) => chk('scale', [x, y]),
    circle: (x: number, y: number, r: number, p: FxPaint) => chk('circle', [x, y, r], p),
    oval: (x: number, y: number, rx: number, ry: number, p: FxPaint) => chk('oval', [x, y, rx, ry], p),
    rect: (x: number, y: number, w: number, h: number, p: FxPaint) => chk('rect', [x, y, w, h], p),
    rrect: (x: number, y: number, w: number, h: number, r: number, p: FxPaint) => chk('rrect', [x, y, w, h, r], p),
    path: (c: number[], p: FxPaint) => chk('path', c, p),
    shape: (k: string, x: number, y: number, s: number, r: number, p: FxPaint, sx?: number, sy?: number) => {
      if (!SHAPES[k]) bad.push('forma desconhecida ' + k);
      chk('shape', [x, y, s, r, sx ?? 1, sy ?? 1], p);
    },
    glow: (x: number, y: number, r: number, c: number, a: number) => chk('glow', [x, y, r, c, a]),
    glowOval: (x: number, y: number, rx: number, ry: number, c: number, a: number) => chk('glowOval', [x, y, rx, ry, c, a]),
    ring: (x: number, y: number, rx: number, ry: number, w: number, cols: number[], rot: number, a: number) => chk('ring', [x, y, rx, ry, w, rot, a, ...cols]),
    clipRRect: (x: number, y: number, w: number, h: number, r: number) => chk('clip', [x, y, w, h, r]),
    clipOval: (x: number, y: number, rx: number, ry: number) => chk('clip', [x, y, rx, ry]),
  };
  return pen as unknown as Pen & { calls: number; bad: string[]; log: string[] };
}

const rainbow = flagOf('rainbow');
const slotIds = (slot: string) => (AVATAR_ITEM_SLOTS.find((d) => d.slot === slot)?.items ?? []).map((i) => i.id).filter((id) => id !== 'none');
const full = stageLayout('full', 320);
const bust = stageLayout('bust', 200);
const F_FULL = auraFrame({ w: full.w, h: full.h }, full.body, null);
const F_BUST = auraFrame({ w: bust.w, h: bust.h }, bust.body, AVATAR_BUST_VIEWBOX);
const TIMES = [0, 0.37, 1.3, 2.71, 7.9, 61.4];

describe('auras: catálogo e parâmetros', () => {
  it('toda aura do catálogo (menos none) tem desenho próprio', () => {
    const ids = slotIds('aura');
    expect(ids.length).toBe(22);
    for (const id of ids) expect(AURA_IDS).toContain(id);
  });

  it('none e vazio = sem aura; id desconhecido cai numa aura válida', () => {
    expect(auraSpec('none', null, 'medium', rainbow)).toBeNull();
    expect(auraSpec('', null, 'medium', rainbow)).toBeNull();
    expect(auraSpec('xyz', null, 'medium', rainbow)?.id).toBe('lime');
  });

  it('partículas por nível: suave 12, média 20, intensa 32 (e menos no estático)', () => {
    for (const lv of ['soft', 'medium', 'max'] as const) {
      const s = auraSpec('sparkle', null, lv, rainbow) as AuraSpec;
      expect(s.n).toBe(AURA_PARTICLES[lv]);
      expect((auraSpec('sparkle', null, lv, rainbow, true) as AuraSpec).n).toBeLessThan(s.n);
    }
    expect(auraSpec('sparkle', null, 'qualquer', rainbow)?.n).toBe(20);
  });

  it('tinta: a_auto (null) mantém as cores; com tinta a paleta inteira muda de matiz e o branco continua branco', () => {
    const orig = auraSpec('flames', null, 'medium', rainbow) as AuraSpec;
    const blue = auraSpec('flames', '#00E5FF', 'medium', rainbow) as AuraSpec;
    expect(orig.c[0]).toBe(0xff7a1a);
    expect(blue.c[0]).not.toBe(orig.c[0]);
    const b = blue.c[0] & 255;
    const r = (blue.c[0] >> 16) & 255;
    expect(b).toBeGreaterThan(r);
    expect(retint(0xffffff, 0xff7a1a, 0x00e5ff)).toBe(0xffffff);
  });

  it('aura do orgulho usa as listras da bandeira (overlays viram anéis)', () => {
    const trans = auraSpec('pride', null, 'medium', flagOf('trans')) as AuraSpec;
    expect(trans.flag).toEqual([0x5bcefa, 0xf5a9b8, 0xffffff, 0xf5a9b8, 0x5bcefa]);
    expect(flagRings(flagOf('progress')).c.length).toBe(11);
    expect(flagRings(flagOf('intersex')).c).toContain(0x7902aa);
    expect(hexRgb('#abc', 0)).toBe(0xaabbcc);
  });

  it('figura acompanha o corpo e a cadeira de rodas abaixa a cabeça', () => {
    const slim = auraFigure({ ...DEFAULT_AVATAR, body: 'slim' } as AvatarConfig);
    const plus = auraFigure({ ...DEFAULT_AVATAR, body: 'plus' } as AvatarConfig);
    const chair = auraFigure({ ...DEFAULT_AVATAR, vehicle: 'wheelchair' } as AvatarConfig);
    const stand = auraFigure({ ...DEFAULT_AVATAR } as AvatarConfig);
    expect(plus.hy).toBeGreaterThan(slim.hy);
    expect(chair.hy).toBeGreaterThan(stand.hy + 10);
    for (const f of [slim, plus, chair, stand]) for (const v of Object.values(f)) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('auras: desenho', () => {
  it('as 22 auras × níveis × camadas × modos × tempos: só números finitos e formas conhecidas', () => {
    for (const id of AURA_IDS) {
      for (const lv of ['soft', 'medium', 'max']) {
        for (const tint of [null, '#9B5CFF']) {
          const S = auraSpec(id, tint, lv, flagOf(id === 'pride' ? 'progress' : 'rainbow')) as AuraSpec;
          for (const F of [F_FULL, F_BUST]) {
            for (const t of TIMES) {
              for (const front of [false, true]) {
                const P = checkPen();
                drawAura(P, S, F, t, front);
                if (P.bad.length) throw new Error(`${id}/${lv}/${front ? 'frente' : 'trás'}/t=${t}: ${P.bad.slice(0, 3).join(' ')}`);
              }
            }
          }
        }
      }
    }
  });

  it('custo por quadro limitado (desenhos por camada) e a camada de trás sempre desenha algo', () => {
    for (const id of AURA_IDS) {
      const S = auraSpec(id, null, 'max', rainbow) as AuraSpec;
      let worst = 0;
      for (const t of TIMES) {
        const back = checkPen();
        drawAura(back, S, F_FULL, t, false);
        const front = checkPen();
        drawAura(front, S, F_FULL, t, true);
        expect(back.calls).toBeGreaterThan(2);
        worst = Math.max(worst, back.calls + front.calls);
      }
      // ~32 partículas × poucas chamadas cada + a estrutura (anéis, chamas, raios)
      expect({ id, worst: worst <= 420 }).toEqual({ id, worst: true });
    }
  });

  it('mesmo t = mesmo quadro (sem Math.random); t diferente = quadro diferente', () => {
    for (const id of AURA_IDS) {
      const S = auraSpec(id, null, 'medium', rainbow) as AuraSpec;
      const a = checkPen();
      const b = checkPen();
      const c = checkPen();
      drawAura(a, S, F_FULL, S.still, false);
      drawAura(b, S, F_FULL, S.still, false);
      drawAura(c, S, F_FULL, S.still + 0.5, false);
      expect(a.log).toEqual(b.log);
      expect(a.log.join('|')).not.toEqual(c.log.join('|'));
    }
  });

  it('versão estática (SVG das listas): modelo sem NaN e enxuto', () => {
    for (const id of AURA_IDS) {
      for (const isBust of [false, true]) {
        const S = auraSpec(id, null, 'medium', rainbow, true) as AuraSpec;
        const vb = isBust ? AVATAR_BUST_VIEWBOX : AVATAR_VIEWBOX;
        const F = svgAuraFrame(vb, isBust);
        let nodes = 0;
        for (const front of [false, true]) {
          const P = svgPen(SHAPES, true);
          drawAuraUnits(P, S, F, S.still, front);
          const m = P.model();
          nodes += m.nodes.length;
          const str = fxSvgToString(m, 'x_');
          expect(str).not.toMatch(/NaN|Infinity|undefined/);
        }
        expect({ id, nodes: nodes <= 140 }).toEqual({ id, nodes: true });
      }
    }
  });
});

describe('fundos', () => {
  it('todo fundo do catálogo (menos none) tem desenho próprio', () => {
    const ids = slotIds('backdrop');
    expect(ids.length).toBe(14);
    for (const id of ids) expect(BACKDROP_IDS).toContain(id);
    expect(backdropSpec('none', rainbow, { w: 100, h: 100 })).toBeNull();
  });

  it('as 3 partes de cada fundo, nos dois modos e vários tempos: só números finitos', () => {
    for (const id of BACKDROP_IDS) {
      for (const L of [full, bust]) {
        const box = { w: L.w, h: L.h };
        const S = backdropSpec(id, flagOf('progress'), box);
        expect(S).not.toBeNull();
        const B = stageBdFrame(box);
        for (const t of TIMES) {
          for (let part = 0; part < 3; part++) {
            const P = checkPen();
            drawBackdropPart(P, S as NonNullable<typeof S>, B, t, part);
            if (P.bad.length) throw new Error(`${id}/parte ${part}/t=${t}: ${P.bad.slice(0, 3).join(' ')}`);
            if (part === 1) expect(P.calls).toBeLessThanOrEqual(200);
          }
        }
      }
    }
  });

  it('fundo do orgulho traz as peças oficiais da bandeira (anel intersexo em evenodd)', () => {
    const S = backdropSpec('pride', flagOf('intersex'), { w: 256, h: 320 });
    expect(S?.flag.some((p) => p.eo && p.f === 0x7902aa)).toBe(true);
    expect(backdropSpec('pride', flagOf('progress'), { w: 256, h: 320 })?.flag.length).toBe(11);
  });

  it('versão estática (SVG): sem NaN, recorte e tamanho de lista', () => {
    for (const id of BACKDROP_IDS) {
      for (const isBust of [false, true]) {
        const vb = isBust ? AVATAR_BUST_VIEWBOX : AVATAR_VIEWBOX;
        const S = backdropSpec(id, rainbow, { w: vb.w, h: vb.h });
        const P = svgPen(SHAPES, true);
        drawBackdropSvg(P, S as NonNullable<typeof S>, vb, isBust);
        const m = P.model();
        expect(m.clips.length).toBeGreaterThan(0);
        expect(fxSvgToString(m, 'b_')).not.toMatch(/NaN|Infinity|undefined/);
        expect({ id, nodes: m.nodes.length <= 260 }).toEqual({ id, nodes: true });
      }
    }
  });
});
