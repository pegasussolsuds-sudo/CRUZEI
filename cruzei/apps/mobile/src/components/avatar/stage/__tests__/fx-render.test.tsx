// Render de verdade das auras e fundos: o Skia aqui é o CanvasKit (CPU, a mesma API do react-native-skia, como na
// folha de prova). Desenha cada aura e cada fundo num canvas do tamanho do palco e confere pixels; monta o AuraFx e o
// BackdropFx com um Reanimated mínimo e confere que a SkPicture do quadro sai gravada.

import type { SkCanvas, SkSurface } from '@shopify/react-native-skia';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

// sem @types/node no app: o mínimo do 'path' e do require.resolve, tipado à mão
const path = jest.requireActual('path') as { join(...p: string[]): string; dirname(p: string): string };
const resolve = (require as unknown as { resolve(id: string): string }).resolve;

const mockSk: { api: unknown } = { api: null };

jest.mock('@shopify/react-native-skia', () => {
  const R = jest.requireActual('react');
  const types = jest.requireActual('@shopify/react-native-skia/lib/commonjs/skia/types');
  const host = (name: string) =>
    function Host(props: Record<string, unknown>) {
      return R.createElement(name, props, props.children as never);
    };
  return {
    ...types,
    get Skia() {
      return mockSk.api;
    },
    Picture: host('Picture'),
    Group: host('Group'),
  };
});

jest.mock('react-native-reanimated', () => ({
  useDerivedValue: (fn: () => unknown) => ({ value: fn() }),
  useSharedValue: (v: unknown) => ({ value: v }),
}));

type Sk = {
  Surface: { Make(w: number, h: number): SkSurface | null };
  Color(c: string): Float32Array;
};

let Skia: Sk;

beforeAll(async () => {
  const ckPath = resolve('canvaskit-wasm/bin/canvaskit.js');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const init = require(ckPath);
  // o TextDecoder do expo (winter) só fala utf-8; o CanvasKit pede utf-16le na inicialização
  const g = globalThis as unknown as { TextDecoder: unknown };
  const prev = g.TextDecoder;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  g.TextDecoder = require('util').TextDecoder;
  let CK: unknown;
  try {
    CK = await init({ locateFile: (f: string) => path.join(path.dirname(ckPath), f) });
  } finally {
    g.TextDecoder = prev;
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { JsiSkApi } = jest.requireActual('@shopify/react-native-skia/lib/commonjs/skia/web/JsiSkia');
  Skia = JsiSkApi(CK) as Sk;
  mockSk.api = Skia;
}, 60000);

/* eslint-disable @typescript-eslint/no-var-requires */
const load = () => ({
  core: require('../fx-skia') as typeof import('../fx-skia'),
  shapes: require('../fx-shapes') as typeof import('../fx-shapes'),
  auras: require('../fx-auras') as typeof import('../fx-auras'),
  bd: require('../fx-backdrops') as typeof import('../fx-backdrops'),
  layout: require('../layout') as typeof import('../layout'),
  flags: require('../../../../avatar/parts/flags') as typeof import('../../../../avatar/parts/flags'),
});

function surface(w: number, h: number): { s: SkSurface; c: SkCanvas } {
  const s = Skia.Surface.Make(w, h) as SkSurface;
  const c = s.getCanvas();
  c.clear(Skia.Color('rgba(0,0,0,0)'));
  return { s, c };
}

/** alfa de cada pixel (0..255) */
function alphas(s: SkSurface, w: number, h: number): Uint8Array {
  s.flush();
  const img = s.makeImageSnapshot();
  const px = img.readPixels(0, 0, { width: w, height: h, alphaType: 3, colorType: 4 }) as Uint8Array;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = px[i * 4 + 3];
  return out;
}

function rgba(s: SkSurface, w: number, h: number): Uint8Array {
  s.flush();
  return s.makeImageSnapshot().readPixels(0, 0, { width: w, height: h, alphaType: 3, colorType: 4 }) as Uint8Array;
}

function diff(a: Uint8Array, b: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 8) n++;
  return n;
}

describe('auras e fundos no Skia (CanvasKit)', () => {
  it('cada aura desenha (atrás e na frente) e anima', () => {
    const { core, shapes, auras, layout, flags } = load();
    const L = layout.stageLayout('full', 200);
    const F = auras.auraFrame({ w: L.w, h: L.h }, L.body, null);
    for (const id of auras.AURA_IDS) {
      const S = auras.auraSpec(id, null, 'medium', flags.flagOf('rainbow')) as NonNullable<ReturnType<typeof auras.auraSpec>>;
      const shot = (t: number, front: boolean) => {
        const { s, c } = surface(L.w, L.h);
        auras.drawAura(core.skiaPen(c, shapes.SHAPES, false), S, F, t, front);
        return alphas(s, L.w, L.h);
      };
      const a = shot(1.3, false);
      const lit = a.reduce((n, v) => n + (v > 10 ? 1 : 0), 0);
      expect({ id, visible: lit > L.w * L.h * 0.02 }).toEqual({ id, visible: true });
      expect({ id, moves: diff(a, shot(1.9, false)) > 50 }).toEqual({ id, moves: true });
      shot(1.3, true); // a camada da frente não quebra
    }
  });

  it('cada fundo cobre o canvas inteiro, recorta os cantos e o quadro parado se repete', () => {
    const { core, shapes, bd, layout, flags } = load();
    for (const mode of ['full', 'bust'] as const) {
      const L = layout.stageLayout(mode, 160);
      const box = { w: L.w, h: L.h };
      for (const id of bd.BACKDROP_IDS) {
        const S = bd.backdropSpec(id, flags.flagOf('progress'), box) as NonNullable<ReturnType<typeof bd.backdropSpec>>;
        const shot = (t: number) => {
          const { s, c } = surface(L.w, L.h);
          bd.drawBackdrop(core.skiaPen(c, shapes.SHAPES, false), S, box, mode === 'bust' ? L.w / 2 : 24, t);
          return rgba(s, L.w, L.h);
        };
        const a = shot(S.still);
        let opaque = 0;
        for (let i = 3; i < a.length; i += 4) if (a[i] > 250) opaque++;
        const total = L.w * L.h;
        // busto = círculo (π/4 da caixa); corpo inteiro = cantos arredondados
        expect({ id, mode, covered: opaque > total * (mode === 'bust' ? 0.74 : 0.96) }).toEqual({ id, mode, covered: true });
        expect(a[3]).toBeLessThan(10); // canto de cima recortado
        expect(diff(a, shot(S.still))).toBe(0);
      }
    }
  });

  it('AuraFx grava a SkPicture do quadro nas duas camadas; movimento reduzido = quadro parado da aura', () => {
    const { AuraFx } = require('../AuraFx') as typeof import('../AuraFx');
    const { core, shapes, auras, layout, flags } = load();
    const L = layout.stageLayout('full', 200);
    const flag = flags.flagOf('trans');
    const t = { value: 3.7 } as never;
    let r: ReactTestRenderer | null = null;
    const props = { aura: 'galaxy', tint: null, level: 'max' as const, flag, box: { w: L.w, h: L.h }, body: L.body, t };
    act(() => {
      r = create(
        <>
          <AuraFx {...props} still layer="back" />
          <AuraFx {...props} still={false} layer="front" />
        </>,
      );
    });
    const pics = (r as unknown as ReactTestRenderer).root.findAllByType('Picture' as never);
    expect(pics).toHaveLength(2);
    const pic = (pics[0].props as { picture: { value: unknown } }).picture.value as { makeShader?: unknown } | null;
    expect(pic).toBeTruthy();
    // o quadro parado bate com o desenho direto no t `still` da aura
    const draw = (fn: (c: SkCanvas) => void) => {
      const { s, c } = surface(L.w, L.h);
      fn(c);
      return rgba(s, L.w, L.h);
    };
    const S = auras.auraSpec('galaxy', null, 'max', flag) as NonNullable<ReturnType<typeof auras.auraSpec>>;
    const F = auras.auraFrame({ w: L.w, h: L.h }, L.body, null);
    const viaFx = draw((c) => c.drawPicture(pic as never));
    const direct = draw((c) => auras.drawAura(core.skiaPen(c, shapes.SHAPES, false), S, F, S.still, false));
    expect(diff(viaFx, direct)).toBe(0);
    act(() => (r as unknown as ReactTestRenderer).unmount());
  });

  it('BackdropFx: duas partes paradas gravadas uma vez + a animada; sem aura/fundo não monta nada', () => {
    const { AuraFx } = require('../AuraFx') as typeof import('../AuraFx');
    const { BackdropFx } = require('../BackdropFx') as typeof import('../BackdropFx');
    const { layout, flags } = load();
    const L = layout.stageLayout('bust', 160);
    const flag = flags.flagOf('rainbow');
    const t = { value: 1 } as never;
    let r: ReactTestRenderer | null = null;
    act(() => {
      r = create(
        <>
          <BackdropFx backdrop="aurora" flag={flag} box={{ w: L.w, h: L.h }} radius={L.w / 2} t={t} still={false} />
          <BackdropFx backdrop="none" flag={flag} box={{ w: L.w, h: L.h }} radius={L.w / 2} t={t} still={false} />
          <AuraFx aura="none" tint={null} level="medium" flag={flag} box={{ w: L.w, h: L.h }} body={L.body} t={t} still={false} layer="back" />
        </>,
      );
    });
    const pics = (r as unknown as ReactTestRenderer).root.findAllByType('Picture' as never);
    expect(pics).toHaveLength(3);
    for (const p of pics) {
      const v = (p.props as { picture: unknown }).picture as { value?: unknown };
      expect(v && ('value' in v ? v.value : v)).toBeTruthy();
    }
    act(() => (r as unknown as ReactTestRenderer).unmount());
  });
});
