// Partículas das animações no Skia de verdade (CanvasKit, CPU, a mesma API do react-native-skia): cada tipo desenha
// pixels visíveis com as formas próprias (lábios, "HA", fogos), o EmoteFx grava a SkPicture do quadro e bate com o
// desenho direto, e não grava nada sem animação.

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
  };
});

jest.mock('react-native-reanimated', () => ({
  useDerivedValue: (fn: () => unknown) => ({ value: fn() }),
  useSharedValue: (v: unknown) => ({ value: v }),
}));

type Sk = { Surface: { Make(w: number, h: number): SkSurface | null }; Color(c: string): Float32Array };
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
  pen: require('../fx-skia') as typeof import('../fx-skia'),
  fx: require('../../../../avatar/emotes/gestures-fx') as typeof import('../../../../avatar/emotes/gestures-fx'),
  emotes: require('../../../../avatar/emotes') as typeof import('../../../../avatar/emotes'),
});
/* eslint-enable @typescript-eslint/no-var-requires */

const W = 240;
const H = 300;
const ANCH = {
  mouth: { x: 120, y: 82 },
  handL: { x: 70, y: 150 },
  handR: { x: 170, y: 150 },
  head: { x: 120, y: 30 },
  chest: { x: 120, y: 135 },
  pet: { x: 200, y: 230 },
  feet: { x: 120, y: 274 },
  above: { x: 120, y: 11.6 },
};

function shot(fn: (c: SkCanvas) => void): Uint8Array {
  const s = Skia.Surface.Make(W, H) as SkSurface;
  const c = s.getCanvas();
  c.clear(Skia.Color('rgba(0,0,0,0)'));
  fn(c);
  s.flush();
  return s.makeImageSnapshot().readPixels(0, 0, { width: W, height: H, alphaType: 3, colorType: 4 }) as Uint8Array;
}
const lit = (px: Uint8Array) => {
  let n = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i] > 20) n++;
  return n;
};
const diff = (a: Uint8Array, b: Uint8Array) => {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 8) n++;
  return n;
};

describe('partículas no Skia (CanvasKit)', () => {
  it('cada tipo de partícula desenha pixels visíveis e muda com o tempo', () => {
    const { pen, fx } = load();
    const kinds = ['hearts', 'kiss', 'notes', 'sparkles', 'confetti', 'stars', 'bubbles', 'flash', 'fireworks', 'haha', 'petals'] as const;
    for (const kind of kinds) {
      const from = kind === 'confetti' || kind === 'stars' || kind === 'petals' || kind === 'fireworks' ? 'above' : kind === 'haha' ? 'head' : 'chest';
      const S = fx.emoteFxSpec({ dur: 3, loop: false, fx: [{ kind, from, start: 0, end: 0.9, rate: 10 }] });
      const at = (t: number) => shot((c) => fx.drawEmoteFx(pen.skiaPen(c, fx.EMOTE_SHAPES, false), S, t, ANCH, false));
      const a = at(1.2);
      expect({ kind, visible: lit(a) > 150 }).toEqual({ kind, visible: true });
      expect({ kind, moves: diff(a, at(1.45)) > 100 }).toEqual({ kind, moves: true });
    }
  });

  it('EmoteFx grava o quadro (igual ao desenho direto); sem animação ou antes de começar não desenha nada', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { EmoteFx } = require('../EmoteFx') as typeof import('../EmoteFx');
    const { pen, fx, emotes } = load();
    const def = emotes.emoteDef('kiss');
    const t = { value: 1.35 } as never;
    const anchors = { value: ANCH } as never;
    let r: ReactTestRenderer | null = null;
    act(() => {
      r = create(
        <>
          <EmoteFx def={def} t={t} anchors={anchors} still={false} />
          <EmoteFx def={null} t={t} anchors={anchors} still={false} />
        </>,
      );
    });
    const pics = (r as unknown as ReactTestRenderer).root.findAllByType('Picture' as never);
    expect(pics).toHaveLength(1);
    const pic = (pics[0].props as { picture: { value: unknown } }).picture.value;
    const viaFx = shot((c) => c.drawPicture(pic as never));
    const direct = shot((c) => fx.drawEmoteFx(pen.skiaPen(c, fx.EMOTE_SHAPES, false), fx.emoteFxSpec(def), 1.35, ANCH, false));
    expect(lit(viaFx)).toBeGreaterThan(100);
    expect(diff(viaFx, direct)).toBe(0);
    act(() => (r as unknown as ReactTestRenderer).unmount());

    // t = 0 (parada) → quadro vazio
    let r2: ReactTestRenderer | null = null;
    act(() => {
      r2 = create(<EmoteFx def={def} t={{ value: 0 } as never} anchors={anchors} still />);
    });
    const p2 = (r2 as unknown as ReactTestRenderer).root.findByType('Picture' as never);
    expect(lit(shot((c) => c.drawPicture((p2.props as { picture: { value: unknown } }).picture.value as never)))).toBe(0);
    act(() => (r2 as unknown as ReactTestRenderer).unmount());
  });
});
